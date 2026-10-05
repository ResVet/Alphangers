// The editor shell: header, content tabs, document status, mode switch,
// the active editor and the save bar.
import { h, clear, replace, debounce, focusSoon, $ } from './dom.js';
import { paintIssues, paintBadges } from './fields.js';
import { confirmDialog, toast } from './ui.js';
import { KEY_INFO, fmtRelative, fmtWhen, pathLabel } from './format.js';
import { reviewAndSave, resetToBundled, exportJson, importJson } from './save-flow.js';
import { renderLinks } from './editor-links.js';
import { renderAnnouncements, revealAnnouncement } from './editor-announcements.js';
import { renderSchedule, revealSchedule } from './editor-schedule.js';
import { renderDosen, revealDosen } from './editor-dosen.js';
import { renderHeart, revealHeart } from './editor-heart.js';
import { renderRaw } from './raw.js';
import { renderHistory } from './history.js';

const EDITORS = {
  links: { render: renderLinks },
  announcements: { render: renderAnnouncements, reveal: revealAnnouncement },
  schedule: { render: renderSchedule, reveal: revealSchedule },
  dosen: { render: renderDosen, reveal: revealDosen },
  heart: { render: renderHeart, reveal: revealHeart },
};
const MODES = [
  ['form', 'Form'],
  ['json', 'JSON'],
  ['history', 'Riwayat'],
];

