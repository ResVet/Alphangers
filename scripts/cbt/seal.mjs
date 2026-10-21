// Seals the try out for the site, from a private folder that is never committed:
//   roster.json        { v, cls, source, people: [{ nim, name, grp, blocked? }] }
//   banks/<id>.json    a question bank in the site format; pictures as paths in the folder, or
//                      an empty path for img/<bank id>/<picture id>.<ext>. Other files there
//                      (working files, notes) are skipped.
//   img/...            those pictures
//   secret.txt         the master secret, unless CBT_SECRET is set
// It checks everything first and writes nothing if anything is wrong. Then it writes:
//   public/cbt/<id>.<hash>.bin          each bank, sealed with its own key
//   public/cbt/<id>-<img>.<hash>.bin    each picture, sealed with its bank's key
//   src/data/cbt.json                   the public list of banks: names and counts, nothing secret
//   netlify/data/cbt.mjs                the sealed class list and the bank versions, for the function
// Sealing is deterministic, so running it again on the same input changes no file, and sealed
// files it no longer uses are deleted. It never prints the secret or a key.
//
//   node scripts/cbt/seal.mjs --private ../cbt-private [--out <repository root>]
//   npm run cbt:seal -- --private ../cbt-private
//
// A bank's key changes with its "kv" (default 1): raise it to lock out everyone who kept the
// old key, then deploy.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { LABEL, BANK_ID, IMG_ID, derive, seal, openJson, hashHex, parseSecret, toB64u } from '../../src/lib/seal.js';
import { NIM_RE, cleanName } from '../../netlify/lib/cbt.mjs';
import { sniff, TYPES, MAX_BYTES } from '../../netlify/lib/media.mjs';

function fail(message) {
  console.error(message);
  process.exit(1);
}
const USAGE = 'usage: node scripts/cbt/seal.mjs --private <folder> [--out <repository root>]';
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--private', '--out'].includes(args[i]) || !args[i + 1]) fail(USAGE);
  opt[args[i]] = args[i + 1];
}
if (!opt['--private']) fail(USAGE);
const dir = resolve(opt['--private']);
const out = resolve(opt['--out'] || join(dirname(fileURLToPath(import.meta.url)), '../..'));
const inside = (base, p) => {
  const r = relative(base, p);
  return r === '' || !(r === '..' || r.startsWith('..' + sep) || isAbsolute(r));
};
if (inside(out, dir)) fail('Keep the private folder outside the output folder, or its plain text can end up in git.');

const problems = [];
const bad = (where, what) => problems.push(`${where}: ${what}`);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
function text(v, where, field, { max = 200, optional = false } = {}) {
  if (v === undefined && optional) return;
  if (typeof v !== 'string' || !v.trim()) return bad(where, `${field} must be text`);
  if (v.length > max) bad(where, `${field} is over ${max} characters`);
  if (UNSAFE.test(v)) bad(where, `${field} has control or text-direction characters`);
}
function onlyKeys(o, keys, where) {
  for (const k of Object.keys(o)) if (!keys.includes(k)) bad(where, `unknown field "${k}"`);
}
function readJson(path, where) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    bad(where, e.code === 'ENOENT' ? 'missing' : 'not valid JSON');
    return undefined;
  }
}

// ---------- the secret

let raw = process.env.CBT_SECRET?.trim();
if (!raw) {
  try {
    raw = readFileSync(join(dir, 'secret.txt'), 'utf8').trim();
  } catch {
    raw = '';
  }
}
let master = null;
try {
  master = parseSecret(raw);
} catch {
  bad('secret', 'set CBT_SECRET or put secret.txt in the private folder: 43 base64url characters');
}

// ---------- the class list

