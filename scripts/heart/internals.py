"""Everything inside the heart: valves, papillary muscles, chordae, the moderator band,
the conduction system, activation times for the depolarisation wave, and the blood flow routes.

  python3 scripts/heart/internals.py   (needs out/body_labeled.npz and out/vessels.npz)

Writes out/internals.npz (meshes with part ids and activation times) and out/meta.json
(flow routes, landmark points and timings the site uses).
"""
import os, sys, json
import numpy as np
import trimesh
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anatomy
from sdf import unit
from parts import PART_INDEX, PARTS
from build_heart import fields
from vessels import tube, smooth, resample

OUT = os.path.join(HERE, 'out')
rng = np.random.RandomState(7)


def perp_frame(n, ref):
    n = unit(n)
    e1 = np.asarray(ref, float) - n * np.dot(ref, n)
    e1 = unit(e1)
    return n, e1, np.cross(n, e1)


def grid_mesh(fn, ns, na):
    """Surface from a function of (s, a) in [0,1]^2."""
    S, A = np.meshgrid(np.linspace(0, 1, ns), np.linspace(0, 1, na), indexing='ij')
    V = fn(S.ravel(), A.ravel())
    F = []
    for i in range(ns - 1):
        for j in range(na - 1):
            a = i * na + j
            F += [[a, a + na, a + 1], [a + 1, a + na, a + na + 1]]
    return V, np.array(F)


def semilunar(c, n, R, ref, H=0.55, belly=0.42):
    """Closed semilunar valve: three cusps hanging from a crown-shaped annulus."""
    n, e1, e2 = perp_frame(n, ref)
    out = []
    centre = c + n * (H * 0.55)
    for k in range(3):
        t0 = k * 2 * np.pi / 3

        def fn(s, a, t0=t0):
            th = t0 + a * 2 * np.pi / 3
            h = H * (1 - np.sin(np.pi * a)) ** 1.5
            ann = c + R * (np.cos(th)[:, None] * e1 + np.sin(th)[:, None] * e2) + h[:, None] * n
            b0 = c + R * (np.cos(t0) * e1 + np.sin(t0) * e2) + H * n
            t1 = t0 + 2 * np.pi / 3
            b1 = c + R * (np.cos(t1) * e1 + np.sin(t1) * e2) + H * n
            w = np.clip(a * 2, 0, 1)[:, None]; w2 = np.clip(a * 2 - 1, 0, 1)[:, None]
            edge = np.where((a < 0.5)[:, None], b0 * (1 - w) + centre * w, centre * (1 - w2) + b1 * w2)
            p = ann * (1 - s[:, None]) + edge * s[:, None]
            return p - n * (belly * np.sin(np.pi * s) * np.sin(np.pi * a))[:, None]
        out.append(grid_mesh(fn, 9, 17))
    return out


def atrioventricular(c, n, R, ref, sectors, depth=1.25, free=0.5, scallops=None):
    """Open-ish AV valve: leaflets hang from the annulus into the ventricle.
    sectors: list of (start, end) angles in degrees, measured from `ref`."""
    n, e1, e2 = perp_frame(n, ref)
    meshes, edges = [], []
    for si, (a0, a1) in enumerate(sectors):
        a0r, a1r = np.radians(a0), np.radians(a1)
        sc = scallops[si] if scallops else 1

        def fn(s, a, a0r=a0r, a1r=a1r, sc=sc):
            th = a0r + a * (a1r - a0r)
            prof = np.sin(np.pi * a) ** 0.6
            if sc > 1:
                prof = prof * (0.82 + 0.18 * np.abs(np.sin(np.pi * a * sc)))
            dep = depth * (0.3 + 0.7 * prof)
            rad = R * (1 - s) + R * free * s
            radial = np.cos(th)[:, None] * e1 + np.sin(th)[:, None] * e2
            return c + radial * rad[:, None] + n * (dep * s ** 1.1)[:, None]
        V, F = grid_mesh(fn, 9, 21)
        meshes.append(V.reshape(9, 21, 3))
        edges.append(V.reshape(9, 21, 3)[-1])
    return meshes, edges, (n, e1, e2)


def sheet(V3):
    ns, na, _ = V3.shape
    F = []
    for i in range(ns - 1):
        for j in range(na - 1):
            a = i * na + j
            F += [[a, a + na, a + 1], [a + 1, a + na, a + na + 1]]
    return V3.reshape(-1, 3), np.array(F)


