"""Writes the finished heart as one glTF binary plus the metadata the viewer needs.

  python3 scripts/heart/export_glb.py   (after build_heart, label_heart, vessels, internals)

The GLB has four meshes so the viewer can draw them with different materials:
  body        chambers, septa and great vessels
  coronary    coronary arteries and cardiac veins
  valves      valves, papillary muscles, chordae, moderator band
  conduction  SA node to Purkinje fibres

Every vertex carries three custom attributes:
  _PART  unsigned byte, the part index from parts.py, plus 128 when the vertex is on an
         inside (endocardial) surface
  _T     unsigned short, activation time in ms for the depolarisation wave (65535 = none)
  _AO    unsigned byte, normalised ambient occlusion baked from the body and coronary
         surfaces (255 = fully open), so grooves and the spaces between vessels read as
         depth instead of flat colour

pack.mjs then quantises and meshopt-compresses it into public/models/heart.glb.
"""
import os, sys, json, struct
import numpy as np
import trimesh
from scipy.spatial import cKDTree
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from parts import PARTS, PART_INDEX

OUT = os.path.join(HERE, 'out')
VALVES = {PART_INDEX[k] for k in ('tv', 'pv', 'mv', 'av', 'chordae', 'pap_lv', 'pap_rv', 'modband')}
CONDUCTION = {PART_INDEX[k] for k in ('san', 'internodal', 'avn', 'his', 'lbb', 'rbb', 'purk')}
NO_TIME = 65535


def smooth_normals(V, F):
    """Vertex normals computed on the welded mesh, so split part borders do not show a seam."""
    m = trimesh.Trimesh(V, F, process=True)
    n = m.vertex_normals
    _, j = cKDTree(m.vertices).query(V)
    return n[j]


def hemisphere(n=28, seed=7):
    """Cosine-weighted unit directions around +z, fixed seed so rebuilds are identical."""
    rng = np.random.default_rng(seed)
    u, v = rng.random(n), rng.random(n)
    r, phi = np.sqrt(u), 2 * np.pi * v
    return np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1 - u)], 1)


