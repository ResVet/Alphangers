// Classmate-only access to the try out: everything /api/cbt does. netlify/functions/cbt.mjs only
// wires in the real store, token check and data; here they come in as arguments, so all of it
// runs in unit tests (tests/cbt.test.mjs).
//
// A student signs in with Google and binds the account to a NIM on the sealed class list, once:
// one NIM per account and one account per NIM, until an admin releases it. A bound account that
// is allowed gets the key of every bank. Any other gets the same neutral "closed" whatever the
// reason, and the claim screen answers alike for every NIM, so nobody can tell who is closed.
//
// State is three JSON documents in the `cbt` Blobs store. Each is written only if it is still
// the version that was read (its ETag), and read again and retried when another request wrote
// first, so two requests can never both bind one NIM or one account.
//   claims  { v, nim: { <nim>: { uid, email, gname, at } } }   both directions checked in one place
//   config  { v, blocked, accounts, add, drop, at, by }         missing: the class list's own blocks
//   log     { v, ev: [...] }                                    newest first, at most 200
// plus `secret`, the master secret when an admin installed it instead of setting CBT_SECRET.
import { LABEL, BANK_ID, derive, openJson, parseSecret, fromB64u, toB64u } from '../../src/lib/seal.js';
import { AuthError } from './auth.mjs';
import { json } from './media.mjs';

/** Seconds a device may keep the keys and open banks offline. */
export const TTL = 7 * 24 * 3600;
export const NIM_RE = /^[0-9]{6,20}$/;
export const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_BODY = 4096;
const LOG_MAX = 200;
const TRIES = 5;
const RECHECK = 30_000;
const HOUR = 3600_000;
// per account and per instance; the platform limit in the function config holds across instances
const LIMITS = { me: [120, 600_000], claim: [12, 600_000], admin: [240, 600_000] };
const ROUTES = { '/api/cbt/me': ['GET'], '/api/cbt/claim': ['POST'], '/api/cbt/admin': ['GET', 'POST'] };

const MSG = {
  auth: 'Sesi login habis. Masuk lagi lalu coba lagi.',
  google: 'Masuk pakai akun Google yang emailnya sudah terverifikasi.',
  'auth-down': 'Cek login lagi gangguan, coba lagi sebentar.',
  origin: 'Asal permintaan tidak dikenal.',
  method: 'Metode tidak didukung.',
  route: 'Alamat tidak dikenal.',
  'too-big': 'Permintaan terlalu besar.',
  'bad-json': 'Isi permintaan tidak valid.',
  'bad-request': 'Isi permintaan tidak valid.',
  'bad-nim': 'NIM cuma angka, 6 sampai 20 digit.',
  'not-found': 'NIM ini nggak ada di daftar kelas. Cek lagi angkanya.',
  taken: 'NIM ini sudah dipakai akun lain. Kalau ini NIM kamu, hubungi admin kelas.',
  slow: 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',
  busy: 'Lagi ramai, coba lagi sebentar.',
  server: 'Server lagi gangguan, coba lagi sebentar.',
  // admin only
  'not-admin': 'Akun ini bukan admin.',
  'bad-op': 'Perintah admin tidak dikenal.',
  'bad-uid': 'ID akun tidak valid.',
  'bad-name': 'Nama 2 sampai 80 karakter: huruf, spasi, titik, apostrof atau tanda hubung.',
  'bad-secret': 'Kunci utama harus 43 karakter base64url dan cocok dengan daftar kelas.',
  'exists-nim': 'NIM ini sudah ada di daftar.',
  'exists-secret': 'Kunci utama sudah terpasang.',
  setup: 'Pasang kunci utama dulu.',
  'gone-nim': 'NIM ini nggak ada di daftar kelas.',
};

const ok = (body) => json(200, body);
const err = (status, code, msg = code, headers) => json(status, { error: MSG[msg], code }, headers);
class Answer {
  constructor(res) {
    this.res = res;
  }
}
class Busy extends Error {}

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const isNim = (x) => typeof x === 'string' && NIM_RE.test(x);
const isUid = (x) => typeof x === 'string' && UID_RE.test(x);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/** Text from a token claim, safe to store and show: no control or direction characters, capped. */
function clean(s, max) {
  if (typeof s !== 'string') return '';
  return [...s.normalize('NFC').replace(CONTROL, '').replace(/\s+/g, ' ').trim()].slice(0, max).join('');
}

