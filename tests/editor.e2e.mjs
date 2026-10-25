// Browser checks for the live editor on the portal, against a --mode mock build so the mock
// backend stands in for Firebase. Photo uploads are answered by a stub of /api/media.
//   npx vite build --mode mock --outDir dist-mock && node --test tests/editor.e2e.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDist } from './lib/serve-dist.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let srv, browser;
before(async () => {
  srv = await serveDist({ dir: process.env.DIST_MOCK_DIR || join(ROOT, 'dist-mock') });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
});
after(async () => { await browser?.close(); srv?.server.close(); });

async function open({ width = 1440, height = 900, query = '?admin&mock=admin', time = null } = {}) {
  const mobile = width < 900;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, timezoneId: 'Asia/Jakarta' });
  const page = await context.newPage();
  // a fixed date where the schedule shows several sessions; the clock runs on from there
  if (time) await page.clock.install({ time: new Date(time) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://firestore.googleapis.com/**', (r) => r.abort());
  const uploads = [];
  await page.route('**/api/media**', async (r) => {
    const req = r.request();
    uploads.push({ w: new URL(req.url()).searchParams.get('w'), auth: req.headers().authorization, type: req.headers()['content-type'] });
    const w = new URL(req.url()).searchParams.get('w');
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: w === 'full' ? '/img/divisi/bph-1.jpg' : '/img/divisi/bph-1-640.webp' }) });
  });
  await page.goto(srv.url + '/' + query, { waitUntil: 'load' });
  return { page, context, errors, uploads, mobile };
}
const submit = (page) => page.click('.ed-sheet button[type=submit]');
// a date where the schedule shows several sessions
const TUESDAY = '2026-10-06T08:00:00+07:00';

// Presses a page control in edit mode. A button or link holding page texts is selected by a
// click (so its texts can be changed); it is then pressed from its bar (Klik or Buka).
async function press(page, sel) {
  const el = page.locator(sel).first();
  const keyed = await el.evaluate((x) => {
    const c = x.closest('button, a[href], [role=button], label, summary');
    return !!c && (c.matches('[data-k], [data-kt]') || !!c.querySelector('[data-k], [data-kt]'));
  });
  await el.click();
  if (keyed) await page.locator('.ed-bar .ed-bar-b').filter({ hasText: /^(Klik|Buka)$/ }).first().click();
}
// Draws a text of the test's own into the page, the way a section does (window.__alphaTexts is
// there in mock builds only).
const draw = (page, fn, arg) => page.evaluate(fn, arg);

test('visitors never download the editor', async () => {
  const { page, context } = await open({ query: '' });
  const scripts = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/assets\/(editor|backend-firebase|index\.esm)[^/]*\.js/.test(n)));
  assert.deepEqual(scripts, []);
  assert.equal(await page.locator('.ed-dock').count(), 0);
  await context.close();
});

test('a signed-in non-admin gets told so and nothing is editable', async () => {
  const { page, context } = await open({ query: '?admin&mock=guest' });
  await page.waitForFunction(() => /bukan admin/.test(document.querySelector('.ed-dock')?.textContent || ''));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('editing')), false);
  await context.close();
});

