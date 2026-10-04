// Announcements: plain text only. The body is never rendered as HTML, here or on the portal.
import { h, focusSoon, $ } from './dom.js';
import { input, select, checkbox, optional, issueBadge } from './fields.js';
import { confirmDialog } from './ui.js';
import { TAG_LABELS, fmtDay, todayWib } from './format.js';
import { ANNOUNCEMENT_TAGS } from '../lib/validate.js';

function newId(items) {
  const day = todayWib().replace(/-/g, '');
  let id;
  do id = `p-${day}-${Math.random().toString(36).slice(2, 6)}`;
  while (items.some((x) => x.id === id));
  return id;
}

export function renderAnnouncements(host, ctx) {
  const items = ctx.doc.draft.items;
  const open = ctx.ui.open || (ctx.ui.open = new Set());
  const today = todayWib();

  function summary(a) {
    const bits = [h('span', { class: `chip tag-${a.tag}` }, TAG_LABELS[a.tag] || a.tag)];
    if (a.pinned) bits.push(h('span', { class: 'chip' }, 'Disematkan'));
    if (a.until && a.until < today) bits.push(h('span', { class: 'chip muted' }, 'Sudah tersembunyi'));
    bits.push(h('span', { class: 'mono meta' }, fmtDay(a.date, { weekday: false })));
    return bits;
  }

  const cards = items.map((a, i) => {
    const p = ['items', i];
    const isOpen = open.has(a.id);
    const panelId = `ann-${a.id}`;
    const head = h(
      'div',
      { class: 'card-head' },
      h(
        'button',
        {
          type: 'button',
          class: 'disclose',
          'aria-expanded': isOpen ? 'true' : 'false',
          'aria-controls': panelId,
          onclick: () => {
            if (isOpen) open.delete(a.id);
            else open.add(a.id);
            ctx.rerender();
          },
        },
        h('span', { class: 'card-title' }, a.title || '(tanpa judul)'),
      ),
      issueBadge(ctx.doc.result, p),
      h('div', { class: 'chips' }, summary(a)),
    );
    const panel = isOpen
      ? h(
          'div',
          { class: 'grid2', id: panelId },
          input({ label: 'Judul', obj: a, prop: 'title', path: p.concat('title'), ctx, max: 120, wide: true }),
          input({
            label: 'Isi',
            obj: a,
            prop: 'body',
            path: p.concat('body'),
            ctx,
            type: 'textarea',
            rows: 5,
            max: 2000,
            wide: true,
            hint: 'Teks biasa. Enter untuk baris baru. Link ditaruh di kolom Link, bukan di sini.',
          }),
          select({
            label: 'Label',
            obj: a,
            prop: 'tag',
            path: p.concat('tag'),
            ctx,
            options: ANNOUNCEMENT_TAGS.map((t) => [t, TAG_LABELS[t]]),
            onCommit: () => ctx.rerender(),
          }),
          input({ label: 'Tanggal posting', obj: a, prop: 'date', path: p.concat('date'), ctx, type: 'date' }),
          input({
            label: 'Tenggat (opsional)',
            obj: a,
            prop: 'due',
            path: p.concat('due'),
            ctx,
            type: 'datetime-local',
            hint: 'Jam WIB. Wajar diisi untuk label Deadline.',
            write: optional,
          }),
          input({
            label: 'Sembunyikan setelah (opsional)',
            obj: a,
            prop: 'until',
            path: p.concat('until'),
            ctx,
            type: 'date',
            hint: 'Kosongkan kalau mau tampil terus.',
            write: optional,
          }),
          input({
            label: 'Link (opsional)',
            obj: a,
            prop: 'link',
            path: p.concat('link'),
            ctx,
            type: 'url',
            inputmode: 'url',
            max: 2048,
            wide: true,
            placeholder: 'https://',
            write: (s) => optional(s.trim()),
          }),
          checkbox({ label: 'Sematkan di paling atas', obj: a, prop: 'pinned', path: p.concat('pinned'), ctx, onCommit: () => ctx.rerender() }),
          h(
            'div',
            { class: 'card-foot wide' },
            h('button', { type: 'button', class: 'btn ghost sm danger-text', onclick: () => remove(i) }, 'Hapus pengumuman'),
          ),
        )
      : null;
    return h('li', { class: `card${isOpen ? ' open' : ''}`, dataset: { id: a.id } }, head, panel);
  });

  function add() {
    const a = { id: newId(items), title: '', body: '', tag: 'info', date: todayWib() };
    items.unshift(a);
    open.add(a.id);
    ctx.changed();
    ctx.rerender();
    focusSoon(() => $(`li[data-id="${CSS.escape(a.id)}"] input`, host));
  }

  async function remove(i) {
    const a = items[i];
    const ok = await confirmDialog({ title: 'Hapus pengumuman ini?', text: `"${a.title || 'Tanpa judul'}" hilang dari portal setelah kamu simpan.`, confirm: 'Hapus', danger: true });
    if (!ok) return;
    items.splice(i, 1);
    ctx.changed();
    ctx.rerender();
  }

  host.append(
    h(
      'div',
      { class: 'bar' },
      h('p', { class: 'lede' }, 'Yang disematkan tampil paling atas. Yang lewat tanggal sembunyinya otomatis hilang dari portal.'),
      h('button', { type: 'button', class: 'btn', onclick: add }, 'Tambah pengumuman'),
    ),
    items.length
      ? h('ol', { class: 'cards' }, cards)
      : h('div', { class: 'empty' }, h('p', null, 'Belum ada pengumuman.'), h('p', { class: 'hint' }, 'Yang kamu tambah di sini muncul di portal setelah disimpan.')),
  );
}

export function revealAnnouncement(ctx, path) {
  const a = ctx.doc.draft.items[path[1]];
  if (!a) return false;
  (ctx.ui.open || (ctx.ui.open = new Set())).add(a.id);
  return true;
}
