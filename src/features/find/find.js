// Site-wide search (Ctrl/Cmd K or the "Cari" button): channels, sessions, lecturers and parts
// of the heart in one list. Loaded the first time someone opens it.
// Its fixed words are page texts the admin can change (src/copy/find.js); what it finds is data.
import './find.css';
import '../../copy/find.js';
import { kSet, kHTML, kAttrs, kText, tx, onTexts } from '../../lib/texts.js';
import { createModel, queryTokens, compact, formatDate, formatTime, kindKey, todayWIB } from '../../lib/schedule-model.js';

const LIMIT = { channel: 5, session: 6, dosen: 6, heart: 5 };
// group headings, by result type
const GROUP = { section: 'find.g.section', channel: 'find.g.channel', session: 'find.g.session', dosen: 'find.g.dosen', heart: 'find.g.heart' };
// the parts of the page offered before anything is typed; k + '.t' is the name, k + '.s' the line under it
const SECTIONS = [
  { id: 'jadwal', k: 'find.sec.jadwal' },
  { id: 'menu', k: 'find.sec.menu' },
  { id: 'dosen', k: 'find.sec.dosen' },
  { id: 'anatomi', k: 'find.sec.anatomi' },
];

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

/** A result's name. */
function nameEl(r) {
  return r.type === 'section' ? k('span', 'fd-n', r.k + '.t') : el('span', 'fd-n', r.name);
}

/** The line under a result: a session's day, time, kind and blok, or the data line of the others. */
function subEl(r) {
  if (r.type === 'section') return k('span', 'fd-s', r.k + '.s');
  if (r.type === 'dosen' && !r.sub) return k('span', 'fd-s', 'find.dosen');
  if (r.type !== 'session') return el('span', 'fd-s', r.sub);
  const s = r.s;
  const line = el('span', 'fd-s');
  const kind = kindKey(s.kind);
  line.append(
    s.date === r.today ? k('span', null, 'find.today') : el('span', 'fd-dt', formatDate(s.date, 'short')), ', ',
    s.tba ? k('span', null, 'jadwal.time.tba') : formatTime(s.start), ' · ',
    kind ? k('span', null, kind) : s.kindLabel, ' · ',
    el('span', 'fd-blok', s.blok.name));
  return line;
}

/** Scores a haystack against query tokens: every token must appear; earlier and word-start hits rank higher. */
function score(hay, words, tokens) {
  let total = 0;
  for (const t of tokens) {
    const i = hay.indexOf(t);
    if (i < 0) return -1;
    const atStart = words.some((w) => w.startsWith(t));
    // short tokens ("lad", "av") only count at the start of a word, or they match half the data
    if (!atStart && t.length < 4) return -1;
    total += atStart ? 3 : 1;
    if (i === 0) total += 2;
  }
  return total;
}

// Classmates type the same term in Indonesian or English spelling ("genetik", "genetic",
// "fisiologi", "physiology"), so both sides are folded to one spelling before comparing.
function fold(text) {
  return compact(text).replace(/ph/g, 'f').replace(/[cq]/g, 'k').replace(/y/g, 'i');
}

function wordsOf(text) {
  return String(text || '').split(/[\s,./()-]+/).map(fold).filter(Boolean);
}

function tokensOf(q) {
  return queryTokens(q).map(fold).filter(Boolean);
}

/**
 * @param {object} deps
 * @param {(key: string) => Promise<any>} deps.load   content loader (bundled, cached or live)
 * @param {(name: 'dosen'|'anatomi') => Promise<any>} deps.ensure  mounts a section now and returns its view
 * @param {(el: Element) => void} deps.jump  scrolls the page to an element
 */
