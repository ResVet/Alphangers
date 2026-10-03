// node scripts/heart/dev/shoot.mjs <model path relative to repo> <out.png> [query]
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const [model, out, extra = ''] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = srv.address().port;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
pg.on('console', m => m.type() === 'error' && console.log('console:', m.text()));
pg.on('pageerror', e => console.log('pageerror:', e.message));
await pg.goto(`http://localhost:${port}/scripts/heart/dev/preview.html?m=/${model}&${extra}`);
await pg.waitForFunction(() => window.__ready, null, { timeout: 120000 });
await pg.locator('canvas').screenshot({ path: out });
await b.close(); srv.close();
console.log('saved', out);
