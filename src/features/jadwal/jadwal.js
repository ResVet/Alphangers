// Jadwal: the class schedule by day, with a week strip, a month calendar, a live
// "now / next" readout and calendar export. Mounts into any element.
import './jadwal.css';
import {
  createModel, todayWIB, addDays, startOfWeek, weekdayOf, monthGrid, monthOf, addMonths, daysInMonth,
  daysBetween, parseISO, isISODate, formatDate, formatTime, relativeDay, daysUntilLabel, countdownParts,
  DAYS, DAYS_SHORT, MONTHS, MONTHS_SHORT,
} from '../../lib/schedule-model.js';
import {
  sessionCalendar, dayCalendar, blokCalendar, sessionFilename, dayFilename, blokFilename,
  googleCalendarUrl, downloadICS,
} from '../../lib/ics.js';
import { esc, phonesHTML, bindCopy, makeAnnouncer, prefersReducedMotion, makeClock, labelRegion } from '../dosen/contact.js';

const STORE_KEY = 'alpha.jadwal.date';
const SWIPE_MIN_PX = 60;
let mounts = 0;

const ICON = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 2.8v4.4M16 2.8v4.4"/></svg>',
};

function pad(n) {
  return String(n).padStart(2, '0');
}

function readStoredDate() {
  try {
    const v = sessionStorage.getItem(STORE_KEY);
    return isISODate(v) ? v : null;
  } catch {
    return null;
  }
}

function storeDate(iso) {
  try {
    sessionStorage.setItem(STORE_KEY, iso);
  } catch {
    // storage blocked: the date just isn't remembered
  }
}

function timeRange(s) {
  return formatTime(s.start) + ' - ' + (s.end ? formatTime(s.end) : 'selesai');
}

function whenLabel(s, today) {
  const rel = relativeDay(s.date, today);
  return (rel || formatDate(s.date, 'medium')) + ', ' + formatTime(s.start);
}

