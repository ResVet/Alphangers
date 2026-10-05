// Photo uploads from the live editor. POST /api/media?w=<width|full> with the image bytes as the
// body and the admin's Firebase ID token as a Bearer token. Answers { url, key, bytes }.
// DELETE /api/media/<key> removes one file (the editor only does this for uploads it discarded).
import { getStore } from '@netlify/blobs';
import { requireAdmin, AuthError } from '../lib/auth.mjs';
import { KEY_RE, MAX_BYTES, STORE, sniff, contentKey, json } from '../lib/media.mjs';

// Second line of defence behind the platform rate limit below: per admin, per instance.
const recent = new Map();
function throttled(uid, max = 240, windowMs = 10 * 60000) {
  const now = Date.now();
  const list = (recent.get(uid) || []).filter((t) => now - t < windowMs);
  list.push(now);
  recent.set(uid, list);
  return list.length > max;
}

export default async (req, context) => {
  const origin = req.headers.get('origin');
  // Browsers always send Origin on POST and DELETE; anything else is not the editor.
  if (origin && origin !== new URL(req.url).origin) return json(403, { error: 'Asal permintaan tidak dikenal.' });
  let uid;
  try {
    uid = await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError && e.status === 403) return json(403, { error: 'Akun ini bukan admin.' });
    if (e instanceof AuthError && e.status === 401) return json(401, { error: 'Sesi login habis. Muat ulang halaman lalu coba lagi.' });
    console.error('admin check', e);
    return json(503, { error: 'Cek admin gagal, coba lagi sebentar.' });
  }
  if (throttled(uid)) return json(429, { error: 'Terlalu banyak unggahan. Tunggu beberapa menit.' }, { 'retry-after': '120' });
  const store = getStore({ name: STORE, consistency: 'strong' });

  if (req.method === 'DELETE') {
    const key = context.params?.key || '';
    if (!KEY_RE.test(key)) return json(400, { error: 'Kunci foto tidak valid.' });
    await store.delete(key);
    return json(200, { ok: true });
  }
  if (req.method !== 'POST') return json(405, { error: 'Metode tidak didukung.' }, { allow: 'POST, DELETE' });

  const label = new URL(req.url).searchParams.get('w') || 'full';
  if (!/^(?:[1-9]\d{1,3}|full)$/.test(label)) return json(400, { error: 'Ukuran tidak valid.' });
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return json(413, { error: 'File terlalu besar (maks 5,8 MB per file).' });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return json(400, { error: 'File kosong.' });
  if (bytes.length > MAX_BYTES) return json(413, { error: 'File terlalu besar (maks 5,8 MB per file).' });
  const ext = sniff(bytes);
  if (!ext) return json(415, { error: 'Cuma JPEG, PNG, WebP atau AVIF.' });

  const key = await contentKey(bytes, label, ext);
  // Same bytes, same key: an upload that already exists is not written twice.
  const have = await store.getMetadata(key);
  if (!have) await store.set(key, bytes, { metadata: { by: uid, at: new Date().toISOString(), bytes: bytes.length } });
  return json(200, { key, url: '/media/' + key, bytes: bytes.length });
};

export const config = {
  path: ['/api/media', '/api/media/:key'],
  method: ['POST', 'DELETE'],
  rateLimit: { windowLimit: 90, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
