// Tests for classmate-only access to the try out: the sealed files (src/lib/seal.js), the
// /api/cbt logic (netlify/lib/cbt.mjs) against an in-memory Blobs store with real ETag rules,
// and the seal script (scripts/cbt/seal.mjs) end to end in a temporary folder.
// Every name and NIM here is made up.
// Run: node --test tests/cbt.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LABEL, SealError, derive, seal, open, openJson, toB64u, fromB64u, hashHex } from '../src/lib/seal.js';
import { AuthError } from '../netlify/lib/auth.mjs';
import { createCbt, matchClaim, cleanName, TTL } from '../netlify/lib/cbt.mjs';
import { displayName } from '../src/lib/names.js';

const newSecret = () => toB64u(crypto.getRandomValues(new Uint8Array(32)));
const SECRET = newSecret();
const OTHER = newSecret();
const T0 = Date.parse('2026-10-22T01:00:00Z');
const ORIGIN = 'https://alphangers.test';

const PEOPLE = [
  { nim: '09011282631001', name: 'DIMAS PRATAMA SAPUTRA' },
  { nim: '09011282631002', name: 'M. FARHAN ALFARIZQI' },
  { nim: '09011282631003', name: 'SITI NUR HALIZAH' },
  { nim: '09011282631004', name: 'MUHAMMAD RIZKY AKBAR' },
  { nim: '09011282631005', name: 'ANINDYA PUTRI KIRANA', blocked: true },
  { nim: '09011282631006', name: 'NAUFAL HAKIM' },
  { nim: '09011282631007', name: "NUR'AINI SALSABILA" },
];
const [DIMAS, FARHAN, SITI, RIZKY, ANIN, NAUFAL] = PEOPLE.map((p) => p.nim);
const BANKS = [{ id: 'b2', kv: 1 }, { id: 'b3', kv: 2 }];

async function sealRoster(secret, people) {
  const m = fromB64u(secret);
  return toB64u(await seal(await derive(m, LABEL.rosterKey), await derive(m, LABEL.rosterIv), JSON.stringify({ v: 1, people }), LABEL.rosterAad));
}
const ROSTER = await sealRoster(SECRET, PEOPLE);

// Google accounts. The token is the account's name; the fake check below turns it into claims.
const ACCOUNTS = {
  dimas: { uid: 'uDimas', email: 'dimaspratama09@gmail.com', name: 'Dimas Pratama' },
  farhan: { uid: 'uFarhan', email: '09011282631002@student.example.ac.id', name: 'Farhan' },
  siti: { uid: 'uSiti', email: 'siti.halizah@gmail.com', name: 'Siti Nur Halizah' },
  anin: { uid: 'uAnin', email: 'anindya.k@gmail.com', name: 'Anindya Kirana' },
  naufal: { uid: 'uNaufal', email: 'naufalhkm@gmail.com', name: 'Naufal' },
  eve: { uid: 'uEve', email: 'eve.random@gmail.com', name: 'Evelyn Tan' },
  mallory: { uid: 'uMallory', email: 'mallory@gmail.com', name: 'Mallory' },
  admin: { uid: 'uAdmin', email: 'admin.kelas@gmail.com', name: 'Admin Kelas' },
};
const ADMINS = new Set(['uAdmin']);
async function verify(token) {
  if (token === 'unverified') throw new AuthError(403, 'not a verified Google account');
  if (token === 'jwks-down') throw new Error('jwks 500');
  const a = ACCOUNTS[token];
  if (!a) throw new AuthError(401, 'bad signature');
  return { sub: a.uid, email: a.email, name: a.name, email_verified: true, firebase: { sign_in_provider: 'google.com' } };
}

// Netlify Blobs as far as the function uses it: strong reads, ETags, onlyIfNew / onlyIfMatch.
// race(key) makes the next conditional write to that key lose: another writer gets there first.
class FakeStore {
  constructor() {
    this.m = new Map();
    this.n = 0;
    this.rivals = [];
    this.writes = 0;
  }
  tick() {
    return new Promise((r) => setImmediate(r));
  }
  raw(key, data) {
    this.m.set(key, { data: typeof data === 'string' ? data : JSON.stringify(data), etag: `"e${++this.n}"` });
  }
  doc(key) {
    const e = this.m.get(key);
    return e ? JSON.parse(e.data) : null;
  }
  async get(key, { type } = {}) {
    await this.tick();
    const e = this.m.get(key);
    if (!e) return null;
    return type === 'json' ? JSON.parse(e.data) : e.data;
  }
  async getWithMetadata(key, { type } = {}) {
    await this.tick();
    const e = this.m.get(key);
    if (!e) return null;
    return { data: type === 'json' ? JSON.parse(e.data) : e.data, etag: e.etag, metadata: {} };
  }
  set(key, data, opts) {
    return this.put(key, String(data), opts);
  }
  setJSON(key, data, opts) {
    return this.put(key, JSON.stringify(data), opts);
  }
  async put(key, data, { onlyIfNew, onlyIfMatch } = {}) {
    await this.tick();
    const i = this.rivals.findIndex((r) => r.key === key);
    if (i >= 0 && (onlyIfNew || onlyIfMatch)) {
      const [r] = this.rivals.splice(i, 1);
      r.run(this);
    }
    const cur = this.m.get(key);
    if (onlyIfNew && cur) return { modified: false };
    if (onlyIfMatch && (!cur || cur.etag !== onlyIfMatch)) return { modified: false };
    const etag = `"e${++this.n}"`;
    this.m.set(key, { data, etag });
    this.writes++;
    return { modified: true, etag };
  }
  async delete(key) {
    await this.tick();
    this.m.delete(key);
  }
  race(key, run = (s) => s.raw(key, s.m.get(key)?.data ?? '{"v":1}')) {
    this.rivals.push({ key, run });
  }
}

function setup({ env = {}, blobsSecret, roster = ROSTER, banks = BANKS, store = new FakeStore() } = {}) {
  if (blobsSecret) store.raw('secret', blobsSecret);
  const errors = [];
  const clock = { t: T0 };
  const cbt = createCbt({
    store,
    verify,
    isAdmin: async (token, uid) => {
      if (token === 'admin-down') throw new AuthError(503, 'admin check failed: 500');
      return ADMINS.has(uid);
    },
    env,
    roster,
    banks,
    now: () => clock.t,
    log: { error: (...a) => errors.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ')) },
    sleep: async () => {},
  });
  const call = async (method, path, { as, body, raw, origin = ORIGIN, headers = {} } = {}) => {
    const h = { ...headers };
    if (as) h.authorization = 'Bearer ' + as;
    if (method === 'POST' && origin) h.origin = origin;
    const init = { method, headers: h };
    if (raw !== undefined) init.body = raw;
    else if (body !== undefined) init.body = JSON.stringify(body);
    const res = await cbt(new Request(ORIGIN + path, init));
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), text, headers: res.headers };
  };
  const me = (as) => call('GET', '/api/cbt/me', { as });
  const claim = (as, nim, confirm = false) => call('POST', '/api/cbt/claim', { as, body: { nim, confirm } });
  const admin = (op, args = {}, as = 'admin') => call('POST', '/api/cbt/admin', { as, body: { op, ...args } });
  const view = (as = 'admin') => call('GET', '/api/cbt/admin', { as });
  return { cbt, store, errors, clock, call, me, claim, admin, view };
}
const ready = (o = {}) => setup({ env: { CBT_SECRET: SECRET }, ...o });

async function bankKey(secret, id, kv) {
  return toB64u(await derive(fromB64u(secret), LABEL.bankKey(id, kv)));
}
const row = (v, nim) => v.body.people.find((p) => p.nim === nim);

// ---------- sealed files

