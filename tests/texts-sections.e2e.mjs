// Page texts in the lecturer list, the 3D heart, the divisions, the class photo and the photo
// viewer, on the built site (src/lib/texts.js, src/copy/): every visible word there has a key,
// changed texts show (read from the links document), and with no changes every text is its default.
//   npx vite build && node --test tests/texts-sections.e2e.mjs      (DIST_DIR=<dir> for another build)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { serveDist } from './lib/serve-dist.mjs';
import { unkeyedTexts, linksRoute } from './lib/text-audit.mjs';
import { listCopy } from '../src/copy/index.js';
import { fill } from '../src/lib/texts.js';

const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
// the heart draws with WebGL: software GL, as in portal.e2e.mjs
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const links = JSON.parse(readFileSync(new URL('../src/data/links.json', import.meta.url), 'utf8'));
const DEFAULTS = new Map(listCopy().flatMap((g) => g.items.map((i) => [i.key, i.d])));

// Left out of the audit on purpose: content with its own editor, formatting, and text no one sees.
const SKIP = {
  '.dz-name': 'lecturer names (dosen editor)',
  '.dz-spec': 'specialties (dosen editor); a missing one shows the key dosen.spec.none',
  '.dz-dlg-k': 'specialty in the details (dosen editor)',
  '.dz-dlg-n': 'lecturer name in the details (dosen editor)',
  '.dz-code': 'blok codes such as B3 ZM (schedule data)',
  '.dz-chip[data-blok]': 'blok names on the filter chips (schedule data)',
  '.dz-g-h': 'A to Z letters, taken from the names',
  '.dz-az-b': 'A to Z letters, taken from the names',
  '.dz-se-d': 'dates and times of a session (formatting)',
  '.dz-se-t': 'session titles (schedule editor)',
  '.ct-num': 'phone numbers (dosen editor)',
  '.dz-sr': 'screen reader text, not visible (like an aria-label)',
  '.ct-sr': 'screen reader text, not visible (like an aria-label)',
  '.sr': 'screen reader text, not visible (like an aria-label)',
  '.hx-item': 'part names in the heart\'s list (heart notes editor)',
  '.hx-name': 'part name (heart notes editor)',
  '.hx-alt': 'Latin and English part names (heart notes editor)',
  '.hx-sum': 'part summary (heart notes editor)',
  '.hx-pts': 'part anatomy points (heart notes editor)',
  '.hx-sec > p': 'part function, blood supply and ECG notes (heart notes editor)',
  '.hx-num': 'part numbers (heart notes editor)',
  '.hx-clin': 'clinical notes (heart notes editor)',
  '.hx-chip': 'related part names (heart notes editor)',
  '.hx-peek-n': 'tapped part name (heart notes editor)',
  '.hx-peek-s': 'tapped part summary (heart notes editor)',
  '.hx-tip': 'part name under the mouse (heart notes editor)',
  '[data-f]': 'division name, full name, tag and description (divisi editor)',
  '.dv-ix': 'division names in the index (divisi editor)',
  '.dv-blank': 'division name drawn in an empty photo slot (divisi editor)',
  '.dv-cap': 'photo captions (divisi editor)',
  '.pv-kick': 'kicker passed in by the section that opens the viewer: a page text from divisi (checked below), the class photo\'s own heading from index.html',
  '.pv-title': 'title passed in: a division\'s name, or the class photo heading',
  '.pv-sub': 'subtitle passed in: a division\'s full name',
  '.pv-cap': 'photo caption (divisi editor)',
  '.pv-desc': 'description passed in: a division\'s, or the class photo\'s line from index.html',
};
const skip = Object.keys(SKIP);

let srv, browser;
before(async () => {
  srv = await serveDist();
  browser = await chromium.launch({ executablePath: EXE, args: GL });
});
after(async () => {
  await browser?.close();
  srv?.server.close();
});

async function open(w, h, t = {}) {
  const mobile = w < 900;
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // tx() with a key nobody registered shows nothing: a bug
  page.on('console', (m) => { if (m.text().includes('[texts]')) errors.push(m.text()); });
  // a Monday morning, so a lecturer's details mark the next session
  await page.clock.install({ time: new Date('2026-10-05T09:15:00+07:00') });
  await linksRoute(page, links, t);
  await page.goto(srv.url + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.classList.contains('js'));
  return { ctx, page, errors };
}

