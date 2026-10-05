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
// Inside the portal's editor (the dock's "Panel" view). Drafts then belong to both editors:
// the ones written on the page are taken over without asking, and the portal asks for this
// side's drafts to be written out before it switches back.
const EMBED = params.has('embed') && window.parent !== window;
if (EMBED) document.documentElement.classList.add('embed');

async function createBackend() {
  // The mock exists only in `vite` dev and in builds made with --mode mock.
  // In a normal production build both checks are constant false, so Vite
  // drops this branch and the mock module never ships.
  if ((import.meta.env.DEV || import.meta.env.MODE === 'mock') && params.has('mock')) {
    const { createMockBackend } = await import('./backend-mock.js');
    return createMockBackend(params);
  }
  // Same dev-only gate: ?setup shows the guide a fresh clone sees before Firebase is set.
  if ((import.meta.env.DEV || import.meta.env.MODE === 'mock') && params.has('setup')) return null;
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

function renderFailure(title, e) {
  replace(
    root,
    h(
      'main',
      { id: 'main', class: 'gate' },
      h('div', { class: 'gate-card' }, h('h1', null, title), h('p', { class: 'err-text' }, explain(e)), h('button', { type: 'button', class: 'btn', onclick: () => location.reload() }, 'Coba lagi')),
    ),
  );
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
  // Shown once, on the first sign-in screen; a later sign-out starts clean.
  let redirectError = await backend.finishRedirect();
  let started = false;

  const onAuthError = (e) => {
    if (!started) renderFailure('Login gagal dicek', e);
  };

  backend.onAuth(async (user) => {
    if (!user) {
      if (started) location.reload(); // signed out mid-session: start clean
      else {
        renderSignIn(root, backend, redirectError);
        redirectError = null;
      }
      return;
    }
    if (started) return;
    renderLoading(root, 'Mengecek akses admin…');
    let admin = false;
    let reason = 'not-admin';
    let error = null;
    try {
      if (!user.verified) reason = 'unverified';
      else if (user.provider !== 'google.com') reason = 'provider';
      else admin = await backend.isAdmin(user.uid);
    } catch (e) {
      reason = 'error';
      error = e;
    }
    if (!admin) {
      renderNotAdmin(root, backend, user, reason, error);
      return;
    }
    renderLoading(root, 'Memuat konten…');
    try {
      const docs = await loadDocs(backend);
      started = true;
      if (EMBED) {
        for (const d of Object.values(docs)) if (d.pending) d.restorePending();
        window.addEventListener('message', (e) => {
          if (e.origin !== location.origin || e.source !== window.parent || e.data?.type !== 'alpha:flush') return;
          for (const d of Object.values(docs)) d.flushDraft();
          e.source.postMessage({ type: 'alpha:flushed', id: e.data.id }, location.origin);
        });
      }
      const { startApp } = await import('./app.js');
      startApp(root, { backend, user, docs, embed: EMBED });
    } catch (e) {
      renderFailure('Konten gagal dimuat', e);
    }
  }, onAuthError);
}

boot();
