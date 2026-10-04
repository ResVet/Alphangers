// Saved versions for one key. Each entry is a version that got replaced
// (by a save or a reset), with who replaced it and when.
import { h, replace, append } from './dom.js';
import { validateJsonText } from '../lib/validate.js';
import { diff } from './diff.js';
import { renderChanges, summarize } from './diff-view.js';
import { fmtWhen, fmtRelative } from './format.js';
import { explain } from './errors.js';
import { toast } from './ui.js';

export function renderHistory(host, ctx) {
  const doc = ctx.doc;
  const box = h('div', { class: 'history', 'aria-busy': 'true' }, h('p', { class: 'meta' }, 'Memuat riwayat…'));
  host.append(
    h('p', { class: 'lede' }, 'Tiap kali kamu simpan atau kembalikan ke bawaan, versi sebelumnya disimpan di sini. Memulihkan versi lama tidak menghapus apa pun: hasilnya jadi draf, lalu kamu simpan seperti biasa.'),
    box,
  );

  ctx.backend
    .history(doc.key, 20)
    .then((entries) => paint(entries))
    .catch((e) => replace(box, h('p', { class: 'err-text' }, explain(e))))
    .finally(() => box.removeAttribute('aria-busy'));

  const who = (uid) => (uid === ctx.user.uid ? 'kamu' : `uid ${String(uid).slice(0, 8)}…`);
  const parse = (json) => {
    const r = validateJsonText(doc.key, json);
    return r.ok ? r.data : null;
  };

  function paint(entries) {
    if (!entries.length) {
      replace(box, h('div', { class: 'empty' }, h('p', null, 'Belum ada riwayat.'), h('p', { class: 'hint' }, 'Riwayat mulai terisi setelah simpan kedua, karena simpan pertama menggantikan versi bawaan.')));
      return;
    }
    // What replaced each entry: the next newer entry with rev + 1, or the current server copy.
    const newerOf = (e, idx) => {
      if (e.op === 'reset') return { label: 'versi bawaan', data: doc.bundled };
      for (let k = idx - 1; k >= 0; k--) if (entries[k].rev === e.rev + 1) return { label: `rev ${e.rev + 1}`, data: parse(entries[k].json) };
      if (doc.base.exists && doc.base.rev === e.rev + 1) return { label: `rev ${doc.base.rev} (sekarang)`, data: doc.base.data };
      return null;
    };

    replace(
      box,
      h(
        'ol',
        { class: 'hist-list' },
        entries.map((e, idx) => {
          const old = parse(e.json);
          const newer = newerOf(e, idx);
          const detail = h('div', { class: 'hist-detail', hidden: true });
          const changes = old && newer && newer.data ? diff(old, newer.data) : null;
          const toggle = h('button', { type: 'button', class: 'btn ghost sm', 'aria-expanded': 'false' }, 'Lihat perubahan');
          toggle.addEventListener('click', () => {
            const open = detail.hidden;
            detail.hidden = !open;
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open && !detail.firstChild) {
              append(detail, 
                changes
                  ? [h('p', { class: 'hint' }, `Dari rev ${e.rev} ke ${newer.label}:`), renderChanges(changes, 60)]
                  : h('p', { class: 'hint' }, old ? 'Versi berikutnya tidak ada di 20 riwayat terakhir, jadi tidak bisa dibandingkan.' : 'Isi versi ini tidak valid lagi untuk format sekarang.'),
              );
            }
          });
          return h(
            'li',
            { class: 'hist-item' },
            h(
              'div',
              { class: 'hist-head' },
              h('span', { class: `chip ${e.op === 'reset' ? 'muted' : ''}` }, e.op === 'reset' ? 'Kembali ke bawaan' : 'Disimpan'),
              h('span', { class: 'hist-when', title: e.at ? fmtWhen(e.at) : '' }, e.at ? fmtRelative(e.at) : 'baru saja'),
              h('span', { class: 'meta' }, `oleh ${who(e.by)}`),
              h('span', { class: 'mono meta' }, `rev ${e.rev} diganti`),
            ),
            e.note ? h('p', { class: 'hist-note' }, e.note) : null,
            changes ? h('p', { class: 'meta' }, summarize(changes) || 'Tidak ada beda isi.') : null,
            h(
              'div',
              { class: 'row-actions left' },
              toggle,
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn ghost sm',
                  disabled: !old,
                  onclick: () => {
                    doc.replaceDraft(structuredClone(old));
                    ctx.setMode('form');
                    toast(`Rev ${e.rev} dimuat ke draf. Cek lalu simpan kalau sudah pas.`);
                  },
                },
                `Pulihkan rev ${e.rev}`,
              ),
            ),
            detail,
          );
        }),
      ),
    );
  }
}
