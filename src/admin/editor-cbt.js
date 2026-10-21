// The "Peserta try out" tab: who may open the class's try outs. Unlike the other tabs this is not
// a content document with a draft and a save button. Every action goes straight to the try out
// server (/api/cbt/admin, see cbt-api.js) and the list is drawn again from the server's answer,
// keeping the search, the filter, the scroll position and the focused button where they were.
import { h, replace, clear, nextId, $ } from './dom.js';
import { confirmDialog, openDialog, toast } from './ui.js';
import { fold, fmtRelative, fmtWhen } from './format.js';
import { cbtAdmin, explainCbt, checkNewPerson } from './cbt-api.js';
import { heldSetupCode } from './setup-link.js';
import { displayName } from '../lib/names.js';

export const TRYOUT = {
  key: 'tryout',
  title: 'Peserta try out',
  sub: 'Siapa yang boleh membuka soal try out kelas. Setiap perubahan di sini langsung berlaku.',
  noSave: 'Tidak ada yang perlu disimpan di sini. Setiap perubahan langsung tersimpan di server.',
};

const STALE_MS = 60_000;
const LOG_PAGE = 30;

const FILTERS = [
  ['all', 'Semua', () => true],
  ['in', 'Sudah masuk', (p) => !!p.claim],
  ['out', 'Belum masuk', (p) => !p.claim],
  ['check', 'Perlu dicek', (p) => !!p.claim && (p.claim.match === 'none' || p.claim.match === 'partial')],
  ['blocked', 'Diblokir', (p) => p.blocked],
];

const EMPTY = {
  in: 'Belum ada yang masuk.',
  out: 'Semua orang di daftar sudah masuk.',
  check: 'Tidak ada akun yang perlu dicek.',
  blocked: 'Tidak ada yang diblokir.',
};

// How the server compared the Google account with the name on the list: badge, then what it means.
const MATCH = {
  nim: ['cocok via NIM', 'Alamat emailnya memuat NIM ini.'],
  name: ['cocok', 'Nama akun Google atau alamat emailnya sesuai dengan nama di daftar.'],
  partial: ['mirip', 'Hanya sebagian nama akun Google-nya yang sama dengan nama di daftar. Biasanya nama panggilan, tapi kalau ragu tanyakan ke orangnya.'],
  none: ['perlu dicek', 'Nama dan email akun ini tidak mirip dengan nama di daftar. Bisa jadi akun pribadi dengan nama lain, bisa juga orang yang memakai NIM teman. Pastikan dulu.'],
};

const HOW = [
  'Teman sekelas masuk try out pakai akun Google, lalu mengetik NIM-nya sekali. Sejak itu NIM itu terikat ke akun tersebut dan tidak bisa dipakai akun lain.',
  'Kecocokan membandingkan nama dan email akun Google dengan nama di daftar: cocok via NIM (emailnya memuat NIM), cocok, mirip (hanya sebagian nama yang sama), atau perlu dicek (tidak ada yang mirip).',
  'Yang diblokir tetap bisa masuk, tapi soalnya tidak terbuka dan dia hanya melihat pesan netral. Teman lain tidak bisa tahu siapa yang diblokir.',
  'Kalau ada yang salah ketik NIM atau masuk dengan akun yang salah, lepas akunnya supaya NIM itu bebas lagi. Kalau akunnya bukan milik teman sekelas, blokir akun Google-nya.',
  'Hapus dari daftar ikut melepas akunnya, tapi akun itu masih bisa mengetik NIM lain yang belum terpakai. Untuk menutup satu akun sepenuhnya, blokir akun Google-nya.',
  'Perubahan berlaku begitu perangkat peserta mengecek ke server lagi, paling lama sekitar satu jam selama online. Perangkat yang terus offline menyimpan kunci soal paling lama 7 hari.',
];

// Log entries worth a second look get an amber mark.
const WARN = new Set(['conflict', 'closed']);

