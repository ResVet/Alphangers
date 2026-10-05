// Makes the packed model cheaper to draw without changing how it looks.
//   node scripts/heart/optimize.mjs [ratio]        (default 0.4, the share of triangles kept)
//
// 1. Simplifies the body and the coronary vessels with meshoptimizer. Every vertex on a border
//    between two parts is locked, so part colours, picking and the conduction wave keep their
//    exact edges; normals and ambient occlusion steer which edges collapse, so the shading holds.
//    Collapses stop at a geometric error far below a pixel at any zoom the explorer allows.
// 2. Orders every mesh's triangles for the GPU's vertex cache, so each vertex is shaded about
//    once instead of up to twice.
// Reads and writes public/models/heart.glb (EXT_meshopt_compression and quantisation are kept).
// The file is marked once simplified; a second run only reorders.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { reorder, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.env.HEART_GLB || join(here, '..', '..', 'public', 'models', 'heart.glb');
const out = process.env.HEART_OUT || file;
const KEEP = Number(process.argv[2] || 0.4);
const MAX_ERROR = 0.0008; // relative to the mesh's size: about 0.07 mm on this heart
const SIMPLIFY = new Set(['body', 'coronary']);

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(file);
// marked once simplified, so running this again (by hand, or after pack.mjs) never simplifies twice
const root = doc.getRoot();
const done = root.getExtras()?.simplified;
if (done) console.log(`already simplified (kept ${done}); only reordering`);

const toFloat = (acc) => {
  const a = acc.getArray(), n = acc.getElementSize();
  const norm = acc.getNormalized() ? (a instanceof Int16Array ? 32767 : a instanceof Int8Array ? 127 : a instanceof Uint8Array ? 255 : a instanceof Uint16Array ? 65535 : 1) : 1;
  const f = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) f[i] = Math.max(-1, a[i] / norm);
  return { f, n };
};

for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const name = mesh.getName();
    if (done || !SIMPLIFY.has(name)) continue;
    const idx = prim.getIndices().getArray();
    const pos = toFloat(prim.getAttribute('POSITION')).f;
    const nrm = toFloat(prim.getAttribute('NORMAL')).f;
    const ao = toFloat(prim.getAttribute('_AO')).f;
    const part = prim.getAttribute('_PART').getArray();
    const vc = pos.length / 3;
    // lock every vertex shared by triangles of different parts (or inner and outer surface)
    const lock = new Uint8Array(vc);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if (part[a] !== part[b] || part[b] !== part[c]) lock[a] = lock[b] = lock[c] = 1;
    }
    const attrs = new Float32Array(vc * 4);
    for (let v = 0; v < vc; v++) { attrs[v * 4] = nrm[v * 3]; attrs[v * 4 + 1] = nrm[v * 3 + 1]; attrs[v * 4 + 2] = nrm[v * 3 + 2]; attrs[v * 4 + 3] = ao[v]; }
    const target = Math.floor((idx.length * KEEP) / 3) * 3;
    const [res, err] = MeshoptSimplifier.simplifyWithAttributes(
      Uint32Array.from(idx), pos, 3, attrs, 4, [0.6, 0.6, 0.6, 0.25], lock, target, MAX_ERROR, []);
    console.log(`${name}: ${idx.length / 3} -> ${res.length / 3} triangles, error ${(err * 100).toFixed(4)}% of size, ${lock.reduce((a, b) => a + b, 0)} border vertices locked`);
    const Idx = prim.getIndices().getArray().constructor;
    prim.getIndices().setArray(new (vc > 65535 ? Uint32Array : Idx)(res));
  }
}
// drop vertices no triangle uses any more, then order for the vertex cache
await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'performance' }));
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const idx = prim.getIndices().getArray();
  const used = new Int32Array(prim.getAttribute('POSITION').getCount()).fill(-1);
  let n = 0;
  for (const v of idx) if (used[v] < 0) used[v] = n++;
  if (n === used.length) continue;
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem), a = acc.getArray(), k = acc.getElementSize();
    const b = new a.constructor(n * k);
    for (let v = 0; v < used.length; v++) if (used[v] >= 0) for (let j = 0; j < k; j++) b[used[v] * k + j] = a[v * k + j];
    acc.setArray(b);
  }
  const ni = new idx.constructor(idx.length);
  for (let i = 0; i < idx.length; i++) ni[i] = used[idx[i]];
  prim.getIndices().setArray(ni);
}
await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'performance' }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
if (!done) root.setExtras({ ...root.getExtras(), simplified: KEEP });
await io.write(out, doc);
console.log(`${out}: ${Math.round((await stat(out)).size / 1024)} KB`);
