// The try out's access module without a browser: the state machine, the cached keys, the
// hourly re-check, claims, sign-out, opening sealed banks and pictures, in-app browsers and the
// watermark text. Auth, the server and storage are small fakes; sealing is the real seal.js.
//   node --test tests/tryout-access.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccess, inApp, watermarkCss } from '../src/features/tryout/access.js';
import { derive, seal, LABEL, toB64u, parseSecret } from '../src/lib/seal.js';

const SECRET = parseSecret('0FBDA8R_Sb0sG6c56YmPo8pDvaVoFtX-6LGsqK-faK8');
const HOUR = 3600e3;
const T0 = Date.UTC(2026, 9, 21, 8, 0, 0);
const WHO = { name: 'Dina Ayu Pratiwi', nim: '04011999999001' };

const BANK = {
  id: 'b3', name: 'Blok 3', title: 'Karakter Biologi Tubuh Manusia', sem: 'Semester 1', topics: { sel: 'Sel' },
  q: [{ id: 'q1', t: 'mc', tp: 'sel', q: 'Organel penghasil ATP?', o: ['Ribosom', 'Mitokondria', 'Lisosom', 'Golgi'], a: [1], e: 'Mitokondria.',
    img: [{ id: 'i1', f: '/cbt/b3-i1.bin', w: 4, h: 3, type: 'image/png' }] }],
};
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

async function keyOf(id, kv = 1) { return derive(SECRET, LABEL.bankKey(id, kv)); }
async function files() {
  const k = await keyOf('b3'), iv = await derive(SECRET, LABEL.bankIv('b3', 1));
  return {
    '/cbt/b3.bin': await seal(k, iv, JSON.stringify(BANK), LABEL.bankAad('b3', 1)),
    '/cbt/b3-i1.bin': await seal(k, iv, PNG, LABEL.imgAad('b3', 1, 'i1')),
  };
}
const MANIFEST = { v: 1, banks: [
  { id: 'b2', kv: 1, name: 'Blok 2', title: 'Kimia dan Fisika Kehidupan', sem: 'Semester 1', n: 279, topics: 10, file: '/cbt/b2.bin', bytes: 10 },
  { id: 'b3', kv: 1, name: 'Blok 3', title: 'Karakter Biologi Tubuh Manusia', sem: 'Semester 1', n: 1, topics: 1, file: '/cbt/b3.bin', bytes: 10, by: 'Batu Alphangers', new: true },
] };

function memStore(init = {}) {
  const m = new Map(Object.entries(init));
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, String(v)), del: (k) => m.delete(k), map: m };
}

/** A server that answers like the spec; `me` and `claim` can be swapped per test. */
async function rig({ cache, online = true, me, claim, user = { uid: 'u1', email: 'dina@example.com' }, slowMe = 0, budget = 50 } = {}) {
  const blobs = await files();
  const keys = { b2: { kv: 1, k: toB64u(await keyOf('b2')) }, b3: { kv: 1, k: toB64u(await keyOf('b3')) } };
  const store = memStore(cache ? { 'alpha.cbt.v1': JSON.stringify(cache), 'alpha.to.v1.hist.b3': '[{"id":"r1"}]' } : { 'alpha.to.v1.hist.b3': '[{"id":"r1"}]' });
  const calls = { auth: 0, me: 0, claim: [], files: [], signOut: 0, signIn: 0, auths: [] };
  let clock = T0, net = online, signedIn = cache ? user : null;
  const okBody = () => ({ state: 'ok', who: WHO, keys, ttl: 604800 });
  const fakeAuth = {
    async user() { return signedIn && { ...signedIn, getIdToken: async () => 'tok-' + signedIn.uid }; },
    async signIn() { calls.signIn++; signedIn = user; return this.user(); },
    async finishRedirect() { return null; },
    async signOut() { calls.signOut++; signedIn = null; },
  };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  async function fetch(url, init = {}) {
    // offline: the server is out of reach, files still come from the service worker cache
    if (!net && url.startsWith('/api/')) throw new TypeError('Failed to fetch');
    if (url.startsWith('/api/')) calls.auths.push(init.headers?.authorization || init.headers?.Authorization);
    if (url === '/api/cbt/me') {
      calls.me++;
      if (slowMe) await new Promise((r) => setTimeout(r, slowMe));
      return me ? me(json, okBody) : json(200, okBody());
    }
    if (url === '/api/cbt/claim') {
      const body = JSON.parse(init.body);
      calls.claim.push(body);
      return claim ? claim(json, body, okBody) : json(200, body.confirm ? okBody() : { preview: 'Dina Ayu Pratiwi' });
    }
    calls.files.push(url);
    if (blobs[url]) return new Response(blobs[url], { status: 200 });
    return new Response('nope', { status: 404 });
  }
  const access = createAccess({
    manifest: MANIFEST, storage: store, fetch, budget,
    auth: async () => { calls.auth++; return fakeAuth; },
    now: () => clock, online: () => net, redirectPending: () => false,
  });
  return { access, store, calls, keys, setOnline: (v) => { net = v; }, tick: (ms) => { clock += ms; }, cached: () => JSON.parse(store.get('alpha.cbt.v1') || 'null') };
}
const fresh = (keys, extra = {}) => ({ uid: 'u1', who: WHO, keys, exp: T0 + 7 * 24 * HOUR, checked: T0 - 5 * 60e3, ...extra });

