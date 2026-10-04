// Save with review, conflict handling, reset, export and import.
import { h } from './dom.js';
import { diff } from './diff.js';
import { renderChanges, summarize } from './diff-view.js';
import { merge3 } from './merge.js';
import { ConflictError, explain } from './errors.js';
import { openDialog, confirmDialog, alertDialog, toast, download, pickJsonFile } from './ui.js';
import { validateJsonText, byteLength, MAX_JSON_BYTES } from '../lib/validate.js';
import { KEY_INFO, pathLabel, fmtBytes, fmtWhen } from './format.js';

function issueList(issues, data, max = 10) {
  return h(
    'ul',
    { class: 'issues err' },
    issues.slice(0, max).map((i) => h('li', null, h('span', { class: 'issue-path' }, pathLabel(data, i.path)), ' ', i.msg)),
    issues.length > max ? h('li', null, `dan ${issues.length - max} lainnya`) : null,
  );
}

const who = (ctx, uid) => (uid === ctx.user.uid ? 'kamu' : uid ? `uid ${uid.slice(0, 8)}…` : 'tidak diketahui');

export async function reviewAndSave(ctx) {
  const { doc } = ctx;
  if (ctx.ui.rawPending) {
    await alertDialog('JSON belum valid', 'Teks di mode JSON masih ada error, jadi belum masuk draf. Betulkan dulu atau pindah ke Form untuk membuangnya.');
    return false;
  }
  if (!doc.result.ok) {
    await alertDialog('Belum bisa disimpan', [h('p', null, `Ada ${doc.result.errors.length} error. Bereskan dulu:`), issueList(doc.result.errors, doc.draft)]);
    return false;
  }
  const clean = doc.result.data;
  const changes = diff(doc.base.data, clean);
  if (!changes.length) {
    toast(doc.base.exists ? 'Tidak ada perubahan untuk disimpan.' : 'Masih sama dengan versi bawaan, tidak ada yang perlu disimpan.');
    return false;
  }
  const json = JSON.stringify(clean);
  const bytes = byteLength(json);
  if (bytes > MAX_JSON_BYTES) {
    await alertDialog('Terlalu besar', `Datanya ${fmtBytes(bytes)}, batasnya ${fmtBytes(MAX_JSON_BYTES)}.`);
    return false;
  }

  const note = h('input', { type: 'text', id: 'save-note', maxLength: 200, placeholder: 'Contoh: link OSCE diganti', autocomplete: 'off' });
  const warnings = doc.result.warnings;
  const choice = await openDialog({
    title: 'Cek sebelum simpan',
    wide: true,
    body: [
      h('p', { class: 'dlg-sum' }, `${KEY_INFO[doc.key].title}: ${summarize(changes)}. ${doc.base.exists ? `Rev ${doc.base.rev} jadi rev ${doc.base.rev + 1}.` : 'Ini simpan pertama, menggantikan versi bawaan.'}`),
      warnings.length
        ? h('details', { class: 'warn-box' }, h('summary', null, `${warnings.length} peringatan (boleh tetap simpan)`), h('ul', { class: 'issues warn' }, warnings.slice(0, 20).map((w) => h('li', null, h('span', { class: 'issue-path' }, pathLabel(clean, w.path)), ' ', w.msg))))
        : null,
      renderChanges(changes),
      h('div', { class: 'fld' }, h('label', { htmlFor: 'save-note' }, 'Catatan (opsional, masuk riwayat)'), note),
      h('p', { class: 'hint' }, `Ukuran ${fmtBytes(bytes)} dari batas ${fmtBytes(MAX_JSON_BYTES)}.`),
    ],
    actions: [
      { label: 'Kembali', value: null, kind: 'ghost' },
      { label: 'Simpan sekarang', value: 'save', kind: 'primary', autofocus: true },
    ],
    onOpen: (dlg, finish) => note.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), finish('save'))),
  });
  if (choice !== 'save') return false;

  ctx.setBusy(true);
  try {
    const res = await ctx.backend.save(doc.key, { json, baseRev: doc.base.rev, note: note.value.trim() });
    doc.setBase({ exists: true, rev: res.rev, json, updatedAt: new Date(), updatedBy: ctx.user.uid });
    toast(`Tersimpan sebagai rev ${res.rev}. Pengunjung dapat versi baru saat membuka atau memuat ulang portal.`);
    ctx.rerender();
    return true;
  } catch (e) {
    if (e instanceof ConflictError) return handleConflict(ctx, e.remote, clean);
    await alertDialog('Gagal menyimpan', [h('p', null, explain(e)), h('p', { class: 'hint' }, 'Draf kamu masih aman di perangkat ini.')]);
    return false;
  } finally {
    ctx.setBusy(false);
  }
}

