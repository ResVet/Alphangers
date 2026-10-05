// Divisi: one chapter per division, in the order the class lists them. Each chapter has a deck of
// three prints (the division's main photos) that can be flipped through with the arrows, a swipe
// or the keyboard, and a full view with every photo, the whole description and zoom.
// The data lives in the links document (field "divisi"); without it the bundled list is used.
import './divisi.css';
import { pictureHTML, watchLoaded } from '../../lib/photo.js';
import { getViewer } from '../viewer/viewer.js';

const SLOTS = 3;
const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const EASE = 'cubic-bezier(.32,.72,0,1)';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const two = (n) => String(n).padStart(2, '0');

let bundled = null;
async function defaults() {
  if (!bundled) bundled = (await import('../../data/divisi.json')).default.items;
  return bundled;
}

/** The divisi list to show: the edited one from the links document, or the bundled one. */
export async function divisiOf(links) {
  return Array.isArray(links?.divisi) ? links.divisi : defaults();
}

export async function mountDivisi(root, { links }) {
  let items = await divisiOf(links);
  const decks = new Map(); // id -> { at }
  root.classList.add('dv');

  function render() {
    const n = items.length;
    root.innerHTML =
      '<header class="dv-head wrap">' +
        '<h2 class="dv-h rv"><span data-k="divisi.h1">orang-orang di balik</span> <em data-k="divisi.h2">kelas ini.</em></h2>' +
        '<p class="dv-lede rv" style="--d:.1s" data-k="divisi.lede">' + esc(n === 8 ? 'Delapan divisi, satu kelas. Ini mereka yang ngurus Class Alpha di balik layar.' : 'Divisi Class Alpha, yang ngurus kelas di balik layar.') + '</p>' +
      '</header>' +
      '<nav class="dv-index" aria-label="Lompat ke divisi"><div class="dv-index-in">' +
        items.map((d, i) => '<a class="dv-ix" href="#dv-' + esc(d.id) + '" data-ix="' + esc(d.id) + '"><span>' + two(i + 1) + '</span>' + esc(d.name) + '</a>').join('') +
      '</div></nav>' +
      '<div class="dv-list">' + items.map((d, i) => chapterHTML(d, i, n)).join('') + '</div>';
    watchLoaded(root);
    for (const d of items) {
      const prev = decks.get(d.id);
      decks.set(d.id, { at: prev ? Math.min(prev.at, SLOTS - 1) : 0 });
      place(d.id, false);
    }
    observe();
  }

  function chapterHTML(d, i, n) {
    const photos = d.photos || [];
    const lead = photos[0];
    const amb = lead?.lq ? '<i style="background-image:url(' + esc(lead.lq) + ')"></i>' : '<i class="dv-amb-none"></i>';
    const prints = [];
    for (let k = 0; k < SLOTS; k++) prints.push(printHTML(d, photos[k], k));
    const extra = Math.max(0, photos.length - SLOTS);
    return '<article class="dv-ch" id="dv-' + esc(d.id) + '" data-id="' + esc(d.id) + '" style="--glow:' + esc(lead?.bg || '#1d4a16') + '">' +
      '<div class="dv-amb" aria-hidden="true">' + amb + '</div>' +
      '<div class="dv-copy">' +
        '<p class="dv-no" aria-hidden="true"><b>' + two(i + 1) + '</b><span>/ ' + two(n) + '</span></p>' +
        '<h3 class="dv-name" data-f="name">' + esc(d.name) + '</h3>' +
        (d.full ? '<p class="dv-full" data-f="full">' + esc(d.full) + '</p>' : '') +
        (d.tag ? '<p class="dv-tag" data-f="tag">' + esc(d.tag) + '</p>' : '') +
        (d.desc ? '<p class="dv-desc" data-f="desc">' + esc(d.desc) + '</p>' : '') +
        '<div class="dv-ctl">' +
          '<button type="button" class="dv-arrow" data-step="-1" aria-label="Foto sebelumnya"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg></button>' +
          '<p class="dv-pos" aria-live="polite"><b>1</b><span> / ' + SLOTS + '</span></p>' +
          '<button type="button" class="dv-arrow" data-step="1" aria-label="Foto berikutnya"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg></button>' +
          (photos.length ? '<button type="button" class="dv-more" data-open="0">Lihat semua foto' + (extra ? ' <span>+' + extra + '</span>' : '') + '</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="dv-deck" role="group" aria-roledescription="tumpukan foto" aria-label="Foto ' + esc(d.name) + '" tabindex="-1">' +
        '<div class="dv-tilt">' + prints.join('') + '</div>' +
      '</div>' +
    '</article>';
  }

  function printHTML(d, ph, k) {
    if (!ph) {
      return '<figure class="dv-print is-empty" data-i="' + k + '" data-empty>' +
        '<div class="dv-pic"><span class="dv-blank" aria-hidden="true"><b>' + esc(d.name) + '</b></span><span class="dv-soon">Foto menyusul</span></div>' +
        '</figure>';
    }
    return '<figure class="dv-print" data-i="' + k + '">' +
      '<button type="button" class="dv-pic" data-open="' + k + '" aria-label="Buka foto ' + (k + 1) + ' divisi ' + esc(d.name) + '">' +
        pictureHTML(ph, { sizes: '(min-width: 900px) min(50vw, 760px), 86vw' }) + '</button>' +
      (ph.cap ? '<figcaption class="dv-cap">' + esc(ph.cap) + '</figcaption>' : '') +
      '</figure>';
  }

  // ---------- the deck
  // slot 0 is the front print; the others fan out behind it
  function place(id, animate, dir = 0) {
    const ch = root.querySelector('.dv-ch[data-id="' + CSS.escape(id) + '"]');
    if (!ch) return;
    const { at } = decks.get(id);
    const prints = [...ch.querySelectorAll('.dv-print')];
    prints.forEach((p, k) => {
      const slot = (k - at + SLOTS) % SLOTS;
      const was = +(p.dataset.slot ?? slot);
      p.dataset.slot = slot;
      p.style.zIndex = String(SLOTS - slot);
      p.inert = slot !== 0;
      if (!animate || RM()) return;
      // the print that leaves the front is tossed aside and slides in at the back; the one that
      // comes back from the back on "previous" takes the same path in reverse
      if ((dir > 0 && was === 0) || (dir < 0 && slot === 0)) {
        const out = dir > 0;
        p.style.zIndex = out ? '9' : String(SLOTS);
        const side = 'translate3d(-62%, 4%, 60px) rotate(-11deg) rotateY(16deg)';
        p.animate(
          out ? [{ transform: slotTransform(0), offset: 0 }, { transform: side, offset: 0.42 }, { transform: slotTransform(slot), offset: 1 }]
            : [{ transform: slotTransform(was), offset: 0 }, { transform: side, offset: 0.5 }, { transform: slotTransform(0), offset: 1 }],
          { duration: 780, easing: EASE },
        );
        // tuck it behind the others once it is out of their way
        setTimeout(() => { if (p.isConnected) p.style.zIndex = String(SLOTS - +p.dataset.slot); }, out ? 330 : 0);
      }
    });
    const real = (decksPhotos(id) || []).length;
    const pos = ch.querySelector('.dv-pos b');
    if (pos) pos.textContent = String(at + 1);
    ch.dataset.real = String(Math.min(real, SLOTS));
  }
  function slotTransform(slot) {
    return getComputedStyle(root).getPropertyValue('--dv-s' + slot).trim() || 'none';
  }
  function decksPhotos(id) {
    return items.find((d) => d.id === id)?.photos;
  }
  function step(id, d) {
    const st = decks.get(id);
    if (!st) return;
    st.at = (st.at + d + SLOTS) % SLOTS;
    place(id, true, d);
  }

  // ---------- full view
  function openViewer(id, slot, fromEl) {
    const d = items.find((x) => x.id === id);
    const photos = (d?.photos || []).filter(Boolean);
    if (!photos.length) return;
    getViewer().open({
      photos,
      index: Math.min(slot, photos.length - 1),
      kick: 'Divisi ' + two(items.indexOf(d) + 1),
      title: d.name,
      sub: d.full,
      desc: d.desc,
      from: fromEl?.querySelector('img') || null,
      owner: { kind: 'divisi', id },
    });
  }

  // ---------- events
  root.addEventListener('click', (e) => {
    const ch = e.target.closest('.dv-ch');
    const s = e.target.closest('[data-step]');
    if (s && ch) return step(ch.dataset.id, +s.dataset.step);
    const o = e.target.closest('[data-open]');
    if (o && ch) {
      const k = +o.dataset.open;
      // the print in front stands for the photo the reader is looking at
      const slot = o.classList.contains('dv-more') ? decks.get(ch.dataset.id).at : k;
      const fromEl = o.classList.contains('dv-more') ? ch.querySelector('.dv-print[data-slot="0"] .dv-pic') : o;
      return openViewer(ch.dataset.id, slot, fromEl);
    }
    const ix = e.target.closest('[data-ix]');
    if (ix) {
      e.preventDefault();
      const target = root.querySelector('#dv-' + CSS.escape(ix.dataset.ix));
      target?.scrollIntoView({ behavior: RM() ? 'auto' : 'smooth', block: 'start' });
    }
  });
  root.addEventListener('keydown', (e) => {
    const ch = e.target.closest('.dv-ch');
    if (!ch || e.target.closest('input, textarea, [contenteditable="true"]')) return;
    if (!e.target.closest('.dv-deck, .dv-ctl')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(ch.dataset.id, 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(ch.dataset.id, -1); }
  });

  // swipe the deck sideways on touch screens; vertical drags stay page scrolls (touch-action: pan-y)
  let sw = null;
  root.addEventListener('pointerdown', (e) => {
    const deck = e.target.closest('.dv-deck');
    if (!deck || e.pointerType === 'mouse') return;
    sw = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: deck.closest('.dv-ch').dataset.id };
  });
  root.addEventListener('pointerup', (e) => {
    if (!sw) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y, dt = e.timeStamp - sw.t;
    const id = sw.id;
    sw = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 700) {
      step(id, dx < 0 ? 1 : -1);
      // a swipe is not a tap on the photo
      const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      root.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => root.removeEventListener('click', stop, { capture: true }), 400);
    }
  });
  root.addEventListener('pointercancel', () => { sw = null; });

  // the deck leans toward a mouse; one transform write per frame on the hovered deck only
  let tiltEl = null, tiltF = 0, tx = 0, ty = 0;
  if (FINE() && !RM()) {
    root.addEventListener('pointermove', (e) => {
      const deck = e.target.closest('.dv-deck');
      const tilt = deck?.querySelector('.dv-tilt') || null;
      if (tilt !== tiltEl) {
        if (tiltEl) tiltEl.style.transform = '';
        tiltEl = tilt;
      }
      if (!deck) return;
      const r = deck.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      ty = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (!tiltF) tiltF = requestAnimationFrame(() => {
        tiltF = 0;
        if (tiltEl) tiltEl.style.transform = 'rotateX(' + (-ty * 7).toFixed(2) + 'deg) rotateY(' + (tx * 10).toFixed(2) + 'deg)';
      });
    }, { passive: true });
    root.addEventListener('pointerleave', () => { if (tiltEl) tiltEl.style.transform = ''; tiltEl = null; });
  }

  // which chapter is under the reading line: lights up its name in the index
  let spy = null;
  function observe() {
    spy?.disconnect();
    if (!('IntersectionObserver' in window)) return;
    const links = new Map([...root.querySelectorAll('[data-ix]')].map((a) => [a.dataset.ix, a]));
    spy = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const id = en.target.dataset.id;
        links.forEach((a, k) => a.classList.toggle('on', k === id));
        const a = links.get(id);
        a?.parentElement.scrollTo({ left: a.offsetLeft - 16, behavior: RM() ? 'auto' : 'smooth' });
      }
    }, { rootMargin: '-45% 0px -54% 0px' });
    root.querySelectorAll('.dv-ch').forEach((c) => spy.observe(c));
    // without scroll-driven animation support, chapters fade in as they arrive
    if (!CSS.supports?.('animation-timeline: view()')) {
      const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -12% 0px' });
      root.querySelectorAll('.dv-ch').forEach((c) => io.observe(c));
    }
  }

  render();

  return {
    async update({ links: fresh }) {
      items = await divisiOf(fresh);
      render();
    },
    items: () => items,
    open: openViewer,
    step,
    destroy() {
      spy?.disconnect();
      root.innerHTML = '';
    },
  };
}
