"""Body plus extra part meshes, coloured per part, for previews.
  python3 dev/combine.py out.glb [extra.npz ...]"""
import sys, os
import numpy as np, trimesh
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from parts import color_of
OUT = os.path.join(os.path.dirname(__file__), '..', 'out')
d = np.load(os.path.join(OUT, 'body_labeled.npz'))
mute = '--mute' in sys.argv
body = trimesh.Trimesh(d['v'], d['f'], process=False)
body.visual.vertex_colors = np.tile([196, 120, 110, 255], (len(d['v']), 1)) if mute else d['c']
ms = [body]
for f in [a for a in sys.argv[2:] if a.endswith('.npz')]:
    e = np.load(f)
    m = trimesh.Trimesh(e['v'], e['f'], process=False)
    from parts import PARTS
    art = {'rca', 'lmca', 'lad', 'diag', 'lcx', 'om', 'rmarg', 'pda'}
    vein = {'gcv', 'mcv', 'scv', 'cs'}
    def col(p):
        k = PARTS[int(p)]
        if mute and k in art: return (215, 40, 50, 255)
        if mute and k in vein: return (50, 90, 215, 255)
        return color_of(int(p))
    m.visual.vertex_colors = np.array([col(p) for p in e['part']], np.uint8)
    ms.append(m)
trimesh.util.concatenate(ms).export(sys.argv[1])
print('wrote', sys.argv[1])
