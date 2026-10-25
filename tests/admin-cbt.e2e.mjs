// Browser checks for the "Peserta try out" tab of /admin/ on the --mode mock build, served with
// the production headers (CSP included). The mock backend answers /api/cbt/admin from memory:
//   /admin/?mock#tryout              the server has no setup code yet
//   /admin/?mock&cbt=ready#tryout    set up, 20 made-up classmates, a log with a NIM conflict
//   /admin/?mock&cbt=down#tryout     the first answer is a 503, the retry works
//
//   npx vite build --mode mock --outDir dist-mock && node --test tests/admin-cbt.e2e.mjs
// SHOTS=<dir> keeps screenshots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { serveDist } from './lib/serve-dist.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AXE = readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8');
const SHOTS = process.env.SHOTS || '';
const FIRESTORE = 'https://firestore.googleapis.com';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let srv, browser;
before(async () => {
  assert.ok(existsSync(join(process.env.DIST_MOCK_DIR || join(ROOT, 'dist-mock'), 'admin', 'index.html')), 'run "npx vite build --mode mock --outDir dist-mock" first');
  srv = await serveDist({ dir: process.env.DIST_MOCK_DIR || join(ROOT, 'dist-mock') });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
});
after(async () => { await browser?.close(); srv?.server.close(); });

/** Opens a page and collects console errors, CSP violations and requests to other hosts. */
async function open(path, { width = 1280, height = 800 } = {}) {
  const mobile = width < 900;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, timezoneId: 'Asia/Jakarta' });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  // the portal reads edited content from Firestore; answered like an empty database
  await context.route(FIRESTORE + '/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":404}}' }));
  const page = await context.newPage();
  const problems = [];
  const requests = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    const where = m.location().url || '';
    if (m.text().startsWith('Failed to load resource') && where.startsWith(FIRESTORE)) return;
    // the portal under the Panel has its own suites; here only its errors count
    if (m.type() === 'error' || (m.type() === 'warning' && where.includes('/admin/'))) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(srv.url + path, { waitUntil: 'load' });
  return { page, context, problems, requests };
}

async function finish(s) {
  for (const f of s.page.frames()) assert.deepEqual(await f.evaluate(() => window.__csp || []).catch(() => []), [], 'CSP violations in ' + f.url());
  assert.deepEqual(s.problems, [], 'console errors');
  const outside = s.requests.filter((u) => !u.startsWith(srv.url) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith(FIRESTORE));
  assert.deepEqual(outside, [], 'requests to other hosts');
  await s.context.close();
}

const shot = (page, name, fullPage = false) => (SHOTS ? page.screenshot({ path: join(SHOTS, name + '.png'), fullPage, caret: 'initial' }) : null);
const rows = (page) => page.locator('li.cbt-p');
const row = (page, name) => page.locator('li.cbt-p', { hasText: name });
const dialog = (page) => page.locator('dialog[open]');
const filter = (page, label) => page.getByRole('group', { name: 'Saring' }).getByRole('button', { name: new RegExp('^' + label) });
const toastHas = async (page, s) => (await page.locator('.toast').allInnerTexts()).some((t) => t.includes(s));
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const focused = (page) => page.evaluate(() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').trim());

async function counts(page) {
  return Object.fromEntries(await page.locator('.cbt-counts li').evaluateAll((lis) => lis.map((li) => [li.querySelector('.l').textContent.trim(), li.querySelector('.n').textContent.trim()])));
}

async function ready(path = '/admin/?mock&cbt=ready#tryout', size) {
  const s = await open(path, size);
  await rows(s.page).first().waitFor();
  return s;
}

async function openRow(page, name) {
  const r = row(page, name);
  await r.locator('.disclose').click();
  await r.locator('.cbt-panel').waitFor();
  return r;
}

async function axe(page) {
  await page.evaluate(AXE); // through devtools, so the page CSP does not see an inline script
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '));
  });
}

