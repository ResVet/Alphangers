// Who may open the try out banks, and the banks themselves once they may.
//
// The banks and their pictures are sealed files under /cbt/ (src/lib/seal.js). The server hands
// a signed-in classmate the key for each bank (/api/cbt/me); this module keeps those keys in
// localStorage with the account they belong to and when they expire, so the try out also works
// offline. It asks the server again at most once an hour while online, and forgets the keys as
// soon as the server says the account may not take the try out. Scores and progress are not
// touched here; they stay in the try out's own storage.
//
// Firebase is loaded only when it is really needed: when the student taps the sign-in button,
// or when cached access needs a fresh ID token. A visitor who only looks at the Try Out home
// downloads nothing from Google.
//
// createAccess() is the whole state machine with its inputs passed in, so it runs in Node tests;
// getAccess() wires it to the browser, Firebase and, in mock builds, to tests/fixtures/cbt.
import { open, openJson, fromB64u, LABEL, BANK_ID, IMG_ID } from '../../lib/seal.js';

const KEY = 'alpha.cbt.v1';
const FLAG = 'alpha.cbt.redirect';
const HOUR = 3600e3;
const TTL = 604800;
const TTL_MAX = 30 * 86400;
const FILE = /^\/cbt\/[A-Za-z0-9._-]+\.bin$/;
const TYPES = new Set(['image/webp', 'image/png', 'image/jpeg', 'image/avif', 'image/gif']);
const B64K = /^[A-Za-z0-9_-]{43}$/;

const coded = (code) => Object.assign(new Error(code), { code });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Browsers inside other apps (Instagram, Facebook, Line, TikTok, X, Android WebViews), where Google refuses to sign in. */
export function inApp(ua) {
  return /Instagram|FBAN|FBAV|FB_IAB|\bLine\/|musical_ly|TikTok|BytedanceWebview|Twitter|Snapchat|LinkedInApp|KAKAOTALK|; wv\)/.test(String(ua || ''));
}

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * A CSS background (url("data:image/svg+xml,...")) that repeats the student's name and the last
 * four digits of their NIM. 'pic' is the darker tone for pictures, which are mostly white.
 * The text is slanted inside the tile, and the tile repeats seamlessly, so the element that
 * carries it needs no transform.
 */
export function watermarkCss(who, tone) {
  if (!who || typeof who.name !== 'string' || !who.name.trim()) return 'none';
  const raw = who.name.trim().replace(/\s+/g, ' ').slice(0, 64) + ' ·· ' + String(who.nim || '').slice(-4);
  const len = raw.length * 8.6, c = Math.cos(0.4189), s = Math.sin(0.4189);
  const w = Math.round(len * c + 13 * s + 70), h = Math.round(2 * (len * s + 13 * c + 26));
  const fill = tone === 'pic' ? '#2a2a2a' : '#eef2e8';
  const op = tone === 'pic' ? 0.16 : 0.055;
  const t = xml(raw);
  const one = (x, y) => `<text x='${x}' y='${y}' text-anchor='middle' dominant-baseline='middle' transform='rotate(-24 ${x} ${y})'>${t}</text>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<g font-family='ui-monospace,SFMono-Regular,Menlo,Consolas,monospace' font-size='13' letter-spacing='1' fill='${fill}' fill-opacity='${op}'>` +
    one(Math.round(w / 2), Math.round(h / 4)) + one(0, Math.round((3 * h) / 4)) + one(w, Math.round((3 * h) / 4)) + '</g></svg>';
  return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
}

function signErr(e) {
  const c = (e && e.code) || '';
  if (c === 'auth/network-request-failed' || c === 'auth/timeout') return 'network';
  if (c === 'auth/web-storage-unsupported' || c === 'auth/operation-not-supported-in-this-environment') return 'storage';
  if (c === 'auth/popup-blocked') return 'popup';
  if (c === 'auth/too-many-requests') return 'slow';
  if (c === 'auth/user-disabled') return 'account';
  if (c === 'app/redirect-lost') return 'redirect';
  return 'auth';
}

const pickWho = (w) => ({ short: String(w.short || w.name || ''), name: String(w.name || ''), nim: String(w.nim || '') });
const okWho = (w) => !!w && typeof w === 'object' && typeof w.name === 'string' && !!w.name;

