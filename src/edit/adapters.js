// What can be edited on the page, and how. Each adapter names the elements it handles
// (selector), a short label for the action bar, the actions for one element, and the tools shown
// at the top of its section while edit mode is on. Every change goes through ctx.store.edit(),
// which validates the whole document before keeping anything.
import { openForm, confirmDialog, alertDialog, h } from './sheet.js';
import { uploadPhoto, pickFiles } from './media.js';
import { SESSION_KINDS, ANNOUNCEMENT_TAGS, HEART_IDS } from '../lib/validate.js';
import { KIND_LABELS, TAG_LABELS, slugify, todayWib } from '../admin/format.js';
import { pictureHTML } from '../lib/photo.js';

const kindOptions = SESSION_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] || k }));
const tagOptions = ANNOUNCEMENT_TAGS.map((t) => ({ value: t, label: TAG_LABELS[t] || t }));
const TITLE_WORDS = new Set(['prof', 'dr', 'drs', 'dra', 'drg', 'apt', 'ir', 'h', 'hj', 'm', 'mm']);

function uniqueId(base, taken) {
  let id = base || 'baru';
  for (let n = 2; taken.has(id); n++) id = (base || 'baru') + '-' + n;
  return id;
}

// "dr. Rara Inggarsih, M.Kes" -> "RI"; made unique within the blok by adding letters, then digits
function codeFor(name, taken) {
  const words = String(name).split(',')[0].split(/\s+/).map((w) => w.replace(/[^A-Za-z]/g, '')).filter((w) => w && !TITLE_WORDS.has(w.toLowerCase()));
  let base = words.map((w) => w[0]).join('').toUpperCase().slice(0, 3) || 'DS';
  if (base.length < 2) base = (words[0] || 'DSN').slice(0, 3).toUpperCase();
  let code = base;
  const extra = (words[words.length - 1] || 'X').toUpperCase().slice(1);
  for (let i = 0; taken.has(code) && i < extra.length && code.length < 6; i++) code = base + extra.slice(0, i + 1);
  for (let n = 2; taken.has(code); n++) code = base.slice(0, 5) + n;
  return code;
}

function parseRef(ref) {
  const [blokId, date, i] = String(ref || '').split('|');
  return { blokId, date, index: +i };
}

function dayOf(blok, date, create) {
  let day = blok.days.find((d) => d.d === date);
  if (!day && create) { day = { d: date, s: [] }; blok.days.push(day); }
  return day;
}

function blokForDate(schedule, date) {
  return schedule.bloks.find((b) => date >= b.start && date <= b.end) || null;
}

// ======================================================================
// jadwal

function sessionFields(ctx, { withDate = true } = {}) {
  return [
    { name: 't', label: 'Materi', required: true, max: 200, wide: true, placeholder: 'Contoh: Tutorial 2 Skenario B' },
    { name: 'k', label: 'Jenis', type: 'select', options: kindOptions, half: true },
    withDate ? { name: 'date', label: 'Tanggal', type: 'date', required: true, half: true } : null,
    { name: 's', label: 'Mulai', type: 'time', required: true, half: true },
    { name: 'e', label: 'Selesai', type: 'time', half: true, hint: 'Kosongkan kalau sampai selesai.' },
    { name: 'dz', label: 'Dosen', type: 'people', people: ctx.store.get('dosen').list, wide: true, empty: 'Belum ada dosen. Cari lalu pilih.' },
    { name: 'pj', label: 'Dosen ini penanggung jawab (PJ)', type: 'checkbox' },
    { name: 'tim', label: 'Diajar tim dosen per kelompok', type: 'checkbox' },
    { name: 'n', label: 'Catatan', type: 'textarea', max: 300, rows: 2, wide: true, placeholder: 'Ruangan, bawaan, link Zoom' },
    { type: 'section', label: 'Pembatalan' },
    { name: 'batal', label: 'Sesi ini dibatalkan', type: 'checkbox' },
    { name: 'alasan', label: 'Alasan (tampil di jadwal)', max: 200, wide: true, placeholder: 'Contoh: dosen dinas luar, diganti Kamis' },
  ].filter(Boolean);
}

