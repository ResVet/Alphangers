// Three-way merge for a save conflict: base is what this tab loaded, mine is
// the draft, theirs is the newer version on the server. Items in the main list
// are matched by id. When both sides changed the same item, the draft wins and
// the item is reported. When one side deleted an item the other side edited,
// the edited copy is kept, so a merge never silently loses work.
import { KEY_INFO, itemLabel } from './format.js';

const J = (v) => JSON.stringify(v);

export function merge3(key, base, mine, theirs) {
  const listField = KEY_INFO[key].list;
  const conflicts = [];
  const result = {};

  for (const f of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    if (f === listField) continue;
    result[f] = J(mine[f]) !== J(base?.[f]) ? mine[f] : theirs[f];
  }

  const byId = (arr) => new Map((arr || []).map((x) => [x.id, x]));
  const B = byId(base?.[listField]);
  const M = byId(mine[listField]);
  const T = byId(theirs[listField]);
  const out = [];
  const label = (x) => itemLabel(listField, x, 0);

  for (const m of mine[listField]) {
    const b = B.get(m.id), t = T.get(m.id);
    if (!b) {
      if (t && J(t) !== J(m)) conflicts.push({ label: label(m), why: 'Ditambah di dua tempat dengan isi beda. Punyamu yang dipakai.' });
      out.push(m);
    } else if (!t) {
      if (J(m) !== J(b)) {
        conflicts.push({ label: label(m), why: 'Dihapus di server, tapi kamu ubah. Tetap disimpan.' });
        out.push(m);
      }
    } else if (J(m) === J(b)) out.push(t);
    else if (J(t) === J(b) || J(t) === J(m)) out.push(m);
    else {
      conflicts.push({ label: label(m), why: 'Diubah di dua tempat. Punyamu yang dipakai.' });
      out.push(m);
    }
  }

  for (const t of theirs[listField]) {
    if (M.has(t.id)) continue;
    const b = B.get(t.id);
    if (!b) out.push(t); // added on the server
    else if (J(t) !== J(b)) {
      conflicts.push({ label: label(t), why: 'Kamu hapus, tapi di server diubah. Versi server dipertahankan.' });
      out.push(t);
    }
    // else: deleted here and untouched there, so it stays deleted
  }

  result[listField] = out;
  return { data: result, conflicts };
}