const people = [];
const rosterIn = readJson(join(dir, 'roster.json'), 'roster.json');
if (rosterIn !== undefined) {
  if (!isObj(rosterIn) || !Array.isArray(rosterIn.people) || !rosterIn.people.length) bad('roster.json', 'needs a list of people');
  else {
    const seen = new Set();
    rosterIn.people.forEach((p, i) => {
      const where = `roster.json people[${i}]`;
      if (!isObj(p)) return bad(where, 'not an object');
      onlyKeys(p, ['nim', 'name', 'grp', 'blocked'], where);
      if (typeof p.nim !== 'string' || !NIM_RE.test(p.nim)) bad(where, 'nim must be 6 to 20 digits');
      else if (seen.has(p.nim)) bad(where, 'a nim that is already on the list');
      seen.add(p.nim);
      const name = cleanName(p.name);
      if (!name) bad(where, "name must be 2 to 80 letters, spaces and . ' -");
      if (p.grp !== undefined && (typeof p.grp !== 'string' || p.grp.length > 20 || UNSAFE.test(p.grp))) bad(where, 'grp must be short text');
      if (p.blocked !== undefined && typeof p.blocked !== 'boolean') bad(where, 'blocked must be true or false');
      people.push({ nim: p.nim, name, grp: p.grp ?? '', ...(p.blocked ? { blocked: true } : {}) });
    });
  }
}

// ---------- the banks

function checkPicture(p, where, bankId, pics) {
  if (!isObj(p)) return bad(where, 'not an object');
  onlyKeys(p, ['id', 'f', 'w', 'h', 'type'], where);
  const idOk = typeof p.id === 'string' && IMG_ID.test(p.id);
  if (!idOk) bad(where, 'id must be 1 to 16 lowercase letters or digits');
  for (const k of ['w', 'h']) if (!Number.isInteger(p[k]) || p[k] < 1 || p[k] > 10000) bad(where, `${k} must be the size in pixels`);
  const ext = Object.keys(TYPES).find((x) => TYPES[x] === p.type);
  if (!ext) bad(where, `type must be one of ${Object.values(TYPES).join(', ')}`);
  if (p.f !== undefined && typeof p.f !== 'string') return bad(where, 'f must be a path in the private folder');
  const rel = p.f || (idOk && ext ? `img/${bankId}/${p.id}.${ext}` : '');
  if (!rel) return;
  if (isAbsolute(rel) || rel.includes('\\') || rel.split('/').includes('..') || !inside(dir, resolve(dir, rel))) return bad(where, `${rel} must be a path inside the private folder`);
  const abs = resolve(dir, rel);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return bad(where, `${rel} is missing`);
  }
  if (!st.isFile() || st.size > MAX_BYTES) return bad(where, `${rel} must be a picture file of at most 5.8 MB`);
  const bytes = new Uint8Array(readFileSync(abs));
  if (ext && sniff(bytes) !== ext) bad(where, `${rel} is not a ${p.type} file`);
  const before = pics.get(p.id);
  if (before && before.abs !== abs) bad(where, `picture id ${p.id} is used for two different files`);
  if (idOk && !before) pics.set(p.id, { abs, bytes });
}

