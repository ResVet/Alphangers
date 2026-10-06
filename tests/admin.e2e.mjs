// Browser checks for /admin/, using the dev server and its mock backend.
//
//   node tests/admin.e2e.mjs
//
// It starts its own Vite dev server unless ADMIN_URL points at one already.
// ADMIN_URL, SHOTS (screenshot folder) and CHROMIUM (browser path) can be set
// in the environment. The mock backend only exists in dev and --mode mock builds.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { firebaseConfig } from '../src/lib/firebase-config.js';

let server = null;
let BASE = process.env.ADMIN_URL;
if (!BASE) {
  server = await createServer({
    root: join(dirname(fileURLToPath(import.meta.url)), '..'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 5175, strictPort: false, hmr: false },
  });
  await server.listen();
  BASE = server.resolvedUrls.local[0].replace(/\/$/, '') + '/admin/';
}
const SHOTS = process.env.SHOTS || 'test-results';
const PREFIX = process.env.SHOT_PREFIX || 'w2-';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const problems = [];
const results = [];
const check = (name, ok, info = '') => results.push({ name, ok: !!ok, info });
// caret 'initial' because the default makes Playwright write style attributes into inputs.
const shot = (p, name, full = false) => p.screenshot({ path: `${SHOTS}/${PREFIX}${name}.png`, fullPage: full, caret: 'initial' });

