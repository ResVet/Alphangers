// The live editor. Loaded only for the admin: after the "Admin" button in the footer, a visit to
// /?admin, Ctrl+Shift+E, or automatically on a device where an admin signed in before.
//
// It signs in with Google (Firebase Auth), checks /admins/{uid} like the admin page does, loads
// every content document with its revision, and puts a dock at the bottom of the screen:
// view or edit mode, undo and redo, the number of unpublished changes, and Publish.
// Publishing writes through the same transaction as /admin/ (history snapshot plus optimistic
// revision check), so every published change can be reviewed and rolled back there.
import './edit.css';
import { firebaseConfig, appCheckSiteKey } from '../lib/firebase-config.js';
import { createStore } from './store.js';
import { createOverlay } from './overlay.js';
import { ADAPTERS, textsPanel } from './adapters.js';
import { h, confirmDialog, alertDialog, chooseDialog } from './sheet.js';
import { explain } from '../admin/errors.js';

const HINT = 'alpha.admin';
const MODE = 'alpha.admin.mode';
const KEY_NAMES = { links: 'Halaman, Drive dan divisi', announcements: 'Pengumuman', schedule: 'Jadwal', dosen: 'Dosen', heart: 'Catatan jantung' };

function ls(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch { /* storage blocked: the editor just won't reopen by itself */ }
  return null;
}
function ss(k, v) {
  try {
    if (v === undefined) return sessionStorage.getItem(k);
    sessionStorage.setItem(k, v);
  } catch { /* ignore */ }
  return null;
}

let started = null;
export function startEditor(opts) {
  if (!started) started = run(opts);
  else if (opts.signIn) started.then((api) => api?.signIn());
  return started;
}

async function createBackend() {
  if ((import.meta.env.DEV || import.meta.env.MODE === 'mock') && /[?&]mock\b/.test(location.search)) {
    const { createMockBackend } = await import('../admin/backend-mock.js');
    return createMockBackend(new URLSearchParams(location.search));
  }
  if (!firebaseConfig) return null;
  const { createFirebaseBackend } = await import('../admin/backend-firebase.js');
  return createFirebaseBackend(firebaseConfig, appCheckSiteKey);
}

