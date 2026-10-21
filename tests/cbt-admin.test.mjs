// The admin side of the try out server: src/admin/cbt-api.js, the one place the editor calls
// /api/cbt/admin. fetch is stubbed per test; the mock backend's fake answers are covered by
// tests/admin-cbt.e2e.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cbtAdmin, explainCbt, checkNewPerson, CbtError } from '../src/admin/cbt-api.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const STATE = {
  ready: true, source: 'blobs',
  people: [{ nim: '04011999261001', name: 'ADINDA PUTRI', grp: 'A1', blocked: false, claim: { uid: 'u1', email: 'a@gmail.com', gname: 'Adinda', at: '2026-10-20T03:00:00.000Z', match: 'name' } }],
  accounts: [], log: [], counts: { people: 1, claimed: 1, blocked: 0 },
};

function backend(tokens = ['t1', 't2']) {
  const calls = [];
  return { kind: 'firebase', calls, token: async (force = false) => { calls.push(force); return tokens[calls.length - 1]; } };
}

function answer(status, body, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': typeof body === 'string' ? 'text/html' : 'application/json', ...headers } });
}

function stub(...replies) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, method: init.method, auth: init.headers.Authorization, type: init.headers['Content-Type'], body: init.body, credentials: init.credentials });
    const r = replies[Math.min(seen.length, replies.length) - 1];
    return typeof r === 'function' ? r(init) : r;
  };
  return seen;
}

test('GET asks for the list with the ID token and no cookies', async () => {
  const seen = stub(answer(200, STATE));
  const data = await cbtAdmin(backend());
  assert.deepEqual(seen, [{ url: '/api/cbt/admin', method: 'GET', auth: 'Bearer t1', type: undefined, body: undefined, credentials: 'omit' }]);
  assert.equal(data.ready, true);
  assert.equal(data.people[0].claim.match, 'name');
});

test('POST sends the op as JSON', async () => {
  const seen = stub(answer(200, STATE));
  await cbtAdmin(backend(), { op: 'block', nim: '04011999261001' });
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].type, 'application/json');
  assert.deepEqual(JSON.parse(seen[0].body), { op: 'block', nim: '04011999261001' });
});

test('a 401 is retried once with a fresh token', async () => {
  const b = backend();
  const seen = stub(answer(401, { error: 'Sesi login habis.', code: 'auth' }), answer(200, STATE));
  const data = await cbtAdmin(b);
  assert.deepEqual(b.calls, [false, true]);
  assert.deepEqual(seen.map((s) => s.auth), ['Bearer t1', 'Bearer t2']);
  assert.equal(data.people.length, 1);
});

test('a second 401 means the session is over: reload', async () => {
  stub(answer(401, { error: 'x', code: 'auth' }));
  const e = await cbtAdmin(backend()).catch((x) => x);
  assert.ok(e instanceof CbtError);
  assert.equal(e.status, 401);
  assert.match(explainCbt(e), /Sesi login habis.*Muat ulang/);
});

test('every failure gets a plain Indonesian explanation', async () => {
  const cases = [
    [answer(403, { error: 'Akun ini bukan admin.', code: 'not-admin' }), /admin/],
    [answer(429, { error: 'Pelan-pelan.', code: 'slow' }, { 'retry-after': '120' }), /Terlalu banyak.*2 menit/],
    [answer(500, { error: 'boom' }), /bermasalah.*500/],
    [answer(502, '<html>Bad gateway</html>'), /bermasalah.*502/],
    [answer(404, '<html>Not found</html>'), /belum aktif/],
    [answer(400, { error: 'NIM harus angka.', code: 'bad-nim' }), /^NIM harus angka\.$/],
    [answer(409, { error: 'NIM ini sudah ada di daftar.', code: 'exists' }), /^NIM ini sudah ada di daftar\.$/],
  ];
  for (const [reply, want] of cases) {
    stub(reply);
    const e = await cbtAdmin(backend(), { op: 'add', nim: '123456', name: 'Ab' }).catch((x) => x);
    assert.ok(e instanceof CbtError, String(e));
    assert.match(explainCbt(e, 'add'), want);
  }
});

test('a 409 on install without a sentence says a code is already there', async () => {
  stub(answer(409, {}));
  const e = await cbtAdmin(backend(), { op: 'install', secret: 'x' }).catch((x) => x);
  assert.match(explainCbt(e, 'install'), /sudah punya kode setup/);
});

test('offline and a server that never answers', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const off = await cbtAdmin(backend()).catch((x) => x);
  assert.equal(off.status, 0);
  assert.match(explainCbt(off), /tersambung.*internet/);

  globalThis.fetch = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const slow = await cbtAdmin(backend(), undefined, { timeout: 30 }).catch((x) => x);
  assert.equal(slow.code, 'timeout');
  assert.match(explainCbt(slow), /tidak menjawab/);
});

test('an answer that is not the list is an error, not an empty list', async () => {
  stub(answer(200, '<html>index</html>'));
  const e = await cbtAdmin(backend()).catch((x) => x);
  assert.ok(e instanceof CbtError);
});

