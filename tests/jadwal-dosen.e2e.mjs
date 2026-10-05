// End-to-end tests for the jadwal and dosen modules on their dev pages.
// Run: node --test tests/jadwal-dosen.e2e.mjs
// Starts its own Vite dev server on a free port and drives the preinstalled Chromium.
// Set SHOTS=/some/dir to also save screenshots of every viewport.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const SHOTS = process.env.SHOTS || '';
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');

const MON_0915 = '2026-10-05T09:15:00+07:00';
const SAT_NOON = '2026-10-03T12:00:00+07:00';
const VIEWPORTS = [[280, 653], [360, 740], [390, 844], [768, 1024], [1280, 800], [1920, 1080], [2560, 1440]];

let server;
let base;
let browser;

before(async () => {
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 5180, strictPort: false, hmr: false },
  });
  await server.listen();
  base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ executablePath: CHROMIUM });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/** Opens a dev page in a fresh context with the fake clock set to `time`; it runs on from there. */
async function open(path, opts = {}) {
  const {
    time = MON_0915, viewport = { width: 1280, height: 800 }, timezoneId, reducedMotion = 'no-preference', init, permissions,
  } = opts;
  const context = await browser.newContext({ viewport, timezoneId, reducedMotion, permissions, acceptDownloads: true });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  if (time) await page.clock.install({ time: new Date(time) });
  await page.goto(base + path);
  await page.waitForSelector('html[data-ready]');
  return { page, context, errors };
}

const text = (page, sel) => page.locator(sel).first().textContent().then((t) => t.replace(/\s+/g, ' ').trim());
const dateText = (page) => text(page, '.jw-date');
const activeInfo = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return { cls: a?.className || '', date: a?.dataset?.date || '', act: a?.dataset?.act || '', open: a?.dataset?.open || '' };
});

async function readDownload(page, click) {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: download.suggestedFilename(), body: readFileSync(await download.path(), 'utf8') };
}

// The list folds after a few rows and builds the rest only once it can be seen. Open it fully.
async function dosenRendered(page) {
  await page.evaluate(() => document.querySelector('.dz').scrollIntoView());
  await page.evaluate(() => { const b = document.querySelector('.dz-more:not([hidden]) .dz-more-b'); if (b) b.click(); });
  await page.waitForFunction(() => document.querySelectorAll('.dz-row').length === 476);
}

const visibleRows = (page) => page.$$eval('.dz-row:not([hidden])', (rows) => rows.map((r) => r.querySelector('.dz-name').textContent));

async function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

async function axeSeriousOrCritical(page) {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '));
}

