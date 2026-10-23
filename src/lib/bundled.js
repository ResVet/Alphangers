// Bloks (and channels) that ship with the site after the admin has published a copy.
//
// The schedule and the lecturer list ship in src/data. Once the admin publishes one of them, the
// published copy replaces the shipped one completely (content.js), so a blok added to the shipped
// copy later (a new block's official schedule landing in the repository) would never show.
//
// scripts/build_data.py gives such a blok an `added` time and both shipped documents a `base` (the
// newest of those times). A published copy whose own `base` is older or missing has not taken
// that blok in yet, and gets it here without anything the admin changed being touched:
//   schedule  the blok is appended, unless the copy already has a blok with the same id or with
//             dates that overlap it; then the admin's own blok stands.
//   dosen     people teaching in such a blok are added when the list lacks them, and people it
//             has get that blok and their code in it. Names, phones and everyone else stay.
//   links     the same for channels (the Try Out OSPE channel): a channel with a newer `added`
//             goes in right after the channel it follows in the shipped list, or at the end,
//             unless the copy already has a channel with that id.
// The merged copy carries the shipped `base`, and the editors start from the merged copy, so the
// next publish saves the blok together with that `base`. A blok the admin deletes after that
// stays deleted.
//
// Pure: no DOM, no storage, no network. Inputs are never changed.

import { validate } from './validate.js';

function time(s) {
  return typeof s === 'string' ? Date.parse(s) : NaN;
}

/** true when stamp is a real time later than base, or base is missing. */
export function isNewer(stamp, base) {
  const t = time(stamp);
  if (!Number.isFinite(t)) return false;
  const b = time(base);
  return !Number.isFinite(b) || t > b;
}

const clone = (x) => JSON.parse(JSON.stringify(x));

export function mergeSchedule(remote, bundled) {
  if (!remote || !bundled || !Array.isArray(remote.bloks) || !Array.isArray(bundled.bloks)) return remote;
  if (!isNewer(bundled.base, remote.base)) return remote;
  const bloks = remote.bloks.slice();
  for (const b of bundled.bloks) {
    if (!b || !isNewer(b.added, remote.base)) continue;
    const taken = bloks.some((r) => r && (r.id === b.id || (r.start <= b.end && b.start <= r.end)));
    if (!taken) bloks.push(clone(b));
  }
  return { ...remote, base: bundled.base, bloks };
}

export function mergeDosen(remote, bundled) {
  if (!remote || !bundled || !Array.isArray(remote.list) || !Array.isArray(bundled.list)) return remote;
  if (!isNewer(bundled.base, remote.base)) return remote;
  const added = bundled.added && typeof bundled.added === 'object' ? bundled.added : {};
  const fresh = new Set(Object.keys(added).filter((id) => isNewer(added[id], remote.base)));
  const list = remote.list.slice();
  const at = new Map(list.map((p, i) => [p && p.id, i]));
  for (const p of bundled.list) {
    const teaches = (Array.isArray(p?.bloks) ? p.bloks : []).filter((b) => fresh.has(b));
    if (!teaches.length) continue;
    const i = at.get(p.id);
    if (i === undefined) {
      at.set(p.id, list.length);
      list.push(clone(p));
      continue;
    }
    const r = { ...list[i], bloks: Array.isArray(list[i].bloks) ? list[i].bloks.slice() : [], codes: { ...(list[i].codes || {}) } };
    for (const b of teaches) {
      if (!r.bloks.includes(b)) r.bloks.push(b);
      if (p.codes?.[b] && !r.codes[b]) r.codes[b] = p.codes[b];
    }
    list[i] = r;
  }
  return { ...remote, base: bundled.base, list };
}

export function mergeLinks(remote, bundled) {
  if (!remote || !bundled || !Array.isArray(remote.channels) || !Array.isArray(bundled.channels)) return remote;
  if (!isNewer(bundled.base, remote.base)) return remote;
  const channels = remote.channels.slice();
  bundled.channels.forEach((c, i) => {
    if (!c || !isNewer(c.added, remote.base) || channels.some((r) => r && r.id === c.id)) return;
    let at = channels.length;
    for (let j = i - 1; j >= 0; j--) {
      const k = channels.findIndex((r) => r && r.id === bundled.channels[j]?.id);
      if (k >= 0) { at = k + 1; break; }
    }
    channels.splice(at, 0, clone(c));
  });
  return { ...remote, base: bundled.base, channels };
}

const MERGERS = { schedule: mergeSchedule, dosen: mergeDosen, links: mergeLinks };
/** The content keys a published copy can gain shipped bloks or channels in. */
export const MERGED = Object.freeze(Object.keys(MERGERS));

/**
 * The copy to show or edit for a validated published document: itself, plus the bloks the shipped
 * copy gained since it was saved. The result is validated, which also puts its keys in the usual
 * order; if it would not validate (it cannot with sound inputs) the published copy is used as it is.
 */
export function withBundled(key, remote, bundled) {
  const merge = MERGERS[key];
  if (!merge || !remote || !bundled) return remote;
  const merged = merge(remote, bundled);
  if (merged === remote) return remote;
  const res = validate(key, merged);
  return res.ok ? res.data : remote;
}