function checkBank(file) {
  const where = `banks/${file}`;
  const id = file.slice(0, -'.json'.length);
  if (!BANK_ID.test(id)) return bad(where, 'name the file <bank id>.json: a-z, then up to 11 more a-z or 0-9');
  const b = readJson(join(dir, 'banks', file), where);
  if (b === undefined) return;
  if (!isObj(b)) return bad(where, 'not a JSON object');
  onlyKeys(b, ['id', 'kv', 'new', 'name', 'title', 'sem', 'by', 'refs', 'topics', 'q'], where);
  if (b.id !== id) bad(where, `id must be "${id}", like the file name`);
  const kv = b.kv ?? 1;
  if (!Number.isInteger(kv) || kv < 1 || kv > 9999) bad(where, 'kv must be a whole number from 1');
  if (b.new !== undefined && typeof b.new !== 'boolean') bad(where, 'new must be true or false');
  text(b.name, where, 'name', { max: 120 });
  text(b.title, where, 'title', { max: 120 });
  text(b.sem, where, 'sem', { max: 120 });
  text(b.by, where, 'by', { max: 120, optional: true });
  if (b.refs !== undefined) {
    if (!Array.isArray(b.refs) || b.refs.length > 50) bad(where, 'refs must be a list of at most 50');
    else
      b.refs.forEach((r, i) => {
        const w = `${where} refs[${i}]`;
        if (!isObj(r)) return bad(w, 'not an object');
        onlyKeys(r, ['name', 'url'], w);
        text(r.name, w, 'name');
        let u = null;
        try {
          u = new URL(r.url);
        } catch {}
        if (!u || u.protocol !== 'https:' || u.username || u.password || r.url.length > 500) bad(w, 'url must be an https link');
      });
  }
  const topics = isObj(b.topics) && Object.keys(b.topics).length && Object.keys(b.topics).length <= 100 ? b.topics : null;
  if (!topics) bad(where, 'topics must map 1 to 100 keys to labels');
  else
    for (const [k, v] of Object.entries(topics)) {
      if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(k)) bad(where, `topic key "${k}" must be lowercase letters, digits, _ or -`);
      text(v, where, `topic ${k}`, { max: 80 });
    }
  if (!Array.isArray(b.q) || !b.q.length || b.q.length > 5000) return bad(where, 'q must be a list of questions');
  const ids = new Set();
  const pics = new Map();
  b.q.forEach((q, i) => {
    const w = `${where} q[${i}]${typeof q?.id === 'string' ? ` (${q.id})` : ''}`;
    if (!isObj(q)) return bad(w, 'not an object');
    onlyKeys(q, ['id', 't', 'tp', 'q', 'o', 'a', 'e', 'n', 'ns', 'img', 'ei', 'src'], w);
    if (typeof q.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(q.id)) bad(w, 'id must be letters, digits, _ or -');
    else if (ids.has(q.id)) bad(w, 'an id already used in this bank');
    ids.add(q.id);
    if (q.t !== 'mc' && q.t !== 'tf') bad(w, 't must be "mc" or "tf"');
    if (!topics || typeof q.tp !== 'string' || !Object.hasOwn(topics, q.tp)) bad(w, 'tp must be one of the topic keys');
    text(q.q, w, 'q', { max: 10000 });
    const n = Array.isArray(q.o) ? q.o.length : 0;
    if (!Array.isArray(q.o)) bad(w, 'o must be a list of options');
    else {
      if (q.t === 'tf' && n !== 2) bad(w, 'a tf question has 2 options');
      if (q.t === 'mc' && (n < 4 || n > 5)) bad(w, 'an mc question has 4 or 5 options');
      q.o.forEach((o, j) => text(o, w, `o[${j}]`, { max: 2000 }));
    }
    if (!Array.isArray(q.a) || !q.a.length || q.a.some((x) => !Number.isInteger(x) || x < 0 || x >= n) || new Set(q.a).size !== q.a.length) {
      bad(w, 'a must list the right options by index, each once');
    }
    text(q.e, w, 'e', { max: 10000 });
    text(q.n, w, 'n', { max: 5000, optional: true });
    if (q.ns !== undefined && q.ns !== 1 && q.ns !== true) bad(w, 'ns must be 1');
    text(q.src, w, 'src', { max: 500, optional: true });
    for (const field of ['img', 'ei']) {
      if (q[field] === undefined) continue;
      if (!Array.isArray(q[field]) || !q[field].length || q[field].length > 10) bad(w, `${field} must be a list of 1 to 10 pictures`);
      else q[field].forEach((p, j) => checkPicture(p, `${w} ${field}[${j}]`, id, pics));
    }
  });
  return { id, kv, bank: b, pics };
}

// Only <bank id>.json is a bank; the folder may also hold working files, which are named and skipped.
const bankFiles = [];
for (const f of existsSync(join(dir, 'banks')) ? readdirSync(join(dir, 'banks')).sort() : []) {
  if (!f.endsWith('.json')) continue;
  if (BANK_ID.test(f.slice(0, -'.json'.length))) bankFiles.push(f);
  else console.log(`banks/${f}: not named <bank id>.json, so not a bank; skipped`);
}
const banks = bankFiles.map(checkBank).filter(Boolean);

if (problems.length) fail(`Nothing written. Fix these first:\n  ${problems.join('\n  ')}`);

