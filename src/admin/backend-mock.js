// In-memory backend for local development and the Playwright checks. It keeps
// the same contract as the Firestore rules (rev must move by one, every
// replaced version goes to history) so the UI can be exercised end to end
// without a Firebase project. Never part of a production build: main.js only
// imports it behind import.meta.env checks that Vite removes at build time.
//
//   /admin/?mock=admin   signed in as an admin
//   /admin/?mock=guest   signed in, not an admin
//   /admin/?mock=out     signed out (the sign-in button makes you admin)
//   &seed=1              start with saved versions and some history
//   &cbt=ready           the try out server already has its setup code (default: not yet)
//   &cbt=down            the try out server's first answer is a 503
//
// window.__alphaMock.bump(key) simulates a save from another tab.
import { ConflictError } from './errors.js';
import { loadBundled } from '../lib/content.js';

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/* ---------- the try out server (/api/cbt/admin) ---------- */

// Made-up classmates, written in capitals like the class list. NIMs are 04011999 + suffix.
const ROSTER = [
  ['261001', 'ADINDA PUTRI MAHARANI'], ['261002', 'BAGUS SETYO NUGROHO'], ['261003', 'CITRA AYU LESTARI'],
  ['261004', 'DEWI KARTIKA SARI'], ['261005', 'EKO PRASETYO WIBOWO'], ['261006', 'FAJAR RAMADHAN SIREGAR'],
  ['261007', 'GALUH PRAMESWARI'], ['261008', 'HENDRA GUNAWAN TANJUNG'], ['261009', 'I GUSTI AYU MADE SRIASIH'],
  ['261010', 'JOSUA PARULIAN SITORUS'], ['261011', 'KEZIA ANGELINA WIJAYA'], ['261012', 'LAILATUL FITRIANI'],
  ['261013', 'MUHAMMAD RIZKY AL-FARISI'], ['261014', 'NADIA SALSABILA HARAHAP'], ['261015', 'OKTAVIANUS DANIEL'],
  ['261016', 'PUTU EKA WIRAWAN'], ['261017', 'RAHMA AULIA PUTRI'], ['261018', 'SATRIA DWI ANGGORO'],
  ['261019', 'TIARA NUR HALIZA'], ['261020', 'WAHYU ADI KUSUMA'],
].map(([n, name]) => ({ nim: '04011999' + n, name }));

// Who signed in with which Google account: [Google name, email, match, hours ago]. 261004 is
// held by an account that looks nothing like Dewi; the real Dewi shows up in the log.
const CLAIMS = {
  261001: ['Adinda Putri', 'adinda.maharani@gmail.com', 'name', 72],
  261002: ['Bagus Nugroho', 'bagus.04011999261002@gmail.com', 'nim', 70],
  261004: ['kucing oren', 'kucingoren.77@gmail.com', 'none', 30],
  261006: ['Fajar Siregar', 'fajar.siregar@gmail.com', 'name', 52],
  261007: ['Galuh P', 'galuhpw@gmail.com', 'partial', 47],
  261009: ['Sriasih', 'gekmade.sriasih@gmail.com', 'name', 46],
  261010: ['Josua Sitorus', 'josua.sitorus@gmail.com', 'name', 26],
  261011: ['Kezia Wijaya', 'kezia.wijaya@gmail.com', 'name', 3.2],
  261013: ['M. Rizky', 'rizky.alfarisi@gmail.com', 'name', 20],
  261015: ['Daniel', 'daniel04011999261015@gmail.com', 'nim', 9],
  261017: ['Rahma Aulia', 'rahmaaulia.p@gmail.com', 'name', 5],
  261019: ['Tiara', 'tiaranh.02@gmail.com', 'partial', 2],
};