test('not ready: one line on why, a wrong code is refused, the right one installs', async () => {
  const s = await open('/admin/?mock#tryout');
  const { page } = s;
  await page.getByLabel('Kode setup').waitFor();
  assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), 'Peserta try out');
  assert.equal(await page.getByRole('navigation', { name: 'Konten' }).getByRole('button', { name: 'Peserta try out' }).getAttribute('aria-current'), 'page');
  for (const sel of ['.toolbar', '.savebar', '.doc-head .state']) assert.equal(await page.locator(sel).isVisible(), false, sel + ' is hidden');
  assert.equal(await page.title(), 'Peserta try out · Admin Alphangers');
  assert.match(await page.locator('.cbt-status').innerText(), /belum siap/i);
  assert.equal(await rows(page).count(), 0, 'no list before the server can open it');
  await shot(page, 'not-ready-1280', true);

  const code = page.getByLabel('Kode setup');
  await page.getByRole('button', { name: 'Pasang' }).click();
  assert.equal(await code.getAttribute('aria-invalid'), 'true', 'empty is refused before sending');
  await code.fill('kode-yang-salah');
  await page.getByRole('button', { name: 'Pasang' }).click();
  await page.waitForFunction(() => /tidak cocok/.test(document.querySelector('.cbt-setup .msg')?.textContent || ''));
  assert.equal(await code.getAttribute('aria-invalid'), 'true');
  await code.fill('mock-setup-code');
  await code.press('Enter');
  await rows(page).first().waitFor();
  assert.equal(await rows(page).count(), 20);
  assert.match(await page.locator('.cbt-status').innerText(), /siap/i);
  assert.doesNotMatch(await page.locator('.cbt-status').innerText(), /belum siap/i);
  assert.ok(await toastHas(page, 'terpasang'));
  await finish(s);
});

test('setup link: the code fills the field and leaves the address bar at once', async () => {
  const s = await open('/admin/?mock#tryout/pasang=mock-setup-code');
  const { page } = s;
  await page.getByLabel('Kode setup').waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#tryout');
  assert.equal(await page.getByLabel('Kode setup').inputValue(), 'mock-setup-code');
  await page.getByRole('button', { name: 'Pasang' }).click();
  await rows(page).first().waitFor();
  assert.equal(await page.getByLabel('Kode setup').count(), 0);
  assert.ok(!s.requests.some((u) => u.includes('mock-setup-code')), 'the code never went over the network');
  await finish(s);

  // the same link opened in a tab that already shows another tab (not Links: its page-text
  // loader parses the portal's HTML with DOMParser, which Chrome reports as inline styles)
  const t = await open('/admin/?mock#announcements');
  await t.page.getByRole('heading', { level: 1, name: 'Pengumuman' }).waitFor();
  await t.page.evaluate(() => { location.hash = '#tryout/pasang=mock-setup-code'; });
  await t.page.getByLabel('Kode setup').waitFor();
  assert.equal(await t.page.evaluate(() => location.hash), '#tryout');
  assert.equal(await t.page.getByLabel('Kode setup').inputValue(), 'mock-setup-code');
  await finish(t);
});