// ---------- seal

// b2 before b10
function byId(a, b) {
  const x = a.id.match(/\d+|\D+/g);
  const y = b.id.match(/\d+|\D+/g);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (/^\d/.test(x[i]) && /^\d/.test(y[i]) && Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
    return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length;
}

const files = new Map(); // name in public/cbt -> sealed bytes
const manifest = [];
const versions = [];
for (const { id, kv, bank, pics } of banks.sort(byId)) {
  const key = await derive(master, LABEL.bankKey(id, kv));
  const ivKey = await derive(master, LABEL.bankIv(id, kv));
  const paths = new Map();
  for (const [img, { bytes }] of pics) {
    const sealed = await seal(key, ivKey, bytes, LABEL.imgAad(id, kv, img));
    const name = `${id}-${img}.${await hashHex(sealed)}.bin`;
    files.set(name, sealed);
    paths.set(img, '/cbt/' + name);
  }
  // kv and new are how to build it, not part of the bank
  const { kv: _kv, new: isNew, ...content } = bank;
  for (const q of content.q) for (const f of ['img', 'ei']) if (q[f]) q[f] = q[f].map((p) => ({ ...p, f: paths.get(p.id) }));
  const sealed = await seal(key, ivKey, JSON.stringify(content), LABEL.bankAad(id, kv));
  if (!isDeepStrictEqual(await openJson(key, sealed, LABEL.bankAad(id, kv)), content)) fail(`${id}: the sealed bank does not open to the same content`);
  const name = `${id}.${await hashHex(sealed)}.bin`;
  files.set(name, sealed);
  manifest.push({
    id, kv, name: content.name, title: content.title, sem: content.sem, n: content.q.length, topics: Object.keys(content.topics).length,
    file: '/cbt/' + name, bytes: sealed.length, ...(content.by ? { by: content.by } : {}), ...(isNew ? { new: true } : {}),
  });
  versions.push({ id, kv, pictures: pics.size });
}
const roster = await seal(await derive(master, LABEL.rosterKey), await derive(master, LABEL.rosterIv), JSON.stringify({ v: 1, people }), LABEL.rosterAad);

// ---------- write, only what changed

let written = 0;
let unchanged = 0;
function put(path, data) {
  const bytes = Buffer.from(data);
  try {
    if (readFileSync(path).equals(bytes)) return unchanged++;
  } catch {}
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  written++;
}
const pub = join(out, 'public/cbt');
for (const [name, bytes] of files) put(join(pub, name), bytes);
put(join(out, 'src/data/cbt.json'), JSON.stringify({ v: 1, banks: manifest }, null, 2) + '\n');
put(
  join(out, 'netlify/data/cbt.mjs'),
  `// Written by scripts/cbt/seal.mjs (npm run cbt:seal): the sealed class list and the version of
// every bank, for netlify/functions/cbt.mjs. Generated; do not edit by hand.
export const ROSTER = '${toB64u(roster)}';
export const BANKS = [${versions.map((b) => `{ id: '${b.id}', kv: ${b.kv} }`).join(', ')}];
`,
);
let removed = 0;
const SEALED = /^[a-z][a-z0-9]{0,11}(?:-[a-z0-9]{1,16})?\.[0-9a-f]{10}\.bin$/;
for (const name of existsSync(pub) ? readdirSync(pub) : []) {
  if (files.has(name)) continue;
  if (SEALED.test(name)) {
    unlinkSync(join(pub, name));
    removed++;
  } else console.warn(`public/cbt/${name}: not a sealed file, left alone`);
}

console.log(`class list: ${people.length} people, ${people.filter((p) => p.blocked).length} closed by default`);
for (const [i, b] of manifest.entries()) console.log(`${b.id} v${b.kv}: ${b.n} questions, ${b.topics} topics, ${versions[i].pictures} pictures, ${b.bytes} bytes, ${b.file}`);
if (!manifest.length) console.log('no banks in banks/');
console.log(`files: ${written} written, ${unchanged} unchanged, ${removed} removed`);
