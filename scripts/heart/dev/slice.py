"""Cross-section of the sculpted field, coloured by cavity, for checking wall thickness and septa.

  python3 dev/slice.py out.png  ox,oy,oz  ux,uy,uz  vx,vy,vz  [half_size]
"""
import sys, os
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import anatomy
from build_heart import fields
from sdf import unit

out = sys.argv[1]
o = np.array([float(x) for x in sys.argv[2].split(',')])
u = unit([float(x) for x in sys.argv[3].split(',')])
w = np.array([float(x) for x in sys.argv[4].split(',')])
w = unit(w - u * np.dot(w, u))
half = float(sys.argv[5]) if len(sys.argv) > 5 else 7.0
N = 420
s = np.linspace(-half, half, N)
A, B = np.meshgrid(s, s[::-1])
Pts = o + A.reshape(-1, 1) * u + B.reshape(-1, 1) * w
P, L, O = anatomy.build()
final, D, C, U = fields(Pts, P, L, O)
names = list(C.keys())
cav = np.stack([C[k] for k in names])
which = np.argmin(cav, 0)
inside_cav = cav.min(0) < 0
img = np.zeros((N * N, 3), np.uint8) + np.array([14, 16, 15], np.uint8)
img[final < 0] = (176, 70, 62)
rng = np.random.RandomState(3)
pal = {k: rng.randint(60, 230, 3) for k in names}
for i, k in enumerate(names):
    m = inside_cav & (which == i) & (final >= 0)
    img[m] = pal[k]
im = Image.fromarray(img.reshape(N, N, 3)).resize((N * 2, N * 2), Image.NEAREST)
dr = ImageDraw.Draw(im)
for i, k in enumerate(names):
    m = (inside_cav & (which == i) & (final >= 0)).reshape(N, N)
    if m.sum() > 40:
        yy, xx = np.nonzero(m)
        dr.text((xx.mean() * 2 - 8, yy.mean() * 2 - 5), k, fill=(255, 255, 255))
# 1 cm scale bar
px = N * 2 / (2 * half)
dr.line([(20, N * 2 - 20), (20 + px, N * 2 - 20)], fill=(255, 255, 255), width=3)
dr.text((20, N * 2 - 36), '1 cm', fill=(255, 255, 255))
im.save(out)
print('saved', out)
