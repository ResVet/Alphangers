// Frame-time benchmark of the built portal: scrolls the whole page and works the 3D heart
// under CPU throttling, then prints frame statistics and main-thread long tasks.
//   npm run build && node tests/perf.mjs            (THROTTLE=4 W=390 H=844 to change)
import { chromium } from '@playwright/test';
import { serveDist } from './lib/serve-dist.mjs';

const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const W = +(process.env.W || 1280), H = +(process.env.H || 800);
const THROTTLE = +(process.env.THROTTLE || 4);
const mobile = W < 900;

const srv = await serveDist();
const browser = await chromium.launch({ executablePath: EXE, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1 });
await ctx.route('https://firestore.googleapis.com/**', (r) => r.fulfill({ status: 404, body: '{}' }));
await ctx.addInitScript(() => {
  window.__long = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  window.__frames = (ms) => new Promise((res) => {
    const out = []; let last = performance.now(); const end = last + ms;
    const f = (t) => { out.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(out); };
    requestAnimationFrame(f);
  });
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
const t0 = Date.now();
await page.goto(srv.url + '/', { waitUntil: 'load' });
await page.waitForTimeout(4000);
const loadLong = await page.evaluate(() => window.__long.splice(0));

function stats(name, f) {
  f = f.slice(2).sort((a, b) => a - b);
  const q = (p) => f[Math.min(f.length - 1, Math.floor(p * f.length))].toFixed(1);
  const janky = f.filter((x) => x > 34).length;
  console.log(`${name.padEnd(22)} frames ${String(f.length).padStart(4)}  p50 ${q(0.5)}ms  p90 ${q(0.9)}ms  p99 ${q(0.99)}ms  >34ms ${janky} (${(100 * janky / f.length).toFixed(0)}%)`);
}
const sum = (a) => a.reduce((s, x) => s + x, 0);
console.log(`viewport ${W}x${H}  cpu x${THROTTLE}  load long tasks: ${loadLong.length}, ${sum(loadLong).toFixed(0)}ms total, max ${Math.max(0, ...loadLong).toFixed(0)}ms`);

stats('idle hero', await page.evaluate(() => window.__frames(2500)));

// scroll the page in steps, like a reader with a wheel or a flick
const total = await page.evaluate(() => document.documentElement.scrollHeight);
const scrollFrames = page.evaluate(() => window.__frames(9000));
const steps = 90;
for (let i = 0; i < steps; i++) {
  await page.mouse.wheel(0, Math.ceil(total / steps));
  await page.waitForTimeout(95);
}
stats('scroll whole page', await scrollFrames);
const scrollLong = await page.evaluate(() => window.__long.splice(0));
console.log(`  scroll long tasks: ${scrollLong.length}, ${sum(scrollLong).toFixed(0)}ms, max ${Math.max(0, ...scrollLong).toFixed(0)}ms`);

// the heart explorer
await page.evaluate(() => document.getElementById('anatomi').scrollIntoView());
const ready = await page.waitForSelector('.hx.ready', { timeout: 60000 }).then(() => true, () => false);
console.log('heart ready:', ready, ((Date.now() - t0) / 1000).toFixed(1) + 's since start');
await page.waitForTimeout(1500);
await page.evaluate(() => window.__long.splice(0));
const box = await page.locator('.hx-c').boundingBox();
const hov = page.evaluate(() => window.__frames(3000));
for (let i = 0; i < 40; i++) {
  await page.mouse.move(box.x + box.width * (0.3 + 0.4 * (i / 40)), box.y + box.height * (0.35 + 0.3 * Math.sin(i / 6)));
  await page.waitForTimeout(60);
}
stats('heart hover', await hov);
const drag = page.evaluate(() => window.__frames(3000));
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
for (let i = 0; i < 40; i++) { await page.mouse.move(box.x + box.width / 2 + i * 6, box.y + box.height / 2 + Math.sin(i / 5) * 30); await page.waitForTimeout(50); }
await page.mouse.up();
stats('heart drag', await drag);
for (const m of ['cut', 'ecg', 'flow']) {
  const t = Date.now();
  await page.click(`.hx-mode[data-mode="${m}"]`);
  stats(`heart mode ${m}`, await page.evaluate(() => window.__frames(2500)));
  console.log(`  switch+frames ${Date.now() - t}ms`);
}
const tapT = Date.now();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(50);
console.log('tap to info ms', Date.now() - tapT);
const heartLong = await page.evaluate(() => window.__long.splice(0));
console.log(`  heart long tasks: ${heartLong.length}, ${sum(heartLong).toFixed(0)}ms, max ${Math.max(0, ...heartLong).toFixed(0)}ms`);
const m = await cdp.send('Performance.enable').then(() => cdp.send('Performance.getMetrics'));
const g = (n) => m.metrics.find((x) => x.name === n)?.value;
console.log(`DOM nodes ${g('Nodes')}  JS heap ${(g('JSHeapUsedSize') / 1e6).toFixed(1)}MB  layouts ${g('LayoutCount')}  recalcs ${g('RecalcStyleCount')}  layout time ${(g('LayoutDuration') * 1000).toFixed(0)}ms  style time ${(g('RecalcStyleDuration') * 1000).toFixed(0)}ms  script ${(g('ScriptDuration') * 1000).toFixed(0)}ms`);
await browser.close();
srv.server.close();
