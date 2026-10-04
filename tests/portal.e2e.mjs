// End-to-end checks of the built portal under the production headers.
//   npm run build && node --test tests/portal.e2e.mjs
// Env: CHROMIUM_PATH (default /opt/pw-browsers/chromium), SHOTS=<dir> to keep screenshots,
// VIEWPORTS=1280x800,390x844 to narrow the matrix.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { serveDist } from './lib/serve-dist.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const VIEWPORTS = (process.env.VIEWPORTS || '1440x900,1280x800,768x1024,390x844,360x640,844x390').split(',');
const SHOTS = process.env.SHOTS;
const FIRESTORE = 'https://firestore.googleapis.com';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let srv, browser, noGl;

before(async () => {
  assert.ok(existsSync(join(ROOT, 'dist', 'index.html')), 'run "npm run build" first');
  srv = await serveDist();
  browser = await chromium.launch({ executablePath: EXE, args: GL });
  noGl = await chromium.launch({ executablePath: EXE, args: ['--disable-3d-apis'] });
});
after(async () => {
  await browser?.close();
  await noGl?.close();
  srv?.server.close();
});

/** Opens the portal and collects anything that went wrong while it ran. */
async function open(b, { w = 1280, h = 800, reducedMotion = false, blockStorage = false, hash = '' } = {}) {
  const touch = w < 1024 || h > w;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: w < 900, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  // collect CSP violations from inside the page
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  // count channel rows taken out of the page: they should be drawn once, not redrawn when
  // a remote copy turns out to match the one on screen
  await ctx.addInitScript(() => {
    window.__rowsRemoved = 0;
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.removedNodes) if (n.nodeType === 1 && n.classList?.contains('row')) window.__rowsRemoved++;
    }).observe(document, { childList: true, subtree: true });
  });
  if (blockStorage) {
    await ctx.addInitScript(() => {
      for (const k of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, k, { get() { throw new DOMException('blocked', 'SecurityError'); } });
      }
    });
  }
  // Once Firebase is configured the portal asks Firestore for each content key. The tests
  // answer like an empty database, so every section falls back to the bundled copy.
  await ctx.route(FIRESTORE + '/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":404,"status":"NOT_FOUND"}}' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // the browser's own line for those 404s
    if (m.text().startsWith('Failed to load resource') && m.location().url.startsWith(FIRESTORE)) return;
    errors.push('console: ' + m.text());
  });
  page.on('requestfailed', (r) => { if (!/\/sw\.js$/.test(r.url())) errors.push('requestfailed: ' + r.url()); });
  const outside = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(srv.url) || u.startsWith('data:') || u.startsWith('blob:')) return;
    // Firestore reads are the one expected outside request: plain GETs for a content document, no cookies
    if (u.startsWith(FIRESTORE + '/v1/projects/') && r.method() === 'GET' && /\/documents\/content\/[a-z]+\?key=/.test(u)) return;
    outside.push(u);
  });
  await page.goto(srv.url + '/' + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.classList.contains('js'));
  await page.waitForTimeout(reducedMotion ? 600 : 3400);
  return { ctx, page, errors, outside, ev: (f, a) => page.evaluate(f, a) };
}

async function finish(t, s, name) {
  if (SHOTS) await s.page.screenshot({ path: join(SHOTS, name + '.png') }).catch(() => {});
  const csp = await s.ev(() => window.__csp).catch(() => []);
  assert.deepEqual(csp, [], 'CSP violations');
  assert.deepEqual(s.errors, [], 'page errors');
  assert.deepEqual(s.outside, [], 'requests to other hosts (only Firestore content reads are allowed)');
  await s.ctx.close();
}

const overflow = (s) => s.ev(() => document.documentElement.scrollWidth - innerWidth);

