// Photo uploads from the live editor, prepared in the browser before anything leaves the device:
//
//  - the original is kept for the zoom view, with its metadata removed byte for byte (camera
//    serial, GPS position, editing history) and the pixels untouched. A phone photo that relies
//    on an EXIF rotation tag is the one exception: it is re-encoded upright at high quality,
//    because dropping the tag would show it sideways.
//  - smaller copies at 640, 1280 and 2048 px wide, for srcset;
//  - a 24 px blurred preview and the dominant colour, stored inline in the content document.
//
// Files go to /api/media (netlify/functions/media-upload.mjs) with the admin's ID token.

const WIDTHS = [640, 1280, 2048];
const MAX_UPLOAD = 5_600_000;
const FULL_MAX_SIDE = 6000;

// ---------- metadata, removed without touching the image data

function jpegOrientation(b) {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (m === 0xda) break;
    if (m === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10, le = b[t] === 0x49;
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const u32 = (o) => (le ? (b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16)) + b[t + o + 3] * 2 ** 24 : b[t + o] * 2 ** 24 + ((b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3]));
      const ifd = u32(4), n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (u16(e) === 0x0112) return u16(e + 8);
      }
    }
    i += 2 + len;
  }
  return 1;
}

function stripJpeg(b) {
  const out = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    if (b[i + 1] === 0xff) { i++; continue; } // fill byte before a marker
    const m = b[i + 1];
    if (m === 0xda) break; // image data follows; copy the rest as is
    const len = (b[i + 2] << 8) | b[i + 3];
    // keep JFIF (APP0), the colour profile (APP2) and Adobe colour info (APP14); drop EXIF/XMP,
    // IPTC, comments and every other application segment
    const keep = !((m >= 0xe1 && m <= 0xef && m !== 0xe2 && m !== 0xee) || m === 0xfe);
    if (keep) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  out.push(b.subarray(i));
  return concat(out);
}

function stripPng(b) {
  const out = [b.subarray(0, 8)];
  const drop = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const end = i + 12 + len;
    if (!drop.has(type)) out.push(b.subarray(i, end));
    i = end;
  }
  return concat(out);
}

function stripWebp(b) {
  const parts = [];
  let i = 12, flagsAt = -1;
  while (i + 8 <= b.length) {
    const type = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    const end = i + 8 + len + (len & 1);
    if (type !== 'EXIF' && type !== 'XMP ') {
      if (type === 'VP8X') flagsAt = parts.reduce((s, p) => s + p.length, 12) + 8;
      parts.push(b.subarray(i, end));
    }
    i = end;
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(b.subarray(0, 12));
  out.set(body, 12);
  const size = out.length - 8;
  out[4] = size & 255; out[5] = (size >> 8) & 255; out[6] = (size >> 16) & 255; out[7] = (size >> 24) & 255;
  if (flagsAt >= 0) out[flagsAt] &= ~(0x08 | 0x04); // no EXIF, no XMP
  return out;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function kindOf(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'webp';
  if (String.fromCharCode(...b.subarray(4, 8)) === 'ftyp') return 'avif';
  return null;
}

export const _test = { stripJpeg, stripPng, stripWebp, jpegOrientation, kindOf };

// ---------- resizing

let webpOk = null;
function canWebp() {
  if (webpOk === null) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    webpOk = c.toDataURL('image/webp').startsWith('data:image/webp');
  }
  return webpOk;
}

function canvasOf(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function encode(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, quality));
}

// Halves in steps until close to the target, so a 6000 px photo shrinks without shimmer.
function resized(bitmap, w) {
  let src = bitmap, sw = bitmap.width, sh = bitmap.height;
  while (sw / 2 >= w * 1.5) {
    const c = canvasOf(Math.round(sw / 2), Math.round(sh / 2));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    src = c; sw = c.width; sh = c.height;
  }
  const h = Math.round((bitmap.height * w) / bitmap.width);
  const c = canvasOf(w, h);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return c;
}

async function blobToDataUrl(blob) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsDataURL(blob);
  });
}

/**
 * Turns a picked file into the files to upload and the photo record.
 * Resolves { files: [{ label, blob }], meta: { w, h, lq, bg } }.
 */