/** A person's name as an admin typed it, tidied, or null when it is not a name. */
export function cleanName(s) {
  if (typeof s !== 'string' || s.length > 200 || /[\u0000-\u001f\u007f]/.test(s)) return null;
  const t = s.normalize('NFC').replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 80 || !/^\p{L}[\p{L}\p{M} .'-]*$/u.test(t)) return null;
  return (t.match(/\p{L}/gu) || []).length >= 2 ? t : null;
}

// ---------- names

// Muhammad in the spellings and short forms Indonesian names use. A lone "M" counts only as
// the first word of a name ("M. Farhan"); elsewhere it is just an initial.
const MUHAMMAD = /^(?:md|mhd|mhmd|moh|mohd|moch|much|muh|muhd|m[ou]c?k?h?amm?[ae]d)$/;
const PARTICLES = new Set(['al', 'el', 'bin', 'binti', 'bt', 'ibn', 'ibnu']);
const TITLES = new Set([
  'dr', 'drs', 'dra', 'drg', 'prof', 'ir', 'hj', 'haji', 'hajah', 'hajjah', 'kh', 'ust', 'ustadz', 'ustadzah',
  'sked', 'ked', 'skm', 'spd', 'st', 'se', 'sh', 'ssi', 'skom', 'amd', 'mkes', 'mm', 'mt', 'msc', 'phd', 'bsc',
  'mr', 'mrs', 'ms', 'miss', 'sdr', 'sdri',
]);
const fold = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const letters = (w) => fold(w).replace(/[^a-z]/g, '');
const titleCase = (w) => w.toLowerCase().replace(/(^|-)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
const initial = (w) => (/\p{L}/u.exec(w)?.[0].toUpperCase() ?? '') + '.';

/**
 * The short name shown when someone types a NIM, so a typo does not bind the wrong person
 * without giving away the full name: the given name written out, every later word an initial.
 * DIMAS PRATAMA SAPUTRA is "Dimas P. S.". When a name starts with an abbreviation ("M.",
 * "Moch.", a single letter) or with Muhammad in any spelling, the first word that is not one is
 * the given name and the ones before it stay initials: M. FARHAN ALFARIZQI and MUHAMMAD FARHAN
 * ALFARIZQI are both "M. Farhan A.". Al and similar particles stay whole before the given name
 * ("M. Al Fatih") and are left out after it ("AHMAD FAUZI BIN ABDULLAH" is "Ahmad F. A.").
 */
export function shortName(full) {
  const words = String(full || '').trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const abbr = (w, i) => /\.$/.test(w) || letters(w).length < 2 || MUHAMMAD.test(letters(w)) || (i === 0 && letters(w) === 'm');
  const particle = (w) => PARTICLES.has(letters(w));
  let v = words.findIndex((w, i) => !abbr(w, i) && !particle(w));
  if (v < 0) v = words.findIndex((w) => !/\.$/.test(w) && letters(w).length > 1);
  if (v < 0) return words.map(initial).join(' ');
  const before = words.slice(0, v).map((w) => (particle(w) ? titleCase(w) : initial(w)));
  const after = words.slice(v + 1).filter((w) => !particle(w)).map(initial);
  return [...before, titleCase(words[v]), ...after].join(' ');
}

// The words of a name that say something: folded to plain lowercase, titles, particles and
// single-letter initials left out, every spelling of Muhammad made one word.
function nameWords(s) {
  const ws = fold(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !TITLES.has(w));
  return ws
    .map((w, i) => (MUHAMMAD.test(w) || (i === 0 && w === 'm') ? 'muhammad' : w))
    .filter((w) => w.length > 1 && !PARTICLES.has(w) && !/^[0-9]+$/.test(w));
}

/**
 * How much a Google account looks like the person whose NIM it claimed, for the admin view:
 * 'nim' when the email's local part contains the NIM; 'name' when every word of the Google name
 * is in the class list name, or the local part holds two of its words; 'partial' when one
 * telling word matches; else 'none'. Muhammad alone tells nothing, so it never decides a match.
 */
export function matchClaim(person, claim) {
  const local = fold(String(claim?.email || '').split('@')[0]).replace(/[^a-z0-9]/g, '');
  if (local && local.includes(person.nim)) return 'nim';
  const known = new Set(nameWords(person.name));
  const telling = (w) => w !== 'muhammad';
  const g = [...new Set(nameWords(claim?.gname))];
  if (g.length && g.every((w) => known.has(w)) && g.some(telling)) return 'name';
  const inMail = [...known].filter((w) => w.length >= 3 && local.includes(w));
  if (inMail.length >= 2 && inMail.some(telling)) return 'name';
  if (g.some((w) => telling(w) && known.has(w)) || inMail.some((w) => telling(w) && w.length >= 4)) return 'partial';
  return 'none';
}

// ---------- documents

function readRoster(doc) {
  if (!isObj(doc) || doc.v !== 1 || !Array.isArray(doc.people)) throw new Error('class list');
  const people = new Map();
  for (const p of doc.people) {
    if (!isObj(p) || !isNim(p.nim) || typeof p.name !== 'string' || people.has(p.nim)) throw new Error('class list');
    people.set(p.nim, { nim: p.nim, name: p.name, grp: typeof p.grp === 'string' ? p.grp : '', blocked: p.blocked === true });
  }
  return people;
}

function readClaims(d) {
  if (d === null) return { v: 1, nim: {} };
  if (!isObj(d) || d.v !== 1 || !isObj(d.nim)) throw new Error('cbt: the claims document is malformed');
  for (const [nim, c] of Object.entries(d.nim)) if (!isNim(nim) || !isObj(c) || !isUid(c.uid)) throw new Error('cbt: the claims document is malformed');
  return d;
}

// Without a config document the class list decides who is blocked.
function readConfig(d, roster) {
  if (d === null) return { v: 1, blocked: roster ? [...roster.values()].filter((p) => p.blocked).map((p) => p.nim) : [], accounts: [], add: [], drop: [] };
  const good = isObj(d) && d.v === 1 && [d.blocked, d.accounts, d.add, d.drop].every(Array.isArray)
    && d.blocked.every(isNim) && d.drop.every(isNim)
    && d.accounts.every((a) => isObj(a) && isUid(a.uid))
    && d.add.every((a) => isObj(a) && isNim(a.nim) && typeof a.name === 'string');
  if (!good) throw new Error('cbt: the config document is malformed');
  return d;
}

// The log only informs; a broken one is started over rather than locking anyone out.
const readLog = (d) => (isObj(d) && d.v === 1 && Array.isArray(d.ev) ? d : { v: 1, ev: [] });

/** Who is on the list now: the class list minus removed rows, plus people admins added. */
function everyone(roster, config) {
  const drop = new Set(config.drop);
  const out = new Map();
  for (const p of roster.values()) if (!drop.has(p.nim)) out.set(p.nim, p);
  for (const a of config.add) if (!out.has(a.nim)) out.set(a.nim, { nim: a.nim, name: a.name, grp: '', added: true });
  return out;
}

function limiter(max, windowMs) {
  const hits = new Map();
  // Seconds to wait, or 0 when the call may go ahead (and is counted).
  return (key, t) => {
    const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (list.length >= max) {
      hits.set(key, list);
      return Math.max(1, Math.ceil((list[0] + windowMs - t) / 1000));
    }
    list.push(t);
    hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] >= windowMs) hits.delete(k);
    return 0;
  };
}

