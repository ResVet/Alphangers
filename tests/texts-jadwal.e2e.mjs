// Every visible text of the schedule, the announcements board and the site search has a page-text
// key (src/copy/jadwal.js, info.js, find.js), with no changed texts each shows its default, and a
// text the admin changed shows on the page. Runs against a production build; its Firestore reads
// are answered here: the links document with changed texts (site.t), announcements, and a schedule
// with a cancelled, an online and a tagged session added.
//   npx vite build --outDir dist && node --test --test-concurrency=1 tests/texts-jadwal.e2e.mjs
// Env: DIST_DIR (default dist), CHROMIUM_PATH, SHOTS=<dir> to keep screenshots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { serveDist } from './lib/serve-dist.mjs';
import { unkeyedTexts, linksBody } from './lib/text-audit.mjs';
import { listCopy, fill } from '../src/lib/texts.js';
import '../src/copy/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const read = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const LINKS = read('src/data/links.json');
const REG = new Map(listCopy().flatMap((g) => g.items.map((i) => [i.key, i])));
const MINE = /^(jadwal|info|find)\./;

const TEACH = '2026-11-04T09:00:00+07:00'; // Blok 4: two sessions running at once, the next one later that morning
const EVE = '2026-12-01T19:00:00+07:00'; // the evening before the Blok 4 CBT, whose time is not out yet
const AFTER = '2026-12-07T10:00:00+07:00'; // the Monday after the last blok
const WIDTHS = [390, 1280];

// What unkeyedTexts may leave, and why: content with its own editor, formatting, and text no one sees.
const SKIP = {
  jadwal: [
    '.jw-sr', // screen-reader text, not visible (like an aria-label)
    '.jw-date', '.jw-dt', // dates: day and month names, numbers
    '.jw-strip-m', '.jw-chip-w', '.jw-cal-h', '.jw-cal-g th', // month and weekday names in the strip and the calendar
    '[data-until]', // the ticking countdown: numbers and units ("1 hari 19 jam")
    '.jw-pill', '.jw-blokline-n', '.jw-blokline-t', // blok names and titles (blok editor)
    '.jw-ro-t', '.jw-s-t', '.jw-hit-t', // session titles (session editor)
    '.jw-s-note', '.jw-s-why', '.jw-tag', '.jw-loc', // session notes, cancel reasons, tags; the blok's place
    '.jw-link', '.jw-p-n', '.jw-p-s', // lecturer names and specialties (lecturer editor)
    '.ct-num', '.ct-sr', // phone numbers (lecturer editor) and the screen-reader text of their buttons
  ],
  info: [
    '.ib-title', '.ib-body', // announcement titles and bodies (announcement editor)
    '.ib-date', '.ib-dt', // post and due dates when they are not hari ini / besok / lusa / kemarin
  ],
  find: [
    '.fd-sr', // screen-reader text
    '.fd-n:not([data-k])', // what was found: channel names, session titles, lecturer names, heart parts
    '.fd-s:not(:has(*))', // the line under a channel, a lecturer or a heart part (data); a session's line is checked
    '.fd-dt', '.fd-blok', // a session's date and blok name
  ],
};

function doc(name, data) {
  return JSON.stringify({
    name: 'projects/alphangers-1ba79/databases/(default)/documents/content/' + name,
    fields: { json: { stringValue: JSON.stringify(data) }, rev: { integerValue: '999' } },
    updateTime: '2026-10-24T00:00:00.000000Z',
  });
}

// The bundled schedule with the states it does not have yet: two sessions at once on the teaching
// day, and on the day after a cancelled session, an online one with tags and a lecturer missing from
// the lecturer list, and one taught by a team.
function scheduleWithExtras() {
  const s = read('src/data/schedule.json');
  const b4 = s.bloks.find((b) => b.id === 'b4');
  const day = (d) => b4.days.find((x) => x.d === d).s;
  b4.codes.ZZQ = 'dosen-tanpa-data';
  day('2026-11-04').push({ s: '08:00', e: '09:30', t: 'Sesi Uji Barengan', k: 'tutorial', dz: [] });
  const thu = day('2026-11-05');
  Object.assign(thu[0], { batal: true, alasan: 'Dosen dinas luar' });
  Object.assign(thu[1], { online: true, tautan: 'https://meet.google.com/abc-defg-hij', label: ['Kelas gabungan', 'Bawa jas lab'], dz: [...thu[1].dz, 'ZZQ'] });
  thu[2].tim = true;
  return s;
}

