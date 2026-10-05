// Shared bits of the media functions: what an image key looks like and how to recognise a file.

// <24 hex of the content's SHA-256>-<width or "full">.<ext>. Content-addressed, so a key never
// changes meaning and every response can be cached forever.
export const KEY_RE = /^[a-f0-9]{24}-(?:[1-9]\d{1,3}|full)\.(?:webp|jpg|avif|png)$/;
export const TYPES = { webp: 'image/webp', jpg: 'image/jpeg', avif: 'image/avif', png: 'image/png' };
// Netlify answers synchronous functions with at most 6 MB of request body.
export const MAX_BYTES = 5_800_000;
export const STORE = 'media';

/** The real type from the first bytes, whatever the client called it. SVG and HTML never pass. */
export function sniff(b) {
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  const ascii = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  if (ascii(4, 4) === 'ftyp' && /^(avif|avis)$/.test(ascii(8, 4))) return 'avif';
  return null;
}

export async function contentKey(bytes, label, ext) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = [...hash.subarray(0, 12)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex}-${label}.${ext}`;
}

export function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
  });
}