test('banks, pictures and the class list open only with their own key and label', async () => {
  const m = fromB64u(SECRET);
  const key = await derive(m, LABEL.bankKey('b3', 1));
  const iv = await derive(m, LABEL.bankIv('b3', 1));
  const bank = { id: 'b3', q: [{ id: 'q001', q: 'Organel penghasil ATP terbanyak?' }] };
  const sealed = await seal(key, iv, JSON.stringify(bank), LABEL.bankAad('b3', 1));
  assert.deepEqual(await openJson(key, sealed, LABEL.bankAad('b3', 1)), bank);
  assert.deepEqual(sealed, await seal(key, iv, JSON.stringify(bank), LABEL.bankAad('b3', 1)), 'the same input seals to the same bytes');
  assert.equal(Buffer.from(sealed).toString('latin1').includes('ATP'), false);
  for (const i of [0, 1, 12, 13, 40, sealed.length - 1]) {
    const bad = sealed.slice();
    bad[i] ^= 1;
    await assert.rejects(open(key, bad, LABEL.bankAad('b3', 1)), SealError, 'byte ' + i);
  }
  await assert.rejects(open(key, sealed.subarray(0, 20), LABEL.bankAad('b3', 1)), (e) => e.reason === 'format');
  await assert.rejects(open(key, sealed, LABEL.bankAad('b3', 2)), SealError, 'another version');
  await assert.rejects(open(key, sealed, LABEL.bankAad('b2', 1)), SealError, 'another bank');
  await assert.rejects(open(await derive(m, LABEL.bankKey('b3', 2)), sealed, LABEL.bankAad('b3', 1)), SealError, 'the next version key');
  await assert.rejects(open(await derive(fromB64u(OTHER), LABEL.bankKey('b3', 1)), sealed, LABEL.bankAad('b3', 1)), SealError, 'another secret');

  const pic = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 9, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4]);
  const sp = await seal(key, iv, pic, LABEL.imgAad('b3', 1, 'i01'));
  assert.deepEqual(await open(key, sp, LABEL.imgAad('b3', 1, 'i01')), pic);
  await assert.rejects(open(key, sp, LABEL.imgAad('b3', 1, 'i02')), SealError, 'a picture cannot pass as another');
  await assert.rejects(open(key, sp, LABEL.bankAad('b3', 1)), SealError, 'nor as the bank');
  const bp = sp.slice();
  bp[sp.length - 5] ^= 4;
  await assert.rejects(open(key, bp, LABEL.imgAad('b3', 1, 'i01')), SealError, 'a changed picture');

  const roster = fromB64u(ROSTER);
  const rk = await derive(m, LABEL.rosterKey);
  assert.equal((await openJson(rk, roster, LABEL.rosterAad)).people.length, PEOPLE.length);
  await assert.rejects(openJson(await derive(fromB64u(OTHER), LABEL.rosterKey), roster, LABEL.rosterAad), SealError);
  await assert.rejects(openJson(key, roster, LABEL.rosterAad), SealError, 'a bank key does not open the class list');
  const br = roster.slice();
  br[30] ^= 0x80;
  await assert.rejects(openJson(rk, br, LABEL.rosterAad), SealError);
});

// ---------- /me

test('/me without a secret is setup, for everyone, and logs nothing', async () => {
  const t = setup();
  assert.deepEqual((await t.me('dimas')).body, { state: 'setup' });
  assert.deepEqual((await t.me('eve')).body, { state: 'setup' });
  assert.deepEqual((await t.claim('dimas', DIMAS, true)).body, { state: 'setup' });
  assert.equal(t.store.doc('claims'), null, 'nothing bound');
  assert.deepEqual(t.errors, []);
});

test('a wrong secret counts as missing and logs one error, whatever it is and wherever it is', async () => {
  for (const o of [{ env: { CBT_SECRET: OTHER } }, { blobsSecret: OTHER }, { env: { CBT_SECRET: 'too-short' } }]) {
    const t = setup(o);
    for (let i = 0; i < 3; i++) {
      assert.deepEqual((await t.me('dimas')).body, { state: 'setup' });
      t.clock.t += 31_000;
    }
    assert.equal(t.errors.length, 1, JSON.stringify(o) + ' ' + t.errors.join(' | '));
    for (const e of t.errors) assert.equal(e.includes(OTHER), false, 'the secret itself is never logged');
  }
  // a secret with no class list to open (the placeholder data module)
  const p = setup({ env: { CBT_SECRET: SECRET }, roster: '', banks: [] });
  assert.deepEqual((await p.me('dimas')).body, { state: 'setup' });
  assert.equal(p.errors.length, 1);
  assert.equal((await p.view()).body.ready, false);
});

test('/me: claim before binding, ok after, with one key per bank and the offline ttl', async () => {
  const t = ready();
  assert.deepEqual((await t.me('dimas')).body, { state: 'claim' });
  await t.claim('dimas', DIMAS, true);
  const r = await t.me('dimas');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(r.body, {
    state: 'ok',
    who: { name: 'Dimas Pratama Saputra', nim: DIMAS },
    keys: { b2: { kv: 1, k: await bankKey(SECRET, 'b2', 1) }, b3: { kv: 2, k: await bankKey(SECRET, 'b3', 2) } },
    ttl: TTL,
  });
  assert.equal(TTL, 604800);
  // the handed out key really opens a bank sealed for that version
  const m = fromB64u(SECRET);
  const sealed = await seal(await derive(m, LABEL.bankKey('b3', 2)), await derive(m, LABEL.bankIv('b3', 2)), '{"id":"b3"}', LABEL.bankAad('b3', 2));
  assert.deepEqual(await openJson(fromB64u(r.body.keys.b3.k), sealed, LABEL.bankAad('b3', 2)), { id: 'b3' });
});

test('/me needs a valid token from a verified Google account', async () => {
  const t = ready();
  const none = await t.call('GET', '/api/cbt/me');
  assert.equal(none.status, 401);
  assert.equal(none.body.code, 'auth');
  assert.match(none.body.error, /\w/);
  assert.equal((await t.call('GET', '/api/cbt/me', { headers: { authorization: 'Basic abc' } })).status, 401);
  assert.equal((await t.me('forged')).status, 401);
  const u = await t.me('unverified');
  assert.equal(u.status, 403);
  assert.equal(u.body.code, 'google');
  const down = await t.me('jwks-down');
  assert.equal(down.status, 503);
  assert.equal(down.body.code, 'auth-down');
});

test('/me is closed for a blocked NIM, a blocked account and a NIM no longer on the list, and never says why', async () => {
  const t = ready();
  // ANIN is blocked on the class list itself; she claims like anyone else
  assert.equal((await t.claim('anin', ANIN, true)).body.state, 'closed');
  const a = await t.me('anin');
  assert.deepEqual(a.body, { state: 'closed', who: { name: 'Anindya Putri Kirana', nim: ANIN } });
  // an account blocked by an admin, bound and not bound
  await t.claim('naufal', NAUFAL, true);
  await t.admin('blockAccount', { uid: 'uNaufal' });
  await t.admin('blockAccount', { uid: 'uEve' });
  assert.deepEqual((await t.me('naufal')).body, { state: 'closed', who: { name: 'Naufal Hakim', nim: NAUFAL } });
  assert.deepEqual((await t.me('eve')).body, { state: 'closed', who: null });
  // a claim left on a NIM the list no longer has (here: the class list was rebuilt without it)
  const claims = t.store.doc('claims');
  claims.nim['09011282639999'] = { uid: 'uMallory', email: 'mallory@gmail.com', gname: 'Mallory', at: new Date(T0).toISOString() };
  t.store.raw('claims', claims);
  assert.deepEqual((await t.me('mallory')).body, { state: 'closed', who: null });
  for (const x of ['anin', 'naufal', 'eve', 'mallory']) {
    const r = await t.me(x);
    assert.equal(r.text.includes('"keys"'), false);
    assert.doesNotMatch(r.text, /block|blokir|banned|pelanggaran|removed|drop/i);
  }
});

// ---------- claim

test('claim: preview, then confirm binds; confirming again changes nothing', async () => {
  const t = ready();
  const p = await t.claim('farhan', FARHAN);
  assert.equal(p.status, 200);
  assert.deepEqual(p.body, { preview: 'M. Farhan Alfarizqi' });
  assert.equal(t.store.doc('claims'), null, 'a preview binds nothing');
  const c = await t.claim('farhan', FARHAN, true);
  assert.equal(c.body.state, 'ok');
  assert.equal(c.body.who.nim, FARHAN);
  assert.deepEqual(c.body, (await t.me('farhan')).body, 'answers exactly like /me');
  const bound = t.store.doc('claims').nim[FARHAN];
  assert.deepEqual(bound, { uid: 'uFarhan', email: '09011282631002@student.example.ac.id', gname: 'Farhan', at: new Date(T0).toISOString() });
  const writes = t.store.writes;
  assert.deepEqual((await t.claim('farhan', FARHAN, true)).body, c.body);
  // an account that is bound cannot bind or even preview another NIM
  assert.deepEqual((await t.claim('farhan', DIMAS, true)).body, c.body);
  assert.deepEqual((await t.claim('farhan', DIMAS)).body, c.body);
  assert.equal(t.store.writes, writes, 'nothing written');
  assert.equal(t.store.doc('claims').nim[DIMAS], undefined);
});

test('claim: NIM format, unknown NIM, and a NIM another account holds (409 and a conflict in the log)', async () => {
  const t = ready();
  for (const nim of ['12345', '1'.repeat(21), '0901128263100a', ' 09011282631001', '０９０１１２８２６３１００１', 9011282631001, null, '']) {
    const r = await t.call('POST', '/api/cbt/claim', { as: 'dimas', body: { nim, confirm: false } });
    assert.equal(r.status, 400, String(nim));
    assert.equal(r.body.code, 'bad-nim');
  }
  const bad = await t.call('POST', '/api/cbt/claim', { as: 'dimas', body: { nim: DIMAS, confirm: 'yes' } });
  assert.equal(bad.status, 400);
  const nf = await t.claim('dimas', '09011282639999');
  assert.equal(nf.status, 404);
  assert.equal(nf.body.code, 'not-found');
  assert.match(nf.body.error, /NIM/);

  await t.claim('dimas', DIMAS, true);
  for (const confirm of [false, true]) {
    const r = await t.claim('eve', DIMAS, confirm);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'taken');
    t.clock.t += 60_000;
  }
  t.clock.t -= 120_000;
  const ev = t.store.doc('log').ev;
  assert.equal(ev.length, 1, 'the same attempt again within the hour is one entry');
  assert.deepEqual(ev[0], { at: new Date(T0).toISOString(), kind: 'conflict', nim: DIMAS, uid: 'uEve', email: 'eve.random@gmail.com', gname: 'Evelyn Tan' });
  t.clock.t += 3601_000;
  await t.claim('eve', DIMAS);
  await t.claim('eve', SITI); // free: just a preview, not a conflict
  assert.equal(t.store.doc('log').ev.length, 2);
  assert.equal(t.store.doc('claims').nim[DIMAS].uid, 'uDimas', 'the holder keeps it');
  assert.equal((await t.me('eve')).body.state, 'claim');
});