/** The field takes the code itself or the whole setup link. */
export function setupSecret(raw) {
  const t = String(raw || '').trim();
  const m = /pasang=([^\s&#]+)/.exec(t);
  if (!m) return t.replace(/\s+/g, '');
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * One log entry in plain words. nameOf(nim) gives a name or '', me is the signed-in admin's
 * email, blockedAccount(uid) says whether that Google account is blocked now.
 */
export function logLine(e, { nameOf = () => '', me = '', blockedAccount = () => false } = {}) {
  const by = !e.by ? 'Admin' : e.by.toLowerCase() === me ? 'Kamu' : e.by;
  const person = e.nim ? nameOf(e.nim) : '';
  const nimRef = `NIM ${e.nim}${person ? ` (${person})` : ''}`;
  const target = person || (e.nim ? `NIM ${e.nim}` : 'seseorang');
  const withNim = person && e.nim ? `${person} (${e.nim})` : target;
  const acct = e.email ? (e.gname ? `${e.gname} (${e.email})` : e.email) : e.gname || 'Akun tanpa email';
  switch (e.kind) {
    case 'conflict':
      return `${acct} mencoba ${nimRef} yang sudah dipakai akun lain.`;
    case 'closed':
      return blockedAccount(e.uid) ? `${acct}, akun yang sedang diblokir, masuk dengan ${nimRef}.` : `${acct} masuk dengan ${nimRef} yang sedang diblokir.`;
    case 'block':
      return `${by} memblokir ${target}.`;
    case 'unblock':
      return `${by} membuka blokir ${target}.`;
    case 'release':
      return `${by} melepas akun${e.email || e.gname ? ' ' + (e.email || e.gname) : ''} dari ${target}.`;
    case 'blockAccount':
      return `${by} memblokir akun Google ${acct}.`;
    case 'unblockAccount':
      return `${by} membuka blokir akun Google ${acct}.`;
    case 'add':
      return `${by} menambahkan ${withNim} ke daftar.`;
    case 'remove':
      return `${by} menghapus ${withNim} dari daftar${e.email ? ` dan melepas akun ${e.email}` : ''}.`;
    case 'install':
      return `${by} memasang kode setup. Server mulai bisa membuka daftar kelas.`;
    default:
      return `Kejadian lain di server (${e.kind})${e.by ? `, oleh ${by}` : ''}.`;
  }
}

const asDate = (at) => {
  const d = new Date(at);
  return Number.isNaN(+d) ? null : d;
};

function when(at) {
  const d = asDate(at);
  if (!d) return '';
  const rel = fmtRelative(d);
  const abs = fmtWhen(d);
  return rel === abs ? abs : `${abs} (${rel})`;
}

export function renderTryout(host, { backend, user }) {
  const me = String(user.email || '').toLowerCase();
  const ui = { q: '', filter: 'all', open: new Set(), keep: new Set(), logShown: LOG_PAGE };
  let data = null; // the server's last answer, normalised by cbt-api.js
  let loadedAt = 0;
  let loadError = null;
  let loading = false;
  let installing = false;
  let adding = false;
  let addForm = null;
  let code = heldSetupCode(); // from a setup link, until the setup field takes it
  const busy = new Map(); // NIM or account uid -> what the server is doing for it
  const names = new Map(); // NIM -> name, kept after a removal so the log can still say who
  let queue = Promise.resolve();

  /* ---------- the parts that stay: search, add button, setup field ---------- */

  const statusBox = h('section', { class: 'cbt-status' });
  const countsBox = h('ul', { class: 'cbt-counts', 'aria-label': 'Ringkasan' });
  const how = h('details', { class: 'panel cbt-how' }, h('summary', null, 'Cara kerja akses try out'), h('ul', { class: 'plain' }, HOW.map((t) => h('li', null, t))));
  const searchId = nextId('cbt-q');
  const search = h('input', { type: 'search', id: searchId, placeholder: 'Nama, NIM, atau email', autocomplete: 'off', spellcheck: false });
  search.addEventListener('input', () => {
    ui.q = search.value;
    ui.keep.clear();
    paintPeople();
  });
  const addBtn = h('button', { type: 'button', class: 'btn', 'aria-expanded': 'false', onclick: openAdd }, 'Tambah orang');
  const filterBar = h('div', { class: 'seg cbt-filter', role: 'group', 'aria-label': 'Saring' });
  const addHost = h('div', { class: 'cbt-add-host' });
  const count = h('p', { class: 'mono meta', 'aria-live': 'polite' });
  const results = h('div', { class: 'cbt-results' });
  const peopleSec = h(
    'section',
    { class: 'cbt-sec', 'aria-labelledby': 'cbt-people-h' },
    h('h2', { class: 'cbt-h', id: 'cbt-people-h' }, 'Daftar peserta'),
    h('div', { class: 'bar' }, h('div', { class: 'fld grow' }, h('label', { htmlFor: searchId }, 'Cari peserta'), search), addBtn),
    filterBar,
    addHost,
    count,
    results,
  );
  const acctBox = h('div');
  const acctSec = h(
    'section',
    { class: 'cbt-sec cbt-accts', 'aria-labelledby': 'cbt-accts-h' },
    h('h2', { class: 'cbt-h', id: 'cbt-accts-h', tabIndex: -1 }, 'Akun Google yang diblokir'),
    h('p', { class: 'hint' }, 'Akun di sini tidak bisa membuka soal try out dengan NIM mana pun.'),
    acctBox,
  );
  const logBox = h('div');
  const logSec = h(
    'section',
    { class: 'cbt-sec cbt-log', 'aria-labelledby': 'cbt-log-h' },
    h('h2', { class: 'cbt-h', id: 'cbt-log-h' }, 'Catatan'),
    h('p', { class: 'hint' }, 'Terbaru di atas: percobaan NIM yang bermasalah dan setiap perubahan oleh admin.'),
    logBox,
  );

  const codeId = nextId('cbt-code');
  const codeInput = h('input', {
    type: 'text', id: codeId, class: 'mono', maxLength: 400, autocomplete: 'off', spellcheck: false, autocapitalize: 'off',
    'aria-describedby': `${codeId}-hint ${codeId}-msg`,
  });
  codeInput.addEventListener('input', () => setupError(''));
  const codeMsg = h('p', { class: 'msg', id: `${codeId}-msg` });
  const installBtn = h('button', { type: 'submit', class: 'btn primary' }, 'Pasang');
  const setupFld = h(
    'div',
    { class: 'fld' },
    h('label', { htmlFor: codeId }, 'Kode setup'),
    h('div', { class: 'cbt-setup-row' }, codeInput, installBtn),
    h('p', { class: 'hint', id: `${codeId}-hint` }, 'Tempel kode setup, atau link setup yang berakhiran #tryout/pasang= beserta kodenya. Cukup dipasang sekali, lalu server menyimpannya.'),
    codeMsg,
  );
  const setupForm = h('form', { class: 'cbt-setup', novalidate: true, onsubmit: install }, setupFld);

  replace(host, statusBox, countsBox, how, peopleSec, acctSec, logSec);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && host.isConnected && !host.hidden) refreshIfStale();
  });

  render();
  load();

  /* ---------- talking to the server ---------- */

  // One request at a time, so answers are applied in the order they were asked for.
  function enqueue(job) {
    const run = queue.then(job);
    queue = run.catch(() => {});
    return run;
  }

  function accept(next) {
    data = next;
    loadedAt = Date.now();
    for (const p of next.people) names.set(p.nim, displayName(p.name));
  }

  function load({ quiet = false } = {}) {
    if (loading) return queue;
    loading = true;
    if (!quiet) paintStatus();
    return enqueue(async () => {
      try {
        accept(await cbtAdmin(backend));
        loadError = null;
      } catch (e) {
        if (data) toast(explainCbt(e), 'err', 7000);
        else loadError = e;
      } finally {
        loading = false;
        render();
      }
    });
  }

  function refreshIfStale() {
    if (!loading && !busy.size && Date.now() - loadedAt > STALE_MS) load({ quiet: !!data });
  }

  // Sends one change for a row (id is its NIM, or an account's uid). The row shows the wait at
  // once; the server's answer then redraws everything. `from` is the button that asked, `focus`
  // the one that should have focus afterwards.
  function change(id, doing, run, { op, done, from, focus }) {
    busy.set(id, doing);
    render({ focus: from });
    return enqueue(async () => {
      try {
        accept(await run());
        busy.delete(id);
        render({ focus: typeof focus === 'function' ? focus() : focus });
        toast(done);
      } catch (e) {
        busy.delete(id);
        render({ focus: from });
        toast(explainCbt(e, op), 'err', 8000);
        // the list moved under us (someone else changed it): show the server's current one
        if (e.status === 404 || e.status === 409) load({ quiet: true });
      }
    });
  }

  /* ---------- drawing ---------- */

  function render({ focus } = {}) {
    const y = window.scrollY;
    const active = document.activeElement;
    const want = focus || (active && host.contains(active) ? active.dataset.k : null);
    paintStatus();
    const ready = !!data && data.ready;
    for (const el of [countsBox, how, peopleSec, acctSec, logSec]) el.hidden = !ready;
    if (ready) {
      paintCounts();
      paintFilter();
      paintPeople();
      paintAccounts();
      paintLog();
    }
    window.scrollTo(0, y);
    refocus(want);
  }

  function refocus(k) {
    if (!k) return;
    const el = k === 'status' ? $('.cbt-status h2', host) : host.querySelector(`[data-k="${CSS.escape(k)}"]`);
    if (!el || el === document.activeElement) return;
    el.focus({ preventScroll: true });
    // scroll only when it would otherwise be out of sight
    const r = el.getBoundingClientRect();
    if (r.bottom < 60 || r.top > window.innerHeight - 10) el.scrollIntoView({ block: 'center' });
  }

  function paintStatus() {
    const dot = h('span', { class: 'cbt-dot', 'aria-hidden': 'true' });
    if (!data) {
      statusBox.className = 'cbt-status';
      if (loadError && !loading) {
        replace(
          statusBox,
          h(
            'div',
            { class: 'banner err' },
            h('p', null, h('b', null, 'Daftar peserta gagal dimuat. '), explainCbt(loadError)),
            h('div', null, h('button', { type: 'button', class: 'btn sm', 'data-k': 'retry', onclick: () => load() }, 'Coba lagi')),
          ),
        );
      } else replace(statusBox, h('p', { class: 'cbt-wait' }, 'Menghubungi server try out…'));
      return;
    }
    if (!data.ready) {
      statusBox.className = 'cbt-status is-setup';
      if (code) {
        codeInput.value = code;
        code = '';
        setupError('');
      }
      replace(
        statusBox,
        h('h2', { tabIndex: -1 }, dot, 'Server try out belum siap'),
        h('p', null, 'Server belum punya kode setup, jadi daftar kelas belum bisa dibuka dan belum ada yang bisa membuka soal try out.'),
        setupForm,
      );
      return;
    }
    if (code) {
      code = '';
      toast('Server sudah punya kode setup, jadi link setup tadi tidak dipakai.', 'warn');
    }
    statusBox.className = 'cbt-status is-ready';
    replace(
      statusBox,
      h(
        'div',
        { class: 'cbt-status-head' },
        h('h2', { tabIndex: -1 }, dot, 'Server try out siap'),
        h('button', { type: 'button', class: 'btn ghost sm', 'data-k': 'reload', 'aria-disabled': loading ? 'true' : null, onclick: () => loading || load() }, loading ? 'Memuat…' : 'Muat ulang'),
      ),
      h('p', null, `Daftar kelas terbuka, jadi yang ada di daftar bisa membuka soal. ${data.source === 'env' ? 'Kode setup diambil dari pengaturan situs di Netlify.' : 'Kode setup tersimpan di server.'}`),
      h('p', { class: 'mono meta' }, `Dimuat ${fmtWhen(new Date(loadedAt))}`),
    );
  }

  function paintCounts() {
    const ps = data.people;
    replace(
      countsBox,
      [
        ['orang di daftar', ps.length],
        ['sudah masuk', ps.filter((p) => p.claim).length],
        ['diblokir', ps.filter((p) => p.blocked).length],
      ].map(([label, n]) => h('li', null, h('span', { class: 'n' }, String(n)), h('span', { class: 'l' }, label))),
    );
  }

  function paintFilter() {
    replace(
      filterBar,
      FILTERS.map(([id, label, test]) =>
        h(
          'button',
          { type: 'button', class: 'seg-b', 'data-k': `filter:${id}`, 'aria-pressed': ui.filter === id ? 'true' : 'false', onclick: () => setFilter(id) },
          label,
          ' ',
          h('span', { class: 'n' }, String(data.people.filter(test).length)),
        ),
      ),
    );
  }

  function setFilter(id) {
    ui.filter = id;
    ui.keep.clear();
    for (const b of filterBar.children) b.setAttribute('aria-pressed', b.dataset.k === `filter:${id}` ? 'true' : 'false');
    paintPeople();
  }

  function visible() {
    const test = FILTERS.find(([id]) => id === ui.filter)[2];
    const terms = fold(ui.q).split(/\s+/).filter(Boolean);
    const hay = (p) => [fold(names.get(p.nim)), p.nim, fold(p.claim?.gname), fold(p.claim?.email)].join(' ');
    return data.people
      .filter((p) => ui.keep.has(p.nim) || (test(p) && terms.every((t) => hay(p).includes(t))))
      .sort((a, b) => names.get(a.nim).localeCompare(names.get(b.nim), 'id'));
  }

  function paintPeople() {
    const list = visible();
    const total = data.people.length;
    count.textContent = ui.q || ui.filter !== 'all' ? `${list.length} dari ${total} orang` : `${total} orang, urut nama`;
    if (list.length) replace(results, h('ul', { class: 'people cbt-list' }, list.map(personRow)));
    else replace(results, emptyState(total));
  }

  function emptyState(total) {
    if (!total) return h('div', { class: 'empty' }, h('p', null, 'Daftar masih kosong.'), h('p', { class: 'hint' }, 'Tambahkan orang dengan tombol Tambah orang.'));
    const label = FILTERS.find(([id]) => id === ui.filter)[1];
    return h(
      'div',
      { class: 'empty' },
      h('p', null, ui.q ? 'Tidak ada yang cocok.' : EMPTY[ui.filter]),
      ui.q ? h('p', { class: 'hint' }, `Pencarian "${ui.q.trim()}"${ui.filter === 'all' ? '' : ` di ${label}`}. Coba sebagian nama atau beberapa angka NIM.`) : null,
      h(
        'div',
        null,
        h('button', {
          type: 'button',
          class: 'btn sm',
          onclick: () => {
            ui.q = '';
            search.value = '';
            setFilter('all');
            refocus('filter:all');
          },
        }, 'Tampilkan semua'),
      ),
    );
  }

  function personRow(p) {
    const name = names.get(p.nim);
    const c = p.claim;
    const acct = c ? data.accounts.find((a) => a.uid === c.uid) : null;
    const doing = busy.get(p.nim) || (c && busy.get(c.uid));
    const isOpen = ui.open.has(p.nim);
    const panelId = `cbt-row-${p.nim}`;
    const marks = [
      p.blocked ? h('span', { class: 'chip is-blocked' }, 'Diblokir') : null,
      acct ? h('span', { class: 'chip is-acct-blocked' }, 'Akun diblokir') : null,
      p.added ? h('span', { class: 'chip muted' }, 'Ditambah admin') : null,
      doing ? h('span', { class: 'cbt-doing' }, doing) : null,
    ].filter(Boolean);
    const head = h(
      'div',
      { class: 'person-head' },
      h(
        'button',
        { type: 'button', class: 'disclose', 'data-k': `${p.nim}:open`, 'aria-expanded': isOpen ? 'true' : 'false', 'aria-controls': isOpen ? panelId : null, onclick: () => toggle(p.nim) },
        h('span', { class: 'person-name cbt-name' }, name),
        h('span', { class: 'person-meta mono' }, p.nim),
      ),
      h(
        'div',
        { class: 'cbt-acct' },
        c ? [h('span', { class: `chip m-${c.match}` }, MATCH[c.match][0]), h('span', { class: 'cbt-who' }, c.gname ? h('span', { class: 'cbt-gname' }, c.gname) : null, h('span', { class: 'cbt-mail' }, c.email))] : h('span', { class: 'cbt-none' }, 'Belum masuk'),
      ),
      marks.length ? h('div', { class: 'chips' }, marks) : null,
    );
    const row = h('li', { class: 'person cbt-p', 'aria-busy': doing ? 'true' : null }, head);
    if (!isOpen) return row;

    const act = (k, text, label, run, extra = '') =>
      h('button', { type: 'button', class: `btn sm${extra}`, 'data-k': `${p.nim}:${k}`, 'aria-label': label, 'aria-disabled': doing ? 'true' : null, onclick: () => doing || run() }, text);
    row.classList.add('open');
    row.append(
      h(
        'div',
        { class: 'cbt-panel', id: panelId },
        h(
          'dl',
          { class: 'cbt-facts' },
          fact('Akun Google', c ? (c.gname ? `${c.gname} · ${c.email}` : c.email) : 'Belum ada. Begitu dia masuk dan mengetik NIM ini, akunnya muncul di sini.'),
          c ? fact('Masuk', when(c.at)) : null,
          c ? fact('Kecocokan', MATCH[c.match][1]) : null,
          p.blocked ? fact('Akses', 'Diblokir. Kalau dia masuk, dia hanya melihat pesan netral dan soalnya tidak terbuka.') : null,
          acct ? fact('Akun', `Akun Google ini diblokir ${fmtRelative(asDate(acct.at)) || ''}, jadi soal tidak terbuka dengan NIM mana pun.`.replace(' ,', ',')) : null,
          p.added ? fact('Asal', 'Ditambah admin, tidak ada di daftar kelas.') : null,
        ),
        h(
          'div',
          { class: 'cbt-acts' },
          p.blocked ? act('block', 'Buka blokir', `Buka blokir ${name}`, () => unblock(p)) : act('block', 'Blokir', `Blokir ${name}`, () => block(p)),
          c ? act('release', 'Lepas akun', `Lepas akun ${c.email} dari ${name}`, () => release(p)) : null,
          c && acct ? act('acct', 'Buka blokir akun Google ini', `Buka blokir akun Google ini (${c.email})`, () => unblockAccount(acct, `${p.nim}:acct`, `${p.nim}:acct`)) : null,
          c && !acct ? act('acct', 'Blokir akun Google ini', `Blokir akun Google ini (${c.email})`, () => blockAccount(p)) : null,
          act('remove', 'Hapus dari daftar', `Hapus dari daftar: ${name}`, () => remove(p), ' ghost danger-text'),
        ),
      ),
    );
    return row;
  }

  function fact(label, value) {
    return h('div', null, h('dt', null, label), h('dd', null, value));
  }

  function toggle(nim) {
    if (ui.open.has(nim)) ui.open.delete(nim);
    else ui.open.add(nim);
    paintPeople();
    refocus(`${nim}:open`);
  }

  function paintAccounts() {
    const list = [...data.accounts].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (!list.length) {
      replace(acctBox, h('p', { class: 'cbt-quiet' }, 'Belum ada akun yang diblokir.'));
      return;
    }
    replace(
      acctBox,
      h(
        'ul',
        { class: 'cbt-acct-list' },
        list.map((a, i) => {
          const doing = busy.get(a.uid);
          const bound = data.people.find((p) => p.claim && p.claim.uid === a.uid);
          const by = !a.by ? '' : a.by.toLowerCase() === me ? ' oleh kamu' : ` oleh ${a.by}`;
          const next = list[i + 1] || list[i - 1];
          return h(
            'li',
            { 'aria-busy': doing ? 'true' : null },
            h(
              'div',
              { class: 'cbt-acct-main' },
              h('p', { class: 'cbt-acct-who' }, a.gname ? h('span', { class: 'cbt-gname' }, a.gname) : null, h('span', { class: 'cbt-mail' }, a.email || a.uid)),
              h('p', { class: 'meta' }, `Diblokir ${fmtRelative(asDate(a.at)) || ''}${by}.`.replace(' .', '.'), bound ? ` Masih terikat ke ${names.get(bound.nim)}.` : ''),
              doing ? h('span', { class: 'cbt-doing' }, doing) : null,
            ),
            h('button', {
              type: 'button',
              class: 'btn sm',
              'data-k': `acct:${a.uid}`,
              'aria-label': `Buka blokir ${a.email || a.gname || 'akun ini'}`,
              'aria-disabled': doing ? 'true' : null,
              onclick: () => doing || unblockAccount(a, `acct:${a.uid}`, next ? `acct:${next.uid}` : 'accts'),
            }, 'Buka blokir'),
          );
        }),
      ),
    );
  }

  function paintLog() {
    const all = data.log;
    if (!all.length) {
      replace(logBox, h('p', { class: 'cbt-quiet' }, 'Belum ada catatan.'));
      return;
    }
    const helpers = { nameOf: (nim) => names.get(nim) || '', me, blockedAccount: (uid) => data.accounts.some((a) => a.uid === uid) };
    const shown = all.slice(0, ui.logShown);
    const rest = all.length - shown.length;
    replace(
      logBox,
      h(
        'ol',
        { class: 'cbt-log-list' },
        shown.map((e) => {
          const d = asDate(e.at);
          const listed = WARN.has(e.kind) && data.people.some((p) => p.nim === e.nim);
          return h(
            'li',
            { class: WARN.has(e.kind) ? 'is-warn' : null },
            h('p', null, logLine(e, helpers), listed ? [' ', h('button', { type: 'button', class: 'link', onclick: () => reveal(e.nim) }, `Lihat ${names.get(e.nim)}`)] : null),
            d ? h('time', { dateTime: e.at, title: fmtWhen(d) }, fmtRelative(d)) : null,
          );
        }),
      ),
      rest > 0
        ? h('button', {
            type: 'button',
            class: 'btn ghost sm cbt-more',
            'data-k': 'log-more',
            onclick: () => {
              ui.logShown += LOG_PAGE;
              paintLog();
              refocus('log-more');
            },
          }, `Tampilkan ${Math.min(LOG_PAGE, rest)} lagi`)
        : null,
    );
  }

  // From a log entry to that person's row, opened.
  function reveal(nim) {
    ui.q = nim;
    search.value = nim;
    ui.open.add(nim);
    setFilter('all');
    const el = host.querySelector(`[data-k="${CSS.escape(nim)}:open"]`);
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'center' });
    }
  }

  /* ---------- setup ---------- */

  function setupError(msg) {
    setupFld.classList.toggle('is-err', !!msg);
    codeMsg.textContent = msg;
    if (msg) codeInput.setAttribute('aria-invalid', 'true');
    else codeInput.removeAttribute('aria-invalid');
  }

  function install(e) {
    e.preventDefault();
    if (installing) return;
    const secret = setupSecret(codeInput.value);
    if (!secret) {
      setupError('Tempel kode setup-nya dulu.');
      codeInput.focus();
      return;
    }
    installing = true;
    setupError('');
    installBtn.textContent = 'Memasang…';
    installBtn.setAttribute('aria-disabled', 'true');
    enqueue(async () => {
      try {
        accept(await cbtAdmin(backend, { op: 'install', secret }));
        codeInput.value = '';
        toast('Kode setup terpasang. Daftar kelas sudah bisa dibuka.');
        render({ focus: 'status' });
      } catch (err) {
        setupError(explainCbt(err, 'install'));
        codeInput.focus();
        if (err.status === 409) load({ quiet: true });
      } finally {
        installing = false;
        installBtn.textContent = 'Pasang';
        installBtn.removeAttribute('aria-disabled');
      }
    });
  }

  /* ---------- actions on a person ---------- */

  async function block(p) {
    const name = names.get(p.nim);
    const ok = await confirmDialog({
      title: `Blokir ${name}?`,
      text: [
        `${name} (NIM ${p.nim}) tidak bisa membuka soal try out lagi. Kalau dia masuk, dia hanya melihat pesan netral tanpa kata blokir, dan teman lain tidak bisa tahu.`,
        p.claim
          ? `Akun ${p.claim.email} tetap terikat ke NIM ini. Blokirnya bisa dibuka lagi kapan saja.`
          : 'Belum ada akun yang masuk dengan NIM ini. Blokir tetap berlaku untuk akun mana pun yang nanti memakainya.',
        'Soal yang sudah terbuka di perangkatnya ikut tertutup begitu perangkat itu mengecek ke server, paling lama sekitar satu jam selama online.',
      ],
      confirm: 'Blokir',
      danger: true,
    });
    const k = `${p.nim}:block`;
    if (!ok) return refocus(k);
    change(p.nim, 'Memblokir…', () => cbtAdmin(backend, { op: 'block', nim: p.nim }), { op: 'block', done: `${name} diblokir.`, from: k, focus: k });
  }

  async function unblock(p) {
    const name = names.get(p.nim);
    const ok = await confirmDialog({
      title: `Buka blokir ${name}?`,
      text: `${name} (NIM ${p.nim}) bisa membuka soal try out lagi begitu perangkatnya mengecek ke server, atau langsung saat dia memuat ulang halaman try out.`,
      confirm: 'Buka blokir',
    });
    const k = `${p.nim}:block`;
    if (!ok) return refocus(k);
    change(p.nim, 'Membuka blokir…', () => cbtAdmin(backend, { op: 'unblock', nim: p.nim }), { op: 'unblock', done: `Blokir ${name} dibuka.`, from: k, focus: k });
  }

  async function release(p) {
    const name = names.get(p.nim);
    const c = p.claim;
    const ok = await confirmDialog({
      title: `Lepas akun dari ${name}?`,
      text: [
        `Akun ${c.gname ? `${c.gname} (${c.email})` : c.email} tidak lagi terikat ke NIM ${p.nim}. NIM ini bebas lagi, jadi ${name} bisa masuk dengan akun yang benar.`,
        'Pakai ini kalau ada yang salah ketik NIM atau masuk dengan akun yang salah. Akun tadi masih bisa masuk dan mengetik NIM yang belum terpakai, termasuk NIM ini. Kalau akun itu bukan milik teman sekelas, pakai Blokir akun Google ini.',
      ],
      confirm: 'Lepas akun',
      danger: true,
    });
    if (!ok) return refocus(`${p.nim}:release`);
    change(p.nim, 'Melepas akun…', () => cbtAdmin(backend, { op: 'release', nim: p.nim }), {
      op: 'release',
      done: `Akun ${c.email} dilepas dari ${name}.`,
      from: `${p.nim}:release`,
      focus: `${p.nim}:block`,
    });
  }

  async function blockAccount(p) {
    const name = names.get(p.nim);
    const c = p.claim;
    const freeId = nextId('cbt-free');
    const free = h('input', { type: 'checkbox', id: freeId, checked: true });
    const yes = await openDialog({
      title: 'Blokir akun Google ini?',
      body: [
        h('p', null, `Akun ${c.gname ? `${c.gname} (${c.email})` : c.email} tidak bisa membuka soal try out lagi, dengan NIM mana pun. Pemiliknya hanya melihat pesan netral.`),
        h('div', { class: 'fld check' }, free, h('label', { htmlFor: freeId }, `Lepaskan juga NIM ${p.nim} dari akun ini, supaya ${name} bisa masuk dengan akunnya sendiri.`)),
        h('p', { class: 'hint' }, 'Pakai ini untuk akun yang bukan milik teman sekelas, misalnya akun yang memakai NIM orang lain. Blokirnya bisa dibuka lagi di bagian Akun Google yang diblokir.'),
      ],
      actions: [
        { label: 'Batal', value: false, kind: 'ghost', autofocus: true },
        { label: 'Blokir akun', value: true, kind: 'danger' },
      ],
    });
    const k = `${p.nim}:acct`;
    if (yes !== true) return refocus(k);
    const alsoFree = free.checked;
    change(
      p.nim,
      'Memblokir akun…',
      async () => {
        const next = await cbtAdmin(backend, { op: 'blockAccount', uid: c.uid });
        const still = next.people.find((x) => x.nim === p.nim)?.claim;
        if (!alsoFree || !still || still.uid !== c.uid) return next;
        accept(next); // the account stays blocked even if freeing the NIM fails
        return cbtAdmin(backend, { op: 'release', nim: p.nim });
      },
      {
        op: 'blockAccount',
        done: alsoFree ? `Akun ${c.email} diblokir dan NIM ${name} bebas lagi.` : `Akun ${c.email} diblokir.`,
        from: k,
        focus: () => (host.querySelector(`[data-k="${CSS.escape(k)}"]`) ? k : `${p.nim}:block`),
      },
    );
  }

  async function unblockAccount(a, from, after) {
    const ok = await confirmDialog({
      title: `Buka blokir ${a.email || a.gname || 'akun ini'}?`,
      text: `Akun ${a.gname && a.email ? `${a.gname} (${a.email})` : a.email || a.gname || a.uid} bisa membuka soal try out lagi kalau terikat ke NIM yang ada di daftar, atau setelah mengetik NIM yang belum terpakai.`,
      confirm: 'Buka blokir',
    });
    if (!ok) return refocus(from);
    change(a.uid, 'Membuka blokir…', () => cbtAdmin(backend, { op: 'unblockAccount', uid: a.uid }), {
      op: 'unblockAccount',
      done: `Blokir akun ${a.email || a.gname} dibuka.`,
      from,
      focus: () => (host.querySelector(`[data-k="${CSS.escape(after)}"]`) || after === 'accts' ? after : null),
    });
  }

  async function remove(p) {
    const name = names.get(p.nim);
    const ok = await confirmDialog({
      title: `Hapus ${name} dari daftar?`,
      text: [
        `${name} (NIM ${p.nim}) tidak ada lagi di daftar peserta, jadi NIM ini tidak bisa dipakai untuk membuka soal try out.`,
        p.claim
          ? `Akun ${p.claim.email} ikut dilepas dan kembali ke langkah mengetik NIM, jadi masih bisa memakai NIM lain yang belum terpakai. Untuk menutup akun itu sepenuhnya, pakai Blokir akun Google ini.`
          : null,
        p.added ? 'Kalau perlu lagi, tambahkan ulang lewat Tambah orang.' : 'Nama ini dari daftar kelas. Kalau perlu lagi, tambahkan ulang dengan NIM yang sama dan namanya kembali seperti di daftar kelas.',
      ].filter(Boolean),
      confirm: 'Hapus',
      danger: true,
    });
    const k = `${p.nim}:remove`;
    if (!ok) return refocus(k);
    const list = visible();
    const i = list.findIndex((x) => x.nim === p.nim);
    const next = list[i + 1] || list[i - 1];
    change(
      p.nim,
      'Menghapus…',
      async () => {
        const res = await cbtAdmin(backend, { op: 'remove', nim: p.nim });
        ui.open.delete(p.nim);
        ui.keep.delete(p.nim);
        return res;
      },
      { op: 'remove', done: `${name} dihapus dari daftar.`, from: k, focus: next ? `${next.nim}:open` : `filter:${ui.filter}` },
    );
  }

  /* ---------- adding a person ---------- */

  function field(label, props, hint) {
    const id = nextId('cbt-f');
    const input = h('input', { type: 'text', id, autocomplete: 'off', spellcheck: false, ...props, 'aria-describedby': `${id}-hint ${id}-msg` });
    const msg = h('p', { class: 'msg', id: `${id}-msg` });
    const el = h('div', { class: 'fld' }, h('label', { htmlFor: id }, label), input, h('p', { class: 'hint', id: `${id}-hint` }, hint), msg);
    const set = (m) => {
      el.classList.toggle('is-err', !!m);
      msg.textContent = m || '';
      if (m) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    };
    input.addEventListener('input', () => set(''));
    return { el, input, set };
  }

  function openAdd() {
    if (addForm) {
      addForm.querySelector('input').focus();
      return;
    }
    const nameF = field('Nama lengkap', { maxLength: 80, autocapitalize: 'words' }, 'Tulis seperti di daftar kelas. Nama ini dicocokkan dengan nama akun Google yang masuk.');
    const nimF = field('NIM', { inputMode: 'numeric', maxLength: 30 }, 'Angka saja, 6 sampai 20 digit. NIM di kelas ini 14 digit.');
    const formErr = h('p', { class: 'err-text', role: 'alert' });
    const submit = h('button', { type: 'submit', class: 'btn primary' }, 'Tambah ke daftar');
    addForm = h(
      'form',
      { class: 'cbt-add', id: 'cbt-add', novalidate: true, 'aria-labelledby': 'cbt-add-h' },
      h('h3', { id: 'cbt-add-h' }, 'Tambah orang ke daftar'),
      h('div', { class: 'grid2' }, nameF.el, nimF.el),
      formErr,
      h('div', { class: 'row-actions left' }, submit, h('button', { type: 'button', class: 'btn ghost', onclick: () => adding || closeAdd(true) }, 'Batal')),
    );
    addForm.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !adding) {
        e.preventDefault();
        closeAdd(true);
      }
    });
    addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (adding) return;
      const { name, nim, errors } = checkNewPerson({ name: nameF.input.value, nim: nimF.input.value });
      const dup = !errors.nim && data.people.find((x) => x.nim === nim);
      if (dup) errors.nim = `NIM ini sudah ada di daftar, atas nama ${names.get(dup.nim)}.`;
      nameF.set(errors.name);
      nimF.set(errors.nim);
      formErr.textContent = '';
      if (errors.name || errors.nim) {
        (errors.name ? nameF : nimF).input.focus();
        return;
      }
      adding = true;
      submit.textContent = 'Menambahkan…';
      submit.setAttribute('aria-disabled', 'true');
      enqueue(async () => {
        try {
          accept(await cbtAdmin(backend, { op: 'add', nim, name }));
          closeAdd(false);
          ui.keep.add(nim); // stays in view whatever the search or filter, until they change
          render({ focus: `${nim}:open` });
          toast(`${names.get(nim) || name} ditambahkan ke daftar.`);
        } catch (err) {
          const msg = explainCbt(err, 'add');
          if (err.code === 'bad-name') nameF.set(msg);
          else if (err.code === 'bad-nim' || err.code === 'exists') nimF.set(msg);
          else formErr.textContent = msg;
          (err.code === 'bad-name' ? nameF : nimF).input.focus();
          if (err.code === 'exists') load({ quiet: true });
        } finally {
          adding = false;
          submit.textContent = 'Tambah ke daftar';
          submit.removeAttribute('aria-disabled');
        }
      });
    });
    replace(addHost, addForm);
    addBtn.setAttribute('aria-expanded', 'true');
    addBtn.setAttribute('aria-controls', 'cbt-add');
    nameF.input.focus();
  }

  function closeAdd(focusButton) {
    addForm = null;
    clear(addHost);
    addBtn.setAttribute('aria-expanded', 'false');
    addBtn.removeAttribute('aria-controls');
    if (focusButton) addBtn.focus();
  }

  return {
    // The tab is shown again: pick up a setup link opened meanwhile, refresh an old list.
    shown() {
      const fresh = heldSetupCode();
      if (fresh) {
        code = fresh;
        if (data) render();
        if (data && !data.ready) installBtn.focus();
      }
      refreshIfStale();
    },
  };
}