describe('jadwal', () => {
  for (const timezoneId of ['America/New_York', 'UTC', 'Asia/Tokyo']) {
    test('opens on WIB today with the device in ' + timezoneId, async () => {
      // 00:30 WIB on Monday is still Sunday afternoon in New York
      const { page, context, errors } = await open('/dev/jadwal.html', { time: '2026-10-05T00:30:00+07:00', timezoneId });
      assert.equal(await dateText(page), 'Senin, 5 Oktober 2026');
      assert.equal(await text(page, '.jw-rel'), 'hari ini');
      assert.equal(await page.locator('.jw-s').count(), 3);
      assert.equal(await page.getAttribute('.jw-chip[data-date="2026-10-05"]', 'aria-pressed'), 'true');
      assert.deepEqual(errors, []);
      await context.close();
    });
  }

  test('weekend says so and jumps to the next class day', async () => {
    const { page, context, errors } = await open('/dev/jadwal.html', { time: SAT_NOON });
    assert.equal(await dateText(page), 'Sabtu, 3 Oktober 2026');
    assert.equal(await text(page, '.jw-empty-t'), 'Hari ini nggak ada kelas.');
    assert.equal(await text(page, '.jw-empty-s'), 'Weekend.');
    assert.equal(await text(page, '.jw-empty .jw-btn.pri'), 'Lompat ke Senin, 5 Okt');
    assert.equal(await text(page, '.jw-empty .jw-btn:not(.pri)'), 'Balik ke Jumat, 2 Okt');
    await page.click('.jw-empty .jw-btn.pri');
    assert.equal(await dateText(page), 'Senin, 5 Oktober 2026');
    assert.equal(await page.locator('.jw-s').count(), 3);
    assert.match((await activeInfo(page)).cls, /jw-date/, 'focus moves to the date heading');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('holiday, before the term and after the term', async () => {
    const { page, context, errors } = await open('/dev/jadwal.html');
    await page.evaluate(() => window.jadwal.go('2026-08-25'));
    assert.equal(await text(page, '.jw-empty-s'), 'Libur Maulid Nabi Muhammad SAW.');
    assert.equal(await text(page, '.jw-empty-t'), 'Tanggal ini kosong.');
    await page.evaluate(() => window.jadwal.go('2026-07-01'));
    assert.equal(await text(page, '.jw-empty-s'), 'Blok 1 baru mulai Selasa, 18 Agu.');
    assert.equal(await text(page, '.jw-blokline'), 'Di luar masa blok');
    await page.evaluate(() => window.jadwal.go('2026-12-01'));
    assert.equal(await text(page, '.jw-empty-s'), 'Jadwal setelah Blok 3 belum masuk.');
    assert.equal(await text(page, '.jw-empty .jw-btn'), 'Lihat Jumat, 30 Okt');
    assert.equal(await page.isDisabled('[data-act="next"]'), true);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('now readout counts down and hands over to the next session', async () => {
    const { page, context, errors } = await open('/dev/jadwal.html', { time: '2026-10-05T10:29:40+07:00' });
    await page.clock.pauseAt(new Date('2026-10-05T10:29:50+07:00'));
    await page.clock.runFor(1100);
    assert.equal(await text(page, '.jw-ro[data-state="now"] .jw-ro-k'), 'Lagi jalan');
    assert.equal(await text(page, '.jw-ro[data-state="now"] .jw-ro-t'), 'Tutorial 1 Skenario A');
    assert.match(await text(page, '[data-until]'), /^00:00:0\d$/);
    assert.equal(await text(page, '.jw-ro-x'), 'habis ini Mekanisme Kontrol Molekuler Siklus Sel, 10.30');
    assert.match(await page.getAttribute('.jw-s >> nth=0', 'class'), /is-now/);
    await page.clock.runFor(12000);
    assert.equal(await text(page, '.jw-ro[data-state="now"] .jw-ro-t'), 'Mekanisme Kontrol Molekuler Siklus Sel');
    assert.equal(await text(page, '.jw-live'), 'Sekarang lagi jalan: Mekanisme Kontrol Molekuler Siklus Sel.');
    assert.match(await page.getAttribute('.jw-s >> nth=0', 'class'), /is-past/);
    assert.match(await page.getAttribute('.jw-s >> nth=1', 'class'), /is-now/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('on a weekend the readout counts days to Monday and to the exam', async () => {
    // 12.20 so the clock creeping a few ms during load cannot flip the hour
    const { page, context } = await open('/dev/jadwal.html', { time: '2026-10-03T12:20:00+07:00' });
    assert.equal(await text(page, '.jw-ro[data-state="next"] .jw-ro-t'), 'Tutorial 1 Skenario A');
    assert.equal(await text(page, '.jw-ro[data-state="next"] .jw-ro-s'), 'lusa, 08.00');
    assert.equal(await text(page, '[data-until]'), '1 hari 19 jam');
    assert.equal(await text(page, '.jw-ro[data-state="exam"] .jw-ro-t'), 'Ujian OSPE Blok 3');
    assert.equal(await text(page, '.jw-ro[data-state="exam"] .jw-ro-n'), '23 hari lagi');
    await page.click('.jw-ro[data-state="exam"] .jw-ro-t');
    assert.equal(await dateText(page), 'Senin, 26 Oktober 2026');
    assert.equal(await text(page, '.jw-s .jw-s-to'), 'sampai selesai');
    await context.close();
  });

  test('week strip by mouse and keyboard', async () => {
    const { page, context } = await open('/dev/jadwal.html');
    await page.click('.jw-chip[data-date="2026-10-07"]');
    assert.equal(await dateText(page), 'Rabu, 7 Oktober 2026');
    const keys = [['ArrowRight', '2026-10-08'], ['End', '2026-10-11'], ['Home', '2026-10-05'], ['PageDown', '2026-10-12'], ['ArrowLeft', '2026-10-11']];
    await page.focus('.jw-chip[aria-pressed="true"]');
    for (const [key, date] of keys) {
      await page.keyboard.press(key);
      assert.equal((await activeInfo(page)).date, date, key);
      assert.equal(await page.getAttribute('.jw-chip[data-date="' + date + '"]', 'aria-pressed'), 'true');
    }
    assert.equal(await dateText(page), 'Minggu, 11 Oktober 2026');
    assert.equal(await page.locator('.jw-strip [tabindex="0"]').count(), 1, 'one tab stop in the strip');
    await context.close();
  });

  test('previous and next skip to class days, Hari ini comes back', async () => {
    const { page, context } = await open('/dev/jadwal.html', { time: '2026-10-02T09:00:00+07:00' });
    await page.click('[data-act="next"]');
    assert.equal(await dateText(page), 'Senin, 5 Oktober 2026');
    await page.click('[data-act="next"]');
    assert.equal(await dateText(page), 'Selasa, 6 Oktober 2026');
    await page.click('[data-act="today"]');
    assert.equal(await dateText(page), 'Jumat, 2 Oktober 2026');
    assert.equal(await page.isDisabled('[data-act="today"]'), true);
    await page.click('[data-act="prev"]');
    assert.equal(await dateText(page), 'Kamis, 1 Oktober 2026');
    await context.close();
  });

  test('blok switcher shows the blok and its title', async () => {
    const { page, context } = await open('/dev/jadwal.html');
    assert.equal(await page.getAttribute('[data-blok="b3"]', 'aria-pressed'), 'true');
    assert.match(await text(page, '.jw-blokline'), /Karakter Biologi Tubuh Manusia.*ketua dr\. Ziske Maritska/);
    await page.click('[data-blok="b1"]');
    assert.equal(await dateText(page), 'Selasa, 18 Agustus 2026');
    assert.equal(await page.getAttribute('[data-blok="b1"]', 'aria-pressed'), 'true');
    assert.match(await text(page, '.jw-blokline'), /Keterampilan Belajar, Komunikasi, dan Dasar Ilmiah/);
    await page.click('[data-blok="b3"]');
    assert.equal(await dateText(page), 'Senin, 5 Oktober 2026', 'the current blok opens on today');
    await context.close();
  });

  test('calendar by mouse: dots, blok range, months, pick a day', async () => {
    const { page, context } = await open('/dev/jadwal.html');
    await page.click('[data-act="cal"]');
    assert.equal(await page.evaluate(() => document.querySelector('.jw-cal').open), true);
    assert.equal(await text(page, '.jw-cal-h'), 'Oktober 2026');
    const cls = (d) => page.getAttribute('.jw-cal td[data-date="' + d + '"]', 'class');
    assert.match(await cls('2026-10-05'), /\bhas\b.*\btoday\b/);
    assert.equal(await page.getAttribute('.jw-cal td[data-date="2026-10-05"]', 'aria-selected'), 'true');
    assert.doesNotMatch(await cls('2026-10-03'), /\bhas\b/);
    assert.match(await cls('2026-09-28'), /\binb\b.*\bbs\b/);
    assert.match(await cls('2026-10-30'), /\bbe\b/);
    assert.match(await cls('2026-10-26'), /\bexam\b/);
    await page.click('[data-cal="prev"]');
    assert.equal(await text(page, '.jw-cal-h'), 'September 2026');
    await page.click('[data-cal="prev"]');
    assert.match(await cls('2026-08-25'), /\blibur\b/);
    await page.click('[data-cal="next"]');
    await page.click('.jw-cal td[data-date="2026-09-14"]');
    assert.equal(await page.evaluate(() => document.querySelector('.jw-cal').open), false);
    assert.equal(await dateText(page), 'Senin, 14 September 2026');
    assert.equal((await activeInfo(page)).act, 'cal', 'focus returns to the calendar button');
    await page.click('[data-act="cal"]');
    await page.mouse.click(4, 400);
    assert.equal(await page.evaluate(() => document.querySelector('.jw-cal').open), false, 'backdrop click closes');
    await context.close();
  });

  test('calendar by keyboard follows the ARIA date picker keys', async () => {
    const { page, context } = await open('/dev/jadwal.html');
    await page.focus('[data-act="cal"]');
    await page.keyboard.press('Enter');
    assert.equal((await activeInfo(page)).date, '2026-10-05');
    const steps = [['ArrowRight', '2026-10-06'], ['ArrowDown', '2026-10-13'], ['Home', '2026-10-12'], ['End', '2026-10-18'],
      ['ArrowUp', '2026-10-11'], ['ArrowLeft', '2026-10-10'], ['PageDown', '2026-11-10'], ['Shift+PageUp', '2025-11-10'], ['Shift+PageDown', '2026-11-10'], ['PageUp', '2026-10-10']];
    for (const [key, date] of steps) {
      await page.keyboard.press(key);
      assert.equal((await activeInfo(page)).date, date, key);
    }
    assert.equal(await text(page, '.jw-cal-h'), 'Oktober 2026');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('.jw-cal').open), false);
    assert.equal((await activeInfo(page)).act, 'cal');
    assert.equal(await dateText(page), 'Senin, 5 Oktober 2026', 'Escape does not change the date');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    assert.equal(await dateText(page), 'Selasa, 6 Oktober 2026');
    await context.close();
  });

  test('lecturers show full name, specialty and working phone links', async () => {
    const { page, context, errors } = await open('/dev/jadwal.html', { permissions: ['clipboard-read', 'clipboard-write'] });
    const rara = page.locator('.jw-s', { hasText: 'Mekanisme Kontrol' }).locator('.jw-p');
    assert.equal(await rara.locator('.jw-p-n').textContent(), 'Rara Inggarsih, S.S.T., M.Kes');
    assert.equal(await rara.locator('.jw-p-s').textContent(), 'Dosen');
    assert.equal(await rara.locator('a', { hasText: 'Telp' }).getAttribute('href'), 'tel:+6283178580581');
    const wa = rara.locator('a', { hasText: 'WA' });
    assert.equal(await wa.getAttribute('href'), 'https://wa.me/6283178580581');
    assert.equal(await wa.getAttribute('target'), '_blank');
    assert.equal(await wa.getAttribute('rel'), 'noopener');
    await rara.locator('[data-copy]').click();
    await rara.locator('[data-copy]', { hasText: 'Tersalin' }).waitFor();
    assert.equal(await rara.locator('[data-copy]').textContent(), 'Tersalin 0831-7858-0581');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '083178580581');
    await page.clock.runFor(200);
    assert.equal(await text(page, '.jw-live'), 'Nomor 0831-7858-0581 disalin.');
    const landline = page.locator('.jw-s', { hasText: 'DNA Mitokondria' }).locator('.ct-ph', { hasText: '0711-411663' });
    assert.equal(await landline.locator('a', { hasText: 'Telp' }).getAttribute('href'), 'tel:+62711411663');
    assert.equal(await landline.locator('a', { hasText: 'WA' }).count(), 0, 'no WhatsApp for a landline');
    assert.equal(await text(page, '.jw-s .jw-tim'), 'Tim dosennya per kelompok');
    assert.equal(await text(page, '.jw-s .jw-loc'), 'Kampus FK Unsri KM.6');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('PJ is marked and explained', async () => {
    const { page, context } = await open('/dev/jadwal.html');
    await page.evaluate(() => window.jadwal.go('2026-10-12'));
    const pb = page.locator('.jw-s', { hasText: 'PB-1 Pedigree' });
    assert.equal(await pb.locator('.jw-p').count(), 2);
    assert.equal(await pb.locator('.jw-pj').count(), 2);
    assert.equal(await pb.locator('.jw-s-note').textContent(), 'Praktikum paralel.');
    assert.equal(await text(page, '.jw-note'), 'PJ penanggung jawab. Yang ngajar di kelas bisa dosen lain.');
    await context.close();
  });

  test('add to calendar: Google link and .ics for a session, a day and a blok', async () => {
    const { page, context } = await open('/dev/jadwal.html');
    const s = page.locator('.jw-s', { hasText: 'Mekanisme Kontrol' });
    await s.locator('[data-add]').click();
    assert.equal(await s.locator('[data-add]').getAttribute('aria-expanded'), 'true');
    const g = new URL(await s.locator('a', { hasText: 'Google Calendar' }).getAttribute('href'));
    assert.equal(g.hostname, 'calendar.google.com');
    assert.equal(g.searchParams.get('dates'), '20261005T103000/20261005T121000');
    assert.equal(g.searchParams.get('ctz'), 'Asia/Jakarta');

    const one = await readDownload(page, () => s.locator('[data-ics="session"]').click());
    assert.equal(one.name, 'alpha-2026-10-05-mekanisme-kontrol-molekuler-siklus-sel.ics');
    assert.match(one.body, /^BEGIN:VCALENDAR\r\n/);
    assert.ok(one.body.includes('\r\nDTSTART;TZID=Asia/Jakarta:20261005T103000\r\n'));
    assert.ok(one.body.includes('\r\nBEGIN:VTIMEZONE\r\nTZID:Asia/Jakarta\r\n'));
    assert.equal(one.body.replaceAll('\r\n', '').includes('\n'), false, 'CRLF only');
    for (const line of one.body.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);

    const day = await readDownload(page, () => page.click('[data-ics="day"]'));
    assert.equal(day.name, 'alpha-2026-10-05.ics');
    assert.equal(day.body.split('\r\nBEGIN:VEVENT\r\n').length - 1, 3);

    const blok = await readDownload(page, () => page.click('[data-ics="blok"]'));
    assert.equal(blok.name, 'alpha-blok-3.ics');
    assert.equal(blok.body.split('\r\nBEGIN:VEVENT\r\n').length - 1, 53);
    await context.close();
  });

  test('search over every session jumps to its day', async () => {
    const { page, context } = await open('/dev/jadwal.html');
    await page.fill('.jw-q', 'pedigree');
    await page.waitForFunction(() => document.querySelectorAll('.jw-hit').length === 1);
    assert.equal(await text(page, '.jw-hitc'), '1 sesi ketemu');
    assert.equal(await text(page, '.jw-hit-m'), 'Sen, 12 Okt, 10.30, Praktikum');
    await page.click('.jw-hit');
    assert.equal(await dateText(page), 'Senin, 12 Oktober 2026');
    assert.match(await page.getAttribute('.jw-s:has-text("Pedigree")', 'class'), /is-flash/);
    await page.fill('.jw-q', 'zzzz');
    await page.waitForFunction(() => document.querySelector('.jw-hitc').textContent === 'Nggak ketemu.');
    await context.close();
  });

  test('the viewed date lasts for the tab session only', async () => {
    const { page, context } = await open('/dev/jadwal.html');
    await page.click('.jw-chip[data-date="2026-10-07"]');
    await page.reload();
    await page.waitForSelector('html[data-ready]');
    assert.equal(await dateText(page), 'Rabu, 7 Oktober 2026');
    await context.close();
    const fresh = await open('/dev/jadwal.html');
    assert.equal(await dateText(fresh.page), 'Senin, 5 Oktober 2026');
    await fresh.context.close();
  });

  test('alpha:open events in and out', async () => {
    const { page, context } = await open('/dev/jadwal.html');
    await page.evaluate(() => {
      window.__opened = [];
      document.addEventListener('alpha:open', (e) => window.__opened.push(e.detail));
    });
    await page.click('.jw-s:has-text("Mekanisme") .jw-p-n');
    assert.deepEqual(await page.evaluate(() => window.__opened), [{ type: 'dosen', id: 'rara-inggarsih' }]);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('alpha:open', { detail: { type: 'date', date: '2026-09-21' } })));
    assert.equal(await dateText(page), 'Senin, 21 September 2026');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('alpha:open', { detail: { type: 'date', date: 'nope' } })));
    assert.equal(await dateText(page), 'Senin, 21 September 2026', 'bad dates are ignored');
    await context.close();
  });
});

describe('dosen', () => {
  test('instant search by name, title, phone and blok code', async () => {
    const { page, context, errors } = await open('/dev/dosen.html');
    await dosenRendered(page);
    assert.equal(await text(page, '.dz-count'), '476 dosen');
    const search = async (q) => {
      await page.fill('.dz-q', q);
      await page.waitForFunction((v) => document.querySelector('.dz-q').value === v, q);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await page.evaluate(() => new Promise(requestAnimationFrame));
      return visibleRows(page);
    };
    assert.deepEqual(await search('abarham'), ['dr. H. Abarham Martadiansyah, SpOG, Subsp.KFM']);
    assert.equal(await text(page, '.dz-count'), '1 dari 476 dosen');
    assert.deepEqual(await search('ABARHAM martadiansyah'), ['dr. H. Abarham Martadiansyah, SpOG, Subsp.KFM']);
    const spog = await search('spog');
    assert.ok(spog.length > 30 && spog.every((n) => /sp\.?\s?og/i.test(n)), 'title search ignores dots');
    assert.deepEqual(await search('7178-1602'), ['dr. H. Abarham Martadiansyah, SpOG, Subsp.KFM']);
    assert.deepEqual(await search('+62 812 7178 1602'), ['dr. H. Abarham Martadiansyah, SpOG, Subsp.KFM']);
    assert.deepEqual(await search('AH'), ['dr. Alfian Hasbi, SpRad']);
    const ah = await search('ah');
    assert.ok(ah.length > 10 && ah.includes('dr. Alfian Hasbi, SpRad'));
    assert.deepEqual(await search('zzqx'), []);
    assert.equal(await page.isVisible('.dz-empty'), true);
    assert.equal(await text(page, '.dz-empty-t'), 'Nggak ketemu.');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('blok and specialty filters with live counts', async () => {
    const { page, context } = await open('/dev/dosen.html');
    await dosenRendered(page);
    const chip = (sel) => page.locator(sel);
    assert.equal(await chip('[data-blok="b2"]').textContent(), 'Blok 2 12');
    const groupCounts = await page.$$eval('.dz-chips-spec .dz-chip-n', (els) => els.map((e) => +e.textContent));
    assert.equal(groupCounts.reduce((a, b) => a + b, 0), 476, 'every person is in exactly one specialty group');
    await chip('[data-blok="b1"]').click();
    assert.equal((await visibleRows(page)).length, 18);
    assert.equal(await chip('[data-blok="b1"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await chip('[data-group="nondokter"]').textContent(), 'Non-dokter 5');
    await chip('[data-group="nondokter"]').click();
    assert.equal((await visibleRows(page)).length, 5, 'blok 1 and non-dokter: only people with both tags');
    assert.equal(await chip('[data-blok="b2"]').textContent(), 'Blok 2 2', 'the count says what adding the chip leaves');
    await chip('[data-blok="b2"]').click();
    assert.deepEqual((await visibleRows(page)).sort(), ['Catherine Dwi Augusthi Putri, SKM., M.KM', 'Drs. Sadakata Sinulingga, Apt., M.Kes'], 'blok chips combine with AND');
    assert.match(await text(page, '.dz-active'), /Blok 1 dan Blok 2.*Non-dokter/);
    await chip('[data-group="dokter"]').click();
    assert.equal(await chip('[data-group="nondokter"]').getAttribute('aria-pressed'), 'false', 'one specialty at a time');
    assert.equal((await visibleRows(page)).length, 3);
    assert.equal(await chip('[data-blok="b3"]').isDisabled(), true, 'nobody teaches in all three bloks, so the chip is off');
    await page.click('.dz-clear');
    assert.equal((await visibleRows(page)).length, 476);
    assert.equal(await page.isHidden('.dz-clear'), true);
    await context.close();
  });

  test('the full list folds back with Ringkas', async () => {
    const { page, context } = await open('/dev/dosen.html', { reducedMotion: 'reduce' });
    await page.evaluate(() => document.querySelector('.dz').scrollIntoView());
    assert.equal(await page.isVisible('.dz-more-b'), true);
    assert.ok((await page.locator('.dz-row').count()) < 476, 'rows past the fold are not built yet');
    await page.click('.dz-more-b');
    await page.waitForFunction(() => document.querySelectorAll('.dz-row').length === 476);
    assert.equal(await page.isVisible('.dz-less-b'), true);
    await page.evaluate(() => document.querySelector('.dz-less-b').scrollIntoView());
    await page.click('.dz-less-b');
    assert.equal(await page.evaluate(() => document.querySelector('.dz').classList.contains('dz-folded')), true);
    const tools = await page.locator('.dz-tools').boundingBox();
    assert.ok(tools.y > -10 && tools.y < 400, 'back at the search box');
    await context.close();
  });

  test('letter index jumps to the group', async () => {
    const { page, context } = await open('/dev/dosen.html', { reducedMotion: 'reduce' });
    await page.click('.dz-az-b[data-letter="Y"]');
    const box = await page.locator('.dz-g[data-letter="Y"] .dz-g-h').boundingBox();
    assert.ok(box.y >= 0 && box.y < 800, 'Y heading is on screen');
    assert.match((await activeInfo(page)).cls, /dz-g-h/);
    await context.close();
  });

  test('detail dialog lists the sessions, Escape closes, focus returns', async () => {
    const { page, context } = await open('/dev/dosen.html');
    await dosenRendered(page);
    await page.fill('.dz-q', 'ziske');
    await page.waitForFunction(() => document.querySelectorAll('.dz-row:not([hidden])').length === 1);
    const name = page.locator('.dz-row:not([hidden]) .dz-name');
    await name.click();
    assert.equal(await page.evaluate(() => document.querySelector('.dz-dlg').open), true);
    assert.equal(await text(page, '.dz-dlg-n'), 'dr. Ziske Maritska, M.Si.Med');
    assert.match((await activeInfo(page)).cls, /dz-dlg-n/);
    assert.equal(await page.locator('.dz-se li').count(), 7);
    assert.equal(await text(page, '.dz-dlg-codes'), 'Blok 3, kode ZM');
    assert.equal(await page.locator('.dz-se .is-past').count(), 4, 'sessions before Monday 09.15 are marked past');
    assert.match(await text(page, '.dz-se li:nth-child(5)'), /Single Genes.*berikutnya/);
    assert.equal(await page.locator('.dz-dlg a[href="tel:+6281224801100"]').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('.dz-dlg').open), false);
    assert.equal((await activeInfo(page)).open, 'ziske-maritska');
    await context.close();
  });

  test('alpha:open with a dosen id scrolls to and opens the person', async () => {
    const { page, context } = await open('/dev/dosen.html', { reducedMotion: 'reduce' });
    await page.fill('.dz-q', 'zzzz');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('alpha:open', { detail: { type: 'dosen', id: 'triwani' } })));
    assert.equal(await text(page, '.dz-dlg-n'), 'dr. Triwani, M.Kes');
    assert.equal(await page.inputValue('.dz-q'), '', 'filters hiding the person are cleared');
    const row = await page.locator('.dz-row[data-id="triwani"]').boundingBox();
    assert.ok(row.y > 0 && row.y < 800, 'row scrolled into view');
    assert.equal(await page.evaluate(() => window.dosen.open('nobody')), false);
    await context.close();
  });
});

describe('together', () => {
  test('lecturer in the schedule opens the directory and back again', async () => {
    const { page, context, errors } = await open('/dev/jadwal.html?both', { reducedMotion: 'reduce' });
    await page.click('.jw-s:has-text("Mekanisme") .jw-p-n');
    assert.equal(await page.evaluate(() => document.querySelector('.dz-dlg').open), true);
    assert.equal(await text(page, '.dz-dlg-n'), 'Rara Inggarsih, S.S.T., M.Kes');
    const target = page.locator('.dz-se-b[data-date="2026-09-29"]');
    assert.match(await target.textContent(), /DNA and Genes/);
    await target.click();
    assert.equal(await page.evaluate(() => document.querySelector('.dz-dlg').open), false);
    assert.equal(await dateText(page), 'Selasa, 29 September 2026');
    assert.match((await activeInfo(page)).cls, /jw-date/);
    assert.match(await page.getAttribute('.jw-s:has-text("DNA and Genes")', 'class'), /is-flash/);
    const top = await page.locator('.jw-date').boundingBox();
    assert.ok(top.y >= 0 && top.y < 800, 'schedule scrolled back into view');
    assert.deepEqual(errors, []);
    await context.close();
  });

  for (const [width, height] of VIEWPORTS) {
    test('no sideways scroll at ' + width + 'x' + height, async () => {
      const { page, context, errors } = await open('/dev/jadwal.html?both', { viewport: { width, height } });
      await page.evaluate(() => document.fonts.ready);
      assert.ok(await noOverflow(page), 'page');
      if (SHOTS) await page.screenshot({ path: SHOTS + '/w1-jadwal-' + width + 'x' + height + '.png' });
      await page.evaluate(() => window.jadwal.go('2026-10-13'));
      assert.ok(await noOverflow(page), 'long practicum day');
      await page.click('[data-act="cal"]');
      assert.ok(await noOverflow(page), 'calendar open');
      const cal = await page.locator('.jw-cal').boundingBox();
      assert.ok(cal.x >= 0 && cal.x + cal.width <= width + 0.5, 'calendar inside the viewport');
      if (SHOTS) {
        await page.waitForTimeout(450); // past the open animation
        await page.screenshot({ path: SHOTS + '/w1-calendar-' + width + 'x' + height + '.png' });
      }
      await page.keyboard.press('Escape');
      await dosenRendered(page);
      assert.ok(await noOverflow(page), 'directory');
      if (SHOTS) {
        await page.evaluate(() => document.querySelector('.dz').scrollIntoView());
        await page.screenshot({ path: SHOTS + '/w1-dosen-' + width + 'x' + height + '.png' });
      }
      await page.evaluate(() => window.dosen.open('rachmat-hidayat'));
      const dlg = await page.locator('.dz-dlg').boundingBox();
      assert.ok(dlg.x >= 0 && dlg.x + dlg.width <= width + 0.5, 'dialog inside the viewport');
      if (SHOTS) {
        await page.waitForTimeout(900); // let the row scroll and the sheet settle
        await page.screenshot({ path: SHOTS + '/w1-detail-' + width + 'x' + height + '.png' });
      }
      assert.ok(await noOverflow(page), 'dialog open');
      assert.deepEqual(errors, []);
      await context.close();
    });
  }

  test('prefers-reduced-motion renders final states', async () => {
    const { page, context } = await open('/dev/jadwal.html?both', { reducedMotion: 'reduce' });
    await page.click('[data-act="next"]');
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'no running animations after a date change');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.jw-chip')).transitionDuration), '0s');
    await page.click('[data-act="today"]');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.jw-s.is-now'), '::before').animationName), 'none');
    await page.click('[data-act="cal"]');
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'calendar opens without animation');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dosen.open('triwani'));
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'dialog opens without animation');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/w1-reduced-motion-1280x800.png' });
    await context.close();
  });

  test('works with storage blocked', async () => {
    const blockStorage = () => {
      for (const key of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, key, { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
      }
    };
    const { page, context, errors } = await open('/dev/jadwal.html?both', { init: blockStorage });
    assert.equal(await dateText(page), 'Senin, 5 Oktober 2026');
    await page.click('.jw-chip[data-date="2026-10-07"]');
    assert.equal(await dateText(page), 'Rabu, 7 Oktober 2026');
    await page.reload();
    await page.waitForSelector('html[data-ready]');
    assert.equal(await dateText(page), 'Senin, 5 Oktober 2026', 'nothing remembered, opens on today');
    await page.fill('.dz-q', 'abarham');
    await dosenRendered(page);
    assert.equal((await visibleRows(page)).length, 1);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('axe: no serious or critical violations', async () => {
    const { page, context } = await open('/dev/jadwal.html?both');
    await dosenRendered(page);
    assert.deepEqual(await axeSeriousOrCritical(page), [], 'page');
    await page.evaluate(() => window.jadwal.go('2026-10-03'));
    assert.deepEqual(await axeSeriousOrCritical(page), [], 'empty day');
    await page.click('[data-act="cal"]');
    assert.deepEqual(await axeSeriousOrCritical(page), [], 'calendar open');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dosen.open('rara-inggarsih'));
    assert.deepEqual(await axeSeriousOrCritical(page), [], 'detail dialog open');
    await context.close();
  });
});