/** Writes a session (new or moved) into the drafts, keeping lecturer codes and both documents in step. */
function putSession(ctx, values, from) {
  const people = values.dz || [];
  const sch0 = ctx.store.get('schedule');
  const target = blokForDate(sch0, values.date);
  if (!target) throw new UserError('Tanggal ' + values.date + ' di luar masa blok mana pun. Ubah atau tambah blok dulu.');
  // decide every lecturer's code in the target blok first, so both documents agree on it
  const byDosen = new Map(Object.entries(target.codes).map(([c, id]) => [id, c]));
  const taken = new Set(Object.keys(target.codes));
  const plan = new Map();
  for (const id of people) {
    let code = byDosen.get(id);
    if (!code) {
      const p = ctx.store.get('dosen').list.find((x) => x.id === id);
      code = codeFor(p?.name || id, taken);
      taken.add(code);
    }
    plan.set(id, code);
  }
  return ctx.store.edit({
    schedule: (sch) => {
      const blok = sch.bloks.find((b) => b.id === target.id);
      let keepCodes = [];
      if (from) {
        const old = sch.bloks.find((b) => b.id === from.blokId);
        const oday = old && dayOf(old, from.date);
        const prev = oday?.s[from.index];
        if (prev) {
          // codes for lecturers missing from the lecturer list cannot be picked in the form;
          // they stay on the session as they were
          const known = new Set(ctx.store.get('dosen').list.map((x) => x.id));
          if (old.id === blok.id) keepCodes = (prev.dz || []).filter((c) => !known.has(old.codes[c]));
          oday.s.splice(from.index, 1);
        }
      }
      for (const [id, code] of plan) blok.codes[code] = id;
      const s = { s: values.s, e: values.e || null, t: values.t, k: values.k, dz: [...plan.values(), ...keepCodes] };
      if (values.pj) s.pj = true;
      if (values.tim) s.tim = true;
      if (values.n) s.n = values.n;
      if (values.batal) { s.batal = true; if (values.alasan) s.alasan = values.alasan; }
      dayOf(blok, values.date, true).s.push(s);
    },
    dosen: (dos) => {
      // a lecturer given a code in a blok is listed as teaching in it
      for (const [id, code] of plan) {
        const p = dos.list.find((x) => x.id === id);
        if (!p) continue;
        if (!p.bloks.includes(target.id)) p.bloks.push(target.id);
        if (!p.codes[target.id]) p.codes[target.id] = code;
      }
    },
  }, from ? 'Ubah sesi' : 'Tambah sesi');
}

class UserError extends Error {}

function safeEdit(ctx, fn) {
  try {
    const res = fn();
    if (res && !res.ok && !res.cancelled) return { errors: res.errors || ['Belum bisa disimpan.'] };
    if (res?.ok) ctx.toast('Tersimpan di draf. Terbitkan kalau sudah selesai.');
    return null;
  } catch (e) {
    if (e instanceof UserError) return { errors: [e.message] };
    throw e;
  }
}

function sessionValue(ctx, ref) {
  const sch = ctx.store.get('schedule');
  const blok = sch.bloks.find((b) => b.id === ref.blokId);
  const s = blok && dayOf(blok, ref.date)?.s[ref.index];
  if (!s) return null;
  return {
    blok,
    s,
    value: {
      t: s.t, k: s.k, date: ref.date, s: s.s, e: s.e || '', n: s.n || '', pj: !!s.pj, tim: !!s.tim, batal: !!s.batal, alasan: s.alasan || '',
      dz: (s.dz || []).map((c) => blok.codes[c]).filter(Boolean),
    },
  };
}

async function editSession(ctx, ref) {
  const cur = sessionValue(ctx, ref);
  if (!cur) return;
  await openForm({
    title: 'Ubah sesi',
    sub: cur.blok.name + ', ' + ref.date,
    fields: sessionFields(ctx),
    value: cur.value,
    onSubmit: (v) => safeEdit(ctx, () => putSession(ctx, v, ref)),
  });
}

async function addSession(ctx, date) {
  const sch = ctx.store.get('schedule');
  const blok = blokForDate(sch, date);
  const day = blok && dayOf(blok, date);
  const last = day?.s[day.s.length - 1];
  await openForm({
    title: 'Tambah sesi',
    sub: blok ? blok.name + ', ' + date : 'Tanggal ini di luar masa blok',
    fields: sessionFields(ctx),
    value: { date, k: 'kuliah', s: last?.e || '08:00', e: '', dz: [] },
    submit: 'Tambah',
    onSubmit: (v) => safeEdit(ctx, () => putSession(ctx, v, null)),
  });
}

function editDay(ctx, date, fn, label) {
  return safeEdit(ctx, () => ctx.store.edit('schedule', (sch) => {
    const blok = blokForDate(sch, date);
    if (!blok) throw new UserError('Tanggal ini di luar masa blok.');
    return fn(dayOf(blok, date, true), blok);
  }, label));
}

async function cancelSession(ctx, ref, on) {
  let why = '';
  if (on) {
    const v = await openForm({ title: 'Batalkan sesi', fields: [{ name: 'alasan', label: 'Alasan (boleh kosong)', max: 200, wide: true, placeholder: 'Contoh: dosen berhalangan' }], value: {}, submit: 'Batalkan sesi' });
    if (!v) return;
    why = v.alasan.trim();
  }
  const r = editDay(ctx, ref.date, (day) => {
    const s = day.s[ref.index];
    if (!s) return false;
    if (on) { s.batal = true; if (why) s.alasan = why; else delete s.alasan; } else { delete s.batal; delete s.alasan; }
  }, on ? 'Batalkan sesi' : 'Aktifkan sesi');
  if (r?.errors) alertDialog('Belum bisa', r.errors);
}

