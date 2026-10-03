"""Shapes of the heart, as signed-distance primitives. Units are centimetres.

Frame: +x patient's left, +y superior, +z anterior. The layout follows the
standard textbook picture: the right ventricle makes most of the front
(sternocostal) surface, the left ventricle forms the left border and the apex,
the right atrium the right border, and the left atrium most of the base.
"""
import numpy as np
from sdf import v, unit, frame, Ellipsoid, Tube, Blend

APEX = v(3.7, -4.5, 2.3)
LV_BASE = v(0.5, 0.9, -0.9)
LV_AXIS = unit(APEX - LV_BASE)

# valve centres and their flow directions (used for openings, valve meshes and flow paths)
VALVES = {
    'mv': dict(c=v(0.55, 0.55, -1.15), n=unit(v(0.35, -0.75, 0.55))),   # left atrium -> left ventricle
    'av': dict(c=v(-0.35, 1.05, 0.15), n=unit(v(-0.3, 0.95, 0.3))),    # left ventricle -> ascending aorta
    'tv': dict(c=v(-1.95, -0.35, 1.0), n=unit(v(0.55, -0.45, 0.7))),    # right atrium -> right ventricle
    'pv': dict(c=v(0.95, 2.5, 2.45), n=unit(v(0.3, 0.9, -0.45))),       # right ventricle -> pulmonary trunk
}


