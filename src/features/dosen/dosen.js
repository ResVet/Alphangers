// Dosen: the lecturer directory. Instant search, blok and specialty filters, A to Z groups,
// and a detail dialog listing every session the person teaches in the class schedule.
import './dosen.css';
import { createModel, compact, queryTokens, formatDate, formatTime } from '../../lib/schedule-model.js';
import { esc, phonesHTML, bindCopy, makeAnnouncer, prefersReducedMotion, makeClock, labelRegion } from './contact.js';

const CHUNK = 60;
const FOLD_MIN = 6; // rows visible above the fold before "Lihat semua"
const FOLD_FILTERED = 30; // a filtered result up to this size shows in full
let mounts = 0;

// 33 specialty labels in the data, folded into groups a student would filter by.
// Anything not listed (a new specialty after a data rebuild) lands in "Lainnya".
export const SPEC_GROUPS = [
  { id: 'dokter', label: 'Dokter non-Sp', specs: ['Dokter'] },
  { id: 'nondokter', label: 'Non-dokter', specs: ['Dosen'] },
  { id: 'interna', label: 'Penyakit Dalam', specs: ['Penyakit Dalam'] },
  { id: 'anak', label: 'Anak', specs: ['Anak'] },
  { id: 'obgin', label: 'Obgin', specs: ['Obstetri dan Ginekologi'] },
  { id: 'bedah', label: 'Bedah', specs: ['Bedah', 'Bedah Saraf', 'Bedah Anak', 'Bedah Plastik', 'Bedah Toraks Kardiovaskular', 'Ortopedi', 'Urologi'] },
  { id: 'saraf', label: 'Saraf & Jiwa', specs: ['Neurologi', 'Kedokteran Jiwa'] },
  { id: 'organ', label: 'Mata, THT, Kulit', specs: ['Mata', 'THT-KL', 'Kulit dan Kelamin'] },
  { id: 'lab', label: 'Lab & Radiologi', specs: ['Patologi Anatomi', 'Patologi Klinik', 'Radiologi', 'Mikrobiologi Klinik', 'Parasitologi Klinik', 'Farmakologi Klinik'] },
  { id: 'lain', label: 'Lainnya', specs: [] },
];
const GROUP_BY_SPEC = new Map(SPEC_GROUPS.flatMap((g) => g.specs.map((s) => [s, g])));
const OTHER = SPEC_GROUPS[SPEC_GROUPS.length - 1];

// Leading words that are titles or honorifics, not the name people search or sort by.
const TITLE_WORDS = new Set(['prof', 'dr', 'drs', 'dra', 'drg', 'drh', 'apt', 'ir', 'kompol', 'h', 'hj']);

/** 'dr. H. M. Alsen Arlan, SpB-KBD' sorts as 'alsen arlan'. */
export function sortKey(name) {
  const tokens = String(name ?? '').split(',')[0].trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length - 1) {
    const t = tokens[i];
    if (t.endsWith('.') || TITLE_WORDS.has(t.toLowerCase())) i++;
    else break;
  }
  return tokens.slice(i).join(' ').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').trim();
}

function letterOf(key) {
  const c = key.charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}

