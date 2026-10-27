// The page shell and the try out screens, in a browser: every text a visitor can see has a key
// (src/copy/shell.js, src/copy/tryout.js, data-k in index.html), changed texts (the links
// document's site.t) show, a note left empty takes no space, and with nothing saved every keyed
// text reads as its default.
//   npx vite build && npx vite build --mode mock --outDir dist-mock && node --test --test-concurrency=1 tests/texts-shell.e2e.mjs
// Env: DIST_DIR, DIST_MOCK_DIR, CHROMIUM_PATH (default /opt/pw-browsers/chromium), SHOTS=<dir> to keep screenshots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { serveDist } from './lib/serve-dist.mjs';
import { unkeyedTexts, linksRoute } from './lib/text-audit.mjs';
import '../src/copy/index.js';
import { copyEntry, fill } from '../src/lib/texts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const DIST = process.env.DIST_DIR || join(ROOT, 'dist');
const DIST_MOCK = process.env.DIST_MOCK_DIR || join(ROOT, 'dist-mock');
const SHOTS = process.env.SHOTS;
const FIRESTORE = 'https://firestore.googleapis.com';
const LINKS = JSON.parse(readFileSync(join(ROOT, 'src/data/links.json'), 'utf8'));
const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.91';
const SIZES = [[390, 844], [1280, 800]];
const NOTES = ['menu.note', 'siklus.note', 'anatomi.note', 'kelas.note'];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// Visible text that stays without a key on purpose: [selector, why].
const SHELL_SKIP = [
  ['#ttlSk', 'the big title is hero.ttl, rebuilt letter by letter, so it is changed from the list of page texts'],
  ['#ledeEnd', 'hero.ends: the endings of the hero line, one at a time, edited as one list'],
  ['#findKey', 'keyboard key names'],
  ['.bpm', 'the unit next to a live number'],
  ['.hud-r span:not([data-k])', 'the unit next to a live number'],
  ['#rail, #siklus .tag', 'ECG wave names (P, PR, QRS, ST, T)'],
  ['.row-n', 'channel names: their own editor (links)'],
  ['.pk-t', 'channel names on the hover cards: their own editor (links)'],
];
const CHANNEL_SKIP = [
  ['.p-ttl', 'the channel name: its own editor (links)'],
  ['.p-hero .lbl, .p-hero .p-sub', 'the channel label and description: their own editor (links)'],
  ['.nextb strong', 'the next channel name: its own editor (links)'],
  ['.f-u:not([data-k])', 'the folder link itself'],
  ['.f-p2 b', 'the channel name drawn on the folder: its own editor (links)'],
];
const TRYOUT_SKIP = [
  ['.p-ttl', 'the channel name: its own editor (links)'],
  ['.p-hero .lbl, .p-hero .p-sub', 'the channel label and description: their own editor (links)'],
  ['.nextb strong', 'the next channel name: its own editor (links)'],
  ['.to-av', 'the first letter of the account name'],
  ['.to-gerr', 'the sign-in error line: transient, registered (to.inerr.*) and written with tx()'],
  ['.sr', 'for screen readers only'],
  ['.to-dlg', 'confirm dialogs: transient, their texts are registered and written with tx()'],
  ['.to-qt, .to-ot, .to-ex, .to-nt', 'questions, options, explanations and their notes: data'],
  ['.to-k', 'answer letters'],
  ['kbd', 'keyboard key names'],
  ['[data-act="tp"]:not([data-v="*"]), .to-tp-n', 'topic names from the question bank'],
  ['.to-tag:not([data-k])', 'topic name, tag (Soal Herdini) or question number from the question bank'],
  ['.to-refl', 'reference titles from the question bank'],
  ['.to-hr-m small, .to-dt', 'dates, durations and the label a session was saved with'],
  ['.to-pass-n:not([data-k]), .to-pass-e:not([data-k]), .to-pv-q b', 'the student\'s name and email: data'],
];
const skips = (list) => list.map(([sel]) => sel);

