// Lecturer directory: search, add, edit, delete, phone clean-up.
import { h, clear, focusSoon, replace, append, $ } from './dom.js';
import { input, issueBadge } from './fields.js';
import { confirmDialog, openDialog, toast } from './ui.js';
import { fold, slugify } from './format.js';
import { normalizePhone } from '../lib/validate.js';
import { nameWords } from './picker.js';

const PAGE = 30;

// Where each lecturer appears in the schedule draft: { id: { bloks, codes, ketua, sessions } }.
export function scheduleUse(schedule) {
  const use = {};
  for (const b of (schedule && schedule.bloks) || []) {
    const sessions = {};
    for (const d of b.days) for (const s of d.s) for (const c of s.dz) sessions[c] = (sessions[c] || 0) + 1;
    for (const [code, id] of Object.entries(b.codes)) {
      const u = (use[id] = use[id] || { bloks: [], codes: {}, ketua: [], refs: [] });
      if (!u.bloks.includes(b.id)) u.bloks.push(b.id);
      u.codes[b.id] = code;
      u.refs.push({ blok: b.name, code, sessions: sessions[code] || 0 });
    }
    if (b.ketua) {
      const u = (use[b.ketua] = use[b.ketua] || { bloks: [], codes: {}, ketua: [], refs: [] });
      u.ketua.push(b.name);
    }
  }
  return use;
}

// The blok list and codes kept on each lecturer are a copy of what the
// schedule says. This finds the people whose copy is out of date.
function outOfSync(list, use) {
  return list.filter((p) => {
    const u = use[p.id] || { bloks: [], codes: {} };
    return JSON.stringify(p.bloks) !== JSON.stringify(u.bloks) || JSON.stringify(p.codes) !== JSON.stringify(u.codes);
  });
}

function phoneStatus(ph) {
  const norm = normalizePhone(ph.n);
  if (!norm) return { text: 'Nomor belum dikenali. Contoh: 0812-3456-7890 atau 0711-354088.', bad: true };
  return { text: norm.wa ? `WhatsApp ke +${norm.wa}` : 'Telepon rumah, tanpa WhatsApp', bad: false };
}

