// Tests for src/lib/validate.js.
// Run: node --test tests/validate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, validateJsonText, normalizePhone, HEART_IDS, MAX_JSON_BYTES } from '../src/lib/validate.js';

const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const FILES = {
  links: 'src/data/links.json',
  announcements: 'src/data/announcements.json',
  schedule: 'src/data/schedule.json',
  dosen: 'src/data/dosen.json',
  heart: 'src/data/heart-parts.json',
};
const paths = (r) => r.errors.map((e) => e.path.join('.'));

test('every bundled file passes and comes back unchanged', () => {
  for (const [key, file] of Object.entries(FILES)) {
    const raw = read(file);
    const r = validate(key, raw);
    assert.equal(r.ok, true, `${key}: ${JSON.stringify(r.errors.slice(0, 3))}`);
    assert.equal(JSON.stringify(r.data), JSON.stringify(raw), `${key} changed on a round trip`);
  }
});

test('HEART_IDS matches the bundled parts and the 3D model metadata', () => {
  const parts = read(FILES.heart).parts.map((p) => p.id);
  assert.deepEqual(parts, HEART_IDS);
  const meta = read('public/models/heart-meta.json');
  assert.deepEqual(Object.keys(meta.anchors).sort(), [...HEART_IDS].filter((x) => x !== 'heart').sort());
});

test('non-objects and unknown keys fail cleanly', () => {
  for (const v of [null, 42, 'x', [], undefined]) {
    assert.equal(validate('links', v).ok, false);
  }
  assert.equal(validate('nope', {}).ok, false);
  assert.equal(validate('links', { v: 2, channels: [] }).ok, false);
});

test('links: https only, warns on non-Drive hosts, drops unknown fields', () => {
  const base = read(FILES.links);
  const bad = structuredClone(base);
  bad.channels[1].url = 'http://drive.google.com/x';
  bad.channels[3].url = 'javascript:alert(1)';
  bad.channels[4].url = 'https://user:pw@drive.google.com/x';
  let r = validate('links', bad);
  assert.equal(r.ok, false);
  assert.deepEqual(paths(r), ['channels.1.url', 'channels.3.url', 'channels.4.url']);

  const odd = structuredClone(base);
  odd.channels[1].url = 'https://example.com/folder';
  odd.channels[1].onclick = 'x';
  odd.extra = true;
  r = validate('links', odd);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.path.join('.') === 'channels.1.url'));
  assert.equal('onclick' in r.data.channels[1], false);
  assert.equal('extra' in r.data, false);
});

test('links: tryout channel never carries a url; ids are unique and well formed', () => {
  const d = read(FILES.links);
  d.channels[2].url = 'https://evil.example';
  let r = validate('links', d);
  assert.equal(r.ok, true);
  assert.equal('url' in r.data.channels[2], false);

  const dup = read(FILES.links);
  dup.channels[1].id = 'lobby';
  assert.deepEqual(paths(validate('links', dup)), ['channels.1.id']);

  const badId = read(FILES.links);
  badId.channels[0].id = 'Lobby Utama';
  assert.equal(validate('links', badId).ok, false);
});

test('text is cleaned: control and bidi characters removed, length capped', () => {
  const d = read(FILES.links);
  d.channels[0].name = '  Main‮ Lobby\u0000 ';
  d.channels[0].sub = 'x'.repeat(500);
  const r = validate('links', d);
  assert.equal(r.ok, true);
  assert.equal(r.data.channels[0].name, 'Main Lobby');
  assert.equal(r.data.channels[0].sub.length, 240);
  assert.ok(r.warnings.some((w) => w.path.join('.') === 'channels.0.sub'));
});

const ann = (over = {}) => ({ id: 'p-1', title: 'Kumpul laporan', body: 'Baris 1\r\nBaris 2', tag: 'deadline', date: '2026-10-01', due: '2026-10-05T23:59', ...over });

