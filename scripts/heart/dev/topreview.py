"""Turn an out/*.npz mesh into a GLB for the preview page (optional per-vertex part colours)."""
import sys, numpy as np, trimesh
src, dst = sys.argv[1], sys.argv[2]
d = np.load(src)
m = trimesh.Trimesh(d['v'], d['f'], process=False)
if 'c' in d:
    m.visual.vertex_colors = d['c']
m.export(dst)
print('wrote', dst, len(m.faces), 'faces')
