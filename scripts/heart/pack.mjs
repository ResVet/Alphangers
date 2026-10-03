// Compresses out/heart_raw.glb into public/models/heart.glb and copies the metadata next to it.
//   node scripts/heart/pack.mjs
// Quantises positions and normals, reorders vertices for the GPU cache, then applies
// EXT_meshopt_compression. The custom _PART and _T attributes are integers and pass through as they are.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { reorder, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = join(here, 'out', 'heart_raw.glb');
const outDir = join(root, 'public', 'models');
const dst = join(outDir, 'heart.glb');

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(src);
await doc.transform(
  reorder({ encoder: MeshoptEncoder, target: 'size' }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, pattern: /^(POSITION|NORMAL)$/ }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
await mkdir(outDir, { recursive: true });
await io.write(dst, doc);
await copyFile(join(here, 'out', 'heart-meta.json'), join(outDir, 'heart-meta.json'));

const kb = async (p) => Math.round((await stat(p)).size / 1024);
console.log(`heart.glb ${await kb(dst)} KB (raw ${await kb(src)} KB)`);
