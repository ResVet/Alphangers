// Schedule: bloks, days, sessions, and the per-blok map of lecturer codes.
import { h, focusSoon, replace, $ } from './dom.js';
import { input, select, checkbox, optional, issueBadge } from './fields.js';
import { dosenPicker, nameWords } from './picker.js';
import { confirmDialog, toast } from './ui.js';
import { KIND_LABELS, fmtDay, addDays, todayWib } from './format.js';
import { SESSION_KINDS, toMinutes, isRealDate } from '../lib/validate.js';

const byStart = (a, b) => (toMinutes(a.s) || 0) - (toMinutes(b.s) || 0);

function addMinutes(hhmm, n) {
  const m = Math.min(23 * 60 + 59, (toMinutes(hhmm) || 0) + n);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function nextWeekday(iso) {
  let d = addDays(iso, 1);
  for (let i = 0; i < 3; i++) {
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    if (wd !== 0 && wd !== 6) break;
    d = addDays(d, 1);
  }
  return d;
}

// Codes come from initials: "Sadakata Sinulingga" -> SS, then SS2, SS3 if taken.
export function makeCode(person, codes) {
  const words = nameWords(person.name);
  let base = words.slice(0, 3).map((w) => w[0]).join('').toUpperCase() || 'D';
  if (base.length === 1 && words[0]) base = words[0].slice(0, 3).toUpperCase();
  base = base.replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'D';
  let code = base;
  for (let n = 2; code in codes; n++) code = `${base}${n}`;
  return code;
}

export function renderSchedule(host, ctx) {
  const data = ctx.doc.draft;
  const ui = ctx.ui;
  const people = () => (ctx.docs.dosen.draft && ctx.docs.dosen.draft.list) || [];
  const personById = (id) => people().find((p) => p.id === id);
  ui.open = ui.open || new WeakSet();
  if (ui.blok === undefined || ui.blok >= data.bloks.length) ui.blok = 0;

  const tabs = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Pilih blok' },
    data.bloks.map((b, i) =>
      h('button', { type: 'button', class: 'seg-b', 'aria-pressed': i === ui.blok ? 'true' : 'false', onclick: () => ((ui.blok = i), ctx.rerender()) }, b.name || b.id, issueBadge(ctx.doc.result, ['bloks', i])),
    ),
    h('button', { type: 'button', class: 'seg-b add', onclick: addBlok }, 'Blok baru'),
  );

  if (!data.bloks.length) {
    host.append(tabs, h('div', { class: 'empty' }, h('p', null, 'Belum ada blok. Tambah satu untuk mulai.')));
    return;
  }

  const bi = ui.blok;
  const blok = data.bloks[bi];
  const bp = ['bloks', bi];

  let codesEl = codesSection();
  host.append(
    h('div', { class: 'bar' }, tabs, h('label', { class: 'cls' }, 'Kelas ', classInput())),
    infoSection(),
    codesEl,
    h('h3', { class: 'sec-title' }, `Hari (${blok.days.length})`),
    blok.days.length ? h('div', { class: 'days' }, blok.days.map((d, di) => dayCard(d, di))) : h('div', { class: 'empty' }, h('p', null, 'Belum ada hari di blok ini.')),
    addDayRow(),
  );

  function classInput() {
    const el = h('input', { type: 'text', value: data.cls || '', maxLength: 40, class: 'sm', 'aria-label': 'Nama kelas' });
    el.addEventListener('input', () => ((data.cls = el.value), ctx.changed()));
    return el;
  }

  /* ---- blok info ---- */

  function infoSection() {
    const d = h('details', { class: 'panel', open: ui.infoOpen !== false }, h('summary', null, h('span', null, 'Info blok')));
    d.addEventListener('toggle', () => (ui.infoOpen = d.open));
    const ketua = personById(blok.ketua);
    d.append(
      h(
        'div',
        { class: 'grid3' },
        input({ label: 'Nama', obj: blok, prop: 'name', path: bp.concat('name'), ctx, max: 40, onCommit: () => ctx.rerender() }),
        input({ label: 'Judul', obj: blok, prop: 'title', path: bp.concat('title'), ctx, max: 160, wide: true }),
        input({ label: 'Lokasi', obj: blok, prop: 'loc', path: bp.concat('loc'), ctx, max: 120 }),
        input({ label: 'Mulai', obj: blok, prop: 'start', path: bp.concat('start'), ctx, type: 'date' }),
        input({ label: 'Selesai', obj: blok, prop: 'end', path: bp.concat('end'), ctx, type: 'date' }),
        h(
          'div',
          { class: 'fld', dataset: { path: bp.concat('ketua').join('.') } },
          h('span', { class: 'lbl' }, 'Ketua blok'),
          h('p', { class: 'value' }, ketua ? ketua.name : blok.ketua ? `${blok.ketua} (tidak ada di daftar dosen)` : 'Belum diisi'),
          h('p', { class: 'msg' }),
        ),
        dosenPicker({
          label: blok.ketua ? 'Ganti ketua blok' : 'Pilih ketua blok',
          people,
          onPick: (p) => {
            blok.ketua = p.id;
            ctx.changed();
            ctx.rerender();
          },
        }),
      ),
      h(
        'div',
        { class: 'row-actions left' },
        h('button', { type: 'button', class: 'btn ghost sm', disabled: !blok.days.length, onclick: fitDates }, 'Samakan tanggal dengan hari pertama dan terakhir'),
        h('button', { type: 'button', class: 'btn ghost sm danger-text', onclick: removeBlok }, 'Hapus blok ini'),
      ),
    );
    return d;
  }

  function fitDates() {
    blok.start = blok.days[0].d;
    blok.end = blok.days[blok.days.length - 1].d;
    ctx.changed();
    ctx.rerender();
  }

  function addBlok() {
    const n = data.bloks.length + 1;
    let id = `b${n}`;
    for (let k = n; data.bloks.some((b) => b.id === id); k++) id = `b${k + 1}`;
    const prev = data.bloks[data.bloks.length - 1];
    const start = prev && prev.end ? nextWeekday(prev.end) : todayWib();
    data.bloks.push({ id, name: `Blok ${n}`, title: '', loc: prev ? prev.loc : '', ketua: null, start, end: start, days: [], codes: {} });
    ui.blok = data.bloks.length - 1;
    ui.infoOpen = true;
    ctx.changed();
    ctx.rerender();
    focusSoon(() => $('details.panel input', host));
  }

  async function removeBlok() {
    const sessions = blok.days.reduce((n, d) => n + d.s.length, 0);
    const ok = await confirmDialog({
      title: `Hapus ${blok.name}?`,
      text: `${blok.days.length} hari dan ${sessions} sesi ikut terhapus. Masih bisa dibatalkan sebelum disimpan.`,
      confirm: 'Hapus blok',
      danger: true,
    });
    if (!ok) return;
    data.bloks.splice(bi, 1);
    ui.blok = Math.max(0, bi - 1);
    ctx.changed();
    ctx.rerender();
  }

  /* ---- lecturer codes ---- */

  function usage() {
    const count = {};
    for (const d of blok.days) for (const s of d.s) for (const c of s.dz) count[c] = (count[c] || 0) + 1;
    return count;
  }

  function codeFor(person) {
    for (const [c, id] of Object.entries(blok.codes)) if (id === person.id) return c;
    const c = makeCode(person, blok.codes);
    blok.codes[c] = person.id;
    toast(`Kode ${c} dibuat untuk ${person.name}.`);
    return c;
  }

  // Redraws only the code list, so an open session keeps its focus.
  function refreshCodes() {
    const fresh = codesSection();
    codesEl.replaceWith(fresh);
    codesEl = fresh;
  }

  function renameCode(oldCode, raw, field) {
    const code = raw.trim().toUpperCase();
    if (code === oldCode) return;
    if (!/^[A-Z0-9]{1,8}$/.test(code)) {
      toast('Kode cuma boleh huruf kapital dan angka, maksimal 8.', 'err');
      field.value = oldCode;
      return;
    }
    if (code in blok.codes) {
      toast(`Kode ${code} sudah dipakai.`, 'err');
      field.value = oldCode;
      return;
    }
    // Rebuild the map so the renamed code keeps its place.
    blok.codes = Object.fromEntries(Object.entries(blok.codes).map(([c, id]) => [c === oldCode ? code : c, id]));
    for (const d of blok.days) for (const s of d.s) s.dz = s.dz.map((c) => (c === oldCode ? code : c));
    ctx.changed();
    ctx.rerender();
  }

  function codesSection() {
    const count = usage();
    const entries = Object.entries(blok.codes);
    const d = h('details', { class: 'panel', open: ui.codesOpen === true }, h('summary', null, h('span', null, `Kode dosen (${entries.length})`), issueBadge(ctx.doc.result, bp.concat('codes'))));
    d.addEventListener('toggle', () => (ui.codesOpen = d.open));
    const rows = entries.map(([code, id]) => {
      const p = personById(id);
      const codeInput = h('input', { type: 'text', value: code, maxLength: 8, class: 'mono code-in', 'aria-label': `Kode untuk ${p ? p.name : id}` });
      codeInput.addEventListener('change', () => renameCode(code, codeInput.value, codeInput));
      const n = count[code] || 0;
      return h(
        'li',
        { class: 'code-row' },
        codeInput,
        h('span', { class: 'code-name' }, p ? p.name : h('span', { class: 'warn-text' }, `${id} (tidak ada di daftar dosen)`)),
        h('span', { class: 'mono meta' }, n ? `${n} sesi` : 'belum dipakai'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn ghost sm',
            disabled: n > 0,
            title: n ? 'Masih dipakai di sesi' : '',
            onclick: () => {
              delete blok.codes[code];
              ctx.changed();
              ctx.rerender();
            },
          },
          'Hapus',
        ),
      );
    });
    d.append(
      h('p', { class: 'hint' }, 'Kode muncul di sesi. Ganti kodenya di sini dan semua sesi ikut berubah.'),
      entries.length ? h('ul', { class: 'code-list' }, rows) : h('p', { class: 'empty' }, 'Belum ada kode.'),
      dosenPicker({
        label: 'Tambah kode dosen',
        people,
        describe: (p) => Object.keys(blok.codes).find((c) => blok.codes[c] === p.id) || '',
        onPick: (p) => {
          codeFor(p);
          ctx.changed();
          ctx.rerender();
        },
      }),
    );
    return d;
  }

  /* ---- days ---- */

  function dayCard(day, di) {
    const dp = bp.concat('days', di);
    const list = h('ul', { class: 'sessions' }, day.s.map((s, si) => sessionRow(day, di, s, si)));
    return h(
      'section',
      { class: 'day', dataset: { day: day.d } },
      h(
        'div',
        { class: 'day-head' },
        h('h4', null, fmtDay(day.d)),
        h('span', { class: 'mono meta' }, day.s.length ? `${day.s.length} sesi` : 'kosong'),
        issueBadge(ctx.doc.result, dp),
        h(
          'div',
          { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn ghost sm', onclick: () => addSession(day) }, 'Tambah sesi'),
          day.s.length && day.s.every((x) => x.batal)
            ? h('button', { type: 'button', class: 'btn ghost sm', onclick: () => cancelDay(day, false) }, 'Aktifkan semua')
            : day.s.length ? h('button', { type: 'button', class: 'btn ghost sm danger-text', onclick: () => cancelDay(day, true) }, 'Batalkan semua') : null,
          h('button', { type: 'button', class: 'btn ghost sm danger-text', onclick: () => removeDay(di) }, 'Hapus hari'),
        ),
      ),
      day.libur !== undefined || !day.s.length
        ? input({ label: 'Libur (opsional)', obj: day, prop: 'libur', path: dp.concat('libur'), ctx, max: 120, write: optional, hint: 'Isi nama hari liburnya kalau tidak ada kuliah.' })
        : null,
      list,
    );
  }

  function addDayRow() {
    const last = blok.days[blok.days.length - 1];
    const dateIn = h('input', { type: 'date', id: 'add-day', value: last ? nextWeekday(last.d) : blok.start || todayWib() });
    return h(
      'div',
      { class: 'add-row' },
      h('div', { class: 'fld' }, h('label', { htmlFor: 'add-day' }, 'Tanggal hari baru'), dateIn),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: () => {
            const d = dateIn.value;
            if (!isRealDate(d)) return toast('Pilih tanggal dulu.', 'err');
            if (blok.days.some((x) => x.d === d)) return toast(`${fmtDay(d)} sudah ada di blok ini.`, 'err');
            blok.days.push({ d, s: [] });
            blok.days.sort((a, b) => (a.d < b.d ? -1 : 1));
            if (!blok.start || d < blok.start) blok.start = d;
            if (!blok.end || d > blok.end) blok.end = d;
            ctx.changed();
            ctx.rerender();
            focusSoon(() => $(`section[data-day="${d}"] button`, host));
          },
        },
        'Tambah hari',
      ),
    );
  }

  // the whole day off (or back on), the same as "Batalkan semua hari ini" on the page
  function cancelDay(day, on) {
    for (const x of day.s) {
      if (on) x.batal = true;
      else { delete x.batal; delete x.alasan; }
    }
    ctx.changed();
    ctx.rerender();
    toast(on ? 'Semua sesi di hari ini ditandai dibatalkan.' : 'Semua sesi di hari ini aktif lagi.');
  }

  async function removeDay(di) {
    const day = blok.days[di];
    if (day.s.length) {
      const ok = await confirmDialog({ title: `Hapus ${fmtDay(day.d)}?`, text: `${day.s.length} sesi di hari ini ikut terhapus.`, confirm: 'Hapus hari', danger: true });
      if (!ok) return;
    }
    blok.days.splice(di, 1);
    ctx.changed();
    ctx.rerender();
  }

  /* ---- sessions ---- */

  // Tags for one session: tap a known one to toggle it, or type a new one. "Kelas gabungan"
  // (Alpha and Beta together) is always offered, and tags used elsewhere come back as choices.
  function knownTags() {
    const seen = new Map([['kelas gabungan', 'Kelas gabungan']]);
    for (const b of data.bloks) for (const d of b.days) for (const x of d.s) for (const t of x.label || []) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    return [...seen.values()];
  }
  function tagsEditor(s, sp, paintSummary) {
    const box = h('div', { class: 'chips edit' });
    const has = (t) => (s.label || []).some((x) => x.toLowerCase() === t.toLowerCase());
    const set = (tags) => { if (tags.length) s.label = tags; else delete s.label; ctx.changed(); paint(); paintSummary(); };
    const full = () => (s.label || []).length >= 4;
    const paint = () => {
      fresh.disabled = addB.disabled = full();
      replace(box, ...[...new Set([...knownTags(), ...(s.label || [])])].map((t) =>
      h('button', { type: 'button', class: 'chip toggle', 'aria-pressed': String(has(t)), disabled: full() && !has(t), onclick: () => {
        set(has(t) ? s.label.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...(s.label || []), t]);
      } }, t)));
    };
    const id = `tag-${sp.join('-')}`;
    const fresh = h('input', { id, type: 'text', maxLength: 30, placeholder: 'Tag baru, misal: Bawa jas lab', autocomplete: 'off' });
    const add = () => {
      const t = fresh.value.trim().replace(/\s+/g, ' ');
      if (!t) return;
      fresh.value = '';
      if (!has(t) && !full()) set([...(s.label || []), t]);
    };
    const addB = h('button', { type: 'button', class: 'btn ghost sm', onclick: add }, 'Tambah tag');
    fresh.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    paint();
    return h('div', { class: 'fld wide', dataset: { path: sp.concat('label').join('.') } },
      h('label', { htmlFor: id }, 'Tag'),
      box,
      h('div', { class: 'tag-add' }, fresh, addB),
      h('p', { class: 'hint' }, 'Ketuk untuk pasang atau lepas. Maksimal 4.'),
      h('p', { class: 'msg' }));
  }

  function addSession(day, copyOf) {
    const last = day.s[day.s.length - 1];
    const s = copyOf
      ? structuredClone(copyOf)
      : { s: last && last.e ? last.e : '08:00', e: addMinutes(last && last.e ? last.e : '08:00', 50), t: '', k: 'kuliah', dz: [] };
    day.s.push(s);
    day.s.sort(byStart);
    ui.open.add(s);
    ctx.changed();
    ctx.rerender();
    focusSoon(() => $('.sess.open input[type="text"]', host));
  }

  function dosenChips(s) {
    return s.dz.map((c) => {
      const p = personById(blok.codes[c]);
      return h('span', { class: 'chip code', title: p ? p.name : 'Kode tidak dikenal' }, c);
    });
  }

  function sessionRow(day, di, s, si) {
    const sp = bp.concat('days', di, 's', si);
    const isOpen = ui.open.has(s);
    const summary = h('div', { class: 'sess-sum' });
    const paintSummary = () =>
      replace(summary, 
        h('span', { class: 'mono time' }, `${s.s || '--:--'}${s.e ? '-' + s.e : ''}`),
        h('span', { class: 'sess-t' }, s.t || '(tanpa judul)'),
        h('span', { class: `chip kind-${s.k}` }, KIND_LABELS[s.k] || s.k),
        ...dosenChips(s),
        s.pj ? h('span', { class: 'chip muted' }, 'PJ') : null,
        s.tim ? h('span', { class: 'chip muted' }, 'Tim') : null,
        ...(s.label || []).map((t) => h('span', { class: 'chip muted' }, t)),
        s.online || s.tautan ? h('span', { class: 'chip kind-online' }, 'Online') : null,
        s.batal ? h('span', { class: 'chip kind-batal' }, 'Dibatalkan') : null,
      );
    paintSummary();

    const actions = h(
      'div',
      { class: 'row-actions' },
      h(
        'button',
        { type: 'button', class: 'btn ghost sm', 'aria-expanded': isOpen ? 'true' : 'false', onclick: () => toggle() },
        isOpen ? 'Tutup' : 'Edit',
      ),
      h('button', { type: 'button', class: 'btn ghost sm', onclick: () => addSession(day, s) }, 'Duplikat'),
      h('button', { type: 'button', class: 'btn ghost sm danger-text', 'aria-label': `Hapus sesi ${s.s} ${s.t}`, onclick: () => remove() }, 'Hapus'),
    );

    function toggle() {
      if (isOpen) {
        ui.open.delete(s);
        day.s.sort(byStart);
        ctx.changed();
      } else ui.open.add(s);
      ctx.rerender();
    }

    function remove() {
      day.s.splice(day.s.indexOf(s), 1);
      ctx.changed();
      ctx.rerender();
      toast('Sesi dihapus. Belum tersimpan, jadi masih bisa dibatalkan.');
    }

    const li = h('li', { class: `sess${isOpen ? ' open' : ''}` }, h('div', { class: 'sess-row' }, summary, issueBadge(ctx.doc.result, sp), actions));
    if (!isOpen) return li;

    const endOpen = h('input', { type: 'checkbox', id: `noend-${di}-${si}`, checked: s.e === null });
    const endField = input({ label: 'Selesai', obj: s, prop: 'e', path: sp.concat('e'), ctx, type: 'time', write: (v) => v || null, onInput: paintSummary });
    endField.querySelector('input').disabled = s.e === null;
    endOpen.addEventListener('change', () => {
      const field = endField.querySelector('input');
      field.disabled = endOpen.checked;
      s.e = endOpen.checked ? null : field.value || addMinutes(s.s, 50);
      field.value = s.e || '';
      ctx.changed();
      paintSummary();
    });

    const dz = h('div', { class: 'chips edit' });
    const paintDz = () =>
      replace(dz, 
        ...s.dz.map((c, j) => {
          const p = personById(blok.codes[c]);
          return h(
            'span',
            { class: 'chip code removable' },
            `${c} · ${p ? p.name : 'tidak dikenal'}`,
            h('button', {
              type: 'button',
              class: 'chip-x',
              'aria-label': `Lepas ${p ? p.name : c} dari sesi`,
              onclick: () => {
                s.dz.splice(j, 1);
                ctx.changed();
                paintDz();
                paintSummary();
              },
            }, '×'),
          );
        }),
        s.dz.length ? null : h('span', { class: 'hint' }, 'Belum ada dosen.'),
      );
    paintDz();

    li.append(
      h(
        'div',
        { class: 'grid3 sess-edit' },
        input({ label: 'Mulai', obj: s, prop: 's', path: sp.concat('s'), ctx, type: 'time', onInput: paintSummary }),
        endField,
        h('div', { class: 'fld check' }, endOpen, h('label', { htmlFor: endOpen.id }, 'Jam selesai belum pasti')),
        input({ label: 'Judul', obj: s, prop: 't', path: sp.concat('t'), ctx, max: 200, wide: true, onInput: paintSummary }),
        select({ label: 'Jenis', obj: s, prop: 'k', path: sp.concat('k'), ctx, options: SESSION_KINDS.map((k) => [k, KIND_LABELS[k]]), onCommit: paintSummary }),
        h('div', { class: 'fld wide', dataset: { path: sp.concat('dz').join('.') } }, h('span', { class: 'lbl' }, 'Dosen'), dz, h('p', { class: 'msg' })),
        dosenPicker({
          label: 'Tambah dosen ke sesi',
          people,
          describe: (p) => Object.keys(blok.codes).find((c) => blok.codes[c] === p.id) || 'kode baru',
          onPick: (p) => {
            const code = codeFor(p);
            if (!s.dz.includes(code)) s.dz.push(code);
            ctx.changed();
            paintDz();
            paintSummary();
            refreshCodes();
          },
        }),
        checkbox({ label: 'Dosen di atas adalah PJ', obj: s, prop: 'pj', path: sp.concat('pj'), ctx, onCommit: paintSummary }),
        checkbox({ label: 'Diampu tim dosen', obj: s, prop: 'tim', path: sp.concat('tim'), ctx, onCommit: paintSummary }),
        input({ label: 'Catatan (opsional)', obj: s, prop: 'n', path: sp.concat('n'), ctx, type: 'textarea', rows: 2, max: 300, wide: true, write: optional }),
        tagsEditor(s, sp, paintSummary),
        h('p', { class: 'sub-h wide' }, 'Online'),
        checkbox({ label: 'Sesi ini online (dari tempat masing-masing)', obj: s, prop: 'online', path: sp.concat('online'), ctx, onCommit: (c) => {
          // unticked: back to the classroom, so the meeting link goes too
          if (!c.checked) { delete s.tautan; ctx.changed(); ctx.rerender(); } else paintSummary();
        } }),
        input({ label: 'Link Zoom, Google Meet, dan sejenisnya (opsional)', obj: s, prop: 'tautan', path: sp.concat('tautan'), ctx, type: 'url', inputmode: 'url', max: 2048, wide: true, placeholder: 'https://zoom.us/j/...', hint: 'Muncul di jadwal sebagai tombol Gabung online. Link saja sudah menandai sesi online.', write: (v) => optional(v.trim()), onCommit: () => {
          if (s.tautan && !s.online) { s.online = true; ctx.changed(); ctx.rerender(); } else paintSummary();
        } }),
        h('p', { class: 'sub-h wide' }, 'Pembatalan'),
        checkbox({ label: 'Sesi ini dibatalkan', obj: s, prop: 'batal', path: sp.concat('batal'), ctx, onCommit: (c) => {
          if (!c.checked) { delete s.alasan; ctx.changed(); ctx.rerender(); } else paintSummary();
        } }),
        input({ label: 'Alasan pembatalan (tampil di jadwal, opsional)', obj: s, prop: 'alasan', path: sp.concat('alasan'), ctx, max: 200, wide: true, placeholder: 'Contoh: dosen dinas luar, diganti Kamis', write: optional }),
      ),
    );
    return li;
  }
}

// Opens whatever holds a path so its field is on screen.
export function revealSchedule(ctx, path) {
  if (path[0] !== 'bloks' || typeof path[1] !== 'number') return false;
  ctx.ui.blok = path[1];
  const blok = ctx.doc.draft.bloks[path[1]];
  if (path[2] === 'codes') ctx.ui.codesOpen = true;
  else if (path[2] !== 'days') ctx.ui.infoOpen = true;
  if (path[2] === 'days' && path[4] === 's' && typeof path[5] === 'number') {
    const s = blok && blok.days[path[3]] && blok.days[path[3]].s[path[5]];
    if (s) (ctx.ui.open || (ctx.ui.open = new WeakSet())).add(s);
  }
  return true;
}