const audit = async (page, root, what) => assert.deepEqual(await unkeyedTexts(page, root, { skip }), [], what + ': visible text without a key');
const text = (page, sel) => page.locator(sel).first().textContent();
const visible = (page, sel) => page.locator(sel).first().isVisible();
const settle = (page, ms = 250) => page.waitForTimeout(ms);

async function toDosen(page) {
  await page.evaluate(() => document.getElementById('dosen').scrollIntoView());
  await page.waitForSelector('#dosenRoot .dz-row', { timeout: 15000 });
}
async function openLecturer(page, id) {
  await page.evaluate((id) => document.dispatchEvent(new CustomEvent('alpha:open', { detail: { type: 'dosen', id } })), id);
  await page.waitForSelector('.dz-dlg[open]');
  await settle(page, 150);
}
async function closeLecturer(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.dz-dlg').open);
}
async function toHeart(page) {
  await page.evaluate(() => document.getElementById('anatomi').scrollIntoView());
  await page.waitForFunction(() => document.querySelector('.hx.ready, .hx.hx-off'), null, { timeout: 90000 });
  await settle(page, 800);
}
async function mode(page, m) {
  await page.click('.hx-mode[data-mode="' + m + '"]');
  await settle(page);
}
async function toDivisi(page) {
  await page.evaluate(() => document.getElementById('divisi').scrollIntoView());
  await page.waitForSelector('.dv-name');
  await settle(page, 400);
}
async function openViewer(page, how) {
  await how();
  await page.waitForSelector('dialog.pv[open]');
  await settle(page, 500);
}
async function closeViewer(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.pv')?.open);
  await settle(page, 300);
}

/** Every element under the roots that shows a registered page text, compared with its default. */
async function notDefault(page, roots) {
  const els = await page.evaluate((roots) => roots.flatMap((r) => [...document.querySelectorAll(r)]).flatMap((root) =>
    [...root.querySelectorAll('[data-k], [data-kp], [data-kt]')].map((el) => ({
      k: el.dataset.k, kv: el.dataset.kv, text: el.textContent,
      kp: el.dataset.kp, kpv: el.dataset.kpv, ph: el.getAttribute('placeholder'),
      kt: el.dataset.kt, ktv: el.dataset.ktv, title: el.getAttribute('title'),
    }))), roots);
  const wrong = [];
  let n = 0;
  const vars = (s) => (s ? JSON.parse(s) : null);
  for (const e of els) {
    for (const [key, v, got] of [[e.k, e.kv, e.text], [e.kp, e.kpv, e.ph], [e.kt, e.ktv, e.title]]) {
      if (!key || !DEFAULTS.has(key)) continue;
      n++;
      const want = fill(DEFAULTS.get(key), vars(v));
      if (got !== want) wrong.push(key + ': ' + JSON.stringify(got) + ' is not ' + JSON.stringify(want));
    }
  }
  return { n, wrong };
}

