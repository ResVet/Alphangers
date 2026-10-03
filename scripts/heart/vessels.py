"""Coronary arteries, cardiac veins and the ligamentum arteriosum.

Each vessel is laid out in a simple map of the heart's outside: an angle around the long axis
and a distance down it towards the apex. Grooves found on the sculpted body (grooves.py) give
the main routes, so the arteries really sit in the interventricular and coronary grooves.
Every point is then cast onto the surface and the tube is lifted so it rides half in the groove.

  python3 scripts/heart/vessels.py   (needs out/body_labeled.npz, writes out/vessels.npz)
"""
import os, sys
import numpy as np
import trimesh

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anatomy
from sdf import unit
from grooves import Surface, ordered, LEFT_V, RIGHT_V, ATRIA, VENTR
from parts import PART_INDEX

OUT = os.path.join(HERE, 'out')
D2R = np.pi / 180
SCALE = 1.2   # vessels a touch thicker than life so they read (and click) at screen size


def wrap(a):
    return (a + 180) % 360 - 180


class Map:
    def __init__(self, S):
        self.S = S
        iv = S.boundary(LEFT_V, RIGHT_V)
        av = S.boundary(ATRIA, VENTR)
        a = np.degrees(S.angle(iv)); t = S.along(iv)
        ant = ordered(iv[a < -90], t[a < -90], 14)
        inf = ordered(iv[(a > -40) & (a < 70)], t[(a > -40) & (a < 70)], 14)
        ring = ordered(av, S.angle(av), 36, -np.pi, np.pi, smooth=1)
        self.ant = (S.along(ant), np.degrees(S.angle(ant)))
        self.inf = (S.along(inf), np.degrees(S.angle(inf)))
        ra = np.degrees(S.angle(ring))
        o = np.argsort(ra)
        # unwrap so the ring can be sampled across the +-180 seam
        self.ring = (np.concatenate([ra[o] - 360, ra[o], ra[o] + 360]),
                     np.tile(S.along(ring)[o], 3))
        self.ray = trimesh.ray.ray_triangle.RayMeshIntersector(S.mesh)

    def ant_phi(self, t):
        return np.interp(t, *self.ant)

    def inf_phi(self, t):
        return np.interp(t, *self.inf)

    def ring_t(self, phi):
        return np.interp(phi, *self.ring)

    def cast(self, phi, t):
        """Outside surface point (and normal) at angle phi (degrees) and distance t along the axis."""
        S = self.S
        phi = np.atleast_1d(phi).astype(float); t = np.atleast_1d(t).astype(float)
        org = S.base + np.outer(t, S.axis)
        dirs = np.outer(np.cos(phi * D2R), S.e1) + np.outer(np.sin(phi * D2R), S.e2)
        loc, ri, ti = self.ray.intersects_location(org, dirs, multiple_hits=True)
        pts = np.zeros((len(phi), 3)); nrm = np.zeros((len(phi), 3)); ok = np.zeros(len(phi), bool)
        for i in range(len(phi)):
            m = ri == i
            if not m.any():
                continue
            dist = np.linalg.norm(loc[m] - org[i], axis=1)
            j = np.argmin(dist)
            pts[i] = loc[m][j]; nrm[i] = S.mesh.face_normals[ti[m][j]]; ok[i] = True
        return pts[ok], nrm[ok]


def resample(P, step=0.07):
    L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    n = max(int(L[-1] / step), 2)
    s = np.linspace(0, L[-1], n)
    return np.stack([np.interp(s, L, P[:, k]) for k in range(3)], 1), s / L[-1]


def smooth(P, it=3):
    P = P.copy()
    for _ in range(it):
        P[1:-1] = 0.25 * P[:-2] + 0.5 * P[1:-1] + 0.25 * P[2:]
    return P


def lay(S, P, radius, lift=0.55):
    """Resample, smooth and seat the path on the surface, lifted by a fraction of its radius."""
    P, u = resample(P)
    P = smooth(P, 4)
    r = np.interp(u, np.linspace(0, 1, len(radius)), radius)
    c, _, tri = S.prox.on_surface(P)
    n = S.mesh.face_normals[tri]
    # keep points that were already floating (ostia, the run over the aortic root) where they are
    gap = np.einsum('ij,ij->i', P - c, n)
    seat = gap < 0.6
    P[seat] = c[seat] + n[seat] * (r[seat] * lift)[:, None]
    return smooth(P, 2), r


