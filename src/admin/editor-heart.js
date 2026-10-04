// Text for the 55 parts of the 3D heart. Ids and groups come from the model,
// so they are shown but never edited, and parts can not be added or removed.
import { h, replace } from './dom.js';
import { input, issueBadge } from './fields.js';
import { GROUP_LABELS } from './format.js';
import { HEART_GROUPS } from '../lib/validate.js';

export function renderHeart(host, ctx) {
  const parts = ctx.doc.draft.parts;
  const ui = ctx.ui;
  if (!ui.part || !parts.some((p) => p.id === ui.part)) ui.part = parts[0] && parts[0].id;
  const i = parts.findIndex((p) => p.id === ui.part);
  const part = parts[i];
  const pp = ['parts', i];

  const picker = h(
    'select',
    { id: 'heart-part' },
    HEART_GROUPS.map((g) =>
      h('optgroup', { label: GROUP_LABELS[g] }, parts.filter((p) => p.group === g).map((p) => h('option', { value: p.id }, p.name || p.id))),
    ),
  );
  picker.value = ui.part;
  picker.addEventListener('change', () => go(picker.value));

  function go(id) {
    ui.part = id;
    ctx.rerender();
    requestAnimationFrame(() => document.getElementById('heart-part')?.focus());
  }

  const step = (d) => {
    const n = parts[(i + d + parts.length) % parts.length];
    go(n.id);
  };

  host.append(
    h(
      'div',
      { class: 'bar' },
      h('div', { class: 'fld grow' }, h('label', { htmlFor: 'heart-part' }, 'Bagian jantung'), picker),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn ghost sm', onclick: () => step(-1), 'aria-label': 'Bagian sebelumnya' }, '←'),
        h('span', { class: 'mono meta' }, `${i + 1}/${parts.length}`),
        h('button', { type: 'button', class: 'btn ghost sm', onclick: () => step(1), 'aria-label': 'Bagian berikutnya' }, '→'),
      ),
    ),
    h(
      'div',
      { class: 'part-head' },
      h('h3', null, part.name || part.id),
      issueBadge(ctx.doc.result, pp),
      h('span', { class: 'chip muted' }, GROUP_LABELS[part.group] || part.group),
      h('span', { class: 'mono meta' }, `id ${part.id}`),
    ),
    h(
      'div',
      { class: 'grid3' },
      input({ label: 'Nama', obj: part, prop: 'name', path: pp.concat('name'), ctx, max: 80, onCommit: () => ctx.rerender() }),
      input({ label: 'Latin', obj: part, prop: 'latin', path: pp.concat('latin'), ctx, max: 160 }),
      input({ label: 'Inggris', obj: part, prop: 'en', path: pp.concat('en'), ctx, max: 80 }),
      input({ label: 'Ringkasan', obj: part, prop: 'summary', path: pp.concat('summary'), ctx, type: 'textarea', rows: 3, max: 600, wide: true }),
    ),
    textList('Anatomi', part.anatomy, pp.concat('anatomy'), 1200),
    h('div', { class: 'grid3' }, input({ label: 'Fungsi', obj: part, prop: 'function', path: pp.concat('function'), ctx, type: 'textarea', rows: 4, max: 1500, wide: true })),
    pairList('Angka penting', part.numbers, pp.concat('numbers'), ['k', 'Nama', 120], ['v', 'Nilai', 200]),
    h('div', { class: 'grid3' }, input({ label: 'Pendarahan dan persarafan', obj: part, prop: 'supply', path: pp.concat('supply'), ctx, type: 'textarea', rows: 4, max: 1500, wide: true })),
    pairList('Klinis', part.clinical, pp.concat('clinical'), ['t', 'Judul', 120], ['d', 'Penjelasan', 1200, true]),
    h('div', { class: 'grid3' }, input({ label: 'EKG', obj: part, prop: 'ecg', path: pp.concat('ecg'), ctx, type: 'textarea', rows: 4, max: 1500, wide: true })),
    related(),
  );

  function listShell(title, arr, path, rowFn, blank) {
    const box = h('div', { class: 'stack' });
    const paint = () => {
      replace(box, 
        ...arr.map((item, j) =>
          h(
            'div',
            { class: 'stack-row' },
            rowFn(item, j),
            h(
              'div',
              { class: 'row-actions col' },
              h('button', { type: 'button', class: 'btn ghost sm', disabled: j === 0, 'aria-label': `Naikkan ${title} ${j + 1}`, onclick: () => (swap(arr, j, j - 1), ctx.changed(), paint()) }, '↑'),
              h('button', { type: 'button', class: 'btn ghost sm', disabled: j === arr.length - 1, 'aria-label': `Turunkan ${title} ${j + 1}`, onclick: () => (swap(arr, j, j + 1), ctx.changed(), paint()) }, '↓'),
              h('button', { type: 'button', class: 'btn ghost sm danger-text', 'aria-label': `Hapus ${title} ${j + 1}`, onclick: () => (arr.splice(j, 1), ctx.changed(), paint()) }, 'Hapus'),
            ),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn ghost sm',
            onclick: () => {
              arr.push(blank());
              ctx.changed();
              paint();
              const rows = box.querySelectorAll('.stack-row');
              rows[rows.length - 1]?.querySelector('input, textarea')?.focus();
            },
          },
          `Tambah ${title.toLowerCase()}`,
        ),
      );
    };
    paint();
    return h('section', { class: 'sub', dataset: { path: path.join('.') } }, h('h4', { class: 'sub-title' }, title, issueBadge(ctx.doc.result, path)), box);
  }

  // Lists of plain strings (anatomy points) are edited through a proxy object per row.
  function textList(title, arr, path, max) {
    return listShell(title, arr, path, (s, j) => {
      const proxy = {
        get v() {
          return arr[j];
        },
        set v(x) {
          arr[j] = x;
        },
      };
      return input({ label: `Poin ${j + 1}`, obj: proxy, prop: 'v', path: path.concat(j), ctx, type: 'textarea', rows: 3, max, wide: true });
    }, () => '');
  }

  function pairList(title, arr, path, [k1, l1, m1], [k2, l2, m2, long2]) {
    return listShell(title, arr, path, (item, j) =>
      h(
        'div',
        { class: 'grid2 tight' },
        input({ label: l1, obj: item, prop: k1, path: path.concat(j, k1), ctx, max: m1 }),
        input({ label: l2, obj: item, prop: k2, path: path.concat(j, k2), ctx, max: m2, type: long2 ? 'textarea' : 'text', rows: 3, wide: !!long2 }),
      ),
    () => ({ [k1]: '', [k2]: '' }));
  }

  function related() {
    const box = h('div', { class: 'fld wide', dataset: { path: pp.concat('related').join('.') } });
    const chips = h('div', { class: 'chips edit' });
    const add = h('select', { id: 'heart-rel', 'aria-label': 'Tambah bagian terkait' });
    const paint = () => {
      replace(chips, 
        ...part.related.map((rid, j) => {
          const r = parts.find((p) => p.id === rid);
          return h(
            'span',
            { class: 'chip removable' },
            r ? r.name : rid,
            h('button', { type: 'button', class: 'chip-x', 'aria-label': `Lepas ${r ? r.name : rid}`, onclick: () => (part.related.splice(j, 1), ctx.changed(), paint()) }, '×'),
          );
        }),
        part.related.length ? null : h('span', { class: 'hint' }, 'Belum ada.'),
      );
      replace(add, 
        h('option', { value: '' }, part.related.length >= 10 ? 'Maksimal 10' : 'Tambah bagian terkait'),
        ...parts.filter((p) => p.id !== part.id && !part.related.includes(p.id)).map((p) => h('option', { value: p.id }, p.name)),
      );
      add.disabled = part.related.length >= 10;
    };
    add.addEventListener('change', () => {
      if (!add.value) return;
      part.related.push(add.value);
      ctx.changed();
      paint();
      add.focus();
    });
    paint();
    box.append(h('span', { class: 'lbl' }, 'Bagian terkait'), chips, add, h('p', { class: 'msg' }));
    return h('div', { class: 'grid3' }, box);
  }
}

function swap(arr, a, b) {
  [arr[a], arr[b]] = [arr[b], arr[a]];
}

export function revealHeart(ctx, path) {
  const p = ctx.doc.draft.parts[path[1]];
  if (!p) return false;
  ctx.ui.part = p.id;
  return true;
}
