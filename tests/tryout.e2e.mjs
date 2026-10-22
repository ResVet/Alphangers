// The try out's way in, end to end, on the mock build (fake Google and a fake /api/cbt in the
// page, fixture banks from tests/fixtures/cbt), under the production headers.
//   npx vite build --mode mock --outDir dist-mock && node --test tests/tryout.e2e.mjs
// Env: CHROMIUM_PATH (default /opt/pw-browsers/chromium), SHOTS=<dir> to keep screenshots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { serveDist } from './lib/serve-dist.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const SHOTS = process.env.SHOTS;
const FIRESTORE = 'https://firestore.googleapis.com';
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const FORBIDDEN = /blokir|pelanggaran|banned/i;
const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.91';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let srv, browser;
before(async () => {
  assert.ok(existsSync(join(ROOT, 'dist-mock', 'index.html')), 'run "npx vite build --mode mock --outDir dist-mock" first');
  srv = await serveDist({ dir: join(ROOT, 'dist-mock') });
  browser = await chromium.launch({ executablePath: EXE });
});
after(async () => {
  await browser?.close();
  srv?.server.close();
});

/** The try out of the mock build, in one scenario, with everything that went wrong collected. */
async function open({ cbt = 'claim', w = 390, h = 844, ua } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: w < 900, userAgent: ua, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  await ctx.route(FIRESTORE + '/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":404,"status":"NOT_FOUND"}}' }));
  const page = await ctx.newPage();
  const errors = [], outside = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().startsWith('Failed to load resource') && m.location().url.startsWith(FIRESTORE)) return;
    errors.push('console: ' + m.text());
  });
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(srv.url) || u.startsWith('data:') || u.startsWith('blob:')) return;
    if (u.startsWith(FIRESTORE + '/v1/projects/') && r.method() === 'GET' && /\/documents\/content\/[a-z]+\?key=/.test(u)) return;
    outside.push(u);
  });
  await page.goto(`${srv.url}/?mock&cbt=${cbt}#tryout`, { waitUntil: 'load' });
  await page.waitForSelector('.to-blk.on[data-b="b3"]', { timeout: 20000 });
  const s = { ctx, page, errors, outside, ev: (f, a) => page.evaluate(f, a), tag: `${cbt}-${w}` };
  return s;
}

async function shot(s, name) {
  if (SHOTS) await s.page.screenshot({ path: join(SHOTS, `${name}-${s.page.viewportSize().width}.png`) }).catch(() => {});
}
async function axe(s, what) {
  if (!(await s.ev(() => !!window.axe))) await s.ev(AXE);
  const r = await s.ev(() => window.axe.run(document.getElementById('panel'), { resultTypes: ['violations'] }));
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '));
  assert.deepEqual(bad, [], 'axe on ' + what);
}
/** Words a student must never read: checked in the panel, its attributes, the toast and the title. */
async function words(s, what) {
  const text = await s.ev(() => {
    const p = document.getElementById('panel');
    const attrs = [...p.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.value));
    return [p.innerText, document.getElementById('toast').textContent, document.title, ...attrs].join('\n');
  });
  assert.doesNotMatch(text, FORBIDDEN, what);
}
async function done(s) {
  assert.deepEqual(await s.ev(() => window.__csp), [], 'CSP violations');
  assert.deepEqual(s.errors, [], 'page errors');
  assert.deepEqual(s.outside, [], 'requests to other hosts');
  await s.ctx.close();
}
const gate = (s, kind) => s.page.waitForSelector(`.to-gate[data-gate="${kind}"]`, { timeout: 10000 });
const fits = (s) => s.ev(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('panel').scrollWidth <= innerWidth);
const focusedHeading = (s) => s.ev(() => document.activeElement && document.activeElement.matches('.to-h'));
async function claim(s, nim) {
  await s.page.fill('#toNim', nim);
  await s.page.click('.to-nimf [type="submit"]');
}
async function signIn(s, kind) {
  await s.page.click('[data-act="gin"]');
  await gate(s, kind);
}
const picOk = (s, sel) => s.page.waitForFunction((q) => {
  const im = document.querySelector(q);
  return im && im.src.startsWith('blob:') && im.complete && im.naturalWidth > 0 && !im.closest('.to-fig').classList.contains('ld');
}, sel, { timeout: 10000 });

