// Firebase ID token check for the media functions, with no service account and no SDK.
//
// 1. The token's RS256 signature is checked against Google's published Firebase keys.
// 2. Its claims must name this project, be current, and come from a verified Google account
//    (the same conditions firestore.rules puts on admins).
// 3. Admin status is asked from Firestore with the caller's own token: the rules let a user read
//    exactly one document in /admins, their own, so a 200 there means they are an admin.
//
// Results are cached per function instance: the keys for as long as Google says, admin
// answers for five minutes.

export const PROJECT_ID = 'alphangers-1ba79';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let keyCache = { at: 0, ttl: 0, keys: new Map() };
const adminCache = new Map();

function b64urlBytes(s) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad), (c) => c.charCodeAt(0));
}

function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
}

async function signingKeys(force = false) {
  if (!force && keyCache.keys.size && Date.now() - keyCache.at < keyCache.ttl) return keyCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('jwks ' + res.status);
  const body = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
  const keys = new Map();
  for (const jwk of body.keys || []) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue;
    keys.set(jwk.kid, await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  keyCache = { at: Date.now(), ttl: Math.min(maxAge, 6 * 3600) * 1000, keys };
  return keys;
}

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Returns the token's claims, or throws AuthError(401). */
export async function verifyIdToken(token, { now = Date.now() / 1000, projectId = PROJECT_ID } = {}) {
  if (typeof token !== 'string' || token.length > 4096) throw new AuthError(401, 'no token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError(401, 'malformed token');
  let header, claims;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    throw new AuthError(401, 'malformed token');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AuthError(401, 'bad algorithm');
  let key = (await signingKeys()).get(header.kid);
  // Google rotates keys; an unknown kid is worth one refetch.
  if (!key) key = (await signingKeys(true)).get(header.kid);
  if (!key) throw new AuthError(401, 'unknown key');
  const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), signed);
  if (!ok) throw new AuthError(401, 'bad signature');
  const skew = 300;
  if (claims.aud !== projectId) throw new AuthError(401, 'wrong project');
  if (claims.iss !== 'https://securetoken.google.com/' + projectId) throw new AuthError(401, 'wrong issuer');
  if (typeof claims.exp !== 'number' || claims.exp < now) throw new AuthError(401, 'expired');
  if (typeof claims.iat !== 'number' || claims.iat > now + skew) throw new AuthError(401, 'issued in the future');
  if (typeof claims.auth_time !== 'number' || claims.auth_time > now + skew) throw new AuthError(401, 'bad auth time');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw new AuthError(401, 'no subject');
  if (claims.email_verified !== true || claims.firebase?.sign_in_provider !== 'google.com') throw new AuthError(403, 'not a verified Google account');
  return claims;
}

/** True when /admins/{uid} exists, asked with the caller's own token. */
export async function isAdmin(token, uid, { projectId = PROJECT_ID } = {}) {
  const hit = adminCache.get(uid);
  if (hit && hit.until > Date.now()) return hit.admin;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/admins/${encodeURIComponent(uid)}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  let admin;
  if (res.ok) admin = true;
  else if (res.status === 404 || res.status === 403) admin = false;
  else throw new AuthError(503, 'admin check failed: ' + res.status);
  adminCache.set(uid, { admin, until: Date.now() + (admin ? 5 : 1) * 60000 });
  return admin;
}

/** The caller's uid when the request carries an admin's token; throws AuthError otherwise. */
export async function requireAdmin(req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.get('authorization') || '');
  if (!m) throw new AuthError(401, 'sign in first');
  const claims = await verifyIdToken(m[1]);
  if (!(await isAdmin(m[1], claims.sub))) throw new AuthError(403, 'not an admin');
  return claims.sub;
}