// Same rules, codes and sentences as netlify/lib/cbt.mjs; answers { status, body }.
function createCbtMock(scenario) {
  const ago = (hours) => new Date(Date.now() - hours * 3600e3).toISOString();
  const ADMIN = 'admin@example.com';
  let ready = scenario === 'ready' || scenario === 'down';
  let failNext = scenario === 'down';
  const people = new Map(ROSTER.map((p) => [p.nim, { ...p, blocked: p.nim.endsWith('261005') || p.nim.endsWith('261011'), added: false, dropped: false }]));
  const claims = new Map(Object.entries(CLAIMS).map(([n, [gname, email, match, hours]]) => ['04011999' + n, { uid: 'g-' + n, email, gname, match, at: ago(hours) }]));
  const accounts = [{ uid: 'g-anon', email: 'akun.tak.dikenal@gmail.com', gname: 'Pengguna Baru', at: ago(50), by: 'ketua.kelas@example.com' }];
  const log = ready
    ? [
        { at: ago(0.67), kind: 'conflict', nim: '04011999261004', uid: 'g-dewi', email: 'dewikartika.sari@gmail.com', gname: 'Dewi Kartika' },
        { at: ago(3.2), kind: 'closed', nim: '04011999261011', uid: 'g-261011', email: 'kezia.wijaya@gmail.com', gname: 'Kezia Wijaya' },
        { at: ago(28), kind: 'block', nim: '04011999261011', by: ADMIN },
        { at: ago(50), kind: 'blockAccount', uid: 'g-anon', email: 'akun.tak.dikenal@gmail.com', gname: 'Pengguna Baru', by: 'ketua.kelas@example.com' },
        { at: ago(140), kind: 'block', nim: '04011999261005', by: ADMIN },
        { at: ago(170), kind: 'install', by: ADMIN },
      ]
    : [];

  const no = (status, code, error) => ({ status, body: { error, code } });
  const note = (e) => {
    log.unshift({ at: new Date().toISOString(), ...e, by: ADMIN });
    log.length = Math.min(log.length, 200);
  };
  function view() {
    if (!ready) return { status: 200, body: structuredClone({ ready: false, source: null, people: [], accounts, log, counts: { people: 0, claimed: 0, blocked: 0 } }) };
    const list = [...people.values()]
      .filter((p) => !p.dropped)
      .map((p) => ({ nim: p.nim, name: p.name, ...(p.added ? { added: true } : {}), blocked: p.blocked, claim: claims.get(p.nim) || null }));
    const counts = { people: list.length, claimed: list.filter((p) => p.claim).length, blocked: list.filter((p) => p.blocked).length };
    return { status: 200, body: structuredClone({ ready: true, source: 'blobs', people: list, accounts, log, counts }) };
  }
  function release(nim) {
    const c = claims.get(nim);
    claims.delete(nim);
    return c;
  }

  return function handle(body) {
    if (failNext) {
      failNext = false;
      return no(503, 'busy', 'Lagi ramai, coba lagi sebentar.');
    }
    if (!body) return view();
    const { op } = body;
    if (op === 'install') {
      if (ready) return no(409, 'exists', 'Kunci utama sudah terpasang.');
      const s = typeof body.secret === 'string' ? body.secret.trim() : '';
      if (s !== 'mock-setup-code' && !/^[A-Za-z0-9_-]{43}$/.test(s)) return no(400, 'bad-secret', 'Kunci utama harus 43 karakter base64url dan cocok dengan daftar kelas.');
      ready = true;
      note({ kind: 'install' });
      return view();
    }
    if (!['block', 'unblock', 'release', 'blockAccount', 'unblockAccount', 'add', 'remove'].includes(op)) return no(400, 'bad-op', 'Perintah admin tidak dikenal.');
    if (!ready) return no(409, 'setup', 'Pasang kunci utama dulu.');

    if (op === 'blockAccount') {
      const uid = String(body.uid || '');
      const seen = [...claims.values()].find((c) => c.uid === uid) || log.find((e) => e.uid === uid && e.email);
      if (!accounts.some((a) => a.uid === uid)) {
        accounts.push({ uid, email: seen?.email || '', gname: seen?.gname || '', at: new Date().toISOString(), by: ADMIN });
        note({ kind: op, uid, email: seen?.email || '', gname: seen?.gname || '' });
      }
      return view();
    }
    if (op === 'unblockAccount') {
      const was = accounts.find((a) => a.uid === body.uid);
      if (was) {
        accounts.splice(accounts.indexOf(was), 1);
        note({ kind: op, uid: was.uid, email: was.email, gname: was.gname });
      }
      return view();
    }

    const nim = typeof body.nim === 'string' ? body.nim : '';
    if (!/^\d{6,20}$/.test(nim)) return no(400, 'bad-nim', 'NIM cuma angka, 6 sampai 20 digit.');
    const p = people.get(nim);
    const listed = p && !p.dropped;
    if (op === 'block' || op === 'unblock') {
      if (op === 'block' && !listed) return no(404, 'not-found', 'NIM ini nggak ada di daftar kelas.');
      if (p && p.blocked !== (op === 'block')) {
        p.blocked = op === 'block';
        note({ kind: op, nim });
      }
    } else if (op === 'release') {
      const gone = release(nim);
      if (gone) note({ kind: op, nim, uid: gone.uid, email: gone.email, gname: gone.gname });
    } else if (op === 'add') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!/^[\p{L}\p{M} .'-]{2,80}$/u.test(name) || !/\p{L}/u.test(name)) return no(400, 'bad-name', 'Nama 2 sampai 80 karakter: huruf, spasi, titik, apostrof atau tanda hubung.');
      if (listed) return no(409, 'exists', 'NIM ini sudah ada di daftar.');
      // a removed classmate comes back as the class list has them
      if (p) p.dropped = false;
      else people.set(nim, { nim, name, blocked: false, added: true, dropped: false });
      note({ kind: op, nim });
    } else {
      if (!listed) return no(404, 'not-found', 'NIM ini nggak ada di daftar kelas.');
      const gone = release(nim);
      if (p.added) people.delete(nim);
      else p.dropped = true;
      note({ kind: op, nim, uid: gone?.uid, email: gone?.email, gname: gone?.gname });
    }
    return view();
  };
}

