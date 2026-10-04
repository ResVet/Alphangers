// The screens before the editor: setup guide, loading, sign-in, not an admin.
import { h, replace } from './dom.js';
import { copyText, toast } from './ui.js';
import { explain } from './errors.js';

function brand() {
  return h('p', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'Alphangers'), h('span', { class: 'brand-sub' }, 'Admin'));
}

function card(...children) {
  return h('main', { id: 'main', class: 'gate' }, h('div', { class: 'gate-card' }, brand(), ...children));
}

const code = (t) => h('code', null, t);

export function renderSetup(root) {
  const steps = [
    ['Buat project di ', h('a', { href: 'https://console.firebase.google.com/', target: '_blank', rel: 'noopener noreferrer' }, 'console.firebase.google.com'), '. Google Analytics boleh dimatikan.'],
    ['Authentication, tab Sign-in method: aktifkan ', h('b', null, 'Google'), '.'],
    ['Firestore Database: Create database, pilih ', h('b', null, 'production mode'), ', lokasi asia-southeast2 (Jakarta).'],
    ['Project settings, Your apps: tambah Web app, salin config-nya ke ', code('src/lib/firebase-config.js'), '.'],
    ['Pasang rules dan index: ', code('npx firebase deploy --only firestore'), '.'],
    ['Authentication, Settings, Authorized domains: tambahkan domain Netlify kamu.'],
    ['Deploy ulang, buka /admin/, login, salin UID kamu, lalu buat dokumen ', code('admins/{UID}'), ' di Firestore.'],
  ];
  replace(
    root,
    card(
      h('h1', null, 'Firebase belum disambungkan'),
      h('p', { class: 'lede' }, 'Halaman ini butuh project Firebase dulu. Selama belum ada, portal tetap jalan pakai data bawaan dari repo.'),
      h('ol', { class: 'steps' }, steps.map((s) => h('li', null, h('span', null, s)))),
      h('p', { class: 'hint' }, 'Panduan lengkap, termasuk App Check dan pembatasan API key, ada di ', code('docs/FIREBASE_SETUP.md'), '.'),
    ),
  );
}

export function renderLoading(root, text = 'Memuat…') {
  replace(root, h('main', { id: 'main', class: 'gate', 'aria-busy': 'true' }, h('div', { class: 'gate-card loading' }, brand(), h('p', { class: 'meta', role: 'status' }, text))));
}

export function renderSignIn(root, backend, error) {
  const msg = h('p', { class: 'err-text', role: 'alert' }, error ? explain(error) : '');
  const btn = h('button', { type: 'button', class: 'btn primary lg' }, 'Masuk dengan Google');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    msg.textContent = '';
    try {
      await backend.signIn();
    } catch (e) {
      msg.textContent = explain(e);
    } finally {
      btn.disabled = false;
    }
  });
  replace(
    root,
    card(
      h('h1', null, 'Masuk dulu'),
      h('p', { class: 'lede' }, 'Pakai akun Google kamu. Cuma akun yang terdaftar sebagai admin yang bisa mengubah isi portal.'),
      btn,
      msg,
    ),
  );
  btn.focus();
}

export function renderNotAdmin(root, backend, user, reason) {
  const uidBox = h('input', { type: 'text', readOnly: true, value: user.uid, class: 'mono uid', id: 'uid-box' });
  const copyBtn = h('button', { type: 'button', class: 'btn' }, 'Salin UID');
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(user.uid, uidBox);
    toast(ok ? 'UID disalin.' : 'Tidak bisa menyalin otomatis. UID sudah dipilih, tekan Ctrl+C.', ok ? 'ok' : 'warn');
  });
  const why =
    reason === 'unverified'
      ? 'Email akun ini belum terverifikasi, jadi tidak bisa jadi admin.'
      : reason === 'provider'
        ? 'Admin harus masuk lewat Google.'
        : reason === 'error'
          ? 'Status admin tidak bisa dicek. Pastikan rules Firestore sudah di-deploy.'
          : 'Akun ini belum terdaftar sebagai admin.';
  replace(
    root,
    card(
      h('h1', null, 'Belum bisa masuk'),
      h('p', { class: 'lede' }, why),
      h('p', { class: 'meta' }, `Masuk sebagai ${user.email || user.name || 'akun tanpa email'}.`),
      h('div', { class: 'fld' }, h('label', { htmlFor: 'uid-box' }, 'UID kamu'), h('div', { class: 'uid-row' }, uidBox, copyBtn)),
      h(
        'details',
        { class: 'panel' },
        h('summary', null, 'Cara mendaftarkan akun ini sebagai admin'),
        h(
          'ol',
          { class: 'steps' },
          h('li', null, h('span', null, 'Buka Firestore Database di console Firebase.')),
          h('li', null, h('span', null, 'Start collection dengan ID ', code('admins'), '.')),
          h('li', null, h('span', null, 'Document ID: tempel UID di atas. Tambah satu field, misalnya ', code('role'), ' berisi ', code('owner'), '.')),
          h('li', null, h('span', null, 'Simpan, lalu muat ulang halaman ini.')),
        ),
        h('p', { class: 'hint' }, 'Dokumen admin cuma bisa dibuat dari console. Dari situs, tidak ada yang bisa menulis ke sana.'),
      ),
      h(
        'div',
        { class: 'row-actions left' },
        h('button', { type: 'button', class: 'btn', onclick: () => location.reload() }, 'Muat ulang'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => backend.signOut() }, 'Keluar'),
      ),
    ),
  );
}