function indexPeople(dosenData, model) {
  const list = Array.isArray(dosenData?.list) ? dosenData.list : [];
  return list
    .filter((p) => p && p.id && p.name)
    .map((p) => {
      const key = sortKey(p.name) || p.name.toLowerCase();
      const group = GROUP_BY_SPEC.get(p.spec) || OTHER;
      const codes = Object.entries(p.codes || {});
      const phones = Array.isArray(p.phones) ? p.phones : [];
      return {
        p,
        id: p.id,
        key,
        letter: letterOf(key),
        group,
        bloks: new Set(Array.isArray(p.bloks) ? p.bloks : []),
        codes,
        codeSet: new Set(codes.map(([, c]) => String(c).toLowerCase())),
        hay: [p.name, sortKey(p.name), p.spec, group.label, ...codes.map(([, c]) => c)].map(compact).join('|'),
        digits: phones.flatMap((ph) => [ph.n, ph.wa]).filter(Boolean).join('|'),
        teaches: model.sessionsByDosen(p.id).length,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key, 'id') || a.p.name.localeCompare(b.p.name, 'id'));
}

/**
 * Turns the search box into a matcher. Rules:
 * digits only (with + - ( ) or spaces) search phone numbers;
 * an exact blok code typed in capitals ("AH") finds only that code;
 * otherwise every word must appear in the name, title, specialty or a code.
 */
export function parseQuery(raw, knownCodes) {
  const text = String(raw ?? '').trim();
  if (!text) return { kind: 'all' };
  if (/^[+\d\s().-]+$/.test(text)) {
    const digits = text.replace(/\D/g, '');
    if (digits.length >= 3) return { kind: 'phone', digits };
  }
  if (/^[A-Z]{2,4}$/.test(text) && knownCodes.has(text.toLowerCase())) return { kind: 'code', code: text.toLowerCase() };
  const tokens = queryTokens(text);
  return tokens.length ? { kind: 'text', tokens } : { kind: 'all' };
}

export function matchesQuery(x, q) {
  switch (q.kind) {
    case 'phone': return x.digits.includes(q.digits);
    case 'code': return x.codeSet.has(q.code);
    case 'text': return q.tokens.every((t) => x.hay.includes(t) || x.codeSet.has(t));
    default: return true;
  }
}

export function mountDosen(root, { schedule, dosen, now } = {}) {
  if (!root) throw new Error('mountDosen needs a root element');
  const uid = 'dz' + ++mounts;
  const clock = makeClock(now);
  let data = { schedule, dosen };
  let model = createModel(schedule, dosen);
  let people = indexPeople(dosen, model);
  let byId = new Map(people.map((x) => [x.id, x]));
  let knownCodes = new Set(people.flatMap((x) => [...x.codeSet]));

  // Filters are strict: a lecturer shows only when every selected tag applies. Every chosen blok
  // must be one they teach in, and specialty is one choice at a time (a person has exactly one).
  const filter = { q: { kind: 'all' }, bloks: new Set(), group: null };
  const rows = new Map();
  let rendered = 0;
  let renderHandle = 0;
  let started = false;
  let returnFocus = null;
  let skipReturn = false;
  let flashTimer = 0;
  let countTimer = 0;
  let inputFrame = 0;
  // The full list is a few hundred rows. Until someone searches, filters, jumps to a letter or
  // asks for everything, only the top of it shows, so the sections below stay within reach.
  // "Ringkas" folds it back, from the button under the list or the bar that follows the reader.
  let expanded = false;
  // Rows past the first slice are built only once they can be seen: expanded, filtered or searched.
  let wantAll = false;

  root.classList.add('dz');
  root.innerHTML = shellHTML(uid);
  const labelled = labelRegion(root, uid + '-h');
  const $ = (sel) => root.querySelector(sel);
  const el = {
    count: $('.dz-count'),
    tools: $('.dz-tools'),
    q: $('.dz-q'),
    blokChips: $('.dz-chips-blok'),
    groupChips: $('.dz-chips-spec'),
    clear: $('.dz-clear'),
    az: $('.dz-az'),
    list: $('.dz-list'),
    empty: $('.dz-empty'),
    more: $('.dz-more'),
    moreB: $('.dz-more-b'),
    less: $('.dz-less'),
    jump: $('.dz-jump'),
    dock: $('.dz-dock'),
    active: $('.dz-active'),
    end: $('.dz-end'),
    dlg: $('.dz-dlg'),
    dlgBody: $('.dz-dlg-in'),
    live: $('.dz-live'),
  };
  const announce = makeAnnouncer(el.live);
  const unbindCopy = bindCopy(root, announce);

  // ---------- list ----------

  function letters() {
    return [...new Set(people.map((x) => x.letter))];
  }

  function renderShells() {
    rows.clear();
    rendered = 0;
    const counts = new Map();
    for (const x of people) counts.set(x.letter, (counts.get(x.letter) || 0) + 1);
    el.list.innerHTML = letters().map((L) =>
      '<div class="dz-g" data-letter="' + L + '" style="contain-intrinsic-size:auto ' + Math.round(counts.get(L) * 116 + 64) + 'px">' +
        '<h3 class="dz-g-h" id="' + uid + '-g-' + L + '" tabindex="-1">' + L + '</h3>' +
        '<ul class="dz-rows" aria-labelledby="' + uid + '-g-' + L + '"></ul></div>'
    ).join('');
    el.az.innerHTML = letters().map((L) => '<button type="button" class="dz-az-b" data-letter="' + L + '">' + L + '</button>').join('');
  }

  function rowHTML(x) {
    const p = x.p;
    const codes = x.codes.map(([b, c]) => {
      const blok = model.blokById(b);
      return '<span class="dz-code"><span aria-hidden="true">' + esc(b.toUpperCase()) + '</span><span class="dz-sr">' + esc(blok ? blok.name : b) + ', kode</span> ' + esc(c) + '</span>';
    }).join('');
    const teaches = x.teaches ? '<span class="dz-teach">' + x.teaches + ' sesi di jadwal</span>' : '';
    return '<li class="dz-row" data-id="' + esc(x.id) + '"' + (isVisible(x) ? '' : ' hidden') + '>' +
      '<div class="dz-who">' +
        '<button type="button" class="dz-name" data-open="' + esc(x.id) + '" aria-haspopup="dialog">' + esc(p.name) + '</button>' +
        '<p class="dz-meta"><span class="dz-spec">' + esc(p.spec || 'Dosen') + '</span>' + codes + teaches + '</p>' +
      '</div>' +
      '<div class="dz-phones">' + phonesHTML(p.phones) + '</div>' +
    '</li>';
  }

  /** Appends the next slice of rows. The browser gets the main thread back between slices. */
  function renderChunk() {
    renderHandle = 0;
    const end = Math.min(people.length, rendered + CHUNK);
    const byLetter = new Map();
    for (let i = rendered; i < end; i++) {
      const x = people[i];
      byLetter.set(x.letter, (byLetter.get(x.letter) || '') + rowHTML(x));
    }
    const tpl = document.createElement('template');
    for (const [L, html] of byLetter) {
      tpl.innerHTML = html;
      for (const li of tpl.content.children) rows.set(li.dataset.id, li);
      el.list.querySelector('.dz-g[data-letter="' + L + '"] .dz-rows')?.append(tpl.content);
    }
    rendered = end;
    if (rendered < people.length && wantAll) renderHandle = idle(renderChunk);
  }

  function flushRender() {
    cancelIdle(renderHandle);
    renderHandle = 0;
    started = true;
    while (rendered < people.length) renderChunk();
    cancelIdle(renderHandle);
    renderHandle = 0;
  }

  function startRender() {
    if (!started) {
      started = true;
      renderChunk();
    }
  }

  /** The rest of the rows, in idle slices, once more than the folded top can be seen. */
  function renderRest() {
    startRender();
    if (wantAll) return;
    wantAll = true;
    if (rendered < people.length && !renderHandle) renderHandle = idle(renderChunk);
  }

  // ---------- filtering ----------

  function isVisible(x) {
    for (const b of filter.bloks) if (!x.bloks.has(b)) return false;
    if (filter.group && x.group.id !== filter.group) return false;
    return matchesQuery(x, filter.q);
  }

  function isActive() {
    return filter.q.kind !== 'all' || filter.bloks.size > 0 || !!filter.group;
  }

  function applyFilter() {
    const perLetter = new Map();
    let shown = 0;
    for (const x of people) {
      const v = isVisible(x);
      if (v) {
        shown++;
        perLetter.set(x.letter, (perLetter.get(x.letter) || 0) + 1);
      }
      const li = rows.get(x.id);
      if (li && li.hidden === v) li.hidden = !v;
    }
    for (const g of el.list.children) g.hidden = !perLetter.get(g.dataset.letter);
    for (const b of el.az.children) b.disabled = !perLetter.get(b.dataset.letter);
    el.empty.hidden = shown > 0;
    const active = isActive();
    if (active) renderRest();
    el.clear.hidden = !active;
    el.count.textContent = active ? shown + ' dari ' + people.length + ' dosen' : people.length + ' dosen';
    el.active.textContent = activeLabel();
    el.active.hidden = !el.active.textContent;
    const folded = !expanded && shown > (active ? FOLD_FILTERED : FOLD_MIN);
    root.classList.toggle('dz-folded', folded);
    root.classList.toggle('dz-open', expanded && shown > FOLD_MIN);
    el.more.hidden = !folded;
    el.less.hidden = !(expanded && shown > FOLD_MIN);
    if (folded) el.moreB.textContent = 'Lihat semua ' + shown + ' dosen';
    renderChips();
    clearTimeout(countTimer);
    if (active) countTimer = setTimeout(() => announce(shown ? shown + ' dosen ketemu.' : 'Nggak ketemu.'), 700);
  }

  /** "Blok 1 + Blok 2 · Non-dokter": what the list is narrowed to, in words. */
  function activeLabel() {
    const parts = [...filter.bloks].map((b) => model.blokById(b)?.name || b);
    const g = filter.group && SPEC_GROUPS.find((x) => x.id === filter.group);
    const words = [];
    if (parts.length) words.push('ngajar di ' + parts.join(' dan '));
    if (g) words.push(g.label);
    return words.length ? 'Cuma yang ' + words.join(', spesialis ') : '';
  }

  /**
   * Chip counts say what you would get after pressing the chip. A blok chip adds that blok to the
   * ones already chosen (everyone left must teach in all of them); a specialty chip replaces the
   * current specialty. A pressed chip shows the size of the current result.
   */
  function renderChips() {
    const withBloks = (x, bloks) => {
      for (const b of bloks) if (!x.bloks.has(b)) return false;
      return true;
    };
    const visibleQ = people.filter((x) => matchesQuery(x, filter.q));
    el.blokChips.innerHTML = model.bloks.map((b) => {
      const on = filter.bloks.has(b.id);
      const bloks = on ? filter.bloks : new Set([...filter.bloks, b.id]);
      const n = visibleQ.reduce((s, x) => s + (withBloks(x, bloks) && (!filter.group || x.group.id === filter.group) ? 1 : 0), 0);
      return chipHTML('blok', b.id, b.name, n, on);
    }).join('');
    el.groupChips.innerHTML = SPEC_GROUPS.map((g) => {
      const n = visibleQ.reduce((s, x) => s + (x.group === g && withBloks(x, filter.bloks) ? 1 : 0), 0);
      return chipHTML('group', g.id, g.label, n, filter.group === g.id);
    }).join('');
  }

  function chipHTML(kind, id, label, n, on) {
    return '<button type="button" class="dz-chip" data-' + kind + '="' + esc(id) + '" aria-pressed="' + on + '"' + (n || on ? '' : ' disabled') + '>' +
      esc(label) + ' <span class="dz-chip-n">' + n + '</span></button>';
  }

  function clearFilters() {
    cancelAnimationFrame(inputFrame);
    inputFrame = 0;
    filter.bloks.clear();
    filter.group = null;
    filter.q = { kind: 'all' };
    el.q.value = '';
    applyFilter();
  }

  function onInput() {
    cancelAnimationFrame(inputFrame);
    inputFrame = requestAnimationFrame(() => {
      inputFrame = 0;
      filter.q = parseQuery(el.q.value, knownCodes);
      startRender();
      applyFilter();
    });
  }

  /** Applies a keystroke that is still waiting for its frame, so the list matches the box right now. */
  function flushInput() {
    if (!inputFrame) return;
    cancelAnimationFrame(inputFrame);
    inputFrame = 0;
    filter.q = parseQuery(el.q.value, knownCodes);
    applyFilter();
  }

  // ---------- detail dialog ----------

  /** Opens a person's detail. Focus goes back to `from` on close, else to whatever had focus, else their row. */
  function expand() {
    renderRest();
    if (expanded) return;
    expanded = true;
    applyFilter();
  }

  /** Folds the list back and puts the reader at its top, where the search box is. */
  function collapse() {
    if (!expanded) return;
    expanded = false;
    applyFilter();
    const top = el.tools.getBoundingClientRect().top + window.scrollY;
    const bar = parseFloat(getComputedStyle(root).getPropertyValue('--dz-top')) || 64;
    window.scrollTo({ top: Math.max(0, top - bar - 12), behavior: 'auto' });
    el.moreB.focus({ preventScroll: true });
    announce('Daftar diringkas.');
  }

  function onListFocus(event) {
    if (expanded || !root.classList.contains('dz-folded')) return;
    if (event.target.getBoundingClientRect().bottom > el.list.getBoundingClientRect().bottom - 8) expand();
  }

  function open(id, { scroll = true, from = null } = {}) {
    const x = byId.get(id);
    if (!x) return false;
    if (scroll) expand();
    flushRender();
    flushInput();
    if (!isVisible(x)) clearFilters();
    const row = rows.get(id);
    if (!el.dlg.open) {
      const active = document.activeElement;
      const usable = active && active !== document.body && !el.dlg.contains(active);
      returnFocus = from || (usable ? active : row?.querySelector('.dz-name'));
    }
    if (row && scroll) {
      row.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      clearTimeout(flashTimer);
      row.classList.add('is-flash');
      flashTimer = setTimeout(() => row.classList.remove('is-flash'), 1800);
    }
    el.dlgBody.innerHTML = detailHTML(x);
    if (!el.dlg.open) {
      if (typeof el.dlg.showModal === 'function') el.dlg.showModal();
      else el.dlg.setAttribute('open', '');
    }
    el.dlgBody.scrollTop = 0;
    el.dlg.querySelector('.dz-dlg-n')?.focus();
    return true;
  }

  function detailHTML(x) {
    const p = x.p;
    const t = clock();
    const sessions = model.sessionsByDosen(x.id);
    const nextIdx = sessions.findIndex((s) => s.endAt > t);
    const codes = x.codes.map(([b, c]) => (model.blokById(b)?.name || b) + ', kode ' + c).join('. ');
    let list;
    if (sessions.length) {
      list = '<ol class="dz-se">' + sessions.map((s, i) => {
        const tag = i === nextIdx ? '<span class="dz-se-next">berikutnya</span>' : '';
        return '<li class="' + (s.endAt <= t ? 'is-past' : '') + '">' +
          '<button type="button" class="dz-se-b" data-date="' + s.date + '" data-uid="' + esc(s.uid) + '">' +
            '<span class="dz-se-d">' + formatDate(s.date, 'short') + '<span class="dz-se-tm">' + formatTime(s.start) + ' - ' + (s.end ? formatTime(s.end) : 'selesai') + '</span></span>' +
            '<span class="dz-se-t">' + esc(s.title) + '</span>' +
            '<span class="dz-se-k">' + esc(s.kindLabel) + (s.pj ? ', sebagai PJ' : '') + tag + '</span>' +
            '<span class="dz-sr">, buka di jadwal</span>' +
          '</button></li>';
      }).join('') + '</ol>';
    } else {
      list = '<p class="dz-dlg-none">Belum ada jadwal ngajar di kelas Alpha.</p>';
    }
    return '<div class="dz-dlg-top">' +
        '<p class="dz-dlg-k">' + esc(p.spec || 'Dosen') + '</p>' +
        '<button type="button" class="dz-x" data-close aria-label="Tutup"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
      '</div>' +
      '<h3 class="dz-dlg-n" id="' + uid + '-dn" tabindex="-1">' + esc(p.name) + '</h3>' +
      (codes ? '<p class="dz-dlg-codes">' + esc(codes) + '</p>' : '') +
      '<div class="dz-dlg-ph">' + phonesHTML(p.phones) + '</div>' +
      '<h4 class="dz-dlg-sub">Jadwal ngajar di kelas Alpha' + (sessions.length ? ' <span>' + sessions.length + ' sesi</span>' : '') + '</h4>' +
      list;
  }

  function closeDialog() {
    if (!el.dlg.open) return;
    if (typeof el.dlg.close === 'function') el.dlg.close();
    else {
      el.dlg.removeAttribute('open');
      onDialogClose();
    }
  }

  function onDialogClose() {
    const back = returnFocus;
    returnFocus = null;
    if (skipReturn) {
      skipReturn = false;
      return;
    }
    if (back && back.isConnected) back.focus();
  }

  // ---------- events ----------

  function onClick(event) {
    const t = event.target;
    const name = t.closest('[data-open]');
    if (name) {
      open(name.dataset.open, { scroll: false, from: name });
      return;
    }
    const chip = t.closest('.dz-chip');
    if (chip) {
      const id = chip.dataset.blok || chip.dataset.group;
      if (chip.dataset.blok) {
        if (filter.bloks.has(id)) filter.bloks.delete(id);
        else filter.bloks.add(id);
      } else {
        filter.group = filter.group === id ? null : id;
      }
      startRender();
      applyFilter();
      root.querySelector('.dz-chip[data-' + (chip.dataset.blok ? 'blok' : 'group') + '="' + CSS.escape(id) + '"]')?.focus();
      return;
    }
    if (t.closest('.dz-clear')) {
      clearFilters();
      el.q.focus();
      return;
    }
    if (t.closest('.dz-more-b')) {
      expand();
      // keep the reader where they were: the first row after the fold gets focus
      const next = [...el.list.querySelectorAll('.dz-row:not([hidden]) .dz-name')][FOLD_MIN];
      next?.focus({ preventScroll: true });
      return;
    }
    if (t.closest('[data-less]')) {
      collapse();
      return;
    }
    const letter = t.closest('.dz-az-b');
    if (letter) return jumpTo(letter.dataset.letter);
    if (t.closest('.dz-jump')) {
      el.tools.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      el.q.focus({ preventScroll: true });
      return;
    }
    if (t.closest('[data-skip]')) {
      // past the list to whatever section follows it
      const next = root.closest('section')?.nextElementSibling;
      if (next) next.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function jumpTo(L) {
    expand();
    flushRender();
    const h = el.list.querySelector('.dz-g[data-letter="' + L + '"] .dz-g-h');
    if (!h) return;
    h.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    h.focus({ preventScroll: true });
  }

  function onDialogClick(event) {
    if (event.target === el.dlg || event.target.closest('[data-close]')) return closeDialog();
    const b = event.target.closest('.dz-se-b');
    if (!b) return;
    const detail = { type: 'date', date: b.dataset.date, uid: b.dataset.uid };
    skipReturn = true;
    closeDialog();
    document.dispatchEvent(new CustomEvent('alpha:open', { detail }));
    if (!detail.handled) {
      // no schedule on this page: behave like a normal close
      skipReturn = false;
      returnFocus?.focus?.();
    }
  }

  function onOpenEvent(event) {
    const d = event.detail || {};
    if (d.type !== 'dosen' || !d.id) return;
    if (open(d.id)) d.handled = true;
  }

  let io = null;
  let toolsIo = null;
  if (typeof IntersectionObserver !== 'undefined') {
    // start building rows a screen or two before the list scrolls into view
    io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        startRender();
        io.disconnect();
      }
    }, { rootMargin: '1500px 0px' });
    io.observe(root);
    // the dock shows while the search box is above the screen and the list end is below it
    let toolsAbove = false, endBelow = true;
    const dock = () => root.classList.toggle('dz-far', toolsAbove && endBelow);
    toolsIo = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === el.tools) toolsAbove = !e.isIntersecting && e.boundingClientRect.top < 0;
        else endBelow = !e.isIntersecting && e.boundingClientRect.top > 0;
      }
      dock();
    });
    toolsIo.observe(el.tools);
    toolsIo.observe(el.end);
  } else {
    startRender();
  }

  root.addEventListener('click', onClick);
  // tabbing into rows hidden under the fold opens the whole list rather than focusing unseen rows
  el.list.addEventListener('focusin', onListFocus);
  el.q.addEventListener('input', onInput);
  el.dlg.addEventListener('click', onDialogClick);
  el.dlg.addEventListener('close', onDialogClose);
  document.addEventListener('alpha:open', onOpenEvent);

  renderShells();
  applyFilter();

  return {
    open(id) {
      return open(id);
    },
    update(next = {}) {
      data = { schedule: next.schedule ?? data.schedule, dosen: next.dosen ?? data.dosen };
      model = createModel(data.schedule, data.dosen);
      people = indexPeople(data.dosen, model);
      byId = new Map(people.map((x) => [x.id, x]));
      knownCodes = new Set(people.flatMap((x) => [...x.codeSet]));
      filter.q = parseQuery(el.q.value, knownCodes);
      cancelIdle(renderHandle);
      const wasStarted = started;
      started = false;
      renderShells();
      if (wasStarted) startRender();
      applyFilter();
    },
    destroy() {
      cancelIdle(renderHandle);
      clearTimeout(flashTimer);
      clearTimeout(countTimer);
      cancelAnimationFrame(inputFrame);
      io?.disconnect();
      toolsIo?.disconnect();
      unbindCopy();
      root.removeEventListener('click', onClick);
      el.list.removeEventListener('focusin', onListFocus);
      document.removeEventListener('alpha:open', onOpenEvent);
      if (el.dlg.open) el.dlg.close();
      root.innerHTML = '';
      root.classList.remove('dz', 'dz-far');
      if (labelled) root.removeAttribute('aria-labelledby');
    },
  };
}

