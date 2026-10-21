// Sealed files for the try out. The question banks, their pictures and the class list sit in
// the repository and the build only as ciphertext; the server (netlify/functions/cbt.mjs) hands
// the key for a bank to a signed-in classmate who is allowed to take it. WebCrypto only, so the
// same code runs in the browser, in Node (build scripts, tests) and in Netlify Functions.
//
// A sealed file is [0x01][12-byte IV][AES-256-GCM ciphertext with its 16-byte tag]. The IV is an
// HMAC of the plaintext under a separate key, so sealing the same file twice gives the same bytes
// (rebuilding does not churn git) and two different files never share an IV. The additional
// data names what the file is (a bank and its version, one picture, the class list), so a file
// cannot be passed off as another one.

const VERSION = 1;
const SALT = 'alphangers/cbt';
const utf8 = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

export class SealError extends Error {
  constructor(reason) {
    super(reason === 'format' ? 'Not a sealed file.' : 'Wrong key, or the file was changed.');
    this.name = 'SealError';
    this.reason = reason;
  }
}

// One place for every label, so the build, the server and the page agree.
export const LABEL = {
  bankKey: (id, kv) => `bank/${id}/v${kv}`,
  bankIv: (id, kv) => `bank-iv/${id}/v${kv}`,
  bankAad: (id, kv) => `bank/${id}/v${kv}`,
  imgAad: (id, kv, img) => `img/${id}/v${kv}/${img}`,
  rosterKey: 'roster/v1',
  rosterIv: 'roster-iv/v1',
  rosterAad: 'roster/v1',
};

export const BANK_ID = /^[a-z][a-z0-9]{0,11}$/;
export const IMG_ID = /^[a-z0-9]{1,16}$/;

function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const bytes = (x) => (x instanceof Uint8Array ? x : typeof x === 'string' ? utf8.encode(x) : new Uint8Array(x));

export function toB64u(b) {
  let s = '';
  for (const c of bytes(b)) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new SealError('format');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad), (c) => c.charCodeAt(0));
}

/** The master secret (CBT_SECRET): 32 random bytes as base64url. Throws on anything else. */
export function parseSecret(s) {
  const t = typeof s === 'string' ? s.trim() : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(t)) throw new SealError('format');
  return fromB64u(t);
}

/** 32 bytes for one purpose, derived from the master secret with HKDF-SHA256. */
export async function derive(master, label) {
  const base = await subtle().importKey('raw', bytes(master), 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: utf8.encode(SALT), info: utf8.encode(label) }, base, 256);
  return new Uint8Array(bits);
}

export async function seal(key, ivKey, plain, aad) {
  const data = bytes(plain);
  const ad = utf8.encode(aad);
  const hk = await subtle().importKey('raw', bytes(ivKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const iv = new Uint8Array(await subtle().sign('HMAC', hk, concat(ad, new Uint8Array([0]), data))).slice(0, 12);
  const k = await subtle().importKey('raw', bytes(key), 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: ad }, k, data));
  return concat(new Uint8Array([VERSION]), iv, ct);
}

export async function open(key, sealed, aad) {
  const s = bytes(sealed);
  if (s.length < 29 || s[0] !== VERSION) throw new SealError('format');
  let k;
  try {
    k = await subtle().importKey('raw', bytes(key), 'AES-GCM', false, ['decrypt']);
  } catch {
    throw new SealError('key');
  }
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: s.subarray(1, 13), additionalData: utf8.encode(aad) }, k, s.subarray(13)));
  } catch {
    throw new SealError('key');
  }
}

export async function openJson(key, sealed, aad) {
  return JSON.parse(new TextDecoder().decode(await open(key, sealed, aad)));
}

/** Hex of the SHA-256 of some bytes, for content-addressed file names. */
export async function hashHex(b, n = 10) {
  const h = new Uint8Array(await subtle().digest('SHA-256', bytes(b)));
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, n);
}