test('announcements: valid item keeps line breaks and optional fields', () => {
  const r = validate('announcements', { v: 1, items: [ann({ link: 'https://forms.gle/abc', pinned: true, until: '2026-10-06' })] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.items[0], {
    id: 'p-1', title: 'Kumpul laporan', body: 'Baris 1\nBaris 2', tag: 'deadline', date: '2026-10-01',
    due: '2026-10-05T23:59', link: 'https://forms.gle/abc', pinned: true, until: '2026-10-06',
  });
});

test('announcements: bad tag, date, due and link are errors', () => {
  const r = validate('announcements', {
    v: 1,
    items: [ann({ tag: 'promo' }), ann({ id: 'p-2', date: '2026-02-30' }), ann({ id: 'p-3', due: '2026-10-05 23:59' }), ann({ id: 'p-4', link: 'data:text/html,hi' })],
  });
  assert.deepEqual(paths(r), ['items.0.tag', 'items.1.date', 'items.2.due', 'items.3.link']);
});

test('announcements: deadline without due and until before date are warnings', () => {
  const r = validate('announcements', { v: 1, items: [ann({ due: undefined, until: '2026-09-01' })] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings.map((w) => w.path.join('.')).sort(), ['items.0.due', 'items.0.until']);
});

test('announcements: pinned must be a real boolean', () => {
  const r = validate('announcements', { v: 1, items: [ann({ pinned: 'yes' })] });
  assert.deepEqual(paths(r), ['items.0.pinned']);
});

test('schedule: end must be after start; open end (null) is fine', () => {
  const d = read(FILES.schedule);
  d.bloks[0].days[0].s[0].e = '07:00';
  let r = validate('schedule', d);
  assert.deepEqual(paths(r), ['bloks.0.days.0.s.0.e']);

  const ok = read(FILES.schedule);
  ok.bloks[0].days[0].s[0].e = null;
  r = validate('schedule', ok);
  assert.equal(r.ok, true);
  assert.equal(r.data.bloks[0].days[0].s[0].e, null);
});

test('schedule: invalid times, kinds and unknown lecturer codes are errors', () => {
  const d = read(FILES.schedule);
  d.bloks[0].days[0].s[0].s = '24:00';
  d.bloks[0].days[0].s[1].k = 'nongkrong';
  d.bloks[0].days[0].s[2].dz = ['ZZZ'];
  const r = validate('schedule', d);
  assert.deepEqual(paths(r), ['bloks.0.days.0.s.0.s', 'bloks.0.days.0.s.1.k', 'bloks.0.days.0.s.2.dz.0']);
});

test('schedule: overlaps warn, sessions and days get sorted', () => {
  const d = read(FILES.schedule);
  const day = d.bloks[0].days[0];
  day.s.push({ s: '07:00', e: '07:30', t: 'Apel pagi', k: 'intro', dz: [] });
  day.s.push({ s: '08:10', e: '08:40', t: 'Bentrok', k: 'kuliah', dz: [] });
  d.bloks[0].days.reverse();
  const r = validate('schedule', d);
  assert.equal(r.ok, true);
  assert.equal(r.data.bloks[0].days[0].d, '2026-08-18');
  assert.equal(r.data.bloks[0].days[0].s[0].t, 'Apel pagi');
  assert.ok(r.warnings.some((w) => /Bentrok/.test(w.msg)));
});

test('schedule: duplicate days, bad codes and a blok ending before it starts are errors', () => {
  const d = read(FILES.schedule);
  d.bloks[0].days[1].d = d.bloks[0].days[0].d;
  d.bloks[1].codes.bad = 'fatmawati';
  d.bloks[2].end = '2026-01-01';
  const r = validate('schedule', d);
  assert.deepEqual(paths(r).sort(), ['bloks.0.days.1.d', 'bloks.1.codes.bad', 'bloks.2.end'].sort());
});

test('dosen: phones are rebuilt from n, so wa can not point elsewhere', () => {
  const d = read(FILES.dosen);
  d.list[0].phones = [{ n: '081271781602', f: 'call me', wa: '6289999999999' }];
  const r = validate('dosen', d);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.list[0].phones[0], { n: '081271781602', f: '0812-7178-1602', wa: '6281271781602' });
});

test('dosen: unrecognised phone, duplicate id are errors; duplicate phones collapse', () => {
  const d = read(FILES.dosen);
  d.list[0].phones = [{ n: '12' }];
  d.list[2].id = d.list[1].id;
  d.list[3].phones = [{ n: '08127106830' }, { n: '+62 812-7106-830' }];
  const r = validate('dosen', d);
  assert.deepEqual(paths(r).sort(), ['list.0.phones.0', 'list.2.id'].sort());
});

test('normalizePhone handles the usual ways people type numbers', () => {
  const cases = [
    ['0812-7178-1602', '081271781602', '0812-7178-1602', '6281271781602'],
    ['+62 812 7178 1602', '081271781602', '0812-7178-1602', '6281271781602'],
    ['6281271781602', '081271781602', '0812-7178-1602', '6281271781602'],
    ['812 7178 1602', '081271781602', '0812-7178-1602', '6281271781602'],
    ['08127800768', '08127800768', '0812-7800-768', '628127800768'],
    ['0895619813555', '0895619813555', '0895-6198-13555', '62895619813555'],
    ['(0711) 7069202', '07117069202', '0711-7069202', ''],
    ['354088', '0711354088', '0711-354088', ''],
    ['+62 711 354088', '0711354088', '0711-354088', ''],
    ['021 5551234', '0215551234', '021-5551234', ''],
  ];
  for (const [input, n, f, wa] of cases) assert.deepEqual(normalizePhone(input), { n, f, wa }, input);
  for (const bad of ['', '123', 'abc', '0812', '08123456789012345']) assert.equal(normalizePhone(bad), null, bad);
});

test('normalizePhone reproduces every number in the bundled list', () => {
  for (const p of read(FILES.dosen).list) for (const ph of p.phones) assert.deepEqual(normalizePhone(ph.n), ph);
});

test('heart: ids are fixed; unknown, missing and duplicate ids fail', () => {
  const extra = read(FILES.heart);
  extra.parts[1].id = 'not_in_model';
  assert.equal(validate('heart', extra).ok, false);

  const missing = read(FILES.heart);
  missing.parts.pop();
  const r = validate('heart', missing);
  assert.equal(r.ok, false);
  assert.match(r.errors[0].msg, /purk/);

  const related = read(FILES.heart);
  related.parts[0].related = ['ra', 'xx'];
  assert.deepEqual(paths(validate('heart', related)), ['parts.0.related.1']);
});

test('heart: group can not be changed to something unknown', () => {
  const d = read(FILES.heart);
  d.parts[3].group = 'lainnya';
  assert.deepEqual(paths(validate('heart', d)), ['parts.3.group']);
});

test('validateJsonText reports syntax errors with a line and size limits', () => {
  let r = validateJsonText('links', '{\n  "v": 1,\n  "channels": [\n    {"id": "a",}\n  ]\n}');
  assert.equal(r.ok, false);
  assert.match(r.errors[0].msg, /JSON tidak valid/);
  r = validateJsonText('links', JSON.stringify({ v: 1, channels: [], pad: 'x'.repeat(MAX_JSON_BYTES) }));
  assert.equal(r.ok, false);
  assert.match(r.errors[0].msg, /Terlalu besar/);
  r = validateJsonText('links', JSON.stringify(read(FILES.links)));
  assert.equal(r.ok, true);
});

test('oversized lists are rejected, not truncated', () => {
  const d = { v: 1, items: Array.from({ length: 101 }, (_, i) => ann({ id: `p-${i}` })) };
  assert.equal(validate('announcements', d).ok, false);
});

test('a validator never throws, even on hostile shapes', () => {
  const weird = [
    { v: 1, channels: [null, 1, 'x', [], { id: {} }] },
    { v: 1, items: [{ toString: 1 }, { id: 'a', title: { length: 9e9 } }] },
    { v: 1, bloks: [{ id: 'b1', name: 'x', start: '2026-01-01', end: '2026-01-02', codes: [], days: [{ d: 1, s: 'x' }] }] },
    { v: 1, list: [{ id: 'a', name: 'b', phones: [{ n: { a: 1 } }], codes: 'x' }] },
    { v: 1, parts: [{ id: '__proto__' }] },
  ];
  const keys = ['links', 'announcements', 'schedule', 'dosen', 'heart'];
  weird.forEach((w, i) => {
    const r = validate(keys[i], w);
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  });
});