test('in-app browsers are recognised, normal browsers are not', () => {
  const yes = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.91',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.37.106]',
    'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.40.98;]',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.9.0',
    'Mozilla/5.0 (Linux; Android 13; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36 musical_ly_2023405030 JsSdk/1.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 TikTok 35.1.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.48',
    'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36',
  ];
  const no = [
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  ];
  for (const ua of yes) assert.equal(inApp(ua), true, ua);
  for (const ua of no) assert.equal(inApp(ua), false, ua);
});

test('signed out: opening a bank asks for sign-in and loads no Firebase', async () => {
  const r = await rig();
  assert.equal((await r.access.ensure('b3')).s, 'out');
  assert.equal(r.calls.auth, 0);
  assert.equal(r.calls.me, 0);
  assert.equal(r.access.account(), null);
});

test('signed out and offline: says a connection is needed, still no Firebase', async () => {
  const r = await rig({ online: false });
  const st = await r.access.ensure('b3');
  assert.deepEqual([st.s, st.code], ['error', 'offline']);
  assert.equal(r.calls.auth, 0);
});

test('sign in, then /me ok: keys cached with uid and expiry, the bank opens', async () => {
  const r = await rig();
  const st = await r.access.signIn();
  assert.equal(st.s, 'ok');
  assert.equal(r.calls.auths[0], 'Bearer tok-u1');
  const c = r.cached();
  assert.equal(c.uid, 'u1');
  assert.deepEqual(c.who, WHO);
  assert.deepEqual(Object.keys(c.keys).sort(), ['b2', 'b3']);
  assert.equal(c.exp, T0 + 604800 * 1000);
  assert.equal(c.checked, T0);
  assert.equal((await r.access.ensure('b3')).s, 'ok');
  assert.equal(r.access.bank('b3').q[0].o[1], 'Mitokondria');
  assert.equal(r.access.has('b3'), true);
  assert.deepEqual(r.access.account().who, WHO);
});

test('a fresh cached access opens offline without Firebase or the server', async () => {
  const r0 = await rig();
  const r = await rig({ cache: fresh(r0.keys), online: true });
  assert.equal((await r.access.ensure('b3')).s, 'ok');
  assert.equal(r.calls.auth, 0);
  assert.equal(r.calls.me, 0);
  assert.equal(r.access.bank('b3').title, 'Karakter Biologi Tubuh Manusia');
});