async function blokForm(ctx, blok) {
  const sch = ctx.store.get('schedule');
  const v = await openForm({
    title: blok ? 'Ubah ' + blok.name : 'Tambah blok',
    fields: [
      { name: 'name', label: 'Nama', required: true, max: 40, half: true, placeholder: 'Blok 4' },
      { name: 'loc', label: 'Tempat', max: 120, half: true },
      { name: 'title', label: 'Judul blok', max: 160, wide: true },
      { name: 'start', label: 'Mulai', type: 'date', required: true, half: true },
      { name: 'end', label: 'Selesai', type: 'date', required: true, half: true },
      { name: 'ketua', label: 'Ketua blok', type: 'people', people: ctx.store.get('dosen').list, wide: true, empty: 'Belum dipilih.' },
    ],
    value: blok ? { ...blok, ketua: blok.ketua ? [blok.ketua] : [] } : { loc: sch.bloks[sch.bloks.length - 1]?.loc || '', ketua: [] },
    submit: blok ? 'Simpan' : 'Tambah',
    onSubmit: (x) => safeEdit(ctx, () => ctx.store.edit('schedule', (d) => {
      let b = blok && d.bloks.find((y) => y.id === blok.id);
      if (!b) {
        b = { id: uniqueId(slugify(x.name), new Set(d.bloks.map((y) => y.id))), days: [], codes: {} };
        d.bloks.push(b);
      }
      Object.assign(b, { name: x.name, title: x.title, loc: x.loc, start: x.start, end: x.end, ketua: x.ketua[0] || null });
    }, blok ? 'Ubah blok' : 'Tambah blok')),
  });
  return v;
}

const jadwal = {
  kind: 'session',
  selector: '.jw-s[data-ref]',
  label: (el) => 'Sesi ' + (el.querySelector('.jw-s-from')?.textContent || ''),
  actions(el, ctx) {
    const ref = parseRef(el.dataset.ref);
    const cur = sessionValue(ctx, ref);
    if (!cur) return [];
    return [
      { label: 'Ubah', primary: true, run: () => editSession(ctx, ref) },
      cur.s.batal ? { label: 'Aktifkan lagi', run: () => cancelSession(ctx, ref, false) } : { label: 'Batalkan', run: () => cancelSession(ctx, ref, true) },
      { label: 'Duplikat', run: () => { const r = safeEdit(ctx, () => putSession(ctx, { ...cur.value, s: cur.value.e || cur.value.s, e: '' }, null)); if (r?.errors) alertDialog('Belum bisa', r.errors); } },
      { label: 'Hapus', danger: true, run: async () => {
        if (!(await confirmDialog('Hapus sesi ini?', cur.s.t, { ok: 'Hapus', danger: true }))) return;
        editDay(ctx, ref.date, (day) => { day.s.splice(ref.index, 1); }, 'Hapus sesi');
      } },
    ];
  },
  section: '#jadwal',
  sectionLabel: 'Jadwal',
  tools(ctx) {
    const date = () => ctx.views.jadwal?.current().date || todayWib();
    return [
      { label: '+ Sesi', primary: true, run: () => addSession(ctx, date()) },
      { label: 'Batalkan semua hari ini', run: async () => {
        const d = date();
        const v = await openForm({ title: 'Batalkan semua sesi', sub: d, fields: [{ name: 'alasan', label: 'Alasan (boleh kosong)', max: 200, wide: true }], value: {}, submit: 'Batalkan semua' });
        if (!v) return;
        const r = editDay(ctx, d, (day) => {
          if (!day.s.length) throw new UserError('Tidak ada sesi di tanggal ini.');
          day.s.forEach((s) => { s.batal = true; if (v.alasan.trim()) s.alasan = v.alasan.trim(); });
        }, 'Batalkan satu hari');
        if (r?.errors) alertDialog('Belum bisa', r.errors);
      } },
      { label: 'Aktifkan semua', run: () => { const r = editDay(ctx, date(), (day) => day.s.forEach((s) => { delete s.batal; delete s.alasan; }), 'Aktifkan satu hari'); if (r?.errors) alertDialog('Belum bisa', r.errors); } },
      { label: 'Libur', run: async () => {
        const d = date();
        const sch = ctx.store.get('schedule');
        const blok = blokForDate(sch, d);
        const cur = blok && dayOf(blok, d);
        await openForm({ title: 'Tandai libur', sub: d, fields: [{ name: 'libur', label: 'Keterangan libur', max: 120, wide: true, hint: 'Kosongkan untuk menghapus tanda libur.' }], value: { libur: cur?.libur || '' },
          onSubmit: (v) => editDay(ctx, d, (day) => { if (v.libur.trim()) day.libur = v.libur.trim(); else delete day.libur; }, 'Tanda libur') });
      } },
      { label: 'Ubah blok', run: () => { const b = blokForDate(ctx.store.get('schedule'), date()); if (b) blokForm(ctx, b); else alertDialog('Di luar masa blok', 'Tanggal yang tampil tidak masuk blok mana pun. Pakai "+ Blok".'); } },
      { label: '+ Blok', run: () => blokForm(ctx, null) },
    ];
  },
};

const blokPill = {
  kind: 'blok',
  selector: '.jw-pill[data-blok]',
  label: (el) => el.textContent,
  actions(el, ctx) {
    const b = ctx.store.get('schedule').bloks.find((x) => x.id === el.dataset.blok);
    if (!b) return [];
    return [
      { label: 'Ubah blok', primary: true, run: () => blokForm(ctx, b) },
      { label: 'Hapus blok', danger: true, run: async () => {
        const n = b.days.reduce((s, d) => s + d.s.length, 0);
        if (!(await confirmDialog('Hapus ' + b.name + '?', 'Semua ' + n + ' sesinya ikut terhapus. Masih bisa dibatalkan pakai Undo sebelum diterbitkan.', { ok: 'Hapus blok', danger: true }))) return;
        ctx.store.edit('schedule', (d) => { d.bloks = d.bloks.filter((x) => x.id !== b.id); }, 'Hapus blok');
      } },
    ];
  },
};

