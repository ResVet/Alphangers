// Full-screen photo viewer shared by the divisi section and the class photo.
//
// The photo grows out of the picture that was clicked (and shrinks back into it on close), can be
// zoomed with the wheel, a pinch, a double tap or + and -, panned when zoomed, swiped sideways to
// the next photo and, on a phone, swiped down to close. Zooming past 1.3x swaps in the original
// file. The panel beside (or under) the photo carries the text and a strip of every photo.
// Back on a phone closes it, like any other full-screen view.
import './viewer.css';
import { pictureHTML, fullSrc, watchLoaded } from '../../lib/photo.js';

const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH = () => !matchMedia('(hover: hover) and (pointer: fine)').matches;
const EASE = 'cubic-bezier(.32,.72,0,1)';
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let viewer = null;
export function getViewer() {
  if (!viewer) viewer = createViewer();
  return viewer;
}

function createViewer() {
  const dlg = document.createElement('dialog');
  dlg.className = 'pv';
  dlg.setAttribute('aria-labelledby', 'pvTitle');
  dlg.innerHTML =
    '<div class="pv-shell">' +
      '<div class="pv-stage" data-cur="zoom">' +
        '<div class="pv-frame"><div class="pv-pan"></div></div>' +
        '<button type="button" class="pv-nav pv-prev" data-go="-1" aria-label="Foto sebelumnya"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg></button>' +
        '<button type="button" class="pv-nav pv-next" data-go="1" aria-label="Foto berikutnya"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg></button>' +
        '<div class="pv-zoom" role="group" aria-label="Zoom">' +
          '<button type="button" data-z="out" aria-label="Perkecil">−</button><output class="pv-zv">100%</output><button type="button" data-z="in" aria-label="Perbesar">+</button>' +
        '</div>' +
        '<p class="pv-hint" aria-hidden="true"></p>' +
      '</div>' +
      '<aside class="pv-side">' +
        '<div class="pv-top">' +
          '<p class="pv-count" aria-live="polite"></p>' +
          '<button type="button" class="pv-x" data-close aria-label="Tutup"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
        '</div>' +
        '<div class="pv-text">' +
          '<p class="pv-kick"></p>' +
          '<h2 class="pv-title" id="pvTitle"></h2>' +
          '<p class="pv-sub"></p>' +
          '<p class="pv-cap"></p>' +
          '<p class="pv-desc"></p>' +
        '</div>' +
        '<div class="pv-tools"></div>' +
        '<ol class="pv-strip" aria-label="Semua foto"></ol>' +
      '</aside>' +
    '</div>';
  document.body.append(dlg);
  const $ = (s) => dlg.querySelector(s);
  const stage = $('.pv-stage'), frame = $('.pv-frame'), pan = $('.pv-pan'), strip = $('.pv-strip'), zv = $('.pv-zv');
  const hint = $('.pv-hint');
  hint.textContent = TOUCH() ? 'Ketuk 2x atau cubit buat zoom, geser buat ganti foto' : 'Scroll atau klik 2x buat zoom, panah buat ganti foto';

  let st = null; // { photos, index, title, sub, kick, desc, from, onIndex }
  let img = null, s = 1, tx = 0, ty = 0, hiRes = false;
  let returnFocus = null, pushed = false;

  // ---------- rendering
  function render(dir = 0) {
    const ph = st.photos[st.index];
    $('.pv-kick').textContent = st.kick || '';
    $('.pv-title').textContent = st.title || '';
    $('.pv-sub').textContent = st.sub || '';
    $('.pv-sub').hidden = !st.sub;
    $('.pv-desc').textContent = st.desc || '';
    $('.pv-desc').hidden = !st.desc;
    $('.pv-cap').textContent = ph?.cap || '';
    $('.pv-cap').hidden = !ph?.cap;
    $('.pv-count').textContent = st.photos.length > 1 ? (st.index + 1) + ' / ' + st.photos.length : '';
    dlg.classList.toggle('pv-one', st.photos.length < 2);
    hiRes = false;
    s = 1; tx = 0; ty = 0;
    pan.innerHTML = ph ? pictureHTML(ph, { sizes: '(min-width: 900px) calc(100vw - 420px), 100vw', eager: true, cls: 'pv-img' }) : '';
    img = pan.querySelector('img');
    if (img) watchLoaded(pan);
    apply(false);
    if (dir && !RM() && img) {
      img.animate([{ opacity: 0, transform: `translateX(${dir * 6}%) scale(.98)` }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE });
    }
    for (const b of strip.children) b.firstElementChild.setAttribute('aria-current', String(+b.dataset.i === st.index));
    const cur = strip.children[st.index];
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: RM() ? 'auto' : 'smooth' });
    st.onIndex?.(st.index);
  }

  function renderStrip() {
    strip.innerHTML = st.photos.map((ph, i) => {
      const thumb = { ...ph, src: ph.set?.[0]?.[0] || ph.src, set: ph.set?.slice(0, 1), avif: ph.avif?.slice(0, 1) };
      return '<li data-i="' + i + '"><button type="button" class="pv-th" aria-label="Foto ' + (i + 1) + (ph.alt ? ': ' + esc(ph.alt) : '') + '">' +
        pictureHTML(thumb, { sizes: '96px', alt: '' }) + '</button></li>';
    }).join('');
    watchLoaded(strip);
  }

  function go(d) {
    if (!st || st.photos.length < 2) return;
    st.index = (st.index + d + st.photos.length) % st.photos.length;
    render(d);
  }

  // ---------- zoom and pan
  function box() {
    const r = frame.getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height };
  }
  function apply(anim) {
    if (!img) return;
    pan.style.transition = anim && !RM() ? 'transform .45s ' + EASE : 'none';
    pan.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,0) scale(' + s.toFixed(3) + ')';
    stage.classList.toggle('is-z', s > 1.01);
    zv.textContent = Math.round(s * 100) + '%';
    if (s > 1.3 && !hiRes) {
      // the untouched original, for reading faces and name tags
      hiRes = true;
      const ph = st.photos[st.index];
      const src = fullSrc(ph);
      if (src && src !== img.currentSrc) {
        const hi = new Image();
        hi.decoding = 'async';
        hi.src = src;
        hi.decode().then(() => {
          if (!img || st.photos[st.index] !== ph) return;
          const pic = img.parentElement;
          pic.querySelectorAll('source').forEach((x) => x.remove());
          img.removeAttribute('srcset');
          img.src = src;
        }, () => {});
      }
    }
  }
  function bound() {
    const b = box();
    const mx = Math.max(0, (s - 1) * b.w / 2), my = Math.max(0, (s - 1) * b.h / 2);
    tx = clamp(tx, -mx, mx);
    ty = clamp(ty, -my, my);
  }
  function zoomAt(ns, px, py, anim) {
    const b = box(), cx = b.l + b.w / 2, cy = b.t + b.h / 2;
    const lx = (px - cx - tx) / s, ly = (py - cy - ty) / s;
    s = clamp(ns, 1, 5);
    tx = px - cx - s * lx;
    ty = py - cy - s * ly;
    if (s < 1.01) { s = 1; tx = ty = 0; }
    bound();
    apply(anim);
  }
  function zoomCenter(f) {
    const b = box();
    zoomAt(s * f, b.l + b.w / 2, b.t + b.h / 2, true);
  }

  // pointers: one finger pans (zoomed) or swipes (not zoomed), two fingers pinch
  const P = new Map();
  let drag = null, pinch = null, tapT = 0, tapX = 0, tapY = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stage.setPointerCapture?.(e.pointerId);
    P.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (P.size === 1) drag = { x: e.clientX, y: e.clientY, tx, ty, moved: false, t: performance.now(), axis: null };
    else if (P.size === 2) {
      const [a, b] = [...P.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx, ty };
      drag = null;
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!P.has(e.pointerId)) return;
    P.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && P.size >= 2) {
      const [a, b] = [...P.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const bx = box(), cx = bx.l + bx.w / 2, cy = bx.t + bx.h / 2;
      const lx = (pinch.mx - cx - pinch.tx) / pinch.s, ly = (pinch.my - cy - pinch.ty) / pinch.s;
      s = clamp(pinch.s * d / pinch.d, 1, 5);
      tx = mx - cx - s * lx;
      ty = my - cy - s * ly;
      bound();
      apply(false);
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 6) { drag.moved = true; drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; }
    if (!drag.moved) return;
    if (s > 1.01) {
      tx = drag.tx + dx;
      ty = drag.ty + dy;
      bound();
      apply(false);
    } else if (drag.axis === 'x' && st.photos.length > 1) {
      pan.style.transition = 'none';
      pan.style.transform = 'translate3d(' + dx.toFixed(1) + 'px,0,0)';
    } else if (drag.axis === 'y' && e.pointerType !== 'mouse' && dy > 0) {
      pan.style.transition = 'none';
      pan.style.transform = 'translate3d(0,' + dy.toFixed(1) + 'px,0) scale(' + (1 - Math.min(dy, 400) / 2400).toFixed(3) + ')';
      dlg.style.setProperty('--pv-fade', (1 - Math.min(dy, 360) / 520).toFixed(3));
    }
  });
  function up(e) {
    if (!P.has(e.pointerId)) return;
    P.delete(e.pointerId);
    if (P.size < 2) pinch = null;
    if (P.size === 1) {
      const [q] = [...P.values()];
      drag = { x: q.x, y: q.y, tx, ty, moved: true, t: performance.now(), axis: null };
      return;
    }
    if (P.size) return;
    const d = drag;
    drag = null;
    if (!d) return;
    dlg.style.removeProperty('--pv-fade');
    if (d.moved && s <= 1.01) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y, dt = performance.now() - d.t;
      const flick = Math.abs(dx) / Math.max(1, dt) > 0.45;
      if (d.axis === 'x' && st.photos.length > 1 && (Math.abs(dx) > 70 || flick)) return go(dx < 0 ? 1 : -1);
      if (d.axis === 'y' && e.pointerType !== 'mouse' && dy > 120) return close();
      apply(true);
      return;
    }
    if (d.moved || e.type !== 'pointerup') return;
    const now = performance.now();
    if (now - tapT < 320 && Math.abs(e.clientX - tapX) < 28 && Math.abs(e.clientY - tapY) < 28) {
      tapT = 0;
      zoomAt(s > 1.01 ? 1 : 2.6, e.clientX, e.clientY, true);
    } else {
      tapT = now; tapX = e.clientX; tapY = e.clientY;
    }
  }
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => stage.addEventListener(t, up));
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(s * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022)), e.clientX, e.clientY, false);
  }, { passive: false });

  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return close();
    const g = e.target.closest('[data-go]');
    if (g) return go(+g.dataset.go);
    const z = e.target.closest('[data-z]');
    if (z) return zoomCenter(z.dataset.z === 'in' ? 1.6 : 1 / 1.6);
    const th = e.target.closest('.pv-th');
    if (th) {
      const i = +th.parentElement.dataset.i;
      const d = i > st.index ? 1 : -1;
      st.index = i;
      render(d);
    }
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === '+' || e.key === '=') zoomCenter(1.6);
    else if (e.key === '-') zoomCenter(1 / 1.6);
    else if (e.key === '0') { s = 1; tx = ty = 0; apply(true); }
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  addEventListener('popstate', () => { if (dlg.open && !history.state?.pv) close(true); });
  addEventListener('resize', () => { if (dlg.open) { bound(); apply(false); } });

  // ---------- open and close, with the photo travelling from and back to its thumbnail
  function flip(fromEl, reverse) {
    if (!fromEl || !img || RM() || !fromEl.isConnected) return null;
    const a = fromEl.getBoundingClientRect(), b = img.getBoundingClientRect();
    if (!a.width || !b.width) return null;
    // the viewer shows the whole photo; the print may crop it, so match on the photo's own box
    const fx = a.left + a.width / 2 - (b.left + b.width / 2), fy = a.top + a.height / 2 - (b.top + b.height / 2);
    const sc = Math.max(a.width / b.width, a.height / b.height);
    const start = `translate3d(${fx}px,${fy}px,0) scale(${sc})`;
    const frames = [{ transform: start, borderRadius: '14px' }, { transform: 'none', borderRadius: '0px' }];
    return img.animate(reverse ? frames.reverse() : frames, { duration: reverse ? 380 : 560, easing: EASE, fill: 'both' });
  }

  function open(opts) {
    st = { index: 0, ...opts, photos: (opts.photos || []).filter(Boolean) };
    if (!st.photos.length) return;
    st.index = clamp(st.index | 0, 0, st.photos.length - 1);
    returnFocus = document.activeElement;
    renderStrip();
    render(0);
    $('.pv-tools').textContent = '';
    st.tools?.($('.pv-tools'), api);
    dlg.classList.remove('is-out');
    dlg.showModal();
    document.documentElement.classList.add('pv-lock');
    try {
      history.pushState({ ...(history.state || {}), pv: 1 }, '', location.href);
      pushed = true;
    } catch {
      pushed = false;
    }
    flip(opts.from, false);
    $('.pv-x').focus({ preventScroll: true });
  }

  function close(fromPop) {
    if (!dlg.open) return;
    const back = st?.from && st.index === (st.start ?? st.index) ? st.from : null;
    const anim = flip(back, true);
    dlg.classList.add('is-out');
    const done = () => {
      dlg.close();
      dlg.classList.remove('is-out');
      document.documentElement.classList.remove('pv-lock');
      pan.innerHTML = '';
      img = null;
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      st?.onClose?.();
      st = null;
    };
    if (anim) anim.finished.then(done, done);
    else setTimeout(done, RM() ? 0 : 220);
    if (!fromPop && pushed && history.state?.pv) history.back();
    pushed = false;
  }

  const api = {
    open: (o) => open({ ...o, start: o.index ?? 0 }),
    close: () => close(),
    isOpen: () => dlg.open,
    index: () => st?.index ?? -1,
    // the editor swaps in fresh photos after an edit without closing
    refresh(photos, index = st?.index ?? 0) {
      if (!st) return;
      st.photos = photos;
      if (!photos.length) return close();
      st.index = clamp(index, 0, photos.length - 1);
      renderStrip();
      render(0);
    },
    el: dlg,
  };
  return api;
}