test('list: counts, search by name, NIM or email, every filter, the log', async () => {
  const s = await ready();
  const { page } = s;
  assert.deepEqual(await counts(page), { 'orang di daftar': '20', 'sudah masuk': '12', diblokir: '2' });
  await shot(page, 'ready-1280', true);

  const search = page.getByLabel('Cari peserta');
  await search.fill('DÉWI');
  assert.deepEqual(await rows(page).locator('.cbt-name').allInnerTexts(), ['Dewi Kartika Sari']);
  await search.fill('261007');
  assert.deepEqual(await rows(page).locator('.cbt-name').allInnerTexts(), ['Galuh Prameswari']);
  await search.fill('kucingoren');
  assert.deepEqual(await rows(page).locator('.cbt-name').allInnerTexts(), ['Dewi Kartika Sari']);
  assert.match(await rows(page).first().locator('.cbt-acct').innerText(), /perlu dicek/);
  await search.fill('');

  for (const [label, n] of [['Sudah masuk', 12], ['Belum masuk', 8], ['Perlu dicek', 3], ['Diblokir', 2], ['Semua', 20]]) {
    await filter(page, label).click();
    assert.equal(await rows(page).count(), n, label);
    assert.equal(await filter(page, label).getAttribute('aria-pressed'), 'true');
  }
  await filter(page, 'Perlu dicek').click();
  assert.deepEqual((await rows(page).locator('.cbt-acct .chip').allInnerTexts()).sort(), ['mirip', 'mirip', 'perlu dicek']);
  await filter(page, 'Belum masuk').click();
  assert.ok((await rows(page).locator('.cbt-acct').allInnerTexts()).every((t) => /Belum masuk/.test(t)));
  await filter(page, 'Diblokir').click();
  assert.equal(await rows(page).locator('.chip.is-blocked').count(), 2);
  await search.fill('adinda');
  assert.match(await page.locator('.cbt-results .empty').innerText(), /Tidak ada yang cocok/);
  await page.getByRole('button', { name: 'Tampilkan semua' }).click();
  assert.equal(await rows(page).count(), 20);
  assert.equal(await search.inputValue(), '');

  // the log: newest first, conflicts and a claim on a blocked NIM in plain words
  const log = page.locator('.cbt-log li');
  assert.match(await log.first().innerText(), /mencoba NIM 04011999261004.*yang sudah dipakai akun lain/s);
  assert.match(await log.first().innerText(), /40 menit lalu/);
  assert.ok((await log.allInnerTexts()).some((t) => /yang sedang diblokir/.test(t)));
  assert.match(await page.locator('.cbt-accts').innerText(), /akun\.tak\.dikenal@gmail\.com/);
  await finish(s);
});

test('block then unblock: a dialog that names the person, search, filter, scroll and focus kept', async () => {
  const s = await ready();
  const { page } = s;
  await filter(page, 'Sudah masuk').click();
  await page.getByLabel('Cari peserta').fill('josua');
  const r = await openRow(page, 'Josua Parulian Sitorus');
  await r.getByRole('button', { name: /^Blokir Josua/ }).click();
  await dialog(page).waitFor();
  assert.equal(await dialog(page).getByRole('heading').innerText(), 'Blokir Josua Parulian Sitorus?');
  assert.match(await dialog(page).innerText(), /04011999261010/);
  assert.match(await dialog(page).innerText(), /pesan netral/);
  await shot(page, 'dialog-block-1280');
  await dialog(page).getByRole('button', { name: 'Batal' }).click();
  assert.equal(await r.locator('.chip.is-blocked').count(), 0, 'cancel changes nothing');

  await r.getByRole('button', { name: /^Blokir Josua/ }).click();
  const y = await page.evaluate(() => scrollY);
  await dialog(page).getByRole('button', { name: 'Blokir', exact: true }).click();
  assert.equal(await r.getAttribute('aria-busy'), 'true', 'busy at once');
  await r.locator('.chip.is-blocked').waitFor();
  assert.equal(await r.getAttribute('aria-busy'), null);
  assert.ok(await toastHas(page, 'diblokir'));
  assert.equal(await page.getByLabel('Cari peserta').inputValue(), 'josua');
  assert.equal(await filter(page, 'Sudah masuk').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => scrollY), y);
  assert.equal(await focused(page), 'Buka blokir Josua Parulian Sitorus');
  assert.equal((await counts(page)).diblokir, '3');

  await r.getByRole('button', { name: /^Buka blokir Josua/ }).click();
  assert.equal(await dialog(page).getByRole('heading').innerText(), 'Buka blokir Josua Parulian Sitorus?');
  await dialog(page).getByRole('button', { name: 'Buka blokir', exact: true }).click();
  await r.locator('.chip.is-blocked').waitFor({ state: 'detached' });
  assert.equal((await counts(page)).diblokir, '2');
  assert.equal(await focused(page), 'Blokir Josua Parulian Sitorus');
  const log = await page.locator('.cbt-log li').allInnerTexts();
  assert.match(log[0], /Kamu membuka blokir Josua Parulian Sitorus/);
  assert.match(log[1], /Kamu memblokir Josua Parulian Sitorus/);
  await finish(s);
});

