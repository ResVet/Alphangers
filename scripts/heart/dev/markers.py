"""Body plus coloured marker spheres, for checking where computed points land.
  python3 dev/markers.py out.glb points.npy [points2.npy ...]"""
import sys, os, colorsys
import numpy as np, trimesh
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
d = np.load(os.path.join(os.path.dirname(__file__), '..', 'out', 'body_labeled.npz'))
body = trimesh.Trimesh(d['v'], d['f'], process=False)
body.visual.vertex_colors = np.tile([200, 190, 185, 255], (len(d['v']), 1))
parts = [body]
for si, f in enumerate(sys.argv[2:]):
    P = np.load(f)
    for i, p in enumerate(P):
        s = trimesh.creation.icosphere(1, 0.09)
        s.apply_translation(p)
        h = (i / max(len(P) - 1, 1)) * 0.8
        r, g, b = colorsys.hls_to_rgb(h, 0.5, 0.9)
        s.visual.vertex_colors = np.tile([int(r * 255), int(g * 255), int(b * 255), 255], (len(s.vertices), 1))
        parts.append(s)
trimesh.util.concatenate(parts).export(sys.argv[1])
print('wrote', sys.argv[1])
