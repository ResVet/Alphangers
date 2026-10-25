// Forms and small dialogs for the live editor. One form builder covers every structured edit
// (a session, a lecturer, a channel, an announcement, a divisi, a heart part): give it fields and
// a value, get the edited value back, or null when the sheet is closed without saving.
// On phones the sheet rises from the bottom; on wide screens it opens from the right edge.
// Everything here builds DOM with textContent; no value is ever parsed as HTML.
import { textLabel } from '../lib/texts.js';

export function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n && k !== 'list' && k !== 'form') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

// The on-screen keyboard of a phone covers the bottom of the screen without making the page
// shorter. While a sheet is open it is kept above the keyboard (--ed-kb, --ed-vh), and the field
// being typed into is scrolled back into view once the keyboard is up.
function keepAboveKeyboard(dlg) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  let frame = 0;
  const fit = () => {
    frame = 0;
    const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
    dlg.style.setProperty('--ed-kb', kb + 'px');
    dlg.style.setProperty('--ed-vh', Math.round(vv.height) + 'px');
  };
  const queue = () => { if (!frame) frame = requestAnimationFrame(fit); };
  let t = 0;
  const reveal = (e) => {
    const f = e.target;
    if (!f?.matches?.('input:not([type=checkbox]), textarea, select')) return;
    clearTimeout(t);
    t = setTimeout(() => { if (document.activeElement === f) f.scrollIntoView({ block: 'nearest' }); }, 320);
  };
  vv.addEventListener('resize', queue);
  vv.addEventListener('scroll', queue);
  dlg.addEventListener('focusin', reveal);
  fit();
  return () => { vv.removeEventListener('resize', queue); vv.removeEventListener('scroll', queue); clearTimeout(t); cancelAnimationFrame(frame); };
}

function openDialog(cls, build) {
  const dlg = h('dialog', { class: 'ed-dlg ' + cls });
  document.body.append(dlg);
  const unfit = keepAboveKeyboard(dlg);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      unfit();
      dlg.classList.add('is-out');
      setTimeout(() => { dlg.close(); dlg.remove(); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
      resolve(v);
    };
    build(dlg, finish);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(null); });
    dlg.showModal();
  });
}

/** Yes/no question. Resolves true or false. */
export function confirmDialog(title, body, { ok = 'Lanjut', cancel = 'Batal', danger = false } = {}) {
  return openDialog('ed-ask', (dlg, finish) => {
    const okB = h('button', { type: 'button', class: 'ed-btn ' + (danger ? 'is-danger' : 'is-pri'), onclick: () => finish(true) }, ok);
    dlg.append(h('div', { class: 'ed-ask-in' },
      h('h3', { class: 'ed-ask-h', text: title }),
      body ? h('p', { class: 'ed-ask-p', text: body }) : null,
      h('div', { class: 'ed-row-end' }, h('button', { type: 'button', class: 'ed-btn', onclick: () => finish(false) }, cancel), okB)));
    queueMicrotask(() => okB.focus());
  }).then((v) => v === true);
}

/** A message with one button. */
export function alertDialog(title, body) {
  return openDialog('ed-ask', (dlg, finish) => {
    const okB = h('button', { type: 'button', class: 'ed-btn is-pri', onclick: () => finish(true) }, 'Oke');
    const list = Array.isArray(body) ? h('ul', { class: 'ed-errs' }, body.map((x) => h('li', { text: x }))) : body ? h('p', { class: 'ed-ask-p', text: body }) : null;
    dlg.append(h('div', { class: 'ed-ask-in' }, h('h3', { class: 'ed-ask-h', text: title }), list, h('div', { class: 'ed-row-end' }, okB)));
    queueMicrotask(() => okB.focus());
  });
}

/** Choice between several actions. Resolves the chosen value or null. */
export function chooseDialog(title, body, choices) {
  return openDialog('ed-ask', (dlg, finish) => {
    dlg.append(h('div', { class: 'ed-ask-in' },
      h('h3', { class: 'ed-ask-h', text: title }),
      body ? h('p', { class: 'ed-ask-p', text: body }) : null,
      h('div', { class: 'ed-col' }, choices.map((c) => h('button', { type: 'button', class: 'ed-btn ' + (c.kind || ''), onclick: () => finish(c.value) }, c.label)))));
  });
}

// ---------- fields

