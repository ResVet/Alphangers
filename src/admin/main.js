// Admin entry point. Decides between the setup guide, sign-in, "not an
// admin", and the editor, and loads all five documents before showing it.
import '../styles/fonts.css';
import '../styles/tokens.css';
import './admin.css';
import { firebaseConfig, appCheckSiteKey } from '../lib/firebase-config.js';
import { KEYS, loadBundled } from '../lib/content.js';
import { DocState } from './doc-state.js';
import { renderSetup, renderLoading, renderSignIn, renderNotAdmin } from './screens.js';
import { explain } from './errors.js';
import { h, replace } from './dom.js';

const root = document.getElementById('app');
const params = new URLSearchParams(location.search);

async function createBackend() {
  // The mock exists only in `vite` dev and in builds made with --mode mock.
  // In a normal production build both checks are constant false, so Vite
  // drops this branch and the mock module never ships.
  if ((import.meta.env.DEV || import.meta.env.MODE === 'mock') && params.has('mock')) {
    const { createMockBackend } = await import('./backend-mock.js');
    return createMockBackend(params);
  }
  if (!firebaseConfig) return null;
  const { createFirebaseBackend } = await import('./backend-firebase.js');
  return createFirebaseBackend(firebaseConfig, appCheckSiteKey);
}

async function loadDocs(backend) {
  const docs = {};
  await Promise.all(
    KEYS.map(async (key) => {
      const [bundled, remote] = await Promise.all([loadBundled(key), backend.read(key)]);
      const doc = new DocState(key, bundled);
      doc.setBase(remote);
      docs[key] = doc;
    }),
  );
  // Keep the tab order the same as KEYS.
  return Object.fromEntries(KEYS.map((k) => [k, docs[k]]));
}

async function boot() {
  let backend;
  try {
    backend = await createBackend();
  } catch (e) {
    replace(root, h('main', { id: 'main', class: 'gate' }, h('div', { class: 'gate-card' }, h('h1', null, 'Firebase gagal dimuat'), h('p', { class: 'err-text' }, explain(e)))));
    return;
  }
  if (!backend) {
    renderSetup(root);
    return;
  }

  renderLoading(root, 'Mengecek login…');
  const redirectError = await backend.finishRedirect();
  let started = false;

  backend.onAuth(async (user) => {
    if (!user) {
      if (started) location.reload(); // signed out mid-session: start clean
      else renderSignIn(root, backend, redirectError);
      return;
    }
    if (started) return;
    renderLoading(root, 'Mengecek akses admin…');
    let admin = false;
    let reason = 'not-admin';
    try {
      if (!user.verified) reason = 'unverified';
      else if (user.provider !== 'google.com') reason = 'provider';
      else admin = await backend.isAdmin(user.uid);
    } catch {
      reason = 'error';
    }
    if (!admin) {
      renderNotAdmin(root, backend, user, reason);
      return;
    }
    renderLoading(root, 'Memuat konten…');
    try {
      const docs = await loadDocs(backend);
      started = true;
      const { startApp } = await import('./app.js');
      startApp(root, { backend, user, docs });
    } catch (e) {
      replace(
        root,
        h(
          'main',
          { id: 'main', class: 'gate' },
          h('div', { class: 'gate-card' }, h('h1', null, 'Konten gagal dimuat'), h('p', { class: 'err-text' }, explain(e)), h('button', { type: 'button', class: 'btn', onclick: () => location.reload() }, 'Coba lagi')),
        ),
      );
    }
  });
}

boot();