test('a blocked NIM answers like any other until it is bound, then closed (and logged)', async () => {
  const t = ready();
  const shape = (r) => ({ status: r.status, keys: Object.keys(r.body).sort(), code: r.body.code });
  // preview: same shape as for an allowed NIM
  assert.deepEqual(shape(await t.claim('anin', ANIN)), shape(await t.claim('naufal', NAUFAL)));
  assert.deepEqual((await t.claim('anin', ANIN)).body, { preview: 'Anindya Putri Kirana' });
  // taken: same answer whoever holds what
  await t.claim('naufal', NAUFAL, true);
  await t.claim('anin', ANIN, true);
  const takenBlocked = await t.claim('eve', ANIN);
  const takenAllowed = await t.claim('eve', NAUFAL);
  assert.deepEqual(takenBlocked.body, takenAllowed.body);
  assert.equal(takenBlocked.status, takenAllowed.status);
  // only the person bound to the blocked NIM learns anything, and only "closed"
  assert.equal((await t.me('anin')).body.state, 'closed');
  const kinds = t.store.doc('log').ev.map((e) => [e.kind, e.nim]);
  assert.deepEqual(kinds.filter(([k]) => k === 'closed'), [['closed', ANIN]]);
  // being bound, she cannot move to an allowed NIM
  assert.equal((await t.claim('anin', SITI, true)).body.state, 'closed');
  assert.equal(t.store.doc('claims').nim[SITI], undefined);
});

test('a blocked account is closed and cannot bind or preview anything', async () => {
  const t = ready();
  await t.admin('blockAccount', { uid: 'uEve' });
  for (const confirm of [false, true]) {
    const r = await t.claim('eve', SITI, confirm);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { state: 'closed', who: null });
  }
  assert.equal(t.store.doc('claims'), null);
  await t.admin('unblockAccount', { uid: 'uEve' });
  assert.equal((await t.claim('eve', SITI)).body.preview, 'Siti Nur Halizah');
});

test('two accounts confirming the same NIM at once: exactly one gets it', async () => {
  for (let round = 0; round < 5; round++) {
    const t = ready();
    const [a, b] = await Promise.all([t.claim('dimas', SITI, true), t.claim('eve', SITI, true)]);
    const won = [a, b].filter((r) => r.status === 200 && r.body.state === 'ok');
    const lost = [a, b].filter((r) => r.status === 409 && r.body.code === 'taken');
    assert.equal(won.length, 1);
    assert.equal(lost.length, 1);
    const claims = t.store.doc('claims').nim;
    assert.deepEqual(Object.keys(claims), [SITI]);
    assert.equal(claims[SITI].uid, a === won[0] ? 'uDimas' : 'uEve');
    assert.equal(t.store.doc('log').ev[0].kind, 'conflict');
  }
});

test('one account confirming two NIMs at once: exactly one is bound', async () => {
  const t = ready();
  const rs = await Promise.all([t.claim('dimas', DIMAS, true), t.claim('dimas', SITI, true), t.claim('dimas', RIZKY, true)]);
  const claims = t.store.doc('claims').nim;
  assert.equal(Object.keys(claims).length, 1);
  const nim = Object.keys(claims)[0];
  for (const r of rs) {
    assert.equal(r.body.state, 'ok');
    assert.equal(r.body.who.nim, nim, 'every answer names the one binding');
  }
});

test('a lost write is read again and retried; five lost writes in a row give up with 503', async () => {
  const t = ready();
  t.store.race('claims', (s) => s.raw('claims', { v: 1, nim: { [RIZKY]: { uid: 'uSiti', email: 'siti.halizah@gmail.com', gname: 'Siti Nur Halizah', at: new Date(T0).toISOString() } } }));
  const r = await t.claim('dimas', DIMAS, true);
  assert.equal(r.body.state, 'ok');
  assert.deepEqual(Object.keys(t.store.doc('claims').nim).sort(), [DIMAS, RIZKY], 'the other write is kept');
  for (let i = 0; i < 5; i++) t.store.race('claims');
  const busy = await t.claim('naufal', NAUFAL, true);
  assert.equal(busy.status, 503);
  assert.equal(busy.body.code, 'busy');
  assert.equal(t.store.doc('claims').nim[NAUFAL], undefined);
  assert.equal((await t.claim('naufal', NAUFAL, true)).body.state, 'ok', 'and works on the next try');
  // the log races too
  for (let i = 0; i < 2; i++) t.store.race('log');
  await t.claim('eve', DIMAS);
  assert.equal(t.store.doc('log').ev.length, 1);
});

test('a store answer without an ETag or a write that does not report one fails closed', async () => {
  const t = ready();
  await t.claim('dimas', DIMAS, true);
  const s = t.store;
  const real = s.getWithMetadata.bind(s);
  s.getWithMetadata = async (k, o) => {
    const x = await real(k, o);
    return x && { ...x, etag: undefined };
  };
  const r = await t.claim('siti', SITI, true);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'server');
  s.getWithMetadata = real;
  s.setJSON = async () => ({ modified: true, etag: '' }); // what the SDK reports for a 500
  assert.equal((await t.claim('siti', SITI, true)).status, 503);
  assert.ok(t.errors.length >= 2);
  // a broken claims or config document never reads as "nobody is bound" or "nobody is blocked"
  for (const [key, data] of [['claims', 'garbage'], ['claims', { v: 1, nim: { [DIMAS]: { uid: 'bad uid!' } } }], ['config', { v: 1, blocked: 'all' }]]) {
    const u = ready();
    await u.claim('dimas', DIMAS, true);
    u.store.raw(key, data);
    const r = await u.me('dimas');
    assert.equal(r.status, 503, key);
    assert.equal(r.body.code, 'server');
  }
});

// ---------- admin

test('admin: only admins, and a failing admin check is a 503', async () => {
  const t = ready();
  for (const [as, status, code] of [[undefined, 401, 'auth'], ['dimas', 403, 'not-admin'], ['admin-down', 503, 'auth-down']]) {
    if (as === 'admin-down') ACCOUNTS['admin-down'] = { uid: 'uAdminDown', email: 'x@gmail.com', name: 'X' };
    const g = await t.call('GET', '/api/cbt/admin', { as });
    assert.equal(g.status, status, String(as));
    assert.equal(g.body.code, code);
    const p = await t.call('POST', '/api/cbt/admin', { as, body: { op: 'block', nim: DIMAS } });
    assert.equal(p.status, status);
  }
  delete ACCOUNTS['admin-down'];
  assert.equal(t.store.doc('config'), null, 'nothing changed');
});

test('admin view: the whole class with claims, how each claim matches, and counts', async () => {
  const t = ready();
  await t.claim('dimas', DIMAS, true);
  await t.claim('farhan', FARHAN, true);
  await t.claim('eve', SITI, true);
  await t.claim('siti', SITI); // conflict
  const v = await t.view();
  assert.equal(v.status, 200);
  assert.deepEqual(Object.keys(v.body), ['ready', 'source', 'people', 'accounts', 'log', 'counts']);
  assert.equal(v.body.ready, true);
  assert.equal(v.body.source, 'env');
  assert.equal(v.body.people.length, PEOPLE.length);
  assert.deepEqual(row(v, DIMAS), { nim: DIMAS, name: 'DIMAS PRATAMA SAPUTRA', blocked: false, claim: { uid: 'uDimas', email: 'dimaspratama09@gmail.com', gname: 'Dimas Pratama', at: new Date(T0).toISOString(), match: 'name' } });
  assert.equal(row(v, FARHAN).claim.match, 'nim');
  assert.equal(row(v, SITI).claim.match, 'none');
  assert.equal(row(v, ANIN).blocked, true, 'blocked on the class list itself');
  assert.equal(row(v, RIZKY).claim, null);
  assert.deepEqual(v.body.counts, { people: 7, claimed: 3, blocked: 1 });
  assert.deepEqual(v.body.accounts, []);
  assert.equal(v.body.log[0].kind, 'conflict');
  assert.equal(v.text.includes(await bankKey(SECRET, 'b2', 1)), false, 'no key in the admin view');
  assert.equal(v.text.includes(SECRET), false);
});

