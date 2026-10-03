"""Finds the grooves on the outside of the heart, where the coronary vessels run.

A groove is where two outside regions meet: the interventricular grooves between the two
ventricles, and the atrioventricular (coronary) groove between the atria and the ventricles.
Each one comes back as an ordered, smoothed polyline sitting on the surface.
"""
import numpy as np
import trimesh

import anatomy
from parts import PART_INDEX

ATRIA = {PART_INDEX[k] for k in ('ra', 'ra_aur', 'la', 'la_aur', 'svc', 'ivc', 'rspv', 'ripv', 'lspv', 'lipv')}
VENTR = {PART_INDEX[k] for k in ('rv', 'rvot', 'lv', 'apex')}
LEFT_V = {PART_INDEX['lv']}
RIGHT_V = {PART_INDEX[k] for k in ('rv', 'rvot')}


class Surface:
    """The outside of the labelled body, with helpers to project points onto it."""

    def __init__(self, d):
        inner = d['inner'].astype(bool)
        F = d['f']
        keep = ~inner[F].any(1)
        self.mesh = trimesh.Trimesh(d['v'], F[keep], process=False)
        self.part = d['part']
        self.F = F[keep]
        self.prox = trimesh.proximity.ProximityQuery(self.mesh)
        # the base of the ventricles and the long axis, for angles around the heart
        self.axis = anatomy.LV_AXIS
        self.base = np.array([-0.55, 0.85, -0.1])
        e1 = np.cross(self.axis, [0, 0, 1.0]); e1 /= np.linalg.norm(e1)
        e2 = np.cross(self.axis, e1)
        self.e1, self.e2 = e1, e2

    def angle(self, P):
        q = P - self.base
        return np.arctan2(q @ self.e2, q @ self.e1)

    def along(self, P):
        return (P - self.base) @ self.axis

    def snap(self, P, lift=0.0):
        """Closest surface points, pushed out along the surface normal by `lift`."""
        c, _, tri = self.prox.on_surface(P)
        n = self.mesh.face_normals[tri]
        return c + n * lift[:, None] if np.ndim(lift) else c + n * lift

    def boundary(self, set_a, set_b):
        """Midpoints of surface edges whose ends belong to the two sets of parts."""
        E = self.mesh.edges_unique
        pa = self.part[self.F]
        # part of each vertex as seen from the faces (vertices are split per part already,
        # so use face adjacency: two faces sharing an edge with different parts)
        fp = pa[:, 0]
        adj = self.mesh.face_adjacency
        a, b = fp[adj[:, 0]], fp[adj[:, 1]]
        m = (np.isin(a, list(set_a)) & np.isin(b, list(set_b))) | (np.isin(a, list(set_b)) & np.isin(b, list(set_a)))
        # parts are split at their borders, so faces on either side do not share an edge;
        # fall back to pairs of nearby faces across the seam
        if m.sum() < 10:
            cen = self.mesh.triangles_center
            ia = np.nonzero(np.isin(fp, list(set_a)))[0]
            ib = np.nonzero(np.isin(fp, list(set_b)))[0]
            from scipy.spatial import cKDTree
            t = cKDTree(cen[ib])
            d, j = t.query(cen[ia])
            close = d < 0.12
            return (cen[ia][close] + cen[ib][j[close]]) / 2
        return self.mesh.triangles_center[adj[m, 0]]


def ordered(points, key, bins, lo=None, hi=None, smooth=2):
    """Median point per bin of `key`, smoothed: turns a scatter along a seam into a polyline."""
    lo = key.min() if lo is None else lo
    hi = key.max() if hi is None else hi
    edges = np.linspace(lo, hi, bins + 1)
    out = []
    for i in range(bins):
        m = (key >= edges[i]) & (key < edges[i + 1])
        if m.sum() >= 3:
            out.append(np.median(points[m], axis=0))
    out = np.array(out)
    for _ in range(smooth):
        if len(out) > 2:
            out[1:-1] = 0.25 * out[:-2] + 0.5 * out[1:-1] + 0.25 * out[2:]
    return out