function inputFor(f, v) {
  const common = { id: f.id, name: f.name, required: f.required, placeholder: f.placeholder || '', autocomplete: 'off', spellcheck: f.spellcheck ?? false };
  switch (f.type) {
    case 'textarea':
      return h('textarea', { ...common, rows: f.rows || 4, maxLength: f.max || 4000, spellcheck: true, value: v ?? '' });
    case 'select':
      return h('select', { id: f.id, name: f.name }, (f.options || []).map((o) => h('option', { value: o.value, selected: o.value === v }, o.label)));
    case 'checkbox':
      return h('input', { id: f.id, name: f.name, type: 'checkbox', checked: !!v });
    case 'time':
      return h('input', { ...common, type: 'time', step: 60, value: v ?? '' });
    case 'date':
      return h('input', { ...common, type: 'date', value: v ?? '' });
    case 'datetime':
      return h('input', { ...common, type: 'datetime-local', value: v ?? '' });
    case 'url':
      return h('input', { ...common, type: 'url', inputMode: 'url', maxLength: 2048, value: v ?? '' });
    default:
      return h('input', { ...common, type: 'text', maxLength: f.max || 300, value: v ?? '' });
  }
}

// A growing list of text rows (anatomy notes, phone numbers) or of two-part rows (key numbers).
function listField(f, value) {
  const rows = h('div', { class: 'ed-list' });
  const pair = f.pair; // e.g. ['k', 'v'] for {k, v} items
  const addRow = (item) => {
    const inputs = pair
      ? pair.map((k, i) => h(i === 0 ? 'input' : 'textarea', { class: 'ed-li-in', placeholder: f.placeholders?.[i] || '', maxLength: f.max || 1200, rows: 2, value: item?.[k] ?? '', 'data-part': k }))
      : [h(f.multiline ? 'textarea' : 'input', { class: 'ed-li-in', placeholder: f.placeholder || '', maxLength: f.max || 1200, rows: 2, value: item ?? '', inputMode: f.inputmode })];
    const row = h('div', { class: 'ed-li' + (pair ? ' is-pair' : '') }, inputs,
      h('button', { type: 'button', class: 'ed-ib', 'aria-label': 'Hapus baris', onclick: () => row.remove() }, '×'));
    rows.append(row);
    return row;
  };
  (value || []).forEach(addRow);
  const add = h('button', { type: 'button', class: 'ed-btn is-sm', onclick: () => addRow(pair ? {} : '').querySelector('input, textarea').focus() }, '+ ' + (f.addLabel || 'Tambah'));
  const el = h('div', { class: 'ed-listw' }, rows, add);
  el.read = () => [...rows.children].map((r) => {
    if (!pair) return r.querySelector('.ed-li-in').value.trim();
    const o = {};
    r.querySelectorAll('[data-part]').forEach((x) => { o[x.dataset.part] = x.value.trim(); });
    return o;
  }).filter((x) => (pair ? Object.values(x).some(Boolean) : x));
  return el;
}

// Pick from a known set (bloks a lecturer teaches in, related heart parts).
function chipsField(f, value) {
  const on = new Set(value || []);
  const box = h('div', { class: 'ed-chips', role: 'group' }, (f.options || []).map((o) => {
    const b = h('button', { type: 'button', class: 'ed-chip', 'aria-pressed': String(on.has(o.value)), onclick: () => {
      if (on.has(o.value)) on.delete(o.value); else on.add(o.value);
      b.setAttribute('aria-pressed', String(on.has(o.value)));
    } }, o.label);
    return b;
  }));
  box.read = () => (f.options || []).map((o) => o.value).filter((v) => on.has(v));
  return box;
}

// Tags: tap the ones already used to toggle them, or type a new one. Keeps the chosen order.
function tagsField(f, value) {
  const chosen = [...(value || [])];
  const known = [...new Set([...(f.options || []), ...chosen])];
  const box = h('div', { class: 'ed-chips', role: 'group' });
  const MAX = f.max || 4;
  const paint = () => {
    box.textContent = '';
    const full = chosen.length >= MAX;
    fresh.disabled = addB.disabled = full;
    for (const t of known) {
      const on = chosen.some((c) => c.toLowerCase() === t.toLowerCase());
      box.append(h('button', { type: 'button', class: 'ed-chip', 'aria-pressed': String(on), disabled: full && !on, onclick: () => {
        const i = chosen.findIndex((c) => c.toLowerCase() === t.toLowerCase());
        if (i >= 0) chosen.splice(i, 1); else chosen.push(t);
        paint();
      } }, t));
    }
  };
  const fresh = h('input', { id: f.id, class: 'ed-li-in', type: 'text', maxLength: 30, placeholder: f.placeholder || 'Tag baru', autocomplete: 'off' });
  const add = () => {
    const t = fresh.value.trim().replace(/\s+/g, ' ');
    if (!t) return;
    if (!known.some((k) => k.toLowerCase() === t.toLowerCase())) known.push(t);
    if (!chosen.some((c) => c.toLowerCase() === t.toLowerCase()) && chosen.length < MAX) chosen.push(t);
    fresh.value = '';
    paint();
    if (!fresh.disabled) fresh.focus();
  };
  const addB = h('button', { type: 'button', class: 'ed-btn is-sm', onclick: () => add() }, '+ Tambah tag');
  fresh.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  paint();
  const el = h('div', { class: 'ed-listw' }, box, h('div', { class: 'ed-li' }, fresh, addB));
  el.read = () => { if (fresh.value.trim()) add(); return chosen.slice(); };
  return el;
}

