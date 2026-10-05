// Forms and small dialogs for the live editor. One form builder covers every structured edit
// (a session, a lecturer, a channel, an announcement, a divisi, a heart part): give it fields and
// a value, get the edited value back, or null when the sheet is closed without saving.
// On phones the sheet rises from the bottom; on wide screens it opens from the right edge.
// Everything here builds DOM with textContent; no value is ever parsed as HTML.

export function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n && k !== 'list' && k !== 'form') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

function openDialog(cls, build) {
  const dlg = h('dialog', { class: 'ed-dlg ' + cls });
  document.body.append(dlg);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      dlg.classList.add('is-out');
      setTimeout(() => { dlg.close(); dlg.remove(); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
      resolve(v);
    };
    build(dlg, finish);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(null); });
    dlg.showModal();
  });
}

/** Yes/no question. Resolves true or false. */
export function confirmDialog(title, body, { ok = 'Lanjut', cancel = 'Batal', danger = false } = {}) {
  return openDialog('ed-ask', (dlg, finish) => {
    const okB = h('button', { type: 'button', class: 'ed-btn ' + (danger ? 'is-danger' : 'is-pri'), onclick: () => finish(true) }, ok);
    dlg.append(h('div', { class: 'ed-ask-in' },
      h('h3', { class: 'ed-ask-h', text: title }),
      body ? h('p', { class: 'ed-ask-p', text: body }) : null,
      h('div', { class: 'ed-row-end' }, h('button', { type: 'button', class: 'ed-btn', onclick: () => finish(false) }, cancel), okB)));
    queueMicrotask(() => okB.focus());
  }).then((v) => v === true);
}

/** A message with one button. */
export function alertDialog(title, body) {
  return openDialog('ed-ask', (dlg, finish) => {
    const okB = h('button', { type: 'button', class: 'ed-btn is-pri', onclick: () => finish(true) }, 'Oke');
    const list = Array.isArray(body) ? h('ul', { class: 'ed-errs' }, body.map((x) => h('li', { text: x }))) : body ? h('p', { class: 'ed-ask-p', text: body }) : null;
    dlg.append(h('div', { class: 'ed-ask-in' }, h('h3', { class: 'ed-ask-h', text: title }), list, h('div', { class: 'ed-row-end' }, okB)));
    queueMicrotask(() => okB.focus());
  });
}

/** Choice between several actions. Resolves the chosen value or null. */
export function chooseDialog(title, body, choices) {
  return openDialog('ed-ask', (dlg, finish) => {
    dlg.append(h('div', { class: 'ed-ask-in' },
      h('h3', { class: 'ed-ask-h', text: title }),
      body ? h('p', { class: 'ed-ask-p', text: body }) : null,
      h('div', { class: 'ed-col' }, choices.map((c) => h('button', { type: 'button', class: 'ed-btn ' + (c.kind || ''), onclick: () => finish(c.value) }, c.label)))));
  });
}

// ---------- fields

function inputFor(f, v) {
  const common = { id: f.id, name: f.name, required: f.required, placeholder: f.placeholder || '', autocomplete: 'off', spellcheck: f.spellcheck ?? false };
  switch (f.type) {
    case 'textarea':
      return h('textarea', { ...common, rows: f.rows || 4, maxLength: f.max || 4000, spellcheck: true, value: v ?? '' });
    case 'select':
      return h('select', { id: f.id, name: f.name }, (f.options || []).map((o) => h('option', { value: o.value, selected: o.value === v }, o.label)));
    case 'checkbox':
      return h('input', { id: f.id, name: f.name, type: 'checkbox', checked: !!v });
    case 'time':
      return h('input', { ...common, type: 'time', step: 60, value: v ?? '' });
    case 'date':
      return h('input', { ...common, type: 'date', value: v ?? '' });
    case 'datetime':
      return h('input', { ...common, type: 'datetime-local', value: v ?? '' });
    case 'url':
      return h('input', { ...common, type: 'url', inputMode: 'url', maxLength: 2048, value: v ?? '' });
    default:
      return h('input', { ...common, type: 'text', maxLength: f.max || 300, value: v ?? '' });
  }
}

