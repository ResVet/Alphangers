// Announcement board above the schedule. Items come from the admin (content key
// "announcements"); the board stays hidden while there is nothing current to show.
import './info.css';
import { todayWIB, wibToMs, formatDate, formatTime, relativeDay, formatCountdown, countdownParts, DAY_MS } from '../../lib/schedule-model.js';

const TAGS = { info: 'Info', deadline: 'Deadline', ujian: 'Ujian', penting: 'Penting' };
const SHOW = 4;

/** Due "YYYY-MM-DDTHH:MM" (WIB) to ms, or null. */
function dueMs(due) {
  if (!due) return null;
  const [d, t] = due.split('T');
  return wibToMs(d, t);
}

/**
 * What the board shows at a given moment, in order: pinned first, then whatever is due
 * soonest, then the newest. Items posted for a later date, past their "until" date, or
 * past their deadline are left out.
 */
export function visibleAnnouncements(items, nowMs) {
  const today = todayWIB(nowMs);
  return (Array.isArray(items) ? items : [])
    .filter((a) => a && a.title && a.date && a.date <= today)
    .filter((a) => !a.until || today <= a.until)
    .filter((a) => { const d = dueMs(a.due); return d === null || d > nowMs; })
    .sort((a, b) => {
      if (!!b.pinned - !!a.pinned) return !!b.pinned - !!a.pinned;
      const da = dueMs(a.due), db = dueMs(b.due);
      if (da !== null || db !== null) return (da ?? Infinity) - (db ?? Infinity);
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function mountInfo(root, { announcements, now } = {}) {
  const clock = typeof now === 'function' ? now : () => Date.now();
  let items = announcements?.items || [];
  let open = false;
  let timer = 0;

  root.classList.add('ib');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Pengumuman');

  function dueLine(a, t) {
    const ms = dueMs(a.due);
    if (ms === null) return null;
    const [d, hhmm] = a.due.split('T');
    const p = el('p', 'ib-due');
    const rel = relativeDay(d, todayWIB(t));
    p.append(el('span', 'ib-due-k', 'Tenggat'), document.createTextNode(' ' + (rel || formatDate(d, 'medium')) + ', ' + formatTime(hhmm)));
    const left = ms - t;
    let txt = formatCountdown(left) + ' lagi';
    if (left < DAY_MS) {
      const { hours, minutes } = countdownParts(left);
      txt = (hours ? hours + ' jam ' : '') + Math.max(1, minutes) + ' menit lagi';
    }
    const c = el('span', 'ib-left' + (left < DAY_MS ? ' soon' : ''), txt);
    p.append(c);
    return p;
  }

  function card(a, t) {
    const li = el('li', 'ib-card ib-' + (TAGS[a.tag] ? a.tag : 'info'));
    const top = el('p', 'ib-top');
    top.append(el('span', 'ib-tag', TAGS[a.tag] || 'Info'));
    if (a.pinned) top.append(el('span', 'ib-pin', 'Disematkan'));
    const rel = relativeDay(a.date, todayWIB(t));
    top.append(el('span', 'ib-date', rel || formatDate(a.date, 'dayShort')));
    li.append(top, el('h3', 'ib-title', a.title));
    if (a.body) {
      const body = el('p', 'ib-body', a.body);
      li.append(body);
      if (a.body.length > 160 || a.body.split('\n').length > 3) {
        body.classList.add('clamp');
        const more = el('button', 'ib-more', 'Selengkapnya');
        more.type = 'button';
        more.setAttribute('aria-expanded', 'false');
        more.addEventListener('click', () => {
          const on = body.classList.toggle('clamp');
          more.textContent = on ? 'Selengkapnya' : 'Ringkas';
          more.setAttribute('aria-expanded', on ? 'false' : 'true');
        });
        li.append(more);
      }
    }
    const due = dueLine(a, t);
    if (due) li.append(due);
    if (a.link) {
      const link = el('a', 'ib-link', 'Buka tautan');
      link.href = a.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.append(el('span', 'ib-arrow', '→'));
      link.lastChild.setAttribute('aria-hidden', 'true');
      li.append(link);
    }
    return li;
  }

  function render() {
    clearTimeout(timer);
    const t = clock();
    const list = visibleAnnouncements(items, t);
    root.textContent = '';
    root.hidden = list.length === 0;
    if (!list.length) return;
    const head = el('div', 'ib-head');
    head.append(el('h2', 'ib-h lbl', 'Pengumuman'), el('span', 'ib-n lbl', list.length + ' aktif'));
    const ul = el('ul', 'ib-list');
    list.slice(0, open ? list.length : SHOW).forEach((a) => ul.append(card(a, t)));
    root.append(head, ul);
    if (list.length > SHOW) {
      const b = el('button', 'ib-all', open ? 'Tampilkan lebih sedikit' : 'Lihat ' + (list.length - SHOW) + ' pengumuman lain');
      b.type = 'button';
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
      b.addEventListener('click', () => { open = !open; render(); root.querySelector('.ib-all')?.focus(); });
      root.append(b);
    }
    // the countdowns count in minutes, so redraw on the next minute
    if (list.some((a) => a.due)) timer = setTimeout(render, 60_000 - (t % 60_000) + 50);
  }

  render();
  return {
    update({ announcements: fresh }) { items = fresh?.items || []; render(); },
    destroy() { clearTimeout(timer); root.textContent = ''; root.hidden = true; },
  };
}
