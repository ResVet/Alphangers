// Classmate-only access to the try out: GET /api/cbt/me, POST /api/cbt/claim, GET and POST
// /api/cbt/admin. What they do is in netlify/lib/cbt.mjs; this file wires in Netlify Blobs, the
// Firebase token and admin checks, the master secret and the sealed class list.
import { getStore } from '@netlify/blobs';
import { verifyIdToken, isAdmin } from '../lib/auth.mjs';
import { createCbt } from '../lib/cbt.mjs';
import { ROSTER, BANKS } from '../data/cbt.mjs';

// A store per call, like the media functions: the Blobs context belongs to the invocation.
const blobs = () => getStore({ name: 'cbt', consistency: 'strong' });
const store = {
  get: (...a) => blobs().get(...a),
  getWithMetadata: (...a) => blobs().getWithMetadata(...a),
  set: (...a) => blobs().set(...a),
  setJSON: (...a) => blobs().setJSON(...a),
  delete: (...a) => blobs().delete(...a),
};

let handle;

export default async (req) => {
  // Made on the first request, so the environment is read inside the function, and kept for the
  // life of the instance along with its rate limits and the secret once found.
  handle ||= createCbt({
    store,
    verify: (token) => verifyIdToken(token),
    isAdmin: (token, uid) => isAdmin(token, uid),
    env: { CBT_SECRET: globalThis.Netlify?.env?.get('CBT_SECRET') ?? process.env.CBT_SECRET },
    roster: ROSTER,
    banks: BANKS,
  });
  return handle(req);
};

export const config = {
  path: ['/api/cbt/me', '/api/cbt/claim', '/api/cbt/admin'],
  method: ['GET', 'POST'],
  // The whole class can come from one campus NAT address: 121 students opening the try out in
  // the same minute before an exam, each with a /me and a claim or two. 300 a minute per address
  // leaves room for that; the per-account limits inside the function bound any one person.
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
