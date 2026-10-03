"""Sculpts the heart from signed-distance shapes and writes the mesh files the site loads.

  python3 scripts/heart/build_heart.py            # full quality
  python3 scripts/heart/build_heart.py --draft    # coarse grid, for quick looks

Output: scripts/heart/out/*.npz (raw parts), then pack.mjs turns them into public/models/heart.glb.
"""
import os, sys, time, json
import numpy as np
from skimage.measure import marching_cubes
import trimesh
import fast_simplification

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sdf import smin, smax, unit, v
import anatomy

DRAFT = '--draft' in sys.argv
H = 0.11 if DRAFT else 0.065
BOX = (v(-5.4, -5.6, -6.6), v(5.0, 10.0, 4.6))
OUT = os.path.join(HERE, 'out')


EXCLUDE = {
    'rv': ['lv', 'aorta'], 'rvot': ['lv', 'aorta'], 'ra': ['la', 'aorta'], 'ra_aur': ['aorta'],
    'la': ['aorta'], 'la_aur': ['pt'],
}

KEEP_APART = [
    ('ra', 'o_av', 0.25), ('ra', 'o_mv', 0.25), ('ra', 'lv', 0.3), ('rv', 'o_av', 0.25), ('rv', 'o_mv', 0.3),
    ('rvot', 'o_av', 0.3), ('o_tv', 'o_av', 0.2), ('o_tv', 'o_mv', 0.25), ('o_tv', 'lv', 0.3),
    ('ra_aur', 'o_av', 0.25), ('la', 'o_av', 0.2),
]


def ramp_k(u, k, until=0.12):
    """Blend radius that is k at the vessel root and fades out along it, so vessels
    merge into the chamber they leave but pass their neighbours with a clean edge."""
    w = np.clip(1 - (u - until * 0.4) / (until * 0.6), 0, 1)
    w[u < 0] = 0
    return np.maximum(k * w, 1e-4)


def fields(Pts, P, L, O):
    """Every component distance at the given points (dict) plus the final solid."""
    D = {}
    U = {}
    for k, f in P.items():
        if hasattr(f, 'eval_full'):
            D[k], U[k] = f.eval_full(Pts)
        else:
            D[k] = f(Pts)
    ven = smin(D['lv'], D['rv'], 0.3)
    ven = smin(ven, D['rvot'], 0.45)
    atr = smin(D['ra'], D['la'], 0.35)
    atr = smin(atr, D['ra_aur'], 0.3)
    atr = smin(atr, D['la_aur'], 0.28)
    body = smin(ven, atr, 0.3)
    body = smin(body, D['aorta'], ramp_k(U['aorta'], 0.35, 0.08))
    body = smin(body, D['pt'], ramp_k(U['pt'], 0.4, 0.3))
    body = smin(body, D['svc'], ramp_k(1 - U['svc'], 0.45, 0.3) * (U['svc'] >= 0))   # u runs from the top down
    body = smin(body, D['ivc'], 0.4)
    for k in ('rspv', 'ripv', 'lspv', 'lipv'):
        body = smin(body, D[k], ramp_k(1 - U[k], 0.3, 0.35) * (U[k] >= 0))
    arteries = smin(D['aorta'], D['bct'], ramp_k(U['bct'], 0.25, 0.2))
    arteries = smin(arteries, D['lcca'], ramp_k(U['lcca'], 0.2, 0.2))
    arteries = smin(arteries, D['lsa'], ramp_k(U['lsa'], 0.22, 0.2))
    pa = smin(D['pt'], D['lpa'], 0.3)
    pa = smin(pa, D['rpa'], 0.3)
    solid = np.minimum(body, arteries)
    solid = np.minimum(solid, pa)
    solid = smin(solid, pa, ramp_k(U['pt'], 0.3, 0.4))
    # cavities
    C = {}
    for k, f in list(L.items()) + [('o_' + k, f) for k, f in O.items()]:
        C[k] = f(Pts)
    # cavities stop at their neighbours' outer surfaces. The septa come out of this: the
    # right-side chambers end where the left-side walls begin, so each septum is as thick as
    # the left wall it borrows, and nothing ever opens into the aortic root by accident.
    for k, others in EXCLUDE.items():
        for o in others:
            C[k] = np.maximum(C[k], -D[o])
    # valve openings never break through the outside wall where the grooves pinch in
    for k in ('o_mv', 'o_tv', 'o_av'):
        C[k] = np.maximum(C[k], solid + 0.25)
    # cavities that must stay apart keep at least a wall's width between them
    for a, b, wall in KEEP_APART:
        C[a] = np.maximum(C[a], wall - C[b])
    cav = np.min(np.stack(list(C.values())), axis=0)
    final = smax(solid, -cav, 0.06)
    return final, D, C, U


def grid():
    lo, hi = BOX
    xs = np.arange(lo[0], hi[0] + H, H)
    ys = np.arange(lo[1], hi[1] + H, H)
    zs = np.arange(lo[2], hi[2] + H, H)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    return np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1), (len(xs), len(ys), len(zs))


def main():
    t0 = time.time()
    P, L, O = anatomy.build()
    Pts, shape = grid()
    print('grid', shape, len(Pts), 'points')
    final, _, _, _ = fields(Pts, P, L, O)
    vol = final.reshape(shape).astype(np.float32)
    print('field %.1fs' % (time.time() - t0))
    verts, faces, _, _ = marching_cubes(vol, 0.0, spacing=(H, H, H))
    verts += BOX[0]
    mesh = trimesh.Trimesh(verts, faces[:, ::-1], process=True)
    parts = mesh.split(only_watertight=False)
    parts = [m for m in parts if len(m.faces) > 2000]
    mesh = trimesh.util.concatenate(parts)
    print('mc', len(mesh.faces), 'faces, %.1fs' % (time.time() - t0))
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=12)
    target = 60000 if DRAFT else 150000
    red = max(0.0, 1 - target / len(mesh.faces))
    vs, fs = fast_simplification.simplify(mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32), target_reduction=red, agg=6)
    mesh = trimesh.Trimesh(vs, fs, process=True)
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=4)
    print('decimated', len(mesh.faces), 'faces, %.1fs' % (time.time() - t0))
    os.makedirs(OUT, exist_ok=True)
    np.savez_compressed(os.path.join(OUT, 'body_raw.npz'), v=mesh.vertices.astype(np.float32), f=mesh.faces.astype(np.int32))
    print('done %.1fs' % (time.time() - t0))


if __name__ == '__main__':
    main()