export function renderDosen(host, ctx) {
  const data = ctx.doc.draft;
  const ui = ctx.ui;
  ui.open = ui.open || new Set();
  ui.shown = ui.shown || PAGE;
  ui.q = ui.q || '';
  const use = scheduleUse(ctx.docs.schedule.draft);
  const specs = [...new Set(data.list.map((p) => p.spec).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
  const results = h('div', { class: 'results' });
  const count = h('p', { class: 'mono meta', 'aria-live': 'polite' });

  const search = h('input', { type: 'search', id: 'dosen-q', value: ui.q, placeholder: 'Nama, spesialisasi, atau nomor', autocomplete: 'off', spellcheck: false });
  search.addEventListener('input', () => {
    ui.q = search.value;
    ui.shown = PAGE;
    paint();
  });

  const stale = outOfSync(data.list, use);
  const syncBanner = stale.length
    ? h(
        'div',
        { class: 'banner warn' },
        h('p', null, `${stale.length} dosen punya data blok yang beda dengan jadwal. Data ini dipakai portal untuk menulis "mengajar di Blok X".`),
        h(
          'button',
          {
            type: 'button',
            class: 'btn sm',
            onclick: () => {
              for (const p of data.list) {
                const u = use[p.id];
                p.bloks = u ? u.bloks.slice() : [];
                p.codes = u ? { ...u.codes } : {};
              }
              ctx.changed();
              ctx.rerender();
              toast('Data blok dosen disamakan dengan jadwal.');
            },
          },
          'Samakan dengan jadwal',
        ),
      )
    : null;

  append(host, [
    h(
      'div',
      { class: 'bar' },
      h('div', { class: 'fld grow' }, h('label', { htmlFor: 'dosen-q' }, 'Cari dosen'), search),
      h('button', { type: 'button', class: 'btn', onclick: add }, 'Tambah dosen'),
    ),
    syncBanner,
    count,
    results,
    h('datalist', { id: 'spec-list' }, specs.map((s) => h('option', { value: s }))),
  ]);
  paint();

  function matches() {
    const terms = fold(ui.q).split(/\s+/).filter(Boolean);
    const digits = ui.q.replace(/\D/g, '');
    const out = [];
    data.list.forEach((p, i) => {
      if (!terms.length) return out.push(i);
      const hay = `${fold(p.name)} ${fold(p.spec)} ${p.id}`;
      const phoneHit = digits.length >= 4 && p.phones.some((ph) => String(ph.n).includes(digits));
      if (phoneHit || terms.every((t) => hay.includes(t))) out.push(i);
    });
    return out;
  }

  function paint() {
    const idx = matches();
    count.textContent = ui.q ? `${idx.length} dari ${data.list.length} dosen cocok` : `${data.list.length} dosen`;
    clear(results);
    if (!idx.length) {
      results.append(h('div', { class: 'empty' }, h('p', null, 'Tidak ada yang cocok.'), h('p', { class: 'hint' }, 'Coba sebagian nama saja, tanpa gelar.')));
      return;
    }
    results.append(h('ul', { class: 'people' }, idx.slice(0, ui.shown).map((i) => personRow(data.list[i], i))));
    if (idx.length > ui.shown) {
      results.append(
        h('div', { class: 'add-row' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => ((ui.shown += PAGE), paint()) }, `Tampilkan ${Math.min(PAGE, idx.length - ui.shown)} lagi`)),
      );
    }
  }

  function personRow(p, i) {
    const lp = ['list', i];
    const isOpen = ui.open.has(p.id);
    const u = use[p.id];
    const panelId = `dosen-${i}`;
    const head = h(
      'div',
      { class: 'person-head' },
      h(
        'button',
        { type: 'button', class: 'disclose', 'aria-expanded': isOpen ? 'true' : 'false', 'aria-controls': panelId, onclick: () => toggle(p) },
        h('span', { class: 'person-name' }, p.name || '(nama kosong)'),
        h('span', { class: 'person-meta' }, [p.spec, ...p.phones.map((ph) => ph.f || ph.n)].filter(Boolean).join(' · ')),
      ),
      issueBadge(ctx.doc.result, lp),
      u ? h('div', { class: 'chips' }, u.refs.map((r) => h('span', { class: 'chip code' }, `${r.blok} ${r.code}`)), u.ketua.map((b) => h('span', { class: 'chip muted' }, `Ketua ${b}`))) : null,
    );
    if (!isOpen) return h('li', { class: 'person' }, head);

    const phones = h('div', { class: 'phones' });
    const paintPhones = () => {
      replace(phones, 
        ...p.phones.map((ph, j) => {
          const status = h('p', { class: 'hint' });
          const setStatus = () => {
            const st = phoneStatus(ph);
            status.textContent = st.text;
            status.classList.toggle('warn-text', st.bad);
          };
          setStatus();
          const field = input({
            label: `Nomor ${j + 1}`,
            obj: ph,
            prop: 'n',
            path: lp.concat('phones', j),
            ctx,
            type: 'tel',
            inputmode: 'tel',
            read: () => ph.f || ph.n || '',
            write: (s) => {
              delete ph.f;
              delete ph.wa;
              return s;
            },
            onInput: setStatus,
            onCommit: (el) => {
              const norm = normalizePhone(el.value);
              if (!norm) return;
              Object.assign(ph, norm);
              el.value = norm.f;
              ctx.changed();
              setStatus();
            },
          });
          field.querySelector('.msg').before(status);
          return h(
            'div',
            { class: 'phone-row' },
            field,
            h('button', {
              type: 'button',
              class: 'btn ghost sm danger-text',
              'aria-label': `Hapus nomor ${j + 1}`,
              onclick: () => {
                p.phones.splice(j, 1);
                ctx.changed();
                paintPhones();
              },
            }, 'Hapus'),
          );
        }),
        p.phones.length < 4
          ? h('button', {
              type: 'button',
              class: 'btn ghost sm',
              onclick: () => {
                p.phones.push({ n: '' });
                ctx.changed();
                paintPhones();
                focusSoon(() => phones.querySelector('.phone-row:last-of-type input'));
              },
            }, 'Tambah nomor')
          : null,
      );
    };
    paintPhones();

    const panel = h(
      'div',
      { class: 'grid2', id: panelId },
      input({
        label: 'Nama lengkap dengan gelar',
        obj: p,
        prop: 'name',
        path: lp.concat('name'),
        ctx,
        max: 120,
        wide: true,
        onCommit: () => {
          if (p.id.startsWith('dosen-baru')) {
            const taken = new Set(data.list.filter((x) => x !== p).map((x) => x.id));
            const base = slugify(nameWords(p.name).join(' ')) || 'dosen';
            let id = base;
            for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
            ui.open.delete(p.id);
            p.id = id;
            ui.open.add(id);
            ctx.changed();
            ctx.rerender();
          }
        },
      }),
      input({ label: 'Spesialisasi', obj: p, prop: 'spec', path: lp.concat('spec'), ctx, max: 60, list: 'spec-list', hint: 'Pilih dari daftar atau ketik baru.' }),
      h('div', { class: 'fld' }, h('span', { class: 'lbl' }, 'ID'), h('p', { class: 'value mono' }, p.id), h('p', { class: 'hint' }, 'Dipakai jadwal untuk menunjuk dosen ini. Tidak bisa diganti.')),
      h('div', { class: 'wide' }, h('h4', { class: 'sub-title' }, 'Telepon'), h('p', { class: 'hint' }, 'Nomor ini tampil publik di portal.'), phones),
      h('div', { class: 'card-foot wide' }, h('button', { type: 'button', class: 'btn ghost sm danger-text', onclick: () => remove(p) }, 'Hapus dosen')),
    );
    return h('li', { class: 'person open' }, head, panel);
  }

  function toggle(p) {
    if (ui.open.has(p.id)) ui.open.delete(p.id);
    else ui.open.add(p.id);
    paint();
  }

  function add() {
    let n = 1;
    while (data.list.some((x) => x.id === `dosen-baru-${n}`)) n++;
    const p = { id: `dosen-baru-${n}`, name: '', spec: '', phones: [{ n: '' }], bloks: [], codes: {} };
    data.list.unshift(p);
    ui.open.add(p.id);
    ui.q = '';
    ctx.changed();
    ctx.rerender();
    focusSoon(() => $('.person.open input', host));
  }

  async function remove(p) {
    const u = use[p.id];
    let ok;
    if (u) {
      const lines = [
        ...u.refs.map((r) => `${r.blok}: kode ${r.code}, ${r.sessions} sesi`),
        ...u.ketua.map((b) => `${b}: ketua blok`),
      ];
      ok = await openDialog({
        title: `${p.name} masih dipakai di jadwal`,
        body: [
          h('ul', { class: 'plain' }, lines.map((l) => h('li', null, l))),
          h('p', null, 'Kalau dihapus, sesi itu tidak punya nama dosen lagi. Sebaiknya ganti dulu di tab Jadwal.'),
        ],
        actions: [
          { label: 'Batal', value: false, kind: 'ghost', autofocus: true },
          { label: 'Tetap hapus', value: true, kind: 'danger' },
        ],
      });
    } else {
      ok = await confirmDialog({ title: `Hapus ${p.name || 'dosen ini'}?`, text: 'Hilang dari portal setelah kamu simpan.', confirm: 'Hapus', danger: true });
    }
    if (!ok) return;
    data.list.splice(data.list.indexOf(p), 1);
    ui.open.delete(p.id);
    ctx.changed();
    ctx.rerender();
  }
}

export function revealDosen(ctx, path) {
  const p = ctx.doc.draft.list[path[1]];
  if (!p) return false;
  ctx.ui.open = ctx.ui.open || new Set();
  ctx.ui.open.add(p.id);
  ctx.ui.q = p.name;
  return true;
}
