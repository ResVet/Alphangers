// Markup for a validated photo record (see photo() in validate.js): a <picture> with an AVIF set
// when there is one, a WebP or JPEG set, the pixel size so the box is reserved before the file
// arrives, and the blurred preview painted underneath until it does.
import { MEDIA_RE } from './validate.js';

const attr = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const srcset = (set) => set.map(([u, w]) => attr(u) + ' ' + w + 'w').join(', ');

/** Largest file in the record, for the zoom view: the original when there is one. */
export function fullSrc(ph) {
  return ph.full || ph.set?.[ph.set.length - 1]?.[0] || ph.src;
}

/**
 * @param ph photo record
 * @param o.sizes the sizes attribute; required when the record has a srcset
 * @param o.eager load now instead of when near the screen
 * @param o.cls class for the <img>
 */
export function pictureHTML(ph, { sizes = '100vw', eager = false, cls = '', alt } = {}) {
  if (!ph || !MEDIA_RE.test(ph.src)) return '';
  const style = ph.lq ? ' style="background-image:url(' + attr(ph.lq) + ')"' : '';
  const img = '<img class="' + attr(cls) + '" src="' + attr(ph.src) + '"' +
    (ph.set?.length ? ' srcset="' + srcset(ph.set) + '" sizes="' + attr(sizes) + '"' : '') +
    ' width="' + ph.w + '" height="' + ph.h + '" alt="' + attr(alt ?? ph.alt ?? '') + '"' +
    ' decoding="async"' + (eager ? ' fetchpriority="high"' : ' loading="lazy"') + ' draggable="false"' + style + '>';
  const avif = ph.avif?.length ? '<source type="image/avif" srcset="' + srcset(ph.avif) + '" sizes="' + attr(sizes) + '">' : '';
  return '<picture>' + avif + img + '</picture>';
}

/** Marks images loaded so CSS can drop the blurred preview behind them. */
export function watchLoaded(root) {
  for (const img of root.querySelectorAll('picture img')) {
    if (img.complete && img.naturalWidth) img.classList.add('is-ld');
    else img.addEventListener('load', () => img.classList.add('is-ld'), { once: true });
  }
}
