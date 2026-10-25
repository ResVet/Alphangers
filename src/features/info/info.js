// Announcement board above the schedule. Items come from the admin (content key
// "announcements"); the board stays hidden while there is nothing current to show.
// Its fixed words are page texts the admin can change (src/copy/info.js); titles and bodies are data.
import './info.css';
import '../../copy/info.js';
import { kSet } from '../../lib/texts.js';
import { todayWIB, wibToMs, formatDate, formatTime, relativeDayKey, formatCountdown, countdownParts, DAY_MS } from '../../lib/schedule-model.js';

// each tag's label is the page text 'info.tag.<tag>'
const TAGS = new Set(['info', 'deadline', 'ujian', 'penting']);
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

/** An element showing a page text. */
function k(tag, cls, key, vars) {
  return kSet(el(tag, cls), key, vars);
}

/** 'besok' as its page text, or the date itself when it has no name relative to today. */
function day(iso, today, style, cls) {
  const key = relativeDayKey(iso, today);
  return key ? k('span', cls, key) : el('span', cls, formatDate(iso, style));
}

/** Time left before a deadline: '2 hari 4 jam' a day or more ahead, '3 jam 12 menit' or '45 menit' under a day. */
function leftText(left) {
  if (left >= DAY_MS) return formatCountdown(left);
  const { hours, minutes } = countdownParts(left);
  return (hours ? hours + ' jam ' : '') + Math.max(1, minutes) + ' menit';
}

export function mountInfo(root, { announcements, now } = {}) {
  const clock = typeof now === 'function' ? now : () => Date.now();
  let items = announcements?.items || [];
  let open = false;
  let timer = 0;
  // what is on the board, so the minute tick can tell whether only the countdowns moved
  let shown = '';
  let lefts = [];

  root.classList.add('ib');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Pengumuman');

  function dueLine(a, t) {
    const ms = dueMs(a.due);
    if (ms === null) return null;
    const [d, hhmm] = a.due.split('T');
    const p = el('p', 'ib-due');
    // one box for the day and the time, as the line has always been laid out
    const when = el('span', 'ib-when');
    when.append(day(d, todayWIB(t), 'medium', 'ib-dt'), document.createTextNode(', ' + formatTime(hhmm)));
    p.append(k('span', 'ib-due-k', 'info.due'), document.createTextNode(' '), when);
    const left = ms - t;
    const c = k('span', 'ib-left' + (left < DAY_MS ? ' soon' : ''), 'info.left', { time: leftText(left) });
    lefts.push({ node: c, ms });
    p.append(c);
    return p;
  }

  function card(a, t) {
    const tag = TAGS.has(a.tag) ? a.tag : 'info';
    const li = el('li', 'ib-card ib-' + tag);
    li.dataset.id = a.id;
    const top = el('p', 'ib-top');
    top.append(k('span', 'ib-tag', 'info.tag.' + tag));
    if (a.pinned) top.append(k('span', 'ib-pin', 'info.pin'));
    top.append(day(a.date, todayWIB(t), 'dayShort', 'ib-date'));
    li.append(top, el('h3', 'ib-title', a.title));
    if (a.body) {
      const body = el('p', 'ib-body', a.body);
      li.append(body);
      if (a.body.length > 160 || a.body.split('\n').length > 3) {
        body.classList.add('clamp');
        const more = el('button', 'ib-more');
        more.type = 'button';
        const label = k('span', null, 'info.more');
        more.append(label);
        more.setAttribute('aria-expanded', 'false');
        more.addEventListener('click', () => {
          const on = body.classList.toggle('clamp');
          kSet(label, on ? 'info.more' : 'info.less');
          more.setAttribute('aria-expanded', on ? 'false' : 'true');
        });
        li.append(more);
      }
    }
    const due = dueLine(a, t);
    if (due) li.append(due);
    if (a.link) {
      const link = el('a', 'ib-link');
      link.href = a.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.append(k('span', null, 'info.link'), el('span', 'ib-arrow', '→'));
      link.lastChild.setAttribute('aria-hidden', 'true');
      li.append(link);
    }
    return li;
  }

  function render() {
    clearTimeout(timer);
    timer = 0;
    lefts = [];
    const t = clock();
    const list = visibleAnnouncements(items, t);
    shown = todayWIB(t) + '|' + open + '|' + list.map((a) => a.id).join('|');
    root.textContent = '';
    root.hidden = list.length === 0;
    if (!list.length) return;
    const head = el('div', 'ib-head');
    head.append(k('h2', 'ib-h lbl', 'info.h'), k('span', 'ib-n lbl', 'info.n', { n: list.length }));
    const ul = el('ul', 'ib-list');
    list.slice(0, open ? list.length : SHOW).forEach((a) => ul.append(card(a, t)));
    root.append(head, ul);
    if (list.length > SHOW) {
      const b = el('button', 'ib-all');
      b.type = 'button';
      b.append(open ? k('span', null, 'info.fewer') : k('span', null, 'info.all', { n: list.length - SHOW }));
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
      b.addEventListener('click', () => { open = !open; render(); root.querySelector('.ib-all')?.focus(); });
      root.append(b);
    }
    schedule(t, list);
  }

  // the countdowns count in minutes, so look again on the next minute
  function schedule(t, list) {
    if (list.some((a) => a.due)) timer = setTimeout(tick, 60_000 - (t % 60_000) + 50);
  }

  // Same cards as before (nothing expired, appeared or changed day): only the countdowns move, so
  // they change where they are and a text the admin is typing on the board is left alone.
  function tick() {
    timer = 0;
    const t = clock();
    const list = visibleAnnouncements(items, t);
    if (todayWIB(t) + '|' + open + '|' + list.map((a) => a.id).join('|') !== shown) return render();
    for (const { node, ms } of lefts) {
      const left = ms - t;
      node.classList.toggle('soon', left < DAY_MS);
      if (!(node.isContentEditable && node === document.activeElement)) kSet(node, 'info.left', { time: leftText(left) });
    }
    schedule(t, list);
  }

  render();
  return {
    update({ announcements: fresh }) { items = fresh?.items || []; render(); },
    destroy() { clearTimeout(timer); root.textContent = ''; root.hidden = true; },
  };
}