for (const [w, h] of [[390, 844], [1280, 800]]) {
  test(`a classmate signs in, matches the NIM, practises with pictures and signs out (${w}x${h})`, async () => {
    const s = await open({ w, h });
    // home: counts from the manifest, the new marker and the credit, nothing from Google yet
    const cards = await s.ev(() => [...document.querySelectorAll('.to-blk.on')].map((b) => ({ id: b.dataset.b, m: b.querySelector('.to-bm').textContent, nb: !!b.querySelector('.to-nb'), by: b.querySelector('.to-bby')?.textContent || '' })));
    assert.deepEqual(cards.map((c) => c.id), ['b2', 'b3']);
    assert.match(cards[0].m, /^6 soal · 3 topik/);
    assert.deepEqual([cards[1].nb, cards[1].by], [true, 'Disusun Batu Alphangers']);
    assert.match(await s.ev(() => document.getElementById('toAcct').textContent), /Khusus anak Alpha/);
    assert.equal(await s.ev(() => document.querySelector('.to-blk.off .to-bs').textContent), 'Soalnya belum masuk');
    // four bloks; a credit line shows only once it has a name, and an empty note not at all
    assert.deepEqual(await s.ev(() => [...document.querySelectorAll('.to-blk')].map((b) => b.dataset.b)), ['b1', 'b2', 'b3', 'b4']);
    assert.deepEqual(await s.ev(() => [...document.querySelectorAll('.to-bby')].filter((e) => e.offsetParent).map((e) => e.closest('.to-blk').dataset.b)), ['b3']);
    assert.equal(await s.ev(() => !!document.querySelector('.to-note').offsetParent), false);
    await shot(s, 'home');

    // a bank asks for sign-in; Back goes home; the second visit still asks
    await s.page.click('.to-blk.on[data-b="b3"]');
    await gate(s, 'masuk');
    assert.ok(await focusedHeading(s), 'focus on the heading');
    assert.ok(await fits(s), 'sign-in fits');
    await words(s, 'masuk');
    await axe(s, 'masuk');
    await shot(s, 'masuk');
    await s.page.goBack();
    await s.page.waitForSelector('.to-blk.on[data-b="b3"]');
    await s.page.click('.to-blk.on[data-b="b3"]');
    await gate(s, 'masuk');

    // Google (fake), then the NIM: unknown, taken, then Dina's, with a preview and a "no"
    await signIn(s, 'nim');
    await axe(s, 'nim');
    await shot(s, 'nim');
    await claim(s, '04011000000000');
    await s.page.waitForFunction(() => /nggak ada di daftar/.test(document.getElementById('toNimE').textContent));
    assert.equal(await s.ev(() => document.getElementById('toNim').getAttribute('aria-invalid')), 'true');
    await claim(s, '04011999999002');
    await s.page.waitForFunction(() => /sudah dipakai akun Google lain/.test(document.getElementById('toNimE').textContent));
    await claim(s, '12ab');
    await s.page.waitForFunction(() => /angka aja/.test(document.getElementById('toNimE').textContent));
    await words(s, 'nim errors');
    await shot(s, 'nim-error');
    await claim(s, '04011999999001');
    await s.page.waitForSelector('.to-pv-q');
    assert.equal(await s.ev(() => document.querySelector('.to-pv-q b').textContent), 'Dina Ayu Pratiwi');
    assert.match(await s.ev(() => document.getElementById('toPassNim').textContent), /04011999999001/);
    await axe(s, 'preview');
    await shot(s, 'nim-preview');
    await s.page.click('[data-act="nimx"]');
    await s.page.waitForSelector('#toNim');
    assert.equal(await s.ev(() => document.getElementById('toNim').value), '04011999999001');
    await s.page.click('.to-nimf [type="submit"]');
    await s.page.waitForSelector('[data-act="nimok"]');
    await s.page.click('[data-act="nimok"]');

    // setup of Blok 3: credit, references (https only), no filters that would match nothing
    await s.page.waitForSelector('.to-start', { timeout: 10000 });
    assert.equal(await s.ev(() => history.state.tv), 'setup');
    assert.equal(await s.ev(() => document.querySelector('.to-by').textContent), 'Disusun Batu Alphangers');
    const secs = await s.ev(() => [...document.querySelectorAll('.to-sec-h h3')].map((x) => x.textContent));
    assert.ok(!secs.includes('Jenis soal') && !secs.includes('Topik'), 'one type and one topic: no filter for them');
    await s.page.click('.to-refs summary');
    const refs = await s.ev(() => [...document.querySelectorAll('.to-refl li')].map((li) => { const a = li.querySelector('a'); return a ? [a.href, a.target, a.rel] : [null]; }));
    assert.deepEqual(refs, [['https://example.org/alberts', '_blank', 'noopener noreferrer'], [null], [null]]);
    assert.ok(await fits(s), 'setup fits');
    await axe(s, 'setup');
    await shot(s, 'setup');

    // practice in a fixed order so the first question is the one with pictures
    await s.page.click('[data-act="sq"]');
    await s.page.click('[data-act="so"]');
    await s.page.click('.to-start');
    await s.page.waitForSelector('#toQ .to-fig img');
    await picOk(s, '#toQ .to-fig img');
    assert.deepEqual(await s.ev(() => { const im = document.querySelector('#toQ .to-fig img'); return [im.alt, im.naturalWidth, im.getAttribute('width'), im.getAttribute('height')]; }), ['Gambar soal', 640, '640', '440']);
    const wm = await s.ev(() => { const el = document.getElementById('toWm'); return { hidden: el.hidden, bg: getComputedStyle(el).backgroundImage, pe: getComputedStyle(el).pointerEvents, aria: el.getAttribute('aria-hidden') }; });
    assert.equal(wm.hidden, false);
    assert.deepEqual([wm.pe, wm.aria], ['none', 'true']);
    assert.ok(decodeURIComponent(wm.bg).includes('Dina Ayu Pratiwi ·· 9001'), 'watermark carries the name and the last four NIM digits');
    assert.ok(await s.ev(() => getComputedStyle(document.querySelector('#toQ .to-pwm')).backgroundImage.startsWith('url(')), 'pictures carry the watermark too');
    assert.equal(await s.ev(() => getComputedStyle(document.getElementById('toQt')).whiteSpace), 'pre-line');
    await axe(s, 'question with a picture');
    await shot(s, 'run-picture');

    // the picture full screen; Back closes it and keeps the question
    await s.page.click('#toQ .to-fz');
    await s.page.waitForSelector('.to-zoom.on');
    await axe(s, 'picture full screen');
    await shot(s, 'zoom');
    await s.page.goBack();
    await s.page.waitForFunction(() => !document.querySelector('.to-zoom') && document.querySelector('#toQ .to-fig img'));
    assert.equal(await s.ev(() => history.state.tv), 'run');

    // right answer with its explanation picture, then a wrong one with a note and two paragraphs
    await s.page.click('.to-o[data-o="1"]');
    await s.page.click('[data-act="check"]');
    await s.page.waitForSelector('.to-fb.ok');
    await picOk(s, '.to-fb .to-fig img');
    assert.deepEqual(await s.ev(() => { const im = document.querySelector('.to-fb .to-fig img'); return [im.alt, im.naturalWidth]; }), ['Gambar pembahasan', 560]);
    await shot(s, 'run-explanation');
    await s.page.click('#toFoot [data-act="next"]');
    await s.page.waitForFunction(() => /\n\n/.test(document.getElementById('toQt').textContent));
    await s.page.click('.to-o[data-o="0"]');
    await s.page.click('[data-act="check"]');
    await s.page.waitForSelector('.to-fb.no .to-nt');
    await s.page.click('#toFoot [data-act="next"]');
    await s.page.click('#toFoot .skip');
    await s.page.click('.to-o[data-o="1"]');
    await s.page.click('[data-act="check"]');
    await s.page.click('#toFoot [data-act="finish"]');
    await s.page.click('.to-dlg [data-dok]');
    await s.page.waitForSelector('#toScore');
    assert.equal(await s.ev(() => document.getElementById('toWm').hidden), true, 'no watermark on the result');

    // review: pictures and the watermark again
    await s.page.click('[data-act="review"]');
    await s.page.waitForSelector('.to-review');
    await s.page.click('[data-act="rf"][data-v="all"]');
    await picOk(s, '.to-rc .to-qt + .to-figs img');
    await picOk(s, '.to-rc .to-fb .to-fig img');
    assert.equal(await s.ev(() => document.getElementById('toWm').hidden), false);
    await words(s, 'review');
    await shot(s, 'review');

    // home again: signed in as Dina; signing out forgets the keys and keeps the scores
    await s.page.goBack(); await s.page.waitForSelector('#toScore');
    await s.page.goBack(); await s.page.waitForSelector('.to-start');
    await s.page.goBack(); await s.page.waitForSelector('#toAcct [data-act="gout"]');
    assert.match(await s.ev(() => document.getElementById('toAcct').textContent), /Masuk sebagai Dina Ayu Pratiwi/);
    assert.ok(await s.ev(() => !!localStorage.getItem('alpha.cbt.v1')));
    await s.page.click('#toAcct [data-act="gout"]');
    await s.page.waitForFunction(() => /Khusus anak Alpha/.test(document.getElementById('toAcct').textContent));
    assert.equal(await s.ev(() => localStorage.getItem('alpha.cbt.v1')), null, 'keys gone');
    assert.ok(await s.ev(() => JSON.parse(localStorage.getItem('alpha.to.v1.hist.b3')).length === 1), 'the score stays');
    await s.page.click('.to-blk.on[data-b="b3"]');
    await gate(s, 'masuk');
    await done(s);
  });
}

