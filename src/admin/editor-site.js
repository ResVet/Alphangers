// The rest of the links document, the same things the page editor changes in place: page texts,
// the divisions with their photos, and the class photo. Shown under the channel list.
import { h, replace } from './dom.js';
import { input, issueBadge } from './fields.js';
import { confirmDialog, toast } from './ui.js';
import { slugify } from './format.js';
import { uploadPhoto, pickFiles } from '../edit/media.js';
import { textList, buildTextList, collectPageTexts, shippedText, savedText, HERO_ENDS } from '../edit/sheet.js';
import { GROUPS, groupOf, listCopy, copyEntry } from '../copy/index.js';
import bundledDivisi from '../data/divisi.json';

const SLOTS = 3;

function uniqueId(base, taken) {
  let id = base || 'divisi';
  for (let n = 2; taken.has(id); n++) id = `${base || 'divisi'}-${n}`;
  return id;
}

// The texts of the page with what the page ships ([{ key, kind, d, ... }], see collectPageTexts).
// Inside the page editor's Panel view the page itself answers (every section, as drawn). On
// /admin/ alone the page's markup is read; the texts that sections build by script come from
// their declarations (src/copy), and texts already changed always show.
let textsOnce = null;
const pageTexts = () => (textsOnce = textsOnce || readPageTexts());

const ATTR = { kp: 'placeholder', kt: 'title' };
const parseVars = (s) => {
  try { const v = JSON.parse(s || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; }
};

async function readPageTexts() {
  try {
    const fromPage = window.parent !== window && window.parent.__alphaPageTexts?.();
    if (Array.isArray(fromPage) && fromPage.length) return fromPage;
  } catch { /* another origin: fall through */ }
  try {
    // without the page's inline styles: parsed here they would only trip this page's CSP
    const html = (await (await fetch('/', { credentials: 'omit' })).text())
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return collectPageTexts(doc.body, {
      def: (el, kind) => (kind === 'k' ? shippedText(el) : el.getAttribute(ATTR[kind]) || ''),
      vals: (el, kind) => parseVars(el.getAttribute(kind === 'k' ? 'data-kv' : 'data-' + kind + 'v')),
      entry: copyEntry,
    });
  } catch { /* offline: only the declared texts and those already changed */ }
  return [];
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
  // The same list as "Semua teks halaman" on the page: every declared text, the texts of the page,
  // and changed texts found nowhere. A change goes into the draft at once, under the same rules.
  const textsBox = h('div', { class: 'tl-box' }, h('p', { class: 'hint' }, 'Memuat daftar teks…'));
  const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
  const ensureT = () => {
    data.site = data.site || { t: {} };
    data.site.t = data.site.t || {};
    return data.site.t;
  };
  pageTexts().then((page) => {
    const t = data.site?.t || {};
    const groups = buildTextList({ reg: listCopy(), page, saved: t, order: GROUPS, groupOf, special: [HERO_ENDS] });
    const list = textList({
      groups,
      skin: 'adm',
      open: 'hero',
      saved: () => data.site?.t || {},
      value: (it) => (own(t, it.key) ? t[it.key] : it.d),
      onInput: (it, v) => {
        const tt = ensureT();
        const next = it.unknown ? (v.trim() ? v : undefined) : savedText(v, it.d, it.opt);
        if (next === undefined) delete tt[it.key];
        else tt[it.key] = next;
        ctx.changed();
      },
    });
    // a text the check flags opens where it is, so its message has a place to show
    const flagged = [...(ctx.doc.result?.errors || []), ...(ctx.doc.result?.warnings || [])]
      .filter((x) => x.path?.[0] === 'site' && x.path[1] === 't' && x.path.length > 2).map((x) => x.path[2]);
    for (const k of flagged) list.reveal(k);
    replace(textsBox,
      h('p', { class: 'hint' }, 'Kolom berisi teks yang tampil sekarang. Kosongkan sebuah kolom buat balik ke teks bawaan (tulisan samar di kolomnya).'),
      list);
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