let srv, mock, browser;
before(async () => {
  for (const d of [DIST, DIST_MOCK]) assert.ok(existsSync(join(d, 'index.html')), 'build ' + d + ' first (see the top of this file)');
  srv = await serveDist({ dir: DIST });
  mock = await serveDist({ dir: DIST_MOCK });
  browser = await chromium.launch({ executablePath: EXE, args: ['--disable-3d-apis'] });
});
after(async () => {
  await browser?.close();
  srv?.server.close();
  mock?.server.close();
});

/** A page of a build, with Firestore answered by the links document carrying t (or by "no document"). */
async function open(server, { w, h, t, path = '/', ua, motion = 'reduce' }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: w < 900, userAgent: ua, reducedMotion: motion });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.text().startsWith('[texts]')) errors.push('console: ' + m.text());
    if (m.type() !== 'error') return;
    if (m.text().startsWith('Failed to load resource') && m.location().url.startsWith(FIRESTORE)) return;
    errors.push('console: ' + m.text());
  });
  if (t) await linksRoute(page, LINKS, t);
  else await page.route(FIRESTORE + '/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":404,"status":"NOT_FOUND"}}' }));
  await page.goto(server.url + path, { waitUntil: 'load' });
  return { ctx, page, errors, ev: (f, a) => page.evaluate(f, a) };
}
const shot = async (s, name) => { if (SHOTS) await s.page.screenshot({ path: join(SHOTS, `${name}-${s.page.viewportSize().width}.png`) }).catch(() => {}); };
const settle = (s) => s.ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 80)))));
const flat = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Every keyed text, title and placeholder under root that does not read as its registered default. */
async function offDefault(page, root) {
  const list = await page.evaluate((root) => {
    const host = document.querySelector(root);
    if (!host) return null;
    const sel = '[data-k], [data-kt], [data-kp]';
    const els = [...host.querySelectorAll(sel)];
    if (host.matches(sel)) els.unshift(host);
    return els.map((el) => ({
      at: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
      parts: [[el.dataset.k, el.dataset.kv, el.textContent, 'text'], [el.dataset.kt, el.dataset.ktv, el.getAttribute('title'), 'title'], [el.dataset.kp, el.dataset.kpv, el.getAttribute('placeholder'), 'placeholder']],
    }));
  }, root);
  if (!list) return ['(nothing matches ' + root + ')'];
  const out = [];
  for (const { at, parts } of list) {
    for (const [key, vars, got, what] of parts) {
      const e = key && copyEntry(key);
      if (!e) continue; // not declared: a text typed into index.html is its own default
      let want = fill(e.d, vars ? JSON.parse(vars) : null);
      if (what === 'text' && e.rich) want = want.replace(/\*\*(.+?)\*\*/g, '$1');
      if (flat(got) !== flat(want)) out.push(`${key} (${what}) on <${at}>: "${flat(got)}", default "${flat(want)}"`);
    }
  }
  return out;
}

/** Runs the audit and the defaults check on each root; collects what is left, by screen. */
async function check(s, screen, roots, skip, left, { defaults = true } = {}) {
  await settle(s);
  for (const root of roots) {
    const u = await unkeyedTexts(s.page, root, { skip });
    if (u.length) left[`${screen} ${root}: no key`] = u;
    if (!defaults) continue;
    const d = await offDefault(s.page, root);
    if (d.length) left[`${screen} ${root}: not the default`] = d;
  }
  await shot(s, screen);
}

/** Where a note is on screen: its text, whether it is marked empty and how much room it takes. */
const notes = (s) => s.ev((keys) => keys.map((k) => {
  const el = document.querySelector(`[data-k="${k}"]`);
  if (!el) return [k, 'missing'];
  const r = el.getBoundingClientRect();
  return [k, el.textContent, el.hasAttribute('data-empty'), getComputedStyle(el).display === 'none' ? 0 : Math.round(r.height)];
}), NOTES);

async function scrollThrough(s) {
  for (const q of ['#menu', '#siklus', '#anatomi', '#kelas', '.foot']) {
    await s.ev((q) => document.querySelector(q)?.scrollIntoView(), q);
    await settle(s);
  }
}