test('release an account, block an impostor account and free its NIM, then unblock it', async () => {
  const s = await ready();
  const { page } = s;
  const search = page.getByLabel('Cari peserta');
  await search.fill('galuh');
  let r = await openRow(page, 'Galuh Prameswari');
  await r.getByRole('button', { name: /^Lepas akun/ }).click();
  assert.match(await dialog(page).innerText(), /galuhpw@gmail\.com.*04011999261007/s);
  await dialog(page).getByRole('button', { name: 'Lepas akun', exact: true }).click();
  await page.waitForFunction(() => /Belum masuk/.test(document.querySelector('li.cbt-p .cbt-acct')?.textContent || ''));
  assert.equal((await counts(page))['sudah masuk'], '11');
  assert.ok(await toastHas(page, 'dilepas'));

  await search.fill('dewi');
  r = await openRow(page, 'Dewi Kartika Sari');
  await r.getByRole('button', { name: /^Blokir akun Google ini/ }).click();
  const free = dialog(page).getByRole('checkbox');
  assert.equal(await free.isChecked(), true, 'freeing the NIM is the default');
  assert.match(await dialog(page).innerText(), /kucingoren\.77@gmail\.com/);
  await dialog(page).getByRole('button', { name: 'Blokir akun', exact: true }).click();
  await page.locator('.cbt-accts li', { hasText: 'kucingoren.77@gmail.com' }).waitFor();
  await page.waitForFunction(() => /Belum masuk/.test(document.querySelector('li.cbt-p .cbt-acct')?.textContent || ''));
  assert.equal((await counts(page))['sudah masuk'], '10');
  const log = await page.locator('.cbt-log li').allInnerTexts();
  assert.match(log[0], /Kamu melepas akun kucingoren\.77@gmail\.com dari Dewi Kartika Sari/);
  assert.match(log[1], /Kamu memblokir akun .*kucingoren\.77@gmail\.com/);

  const acct = page.locator('.cbt-accts li', { hasText: 'kucingoren.77@gmail.com' });
  await acct.getByRole('button', { name: /^Buka blokir/ }).click();
  assert.match(await dialog(page).getByRole('heading').innerText(), /kucingoren\.77@gmail\.com/);
  await dialog(page).getByRole('button', { name: 'Buka blokir', exact: true }).click();
  await acct.waitFor({ state: 'detached' });
  await finish(s);
});

test('add a person with the form, errors shown in place, then remove them', async () => {
  const s = await ready();
  const { page } = s;
  await page.getByRole('button', { name: 'Tambah orang' }).click();
  const name = page.getByLabel('Nama lengkap');
  const nim = page.getByLabel('NIM', { exact: true });
  await name.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), await name.getAttribute('id'));
  const submit = page.getByRole('button', { name: 'Tambah ke daftar' });
  await submit.click();
  assert.equal(await name.getAttribute('aria-invalid'), 'true');
  assert.equal(await nim.getAttribute('aria-invalid'), 'true');
  await name.fill('Budi 2');
  await nim.fill('abc');
  await submit.click();
  assert.match(await page.locator('form.cbt-add').innerText(), /huruf/);
  assert.match(await page.locator('form.cbt-add').innerText(), /angka/);
  await shot(page, 'add-errors-1280');

  await name.fill('Adinda Lagi');
  await nim.fill('04011999261001');
  await submit.click();
  await page.waitForFunction(() => /sudah ada di daftar/.test(document.querySelector('form.cbt-add')?.textContent || ''));

  await name.fill('Gita Ayu Lestari');
  await nim.fill('0401 1999 2610 99');
  await submit.click();
  await page.locator('form.cbt-add').waitFor({ state: 'detached' });
  assert.ok(await toastHas(page, 'Gita Ayu Lestari'));
  assert.equal((await counts(page))['orang di daftar'], '21');
  await page.getByLabel('Cari peserta').fill('261099');
  const r = await openRow(page, 'Gita Ayu Lestari');
  assert.match(await r.innerText(), /Ditambah admin/);
  await r.getByRole('button', { name: /^Hapus dari daftar/ }).click();
  assert.match(await dialog(page).innerText(), /Gita Ayu Lestari/);
  await dialog(page).getByRole('button', { name: 'Hapus', exact: true }).click();
  await r.waitFor({ state: 'detached' });
  assert.equal((await counts(page))['orang di daftar'], '20');
  await finish(s);
});

