// Divisi section and footer on the built site: names fit their column on one line at every
// width, every division has a tag, and an edited list with empty texts falls back to the bundled
// ones. Plus the footer credit link.
//   npx vite build && node --test tests/divisi.e2e.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { serveDist } from './lib/serve-dist.mjs';

let srv, browser;
before(async () => {
  srv = await serveDist();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
});
after(async () => { await browser?.close(); srv?.server.close(); });

async function open(width, height, firestore) {
  const mobile = width < 900;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  await page.route('https://firestore.googleapis.com/**', (r) => (firestore ? firestore(r) : r.fulfill({ status: 404, contentType: 'application/json', body: '{}' })));
  await page.goto(srv.url + '/', { waitUntil: 'load' });
  await page.evaluate(() => document.getElementById('divisi').scrollIntoView());
  await page.waitForSelector('.dv-name');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return { page, context };
}

const lines = (page) => page.$$eval('.dv-name', (ns) => ns.map((n) => {
  const r = document.createRange();
  r.selectNodeContents(n);
  return [n.textContent, new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size, n.scrollWidth <= n.clientWidth + 1];
}));

for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1180, 820], [1280, 800], [1440, 900], [1920, 1080]]) {
  test(`divisi names on one line at ${w}x${h}`, async () => {
    const { page, context } = await open(w, h);
    for (const [name, n, fits] of await lines(page)) {
      assert.equal(n, 1, `${name} wraps at ${w}px`);
      assert.ok(fits, `${name} overflows at ${w}px`);
    }
    await context.close();
  });
}

test('every division has a tag, and Didis is spelled out', async () => {
  const { page, context } = await open(1280, 800);
  const rows = await page.$$eval('.dv-ch', (cs) => cs.map((c) => [c.dataset.id, c.querySelector('.dv-tag')?.textContent || '', c.querySelector('.dv-full')?.textContent || '']));
  assert.equal(rows.length, 8);
  for (const [id, tag] of rows) assert.ok(tag.trim(), `${id} has no tag`);
  assert.deepEqual(rows.find(([id]) => id === 'didis').slice(2), ['Divisi Disiplin']);
  await context.close();
});

test('an edited divisi list with empty texts shows the bundled ones', async () => {
  const links = (await import('../src/data/links.json', { with: { type: 'json' } })).default;
  const divisi = (await import('../src/data/divisi.json', { with: { type: 'json' } })).default.items
    .map((d) => ({ ...d, full: '', tag: d.id === 'pleno' ? 'Tag sendiri' : '', desc: d.id === 'didis' ? '' : d.desc }));
  const doc = { ...links, divisi };
  const body = JSON.stringify({ name: 'x', fields: { rev: { integerValue: '9' }, json: { stringValue: JSON.stringify(doc) } }, updateTime: new Date().toISOString() });
  const { page, context } = await open(1280, 800, (r) => (/content\/links/.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: 'application/json', body })
    : r.fulfill({ status: 404, contentType: 'application/json', body: '{}' })));
  await page.waitForFunction(() => /Tag sendiri/.test(document.querySelector('#dv-pleno .dv-tag')?.textContent || ''), null, { timeout: 15000 });
  assert.equal(await page.textContent('#dv-didis .dv-tag'), 'Tertib kelas');
  assert.equal(await page.textContent('#dv-didis .dv-full'), 'Divisi Disiplin');
  assert.match(await page.textContent('#dv-didis .dv-desc'), /absensi/);
  await context.close();
});

test('footer credit links to the repository', async () => {
  const { page, context } = await open(1280, 800);
  const a = page.locator('footer a.credit');
  assert.equal(await a.textContent(), 'Made with love by Resvet');
  assert.equal(await a.getAttribute('href'), 'https://github.com/ResVet/Alphangers');
  assert.equal(await a.getAttribute('target'), '_blank');
  assert.match(await a.getAttribute('rel'), /noopener/);
  await context.close();
});