for (const [w, h] of SIZES) {
  test(`the page shell: every text has a key and nothing saved means the defaults (${w}x${h})`, async () => {
    // motion on: the heartbeat section shows its intro (and its note) only then
    const s = await open(srv, { w, h, motion: 'no-preference' });
    await s.page.waitForFunction(() => document.body.classList.contains('go') && document.querySelector('#rows .row'), null, { timeout: 20000 });
    await scrollThrough(s);
    const left = {};
    await check(s, 'shell', ['.bar', '.hero', '#menu', '#peek', '#siklus', '#anatomi .ch-head', '#kelas .kelas-copy', '.foot'], skips(SHELL_SKIP), left);
    assert.deepEqual(left, {});

    // the texts as they always were
    assert.equal(await s.ev(() => document.title), 'ALPHANGERS · Class Alpha');
    assert.equal(await s.ev(() => document.getElementById('ttlSk').textContent.replace(/ /g, ' ')), 'ALPHANGERS');
    assert.equal(await s.ev(() => document.getElementById('ttl').getAttribute('aria-label')), 'Alphangers');
    assert.match(await s.ev(() => document.getElementById('chCount').textContent), /^Menu · \d+ channel$/);
    assert.match(await s.ev(() => document.getElementById('clockT').textContent), /^Palembang · \d{2}:\d{2} WIB$/);
    assert.equal(await s.ev(() => document.querySelector('.credit').title), 'Alphangers di GitHub');
    assert.equal(await s.ev(() => document.getElementById('sndS').textContent), 'off');
    // the empty notes take no room
    for (const [k, text, empty, height] of await notes(s)) assert.deepEqual([k, text, empty, height], [k, '', true, 0]);

    // a Drive channel page
    await s.page.goto(srv.url + '/#praktikum');
    await s.page.waitForSelector('#panel.on .folder', { timeout: 20000 });
    await check(s, 'channel', ['#panel'], skips(CHANNEL_SKIP), left);
    assert.deepEqual(left, {});
    const name = LINKS.channels.find((c) => c.id === 'praktikum')?.name;
    if (name) assert.equal(await s.ev(() => document.title), `${name} · ALPHANGERS`);
    assert.match(await s.ev(() => document.querySelector('#panel .p-crumb').textContent), /^Channel \d+ \/ \d+$/);
    assert.equal(await s.ev(() => document.querySelector('#backBtn [data-k]').textContent), 'Kembali');
    assert.deepEqual(s.errors, []);
    await s.ctx.close();
  });

  test(`the page shell: changed texts show, a filled note takes room (${w}x${h})`, async () => {
    const t = {
      'bar.find': 'Cari apa',
      'bar.nav.menu': 'Channel',
      'menu.count': 'Ada {n} channel di sini',
      'menu.row.drive': 'Buka',
      'foot.clock': 'Jam {time} di Palembang',
      'foot.credit.t': 'Kode sumbernya di GitHub',
      'foot.admin': 'Pengurus',
      'hero.ttl': 'ALPHA 26',
      'app.title': 'Portal Alpha',
      'app.title.ch': '{name} di Portal Alpha',
      'ch.crumb': 'Ch {n} dari {total}',
      'ch.back': 'Balik',
      'menu.note': 'Catatan buat menu, kadang agak panjang biar kelihatan barisnya.',
      'siklus.note': 'Catatan buat siklus jantung.',
      'anatomi.note': 'Catatan buat model jantung.',
      'kelas.note': 'Catatan buat foto kelas.',
    };
    const s = await open(srv, { w, h, t, motion: 'no-preference' });
    await s.page.waitForFunction(() => document.querySelector('.find-t').textContent === 'Cari apa' && document.body.classList.contains('go') && document.querySelector('#rows .row'), null, { timeout: 20000 });
    await scrollThrough(s);
    const left = {};
    await check(s, 'shell-changed', ['.bar', '.hero', '#menu', '#peek', '#siklus', '#anatomi .ch-head', '#kelas .kelas-copy', '.foot'], skips(SHELL_SKIP), left, { defaults: false });
    assert.deepEqual(left, {});
    // plain texts, from index.html and from the shell
    assert.equal(await s.ev(() => document.querySelector('[data-k="bar.nav.menu"]').textContent), 'Channel');
    assert.equal(await s.ev(() => document.querySelector('#adminBtn [data-k]').textContent), 'Pengurus');
    assert.ok(await s.ev(() => [...document.querySelectorAll('[data-k="menu.row.drive"]')].every((e) => e.textContent === 'Buka')));
    // texts with data in them, one on a timer
    assert.equal(await s.ev(() => document.getElementById('chCount').textContent), `Ada ${await s.ev(() => document.querySelectorAll('#rows .row').length)} channel di sini`);
    assert.match(await s.ev(() => document.getElementById('clockT').textContent), /^Jam \d{2}:\d{2} di Palembang$/);
    // a title, the big title rebuilt from its letters, the page title
    assert.equal(await s.ev(() => document.querySelector('.credit').title), 'Kode sumbernya di GitHub');
    assert.equal(await s.ev(() => document.getElementById('ttlSk').textContent.replace(/ /g, ' ')), 'ALPHA 26');
    assert.equal(await s.ev(() => document.getElementById('ttl').getAttribute('aria-label')), 'ALPHA 26');
    assert.equal(await s.ev(() => document.title), 'Portal Alpha');
    // filled notes show and take room
    for (const [k, text, empty, height] of await notes(s)) {
      assert.deepEqual([k, text, empty], [k, t[k], false]);
      assert.ok(height > 0, k + ' takes room');
    }
    if (SHOTS) for (const q of ['#menu .ch-head', '#pIntro', '#anatomi .ch-head', '#kelas .kelas-copy']) {
      await s.ev((q) => document.querySelector(q).scrollIntoView({ block: 'center' }), q);
      await settle(s);
      await s.page.screenshot({ path: join(SHOTS, `note-${q.replace(/[^a-z]+/gi, '-')}-${w}.png`) });
    }

    await s.page.goto(srv.url + '/#praktikum');
    await s.page.waitForSelector('#panel.on .folder', { timeout: 20000 });
    await check(s, 'channel-changed', ['#panel'], skips(CHANNEL_SKIP), left, { defaults: false });
    assert.deepEqual(left, {});
    const name = LINKS.channels.find((c) => c.id === 'praktikum')?.name;
    if (name) assert.equal(await s.ev(() => document.title), `${name} di Portal Alpha`);
    assert.match(await s.ev(() => document.querySelector('#panel .p-crumb').textContent), /^Ch \d+ dari \d+$/);
    assert.equal(await s.ev(() => document.querySelector('#backBtn [data-k]').textContent), 'Balik');
    assert.deepEqual(s.errors, []);
    await s.ctx.close();
  });

  test(`the try out, every screen on the way: every text has a key, nothing saved means the defaults (${w}x${h})`, async () => {
    const s = await open(mock, { w, h, path: '/?mock&cbt=claim#tryout' });
    const left = {};
    const at = (screen) => check(s, 'to-' + screen, ['#panel'], skips(TRYOUT_SKIP), left);
    await s.page.waitForSelector('.to-blk.on[data-b="b3"]', { timeout: 20000 });
    await at('home');
    assert.equal(await s.ev(() => document.title), 'Try Out CBT · ALPHANGERS');
    assert.deepEqual(await s.ev(() => { const n = document.querySelector('.to-note'); return [n.dataset.k, n.hasAttribute('data-empty'), n.getClientRects().length]; }), ['to.note', true, 0]);
    await s.page.click('.to-blk.on[data-b="b3"]');
    await s.page.waitForSelector('.to-gate[data-gate="masuk"]');
    await at('masuk');
    assert.equal(await s.ev(() => document.querySelector('[data-k="to.gate.masuk.h"]').textContent), 'Masuk dulu, ya');
    await s.page.click('[data-act="gin"]');
    await s.page.waitForSelector('.to-gate[data-gate="nim"]');
    await at('nim');
    await s.page.fill('#toNim', '04011000000000');
    await s.page.click('.to-nimf [type="submit"]');
    await s.page.waitForFunction(() => document.getElementById('toNimE').textContent.length > 0);
    await at('nim-error');
    await s.page.fill('#toNim', '04011999999001');
    await s.page.click('.to-nimf [type="submit"]');
    await s.page.waitForSelector('.to-pv-q');
    await at('preview');
    await s.page.click('[data-act="nimok"]');
    await s.page.waitForSelector('.to-start', { timeout: 10000 });
    await s.page.click('[data-act="sq"]');
    await s.page.click('[data-act="so"]');
    await at('setup');
    assert.match(await s.ev(() => document.querySelector('.to-start [data-k]').textContent), /^Mulai latihan · \d+ soal$/);
    await s.page.click('[data-act="mode"][data-v="ujian"]');
    await at('setup-sim');
    await s.page.click('[data-act="mode"][data-v="herdini"]');
    await at('setup-hd');
    await s.page.click('[data-act="mode"][data-v="latihan"]');
    await s.page.click('.to-start');
    await s.page.waitForSelector('#toQ');
    await at('run');
    assert.equal(await s.ev(() => document.querySelector('[data-act="flag"]').title), 'Tandai ragu-ragu (F)');
    await s.page.click('.to-o[data-o="1"]');
    await s.page.click('[data-act="check"]');
    await s.page.waitForSelector('.to-fb');
    await at('checked');
    await s.page.click('#toFoot [data-act="next"]');
    await at('run-2');
    await s.ev(() => document.querySelector('.to-nav [data-act="finish"]').click());
    await s.page.waitForSelector('.to-dlg.on');
    await s.page.click('.to-dlg [data-dok]');
    await s.page.waitForSelector('#toScore');
    await at('result');
    await s.page.click('[data-act="review"]');
    await s.page.waitForSelector('.to-review');
    await at('review');
    await s.page.goBack();
    await s.page.waitForSelector('#toScore');
    await s.page.goBack();
    await s.page.waitForSelector('.to-start');
    await at('setup-history');
    await s.page.goBack();
    await s.page.waitForSelector('#toAcct [data-act="gout"]');
    await at('home-signed-in');
    assert.deepEqual(left, {});
    assert.deepEqual(s.errors, []);
    await s.ctx.close();
  });

  test(`the try out's other gates and Try Out OSPE: every text has a key (${w}x${h})`, async () => {
    const left = {};
    const gateOf = async (cbt, blok, kind, { ua, act = 'gin' } = {}) => {
      const s = await open(mock, { w, h, ua, path: `/?mock&cbt=${cbt}#tryout` });
      await s.page.waitForSelector(`.to-blk.on[data-b="${blok}"]`, { timeout: 20000 });
      await s.page.click(`.to-blk.on[data-b="${blok}"]`);
      if (act) {
        await s.page.waitForSelector('.to-gate[data-gate="masuk"]');
        await s.page.click(`[data-act="${act}"]`);
      }
      return s;
    };
    let s = await gateOf('closed', 'b2', 'tutup');
    await s.page.waitForSelector('.to-gate[data-gate="tutup"]', { timeout: 10000 });
    await check(s, 'to-tutup', ['#panel'], skips(TRYOUT_SKIP), left);
    assert.deepEqual(s.errors, []);
    await s.ctx.close();

    s = await gateOf('setup', 'b3', 'siap');
    await s.page.waitForSelector('.to-gate[data-gate="siap"]', { timeout: 10000 });
    await check(s, 'to-siap', ['#panel'], skips(TRYOUT_SKIP), left);
    assert.deepEqual(s.errors, []);
    await s.ctx.close();

    s = await gateOf('offline', 'b3', 'masuk');
    await s.page.waitForFunction(() => document.getElementById('toGErr').textContent.length > 0, null, { timeout: 10000 });
    await check(s, 'to-masuk-offline', ['#panel'], skips(TRYOUT_SKIP), left);
    await s.ctx.close();

    s = await gateOf('claim', 'b3', 'inapp', { ua: INSTAGRAM, act: null });
    await s.page.waitForSelector('.to-gate[data-gate="inapp"]', { timeout: 10000 });
    await check(s, 'to-inapp', ['#panel'], skips(TRYOUT_SKIP), left);
    assert.deepEqual(s.errors, []);
    await s.ctx.close();

    s = await open(mock, { w, h, path: '/?mock&cbt=ok#tryout-ospe' });
    await s.page.waitForSelector('.to-blk.on[data-b="o3"]', { timeout: 20000 });
    await check(s, 'ospe-home', ['#panel'], skips(TRYOUT_SKIP), left);
    await s.page.click('.to-blk.on[data-b="o3"]');
    await s.page.waitForSelector('.to-gate[data-gate="masuk"]');
    await s.page.click('[data-act="gin"]');
    await s.page.waitForSelector('.to-start', { timeout: 10000 });
    await check(s, 'ospe-setup', ['#panel'], skips(TRYOUT_SKIP), left);
    assert.deepEqual(left, {});
    assert.deepEqual(s.errors, []);
    await s.ctx.close();
  });

  test(`the try out: changed texts show, each kind keeps its own note (${w}x${h})`, async () => {
    const t = {
      'to.crumb': 'Latihan CBT',
      'to.note': 'Catatan buat try out CBT.',
      'to.ospe.note': '',
      'to.gate.masuk.h': 'Login dulu',
      'to.start.lat': 'Gas latihan, {n} soal',
      'to.run.check': 'Periksa',
      'to.run.flag.t': 'Ragu (F)',
      'ch.back': 'Balik',
    };
    const s = await open(mock, { w, h, t, path: '/?mock&cbt=ok#tryout' });
    await s.page.waitForFunction(() => document.querySelector('.to-note')?.textContent === 'Catatan buat try out CBT.', null, { timeout: 20000 });
    const left = {};
    await check(s, 'to-home-changed', ['#panel'], skips(TRYOUT_SKIP), left, { defaults: false });
    assert.equal(await s.ev(() => document.getElementById('toBack').textContent.replace(/\s+/g, ' ').trim()), '← Balik');
    assert.ok(await s.ev(() => document.querySelector('.to-note').getBoundingClientRect().height > 0), 'the note takes room');
    await s.page.click('.to-blk.on[data-b="b3"]');
    await s.page.waitForSelector('.to-gate[data-gate="masuk"]');
    assert.equal(await s.ev(() => document.querySelector('[data-k="to.gate.masuk.h"]').textContent), 'Login dulu');
    await s.page.click('[data-act="gin"]');
    await s.page.waitForSelector('.to-start', { timeout: 10000 });
    assert.match(await s.ev(() => document.querySelector('.to-start [data-k]').textContent), /^Gas latihan, \d+ soal$/);
    assert.equal(await s.ev(() => document.querySelector('#panel .p-crumb [data-k]').textContent), 'Latihan CBT');
    await s.page.click('.to-start');
    await s.page.waitForSelector('#toQ');
    assert.equal(await s.ev(() => document.querySelector('[data-act="flag"]').title), 'Ragu (F)');
    assert.equal(await s.ev(() => document.querySelector('#toFoot [data-act="check"]').textContent.trim()), 'Periksa');
    await check(s, 'to-run-changed', ['#panel'], skips(TRYOUT_SKIP), left, { defaults: false });

    // Try Out OSPE: its own note, emptied, takes no room; the CBT crumb is not its crumb
    await s.page.goto(mock.url + '/?mock&cbt=ok#tryout-ospe');
    await s.page.waitForSelector('.to-blk.on[data-b="o3"]', { timeout: 20000 });
    await s.page.waitForFunction(() => document.querySelector('.to-note')?.dataset.k === 'to.ospe.note');
    assert.deepEqual(await s.ev(() => { const n = document.querySelector('.to-note'); return [n.textContent, n.hasAttribute('data-empty'), n.getClientRects().length]; }), ['', true, 0]);
    await s.page.click('.to-blk.on[data-b="o3"]');
    await s.page.waitForSelector('.to-start, .to-gate[data-gate="masuk"]', { timeout: 10000 });
    if (await s.ev(() => !document.querySelector('.to-start'))) {
      await s.page.click('[data-act="gin"]');
      await s.page.waitForSelector('.to-start', { timeout: 10000 });
    }
    assert.deepEqual(await s.ev(() => { const c = document.querySelector('#panel .p-crumb [data-k]'); return [c.dataset.k, c.textContent]; }), ['to.ospe.crumb', 'Try Out OSPE']);
    assert.deepEqual(left, {});
    assert.deepEqual(s.errors, []);
    await s.ctx.close();
  });
}