// ======================================================================
// dosen

function dosenFields(ctx) {
  const sch = ctx.store.get('schedule');
  return [
    { name: 'name', label: 'Nama lengkap dengan gelar', required: true, max: 120, wide: true },
    { name: 'spec', label: 'Spesialis / bidang', max: 60, wide: true, hint: 'Contoh: Penyakit Dalam, Anak, Dokter, Dosen' },
    { name: 'phones', label: 'Nomor telepon (tampil publik)', type: 'list', inputmode: 'tel', placeholder: '0812...', addLabel: 'Nomor', max: 30, wide: true },
    { name: 'bloks', label: 'Ngajar di', type: 'chips', options: sch.bloks.map((b) => ({ value: b.id, label: b.name })), wide: true },
  ];
}

async function dosenForm(ctx, id) {
  const list = ctx.store.get('dosen').list;
  const p = id ? list.find((x) => x.id === id) : null;
  await openForm({
    title: p ? 'Ubah dosen' : 'Tambah dosen',
    fields: dosenFields(ctx),
    value: p ? { name: p.name, spec: p.spec, phones: p.phones.map((x) => x.f || x.n), bloks: p.bloks } : { phones: [], bloks: [] },
    submit: p ? 'Simpan' : 'Tambah',
    onSubmit: (v) => safeEdit(ctx, () => ctx.store.edit('dosen', (d) => {
      let x = p && d.list.find((y) => y.id === p.id);
      if (!x) {
        x = { id: uniqueId(slugify(v.name.replace(/^(prof|dr|drs|dra|drg)\.?\s+/gi, '')), new Set(d.list.map((y) => y.id))), codes: {} };
        d.list.push(x);
      }
      x.name = v.name;
      x.spec = v.spec;
      x.phones = v.phones.map((n) => ({ n }));
      x.bloks = v.bloks;
    }, p ? 'Ubah dosen' : 'Tambah dosen')),
  });
}

const dosen = {
  kind: 'dosen',
  selector: '.dz-row[data-id]',
  label: (el) => el.querySelector('.dz-name')?.textContent || 'Dosen',
  actions(el, ctx) {
    const id = el.dataset.id;
    return [
      { label: 'Ubah', primary: true, run: () => dosenForm(ctx, id) },
      { label: 'Hapus', danger: true, run: async () => {
        const sch = ctx.store.get('schedule');
        const uses = sch.bloks.flatMap((b) => Object.entries(b.codes).filter(([, d]) => d === id).map(([c]) => [b, c]));
        const sessions = uses.reduce((n, [b, c]) => n + b.days.reduce((m, d) => m + d.s.filter((s) => s.dz.includes(c)).length, 0), 0);
        const ok = await confirmDialog('Hapus dosen ini?', sessions ? 'Dipakai di ' + sessions + ' sesi. Namanya ikut dilepas dari sesi-sesi itu.' : null, { ok: 'Hapus', danger: true });
        if (!ok) return;
        ctx.store.edit({
          dosen: (d) => { d.list = d.list.filter((x) => x.id !== id); },
          schedule: (s) => {
            for (const b of s.bloks) {
              for (const [c, d] of Object.entries(b.codes)) {
                if (d !== id) continue;
                delete b.codes[c];
                for (const day of b.days) for (const x of day.s) x.dz = x.dz.filter((z) => z !== c);
              }
              if (b.ketua === id) b.ketua = null;
            }
          },
        }, 'Hapus dosen');
      } },
    ];
  },
  section: '#dosen',
  sectionLabel: 'Dosen',
  tools: (ctx) => [{ label: '+ Dosen', primary: true, run: () => dosenForm(ctx, null) }],
};

// ======================================================================
// channels (Drive)

async function channelForm(ctx, id) {
  const links = ctx.store.get('links');
  const c = id ? links.channels.find((x) => x.id === id) : null;
  await openForm({
    title: c ? 'Ubah channel' : 'Tambah channel',
    fields: [
      { name: 'name', label: 'Nama', required: true, max: 60, half: true },
      { name: 'tag', label: 'Label kecil', max: 60, half: true },
      { name: 'sub', label: 'Keterangan', type: 'textarea', rows: 2, max: 240, wide: true },
      c?.kind === 'tryout' ? { type: 'note', text: 'Channel ini membuka Try Out CBT, jadi tidak pakai link.' } : { name: 'url', label: 'Link folder Drive', type: 'url', wide: true, placeholder: 'https://drive.google.com/drive/folders/...' },
    ],
    value: c ? { ...c, url: c.url || '' } : { url: '' },
    submit: c ? 'Simpan' : 'Tambah',
    onSubmit: (v) => safeEdit(ctx, () => ctx.store.edit('links', (d) => {
      let x = c && d.channels.find((y) => y.id === c.id);
      if (!x) { x = { id: uniqueId(slugify(v.name), new Set(d.channels.map((y) => y.id))) }; d.channels.push(x); }
      x.name = v.name; x.tag = v.tag; x.sub = v.sub;
      if (x.kind !== 'tryout') x.url = v.url.trim();
    }, c ? 'Ubah channel' : 'Tambah channel')),
  });
}