export async function prepare(file) {
  if (file.size > 60_000_000) throw new Error('Foto lebih dari 60 MB. Kecilkan dulu.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = kindOf(bytes);
  if (!kind) throw new Error('Cuma JPG, PNG, WebP atau AVIF. Foto HEIC dari iPhone: ubah ke JPG dulu (Pengaturan > Kamera > Format > Paling Kompatibel).');
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Foto ini tidak bisa dibaca browser. Coba simpan ulang sebagai JPG.');
  }
  const W = bitmap.width, H = bitmap.height;
  const type = canWebp() ? 'image/webp' : 'image/jpeg';
  const files = [];

  // the original for zooming
  const rotated = kind === 'jpg' && jpegOrientation(bytes) !== 1;
  let full = null;
  if (!rotated && Math.max(W, H) <= FULL_MAX_SIDE) {
    const clean = kind === 'jpg' ? stripJpeg(bytes) : kind === 'png' ? stripPng(bytes) : kind === 'webp' ? stripWebp(bytes) : bytes;
    if (clean.length <= MAX_UPLOAD) full = new Blob([clean], { type: file.type || 'application/octet-stream' });
  }
  if (!full) {
    // re-encoded upright (or smaller, for a huge file), at a quality the eye cannot tell apart
    const side = Math.min(4096, Math.max(W, H));
    const c = resized(bitmap, Math.round((W * side) / Math.max(W, H)));
    for (const q of [0.94, 0.9, 0.85, 0.78]) {
      full = await encode(c, kind === 'png' ? 'image/png' : type, q);
      if (full.size <= MAX_UPLOAD) break;
    }
  }
  files.push({ label: 'full', blob: full });

  // copies for srcset
  for (const w of WIDTHS) {
    if (w >= W) continue;
    files.push({ label: String(w), w, blob: await encode(resized(bitmap, w), type, 0.86) });
  }
  if (W <= WIDTHS[WIDTHS.length - 1]) {
    // the original is not wider than the biggest copy: it is the biggest copy
    files.push({ label: String(W), w: W, same: true });
  }

  // preview and colour
  const tiny = resized(bitmap, 24);
  const lq = await blobToDataUrl(await encode(tiny, type, 0.5));
  const one = canvasOf(1, 1);
  const g1 = one.getContext('2d');
  g1.drawImage(tiny, 0, 0, 1, 1);
  const [r, g, b] = g1.getImageData(0, 0, 1, 1).data;
  const bg = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  bitmap.close?.();
  return { files, meta: { w: W, h: H, lq: lq.length < 4000 ? lq : '', bg } };
}

async function uploadOne(blob, label, token) {
  const res = await fetch('/api/media?w=' + encodeURIComponent(label), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
    credentials: 'omit',
  });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(body?.error || 'Unggah gagal (' + res.status + ').');
  return body.url;
}

/**
 * Prepares and uploads one file. onStep(text) reports progress. Resolves a photo record that
 * passes validate()'s photo rules.
 */
export async function uploadPhoto(file, { token, onStep = () => {}, alt = '' }) {
  onStep('Menyiapkan foto');
  const { files, meta } = await prepare(file);
  const t = typeof token === 'function' ? await token() : token;
  let done = 0;
  const total = files.filter((f) => !f.same).length;
  onStep('Mengunggah 0/' + total);
  const urls = {};
  const queue = files.filter((f) => !f.same);
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      urls[f.label] = await uploadOne(f.blob, f.label, t);
      onStep('Mengunggah ' + ++done + '/' + total);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const set = files.filter((f) => f.w).map((f) => [f.same ? urls.full : urls[f.label], f.w]).sort((a, b) => a[1] - b[1]);
  const record = { src: set[set.length - 1][0], w: meta.w, h: meta.h, alt, cap: '', set, full: urls.full };
  if (meta.lq) record.lq = meta.lq;
  record.bg = meta.bg;
  return record;
}

/** Lets the person pick image files. Resolves an array (possibly empty). */
export function pickFiles({ multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/avif';
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...(input.files || [])]), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}