def build():
    P = {}   # outer shapes by part id
    L = {}   # cavities / lumens by part id

    # ---- ventricles
    lv_c = LV_BASE + LV_AXIS * 3.15
    lv_R = frame(LV_AXIS, v(-0.6, 0.0, 0.8))
    P['lv'] = Ellipsoid(lv_c, lv_R, v(3.75, 2.75, 2.85), taper=0.68, bulge=0.04)
    L['lv'] = Ellipsoid(lv_c - LV_AXIS * 0.25, lv_R, v(3.15, 1.75, 1.85), taper=0.6, bulge=0.04)

    rv_axis = unit(v(3.2, -3.6, 1.4))
    rv_c = v(-0.15, -1.3, 1.85)
    rv_R = frame(rv_axis, v(-0.55, 0.15, 0.85))      # local y points away from the LV (front/right)
    P['rv'] = Ellipsoid(rv_c, rv_R, v(3.3, 1.9, 3.15), taper=0.55)
    L['rv'] = Ellipsoid(rv_c + rv_R[1] * 0.1, rv_R, v(2.9, 1.5, 2.75), taper=0.6)

    # right ventricular outflow (infundibulum) climbing to the pulmonary valve
    P['rvot'] = Tube([v(-0.6, 0.0, 2.6), v(0.2, 1.25, 2.75), VALVES['pv']['c']], [1.45, 1.3, 1.2])
    L['rvot'] = Tube([v(-0.7, -0.4, 2.45), v(0.2, 1.25, 2.75), VALVES['pv']['c'] + VALVES['pv']['n'] * 0.2], [1.1, 1.0, 0.95])

    # ---- atria
    ra_c = v(-2.75, 0.5, -0.05)
    # the smooth-walled back part (sinus venarum) reaches over to the left atrium; its inner
    # face against the left atrium becomes the interatrial septum
    sv_c = v(-1.85, 0.55, -1.05)
    P['ra'] = Blend(0.6, Ellipsoid(ra_c, np.eye(3), v(1.95, 2.25, 1.95)), Ellipsoid(sv_c, np.eye(3), v(1.45, 1.75, 1.25)))
    L['ra'] = Blend(0.5, Ellipsoid(ra_c, np.eye(3), v(1.68, 1.98, 1.68)), Ellipsoid(sv_c, np.eye(3), v(1.18, 1.48, 0.98)))
    P['ra_aur'] = Tube([v(-2.75, 1.7, 1.45), v(-2.15, 2.3, 2.5), v(-1.35, 2.45, 3.05)], [1.0, 0.72, 0.36])
    L['ra_aur'] = Tube([v(-2.85, 1.5, 1.2), v(-2.15, 2.3, 2.5), v(-1.45, 2.42, 2.95)], [0.75, 0.48, 0.18])

    la_c = v(0.05, 1.5, -2.5)
    la_R = frame(v(1, 0, 0.1), v(0, 1, 0))
    P['la'] = Ellipsoid(la_c, la_R, v(2.55, 1.7, 1.5))
    L['la'] = Ellipsoid(la_c, la_R, v(2.28, 1.43, 1.23))
    P['la_aur'] = Tube([v(1.9, 2.05, -1.35), v(2.65, 2.35, -0.1), v(2.55, 2.7, 1.0)], [0.82, 0.62, 0.36])
    L['la_aur'] = Tube([v(1.7, 2.0, -1.6), v(2.62, 2.35, -0.1), v(2.5, 2.65, 0.85)], [0.6, 0.42, 0.18])

    # ---- great vessels
    av = VALVES['av']['c']
    aorta_pts = [av, v(-0.85, 2.6, 0.75), v(-1.1, 4.3, 0.85), v(-0.85, 6.0, 0.4), v(0.0, 7.1, -0.55),
                 v(1.15, 7.3, -1.75), v(2.15, 6.6, -3.0), v(2.6, 5.0, -4.1), v(2.8, 2.5, -5.0),
                 v(2.75, 0.6, -5.2)]
    aorta_r = [1.2, 1.38, 1.3, 1.25, 1.17, 1.12, 1.05, 1.0, 0.98, 0.96]
    P['aorta'] = Tube(aorta_pts, aorta_r)
    L['aorta'] = P['aorta'].lumen(0.17, extend=0.3)
    P['bct'] = Tube([v(-0.35, 7.45, -0.05), v(-0.8, 8.6, 0.1), v(-1.25, 9.45, 0.25)], [0.72, 0.64, 0.6])
    L['bct'] = P['bct'].lumen(0.12, extend=0.3)
    P['lcca'] = Tube([v(0.55, 7.85, -0.9), v(0.7, 8.9, -0.87), v(0.8, 9.6, -0.8)], [0.47, 0.44, 0.42])
    L['lcca'] = P['lcca'].lumen(0.1, extend=0.3)
    P['lsa'] = Tube([v(1.45, 7.65, -1.85), v(1.85, 8.7, -1.95), v(2.3, 9.45, -1.95)], [0.52, 0.5, 0.48])
    L['lsa'] = P['lsa'].lumen(0.1, extend=0.3)

    pv = VALVES['pv']['c']
    P['pt'] = Tube([pv, v(1.45, 3.75, 1.45), v(1.45, 4.85, 0.25)], [1.18, 1.16, 1.12])
    L['pt'] = Tube([pv - VALVES['pv']['n'] * 0.15, v(1.45, 3.75, 1.45), v(1.45, 4.85, 0.25)], [1.02, 1.0, 0.96])
    P['lpa'] = Tube([v(1.45, 4.85, 0.25), v(2.7, 5.2, -0.7), v(4.0, 5.1, -1.3)], [0.98, 0.93, 0.9])
    L['lpa'] = P['lpa'].lumen(0.12, extend=0.3)
    P['rpa'] = Tube([v(1.45, 4.85, 0.25), v(0.0, 5.0, -1.45), v(-2.2, 4.95, -2.35), v(-4.0, 4.85, -2.5)], [0.98, 0.92, 0.88, 0.86])
    L['rpa'] = P['rpa'].lumen(0.12, extend=0.3)

    P['svc'] = Tube([v(-2.95, 8.7, -0.55), v(-2.95, 6.0, -0.5), v(-3.0, 2.7, -0.3)], [1.0, 1.0, 1.05])
    L['svc'] = Tube([v(-2.95, 9.0, -0.55), v(-2.95, 6.0, -0.5), v(-3.0, 2.0, -0.25)], [0.85, 0.85, 0.9])
    P['ivc'] = Tube([v(-2.85, -1.25, -0.85), v(-2.9, -2.2, -1.05), v(-2.9, -2.9, -1.15)], [1.2, 1.15, 1.15])
    L['ivc'] = Tube([v(-2.85, -0.9, -0.8), v(-2.9, -2.2, -1.05), v(-2.9, -3.2, -1.15)], [1.02, 0.98, 0.98])

    veins = {
        'rspv': [v(-4.25, 2.75, -3.15), v(-2.9, 2.35, -3.0), v(-1.55, 2.0, -2.75)],
        'ripv': [v(-4.25, 0.55, -3.45), v(-2.9, 0.75, -3.2), v(-1.55, 0.95, -2.9)],
        'lspv': [v(4.4, 2.85, -2.55), v(3.1, 2.4, -2.6), v(2.05, 2.05, -2.55)],
        'lipv': [v(4.4, 0.75, -3.0), v(3.1, 0.95, -2.95), v(2.05, 1.1, -2.75)],
    }
    for k, pts in veins.items():
        P[k] = Tube(pts, [0.62, 0.64, 0.7])
        L[k] = Tube([pts[0] + unit(pts[0] - pts[1]) * 0.3] + pts[1:] + [pts[-1] + unit(pts[-1] - pts[-2]) * 0.6], [0.5, 0.5, 0.52, 0.55])

    # connections between cavities through the valves
    O = {
        'mv': Tube([la_c + v(0.1, -0.3, 0.6), VALVES['mv']['c'], VALVES['mv']['c'] + VALVES['mv']['n'] * 1.0], [1.05, 1.2, 1.1]),
        'av': Tube([lv_c - LV_AXIS * 1.2 + v(-0.4, 0.2, 0.3), av - VALVES['av']['n'] * 0.4, av + VALVES['av']['n'] * 0.35], [0.95, 1.05, 1.1]),
        'tv': Tube([ra_c + v(0.6, -0.4, 0.5), VALVES['tv']['c'], VALVES['tv']['c'] + VALVES['tv']['n'] * 1.1], [1.15, 1.25, 1.1]),
    }
    return P, L, O


# blend tree: (part, partner, radius). Order matters only for readability.
BLENDS = {
    'ventricles': 0.55,
    'atria_to_ventricles': 0.32,
    'auricle': 0.28,
    'vessel_root': 0.35,
    'branch': 0.22,
    'vein': 0.3,
}
