// Serves uploaded photos at /media/<key>. Keys are content hashes, so every answer is cached for a
// year at the CDN and in the browser; the function only runs on a cache miss.
import { getStore } from '@netlify/blobs';
import { KEY_RE, TYPES, STORE } from '../lib/media.mjs';

const SAFE = {
  'x-content-type-options': 'nosniff',
  // a photo opened on its own can never run anything or be framed elsewhere
  'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  'cross-origin-resource-policy': 'same-site',
};

export default async (req, context) => {
  const key = context.params?.key || '';
  if (!KEY_RE.test(key)) return new Response('Not found', { status: 404, headers: { ...SAFE, 'cache-control': 'public, max-age=300' } });
  const etag = '"' + key + '"';
  const forever = { 'cache-control': 'public, max-age=31536000, immutable', 'netlify-cdn-cache-control': 'public, max-age=31536000, immutable', etag };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ...SAFE, ...forever } });
  const store = getStore({ name: STORE, consistency: 'strong' });
  const data = await store.get(key, { type: 'arrayBuffer' });
  if (!data) return new Response('Not found', { status: 404, headers: { ...SAFE, 'cache-control': 'public, max-age=60' } });
  const ext = key.slice(key.lastIndexOf('.') + 1);
  return new Response(data, {
    status: 200,
    headers: { ...SAFE, ...forever, 'content-type': TYPES[ext], 'content-length': String(data.byteLength), 'content-disposition': 'inline' },
  });
};

export const config = {
  path: '/media/:key',
  // files that ship with the site under /media (the Polyester clip and its sound) win over this
  preferStatic: true,
  method: ['GET', 'HEAD'],
};
