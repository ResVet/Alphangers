// Portal entry. Starts the v3 shell right away, then mounts the newer sections as they come near
// the viewport, each with the freshest copy of its data (admin edits arrive through content.js).
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/v3.css';
import './styles/shell.css';
import links from './data/links.json';
import { startPortal } from './legacy/app.js';
import { load, subscribe } from './lib/content.js';
import { createTexts } from './lib/texts.js';

const portal = startPortal({ links });
// Page texts the admin changed (links document, site.t). Applied to every element with a
// data-k key, here and in each section as it mounts.
const texts = createTexts(portal);
// Subscribe once load() has answered, telling it which copy is on screen, so a remote copy
// that matches it does not rebuild the channel rows.
const watchLinks = (shown) => subscribe('links', (data) => { portal.setChannels(data); texts.set(data?.site?.t); }, shown);
load('links').then((data) => {
  if (data !== links) portal.setChannels(data);
  texts.set(data?.site?.t);
  watchLinks(data);
}, () => watchLinks());

const features = import.meta.glob([
  './features/info/info.js', './features/jadwal/jadwal.js', './features/dosen/dosen.js', './features/anatomi/anatomi.js',
  './features/divisi/divisi.js', './features/kelas/kelas.js',
]);

// Mount a feature once its section is within a screen or two of the viewport.
function whenNear(el, margin, fn) {
  if (!el) return;
  if (!('IntersectionObserver' in window)) { fn(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin: margin });
  io.observe(el);
}

function failed(root, what) {
  root.textContent = '';
  const p = document.createElement('p');
  p.className = 'feat-wait lbl';
  p.textContent = `${what} gagal dimuat. Coba muat ulang halamannya.`;
  root.append(p);
}

async function mountFeature(path, rootId, keys, exportName, label, keep = false) {
  const root = document.getElementById(rootId);
  const loader = features[path];
  if (!root || !loader) return null;
  try {
    const [mod, ...data] = await Promise.all([loader(), ...keys.map((k) => load(k))]);
    const args = Object.fromEntries(keys.map((k, i) => [k, data[i]]));
    if (!keep) root.textContent = '';
    const view = await mod[exportName](root, { ...args, portal });
    keys.forEach((k, i) => subscribe(k, async (fresh) => { args[k] = fresh; await view?.update?.({ ...args }); texts.apply(root); }, data[i]));
    texts.apply(root);
    portal.observeReveal(root);
    portal.relayout();
    return view;
  } catch (err) {
    console.error(err);
    if (!keep) failed(root, label);
    return null;
  }
}

// Each section mounts once. ensure() lets search mount one early when a result lives there.
const SECTIONS = {
  info: ['./features/info/info.js', 'info', ['announcements'], 'mountInfo', 'Pengumuman'],
  jadwal: ['./features/jadwal/jadwal.js', 'jadwalRoot', ['schedule', 'dosen'], 'mountJadwal', 'Jadwal'],
  dosen: ['./features/dosen/dosen.js', 'dosenRoot', ['schedule', 'dosen'], 'mountDosen', 'Daftar dosen'],
  anatomi: ['./features/anatomi/anatomi.js', 'anatomiRoot', ['heart'], 'mountAnatomi', 'Model jantung'],
  divisi: ['./features/divisi/divisi.js', 'divisiRoot', ['links'], 'mountDivisi', 'Divisi'],
  // the class photo is already in the page; the module only adds the full view (keep = true)
  kelas: ['./features/kelas/kelas.js', 'kelas', ['links'], 'mountKelas', 'Foto kelas', true],
};
const mounted = {};
// views by section name once mounted; the live editor reads the day on screen and such from them
const views = {};
function ensure(name) {
  if (!mounted[name]) mounted[name] = mountFeature(...SECTIONS[name]).then((v) => { views[name] = v; return v; });
  return mounted[name];
}