export function mountJadwal(root, { schedule, dosen, now } = {}) {
  if (!root) throw new Error('mountJadwal needs a root element');
  const uid = 'jw' + ++mounts;
  const clock = makeClock(now);
  let data = { schedule, dosen };
  let model = createModel(schedule, dosen);

  const state = {
    today: todayWIB(clock()),
    date: null,
    calMonth: null,
    calFocus: null,
    statusKey: '',
    onScreen: typeof IntersectionObserver === 'undefined',
    stripKey: '',
    query: '',
  };
  state.date = readStoredDate() || state.today;

  root.classList.add('jw');
  root.innerHTML = shellHTML(uid);
  const labelled = labelRegion(root, uid + '-h');
  const $ = (sel) => root.querySelector(sel);
  const el = {
    bloks: $('.jw-bloks'),
    mon: $('.jw-mon'),
    rel: $('.jw-rel'),
    date: $('.jw-date'),
    blokline: $('.jw-blokline'),
    prev: $('[data-act="prev"]'),
    next: $('[data-act="next"]'),
    todayBtn: $('[data-act="today"]'),
    calBtn: $('[data-act="cal"]'),
    strip: $('.jw-strip'),
    sum: $('.jw-sum'),
    list: $('.jw-list'),
    foot: $('.jw-foot'),
    q: $('.jw-q'),
    hits: $('.jw-hits'),
    hitsCount: $('.jw-hitc'),
    dlg: $('.jw-cal'),
    calTitle: $('.jw-cal-h'),
    calBody: $('.jw-cal-g tbody'),
    live: $('.jw-live'),
  };
  const announce = makeAnnouncer(el.live);
  const unbindCopy = bindCopy(root, announce);
  let countdowns = [];
  let tickTimer = 0;
  let flashTimer = 0;
  let calReturn = null;

  // ---------- rendering ----------

  function renderAll() {
    renderBloks();
    renderStrip();
    renderDay(0);
    renderMonitor(true);
  }

  function renderBloks() {
    const active = model.blokFor(state.date)?.id;
    el.bloks.innerHTML = model.bloks.map((b) =>
      '<button type="button" class="jw-pill" data-blok="' + esc(b.id) + '" aria-pressed="' + (b.id === active) + '">' + esc(b.name) + '</button>'
    ).join('');
  }

  function markBloks() {
    const active = model.blokFor(state.date)?.id;
    for (const b of el.bloks.querySelectorAll('[data-blok]')) b.setAttribute('aria-pressed', String(b.dataset.blok === active));
  }

  function stripRange() {
    let from = startOfWeek(model.firstDate || state.today);
    let to = addDays(startOfWeek(model.lastDate || state.today), 6);
    for (const d of [state.today, state.date]) {
      const ws = startOfWeek(d);
      if (ws < from) from = ws;
      if (addDays(ws, 6) > to) to = addDays(ws, 6);
    }
    // a date far from the term would make a strip hundreds of chips long; show a month around it instead
    if (daysBetween(from, to) > 400) {
      from = addDays(startOfWeek(state.date), -14);
      to = addDays(startOfWeek(state.date), 20);
    }
    return { from, to };
  }

  function renderStrip() {
    const { from, to } = stripRange();
    const key = from + to + state.today;
    if (key === state.stripKey) return markStrip(true);
    state.stripKey = key;
    let html = '';
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const { m, d: day } = parseISO(d);
      if (day === 1 || d === from) html += '<span class="jw-strip-m" aria-hidden="true">' + MONTHS_SHORT[m - 1] + '</span>';
      html += chipHTML(d);
    }
    el.strip.innerHTML = html;
    markStrip(true, true);
  }

  function chipHTML(d) {
    const info = model.dayInfo(d);
    const n = info.sessions.length;
    const allOff = n > 0 && info.sessions.every((s) => s.cancelled);
    const w = weekdayOf(d);
    const { m, d: day } = parseISO(d);
    const exam = info.sessions.some((s) => s.kind === 'ujian');
    const cls = ['jw-chip'];
    if (n) cls.push('has');
    if (exam) cls.push('exam');
    if (w === 0 || w === 6) cls.push('wkend');
    if (w === 0) cls.push('sun');
    if (allOff) cls.push('off');
    if (d === state.today) cls.push('today');
    const sr = DAYS[w] + ', ' + day + ' ' + MONTHS[m - 1] + (n ? ', ' + n + ' sesi' + (allOff ? ', semua dibatalkan' : '') : info.libur ? ', libur' : ', kosong') +
      (exam ? ', ada ujian' : '') + (d === state.today ? ', hari ini' : '');
    return '<button type="button" class="' + cls.join(' ') + '" data-date="' + d + '" aria-pressed="false" tabindex="-1">' +
      '<span class="jw-chip-w" aria-hidden="true">' + DAYS_SHORT[w] + '</span>' +
      '<span class="jw-chip-d" aria-hidden="true">' + day + '</span>' +
      '<span class="jw-chip-dot" aria-hidden="true"></span>' +
      '<span class="jw-sr">' + sr + '</span></button>';
  }

  function markStrip(scroll, instant) {
    const prev = el.strip.querySelector('[aria-pressed="true"]');
    if (prev) {
      prev.setAttribute('aria-pressed', 'false');
      prev.tabIndex = -1;
    }
    const chip = el.strip.querySelector('[data-date="' + state.date + '"]');
    if (!chip) return;
    chip.setAttribute('aria-pressed', 'true');
    chip.tabIndex = 0;
    if (scroll) scrollChipIntoView(chip, instant);
  }

  function scrollChipIntoView(chip, instant) {
    // scrollTo on the strip itself, so the page never jumps vertically.
    // Measured from the strip's own box: offsetLeft would count from the section and overshoot in two columns.
    const box = el.strip.getBoundingClientRect();
    const r = chip.getBoundingClientRect();
    const left = el.strip.scrollLeft + (r.left - box.left) - (box.width - r.width) / 2;
    el.strip.scrollTo({ left: Math.max(0, left), behavior: instant || prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function renderDay(direction) {
    const d = state.date;
    const info = model.dayInfo(d);
    const w = weekdayOf(d);
    const { y, m, d: day } = parseISO(d);

    el.rel.textContent = relativeDay(d, state.today) || daysUntilLabel(d, state.today);
    el.rel.classList.toggle('is-today', d === state.today);
    el.date.innerHTML = '<em>' + DAYS[w] + ',</em> <span class="jw-date-d">' + day + ' ' + MONTHS[m - 1] + '</span> <span class="jw-date-y">' + y + '</span>';

    const blok = info.blok;
    if (blok) {
      const ketua = blok.ketua ? model.dosenById.get(blok.ketua) : null;
      el.blokline.innerHTML = '<span class="jw-blokline-n">' + esc(blok.name) + '</span> <span class="jw-blokline-t">' + esc(blok.title) + '</span>' +
        '<span class="jw-blokline-r">' + formatDate(blok.start, 'dayShort') + ' - ' + formatDate(blok.end, 'dayShort') +
        (ketua ? ', ketua <button type="button" class="jw-link" data-dosen="' + esc(ketua.id) + '">' + esc(ketua.name) + '</button>' : '') + '</span>';
    } else {
      el.blokline.innerHTML = '<span class="jw-blokline-t">Di luar masa blok</span>';
    }

    const prev = model.prevDate(d);
    const next = model.nextDate(d);
    el.prev.disabled = !prev;
    el.next.disabled = !next;
    el.prev.title = prev ? formatDate(prev, 'medium') : '';
    el.next.title = next ? formatDate(next, 'medium') : '';
    el.todayBtn.disabled = d === state.today;

    if (info.sessions.length) {
      const first = info.sessions[0];
      const last = info.sessions[info.sessions.length - 1];
      const off = info.sessions.filter((x) => x.cancelled).length;
      el.sum.textContent = info.sessions.length + ' sesi, ' + formatTime(first.start) + ' - ' + (last.end ? formatTime(last.end) : 'selesai') +
        (off ? (off === info.sessions.length ? ', semua dibatalkan' : ', ' + off + ' dibatalkan') : '');
      el.list.innerHTML = '<ol class="jw-tl">' + info.sessions.map((s, i) => sessionHTML(s, i)).join('') + '</ol>';
    } else {
      el.sum.textContent = '';
      el.list.innerHTML = emptyHTML(info);
    }
    el.foot.innerHTML = footHTML(info);
    markNow();

    if (direction && !prefersReducedMotion()) {
      el.list.dataset.dir = direction > 0 ? 'next' : 'prev';
      // restart the enter animation even when the direction repeats
      el.list.classList.remove('jw-enter');
      void el.list.offsetWidth;
      el.list.classList.add('jw-enter');
    }
    storeDate(d);
  }

  function sessionHTML(s, i) {
    const menuId = uid + '-add-' + i;
    const ref = s.ref.blokId + '|' + s.ref.date + '|' + s.ref.index;
    return '<li class="jw-s' + (s.cancelled ? ' is-batal' : '') + '" data-uid="' + esc(s.uid) + '" data-ref="' + esc(ref) + '" data-kind="' + esc(s.kind) + '" style="--i:' + i + '">' +
      '<div class="jw-s-time"><span class="jw-s-from">' + formatTime(s.start) + '</span>' +
        '<span class="jw-s-to"><span class="jw-sr">sampai </span>' + (s.end ? formatTime(s.end) : 'selesai') + '</span></div>' +
      '<div class="jw-s-body">' +
        '<p class="jw-s-meta">' + (s.cancelled ? '<span class="jw-batal">Dibatalkan</span>' : '') + '<span class="jw-kind">' + esc(s.kindLabel) + '</span>' +
          (s.blok.loc ? '<span class="jw-loc">' + esc(s.blok.loc) + '</span>' : '') +
          '<span class="jw-now-tag">lagi jalan</span></p>' +
        '<h4 class="jw-s-t">' + esc(s.title) + '</h4>' +
        (s.cancelled && s.cancelReason ? '<p class="jw-s-why">' + esc(s.cancelReason) + '</p>' : '') +
        (s.note ? '<p class="jw-s-note">' + esc(s.note) + '</p>' : '') +
        peopleHTML(s) +
        '<div class="jw-s-add">' +
          '<button type="button" class="jw-mini" data-add aria-expanded="false" aria-controls="' + menuId + '">+ Kalender</button>' +
          '<span class="jw-s-addm" id="' + menuId + '" hidden>' +
            '<a class="jw-mini" href="' + esc(googleCalendarUrl(s)) + '" target="_blank" rel="noopener">Google Calendar</a>' +
            '<button type="button" class="jw-mini" data-ics="session" data-uid="' + esc(s.uid) + '">File .ics</button>' +
          '</span>' +
        '</div>' +
      '</div>' +
      (s.cancelled ? slashHTML() : '') +
      '</li>';
  }

  // The red tape across a cancelled session. Purely decorative; the "Dibatalkan" tag says it in words.
  function slashHTML() {
    const run = '<span>Dibatalkan</span><i></i>'.repeat(6);
    return '<div class="jw-x" aria-hidden="true"><div class="jw-x-tilt"><div class="jw-x-bar">' +
      '<div class="jw-x-face"><div class="jw-x-run">' + run + run + '</div></div>' +
      '<div class="jw-x-edge"></div></div></div></div>';
  }

  function peopleHTML(s) {
    if (s.tim) return '<p class="jw-tim"><strong>Tim</strong> dosennya per kelompok</p>';
    if (!s.lecturers.length) return '';
    const pj = s.pj ? '<span class="jw-pj">PJ<span class="jw-sr">, penanggung jawab</span></span>' : '';
    return '<ul class="jw-ppl">' + s.lecturers.map((l) => {
      if (!l.dosen) {
        return '<li class="jw-p"><p class="jw-p-top"><span class="jw-p-n is-code">Kode ' + esc(l.code) + '</span>' + pj + '</p></li>';
      }
      return '<li class="jw-p"><p class="jw-p-top">' +
        '<button type="button" class="jw-p-n" data-dosen="' + esc(l.id) + '">' + esc(l.dosen.name) + '</button>' + pj + '</p>' +
        '<p class="jw-p-s">' + esc(l.dosen.spec) + '</p>' +
        phonesHTML(l.dosen.phones) + '</li>';
    }).join('') + '</ul>';
  }

  function emptyHTML(info) {
    const d = info.date;
    const isToday = d === state.today;
    const next = model.nextDate(d);
    const prev = model.prevDate(d);
    const title = isToday ? 'Hari ini <em>nggak ada kelas.</em>' : 'Tanggal ini <em>kosong.</em>';
    let why = '';
    if (info.libur) why = 'Libur ' + esc(info.libur) + '.';
    else if (!model.firstDate) why = 'Jadwalnya belum masuk.';
    else if (d < model.firstDate) why = esc(model.bloks[0]?.name || 'Blok') + ' baru mulai ' + formatDate(model.firstDate, 'medium') + '.';
    else if (!next) why = 'Jadwal setelah ' + esc(model.bloks[model.bloks.length - 1]?.name || 'blok ini') + ' belum masuk.';
    else if (!info.blok) why = 'Di luar masa blok.';
    else if (weekdayOf(d) === 0 || weekdayOf(d) === 6) why = 'Weekend.';
    const buttons = [];
    if (next) buttons.push('<button type="button" class="jw-btn pri" data-go="' + next + '">Lompat ke ' + formatDate(next, 'medium') + '</button>');
    if (prev && (!next || daysBetween(prev, d) <= 7)) buttons.push('<button type="button" class="jw-btn" data-go="' + prev + '">' + (next ? 'Balik ke ' : 'Lihat ') + formatDate(prev, 'medium') + '</button>');
    return '<div class="jw-empty"><p class="jw-empty-t">' + title + '</p>' + (why ? '<p class="jw-empty-s">' + why + '</p>' : '') +
      (buttons.length ? '<div class="jw-empty-b">' + buttons.join('') + '</div>' : '') + '</div>';
  }

  function footHTML(info) {
    const parts = [];
    if (info.sessions.some((s) => s.pj)) {
      parts.push('<p class="jw-note"><span class="jw-pj" aria-hidden="true">PJ</span> penanggung jawab. Yang ngajar di kelas bisa dosen lain.</p>');
    }
    const blokSessions = info.blok ? model.sessions.filter((s) => s.blokId === info.blok.id) : [];
    if (info.sessions.length || blokSessions.length) {
      parts.push('<div class="jw-save"><span class="jw-save-l">Simpan ke kalender</span>' +
        (info.sessions.length ? '<button type="button" class="jw-btn" data-ics="day">' + (info.date === state.today ? 'Hari ini' : formatDate(info.date, 'short')) + ' <span class="jw-ext">.ics</span></button>' : '') +
        (blokSessions.length ? '<button type="button" class="jw-btn" data-ics="blok">Semua ' + esc(info.blok.name) + ' <span class="jw-ext">.ics</span></button>' : '') +
        '</div>');
    }
    return parts.join('');
  }

  /** Marks the running session and the finished ones, only when the shown day is today. */
  function markNow() {
    const t = clock();
    const isToday = state.date === state.today;
    for (const li of el.list.querySelectorAll('.jw-s')) {
      const s = sessionByUid(li.dataset.uid);
      if (!s) continue;
      if (s.cancelled) continue;
      li.classList.toggle('is-now', isToday && s.startAt <= t && t < s.endAt);
      li.classList.toggle('is-past', isToday && t >= s.endAt);
    }
  }

  function sessionByUid(id) {
    return model.sessionsOn(state.date).find((s) => s.uid === id) || model.sessions.find((s) => s.uid === id) || null;
  }

  // ---------- now / next readout ----------

  function renderMonitor(initial) {
    const t = clock();
    const today = todayWIB(t);
    const { running, next } = model.nowAndNext(t);
    const ujian = model.nextUjian(t);
    const key = running.map((s) => s.uid).join() + '|' + (next?.uid || '') + '|' + (ujian?.uid || '') + '|' + today;
    if (key === state.statusKey) return false;
    const prevKey = state.statusKey;
    state.statusKey = key;
    countdowns = [];

    let a;
    if (running.length) {
      const s = running[0];
      const after = next && next.date === s.date ? '<p class="jw-ro-x">habis ini ' + esc(next.title) + ', ' + formatTime(next.start) + '</p>' : '';
      a = readout('now', 'Lagi jalan', s, timeRange(s) + (running.length > 1 ? ', barengan ' + (running.length - 1) + ' sesi lain' : ''),
        s.openEnd ? '<p class="jw-ro-n is-words">sampai selesai</p>' : countdownHTML(s.endAt, 'sisa'), after);
    } else if (next) {
      a = readout('next', 'Berikutnya', next, whenLabel(next, today), countdownHTML(next.startAt, 'lagi'), '');
    } else {
      a = '<div class="jw-ro" data-state="none"><p class="jw-ro-k">Berikutnya</p><p class="jw-ro-e">Belum ada jadwal lagi.</p></div>';
    }

    let b;
    if (ujian) {
      const going = ujian.startAt <= t;
      const label = going ? 'lagi jalan' : daysUntilLabel(ujian.date, today);
      const n = /^\d+/.exec(label);
      const big = n ? '<p class="jw-ro-n">' + n[0] + ' <small>' + label.slice(n[0].length).trim() + '</small></p>' : '<p class="jw-ro-n is-words">' + label + '</p>';
      b = readout('exam', 'Ujian berikutnya', ujian, whenLabel(ujian, today), big, '');
    } else {
      b = '<div class="jw-ro" data-state="none"><p class="jw-ro-k">Ujian berikutnya</p><p class="jw-ro-e">Belum ada ujian di jadwal.</p></div>';
    }
    el.mon.innerHTML = a + b;
    for (const node of el.mon.querySelectorAll('[data-until]')) countdowns.push({ node, at: +node.dataset.until });
    updateCountdowns(t);

    if (today !== state.today) {
      state.today = today;
      renderStrip();
      renderDay(0);
    }
    if (!initial && prevKey) {
      if (running.length) announce('Sekarang lagi jalan: ' + running[0].title + '.');
      else if (next && next.date === today) announce('Berikutnya ' + next.title + ', jam ' + formatTime(next.start) + '.');
    }
    return true;
  }

  function readout(kind, label, s, sub, big, extra) {
    return '<div class="jw-ro" data-state="' + kind + '">' +
      '<p class="jw-ro-k">' + label + '</p>' +
      '<button type="button" class="jw-ro-t" data-go="' + s.date + '" data-uid="' + esc(s.uid) + '">' + esc(s.title) + '</button>' +
      '<p class="jw-ro-s">' + esc(sub) + '</p>' + big + extra + '</div>';
  }

  function countdownHTML(at, word) {
    return '<p class="jw-ro-n" role="timer"><span data-until="' + at + '"></span> <small>' + word + '</small></p>';
  }

  function updateCountdowns(t) {
    for (const c of countdowns) {
      const p = countdownParts(c.at - t);
      const text = p.days >= 1
        ? p.days + ' hari' + (p.hours ? ' ' + p.hours + ' jam' : '')
        : pad(p.hours) + ':' + pad(p.minutes) + ':' + pad(p.seconds);
      if (c.node.textContent !== text) c.node.textContent = text;
    }
  }

  function tick() {
    tickTimer = 0;
    const t = clock();
    if (!renderMonitor(false)) updateCountdowns(t);
    markNow();
    scheduleTick();
  }

  function scheduleTick() {
    clearTimeout(tickTimer);
    tickTimer = 0;
    if (!state.onScreen || document.hidden) return;
    // land just after the next whole second so the digits change together with the device clock
    tickTimer = setTimeout(tick, 1000 - (clock() % 1000) + 15);
  }

  // ---------- navigation ----------

  function goDate(d, { focus = false, flash = '' } = {}) {
    if (!isISODate(d)) return;
    const dir = d > state.date ? 1 : d < state.date ? -1 : 0;
    state.date = d;
    renderStrip();
    renderDay(dir);
    markBloks();
    if (focus) el.date.focus({ preventScroll: true });
    if (flash) flashSession(flash);
  }

  function flashSession(sessionUid) {
    const li = el.list.querySelector('.jw-s[data-uid="' + CSS.escape(sessionUid) + '"]');
    if (!li) return;
    clearTimeout(flashTimer);
    li.classList.add('is-flash');
    flashTimer = setTimeout(() => li.classList.remove('is-flash'), 1600);
  }

  function goBlok(id) {
    const blok = model.blokById(id);
    if (!blok) return;
    const target = state.today >= blok.start && state.today <= blok.end ? state.today : model.nearestDate(blok.start) || blok.start;
    goDate(target);
  }

  function onClick(event) {
    const t = event.target;
    const go = t.closest('[data-go]');
    if (go) {
      // the empty state replaces itself, so move focus somewhere that survives
      const inList = el.list.contains(go);
      goDate(go.dataset.go, { focus: inList, flash: go.dataset.uid || '' });
      return;
    }
    const person = t.closest('[data-dosen]');
    if (person) {
      document.dispatchEvent(new CustomEvent('alpha:open', { detail: { type: 'dosen', id: person.dataset.dosen } }));
      return;
    }
    const blok = t.closest('[data-blok]');
    if (blok) return goBlok(blok.dataset.blok);
    const chip = t.closest('.jw-chip');
    if (chip) return goDate(chip.dataset.date);
    const act = t.closest('[data-act]');
    if (act) return onAction(act.dataset.act);
    const add = t.closest('[data-add]');
    if (add) {
      const menu = root.querySelector('#' + add.getAttribute('aria-controls'));
      const open = add.getAttribute('aria-expanded') !== 'true';
      add.setAttribute('aria-expanded', String(open));
      if (menu) menu.hidden = !open;
      return;
    }
    const ics = t.closest('[data-ics]');
    if (ics) return exportICS(ics.dataset.ics, ics.dataset.uid);
  }

  function onAction(act) {
    if (act === 'prev') {
      const d = model.prevDate(state.date);
      if (d) goDate(d);
    } else if (act === 'next') {
      const d = model.nextDate(state.date);
      if (d) goDate(d);
    } else if (act === 'today') {
      goDate(state.today);
      el.strip.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    } else if (act === 'cal') {
      openCal();
    }
  }

  function exportICS(kind, sessionUid) {
    const stamp = clock();
    if (kind === 'session') {
      const s = sessionByUid(sessionUid);
      if (s) downloadICS(sessionCalendar(s, { stamp }), sessionFilename(s));
    } else if (kind === 'day') {
      const list = model.sessionsOn(state.date);
      if (list.length) downloadICS(dayCalendar(list, state.date, { stamp }), dayFilename(state.date));
    } else if (kind === 'blok') {
      const blok = model.blokFor(state.date);
      if (blok) downloadICS(blokCalendar(model.sessions.filter((s) => s.blokId === blok.id), blok, { stamp }), blokFilename(blok));
    }
  }

  function onStripKey(event) {
    const chip = event.target.closest('.jw-chip');
    if (!chip) return;
    const d = chip.dataset.date;
    const moves = { ArrowLeft: -1, ArrowRight: 1, PageUp: -7, PageDown: 7 };
    let to = null;
    if (event.key in moves) to = addDays(d, moves[event.key]);
    else if (event.key === 'Home') to = startOfWeek(d);
    else if (event.key === 'End') to = addDays(startOfWeek(d), 6);
    if (!to) return;
    event.preventDefault();
    goDate(to);
    el.strip.querySelector('[data-date="' + to + '"]')?.focus({ preventScroll: true });
  }

  // a quick horizontal swipe on the session list moves to the previous or next class day
  let touch = null;
  function onTouchStart(e) {
    if (e.touches.length !== 1) return (touch = null);
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp };
  }
  function onTouchEnd(e) {
    if (!touch) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - touch.x;
    const dy = p.clientY - touch.y;
    const quick = e.timeStamp - touch.t < 700;
    touch = null;
    if (!quick || Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 2) return;
    const d = dx < 0 ? model.nextDate(state.date) : model.prevDate(state.date);
    if (d) goDate(d);
  }

  // ---------- month calendar (ARIA grid date picker) ----------

  function openCal() {
    state.calMonth = monthOf(state.date);
    state.calFocus = state.date;
    renderCal();
    calReturn = el.calBtn;
    if (typeof el.dlg.showModal === 'function') el.dlg.showModal();
    else el.dlg.setAttribute('open', '');
    placeCal();
    focusCalCell();
  }

  function closeCal() {
    if (el.dlg.open) {
      if (typeof el.dlg.close === 'function') el.dlg.close();
      else {
        el.dlg.removeAttribute('open');
        onCalClose();
      }
    }
  }

  function onCalClose() {
    const back = calReturn;
    calReturn = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }

  /** Anchors the popover under the button on wide screens; narrow screens get a bottom sheet from CSS. */
  function placeCal() {
    const dlg = el.dlg;
    dlg.style.removeProperty('--x');
    dlg.style.removeProperty('--y');
    if (!matchMedia('(min-width: 640px)').matches) return;
    const r = el.calBtn.getBoundingClientRect();
    const w = dlg.offsetWidth;
    const h = dlg.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const x = Math.min(Math.max(16, r.left + r.width / 2 - w / 2), vw - w - 16);
    let y = r.bottom + 10;
    if (y + h > vh - 16) y = r.top - h - 10;
    if (y < 16) y = Math.max(16, (vh - h) / 2);
    dlg.style.setProperty('--x', Math.round(x) + 'px');
    dlg.style.setProperty('--y', Math.round(y) + 'px');
  }

  function renderCal() {
    const { y, m } = state.calMonth;
    const prefix = y + '-' + pad(m);
    const dots = model.datesInMonth(y, m);
    el.calTitle.textContent = MONTHS[m - 1] + ' ' + y;
    el.calBody.innerHTML = monthGrid(y, m).map((week) => '<tr>' + week.map((d) => {
      const info = model.dayInfo(d);
      const blok = info.blok;
      const day = parseISO(d).d;
      const cls = [];
      if (!d.startsWith(prefix)) cls.push('out');
      if (dots.has(d) || (info.sessions.length && !d.startsWith(prefix))) cls.push('has');
      if (info.sessions.some((s) => s.kind === 'ujian')) cls.push('exam');
      if (info.libur) cls.push('libur');
      if (d === state.today) cls.push('today');
      if (blok) cls.push('inb');
      if (blok && d === blok.start) cls.push('bs');
      if (blok && d === blok.end) cls.push('be');
      const n = info.sessions.length;
      const sr = day + ' ' + MONTHS[parseISO(d).m - 1] + (n ? ', ' + n + ' sesi' : '') + (info.libur ? ', libur' : '') +
        (cls.includes('exam') ? ', ada ujian' : '') + (d === state.today ? ', hari ini' : '') +
        (blok && d === blok.start ? ', ' + blok.name + ' mulai' : '') + (blok && d === blok.end ? ', ' + blok.name + ' selesai' : '');
      return '<td class="' + cls.join(' ') + '" data-date="' + d + '" tabindex="' + (d === state.calFocus ? 0 : -1) + '" aria-selected="' + (d === state.date) + '">' +
        '<span class="jw-cd" aria-hidden="true">' + day + '</span><span class="jw-sr">' + sr + '</span></td>';
    }).join('') + '</tr>').join('');
  }

  function focusCalCell() {
    el.calBody.querySelector('[data-date="' + state.calFocus + '"]')?.focus();
  }

  function moveCalFocus(d) {
    const mo = monthOf(d);
    const changed = mo.y !== state.calMonth.y || mo.m !== state.calMonth.m;
    state.calFocus = d;
    if (changed) {
      state.calMonth = mo;
      renderCal();
    } else {
      for (const td of el.calBody.querySelectorAll('td[tabindex="0"]')) td.tabIndex = -1;
      const td = el.calBody.querySelector('[data-date="' + d + '"]');
      if (td) td.tabIndex = 0;
    }
    focusCalCell();
  }

  function shiftMonth(d, n) {
    const { y, m, d: day } = parseISO(d);
    const to = addMonths(y, m, n);
    return to.y + '-' + pad(to.m) + '-' + pad(Math.min(day, daysInMonth(to.y, to.m)));
  }

  function chooseCal(d) {
    closeCal();
    goDate(d);
  }

  function onCalKey(event) {
    const td = event.target.closest('td[data-date]');
    if (!td) return;
    const d = td.dataset.date;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let to = null;
    if (event.key in moves) to = addDays(d, moves[event.key]);
    else if (event.key === 'Home') to = startOfWeek(d);
    else if (event.key === 'End') to = addDays(startOfWeek(d), 6);
    else if (event.key === 'PageUp') to = shiftMonth(d, event.shiftKey ? -12 : -1);
    else if (event.key === 'PageDown') to = shiftMonth(d, event.shiftKey ? 12 : 1);
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      return chooseCal(d);
    }
    if (!to) return;
    event.preventDefault();
    moveCalFocus(to);
  }

  function onCalClick(event) {
    if (event.target === el.dlg) return closeCal(); // click on the backdrop
    const td = event.target.closest('td[data-date]');
    if (td) return chooseCal(td.dataset.date);
    const b = event.target.closest('[data-cal]');
    if (!b) return;
    const k = b.dataset.cal;
    if (k === 'close') return closeCal();
    if (k === 'today') return chooseCal(state.today);
    const n = k === 'prev' ? -1 : 1;
    state.calMonth = addMonths(state.calMonth.y, state.calMonth.m, n);
    state.calFocus = shiftMonth(state.calFocus, n);
    renderCal();
  }

  // ---------- search over sessions ----------

  let findFrame = 0;
  function onFind() {
    cancelAnimationFrame(findFrame);
    findFrame = requestAnimationFrame(renderFind);
  }

  function renderFind() {
    const q = el.q.value.trim();
    if (q === state.query) return;
    state.query = q;
    if (!q) {
      el.hits.innerHTML = '';
      el.hitsCount.textContent = '';
      return;
    }
    const all = model.search(q);
    const shown = all.slice(0, 12);
    el.hitsCount.textContent = all.length ? all.length + ' sesi ketemu' + (all.length > shown.length ? ', ini 12 yang pertama' : '') : 'Nggak ketemu.';
    el.hits.innerHTML = shown.map((s) =>
      '<li><button type="button" class="jw-hit" data-go="' + s.date + '" data-uid="' + esc(s.uid) + '">' +
        '<span class="jw-hit-t">' + esc(s.title) + '</span>' +
        '<span class="jw-hit-m">' + formatDate(s.date, 'short') + ', ' + formatTime(s.start) + ', ' + esc(s.kindLabel) + '</span>' +
      '</button></li>'
    ).join('');
  }

  // ---------- outside world ----------

  function onOpen(event) {
    const detail = event.detail || {};
    if (detail.type !== 'date' || !isISODate(detail.date)) return;
    detail.handled = true;
    goDate(detail.date, { flash: detail.uid || '' });
    root.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    el.date.focus({ preventScroll: true });
  }

  function onVisibility() {
    if (document.hidden) return scheduleTick();
    tick();
  }

  let io = null;
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver((entries) => {
      const visible = entries[entries.length - 1].isIntersecting;
      if (visible === state.onScreen) return;
      state.onScreen = visible;
      if (visible) tick();
      else scheduleTick();
    }, { rootMargin: '120px 0px' });
    io.observe(root);
  }

  // The tape leans toward the pointer. One listener for the whole list, one style write per frame.
  let tiltFrame = 0, tiltLi = null, tiltX = 0, tiltY = 0;
  function onSlashMove(e) {
    const li = e.target.closest?.('.jw-s.is-batal');
    if (li !== tiltLi) {
      if (tiltLi) tiltLi.style.removeProperty('--tx'), tiltLi.style.removeProperty('--ty');
      tiltLi = li;
    }
    if (!li) return;
    const r = li.getBoundingClientRect();
    tiltX = ((e.clientX - r.left) / r.width) * 2 - 1;
    tiltY = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (!tiltFrame) tiltFrame = requestAnimationFrame(() => {
      tiltFrame = 0;
      if (!tiltLi) return;
      tiltLi.style.setProperty('--tx', tiltX.toFixed(3));
      tiltLi.style.setProperty('--ty', tiltY.toFixed(3));
    });
  }
  function onSlashLeave() {
    if (tiltLi) tiltLi.style.removeProperty('--tx'), tiltLi.style.removeProperty('--ty');
    tiltLi = null;
  }
  if (matchMedia('(hover: hover) and (pointer: fine)').matches && !prefersReducedMotion()) {
    el.list.addEventListener('pointermove', onSlashMove, { passive: true });
    el.list.addEventListener('pointerleave', onSlashLeave);
  }

  root.addEventListener('click', onClick);
  el.strip.addEventListener('keydown', onStripKey);
  el.list.addEventListener('touchstart', onTouchStart, { passive: true });
  el.list.addEventListener('touchend', onTouchEnd, { passive: true });
  el.dlg.addEventListener('keydown', onCalKey);
  el.dlg.addEventListener('click', onCalClick);
  el.dlg.addEventListener('close', onCalClose);
  el.q.addEventListener('input', onFind);
  document.addEventListener('alpha:open', onOpen);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);

  let resizeFrame = 0;
  function onResize() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => el.dlg.open && placeCal());
  }

  renderAll();
  scheduleTick();

  return {
    update(next = {}) {
      data = { schedule: next.schedule ?? data.schedule, dosen: next.dosen ?? data.dosen };
      model = createModel(data.schedule, data.dosen);
      state.stripKey = '';
      state.statusKey = '';
      state.query = '';
      renderAll();
      renderFind();
    },
    /** Jumps to a date; same as dispatching alpha:open with type 'date'. */
    go(date) {
      goDate(date);
    },
    /** The date on screen and today's, for the live editor. */
    current() {
      return { date: state.date, today: state.today };
    },
    destroy() {
      clearTimeout(tickTimer);
      clearTimeout(flashTimer);
      cancelAnimationFrame(findFrame);
      cancelAnimationFrame(resizeFrame);
      io?.disconnect();
      unbindCopy();
      root.removeEventListener('click', onClick);
      document.removeEventListener('alpha:open', onOpen);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      if (el.dlg.open) el.dlg.close();
      root.innerHTML = '';
      root.classList.remove('jw');
      if (labelled) root.removeAttribute('aria-labelledby');
    },
  };
}

