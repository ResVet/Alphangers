// Tests for bloks that ship after the admin published a copy (src/lib/bundled.js), the fields they
// rely on in the validator, and how the portal (content.js) and the editors (doc-state.js) use them.
// Run: node --test tests/bundled.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../src/lib/validate.js';
import { mergeSchedule, mergeDosen, mergeLinks, withBundled, isNewer } from '../src/lib/bundled.js';
import { createContentStore } from '../src/lib/content.js';
import { createModel } from '../src/lib/schedule-model.js';
import { DocState } from '../src/admin/doc-state.js';

const read = (f) => JSON.parse(readFileSync(new URL(`../src/data/${f}.json`, import.meta.url), 'utf8'));
const schedule = read('schedule');
const dosen = read('dosen');
const links = read('links');
const NEW = schedule.bloks.filter((b) => b.added).map((b) => b.id);

// What Firestore holds when the admin published before a blok shipped: the bloks without the new
// ones, no base, and an edit of the admin's own (a cancelled session in Blok 3).
function publishedBefore() {
  const s = structuredClone(schedule);
  s.bloks = s.bloks.filter((b) => !b.added);
  delete s.base;
  s.bloks[2].days[0].s[0].batal = true;
  s.bloks[2].days[0].s[0].alasan = 'Dosen dinas luar';
  return validate('schedule', s).data;
}
function dosenBefore() {
  const d = structuredClone(dosen);
  delete d.base;
  delete d.added;
  // the one lecturer new with Blok 4; everyone else was in the list already
  d.list = d.list.filter((p) => p.id !== 'rosada-dwi-iswari');
  for (const p of d.list) {
    p.bloks = p.bloks.filter((b) => !NEW.includes(b));
    for (const b of NEW) delete p.codes[b];
  }
  d.list.find((p) => p.id === 'wardiansah').phones = [{ n: '081200001111' }];
  return validate('dosen', d).data;
}