async function run({ portal, texts, views, bundledDivisi, signIn: wantSignIn }) {
  const toast = (m) => portal.toast(m);
  const dock = h('div', { class: 'ed-ui ed-dock', role: 'region', 'aria-label': 'Editor' });
  document.body.append(dock);
  const say = (...kids) => { dock.textContent = ''; dock.append(...kids); dock.classList.add('is-in'); };
  const close = () => h('button', { type: 'button', class: 'ed-ib is-x', 'aria-label': 'Tutup editor', onclick: () => { dock.classList.remove('is-in'); ls(HINT, null); } }, '×');
  if (wantSignIn) say(h('span', { class: 'ed-dock-t', text: 'Menyambung ke Firebase…' }));

  let backend;
  try {
    backend = await createBackend();
  } catch (e) {
    say(h('span', { class: 'ed-dock-t', text: 'Firebase gagal dimuat: ' + explain(e) }), close());
    return null;
  }
  if (!backend) { say(h('span', { class: 'ed-dock-t', text: 'Firebase belum diatur. Lihat docs/FIREBASE_SETUP.md.' }), close()); return null; }

  const api = { signIn: () => backend.signIn().catch((e) => alertDialog('Login gagal', explain(e))) };
  const redirectErr = await backend.finishRedirect?.();
  if (redirectErr) toast('Login gagal: ' + explain(redirectErr));

  let ready = false;
  backend.onAuth(async (user) => {
    if (ready && !user) { location.reload(); return; }
    if (ready) return;
    if (!user) {
      ls(HINT, null);
      if (!wantSignIn) { dock.remove(); return; }
      say(h('span', { class: 'ed-dock-t', text: 'Masuk sebagai admin buat mengubah halaman ini.' }),
        h('button', { type: 'button', class: 'ed-btn is-pri', onclick: api.signIn }, 'Masuk dengan Google'), close());
      return;
    }
    say(h('span', { class: 'ed-dock-t', text: 'Mengecek akses admin…' }));
    let admin = false;
    try {
      admin = user.verified && user.provider === 'google.com' && (await backend.isAdmin(user.uid));
    } catch (e) {
      say(h('span', { class: 'ed-dock-t', text: 'Cek admin gagal: ' + explain(e) }), close());
      return;
    }
    if (!admin) {
      ls(HINT, null);
      say(h('span', { class: 'ed-dock-t', text: (user.email || 'Akun ini') + ' bukan admin.' }),
        h('button', { type: 'button', class: 'ed-btn', onclick: () => backend.signOut() }, 'Ganti akun'), close());
      return;
    }
    ls(HINT, '1');
    say(h('span', { class: 'ed-dock-t', text: 'Memuat isi halaman…' }));
    let store;
    try {
      store = await createStore(backend);
    } catch (e) {
      say(h('span', { class: 'ed-dock-t', text: 'Isi halaman gagal dimuat: ' + explain(e) }), close());
      return;
    }
    ready = true;
    await admin_(user, store);
  }, (e) => say(h('span', { class: 'ed-dock-t', text: 'Login gagal dicek: ' + explain(e) }), close()));

  async function admin_(user, store) {
    const ctx = {
      store,
      views,
      texts,
      toast,
      bundledDivisi: await bundledDivisi(),
      token: () => backend.token(),
      progress(text) {
        prog.textContent = text || '';
        prog.hidden = !text;
        return (t) => { prog.textContent = t || ''; prog.hidden = !t; };
      },
      // a [data-k] text typed on the page
      setText(key, value, el) {
        const def = texts.original(el);
        return store.edit('links', (d) => {
          d.site = d.site || { t: {} };
          d.site.t = d.site.t || {};
          if (!value.trim() || value === def) delete d.site.t[key];
          else d.site.t[key] = value;
        }, 'Teks');
      },
      // a divisi field typed in place (name, full, tag, desc)
      setField(el, value) {
        const id = el.closest('.dv-ch')?.dataset.id;
        const f = el.dataset.f;
        if (!id || !f) return null;
        const base = ctx.bundledDivisi;
        return store.edit('links', (d) => {
          if (!Array.isArray(d.divisi)) d.divisi = structuredClone(base);
          const x = d.divisi.find((y) => y.id === id);
          if (!x) return false;
          x[f] = value.trim();
        }, 'Teks divisi');
      },
    };

    const overlay = createOverlay({ adapters: ADAPTERS, ctx });

    // ---------- dock
    const modeView = h('button', { type: 'button', class: 'ed-seg', 'aria-pressed': 'true', onclick: () => setMode(false) }, 'Lihat');
    const modeEdit = h('button', { type: 'button', class: 'ed-seg', 'aria-pressed': 'false', onclick: () => setMode(true) }, 'Edit');
    const undoB = h('button', { type: 'button', class: 'ed-ib', 'aria-label': 'Urungkan (Ctrl+Z)', title: 'Urungkan (Ctrl+Z)', onclick: () => step(-1) }, '↶');
    const redoB = h('button', { type: 'button', class: 'ed-ib', 'aria-label': 'Ulangi (Ctrl+Shift+Z)', title: 'Ulangi (Ctrl+Shift+Z)', onclick: () => step(1) }, '↷');
    const count = h('span', { class: 'ed-count', 'aria-live': 'polite' });
    const pubN = h('span', { class: 'ed-n', 'aria-hidden': 'true' });
    const pub = h('button', { type: 'button', class: 'ed-btn is-pri ed-pub', onclick: publish }, 'Terbitkan', pubN);
    const prog = h('span', { class: 'ed-prog', hidden: true });
    const menuB = h('button', { type: 'button', class: 'ed-ib', 'aria-label': 'Menu editor', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => toggleMenu() }, '⋯');
    const who = h('span', { class: 'ed-who', title: user.email, text: (user.name || user.email || 'A').trim().charAt(0).toUpperCase() });
    const menu = h('div', { class: 'ed-menu', role: 'menu', hidden: true },
      h('p', { class: 'ed-menu-k', text: user.email }),
      h('button', { type: 'button', role: 'menuitem', onclick: () => { toggleMenu(false); textsPanel(ctx); } }, 'Semua teks halaman'),
      h('a', { role: 'menuitem', href: '/admin/', target: '_blank', rel: 'noopener' }, 'Panel admin: riwayat dan JSON'),
      h('button', { type: 'button', role: 'menuitem', onclick: () => { toggleMenu(false); discardAll(); } }, 'Buang semua draf'),
      h('button', { type: 'button', role: 'menuitem', onclick: () => { toggleMenu(false); dock.classList.toggle('is-min'); } }, 'Kecilkan dock'),
      h('button', { type: 'button', role: 'menuitem', onclick: async () => {
        toggleMenu(false);
        if (store.dirtyKeys().length && !(await confirmDialog('Keluar dari akun admin?', 'Draf yang belum diterbitkan tetap tersimpan di perangkat ini.', { ok: 'Keluar' }))) return;
        ls(HINT, null);
        await backend.signOut();
      } }, 'Keluar'));
    dock.textContent = '';
    dock.append(
      h('button', { type: 'button', class: 'ed-min', 'aria-label': 'Buka dock editor', onclick: () => dock.classList.remove('is-min') }, 'Admin'),
      h('div', { class: 'ed-dock-in' },
        who,
        h('div', { class: 'ed-segs', role: 'group', 'aria-label': 'Mode' }, modeView, modeEdit),
        h('span', { class: 'ed-div' }),
        undoB, redoB,
        prog, count, pub, menuB, menu));
    dock.classList.add('is-in', 'is-admin');
    document.documentElement.classList.add('ed-on');

    function toggleMenu(open = menu.hidden) {
      menu.hidden = !open;
      menuB.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector('[role=menuitem]')?.focus();
    }
    document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.ed-menu, [aria-haspopup=menu]')) toggleMenu(false); });

    function paint() {
      const dirty = store.dirtyKeys();
      count.textContent = dirty.length ? dirty.length + ' bagian berubah' : 'Tersimpan';
      count.classList.toggle('is-dirty', dirty.length > 0);
      pub.disabled = !dirty.length;
      pubN.textContent = dirty.length ? String(dirty.length) : '';
      undoB.disabled = !store.canUndo();
      redoB.disabled = !store.canRedo();
    }
    store.onChange(paint);
    paint();

    function setMode(edit) {
      modeEdit.setAttribute('aria-pressed', String(edit));
      modeView.setAttribute('aria-pressed', String(!edit));
      overlay.setOn(edit);
      ss(MODE, edit ? 'edit' : 'view');
      if (edit) toast('Mode edit: ketuk teks buat mengetik, ketuk kartu buat aksinya.');
    }

    function step(d) {
      const label = d < 0 ? store.undo() : store.redo();
      if (label) toast((d < 0 ? 'Diurungkan: ' : 'Diulang: ') + label);
    }

    async function publish() {
      const dirty = store.dirtyKeys();
      if (!dirty.length) return;
      const ok = await confirmDialog('Terbitkan perubahan?', 'Yang berubah: ' + dirty.map((k) => KEY_NAMES[k] || k).join(', ') + '. Semua pengunjung dapat versi baru saat membuka halaman. Versi lama tetap ada di riwayat panel admin.', { ok: 'Terbitkan' });
      if (!ok) return;
      pub.disabled = true;
      const note = ctx.progress('Menerbitkan…');
      try {
        await store.publish({
          uid: user.uid,
          note: 'Edit langsung dari halaman',
          onConflict: (key) => chooseDialog('Ada versi yang lebih baru',
            KEY_NAMES[key] + ' diubah dari tempat lain setelah kamu mulai mengedit.', [
              { label: 'Pakai punyaku (timpa versi itu)', value: 'mine', kind: 'is-pri' },
              { label: 'Pakai versi terbaru (buang draf bagian ini)', value: 'theirs' },
            ]).then((v) => v || 'theirs'),
        });
        toast('Terbit. Pengunjung dapat versi baru saat membuka halaman.');
      } catch (e) {
        alertDialog('Gagal menerbitkan', e.errors ? e.errors.map((x) => x.msg) : explain(e) + ' Draf kamu masih aman di perangkat ini.');
      } finally {
        note(null);
        paint();
      }
    }

    async function discardAll() {
      if (!store.dirtyKeys().length) return toast('Tidak ada draf.');
      if (!(await confirmDialog('Buang semua draf?', 'Halaman kembali ke versi yang sudah terbit.', { ok: 'Buang', danger: true }))) return;
      store.discard();
      toast('Draf dibuang.');
    }

    // keyboard: undo, redo, publish, edit mode
    addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const typing = e.target.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
      const k = e.key.toLowerCase();
      if (k === 'z' && !typing) { e.preventDefault(); step(e.shiftKey ? 1 : -1); }
      else if (k === 'y' && !typing) { e.preventDefault(); step(1); }
      else if (k === 's') { e.preventDefault(); publish(); }
      else if (k === 'e' && e.shiftKey) { e.preventDefault(); setMode(!overlay.on); }
    });
    addEventListener('beforeunload', (e) => { if (store.dirtyKeys().length) e.preventDefault(); });

    // drafts from an earlier visit on this device
    const pend = store.pending();
    if (pend.length) {
      const yes = await confirmDialog('Lanjutkan draf sebelumnya?', 'Ada perubahan yang belum diterbitkan di: ' + pend.map((k) => KEY_NAMES[k] || k).join(', ') + '.', { ok: 'Pulihkan', cancel: 'Buang' });
      if (yes) store.restorePending(); else store.dropPending();
    }
    setMode(ss(MODE) === 'edit');
    paint();
  }

  return api;
}