def bake_ao(targets, occluders, voxel=0.1, reach=1.5):
    """Ambient occlusion by marching rays through a voxelised copy of the surfaces.

    targets:   list of (V, F) to bake
    occluders: list of (V, F) that cast occlusion
    Returns one array of values in [0, 1] per target, 1 = nothing nearby.
    """
    pts = []
    for V, F in occluders:
        V = np.asarray(V, np.float64)
        pts += [V, V[F].mean(1), (V[F[:, 0]] + V[F[:, 1]]) / 2, (V[F[:, 1]] + V[F[:, 2]]) / 2, (V[F[:, 2]] + V[F[:, 0]]) / 2]
    P = np.vstack(pts)
    lo = P.min(0) - reach - 0.5
    dims = np.ceil((P.max(0) + reach + 0.5 - lo) / voxel).astype(int)
    grid = np.zeros(dims, bool)
    ijk = ((P - lo) / voxel).astype(int)
    grid[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
    grid = ndimage.binary_dilation(grid)
    dirs = hemisphere()
    steps = np.arange(0.3, reach + 1e-6, voxel)
    out = []
    for V, F in targets:
        V = np.asarray(V, np.float64)
        N = smooth_normals(V, F)
        # orthonormal frame per vertex
        bad = ~np.isfinite(N).all(1) | (np.linalg.norm(N, axis=1) < 0.5)
        N[bad] = [0, 0, 1]
        a = np.where(np.abs(N[:, 0:1]) < 0.9, [[1, 0, 0]], [[0, 1, 0]])
        T = np.cross(N, a); T /= np.linalg.norm(T, axis=1, keepdims=True)
        B = np.cross(N, T)
        hit = np.zeros(len(V))
        for d in dirs:
            D = T * d[0] + B * d[1] + N * d[2]
            blocked = np.zeros(len(V), bool)
            for s in steps:
                q = V + N * 0.25 + D * s
                g = ((q - lo) / voxel).astype(int)
                g = np.clip(g, 0, dims - 1)
                blocked |= grid[g[:, 0], g[:, 1], g[:, 2]]
            hit += blocked
        ao = 1 - hit / len(dirs)
        # one pass of neighbour averaging takes the speckle out of the ray noise
        m = trimesh.Trimesh(V, F, process=False)
        nb = m.vertex_neighbors
        ao = np.array([0.5 * ao[i] + 0.5 * ao[n].mean() if len(n) else ao[i] for i, n in enumerate(nb)])
        out.append(ao)
    return out


def compact(V, F, keep_faces):
    F = F[keep_faces]
    used = np.unique(F)
    remap = np.full(len(V), -1, np.int64)
    remap[used] = np.arange(len(used))
    return used, remap[F]


def build_meshes():
    body = np.load(os.path.join(OUT, 'body_labeled.npz'))
    t_body = np.load(os.path.join(OUT, 'body_time.npy'))
    ves = np.load(os.path.join(OUT, 'vessels.npz'))
    inn = np.load(os.path.join(OUT, 'internals.npz'))

    meshes = []
    bp = body['part'].astype(np.int64) + 128 * body['inner'].astype(np.int64)
    bf = body['f']
    # marching cubes hands the faces back wound inwards; the viewer relies on the outside of the
    # wall being front facing (the cut face colour is drawn on back faces), so turn them round
    if trimesh.Trimesh(body['v'], bf, process=False).volume < 0:
        bf = bf[:, ::-1].copy()
    meshes.append(('body', body['v'], bf, bp, t_body))
    meshes.append(('coronary', ves['v'], ves['f'], ves['part'].astype(np.int64), np.full(len(ves['v']), -1.0)))

    ip = inn['part'].astype(np.int64)
    fpart = ip[inn['f'][:, 0]]
    for name, group in (('valves', VALVES), ('conduction', CONDUCTION)):
        used, F = compact(inn['v'], inn['f'], np.isin(fpart, list(group)))
        meshes.append((name, inn['v'][used], F, ip[used], inn['t'][used]))

    # the outer surfaces get baked occlusion; valves and conduction sit inside the heart and
    # would come out black, so they stay fully open
    surf = [(m[1], m[2]) for m in meshes[:2]]
    aos = bake_ao(surf, surf)
    for i, ao in enumerate(aos):
        print(f'ao {meshes[i][0]:9s} mean {ao.mean():.3f} p5 {np.percentile(ao, 5):.3f}')
    return [m + (aos[i] if i < 2 else np.ones(len(m[1])),) for i, m in enumerate(meshes)]


def write_glb(path, meshes):
    chunks, views, accessors, gmeshes, nodes = [], [], [], [], []
    offset = 0

    def push(arr, target=None):
        nonlocal offset
        data = arr.tobytes()
        pad = (-len(data)) % 4
        chunks.append(data + b'\0' * pad)
        view = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)}
        if target:
            view['target'] = target
        views.append(view)
        offset += len(data) + pad
        return len(views) - 1

    def accessor(arr, ctype, kind, target, minmax=False, normalized=False):
        acc = {'bufferView': push(arr, target), 'componentType': ctype, 'count': len(arr), 'type': kind}
        if normalized:
            acc['normalized'] = True
        if minmax:
            acc['min'] = arr.min(0).tolist()
            acc['max'] = arr.max(0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    ARRAY, ELEMENT = 34962, 34963
    for name, V, F, part, t, ao in meshes:
        V = np.asarray(V, np.float32)
        N = smooth_normals(V.astype(np.float64), F).astype(np.float32)
        T = np.where(np.asarray(t) < 0, NO_TIME, np.clip(np.round(t), 0, NO_TIME - 1)).astype(np.uint16)
        attrs = {
            'POSITION': accessor(V, 5126, 'VEC3', ARRAY, minmax=True),
            'NORMAL': accessor(N, 5126, 'VEC3', ARRAY),
            '_PART': accessor(np.asarray(part, np.uint8), 5121, 'SCALAR', ARRAY),
            '_T': accessor(T, 5123, 'SCALAR', ARRAY),
            '_AO': accessor(np.round(np.clip(ao, 0, 1) * 255).astype(np.uint8), 5121, 'SCALAR', ARRAY, normalized=True),
        }
        idx_type, idx_ct = (np.uint16, 5123) if len(V) < 65536 else (np.uint32, 5125)
        ind = accessor(np.asarray(F, idx_type).ravel(), idx_ct, 'SCALAR', ELEMENT)
        gmeshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': ind, 'mode': 4}]})
        nodes.append({'name': name, 'mesh': len(gmeshes) - 1})

    gltf = {
        'asset': {'version': '2.0', 'generator': 'alphangers heart builder', 'copyright': 'Khalid (Resvet). All rights reserved.'},
        'scene': 0,
        'scenes': [{'name': 'heart', 'nodes': list(range(len(nodes)))}],
        'nodes': nodes, 'meshes': gmeshes, 'accessors': accessors, 'bufferViews': views,
        'buffers': [{'byteLength': offset}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    binary = b''.join(chunks)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
        f.write(struct.pack('<I4s', len(binary), b'BIN\0')); f.write(binary)


def part_anchors(meshes):
    """Centre and size of every part, for flying the camera to a part picked from the list."""
    pts = {}
    for _, V, F, part, *_ in meshes:
        p = np.asarray(part) & 127
        for k in np.unique(p):
            pts.setdefault(int(k), []).append(np.asarray(V)[p == k])
    out = {}
    for k, arrs in pts.items():
        P = np.vstack(arrs)
        c = P.mean(0)
        # the mean of a curved part can sit off the part; use the nearest real point instead
        c = P[np.argmin(np.linalg.norm(P - c, axis=1))]
        r = float(np.percentile(np.linalg.norm(P - c, axis=1), 90))
        out[PARTS[k]] = {'c': np.round(c, 3).tolist(), 'r': round(max(r, 0.4), 3)}
    return out


def main():
    meshes = build_meshes()
    raw = os.path.join(OUT, 'heart_raw.glb')
    write_glb(raw, meshes)
    meta = json.load(open(os.path.join(OUT, 'meta.json')))
    # thin the flow routes; the viewer re-samples them with a spline
    for k, P in meta['flows'].items():
        P = np.asarray(P)
        keep = np.unique(np.r_[np.arange(0, len(P), 3), len(P) - 1])
        meta['flows'][k] = np.round(P[keep], 2).tolist()
    allV = np.vstack([m[1] for m in meshes])
    meta.update({
        'version': 1,
        'units': 'cm',
        'axes': {'x': 'patient left', 'y': 'superior', 'z': 'anterior'},
        'parts': PARTS,
        'anchors': part_anchors(meshes),
        'bounds': [np.round(allV.min(0), 2).tolist(), np.round(allV.max(0), 2).tolist()],
        'inner_flag': 128,
        'no_time': NO_TIME,
    })
    with open(os.path.join(OUT, 'heart-meta.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    for name, V, F, *_ in meshes:
        print(f'{name:11s} {len(V):7d} verts {len(F):7d} faces')
    print('wrote', raw, os.path.getsize(raw) // 1024, 'KB')


if __name__ == '__main__':
    main()
