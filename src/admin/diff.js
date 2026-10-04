// Structural diff for the "check before saving" view. Lists with ids are
// matched by id (or by date for days, by number for phones), other lists by
// longest common subsequence, so a moved or edited item shows up as one change
// instead of a cascade.
import { fieldLabel, itemLabel } from './format.js';

const KEYED = { channels: 'id', items: 'id', bloks: 'id', days: 'd', list: 'id', parts: 'id', phones: 'n' };

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Returns [{ kind: 'add' | 'remove' | 'change' | 'move', path: [labels], before, after }]
export function diff(before, after) {
  const out = [];
  walk(before, after, [], '', out);
  return out;
}

function walk(a, b, path, list, out) {
  if (same(a, b)) return;
  if (Array.isArray(a) && Array.isArray(b)) return diffList(a, b, path, list, out);
  if (isObj(a) && isObj(b)) return diffObject(a, b, path, list, out);
  out.push({ kind: 'change', path, before: a, after: b });
}

function diffObject(a, b, path, list, out) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    // Inside a codes map the keys are lecturer codes or blok ids, shown as they are.
    const p = path.concat(list === 'codes' ? k : fieldLabel(list, k));
    if (!(k in a)) out.push({ kind: 'add', path: p, before: undefined, after: b[k] });
    else if (!(k in b)) out.push({ kind: 'remove', path: p, before: a[k], after: undefined });
    else {
      const child = Array.isArray(a[k]) || Array.isArray(b[k]) ? k : k === 'codes' ? 'codes' : list;
      walk(a[k], b[k], p, child, out);
    }
  }
}

function diffList(a, b, path, list, out) {
  const keyField = KEYED[list];
  const objects = a.concat(b).every(isObj);
  if (keyField && objects) return diffKeyed(a, b, path, list, keyField, out);
  diffSequence(a, b, path, list, out);
}

function diffKeyed(a, b, path, list, keyField, out) {
  const ka = a.map((x) => x[keyField]);
  const kb = b.map((x) => x[keyField]);
  const mapA = new Map(a.map((x, i) => [x[keyField], { x, i }]));
  const mapB = new Map(b.map((x, i) => [x[keyField], { x, i }]));
  for (const [k, { x, i }] of mapA) {
    if (!mapB.has(k)) out.push({ kind: 'remove', path: path.concat(itemLabel(list, x, i)), before: x, after: undefined });
  }
  for (const [k, { x, i }] of mapB) {
    if (!mapA.has(k)) out.push({ kind: 'add', path: path.concat(itemLabel(list, x, i)), before: undefined, after: x });
    else walk(mapA.get(k).x, x, path.concat(itemLabel(list, x, i)), list, out);
  }
  const commonA = ka.filter((k) => mapB.has(k));
  const commonB = kb.filter((k) => mapA.has(k));
  if (commonA.join('\u0000') !== commonB.join('\u0000')) {
    out.push({ kind: 'move', path, before: commonA.length, after: commonB.length });
  }
}

// Classic LCS table; lists here are short (sessions per day, phones, anatomy points).
function lcsOps(a, b, eq) {
  const n = a.length, m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = eq(a[i], b[j]) ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) ops.push({ op: '=', i: i++, j: j++ });
    else if (t[i + 1][j] >= t[i][j + 1]) ops.push({ op: '-', i: i++ });
    else ops.push({ op: '+', j: j++ });
  }
  while (i < n) ops.push({ op: '-', i: i++ });
  while (j < m) ops.push({ op: '+', j: j++ });
  return ops;
}

function diffSequence(a, b, path, list, out) {
  if (a.length * b.length > 250_000) {
    out.push({ kind: 'change', path, before: a, after: b });
    return;
  }
  const ops = lcsOps(a, b, same);
  // Pair a run of removals with the run of additions right after it, so an
  // edited session reads as "changed" with its fields, not as remove plus add.
  for (let k = 0; k < ops.length; ) {
    if (ops[k].op === '=') {
      k++;
      continue;
    }
    const removed = [], added = [];
    while (k < ops.length && ops[k].op === '-') removed.push(ops[k++].i);
    while (k < ops.length && ops[k].op === '+') added.push(ops[k++].j);
    const pairs = Math.min(removed.length, added.length);
    for (let p = 0; p < pairs; p++) {
      const x = a[removed[p]], y = b[added[p]];
      const label = path.concat(itemLabel(list, y, added[p]));
      if (isObj(x) && isObj(y)) walk(x, y, label, list, out);
      else out.push({ kind: 'change', path: label, before: x, after: y });
    }
    for (const i of removed.slice(pairs)) out.push({ kind: 'remove', path: path.concat(itemLabel(list, a[i], i)), before: a[i], after: undefined });
    for (const j of added.slice(pairs)) out.push({ kind: 'add', path: path.concat(itemLabel(list, b[j], j)), before: undefined, after: b[j] });
  }
}

// Word level diff for long text, so a one-word fix in a paragraph is easy to spot.
// Returns [{ op: '=' | '-' | '+', text }] or null when the texts are too long to compare.
export function wordDiff(a, b) {
  const ta = String(a).split(/(\s+)/);
  const tb = String(b).split(/(\s+)/);
  if (ta.length * tb.length > 400_000) return null;
  const ops = lcsOps(ta, tb, (x, y) => x === y);
  const out = [];
  for (const o of ops) {
    const text = o.op === '+' ? tb[o.j] : ta[o.i];
    const last = out[out.length - 1];
    if (last && last.op === o.op) last.text += text;
    else out.push({ op: o.op, text });
  }
  return out;
}

// One line description of any value, for the change list.
export function preview(v, max = 160) {
  let s;
  if (v === undefined) s = '';
  else if (v === null) s = 'kosong';
  else if (typeof v === 'boolean') s = v ? 'ya' : 'tidak';
  else if (typeof v === 'string') s = v === '' ? '(kosong)' : v;
  else if (Array.isArray(v)) s = v.every((x) => typeof x === 'string') ? v.join(', ') || '(kosong)' : `${v.length} item`;
  else if (isObj(v)) s = v.name || v.title || v.t || v.f || v.k || JSON.stringify(v);
  else s = String(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