export function createFind({ load, ensure, jump }) {
  let index = null;
  let indexing = null;
  let results = [];
  let active = -1;
  let returnTo = null;

  const dlg = el('dialog', 'fd');
  dlg.setAttribute('aria-label', 'Cari di Alphangers');
  const box = el('div', 'fd-box');
  const bar = el('div', 'fd-bar');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>';
  const input = el('input', 'fd-q');
  Object.assign(input, { type: 'search', placeholder: tx('find.ph'), autocomplete: 'off', spellcheck: false });
  input.dataset.kp = 'find.ph';
  input.setAttribute('enterkeyhint', 'go');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'fdList');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-label', 'Cari');
  const esc = el('button', 'fd-esc');
  esc.append(k('span', null, 'find.close'));
  esc.type = 'button';
  esc.setAttribute('aria-label', 'Tutup pencarian');
  bar.append(icon, input, esc);
  const list = el('div', 'fd-list');
  list.id = 'fdList';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Hasil');
  const foot = el('p', 'fd-foot');
  foot.setAttribute('aria-hidden', 'true');
  foot.innerHTML = '<span><kbd>↑</kbd><kbd>↓</kbd> ' + kHTML('find.k.pick') + '</span>' +
    '<span><kbd' + kAttrs('find.k.enter') + '>' + kText('find.k.enter') + '</kbd> ' + kHTML('find.k.open') + '</span>' +
    '<span><kbd' + kAttrs('find.k.esc') + '>' + kText('find.k.esc') + '</kbd> ' + kHTML('find.k.close') + '</span>';
  const live = el('p', 'fd-sr');
  live.setAttribute('aria-live', 'polite');
  box.append(bar, list, foot, live);
  dlg.append(box);
  document.body.append(dlg);

  async function buildIndex() {
    const [links, schedule, dosen, heart] = await Promise.all(['links', 'schedule', 'dosen', 'heart'].map((k) => load(k).catch(() => null)));
    const model = schedule ? createModel(schedule, dosen) : null;
    const prep = (items) => items.map((x) => ({ ...x, hay: fold(x.keys.join('|')), words: x.keys.flatMap(wordsOf) }));
    const sessionKeys = (s) => [s.title, s.kindLabel, s.note, s.blok.name, ...s.lecturers.map((l) => (l.dosen ? l.dosen.name : '') + ' ' + l.code)];
    return {
      model,
      sessions: (model?.sessions || []).map((s) => ({ s, hay: fold(sessionKeys(s).join('|')), words: sessionKeys(s).flatMap(wordsOf), tHay: fold(s.title), tWords: wordsOf(s.title) })),
      channel: prep((links?.channels || []).map((c) => ({ type: 'channel', id: c.id, name: c.name, sub: c.sub || c.tag || '', keys: [c.name, c.tag, c.sub, c.id] }))),
      // without a specialty the line under the name is the page text 'find.dosen'
      dosen: prep((dosen?.list || []).map((p) => ({ type: 'dosen', id: p.id, name: p.name, sub: p.spec || '', keys: [p.name, p.spec, ...(p.phones || []).map((x) => (typeof x === 'string' ? x : (x.n || '') + ' ' + (x.f || '')))] }))),
      heart: prep((heart?.parts || []).map((p) => ({ type: 'heart', id: p.id, name: p.name, sub: [p.latin, p.en].filter(Boolean).join(' · '), keys: [p.name, p.latin, p.en, p.id] }))),
    };
  }

  function ensureIndex() {
    if (!indexing) indexing = buildIndex().then((ix) => { index = ix; return ix; });
    return indexing;
  }
  // the session kinds it searches are page texts: renamed ones count from the next opening on
  onTexts(() => { indexing = null; });

  function rank(items, tokens, limit) {
    return items
      .map((x) => ({ x, s: score(x.hay, x.words, tokens) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s || a.x.name.localeCompare(b.x.name, 'id'))
      .slice(0, limit)
      .map((r) => ({ ...r.x, score: r.s }));
  }

  function sessions(q) {
    if (!index.model) return [];
    const now = Date.now();
    const tokens = tokensOf(q);
    const titleScore = new Map();
    const hits = index.sessions.filter((x) => score(x.hay, x.words, tokens) >= 0).map((x) => {
      titleScore.set(x.s, Math.max(1, score(x.tHay, x.tWords, tokens)));
      return x.s;
    });
    const ahead = hits.filter((s) => s.endAt >= now).sort((a, b) => a.startAt - b.startAt);
    const past = hits.filter((s) => s.endAt < now).sort((a, b) => b.startAt - a.startAt);
    const today = todayWIB(now);
    return ahead.concat(past).slice(0, LIMIT.session).map((s) => ({
      type: 'session',
      id: s.uid,
      date: s.date,
      name: s.title,
      // drawn by subEl(): 'Hari ini, 08.00 · Kuliah · Blok 4'
      s,
      today,
      past: s.endAt < now,
      // a hit on the title counts like a name hit; a hit only on the lecturer counts less
      score: titleScore.get(s),
    }));
  }

  function search(q) {
    const tokens = tokensOf(q);
    if (!tokens.length) {
      return SECTIONS.map((s) => ({ type: 'section', ...s })).concat(index ? index.channel.slice(0, 10) : []);
    }
    // groups in the order of their best hit, so "ziske" leads with the lecturer and "mitral" with the valve
    const groups = [
      rank(index.channel, tokens, LIMIT.channel),
      sessions(q),
      rank(index.dosen, tokens, LIMIT.dosen),
      rank(index.heart, tokens, LIMIT.heart),
    ].filter((g) => g.length);
    const best = (g) => Math.max(...g.map((x) => x.score));
    return groups.map((g, i) => ({ g, i, b: best(g) })).sort((a, b) => b.b - a.b || a.i - b.i).flatMap((x) => x.g);
  }

  function render() {
    const q = input.value;
    results = index ? search(q) : SECTIONS.map((s) => ({ type: 'section', ...s }));
    list.textContent = '';
    let group = null;
    let wrap = null;
    results.forEach((r, i) => {
      if (r.type !== group) {
        group = r.type;
        wrap = el('div', 'fd-g');
        wrap.setAttribute('role', 'group');
        const h = k('p', 'fd-gh', GROUP[r.type]);
        h.id = 'fdG-' + r.type;
        wrap.setAttribute('aria-labelledby', h.id);
        wrap.append(h);
        list.append(wrap);
      }
      const o = el('div', 'fd-o' + (r.past ? ' past' : ''));
      o.id = 'fdO-' + i;
      o.setAttribute('role', 'option');
      o.dataset.i = i;
      o.append(nameEl(r), subEl(r));
      wrap.append(o);
    });
    // '**Nggak ketemu.** Coba kata lain, ...': the bold part is written with ** in the text
    if (!results.length) list.append(k('p', 'fd-none', 'find.none'));
    setActive(results.length ? 0 : -1);
    if (q.trim()) live.textContent = results.length ? results.length + ' hasil.' : 'Nggak ketemu.';
  }

  function setActive(i) {
    active = i;
    list.querySelectorAll('.fd-o').forEach((o) => o.setAttribute('aria-selected', String(+o.dataset.i === i)));
    const cur = list.querySelector('#fdO-' + i);
    if (cur) {
      input.setAttribute('aria-activedescendant', cur.id);
      cur.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function close() {
    document.documentElement.classList.remove('fd-on');
    if (dlg.open) dlg.close();
  }

  async function choose(i) {
    const r = results[i];
    if (!r) return;
    returnTo = null; // the result decides where focus goes
    close();
    await new Promise((r) => requestAnimationFrame(() => r()));
    if (r.type === 'section') return jump(document.getElementById(r.id));
    if (r.type === 'channel') return document.querySelector('.row-b[data-id="' + CSS.escape(r.id) + '"]')?.click();
    if (r.type === 'session') return document.dispatchEvent(new CustomEvent('alpha:open', { detail: { type: 'date', date: r.date, uid: r.id } }));
    if (r.type === 'dosen') {
      await ensure('dosen');
      return document.dispatchEvent(new CustomEvent('alpha:open', { detail: { type: 'dosen', id: r.id } }));
    }
    if (r.type === 'heart') {
      const view = await ensure('anatomi');
      jump(document.getElementById('anatomi'));
      view?.select?.(r.id);
    }
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((active + d + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    }
  });
  list.addEventListener('click', (e) => {
    const o = e.target.closest('.fd-o');
    if (o) choose(+o.dataset.i);
  });
  list.addEventListener('pointermove', (e) => {
    const o = e.target.closest('.fd-o');
    if (o && +o.dataset.i !== active) setActive(+o.dataset.i);
  });
  esc.addEventListener('click', close);
  // a click on the dim backdrop (the dialog itself, outside the box) closes it
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener('close', () => {
    document.documentElement.classList.remove('fd-on');
    returnTo?.focus?.();
    returnTo = null;
  });

  return {
    open() {
      if (dlg.open) return input.focus();
      returnTo = document.activeElement;
      document.documentElement.classList.add('fd-on');
      dlg.showModal();
      input.value = '';
      render();
      input.focus();
      if (!index || !indexing) ensureIndex().then(() => { if (dlg.open) render(); }, () => {});
    },
    close,
    preload: ensureIndex,
  };
}