test('admin: block and unblock a NIM, with validation, logged with the admin', async () => {
  const t = ready();
  await t.claim('naufal', NAUFAL, true);
  const r = await t.admin('block', { nim: NAUFAL });
  assert.equal(r.status, 200);
  assert.equal(row(r, NAUFAL).blocked, true);
  assert.equal((await t.me('naufal')).body.state, 'closed');
  assert.deepEqual(t.store.doc('config').blocked.sort(), [ANIN, NAUFAL], 'starts from the class list blocked rows');
  assert.deepEqual(t.store.doc('log').ev[0], { at: new Date(T0).toISOString(), kind: 'block', nim: NAUFAL, by: 'admin.kelas@gmail.com' });
  const n = t.store.doc('log').ev.length;
  await t.admin('block', { nim: NAUFAL });
  assert.equal(t.store.doc('log').ev.length, n, 'a repeat changes and logs nothing');
  await t.admin('unblock', { nim: NAUFAL });
  assert.equal((await t.me('naufal')).body.state, 'ok');
  await t.admin('unblock', { nim: ANIN });
  assert.equal((await t.claim('anin', ANIN, true)).body.state, 'ok', 'a class list block can be lifted');
  assert.equal((await t.admin('block', { nim: '09011282639999' })).status, 404);
  for (const nim of ['abc', '', undefined, 123]) {
    const b = await t.admin('block', { nim });
    assert.equal(b.status, 400, String(nim));
    assert.equal(b.body.code, 'bad-nim');
    assert.equal((await t.admin('unblock', { nim })).status, 400);
  }
  assert.deepEqual(t.store.doc('log').ev.slice(0, 2).map((e) => [e.kind, e.nim]), [['unblock', ANIN], ['unblock', NAUFAL]]);
});

test('admin: release frees a NIM and the account; the account can claim again', async () => {
  const t = ready();
  await t.claim('eve', DIMAS, true);
  assert.equal((await t.claim('dimas', DIMAS, true)).status, 409);
  const r = await t.admin('release', { nim: DIMAS });
  assert.equal(row(r, DIMAS).claim, null);
  assert.deepEqual(r.body.log[0], { at: new Date(T0).toISOString(), kind: 'release', nim: DIMAS, uid: 'uEve', email: 'eve.random@gmail.com', gname: 'Evelyn Tan', by: 'admin.kelas@gmail.com' });
  assert.equal((await t.claim('dimas', DIMAS, true)).body.state, 'ok');
  assert.equal((await t.me('eve')).body.state, 'claim');
  assert.equal((await t.claim('eve', SITI, true)).body.state, 'ok', 'released, the account may bind once more');
  const n = t.store.doc('log').ev.length;
  assert.equal((await t.admin('release', { nim: RIZKY })).status, 200, 'nothing to release is fine');
  assert.equal(t.store.doc('log').ev.length, n);
  assert.equal((await t.admin('release', { nim: 'x' })).body.code, 'bad-nim');
});

test('admin: block and unblock a Google account, with its email and name from its claim or the log', async () => {
  const t = ready();
  await t.claim('eve', DIMAS, true);
  await t.claim('mallory', DIMAS); // conflict: known from the log only
  let r = await t.admin('blockAccount', { uid: 'uEve' });
  assert.deepEqual(r.body.accounts, [{ uid: 'uEve', email: 'eve.random@gmail.com', gname: 'Evelyn Tan', at: new Date(T0).toISOString(), by: 'admin.kelas@gmail.com' }]);
  r = await t.admin('blockAccount', { uid: 'uMallory' });
  assert.deepEqual(r.body.accounts[1], { uid: 'uMallory', email: 'mallory@gmail.com', gname: 'Mallory', at: new Date(T0).toISOString(), by: 'admin.kelas@gmail.com' });
  r = await t.admin('blockAccount', { uid: 'uNobodyKnows' });
  assert.deepEqual(r.body.accounts[2], { uid: 'uNobodyKnows', email: '', gname: '', at: new Date(T0).toISOString(), by: 'admin.kelas@gmail.com' });
  assert.equal((await t.me('eve')).body.state, 'closed');
  assert.equal(row(r, DIMAS).claim.uid, 'uEve', 'blocking does not release');
  assert.deepEqual(r.body.log[2], { at: new Date(T0).toISOString(), kind: 'blockAccount', uid: 'uEve', email: 'eve.random@gmail.com', gname: 'Evelyn Tan', by: 'admin.kelas@gmail.com' });
  const n = r.body.log.length;
  assert.equal((await t.admin('blockAccount', { uid: 'uEve' })).body.log.length, n, 'a repeat is a no-op');
  r = await t.admin('unblockAccount', { uid: 'uEve' });
  assert.deepEqual(r.body.accounts.map((a) => a.uid), ['uMallory', 'uNobodyKnows']);
  assert.equal(r.body.log[0].kind, 'unblockAccount');
  assert.equal((await t.me('eve')).body.state, 'ok');
  for (const uid of ['', 'a b', 'x'.repeat(129), '../x', 5, undefined, 'é']) {
    assert.equal((await t.admin('blockAccount', { uid })).body.code, 'bad-uid', String(uid));
    assert.equal((await t.admin('unblockAccount', { uid })).body.code, 'bad-uid');
  }
});

test('admin: add a person, then remove them; removing releases their claim', async () => {
  const t = ready();
  const nim = '09011282631050';
  let r = await t.admin('add', { nim, name: '  Rania   Az-Zahra  ' });
  assert.equal(r.status, 200);
  assert.deepEqual(row(r, nim), { nim, name: 'Rania Az-Zahra', added: true, blocked: false, claim: null });
  assert.deepEqual(r.body.counts, { people: 8, claimed: 0, blocked: 1 });
  assert.deepEqual(t.store.doc('config').add, [{ nim, name: 'Rania Az-Zahra', at: new Date(T0).toISOString(), by: 'admin.kelas@gmail.com' }]);
  assert.deepEqual(r.body.log[0], { at: new Date(T0).toISOString(), kind: 'add', nim, by: 'admin.kelas@gmail.com' });
  assert.deepEqual((await t.claim('eve', nim)).body, { preview: 'Rania Az-Zahra' });
  assert.equal((await t.claim('eve', nim, true)).body.who.name, 'Rania Az-Zahra');
  assert.equal((await t.admin('add', { nim, name: 'Lagi' })).body.code, 'exists');
  assert.equal((await t.admin('add', { nim: DIMAS, name: 'Dimas' })).status, 409);

  r = await t.admin('remove', { nim });
  assert.equal(row(r, nim), undefined);
  assert.deepEqual(t.store.doc('config').add, []);
  assert.equal(t.store.doc('claims').nim[nim], undefined, 'claim released');
  assert.deepEqual(r.body.log[0], { at: new Date(T0).toISOString(), kind: 'remove', nim, uid: 'uEve', email: 'eve.random@gmail.com', gname: 'Evelyn Tan', by: 'admin.kelas@gmail.com' });
  assert.equal((await t.me('eve')).body.state, 'claim');
  assert.equal((await t.claim('eve', nim, true)).status, 404, 'the removed NIM is gone');
  assert.equal((await t.admin('remove', { nim })).status, 404);

  // a person on the class list is hidden, not deleted, and adding the NIM again brings them back
  await t.claim('dimas', DIMAS, true);
  r = await t.admin('remove', { nim: DIMAS });
  assert.equal(row(r, DIMAS), undefined);
  assert.deepEqual(t.store.doc('config').drop, [DIMAS]);
  assert.equal((await t.me('dimas')).body.state, 'claim');
  assert.equal((await t.claim('dimas', DIMAS)).status, 404);
  r = await t.admin('add', { nim: DIMAS, name: 'Dimas Saja' });
  assert.deepEqual(row(r, DIMAS), { nim: DIMAS, name: 'DIMAS PRATAMA SAPUTRA', blocked: false, claim: null });
  assert.deepEqual(t.store.doc('config').drop, []);
  assert.equal((await t.claim('dimas', DIMAS, true)).body.state, 'ok');
});

test('a remove that fails half way is finished by trying again', async () => {
  const t = ready();
  await t.claim('eve', DIMAS, true);
  await t.admin('block', { nim: SITI });
  for (let i = 0; i < 5; i++) t.store.race('config');
  const r = await t.admin('remove', { nim: DIMAS });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'busy');
  assert.equal(t.store.doc('claims').nim[DIMAS], undefined, 'the claim went first');
  const again = await t.admin('remove', { nim: DIMAS });
  assert.equal(again.status, 200);
  assert.equal(row(again, DIMAS), undefined);
});