// A growing list of text rows (anatomy notes, phone numbers) or of two-part rows (key numbers).
function listField(f, value) {
  const rows = h('div', { class: 'ed-list' });
  const pair = f.pair; // e.g. ['k', 'v'] for {k, v} items
  const addRow = (item) => {
    const inputs = pair
      ? pair.map((k, i) => h(i === 0 ? 'input' : 'textarea', { class: 'ed-li-in', placeholder: f.placeholders?.[i] || '', maxLength: f.max || 1200, rows: 2, value: item?.[k] ?? '', 'data-part': k }))
      : [h(f.multiline ? 'textarea' : 'input', { class: 'ed-li-in', placeholder: f.placeholder || '', maxLength: f.max || 1200, rows: 2, value: item ?? '', inputMode: f.inputmode })];
    const row = h('div', { class: 'ed-li' + (pair ? ' is-pair' : '') }, inputs,
      h('button', { type: 'button', class: 'ed-ib', 'aria-label': 'Hapus baris', onclick: () => row.remove() }, '×'));
    rows.append(row);
    return row;
  };
  (value || []).forEach(addRow);
  const add = h('button', { type: 'button', class: 'ed-btn is-sm', onclick: () => addRow(pair ? {} : '').querySelector('input, textarea').focus() }, '+ ' + (f.addLabel || 'Tambah'));
  const el = h('div', { class: 'ed-listw' }, rows, add);
  el.read = () => [...rows.children].map((r) => {
    if (!pair) return r.querySelector('.ed-li-in').value.trim();
    const o = {};
    r.querySelectorAll('[data-part]').forEach((x) => { o[x.dataset.part] = x.value.trim(); });
    return o;
  }).filter((x) => (pair ? Object.values(x).some(Boolean) : x));
  return el;
}

// Pick from a known set (bloks a lecturer teaches in, related heart parts).
function chipsField(f, value) {
  const on = new Set(value || []);
  const box = h('div', { class: 'ed-chips', role: 'group' }, (f.options || []).map((o) => {
    const b = h('button', { type: 'button', class: 'ed-chip', 'aria-pressed': String(on.has(o.value)), onclick: () => {
      if (on.has(o.value)) on.delete(o.value); else on.add(o.value);
      b.setAttribute('aria-pressed', String(on.has(o.value)));
    } }, o.label);
    return b;
  }));
  box.read = () => (f.options || []).map((o) => o.value).filter((v) => on.has(v));
  return box;
}

// Lecturers for a session, searched by name, shown in the order chosen.
function peopleField(f, value) {
  const people = f.people || [];
  const byId = new Map(people.map((p) => [p.id, p]));
  let chosen = (value || []).filter((id) => byId.has(id));
  const picked = h('div', { class: 'ed-picked' });
  const q = h('input', { type: 'search', class: 'ed-q', placeholder: 'Cari nama dosen', autocomplete: 'off', spellcheck: false });
  const hits = h('ul', { class: 'ed-hits', role: 'listbox' });
  const paint = () => {
    picked.textContent = '';
    for (const id of chosen) {
      const p = byId.get(id);
      picked.append(h('span', { class: 'ed-pchip' }, p.name, h('button', { type: 'button', class: 'ed-ib', 'aria-label': 'Lepas ' + p.name, onclick: () => { chosen = chosen.filter((x) => x !== id); paint(); } }, '×')));
    }
    if (!chosen.length) picked.append(h('span', { class: 'ed-none', text: f.empty || 'Belum ada dosen dipilih.' }));
  };
  const search = () => {
    hits.textContent = '';
    const t = fold(q.value.trim());
    if (t.length < 2) return;
    const words = t.split(/\s+/);
    people.filter((p) => !chosen.includes(p.id) && words.every((w) => fold(p.name + ' ' + (p.spec || '')).includes(w))).slice(0, 8).forEach((p) => {
      hits.append(h('li', null, h('button', { type: 'button', class: 'ed-hit', onclick: () => { chosen.push(p.id); q.value = ''; hits.textContent = ''; paint(); q.focus(); } },
        h('b', { text: p.name }), h('small', { text: p.spec || '' }))));
    });
    if (!hits.children.length) hits.append(h('li', { class: 'ed-none', text: 'Nggak ketemu.' }));
  };
  q.addEventListener('input', search);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); hits.querySelector('.ed-hit')?.click(); } });
  paint();
  const el = h('div', { class: 'ed-people' }, picked, q, hits);
  el.read = () => chosen.slice();
  return el;
}