/**
 * The /api/cbt handler. `store` is a Netlify Blobs store (or the same surface), `verify(token)`
 * returns the token's claims or throws AuthError, `isAdmin(token, uid)` answers true or false,
 * `env.CBT_SECRET` is the master secret if set, `roster` the sealed class list (base64url) and
 * `banks` the [{ id, kv }] keys are handed out for.
 */
export function createCbt({ store, verify, isAdmin, env = {}, roster = '', banks = [], now = Date.now, log = console, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  for (const b of banks) if (!BANK_ID.test(b?.id) || !Number.isInteger(b?.kv) || b.kv < 1) throw new Error('cbt: bad bank list');
  const limit = Object.fromEntries(Object.entries(LIMITS).map(([k, [max, ms]]) => [k, limiter(max, ms)]));
  const stamp = () => new Date(now()).toISOString();

  // ---------- the master secret: CBT_SECRET first, else the one an admin installed in Blobs.
  // It only counts once it opens the sealed class list. Found, it is kept for the life of the
  // instance; missing, Blobs is asked again at most every 30 s.
  let key = null;
  let envTried = false;
  let blobsAt = -Infinity;
  let blobsWarned = false;
  let pending = null;

  async function unseal(raw, source) {
    let master;
    try {
      master = parseSecret(raw);
    } catch {
      return null;
    }
    let people;
    try {
      people = readRoster(await openJson(await derive(master, LABEL.rosterKey), fromB64u(roster), LABEL.rosterAad));
    } catch {
      return null;
    }
    const keys = {};
    for (const b of banks) keys[b.id] = { kv: b.kv, k: toB64u(await derive(master, LABEL.bankKey(b.id, b.kv))) };
    return { source, people, keys };
  }

  async function find() {
    if (typeof env.CBT_SECRET === 'string' && env.CBT_SECRET.trim() && !envTried) {
      envTried = true;
      const k = await unseal(env.CBT_SECRET, 'env');
      if (k) return (key = k);
      log.error('cbt: CBT_SECRET does not open the class list in netlify/data/cbt.mjs; the try out stays closed until it does');
    }
    // nothing could open a class list that is not there (the placeholder data module)
    if (!roster || now() - blobsAt < RECHECK) return null;
    const stored = await store.get('secret');
    blobsAt = now();
    if (stored) {
      const k = await unseal(stored, 'blobs');
      if (k) return (key = k);
      if (!blobsWarned) log.error('cbt: the installed secret does not open the class list in netlify/data/cbt.mjs');
      blobsWarned = true;
    }
    return null;
  }

  const secret = () => (key ? Promise.resolve(key) : (pending ||= find().finally(() => (pending = null))));

  // ---------- documents, read with their ETag and written on the condition it still matches

  async function read(name) {
    const r = await store.getWithMetadata(name);
    if (!r) return { doc: null, etag: null };
    if (!r.etag) throw new Error(`cbt: Blobs answered ${name} without an ETag`);
    let doc;
    try {
      doc = JSON.parse(r.data);
    } catch {
      doc = undefined; // not JSON: claims and config refuse it, the log starts over
    }
    return { doc, etag: r.etag };
  }

  // Reads a document, lets `change` decide, and writes what it returns as `write`, only if
  // nobody wrote in between; otherwise reads again, up to TRIES times with a short random pause.
  async function update(name, parse, change) {
    for (let i = 0; i < TRIES; i++) {
      if (i) await sleep(10 + Math.random() * 40 * i);
      const { doc, etag } = await read(name);
      const out = change(parse(doc));
      if (!out.write) return out;
      const res = await store.setJSON(name, out.write, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
      if (res?.modified) {
        // the SDK also says "modified" when a conditional write failed with a server error
        if (!res.etag) throw new Error(`cbt: writing ${name} did not confirm`);
        return out;
      }
    }
    throw new Busy();
  }

  async function state(k) {
    const [c, cl] = await Promise.all([read('config'), read('claims')]);
    const config = readConfig(c.doc, k.people);
    const claims = readClaims(cl.doc);
    const byUid = new Map();
    for (const [nim, x] of Object.entries(claims.nim)) if (!byUid.has(x.uid)) byUid.set(x.uid, nim);
    return {
      config, claims, byUid,
      people: everyone(k.people, config),
      blocked: new Set(config.blocked),
      accounts: new Set(config.accounts.map((a) => a.uid)),
      // the name behind a claim even when that person is no longer on the list
      known: (nim) => everyone(k.people, config).get(nim) || k.people.get(nim) || null,
    };
  }

  // What /me says to this account. "closed" looks the same whatever the reason.
  function answer(k, s, uid) {
    const nim = s.byUid.get(uid);
    const p = nim ? s.known(nim) : null;
    const who = p ? { short: shortName(p.name), name: p.name, nim } : null;
    if (s.accounts.has(uid)) return { state: 'closed', who };
    if (!nim) return { state: 'claim' };
    if (!s.people.has(nim) || s.blocked.has(nim)) return { state: 'closed', who };
    return { state: 'ok', who, keys: k.keys, ttl: TTL };
  }

  async function note(ev, dedupe = false) {
    const e = { at: stamp() };
    for (const [f, v] of Object.entries(ev)) if (v !== undefined && v !== '') e[f] = v;
    const same = JSON.stringify(e);
    try {
      await update('log', readLog, (doc) => {
        if (dedupe && doc.ev.some((x) => x.kind === e.kind && x.uid === e.uid && x.nim === e.nim && now() - Date.parse(x.at) < HOUR)) return {};
        // a write that landed although its answer was lost and the SDK sent it again
        if (doc.ev.slice(0, 5).some((x) => JSON.stringify(x) === same)) return {};
        return { write: { v: 1, ev: [e, ...doc.ev].slice(0, LOG_MAX) } };
      });
    } catch (x) {
      log.error('cbt: could not write the log:', x?.message || x);
    }
  }

  // ---------- requests

  async function caller(req) {
    const m = /^Bearer (\S{1,4096})$/.exec(req.headers.get('authorization') || '');
    if (!m) throw new Answer(err(401, 'auth'));
    let claims;
    try {
      claims = await verify(m[1]);
    } catch (e) {
      if (e instanceof AuthError) throw new Answer(e.status === 403 ? err(403, 'google') : err(401, 'auth'));
      log.error('cbt: token check failed:', e?.message || e);
      throw new Answer(err(503, 'auth-down'));
    }
    if (!isUid(claims?.sub)) throw new Answer(err(401, 'auth'));
    return { token: m[1], uid: claims.sub, email: clean(claims.email, 254).toLowerCase(), gname: clean(claims.name, 100) };
  }

  // The JSON body as an object, read only as far as 4 KB.
  async function body(req) {
    if (Number(req.headers.get('content-length')) > MAX_BODY) throw new Answer(err(413, 'too-big'));
    const parts = [];
    let n = 0;
    if (req.body) {
      const reader = req.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.byteLength;
        if (n > MAX_BODY) {
          reader.cancel().catch(() => {});
          throw new Answer(err(413, 'too-big'));
        }
        parts.push(value);
      }
    }
    const bytes = new Uint8Array(n);
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.byteLength;
    }
    let b;
    try {
      b = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new Answer(err(400, 'bad-json'));
    }
    if (!isObj(b)) throw new Answer(err(400, 'bad-json'));
    return b;
  }

  async function claim(user, { nim, confirm = false }) {
    if (!isNim(nim)) return err(400, 'bad-nim');
    if (typeof confirm !== 'boolean') return err(400, 'bad-request');
    const k = await secret();
    if (!k) return ok({ state: 'setup' });
    const s = await state(k);
    // A bound or closed account cannot take a NIM, not even for a look.
    if (s.byUid.has(user.uid) || s.accounts.has(user.uid)) return ok(answer(k, s, user.uid));
    // From here on nothing depends on whether the NIM is blocked.
    const person = s.people.get(nim);
    if (!person) return err(404, 'not-found');
    const conflict = { kind: 'conflict', nim, uid: user.uid, email: user.email, gname: user.gname };
    if (Object.hasOwn(s.claims.nim, nim)) {
      await note(conflict, true);
      return err(409, 'taken');
    }
    if (!confirm) return ok({ preview: shortName(person.name) });
    const { outcome } = await update('claims', readClaims, (doc) => {
      if (Object.values(doc.nim).some((x) => x.uid === user.uid)) return { outcome: 'bound' };
      if (Object.hasOwn(doc.nim, nim)) return { outcome: 'taken' };
      doc.nim[nim] = { uid: user.uid, email: user.email, gname: user.gname, at: stamp() };
      return { write: doc, outcome: 'new' };
    });
    if (outcome === 'taken') {
      await note(conflict, true);
      return err(409, 'taken');
    }
    const a = answer(k, await state(k), user.uid);
    if (outcome === 'new' && a.state === 'closed') await note({ kind: 'closed', nim, uid: user.uid, email: user.email, gname: user.gname });
    return ok(a);
  }

  async function view() {
    const k = await secret();
    const [c, cl, lg] = await Promise.all([read('config'), read('claims'), read('log')]);
    const config = readConfig(c.doc, k?.people);
    const events = readLog(lg.doc).ev;
    if (!k) return { ready: false, source: null, people: [], accounts: config.accounts, log: events, counts: { people: 0, claimed: 0, blocked: 0 } };
    const claims = readClaims(cl.doc).nim;
    const blocked = new Set(config.blocked);
    const people = [...everyone(k.people, config).values()].map((p) => {
      const x = Object.hasOwn(claims, p.nim) ? claims[p.nim] : null;
      return {
        nim: p.nim, name: p.name, grp: p.grp, ...(p.added ? { added: true } : {}), blocked: blocked.has(p.nim),
        claim: x ? { uid: x.uid, email: x.email, gname: x.gname, at: x.at, match: matchClaim(p, x) } : null,
      };
    });
    const counts = { people: people.length, claimed: people.filter((p) => p.claim).length, blocked: people.filter((p) => p.blocked).length };
    return { ready: true, source: k.source, people, accounts: config.accounts, log: events, counts };
  }

  // Drops the claim on a NIM; answers the claim that was there, if any.
  async function release(nim) {
    const out = await update('claims', readClaims, (doc) => {
      if (!Object.hasOwn(doc.nim, nim)) return {};
      const gone = doc.nim[nim];
      delete doc.nim[nim];
      return { write: doc, gone };
    });
    return out.gone || null;
  }

  async function install(raw, by) {
    if (await secret()) return err(409, 'exists', 'exists-secret');
    const cur = await store.getWithMetadata('secret');
    if (cur && !cur.etag) throw new Error('cbt: Blobs answered secret without an ETag');
    // one that still opens the class list wins; one that no longer does may be replaced
    if (cur?.data && (await unseal(cur.data, 'blobs'))) return err(409, 'exists', 'exists-secret');
    const t = typeof raw === 'string' ? raw.trim() : '';
    const k = t.length === 43 ? await unseal(t, 'blobs') : null;
    if (!k) return err(400, 'bad-secret');
    const res = await store.set('secret', t, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (!res?.modified) return err(409, 'exists', 'exists-secret');
    if (!res.etag) throw new Error('cbt: writing secret did not confirm');
    key = k;
    await note({ kind: 'install', by });
    return ok(await view());
  }

  async function admin(req, user, b) {
    let allowed;
    try {
      allowed = await isAdmin(user.token, user.uid);
    } catch (e) {
      log.error('cbt: admin check failed:', e?.message || e);
      return err(503, 'auth-down');
    }
    if (!allowed) return err(403, 'not-admin');
    if (req.method === 'GET') return ok(await view());
    const { op } = b;
    const by = user.email || user.uid;
    if (op === 'install') return install(b.secret, by);
    if (!['block', 'unblock', 'release', 'blockAccount', 'unblockAccount', 'add', 'remove'].includes(op)) return err(400, 'bad-op');
    const k = await secret();
    if (!k) return err(409, 'setup');
    const conf = (d) => readConfig(d, k.people);
    const touch = (cfg) => Object.assign(cfg, { at: stamp(), by });

    if (op === 'blockAccount' || op === 'unblockAccount') {
      const { uid } = b;
      if (!isUid(uid)) return err(400, 'bad-uid');
      if (op === 'blockAccount') {
        // the email and name to show: from the account's claim, else from the log
        const [cl, lg] = await Promise.all([read('claims'), read('log')]);
        const seen = Object.values(readClaims(cl.doc).nim).find((x) => x.uid === uid) || readLog(lg.doc).ev.find((x) => x.uid === uid && (x.email || x.gname));
        const email = seen?.email || '', gname = seen?.gname || '';
        const out = await update('config', conf, (cfg) => {
          if (cfg.accounts.some((a) => a.uid === uid)) return {};
          cfg.accounts.push({ uid, email, gname, at: stamp(), by });
          return { write: touch(cfg) };
        });
        if (out.write) await note({ kind: op, uid, email, gname, by });
      } else {
        const out = await update('config', conf, (cfg) => {
          const was = cfg.accounts.find((a) => a.uid === uid);
          if (!was) return {};
          cfg.accounts = cfg.accounts.filter((a) => a.uid !== uid);
          return { write: touch(cfg), was };
        });
        if (out.was) await note({ kind: op, uid, email: out.was.email, gname: out.was.gname, by });
      }
      return ok(await view());
    }

    const { nim } = b;
    if (!isNim(nim)) return err(400, 'bad-nim');
    if (op === 'block' || op === 'unblock') {
      const out = await update('config', conf, (cfg) => {
        const has = cfg.blocked.includes(nim);
        if (op === 'block' && !everyone(k.people, cfg).has(nim)) return { missing: true };
        if (has === (op === 'block')) return {};
        cfg.blocked = op === 'block' ? [...cfg.blocked, nim] : cfg.blocked.filter((x) => x !== nim);
        return { write: touch(cfg) };
      });
      if (out.missing) return err(404, 'not-found', 'gone-nim');
      if (out.write) await note({ kind: op, nim, by });
    } else if (op === 'release') {
      const gone = await release(nim);
      if (gone) await note({ kind: op, nim, uid: gone.uid, email: gone.email, gname: gone.gname, by });
    } else if (op === 'add') {
      const name = cleanName(b.name);
      if (!name) return err(400, 'bad-name');
      const out = await update('config', conf, (cfg) => {
        if (everyone(k.people, cfg).has(nim)) return { exists: true };
        // a removed classmate comes back as the class list has them
        if (k.people.has(nim)) cfg.drop = cfg.drop.filter((x) => x !== nim);
        else cfg.add.push({ nim, name, at: stamp(), by });
        return { write: touch(cfg) };
      });
      if (out.exists) return err(409, 'exists', 'exists-nim');
      await note({ kind: op, nim, by });
    } else {
      if (!everyone(k.people, readConfig((await read('config')).doc, k.people)).has(nim)) return err(404, 'not-found', 'gone-nim');
      // The claim goes first, so a retry after a failure in between still finishes the job, and
      // once more after the list changed, for a claim that landed in the meantime.
      const freed = await release(nim);
      const out = await update('config', conf, (cfg) => {
        if (cfg.add.some((a) => a.nim === nim)) cfg.add = cfg.add.filter((a) => a.nim !== nim);
        else if (k.people.has(nim) && !cfg.drop.includes(nim)) cfg.drop = [...cfg.drop, nim];
        else return {};
        return { write: touch(cfg) };
      });
      const gone = freed || (await release(nim));
      if (out.write || gone) await note({ kind: op, nim, uid: gone?.uid, email: gone?.email, gname: gone?.gname, by });
    }
    return ok(await view());
  }

  return async function handle(req) {
    try {
      const url = new URL(req.url);
      const methods = Object.hasOwn(ROUTES, url.pathname) ? ROUTES[url.pathname] : null;
      if (!methods) return err(404, 'route');
      if (!methods.includes(req.method)) return err(405, 'method', 'method', { allow: methods.join(', ') });
      // Browsers always send Origin on POST; anything else is not the site.
      const origin = req.headers.get('origin');
      if (req.method === 'POST' && origin && origin !== url.origin) return err(403, 'origin');
      const user = await caller(req);
      const kind = url.pathname.slice('/api/cbt/'.length);
      const wait = limit[kind](user.uid, now());
      if (wait) return err(429, 'slow', 'slow', { 'retry-after': String(wait) });
      const b = req.method === 'POST' ? await body(req) : null;
      if (kind === 'me') {
        const k = await secret();
        return ok(k ? answer(k, await state(k), user.uid) : { state: 'setup' });
      }
      if (kind === 'claim') return await claim(user, b);
      return await admin(req, user, b);
    } catch (e) {
      if (e instanceof Answer) return e.res;
      if (e instanceof Busy) return err(503, 'busy');
      log.error('cbt:', e?.message || e);
      return err(503, 'server');
    }
  };
}
