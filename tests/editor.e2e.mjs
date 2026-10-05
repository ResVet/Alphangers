// Browser checks for the live editor on the portal, against a --mode mock build so the mock
// backend stands in for Firebase. Photo uploads are answered by a stub of /api/media.
//   npx vite build --mode mock --outDir dist-mock && node --test tests/editor.e2e.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
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

async function open({ width = 1440, height = 900, query = '?admin&mock=admin' } = {}) {
  const mobile = width < 900;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, timezoneId: 'Asia/Jakarta' });
  const page = await context.newPage();
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
  const { page, context, errors } = await open();
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
  await page.waitForFunction(() => /477/.test(document.querySelector('.dz-count').textContent));

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
