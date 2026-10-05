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
//
// window.__alphaMock.bump(key) simulates a save from another tab.
import { ConflictError } from './errors.js';
import { loadBundled } from '../lib/content.js';

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export async function createMockBackend(params) {
  const mode = params.get('mock') || 'admin';
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
  };
}