test('the log keeps the newest 200 events', async () => {
  const t = ready();
  const old = Array.from({ length: 200 }, (_, i) => ({ at: new Date(T0 - (i + 1) * 1000).toISOString(), kind: 'block', nim: DIMAS, by: 'x@gmail.com' }));
  t.store.raw('log', { v: 1, ev: old });
  await t.admin('block', { nim: SITI });
  const ev = t.store.doc('log').ev;
  assert.equal(ev.length, 200);
  assert.deepEqual([ev[0].kind, ev[0].nim], ['block', SITI]);
  assert.deepEqual(ev[199], old[198], 'the oldest one dropped');
  t.store.raw('log', 'not json at all');
  await t.admin('unblock', { nim: SITI });
  assert.deepEqual(t.store.doc('log').ev.map((e) => e.kind), ['unblock'], 'a broken log starts over instead of failing');
});

test('admin: add and remove validation', async () => {
  const t = ready();
  for (const name of ['A', 'x'.repeat(81), 'Budi<script>', 'Budi2', '--', "''", '. .', 'Budi\nSantoso', 42, undefined, '']) {
    const r = await t.admin('add', { nim: '09011282631060', name });
    assert.equal(r.status, 400, JSON.stringify(name));
    assert.equal(r.body.code, 'bad-name');
  }
  assert.equal((await t.admin('add', { nim: '123', name: 'Budi Santoso' })).body.code, 'bad-nim');
  assert.equal((await t.admin('add', { nim: '09011282631060', name: "Nur’aini O'Neil-Putri" })).status, 200);
  assert.equal(row(await t.view(), '09011282631060').name, "Nur'aini O'Neil-Putri");
  assert.equal((await t.admin('add', { nim: '09011282631061', name: 'Élodie Ñúñez' })).status, 200, 'letters with accents are letters');
  assert.equal((await t.admin('remove', { nim: '09011282639999' })).body.code, 'not-found');
  assert.equal((await t.admin('remove', { nim: 'abc' })).body.code, 'bad-nim');
});

test('admin: unknown ops and malformed bodies', async () => {
  const t = ready();
  for (const op of ['drop', '__proto__', 'constructor', 'toString', '', 5, undefined, 'BLOCK']) {
    const r = await t.admin(op, { nim: DIMAS });
    assert.equal(r.status, 400, String(op));
    assert.equal(r.body.code, 'bad-op');
  }
  for (const raw of ['null', '[]', '"block"', '{', 'x', '\xff']) {
    const r = await t.call('POST', '/api/cbt/admin', { as: 'admin', raw });
    assert.equal(r.status, 400, raw);
    assert.equal(r.body.code, 'bad-json');
  }
  assert.equal(t.store.doc('config'), null);
});

test('admin ops other than install wait for the secret', async () => {
  const t = setup();
  const v = await t.view();
  assert.deepEqual(v.body, { ready: false, source: null, people: [], accounts: [], log: [], counts: { people: 0, claimed: 0, blocked: 0 } });
  for (const [op, args] of [['block', { nim: DIMAS }], ['add', { nim: '09011282631060', name: 'Budi Santoso' }], ['blockAccount', { uid: 'uEve' }], ['release', { nim: DIMAS }]]) {
    const r = await t.admin(op, args);
    assert.equal(r.status, 409, op);
    assert.equal(r.body.code, 'setup');
  }
});

test('install: only the right secret, only once, and an environment secret wins', async () => {
  const t = setup();
  assert.equal((await t.me('dimas')).body.state, 'setup');
  for (const secret of ['', 'short', SECRET + 'x', 5, undefined]) {
    const r = await t.admin('install', { secret });
    assert.equal(r.status, 400, String(secret));
    assert.equal(r.body.code, 'bad-secret');
  }
  const wrong = await t.admin('install', { secret: OTHER });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'bad-secret');
  assert.equal(t.store.m.has('secret'), false);
  const ok = await t.admin('install', { secret: SECRET });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ready, true);
  assert.equal(ok.body.source, 'blobs');
  assert.equal(ok.body.people.length, PEOPLE.length);
  assert.deepEqual(ok.body.log[0], { at: new Date(T0).toISOString(), kind: 'install', by: 'admin.kelas@gmail.com' });
  assert.equal(ok.text.includes(SECRET), false, 'the secret is not echoed');
  assert.equal(JSON.stringify(t.store.doc('log')).includes(SECRET), false, 'nor logged');
  assert.equal(t.store.m.get('secret').data, SECRET);
  assert.equal((await t.me('dimas')).body.state, 'claim', 'at once, no 30 s wait on this instance');
  assert.equal((await t.admin('install', { secret: SECRET })).status, 409);
  assert.equal((await t.admin('install', { secret: OTHER })).body.code, 'exists');

  // another instance finds the installed secret
  const other = setup({ store: t.store });
  assert.equal((await other.me('dimas')).body.state, 'claim');
  assert.equal((await other.view()).body.source, 'blobs');

  // with CBT_SECRET set, install is refused and the environment wins over Blobs
  const e = setup({ env: { CBT_SECRET: SECRET }, blobsSecret: OTHER });
  assert.equal((await e.admin('install', { secret: SECRET })).status, 409);
  assert.equal((await e.view()).body.source, 'env');
  assert.equal(e.store.m.get('secret').data, OTHER, 'untouched');
  assert.deepEqual(e.errors, [], 'the Blobs secret is never even read');
});

test('install replaces an installed secret that no longer opens the class list, and two installs race safely', async () => {
  const t = setup({ blobsSecret: OTHER });
  assert.equal((await t.me('dimas')).body.state, 'setup');
  assert.equal((await t.admin('install', { secret: SECRET })).status, 200);
  assert.equal(t.store.m.get('secret').data, SECRET);

  const s = new FakeStore();
  const a = setup({ store: s });
  const b = setup({ store: s });
  const rs = await Promise.all([a.admin('install', { secret: SECRET }), b.admin('install', { secret: SECRET })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
});

test('a secret installed elsewhere is noticed within 30 s, not on every request', async () => {
  const t = setup();
  let reads = 0;
  const get = t.store.get.bind(t.store);
  t.store.get = (...a) => (reads++, get(...a));
  assert.equal((await t.me('dimas')).body.state, 'setup');
  t.store.raw('secret', SECRET);
  assert.equal((await t.me('dimas')).body.state, 'setup');
  assert.equal(reads, 1);
  t.clock.t += 30_001;
  assert.equal((await t.me('dimas')).body.state, 'claim');
  assert.equal(reads, 2);
  t.clock.t += 60_000;
  await t.me('dimas');
  assert.equal(reads, 2, 'found once, kept');
});

// ---------- the edges of every request

test('rate limits per account: claim 12, me 120, admin 240 per 10 minutes', async () => {
  const t = ready();
  for (let i = 0; i < 12; i++) assert.equal((await t.claim('eve', DIMAS)).status, 200);
  const slow = await t.claim('eve', DIMAS);
  assert.equal(slow.status, 429);
  assert.equal(slow.body.code, 'slow');
  assert.equal(slow.headers.get('retry-after'), '600');
  assert.equal((await t.claim('dimas', DIMAS)).status, 200, 'per account');
  assert.equal((await t.me('eve')).status, 200, 'per endpoint');
  t.clock.t += 5 * 60_000;
  assert.equal((await t.claim('eve', DIMAS)).headers.get('retry-after'), '300');
  t.clock.t += 5 * 60_000 + 1;
  assert.equal((await t.claim('eve', DIMAS)).status, 200);

  for (let i = 1; i < 120; i++) await t.me('siti');
  assert.equal((await t.me('siti')).status, 200);
  assert.equal((await t.me('siti')).status, 429);
  for (let i = 0; i < 240; i++) await t.view();
  const a = await t.view();
  assert.equal(a.status, 429);
  assert.equal(a.body.code, 'slow');
});

test('POSTs from another origin are refused; method and path are checked', async () => {
  const t = ready();
  for (const origin of ['https://evil.example', 'null', 'http://alphangers.test', 'https://alphangers.test.evil.example']) {
    const r = await t.call('POST', '/api/cbt/claim', { as: 'dimas', body: { nim: DIMAS, confirm: true }, origin });
    assert.equal(r.status, 403, origin);
    assert.equal(r.body.code, 'origin');
    assert.equal((await t.call('POST', '/api/cbt/admin', { as: 'admin', body: { op: 'block', nim: DIMAS }, origin })).status, 403);
  }
  assert.equal(t.store.doc('claims'), null);
  assert.equal((await t.call('POST', '/api/cbt/claim', { as: 'dimas', body: { nim: DIMAS }, origin: '' })).status, 200, 'no Origin: not a browser, the token still decides');
  const m = await t.call('POST', '/api/cbt/me', { as: 'dimas', body: {} });
  assert.equal(m.status, 405);
  assert.equal(m.headers.get('allow'), 'GET');
  assert.equal((await t.call('GET', '/api/cbt/claim', { as: 'dimas' })).status, 405);
  assert.equal((await t.call('DELETE', '/api/cbt/admin', { as: 'admin' })).status, 405);
  assert.equal((await t.call('GET', '/api/cbt/other', { as: 'dimas' })).status, 404);
});

test('bodies over 4 KB are refused before they are read in full', async () => {
  const t = ready();
  const big = JSON.stringify({ nim: DIMAS, pad: 'x'.repeat(5000) });
  const r = await t.call('POST', '/api/cbt/claim', { as: 'dimas', raw: big });
  assert.equal(r.status, 413);
  assert.equal(r.body.code, 'too-big');
  const declared = await t.call('POST', '/api/cbt/claim', { as: 'dimas', raw: '{}', headers: { 'content-length': '999999' } }).catch(() => null);
  if (declared) assert.equal(declared.status, 413);
  // streamed without a length
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(1000).fill(32)); c.close(); } });
  const res = await t.cbt(new Request(ORIGIN + '/api/cbt/claim', { method: 'POST', headers: { authorization: 'Bearer dimas', origin: ORIGIN }, body: stream, duplex: 'half' }));
  assert.equal(res.status, 413);
  const fine = JSON.stringify({ nim: DIMAS, confirm: false, note: 'y'.repeat(3900) });
  assert.equal((await t.call('POST', '/api/cbt/claim', { as: 'dimas', raw: fine })).status, 200);
});