test('an account that may not take the try out: neutral words, a way to switch accounts', async () => {
  const s = await open({ cbt: 'closed', w: 1280, h: 800 });
  await s.page.click('.to-blk.on[data-b="b2"]');
  await gate(s, 'masuk');
  await signIn(s, 'tutup');
  assert.match(await s.ev(() => document.querySelector('.to-gate').innerText), /hubungi pengurus kelas/);
  await words(s, 'tutup');
  await axe(s, 'tutup');
  await shot(s, 'tutup');
  await s.page.click('[data-act="gswitch"]');
  await gate(s, 'masuk');
  assert.equal(await s.ev(() => localStorage.getItem('alpha.cbt.v1')), null);
  await done(s);
});

test('the server has no key yet; Google unreachable; too many NIM checks', async () => {
  let s = await open({ cbt: 'setup' });
  await s.page.click('.to-blk.on[data-b="b3"]');
  await gate(s, 'masuk');
  await signIn(s, 'siap');
  await words(s, 'siap');
  await axe(s, 'siap');
  await shot(s, 'siap');
  await done(s);

  s = await open({ cbt: 'offline' });
  await s.page.click('.to-blk.on[data-b="b3"]');
  await gate(s, 'masuk');
  await s.page.click('[data-act="gin"]');
  await s.page.waitForFunction(() => /Nggak bisa nyambung ke Google/.test(document.getElementById('toGErr').textContent));
  assert.equal(await s.ev(() => document.querySelector('[data-act="gin"]').disabled), false, 'the button can be tapped again');
  await words(s, 'offline');
  await shot(s, 'masuk-offline');
  await done(s);

  s = await open({ cbt: 'slow' });
  await s.page.click('.to-blk.on[data-b="b3"]');
  await gate(s, 'masuk');
  await signIn(s, 'nim');
  await claim(s, '04011999999001');
  await s.page.waitForFunction(() => /Kebanyakan percobaan/.test(document.getElementById('toNimE').textContent));
  await done(s);
});