test('the mock backend answers from memory and nothing goes over the network', async () => {
  globalThis.fetch = () => { throw new Error('no network in mock mode'); };
  const sent = [];
  const mock = { kind: 'mock', token: async () => 'mock-id-token', cbtAdmin: async (body) => { sent.push(body); return { status: 200, body: STATE }; } };
  const data = await cbtAdmin(mock, { op: 'unblock', nim: '04011999261001' });
  assert.deepEqual(sent, [{ op: 'unblock', nim: '04011999261001' }]);
  assert.equal(data.people[0].nim, '04011999261001');
});

test('a new person is checked like the server checks it', () => {
  assert.deepEqual(checkNewPerson({ name: "  Siti  Nur'aini  ", nim: ' 0401 1999 2610 99 ' }), { name: "Siti Nur'aini", nim: '04011999261099', errors: {} });
  // a phone's curly apostrophe becomes the plain one the server accepts
  assert.equal(checkNewPerson({ name: 'Nur’aini', nim: '123456' }).name, "Nur'aini");
  assert.equal(checkNewPerson({ name: 'Ñoman Dé-Ayu', nim: '123456' }).errors.name, undefined);
  const bad = (name, nim) => checkNewPerson({ name, nim }).errors;
  assert.ok(bad('', '').name && bad('', '').nim);
  assert.ok(bad('A', '123456').name, 'one letter');
  assert.ok(bad('Budi 2', '123456').name, 'digits');
  assert.ok(bad('. -', '123456').name, 'no letters');
  assert.ok(bad('x'.repeat(81), '123456').name, 'too long');
  assert.ok(bad('Budi', '12345').nim, 'too short');
  assert.ok(bad('Budi', '1'.repeat(21)).nim, 'too long');
  assert.ok(bad('Budi', '0401-1999').nim, 'not digits');
  assert.equal(bad('Budi', '123456').nim, undefined);
});

test('the server says "kunci utama", this page says "kode setup"', async () => {
  stub(answer(400, { error: 'Kunci utama harus 43 karakter base64url dan cocok dengan daftar kelas.', code: 'bad-secret' }));
  const e = await cbtAdmin(backend(), { op: 'install', secret: 'x' }).catch((x) => x);
  assert.match(explainCbt(e, 'install'), /^Kode setup ini tidak cocok/);
  stub(answer(409, { error: 'Pasang kunci utama dulu.', code: 'setup' }));
  const f = await cbtAdmin(backend(), { op: 'block', nim: '123456' }).catch((x) => x);
  assert.match(explainCbt(f, 'block'), /belum punya kode setup/);
});

// The view's pure helpers (src/admin/editor-cbt.js).
import { displayName, setupSecret, logLine } from '../src/admin/editor-cbt.js';

test('names in capitals are shown the way people write them', () => {
  assert.equal(displayName('MUHAMMAD RIZKY AL-FARISI'), 'Muhammad Rizky Al-Farisi');
  assert.equal(displayName('I GUSTI AYU MADE SRIASIH'), 'I Gusti Ayu Made Sriasih');
  assert.equal(displayName('M. RIZKY'), 'M. Rizky');
  assert.equal(displayName("SITI NUR'AINI"), "Siti Nur'aini");
  assert.equal(displayName('Gita ayu Lestari'), 'Gita ayu Lestari', 'typed by an admin: kept');
});

test('the setup field takes the code or the whole link', () => {
  assert.equal(setupSecret('  abc_DEF-123 '), 'abc_DEF-123');
  assert.equal(setupSecret('https://alphangers.example/admin/#tryout/pasang=abc_DEF-123'), 'abc_DEF-123');
  assert.equal(setupSecret('abc_DEF\n-123'), 'abc_DEF-123', 'a line break from a chat app');
  assert.equal(setupSecret('   '), '');
});

test('log entries in plain words', () => {
  const helpers = { nameOf: (nim) => (nim === '04011999261004' ? 'Dewi Kartika Sari' : ''), me: 'admin@example.com' };
  const line = (e) => logLine(e, helpers);
  assert.equal(line({ kind: 'conflict', nim: '04011999261004', email: 'd@gmail.com', gname: 'Dewi' }), 'Dewi (d@gmail.com) mencoba NIM 04011999261004 (Dewi Kartika Sari) yang sudah dipakai akun lain.');
  assert.equal(line({ kind: 'block', nim: '04011999261004', by: 'ADMIN@example.com' }), 'Kamu memblokir Dewi Kartika Sari.');
  assert.equal(line({ kind: 'release', nim: '04011999261004', email: 'k@gmail.com', by: 'lain@example.com' }), 'lain@example.com melepas akun k@gmail.com dari Dewi Kartika Sari.');
  assert.equal(line({ kind: 'remove', nim: '04011999269999', by: 'admin@example.com' }), 'Kamu menghapus NIM 04011999269999 dari daftar.');
  assert.equal(line({ kind: 'closed', nim: '04011999261004', uid: 'u9', email: 'k@gmail.com' }), 'k@gmail.com masuk dengan NIM 04011999261004 (Dewi Kartika Sari) yang sedang diblokir.');
  assert.equal(logLine({ kind: 'closed', nim: '1234567', uid: 'u9', email: 'k@gmail.com' }, { blockedAccount: () => true }), 'k@gmail.com, akun yang sedang diblokir, masuk dengan NIM 1234567.');
  assert.match(line({ kind: 'mystery' }), /mystery/);
});
