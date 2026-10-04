// Portal entry. Starts the v3 shell right away, then mounts the newer sections as they come near
// the viewport, each with the freshest copy of its data (admin edits arrive through content.js).
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/v3.css';
import './styles/shell.css';
import links from './data/links.json';
import { startPortal } from './legacy/app.js';
import { load, subscribe } from './lib/content.js';

const portal = startPortal({ links });
// Subscribe once load() has answered, telling it which copy is on screen, so a remote copy
// that matches it does not rebuild the channel rows.
const watchLinks = (shown) => subscribe('links', (data) => portal.setChannels(data), shown);
load('links').then((data) => {
  if (data !== links) portal.setChannels(data);
  watchLinks(data);
}, () => watchLinks());

const features = import.meta.glob(['./features/info/info.js', './features/jadwal/jadwal.js', './features/dosen/dosen.js', './features/anatomi/anatomi.js']);

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

async function mountFeature(path, rootId, keys, exportName, label) {
  const root = document.getElementById(rootId);
  const loader = features[path];
  if (!root || !loader) return null;
  try {
    const [mod, ...data] = await Promise.all([loader(), ...keys.map((k) => load(k))]);
    const args = Object.fromEntries(keys.map((k, i) => [k, data[i]]));
    root.textContent = '';
    const view = mod[exportName](root, { ...args, portal });
    keys.forEach((k, i) => subscribe(k, (fresh) => { args[k] = fresh; view?.update?.({ ...args }); }, data[i]));
    portal.observeReveal(root);
    portal.relayout();
    return view;
  } catch (err) {
    console.error(err);
    failed(root, label);
    return null;
  }
}

// Each section mounts once. ensure() lets search mount one early when a result lives there.
const SECTIONS = {
  info: ['./features/info/info.js', 'info', ['announcements'], 'mountInfo', 'Pengumuman'],
  jadwal: ['./features/jadwal/jadwal.js', 'jadwalRoot', ['schedule', 'dosen'], 'mountJadwal', 'Jadwal'],
  dosen: ['./features/dosen/dosen.js', 'dosenRoot', ['schedule', 'dosen'], 'mountDosen', 'Daftar dosen'],
  anatomi: ['./features/anatomi/anatomi.js', 'anatomiRoot', ['heart'], 'mountAnatomi', 'Model jantung'],
};
const mounted = {};
function ensure(name) {
  if (!mounted[name]) mounted[name] = mountFeature(...SECTIONS[name]);
  return mounted[name];
}

// The board and the schedule sit right under the hero, so they start as soon as the shell is up.
ensure('info');
ensure('jadwal');
whenNear(document.getElementById('dosen'), '900px 0px', () => ensure('dosen'));
whenNear(document.getElementById('anatomi'), '700px 0px', () => ensure('anatomi'));

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

// Section links in the bar light up for the section under the reading line (a third of the way
// down the screen). Ratios do not work here: the lecturer list is many screens tall.
const navLinks = [...document.querySelectorAll('.bar-nav a')];
if (navLinks.length) {
  const targets = navLinks.map((a) => [a, document.getElementById(a.getAttribute('data-jump'))]).filter(([, el]) => el);
  let queued = false;
  const spy = () => {
    queued = false;
    const line = innerHeight * 0.34;
    let on = null;
    for (const [a, el] of targets) {
      const r = el.getBoundingClientRect();
      if (r.top <= line && r.bottom > line) on = a;
    }
    navLinks.forEach((a) => a.classList.toggle('on', a === on));
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(spy); } };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  spy();
}

// Keep the scroll progress line and other measurements right when sections grow after mounting.
if ('ResizeObserver' in window) {
  let t = 0;
  new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => portal.relayout(), 160); })
    .observe(document.getElementById('home'));
}

// Offline copy of the portal. Only in the built site; the dev server must never be cached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