for (const [w, h] of [[390, 844], [1280, 800]]) {
  test(`every text in dosen, heart, divisi, kelas and viewer has a key, and shows its default, at ${w}px`, async () => {
    const { ctx, page, errors } = await open(w, h);

    // ---------- lecturers: folded, all of them, filtered, nothing found, the dock, details, a copied number
    await toDosen(page);
    await audit(page, '#dosen', 'lecturer list, folded');
    assert.equal(await text(page, '.dz-count'), '477 dosen');
    assert.equal(await page.getAttribute('.dz-q', 'placeholder'), 'nama, spesialis, nomor HP, kode blok');
    assert.equal(await page.locator('[data-k="dosen.note"]').count(), 1, 'the note slot is there');
    assert.equal(await visible(page, '[data-k="dosen.note"]'), false, 'an empty note is hidden');
    await page.click('#dosenRoot .dz-more-b');
    await page.waitForFunction(() => document.querySelectorAll('.dz-row').length === 477);
    await audit(page, '#dosen', 'lecturer list, all rows');
    await page.evaluate(() => document.querySelectorAll('.dz-row')[200].scrollIntoView());
    await page.waitForFunction(() => document.querySelector('.dz').classList.contains('dz-far'));
    await settle(page, 400);
    await audit(page, '#dosen', 'lecturer list with the dock');
    await page.evaluate(() => document.querySelector('.dz-tools').scrollIntoView());
    await page.click('.dz-chip[data-blok="b1"]');
    await page.click('.dz-chip[data-group="nondokter"]');
    assert.equal(await text(page, '.dz-active'), 'Cuma yang ngajar di Blok 1, spesialis Non-dokter');
    assert.equal(await text(page, '.dz-count'), '5 dari 477 dosen');
    await audit(page, '#dosen', 'lecturer list, filtered');
    await page.click('.dz-clear');
    await page.fill('.dz-q', 'zzqx');
    await page.waitForFunction(() => !document.querySelector('.dz-empty').hidden);
    await audit(page, '#dosen', 'nothing found');
    await page.fill('.dz-q', '');
    await page.waitForFunction(() => document.querySelector('.dz-empty').hidden);
    // details: one with sessions, a PJ part and two codes, one with no session at all
    await openLecturer(page, 'riana-sari-puspita');
    await audit(page, '.dz-dlg', 'lecturer details');
    assert.equal(await text(page, '.dz-dlg-codes'), 'Blok 1, kode RSP. Blok 4, kode RSP');
    await closeLecturer(page);
    await openLecturer(page, 'aryani-azis');
    await audit(page, '.dz-dlg', 'lecturer details with a PJ session');
    await closeLecturer(page);
    await openLecturer(page, 'abarham-martadiansyah');
    await audit(page, '.dz-dlg', 'lecturer details without sessions');
    assert.equal(await text(page, '.dz-dlg-none'), 'Belum ada jadwal ngajar di kelas Alpha.');
    await closeLecturer(page);
    const copy = page.locator('.dz-row:not([hidden]) [data-copy]').first();
    await copy.scrollIntoViewIfNeeded();
    await copy.click();
    await page.locator('.dz-row:not([hidden]) [data-copy] [data-k="dosen.ph.copied"]').first().waitFor();
    await audit(page, '#dosen', 'a number just copied');

    // ---------- the heart: each view, a part with every kind of note, a search with no result
    await toHeart(page);
    await audit(page, '#anatomiRoot', 'heart');
    for (const m of ['cut', 'ecg', 'flow']) {
      await mode(page, m);
      await audit(page, '#anatomiRoot', 'heart, view ' + m);
    }
    await mode(page, 'ecg');
    await page.click('.hx-ecg .hx-tbtn >> nth=0');
    await audit(page, '#anatomiRoot', 'heart, beat playing');
    await mode(page, 'whole');
    await page.click('.hx-item[data-id="mv"]');
    await settle(page);
    await audit(page, '#anatomiRoot', 'heart, mitral valve open');
    await page.fill('.hx-q', 'zzqx');
    await settle(page, 150);
    await audit(page, '#anatomiRoot', 'heart, no part found');
    await page.fill('.hx-q', '');
    if (w < 900) {
      // on a phone, a part tapped on the model gets a card over it
      const box = await page.locator('.hx-c').boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await settle(page, 1200);
      if (await visible(page, '.hx-peek')) await audit(page, '#anatomiRoot', 'heart, tapped part card');
    }

    // ---------- divisi, and the viewer from a division and from the class photo
    await toDivisi(page);
    await audit(page, '#divisiRoot', 'divisi');
    assert.equal(await text(page, '[data-k="divisi.lede"]'), 'Delapan divisi, satu kelas. Ini mereka yang ngurus Class Alpha di balik layar.');
    assert.equal(await visible(page, '[data-k="divisi.note"]'), false, 'an empty note is hidden');
    await openViewer(page, () => page.evaluate(() => document.querySelector('.dv-more').click()));
    await audit(page, 'dialog.pv', 'viewer from a division');
    assert.match(await page.getAttribute('.pv-kick', 'data-k'), /^divisi\.view\.kick$/, 'the division kicker is a page text');
    assert.match(await text(page, '.pv-kick'), /^Divisi \d\d$/);
    await closeViewer(page);
    await page.evaluate(() => document.getElementById('kelas').scrollIntoView());
    await settle(page, 400);
    await audit(page, '#kelas', 'class photo');
    await openViewer(page, () => page.click('#kelasOpen'));
    await audit(page, 'dialog.pv', 'viewer from the class photo');
    assert.equal(await page.getAttribute('.pv-kick', 'data-k'), null, 'a plain kicker leaves no key behind');
    await closeViewer(page);

    // ---------- with no changes, every keyed element shows its default
    const { n, wrong } = await notDefault(page, ['#dosen', '#anatomiRoot', '#divisiRoot', '#kelas', 'dialog.pv']);
    assert.deepEqual(wrong, []);
    assert.ok(n > 1000, 'checked ' + n + ' texts');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  test(`changed texts show in dosen, heart, divisi and the viewer at ${w}px`, async () => {
    const t = {
      'dosen.h1': 'dosen kita',
      'dosen.count': 'Ada {n} dosen',
      'dosen.find.ph': 'Ketik nama dosen',
      'dosen.note': 'Nomor dosen jangan disebar ya.',
      'dosen.ph.call': 'Telepon',
      'dosen.g.nondokter': 'Bukan dokter',
      'anatomi.mode.cut': 'Iris',
      'anatomi.mode.cut.t': 'Lihat bagian dalamnya',
      'anatomi.find.ph': 'Cari katup atau arteri',
      'anatomi.sec.fungsi': 'Kerjanya',
      'anatomi.cur': 'geser',
      'divisi.lede': 'Delapan divisi yang ngurus kelas.',
      'divisi.note': '',
      'divisi.view.kick': 'Divisi ke-{no}',
      'viewer.hint.mouse': 'Scroll buat zoom',
    };
    const { ctx, page, errors } = await open(w, h, t);
    await toDosen(page);
    assert.equal(await text(page, '[data-k="dosen.h1"]'), 'dosen kita', 'a plain text');
    assert.equal(await text(page, '.dz-count'), 'Ada 477 dosen', 'a text with {n}');
    assert.equal(await page.getAttribute('.dz-q', 'placeholder'), 'Ketik nama dosen', 'a placeholder');
    assert.equal(await visible(page, '[data-k="dosen.note"]'), true, 'a written note shows');
    assert.equal(await text(page, '[data-k="dosen.note"]'), 'Nomor dosen jangan disebar ya.');
    assert.equal(await text(page, '.dz-row [data-k="dosen.ph.call"]'), 'Telepon', 'a text inside a link, in every row');
    assert.equal(await page.locator('.dz-row [data-k="dosen.ph.call"]').evaluateAll((els) => els.every((e) => e.textContent === 'Telepon')), true);
    assert.equal(await page.textContent('.dz-chip[data-group="nondokter"]'), 'Bukan dokter 37', 'a filter chip');
    await page.click('.dz-chip[data-group="nondokter"]');
    assert.equal(await text(page, '.dz-active'), 'Cuma yang Bukan dokter', 'the filter line uses the chip\'s text');
    await page.click('.dz-clear');
    await page.fill('.dz-q', 'abarham');
    await page.waitForFunction(() => document.querySelector('.dz-count').textContent === '1 dari 477 dosen');

    await toHeart(page);
    assert.equal(await text(page, '.hx-mode[data-mode="cut"]'), 'Iris', 'a text inside a button');
    assert.equal(await page.getAttribute('.hx-mode[data-mode="cut"]', 'title'), 'Lihat bagian dalamnya', 'a title');
    assert.equal(await page.getAttribute('.hx-q', 'placeholder'), 'Cari katup atau arteri');
    assert.equal(await text(page, '[data-k="anatomi.sec.fungsi"]'), 'Kerjanya', 'a heading in the part notes');
    if (await page.evaluate(() => document.documentElement.classList.contains('fine') && document.querySelector('.hx.ready'))) {
      // the label on the custom cursor over the model, away from the heart
      const box = await page.locator('.hx-c').boundingBox();
      await page.mouse.move(box.x + 8, box.y + box.height - 8);
      await page.mouse.move(box.x + 12, box.y + box.height - 12);
      await page.waitForFunction(() => document.getElementById('crt')?.textContent === 'geser', null, { timeout: 15000 });
    }

    await toDivisi(page);
    assert.equal(await text(page, '[data-k="divisi.lede"]'), 'Delapan divisi yang ngurus kelas.');
    assert.equal(await visible(page, '[data-k="divisi.note"]'), false, 'an emptied note stays hidden');
    assert.equal(await page.getAttribute('[data-k="divisi.note"]', 'data-empty'), '');
    await openViewer(page, () => page.evaluate(() => document.querySelector('.dv-more').click()));
    assert.match(await text(page, '.pv-kick'), /^Divisi ke-\d\d$/, 'a text with {no} in the viewer');
    if (w >= 900) assert.equal(await text(page, '.pv-hint'), 'Scroll buat zoom');
    await closeViewer(page);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
