// The rest of the links document, the same things the page editor changes in place: page texts,
// the divisions with their photos, and the class photo. Shown under the channel list.
import { h, replace } from './dom.js';
import { input, issueBadge } from './fields.js';
import { confirmDialog, toast } from './ui.js';
import { slugify } from './format.js';
import { uploadPhoto, pickFiles } from '../edit/media.js';
import bundledDivisi from '../data/divisi.json';

// the hero endings as the page ships them (src/legacy/app.js); the empty last line is the Polyester button
const ENDS_DEFAULT = 'And yes this website is a bit vibecoded :D\nSemangat belajarnya!\nJangan tanya apa kepanjangan Resvet.\n';
const SLOTS = 3;

function uniqueId(base, taken) {
  let id = base || 'divisi';
  for (let n = 2; taken.has(id); n++) id = `${base || 'divisi'}-${n}`;
  return id;
}

// Every editable page text with the text the page ships. Inside the page editor's Panel view the
// page itself answers (every section, as rendered). On /admin/ alone the page's markup is read,
// which has all texts except those of sections built by script; texts already changed always show.
let textsOnce = null;
function pageTexts() {
  textsOnce = textsOnce || readPageTexts();
  return textsOnce.then((m) => new Map(m));
}

async function readPageTexts() {
  try {
    const fromPage = window.parent !== window && window.parent.__alphaPageTexts?.();
    if (fromPage?.length) return new Map(fromPage);
  } catch { /* another origin: fall through */ }
  const keys = new Map();
  try {
    const html = await (await fetch('/', { credentials: 'omit' })).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('[data-k]').forEach((el) => { if (!keys.has(el.dataset.k)) keys.set(el.dataset.k, el.textContent.trim()); });
  } catch { /* offline: only the texts already changed */ }
  return keys;
}

// the smallest copy of a photo record, for a thumbnail
const thumbSrc = (ph) => (ph?.set?.[0]?.[0]) || ph?.src || '';