test('keyboard only: find a person, open the row, block, confirm', async () => {
  const s = await ready();
  const { page } = s;
  await page.getByLabel('Cari peserta').focus();
  await page.keyboard.type('rahma');
  for (let i = 0; i < 12 && !(await page.evaluate(() => document.activeElement?.matches('li.cbt-p .disclose'))); i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.matches('li.cbt-p .disclose')), true, 'Tab reaches the row');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-expanded')), 'true');
  await page.keyboard.press('Tab');
  assert.equal(await focused(page), 'Blokir Rahma Aulia Putri');
  await page.keyboard.press('Enter');
  await dialog(page).waitFor();
  assert.equal(await focused(page), 'Batal', 'a risky dialog starts on Batal');
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'detached' });
  assert.equal(await focused(page), 'Blokir Rahma Aulia Putri');
  await page.keyboard.press('Enter');
  await dialog(page).waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await focused(page), 'Blokir');
  await page.keyboard.press('Enter');
  await row(page, 'Rahma Aulia Putri').locator('.chip.is-blocked').waitFor();
  assert.equal(await focused(page), 'Buka blokir Rahma Aulia Putri');
  await finish(s);
});

test('a failed load says why and the retry works', async () => {
  const s = await open('/admin/?mock&cbt=down#tryout');
  const { page } = s;
  const banner = page.locator('.cbt-status .banner.err');
  await banner.waitFor();
  assert.match(await banner.innerText(), /bermasalah/);
  await banner.getByRole('button', { name: 'Coba lagi' }).click();
  await rows(page).first().waitFor();
  assert.equal(await rows(page).count(), 20);
  await finish(s);
});

for (const [w, h] of [[360, 740], [390, 844]]) {
  test(`phone ${w}: no sideways scroll, rows and dialogs fit`, async () => {
    const s = await ready('/admin/?mock&cbt=ready#tryout', { width: w, height: h });
    const { page } = s;
    assert.ok(await noSideways(page), 'list');
    const r = await openRow(page, 'Dewi Kartika Sari');
    assert.ok(await noSideways(page), 'open row');
    for (const b of await r.locator('.cbt-panel .btn').all()) {
      const box = await b.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= w && box.height >= 34, 'button on screen and tappable');
    }
    await shot(page, `phone-${w}`, true);
    await r.getByRole('button', { name: /^Blokir akun Google ini/ }).click();
    const box = await dialog(page).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= w, 'dialog fits');
    await shot(page, `phone-${w}-dialog`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Tambah orang' }).click();
    assert.ok(await noSideways(page), 'add form');
    await finish(s);

    const n = await open('/admin/?mock#tryout', { width: w, height: h });
    await n.page.getByLabel('Kode setup').waitFor();
    assert.ok(await noSideways(n.page), 'not ready');
    await shot(n.page, `phone-${w}-not-ready`, true);
    await finish(n);
  });
}

