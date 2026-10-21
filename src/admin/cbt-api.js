// The try out server's admin endpoint (netlify/functions/cbt.mjs). GET /api/cbt/admin answers the
// participant list; POST /api/cbt/admin with { op, ... } changes one thing and answers the whole
// list again. Both carry the admin's Firebase ID token. The mock backend (?mock) answers from
// memory instead, with the same status codes and bodies, so both go through the same checks here.
import { explain } from './errors.js';

const ENDPOINT = '/api/cbt/admin';
const TIMEOUT_MS = 15000;
const MATCH = ['nim', 'name', 'partial', 'none'];

export class CbtError extends Error {
  // status 0: the request never got an answer (code 'offline' or 'timeout')
  constructor(status, body = null, retryAfter = 0) {
    super(`try out server: ${status || body?.code || 'no answer'}`);
    this.name = 'CbtError';
    this.status = status;
    this.code = typeof body?.code === 'string' ? body.code : '';
    // the server's own sentence for the admin, shown as text only
    this.said = typeof body?.error === 'string' ? body.error.trim().slice(0, 300) : '';
    this.retryAfter = retryAfter;
  }
}

/** GET with no body, POST with one. Resolves the normalised list or throws CbtError. */
export async function cbtAdmin(backend, body, { timeout = TIMEOUT_MS } = {}) {
  let res = await send(backend, body, false, timeout);
  // an ID token past its hour: ask Firebase for a fresh one and try once more
  if (res.status === 401) res = await send(backend, body, true, timeout);
  if (res.status >= 200 && res.status < 300 && res.body && typeof res.body === 'object' && Array.isArray(res.body.people)) return normalise(res.body);
  throw new CbtError(res.status === 200 ? 502 : res.status, res.body, res.retryAfter);
}

async function send(backend, body, fresh, timeout) {
  const token = await backend.token(fresh);
  if (backend.kind === 'mock') return backend.cbtAdmin(body);
  if (globalThis.navigator?.onLine === false) throw new CbtError(0, { code: 'offline' });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(ENDPOINT, {
      method: body ? 'POST' : 'GET',
      headers: body ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : { Authorization: 'Bearer ' + token },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      cache: 'no-store',
      signal: ctl.signal,
    });
    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      // not JSON: a gateway error page, or no function deployed at this path
    }
    return { status: res.status, body: json, retryAfter: Number(res.headers.get('retry-after')) || 0 };
  } catch (e) {
    if (e instanceof CbtError) throw e;
    throw new CbtError(0, { code: e.name === 'AbortError' ? 'timeout' : 'offline' });
  } finally {
    clearTimeout(timer);
  }
}

const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const list = (v) => (Array.isArray(v) ? v : []);

// Only the fields the page uses, with safe defaults, so a field the server adds or drops later
// can not break the list.
function normalise(b) {
  return {
    ready: b.ready === true,
    source: b.source === 'env' || b.source === 'blobs' ? b.source : null,
    people: list(b.people)
      .filter((p) => p && typeof p.nim === 'string')
      .map((p) => ({
        nim: p.nim,
        name: text(p.name),
        added: p.added === true,
        blocked: p.blocked === true,
        claim: p.claim && typeof p.claim === 'object'
          ? { uid: text(p.claim.uid), email: text(p.claim.email), gname: text(p.claim.gname), at: p.claim.at, match: MATCH.includes(p.claim.match) ? p.claim.match : 'none' }
          : null,
      })),
    accounts: list(b.accounts)
      .filter((a) => a && a.uid)
      .map((a) => ({ uid: text(a.uid), email: text(a.email), gname: text(a.gname), at: a.at, by: text(a.by) })),
    log: list(b.log)
      .filter((e) => e && typeof e.kind === 'string')
      .map((e) => ({ at: e.at, kind: e.kind, nim: text(e.nim), uid: text(e.uid), email: text(e.email), gname: text(e.gname), by: text(e.by) })),
  };
}

// The server calls the setup code "kunci utama"; this page says "kode setup" everywhere, so these
// two are worded here instead.
const OWN = {
  'bad-secret': 'Kode setup ini tidak cocok dengan daftar kelas. Cek lagi, mungkin ada bagian yang terpotong waktu disalin.',
  setup: 'Server belum punya kode setup, jadi daftar kelas belum bisa dibuka.',
};

/** One sentence for the admin. `op` is the operation that failed, if any. */
export function explainCbt(e, op = '') {
  if (!(e instanceof CbtError)) return explain(e);
  const s = e.status;
  if (s === 0) return e.code === 'timeout' ? 'Server try out tidak menjawab. Cek internet lalu coba lagi.' : 'Gagal tersambung ke server. Cek internet lalu coba lagi.';
  if (s === 401) return 'Sesi login habis. Muat ulang halaman, lalu coba lagi.';
  if (s === 403) return 'Server menolak akun ini. Pastikan akun ini masih terdaftar sebagai admin.';
  if (s === 429) {
    const min = Math.max(1, Math.ceil(e.retryAfter / 60));
    return `Terlalu banyak permintaan dalam waktu singkat. Tunggu ${e.retryAfter ? `${min} menit` : 'sebentar'} lalu coba lagi.`;
  }
  if (s >= 500) return `Server try out sedang bermasalah (kode ${s}). Tunggu sebentar lalu coba lagi.`;
  if (s === 409 && op === 'install') return 'Server sudah punya kode setup. Muat ulang halaman untuk melihat daftarnya.';
  if (OWN[e.code]) return OWN[e.code];
  if (s === 404 && !e.said) return 'Server try out belum aktif di situs ini. Kalau baru saja di-deploy, tunggu beberapa menit lalu muat ulang.';
  if (e.said) return e.said;
  if (s === 409) return 'Data di server baru saja berubah. Daftarnya dimuat ulang, coba lagi.';
  return `Server menolak permintaan ini (kode ${s}).`;
}

// The same rules the server puts on a new person: a name of 2 to 80 characters made of letters,
// spaces and . ' - (with at least one letter), and a NIM of 6 to 20 digits.
const NAME_OK = /^[\p{L}\p{M} .'-]{2,80}$/u;

/** Cleans what was typed and says what is wrong: { name, nim, errors: { name?, nim? } }. */
export function checkNewPerson({ name = '', nim = '' }) {
  const n = String(name).replace(/[‘’`´]/g, "'").replace(/\s+/g, ' ').trim();
  const id = String(nim).replace(/\s+/g, '');
  const errors = {};
  if (!n) errors.name = 'Isi nama lengkapnya.';
  else if (!NAME_OK.test(n) || !/\p{L}/u.test(n)) errors.name = 'Nama 2 sampai 80 huruf. Boleh pakai spasi, titik, tanda petik satu, dan tanda hubung.';
  if (!id) errors.nim = 'Isi NIM-nya.';
  else if (!/^\d{6,20}$/.test(id)) errors.nim = 'NIM cuma boleh angka, 6 sampai 20 digit.';
  return { name: n, nim: id, errors };
}