async function uploadFiles(ctx, files, button) {
  const out = [];
  const label = button.textContent;
  button.disabled = true;
  try {
    for (let i = 0; i < files.length; i++) {
      const rec = await uploadPhoto(files[i], {
        token: (force) => ctx.backend.token(force),
        onStep: (t) => { button.textContent = (files.length > 1 ? `Foto ${i + 1}/${files.length}: ` : '') + t; },
      });
      out.push(rec);
    }
  } catch (e) {
    toast('Unggah gagal: ' + (e.message || e), 'err');
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
  return out;
}

export function renderSite(host, ctx) {
  const data = ctx.doc.draft;

  /* ---------- page texts ---------- */
  const textsBox = h('div', { class: 'grid2' }, h('p', { class: 'hint wide' }, 'Memuat daftar teks…'));
  const ensureT = () => {
    data.site = data.site || { t: {} };
    data.site.t = data.site.t || {};
    return data.site.t;
  };
  pageTexts().then((keys) => {
    const t = data.site?.t || {};
    for (const k of Object.keys(t)) if (!keys.has(k) && k !== 'hero.ends') keys.set(k, '');
    const field = (k, def, opts = {}) => {
      const holder = { v: t[k] ?? '' };
      return input({
        label: opts.label || k,
        obj: holder,
        prop: 'v',
        path: ['site', 't', k],
        ctx,
        type: opts.textarea || (def && def.length > 70) || String(t[k] ?? '').includes('\n') ? 'textarea' : 'text',
        rows: opts.rows || 3,
        max: 4000,
        wide: true,
        placeholder: def,
        hint: opts.hint,
        write: (v) => {
          const tt = ensureT();
          if (!v.trim() || v === def) delete tt[k];
          else tt[k] = v;
          return v;
        },
      });
    };
    replace(textsBox,
      h('p', { class: 'hint wide' }, 'Kosongkan sebuah teks untuk kembali ke tulisan bawaan (yang tampil samar di kolomnya).'),
      field('hero.ends', ENDS_DEFAULT, { label: 'Akhiran kalimat pembuka, satu per baris (baris kosong = tombol 100% Polyester)', textarea: true, rows: 4 }),
      ...[...keys].map(([k, def]) => field(k, def)));
  });

  /* ---------- divisi ---------- */
  const divBox = h('div');
  const startDivisi = () => {
    data.divisi = structuredClone(bundledDivisi.items);
    ctx.changed();
    ctx.rerender();
  };
  if (!Array.isArray(data.divisi)) {
    replace(divBox,
      h('p', { class: 'lede' }, 'Portal masih memakai daftar divisi bawaan. Mulai ubah untuk menyalinnya ke sini, lalu atur teks dan fotonya.'),
      h('div', { class: 'add-row' }, h('button', { type: 'button', class: 'btn', onclick: startDivisi }, 'Ubah divisi')));
  } else {
    const list = data.divisi;
    const saved = new Set((ctx.doc.base.data.divisi || []).map((x) => x.id));
    const byId = new Map(bundledDivisi.items.map((d) => [d.id, d]));
    const move = (arr, i, j) => { const [x] = arr.splice(i, 1); arr.splice(j, 0, x); ctx.changed(); ctx.rerender(); };
    const cards = list.map((d, i) => {
      const p = ['divisi', i];
      const def = byId.get(d.id) || {};
      d.photos = d.photos || [];
      const photos = h('ol', { class: 'ph-list' }, d.photos.map((ph, j) => h('li', { class: 'ph' },
        h('img', { src: thumbSrc(ph), alt: '', loading: 'lazy', decoding: 'async', width: 96, height: 64 }),
        h('div', { class: 'ph-f' },
          h('span', { class: 'mono hint' }, j < SLOTS ? `Tumpukan ${j + 1}` : 'Galeri'),
          input({ label: 'Keterangan (opsional)', obj: ph, prop: 'cap', path: p.concat('photos', j, 'cap'), ctx, max: 600 }),
          input({ label: 'Deskripsi untuk pembaca layar', obj: ph, prop: 'alt', path: p.concat('photos', j, 'alt'), ctx, max: 300 })),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn ghost sm', disabled: j === 0, 'aria-label': 'Naikkan foto', onclick: () => move(d.photos, j, j - 1) }, '↑'),
          h('button', { type: 'button', class: 'btn ghost sm', disabled: j === d.photos.length - 1, 'aria-label': 'Turunkan foto', onclick: () => move(d.photos, j, j + 1) }, '↓'),
          h('button', { type: 'button', class: 'btn ghost sm danger-text', onclick: () => { d.photos.splice(j, 1); ctx.changed(); ctx.rerender(); } }, 'Lepas')))));
      const addPh = h('button', { type: 'button', class: 'btn sm', onclick: async () => {
        const files = await pickFiles({ multiple: true });
        if (!files.length) return;
        const recs = await uploadFiles(ctx, files, addPh);
        if (!recs.length) return;
        for (const r of recs) { r.alt = (d.name || 'Divisi') + ', Class Alpha'; d.photos.push(r); }
        ctx.changed();
        ctx.rerender();
        toast(recs.length + ' foto ditambahkan. Belum tersimpan.');
      } }, '+ Tambah foto');
      return h('li', { class: 'card', dataset: { id: d.id } },
        h('div', { class: 'card-head' },
          h('span', { class: 'num', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
          h('h3', { class: 'card-title' }, d.name || def.name || 'Divisi baru'),
          issueBadge(ctx.doc.result, p),
          h('div', { class: 'row-actions' },
            h('button', { type: 'button', class: 'btn ghost sm', disabled: i === 0, 'aria-label': `Naikkan ${d.name}`, onclick: () => move(list, i, i - 1) }, '↑'),
            h('button', { type: 'button', class: 'btn ghost sm', disabled: i === list.length - 1, 'aria-label': `Turunkan ${d.name}`, onclick: () => move(list, i, i + 1) }, '↓'),
            h('button', { type: 'button', class: 'btn ghost sm danger-text', onclick: async () => {
              const ok = await confirmDialog({ title: `Hapus divisi ${d.name || d.id}?`, text: 'Foto-fotonya ikut dilepas dari halaman. Sebelum simpan, masih bisa dibatalkan.', confirm: 'Hapus', danger: true });
              if (!ok) return;
              list.splice(i, 1);
              ctx.changed();
              ctx.rerender();
            } }, 'Hapus'))),
        h('div', { class: 'grid2' },
          input({ label: 'Nama singkat', obj: d, prop: 'name', path: p.concat('name'), ctx, max: 40, placeholder: def.name,
            onCommit: () => {
              // a new divisi takes its id from the first name it gets
              if (saved.has(d.id) || !/^divisi(-\d+)?$/.test(d.id) || !d.name.trim() || d.name === 'Divisi baru') return;
              d.id = uniqueId(slugify(d.name), new Set(list.filter((x) => x !== d).map((x) => x.id)));
              ctx.changed();
              ctx.rerender();
            } }),
          input({ label: 'Label kecil', obj: d, prop: 'tag', path: p.concat('tag'), ctx, max: 80, placeholder: def.tag, hint: 'Kosongkan untuk label bawaan.' }),
          input({ label: 'Kepanjangan', obj: d, prop: 'full', path: p.concat('full'), ctx, max: 100, wide: true, placeholder: def.full }),
          input({ label: 'Deskripsi', obj: d, prop: 'desc', path: p.concat('desc'), ctx, type: 'textarea', rows: 4, max: 3000, wide: true, placeholder: def.desc }),
          h('div', { class: 'fld wide' },
            h('span', { class: 'lbl' }, 'Foto (tiga pertama tampil di tumpukan)'),
            d.photos.length ? photos : h('p', { class: 'hint' }, 'Belum ada foto.'),
            h('div', { class: 'add-row' }, addPh))));
    });
    replace(divBox,
      h('ol', { class: 'cards' }, cards),
      h('div', { class: 'add-row' }, h('button', { type: 'button', class: 'btn', onclick: () => {
        list.push({ id: uniqueId('divisi', new Set(list.map((x) => x.id))), name: 'Divisi baru', full: '', tag: '', desc: '', photos: [] });
        ctx.changed();
        ctx.rerender();
      } }, 'Tambah divisi')));
  }

  /* ---------- class photo ---------- */
  const ph = data.site?.photo;
  const replacePh = h('button', { type: 'button', class: 'btn sm', onclick: async () => {
    const files = await pickFiles();
    if (!files.length) return;
    const [rec] = await uploadFiles(ctx, files, replacePh);
    if (!rec) return;
    rec.alt = 'Foto bersama Class Alpha';
    data.site = data.site || { t: {} };
    data.site.photo = rec;
    ctx.changed();
    ctx.rerender();
    toast('Foto kelas diganti. Belum tersimpan.');
  } }, 'Ganti foto');
  const kelasBox = h('div', { class: 'kelas-ph' },
    h('img', { src: ph ? thumbSrc(ph) : '/img/kelas/alpha-640.webp', alt: '', width: 192, height: 144, loading: 'lazy' }),
    h('div', null,
      h('p', { class: 'hint' }, ph ? 'Foto unggahan sendiri.' : 'Foto bawaan dari repo.'),
      h('div', { class: 'row-actions' }, replacePh,
        ph ? h('button', { type: 'button', class: 'btn ghost sm danger-text', onclick: () => { delete data.site.photo; ctx.changed(); ctx.rerender(); } }, 'Pakai foto bawaan') : null)));

  host.append(
    h('h2', { class: 'sub-title' }, 'Divisi'),
    divBox,
    h('h2', { class: 'sub-title' }, 'Foto kelas'),
    kelasBox,
    h('h2', { class: 'sub-title' }, 'Teks halaman'),
    textsBox,
  );
}