function moveIn(ctx, key, listOf, id, by, label) {
  ctx.store.edit(key, (d) => {
    const arr = listOf(d);
    const i = arr.findIndex((x) => x.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= arr.length) return false;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }, label);
}

const channel = {
  kind: 'channel',
  selector: '#rows .row-b[data-id]',
  label: (el) => el.querySelector('.row-n')?.childNodes[0]?.textContent || 'Channel',
  actions(el, ctx) {
    const id = el.dataset.id;
    return [
      { label: 'Ubah', primary: true, run: () => channelForm(ctx, id) },
      { label: '↑', run: () => moveIn(ctx, 'links', (d) => d.channels, id, -1, 'Urutan channel') },
      { label: '↓', run: () => moveIn(ctx, 'links', (d) => d.channels, id, 1, 'Urutan channel') },
      { label: 'Hapus', danger: true, run: async () => {
        if (!(await confirmDialog('Hapus channel ini?', null, { ok: 'Hapus', danger: true }))) return;
        ctx.store.edit('links', (d) => { d.channels = d.channels.filter((x) => x.id !== id); }, 'Hapus channel');
      } },
    ];
  },
  section: '#menu',
  sectionLabel: 'Drive',
  tools: (ctx) => [{ label: '+ Channel', primary: true, run: () => channelForm(ctx, null) }],
};

// ======================================================================
// announcements

async function infoForm(ctx, id) {
  const items = ctx.store.get('announcements').items;
  const a = id ? items.find((x) => x.id === id) : null;
  await openForm({
    title: a ? 'Ubah pengumuman' : 'Pengumuman baru',
    fields: [
      { name: 'title', label: 'Judul', required: true, max: 120, wide: true },
      { name: 'tag', label: 'Label', type: 'select', options: tagOptions, half: true },
      { name: 'date', label: 'Tampil mulai', type: 'date', required: true, half: true },
      { name: 'body', label: 'Isi', type: 'textarea', rows: 6, max: 2000, wide: true },
      { name: 'due', label: 'Tenggat (opsional)', type: 'datetime', half: true },
      { name: 'until', label: 'Sembunyikan setelah (opsional)', type: 'date', half: true },
      { name: 'link', label: 'Tautan (opsional)', type: 'url', wide: true },
      { name: 'pinned', label: 'Sematkan di paling atas', type: 'checkbox' },
    ],
    value: a ? { ...a, due: a.due || '', until: a.until || '', link: a.link || '' } : { tag: 'info', date: todayWib(), due: '', until: '', link: '' },
    submit: a ? 'Simpan' : 'Tambah',
    onSubmit: (v) => safeEdit(ctx, () => ctx.store.edit('announcements', (d) => {
      let x = a && d.items.find((y) => y.id === a.id);
      if (!x) {
        x = { id: 'p-' + v.date.replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6) };
        d.items.unshift(x);
      }
      Object.assign(x, { title: v.title, tag: v.tag, date: v.date, body: v.body });
      for (const k of ['due', 'until', 'link']) { if (v[k]) x[k] = v[k]; else delete x[k]; }
      if (v.pinned) x.pinned = true; else delete x.pinned;
    }, a ? 'Ubah pengumuman' : 'Tambah pengumuman')),
  });
}

async function allInfo(ctx) {
  const items = ctx.store.get('announcements').items;
  await openForm({
    title: 'Semua pengumuman',
    sub: items.length + ' item, termasuk yang sudah lewat atau belum tayang',
    submit: 'Tutup',
    fields: [{ type: 'custom', name: '_', render: () => {
      const ul = h('ul', { class: 'ed-rows' }, items.map((a) => h('li', { class: 'ed-rowi' },
        h('div', null, h('b', { text: a.title }), h('small', { text: (TAG_LABELS[a.tag] || a.tag) + ', ' + a.date + (a.until ? ' sampai ' + a.until : '') })),
        h('button', { type: 'button', class: 'ed-btn is-sm', onclick: (e) => { e.target.closest('dialog').querySelector('.is-x').click(); infoForm(ctx, a.id); } }, 'Ubah'),
        h('button', { type: 'button', class: 'ed-btn is-sm is-danger', onclick: async (e) => {
          if (!(await confirmDialog('Hapus pengumuman ini?', a.title, { ok: 'Hapus', danger: true }))) return;
          ctx.store.edit('announcements', (d) => { d.items = d.items.filter((x) => x.id !== a.id); }, 'Hapus pengumuman');
          e.target.closest('li').remove();
        } }, 'Hapus'))));
      if (!items.length) ul.append(h('li', { class: 'ed-none', text: 'Belum ada pengumuman.' }));
      return ul;
    } }],
  });
}