test('edit mode: cancel a session, type a page text, undo, redo, publish', async () => {
  const { page, context, errors } = await open({ time: '2026-10-06T08:00:00+07:00' });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  assert.ok(await page.locator('.ed-text').count() > 20, 'page texts are editable');
  const sess = page.locator('.jw-s[data-ref]').nth(1);
  await sess.scrollIntoViewIfNeeded();
  await sess.click({ position: { x: 300, y: 30 } });
  await page.click('.ed-bar-b:has-text("Batalkan")');
  await page.fill('.ed-sheet input', 'Dosen dinas luar');
  await submit(page);
  await page.waitForSelector('.jw-s.is-batal');
  assert.equal(await page.locator('.jw-s-why').first().innerText(), 'Dosen dinas luar');
  assert.ok(await page.locator('.jw-s.is-batal .jw-x').count(), 'the tape is drawn');

  await page.evaluate(() => scrollTo(0, 0));
  const kick = page.locator('[data-k="hero.kick"]');
  await kick.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Portal kelas Alpha');
  await page.keyboard.press('Enter');
  assert.equal(await kick.innerText(), 'PORTAL KELAS ALPHA');
  assert.match(await page.locator('.ed-n').innerText(), /2/);
  await page.keyboard.press('Control+z');
  assert.equal((await kick.innerText()).toLowerCase(), 'portal kelas · pspd fk unsri');
  await page.keyboard.press('Control+Shift+z');
  assert.equal((await kick.innerText()).toLowerCase(), 'portal kelas alpha');

  await page.click('.ed-pub');
  await page.click('.ed-ask .ed-btn.is-pri');
  await page.waitForFunction(() => /tersimpan/i.test(document.querySelector('.ed-count').textContent));
  assert.equal(await page.locator('.ed-pub').isDisabled(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('lecturer, session with that lecturer, channel, announcement, heart note', async () => {
  const { page, context, errors } = await open();
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');

  await page.evaluate(() => document.getElementById('dosen').scrollIntoView());
  await page.click('.ed-tools-b:has-text("+ Dosen")');
  await page.fill('.ed-sheet input >> nth=0', 'dr. Zaskia Uji Coba, Sp.PD');
  await page.fill('.ed-sheet input >> nth=1', 'Penyakit Dalam');
  await page.click('.ed-sheet .ed-btn:has-text("+ Nomor")');
  await page.fill('.ed-sheet .ed-li-in', '0812 3456 7890');
  await submit(page);
  await page.waitForFunction(() => /478/.test(document.querySelector('.dz-count').textContent));

  await page.evaluate(() => document.getElementById('jadwal').scrollIntoView());
  await page.click('.ed-tools-b:has-text("+ Sesi")');
  await page.fill('.ed-sheet input[name=t]', 'Sesi Uji Coba Editor');
  await page.fill('.ed-sheet input[name=s]', '16:00');
  await page.fill('.ed-sheet input[name=e]', '17:00');
  await page.fill('.ed-sheet .ed-q', 'zaskia');
  await page.click('.ed-sheet .ed-hit');
  await submit(page);
  await page.waitForSelector('.jw-s:has-text("Sesi Uji Coba Editor")');
  assert.deepEqual(await page.locator('.jw-s:has-text("Sesi Uji Coba Editor") .jw-p-n').allInnerTexts(), ['dr. Zaskia Uji Coba, Sp.PD']);

  await page.evaluate(() => document.getElementById('menu').scrollIntoView());
  await page.click('.ed-tools-b:has-text("+ Channel")');
  await page.fill('.ed-sheet input[name=name]', 'Rekaman Kuliah');
  await page.fill('.ed-sheet input[name=url]', 'http://drive.google.com/x');
  await submit(page);
  assert.match(await page.locator('.ed-errbox').innerText(), /https/, 'an http link is refused with a reason');
  await page.fill('.ed-sheet input[name=url]', 'https://drive.google.com/drive/folders/abc123');
  await submit(page);
  await page.waitForSelector('.row-n:has-text("Rekaman Kuliah")');

  await page.evaluate(() => document.getElementById('jadwal').scrollIntoView());
  await page.click('.ed-tools-b:has-text("+ Pengumuman")');
  await page.fill('.ed-sheet input[name=title]', 'Kuliah pindah ke aula');
  await page.fill('.ed-sheet textarea[name=body]', '<img src=x onerror=alert(1)> di aula lantai 3.');
  await submit(page);
  await page.waitForSelector('.ib-title:has-text("Kuliah pindah ke aula")');
  assert.equal(await page.locator('.ib-body img').count(), 0, 'text never becomes HTML');

  await page.evaluate(() => document.getElementById('anatomi').scrollIntoView());
  await page.waitForSelector('.hx-info[data-id]', { timeout: 60000 });
  await page.click('.hx-info .hx-name', { force: true });
  await page.click('.ed-bar-b:has-text("Ubah catatan")');
  await page.fill('.ed-sheet textarea[name=summary]', 'Ringkasan baru dari editor.');
  await submit(page);
  assert.equal(await page.locator('.hx-sum').innerText(), 'Ringkasan baru dari editor.');
  assert.match(await page.locator('.ed-n').innerText(), /5/);
  assert.deepEqual(errors, []);
  await context.close();
});

for (const width of [1440, 390]) {
  test('divisi photo upload into an empty slot and a name typed in place at ' + width, async () => {
    const { page, context, errors, uploads, mobile } = await open({ width, height: width > 900 ? 900 : 844 });
    await page.waitForSelector('.ed-dock.is-admin');
    await page.click('.ed-seg:has-text("Edit")');
    await page.evaluate(() => document.getElementById('divisi').scrollIntoView());
    await page.waitForSelector('#dv-batu');
    await page.evaluate(() => document.getElementById('dv-batu').scrollIntoView());
    const slot = page.locator('#dv-batu .dv-print[data-slot="0"]');
    if (mobile) await slot.tap({ force: true }); else await slot.click({ force: true });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.ed-bar-b:has-text("Unggah foto")')]);
    await chooser.setFiles(join(ROOT, 'public/img/divisi/bph-1.jpg'));
    await page.waitForFunction(() => document.querySelector('#dv-batu .dv-print:not(.is-empty)'), null, { timeout: 30000 });
    assert.deepEqual(uploads.map((u) => u.w).sort(), ['1280', '640', 'full']);
    assert.ok(uploads.every((u) => u.auth === 'Bearer mock-id-token'), 'every upload carries the ID token');
    const name = page.locator('#dv-batu [data-f="name"]');
    await name.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Batu Bata');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Batu Bata/.test(document.querySelector('[data-ix="batu"]').textContent));
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('Panel: the /admin/ editor inside the page, drafts carried both ways', async () => {
  const { page, context, errors } = await open();
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  // the button's text sits in a link: the link is selected, and its text changes from Ubah teks
  const cta = page.locator('[data-k="hero.cta"]').first();
  await cta.scrollIntoViewIfNeeded();
  await cta.click();
  await page.click('.ed-bar-b:has-text("Ubah teks")');
  await page.fill('.ed-sheet .tl-in', 'Buka jadwal kelas');
  await submit(page);
  await page.waitForFunction(() => /1/.test(document.querySelector('.ed-n')?.textContent || ''));
  assert.equal(await cta.textContent(), 'Buka jadwal kelas');

  await page.click('.ed-seg:has-text("Panel")');
  const frame = page.frameLocator('.ed-panel-f');
  await frame.locator('.key-b').first().waitFor({ timeout: 20000 });
  // the page's draft is there, marked unsaved, without a restore prompt
  assert.equal(await frame.locator('.key-b').filter({ hasText: /Link|Drive|Halaman/ }).locator('.dirty-mark').isHidden(), false);
  assert.equal(await page.locator('.ed-pub').isVisible(), false, 'publishing waits until the panel is closed');

  // throw the draft away in the panel, then go back to the page
  await frame.locator('.key-b').filter({ hasText: /Link|Drive|Halaman/ }).click();
  await frame.locator('button:has-text("Batalkan perubahan")').click();
  const ok = frame.locator('dialog[open] button.primary, dialog[open] button.danger, dialog[open] .btn.primary');
  if (await ok.count()) await ok.first().click();
  await page.click('.ed-seg:has-text("Lihat")');
  await page.waitForSelector('.ed-panel', { state: 'detached' });
  await page.waitForFunction(() => !/Buka jadwal kelas/.test(document.querySelector('[data-k="hero.cta"]').textContent));
  assert.equal(await page.locator('.ed-n').textContent(), '');
  assert.deepEqual(errors, []);
  await context.close();
});

test('online session with a join link, tags, and the same controls in the Panel', async () => {
  const { page, context, errors } = await open({ time: TUESDAY });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  const sess = page.locator('.jw-s[data-ref]').first();
  await sess.scrollIntoViewIfNeeded();
  await sess.click({ position: { x: 300, y: 30 } });
  await page.click('.ed-bar-b:has-text("Online")');
  await page.fill('.ed-sheet input[name=tautan]', 'https://meet.google.com/abc-defg-hij');
  await submit(page);
  await page.waitForSelector('.jw-s .jw-join');
  assert.equal(await page.locator('.jw-join').first().getAttribute('href'), 'https://meet.google.com/abc-defg-hij');
  assert.equal(await sess.locator('.jw-online').count(), 1);

  await sess.click({ position: { x: 300, y: 30 } });
  await page.click('.ed-bar-b:has-text("Ubah")');
  await page.click('.ed-sheet .ed-chip:has-text("Kelas gabungan")');
  await page.fill('.ed-sheet .ed-chips + .ed-li input', 'Bawa jas lab');
  await page.keyboard.press('Enter');
  await submit(page);
  await page.waitForSelector('.jw-tag.is-gab');
  assert.deepEqual(await sess.locator('.jw-tag').allTextContents(), ['Kelas gabungan', 'Bawa jas lab']);

  // the Panel shows the same session with its tags and link, and can cancel it
  await page.click('.ed-seg:has-text("Panel")');
  const frame = page.frameLocator('.ed-panel-f');
  await frame.locator('.key-b').first().waitFor({ timeout: 20000 });
  await frame.locator('.key-b', { hasText: 'Jadwal' }).click();
  const online = frame.locator('.sess:has(.chip.kind-online)');
  const tabs = frame.locator('[aria-label="Pilih blok"] .seg-b:not(.add)');
  for (let i = 0, n = await tabs.count(); i < n && !(await online.count()); i++) await tabs.nth(i).click();
  await online.first().locator('button:has-text("Edit")').click();
  assert.deepEqual(await frame.locator('.sess.open button.chip.toggle[aria-pressed=true]').allTextContents(), ['Kelas gabungan', 'Bawa jas lab']);
  assert.equal(await frame.locator('.sess.open input[type=url]').inputValue(), 'https://meet.google.com/abc-defg-hij');
  await frame.locator('.sess.open label:has-text("Sesi ini dibatalkan")').click();
  await frame.locator('.sess.open input[placeholder^="Contoh: dosen dinas"]').fill('Libur nasional');

  // divisi, class photo and page texts are in the Panel too
  await frame.locator('.key-b', { hasText: 'Link' }).click();
  await frame.locator('button:has-text("Ubah divisi")').click();
  assert.equal(await frame.locator('h2.sub-title:has-text("Divisi") + div .card').count(), 8);
  // the same grouped list of page texts as on the page, its first group open
  await frame.locator('h2.sub-title:has-text("Teks halaman") + div .tl-g').nth(3).waitFor();
  await frame.locator('h2.sub-title:has-text("Teks halaman") + div .tl-row.fld').nth(2).waitFor();

  await page.click('.ed-seg:has-text("Lihat")');
  await page.waitForSelector('.ed-panel', { state: 'detached' });
  await page.waitForSelector('.jw-s.is-batal');
  assert.deepEqual(await page.locator('.jw-s-why').allTextContents(), ['Libur nasional']);
  assert.equal(await page.locator('.jw-s.is-batal .jw-join').count(), 0, 'no join button on a cancelled session');
  assert.deepEqual(errors, []);
  await context.close();
});

test('switching back to Lihat leaves no outline behind', async () => {
  const { page, context, errors } = await open({ time: TUESDAY });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  const sess = page.locator('.jw-s[data-ref]').first();
  await sess.scrollIntoViewIfNeeded();
  await sess.click({ position: { x: 300, y: 30 } });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.ed-sel')).opacity === '1');
  await page.click('.ed-seg:has-text("Lihat")');
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ed-sel')).opacity), '0');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ed-hl')).opacity), '0');
  assert.equal(await page.locator('.ed-bar').isHidden(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

// The schedule as published before Blok 4 was added to the bundled copy (no Blok 4, no "base"),
// with an edit the admin made in Blok 3.
function publishedBeforeBlok4() {
  const old = JSON.parse(readFileSync(join(ROOT, 'src/data/schedule.json'), 'utf8'));
  old.bloks = old.bloks.filter((b) => b.id !== 'b4');
  for (const b of old.bloks) delete b.added;
  delete old.base;
  const s = old.bloks.find((b) => b.id === 'b3').days.find((d) => d.d === '2026-10-27').s[0];
  Object.assign(s, { batal: true, alasan: 'Dosen dinas luar' });
  return old;
}

test('a schedule published before Blok 4 shows it, and the next publish keeps it', async () => {
  const { page, context, errors } = await open({ time: '2026-11-02T08:00:00+07:00' });
  await page.waitForFunction(() => !!window.__alphaMock);
  // in place before the editor reads its documents (it signs in and checks admin first)
  await page.evaluate((json) => window.__alphaMock.docs.set('schedule', { json, rev: 20, updatedAt: new Date('2026-10-22T00:45:10Z'), updatedBy: 'admin-K3hal1dUidExample0' }), JSON.stringify(publishedBeforeBlok4()));
  await page.waitForSelector('.ed-dock.is-admin');
  await page.waitForFunction(() => /tersimpan/i.test(document.querySelector('.ed-count')?.textContent || ''));
  assert.equal(await page.locator('.ed-pub').isDisabled(), true, 'Blok 4 coming in is not a change of its own');
  assert.equal((await page.locator('.jw-date').textContent()).replace(/\s+/g, ' ').trim(), 'Senin, 2 November 2026');
  await page.click('.ed-seg:has-text("Edit")');
  const sess = page.locator('.jw-s[data-ref]').nth(1);
  await sess.scrollIntoViewIfNeeded();
  await sess.click({ position: { x: 300, y: 30 } });
  await page.click('.ed-bar-b:has-text("Batalkan")');
  await page.fill('.ed-sheet input', 'Pindah ke minggu depan');
  await submit(page);
  await page.waitForSelector('.jw-s.is-batal');
  await page.click('.ed-pub');
  await page.click('.ed-ask .ed-btn.is-pri');
  await page.waitForFunction(() => /tersimpan/i.test(document.querySelector('.ed-count').textContent));
  const saved = await page.evaluate(() => JSON.parse(window.__alphaMock.docs.get('schedule').json));
  assert.deepEqual(saved.bloks.map((b) => b.id), ['b1', 'b2', 'b3', 'b4']);
  assert.match(saved.base, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  const b3 = saved.bloks[2].days.find((d) => d.d === '2026-10-27').s[0];
  assert.deepEqual([b3.batal, b3.alasan], [true, 'Dosen dinas luar'], 'the Blok 3 edit is kept');
  const b4 = saved.bloks[3].days.find((d) => d.d === '2026-11-02').s[1];
  assert.deepEqual([b4.t, b4.batal, b4.alasan], ['KA2. Introduction to Bones, Muscles, and Joints', true, 'Pindah ke minggu depan']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('try out page: card texts, a hidden credit, notes typed in place, published', async () => {
  const { page, context, errors } = await open({ width: 1280, height: 860, query: '?admin&mock=admin&cbt=ok' });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  // a channel row opens its page from its action bar
  await page.evaluate(() => document.querySelector('.row-b[data-id="tryout"]').scrollIntoView({ block: 'center' }));
  await page.click('.row-b[data-id="tryout"]');
  await page.click('.ed-bar-b:text-is("Buka")');
  await page.waitForSelector('#panel.on .to-blk[data-b="b4"]');
  await page.waitForFunction(() => !document.querySelector('#curtain.move') && document.querySelectorAll('#panel .ed-text').length >= 3);
  assert.equal(await page.locator('.to-note').isVisible(), true, 'the empty note is a slot while editing');
  // a credit on a card that has none
  await page.click('.to-blk[data-b="b2"] .to-bs');
  await page.click('.ed-bar-b:has-text("Ubah teks")');
  await page.fill('.ed-sheet input[name=byk]', 'Dibuat oleh');
  await page.fill('.ed-sheet input[name=by]', 'Tim Batu');
  await submit(page);
  await page.waitForFunction(() => document.querySelector('.to-blk[data-b="b2"] .to-bby').textContent === 'Dibuat oleh Tim Batu');
  // a credit taken away
  await page.click('.to-blk[data-b="b3"] .to-bs');
  await page.click('.ed-bar-b:has-text("Ubah teks")');
  assert.equal(await page.inputValue('.ed-sheet input[name=by]'), 'Batu Alphangers');
  await page.fill('.ed-sheet input[name=by]', '');
  await submit(page);
  await page.waitForFunction(() => document.querySelector('.to-blk[data-b="b3"] .to-bby').hasAttribute('data-empty'));
  // a card with no questions yet (an aria-disabled button, so Playwright needs force, and with
  // force it does not wait for the closing sheet to get out of the way)
  await page.waitForSelector('.ed-sheet', { state: 'detached' });
  await page.click('.to-blk[data-b="b4"] .to-bs', { force: true });
  assert.equal(await page.locator('.ed-bar-b:text-is("Buka")').count(), 0);
  await page.click('.ed-bar-b:has-text("Ubah teks")');
  await page.fill('.ed-sheet input[name=badge]', 'Desember');
  await submit(page);
  await page.waitForFunction(() => document.querySelector('.to-blk[data-b="b4"] .to-bx').textContent === 'Desember');
  // a note typed in place
  await page.click('.to-note');
  await page.keyboard.type('Soal Blok 4 menyusul, ya.');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForFunction(() => !document.querySelector('.to-note').hasAttribute('data-empty'));
  // the header is the channel
  await page.click('#panel .p-hero .p-ttl');
  await page.click('.ed-bar-b:has-text("Ubah channel")');
  assert.equal(await page.inputValue('.ed-sheet input[name=name]'), 'Try Out CBT');
  await page.click('.ed-sheet .ed-btn:has-text("Batal")');
  // as the class sees it
  await page.click('.ed-seg:has-text("Lihat")');
  const seen = () => page.evaluate(() => ({
    credits: [...document.querySelectorAll('.to-blk .to-bby')].filter((e) => e.offsetParent).map((e) => e.closest('.to-blk').dataset.b + ': ' + e.textContent),
    note: document.querySelector('.to-note').offsetParent ? document.querySelector('.to-note').textContent : null,
  }));
  assert.deepEqual(await seen(), { credits: ['b2: Dibuat oleh Tim Batu'], note: 'Soal Blok 4 menyusul, ya.' });
  // the blok page has the same texts, and its own note
  await page.click('.ed-seg:has-text("Edit")');
  await page.click('.to-blk[data-b="b3"] .to-bs');
  await page.click('.ed-bar-b:text-is("Buka")');
  await press(page, '.to-gate [data-act="gin"]');
  await page.waitForSelector('.to-setup .to-head', { timeout: 15000 });
  assert.equal(await page.locator('.to-head .to-by').isVisible(), true, 'the empty credit is a slot while editing');
  await page.click('.to-head .to-note');
  await page.keyboard.type('Fokus ke topik genetika.');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForFunction(() => document.querySelector('.to-head .to-note').textContent === 'Fokus ke topik genetika.');
  // saving every page text at once keeps the hidden credit hidden
  await page.click('[aria-label="Menu editor"]');
  await page.click('.ed-menu [role=menuitem]:has-text("Semua teks halaman")');
  await submit(page);
  await page.click('.ed-seg:has-text("Lihat")');
  assert.equal(await page.locator('.to-head .to-by').isVisible(), false);
  assert.equal(await page.locator('.to-head .to-note').isVisible(), true);
  await page.click('.ed-pub');
  await page.click('.ed-ask .ed-btn.is-pri');
  await page.waitForFunction(() => /tersimpan/i.test(document.querySelector('.ed-count').textContent));
  const t = await page.evaluate(() => JSON.parse(window.__alphaMock.docs.get('links').json).site.t);
  assert.deepEqual(
    [t['to.b2.byk'], t['to.b2.by'], t['to.b3.by'], t['to.b4.badge'], t['to.note'], t['to.b3.note']],
    ['Dibuat oleh', 'Tim Batu', '', 'Desember', 'Soal Blok 4 menyusul, ya.', 'Fokus ke topik genetika.']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a Drive channel page: the folder link and a note', async () => {
  const { page, context, errors } = await open({ width: 1280, height: 860 });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  await page.evaluate(() => document.querySelector('.row-b[data-id="praktikum"]').scrollIntoView({ block: 'center' }));
  await page.click('.row-b[data-id="praktikum"]');
  await page.click('.ed-bar-b:text-is("Buka")');
  await page.waitForSelector('#panel.on .folder');
  await page.waitForFunction(() => !document.querySelector('#curtain.move'));
  await page.click('#panel .folder .f-k');
  assert.deepEqual((await page.locator('.ed-bar-b').allTextContents()).slice(0, 2), ['Ubah link', 'Buka folder']);
  await page.click('.ed-bar-b:has-text("Ubah link")');
  await page.fill('.ed-sheet input[name=url]', 'https://drive.google.com/drive/folders/praktikumBaru123');
  await submit(page);
  await page.waitForFunction(() => document.querySelector('#panel .folder').href.endsWith('praktikumBaru123'));
  await page.click('#panel .p-note');
  await page.keyboard.type('Laporan PA dikumpulkan tiap Jumat.');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForFunction(() => !document.querySelector('#panel .p-note').hasAttribute('data-empty'));
  await page.click('.ed-seg:has-text("Lihat")');
  assert.equal(await page.locator('#panel .p-note').innerText(), 'Laporan PA dikumpulkan tiap Jumat.');
  // the next channel has no note of its own
  await page.click('#panel .nextb');
  await page.waitForFunction(() => document.querySelector('#panel .p-hero')?.dataset.ch === 'kating' && !document.querySelector('#curtain.move'));
  assert.equal(await page.locator('#panel .p-note').isVisible(), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a text with {names} and **bold**: typed raw, saved raw, shown filled', async () => {
  const { page, context, errors } = await open({ width: 1280, height: 860 });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  await draw(page, () => {
    const { registerCopy, kSet } = window.__alphaTexts;
    registerCopy('jadwal', null, {
      'jadwal.t-tpl': 'Jadwal setelah {blok} belum masuk.',
      'jadwal.t-rich': { d: 'Bawa **jas lab** ke {ruang}.', rich: true },
    });
    const host = document.getElementById('jadwal');
    host.prepend(kSet(Object.assign(document.createElement('p'), { id: 't-tpl' }), 'jadwal.t-tpl', { blok: 'Blok 4' }),
      kSet(Object.assign(document.createElement('p'), { id: 't-rich' }), 'jadwal.t-rich', { ruang: 'Lab 2' }));
  });
  const tpl = page.locator('#t-tpl');
  // drawn after edit mode started, and still typable
  await page.waitForFunction(() => document.getElementById('t-tpl').classList.contains('ed-text'));
  assert.equal(await tpl.textContent(), 'Jadwal setelah Blok 4 belum masuk.');
  await tpl.scrollIntoViewIfNeeded();
  await tpl.click();
  assert.equal(await tpl.textContent(), 'Jadwal setelah {blok} belum masuk.', 'typing shows the text as written');
  await page.waitForSelector('#ed-tip.is-in');
  assert.match(await page.locator('#ed-tip').textContent(), /\{blok\} diisi otomatis, sekarang: Blok 4/);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Soal {blok} masih disusun.');
  await page.keyboard.press('Enter');
  assert.equal(await tpl.textContent(), 'Soal Blok 4 masih disusun.');
  assert.equal(await page.evaluate(() => window.__alphaTexts.get()['jadwal.t-tpl']), 'Soal {blok} masih disusun.');
  assert.equal(await page.locator('#ed-tip').isHidden(), true);

  // the section redraws the text while it is typed (as a count or a clock would): nothing is lost
  await tpl.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Soal {blok}');
  await page.evaluate(() => window.__alphaTexts.kSet(document.getElementById('t-tpl'), 'jadwal.t-tpl', { blok: 'Blok 5' }));
  await page.keyboard.type(' masih disusun.');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.__alphaTexts.get()['jadwal.t-tpl']), 'Soal {blok} masih disusun.');
  assert.equal(await tpl.textContent(), 'Soal Blok 5 masih disusun.');

  // Escape puts back what was there
  await tpl.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Salah ketik');
  await page.keyboard.press('Escape');
  assert.equal(await tpl.textContent(), 'Soal Blok 5 masih disusun.');

  // nothing changed, nothing saved
  await page.evaluate(() => { window.__t0 = window.__alphaTexts.get(); });
  await tpl.click();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.__alphaTexts.get() === window.__t0), true);

  // **bold**
  const rich = page.locator('#t-rich');
  await rich.click();
  assert.equal(await rich.textContent(), 'Bawa **jas lab** ke {ruang}.');
  assert.match(await page.locator('#ed-tip').textContent(), /\*\*penting\*\*/);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Bawa **jas lab dan sarung tangan** ke {ruang}.');
  await page.keyboard.press('Enter');
  assert.equal(await rich.locator('b').textContent(), 'jas lab dan sarung tangan');
  assert.equal(await rich.textContent(), 'Bawa jas lab dan sarung tangan ke Lab 2.');
  assert.equal(await page.evaluate(() => window.__alphaTexts.get()['jadwal.t-rich']), 'Bawa **jas lab dan sarung tangan** ke {ruang}.');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a text inside a button: changed from Ubah teks, and the button still works from Klik', async () => {
  const { page, context, errors } = await open({ width: 1280, height: 860 });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  await draw(page, () => {
    const { registerCopy, kHTML } = window.__alphaTexts;
    registerCopy('jadwal', null, { 'jadwal.t-btn': 'Tombol uji', 'jadwal.t-btn2': 'baris kedua' });
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 't-btn';
    b.innerHTML = kHTML('jadwal.t-btn') + ' ' + kHTML('jadwal.t-btn2', null, 'small');
    window.__clicks = 0;
    b.addEventListener('click', () => window.__clicks++);
    document.getElementById('jadwal').prepend(b);
  });
  await page.waitForFunction(() => document.querySelector('#t-btn [data-k]')?.classList.contains('ed-ctl-k'));
  assert.equal(await page.locator('#t-btn [data-k="jadwal.t-btn"]').getAttribute('contenteditable'), null, 'a button text is not typed into');
  const btn = page.locator('#t-btn');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  assert.equal(await page.evaluate(() => window.__clicks), 0, 'in edit mode a click selects the button');
  assert.deepEqual((await page.locator('.ed-bar-b').allTextContents()).slice(0, 2), ['Ubah teks', 'Klik']);
  await page.click('.ed-bar-b:has-text("Ubah teks")');
  assert.equal(await page.locator('.ed-sheet .tl-in').count(), 2, 'one field per text in the button');
  assert.equal(await page.inputValue('.ed-sheet .tl-in >> nth=0'), 'Tombol uji');
  await page.fill('.ed-sheet .tl-in >> nth=0', 'Tombol baru');
  await submit(page);
  await page.waitForFunction(() => document.querySelector('#t-btn [data-k="jadwal.t-btn"]').textContent === 'Tombol baru');
  await btn.click();
  await page.click('.ed-bar-b:text-is("Klik")');
  assert.equal(await page.evaluate(() => window.__clicks), 1, 'Klik presses the button');
  assert.deepEqual(errors, []);
  await context.close();
});

test('on a laptop the bar over a selection low on the screen stops above the dock', async () => {
  const { page, context, errors } = await open({ width: 1280, height: 860 });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  await draw(page, () => {
    const { registerCopy, kHTML } = window.__alphaTexts;
    registerCopy('jadwal', null, { 'jadwal.t-low': 'Tombol paling bawah di layar' });
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 't-low';
    b.style.cssText = 'position:fixed;left:0;bottom:6px;z-index:50';
    b.innerHTML = kHTML('jadwal.t-low');
    window.__clicks = 0;
    b.addEventListener('click', () => window.__clicks++);
    document.getElementById('jadwal').prepend(b);
  });
  await page.waitForFunction(() => document.querySelector('#t-low [data-k]')?.classList.contains('ed-ctl-k'));
  await page.click('#t-low');
  await page.waitForFunction(() => {
    const b = document.querySelector('.ed-bar');
    return b && !b.hidden && b.getAnimations().every((a) => a.playState !== 'running') && b.getBoundingClientRect().top > 100;
  });
  const [bar, dock] = await page.evaluate(() => ['.ed-bar', '.ed-dock'].map((s) => document.querySelector(s).getBoundingClientRect().toJSON()));
  assert.ok(bar.bottom <= dock.top, `the bar (${Math.round(bar.top)}-${Math.round(bar.bottom)}) stays above the dock (from ${Math.round(dock.top)})`);
  await page.click('.ed-bar-b:text-is("Klik")');
  assert.equal(await page.evaluate(() => window.__clicks), 1, 'Klik presses the button');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Semua teks halaman: a text of a part never opened, search, save, reset one', async () => {
  const { page, context, errors } = await open({ width: 1280, height: 860 });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  // declared by a part of the page that is not drawn yet
  await draw(page, () => {
    window.__alphaTexts.registerCopy('viewer', null, { 'viewer.t-never': 'Keterangan foto yang belum dibuka' });
    window.__alphaTexts.registerCopy('jadwal', null, { 'jadwal.t-scope': 'Teks jadwal buat uji' });
  });
  const openList = async () => {
    await page.click('[aria-label="Menu editor"]');
    await page.click('.ed-menu [role=menuitem]:has-text("Semua teks halaman")');
    await page.waitForSelector('.ed-sheet .tl');
  };
  await openList();
  assert.ok(await page.locator('.tl-g').count() >= 3, 'texts come in groups');
  await page.fill('.tl-qi', 'foto yang belum');
  const row = page.locator('.tl-row[data-key="viewer.t-never"]');
  await row.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.tl-g')].filter((g) => !g.hidden).length === 1);
  assert.equal(await row.locator('.tl-in').inputValue(), 'Keterangan foto yang belum dibuka');
  await row.locator('.tl-in').fill('Keterangan foto baru');
  assert.match(await page.locator('.tl-sum').textContent(), /1 diubah/);
  await submit(page);
  await page.waitForSelector('.ed-sheet', { state: 'detached' });
  assert.equal(await page.evaluate(() => window.__alphaTexts.get()['viewer.t-never']), 'Keterangan foto baru');

  // only what changed, then one back to its default
  await openList();
  await page.click('.tl-only');
  await row.waitFor();
  assert.equal(await page.locator('.tl-row:visible').count(), 1);
  await row.locator('.tl-reset').click();
  assert.equal(await row.locator('.tl-in').inputValue(), 'Keterangan foto yang belum dibuka');
  await submit(page);
  await page.waitForSelector('.ed-sheet', { state: 'detached' });
  assert.equal(await page.evaluate(() => 'viewer.t-never' in window.__alphaTexts.get()), false);

  // a section's "Teks" opens the list at that section
  await page.evaluate(() => document.getElementById('jadwal').scrollIntoView());
  await page.click('.ed-tools[aria-label="Ubah Jadwal"] .ed-tools-b:text-is("Teks")');
  await page.waitForSelector('.ed-sheet .tl-scope');
  assert.deepEqual(await page.locator('.tl-g:visible').evaluateAll((gs) => gs.map((g) => g.dataset.g)), ['jadwal']);
  await page.click('.ed-sheet .ed-btn:has-text("Batal")');
  assert.deepEqual(errors, []);
  await context.close();
});

test('an optional note shows once written and hides again when emptied', async () => {
  const { page, context, errors } = await open({ width: 1280, height: 860 });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  await draw(page, () => {
    const { registerCopy, kSet } = window.__alphaTexts;
    registerCopy('jadwal', null, { 'jadwal.t-note': { d: '', opt: true, ml: true, ph: 'Catatan buat kelas (boleh kosong)' } });
    document.getElementById('jadwal').prepend(kSet(Object.assign(document.createElement('p'), { id: 't-note', className: 'k-note' }), 'jadwal.t-note'));
  });
  const note = page.locator('#t-note');
  await page.waitForFunction(() => document.getElementById('t-note').classList.contains('ed-text'));
  assert.equal(await note.getAttribute('data-empty'), '');
  assert.equal(await note.isVisible(), true, 'an empty note is a spot to write in while editing');
  await note.scrollIntoViewIfNeeded();
  await note.click();
  await page.keyboard.type('Bawa buku catatan.');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForFunction(() => !document.getElementById('t-note').hasAttribute('data-empty'));
  await page.click('.ed-seg:has-text("Lihat")');
  assert.equal(await note.isVisible(), true);
  assert.equal(await note.textContent(), 'Bawa buku catatan.');
  await page.click('.ed-seg:has-text("Edit")');
  await note.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForFunction(() => document.getElementById('t-note').hasAttribute('data-empty'));
  assert.equal(await page.evaluate(() => 'jadwal.t-note' in window.__alphaTexts.get()), false, 'a note with an empty default just goes back to it');
  await page.click('.ed-seg:has-text("Lihat")');
  assert.equal(await note.isVisible(), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a text drawn inside an open dialog is typed there, its hint on top', async () => {
  const { page, context, errors } = await open({ width: 1280, height: 860 });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  await page.keyboard.press('Control+k');
  await page.waitForSelector('dialog.fd[open]');
  await draw(page, () => {
    const { registerCopy, kSet } = window.__alphaTexts;
    registerCopy('find', null, { 'find.t-dlg': 'Ketik nama {apa} di sini.' });
    document.querySelector('dialog.fd[open]').append(kSet(Object.assign(document.createElement('p'), { id: 't-dlg' }), 'find.t-dlg', { apa: 'dosen' }));
  });
  await page.waitForFunction(() => document.getElementById('t-dlg').classList.contains('ed-text'));
  await page.click('#t-dlg');
  await page.waitForSelector('#ed-tip.is-in');
  assert.equal(await page.evaluate(() => document.getElementById('ed-tip').closest('dialog')?.classList.contains('fd')), true, 'the hint sits in the dialog, above it');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Cari {apa} di sini.');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#t-dlg').textContent(), 'Cari dosen di sini.');
  assert.equal(await page.locator('dialog.fd[open]').count(), 1, 'the dialog stays open');
  assert.deepEqual(errors, []);
  await context.close();
});

test('at 390px the list of page texts fits the screen', async () => {
  const { page, context, errors } = await open({ width: 390, height: 844 });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  await page.click('[aria-label="Menu editor"]');
  await page.click('.ed-menu [role=menuitem]:has-text("Semua teks halaman")');
  await page.waitForSelector('.ed-sheet .tl-row');
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const sb = document.querySelector('.ed-sheet .ed-sb');
    const r = document.querySelector('.ed-sheet').getBoundingClientRect();
    const wide = [...document.querySelectorAll('.ed-sheet *')].filter((x) => { const b = x.getBoundingClientRect(); return b.width && (b.right > innerWidth + 0.5 || b.left < -0.5); }).map((x) => x.className);
    const taps = [...document.querySelectorAll('.tl-gh, .tl-only, .ed-sheet .tl-in, .ed-sheet .ed-sf .ed-btn')].map((x) => x.getBoundingClientRect().height);
    return { sb: sb.scrollWidth - sb.clientWidth, left: r.left, right: r.right, wide, minTap: Math.min(...taps) };
  });
  assert.equal(m.sb, 0, 'no sideways scroll in the list');
  assert.ok(m.left >= 0 && m.right <= 390, 'the sheet is inside the screen');
  assert.deepEqual(m.wide, []);
  assert.ok(m.minTap >= 38, 'taps are comfortable (' + m.minTap + 'px)');
  assert.deepEqual(errors, []);
  await context.close();
});

test('on a small phone the dock fits, its menu closes on a text, and the bar keeps the card in view', async () => {
  const { page, context, errors } = await open({ width: 360, height: 740, time: TUESDAY });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  await page.click('[data-k="hero.kick"]');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Portal kelas Alpha 2026');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.ed-pub .ed-n').textContent === '1');
  // every control on screen and at touch size; Panel and Ulangi wait in the menu
  const dock = await page.evaluate(() => [...document.querySelectorAll('.ed-dock button')]
    .filter((x) => x.getClientRects().length && !x.closest('.ed-menu'))
    .map((x) => { const r = x.getBoundingClientRect(); return (x.getAttribute('aria-label') || x.textContent).trim() + (r.left >= 0 && r.right <= innerWidth ? '' : ' OFF') + (r.height < 38 ? ' SMALL' : ''); }));
  assert.deepEqual(dock, ['Lihat', 'Edit', 'Urungkan (Ctrl+Z)', 'Terbitkan1', 'Menu editor']);
  // the menu has Ulangi and Panel, and goes away when a text is tapped
  await page.click('[aria-label="Menu editor"]');
  assert.equal(await page.locator('.ed-menu [role=menuitem]:has-text("Ulangi")').isVisible(), true);
  // (its left end: the open menu covers the rest of it on this screen)
  await page.click('[data-k="hero.kick"]', { position: { x: 6, y: 6 } });
  assert.equal(await page.locator('.ed-menu').isHidden(), true);
  await page.keyboard.press('Escape');
  // a session card: the bar shows every action on screen, and the card scrolls out from under it
  await page.locator('.jw-s[data-ref]').first().evaluate((x) => x.scrollIntoView({ block: 'end' }));
  await page.locator('.jw-s[data-ref]').first().click({ position: { x: 60, y: 24 } });
  await page.waitForSelector('.ed-bar:not([hidden]) .ed-bar-b:has-text("Hapus")');
  // (it ends above the bar, or, too tall for that, starts just under the top bar)
  await page.waitForFunction(() => {
    const c = document.querySelector('.jw-s[data-ref]').getBoundingClientRect(), b = document.querySelector('.ed-bar').getBoundingClientRect();
    return c.bottom <= b.top || (c.top >= 0 && c.top <= 90);
  });
  const bar = await page.evaluate(() => [...document.querySelectorAll('.ed-bar .ed-bar-b')].filter((b) => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || b.scrollWidth > b.clientWidth; }).map((b) => b.textContent));
  assert.deepEqual(bar, []);
  // the publish question names each changed part on its own line
  await page.click('.ed-bar-b.is-x');
  await page.click('.ed-pub');
  assert.match(await page.locator('.ed-ask-p').textContent(), /^Yang berubah \(1 bagian\):\n• Teks halaman, channel, Drive dan divisi\n/);
  await page.click('.ed-ask .ed-btn:has-text("Batal")');
  assert.deepEqual(errors, []);
  await context.close();
});

test('on a phone the try out buttons stay above the dock, and its dialogs are page texts', async () => {
  const { page, context, errors } = await open({ width: 390, height: 844, query: '?admin&mock=admin&cbt=ok#tryout' });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('#panel.on .to-blk[data-b="b3"]');
  await page.click('.to-gate [data-act="gin"]');
  await page.click('[data-act="mode"][data-v="latihan"]');
  await page.click('.to-start');
  await page.click('.to-o >> nth=0');
  await page.click('[data-act="check"]');
  await page.waitForSelector('#toFoot [data-act="next"]');
  // the bottom buttons can be pressed where they are drawn, once the page has settled
  const clear = (q) => page.waitForFunction((q) => [...document.querySelectorAll(q)]
    .filter((b) => b.getClientRects().length).every((b) => {
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit === b || b.contains(hit);
    }), q, { timeout: 5000 });
  await clear('#toFoot button');
  await page.evaluate(() => document.getElementById('panel').scrollTo(0, 1e6));
  await clear('#toFoot button');
  // the question list rises from the bottom; its Selesai button too
  await page.click('.to-navb');
  await page.waitForSelector('.to-nav.open');
  await clear('.to-nav [data-act="finish"]');
  await page.click('.to-nav [data-act="finish"]');
  await page.waitForSelector('.to-dlg.on');
  // in Edit the dialog's words are typed in place and its buttons are selected, not pressed
  await page.click('.ed-seg:has-text("Edit")');
  await page.waitForFunction(() => document.querySelector('.to-dlg [data-k="to.dlg.fin.h"]')?.classList.contains('ed-text'));
  await page.click('.to-dlg [data-dok]');
  await page.waitForSelector('.ed-bar:not([hidden]) .ed-bar-b:text-is("Klik")');
  assert.equal(await page.locator('.to-dlg').count(), 1, 'still open');
  await page.click('.to-dlg [data-k="to.dlg.fin.h"]');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Udah yakin selesai?');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.__alphaTexts.get()['to.dlg.fin.h']), 'Udah yakin selesai?');
  await press(page, '.to-dlg [data-dok]');
  await page.waitForSelector('#toScore', { timeout: 15000 });
  assert.deepEqual(errors, []);
  await context.close();
});

test('a label inside a card selects the card, and changes from its Ubah teks', async () => {
  const { page, context, errors } = await open({ width: 1280, height: 860, time: TUESDAY });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  await page.locator('.jw-s[data-ref]').first().scrollIntoViewIfNeeded();
  // a label every session card shares, drawn with its value
  await draw(page, () => {
    const { registerCopy, kSet } = window.__alphaTexts;
    registerCopy('jadwal', null, { 'jadwal.t-card': 'Ruang {ruang}' });
    document.querySelector('.jw-s[data-ref]').append(kSet(Object.assign(document.createElement('span'), { id: 't-card' }), 'jadwal.t-card', { ruang: 'B2' }));
  });
  await page.waitForFunction(() => document.getElementById('t-card')?.classList.contains('ed-ctl-k'));
  assert.equal(await page.locator('#t-card').getAttribute('contenteditable'), null, 'not typed into inside a card');
  await page.click('#t-card');
  await page.waitForSelector('.ed-bar:not([hidden]) .ed-bar-b:has-text("Batalkan")');
  await page.click('.ed-bar-b:text-is("Ubah teks")');
  assert.equal(await page.inputValue('.ed-sheet .tl-row[data-key="jadwal.t-card"] .tl-in'), 'Ruang {ruang}');
  assert.match(await page.locator('.ed-sheet .tl-row[data-key="jadwal.t-card"] .tl-hint').textContent(), /\{ruang\} diisi otomatis, sekarang: B2/);
  await page.fill('.ed-sheet .tl-row[data-key="jadwal.t-card"] .tl-in', 'Ruang kuliah {ruang}');
  await submit(page);
  await page.waitForFunction(() => document.getElementById('t-card').textContent === 'Ruang kuliah B2');
  assert.equal(await page.evaluate(() => window.__alphaTexts.get()['jadwal.t-card']), 'Ruang kuliah {ruang}');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a dialog added after edit mode started has its texts typable at once', async () => {
  const { page, context, errors } = await open({ width: 390, height: 844 });
  await page.waitForSelector('.ed-dock.is-admin');
  await page.click('.ed-seg:has-text("Edit")');
  // like the photo viewer: appended to the body when it opens, a kicker with {no}
  await draw(page, () => {
    const { registerCopy, kHTML } = window.__alphaTexts;
    registerCopy('viewer', null, { 'viewer.t-kick': 'Foto {no} dari {n}' });
    const d = document.createElement('dialog');
    d.id = 't-pv';
    d.innerHTML = kHTML('viewer.t-kick', { no: 3, n: 8 }, 'p') + '<button type="button" id="t-pv-x">Tutup</button>';
    d.querySelector('#t-pv-x').addEventListener('click', () => d.close());
    // a click on the photo area closes it, as the viewer does
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('p')) d.close(); });
    document.body.append(d);
    d.showModal();
  });
  const kick = page.locator('#t-pv [data-k="viewer.t-kick"]');
  await page.waitForFunction(() => document.querySelector('#t-pv [data-k]')?.classList.contains('ed-text'));
  await kick.tap();
  assert.equal(await kick.textContent(), 'Foto {no} dari {n}');
  await page.waitForSelector('#ed-tip.is-in');
  assert.match(await page.locator('#ed-tip').textContent(), /\{no\} diisi otomatis, sekarang: 3/);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Foto ke-{no} (dari {n})');
  await page.evaluate(() => document.activeElement.blur());
  assert.equal(await kick.textContent(), 'Foto ke-3 (dari 8)');
  assert.equal(await page.evaluate(() => window.__alphaTexts.get()['viewer.t-kick']), 'Foto ke-{no} (dari {n})');
  assert.equal(await page.locator('#t-pv[open]').count(), 1, 'typing did not close the dialog');
  assert.deepEqual(errors, []);
  await context.close();
});