test('an hour later and online: re-checks once; closed wipes keys but not scores', async () => {
  const r0 = await rig();
  const r = await rig({ cache: fresh(r0.keys, { checked: T0 - 2 * HOUR }), me: (json) => json(200, { state: 'closed', who: WHO }) });
  const st = await r.access.ensure('b3');
  assert.equal(st.s, 'closed');
  assert.equal(r.calls.auth, 1);
  assert.equal(r.calls.me, 1);
  assert.deepEqual(r.cached().keys, {});
  assert.equal(r.access.has('b3'), false);
  assert.equal(r.access.bank('b3'), null);
  assert.equal(r.store.get('alpha.to.v1.hist.b3'), '[{"id":"r1"}]');
});

test('an hour later and offline: the cached keys still work, nothing is asked', async () => {
  const r0 = await rig();
  const r = await rig({ cache: fresh(r0.keys, { checked: T0 - 2 * HOUR }), online: false });
  assert.equal((await r.access.ensure('b3')).s, 'ok', 'the bank file comes from the service worker cache');
  assert.equal(r.calls.me, 0);
  assert.equal(r.calls.auth, 0);
});

test('expired keys and offline: needs a connection', async () => {
  const r0 = await rig();
  const r = await rig({ cache: fresh(r0.keys, { exp: T0 - 1000, checked: T0 - 8 * 24 * HOUR }), online: false });
  const st = await r.access.ensure('b3');
  assert.deepEqual([st.s, st.code], ['error', 'offline']);
});

test('re-check fails on the network: the unexpired cache is used', async () => {
  const r0 = await rig();
  const r = await rig({ cache: fresh(r0.keys, { checked: T0 - 2 * HOUR }), me: () => { throw new TypeError('Failed to fetch'); } });
  assert.equal((await r.access.ensure('b3')).s, 'ok');
  assert.equal(r.calls.me, 1);
});

test('a slow re-check does not hold the bank; a late "claim" answer still wipes the keys', async () => {
  const r0 = await rig();
  const r = await rig({ cache: fresh(r0.keys, { checked: T0 - 2 * HOUR }), slowMe: 200, budget: 20, me: (json) => json(200, { state: 'claim' }) });
  const seen = [];
  r.access.onChange((st) => seen.push(st.s));
  assert.equal((await r.access.ensure('b3')).s, 'ok');
  await new Promise((res) => setTimeout(res, 300));
  assert.deepEqual(seen.at(-1), 'claim');
  assert.deepEqual(r.cached().keys, {});
  assert.equal(r.access.has('b3'), false);
});

test('claim: preview, not found, taken, too many tries, network, then confirm binds', async () => {
  const answers = { '04011999999001': [200, { preview: 'Dina Ayu Pratiwi' }], '04011999999002': [409, { code: 'taken', error: 'x' }], '04011999999003': [429, { code: 'slow', error: 'x' }] };
  const r = await rig({
    me: (json) => json(200, { state: 'claim' }),
    claim: (json, body, okBody) => (body.confirm ? json(200, okBody()) : json(...(answers[body.nim] || [404, { code: 'not-found', error: 'x' }]))),
  });
  assert.equal((await r.access.signIn()).s, 'claim');
  assert.deepEqual(await r.access.claim('04011999999001', false), { preview: 'Dina Ayu Pratiwi' });
  assert.deepEqual(await r.access.claim('04011000000000', false), { error: 'not-found' });
  assert.deepEqual(await r.access.claim('04011999999002', false), { error: 'taken' });
  assert.deepEqual(await r.access.claim('04011999999003', false), { error: 'slow' });
  assert.deepEqual(await r.access.claim('12ab', false), { error: 'format' });
  assert.equal(r.calls.claim.length, 4, 'a malformed NIM never reaches the server');
  r.setOnline(false);
  assert.deepEqual(await r.access.claim('04011999999001', false), { error: 'network' });
  r.setOnline(true);
  const st = await r.access.claim('04011999999001', true);
  assert.equal(st.s, 'ok');
  assert.deepEqual(r.calls.claim.at(-1), { nim: '04011999999001', confirm: true });
  assert.equal(r.access.has('b3'), true);
});