export async function createMockBackend(params) {
  const mode = params.get('mock') || 'admin';
  const cbt = createCbtMock(params.get('cbt'));
  const docs = new Map();
  const history = [];
  let user = mode === 'out' ? null : makeUser(mode);
  const listeners = new Set();

  function makeUser(m) {
    return m === 'guest'
      ? { uid: 'guest-7Qx2LmN4pR8sT1vW', email: 'tamu@example.com', name: 'Tamu', verified: true, provider: 'google.com' }
      : { uid: 'admin-K3hal1dUidExample0', email: 'admin@example.com', name: 'Admin', verified: true, provider: 'google.com' };
  }

  function write(key, json, by, note, op = 'save') {
    const cur = docs.get(key);
    if (cur) history.unshift({ id: `${key}-${cur.rev}-${+cur.updatedAt}`, key, op, rev: cur.rev, json: cur.json, at: new Date(), by, note });
    if (op === 'reset') docs.delete(key);
    else docs.set(key, { json, rev: (cur ? cur.rev : 0) + 1, updatedAt: new Date(), updatedBy: by });
  }

  if (params.get('seed') === '1') {
    const links = await loadBundled('links');
    const v1 = structuredClone(links);
    v1.channels[0].sub = 'Pengumuman dan jadwal blok.';
    write('links', JSON.stringify(v1), 'admin-K3hal1dUidExample0', 'Isi awal');
    await wait(5);
    write('links', JSON.stringify(links), 'admin-K3hal1dUidExample0', 'Deskripsi lobby diperjelas');
    write('announcements', JSON.stringify({
      v: 1,
      items: [
        { id: 'p-20261001-ospe', title: 'Pengumpulan laporan praktikum PB-4', body: 'Laporan dikumpulkan ke PJ kelompok.\nFormat PDF, nama file: NIM_Nama.', tag: 'deadline', date: '2026-10-01', due: '2026-10-17T23:59', link: 'https://drive.google.com/drive/folders/example', pinned: true },
        { id: 'p-20260930-cbt', title: 'Ujian CBT Blok 3', body: 'Datang 30 menit sebelum mulai. Bawa kartu ujian.', tag: 'ujian', date: '2026-09-30' },
      ],
    }), 'admin-K3hal1dUidExample0', '');
  }

  const emit = () => listeners.forEach((cb) => cb(user));
  const need = () => {
    if (!user || user.uid.startsWith('guest')) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    return user.uid;
  };
  const remote = (key) => {
    const d = docs.get(key);
    return d ? { exists: true, ...d } : { exists: false, rev: 0, json: null, updatedAt: null, updatedBy: null };
  };

  globalThis.__alphaMock = {
    bump(key) {
      const d = docs.get(key);
      const data = d ? JSON.parse(d.json) : null;
      if (!data) return false;
      if (key === 'links') data.channels[1].sub = 'Diubah dari tab lain.';
      if (key === 'announcements' && data.items[0]) data.items[0].title += ' (revisi)';
      write(key, JSON.stringify(data), 'admin-OtherTabUid000000', 'Dari tab lain');
      return true;
    },
    docs,
    history,
  };

  return {
    kind: 'mock',
    onAuth(cb) {
      listeners.add(cb);
      queueMicrotask(() => cb(user));
      return () => listeners.delete(cb);
    },
    async finishRedirect() {
      return null;
    },
    async signIn() {
      await wait();
      user = makeUser('admin');
      emit();
    },
    async signOut() {
      await wait(40);
      user = null;
      emit();
    },
    async token() {
      need();
      return 'mock-id-token';
    },
    async isAdmin(uid) {
      await wait();
      return uid.startsWith('admin');
    },
    async read(key) {
      await wait(60);
      need();
      return remote(key);
    },
    async save(key, { json, baseRev, note }) {
      await wait();
      const by = need();
      const cur = remote(key);
      if (cur.rev !== baseRev) throw new ConflictError(cur);
      write(key, json, by, note);
      return { rev: docs.get(key).rev };
    },
    async reset(key, { baseRev, note }) {
      await wait();
      const by = need();
      const cur = remote(key);
      if (cur.rev !== baseRev) throw new ConflictError(cur);
      if (cur.exists) write(key, null, by, note, 'reset');
      return { rev: 0 };
    },
    async history(key, n = 20) {
      await wait();
      need();
      return history.filter((h) => h.key === key).slice(0, n);
    },
    // GET /api/cbt/admin without a body, POST with one; answers { status, body }
    async cbtAdmin(body) {
      await wait(body ? 320 : 220);
      if (!user || user.uid.startsWith('guest')) return { status: 403, body: { error: 'Akun ini bukan admin.', code: 'not-admin' } };
      return cbt(body);
    },
  };
}
