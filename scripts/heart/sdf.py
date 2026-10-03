"""Small signed-distance toolkit used to sculpt the heart. Units are centimetres.

Frame: +x is the patient's left, +y is up (superior), +z is front (anterior).
"""
import numpy as np
from scipy.spatial import cKDTree


def v(*a):
    return np.array(a, dtype=np.float64)


def unit(a):
    a = np.asarray(a, dtype=np.float64)
    return a / np.linalg.norm(a)


def frame(x_axis, hint):
    """Orthonormal rows (x, y, z) with x along x_axis and y as close to hint as possible."""
    x = unit(x_axis)
    h = np.asarray(hint, dtype=np.float64)
    y = unit(h - x * np.dot(h, x))
    z = np.cross(x, y)
    return np.stack([x, y, z])


def smin(a, b, k):
    """Polynomial smooth minimum (blend radius k)."""
    if np.isscalar(k) and k <= 0:
        return np.minimum(a, b)
    k = np.maximum(k, 1e-6)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


class Ellipsoid:
    """Ellipsoid with an optional taper: the cross-section shrinks towards the +x end (the apex)."""

    def __init__(self, c, axes, r, taper=0.0, bulge=0.0):
        self.c = np.asarray(c, float)
        self.R = np.asarray(axes, float)      # rows: local x, y, z in world space
        self.r = np.asarray(r, float)
        self.taper = taper
        self.bulge = bulge

    def local(self, P):
        return (P - self.c) @ self.R.T

    def __call__(self, P):
        q = self.local(P)
        if self.taper or self.bulge:
            t = np.clip(q[:, 0] / self.r[0], -1.0, 1.0)
            s = 1.0 - self.taper * np.maximum(t, 0.0) ** 1.5 + self.bulge * (1 - t * t)
            q = q.copy()
            q[:, 1] /= s
            q[:, 2] /= s
        k0 = np.linalg.norm(q / self.r, axis=1)
        k1 = np.linalg.norm(q / (self.r * self.r), axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-6)

    def shrink(self, d, shift=None):
        c = self.c if shift is None else self.c + np.asarray(shift, float)
        r = np.maximum(self.r - np.asarray(d, float), 0.05)
        return Ellipsoid(c, self.R, r, self.taper, self.bulge)


def catmull(points, step=0.03):
    """Centripetal Catmull-Rom through the points, resampled at roughly `step` spacing.

    Returns the samples, their arc-length parameter (0..1) and the parameter of
    each control point, so per-point values can be interpolated along the curve.
    """
    P = np.asarray(points, float)
    if len(P) == 2:
        n = max(2, int(np.linalg.norm(P[1] - P[0]) / step) + 1)
        t = np.linspace(0, 1, n)[:, None]
        u = np.linspace(0, 1, n)
        return P[0] * (1 - t) + P[1] * t, u, np.array([0.0, 1.0])
    ext = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    knot_idx = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        def tj(ti, a, b):
            return ti + max(np.linalg.norm(b - a), 1e-6) ** 0.5
        t0 = 0.0; t1 = tj(t0, p0, p1); t2 = tj(t1, p1, p2); t3 = tj(t2, p2, p3)
        seg = np.linalg.norm(p2 - p1)
        n = max(2, int(seg / step))
        knot_idx.append(len(out))
        for t in np.linspace(t1, t2, n, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    knot_idx.append(len(out))
    out.append(P[-1])
    C = np.array(out)
    L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(C, axis=0), axis=1))])
    u = L / max(L[-1], 1e-9)
    return C, u, u[knot_idx]


class Tube:
    """Swept sphere along a spline with radius interpolated along its length.

    Distance is the min over densely sampled spheres, which is a close stand-in
    for the exact sweep as long as the spacing is well under the radius.
    """

    def __init__(self, points, radii, step=0.03, squash=None):
        self.C, self.u, knots = catmull(points, step)
        r = np.asarray(radii, float)
        if r.ndim == 0:
            r = np.full(2, float(r))
        # radii given per control point follow the curve; any other count is spread evenly
        at = knots if len(r) == len(knots) else np.linspace(0, 1, len(r))
        self.R = np.interp(self.u, at, r)
        self.tree = cKDTree(self.C)
        pad = self.R.max() + 0.6
        self.lo = self.C.min(0) - pad
        self.hi = self.C.max(0) + pad
        self.points = np.asarray(points, float)
        self.radii = r

    def eval(self, P, k=8, far=1e3):
        """Returns (distance, arc parameter of the nearest sample)."""
        d = np.full(len(P), far)
        u = np.zeros(len(P))
        m = np.all((P > self.lo) & (P < self.hi), axis=1)
        if not m.any():
            return d, u
        Q = P[m]
        kk = min(k, len(self.C))
        dist, idx = self.tree.query(Q, k=kk)
        if kk == 1:
            dist = dist[:, None]; idx = idx[:, None]
        val = dist - self.R[idx]
        j = np.argmin(val, axis=1)
        d[m] = val[np.arange(len(Q)), j]
        u[m] = self.u[idx[np.arange(len(Q)), j]]
        # points outside the bbox are far; give them a conservative distance so blends stay smooth
        return d, u

    def __call__(self, P):
        d, _ = self.eval(P)
        out = d >= 1e3 - 1
        if out.any():
            # outside the padded box: distance to the box is a safe lower bound and costs nothing
            Q = P[out]
            g = np.maximum(np.maximum(self.lo - Q, Q - self.hi), 0.0)
            d[out] = np.linalg.norm(g, axis=1) + 0.6
        return d

    def eval_full(self, P):
        """(distance, arc parameter) with the box fallback applied."""
        d, u = self.eval(P)
        out = d >= 1e3 - 1
        if out.any():
            Q = P[out]
            g = np.maximum(np.maximum(self.lo - Q, Q - self.hi), 0.0)
            d[out] = np.linalg.norm(g, axis=1) + 0.6
            u[out] = -1.0
        return d, u

    def lumen(self, wall, extend=0.0):
        pts = self.points.copy()
        if extend:
            a = pts[0] + unit(pts[0] - pts[1]) * extend
            b = pts[-1] + unit(pts[-1] - pts[-2]) * extend
            pts = np.vstack([a, pts, b])
            r = np.concatenate([[self.radii[0]], self.radii, [self.radii[-1]]])
        else:
            r = self.radii
        return Tube(pts, np.maximum(r - wall, 0.05))


class Blend:
    """Smooth union of shapes, so a chamber can be built from more than one lobe."""

    def __init__(self, k, *shapes):
        self.k = k
        self.shapes = shapes

    def __call__(self, P):
        d = self.shapes[0](P)
        for s in self.shapes[1:]:
            d = smin(d, s(P), self.k)
        return d
