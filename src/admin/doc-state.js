// What the admin knows about one content key: the version on the server
// (or the bundled one when there is none), the draft being edited, and the
// latest validation result for that draft.
import { validate, validateJsonText } from '../lib/validate.js';

const DRAFT_PREFIX = 'alpha.draft.v1.';

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export class DocState {
  constructor(key, bundled) {
    this.key = key;
    this.bundled = bundled;
    this.base = null;
    this.draft = null;
    this.result = null;
    this.dirty = false;
    this.pending = undefined;
    this.persistTimer = null;
    this.listeners = new Set();
  }

  // remote: { exists, rev, json, updatedAt, updatedBy }
  setBase(remote) {
    let data = this.bundled;
    let invalid = null;
    if (remote.exists) {
      const res = validateJsonText(this.key, remote.json);
      if (res.ok) data = res.data;
      else invalid = res.errors;
    }
    this.base = { ...remote, data, invalid, json: remote.exists ? remote.json : null };
    this.baseJson = JSON.stringify(data);
    // A draft left from an earlier visit is offered once, before anything overwrites it.
    this.pending = this.pending === undefined ? this.savedDraft() : null;
    this.replaceDraft(structuredClone(data));
  }

  replaceDraft(data) {
    this.draft = data;
    this.refresh();
  }

  // Call after any edit. Cheap enough to run on every keystroke for these sizes.
  refresh() {
    this.result = validate(this.key, this.draft);
    const json = JSON.stringify(this.draft);
    this.dirty = json !== this.baseJson;
    clearTimeout(this.persistTimer);
    if (this.dirty) this.persistTimer = setTimeout(() => this.persistDraft(json), 300);
    else if (!this.pending) this.dropDraft();
    for (const fn of this.listeners) fn(this);
  }

  // Writes a pending draft now instead of after the debounce (page is closing).
  flushDraft() {
    if (!this.dirty) return;
    clearTimeout(this.persistTimer);
    this.persistDraft(JSON.stringify(this.draft));
  }

  restorePending() {
    const p = this.pending;
    this.pending = null;
    if (p) this.replaceDraft(p.data);
  }

  dismissPending() {
    this.pending = null;
    if (!this.dirty) this.dropDraft();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  discard() {
    this.replaceDraft(structuredClone(this.base.data));
  }

  // Data that would be written right now, or null when the draft has errors.
  clean() {
    return this.result && this.result.ok ? this.result.data : null;
  }

  // Drafts survive a closed tab, which matters when editing on a phone.
  persistDraft(json) {
    try {
      storage()?.setItem(DRAFT_PREFIX + this.key, JSON.stringify({ baseRev: this.base.rev, at: Date.now(), json }));
    } catch {
      /* storage full or blocked: the draft just won't survive a reload */
    }
  }

  dropDraft() {
    try {
      storage()?.removeItem(DRAFT_PREFIX + this.key);
    } catch {
      /* ignore */
    }
  }

  savedDraft() {
    try {
      const raw = storage()?.getItem(DRAFT_PREFIX + this.key);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (typeof d.json !== 'string' || d.json === this.baseJson) return null;
      return { baseRev: d.baseRev, at: new Date(d.at), data: JSON.parse(d.json) };
    } catch {
      return null;
    }
  }
}
