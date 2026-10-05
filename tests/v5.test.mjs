// Tests for what v5 added: page texts, divisi and photos in the links document, cancelled
// sessions (model and calendar export), the editor's metadata stripping, and the media
// functions' token check and file sniffing.
// Run: node --test tests/v5.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { validate } from '../src/lib/validate.js';
import { createModel } from '../src/lib/schedule-model.js';
import { sessionCalendar } from '../src/lib/ics.js';
import { createContentStore } from '../src/lib/content.js';

const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const links = read('src/data/links.json');
const divisi = read('src/data/divisi.json');
const photo = divisi.items[0].photos[0];

// ---------- links: site texts, divisi, photos

test('bundled divisi and class photo pass inside the links document', () => {
  const r = validate('links', { ...links, divisi: divisi.items, site: { t: { 'hero.lede': 'Halo' }, photo: read('src/data/kelas.json') } });
  assert.equal(r.ok, true, JSON.stringify(r.errors.slice(0, 3)));
  assert.equal(r.data.divisi.length, 8);
  assert.deepEqual(r.data.divisi.map((d) => d.id), ['bph', 'batu', 'didis', 'jarkom', 'medinfo', 'pleno', 'praktikum', 'solid']);
});

test('a links document without site or divisi stays as it was', () => {
  const r = validate('links', links);
  assert.equal(r.ok, true);
  assert.equal('divisi' in r.data, false);
  assert.equal('site' in r.data, false);
});

test('photos must come from this site', () => {
  for (const src of ['https://evil.example/x.jpg', '//evil.example/x.jpg', '/media/../admin/index.html', '/img/a/../../x.jpg', 'javascript:alert(1)', '/uploads/x.jpg', '/media/.hidden']) {
    const r = validate('links', { ...links, divisi: [{ id: 'x', name: 'X', photos: [{ ...photo, src }] }] });
    assert.equal(r.ok, false, src);
  }
  const bad = validate('links', { ...links, divisi: [{ id: 'x', name: 'X', photos: [{ ...photo, set: [['https://cdn.example/a.webp', 640]] }] }] });
  assert.equal(bad.ok, false, 'srcset entries are checked too');
});

test('a broken preview or colour is dropped with a warning, not an error', () => {
  const r = validate('links', { ...links, divisi: [{ id: 'x', name: 'X', photos: [{ ...photo, lq: 'data:text/html;base64,PHNjcmlwdD4=', bg: 'red' }] }] });
  assert.equal(r.ok, true);
  assert.equal('lq' in r.data.divisi[0].photos[0], false);
  assert.equal('bg' in r.data.divisi[0].photos[0], false);
  assert.equal(r.warnings.length, 2);
});

test('page text keys and values', () => {
  const ok = validate('links', { ...links, site: { t: { 'hero.lede': '  dua\n\n\n\nbaris  ', 'siklus.cap0.k': 'P' } } });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.site.t['hero.lede'], 'dua\n\nbaris', 'trimmed, runs of blank lines folded');
  assert.equal(validate('links', { ...links, site: { t: { 'Hero Lede': 'x' } } }).ok, false, 'keys are lowercase dotted names');
  assert.equal(validate('links', { ...links, site: { t: { '__proto__.x': 'x' } } }).ok, false);
  const many = Object.fromEntries(Array.from({ length: 601 }, (_, i) => ['k' + i, 'x']));
  assert.equal(validate('links', { ...links, site: { t: many } }).ok, false, 'at most 600 texts');
});

test('control characters and bidi overrides are removed from page texts', () => {
  const r = validate('links', { ...links, site: { t: { 'foot.credit': 'Made‮ with\u0007 love' } } });
  assert.equal(r.data.site.t['foot.credit'], 'Made with love');
});

// ---------- cancelled sessions

const schedule = read('src/data/schedule.json');
const dosen = read('src/data/dosen.json');
function withCancelled(date, index, reason) {
  const s = structuredClone(schedule);
  for (const b of s.bloks) for (const d of b.days) if (d.d === date) { d.s[index].batal = true; if (reason) d.s[index].alasan = reason; }
  return s;
}

test('batal and alasan validate; alasan without batal is dropped', () => {
  const s = withCancelled('2026-10-05', 1, 'Dosen dinas luar');
  const r = validate('schedule', s);
  assert.equal(r.ok, true);
  const day = r.data.bloks.flatMap((b) => b.days).find((d) => d.d === '2026-10-05');
  assert.equal(day.s[1].batal, true);
  assert.equal(day.s[1].alasan, 'Dosen dinas luar');
  const s2 = structuredClone(schedule);
  s2.bloks[2].days[0].s[0].alasan = 'tanpa batal';
  const r2 = validate('schedule', s2);
  assert.equal('alasan' in r2.data.bloks[2].days[0].s[0], false);
});

