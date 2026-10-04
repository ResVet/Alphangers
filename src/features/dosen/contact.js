// Phone links and copy-to-clipboard, shared by the schedule and the lecturer list.
import './contact.css';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** tel: with the +62 country code, so the link also works on a SIM from abroad. */
export function telHref(phone) {
  const digits = String(phone?.n || '').replace(/\D/g, '');
  if (!digits) return '';
  return 'tel:' + (digits.startsWith('0') ? '+62' + digits.slice(1) : '+' + digits);
}

export function waHref(phone) {
  const wa = String(phone?.wa || '').replace(/\D/g, '');
  return wa ? 'https://wa.me/' + wa : '';
}

export function phoneLabel(phone) {
  return phone?.f || phone?.n || '';
}

/** Markup for a person's phone numbers with call, WhatsApp and copy actions. */
export function phonesHTML(phones, { empty = 'Nomor belum ada.' } = {}) {
  const list = Array.isArray(phones) ? phones.filter((p) => p && (p.n || p.f)) : [];
  if (!list.length) return '<p class="ct-none">' + esc(empty) + '</p>';
  return '<ul class="ct-phones">' + list.map(phoneHTML).join('') + '</ul>';
}

function phoneHTML(phone) {
  const label = esc(phoneLabel(phone));
  const tel = telHref(phone);
  const wa = waHref(phone);
  return '<li class="ct-ph">' +
    '<span class="ct-num">' + label + '</span>' +
    '<span class="ct-acts">' +
      (tel ? '<a class="ct-act" href="' + esc(tel) + '">Telp<span class="ct-sr"> ' + label + '</span></a>' : '') +
      (wa ? '<a class="ct-act" href="' + esc(wa) + '" target="_blank" rel="noopener">WA<span class="ct-sr"> ' + label + '</span></a>' : '') +
      '<button type="button" class="ct-act" data-copy="' + esc(phone.n || phone.f) + '" data-copy-label="' + label + '">' +
        '<span class="ct-copy-t">Salin</span><span class="ct-sr"> ' + label + '</span></button>' +
    '</span>' +
  '</li>';
}

/** Clipboard API first; the textarea fallback covers plain-http LAN previews and old WebViews. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * One delegated listener for every [data-copy] button inside root.
 * `announce(text)` reports the result to a polite live region.
 * Returns a cleanup function.
 */
export function bindCopy(root, announce) {
  const timers = new Map();
  async function onClick(event) {
    const btn = event.target.closest('[data-copy]');
    if (!btn || !root.contains(btn)) return;
    const label = btn.dataset.copyLabel || btn.dataset.copy;
    const ok = await copyText(btn.dataset.copy);
    const text = btn.querySelector('.ct-copy-t');
    if (text) text.textContent = ok ? 'Tersalin' : 'Gagal';
    btn.dataset.state = ok ? 'done' : 'fail';
    announce?.(ok ? 'Nomor ' + label + ' disalin.' : 'Gagal menyalin. Nomornya ' + label + '.');
    clearTimeout(timers.get(btn));
    timers.set(btn, setTimeout(() => {
      if (text) text.textContent = 'Salin';
      delete btn.dataset.state;
      timers.delete(btn);
    }, 1800));
  }
  root.addEventListener('click', onClick);
  return () => {
    root.removeEventListener('click', onClick);
    for (const t of timers.values()) clearTimeout(t);
  };
}

/** Writes to a live region, clearing first so the same message is announced twice in a row. */
export function makeAnnouncer(region) {
  let timer = 0;
  return (text) => {
    clearTimeout(timer);
    region.textContent = '';
    timer = setTimeout(() => { region.textContent = text; }, 60);
  };
}

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Clock for the features. `now` may be a function, a Date, ms or a date string.
 * A fixed value keeps ticking forward from that moment, which is what a preview of
 * "Monday 09.15" needs.
 */
export function makeClock(now) {
  if (typeof now === 'function') {
    return () => {
      const v = now();
      return v instanceof Date ? v.getTime() : Number(v);
    };
  }
  if (now != null) {
    const start = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : Number(now);
    if (Number.isFinite(start)) {
      const offset = start - Date.now();
      return () => Date.now() + offset;
    }
  }
  return () => Date.now();
}

/** Names the section after the module's heading, unless the page already named it. */
export function labelRegion(root, headingId) {
  if (!root.hasAttribute('aria-label') && !root.hasAttribute('aria-labelledby')) {
    root.setAttribute('aria-labelledby', headingId);
    return true;
  }
  return false;
}