class Inner:
    """The inside surfaces of chosen parts, for seating things on the endocardium."""

    def __init__(self, d, names):
        ids = [PART_INDEX[k] for k in names]
        inner = d['inner'].astype(bool)
        F = d['f']
        keep = inner[F].all(1) & np.isin(d['part'][F[:, 0]], ids)
        self.mesh = trimesh.Trimesh(d['v'], F[keep], process=False)
        self.prox = trimesh.proximity.ProximityQuery(self.mesh)
        self.ray = trimesh.ray.ray_triangle.RayMeshIntersector(self.mesh)

    def snap(self, P, lift=0.0):
        P = np.atleast_2d(P)
        c, _, tri = self.prox.on_surface(P)
        return c + self.mesh.face_normals[tri] * lift

    def hit(self, origin, direction):
        loc, ri, ti = self.ray.intersects_location([origin], [unit(direction)], multiple_hits=True)
        if len(loc) == 0:
            return None, None
        j = np.argmin(np.linalg.norm(loc - origin, axis=1))
        return loc[j], self.mesh.face_normals[ti[j]]


def cavity_points(P, L, O):
    """A deep interior point for each cavity, found on a coarse grid."""
    lo, hi = np.array([-5.4, -5.6, -6.6]), np.array([5.0, 10.0, 4.6])
    h = 0.14
    g = np.stack(np.meshgrid(*[np.arange(lo[i], hi[i], h) for i in range(3)], indexing='ij'), -1).reshape(-1, 3)
    final, D, C, U = fields(g, P, L, O)
    deep = {}
    for k, c in C.items():
        m = (c < -0.25) & (final < -0.0)
        m = (c < -0.25)
        if m.sum() < 5:
            continue
        pts = g[m]
        cen = pts.mean(0)
        deep[k] = pts[np.argmin(np.linalg.norm(pts - cen, axis=1) + 0.6 * c[m])]
    return deep


def path_on(inner, pts, lift, n=40):
    """Smooth path through waypoints, seated on an inner surface and lifted into the cavity."""
    P, _ = resample(np.asarray(pts, float), 0.08)
    P = smooth(P, 6)
    P = inner.snap(P, lift)
    return smooth(P, 3)