test('a cancelled session is never "now" or "next" and never the next exam', () => {
  const s = withCancelled('2026-10-05', 1, 'x');
  const m = createModel(s, dosen);
  const t = Date.parse('2026-10-05T10:45:00+07:00'); // inside the 10.30 session
  const { running, next } = m.nowAndNext(t);
  assert.equal(running.length, 0, 'the cancelled 10.30 session is not running');
  assert.equal(next.start, '13:00');
  const cancelled = m.sessionsOn('2026-10-05')[1];
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.cancelReason, 'x');
  assert.deepEqual(cancelled.ref, { blokId: 'b3', date: '2026-10-05', index: 1 });
  // the exam countdown skips a cancelled exam
  const ex = structuredClone(schedule);
  const first = createModel(ex, dosen).nextUjian(t);
  for (const b of ex.bloks) for (const d of b.days) for (const x of d.s) if (d.d === first.date && x.t === first.title) x.batal = true;
  const after = createModel(ex, dosen).nextUjian(t);
  assert.ok(!after || after.uid !== first.uid);
});

test('calendar export marks a cancelled session', () => {
  const m = createModel(withCancelled('2026-10-05', 1, 'Dosen dinas luar'), dosen);
  const ics = sessionCalendar(m.sessionsOn('2026-10-05')[1], { stamp: 0 });
  assert.match(ics, /STATUS:CANCELLED/);
  assert.match(ics, /SUMMARY:DIBATALKAN: /);
  assert.match(ics.replace(/\r\n /g, ''), /dibatalkan: Dosen dinas luar/);
});

// ---------- content layer: drafts from the editor

test('inject shows a draft to subscribers and load, and null goes back', async () => {
  const bundled = { links: async () => ({ default: links }) };
  const store = createContentStore({ config: null, bundled, storage: { get: () => null, set() {}, remove() {} } });
  const first = await store.load('links');
  const seen = [];
  store.subscribe('links', (d) => seen.push(d), first);
  const draft = { ...links, site: { t: { 'hero.kick': 'Draf' } } };
  await store.inject('links', draft);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].site.t['hero.kick'], 'Draf');
  assert.equal((await store.load('links')).site.t['hero.kick'], 'Draf');
  await store.inject('links', null);
  assert.equal(seen.length, 2);
  assert.equal('site' in seen[1], false);
});

// ---------- the editor's metadata stripping (pure byte work, no DOM needed)

const { _test: strip } = await import('../src/edit/media.js');

function seg(marker, payload) {
  const len = payload.length + 2;
  return Uint8Array.from([0xff, marker, len >> 8, len & 255, ...payload]);
}
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
function exifWithOrientation(o) {
  // "Exif\0\0" + little-endian TIFF header + one IFD entry (0x0112 orientation)
  const tiff = [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0];
  return seg(0xe1, [...ascii('Exif'), 0, 0, ...tiff]);
}
function jpeg(...segs) {
  const sos = Uint8Array.from([0xff, 0xda, 0, 8, 1, 2, 3, 4, 5, 6, 0x11, 0x22, 0xff, 0xd9]);
  const parts = [Uint8Array.from([0xff, 0xd8]), ...segs, sos];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('JPEG: EXIF, XMP, IPTC and comments go; JFIF, colour profile and image data stay', () => {
  const jfif = seg(0xe0, ascii('JFIF\0'));
  const icc = seg(0xe2, ascii('ICC_PROFILE\0data'));
  const xmp = seg(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:gps/>'));
  const iptc = seg(0xed, ascii('Photoshop 3.0'));
  const com = seg(0xfe, ascii('shot by camera serial 123'));
  const input = jpeg(jfif, exifWithOrientation(1), xmp, icc, iptc, com);
  const out = strip.stripJpeg(input);
  const expected = jpeg(jfif, icc);
  assert.deepEqual([...out], [...expected]);
  assert.equal(strip.kindOf(out), 'jpg');
});

test('JPEG orientation is read so rotated phone photos get re-encoded instead', () => {
  assert.equal(strip.jpegOrientation(jpeg(exifWithOrientation(6))), 6);
  assert.equal(strip.jpegOrientation(jpeg(exifWithOrientation(1))), 1);
  assert.equal(strip.jpegOrientation(jpeg(seg(0xe0, ascii('JFIF\0')))), 1, 'no EXIF means upright');
});

test('PNG text and EXIF chunks go, image chunks stay', () => {
  const chunk = (type, data) => {
    const len = data.length;
    return Uint8Array.from([len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...ascii(type), ...data, 0, 0, 0, 0]);
  };
  const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]), chunk('tEXt', ascii('Author\0me')), chunk('eXIf', [1, 2, 3]), chunk('IDAT', [9, 9]), chunk('IEND', [])];
  const all = (ps) => { const o = new Uint8Array(ps.reduce((s, p) => s + p.length, 0)); let i = 0; for (const p of ps) { o.set(p, i); i += p.length; } return o; };
  const out = strip.stripPng(all(parts));
  assert.deepEqual([...out], [...all([parts[0], parts[1], parts[4], parts[5]])]);
});