const longBody = 'Laporan praktikum PA1 dikumpulkan lewat Drive kelas, satu file per kelompok. '.repeat(3);
const BOARD = [
  { id: 'a1', title: 'Kuliah KH2 pindah ke aula', body: 'Aula lantai 3.', tag: 'penting', date: '2026-11-04', pinned: true },
  { id: 'a2', title: 'Laporan PA1', body: longBody, tag: 'deadline', date: '2026-11-03', due: '2026-11-04T23:59' },
  { id: 'a3', title: 'OSPE Anatomi', body: 'Bawa jas lab.', tag: 'ujian', date: '2026-11-01', due: '2026-11-06T12:00', link: 'https://drive.google.com/drive/folders/abc123' },
  { id: 'a4', title: 'Foto kelas', body: 'Sudah ada di Drive.', tag: 'info', date: '2026-10-30' },
  { id: 'a5', title: 'Arsip Blok 3', body: '', tag: 'info', date: '2026-10-29' },
];

let srv, browser;
before(async () => {
  assert.ok(existsSync(join(process.env.DIST_DIR || join(ROOT, 'dist'), 'index.html')), 'build first: npx vite build');
  srv = await serveDist();
  browser = await chromium.launch({ executablePath: EXE });
});
after(async () => {
  await browser?.close();
  srv?.server.close();
});

/** The portal at a moment in Palembang, with what Firestore answers: changed texts, announcements, a schedule. */
async function open({ time, width, t = null, items = null, schedule = null }) {
  const mobile = width < 900;
  const ctx = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 800 }, isMobile: mobile, hasTouch: mobile,
    timezoneId: 'Asia/Jakarta', reducedMotion: 'reduce', serviceWorkers: 'block',
  });
  await ctx.route('https://firestore.googleapis.com/**', (r) => {
    const u = r.request().url();
    const ok = (body) => r.fulfill({ status: 200, contentType: 'application/json', body });
    if (t && u.includes('/documents/content/links')) return ok(linksBody(LINKS, t));
    if (items && u.includes('/documents/content/announcements')) return ok(doc('announcements', { v: 1, items }));
    if (schedule && u.includes('/documents/content/schedule')) return ok(doc('schedule', schedule));
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
    if (m.type() === 'warning' && m.text().includes('[texts] unregistered key')) errors.push(m.text());
  });
  await page.clock.install({ time: new Date(time) });
  await page.goto(srv.url + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('loader')).display === 'none', null, { timeout: 15000 });
  await page.waitForSelector('#jadwalRoot .jw-date');
  return { ctx, page, errors };
}

const text = (page, sel) => page.locator(sel).first().textContent().then((s) => s.replace(/\s+/g, ' ').trim());
const shot = (page, name) => (SHOTS ? page.screenshot({ path: join(SHOTS, name + '.png') }) : null);
const audit = async (page, root, skip, what) => assert.deepEqual(await unkeyedTexts(page, root, { skip }), [], what);

// With no changed texts, every page text under the roots shows its registered default with its vars
// filled, and so does every placeholder and title.
async function assertDefaults(page, roots, what) {
  const seen = await page.evaluate((roots) => {
    const out = [];
    const source = (el) => (el.hasAttribute('data-rich')
      ? [...el.childNodes].map((n) => (n.nodeType === 1 && n.tagName === 'B' ? '**' + n.textContent + '**' : n.textContent)).join('')
      : el.textContent);
    for (const host of document.querySelectorAll(roots)) {
      for (const el of host.querySelectorAll('[data-k]')) out.push({ k: el.dataset.k, kv: el.dataset.kv || '', got: source(el) });
      for (const el of host.querySelectorAll('[data-kp], [data-kt]')) {
        if (el.dataset.kp) out.push({ k: el.dataset.kp, kv: el.dataset.kpv || '', got: el.getAttribute('placeholder') });
        if (el.dataset.kt) out.push({ k: el.dataset.kt, kv: el.dataset.ktv || '', got: el.getAttribute('title') });
      }
    }
    return out;
  }, roots);
  const wrong = [];
  for (const s of seen) {
    const e = REG.get(s.k);
    if (!e) {
      if (MINE.test(s.k)) wrong.push(s.k + ' is not registered');
      continue;
    }
    const want = fill(e.d, s.kv ? JSON.parse(s.kv) : null);
    if (s.got !== want) wrong.push(s.k + ': ' + JSON.stringify(s.got) + ' instead of ' + JSON.stringify(want));
  }
  assert.ok(seen.length > 0, what + ': no page texts found');
  assert.deepEqual(wrong, [], what);
}

