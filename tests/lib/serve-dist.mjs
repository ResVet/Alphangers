// Serves dist/ with the headers from netlify.toml, applied the way Netlify applies them:
// every matching rule contributes, and same-name headers are joined. Lets the tests run the
// built site under the real Content-Security-Policy.
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.txt': 'text/plain',
};

export function headerRules(toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8')) {
  const rules = [];
  let cur = null;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line === '[[headers]]') { cur = { for: null, values: {} }; rules.push(cur); continue; }
    if (line.startsWith('[')) { if (line !== '[headers.values]') cur = null; continue; }
    if (!cur) continue;
    const m = line.match(/^([A-Za-z-]+)\s*=\s*"(.*)"$/);
    if (!m) continue;
    if (m[1] === 'for') cur.for = m[2];
    else cur.values[m[1]] = m[2];
  }
  return rules;
}

const matches = (pattern, path) => (pattern.endsWith('/*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern);

export function serveDist({ dir = join(ROOT, 'dist'), port = 0 } = {}) {
  const rules = headerRules();
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/admin') { res.writeHead(301, { location: '/admin/' }); return res.end(); }
    let file = join(dir, path);
    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    const headers = { 'content-type': TYPES[extname(file)] || 'application/octet-stream' };
    for (const r of rules) {
      if (!matches(r.for, path)) continue;
      for (const [k, v] of Object.entries(r.values)) {
        const key = k.toLowerCase();
        headers[key] = headers[key] && key !== 'content-type' ? headers[key] + ', ' + v : v;
      }
    }
    res.writeHead(200, headers);
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port })));
}