test('WebP EXIF and XMP chunks go and the VP8X flags are cleared', () => {
  const ch = (type, data) => { const len = data.length; const pad = len & 1 ? [0] : []; return [...ascii(type), len & 255, (len >> 8) & 255, 0, 0, ...data, ...pad]; };
  const vp8x = ch('VP8X', [0x08 | 0x04 | 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const body = [...ascii('WEBP'), ...vp8x, ...ch('VP8 ', [1, 2, 3, 4]), ...ch('EXIF', [5, 6, 7]), ...ch('XMP ', [8, 9])];
  const len = body.length;
  const input = Uint8Array.from([...ascii('RIFF'), len & 255, (len >> 8) & 255, 0, 0, ...body]);
  const out = strip.stripWebp(input);
  assert.equal(strip.kindOf(out), 'webp');
  const text = String.fromCharCode(...out);
  assert.equal(text.includes('EXIF'), false);
  assert.equal(text.includes('XMP '), false);
  assert.equal(out[20] & 0x0c, 0, 'EXIF and XMP flags off');
  assert.equal(out[20] & 0x10, 0x10, 'other flags untouched');
  assert.equal(out[4] | (out[5] << 8), out.length - 8, 'RIFF size matches');
});

// ---------- media functions

const { verifyIdToken, AuthError } = await import('../netlify/lib/auth.mjs');
const { sniff, KEY_RE } = await import('../netlify/lib/media.mjs');

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('securetoken@system.gserviceaccount.com')) {
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=3600' } });
  }
  return realFetch(url, init);
};
const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function token(claims, { kid = 'k1', key = privateKey, alg = 'RS256' } = {}) {
  const head = b64u({ alg, kid, typ: 'JWT' }) + '.' + b64u(claims);
  const sig = createSign('RSA-SHA256').update(head).sign(key).toString('base64url');
  return head + '.' + sig;
}
const now = Math.floor(Date.now() / 1000);
const good = { aud: 'alphangers-1ba79', iss: 'https://securetoken.google.com/alphangers-1ba79', sub: 'uid123', iat: now - 10, exp: now + 3000, auth_time: now - 100, email_verified: true, firebase: { sign_in_provider: 'google.com' } };

test('a valid Firebase ID token passes', async () => {
  const c = await verifyIdToken(token(good));
  assert.equal(c.sub, 'uid123');
});

test('forged, expired, foreign and unverified tokens are refused', async () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const cases = {
    'wrong key': token(good, { key: other }),
    'unknown kid': token(good, { kid: 'nope' }),
    'alg none': b64u({ alg: 'none', kid: 'k1' }) + '.' + b64u(good) + '.',
    expired: token({ ...good, exp: now - 1 }),
    'other project': token({ ...good, aud: 'someone-else' }),
    'other issuer': token({ ...good, iss: 'https://securetoken.google.com/someone-else' }),
    'issued in the future': token({ ...good, iat: now + 3600 }),
    'email not verified': token({ ...good, email_verified: false }),
    'password sign-in': token({ ...good, firebase: { sign_in_provider: 'password' } }),
    'no subject': token({ ...good, sub: '' }),
    garbage: 'a.b.c',
  };
  for (const [name, t] of Object.entries(cases)) {
    await assert.rejects(verifyIdToken(t), AuthError, name);
  }
  // a tampered payload with the original signature
  const [h, , s] = token(good).split('.');
  await assert.rejects(verifyIdToken(h + '.' + b64u({ ...good, sub: 'attacker' }) + '.' + s), AuthError, 'tampered payload');
});

test('only real image files are accepted, and keys are content hashes', () => {
  assert.equal(sniff(new Uint8Array(readFileSync(new URL('../public/img/divisi/bph-1.jpg', import.meta.url)))), 'jpg');
  assert.equal(sniff(new Uint8Array(readFileSync(new URL('../public/img/kelas/alpha.webp', import.meta.url)))), 'webp');
  assert.equal(sniff(new Uint8Array(readFileSync(new URL('../public/img/divisi/bph-1-640.avif', import.meta.url)))), 'avif');
  assert.equal(sniff(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')), null);
  assert.equal(sniff(new TextEncoder().encode('<!doctype html><script>alert(1)</script>')), null);
  assert.equal(KEY_RE.test('0123456789abcdef01234567-1280.webp'), true);
  for (const k of ['../x.webp', '0123456789abcdef01234567-1280.svg', '0123456789abcdef01234567-1280.webp/x', 'x.webp']) assert.equal(KEY_RE.test(k), false, k);
});