export function createAccess(deps) {
  const list = (deps.manifest && Array.isArray(deps.manifest.banks) ? deps.manifest.banks : [])
    .filter((b) => b && BANK_ID.test(b.id) && Number.isInteger(b.kv) && b.kv >= 1 && FILE.test(b.file));
  const byId = new Map(list.map((b) => [b.id, b]));
  const store = deps.storage;
  const net = deps.fetch;
  const fileUrl = deps.fileUrl || ((p) => p);
  const now = deps.now || Date.now;
  const online = deps.online || (() => true);
  const budget = deps.budget == null ? 3000 : deps.budget;
  const activation = deps.activation || (() => true);
  const redirectPending = deps.redirectPending || (() => false);

  // the cached access; memory takes over for this page when storage refuses
  let mem = null, broken = false;
  const valid = (c) => !!c && typeof c === 'object' && typeof c.uid === 'string' && !!c.uid && !!c.keys && typeof c.keys === 'object' &&
    Number.isFinite(c.exp) && Number.isFinite(c.checked) && (c.who === null || okWho(c.who));
  function read() {
    if (broken) return mem;
    let raw;
    try { raw = store.get(KEY); } catch { broken = true; return mem; }
    try { const c = raw ? JSON.parse(raw) : null; return valid(c) ? c : null; } catch { return null; }
  }
  function write(c) {
    mem = c;
    if (broken) return;
    try { if (c) store.set(KEY, JSON.stringify(c)); else store.del(KEY); } catch { broken = true; }
  }
  function keyFor(c, id) {
    const e = byId.get(id), k = c && c.keys[id];
    if (!e || !k || k.kv !== e.kv || typeof k.k !== 'string' || !B64K.test(k.k) || !(c.exp > now())) return null;
    try { return fromB64u(k.k); } catch { return null; }
  }

  // opened banks and pictures live in memory only
  const opened = new Map(), pics = new Map();
  let gen = 0;
  function release(id) {
    for (const [k, ent] of pics) {
      if (id && !k.startsWith(id + '/')) continue;
      ent.dead = true;
      if (ent.url) URL.revokeObjectURL(ent.url);
      pics.delete(k);
    }
  }
  function forget() { gen++; opened.clear(); release(); }
  function wipe() { write(null); forget(); }

  let state = { s: 'idle' };
  const subs = new Set();
  function set(st) {
    state = st;
    for (const f of [...subs]) {
      try { f(st); } catch (e) { queueMicrotask(() => { throw e; }); }
    }
    return st;
  }

  let kitP = null, kitReady = false;
  function kit() {
    return kitP || (kitP = Promise.resolve().then(deps.auth).then((a) => { kitReady = true; return a; }, (e) => { kitP = null; throw e; }));
  }

  async function api(u, path, body, again = false) {
    if (!online()) return { net: true };
    let token;
    try { token = await u.getIdToken(again); } catch (e) {
      return e && e.code === 'auth/network-request-failed' ? { net: true } : { status: 401 };
    }
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), 15000);
    try {
      const headers = { authorization: 'Bearer ' + token };
      if (body) headers['content-type'] = 'application/json';
      const res = await net(path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (res.status === 401 && !again) return api(u, path, body, true);
      return { status: res.status, data };
    } catch {
      return { net: true };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // a server answer becomes the cached access and a state
  function apply(u, r) {
    if (r.net) return { s: 'error', code: online() ? 'network' : 'offline' };
    if (r.status === 401 || r.status === 403) return { s: 'error', code: 'account' };
    const d = r.status === 200 && r.data && typeof r.data === 'object' ? r.data : null;
    if (!d) return { s: 'error', code: 'server' };
    const base = { uid: u.uid, email: typeof u.email === 'string' ? u.email : '' };
    if (d.state === 'ok' && okWho(d.who) && d.keys && typeof d.keys === 'object') {
      const keys = {};
      for (const [id, k] of Object.entries(d.keys)) {
        if (BANK_ID.test(id) && k && Number.isInteger(k.kv) && typeof k.k === 'string' && B64K.test(k.k)) keys[id] = { kv: k.kv, k: k.k };
      }
      const ttl = Number.isFinite(d.ttl) && d.ttl > 0 ? Math.min(d.ttl, TTL_MAX) : TTL;
      const who = pickWho(d.who);
      write({ ...base, who, keys, exp: now() + ttl * 1000, checked: now() });
      return { s: 'ok', who };
    }
    if (d.state === 'claim') {
      forget();
      write({ ...base, who: null, keys: {}, exp: 0, checked: now() });
      return { s: 'claim', email: base.email };
    }
    if (d.state === 'closed') {
      forget();
      const who = okWho(d.who) ? pickWho(d.who) : null;
      write({ ...base, who, keys: {}, exp: 0, checked: now() });
      return { s: 'closed', who };
    }
    if (d.state === 'setup') return { s: 'setup' };
    return { s: 'error', code: 'server' };
  }

  // ask the server what this account may do (one request at a time)
  let inflight = null;
  function verify() {
    return inflight || (inflight = (async () => {
      let a, u;
      try { a = await kit(); } catch { return { s: 'error', code: online() ? 'network' : 'offline' }; }
      try { u = await a.user(); } catch (e) {
        const code = signErr(e);
        if (code === 'network') return { s: 'error', code: online() ? 'network' : 'offline' };
        wipe();
        return { s: 'out', err: code };
      }
      if (!u) { wipe(); return { s: 'out' }; }
      const c = read();
      if (c && c.uid !== u.uid) wipe();
      return apply(u, await api(u, '/api/cbt/me'));
    })().finally(() => { inflight = null; }));
  }
  // with usable keys in hand, a failed or unclear answer keeps them
  const keeps = (r) => r.s === 'error' || r.s === 'setup';

  async function check(id) {
    const c = read();
    if (keyFor(c, id)) {
      if (!online() || now() - c.checked < HOUR) return set({ s: 'ok', who: c.who });
      const p = verify();
      const r = await Promise.race([p, sleep(budget).then(() => null)]);
      if (!r) {
        // too slow: open from the cache now, and act on the answer when it comes
        p.then((late) => { if (!keeps(late)) set(late); });
        return set({ s: 'ok', who: c.who });
      }
      if (keeps(r) && keyFor(read(), id)) return set({ s: 'ok', who: read().who });
      return set(r);
    }
    if (!online()) return set({ s: 'error', code: 'offline' });
    if (c || redirectPending()) return set(await verify());
    return set({ s: 'out' });
  }

  async function openBank(id) {
    const e = byId.get(id), c = read(), raw = keyFor(c, id);
    if (!raw) throw coded('nokey');
    const k = c.keys[id].k, o = opened.get(id);
    if (o && o.k === k && o.file === e.file) return o.bank;
    const g = gen;
    let res;
    try { res = await net(fileUrl(e.file)); } catch { throw coded(online() ? 'network' : 'offline'); }
    if (!res.ok) throw coded('files');
    const buf = new Uint8Array(await res.arrayBuffer());
    let bank;
    try { bank = await openJson(raw, buf, LABEL.bankAad(id, e.kv)); } catch (err) { throw coded(err && err.reason === 'key' ? 'key' : 'files'); }
    if (!bank || typeof bank !== 'object' || !Array.isArray(bank.q) || !bank.topics) throw coded('files');
    if (g !== gen) throw coded('gone');
    opened.set(id, { k, file: e.file, bank });
    return bank;
  }
  const fileErr = (e) => (e && (e.code === 'offline' || e.code === 'network' || e.code === 'nokey') ? e.code : 'files');

  async function ensure(id) {
    if (!byId.has(id)) return set({ s: 'error', code: 'missing' });
    const st = await check(id);
    if (st.s !== 'ok') return st;
    try {
      await openBank(id);
      return state;
    } catch (e) {
      if (e.code === 'gone') return state;
      if (e.code !== 'nokey' && e.code !== 'key') return set({ s: 'error', code: fileErr(e) });
    }
    // no key for this bank, or the key does not fit: the cached keys may be older than the bank
    if (!online()) return set({ s: 'error', code: 'offline' });
    const r = await verify();
    if (r.s !== 'ok') return set(r);
    set(r);
    try {
      await openBank(id);
      return state;
    } catch (e) {
      return e.code === 'gone' ? state : set({ s: 'error', code: fileErr(e) });
    }
  }

  async function signIn(target) {
    if (!online()) return set({ s: 'out', err: 'offline' });
    const t0 = clock(), cold = !kitReady;
    let a;
    try { a = await kit(); } catch { return set({ s: 'out', err: 'network' }); }
    // a popup needs a recent tap; when loading Firebase took that long, ask for one more
    if (cold && !activation(t0)) return { again: true };
    let u;
    try { u = await a.signIn(target); } catch (e) { return set({ s: 'out', err: signErr(e) }); }
    if (!u) return set({ s: 'out' });
    const c = read();
    if (c && c.uid !== u.uid) wipe();
    return set(apply(u, await api(u, '/api/cbt/me')));
  }

  async function claim(nim, confirm) {
    nim = String(nim == null ? '' : nim).replace(/[\s.-]/g, '');
    if (!/^\d{6,20}$/.test(nim)) return { error: 'format' };
    if (!online()) return { error: 'network' };
    let u;
    try { u = await (await kit()).user(); } catch { return { error: 'network' }; }
    if (!u) { wipe(); set({ s: 'out' }); return { error: 'account' }; }
    const r = await api(u, '/api/cbt/claim', { nim, confirm: !!confirm });
    if (r.net) return { error: 'network' };
    const code = r.data && r.data.code;
    if (r.status === 404 || code === 'not-found') return { error: 'not-found' };
    if (r.status === 409 || code === 'taken') return { error: 'taken' };
    if (r.status === 429 || code === 'slow') return { error: 'slow' };
    if (r.status === 400 || code === 'bad-nim') return { error: 'format' };
    if (r.status === 401 || r.status === 403 || code === 'auth') return { error: 'account' };
    if (r.status !== 200 || !r.data) return { error: 'server' };
    // an account that is already matched (or a server without its key) answers like /me
    if (typeof r.data.state === 'string') return set(apply(u, r));
    if (!confirm) return typeof r.data.preview === 'string' && r.data.preview ? { preview: r.data.preview } : { error: 'server' };
    return set(apply(u, r));
  }

  async function signOut() {
    wipe();
    set({ s: 'out' });
    try { await (await kit()).signOut(); } catch { /* the cached access is gone either way */ }
  }

  function picture(id, img) {
    if (!img || !IMG_ID.test(img.id) || typeof img.f !== 'string' || !FILE.test(img.f) || !TYPES.has(img.type)) return Promise.reject(coded('files'));
    const key = id + '/' + img.id, hit = pics.get(key);
    if (hit) return hit.p;
    const ent = { dead: false, url: null, p: null };
    ent.p = (async () => {
      const e = byId.get(id), raw = keyFor(read(), id);
      if (!e || !raw) throw coded('nokey');
      let res;
      try { res = await net(fileUrl(img.f)); } catch { throw coded(online() ? 'network' : 'offline'); }
      if (!res.ok) throw coded('files');
      const bytes = await open(raw, new Uint8Array(await res.arrayBuffer()), LABEL.imgAad(id, e.kv, img.id));
      const url = URL.createObjectURL(new Blob([bytes], { type: img.type }));
      if (ent.dead) { URL.revokeObjectURL(url); throw coded('gone'); }
      ent.url = url;
      return url;
    })();
    pics.set(key, ent);
    ent.p.catch(() => { if (pics.get(key) === ent) pics.delete(key); });
    return ent.p;
  }

  return {
    manifest: { v: 1, banks: list },
    banks: list,
    entry: (id) => byId.get(id) || null,
    get state() { return state; },
    returning: null,
    account() {
      const c = read();
      return c ? { uid: c.uid, email: c.email || '', who: c.who || null } : null;
    },
    has: (id) => !!keyFor(read(), id),
    bank(id) {
      const o = opened.get(id), c = read();
      return o && keyFor(c, id) && c.keys[id].k === o.k ? o.bank : null;
    },
    watermark(tone) {
      const c = read();
      return watermarkCss(c && c.who, tone);
    },
    ensure, signIn, claim, signOut, picture, release,
    resume: async () => (online() ? set(await verify()) : state),
    onChange(f) { subs.add(f); return () => subs.delete(f); },
  };
}

// ---- the browser -----------------------------------------------------------------------------

function local() {
  return {
    get: (k) => window.localStorage.getItem(k),
    set: (k, v) => window.localStorage.setItem(k, v),
    del: (k) => window.localStorage.removeItem(k),
  };
}
function flag() {
  try { return sessionStorage.getItem(FLAG); } catch { return null; }
}

// Firebase, behind the small interface createAccess() needs
async function firebaseAdapter() {
  const { firebaseAuth } = await import('../../lib/firebase-auth.js');
  const kit = await firebaseAuth();
  return {
    async user() {
      if (flag()) {
        const lost = await kit.finishRedirect(FLAG);
        if (lost) throw lost;
      }
      await kit.auth.authStateReady();
      return kit.auth.currentUser;
    },
    signIn: (target) => kit.signIn(FLAG, target || '1'),
    signOut: () => kit.signOut(),
  };
}

let made = null;
/** The one access object for this page. The manifest is src/data/cbt.json (fixtures in mock builds). */
export function getAccess(manifest) {
  return made || (made = (async () => {
    const back = flag();
    let deps = {
      manifest,
      storage: local(),
      fetch: (u, i) => window.fetch(u, i),
      auth: firebaseAdapter,
      online: () => navigator.onLine !== false,
      redirectPending: () => !!flag(),
      activation: (t0) => (navigator.userActivation ? navigator.userActivation.isActive : clock() - t0 < 900),
    };
    if ((import.meta.env.DEV || import.meta.env.MODE === 'mock') && /[?&]mock(?:[=&]|$)/.test(location.search)) {
      const { mockDeps } = await import('./mock.js');
      deps = { ...deps, ...(await mockDeps()) };
    }
    const a = createAccess(deps);
    if (back) {
      a.returning = /^[a-z][a-z0-9]{0,11}$/.test(back) ? back : null;
      a.resume();
    }
    return a;
  })().catch((e) => { made = null; throw e; }));
}