test('sign out wipes the keys and the opened banks, keeps the scores', async () => {
  const r = await rig();
  await r.access.signIn();
  await r.access.ensure('b3');
  const url = await r.access.picture('b3', BANK.q[0].img[0]).catch((e) => e);
  await r.access.signOut();
  assert.equal(r.store.get('alpha.cbt.v1'), null);
  assert.equal(r.calls.signOut, 1);
  assert.equal(r.access.bank('b3'), null);
  assert.equal(r.access.account(), null);
  assert.equal(r.store.get('alpha.to.v1.hist.b3'), '[{"id":"r1"}]');
  assert.ok(typeof url === 'string' || url instanceof Error);
});

test('pictures open with the bank key and are memoised', async () => {
  const r = await rig();
  await r.access.signIn();
  await r.access.ensure('b3');
  const made = [];
  globalThis.URL.createObjectURL = (b) => { made.push(b); return 'blob:test/' + made.length; };
  const a = await r.access.picture('b3', BANK.q[0].img[0]);
  const b = await r.access.picture('b3', BANK.q[0].img[0]);
  assert.equal(a, 'blob:test/1');
  assert.equal(b, a);
  assert.equal(made.length, 1);
  assert.equal(made[0].type, 'image/png');
  assert.deepEqual(new Uint8Array(await made[0].arrayBuffer()), PNG);
  await assert.rejects(r.access.picture('b3', { id: 'zz', f: '/cbt/missing.bin', w: 1, h: 1, type: 'image/png' }));
});

test('blocked storage: the access lives in memory for this page', async () => {
  const r0 = await rig();
  const throwing = { get() { throw new Error('blocked'); }, set() { throw new Error('blocked'); }, del() { throw new Error('blocked'); } };
  const access = createAccess({
    manifest: MANIFEST, storage: throwing, budget: 50, now: () => T0, online: () => true, redirectPending: () => false,
    auth: async () => ({ user: async () => ({ uid: 'u1', getIdToken: async () => 't' }), signIn: async () => ({ uid: 'u1', getIdToken: async () => 't' }), signOut: async () => {}, finishRedirect: async () => null }),
    fetch: async (u) => (u === '/api/cbt/me' ? new Response(JSON.stringify({ state: 'ok', who: WHO, keys: r0.keys, ttl: 60 }), { status: 200 }) : new Response('x', { status: 404 })),
  });
  assert.equal((await access.signIn()).s, 'ok');
  assert.equal(access.has('b3'), true);
});

