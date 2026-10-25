// Every text on the page that the admin can change, and the engine that shows the changed ones.
//
// The changed texts live in the links document (site.t), keyed like "jadwal.empty". An element
// that shows such a text carries the key in data-k; apply() puts the changed text in it, or the
// default when nothing changed. The live editor finds the same elements to make them typable.
//
// Texts in index.html are their own default: the element's text as the page ships it. Texts that
// scripts build are declared up front in src/copy/*.js with registerCopy(), so the editor can list
// all of them even before their section was opened, and are written with kHTML() / kAttrs() /
// kText() / kSet() (or tx() where only the string is needed):
//
//   registerCopy('jadwal', 'Jadwal', { 'jadwal.empty': 'Tidak ada kelas.', 'jadwal.after': 'Jadwal setelah {blok} belum masuk.' });
//   kHTML('jadwal.empty', null, 'p', 'jw-empty')      // <p class="jw-empty" data-k="jadwal.empty">Tidak ada kelas.</p>
//   kSet(el, 'jadwal.after', { blok: 'Blok 4' })      // el shows "Jadwal setelah Blok 4 belum masuk."
//
// {name} in a text is filled from the vars given with it; the editor shows the raw text with the
// {name} parts while typing. An entry can also be { d: 'default', ml: true } for multi-line text,
// rich: true for **bold** parts, opt: true for a text that may be left empty (a credit, a note:
// hidden from visitors while empty, see below), ph: 'what goes here' for the placeholder edit mode
// shows in an empty one, h: 'a hint for the editor' and label: 'the name the list shows it under'.
// registerLabels() names texts for the editor's lists in one go, those of index.html included.
// Attributes work the same way: data-kp="key" for a placeholder, data-kt="key" for a title
// (kAttr('kp', key) writes both the marker and the attribute).
//
// A text marked data-opt may be empty. While it is, data-empty is set on it, or on the line
// around it (data-opt-line), and the stylesheet hides that.
//
// Plain text only: values are written with textContent and text nodes, never as HTML.

const REG = new Map();      // key -> { d, ml, rich, opt, ph, h, label, group }
const GROUPS = new Map();   // group id -> label
const LABELS = new Map();   // key, or "group.*.rest" for a part every blok has -> its name in the lists
const original = new WeakMap();
const originalAttr = new WeakMap();
const listeners = new Set();
let T = {};

const VAR_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
const BOLD_RE = /\*\*([^*\n]+?)\*\*/g;
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const ATTRS = { kp: 'placeholder', kt: 'title' };
const MARKED = '[data-k], [data-kp], [data-kt]';

/** Declares the texts a part of the page builds. Calling it again for a key replaces the entry. */
export function registerCopy(group, label, entries) {
  if (label) GROUPS.set(group, label);
  else if (!GROUPS.has(group)) GROUPS.set(group, group);
  for (const [key, v] of Object.entries(entries || {})) {
    const e = typeof v === 'string' ? { d: v } : { ...v, d: String(v?.d ?? '') };
    e.group = group;
    REG.set(key, e);
  }
}

/** The registry entry of a key, or null. */
export function copyEntry(key) {
  return REG.get(key) || null;
}

/**
 * Names texts the way the editor's lists show them ({ 'to.card.meta': 'Kartu blok: jumlah soal' }),
 * for texts declared here and texts of index.html alike. "to.*.name" names that text of every blok.
 */
export function registerLabels(map) {
  for (const [key, v] of Object.entries(map || {})) LABELS.set(key, String(v));
}

/**
 * What the editor's lists call a text, or '' when it has no name yet (the list then shows its key).
 * A name given once for every blok ("to.*.title") is followed by which blok it is when ofPart is
 * given: ofPart('b3', key) answers its name ("Blok 3"), or nothing to show the part itself.
 */
export function textLabel(key, ofPart = null) {
  const k = String(key);
  const named = LABELS.get(k) || REG.get(k)?.label;
  if (named) return named;
  const p = k.split('.');
  const all = p.length > 2 && LABELS.get(p[0] + '.*.' + p.slice(2).join('.'));
  if (!all) return '';
  return ofPart ? all + ' · ' + (ofPart(p[1], k) || p[1]) : all;
}

/** The label of a group as registered, or null. */
export function groupLabel(group) {
  return GROUPS.get(group) || null;
}

/** Every declared text, grouped as registered: [{ id, label, items: [{ key, d, ml, rich, opt, ph, h, label, vars }] }]. */
export function listCopy() {
  const out = new Map();
  for (const [key, e] of REG) {
    if (!out.has(e.group)) out.set(e.group, { id: e.group, label: GROUPS.get(e.group) || e.group, items: [] });
    out.get(e.group).items.push({ key, d: e.d, ml: !!e.ml, rich: !!e.rich, opt: !!e.opt, ph: e.ph || '', h: e.h || '', label: textLabel(key), vars: varsOf(e.d) });
  }
  return [...out.values()];
}