async function openFind(page) {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('dialog.fd[open]');
}

async function findFor(page, q) {
  await page.fill('.fd-q', q);
  await page.waitForFunction((q) => document.querySelector('.fd-q').value === q && document.querySelector('.fd-list').children.length > 0, q);
}

async function goDay(page, date) {
  await page.click('.jw-chip[data-date="' + date + '"]');
  await page.waitForSelector('.jw-chip[data-date="' + date + '"][aria-pressed="true"]');
}

for (const width of WIDTHS) {
  test('every text has a key, and shows its default, on a teaching day at ' + width, async () => {
    const { ctx, page, errors } = await open({ time: TEACH, width, items: BOARD, schedule: scheduleWithExtras() });
    const J = '#jadwalRoot';

    // the board: tags, pin, deadline, countdowns, the long body, the link, the button for the rest
    await page.waitForSelector('#info .ib-card');
    await page.locator('#info').scrollIntoViewIfNeeded();
    await audit(page, '#info', SKIP.info, 'board');
    assert.equal(await text(page, '.ib-h'), 'Pengumuman');
    assert.equal(await text(page, '.ib-n'), '5 aktif');
    assert.match(await text(page, '.ib-card[data-id="a2"] .ib-due'), /^Tenggat hari ini, 23\.59\d+ jam \d+ menit lagi$/);
    assert.match(await text(page, '.ib-card[data-id="a3"] .ib-left'), /^2 hari \d+ jam lagi$/);
    await shot(page, 'board-' + width);
    await page.click('.ib-more');
    assert.equal(await text(page, '.ib-more'), 'Ringkas');
    await page.click('.ib-all');
    assert.equal(await text(page, '.ib-all'), 'Tampilkan lebih sedikit');
    await audit(page, '#info', SKIP.info, 'board, all of it');
    await assertDefaults(page, '#info', 'board');

    // the schedule, once the served copy is in: two sessions running, one after them
    await page.waitForSelector(J + ' [data-k="jadwal.mon.also"]');
    await page.locator(J + ' .jw-head').scrollIntoViewIfNeeded();
    assert.equal(await text(page, '.jw-ro[data-state="now"] .jw-ro-s'), '07.30 - 10.00, barengan 1 sesi lain');
    assert.match(await text(page, '.jw-ro-x'), /^habis ini PA2\..*, 10\.00$/);
    // the note under the heading is empty: hidden, and the heading block is only the heading
    assert.equal(await page.locator(J + ' .jw-title .k-note').isVisible(), false);
    const [hTitle, hHead] = await page.evaluate(() => [document.querySelector('.jw-title').getBoundingClientRect().height, document.querySelector('.jw-h').getBoundingClientRect().height]);
    assert.ok(Math.abs(hTitle - hHead) < 0.5, 'an empty note takes no space');
    await audit(page, J, SKIP.jadwal, 'teaching day');
    await shot(page, 'jadwal-teach-' + width);
    await page.locator(J + ' .jw-s [data-add]').first().click();
    await audit(page, J, SKIP.jadwal, 'add to calendar open');
    await assertDefaults(page, J, 'teaching day');

    // search in the schedule: more hits than shown, then none
    await page.fill('.jw-q', 'blok');
    await page.waitForSelector('[data-k="jadwal.find.many"]');
    await audit(page, J, SKIP.jadwal, 'search with hits');
    await assertDefaults(page, J, 'search with hits');
    await page.fill('.jw-q', 'zzzz');
    await page.waitForFunction(() => document.querySelector('.jw-hitc').textContent === 'Nggak ketemu.');
    await page.fill('.jw-q', '');
    await page.waitForFunction(() => document.querySelector('.jw-hitc').textContent === '' && !document.querySelector('.jw-hitc').dataset.k);

    // a cancelled session, an online one with tags and an unknown lecturer code, a team
    await goDay(page, '2026-11-05');
    await page.waitForSelector(J + ' .jw-s.is-batal');
    assert.equal(await text(page, '.jw-why-k'), 'Alasan');
    assert.equal(await text(page, '.jw-s-why'), 'Dosen dinas luar');
    assert.equal(await page.getAttribute('.jw-tag.is-gab', 'title'), 'Kelas Alpha dan Beta bersama');
    assert.equal(await text(page, '.jw-p-n.is-code'), 'Kode ZZQ');
    assert.equal(await text(page, '.jw-tim'), 'Tim dosennya per kelompok');
    assert.equal(await page.locator('.jw-x [data-k="jadwal.s.batal"]').count(), 12);
    assert.equal(await page.locator('.jw-x').getAttribute('inert'), '', 'the tape is never typable');
    await audit(page, J, SKIP.jadwal, 'cancelled and online');
    await assertDefaults(page, J, 'cancelled and online');
    await page.locator(J + ' .jw-s.is-batal').scrollIntoViewIfNeeded();
    await shot(page, 'jadwal-batal-' + width);

    // a weekend, the day whose time is not out, a holiday
    await goDay(page, '2026-11-07');
    assert.equal(await text(page, '.jw-empty-t'), 'Tanggal ini kosong.');
    assert.equal(await text(page, '.jw-empty-s'), 'Weekend.');
    await audit(page, J, SKIP.jadwal, 'weekend');
    await goDay(page, '2026-12-02');
    assert.equal(await text(page, '.jw-sum'), '1 sesi, jam menyusul');
    assert.equal(await text(page, '.jw-s[data-tba] .jw-tba'), 'Jam menyusul');
    assert.equal(await text(page, '.jw-rel'), '28 hari lagi');
    await audit(page, J, SKIP.jadwal, 'time not out yet');
    await goDay(page, '2026-08-25');
    assert.equal(await text(page, '.jw-empty-s'), 'Libur Maulid Nabi Muhammad SAW.');
    assert.equal(await text(page, '.jw-rel'), '71 hari lalu');
    await audit(page, J, SKIP.jadwal, 'holiday');
    await assertDefaults(page, J, 'holiday');

    // the month calendar
    await page.click('[data-act="cal"]');
    await page.waitForSelector('.jw-cal[open]');
    await audit(page, '.jw-cal', SKIP.jadwal, 'calendar');
    await assertDefaults(page, '.jw-cal', 'calendar');
    await page.click('[data-cal="close"]');

    // the site search: the sections, a session today, a lecturer, nothing
    await openFind(page);
    await page.waitForSelector('.fd-o');
    await audit(page, 'dialog.fd', SKIP.find, 'search, empty');
    await assertDefaults(page, 'dialog.fd', 'search, empty');
    await findFor(page, 'PA2');
    await page.waitForSelector('.fd-o [data-k="find.today"]');
    assert.equal(await text(page, '[aria-labelledby="fdG-session"] .fd-o .fd-s'), 'Hari ini, 10.00 · Praktikum · Blok 4');
    await audit(page, 'dialog.fd', SKIP.find, 'search, a session today');
    await findFor(page, 'ziske');
    await audit(page, 'dialog.fd', SKIP.find, 'search, a lecturer');
    await shot(page, 'find-' + width);
    await findFor(page, 'zzqx');
    assert.equal(await text(page, '.fd-none'), 'Nggak ketemu. Coba kata lain, misalnya nama dosen, judul kuliah, atau "mitral".');
    assert.equal(await text(page, '.fd-none b'), 'Nggak ketemu.');
    await audit(page, 'dialog.fd', SKIP.find, 'search, nothing');
    await assertDefaults(page, 'dialog.fd', 'search, nothing');

    assert.deepEqual(errors, []);
    await ctx.close();
  });

  test('the evening before the CBT, whose time is not out, at ' + width, async () => {
    const { ctx, page, errors } = await open({ time: EVE, width });
    const J = '#jadwalRoot';
    assert.equal(await text(page, '.jw-ro[data-state="next"] .jw-ro-k'), 'Berikutnya');
    assert.equal(await text(page, '.jw-ro[data-state="next"] .jw-ro-s'), 'besok, jam menyusul');
    assert.equal(await text(page, '.jw-ro[data-state="next"] .jw-ro-n'), 'besok');
    assert.equal(await text(page, '.jw-ro[data-state="exam"] .jw-ro-s'), 'besok, jam menyusul');
    assert.equal(await text(page, '.jw-sum'), '1 sesi, 08.00 - selesai');
    assert.equal(await text(page, '.jw-s .jw-s-to'), 'sampai selesai');
    await page.locator(J + ' .jw-head').scrollIntoViewIfNeeded();
    await audit(page, J, SKIP.jadwal, 'evening before the CBT');
    await assertDefaults(page, J, 'evening before the CBT');
    await shot(page, 'jadwal-eve-' + width);
    await goDay(page, '2026-12-02');
    assert.equal(await text(page, '.jw-rel'), 'besok');
    await audit(page, J, SKIP.jadwal, 'the CBT day');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  test('changed texts show, a written note shows and an emptied one hides, at ' + width, async () => {
    const T = {
      'jadwal.mon.next': 'Selanjutnya', // a plain text
      'jadwal.after': 'Belum ada jadwal sesudah {blok}.', // a text with a {name}
      'jadwal.find.ph': 'cari materi, dosen, atau OSPE', // a placeholder
      'jadwal.note': 'Blok 5 menyusul.\nCek lagi tiap Senin.', // the note under the heading, two lines
      'jadwal.day.today': 'hari ini juga', // a word schedule-model.js gives
      'info.h': 'Kabar kelas',
      'info.left': 'tinggal {time}',
      'find.ph': 'Cari apa aja',
      'find.g.section': 'Langsung ke',
    };
    const items = [{ id: 'z1', title: 'Libur akhir blok', body: 'Selamat istirahat.', tag: 'info', date: '2026-12-07', due: '2026-12-09T12:00' }];
    const { ctx, page, errors } = await open({ time: AFTER, width, t: T, items });
    const J = '#jadwalRoot';
    await page.waitForFunction(() => document.querySelector('.jw-empty-s')?.textContent === 'Belum ada jadwal sesudah Blok 4.');
    assert.equal(await text(page, '.jw-empty-t'), 'Hari ini nggak ada kelas.');
    assert.equal(await text(page, '.jw-rel'), 'hari ini juga');
    assert.equal(await text(page, '.jw-ro[data-state="none"] .jw-ro-k'), 'Selanjutnya');
    assert.equal(await text(page, '.jw-ro[data-state="none"] .jw-ro-e'), 'Belum ada jadwal lagi.');
    assert.equal(await page.getAttribute('.jw-q', 'placeholder'), 'cari materi, dosen, atau OSPE');
    const note = page.locator(J + ' .jw-title .k-note');
    assert.equal(await note.isVisible(), true);
    assert.equal(await note.innerText(), 'Blok 5 menyusul.\nCek lagi tiap Senin.');
    await audit(page, J, SKIP.jadwal, 'after the last blok, with changed texts');
    await page.locator(J + ' .jw-head').scrollIntoViewIfNeeded();
    await shot(page, 'jadwal-note-' + width);

    await page.waitForSelector('#info .ib-card');
    assert.equal(await text(page, '.ib-h'), 'Kabar kelas');
    assert.match(await text(page, '.ib-left'), /^tinggal 2 hari \d+ jam$/);
    await audit(page, '#info', SKIP.info, 'board with changed texts');

    await openFind(page);
    assert.equal(await page.getAttribute('.fd-q', 'placeholder'), 'Cari apa aja');
    await page.waitForSelector('.fd-gh');
    assert.equal(await text(page, '.fd-gh'), 'Langsung ke');
    assert.deepEqual(errors, []);
    await ctx.close();

    // the note taken away again: saved empty, it hides and leaves no gap
    const second = await open({ time: AFTER, width, t: { 'jadwal.note': '', 'jadwal.h2': 'kuliah apa ya?' } });
    await second.page.waitForFunction(() => document.querySelector('.jw-h em')?.textContent === 'kuliah apa ya?');
    assert.equal(await text(second.page, '.jw-h'), 'hari ini kuliah apa ya?');
    const empty = second.page.locator(J + ' .jw-title .k-note');
    assert.equal(await empty.isVisible(), false);
    assert.equal(await empty.getAttribute('data-empty'), '');
    const [hTitle, hHead] = await second.page.evaluate(() => [document.querySelector('.jw-title').getBoundingClientRect().height, document.querySelector('.jw-h').getBoundingClientRect().height]);
    assert.ok(Math.abs(hTitle - hHead) < 0.5, 'an emptied note takes no space');
    assert.deepEqual(second.errors, []);
    await second.ctx.close();
  });
}