// Lecturers for a session, searched by name, shown in the order chosen.
function peopleField(f, value) {
  const people = f.people || [];
  const byId = new Map(people.map((p) => [p.id, p]));
  let chosen = (value || []).filter((id) => byId.has(id));
  const picked = h('div', { class: 'ed-picked' });
  const q = h('input', { type: 'search', class: 'ed-q', placeholder: 'Cari nama dosen', autocomplete: 'off', spellcheck: false });
  const hits = h('ul', { class: 'ed-hits', role: 'listbox' });
  const paint = () => {
    picked.textContent = '';
    for (const id of chosen) {
      const p = byId.get(id);
      picked.append(h('span', { class: 'ed-pchip' }, p.name, h('button', { type: 'button', class: 'ed-ib', 'aria-label': 'Lepas ' + p.name, onclick: () => { chosen = chosen.filter((x) => x !== id); paint(); } }, '×')));
    }
    if (!chosen.length) picked.append(h('span', { class: 'ed-none', text: f.empty || 'Belum ada dosen dipilih.' }));
  };
  const search = () => {
    hits.textContent = '';
    const t = fold(q.value.trim());
    if (t.length < 2) return;
    const words = t.split(/\s+/);
    people.filter((p) => !chosen.includes(p.id) && words.every((w) => fold(p.name + ' ' + (p.spec || '')).includes(w))).slice(0, 8).forEach((p) => {
      hits.append(h('li', null, h('button', { type: 'button', class: 'ed-hit', onclick: () => { chosen.push(p.id); q.value = ''; hits.textContent = ''; paint(); q.focus(); } },
        h('b', { text: p.name }), h('small', { text: p.spec || '' }))));
    });
    if (!hits.children.length) hits.append(h('li', { class: 'ed-none', text: 'Nggak ketemu.' }));
  };
  q.addEventListener('input', search);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); hits.querySelector('.ed-hit')?.click(); } });
  paint();
  const el = h('div', { class: 'ed-people' }, picked, q, hits);
  el.read = () => chosen.slice();
  return el;
}

/**
 * Opens a form. fields: [{ name, label, type, hint, required, options, ... }]. onSubmit gets the
 * values and may answer { errors: ['...'] } to keep the sheet open with those messages.
 * Resolves with the values that were accepted, or null.
 */
export function openForm({ title, sub, fields, value = {}, submit = 'Simpan', extra = [], onSubmit, cls = '', foot = null, autofocus = true }) {
  return openDialog('ed-sheet' + (cls ? ' ' + cls : ''), (dlg, finish) => {
    const readers = new Map();
    const errBox = h('div', { class: 'ed-errbox', role: 'alert', hidden: true });
    const body = h('div', { class: 'ed-fields' });
    let n = 0;
    for (const f of fields) {
      if (f.type === 'note') { body.append(h('p', { class: 'ed-note', text: f.text })); continue; }
      if (f.type === 'section') { body.append(h('h4', { class: 'ed-sec', text: f.label })); continue; }
      const id = 'edf' + ++n;
      const fld = { ...f, id };
      let control;
      if (f.type === 'list') control = listField(fld, value[f.name]);
      else if (f.type === 'chips') control = chipsField(fld, value[f.name]);
      else if (f.type === 'tags') control = tagsField(fld, value[f.name]);
      else if (f.type === 'people') control = peopleField(fld, value[f.name]);
      else if (f.type === 'custom') control = f.render(value);
      else control = inputFor(fld, value[f.name]);
      readers.set(f.name, () => {
        if (control.read) return control.read();
        if (f.type === 'checkbox') return control.checked;
        return control.value;
      });
      const label = f.type === 'checkbox'
        ? h('label', { class: 'ed-check', htmlFor: id }, control, h('span', { text: f.label }))
        : f.label ? h('label', { class: 'ed-lbl', htmlFor: id, text: f.label + (f.required ? ' *' : '') }) : null;
      body.append(h('div', { class: 'ed-fld' + (f.wide ? ' is-wide' : '') + (f.half ? ' is-half' : '') },
        label, f.type === 'checkbox' ? null : control, f.hint ? h('p', { class: 'ed-hint', text: f.hint }) : null));
    }
    const read = () => Object.fromEntries([...readers].map(([k, fn]) => [k, fn()]));
    const save = h('button', { type: 'submit', class: 'ed-btn is-pri' }, submit);
    const form = h('form', { class: 'ed-form', novalidate: true },
      h('header', { class: 'ed-sh' },
        h('div', null, h('h3', { class: 'ed-sh-t', text: title }), sub ? h('p', { class: 'ed-sh-s', text: sub }) : null),
        h('button', { type: 'button', class: 'ed-ib is-x', 'aria-label': 'Tutup', onclick: () => finish(null) }, '×')),
      h('div', { class: 'ed-sb' }, errBox, body),
      h('footer', { class: 'ed-sf' },
        extra.map((x) => h('button', { type: 'button', class: 'ed-btn ' + (x.kind || ''), onclick: async () => { const r = await x.run(read()); if (r !== false) finish(null); } }, x.label)),
        foot,
        h('span', { class: 'ed-sp' }),
        h('button', { type: 'button', class: 'ed-btn', onclick: () => finish(null) }, 'Batal'), save));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = read();
      for (const f of fields) {
        if (f.required && !String(values[f.name] ?? '').trim()) {
          errBox.hidden = false;
          errBox.textContent = f.label + ' wajib diisi.';
          return;
        }
      }
      save.disabled = true;
      const res = onSubmit ? await onSubmit(values) : null;
      save.disabled = false;
      if (res && res.errors?.length) {
        errBox.hidden = false;
        errBox.textContent = '';
        errBox.append(h('ul', { class: 'ed-errs' }, res.errors.slice(0, 8).map((x) => h('li', { text: x }))));
        errBox.scrollIntoView({ block: 'nearest' });
        return;
      }
      finish(values);
    });
    dlg.append(form);
    if (autofocus) queueMicrotask(() => body.querySelector('input:not([type=checkbox]), textarea, select')?.focus());
  });
}