/** Names used as {name} in a text, in order of first use. */
export function varsOf(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Fills {name} parts from vars; a name without a value stays as written. */
export function fill(template, vars) {
  const s = String(template ?? '');
  if (!vars) return s;
  return s.replace(VAR_RE, (all, name) => (own(vars, name) && vars[name] != null ? String(vars[name]) : all));
}

/** The text a key ships with: its registered default, or the element's own text from the page. */
export function defaultText(key, el) {
  const e = REG.get(key);
  if (e) return e.d;
  if (el) return original.has(el) ? original.get(el) : shippedText(el);
  return '';
}

/** The text a key shows right now, before {name} parts are filled. el helps for texts from index.html.
 *  A changed text left empty counts only where a text may be empty (opt); elsewhere the default shows. */
export function rawText(key, el) {
  return own(T, key) && (T[key] !== '' || flagsOf(key, el).opt) ? T[key] : defaultText(key, el);
}

/** The text to show for a key, {name} parts filled. */
export function tx(key, vars) {
  if (!REG.has(key) && !own(T, key)) console.warn('[texts] unregistered key', key);
  return fill(rawText(key), vars);
}

function flagsOf(key, el) {
  const e = REG.get(key);
  return {
    ml: !!(e?.ml || el?.hasAttribute?.('data-ml')),
    rich: !!(e?.rich || el?.hasAttribute?.('data-rich')),
    opt: !!(e?.opt || el?.hasAttribute?.('data-opt')),
    ph: e?.ph || '',
  };
}

/** Attributes for an element built as an HTML string: ' data-k="key"' plus the vars and flags it needs. */
export function kAttrs(key, vars) {
  const f = flagsOf(key);
  let a = ' data-k="' + escHTML(key) + '"';
  if (vars && Object.keys(vars).length) a += ' data-kv="' + escHTML(JSON.stringify(vars)) + '"';
  if (f.ml) a += ' data-ml';
  if (f.rich) a += ' data-rich';
  if (f.opt) {
    a += ' data-opt';
    if (!fill(rawText(key), vars).trim()) a += ' data-empty';
  }
  if (f.ph) a += ' data-ph="' + escHTML(f.ph) + '"';
  return a;
}

/** The inner HTML for a key, escaped (with <b> for **bold** in rich texts). Pair it with kAttrs(). */
export function kText(key, vars) {
  const text = fill(rawText(key), vars);
  return flagsOf(key).rich ? richHTML(text) : escHTML(text);
}

/** A whole element as an HTML string: kHTML('jadwal.empty', null, 'p', 'jw-empty'). */
export function kHTML(key, vars, tag = 'span', cls = '') {
  return '<' + tag + (cls ? ' class="' + escHTML(cls) + '"' : '') + kAttrs(key, vars) + '>' + kText(key, vars) + '</' + tag + '>';
}

/** Marks an element built with the DOM and gives it the text: kSet(el, 'jadwal.after', { blok }). */
export function kSet(el, key, vars) {
  // An element being typed into keeps what is typed, as in apply(). Only its vars follow (the
  // editor repaints it with them once the typing ends); another key waits for the next redraw.
  const typing = el.isContentEditable && el === el.ownerDocument?.activeElement;
  if (typing && el.dataset.k !== key) return el;
  el.dataset.k = key;
  if (vars && Object.keys(vars).length) el.dataset.kv = JSON.stringify(vars);
  else delete el.dataset.kv;
  const f = flagsOf(key);
  if (f.ml) el.setAttribute('data-ml', '');
  if (f.rich) el.setAttribute('data-rich', '');
  if (f.opt) el.setAttribute('data-opt', '');
  if (f.ph) el.setAttribute('data-ph', f.ph);
  if (typing) return el;
  show(el, fill(rawText(key, el), vars), f.rich);
  markEmpty(el);
  return el;
}

/** A placeholder or title taken from a key, as HTML attributes: kAttr('kp', 'find.ph'). */
export function kAttr(kind, key, vars) {
  const name = ATTRS[kind];
  if (!name) throw new Error('[texts] unknown attribute kind ' + kind);
  return ' data-' + kind + '="' + escHTML(key) + '"' +
    (vars && Object.keys(vars).length ? ' data-' + kind + 'v="' + escHTML(JSON.stringify(vars)) + '"' : '') +
    ' ' + name + '="' + escHTML(fill(rawText(key), vars)) + '"';
}

// **bold** parts, the only markup a text can carry
function richParts(text) {
  const s = String(text);
  const out = [];
  let at = 0;
  for (const m of s.matchAll(BOLD_RE)) {
    if (m.index > at) out.push([false, s.slice(at, m.index)]);
    out.push([true, m[1]]);
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push([false, s.slice(at)]);
  return out;
}
function richHTML(text) {
  return richParts(text).map(([b, s]) => (b ? '<b>' + escHTML(s) + '</b>' : escHTML(s))).join('');
}
// what an element shows, read back in the form show() writes it (<b> as **)
function sourceOf(el) {
  if (!el.hasAttribute?.('data-rich')) return el.textContent;
  let s = '';
  for (const n of el.childNodes) s += n.nodeType === 1 && n.tagName === 'B' ? '**' + n.textContent + '**' : n.textContent;
  return s;
}
/** The text a page element ships with. Line breaks that only come from how index.html is laid out
 *  are not part of it: around the text they go, inside it they become one space. */
export function shippedText(el) {
  return sourceOf(el).replace(/^\s*\n\s*|\s*\n\s*$/g, '').replace(/\s*\n\s*/g, ' ');
}
function show(el, text, rich) {
  if (!rich) {
    if (el.textContent !== text) el.textContent = text;
    return;
  }
  if (sourceOf(el) === text) return;
  el.textContent = '';
  for (const [b, s] of richParts(text)) {
    if (b) {
      const x = document.createElement('b');
      x.textContent = s;
      el.append(x);
    } else el.append(document.createTextNode(s));
  }
}
// an optional text (data-opt) that is empty hides itself, or the line around it (data-opt-line)
function markEmpty(el) {
  if (!el.hasAttribute?.('data-opt')) return;
  const box = el.closest?.('[data-opt-line]') || el;
  box.toggleAttribute('data-empty', !el.textContent.trim());
}

function varsOfEl(el, attr = 'kv') {
  const raw = el.dataset[attr];
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** The text an element shows for its key right now, vars filled. */
export function textFor(el) {
  return fill(rawText(el.dataset.k, el), varsOfEl(el));
}

/** The raw text (with {name} parts and ** marks) behind an element, for typing into it. */
export function sourceFor(el) {
  return rawText(el.dataset.k, el);
}

/** The vars an element fills its text with ({} when it has none). */
export function varsFor(el) {
  return varsOfEl(el) || {};
}

/** Writes the current texts into every marked element under root. */
export function apply(root = document) {
  if (!root?.querySelectorAll) return;
  const list = [...root.querySelectorAll(MARKED)];
  if (root.matches?.(MARKED)) list.unshift(root);
  for (const el of list) {
    if (el.dataset.k) {
      // an element being typed into is left alone
      if (!(el.isContentEditable && el === el.ownerDocument?.activeElement)) {
        if (!original.has(el)) original.set(el, REG.has(el.dataset.k) ? sourceOf(el) : shippedText(el));
        show(el, textFor(el), flagsOf(el.dataset.k, el).rich);
      }
      markEmpty(el);
    }
    for (const kind in ATTRS) if (el.dataset[kind]) attr(el, kind);
  }
}

function attr(el, kind) {
  const name = ATTRS[kind], key = el.dataset[kind];
  let o = originalAttr.get(el);
  if (!o) { o = {}; originalAttr.set(el, o); }
  if (!own(o, name)) o[name] = el.getAttribute(name) || '';
  const raw = own(T, key) ? T[key] : REG.has(key) ? REG.get(key).d : o[name];
  const want = fill(raw, varsOfEl(el, kind + 'v'));
  if (el.getAttribute(name) !== want) el.setAttribute(name, want);
}

/** The shipped text of an attribute (placeholder or title) under a data-kp / data-kt key. */
export function defaultAttr(el, name) {
  const kind = Object.keys(ATTRS).find((k) => ATTRS[k] === name);
  const key = kind && el.dataset[kind];
  if (key && REG.has(key)) return REG.get(key).d;
  const o = originalAttr.get(el);
  return o && own(o, name) ? o[name] : el.getAttribute(name) || '';
}

/** Replaces the changed texts (the links document's site.t) and repaints the page. */
export function setTexts(next) {
  T = next && typeof next === 'object' ? next : {};
  if (typeof document !== 'undefined') apply(document);
  for (const fn of listeners) {
    try { fn(T); } catch (e) { console.error('[texts] listener failed', e); }
  }
}

/** The changed texts as last set. */
export function getTexts() {
  return T;
}

/** Called after every setTexts(); returns an unsubscribe function. */
export function onTexts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// The object main.js hands to the live editor, and to the shell for the hero endings.
export function createTexts(portal) {
  return {
    set(next) {
      setTexts(next);
      portal?.setTexts?.(T);
    },
    apply,
    get: getTexts,
    original: (el) => defaultText(el?.dataset?.k, el),
    defaultText,
    defaultAttr,
    rawText,
    textFor,
    sourceFor,
    varsFor,
    listCopy,
    copyEntry,
    groupLabel,
    varsOf,
    fill,
  };
}