function shellHTML(uid) {
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((w) => '<th scope="col" abbr="' + DAYS[w] + '">' + DAYS_SHORT[w] + '</th>').join('');
  return '<div class="jw-in">' +
    '<header class="jw-head">' +
      '<h2 class="jw-h" id="' + uid + '-h"><span data-k="jadwal.h1">hari ini</span> <em data-k="jadwal.h2">kuliah apa?</em></h2>' +
      '<div class="jw-bloks" role="group" aria-label="Pilih blok"></div>' +
    '</header>' +
    '<div class="jw-grid">' +
      '<div class="jw-side"><div class="jw-mon"></div></div>' +
      '<div class="jw-main">' +
        '<div class="jw-top">' +
          '<div class="jw-dayhead">' +
            '<p class="jw-rel"></p>' +
            '<h3 class="jw-date" tabindex="-1"></h3>' +
            '<p class="jw-blokline"></p>' +
          '</div>' +
          '<div class="jw-bar">' +
            '<button type="button" class="jw-ic" data-act="prev" aria-label="Hari kuliah sebelumnya">' + ICON.prev + '</button>' +
            '<button type="button" class="jw-btn jw-calbtn" data-act="cal" aria-haspopup="dialog">' + ICON.cal + '<span class="jw-calbtn-t">Kalender</span></button>' +
            '<button type="button" class="jw-btn" data-act="today">Hari ini</button>' +
            '<button type="button" class="jw-ic" data-act="next" aria-label="Hari kuliah berikutnya">' + ICON.next + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="jw-strip" role="group" aria-label="Pilih hari"></div>' +
        '<p class="jw-sum" aria-hidden="true"></p>' +
        '<div class="jw-list"></div>' +
        '<div class="jw-foot"></div>' +
        '<div class="jw-find">' +
          '<label class="jw-find-l" for="' + uid + '-q">Cari materi atau dosen</label>' +
          '<input class="jw-q" id="' + uid + '-q" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="pedigree, ziske, OSPE">' +
          '<p class="jw-hitc" aria-live="polite"></p>' +
          '<ol class="jw-hits"></ol>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<dialog class="jw-cal" aria-label="Pilih tanggal">' +
      '<div class="jw-cal-in">' +
        '<div class="jw-cal-top">' +
          '<button type="button" class="jw-ic" data-cal="prev" aria-label="Bulan sebelumnya">' + ICON.prev + '</button>' +
          '<h3 class="jw-cal-h" id="' + uid + '-calh" aria-live="polite"></h3>' +
          '<button type="button" class="jw-ic" data-cal="next" aria-label="Bulan berikutnya">' + ICON.next + '</button>' +
        '</div>' +
        '<table class="jw-cal-g" role="grid" aria-labelledby="' + uid + '-calh"><thead><tr>' + weekdays + '</tr></thead><tbody></tbody></table>' +
        '<p class="jw-cal-key" aria-hidden="true"><span class="k-has">ada kelas</span><span class="k-exam">ujian</span><span class="k-blok">masa blok</span></p>' +
        '<div class="jw-cal-foot">' +
          '<button type="button" class="jw-btn" data-cal="today">Hari ini</button>' +
          '<button type="button" class="jw-btn pri" data-cal="close">Tutup</button>' +
        '</div>' +
      '</div>' +
    '</dialog>' +
    '<p class="jw-live jw-sr" aria-live="polite"></p>' +
  '</div>';
}
