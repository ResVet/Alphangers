// Renders the output of diff() as a readable list.
import { h } from './dom.js';
import { preview, wordDiff } from './diff.js';

const KIND = { add: 'Tambah', remove: 'Hapus', change: 'Ubah', move: 'Urutan' };

function valueBlock(v, cls) {
  return h('div', { class: `dv-val ${cls}` }, preview(v, 400));
}

function textChange(before, after) {
  const parts = wordDiff(before, after);
  if (!parts) return [valueBlock(before, 'old'), valueBlock(after, 'new')];
  return h(
    'div',
    { class: 'dv-val words' },
    parts.map((p) => (p.op === '=' ? p.text : h(p.op === '+' ? 'ins' : 'del', null, p.text))),
  );
}

function body(c) {
  if (c.kind === 'move') return h('p', { class: 'dv-note' }, 'Urutan item diubah.');
  if (c.kind === 'add') return valueBlock(c.after, 'new');
  if (c.kind === 'remove') return valueBlock(c.before, 'old');
  const long = typeof c.before === 'string' && typeof c.after === 'string' && c.before.length + c.after.length > 80;
  if (long) return textChange(c.before, c.after);
  return h('div', { class: 'dv-pair' }, valueBlock(c.before, 'old'), h('span', { class: 'dv-arrow', 'aria-label': 'menjadi' }, '→'), valueBlock(c.after, 'new'));
}

export function renderChanges(changes, max = 150) {
  if (!changes.length) return h('p', { class: 'empty' }, 'Tidak ada perubahan.');
  const shown = changes.slice(0, max);
  return h(
    'div',
    { class: 'dv' },
    h(
      'ol',
      { class: 'dv-list' },
      shown.map((c) =>
        h(
          'li',
          { class: `dv-item ${c.kind}` },
          h('div', { class: 'dv-head' }, h('span', { class: `dv-kind ${c.kind}` }, KIND[c.kind]), h('span', { class: 'dv-path' }, c.path.join(' › ') || 'Dokumen')),
          body(c),
        ),
      ),
    ),
    changes.length > max ? h('p', { class: 'hint' }, `Dan ${changes.length - max} perubahan lain. Pakai Ekspor JSON kalau mau lihat semuanya.`) : null,
  );
}

export function summarize(changes) {
  const n = { add: 0, remove: 0, change: 0, move: 0 };
  for (const c of changes) n[c.kind]++;
  const parts = [];
  if (n.change) parts.push(`${n.change} diubah`);
  if (n.add) parts.push(`${n.add} ditambah`);
  if (n.remove) parts.push(`${n.remove} dihapus`);
  if (n.move) parts.push('urutan berubah');
  return parts.join(', ');
}