const info = {
  kind: 'announcement',
  selector: '.ib-card[data-id]',
  label: () => 'Pengumuman',
  actions(el, ctx) {
    const id = el.dataset.id;
    const a = ctx.store.get('announcements').items.find((x) => x.id === id);
    return [
      { label: 'Ubah', primary: true, run: () => infoForm(ctx, id) },
      { label: a?.pinned ? 'Lepas sematan' : 'Sematkan', run: () => ctx.store.edit('announcements', (d) => { const x = d.items.find((y) => y.id === id); if (x.pinned) delete x.pinned; else x.pinned = true; }, 'Sematan') },
      { label: 'Hapus', danger: true, run: async () => {
        if (!(await confirmDialog('Hapus pengumuman ini?', a?.title, { ok: 'Hapus', danger: true }))) return;
        ctx.store.edit('announcements', (d) => { d.items = d.items.filter((x) => x.id !== id); }, 'Hapus pengumuman');
      } },
    ];
  },
  section: '#jadwal',
  sectionLabel: 'Pengumuman',
  tools: (ctx) => [
    { label: '+ Pengumuman', primary: true, run: () => infoForm(ctx, null) },
    { label: 'Semua pengumuman', run: () => allInfo(ctx) },
  ],
};

// ======================================================================
// heart notes

async function partForm(ctx, id) {
  const parts = ctx.store.get('heart').parts;
  const p = parts.find((x) => x.id === id);
  if (!p) return;
  await openForm({
    title: 'Catatan: ' + p.name,
    fields: [
      { name: 'name', label: 'Nama', required: true, max: 80, half: true },
      { name: 'en', label: 'Nama Inggris', max: 80, half: true },
      { name: 'latin', label: 'Nama Latin', max: 160, wide: true },
      { name: 'summary', label: 'Ringkasan', type: 'textarea', rows: 3, max: 600, wide: true },
      { name: 'anatomy', label: 'Anatomi (satu poin per baris, boleh "Judul: isi")', type: 'list', multiline: true, addLabel: 'Poin', wide: true },
      { name: 'function', label: 'Fungsi', type: 'textarea', rows: 3, max: 1500, wide: true },
      { name: 'numbers', label: 'Angka penting', type: 'list', pair: ['k', 'v'], placeholders: ['Apa', 'Nilai'], addLabel: 'Angka', wide: true },
      { name: 'supply', label: 'Perdarahan', type: 'textarea', rows: 2, max: 1500, wide: true },
      { name: 'clinical', label: 'Klinis', type: 'list', pair: ['t', 'd'], placeholders: ['Kondisi', 'Penjelasan'], addLabel: 'Kondisi', wide: true },
      { name: 'ecg', label: 'Di EKG', type: 'textarea', rows: 2, max: 1500, wide: true },
      { name: 'related', label: 'Bagian terkait', type: 'chips', options: parts.filter((x) => x.id !== id && HEART_IDS.includes(x.id)).map((x) => ({ value: x.id, label: x.name })), wide: true },
    ],
    value: p,
    onSubmit: (v) => safeEdit(ctx, () => ctx.store.edit('heart', (d) => {
      const x = d.parts.find((y) => y.id === id);
      Object.assign(x, v);
    }, 'Catatan jantung')),
  });
}

const heartPart = {
  kind: 'part',
  selector: '.hx-info[data-id]',
  label: (el) => 'Catatan ' + (el.querySelector('.hx-name')?.textContent || ''),
  actions: (el, ctx) => [{ label: 'Ubah catatan', primary: true, run: () => partForm(ctx, el.dataset.id) }],
  pass: (target) => !!target.closest('.hx-chip'),
};

// ======================================================================
// divisi and photos

function divisiList(ctx) {
  const links = ctx.store.get('links');
  return links.divisi;
}

// The first edit to divisi copies the bundled list into the links document.
function editDivisi(ctx, fn, label) {
  const base = ctx.bundledDivisi;
  return ctx.store.edit('links', (d) => {
    if (!Array.isArray(d.divisi)) d.divisi = structuredClone(base);
    return fn(d.divisi, d);
  }, label);
}

async function upload(ctx, files, onEach) {
  const out = [];
  const note = ctx.progress('Menyiapkan ' + files.length + ' foto');
  try {
    for (let i = 0; i < files.length; i++) {
      const rec = await uploadPhoto(files[i], { token: ctx.token, onStep: (t) => note((files.length > 1 ? 'Foto ' + (i + 1) + '/' + files.length + ': ' : '') + t) });
      out.push(rec);
      onEach?.(rec, i);
    }
  } catch (e) {
    alertDialog('Unggah gagal', e.message || String(e));
  } finally {
    note(null);
  }
  return out;
}