test('the shipped data marks Blok 4 as added and carries its base', () => {
  assert.deepEqual(NEW, ['b4']);
  assert.equal(schedule.base, schedule.bloks[3].added);
  assert.equal(dosen.base, schedule.base);
  assert.deepEqual(dosen.added, { b4: schedule.base });
  assert.match(schedule.base, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('validator: menyusul, base and added are kept; broken stamps are dropped with a warning only', () => {
  const s = structuredClone(schedule);
  const r = validate('schedule', s);
  assert.equal(r.ok, true);
  const cbt = r.data.bloks[3].days.find((d) => d.d === '2026-12-02').s[0];
  assert.equal(cbt.menyusul, true);
  assert.equal(r.data.base, schedule.base);
  assert.equal(r.data.bloks[3].added, schedule.base);
  s.base = 'kemarin';
  s.bloks[3].added = '2026-13-40T99:00:00Z';
  s.bloks[3].days[0].s[0].menyusul = false;
  const bad = validate('schedule', s);
  assert.equal(bad.ok, true, 'bookkeeping never blocks a save');
  assert.equal('base' in bad.data, false);
  assert.equal('added' in bad.data.bloks[3], false);
  assert.equal('menyusul' in bad.data.bloks[3].days[0].s[0], false);
  assert.ok(bad.warnings.some((w) => w.path.join('.') === 'base'));
  assert.ok(bad.warnings.some((w) => w.path.join('.') === 'bloks.3.added'));
  s.bloks[3].days[0].s[0].menyusul = 'ya';
  assert.equal(validate('schedule', s).ok, false, 'menyusul must be a real boolean');
  const d = structuredClone(dosen);
  d.added = { b4: d.base, 'Bad Id': d.base, b5: 'nope' };
  const rd = validate('dosen', d);
  assert.equal(rd.ok, true);
  assert.deepEqual(rd.data.added, { b4: d.base });
  assert.equal(rd.warnings.length, 2);
});

test('validator: a session without its time never warns about overlaps', () => {
  const s = structuredClone(schedule);
  const day = s.bloks[3].days.find((d) => d.d === '2026-12-02');
  day.s[0].e = '23:00';
  day.s.push({ s: '08:00', e: '10:00', t: 'Briefing', k: 'kuliah', dz: [] });
  const r = validate('schedule', s);
  assert.equal(r.warnings.filter((w) => /Bentrok/.test(w.msg) && w.path[1] === 3).length, 0);
});

test('isNewer compares real times; a missing base is older than anything', () => {
  assert.equal(isNewer('2026-10-22T02:00:00Z', undefined), true);
  assert.equal(isNewer('2026-10-22T02:00:00Z', '2026-10-22T01:59:59Z'), true);
  assert.equal(isNewer('2026-10-22T02:00:00Z', '2026-10-22T02:00:00Z'), false);
  assert.equal(isNewer(undefined, undefined), false);
  assert.equal(isNewer('nope', undefined), false);
});

test('schedule: a published copy without Blok 4 gets it, and keeps every edit of its own', () => {
  const remote = publishedBefore();
  const before = JSON.stringify(remote);
  const merged = withBundled('schedule', remote, schedule);
  assert.equal(JSON.stringify(remote), before, 'the published copy is not changed');
  assert.deepEqual(merged.bloks.map((b) => b.id), ['b1', 'b2', 'b3', 'b4']);
  assert.equal(merged.base, schedule.base);
  assert.equal(merged.bloks[2].days[0].s[0].batal, true);
  assert.equal(merged.bloks[2].days[0].s[0].alasan, 'Dosen dinas luar');
  assert.deepEqual(merged.bloks[3], schedule.bloks[3]);
  assert.equal(validate('schedule', merged).ok, true);
  assert.equal(JSON.stringify(validate('schedule', merged).data), JSON.stringify(merged), 'already in validated form');
});

test('schedule: nothing changes once the copy has taken the blok in, or when the admin has it', () => {
  const taken = withBundled('schedule', publishedBefore(), schedule);
  assert.equal(withBundled('schedule', taken, schedule), taken, 'same base: same object back');
  const deleted = { ...taken, bloks: taken.bloks.slice(0, 3) };
  assert.equal(withBundled('schedule', deleted, schedule), deleted, 'deleted after it was taken in: stays deleted');
  const own = publishedBefore();
  own.bloks.push({ ...structuredClone(schedule.bloks[3]), id: 'blok-4', days: [], codes: {} });
  delete own.bloks[3].added;
  assert.deepEqual(withBundled('schedule', own, schedule).bloks.map((b) => b.id), ['b1', 'b2', 'b3', 'blok-4'], 'overlapping dates: the admin\'s own blok stands');
  const sameId = publishedBefore();
  sameId.bloks.push({ ...structuredClone(schedule.bloks[3]), start: '2027-01-04', end: '2027-01-08', days: [], codes: {} });
  delete sameId.bloks[3].added;
  assert.equal(withBundled('schedule', sameId, schedule).bloks.filter((b) => b.id === 'b4').length, 1, 'same id: the admin\'s one');
  assert.equal(mergeSchedule(null, schedule), null);
  assert.equal(withBundled('links', { v: 1, channels: [] }, schedule).channels.length, 0, 'other keys pass through');
});

test('dosen: Blok 4 lecturers join an older published list without touching anything else', () => {
  const remote = dosenBefore();
  assert.equal(remote.list.some((p) => p.id === 'rosada-dwi-iswari'), false);
  const merged = withBundled('dosen', remote, dosen);
  assert.equal(merged.list.length, dosen.list.length);
  const rd = merged.list.find((p) => p.id === 'rosada-dwi-iswari');
  assert.deepEqual(rd.bloks, ['b4']);
  const war = merged.list.find((p) => p.id === 'wardiansah');
  assert.deepEqual(war.bloks, ['b4']);
  assert.deepEqual(war.codes, { b4: 'WAR' });
  assert.deepEqual(war.phones.map((x) => x.n), ['081200001111'], 'the admin\'s phone stays');
  const rsp = merged.list.find((p) => p.id === 'riana-sari-puspita');
  assert.deepEqual(rsp.bloks, ['b1', 'b4']);
  assert.deepEqual(rsp.codes, { b1: 'RSP', b4: 'RSP' });
  assert.equal(merged.base, dosen.base);
  assert.equal(withBundled('dosen', merged, dosen), merged);
  assert.equal(mergeDosen(remote, { ...dosen, base: undefined }), remote, 'a shipped list without base adds nothing');
  // every Blok 4 code resolves against the merged list
  const m = createModel(withBundled('schedule', publishedBefore(), schedule), merged);
  assert.ok(m.sessions.filter((s) => s.blokId === 'b4').every((s) => s.lecturers.every((l) => l.dosen)));
});

// ---------- the portal

function memoryStorage() {
  const m = new Map();
  return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k) };
}
const respond = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const firestoreDoc = (data, rev = 20, updateTime = '2026-10-22T00:45:10.945353Z') => ({ fields: { json: { stringValue: JSON.stringify(data) }, rev: { integerValue: String(rev) } }, updateTime });
const BUNDLED = { schedule: async () => ({ default: schedule }), dosen: async () => ({ default: dosen }), links: async () => ({ default: links }) };
const CONFIG = { apiKey: 'AIzaTestKeyTestKeyTestKey123', projectId: 'alphangers-test' };
const tick = () => new Promise((r) => setTimeout(r, 0));
const quiet = { warn() {}, error() {} };

test('portal: the published schedule shows with Blok 4, and the cache keeps it as published', async () => {
  const storage = memoryStorage();
  const published = publishedBefore();
  let answer;
  const gate = new Promise((r) => (answer = r));
  const store = createContentStore({ config: CONFIG, fetchImpl: () => gate, storage, bundled: BUNDLED, log: quiet });
  const first = await store.load('schedule');
  assert.deepEqual(first.bloks.map((b) => b.id), ['b1', 'b2', 'b3', 'b4'], 'bundled copy first');
  const got = [];
  store.subscribe('schedule', (d) => got.push(d), first);
  answer(respond(200, firestoreDoc(published)));
  await tick(); await tick(); await tick();
  assert.equal(got.length, 1, 'the published copy differs (a cancelled session), so it is delivered');
  assert.deepEqual(got[0].bloks.map((b) => b.id), ['b1', 'b2', 'b3', 'b4']);
  assert.equal(got[0].bloks[2].days[0].s[0].batal, true);
  const cached = JSON.parse(storage.get('alpha.c.v1.schedule'));
  assert.deepEqual(JSON.parse(cached.json).bloks.map((b) => b.id), ['b1', 'b2', 'b3'], 'cache holds what Firestore has');

  // next visit: the cached copy is shown merged right away; the server says unchanged
  const head = { fields: { rev: { integerValue: '20' } }, updateTime: '2026-10-22T00:45:10.945353Z' };
  const store2 = createContentStore({ config: CONFIG, fetchImpl: async () => respond(200, head), storage, bundled: BUNDLED, log: quiet });
  const again = await store2.load('schedule');
  assert.deepEqual(again.bloks.map((b) => b.id), ['b1', 'b2', 'b3', 'b4']);
  assert.equal(again.bloks[2].days[0].s[0].batal, true);
  const late = [];
  store2.subscribe('schedule', (d) => late.push(d), again);
  await tick(); await tick(); await tick();
  assert.equal(late.length, 0, 'an unchanged copy is not delivered twice');
});

test('portal: a published copy that already has Blok 4 shows exactly as published', async () => {
  const published = withBundled('schedule', publishedBefore(), schedule);
  published.bloks[3].days[0].s[0].batal = true;
  const store = createContentStore({ config: CONFIG, fetchImpl: async () => respond(200, firestoreDoc(published)), storage: memoryStorage(), bundled: BUNDLED, log: quiet });
  await store.load('schedule');
  const got = [];
  store.subscribe('schedule', (d) => got.push(d));
  await tick(); await tick(); await tick();
  assert.equal(got.at(-1).bloks[3].days[0].s[0].batal, true);
  assert.equal(got.at(-1).bloks.length, 4);
});

// ---------- the editors

test('editors: the base is the published copy plus Blok 4, not a draft, and saving keeps both', () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  try {
    const json = JSON.stringify(publishedBefore());
    // a draft from an earlier visit that only repeats what was published is not offered back
    mem.set('alpha.draft.v1.schedule', JSON.stringify({ baseRev: 20, at: Date.now(), json }));
    const doc = new DocState('schedule', schedule);
    doc.setBase({ exists: true, rev: 20, json, updatedAt: new Date(), updatedBy: 'admin' });
    assert.equal(doc.pending, null);
    assert.deepEqual(doc.base.data.bloks.map((b) => b.id), ['b1', 'b2', 'b3', 'b4']);
    assert.equal(doc.base.data.base, schedule.base);
    assert.equal(doc.dirty, false);
    assert.equal(doc.result.ok, true);
    // an edit in Blok 4, then the clean copy that would be saved
    doc.draft.bloks[3].days[0].s[1].batal = true;
    doc.refresh();
    assert.equal(doc.dirty, true);
    const saved = doc.clean();
    assert.equal(saved.base, schedule.base);
    assert.equal(saved.bloks[2].days[0].s[0].alasan, 'Dosen dinas luar');
    assert.equal(saved.bloks[3].days[0].s[1].batal, true);
    // after the save the base is what was saved, and it is not merged a second time
    doc.setBase({ exists: true, rev: 21, json: JSON.stringify(saved), updatedAt: new Date(), updatedBy: 'admin' });
    assert.equal(doc.dirty, false);
    assert.equal(doc.base.data.bloks.length, 4);
  } finally {
    delete globalThis.localStorage;
  }
});