test('every error is an Indonesian sentence with a code, and no student-facing text says blocked', async () => {
  const t = ready();
  const rs = [await t.call('GET', '/api/cbt/me'), await t.claim('eve', '1'), await t.claim('eve', '09011282639999'), await t.call('POST', '/api/cbt/claim', { as: 'eve', raw: '[' })];
  await t.claim('dimas', DIMAS, true);
  rs.push(await t.claim('eve', DIMAS));
  for (const r of rs) {
    assert.equal(typeof r.body.code, 'string');
    assert.ok(r.body.error.length > 10, r.body.error);
    assert.doesNotMatch(r.body.error, /blokir|banned|pelanggaran/i);
  }
});

// ---------- names

test('display names: the class list name written out in full, in title case', () => {
  const cases = {
    'DIMAS PRATAMA SAPUTRA': 'Dimas Pratama Saputra',
    'M. FARHAN ALFARIZQI': 'M. Farhan Alfarizqi',
    'MOCH. ILHAM': 'Moch. Ilham',
    'MUHAMMAD AL FATIH': 'Muhammad Al Fatih',
    "NUR'AINI SALSABILA": "Nur'aini Salsabila",
    "SITI NUR 'AINI": "Siti Nur 'Aini",
    'SRI-WAHYUNI PUTRI': 'Sri-Wahyuni Putri',
    'M.FARID': 'M.Farid',
    'I GUSTI AYU MADE SARI': 'I Gusti Ayu Made Sari',
    '  NAUFAL   HAKIM ': 'Naufal Hakim',
    'Rania Az-Zahra': 'Rania Az-Zahra',
    'Gita ayu Lestari': 'Gita ayu Lestari',
    '': '',
  };
  for (const [full, shown] of Object.entries(cases)) assert.equal(displayName(full), shown, full);
});

test('match: how much a Google account looks like the person it claimed', () => {
  const p = (nim, name) => ({ nim, name });
  const c = (email, gname) => ({ email, gname });
  const cases = [
    [p('09011282631002', 'M. FARHAN ALFARIZQI'), c('09011282631002@student.example.ac.id', 'Siapa Saja'), 'nim'],
    [p('09011282631001', 'DIMAS PRATAMA SAPUTRA'), c('x@gmail.com', 'Dimas Pratama'), 'name'],
    [p('09011282631001', 'DIMAS PRATAMA SAPUTRA'), c('x@gmail.com', 'dimas  P.  Saputra'), 'name'],
    [p('09011282631001', 'DIMAS PRATAMA SAPUTRA'), c('x@gmail.com', 'Dr. Dimás Pratama, S.Ked'), 'name'],
    [p('09011282631002', 'M. FARHAN ALFARIZQI'), c('x@gmail.com', 'Muhammad Farhan'), 'name'],
    [p('09011282631004', 'MUHAMMAD RIZKY AKBAR'), c('x@gmail.com', 'Mochammad Rizky'), 'name'],
    [p('09011282631004', 'MUHAMMAD RIZKY AKBAR'), c('x@gmail.com', 'M Rizky'), 'name'],
    [p('09011282631004', 'MUHAMMAD RIZKY AKBAR'), c('rizky.akbar21@gmail.com', 'Kiki'), 'name'],
    [p('09011282631004', 'MUHAMMAD RIZKY AKBAR'), c('x@gmail.com', 'Muhammad Fauzan'), 'none'],
    [p('09011282631004', 'MUHAMMAD RIZKY AKBAR'), c('x@gmail.com', 'Muhammad'), 'none'],
    [p('09011282631004', 'MUHAMMAD RIZKY AKBAR'), c('x@gmail.com', 'Rizky Ramadhan'), 'partial'],
    [p('09011282631003', 'SITI NUR HALIZAH'), c('halizah99@gmail.com', 'Ica'), 'partial'],
    [p('09011282631001', 'DIMAS PRATAMA SAPUTRA'), c('dimas.saputra@gmail.com', ''), 'name'],
    [p('09011282631001', 'DIMAS PRATAMA SAPUTRA'), c('eve@gmail.com', 'Evelyn Tan'), 'none'],
    [p('09011282631001', 'DIMAS PRATAMA SAPUTRA'), c('', ''), 'none'],
    [p('09011282631006', 'NAUFAL HAKIM'), c('x@gmail.com', 'Naufal H'), 'name'],
    [p('09011282631006', 'NAUFAL HAKIM'), c('x@gmail.com', 'N.'), 'none'],
    [p('09011282631006', 'NAUFAL HAKIM'), c('kalimantan@gmail.com', 'Ali'), 'none'],
  ];
  for (const [person, claim, want] of cases) assert.equal(matchClaim(person, claim), want, `${person.name} / ${claim.gname} / ${claim.email}`);
});

test('names an admin types are tidied and checked', () => {
  assert.equal(cleanName('  budi   santoso '), 'budi santoso');
  assert.equal(cleanName('Nur’aini'), "Nur'aini");
  for (const bad of ['B', 'Budi 2', 'Budi_S', '<b>', '-Budi', 'x'.repeat(81), null]) assert.equal(cleanName(bad), null, String(bad));
});

// ---------- the seal script, end to end in a temporary folder

const SCRIPT = fileURLToPath(new URL('../scripts/cbt/seal.mjs', import.meta.url));
const WEBP = Uint8Array.from([...Buffer.from('RIFF'), 30, 0, 0, 0, ...Buffer.from('WEBPVP8L'), 17, 0, 0, 0, 0x2f, 3, 0x80, 2, 0, 7, 0x10, 0x11, 0x88, 0x88, 0xfe, 7, 0, 1, 2, 3, 4, 0]);
const PIC = { id: 'i01', f: 'img/b3/i01.webp', w: 4, h: 3, type: 'image/webp' };
const SECRET_TEXT = [
  'Ikatan kovalen terbentuk karena berbagi apa', 'Elektron valensi', 'Atom berbagi pasangan elektron', 'Tekanan osmotik bergantung pada partikel',
  'Sifat koligatif larutan', 'Organel penghasil ATP terbanyak adalah', 'Mitokondria', 'Fosforilasi oksidatif', 'Epitel selapis gepeng melapisi',
  'Dua jawaban diterima', 'Kimia dasar', 'Sel dan organel', 'Buku ajar histologi', 'example.org/histologi',
];
function privateDir(change = (x) => x) {
  const files = {
    roster: { v: 1, cls: 'Alpha', source: 'absen.xlsx', people: structuredClone(PEOPLE.slice(0, 3)).concat([{ nim: ANIN, name: 'ANINDYA PUTRI KIRANA', blocked: true }]) },
    b2: {
      id: 'b2', name: 'Blok 2', title: 'Kimia dan Fisika Kehidupan', sem: 'Semester 1',
      topics: { kim: 'Kimia dasar', fis: 'Biofisika' },
      q: [
        { id: 'a1', src: 'latihan 1', t: 'mc', tp: 'kim', q: 'Ikatan kovalen terbentuk karena berbagi apa?', o: ['Elektron valensi', 'Proton', 'Neutron', 'Foton'], a: [0], e: 'Atom berbagi pasangan elektron.' },
        { id: 'a2', t: 'tf', tp: 'fis', q: 'Tekanan osmotik bergantung pada partikel terlarut.', o: ['Benar', 'Salah'], a: [0], e: 'Sifat koligatif larutan.', ns: 1 },
      ],
    },
    b3: {
      id: 'b3', kv: 2, new: true, name: 'Blok 3', title: 'Karakter Biologi Tubuh Manusia', sem: 'Semester 1', by: 'Batu Alphangers',
      refs: [{ name: 'Buku ajar histologi', url: 'https://example.org/histologi' }],
      topics: { sel: 'Sel dan organel', jar: 'Jaringan', gen: 'Genetika' },
      q: [
        { id: 'q001', t: 'mc', tp: 'sel', q: 'Organel penghasil ATP terbanyak adalah\n\npilih satu.', o: ['Mitokondria', 'Ribosom', 'Lisosom', 'Golgi', 'Nukleolus'], a: [0], e: 'Fosforilasi oksidatif.', img: [{ ...PIC }] },
        { id: 'q002', t: 'mc', tp: 'jar', q: 'Epitel selapis gepeng melapisi', o: ['Alveolus', 'Kulit', 'Esofagus', 'Kandung kemih'], a: [0, 3], e: 'Difusi.', n: 'Dua jawaban diterima.', ei: [{ ...PIC, f: '' }] },
      ],
    },
  };
  change(files);
  const dir = mkdtempSync(join(tmpdir(), 'cbt-private-'));
  mkdirSync(join(dir, 'banks'));
  mkdirSync(join(dir, 'img/b3'), { recursive: true });
  writeFileSync(join(dir, 'roster.json'), JSON.stringify(files.roster));
  for (const [id, bank] of Object.entries(files)) if (id !== 'roster' && bank) writeFileSync(join(dir, `banks/${id}.json`), JSON.stringify(bank, null, 2));
  writeFileSync(join(dir, 'img/b3/i01.webp'), WEBP);
  writeFileSync(join(dir, 'img/b3/i02.webp'), WEBP);
  writeFileSync(join(dir, 'secret.txt'), SECRET + '\n');
  return dir;
}
function sealRun(dir, out, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, '--private', dir, '--out', out], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  return { code: r.status, text: r.stdout + r.stderr };
}
function snapshot(out) {
  const files = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files[p.slice(out.length + 1)] = { bytes: readFileSync(p), mtime: statSync(p).mtimeMs };
    }
  };
  walk(out);
  return files;
}

