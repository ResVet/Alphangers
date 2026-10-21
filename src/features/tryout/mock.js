// The try out without Google and without the server, for `vite` dev and `vite build --mode mock`
// with ?mock in the URL. Production builds drop the branch that imports this file.
//
// Banks come from tests/fixtures/cbt (fake questions sealed with a throwaway key, see
// scripts/cbt/fixtures.mjs). /api/cbt/me and /api/cbt/claim are answered here, in the page.
// Pick a scenario with ?mock&cbt=...:
//   claim   (default) a new account: NIM 04011999999001 is Dina, 04011999999002 belongs to
//           another account, any other NIM is not on the list
//   ok      the account is already matched to Dina
//   closed  the account is matched, but may not take the try out
//   setup   the server has no key yet
//   slow    like claim, but every NIM check answers "too many tries"
//   offline Google and the server are out of reach
import fixtures from '../../../tests/fixtures/cbt/manifest.json';
import { derive, toB64u, parseSecret, LABEL } from '../../lib/seal.js';

const files = import.meta.glob('../../../tests/fixtures/cbt/*.bin', { query: '?url&no-inline', import: 'default', eager: true });
const byName = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split('/').pop(), url]));

const ROSTER = {
  '04011999999001': { name: 'Dina Ayu Pratiwi' },
  '04011999999002': { name: 'Bagas Nugroho' },
};
const TAKEN = '04011999999002';
const USER = { uid: 'mock-dina-7Qx2LmN4', email: 'dina.pratiwi@example.com' };
const SERVER = 'alpha.cbt.mock';
const SIGNED = 'alpha.cbt.mock.user';
const SCENARIOS = ['claim', 'ok', 'closed', 'setup', 'slow', 'offline'];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = () => Object.assign(new Error('mock: offline'), { code: 'auth/network-request-failed' });

function storeGet(s, k) {
  try { return JSON.parse(s.getItem(k)); } catch { return null; }
}
function storeSet(s, k, v) {
  try { if (v == null) s.removeItem(k); else s.setItem(k, JSON.stringify(v)); } catch { /* the mock forgets */ }
}

export async function mockDeps() {
  const q = new URLSearchParams(location.search);
  const scenario = SCENARIOS.includes(q.get('cbt')) ? q.get('cbt') : 'claim';
  const master = parseSecret(fixtures.secret);
  const keys = {};
  for (const b of fixtures.banks) keys[b.id] = { kv: b.kv, k: toB64u(await derive(master, LABEL.bankKey(b.id, b.kv))) };

  // the fake server's memory: which account is matched to which NIM, per tab
  let server = storeGet(sessionStorage, SERVER);
  if (!server || server.scenario !== scenario) {
    server = { scenario, bound: scenario === 'ok' || scenario === 'closed' ? { [USER.uid]: '04011999999001' } : {} };
    storeSet(sessionStorage, SERVER, server);
  }
  const me = (uid) => {
    if (scenario === 'setup') return { state: 'setup' };
    const nim = server.bound[uid];
    if (!nim) return { state: 'claim' };
    const who = { ...ROSTER[nim], nim };
    if (scenario === 'closed') return { state: 'closed', who };
    return { state: 'ok', who, keys, ttl: 604800 };
  };

  const user = () => ({ ...USER, getIdToken: async () => 'mock.' + USER.uid });
  const auth = async () => {
    await wait(120);
    return {
      async user() { return storeGet(localStorage, SIGNED) ? user() : null; },
      async signIn() {
        await wait(450);
        if (scenario === 'offline') throw fail();
        storeSet(localStorage, SIGNED, 1);
        return user();
      },
      async signOut() { storeSet(localStorage, SIGNED, null); },
    };
  };

  async function api(url, init) {
    if (scenario === 'offline') throw new TypeError('Failed to fetch');
    await wait(260);
    const h = (init && init.headers) || {};
    const uid = String(h.authorization || '').replace(/^Bearer mock\./, '');
    if (uid !== USER.uid) return json(401, { error: 'Masuk dulu.', code: 'auth' });
    if (url === '/api/cbt/me') return json(200, me(uid));
    if (url === '/api/cbt/claim' && init.method === 'POST') {
      let body = null;
      try { body = JSON.parse(init.body); } catch { /* answered below */ }
      const nim = body && typeof body.nim === 'string' ? body.nim : '';
      if (!/^\d{6,20}$/.test(nim)) return json(400, { error: 'NIM harus angka.', code: 'bad-nim' });
      if (scenario === 'slow') return json(429, { error: 'Terlalu sering.', code: 'slow' });
      if (server.bound[uid]) return json(200, body.confirm ? me(uid) : { preview: ROSTER[server.bound[uid]].name });
      if (!ROSTER[nim]) return json(404, { error: 'Tidak ada.', code: 'not-found' });
      if (nim === TAKEN) return json(409, { error: 'Sudah dipakai.', code: 'taken' });
      if (!body.confirm) return json(200, { preview: ROSTER[nim].name });
      server.bound[uid] = nim;
      storeSet(sessionStorage, SERVER, server);
      return json(200, me(uid));
    }
    return json(404, { error: 'Tidak ada.', code: 'not-found' });
  }

  return {
    manifest: { v: fixtures.v, banks: fixtures.banks },
    auth,
    fetch: (url, init) => (String(url).startsWith('/api/') ? api(url, init || {}) : window.fetch(url, init)),
    fileUrl: (p) => byName[p.split('/').pop()] || p,
  };
}