def tube(P, r, sides=10, cap=True):
    """Tube mesh along the polyline with parallel-transport frames."""
    T = np.gradient(P, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    n0 = np.cross(T[0], [0, 1, 0])
    if np.linalg.norm(n0) < 1e-3:
        n0 = np.cross(T[0], [1, 0, 0])
    n0 /= np.linalg.norm(n0)
    N = [n0]
    for i in range(1, len(P)):
        n = N[-1] - T[i] * np.dot(N[-1], T[i])
        N.append(n / np.linalg.norm(n))
    N = np.array(N); B = np.cross(T, N)
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    V = (P[:, None, :] + r[:, None, None] * (np.cos(ang)[None, :, None] * N[:, None, :] + np.sin(ang)[None, :, None] * B[:, None, :])).reshape(-1, 3)
    F = []
    for i in range(len(P) - 1):
        for j in range(sides):
            a = i * sides + j; b = i * sides + (j + 1) % sides
            F += [[a, a + sides, b], [b, a + sides, b + sides]]
    V = list(V)
    if cap:
        for end, sgn in ((0, -1), (len(P) - 1, 1)):
            c = len(V)
            V.append(P[end] + T[end] * sgn * r[end] * 0.6)
            base = end * sides
            for j in range(sides):
                a = base + j; b = base + (j + 1) % sides
                F.append([c, b, a] if sgn < 0 else [c, a, b])
    return np.array(V), np.array(F)


def build():
    d = np.load(os.path.join(OUT, 'body_labeled.npz'))
    S = Surface(d)
    M = Map(S)
    paths = {}

    # coronary ostia on the aortic root, just above the valve in the right and left sinuses
    av = anatomy.VALVES['av']['c']; n = anatomy.VALVES['av']['n']
    sinus = av + n * 0.75
    def perp(v):
        v = np.asarray(v, float); v = v - n * np.dot(v, n); return v / np.linalg.norm(v)
    os_r = sinus + perp([-0.35, 0.0, 1.0]) * 1.42
    os_l = sinus + perp([1.0, 0.1, -0.45]) * 1.42

    def ring(p0, p1, k=40, dt=0.0):
        phi = np.linspace(p0, p1, k)
        return M.cast(wrap(phi), M.ring_t(phi) + dt)[0]

    def ant(t0, t1, k=30, dphi=0.0):
        t = np.linspace(t0, t1, k)
        return M.cast(M.ant_phi(t) + dphi, t)[0]

    def inf(t0, t1, k=30, dphi=0.0):
        t = np.linspace(t0, t1, k)
        return M.cast(M.inf_phi(t) + dphi, t)[0]

    def line(a, b, k=30):
        phi = np.linspace(a[0], b[0], k); t = np.linspace(a[1], b[1], k)
        return M.cast(wrap(phi), t)[0]

    crux_phi = float(M.inf_phi(M.inf[0][0]))
    crux_t = float(M.ring_t(crux_phi))
    bif = M.cast(-160.0, 0.55)[0][0] + 0.0
    bif = bif + unit(bif - S.base) * 0.12

    # right coronary artery: right sinus, out between the right auricle and the conus,
    # down the right coronary groove, round the acute margin to the crux
    rca_run = ring(-95, crux_phi, 60)
    paths['rca'] = (np.vstack([os_r, (os_r + rca_run[0]) / 2 + unit(os_r - av) * 0.3, rca_run]), [0.2, 0.19, 0.17, 0.15, 0.14])
    paths['pda'] = (np.vstack([rca_run[-1], inf(crux_t, 4.7, 30)]), [0.13, 0.1, 0.07, 0.05])
    am_phi = -10.0
    am0 = M.cast(am_phi, M.ring_t(am_phi))[0][0]
    paths['rmarg'] = (np.vstack([am0, line((am_phi + 2, M.ring_t(am_phi) + 0.3), (-4, 4.4), 30)]), [0.11, 0.08, 0.05])

    # left main: left sinus, behind the pulmonary trunk, to its split under the left auricle
    paths['lmca'] = (np.vstack([os_l, (os_l + bif) / 2 + np.array([0.0, 0.25, 0.0]), bif]), [0.23, 0.22, 0.21])
    lad = ant(0.7, 5.75, 40)
    wrap_apex = inf(5.6, 5.0, 8)
    paths['lad'] = (np.vstack([bif, lad, wrap_apex]), [0.19, 0.17, 0.14, 0.1, 0.07, 0.05])
    d0 = M.cast(M.ant_phi(1.9), 1.9)[0][0]
    paths['diag'] = (np.vstack([d0, line((M.ant_phi(1.9) - 5, 2.05), (-178, 4.3), 30)]), [0.12, 0.09, 0.05])
    lcx = ring(-178, -265, 45)   # runs leftwards, past the left border, onto the back
    paths['lcx'] = (np.vstack([bif, lcx]), [0.17, 0.15, 0.12, 0.09])
    om0 = M.cast(wrap(-205.0), M.ring_t(-205.0))[0][0]
    paths['om'] = (np.vstack([om0, line((wrap(-207.0), M.ring_t(-205.0) + 0.35), (wrap(-212.0), 4.4), 30)]), [0.12, 0.09, 0.05])

    # veins: great cardiac vein beside the LAD then along the left groove, the coronary sinus
    # in the back of the groove, middle and small cardiac veins draining into it
    gcv_iv = ant(5.1, 0.75, 34, dphi=-8.0)
    gcv_av = ring(-170, -240, 30, dt=-0.12)
    paths['gcv'] = (np.vstack([gcv_iv, gcv_av]), [0.1, 0.13, 0.17, 0.2])
    cs = ring(-240, crux_phi - 360 + 12, 40, dt=-0.28)
    paths['cs'] = (cs, [0.26, 0.32, 0.36, 0.38])
    paths['mcv'] = (np.vstack([inf(5.0, crux_t + 0.25, 30, dphi=7.0), cs[-4]]), [0.07, 0.1, 0.14])
    paths['scv'] = (np.vstack([ring(-16, crux_phi - 6, 30, dt=0.28), cs[-2]]), [0.06, 0.07, 0.08])

    # ligamentum arteriosum: start of the left pulmonary artery to the underside of the arch
    P_, _, _ = anatomy.build()
    lpa, ao = P_['lpa'], P_['aorta']
    li = np.arange(len(lpa.C))[lpa.u < 0.35]
    ai = np.arange(len(ao.C))[(ao.u > 0.44) & (ao.u < 0.58)]
    dd = np.linalg.norm(lpa.C[li][:, None] - ao.C[ai][None], axis=2)
    i, j = np.unravel_index(np.argmin(dd), dd.shape)
    a, b = lpa.C[li[i]], ao.C[ai[j]]
    e = unit(b - a)
    lig = np.array([a + e * (lpa.R[li[i]] - 0.05), b - e * (ao.R[ai[j]] - 0.05)])

    meshes = []
    for name, (P, rad) in paths.items():
        Pl, r = lay(S, P, np.array(rad, float) * SCALE)
        V, F = tube(Pl, r, sides=10)
        meshes.append((name, V, F))
    V, F = tube(np.linspace(lig[0], lig[1], 12), np.full(12, 0.11), sides=8)
    meshes.append(('lig_art', V, F))
    return meshes


def main():
    meshes = build()
    vs, fs, ps = [], [], []
    off = 0
    for name, V, F in meshes:
        vs.append(V); fs.append(F + off); ps.append(np.full(len(V), PART_INDEX[name], np.int16))
        off += len(V)
        print(f'{name:8s} {len(F):6d} faces')
    np.savez_compressed(os.path.join(OUT, 'vessels.npz'), v=np.vstack(vs).astype(np.float32),
                        f=np.vstack(fs).astype(np.int32), part=np.concatenate(ps))


if __name__ == '__main__':
    main()