// ---------- channels: the Try Out OSPE channel, shipped after the admin published the links

// What Firestore holds when the admin published the links before the channel shipped: no base, no
// OSPE channel, a renamed Drive channel and a page text of the admin's own.
function linksBefore() {
  const l = structuredClone(links);
  delete l.base;
  l.channels = l.channels.filter((c) => !c.added);
  l.channels.find((c) => c.id === 'quiz').name = 'Quiz Mingguan';
  l.site = { t: { 'to.note': 'Semangat!' } };
  return validate('links', l).data;
}

test('links: the shipped copy marks the OSPE channel as added and carries its base', () => {
  const ospe = links.channels.find((c) => c.kind === 'ospe');
  assert.equal(ospe.id, 'tryout-ospe');
  assert.equal(ospe.added, links.base);
  assert.equal(links.channels[links.channels.indexOf(ospe) - 1].id, 'tryout', 'shipped right after Try Out CBT');
  const r = validate('links', links);
  assert.equal(r.ok, true);
  assert.equal(r.data.base, links.base);
  assert.equal(r.data.channels.find((c) => c.id === 'tryout-ospe').added, ospe.added);
});

test('links: an older published copy gets the OSPE channel after Try Out CBT, and keeps its own edits', () => {
  const before = linksBefore();
  const merged = mergeLinks(before, links);
  assert.notEqual(merged, before);
  assert.deepEqual(merged.channels.map((c) => c.id), links.channels.map((c) => c.id));
  assert.equal(merged.base, links.base);
  assert.equal(merged.channels.find((c) => c.id === 'quiz').name, 'Quiz Mingguan');
  assert.deepEqual(merged.site, { t: { 'to.note': 'Semangat!' } });
  assert.equal(before.channels.some((c) => c.id === 'tryout-ospe'), false, 'inputs are never changed');
  assert.equal(validate('links', merged).ok, true);

  // the admin moved Try Out CBT to the top: the new channel follows it there
  const moved = structuredClone(before);
  moved.channels.unshift(...moved.channels.splice(moved.channels.findIndex((c) => c.id === 'tryout'), 1));
  assert.deepEqual(mergeLinks(moved, links).channels.slice(0, 2).map((c) => c.id), ['tryout', 'tryout-ospe']);
  // without Try Out CBT it follows the channel before that in the shipped list
  const gone = structuredClone(before);
  gone.channels = gone.channels.filter((c) => c.id !== 'tryout');
  const g = mergeLinks(gone, links).channels.map((c) => c.id);
  assert.equal(g[g.indexOf('tryout-ospe') - 1], 'batu');
});