// ======================================================================
// Page texts (src/lib/texts.js): the rules both editors save them by, and the list that shows
// them. The same list is the dock's "Semua teks halaman", the "Ubah teks" form of a button, and
// the page texts in the admin panel, so all three agree on what a change is.

export const TEXT_MAX = 4000; // characters in one text (src/lib/validate.js)
export const TEXTS_MAX = 600; // changed texts the links document holds
const fmtN = (n) => Number(n).toLocaleString('id-ID');
const ownKey = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const VAR_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
const varsIn = (s) => [...new Set([...String(s ?? '').matchAll(VAR_RE)].map((m) => m[1]))];

// the hero endings as the page ships them (src/legacy/app.js). The empty line is the Polyester
// button; it sits between two endings because a saved text loses an empty line at its end.
export const ENDS_DEFAULT = 'And yes this website is a bit vibecoded\u00a0:D\nSemangat belajarnya!\n\nJangan tanya apa kepanjangan Resvet.';
export const HERO_ENDS = { key: 'hero.ends', group: 'hero', d: ENDS_DEFAULT, ml: true, label: 'Akhiran kalimat pembuka', h: 'Satu per baris. Baris kosong jadi tombol 100% Polyester.', where: 'special' };

export const tooLongText = (n) => 'Kepanjangan: ' + fmtN(n) + ' huruf, maksimal ' + fmtN(TEXT_MAX) + '.';
export const tooManyTexts = (n) => 'Teks yang diubah jadi ' + fmtN(n) + ', maksimal ' + TEXTS_MAX + '. Balikin beberapa ke bawaan dulu.';