// The board and the schedule sit right under the hero, so they start as soon as the shell is up.
ensure('info');
ensure('jadwal');
whenNear(document.getElementById('dosen'), '900px 0px', () => ensure('dosen'));
// once the reader reaches the lecturers, fetch the heart model in the background
whenNear(document.getElementById('dosen'), '0px', () => {
  const go = () => features['./features/anatomi/anatomi.js']().then((m) => m.prefetchHeart?.(), () => {});
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500);
});
whenNear(document.getElementById('anatomi'), '700px 0px', () => ensure('anatomi'));
whenNear(document.getElementById('divisi'), '1200px 0px', () => ensure('divisi'));
whenNear(document.getElementById('kelas'), '900px 0px', () => ensure('kelas'));

// Search palette: the button, Ctrl/Cmd K, or "/" when not typing somewhere.
const findBtn = document.getElementById('findBtn');
let find = null;
async function openFind() {
  if (!find) {
    const { createFind } = await import('./features/find/find.js');
    find = createFind({ load, ensure, jump: (el) => el && portal.jumpTo(el) });
  }
  find.open();
}
if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
  const k = document.getElementById('findKey');
  if (k) k.textContent = '⌘ K';
}
findBtn?.addEventListener('click', openFind);
addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
  if (((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey)) {
    if (document.querySelector('#panel.on')) return;
    e.preventDefault();
    openFind();
  }
});

// Section links in the bar light up for the section under the reading line, a third of the way
// down the screen. An observer with a one-pixel band at that line does it without reading layout
// on scroll (the lecturer list alone is many screens tall).
const navLinks = [...document.querySelectorAll('.bar-nav a')];
if (navLinks.length && 'IntersectionObserver' in window) {
  const byId = new Map(navLinks.map((a) => [a.getAttribute('data-jump'), a]));
  const inBand = new Set();
  const paint = () => {
    // the last section in page order wins when two touch the line at a boundary
    let on = null;
    for (const a of navLinks) if (inBand.has(a.getAttribute('data-jump'))) on = a;
    navLinks.forEach((a) => a.classList.toggle('on', a === on));
  };
  const spy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) inBand.add(e.target.id);
      else inBand.delete(e.target.id);
    }
    paint();
  }, { rootMargin: '-34% 0px -65% 0px' });
  for (const id of byId.keys()) {
    const el = document.getElementById(id);
    if (el) spy.observe(el);
  }
}

// Sections grow after mounting (lists render in slices, images load). The shell keeps the page
// offsets it animates against in a cache; refresh it when the page height changes. The observer
// fires after layout, so reading positions here costs nothing extra.
if ('ResizeObserver' in window) {
  let h = 0;
  new ResizeObserver((entries) => {
    const nh = Math.round(entries[0].contentRect.height);
    if (nh !== h) { h = nh; portal.relayout(); }
  }).observe(document.getElementById('home'));
}

// Live editor for the admin (src/edit). None of it is downloaded for visitors: it loads after the
// Admin button in the footer, at /?admin, with Ctrl+Shift+E, or by itself on a device where an
// admin has signed in before (they stay signed in).
let editor = null;
function openEditor(signIn) {
  if (!editor) {
    editor = import('./edit/editor.js').then((m) => m.startEditor({
      portal, texts, views, signIn,
      bundledDivisi: () => import('./data/divisi.json').then((x) => x.default.items),
    }));
  } else if (signIn) editor.then((m) => m?.signIn?.());
  return editor;
}
document.getElementById('adminBtn')?.addEventListener('click', () => openEditor(true));
addEventListener('keydown', (e) => {
  if (!editor && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); openEditor(true); }
});
let adminHint = null;
try { adminHint = localStorage.getItem('alpha.admin'); } catch { /* blocked storage: no auto start */ }
if (/[?&]admin\b/.test(location.search) || location.hash === '#admin') openEditor(true);
else if (adminHint === '1') {
  const later = () => openEditor(false);
  if ('requestIdleCallback' in window) requestIdleCallback(later, { timeout: 3000 }); else setTimeout(later, 1500);
}

// Offline copy of the portal. Only in the built site; the dev server must never be cached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