async function divisiForm(ctx, id) {
  const list = divisiList(ctx) || ctx.bundledDivisi;
  const d = id ? list.find((x) => x.id === id) : null;
  await openForm({
    title: d ? 'Ubah ' + d.name : 'Divisi baru',
    fields: [
      { name: 'name', label: 'Nama singkat', required: true, max: 40, half: true, placeholder: 'Medinfo' },
      { name: 'tag', label: 'Label kecil', max: 80, half: true, placeholder: 'Dokumentasi' },
      { name: 'full', label: 'Kepanjangan', max: 100, wide: true, placeholder: 'Media dan Informasi' },
      { name: 'desc', label: 'Deskripsi', type: 'textarea', rows: 6, max: 3000, wide: true },
    ],
    value: d || {},
    submit: d ? 'Simpan' : 'Tambah',
    onSubmit: (v) => safeEdit(ctx, () => editDivisi(ctx, (arr) => {
      let x = d && arr.find((y) => y.id === d.id);
      if (!x) { x = { id: uniqueId(slugify(v.name), new Set(arr.map((y) => y.id))), photos: [] }; arr.push(x); }
      Object.assign(x, { name: v.name, tag: v.tag, full: v.full, desc: v.desc });
    }, d ? 'Ubah divisi' : 'Tambah divisi')),
  });
}

// every photo of one divisi: order (the first three are the deck), captions, alt text, delete, add
async function photoManager(ctx, id) {
  const list = divisiList(ctx) || ctx.bundledDivisi;
  const d = list.find((x) => x.id === id);
  if (!d) return;
  let photos = structuredClone(d.photos || []);
  let paint = () => {};
  await openForm({
    title: 'Foto ' + d.name,
    sub: 'Tiga foto pertama tampil di tumpukan. Sisanya ada di tampilan lengkap.',
    fields: [{ type: 'custom', name: 'photos', render: () => {
      const grid = h('ol', { class: 'ed-photos' });
      paint = () => {
        grid.textContent = '';
        photos.forEach((ph, i) => {
          const thumb = h('div', { class: 'ed-ph-t' });
          thumb.innerHTML = pictureHTML({ ...ph, src: ph.set?.[0]?.[0] || ph.src, set: ph.set?.slice(0, 1), avif: ph.avif?.slice(0, 1) }, { sizes: '160px', alt: '' });
          const cap = h('textarea', { class: 'ed-li-in', rows: 2, maxLength: 600, placeholder: 'Keterangan foto (opsional)', value: ph.cap || '', oninput: (e) => { ph.cap = e.target.value; } });
          const alt = h('input', { class: 'ed-li-in', maxLength: 300, placeholder: 'Deskripsi untuk pembaca layar', value: ph.alt || '', oninput: (e) => { ph.alt = e.target.value; } });
          grid.append(h('li', { class: 'ed-ph' + (i < 3 ? ' is-main' : '') }, thumb,
            h('div', { class: 'ed-ph-f' }, h('span', { class: 'ed-ph-n', text: i < 3 ? 'Tumpukan ' + (i + 1) : 'Galeri' }), cap, alt),
            h('div', { class: 'ed-ph-a' },
              h('button', { type: 'button', class: 'ed-ib', disabled: i === 0, 'aria-label': 'Naikkan', onclick: () => { [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]]; paint(); } }, '↑'),
              h('button', { type: 'button', class: 'ed-ib', disabled: i === photos.length - 1, 'aria-label': 'Turunkan', onclick: () => { [photos[i + 1], photos[i]] = [photos[i], photos[i + 1]]; paint(); } }, '↓'),
              h('button', { type: 'button', class: 'ed-ib is-danger', 'aria-label': 'Hapus foto', onclick: () => { photos.splice(i, 1); paint(); } }, '×'))));
        });
        if (!photos.length) grid.append(h('li', { class: 'ed-none', text: 'Belum ada foto.' }));
      };
      paint();
      const add = h('button', { type: 'button', class: 'ed-btn is-pri', onclick: async () => {
        const files = await pickFiles({ multiple: true });
        if (!files.length) return;
        await upload(ctx, files, (rec) => { rec.alt = d.name + ', Class Alpha'; photos.push(rec); paint(); });
      } }, '+ Tambah foto');
      const el = h('div', { class: 'ed-phw' }, grid, add);
      el.read = () => photos;
      return el;
    } }],
    onSubmit: () => safeEdit(ctx, () => editDivisi(ctx, (arr) => {
      const x = arr.find((y) => y.id === id);
      x.photos = photos;
    }, 'Foto divisi')),
  });
}

async function photoAt(ctx, id, slot, replace) {
  const files = await pickFiles();
  if (!files.length) return;
  const [rec] = await upload(ctx, files);
  if (!rec) return;
  const d = (divisiList(ctx) || ctx.bundledDivisi).find((x) => x.id === id);
  rec.alt = d ? d.name + ', Class Alpha' : '';
  const r = editDivisi(ctx, (arr) => {
    const x = arr.find((y) => y.id === id);
    if (replace && x.photos[slot]) { rec.cap = x.photos[slot].cap; rec.alt = x.photos[slot].alt || rec.alt; x.photos[slot] = rec; }
    else x.photos.splice(Math.min(slot, x.photos.length), 0, rec);
  }, replace ? 'Ganti foto' : 'Tambah foto');
  if (!r.ok) alertDialog('Belum bisa', r.errors);
}

