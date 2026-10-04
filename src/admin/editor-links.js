// Drive folder links shown as channels on the portal.
import { h, focusSoon, $ } from './dom.js';
import { input, issueBadge } from './fields.js';
import { confirmDialog } from './ui.js';
import { slugify } from './format.js';

function uniqueId(base, taken) {
  let id = base || 'channel';
  for (let n = 2; taken.has(id); n++) id = `${base || 'channel'}-${n}`;
  return id;
}

function move(arr, i, j) {
  const [x] = arr.splice(i, 1);
  arr.splice(j, 0, x);
}

export function renderLinks(host, ctx) {
  const data = ctx.doc.draft;
  const saved = new Set((ctx.doc.base.data.channels || []).map((c) => c.id));
  const list = data.channels;

  const cards = list.map((c, i) => {
    const p = ['channels', i];
    const isNew = !saved.has(c.id);
    const head = h(
      'div',
      { class: 'card-head' },
      h('span', { class: 'num', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
      h('h3', { class: 'card-title' }, c.name || 'Channel baru'),
      issueBadge(ctx.doc.result, p),
      h('span', { class: 'mono id' }, c.id),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn ghost sm', disabled: i === 0, 'aria-label': `Naikkan ${c.name}`, onclick: () => reorder(i, i - 1) }, '↑'),
        h('button', { type: 'button', class: 'btn ghost sm', disabled: i === list.length - 1, 'aria-label': `Turunkan ${c.name}`, onclick: () => reorder(i, i + 1) }, '↓'),
        h('button', { type: 'button', class: 'btn ghost sm danger-text', onclick: () => remove(i) }, 'Hapus'),
      ),
    );

    const urlField =
      c.kind === 'tryout'
        ? h('p', { class: 'note wide' }, 'Channel ini membuka Try Out CBT di portal, jadi tidak pakai link.')
        : input({
            label: 'Link folder Drive',
            obj: c,
            prop: 'url',
            path: p.concat('url'),
            ctx,
            type: 'url',
            inputmode: 'url',
            max: 2048,
            wide: true,
            placeholder: 'https://drive.google.com/drive/folders/...',
            hint: 'Kosongkan kalau foldernya belum ada.',
            write: (s) => s.trim(),
          });

    return h(
      'li',
      { class: 'card', dataset: { id: c.id } },
      head,
      h(
        'div',
        { class: 'grid2' },
        input({
          label: 'Nama',
          obj: c,
          prop: 'name',
          path: p.concat('name'),
          ctx,
          max: 60,
          onCommit: () => {
            // New channels take their id from the first name they get.
            if (isNew && /^channel(-\d+)?$/.test(c.id)) {
              const taken = new Set(list.filter((x) => x !== c).map((x) => x.id));
              c.id = uniqueId(slugify(c.name), taken);
              ctx.changed();
              ctx.rerender();
            }
          },
        }),
        input({ label: 'Label kecil', obj: c, prop: 'tag', path: p.concat('tag'), ctx, max: 60, hint: 'Contoh: Arsip soal' }),
        input({ label: 'Deskripsi', obj: c, prop: 'sub', path: p.concat('sub'), ctx, type: 'textarea', rows: 2, max: 240, wide: true }),
        urlField,
        c.url && c.kind !== 'tryout'
          ? h('a', { class: 'link-test', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, 'Buka link ini di tab baru')
          : null,
      ),
    );
  });

  function reorder(i, j) {
    move(list, i, j);
    ctx.changed();
    ctx.rerender();
    focusSoon(() => $(`li[data-id="${CSS.escape(list[j].id)}"] .row-actions button:not([disabled])`, host));
  }

  async function remove(i) {
    const c = list[i];
    const ok = await confirmDialog({
      title: `Hapus channel ${c.name || c.id}?`,
      text: 'Channel ini hilang dari portal setelah kamu simpan. Sebelum simpan, masih bisa dibatalkan.',
      confirm: 'Hapus',
      danger: true,
    });
    if (!ok) return;
    list.splice(i, 1);
    ctx.changed();
    ctx.rerender();
  }

  function add() {
    const taken = new Set(list.map((x) => x.id));
    list.push({ id: uniqueId('channel', taken), name: '', tag: '', sub: '', url: '' });
    ctx.changed();
    ctx.rerender();
    focusSoon(() => $('.cards > li:last-child input', host));
  }

  host.append(
    h('p', { class: 'lede' }, 'Urutan di sini sama dengan urutan di portal. Link wajib https, dan sebaiknya folder drive.google.com.'),
    h('ol', { class: 'cards' }, cards),
    h('div', { class: 'add-row' }, h('button', { type: 'button', class: 'btn', onclick: add }, 'Tambah channel')),
  );
}