for (const vp of VIEWPORTS) {
  const [w, h] = vp.split('x').map(Number);
  test(`portal at ${vp}`, async (t) => {
    const s = await open(browser, { w, h });
    assert.ok((await overflow(s)) <= 0, 'no sideways scroll at the top');

    // section order: schedule, Drive channels, lecturers, heart cycle, 3D heart
    const order = await s.ev(() => ['jadwal', 'menu', 'dosen', 'siklus', 'anatomi'].map((id) => document.getElementById(id).getBoundingClientRect().top + scrollY));
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections in order');

    // schedule mounted with a day heading and the next-up readout
    await s.ev(() => document.getElementById('jadwal').scrollIntoView());
    await s.page.waitForSelector('#jadwalRoot .jw-date', { timeout: 10000 });
    assert.match(await s.ev(() => document.querySelector('#jadwalRoot .jw-date').textContent), /\d/);
    assert.ok((await overflow(s)) <= 0, 'no sideways scroll at the schedule');

    // the announcement board stays out of the way while there is nothing to announce
    assert.equal(await s.ev(() => document.getElementById('info').hidden), true);

    // ten channels, drawn once; a Drive channel opens its panel with the right folder, Escape closes it
    assert.equal(await s.ev(() => document.querySelectorAll('#rows .row-b').length), 10);
    assert.equal(await s.ev(() => window.__rowsRemoved), 0, 'channel rows were not redrawn');
    await s.ev(() => document.querySelector('.row-b[data-id="praktikum"]').scrollIntoView({ block: 'center' }));
    await s.page.waitForTimeout(400);
    await s.page.click('.row-b[data-id="praktikum"]');
    // Escape is ignored while the curtain is still moving, as it was in v3
    await s.page.waitForFunction(() => document.querySelector('#panel.on .folder') && !document.querySelector('#curtain.move'), null, { timeout: 15000 });
    assert.equal(await s.ev(() => document.querySelector('#panel .folder').href), 'https://drive.google.com/drive/folders/1LTCIJ6ieAdvzZXUIvfrnTe_ww6ID32Xm');
    assert.ok(await s.ev(() => document.querySelector('#panel').scrollWidth <= innerWidth), 'panel fits');
    await s.page.keyboard.press('Escape');
    await s.page.waitForFunction(() => !document.querySelector('#panel').classList.contains('on') && !document.querySelector('#curtain.move'), null, { timeout: 15000 });

    // lecturer list: folded until asked, then all of it
    await s.ev(() => document.getElementById('dosen').scrollIntoView());
    await s.page.waitForSelector('#dosenRoot .dz-row', { timeout: 15000 });
    assert.equal(await s.ev(() => document.getElementById('dosenRoot').classList.contains('dz-folded')), true, 'list starts folded');
    await s.page.click('#dosenRoot .dz-more-b');
    assert.equal(await s.ev(() => document.getElementById('dosenRoot').classList.contains('dz-folded')), false);
    assert.ok((await overflow(s)) <= 0, 'no sideways scroll at the lecturers');

    // search palette finds a lecturer and hands over to the lecturer section
    await s.ev(() => scrollTo(0, 0));
    await s.page.click('#findBtn');
    await s.page.waitForSelector('dialog.fd[open]');
    await s.page.fill('.fd-q', 'ziske');
    await s.page.waitForFunction(() => document.querySelectorAll('.fd-o').length > 0);
    assert.match(await s.ev(() => document.querySelector('.fd-o .fd-n').textContent), /Ziske/);
    await s.page.keyboard.press('Enter');
    await s.page.waitForSelector('#dosenRoot dialog[open]', { timeout: 10000 });
    await s.page.keyboard.press('Escape');

    // try out opens from its hash and reaches the setup screen
    await s.ev(() => { location.hash = 'tryout'; });
    await s.page.waitForFunction(() => !!document.querySelector('.to-blk.on') && !document.querySelector('#curtain.move'), null, { timeout: 20000 });
    await s.page.click('.to-blk.on');
    await s.page.waitForSelector('.to-start', { timeout: 10000 });
    assert.ok(await s.ev(() => document.querySelector('#panel').scrollWidth <= innerWidth), 'try out setup fits');
    await s.page.keyboard.press('Escape');
    await s.page.waitForFunction(() => !document.querySelector('#curtain.move'), null, { timeout: 15000 });

    // 3D heart loads, or says plainly why not
    await s.ev(() => document.getElementById('anatomi').scrollIntoView());
    await s.page.waitForFunction(() => document.querySelector('.hx.ready, .hx.hx-off'), null, { timeout: 60000 });
    assert.ok((await overflow(s)) <= 0, 'no sideways scroll at the heart');
    await finish(t, s, 'portal-' + vp);
  });
}

test('reduced motion: content is there at once, the heart does not spin', async (t) => {
  const s = await open(browser, { reducedMotion: true });
  assert.equal(await s.ev(() => getComputedStyle(document.getElementById('loader')).display === 'none' || document.getElementById('loader').classList.contains('done') || !document.getElementById('loader').offsetParent), true);
  await s.ev(() => document.getElementById('anatomi').scrollIntoView());
  await s.page.waitForFunction(() => document.querySelector('.hx.ready, .hx.hx-off'), null, { timeout: 60000 });
  await finish(t, s, 'reduced-motion');
});

test('storage blocked: everything still renders', async (t) => {
  const s = await open(browser, { blockStorage: true });
  await s.page.waitForSelector('#jadwalRoot .jw-date', { timeout: 10000 });
  await s.ev(() => document.getElementById('dosen').scrollIntoView());
  await s.page.waitForSelector('#dosenRoot .dz-row', { timeout: 15000 });
  assert.equal(await s.ev(() => document.querySelectorAll('#rows .row-b').length), 10);
  await finish(t, s, 'storage-blocked');
});

test('no WebGL: still picture and the part notes', async (t) => {
  const s = await open(noGl, {});
  await s.ev(() => document.getElementById('anatomi').scrollIntoView());
  await s.page.waitForSelector('.hx.hx-off .hx-poster', { timeout: 20000 });
  assert.ok(await s.ev(() => document.querySelectorAll('.hx-item').length >= 55), 'part list');
  await finish(t, s, 'no-webgl');
});

test('accessibility: no serious or critical axe findings', async (t) => {
  const s = await open(browser, { reducedMotion: true });
  for (const id of ['dosen', 'anatomi']) {
    await s.ev((id) => document.getElementById(id).scrollIntoView(), id);
    await s.page.waitForTimeout(1500);
  }
  await s.page.waitForFunction(() => document.querySelector('.hx.ready, .hx.hx-off'), null, { timeout: 60000 });
  // injected through the devtools protocol, so the page CSP does not see an inline script
  await s.page.evaluate(readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8'));
  const res = await s.ev(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '));
  });
  assert.deepEqual(res, []);
  await finish(t, s, 'axe');
});