async function handleConflict(ctx, remote, mine) {
  const { doc } = ctx;
  const theirsRes = remote.exists ? validateJsonText(doc.key, remote.json) : { ok: true, data: doc.bundled };
  const theirs = theirsRes.ok ? theirsRes.data : null;
  const serverChanges = theirs ? diff(doc.base.data, theirs) : [];
  const whenText = remote.updatedAt ? `${fmtWhen(remote.updatedAt)} oleh ${who(ctx, remote.updatedBy)}` : '';

  const choice = await openDialog({
    title: 'Ada versi yang lebih baru',
    wide: true,
    body: [
      h('p', null, `Sejak kamu buka, data ini sudah diubah dari tab atau perangkat lain. Kamu mulai dari rev ${doc.base.rev}, di server sekarang ${remote.exists ? `rev ${remote.rev}` : 'versi bawaan'}${whenText ? `, ${whenText}` : ''}. Perubahanmu belum disimpan.`),
      theirs
        ? [h('h3', { class: 'sub-title' }, 'Yang berubah di server'), renderChanges(serverChanges, 40)]
        : h('p', { class: 'err-text' }, 'Versi di server tidak valid, jadi tidak bisa digabung.'),
      h('ul', { class: 'plain choices' },
        h('li', null, h('b', null, 'Gabungkan: '), 'ambil perubahan dari server, lalu pasang perubahanmu di atasnya. Kamu cek lagi sebelum simpan.'),
        h('li', null, h('b', null, 'Timpa: '), 'simpan punyamu apa adanya. Perubahan di server hilang (tetap ada di Riwayat).'),
        h('li', null, h('b', null, 'Pakai versi server: '), 'buang perubahanmu.'),
      ),
    ],
    actions: [
      { label: 'Pakai versi server', value: 'theirs', kind: 'ghost' },
      { label: 'Timpa', value: 'mine', kind: 'ghost' },
      theirs ? { label: 'Gabungkan', value: 'merge', kind: 'primary', autofocus: true } : null,
    ].filter(Boolean),
  });

  if (choice === 'merge') {
    const { data, conflicts } = merge3(doc.key, doc.base.data, mine, theirs);
    doc.setBase(remote);
    doc.replaceDraft(data);
    ctx.rerender();
    if (conflicts.length) {
      await alertDialog('Ada yang bentrok', [
        h('p', null, 'Bagian ini diubah di dua tempat. Pilihan di bawah sudah dipakai, cek di daftar perubahan:'),
        h('ul', { class: 'plain' }, conflicts.map((c) => h('li', null, h('b', null, c.label), ': ', c.why))),
      ]);
    }
    return reviewAndSave(ctx);
  }
  if (choice === 'mine') {
    doc.setBase(remote);
    doc.replaceDraft(structuredClone(mine));
    ctx.rerender();
    return reviewAndSave(ctx);
  }
  if (choice === 'theirs') {
    doc.setBase(remote);
    ctx.rerender();
    toast('Perubahanmu dibuang. Sekarang pakai versi dari server.');
  }
  return false;
}

export async function resetToBundled(ctx) {
  const { doc } = ctx;
  if (!doc.base.exists) {
    toast(doc.dirty ? 'Server sudah pakai versi bawaan. Pakai "Batalkan perubahan" untuk membuang draf.' : 'Sudah pakai versi bawaan.');
    return;
  }
  const ok = await confirmDialog({
    title: 'Kembalikan ke versi bawaan?',
    text: [
      'Dokumen ini dihapus dari Firestore, jadi portal kembali memakai file JSON dari repo.',
      `Versi sekarang (rev ${doc.base.rev}) tetap ada di Riwayat dan bisa dipulihkan.`,
      doc.dirty ? 'Perubahan yang belum disimpan ikut dibuang.' : null,
    ].filter(Boolean),
    confirm: 'Kembalikan',
    danger: true,
  });
  if (!ok) return;
  let baseRev = doc.base.rev;
  ctx.setBusy(true);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await ctx.backend.reset(doc.key, { baseRev, note: 'Kembali ke versi bawaan' });
        doc.setBase({ exists: false, rev: 0, json: null, updatedAt: null, updatedBy: null });
        ctx.rerender();
        toast('Sudah kembali ke versi bawaan.');
        return;
      } catch (e) {
        if (!(e instanceof ConflictError) || attempt > 0) throw e;
        if (!e.remote.exists) {
          doc.setBase(e.remote);
          ctx.rerender();
          toast('Sudah pakai versi bawaan (diubah dari tempat lain).');
          return;
        }
        const again = await confirmDialog({
          title: 'Ada versi yang lebih baru',
          text: `Server sekarang di rev ${e.remote.rev}. Tetap kembalikan ke bawaan? Rev ${e.remote.rev} tetap masuk Riwayat.`,
          confirm: 'Tetap kembalikan',
          danger: true,
        });
        if (!again) return;
        baseRev = e.remote.rev;
      }
    }
  } catch (e) {
    await alertDialog('Gagal', explain(e));
  } finally {
    ctx.setBusy(false);
  }
}

export function exportJson(ctx) {
  const { doc } = ctx;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  download(`alphangers-${doc.key}-${stamp}.json`, JSON.stringify(doc.draft, null, 2) + '\n');
  toast(doc.dirty ? 'Draf (termasuk yang belum disimpan) diekspor.' : 'Data diekspor.');
}

export async function importJson(ctx) {
  const { doc } = ctx;
  const file = await pickJsonFile();
  if (!file) return;
  if (file.error) return alertDialog('File tidak bisa dipakai', file.error);
  const res = validateJsonText(doc.key, file.text);
  if (!res.ok) {
    let parsed = null;
    try {
      parsed = JSON.parse(file.text);
    } catch {
      /* syntax error already reported */
    }
    return alertDialog('File tidak bisa dipakai', [h('p', null, `${file.name} bukan data ${KEY_INFO[doc.key].title} yang valid.`), issueList(res.errors, parsed || {})]);
  }
  if (doc.dirty && !(await confirmDialog({ title: 'Ganti draf dengan isi file?', text: 'Perubahan yang belum disimpan diganti isi file ini.', confirm: 'Ganti' }))) return;
  doc.replaceDraft(res.data);
  ctx.setMode('form');
  toast(`${file.name} dimuat ke draf. Cek perubahannya, lalu simpan.${res.warnings.length ? ` Ada ${res.warnings.length} peringatan.` : ''}`);
}