test('watermark: name and the last four NIM digits, escaped inside the SVG', () => {
  const css = watermarkCss({ name: `O'NEIL <B> & "C"`, nim: '04011182631023' });
  assert.match(css, /^url\("data:image\/svg\+xml,/);
  const svg = decodeURIComponent(css.slice('url("data:image/svg+xml,'.length, -2));
  assert.ok(svg.includes('O&#39;NEIL &lt;B&gt; &amp; &quot;C&quot; ·· 1023'), svg);
  assert.ok(!/<B>/.test(svg));
  assert.ok(!css.slice(5, -2).includes('"'), 'no bare quote can end the url("...")');
  assert.equal(watermarkCss(null), 'none');
});

test('keys cached before a bank existed: asks the server again, then opens it', async () => {
  const r0 = await rig();
  const r = await rig({ cache: fresh({ b2: r0.keys.b2 }) });
  assert.equal(r.access.has('b3'), false);
  assert.equal((await r.access.ensure('b3')).s, 'ok');
  assert.equal(r.calls.me, 1);
  assert.equal(r.access.bank('b3').q.length, 1);
});

test('the server knows no key for the bank: a clear error, not a loop', async () => {
  const r0 = await rig();
  const r = await rig({ cache: fresh({ b2: r0.keys.b2 }), me: (json) => json(200, { state: 'ok', who: WHO, keys: { b2: r0.keys.b2 }, ttl: 604800 }) });
  const st = await r.access.ensure('b3');
  assert.deepEqual([st.s, st.code], ['error', 'nokey']);
  assert.ok(r.calls.me <= 2);
});

test('a rejected token is refreshed once before giving up', async () => {
  let n = 0;
  const r = await rig({ me: (json, okBody) => (++n === 1 ? json(401, { error: 'x', code: 'auth' }) : json(200, okBody())) });
  assert.equal((await r.access.signIn()).s, 'ok');
  assert.equal(n, 2);
});

test('loading Firebase outlived the tap: asks for a second tap, which signs in', async () => {
  const r0 = await rig();
  let active = false, signIns = 0;
  const access = createAccess({
    manifest: MANIFEST, storage: memStore(), budget: 50, now: () => T0, online: () => true, redirectPending: () => false, activation: () => active,
    auth: async () => ({ user: async () => null, signIn: async () => { signIns++; return { uid: 'u1', getIdToken: async () => 't' }; }, signOut: async () => {}, finishRedirect: async () => null }),
    fetch: async (u) => (u === '/api/cbt/me' ? new Response(JSON.stringify({ state: 'ok', who: WHO, keys: r0.keys, ttl: 60 }), { status: 200 }) : new Response('x', { status: 404 })),
  });
  assert.deepEqual(await access.signIn('b3'), { again: true });
  assert.equal(signIns, 0);
  active = false;
  assert.equal((await access.signIn('b3')).s, 'ok', 'the SDK is warm now, so the second tap goes straight to Google');
  assert.equal(signIns, 1);
});

test('a closed popup or a lost redirect leaves the student signed out, with a reason', async () => {
  const mk = (signIn, user) => createAccess({
    manifest: MANIFEST, storage: memStore(), budget: 50, now: () => T0, online: () => true, redirectPending: () => true,
    auth: async () => ({ user, signIn, signOut: async () => {}, finishRedirect: async () => null }),
    fetch: async () => new Response('x', { status: 500 }),
  });
  assert.deepEqual(await mk(async () => null, async () => null).signIn(), { s: 'out' });
  const err = (code) => async () => { throw Object.assign(new Error(code), { code }); };
  assert.deepEqual(await mk(err('auth/network-request-failed')).signIn(), { s: 'out', err: 'network' });
  assert.deepEqual(await mk(err('auth/web-storage-unsupported')).signIn(), { s: 'out', err: 'storage' });
  assert.deepEqual(await mk(null, err('app/redirect-lost')).resume(), { s: 'out', err: 'redirect' });
});

test('leaving a bank revokes its picture URLs; the next view makes new ones', async () => {
  const r = await rig();
  await r.access.signIn();
  await r.access.ensure('b3');
  let made = 0;
  const revoked = [];
  globalThis.URL.createObjectURL = () => 'blob:test/' + ++made;
  globalThis.URL.revokeObjectURL = (u) => revoked.push(u);
  const a = await r.access.picture('b3', BANK.q[0].img[0]);
  r.access.release('b3');
  assert.deepEqual(revoked, [a]);
  const b = await r.access.picture('b3', BANK.q[0].img[0]);
  assert.notEqual(b, a);
});

test('claim on an account that is already matched answers like /me, so state wins over preview', async () => {
  const r = await rig({ me: (json) => json(200, { state: 'claim' }), claim: (json, body, okBody) => json(200, okBody()) });
  await r.access.signIn();
  const st = await r.access.claim('04011999999001', false);
  assert.equal(st.s, 'ok');
  assert.equal(r.access.has('b3'), true);
  const r2 = await rig({ me: (json) => json(200, { state: 'claim' }), claim: (json) => json(200, { state: 'closed', who: null }) });
  await r2.access.signIn();
  assert.deepEqual(await r2.access.claim('04011999999001', false), { s: 'closed', who: null });
  const r3 = await rig({ me: (json) => json(200, { state: 'claim' }), claim: (json) => json(400, { error: 'NIM harus angka.', code: 'bad-nim' }) });
  await r3.access.signIn();
  assert.deepEqual(await r3.access.claim('040111', false), { error: 'format' });
});
