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
  srv = await serveDist({ dir: join(ROOT, 'dist-mock') });
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
  const lede = page.locator('[data-k="hero.cta"]').first();
  await lede.scrollIntoViewIfNeeded();
  await lede.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Buka jadwal kelas');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /1/.test(document.querySelector('.ed-n')?.textContent || ''));

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
  const { page, context, errors } = await open();
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
  await frame.locator('h2.sub-title:has-text("Teks halaman") + div .fld').nth(5).waitFor();

  await page.click('.ed-seg:has-text("Lihat")');
  await page.waitForSelector('.ed-panel', { state: 'detached' });
  await page.waitForSelector('.jw-s.is-batal');
  assert.deepEqual(await page.locator('.jw-s-why').allTextContents(), ['Libur nasional']);
  assert.equal(await page.locator('.jw-s.is-batal .jw-join').count(), 0, 'no join button on a cancelled session');
  assert.deepEqual(errors, []);
  await context.close();
});

test('switching back to Lihat leaves no outline behind', async () => {
  const { page, context, errors } = await open();
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
  await page.click('.to-gate [data-act="gin"]');
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
  assert.deepEqual(await page.locator('.ed-bar-b').allTextContents(), ['Ubah link', 'Buka folder', '×']);
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