export function startApp(root, { backend, user, docs, embed = false }) {
  const keys = Object.keys(docs);
  const uiState = Object.fromEntries(keys.map((k) => [k, {}]));
  let key = keys[0];
  let mode = 'form';
  let busy = false;

  // Shell
  const navButtons = {};
  const nav = h(
    'nav',
    { class: 'keys', 'aria-label': 'Konten' },
    keys.map((k) => {
      const dot = h('span', { class: 'dirty-mark', hidden: true }, h('span', { class: 'sr-only' }, ' (belum disimpan)'));
      const b = h('button', { type: 'button', class: 'key-b', onclick: () => go(k, 'form') }, KEY_INFO[k].title, dot);
      navButtons[k] = { b, dot };
      return b;
    }),
  );
  const title = h('h1', { tabIndex: -1 });
  const source = h('p', { class: 'meta source' });
  const stateChip = h('span', { class: 'state' });
  const banners = h('div', { class: 'banners' });
  const issues = h('div', { class: 'issues-sum' });
  const modeBar = h('div', { class: 'seg', role: 'group', 'aria-label': 'Mode' });
  const editor = h('div', { class: 'editor' });
  const saveState = h('p', { class: 'savebar-state', 'aria-live': 'polite' });
  const discardBtn = h('button', { type: 'button', class: 'btn ghost', onclick: discard }, 'Batalkan perubahan');
  const saveBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => ctx().save() }, 'Simpan');

  replace(
    root,
    h(
      'div',
      { class: 'app' },
      h(
        'header',
        { class: 'top' },
        h('p', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'Alphangers'), h('span', { class: 'brand-sub' }, 'Admin')),
        h(
          'div',
          { class: 'who' },
          h('span', { class: 'who-name', title: `UID ${user.uid}` }, user.email || user.name),
          embed ? null : h('a', { class: 'btn ghost sm who-live', href: '/?admin', title: 'Buka portal dengan Lihat, Edit dan Panel' }, 'Ke halaman'),
          h('button', { type: 'button', class: 'btn ghost sm', onclick: signOut }, 'Keluar'),
        ),
      ),
      nav,
      h(
        'main',
        { id: 'main', class: 'main' },
        h('div', { class: 'doc-head' }, h('div', null, title, source), stateChip),
        banners,
        h(
          'div',
          { class: 'toolbar' },
          modeBar,
          h(
            'div',
            { class: 'tools' },
            h('button', { type: 'button', class: 'btn ghost sm', onclick: () => exportJson(ctx()) }, 'Ekspor JSON'),
            h('button', { type: 'button', class: 'btn ghost sm', onclick: () => importJson(ctx()) }, 'Impor JSON'),
            h('button', { type: 'button', class: 'btn ghost sm danger-text', onclick: () => resetToBundled(ctx()) }, 'Kembalikan ke bawaan'),
          ),
        ),
        issues,
        editor,
      ),
      h('div', { class: 'savebar' }, h('div', { class: 'savebar-in' }, saveState, h('div', { class: 'row-actions' }, discardBtn, saveBtn))),
    ),
  );

  function ctx() {
    const doc = docs[key];
    return {
      doc,
      docs,
      backend,
      user,
      ui: uiState[key],
      changed: () => doc.refresh(),
      rerender: () => renderAll(),
      setMode: (m) => go(key, m),
      setBusy,
      save: () => (busy ? null : reviewAndSave(ctx())),
    };
  }

  function setBusy(on) {
    busy = on;
    saveBtn.disabled = on;
    discardBtn.disabled = on;
    saveBtn.textContent = on ? 'Menyimpan…' : 'Simpan';
    root.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  /* ---------- chrome that follows the draft ---------- */

  function paintChrome() {
    const doc = docs[key];
    for (const k of keys) navButtons[k].dot.hidden = !docs[k].dirty;
    stateChip.className = `state ${doc.dirty ? 'dirty' : doc.base.exists ? 'saved' : 'bundled'}`;
    stateChip.textContent = doc.dirty ? 'Belum disimpan' : doc.base.exists ? 'Tersimpan' : 'Versi bawaan';
    const errs = doc.result ? doc.result.errors.length : 0;
    saveState.textContent = doc.dirty ? (errs ? `Ada perubahan, ${errs} error harus dibereskan.` : 'Ada perubahan yang belum disimpan.') : 'Semua tersimpan.';
    saveBtn.disabled = busy || !doc.dirty;
    discardBtn.disabled = busy || !doc.dirty;
    paintIssueSummary(doc);
    paintIssues(editor, doc.result);
    paintBadges(editor, doc.result);
  }
  const paintSoon = debounce(paintChrome, 120);

  function paintIssueSummary(doc) {
    clear(issues);
    const r = doc.result;
    if (!r || !doc.dirty || !r.errors.length) return;
    const rows = r.errors.slice(0, 8).map((e) =>
      h(
        'li',
        null,
        h('button', { type: 'button', class: 'link', onclick: () => reveal(e.path) }, pathLabel(doc.draft, e.path)),
        ' ',
        e.msg,
      ),
    );
    issues.append(
      h(
        'div',
        { class: 'banner err', role: 'region', 'aria-label': 'Error' },
        h('p', null, h('b', null, `${r.errors.length} error`), ' harus dibereskan sebelum simpan.'),
        h('ul', { class: 'issues err' }, rows, r.errors.length > 8 ? h('li', null, `dan ${r.errors.length - 8} lainnya`) : null),
      ),
    );
  }

  function reveal(path) {
    const ed = EDITORS[key];
    if (ed.reveal) ed.reveal(ctx(), path);
    go(key, 'form');
    focusSoon(() => {
      const el = $(`.fld[data-path="${CSS.escape(path.join('.'))}"]`, editor);
      const control = el && el.querySelector('input, textarea, select, button');
      if (el) el.scrollIntoView({ block: 'center' });
      return control;
    });
  }

  /* ---------- head, banners, body ---------- */

  function paintHead() {
    const doc = docs[key];
    const info = KEY_INFO[key];
    title.textContent = info.title;
    document.title = `${info.title} · Admin Alphangers`;
    if (doc.base.exists) {
      const by = doc.base.updatedBy === user.uid ? 'kamu' : doc.base.updatedBy ? `uid ${doc.base.updatedBy.slice(0, 8)}…` : '';
      source.textContent = `Firestore rev ${doc.base.rev}, disimpan ${fmtRelative(doc.base.updatedAt)}${by ? ` oleh ${by}` : ''}`;
      source.title = doc.base.updatedAt ? fmtWhen(doc.base.updatedAt) : '';
    } else {
      source.textContent = 'Versi bawaan dari repo. Belum pernah disimpan ke Firestore.';
      source.title = '';
    }
    for (const [k, { b }] of Object.entries(navButtons)) b.setAttribute('aria-current', k === key ? 'page' : 'false');

    replace(modeBar, 
      ...MODES.map(([m, label]) => h('button', { type: 'button', class: 'seg-b', 'aria-pressed': m === mode ? 'true' : 'false', onclick: () => go(key, m) }, label)),
    );

    clear(banners);
    if (doc.base.invalid) {
      banners.append(
        h('div', { class: 'banner err' }, h('p', null, h('b', null, 'Dokumen di server tidak valid. '), `Portal mengabaikannya dan memakai cadangan. Yang tampil di sini versi bawaan; simpan untuk menimpa rev ${doc.base.rev}.`)),
      );
    }
    if (doc.pending) {
      const p = doc.pending;
      banners.append(
        h(
          'div',
          { class: 'banner warn' },
          h('p', null, `Ada draf yang belum disimpan dari ${fmtRelative(p.at)}.${p.baseRev !== doc.base.rev ? ' Versi di server sudah berubah sejak itu, jadi cek perubahannya baik-baik sebelum simpan.' : ''}`),
          h(
            'div',
            { class: 'row-actions' },
            h('button', { type: 'button', class: 'btn sm', onclick: () => (doc.restorePending(), renderAll()) }, 'Pulihkan draf'),
            h('button', { type: 'button', class: 'btn ghost sm', onclick: () => (doc.dismissPending(), renderAll()) }, 'Buang'),
          ),
        ),
      );
    }
  }

  function renderBody() {
    const y = window.scrollY;
    clear(editor);
    const c = ctx();
    if (mode === 'json') renderRaw(editor, c);
    else if (mode === 'history') renderHistory(editor, c);
    else EDITORS[key].render(editor, c);
    paintChrome();
    window.scrollTo(0, y);
  }

  function renderAll() {
    paintHead();
    renderBody();
  }

  async function go(k, m) {
    if (mode === 'json' && uiState[key].rawPending && (k !== key || m !== 'json')) {
      const ok = await confirmDialog({ title: 'JSON belum valid', text: 'Teks JSON yang belum valid tidak masuk draf dan akan dibuang. Lanjut?', confirm: 'Buang dan lanjut' });
      if (!ok) return;
      uiState[key].rawPending = false;
    }
    const changedKey = k !== key;
    key = k;
    mode = m;
    const hash = `#${k}${m === 'form' ? '' : '/' + m}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
    renderAll();
    if (changedKey) {
      window.scrollTo(0, 0);
      title.focus();
    }
  }

  async function discard() {
    const doc = docs[key];
    const ok = await confirmDialog({ title: 'Batalkan perubahan?', text: `Semua perubahan di ${KEY_INFO[key].title} yang belum disimpan dibuang.`, confirm: 'Buang perubahan', danger: true });
    if (!ok) return;
    doc.discard();
    renderBody();
    toast('Perubahan dibuang.');
  }

  async function signOut() {
    const dirty = keys.filter((k) => docs[k].dirty).map((k) => KEY_INFO[k].title);
    if (dirty.length) {
      const ok = await confirmDialog({
        title: 'Keluar sekarang?',
        text: `Ada perubahan belum disimpan di ${dirty.join(', ')}. Drafnya tetap tersimpan di perangkat ini dan bisa dipulihkan nanti.`,
        confirm: 'Keluar',
      });
      if (!ok) return;
    }
    for (const k of keys) docs[k].flushDraft();
    await backend.signOut();
  }

  // Unsaved changes guard. Drafts are also kept in localStorage, but a
  // reminder before leaving is cheaper than a restore.
  window.addEventListener('beforeunload', (e) => {
    for (const k of keys) docs[k].flushDraft();
    // inside the portal the drafts carry over to the page editor, so no reminder there
    if (!embed && keys.some((k) => docs[k].dirty)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!document.querySelector('dialog[open]')) ctx().save();
    }
  });
  window.addEventListener('hashchange', () => fromHash());

  for (const k of keys) docs[k].onChange((doc) => doc.key === key && paintSoon());
  for (const k of keys) docs[k].onChange(() => paintNavSoon());
  const paintNavSoon = debounce(() => {
    for (const k of keys) navButtons[k].dot.hidden = !docs[k].dirty;
  }, 150);

  function fromHash() {
    const [k, m] = location.hash.replace(/^#/, '').split('/');
    go(keys.includes(k) ? k : keys[0], MODES.some(([x]) => x === m) ? m : 'form');
  }
  fromHash();
}