async function open(w, h, query = '') {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('console', (m) => {
    // 4xx responses are reported with their URL below; the browser's own line adds nothing.
    if (m.text().startsWith('Failed to load resource')) return;
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${query}: ${m.text()}`);
  });
  p.on('pageerror', (e) => problems.push(`[pageerror] ${query}: ${e.message}`));
  p.on('requestfailed', (r) => problems.push(`[requestfailed] ${r.url()}`));
  p.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && problems.push(`[${r.status()}] ${r.url()}`));
  await p.goto(BASE + query, { waitUntil: 'networkidle' });
  return p;
}

const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const inlineStyles = (p) => p.evaluate(() => Array.from(document.querySelectorAll('[style]')).map((e) => `${e.tagName}.${e.className}: ${e.getAttribute('style')}`));
const text = (p, sel) => p.locator(sel).first().innerText();
const toastHas = async (p, s) => (await p.locator('.toast').allInnerTexts()).some((t) => t.includes(s));

async function nav(p, label) {
  await p.getByRole('navigation', { name: 'Konten' }).getByRole('button', { name: label }).click();
  await p.waitForTimeout(150);
}

try {
  /* ---- setup guide (no config, or ?setup in dev) and the real sign-in screen ---- */
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    const p = await open(w, h, firebaseConfig ? '?setup' : '');
    check(`setup guide shows (${w})`, (await text(p, 'h1')) === 'Firebase belum disambungkan');
    check(`setup guide has 7 steps (${w})`, (await p.locator('.steps li').count()) === 7);
    check(`setup no horizontal scroll (${w})`, await noOverflow(p));
    check(`setup loads no Firebase SDK (${w})`, !(await p.evaluate(() => performance.getEntriesByType('resource').some((r) => /backend-firebase|firebase_auth|firebase_firestore/.test(r.name)))));
    await shot(p, `setup-${w}`, true);
    await p.context().close();
  }
  if (firebaseConfig) {
    for (const [w, h] of [[390, 844], [1280, 800]]) {
      const p = await open(w, h, '');
      check(`real sign-in shows (${w})`, (await text(p, 'h1')) === 'Masuk dulu');
      check(`real sign-in offers Google (${w})`, await p.getByRole('button', { name: 'Masuk dengan Google' }).isVisible());
      check(`real sign-in shows no error on first load (${w})`, (await p.locator('.err-text').first().innerText()).trim() === '');
      check(`real sign-in no horizontal scroll (${w})`, await noOverflow(p));
      await shot(p, `signin-real-${w}`, true);
      await p.context().close();
    }
  }

  /* ---- signed out, then sign in ---- */
  {
    const p = await open(390, 844, '?mock=out');
    await p.getByRole('button', { name: 'Masuk dengan Google' }).waitFor();
    await shot(p, 'signin-390');
    await p.getByRole('button', { name: 'Masuk dengan Google' }).click();
    await p.locator('.editor .card').first().waitFor();
    check('sign in leads to the editor', await p.locator('h1', { hasText: 'Link dan halaman' }).isVisible());
    await p.context().close();
  }

  /* ---- signed in but not an admin ---- */
  {
    const p = await open(390, 844, '?mock=guest');
    await p.locator('#uid-box').waitFor();
    check('not-admin shows the UID', (await p.inputValue('#uid-box')) === 'guest-7Qx2LmN4pR8sT1vW');
    await p.getByRole('button', { name: 'Salin UID' }).click();
    await p.waitForTimeout(100);
    check('copy UID puts it on the clipboard', (await p.evaluate(() => navigator.clipboard.readText())) === 'guest-7Qx2LmN4pR8sT1vW');
    await p.locator('details.panel summary').click();
    await shot(p, 'notadmin-390', true);
    await p.context().close();
  }

  /* ---- admin, laptop ---- */
  {
    const p = await open(1280, 800, '?mock=admin&seed=1');
    await p.locator('.editor .card').first().waitFor();
    check('links editor lists 10 channels', (await p.locator('.cards > li').count()) === 10);
    { const st = await inlineStyles(p); check('no inline style attributes', st.length === 0, st.join('; ')); }
    await shot(p, 'links-1280');

    // https only: http is an error, a non-Drive host only a warning
    const url2 = p.locator('.cards > li').nth(1).getByLabel('Link folder Drive');
    await url2.fill('http://drive.google.com/x');
    await p.waitForTimeout(250);
    check('http url marked as error', await p.locator('.cards > li').nth(1).locator('.fld.is-err').isVisible());
    check('error summary appears', (await text(p, '.issues-sum')).includes('harus dibereskan'));
    await p.getByRole('button', { name: 'Simpan', exact: true }).click();
    check('save blocked while errors exist', await p.getByRole('heading', { name: 'Belum bisa disimpan' }).isVisible());
    await shot(p, 'blocked-1280');
    await p.getByRole('button', { name: 'Oke' }).click();
    await url2.fill('https://example.com/folder');
    await p.waitForTimeout(250);
    check('non-Drive host only warns', await p.locator('.cards > li').nth(1).locator('.fld.is-warn').isVisible());
    await url2.fill('https://drive.google.com/drive/folders/NEW');
    await p.locator('.cards > li').first().getByLabel('Nama').fill('Main Lobby Alpha');
    await p.waitForTimeout(200);
    check('dirty state shown', (await text(p, '.state')) === 'Belum disimpan');

    // review then save
    await p.keyboard.press('Control+s');
    await p.getByRole('heading', { name: 'Cek sebelum simpan' }).waitFor();
    const review = await text(p, 'dialog');
    check('review lists both changes', review.includes('Main Lobby Alpha') && review.includes('NEW'));
    await shot(p, 'review-1280');
    await p.getByLabel('Catatan (opsional, masuk riwayat)').fill('ganti link Batu');
    await p.getByRole('button', { name: 'Simpan sekarang' }).click();
    await p.waitForSelector('.toast');
    check('saved as rev 3', await toastHas(p, 'rev 3'));
    check('source line shows rev 3', (await text(p, '.source')).includes('rev 3'));

    // conflict: another tab saves in between, then merge
    await p.locator('.cards > li').nth(3).getByLabel('Label kecil').fill('Kuliah terpadu');
    await p.evaluate(() => window.__alphaMock.bump('links'));
    await p.getByRole('button', { name: 'Simpan', exact: true }).click();
    await p.getByRole('button', { name: 'Simpan sekarang' }).click();
    await p.getByRole('heading', { name: 'Ada versi yang lebih baru' }).waitFor();
    check('conflict dialog lists the server change', (await text(p, 'dialog')).includes('Diubah dari tab lain.'));
    await shot(p, 'conflict-1280');
    await p.getByRole('button', { name: 'Gabungkan' }).click();
    await p.getByRole('heading', { name: 'Cek sebelum simpan' }).waitFor();
    await p.getByRole('button', { name: 'Simpan sekarang' }).click();
    await p.waitForTimeout(400);
    const saved = await p.evaluate(() => JSON.parse(window.__alphaMock.docs.get('links').json));
    check('merge kept both edits', saved.channels[1].sub === 'Diubah dari tab lain.' && saved.channels[3].tag === 'Kuliah terpadu');
    check('merged save is rev 5', saved && (await p.evaluate(() => window.__alphaMock.docs.get('links').rev)) === 5);

    // history
    await p.getByRole('button', { name: 'Riwayat' }).click();
    await p.locator('.hist-item').first().waitFor();
    check('history lists saves', (await p.locator('.hist-item').count()) >= 4);
    await p.locator('.hist-item').first().getByRole('button', { name: 'Lihat perubahan' }).click();
    check('history diff opens', await p.locator('.hist-item .dv-item').first().isVisible());
    await shot(p, 'history-1280');
    await p.locator('.hist-item').nth(1).getByRole('button', { name: /Pulihkan rev/ }).click();
    await p.waitForTimeout(200);
    check('restore loads into the draft', (await text(p, '.state')) === 'Belum disimpan');
    await p.getByRole('button', { name: 'Batalkan perubahan' }).click();
    await p.getByRole('button', { name: 'Buang perubahan' }).click();

    // JSON mode
    await p.getByRole('button', { name: 'JSON', exact: true }).click();
    await p.locator('#raw-json').fill('{ "v": 1, "channels": [ { "id": "x", } ] }');
    await p.waitForTimeout(450);
    check('bad JSON reported', (await text(p, '#raw-status')).includes('Belum dipakai'));
    await shot(p, 'json-1280');
    await p.locator('#raw-json').fill(JSON.stringify({ v: 1, channels: [{ id: 'lobby', name: 'Lobby', tag: '', sub: '', url: 'javascript:alert(1)' }] }));
    await p.waitForTimeout(450);
    check('javascript: url rejected in JSON mode', (await text(p, '#raw-status')).includes('https'));
    await p.getByRole('button', { name: 'Form', exact: true }).click();
    check('leaving bad JSON asks first', await p.getByRole('heading', { name: 'JSON belum valid' }).isVisible());
    await p.getByRole('button', { name: 'Buang dan lanjut' }).click();

    // announcements: plain text only
    await nav(p, 'Pengumuman');
    await p.getByRole('button', { name: 'Tambah pengumuman' }).click();
    const card = p.locator('.cards > li').first();
    await card.getByLabel('Judul').fill('<img src=x onerror="window.__xss=1">Kumpul tugas');
    await card.getByLabel('Isi').fill('Baris satu\n<script>window.__xss=2</script>');
    await card.getByLabel('Label').selectOption('deadline');
    await p.waitForTimeout(250);
    check('deadline without due warns', await card.locator('.fld.is-warn').first().isVisible());
    check('markup stays text', (await p.evaluate(() => window.__xss === undefined && document.querySelectorAll('.editor img, .editor script').length === 0)));
    await shot(p, 'announcements-1280');
    await p.getByRole('button', { name: 'Simpan', exact: true }).click();
    const annReview = await text(p, 'dialog');
    check('review shows markup as text', annReview.includes('<img src=x'));
    await p.getByRole('button', { name: 'Kembali', exact: true }).click();

    // schedule
    await nav(p, 'Jadwal');
    await p.locator('.day').first().waitFor();
    check('schedule shows Blok 1 with 14 days', (await p.locator('.day').count()) === 14);
    const firstSess = p.locator('.day').first().locator('.sess').first();
    await firstSess.getByRole('button', { name: 'Edit' }).click();
    const sess = p.locator('.sess.open');
    await sess.getByLabel('Selesai', { exact: true }).fill('07:30');
    await p.waitForTimeout(250);
    check('end before start is an error', await sess.locator('.fld.is-err').first().isVisible());
    await shot(p, 'schedule-error-1280');
    await sess.getByLabel('Selesai', { exact: true }).fill('08:50');
    const picker = sess.getByRole('combobox', { name: 'Tambah dosen ke sesi' });
    await picker.fill('fatmawati');
    await p.waitForTimeout(100);
    check('lecturer search finds Fatmawati', (await p.locator('.pick-list [role="option"]').first().innerText()).includes('Fatmawati'));
    await picker.press('Enter');
    await p.waitForTimeout(200);
    check('picking a lecturer adds a chip and a blok code', (await text(p, '.sess.open .chips.edit')).includes('Fatmawati') && (await text(p, 'details.panel >> nth=1')).includes('Kode dosen (19)'));
    await shot(p, 'schedule-1280');
    await sess.getByRole('button', { name: 'Tutup' }).click();
    await p.locator('.day').first().locator('.sess').first().getByRole('button', { name: 'Duplikat' }).click();
    await p.waitForTimeout(150);
    check('duplicate adds a session', (await p.locator('.day').first().locator('.sess').count()) === 6);
    check('overlap from the duplicate warns', (await p.locator('.day').first().locator('.badge.warn').count()) >= 1);

    // dosen
    await nav(p, 'Dosen');
    await p.getByLabel('Cari dosen').fill('sadakata');
    await p.waitForTimeout(100);
    check('search narrows to one', (await p.locator('.person').count()) === 1);
    await p.locator('.person .disclose').first().click();
    const phone = p.locator('.person.open').getByRole('textbox', { name: 'Nomor 1' });
    await phone.fill('+62 812 1111 2222');
    await phone.press('Tab');
    await p.waitForTimeout(150);
    check('phone normalised on blur', (await phone.inputValue()) === '0812-1111-2222');
    check('WhatsApp target shown', (await text(p, '.person.open .phones')).includes('+6281211112222'));
    await p.locator('.person.open').getByRole('button', { name: 'Hapus dosen' }).click();
    check('delete warns about schedule use', (await text(p, 'dialog')).includes('masih dipakai di jadwal'));
    await shot(p, 'dosen-delete-1280');
    await p.getByRole('button', { name: 'Batal', exact: true }).click();
    await shot(p, 'dosen-1280');

    // heart
    await nav(p, 'Jantung 3D');
    await p.getByLabel('Bagian jantung').selectOption('lv');
    await p.waitForTimeout(100);
    check('heart part switches', (await text(p, '.part-head h3')).includes('Ventrikel'));
    check('heart ids are not editable', (await p.locator('.part-head').innerText()).includes('id lv'));
    await shot(p, 'heart-1280');

    // reset to bundled
    await nav(p, 'Link dan halaman');
    await p.getByRole('button', { name: 'Kembalikan ke bawaan' }).click();
    await p.getByRole('button', { name: 'Kembalikan', exact: true }).click();
    await p.waitForTimeout(300);
    check('reset goes back to bundled', (await text(p, '.state')) === 'Versi bawaan' || (await text(p, '.state')) === 'Belum disimpan');
    check('reset removed the server doc', await p.evaluate(() => !window.__alphaMock.docs.has('links')));

    // unsaved guard
    await p.locator('.cards > li').first().getByLabel('Nama').fill('Belum disimpan');
    await p.waitForTimeout(400);
    let guarded = false;
    p.on('dialog', async (d) => {
      if (d.type() === 'beforeunload') guarded = true;
      await d.dismiss();
    });
    await p.close({ runBeforeUnload: true });
    await new Promise((r) => setTimeout(r, 400));
    check('leaving with unsaved changes asks first', guarded);
    await p.context().close();
  }

  /* ---- admin, phone ---- */
  {
    const p = await open(390, 844, '?mock=admin&seed=1');
    await p.locator('.editor .card').first().waitFor();
    check('phone: no horizontal scroll on links', await noOverflow(p));
    await shot(p, 'links-390');
    await p.locator('.cards > li').first().getByLabel('Deskripsi').fill('Pengumuman, jadwal blok, dan info kelas.');
    await p.waitForTimeout(200);
    await p.getByRole('button', { name: 'Simpan', exact: true }).click();
    await p.getByRole('heading', { name: 'Cek sebelum simpan' }).waitFor();
    await shot(p, 'review-390');
    await p.getByRole('button', { name: 'Kembali', exact: true }).click();

    // draft survives a reload
    await p.waitForTimeout(400);
    await p.reload({ waitUntil: 'networkidle' });
    await p.locator('.banner.warn').waitFor();
    check('draft restore offered after reload', (await text(p, '.banner.warn')).includes('draf'));
    await shot(p, 'draft-390');
    await p.getByRole('button', { name: 'Pulihkan draf' }).click();
    check('draft restored', (await text(p, '.state')) === 'Belum disimpan');

    await nav(p, 'Pengumuman');
    check('phone: announcements no overflow', await noOverflow(p));
    await shot(p, 'announcements-390', true);
    await nav(p, 'Jadwal');
    await p.locator('.day').first().locator('.sess').first().getByRole('button', { name: 'Edit' }).click();
    check('phone: schedule no overflow', await noOverflow(p));
    await shot(p, 'schedule-390');
    await nav(p, 'Dosen');
    await p.locator('.person .disclose').first().click();
    check('phone: dosen no overflow', await noOverflow(p));
    await shot(p, 'dosen-390');
    await nav(p, 'Jantung 3D');
    check('phone: heart no overflow', await noOverflow(p));
    await shot(p, 'heart-390');
    { const st = await inlineStyles(p); check('phone: no inline style attributes', st.length === 0, st.join('; ')); }
    await p.context().close();
  }
} catch (e) {
  check('script ran to the end', false, e.stack || String(e));
}

await browser.close();
await server?.close();
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.info ? `\n     ${r.info}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (problems.length) console.log('\nConsole and network problems:\n' + problems.join('\n'));
process.exit(failed.length || problems.length ? 1 : 0);