test('the seal script writes sealed banks and pictures, the public manifest and the function data', async () => {
  const dir = privateDir();
  writeFileSync(join(dir, 'banks/b3-topics.json'), JSON.stringify({ v: 1, bank: 'b3', note: 'working file' }));
  writeFileSync(join(dir, 'banks/CONVERSION.md'), 'notes');
  const out = mkdtempSync(join(tmpdir(), 'cbt-out-'));
  const r = sealRun(dir, out);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /banks\/b3-topics\.json: .*skipped/, 'other JSON in banks/ is named and skipped');
  const m = fromB64u(SECRET);
  for (const [id, kv] of [['b2', 1], ['b3', 2]]) assert.equal(r.text.includes(toB64u(await derive(m, LABEL.bankKey(id, kv)))), false, 'no key printed');
  assert.equal(r.text.includes(SECRET), false, 'no secret printed');

  const names = readdirSync(join(out, 'public/cbt')).sort();
  assert.equal(names.length, 3);
  const b2 = names.find((n) => n.startsWith('b2.'));
  const b3 = names.find((n) => n.startsWith('b3.'));
  const pic = names.find((n) => n.startsWith('b3-'));
  assert.match(b2, /^b2\.[0-9a-f]{10}\.bin$/);
  assert.match(b3, /^b3\.[0-9a-f]{10}\.bin$/);
  assert.match(pic, /^b3-i01\.[0-9a-f]{10}\.bin$/);
  const file = (n) => new Uint8Array(readFileSync(join(out, 'public/cbt', n)));
  for (const n of names) assert.equal(n.split('.')[1], await hashHex(file(n)), 'named by the hash of its bytes');

  const manifest = JSON.parse(readFileSync(join(out, 'src/data/cbt.json'), 'utf8'));
  assert.deepEqual(manifest, {
    v: 1,
    banks: [
      { id: 'b2', kv: 1, name: 'Blok 2', title: 'Kimia dan Fisika Kehidupan', sem: 'Semester 1', n: 2, topics: 2, file: '/cbt/' + b2, bytes: file(b2).length },
      { id: 'b3', kv: 2, name: 'Blok 3', title: 'Karakter Biologi Tubuh Manusia', sem: 'Semester 1', n: 2, topics: 3, file: '/cbt/' + b3, bytes: file(b3).length, by: 'Batu Alphangers', new: true },
    ],
  });

  const data = await import(pathToFileURL(join(out, 'netlify/data/cbt.mjs')).href);
  assert.deepEqual(data.BANKS, [{ id: 'b2', kv: 1 }, { id: 'b3', kv: 2 }]);
  const roster = await openJson(await derive(m, LABEL.rosterKey), fromB64u(data.ROSTER), LABEL.rosterAad);
  assert.deepEqual(roster, { v: 1, people: [...PEOPLE.slice(0, 3), { nim: ANIN, name: 'ANINDYA PUTRI KIRANA', blocked: true }] });

  const key = await derive(m, LABEL.bankKey('b3', 2));
  const bank = await openJson(key, file(b3), LABEL.bankAad('b3', 2));
  assert.equal('kv' in bank || 'new' in bank, false, 'build settings stay out of the bank');
  assert.equal(bank.q[0].q, 'Organel penghasil ATP terbanyak adalah\n\npilih satu.');
  assert.deepEqual(bank.q[0].img, [{ ...PIC, f: '/cbt/' + pic }]);
  assert.deepEqual(bank.q[1].ei, [{ ...PIC, f: '/cbt/' + pic }], 'an empty path finds img/<bank>/<id>.<ext>');
  assert.deepEqual(await open(key, file(pic), LABEL.imgAad('b3', 2, 'i01')), WEBP);
  await assert.rejects(openJson(await derive(m, LABEL.bankKey('b3', 1)), file(b3), LABEL.bankAad('b3', 1)), SealError, 'only kv 2 opens it');
  assert.equal((await openJson(await derive(m, LABEL.bankKey('b2', 1)), file(b2), LABEL.bankAad('b2', 1))).q.length, 2);

  // nothing readable anywhere in the output
  const all = Object.values(snapshot(out)).map((f) => f.bytes.toString('latin1')).join('\n');
  for (const s of [...SECRET_TEXT, ...PEOPLE.slice(0, 3).flatMap((p) => [p.name, p.nim]), SECRET]) assert.equal(all.includes(s), false, s);

  // and the server, given what the script wrote, hands out keys that open those files
  const t = setup({ env: { CBT_SECRET: SECRET }, roster: data.ROSTER, banks: data.BANKS });
  await t.claim('dimas', DIMAS, true);
  const me = (await t.me('dimas')).body;
  assert.equal(me.state, 'ok');
  assert.equal((await openJson(fromB64u(me.keys.b3.k), file(b3), LABEL.bankAad('b3', me.keys.b3.kv))).id, 'b3');
  assert.equal((await t.claim('anin', ANIN, true)).body.state, 'closed', 'blocked rows come through');
  rmSync(dir, { recursive: true });
  rmSync(out, { recursive: true });
});

test('the seal script is deterministic and removes the sealed files it no longer uses', () => {
  const dir = privateDir();
  const out = mkdtempSync(join(tmpdir(), 'cbt-out-'));
  assert.equal(sealRun(dir, out).code, 0);
  const first = snapshot(out);
  const again = sealRun(dir, out, { CBT_SECRET: SECRET });
  assert.equal(again.code, 0, again.text);
  assert.deepEqual(snapshot(out), first, 'same bytes, files not even rewritten');

  writeFileSync(join(out, 'public/cbt/b9.0123456789.bin'), 'old');
  writeFileSync(join(out, 'public/cbt/b3-i02.abcdefabcd.bin'), 'old');
  writeFileSync(join(out, 'public/cbt/README.txt'), 'keep me');
  const third = sealRun(dir, out);
  assert.equal(third.code, 0);
  const names = readdirSync(join(out, 'public/cbt'));
  assert.equal(names.includes('b9.0123456789.bin'), false);
  assert.equal(names.includes('b3-i02.abcdefabcd.bin'), false);
  assert.equal(names.includes('README.txt'), true, 'only files it could have written are deleted');

  // a new key version and one bank fewer: new names, the old files go
  rmSync(join(dir, 'banks/b2.json'));
  const b3 = JSON.parse(readFileSync(join(dir, 'banks/b3.json'), 'utf8'));
  writeFileSync(join(dir, 'banks/b3.json'), JSON.stringify({ ...b3, kv: 3 }));
  assert.equal(sealRun(dir, out).code, 0);
  const left = readdirSync(join(out, 'public/cbt')).filter((n) => n.endsWith('.bin')).sort();
  assert.equal(left.length, 2);
  for (const n of left) assert.equal(Object.hasOwn(first, 'public/cbt/' + n), false, n);
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'src/data/cbt.json'), 'utf8')).banks.map((b) => [b.id, b.kv]), [['b3', 3]]);
  rmSync(dir, { recursive: true });
  rmSync(out, { recursive: true });

  // banks in the order of their ids, numbers by value
  const ten = privateDir();
  writeFileSync(join(ten, 'banks/b10.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(ten, 'banks/b2.json'), 'utf8')), id: 'b10' }));
  const o10 = mkdtempSync(join(tmpdir(), 'cbt-out-'));
  assert.equal(sealRun(ten, o10).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(o10, 'src/data/cbt.json'), 'utf8')).banks.map((b) => b.id), ['b2', 'b3', 'b10']);
  assert.match(readFileSync(join(o10, 'netlify/data/cbt.mjs'), 'utf8'), /BANKS = \[\{ id: 'b2', kv: 1 \}, \{ id: 'b3', kv: 2 \}, \{ id: 'b10', kv: 1 \}\];/);
  rmSync(ten, { recursive: true });
  rmSync(o10, { recursive: true });
});