test('a link opened inside Instagram says how to get to a real browser', async () => {
  const s = await open({ ua: INSTAGRAM });
  await s.page.click('.to-blk.on[data-b="b3"]');
  await gate(s, 'inapp');
  assert.ok((await s.ev(() => document.getElementById('toUrl').value)).includes('#tryout'));
  assert.ok(await fits(s));
  await words(s, 'inapp');
  await axe(s, 'inapp');
  await shot(s, 'inapp');
  await s.page.click('[data-act="gapp"]');
  await gate(s, 'masuk');
  await s.page.goBack();
  await s.page.waitForSelector('.to-blk.on[data-b="b3"]');
  await done(s);
});

test('signed out with an unfinished session: no resume card and no questions', async () => {
  const s = await open({ cbt: 'ok' });
  await s.ev(() => localStorage.setItem('alpha.to.v1.sess.b3', JSON.stringify({ v: 1, id: 'x', blok: 'b3', mode: 'latihan', ids: ['g01', 'g02'], perm: {}, ans: {}, chk: {}, flag: {}, cur: 1, limit: 0, used: 30, t0: Date.now(), label: '', w5: 0, w1: 0 })));
  await s.page.reload();
  await s.page.waitForSelector('.to-blk.on[data-b="b3"]');
  assert.equal(await s.ev(() => !!document.querySelector('.to-resume')), false);
  await s.page.click('.to-blk.on[data-b="b3"]');
  await gate(s, 'masuk');
  assert.doesNotMatch(await s.ev(() => document.getElementById('panel').innerText), /hemofilia|Perhatikan gambar/);
  // once signed in (already matched in this scenario) the session is there to resume
  await s.page.click('[data-act="gin"]');
  await s.page.waitForSelector('.to-start', { timeout: 10000 });
  await s.page.goBack();
  await s.page.waitForSelector('.to-resume');
  await done(s);
});
