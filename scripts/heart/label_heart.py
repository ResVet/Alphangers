"""Gives every vertex of the sculpted body a part id, so each region can be picked in the viewer.

Outside surfaces take the nearest outer shape. Inside surfaces take the cavity they face,
and the walls shared between chambers become the septa.

  python3 scripts/heart/label_heart.py   (reads out/body_raw.npz, writes out/body_labeled.npz)
"""
import os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anatomy
from build_heart import fields
from parts import PART_INDEX, color_of

OUT = os.path.join(HERE, 'out')

AORTA_ARCH = (0.33, 0.62)   # arc parameter where the arch starts and ends (BCT origin to isthmus)
OUTER = ['lv', 'rv', 'rvot', 'ra', 'la', 'ra_aur', 'la_aur', 'aorta', 'bct', 'lcca', 'lsa', 'pt',
         'lpa', 'rpa', 'svc', 'ivc', 'rspv', 'ripv', 'lspv', 'lipv']


def aorta_part(u):
    return np.where(u < AORTA_ARCH[0], 'aorta_asc', np.where(u < AORTA_ARCH[1], 'aorta_arch', 'aorta_desc'))


def label(V):
    P, L, O = anatomy.build()
    final, D, C, U = fields(V, P, L, O)
    solid = np.min(np.stack([D[k] for k in OUTER]), 0)
    names = list(C.keys())
    cav = np.stack([C[k] for k in names])
    inner = -cav.min(0) > solid                 # the cavity is what made this surface
    out_names = np.array(OUTER)
    lab = out_names[np.argmin(np.stack([D[k] for k in OUTER]), 0)].astype(object)
    cav_names = np.array(names)[np.argmin(cav, 0)].astype(object)
    lab[inner] = cav_names[inner]

    # valve connectors belong to whichever chamber is closer
    pairs = {'o_mv': ('la', 'lv'), 'o_tv': ('ra', 'rv'), 'o_av': ('lv', 'aorta')}
    for k, (a, b) in pairs.items():
        m = lab == k
        lab[m] = np.where(C[a][m] < C[b][m], a, b)

    # aorta: outside by the outer tube's arc parameter, inside likewise
    m = lab == 'aorta'
    lab[m] = aorta_part(U['aorta'][m])

    # septa: the right-side cavity walls that are really the left chamber's outer surface
    Pp, Lp, Op = P, L, O
    rv_raw = Lp['rv'](V)
    ra_raw = Lp['ra'](V)
    m = inner & (lab == 'rv') & (-D['lv'] > rv_raw - 0.02)
    lab[m] = 'ivs'
    m = inner & (lab == 'lv') & (D['rv'] < 0.0)
    lab[m] = 'ivs'
    m = inner & (lab == 'ra') & (-D['la'] > ra_raw - 0.02)
    ias_ra = m.copy()
    lab[m] = 'ias'
    m = inner & (lab == 'la') & (D['ra'] < 0.0)
    lab[m] = 'ias'

    # fossa ovalis: the thin oval on the right-atrial face of the septum, low and towards the IVC
    if ias_ra.any():
        pts = V[ias_ra]
        ivc_mouth = anatomy.build()[0]['ivc'].C[0]
        c0 = pts.mean(0)
        target = c0 + 0.45 * (ivc_mouth - c0)
        centre = pts[np.argmin(np.linalg.norm(pts - target, axis=1))]
        m = ias_ra & (np.linalg.norm(V - centre, axis=1) < 0.85)
        lab[m] = 'fossa'

    # apex: the outside tip of the left ventricle
    ext_lv = (~inner) & (lab == 'lv')
    proj = V @ anatomy.LV_AXIS
    tip = V[ext_lv][np.argmax(proj[ext_lv])]
    m = (~inner) & np.isin(lab, ['lv', 'rv']) & (np.linalg.norm(V - tip, axis=1) < 1.35)
    lab[m] = 'apex'
    return lab, inner


def main():
    d = np.load(os.path.join(OUT, 'body_raw.npz'))
    V, F = d['v'].astype(np.float64), d['f']
    lab, inner = label(V)
    vid = np.array([PART_INDEX[str(k)] for k in lab], np.int16)
    # one part per face (majority of its corners), then split shared corners
    fl = vid[F]
    face_part = np.where(fl[:, 1] == fl[:, 2], fl[:, 1], fl[:, 0])
    nv, nf = [], []
    key = {}
    for fi in range(len(F)):
        p = face_part[fi]
        tri = []
        for vi in F[fi]:
            k = (vi, p)
            j = key.get(k)
            if j is None:
                j = len(nv)
                key[k] = j
                nv.append((vi, p))
            tri.append(j)
        nf.append(tri)
    src = np.array([a for a, _ in nv])
    part = np.array([b for _, b in nv], np.int16)
    V2 = d['v'][src]
    F2 = np.array(nf, np.int32)
    col = np.array([color_of(p) for p in part], np.uint8)
    np.savez_compressed(os.path.join(OUT, 'body_labeled.npz'), v=V2, f=F2, part=part, c=col,
                        inner=inner[src].astype(np.uint8))
    counts = {}
    for p in face_part:
        counts[p] = counts.get(p, 0) + 1
    inv = {v: k for k, v in PART_INDEX.items()}
    print('labelled', len(F2), 'faces,', len(V2), 'verts')
    print(', '.join(f'{inv[k]}:{v}' for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))


if __name__ == '__main__':
    main()