def main():
    d = np.load(os.path.join(OUT, 'body_labeled.npz'))
    P, L, O = anatomy.build()
    V = anatomy.VALVES
    deep = cavity_points(P, L, O)
    print('cavity points', {k: np.round(v, 2).tolist() for k, v in deep.items() if not k.startswith('o_')})
    lv_in = Inner(d, ['lv', 'ivs'])
    rv_in = Inner(d, ['rv', 'ivs', 'rvot'])
    ra_in = Inner(d, ['ra', 'ias', 'fossa'])
    la_in = Inner(d, ['la', 'ias'])
    meshes = []   # (part, V, F, time_ms)

    def add(part, Vv, Ff, t=-1.0):
        tt = np.full(len(Vv), t, np.float32) if np.isscalar(t) else np.asarray(t, np.float32)
        meshes.append((part, np.asarray(Vv, np.float32), np.asarray(Ff, np.int32), tt))

    # ---- valves
    av, pv, mv, tv = V['av'], V['pv'], V['mv'], V['tv']
    for Vv, Ff in semilunar(av['c'], av['n'], 1.0, [0, 0, 1.0]):
        add('av', Vv, Ff)
    for Vv, Ff in semilunar(pv['c'], pv['n'], 0.95, [1.0, 0, 0]):
        add('pv', Vv, Ff)
    lvc = deep['lv']
    rvc = deep['rv']
    # mitral: the anterior leaflet faces the aortic valve, the posterior one has three scallops
    mv_ref = av['c'] - mv['c']
    mvm, mv_edges, mv_fr = atrioventricular(mv['c'], mv['n'], 1.12, mv_ref,
                                            [(-62, 62), (70, 290)], depth=1.35, free=0.45, scallops=[1, 3])
    for m in mvm:
        add('mv', *sheet(m))
    # tricuspid: septal leaflet towards the septum, anterior towards the front, posterior below
    tv_ref = lvc - tv['c']
    tvm, tv_edges, tv_fr = atrioventricular(tv['c'], tv['n'], 1.18, tv_ref,
                                            [(-55, 55), (63, 190), (198, 297)], depth=1.3, free=0.5)
    for m in tvm:
        add('tv', *sheet(m))

    # ---- papillary muscles (base on the wall, tip pointing at the valve) and chordae
    ax = anatomy.LV_AXIS
    def perp_ax(v):
        v = np.asarray(v, float) - ax * np.dot(v, ax); return unit(v)
    sept = perp_ax(rvc - lvc)
    ant = perp_ax([0, 0.2, 1.0])
    inf_ = perp_ax([0, -1.0, -0.2])
    pm_lv = {}
    for name, dirv in (('al', unit(-sept * 0.75 + ant * 0.8)), ('pm', unit(-sept * 0.35 + inf_ * 0.95))):
        o = lvc + ax * 1.1
        base, nb = lv_in.hit(o, dirv)
        tip = base + unit(mv['c'] + mv['n'] * 1.0 - base) * 1.9
        path = np.linspace(base - nb * 0.25, tip, 22)
        Vv, Ff = tube(path, np.interp(np.linspace(0, 1, 22), [0, 0.15, 0.45, 0.8, 0.93, 1], [0.5, 0.46, 0.42, 0.3, 0.22, 0.1]), sides=20)
        add('pap_lv', Vv, Ff)
        pm_lv[name] = (base, tip)
    # each mitral leaflet takes chordae from both muscles; split the free edges by side
    chords = []
    def chordae(pm, edges, k_per, side_ref):
        for e in edges:
            pts = e[1:-1]
            side = np.sign((pts - pts.mean(0)) @ side_ref)
            for name, (base, tip) in pm.items():
                sel = pts[side == (1 if name in ('al', 'ant', 'sep') else -1)] if len(pm) == 2 else pts
                if len(sel) == 0:
                    continue
                idx = np.linspace(0, len(sel) - 1, min(k_per, len(sel))).astype(int)
                for p in sel[idx]:
                    a = tip + rng.normal(0, 0.06, 3)
                    mid = (a + p) / 2 + unit(tip - p) * 0.0
                    chords.append(np.linspace(a, p, 6))
    side_ref = unit(pm_lv['al'][1] - pm_lv['pm'][1])
    chordae(pm_lv, mv_edges, 5, side_ref)

    # right ventricle: anterior (big, takes the moderator band), posterior, septal
    pm_rv = {}
    rv_dirs = {'ant': unit([-0.55, -0.35, 0.85]), 'post': unit([-0.25, -0.95, 0.1])}
    for name, dirv in rv_dirs.items():
        o = rvc + ax * 0.6
        base, nb = rv_in.hit(o, dirv)
        if base is None:
            base, nb = rv_in.hit(rvc, dirv)
        tip = base + unit(tv['c'] + tv['n'] * 1.0 - base) * (1.6 if name == 'ant' else 1.2)
        path = np.linspace(base - nb * 0.2, tip, 18)
        r0 = 0.4 if name == 'ant' else 0.3
        Vv, Ff = tube(path, np.interp(np.linspace(0, 1, 18), [0, 0.3, 0.8, 0.93, 1], [r0, r0 * 0.88, r0 * 0.6, r0 * 0.42, 0.08]), sides=16)
        add('pap_rv', Vv, Ff)
        pm_rv[name] = (base, tip)
    # septal papillary muscle: small, from the septum close to the valve
    sep_base = rv_in.snap(tv['c'] + tv['n'] * 1.3 + sept * -1.0 + ax * 0.3)[0]
    sep_tip = sep_base + unit(tv['c'] + tv['n'] * 0.9 - sep_base) * 0.6
    Vv, Ff = tube(np.linspace(sep_base, sep_tip, 10), np.interp(np.linspace(0, 1, 10), [0, 0.7, 1], [0.2, 0.15, 0.06]), sides=12)
    add('pap_rv', Vv, Ff)
    pm_rv['sep'] = (sep_base, sep_tip)
    # tricuspid chordae: each leaflet to the two muscles at its commissures
    for e, pms in zip(tv_edges, (('sep', 'ant'), ('ant', 'post'), ('post', 'sep'))):
        pts = e[1:-1]
        half = len(pts) // 2
        for name, sel in ((pms[0], pts[:half]), (pms[1], pts[half:])):
            tip = pm_rv[name][1]
            for p in sel[::2]:
                chords.append(np.linspace(tip + rng.normal(0, 0.05, 3), p, 6))
    cv, cf = [], []
    for c in chords:
        Vv, Ff = tube(c, np.full(len(c), 0.028), sides=4, cap=False)
        cf.append(Ff + sum(len(x) for x in cv)); cv.append(Vv)
    add('chordae', np.vstack(cv), np.vstack(cf))

    # moderator band: low on the septum across to the base of the anterior papillary muscle
    mb_s = rv_in.snap(rvc + ax * 1.2 - sept * 0.2 + rng.normal(0, 0.0, 3))[0]
    # pick the septal point properly: walk from the RV cavity towards the LV
    hit_s, _ = rv_in.hit(rvc + ax * 1.15, -sept)
    if hit_s is not None:
        mb_s = hit_s
    mb_e = pm_rv['ant'][0] + unit(pm_rv['ant'][1] - pm_rv['ant'][0]) * 0.35
    mb_path = np.linspace(mb_s, mb_e, 16)
    mb_path[1:-1] += unit(np.cross(mb_e - mb_s, ax)) * 0.0
    Vv, Ff = tube(mb_path, np.interp(np.linspace(0, 1, 16), [0, 0.5, 1], [0.24, 0.17, 0.22]), sides=14)
    add('modband', Vv, Ff)

    # ---- conduction system
    svc_mouth = P['svc'].C[-1]
    ext = d['inner'] == 0
    Vb = d['v']
    ra_ext = ext & np.isin(d['part'], [PART_INDEX['ra'], PART_INDEX['svc'], PART_INDEX['ra_aur']])
    target = svc_mouth + np.array([-0.9, -0.3, 0.75])
    i = np.argmin(np.linalg.norm(Vb[ra_ext] - target, axis=1))
    san_c = Vb[ra_ext][i]
    san_n = unit(san_c - (svc_mouth + np.array([0, -0.5, 0])))
    san_path = np.array([san_c + np.array([0, 0.65, -0.1]), san_c, san_c + np.array([0.1, -0.7, 0.15])])
    san_path, _ = resample(san_path, 0.05)
    san_path = smooth(san_path, 4) - san_n * 0.05
    Vv, Ff = tube(san_path, np.interp(np.linspace(0, 1, len(san_path)), [0, 0.3, 0.6, 1], [0.08, 0.24, 0.22, 0.07]), sides=12)
    add('san', Vv, Ff, 0.0)

    # AV node: apex of the triangle of Koch, on the right-atrial face of the septum just above
    # the septal leaflet of the tricuspid valve, in front of the coronary sinus opening
    ias_pts = Vb[(d['inner'] == 1) & np.isin(d['part'], [PART_INDEX['ias'], PART_INDEX['fossa']])]
    ias_c = ias_pts.mean(0)
    koch = tv['c'] * 0.55 + ias_c * 0.45 + np.array([0, -0.35, 0])
    avn_c = ra_in.snap(koch, 0.12)[0]
    avn_dir = unit(tv['c'] - ias_c)
    Vv, Ff = tube(np.linspace(avn_c - avn_dir * 0.35, avn_c + avn_dir * 0.35, 10), np.array([0.08, 0.17, 0.22, 0.24, 0.24, 0.23, 0.2, 0.17, 0.12, 0.07]), sides=12)
    add('avn', Vv, Ff, 85.0)

    # internodal tracts (anterior, middle, posterior) and Bachmann's bundle
    def tract(points, t0, t1, part='internodal', inner=ra_in, lift=0.1, r=0.07):
        Pp = path_on(inner, points, lift)
        u = np.linspace(0, 1, len(Pp))
        Vv, Ff = tube(Pp, np.full(len(Pp), r), sides=6)
        tt = np.repeat(t0 + (t1 - t0) * u, 6)
        tt = np.concatenate([tt, [t0, t1]])
        add(part, Vv, Ff, tt)
        return Pp
    ra_top = deep['ra'] + np.array([0.3, 1.2, 0.4])
    tract([san_c, ra_top, ias_c + np.array([0.0, 0.7, 0.4]), avn_c], 0, 40)
    tract([san_c, svc_mouth + np.array([0.9, -0.6, -0.5]), ias_c + np.array([-0.2, 0.2, 0.0]), avn_c], 0, 42)
    ivc_mouth = P['ivc'].C[0]
    tract([san_c, deep['ra'] + np.array([-1.0, -0.2, 0.3]), ivc_mouth + np.array([0.6, 0.6, 0.6]), avn_c], 0, 45)
    la_aur_base = P['la_aur'].C[0]
    bach_ra = ra_in.snap(ias_c + np.array([0.2, 0.9, 0.6]), 0.1)[0]
    bach_la = la_in.snap(la_aur_base + np.array([-0.4, -0.1, -0.2]), 0.1)[0]
    b1 = tract([san_c, bach_ra], 0, 18)
    b2 = tract([bach_ra, ias_c + np.array([0.7, 0.9, -0.2]), bach_la], 18, 40, inner=la_in)

    # His bundle: through the central fibrous body to the crest of the muscular septum
    lv_sep = Inner(d, ['ivs'])
    crest_ref = av['c'] * 0.5 + tv['c'] * 0.5 + ax * 0.9
    crest = lv_sep.snap(crest_ref)[0]
    his = np.linspace(avn_c + avn_dir * 0.3, crest, 12)
    his = smooth(his, 2)
    Vv, Ff = tube(his, np.full(len(his), 0.11), sides=8)
    add('his', Vv, Ff, np.concatenate([np.repeat(np.linspace(120, 140, len(his)), 8), [120, 140]]))

    # bundle branches
    lv_side = Inner(d, ['ivs', 'lv'])
    def seat_lv(pts, lift=0.08):
        Pp, _ = resample(np.asarray(pts, float), 0.08)
        Pp = smooth(Pp, 6)
        return smooth(lv_side.snap(Pp, lift), 3)
    def seat_rv(pts, lift=0.08):
        Pp, _ = resample(np.asarray(pts, float), 0.08)
        Pp = smooth(Pp, 6)
        return smooth(rv_in.snap(Pp, lift), 3)
    lbb_fans = []
    for name in ('al', 'pm'):
        base = pm_lv[name][0]
        mid = crest + (base - crest) * 0.45 + sept * 0.6
        Pp = seat_lv([crest, mid, base + unit(lvc - base) * 0.3])
        lbb_fans.append(Pp)
        u = np.linspace(0, 1, len(Pp))
        Vv, Ff = tube(Pp, np.interp(u, [0, 1], [0.1, 0.06]), sides=6)
        add('lbb', Vv, Ff, np.concatenate([np.repeat(140 + 25 * u, 6), [140, 165]]))
    rbb = seat_rv([crest + sept * -0.3, crest + (mb_s - crest) * 0.5 - sept * 0.2, mb_s])
    rbb = np.vstack([rbb, mb_path[1:]])
    u = np.linspace(0, 1, len(rbb))
    Vv, Ff = tube(rbb, np.full(len(rbb), 0.06), sides=6)
    add('rbb', Vv, Ff, np.concatenate([np.repeat(140 + 28 * u, 6), [140, 168]]))

    # Purkinje fibres: branching strands under the endocardium of both ventricles
    lower = Inner(d, ['lv', 'ivs', 'rv', 'apex'])
    starts = [f[-1] for f in lbb_fans] + [rbb[-1]] + [f[len(f) // 2] for f in lbb_fans]
    strands = []
    pool = list(starts)
    for k in range(46):
        p = pool[rng.randint(len(pool))] if k > 5 else starts[k % len(starts)]
        dirv = unit(rng.normal(0, 1, 3) + ax * 0.6)
        pts = [p]
        for _ in range(int(rng.randint(7, 13))):
            q = pts[-1] + dirv * 0.3
            q = lower.snap(q, 0.05)[0]
            dirv = unit(dirv + rng.normal(0, 0.45, 3))
            pts.append(q)
        pts = smooth(np.array(pts), 2)
        strands.append(pts)
        pool.extend(pts[::3])
    pv_, pf_, pt_ = [], [], []
    for s_ in strands:
        Vv, Ff = tube(s_, np.linspace(0.045, 0.022, len(s_)), sides=4, cap=False)
        pf_.append(Ff + sum(len(x) for x in pv_)); pv_.append(Vv)
    PV = np.vstack(pv_)
    tree_pts = np.vstack(starts)
    t_purk = 165 + 6 * np.min(np.linalg.norm(PV[:, None] - tree_pts[None], axis=2), 1)
    add('purk', PV, np.vstack(pf_), t_purk)

    # ---- activation time on the body: atria from the sinus node, ventricles from the Purkinje net
    part = d['part']
    t_body = np.full(len(Vb), -1.0, np.float32)
    atr = np.isin(part, [PART_INDEX[k] for k in ('ra', 'ra_aur', 'ias', 'fossa')])
    t_body[atr] = 9.0 * np.linalg.norm(Vb[atr] - san_c, axis=1)
    la_ = np.isin(part, [PART_INDEX[k] for k in ('la', 'la_aur')])
    t_body[la_] = 22 + 9.0 * np.linalg.norm(Vb[la_] - bach_la, axis=1)
    ven = np.isin(part, [PART_INDEX[k] for k in ('lv', 'rv', 'rvot', 'apex', 'ivs')])
    net = cKDTree(np.vstack(strands + lbb_fans + [rbb]))
    dist, _ = net.query(Vb[ven])
    t_body[ven] = 165 + 13.0 * dist + 12 * (d['inner'][ven] == 0)

    # ---- flow routes (for the blood flow particles)
    def route(pts):
        Pp, _ = resample(np.asarray(pts, float), 0.15)
        return np.round(smooth(Pp, 8), 3).tolist()
    pt_split = P['pt'].C[-1]
    flows = {
        'svc': route([P['svc'].C[0], P['svc'].C[len(P['svc'].C) // 2], deep['ra'], tv['c'], tv['c'] + tv['n'] * 1.2, rvc, deep['rvot'], pv['c'], P['pt'].C[len(P['pt'].C) // 2], pt_split]),
        'ivc': route([P['ivc'].C[-1], P['ivc'].C[0], deep['ra'], tv['c'], tv['c'] + tv['n'] * 1.2, rvc, deep['rvot'], pv['c'], P['pt'].C[len(P['pt'].C) // 2], pt_split]),
        'lpa': route([pt_split, P['lpa'].C[len(P['lpa'].C) // 2], P['lpa'].C[-1]]),
        'rpa': route([pt_split, P['rpa'].C[len(P['rpa'].C) // 3], P['rpa'].C[-1]]),
    }
    for k in ('rspv', 'ripv', 'lspv', 'lipv'):
        flows[k] = route([P[k].C[0], P[k].C[-1], deep['la'], mv['c'], mv['c'] + mv['n'] * 1.2, lvc, lvc + ax * 1.6, lvc + ax * 0.4 + sept * 0.7, av['c'] - av['n'] * 0.6, av['c'], P['aorta'].C[len(P['aorta'].C) // 6], P['aorta'].C[len(P['aorta'].C) // 3]])
    ao = P['aorta'].C
    flows['arch'] = route([ao[len(ao) // 3], ao[len(ao) // 2], ao[int(len(ao) * 0.7)], ao[-1]])
    for k in ('bct', 'lcca', 'lsa'):
        c = P[k].C
        flows[k] = route([c[0], c[len(c) // 2], c[-1]])

    # write
    vs, fs, ps, ts = [], [], [], []
    off = 0
    for part_name, Vv, Ff, tt in meshes:
        vs.append(Vv); fs.append(Ff + off); ps.append(np.full(len(Vv), PART_INDEX[part_name], np.int16)); ts.append(tt)
        off += len(Vv)
    np.savez_compressed(os.path.join(OUT, 'internals.npz'), v=np.vstack(vs), f=np.vstack(fs), part=np.concatenate(ps), t=np.concatenate(ts))
    np.save(os.path.join(OUT, 'body_time.npy'), t_body)
    landmarks = {
        'san': san_c, 'avn': avn_c, 'his': crest, 'apex': anatomy.APEX, 'mv': mv['c'], 'tv': tv['c'], 'av': av['c'], 'pv': pv['c'],
        'lv': lvc, 'rv': rvc, 'ra': deep['ra'], 'la': deep['la'], 'fossa': ias_c,
    }
    meta = {
        'flows': flows,
        'deoxy': ['svc', 'ivc', 'lpa', 'rpa'],
        'landmarks': {k: np.round(np.asarray(v, float), 3).tolist() for k, v in landmarks.items()},
        'timing_ms': {'p_wave': [0, 95], 'av_delay': [85, 130], 'his': [120, 140], 'branches': [140, 168], 'purkinje': [165, 200], 'qrs': [165, 250]},
    }
    with open(os.path.join(OUT, 'meta.json'), 'w') as f:
        json.dump(meta, f)
    counts = {}
    for part_name, Vv, Ff, _ in meshes:
        counts[part_name] = counts.get(part_name, 0) + len(Ff)
    print(counts)


if __name__ == '__main__':
    main()
