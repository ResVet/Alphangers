// Prepares a photo for the site the same way the live editor does for uploads: smaller copies
// for srcset (AVIF and WebP), the untouched original for zooming, a blurred inline preview and
// the dominant colour. Prints the photo record to paste into a content file.
//
//   node scripts/media.mjs <input image> <output path without extension> [alt text]
//   node scripts/media.mjs ~/foto/bph.jpg public/img/divisi/bph-1 "Pengurus BPH di lobi FK"
import sharp from 'sharp';
import { copyFileSync, statSync } from 'node:fs';
import { extname, basename } from 'node:path';

const [input, out, alt = ''] = process.argv.slice(2);
if (!input || !out) {
  console.error('usage: node scripts/media.mjs <input> <output base> [alt]');
  process.exit(1);
}
const WIDTHS = [640, 1280, 2000];
const img = sharp(input, { failOn: 'error' }).rotate();
const meta = await img.metadata();
const W = meta.autoOrient?.width || meta.width, H = meta.autoOrient?.height || meta.height;
const pub = (p) => '/' + p.replace(/^public\//, '');

// the original, byte for byte, is what the zoom view opens
const ext = extname(input).toLowerCase().replace('.jpeg', '.jpg');
const fullPath = out + ext;
copyFileSync(input, fullPath);

const set = [], avif = [];
for (const w of WIDTHS.filter((w) => w < W).concat(W > WIDTHS[WIDTHS.length - 1] ? [] : [W])) {
  const r = sharp(input).rotate().resize({ width: w, withoutEnlargement: true });
  const webp = `${out}-${w}.webp`, av = `${out}-${w}.avif`;
  await r.clone().webp({ quality: 86, effort: 6, smartSubsample: true }).toFile(webp);
  await r.clone().avif({ quality: 64, effort: 7, chromaSubsampling: '4:4:4' }).toFile(av);
  set.push([pub(webp), w]);
  avif.push([pub(av), w]);
  console.error(w, 'webp', statSync(webp).size, 'avif', statSync(av).size);
}
const lqBuf = await sharp(input).rotate().resize({ width: 24 }).webp({ quality: 50 }).toBuffer();
const { dominant } = await sharp(input).stats();
const hex = '#' + [dominant.r, dominant.g, dominant.b].map((x) => x.toString(16).padStart(2, '0')).join('');
const record = {
  src: set[set.length - 1][0], w: W, h: H, alt, cap: '',
  set, avif, full: pub(fullPath), lq: 'data:image/webp;base64,' + lqBuf.toString('base64'), bg: hex,
};
console.error(basename(fullPath), statSync(fullPath).size, 'bytes, lq', lqBuf.length, 'bytes');
console.log(JSON.stringify(record, null, 2));