for (const [w, h] of [[1280, 800], [390, 844]]) {
  test(`inside the Panel frame on the page at ${w}`, async () => {
    const s = await open('/?admin&mock=admin', { width: w, height: h });
    const { page } = s;
    await page.waitForSelector('.ed-dock.is-admin');
    // on a phone the dock keeps Lihat and Edit; Panel is in its menu
    if (w < 640) {
      await page.click('[aria-label="Menu editor"]');
      await page.click('.ed-menu [role=menuitem]:has-text("Panel")');
    } else await page.click('.ed-seg:has-text("Panel")');
    const frame = page.frameLocator('.ed-panel-f');
    await frame.getByRole('button', { name: 'Peserta try out' }).click();
    await frame.getByLabel('Kode setup').fill('mock-setup-code');
    await frame.getByRole('button', { name: 'Pasang' }).click();
    await frame.locator('li.cbt-p').first().waitFor();
    const f = page.frames().find((x) => x.url().includes('/admin/'));
    assert.equal(await f.evaluate(() => document.documentElement.classList.contains('embed')), true);
    assert.equal(await f.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll in the frame');
    assert.equal(await frame.locator('.savebar').isVisible(), false);
    await frame.locator('li.cbt-p .disclose').first().click();
    await shot(page, `embed-${w}`);
    await page.click('.ed-seg:has-text("Lihat")');
    await page.waitForSelector('.ed-panel', { state: 'detached' });
    await finish(s);
  });
}

test('the other tabs keep their header, modes, save bar, Ctrl+S and unsaved-changes guard', async () => {
  const s = await open('/admin/?mock&seed=1#announcements');
  const { page } = s;
  await page.locator('.cards > li').first().waitFor();
  await page.getByRole('button', { name: 'Tambah pengumuman' }).click();
  await page.locator('.cards > li').first().getByLabel('Judul').fill('Kumpul di aula');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.state').innerText(), 'Belum disimpan');

  const nav = page.getByRole('navigation', { name: 'Konten' });
  await nav.getByRole('button', { name: 'Peserta try out' }).click();
  await page.getByLabel('Kode setup').waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#tryout');
  for (const sel of ['.toolbar', '.savebar', '.banners', '.doc-head .state']) assert.equal(await page.locator(sel).isVisible(), false, sel);
  assert.equal(await nav.getByRole('button', { name: /Pengumuman/ }).locator('.dirty-mark').isVisible(), true, 'the draft is still marked');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(200);
  assert.equal(await dialog(page).count(), 0, 'nothing to save here');
  assert.ok(await toastHas(page, 'langsung'));

  await nav.getByRole('button', { name: /Pengumuman/ }).click();
  assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), 'Pengumuman');
  assert.equal(await page.title(), 'Pengumuman · Admin Alphangers');
  for (const sel of ['.toolbar', '.savebar', '.doc-head .state']) assert.equal(await page.locator(sel).isVisible(), true, sel);
  assert.equal(await page.locator('.state').innerText(), 'Belum disimpan');
  assert.equal(await page.locator('.cards > li').first().getByLabel('Judul').inputValue(), 'Kumpul di aula');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  assert.equal(await page.evaluate(() => location.hash), '#announcements/json');
  await page.getByRole('button', { name: 'Form', exact: true }).click();
  await page.keyboard.press('Control+s');
  await page.getByRole('heading', { name: 'Cek sebelum simpan' }).waitFor();
  await dialog(page).getByRole('button', { name: 'Kembali' }).click();

  // leaving with unsaved changes still asks first, from the try out tab too
  await nav.getByRole('button', { name: 'Peserta try out' }).click();
  await page.getByLabel('Kode setup').waitFor();
  assert.deepEqual(s.problems, []);
  let guarded = false;
  page.on('dialog', async (d) => { if (d.type() === 'beforeunload') guarded = true; await d.dismiss(); });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(guarded, true);
  await s.context.close();
});

test('accessibility: no serious or critical axe findings', async () => {
  const n = await open('/admin/?mock#tryout');
  await n.page.getByLabel('Kode setup').waitFor();
  await n.page.getByRole('button', { name: 'Pasang' }).click();
  assert.deepEqual(await axe(n.page), [], 'not ready, with an error');
  await finish(n);

  const s = await ready();
  const { page } = s;
  assert.deepEqual(await axe(page), [], 'list');
  await filter(page, 'Perlu dicek').click();
  await openRow(page, 'Dewi Kartika Sari');
  assert.deepEqual(await axe(page), [], 'open row');
  await page.getByRole('button', { name: /^Blokir akun Google ini/ }).click();
  assert.deepEqual(await axe(page), [], 'dialog');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Tambah orang' }).click();
  await page.getByRole('button', { name: 'Tambah ke daftar' }).click();
  assert.deepEqual(await axe(page), [], 'add form with errors');
  await finish(s);
});