const divisi = {
  kind: 'divisi',
  selector: '.dv-ch[data-id]',
  label: (el) => 'Divisi ' + (el.querySelector('.dv-name')?.textContent || ''),
  // the arrows still flip the deck, and the prints are their own target
  pass: (target) => !!target.closest('[data-step], [data-ix], .dv-print, .ed-text'),
  actions(el, ctx) {
    const id = el.dataset.id;
    return [
      { label: 'Ubah teks', primary: true, run: () => divisiForm(ctx, id) },
      { label: 'Kelola foto', run: () => photoManager(ctx, id) },
      { label: '↑', run: () => editDivisi(ctx, (arr) => { const i = arr.findIndex((x) => x.id === id); if (i < 1) return false; [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; }, 'Urutan divisi') },
      { label: '↓', run: () => editDivisi(ctx, (arr) => { const i = arr.findIndex((x) => x.id === id); if (i < 0 || i >= arr.length - 1) return false; [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; }, 'Urutan divisi') },
      { label: 'Hapus', danger: true, run: async () => {
        if (!(await confirmDialog('Hapus divisi ini?', 'Foto-fotonya ikut dilepas dari halaman.', { ok: 'Hapus', danger: true }))) return;
        editDivisi(ctx, (arr) => { arr.splice(arr.findIndex((x) => x.id === id), 1); }, 'Hapus divisi');
      } },
    ];
  },
  section: '#divisi',
  sectionLabel: 'Divisi',
  tools: (ctx) => [{ label: '+ Divisi', primary: true, run: () => divisiForm(ctx, null) }],
};

const print = {
  kind: 'photo',
  selector: '.dv-print[data-i]',
  label: (el) => (el.dataset.empty != null ? 'Slot foto ' : 'Foto ') + (+el.dataset.i + 1),
  actions(el, ctx) {
    const id = el.closest('.dv-ch').dataset.id;
    const slot = +el.dataset.i;
    if (el.dataset.empty != null) return [{ label: 'Unggah foto', primary: true, run: () => photoAt(ctx, id, slot, false) }];
    return [
      { label: 'Ganti foto', primary: true, run: () => photoAt(ctx, id, slot, true) },
      { label: 'Lihat', run: () => ctx.views.divisi?.open(id, slot, el.querySelector('.dv-pic')) },
      { label: 'Keterangan', run: () => photoManager(ctx, id) },
      { label: 'Hapus foto', danger: true, run: async () => {
        if (!(await confirmDialog('Lepas foto ini dari divisi?', 'Filenya tetap tersimpan, jadi bisa dikembalikan pakai Undo.', { ok: 'Lepas', danger: true }))) return;
        editDivisi(ctx, (arr) => { arr.find((x) => x.id === id).photos.splice(slot, 1); }, 'Hapus foto');
      } },
    ];
  },
};

// ======================================================================
// class photo

const kelas = {
  kind: 'kelas',
  selector: '#kelasPh',
  label: () => 'Foto kelas',
  actions(el, ctx) {
    const has = !!ctx.store.get('links').site?.photo;
    return [
      { label: 'Ganti foto', primary: true, run: async () => {
        const files = await pickFiles();
        if (!files.length) return;
        const [rec] = await upload(ctx, files);
        if (!rec) return;
        rec.alt = 'Foto bersama Class Alpha';
        ctx.store.edit('links', (d) => { d.site = d.site || { t: {} }; d.site.photo = rec; }, 'Foto kelas');
      } },
      { label: 'Lihat', run: () => ctx.views.kelas?.open() },
      has ? { label: 'Pakai foto bawaan', danger: true, run: () => ctx.store.edit('links', (d) => { delete d.site.photo; }, 'Foto kelas bawaan') } : null,
    ];
  },
};

// ======================================================================
// page texts that are not typed into directly (hero endings, marquee, everything at once)

export async function textsPanel(ctx) {
  const keys = new Map();
  document.querySelectorAll('[data-k]').forEach((el) => { if (!keys.has(el.dataset.k)) keys.set(el.dataset.k, ctx.texts.original(el)); });
  const t = ctx.store.get('links').site?.t || {};
  const fields = [
    { name: 'hero.ends', label: 'Akhiran kalimat pembuka, satu per baris (baris kosong = tombol 100% Polyester)', type: 'textarea', rows: 4, wide: true },
    ...[...keys].map(([k, def]) => ({ name: k, label: k, wide: true, max: 4000, placeholder: def })),
  ];
  const value = Object.fromEntries(fields.map((f) => [f.name, t[f.name] ?? (f.name === 'hero.ends' ? 'Semangat belajarnya!\nJangan tanya apa kepanjangan Resvet.\n' : keys.get(f.name))]));
  await openForm({
    title: 'Teks halaman',
    sub: 'Semua teks yang bisa diubah. Kosongkan untuk kembali ke teks bawaan.',
    fields,
    value,
    onSubmit: (v) => safeEdit(ctx, () => ctx.store.edit('links', (d) => {
      d.site = d.site || { t: {} };
      d.site.t = d.site.t || {};
      for (const [k, val] of Object.entries(v)) {
        const def = k === 'hero.ends' ? null : keys.get(k);
        if (!String(val).trim() || val === def) delete d.site.t[k];
        else d.site.t[k] = val;
      }
    }, 'Teks halaman')),
  });
}

export const ADAPTERS = [print, kelas, jadwal, blokPill, dosen, channel, info, heartPart, divisi];