test('the seal script lists a bank under its kind of try out, and an explanation is optional', async () => {
  const dir = privateDir((f) => {
    f.b3.kind = 'tryout';
    f.o3 = {
      id: 'o3', kind: 'ospe', name: 'Blok 3', title: 'Karakter Biologi Tubuh Manusia', sem: 'Semester 1', by: 'Praktikum Alphangers',
      topics: { sel: 'Morfologi sel' },
      q: [{ id: 'd1-03', t: 'mc', tp: 'sel', q: 'Epitel pada alveolus paru-paru adalah', o: ['Kubus selapis', 'Silindris selapis', 'Pipih selapis', 'Transisional'], a: [2] }],
    };
  });
  const out = mkdtempSync(join(tmpdir(), 'cbt-out-'));
  const r = sealRun(dir, out);
  assert.equal(r.code, 0, r.text);
  const manifest = JSON.parse(readFileSync(join(out, 'src/data/cbt.json'), 'utf8'));
  assert.deepEqual(manifest.banks.map((b) => [b.id, b.kind]), [['b2', undefined], ['b3', undefined], ['o3', 'ospe']], 'the default kind is not written');
  const data = await import(pathToFileURL(join(out, 'netlify/data/cbt.mjs')).href);
  assert.deepEqual(data.BANKS, [{ id: 'b2', kv: 1 }, { id: 'b3', kv: 2 }, { id: 'o3', kv: 1 }], 'the server hands out its key like any other');
  const o3 = manifest.banks[2];
  const bank = await openJson(await derive(fromB64u(SECRET), LABEL.bankKey('o3', 1)), new Uint8Array(readFileSync(join(out, 'public', o3.file))), LABEL.bankAad('o3', 1));
  assert.equal('kind' in bank, false, 'the kind stays out of the bank');
  assert.equal('e' in bank.q[0], false);
  assert.equal(bank.q[0].a[0], 2);
  rmSync(dir, { recursive: true });
  rmSync(out, { recursive: true });
});

test('the seal script refuses bad input and then writes nothing', () => {
  const q = (f, i = 0) => f.b3.q[i];
  const cases = {
    'answer out of range': (f) => (q(f).a = [5]),
    'repeated answer': (f) => (q(f).a = [0, 0]),
    'no answer': (f) => (q(f).a = []),
    'unknown topic': (f) => (q(f).tp = 'nope'),
    'repeated question id': (f) => (q(f, 1).id = 'q001'),
    'three options': (f) => (q(f).o = ['a', 'b', 'c']),
    'true/false with three': (f) => (f.b2.q[1].o = ['Benar', 'Salah', 'Mungkin']),
    'empty option': (f) => (q(f).o[2] = ' '),
    'unknown type': (f) => (q(f).t = 'essay'),
    'unknown kind of try out': (f) => (f.b3.kind = 'osce'),
    'unknown field': (f) => (q(f).jawaban = 'A'),
    'missing picture': (f) => (q(f).img[0].f = 'img/b3/none.webp'),
    'picture outside the folder': (f) => (q(f).img[0].f = '../secret.txt'),
    'dot dot inside the path': (f) => (q(f).img[0].f = 'img/b3/../b3/i01.webp'),
    'absolute picture path': (f) => (q(f).img[0].f = '/etc/hostname'),
    'picture of another type': (f) => (q(f).img[0].type = 'image/png'),
    'bad picture id': (f) => (q(f).img[0].id = 'I-01'),
    'one picture id, two files': (f) => (q(f, 1).ei[0] = { ...PIC, f: 'img/b3/i02.webp' }),
    'http reference': (f) => (f.b3.refs[0].url = 'http://example.org/x'),
    'script reference': (f) => (f.b3.refs[0].url = 'javascript:alert(1)'),
    'id unlike the file name': (f) => (f.b3.id = 'b4'),
    'bad kv': (f) => (f.b3.kv = 0),
    'bad topic key': (f) => (f.b3.topics = { 'Sel Organel': 'x' }),
    'no title': (f) => delete f.b3.title,
    'bidi override in a stem': (f) => (q(f).q = 'abc\u202edef'),
    'repeated NIM': (f) => (f.roster.people[1].nim = f.roster.people[0].nim),
    'NIM with letters': (f) => (f.roster.people[0].nim = '0901128263100X'),
    'name with digits': (f) => (f.roster.people[0].name = 'DIMAS 2'),
    'blocked not a boolean': (f) => (f.roster.people[0].blocked = 'ya'),
    'a field the class list does not have': (f) => (f.roster.people[0].grp = 'A1'),
    'no people': (f) => (f.roster.people = []),
  };
  const before = JSON.stringify(PEOPLE);
  for (const [name, change] of Object.entries(cases)) {
    const dir = privateDir(change);
    const out = mkdtempSync(join(tmpdir(), 'cbt-out-'));
    const r = sealRun(dir, out);
    assert.notEqual(r.code, 0, name);
    assert.match(r.text, /b2|b3|roster/, name + ': says where: ' + r.text);
    assert.deepEqual(readdirSync(out), [], name + ': nothing written');
    rmSync(dir, { recursive: true });
    rmSync(out, { recursive: true });
  }
  assert.equal(JSON.stringify(PEOPLE), before, 'the cases changed copies only');
  const dir = privateDir();
  const out = mkdtempSync(join(tmpdir(), 'cbt-out-'));
  writeFileSync(join(dir, 'secret.txt'), 'not-a-secret');
  const bad = sealRun(dir, out);
  assert.notEqual(bad.code, 0);
  assert.equal(bad.text.includes('not-a-secret'), false, 'a bad secret is not echoed either');
  const within = sealRun(dir, dir, { CBT_SECRET: SECRET });
  assert.notEqual(within.code, 0, 'the private folder may not be inside the output');
  assert.match(within.text, /outside the output/);
  assert.notEqual(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status, 0, 'usage without --private');
  rmSync(dir, { recursive: true });
  rmSync(out, { recursive: true });
});

// ---------- the function itself, with the data module in the repository

test('the data module and the public bank list agree', async () => {
  const data = await import('../netlify/data/cbt.mjs');
  const { default: manifest } = await import('../src/data/cbt.json', { with: { type: 'json' } });
  assert.deepEqual(data.BANKS, manifest.banks.map((b) => ({ id: b.id, kv: b.kv })), 'every bank the page lists has a key the server can hand out');
  if (!data.ROSTER) return assert.deepEqual(data.BANKS, [], 'the placeholder has neither a class list nor banks');
  const sealed = fromB64u(data.ROSTER);
  assert.equal(sealed[0], 1, 'a sealed class list');
  assert.ok(sealed.length > 1000);
});

test('the function: config, a real token check, and setup while there is no class list', async () => {
  const fn = await import('../netlify/functions/cbt.mjs');
  assert.deepEqual(fn.config.path, ['/api/cbt/me', '/api/cbt/claim', '/api/cbt/admin']);
  assert.deepEqual(fn.config.method, ['GET', 'POST']);
  assert.deepEqual(fn.config.rateLimit, { windowLimit: 300, windowSize: 60, aggregateBy: ['ip', 'domain'] });
  const data = await import('../netlify/data/cbt.mjs');
  // with the generated class list the function needs Blobs, which only runs on Netlify
  const placeholder = data.ROSTER === '';

  // a Firebase ID token signed by a key Google "publishes" (the JWKS fetch is answered here)
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('securetoken@system.gserviceaccount.com')) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=3600' } });
    throw new Error('unexpected request to ' + url);
  };
  try {
    const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const claims = { aud: 'alphangers-1ba79', iss: 'https://securetoken.google.com/alphangers-1ba79', sub: 'uFn', iat: now - 10, exp: now + 3000, auth_time: now - 100, email: 'fn@gmail.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
    const head = b64u({ alg: 'RS256', kid: 'k1', typ: 'JWT' }) + '.' + b64u(claims);
    const token = head + '.' + createSign('RSA-SHA256').update(head).sign(privateKey).toString('base64url');
    const call = (path, init = {}) => fn.default(new Request(ORIGIN + path, { ...init, headers: { authorization: 'Bearer ' + token, ...init.headers } }));
    assert.equal((await fn.default(new Request(ORIGIN + '/api/cbt/me'))).status, 401);
    assert.equal((await call('/api/cbt/claim', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' })).status, 403);
    if (placeholder) {
      const me = await call('/api/cbt/me');
      assert.equal(me.status, 200);
      assert.deepEqual(await me.json(), { state: 'setup' }, 'no class list: setup, without asking Blobs');
      const claim = await call('/api/cbt/claim', { method: 'POST', headers: { origin: ORIGIN }, body: JSON.stringify({ nim: DIMAS, confirm: true }) });
      assert.deepEqual(await claim.json(), { state: 'setup' });
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