test('links: nothing changes once the copy has the channel, has its id, or is newer', () => {
  const taken = mergeLinks(linksBefore(), links);
  assert.equal(mergeLinks(taken, links), taken, 'the merged copy carries the base');
  const own = linksBefore();
  own.channels.push({ id: 'tryout-ospe', name: 'Punya admin', tag: '', sub: '', url: '' });
  const r = mergeLinks(own, links);
  assert.equal(r.channels.filter((c) => c.id === 'tryout-ospe').length, 1);
  assert.equal(r.channels.find((c) => c.id === 'tryout-ospe').name, 'Punya admin');
  // the admin deleted the channel after a publish that took it in: it stays deleted
  const deleted = structuredClone(taken);
  deleted.channels = deleted.channels.filter((c) => c.id !== 'tryout-ospe');
  assert.equal(mergeLinks(deleted, links), deleted);
  assert.equal(withBundled('links', deleted, links), deleted);
});

test('links: the portal shows the published links with the OSPE channel', async () => {
  const published = linksBefore();
  const store = createContentStore({ config: CONFIG, fetchImpl: async () => respond(200, firestoreDoc(published)), storage: memoryStorage(), bundled: BUNDLED, log: quiet });
  await store.load('links');
  const got = [];
  store.subscribe('links', (d) => got.push(d));
  await tick(); await tick(); await tick();
  const last = got.at(-1);
  assert.deepEqual(last.channels.map((c) => c.id), links.channels.map((c) => c.id));
  assert.equal(last.channels.find((c) => c.id === 'quiz').name, 'Quiz Mingguan');
  assert.equal(last.site.t['to.note'], 'Semangat!');
});

test('links: the editors start from the published links plus the channel, and saving keeps it', () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  try {
    const doc = new DocState('links', links);
    doc.setBase({ exists: true, rev: 7, json: JSON.stringify(linksBefore()), updatedAt: new Date(), updatedBy: 'admin' });
    assert.equal(doc.dirty, false, 'the merge alone is not a draft change');
    assert.ok(doc.base.data.channels.some((c) => c.id === 'tryout-ospe'));
    doc.draft.channels.find((c) => c.id === 'quiz').tag = 'Kuis';
    doc.refresh();
    const saved = doc.clean();
    assert.equal(saved.base, links.base);
    assert.equal(saved.channels.find((c) => c.id === 'tryout-ospe').kind, 'ospe');
    assert.equal(saved.channels.find((c) => c.id === 'quiz').name, 'Quiz Mingguan');
  } finally {
    delete globalThis.localStorage;
  }
});