function idle(fn) {
  return typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 200 }) : setTimeout(fn, 16);
}

function cancelIdle(handle) {
  if (!handle) return;
  if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle);
  clearTimeout(handle);
}

function shellHTML(uid) {
  return '<div class="dz-in">' +
    '<header class="dz-head">' +
      '<h2 class="dz-h" id="' + uid + '-h"><span data-k="dosen.h1">dosennya</span> <em data-k="dosen.h2">siapa?</em></h2>' +
      '<p class="dz-count"></p>' +
    '</header>' +
    '<div class="dz-tools">' +
      '<label class="dz-lbl" for="' + uid + '-q">Cari dosen</label>' +
      '<input class="dz-q" id="' + uid + '-q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="nama, spesialis, nomor HP, kode blok">' +
      '<div class="dz-filters">' +
        '<div class="dz-frow"><span class="dz-lbl" id="' + uid + '-fb">Ngajar di</span><div class="dz-chips dz-chips-blok" role="group" aria-labelledby="' + uid + '-fb"></div></div>' +
        '<div class="dz-frow"><span class="dz-lbl" id="' + uid + '-fs">Spesialis</span><div class="dz-chips dz-chips-spec" role="group" aria-labelledby="' + uid + '-fs"></div></div>' +
      '</div>' +
      '<div class="dz-azrow">' +
        '<nav class="dz-az" aria-label="Lompat ke huruf"></nav>' +
        '<button type="button" class="dz-clear" hidden>Hapus filter</button>' +
      '</div>' +
    '</div>' +
    '<p class="dz-active" hidden></p>' +
    '<div class="dz-list"></div>' +
    '<div class="dz-more" hidden><button type="button" class="dz-more-b"></button></div>' +
    '<div class="dz-less" hidden><button type="button" class="dz-less-b" data-less>Ringkas daftar <span aria-hidden="true">↑</span></button></div>' +
    '<div class="dz-empty" hidden><p class="dz-empty-t">Nggak <em>ketemu.</em></p><p class="dz-empty-s">Coba kata lain, atau hapus filternya.</p></div>' +
    '<i class="dz-end" aria-hidden="true"></i>' +
    '<div class="dz-dock" role="group" aria-label="Pintasan daftar dosen">' +
      '<button type="button" class="dz-jump">Cari dosen</button>' +
      '<button type="button" class="dz-dock-b" data-less>Ringkas</button>' +
      '<button type="button" class="dz-dock-b" data-skip>Lewati daftar <span aria-hidden="true">↓</span></button>' +
    '</div>' +
    '<dialog class="dz-dlg" aria-labelledby="' + uid + '-dn"><div class="dz-dlg-in"></div></dialog>' +
    '<p class="dz-live dz-sr" aria-live="polite"></p>' +
  '</div>';
}