/**
 * Opens a form. fields: [{ name, label, type, hint, required, options, ... }]. onSubmit gets the
 * values and may answer { errors: ['...'] } to keep the sheet open with those messages.
 * Resolves with the values that were accepted, or null.
 */
export function openForm({ title, sub, fields, value = {}, submit = 'Simpan', extra = [], onSubmit }) {
  return openDialog('ed-sheet', (dlg, finish) => {
    const readers = new Map();
    const errBox = h('div', { class: 'ed-errbox', role: 'alert', hidden: true });
    const body = h('div', { class: 'ed-fields' });
    let n = 0;
    for (const f of fields) {
      if (f.type === 'note') { body.append(h('p', { class: 'ed-note', text: f.text })); continue; }
      if (f.type === 'section') { body.append(h('h4', { class: 'ed-sec', text: f.label })); continue; }
      const id = 'edf' + ++n;
      const fld = { ...f, id };
      let control;
      if (f.type === 'list') control = listField(fld, value[f.name]);
      else if (f.type === 'chips') control = chipsField(fld, value[f.name]);
      else if (f.type === 'people') control = peopleField(fld, value[f.name]);
      else if (f.type === 'custom') control = f.render(value);
      else control = inputFor(fld, value[f.name]);
      readers.set(f.name, () => {
        if (control.read) return control.read();
        if (f.type === 'checkbox') return control.checked;
        return control.value;
      });
      const label = f.type === 'checkbox'
        ? h('label', { class: 'ed-check', htmlFor: id }, control, h('span', { text: f.label }))
        : h('label', { class: 'ed-lbl', htmlFor: id, text: f.label + (f.required ? ' *' : '') });
      body.append(h('div', { class: 'ed-fld' + (f.wide ? ' is-wide' : '') + (f.half ? ' is-half' : '') },
        label, f.type === 'checkbox' ? null : control, f.hint ? h('p', { class: 'ed-hint', text: f.hint }) : null));
    }
    const read = () => Object.fromEntries([...readers].map(([k, fn]) => [k, fn()]));
    const save = h('button', { type: 'submit', class: 'ed-btn is-pri' }, submit);
    const form = h('form', { class: 'ed-form', novalidate: true },
      h('header', { class: 'ed-sh' },
        h('div', null, h('h3', { class: 'ed-sh-t', text: title }), sub ? h('p', { class: 'ed-sh-s', text: sub }) : null),
        h('button', { type: 'button', class: 'ed-ib is-x', 'aria-label': 'Tutup', onclick: () => finish(null) }, '×')),
      h('div', { class: 'ed-sb' }, errBox, body),
      h('footer', { class: 'ed-sf' },
        extra.map((x) => h('button', { type: 'button', class: 'ed-btn ' + (x.kind || ''), onclick: async () => { const r = await x.run(read()); if (r !== false) finish(null); } }, x.label)),
        h('span', { class: 'ed-sp' }),
        h('button', { type: 'button', class: 'ed-btn', onclick: () => finish(null) }, 'Batal'), save));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = read();
      for (const f of fields) {
        if (f.required && !String(values[f.name] ?? '').trim()) {
          errBox.hidden = false;
          errBox.textContent = f.label + ' wajib diisi.';
          return;
        }
      }
      save.disabled = true;
      const res = onSubmit ? await onSubmit(values) : null;
      save.disabled = false;
      if (res && res.errors?.length) {
        errBox.hidden = false;
        errBox.textContent = '';
        errBox.append(h('ul', { class: 'ed-errs' }, res.errors.slice(0, 8).map((x) => h('li', { text: x }))));
        errBox.scrollIntoView({ block: 'nearest' });
        return;
      }
      finish(values);
    });
    dlg.append(form);
    queueMicrotask(() => body.querySelector('input:not([type=checkbox]), textarea, select')?.focus());
  });
}