/** A text the way the validator keeps it: one kind of line break, no space at the ends or before a line break. */
export function normText(s) {
  return String(s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * What a typed text is saved as, or undefined when nothing is saved (the page shows its default).
 * The default itself saves nothing. An emptied text goes back to the default, except an optional
 * one (opt) that has a default of its own: that is saved empty, and hides.
 */
export function savedText(value, def, opt) {
  const s = String(value ?? '').replace(/\r\n?/g, '\n');
  const d = String(def ?? '');
  if (s === d || normText(s) === normText(d)) return undefined;
  if (!s.trim()) return opt && d.trim() ? '' : undefined;
  return s;
}

/**
 * Applies [{ key, value, def, opt, unknown }] to a copy of the changed texts t. unknown: a saved
 * text whose default is not known here (emptied, it goes back to its default). Returns
 * { t, errors }; errors say plainly what breaks the links document's limits.
 */
export function applyTextChanges(t, changes, labelOf = (k) => k) {
  const next = { ...(t || {}) };
  const errors = [];
  for (const c of changes) {
    const v = c.unknown ? (String(c.value ?? '').trim() ? String(c.value) : undefined) : savedText(c.value, c.def, c.opt);
    if (v === undefined) delete next[c.key];
    else next[c.key] = v;
    const n = v === undefined ? 0 : normText(v).length;
    if (n > TEXT_MAX) errors.push(labelOf(c.key) + ': ' + tooLongText(n));
  }
  const n = Object.keys(next).length;
  if (n > TEXTS_MAX) errors.push(tooManyTexts(n));
  return { t: next, errors };
}

// The text an element of index.html ships with, for a parsed copy of the page: the engine's own reader.
export { shippedText } from '../lib/texts.js';

/**
 * The keyed texts found under root: [{ key, kind, d, ml, rich, opt, ph, vals, many }], one per key.
 * kind is 'k' (the element's text), 'kp' (placeholder) or 'kt' (title). def(el, kind) gives the
 * default, vals(el, kind) the {name} values the element fills in; a name filled differently in
 * two places has the value null (many).
 */
export function collectPageTexts(root, { def, vals = () => null, entry = () => null, skip = '.ed-ui, .ed-dlg, .ed-bar, .ed-tip' } = {}) {
  const out = new Map();
  const put = (el, kind) => {
    const key = kind === 'k' ? el.dataset.k : el.dataset[kind];
    if (!key || el.closest(skip)) return;
    const v = vals(el, kind);
    const has = v && Object.keys(v).length ? v : null;
    const cur = out.get(key);
    if (cur) {
      if (has) {
        cur.vals = cur.vals || {};
        for (const [n, x] of Object.entries(has)) {
          if (!ownKey(cur.vals, n)) cur.vals[n] = x;
          else if (cur.vals[n] !== null && String(cur.vals[n]) !== String(x)) { cur.vals[n] = null; cur.many = true; }
        }
      }
      return;
    }
    const e = entry(key);
    const k = kind === 'k';
    out.set(key, {
      key, kind, d: String(def(el, kind) ?? ''),
      ml: k && (!!e?.ml || el.hasAttribute('data-ml')), rich: k && (!!e?.rich || el.hasAttribute('data-rich')),
      opt: k && (!!e?.opt || el.hasAttribute('data-opt')), ph: e?.ph || (k && el.dataset.ph) || '', h: e?.h || '',
      label: textLabel(key), vals: has ? { ...has } : null, many: false,
    });
  };
  for (const el of root.querySelectorAll('[data-k]')) put(el, 'k');
  for (const el of root.querySelectorAll('[data-kp]')) put(el, 'kp');
  for (const el of root.querySelectorAll('[data-kt]')) put(el, 'kt');
  return [...out.values()];
}

/**
 * Every text the list shows, grouped: [{ id, label, items }]. reg: listCopy() (every declared
 * text, also of sections never opened); page: collectPageTexts() (texts in the page, declared or
 * not); saved: the changed texts, of which those found nowhere go under "Lainnya". order: the
 * GROUPS of src/copy/groups.js; special: items that lead their group (the hero endings).
 */
export function buildTextList({ reg = [], page = [], saved = {}, order = [], groupOf = (k) => String(k).split('.')[0], special = [] }) {
  const labels = new Map(order);
  const groups = new Map();
  const seen = new Set();
  const group = (id, label) => {
    if (!groups.has(id)) groups.set(id, { id, label: labels.get(id) || label || (id === 'lain' ? 'Lainnya' : id), items: [] });
    return groups.get(id);
  };
  const pageBy = new Map(page.map((p) => [p.key, p]));
  // A text every blok has (to.b3.title) is named once for all of them; each row adds its blok's
  // name as the card shows it (or the blok's id), or the list would hold several "Kartu blok: judul".
  const ofPart = (part, key) => {
    const k = key.split('.')[0] + '.' + part + '.name';
    return String(ownKey(saved, k) && saved[k] ? saved[k] : pageBy.get(k)?.d || '');
  };
  for (const s of special) {
    group(s.group).items.push({ vars: [], kind: 'k', ph: '', h: '', ...s });
    seen.add(s.key);
  }
  for (const g of reg) {
    for (const it of g.items) {
      if (seen.has(it.key)) continue;
      const p = pageBy.get(it.key);
      group(g.id, g.label).items.push({ ...it, group: g.id, vars: it.vars || varsIn(it.d), kind: p?.kind || 'k', vals: p?.vals || null, many: !!p?.many, where: 'reg' });
      seen.add(it.key);
    }
  }
  for (const p of page) {
    if (seen.has(p.key)) continue;
    const id = groupOf(p.key);
    group(id).items.push({ ...p, label: textLabel(p.key, ofPart) || p.label, group: id, vars: varsIn(p.d), where: 'page' });
    seen.add(p.key);
  }
  for (const key of Object.keys(saved || {})) {
    if (seen.has(key)) continue;
    const v = String(saved[key] ?? '');
    group('lain').items.push({ key, label: textLabel(key, ofPart), group: 'lain', d: '', ml: v.includes('\n'), rich: false, opt: false, ph: '', h: '', vars: varsIn(v), vals: null, many: false, kind: 'k', where: 'saved', unknown: true, from: labels.get(groupOf(key)) || '' });
    seen.add(key);
  }
  const at = (id) => (id === 'lain' ? 1e6 : order.findIndex(([g]) => g === id) + 1 || 1e5);
  return [...groups.values()].filter((g) => g.items.length).sort((a, b) => at(a.id) - at(b.id));
}

/**
 * Lines that help while typing a text: which {name} parts are filled in and with what, the **bold**
 * marks, and whether it may stay empty. it: { vars, vals, many, rich, opt, h }. [{ code, text, val, warn }]
 */
export function textHints(raw, it) {
  const out = [];
  const known = new Set([...(it.vars || []), ...Object.keys(it.vals || {})]);
  for (const name of new Set([...varsIn(raw), ...known])) {
    if (!known.has(name)) { out.push({ code: '{' + name + '}', text: ' nggak dikenal, jadi tampil apa adanya.', warn: true }); continue; }
    const has = ownKey(it.vals, name);
    const v = has ? it.vals[name] : undefined;
    if (has && v !== null && v !== undefined) out.push({ code: '{' + name + '}', text: ' diisi otomatis, sekarang: ', val: String(v) });
    else out.push({ code: '{' + name + '}', text: ' diisi otomatis' + (has ? ', beda di tiap tempat.' : '.') });
  }
  if (it.rich) out.push({ text: 'Apit pakai ** biar tebal, misalnya **penting**.' });
  if (it.opt) out.push({ text: 'Kosongkan supaya tidak tampil.' });
  if (it.h) out.push({ text: it.h });
  return out;
}

/** Writes textHints() lines into box (as text, never HTML). Returns how many there are. */
export function paintHints(box, lines, cls = 'tl-hl') {
  box.textContent = '';
  for (const l of lines) {
    box.append(h('span', { class: cls + (l.warn ? ' is-warn' : '') }, l.code ? h('code', { text: l.code }) : null, l.text, l.val ? h('b', { text: l.val }) : null));
  }
  return lines.length;
}

let tlSeq = 0;
const KIND_WORD = { kp: 'tulisan samar di kolom', kt: 'keterangan saat disorot' };

/**
 * The list of page texts: groups that fold open, a search box over text and key, "Hanya yang
 * diubah", and per text its default as placeholder, a reset to the default, the {name} hints and
 * a warning past the limits. value(item) is the text a field starts with; onInput(item, text) is
 * called on every change (the admin panel writes it to its draft at once, the dock waits for
 * Simpan and reads changes()). flat: just the rows (a button's own texts); open: the group shown
 * open; only: show this group alone; skin 'adm' marks rows the way the admin panel's fields are.
 */
export function textList({ groups, value, saved = {}, onInput = null, open = 'hero', only = null, flat = false, skin = 'ed' }) {
  const items = groups.flatMap((g) => g.items);
  const byKey = new Map(items.map((it) => [it.key, it]));
  const savedNow = () => (typeof saved === 'function' ? saved() : saved) || {};
  const init = new Map(items.map((it) => [it.key, String(value(it) ?? '')]));
  const vals = new Map(init);
  const touched = new Set();
  const forced = new Set();
  const rows = new Map();
  const gEls = new Map();
  const collapsed = new Set();
  const openSet = new Set(only && groups.some((g) => g.id === only) ? [only] : groups.some((g) => g.id === open) ? [open] : []);
  let filter = only && groups.some((g) => g.id === only) ? only : null;
  let q = '';
  let onlyChanged = false;
  const pre = 'tl' + ++tlSeq;

  const willSave = (it) => {
    const v = vals.get(it.key);
    if (it.unknown) return !(touched.has(it.key) && !v.trim());
    return savedText(v, it.d, it.opt) !== undefined;
  };
  const labelOf = (it) => {
    if (it.label) return it.label;
    if (flat && items.length === 1) return it.kind === 'k' ? 'Teks' : KIND_WORD[it.kind].replace(/^./, (c) => c.toUpperCase());
    const tail = it.key.startsWith(it.group + '.') ? it.key.slice(it.group.length + 1) : it.key;
    return tail + (KIND_WORD[it.kind] ? ' (' + KIND_WORD[it.kind] + ')' : '');
  };
  // the text, its name and its key: not the group's name, or "try out" would match all of Try out
  const hay = (it) => fold([it.key, it.d, vals.get(it.key), it.label, it.from].join(' '));
  const projected = () => {
    let n = 0;
    for (const k of Object.keys(savedNow())) if (!byKey.has(k)) n++;
    for (const it of items) if (willSave(it)) n++;
    return n;
  };

  // ---------- one text
  function buildRow(it) {
    const id = pre + '-' + rows.size;
    const v = vals.get(it.key);
    const long = it.ml || Math.max(it.d.length, v.length) > 56 || v.includes('\n');
    const lines = Math.max(v.split('\n').length, it.d.split('\n').length);
    const input = h(long ? 'textarea' : 'input', {
      id, class: 'tl-in', value: v, rows: long ? Math.min(8, Math.max(it.ml ? 3 : 2, lines)) : null, type: long ? null : 'text', autocomplete: 'off', spellcheck: true,
      placeholder: it.unknown ? 'Kosongkan buat balik ke bawaan' : it.d || it.ph || '',
      'aria-describedby': id + '-h ' + id + '-e',
    });
    const reset = h('button', { type: 'button', class: 'tl-reset', 'aria-label': 'Pakai teks bawaan: ' + labelOf(it), onclick: () => {
      vals.set(it.key, it.unknown ? '' : it.d);
      input.value = vals.get(it.key);
      touched.add(it.key);
      forced.add(it.key);
      changed(it);
      input.focus();
    } }, h('span', { 'aria-hidden': 'true', text: '↺' }), ' Bawaan');
    const r = {
      input, reset,
      hint: h('p', { class: 'tl-hint', id: id + '-h' }),
      def: h('p', { class: 'tl-def' }),
      err: h('p', { class: 'tl-err', id: id + '-e', role: 'alert' }),
    };
    r.row = h('div', { class: 'tl-row' + (skin === 'adm' ? ' fld' : ''), 'data-key': it.key, 'data-path': skin === 'adm' ? 'site.t.' + it.key : null },
      h('div', { class: 'tl-rh' }, h('label', { class: 'tl-k', htmlFor: id, text: labelOf(it) }), reset),
      input, r.hint, r.def, r.err, skin === 'adm' ? h('p', { class: 'msg' }) : null);
    input.addEventListener('input', () => {
      vals.set(it.key, input.value);
      touched.add(it.key);
      forced.delete(it.key);
      changed(it);
    });
    input.addEventListener('keydown', (e) => {
      // Enter in a one-line text does not save the form, and on a phone it puts the keyboard away
      if (e.key === 'Enter' && !it.ml && !e.isComposing) { e.preventDefault(); if (!FINE()) input.blur(); }
    });
    rows.set(it.key, r);
    paintRow(it);
    return r.row;
  }
  function paintRow(it) {
    const r = rows.get(it.key);
    if (!r) return;
    const v = vals.get(it.key);
    const on = willSave(it);
    r.row.classList.toggle('is-changed', on);
    r.reset.hidden = it.unknown ? !on : savedText(v, it.d, it.opt) === undefined;
    const showDef = !it.unknown && on && (it.d !== '' || it.opt);
    r.def.hidden = !showDef;
    if (showDef) { r.def.textContent = ''; r.def.append(h('span', { text: 'Bawaan: ' }), it.d ? it.d : 'kosong, tidak tampil'); }
    const lines = textHints(v, it);
    if (it.unknown) lines.unshift({ text: 'Belum tampil di halaman ini' + (it.from ? ' (' + it.from + ')' : '') + ', jadi teks bawaannya belum kelihatan.' });
    r.hint.hidden = !paintHints(r.hint, lines);
    const n = on ? normText(v).length : 0;
    r.err.textContent = n > TEXT_MAX ? tooLongText(n) : '';
    r.err.hidden = !r.err.textContent;
    r.row.classList.toggle('is-err', !r.err.hidden);
  }
  function changed(it) {
    paintRow(it);
    paintCounts();
    onInput?.(it, vals.get(it.key));
  }

  // ---------- groups
  function buildGroup(g) {
    const bodyId = pre + '-g-' + g.id;
    const gl = h('span', { class: 'tl-gl', text: g.label });
    const count = h('span', { class: 'tl-gn' });
    const head = h('button', { type: 'button', class: 'tl-gh', 'aria-expanded': 'false', 'aria-controls': bodyId, onclick: () => {
      const isOpen = head.getAttribute('aria-expanded') === 'true';
      if (q || onlyChanged) { if (isOpen) collapsed.add(g.id); else collapsed.delete(g.id); }
      else if (isOpen) openSet.delete(g.id); else openSet.add(g.id);
      paint();
    } }, gl, count, h('span', { class: 'tl-chev', 'aria-hidden': 'true' }));
    const body = h('div', { class: 'tl-gb', id: bodyId, hidden: true });
    if (g.items.some((it) => it.unknown)) body.append(h('p', { class: 'tl-gnote', text: 'Teks yang pernah diubah, tapi bagiannya belum tampil di halaman ini. Misalnya kartu try out yang belum dibuka.' }));
    const sec = h('section', { class: 'tl-g', 'data-g': g.id }, h('h4', { class: 'tl-gt' }, head), body);
    gEls.set(g.id, { sec, head, body, count, built: false });
    return sec;
  }
  function fill(g) {
    const ge = gEls.get(g.id);
    if (ge.built) return;
    ge.built = true;
    for (const it of g.items) ge.body.append(buildRow(it));
  }
  function paintCounts() {
    let changedN = 0;
    for (const g of groups) {
      const n = g.items.filter(willSave).length;
      changedN += n;
      const ge = gEls.get(g.id);
      if (!ge) continue;
      ge.count.textContent = '';
      ge.count.append(String(g.items.length));
      if (n) ge.count.append(h('b', { class: 'tl-gc', text: n + ' diubah' }));
    }
    if (flat) return;
    onlyN.textContent = changedN ? String(changedN) : '';
    sum.textContent = items.length + ' teks' + (changedN ? ', ' + changedN + ' diubah' : '');
    const p = projected();
    warn.hidden = p <= TEXTS_MAX;
    warn.textContent = warn.hidden ? '' : tooManyTexts(p);
  }
  function paint() {
    if (flat) return;
    const words = fold(q).split(/\s+/).filter(Boolean);
    const searching = words.length > 0 || onlyChanged;
    let shown = 0;
    for (const g of groups) {
      const ge = gEls.get(g.id);
      if (filter && g.id !== filter) { ge.sec.hidden = true; continue; }
      const match = g.items.filter((it) => (!onlyChanged || willSave(it)) && words.every((w) => hay(it).includes(w)));
      ge.sec.hidden = !match.length;
      if (!match.length) continue;
      shown += match.length;
      const isOpen = searching ? !collapsed.has(g.id) : filter === g.id || openSet.has(g.id);
      ge.head.setAttribute('aria-expanded', String(isOpen));
      ge.body.hidden = !isOpen;
      if (!isOpen) continue;
      fill(g);
      const keep = new Set(match.map((it) => it.key));
      for (const it of g.items) rows.get(it.key).row.hidden = !keep.has(it.key);
    }
    none.hidden = shown > 0;
  }

  // ---------- the whole list
  const root = h('div', { class: 'tl' + (flat ? ' is-flat' : '') + (skin === 'adm' ? ' is-adm' : '') });
  let onlyN, sum, warn, none;
  if (flat) {
    for (const it of items) root.append(buildRow(it));
  } else {
    const qi = h('input', { type: 'search', class: 'tl-qi', placeholder: 'Cari teks', 'aria-label': 'Cari teks', autocomplete: 'off', spellcheck: false, enterkeyhint: 'search' });
    let t = 0;
    qi.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = qi.value.trim(); collapsed.clear(); paint(); }, 90); });
    qi.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (!FINE()) qi.blur(); }
      // Esc empties the search first, and closes the sheet only when it is already empty
      else if (e.key === 'Escape' && qi.value) { e.preventDefault(); e.stopPropagation(); qi.value = ''; q = ''; paint(); }
    });
    onlyN = h('b', { class: 'tl-onlyn' });
    const onlyB = h('button', { type: 'button', class: 'tl-only', 'aria-pressed': 'false', onclick: () => {
      onlyChanged = !onlyChanged;
      onlyB.setAttribute('aria-pressed', String(onlyChanged));
      collapsed.clear();
      paint();
    } }, 'Hanya yang diubah', onlyN);
    sum = h('p', { class: 'tl-sum', 'aria-live': 'polite' });
    warn = h('p', { class: 'tl-warn', role: 'alert', hidden: true });
    none = h('p', { class: 'tl-none', hidden: true, text: 'Nggak ada teks yang cocok.' });
    const scope = filter ? h('p', { class: 'tl-scope' },
      h('span', null, 'Cuma ', h('b', { text: groups.find((g) => g.id === filter).label })),
      h('button', { type: 'button', class: 'tl-all', onclick: (e) => { filter = null; openSet.add(only); e.currentTarget.parentElement.remove(); paint(); } }, 'Lihat semua')) : null;
    root.append(...[h('div', { class: 'tl-bar' }, h('label', { class: 'tl-q' }, h('span', { class: 'tl-qic', 'aria-hidden': 'true' }), qi), onlyB), scope, sum, warn].filter(Boolean));
    for (const g of groups) root.append(buildGroup(g));
    root.append(none);
  }
  paintCounts();
  paint();

  root.changes = () => items
    .filter((it) => forced.has(it.key) || vals.get(it.key) !== init.get(it.key))
    .map((it) => ({ key: it.key, value: vals.get(it.key), def: it.d, opt: !!it.opt, unknown: !!it.unknown, label: labelOf(it) }));
  root.errors = () => {
    const out = [];
    for (const it of items) {
      const n = willSave(it) ? normText(vals.get(it.key)).length : 0;
      if (n > TEXT_MAX) out.push(labelOf(it) + ': ' + tooLongText(n));
    }
    const p = projected();
    if (p > TEXTS_MAX) out.push(tooManyTexts(p));
    return out;
  };
  root.reveal = (key) => {
    const it = byKey.get(key);
    if (!it || flat) return rows.get(key)?.input;
    const g = groups.find((x) => x.id === it.group);
    openSet.add(g.id);
    collapsed.delete(g.id);
    paint();
    return rows.get(key)?.input;
  };
  return root;
}

const FINE = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
