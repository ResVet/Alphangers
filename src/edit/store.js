// Drafts for the live editor. One DocState per content key (the same class the admin page uses,
// so a draft started here also shows up there and survives a closed tab). Every change goes
// through edit(): it works on a copy, validates it, keeps it only when it is valid, records it for
// undo, and shows it on the page through the content layer.
import { DocState } from '../admin/doc-state.js';
import { validate, CONTENT_KEYS } from '../lib/validate.js';
import { loadBundled, inject } from '../lib/content.js';

// saved in this order, so a session never points at a lecturer that is not published yet
const SAVE_ORDER = ['dosen', 'schedule', 'links', 'announcements', 'heart'];

export async function createStore(backend) {
  const docs = {};
  await Promise.all(CONTENT_KEYS.map(async (key) => {
    const [bundled, remote] = await Promise.all([loadBundled(key), backend.read(key)]);
    const doc = new DocState(key, bundled);
    doc.setBase(remote);
    docs[key] = doc;
  }));
  const undo = [], redo = [];
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());

  function show(key) {
    const clean = docs[key].clean();
    if (clean) inject(key, clean);
  }

  /**
   * edit({ schedule: (d) => {...}, dosen: (d) => {...} }, 'label') or edit('schedule', fn, 'label').
   * Each function changes its draft copy in place. Nothing is kept unless every copy validates.
   */
  function edit(a, b, c) {
    const fns = typeof a === 'string' ? { [a]: b } : a;
    const label = typeof a === 'string' ? c : b;
    const next = {}, before = {};
    const errors = [];
    for (const [key, fn] of Object.entries(fns)) {
      const draft = structuredClone(docs[key].draft);
      before[key] = JSON.stringify(docs[key].draft);
      const r = fn(draft);
      if (r === false) return { ok: false, cancelled: true };
      const res = validate(key, draft);
      if (!res.ok) errors.push(...res.errors.map((e) => humanError(e)));
      else next[key] = res.data;
    }
    if (errors.length) return { ok: false, errors };
    const step = { label, keys: {} };
    for (const [key, data] of Object.entries(next)) {
      const after = JSON.stringify(data);
      if (after === before[key]) continue;
      step.keys[key] = { before: before[key], after };
      docs[key].replaceDraft(data);
      show(key);
    }
    if (Object.keys(step.keys).length) {
      undo.push(step);
      if (undo.length > 120) undo.shift();
      redo.length = 0;
      emit();
    }
    return { ok: true };
  }

  function travel(from, to, dir) {
    const step = from.pop();
    if (!step) return null;
    for (const [key, v] of Object.entries(step.keys)) {
      docs[key].replaceDraft(JSON.parse(dir < 0 ? v.before : v.after));
      show(key);
    }
    to.push(step);
    emit();
    return step.label;
  }

  function dirtyKeys() {
    return CONTENT_KEYS.filter((k) => docs[k].dirty);
  }

  /** Publishes every changed document. onConflict(key, remote) decides: 'mine' | 'theirs'. */
  async function publish({ note = '', onConflict, uid }) {
    const done = [];
    for (const key of SAVE_ORDER) {
      const doc = docs[key];
      if (!doc.dirty) continue;
      const clean = doc.clean();
      if (!clean) throw Object.assign(new Error('invalid'), { key, errors: doc.result.errors });
      const json = JSON.stringify(clean);
      try {
        const res = await backend.save(key, { json, baseRev: doc.base.rev, note });
        doc.setBase({ exists: true, rev: res.rev, json, updatedAt: new Date(), updatedBy: uid });
      } catch (e) {
        if (e?.name !== 'ConflictError' && !e?.remote) throw e;
        const choice = await onConflict(key, e.remote);
        const mine = structuredClone(clean);
        const remote = await backend.read(key);
        doc.setBase(remote);
        if (choice === 'mine') {
          doc.replaceDraft(mine);
          const res = await backend.save(key, { json, baseRev: doc.base.rev, note });
          doc.setBase({ exists: true, rev: res.rev, json, updatedAt: new Date(), updatedBy: uid });
        }
        show(key);
      }
      done.push(key);
    }
    undo.length = 0;
    redo.length = 0;
    emit();
    return done;
  }

  function discard() {
    for (const key of dirtyKeys()) {
      docs[key].discard();
      show(key);
    }
    undo.length = 0;
    redo.length = 0;
    emit();
  }

  /** Drafts left from an earlier visit (this device), restored or dropped by the caller. */
  function pending() {
    return CONTENT_KEYS.filter((k) => docs[k].pending);
  }
  function restorePending() {
    for (const k of pending()) { docs[k].restorePending(); show(k); }
    emit();
  }
  function dropPending() {
    for (const k of pending()) docs[k].dismissPending();
  }

  function flush() {
    for (const k of CONTENT_KEYS) docs[k].flushDraft();
  }
  addEventListener('pagehide', flush);

  return {
    docs,
    get: (key) => docs[key].draft,
    edit,
    undo: () => travel(undo, redo, -1),
    redo: () => travel(redo, undo, 1),
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    dirtyKeys,
    publish,
    discard,
    pending,
    restorePending,
    dropPending,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

function humanError(e) {
  const where = (e.path || []).filter((x) => typeof x === 'string' && !/^\d+$/.test(x)).slice(-1)[0];
  return (where ? where + ': ' : '') + e.msg;
}
