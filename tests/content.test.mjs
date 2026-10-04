// Tests for src/lib/content.js with a mocked fetch and storage.
// Run: node --test tests/content.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContentStore, safeStorage } from '../src/lib/content.js';

const read = (f) => JSON.parse(readFileSync(new URL(`../src/data/${f}.json`, import.meta.url), 'utf8'));
const BUNDLED = {
  links: async () => ({ default: read('links') }),
  announcements: async () => ({ default: read('announcements') }),
  schedule: async () => ({ default: read('schedule') }),
  dosen: async () => ({ default: read('dosen') }),
  heart: async () => ({ default: read('heart-parts') }),
};
const CONFIG = { apiKey: 'AIzaTestKeyTestKeyTestKey123', projectId: 'alphangers-test', authDomain: 'x', appId: 'y' };

function memoryStorage() {
  const m = new Map();
  return {
    m,
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => m.set(k, v),
    remove: (k) => m.delete(k),
  };
}

function quietLog() {
  const calls = { warn: [], error: [] };
  return { calls, warn: (...a) => calls.warn.push(a.join(' ')), error: (...a) => calls.error.push(a.join(' ')) };
}

function firestoreDoc(data, rev = 3, updateTime = '2026-10-04T07:00:00.000000Z') {
  return { fields: { json: { stringValue: JSON.stringify(data) }, rev: { integerValue: String(rev) } }, updateTime };
}

// What a GET with mask.fieldPaths=rev returns: no json, but the update time is still there.
function firestoreHead(rev = 3, updateTime = '2026-10-04T07:00:00.000000Z') {
  return { fields: { rev: { integerValue: String(rev) } }, updateTime };
}

// Answers each request from a list, in order, and records what was asked.
function scriptedFetch(...answers) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return answers.shift() ?? new Promise(() => {});
  };
  return { fetchImpl, calls };
}

const T1 = '2026-10-04T07:00:00.000000Z';
const T2 = '2026-10-05T08:30:00.000000Z';
const cacheEntry = (data, updateTime, rev = 3) => JSON.stringify({ rev, json: JSON.stringify(data), updateTime });

function respond(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

// Lets a test decide when the fetch answers.
function deferredFetch() {
  const calls = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return gate;
  };
  return { fetchImpl, calls, answer: (res) => release(res) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const newerLinks = () => {
  const d = read('links');
  d.channels[0].url = 'https://drive.google.com/drive/folders/NEWER';
  return d;
};

test('config null: bundled data only and no network', async () => {
  let fetched = 0;
  const store = createContentStore({ config: null, fetchImpl: async () => (fetched++, respond(500)), storage: memoryStorage(), bundled: BUNDLED });
  const links = await store.load('links');
  assert.deepEqual(links, read('links'));
  for (const k of ['announcements', 'schedule', 'dosen', 'heart']) await store.load(k);
  await tick();
  assert.equal(fetched, 0);
});

test('unknown key throws', async () => {
  const store = createContentStore({ config: null, storage: memoryStorage(), bundled: BUNDLED });
  await assert.rejects(() => store.load('nope'), /Unknown content key/);
});

test('remote newer: subscriber gets it, cache is written, next load returns it', async () => {
  const f = deferredFetch();
  const storage = memoryStorage();
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage, bundled: BUNDLED, log: quietLog() });
  const first = await store.load('links');
  assert.equal(first.channels[0].url, '');
  const got = [];
  store.subscribe('links', (d) => got.push(d));
  f.answer(respond(200, firestoreDoc(newerLinks(), 7)));
  await tick();
  assert.equal(got.length, 1);
  assert.equal(got[0].channels[0].url, 'https://drive.google.com/drive/folders/NEWER');
  const cached = JSON.parse(storage.get('alpha.c.v1.links'));
  assert.equal(cached.rev, 7);
  assert.equal(JSON.parse(cached.json).channels[0].url, 'https://drive.google.com/drive/folders/NEWER');
  const again = await store.load('links');
  assert.equal(again.channels[0].url, 'https://drive.google.com/drive/folders/NEWER');
  // Request shape: REST URL with key, field mask, no credentials.
  const { url, opts } = f.calls[0];
  assert.match(url, /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/alphangers-test\/databases\/\(default\)\/documents\/content\/links\?key=AIza/);
  assert.match(url, /mask\.fieldPaths=json/);
  assert.equal(opts.credentials, 'omit');
  assert.equal(f.calls.length, 1, 'one request per key per page load');
});

test('subscriber added after the remote copy arrived still gets it', async () => {
  const f = deferredFetch();
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage: memoryStorage(), bundled: BUNDLED, log: quietLog() });
  await store.load('links');
  f.answer(respond(200, firestoreDoc(newerLinks())));
  await tick();
  const got = [];
  store.subscribe('links', (d) => got.push(d));
  await tick();
  assert.equal(got.length, 1);
});

test('remote equal to what was shown: no notification', async () => {
  const f = deferredFetch();
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage: memoryStorage(), bundled: BUNDLED, log: quietLog() });
  await store.load('links');
  const got = [];
  store.subscribe('links', (d) => got.push(d));
  f.answer(respond(200, firestoreDoc(read('links'))));
  await tick();
  assert.equal(got.length, 0);
});

test('cache is used before bundled on the next visit', async () => {
  const storage = memoryStorage();
  const data = newerLinks();
  storage.set('alpha.c.v1.links', JSON.stringify({ rev: 2, json: JSON.stringify(data) }));
  const store = createContentStore({ config: CONFIG, fetchImpl: async () => new Promise(() => {}), storage, bundled: BUNDLED, log: quietLog() });
  const links = await store.load('links');
  assert.equal(links.channels[0].url, 'https://drive.google.com/drive/folders/NEWER');
});

test('remote invalid: one warning, no notification, cache untouched', async () => {
  const storage = memoryStorage();
  storage.set('alpha.c.v1.links', JSON.stringify({ rev: 2, json: JSON.stringify(newerLinks()) }));
  const log = quietLog();
  const hostile = read('links');
  hostile.channels[1].url = 'javascript:alert(1)';
  const store = createContentStore({ config: CONFIG, fetchImpl: async () => respond(200, firestoreDoc(hostile)), storage, bundled: BUNDLED, log });
  const got = [];
  const links = await store.load('links');
  store.subscribe('links', (d) => got.push(d));
  await tick();
  await tick();
  assert.equal(links.channels[0].url, 'https://drive.google.com/drive/folders/NEWER');
  assert.equal(got.length, 0);
  assert.equal(log.calls.warn.length, 1);
  assert.match(log.calls.warn[0], /Ignoring remote "links"/);
  assert.equal(JSON.parse(storage.get('alpha.c.v1.links')).rev, 2);
});

test('remote with broken JSON string or a missing field is ignored', async () => {
  for (const body of [{ fields: { json: { stringValue: '{nope' } } }, { fields: {} }, { nothing: true }]) {
    const log = quietLog();
    const store = createContentStore({ config: CONFIG, fetchImpl: async () => respond(200, body), storage: memoryStorage(), bundled: BUNDLED, log });
    const got = [];
    await store.load('heart');
    store.subscribe('heart', (d) => got.push(d));
    await tick();
    await tick();
    assert.equal(got.length, 0);
    assert.equal(log.calls.warn.length, 1);
  }
});

test('remote document with extra fields is cleaned before use', async () => {
  const d = newerLinks();
  d.evil = '<img src=x onerror=alert(1)>';
  d.channels[0].onclick = 'alert(1)';
  const f = deferredFetch();
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage: memoryStorage(), bundled: BUNDLED, log: quietLog() });
  await store.load('links');
  const got = [];
  store.subscribe('links', (x) => got.push(x));
  f.answer(respond(200, firestoreDoc(d)));
  await tick();
  assert.equal(got.length, 1);
  assert.equal('evil' in got[0], false);
  assert.equal('onclick' in got[0].channels[0], false);
});

test('network down: bundled data, no warning, no notification', async () => {
  const log = quietLog();
  const store = createContentStore({
    config: CONFIG,
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
    storage: memoryStorage(),
    bundled: BUNDLED,
    log,
  });
  const got = [];
  const s = await store.load('schedule');
  store.subscribe('schedule', (d) => got.push(d));
  await tick();
  assert.deepEqual(s, read('schedule'));
  assert.equal(got.length, 0);
  assert.equal(log.calls.warn.length, 0);
});

test('timeout aborts the request', async () => {
  let aborted = false;
  const store = createContentStore({
    config: CONFIG,
    timeoutMs: 20,
    fetchImpl: (url, { signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => ((aborted = true), reject(new Error('aborted'))))),
    storage: memoryStorage(),
    bundled: BUNDLED,
    log: quietLog(),
  });
  await store.load('dosen');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(aborted, true);
});

test('HTTP 403 logs one warning and keeps the bundled copy', async () => {
  const log = quietLog();
  const store = createContentStore({ config: CONFIG, fetchImpl: async () => respond(403, {}), storage: memoryStorage(), bundled: BUNDLED, log });
  const d = await store.load('announcements');
  await tick();
  assert.deepEqual(d, read('announcements'));
  assert.equal(log.calls.warn.length, 1);
});

test('404 (admin reset): cache cleared and subscribers go back to bundled', async () => {
  const storage = memoryStorage();
  storage.set('alpha.c.v1.links', JSON.stringify({ rev: 4, json: JSON.stringify(newerLinks()) }));
  const f = deferredFetch();
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage, bundled: BUNDLED, log: quietLog() });
  const first = await store.load('links');
  assert.equal(first.channels[0].url, 'https://drive.google.com/drive/folders/NEWER');
  const got = [];
  store.subscribe('links', (d) => got.push(d));
  f.answer(respond(404, { error: { code: 404 } }));
  await tick();
  await tick();
  assert.equal(storage.get('alpha.c.v1.links'), null);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0], read('links'));
});

test('corrupted cache is dropped and bundled is used', async () => {
  const storage = memoryStorage();
  storage.set('alpha.c.v1.links', '{"json":"{\\"v\\":1,\\"channels\\":[{\\"id\\":\\"x\\",\\"name\\":\\"X\\",\\"url\\":\\"http://evil\\"}]}"}');
  const store = createContentStore({ config: CONFIG, fetchImpl: async () => new Promise(() => {}), storage, bundled: BUNDLED, log: quietLog() });
  const d = await store.load('links');
  assert.deepEqual(d, read('links'));
  assert.equal(storage.get('alpha.c.v1.links'), null);
});

test('storage blocked: accessor throws, everything still works', async () => {
  const blocked = safeStorage(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  });
  const f = deferredFetch();
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage: blocked, bundled: BUNDLED, log: quietLog() });
  const d = await store.load('links');
  assert.deepEqual(d, read('links'));
  const got = [];
  store.subscribe('links', (x) => got.push(x));
  f.answer(respond(200, firestoreDoc(newerLinks())));
  await tick();
  assert.equal(got.length, 1);
});

test('storage full: setItem throws, update still delivered', async () => {
  const full = safeStorage(() => ({
    getItem: () => null,
    setItem: () => {
      throw new DOMException('Quota', 'QuotaExceededError');
    },
    removeItem: () => {},
  }));
  const f = deferredFetch();
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage: full, bundled: BUNDLED, log: quietLog() });
  await store.load('links');
  const got = [];
  store.subscribe('links', (x) => got.push(x));
  f.answer(respond(200, firestoreDoc(newerLinks())));
  await tick();
  assert.equal(got.length, 1);
});

test('unsubscribe stops updates; a throwing subscriber does not stop others', async () => {
  const f = deferredFetch();
  const log = quietLog();
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage: memoryStorage(), bundled: BUNDLED, log });
  await store.load('links');
  const got = [];
  const off = store.subscribe('links', (x) => got.push(['a', x]));
  store.subscribe('links', () => {
    throw new Error('boom');
  });
  store.subscribe('links', (x) => got.push(['c', x]));
  off();
  f.answer(respond(200, firestoreDoc(newerLinks())));
  await tick();
  assert.deepEqual(got.map((g) => g[0]), ['c']);
  assert.equal(log.calls.error.length, 1);
});

test('a config with a bad projectId is refused and makes no requests', async () => {
  let fetched = 0;
  const log = quietLog();
  const store = createContentStore({
    config: { ...CONFIG, projectId: 'evil.com/x?' },
    fetchImpl: async () => (fetched++, respond(200, {})),
    storage: memoryStorage(),
    bundled: BUNDLED,
    log,
  });
  await store.load('links');
  await tick();
  assert.equal(fetched, 0);
  assert.equal(log.calls.warn.length, 1);
});

test('first visit stores the update time with the cached copy', async () => {
  const storage = memoryStorage();
  const f = scriptedFetch(respond(200, firestoreDoc(newerLinks(), 7, T1)));
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage, bundled: BUNDLED, log: quietLog() });
  await store.load('links');
  await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(JSON.parse(storage.get('alpha.c.v1.links')).updateTime, T1);
});

test('unchanged since the cached copy: one rev-only request, no download, no notification', async () => {
  const storage = memoryStorage();
  storage.set('alpha.c.v1.links', cacheEntry(newerLinks(), T1));
  const f = scriptedFetch(respond(200, firestoreHead(3, T1)));
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage, bundled: BUNDLED, log: quietLog() });
  const first = await store.load('links');
  assert.equal(first.channels[0].url, 'https://drive.google.com/drive/folders/NEWER');
  const got = [];
  store.subscribe('links', (d) => got.push(d));
  await tick();
  await tick();
  assert.equal(f.calls.length, 1, 'only the small check');
  assert.match(f.calls[0].url, /mask\.fieldPaths=rev$/);
  assert.doesNotMatch(f.calls[0].url, /fieldPaths=json/);
  assert.equal(got.length, 0);
  assert.equal(JSON.parse(storage.get('alpha.c.v1.links')).updateTime, T1);
  // later loads in the same page use that copy without asking again
  assert.equal((await store.load('links')).channels[0].url, 'https://drive.google.com/drive/folders/NEWER');
  assert.equal(f.calls.length, 1);
});

test('changed since the cached copy: the full document is downloaded and delivered', async () => {
  const storage = memoryStorage();
  storage.set('alpha.c.v1.links', cacheEntry(read('links'), T1));
  const newer = newerLinks();
  const f = scriptedFetch(respond(200, firestoreHead(4, T2)), respond(200, firestoreDoc(newer, 4, T2)));
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage, bundled: BUNDLED, log: quietLog() });
  await store.load('links');
  const got = [];
  store.subscribe('links', (d) => got.push(d));
  await tick();
  await tick();
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[1].url, /mask\.fieldPaths=json&mask\.fieldPaths=rev$/);
  assert.equal(got.length, 1);
  assert.equal(got[0].channels[0].url, 'https://drive.google.com/drive/folders/NEWER');
  const cached = JSON.parse(storage.get('alpha.c.v1.links'));
  assert.equal(cached.updateTime, T2);
  assert.equal(cached.rev, 4);
});

test('a cached copy from before update times were kept is downloaded in full once', async () => {
  const storage = memoryStorage();
  storage.set('alpha.c.v1.links', JSON.stringify({ rev: 2, json: JSON.stringify(newerLinks()) }));
  const f = scriptedFetch(respond(200, firestoreDoc(newerLinks(), 2, T1)));
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage, bundled: BUNDLED, log: quietLog() });
  await store.load('links');
  await tick();
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /fieldPaths=json/);
  assert.equal(JSON.parse(storage.get('alpha.c.v1.links')).updateTime, T1);
});

test('reset while a copy is cached: the rev check finds nothing, back to bundled', async () => {
  const storage = memoryStorage();
  storage.set('alpha.c.v1.links', cacheEntry(newerLinks(), T1));
  const f = scriptedFetch(respond(404, { error: { code: 404 } }));
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage, bundled: BUNDLED, log: quietLog() });
  await store.load('links');
  const got = [];
  store.subscribe('links', (d) => got.push(d));
  await tick();
  await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(storage.get('alpha.c.v1.links'), null);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0], read('links'));
});

test('a rev check without an update time falls back to the full download', async () => {
  const storage = memoryStorage();
  storage.set('alpha.c.v1.links', cacheEntry(read('links'), T1));
  const f = scriptedFetch(respond(200, { fields: { rev: { integerValue: '3' } } }), respond(200, firestoreDoc(newerLinks(), 3, T2)));
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage, bundled: BUNDLED, log: quietLog() });
  await store.load('links');
  const got = [];
  store.subscribe('links', (d) => got.push(d));
  await tick();
  await tick();
  assert.equal(f.calls.length, 2);
  assert.equal(got.length, 1);
});

test('a subscriber that names the copy it shows still gets a newer copy another caller already saw', async () => {
  const f = deferredFetch();
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage: memoryStorage(), bundled: BUNDLED, log: quietLog() });
  const shownByA = await store.load('links'); // section A renders the bundled copy, then waits for its module
  f.answer(respond(200, firestoreDoc(newerLinks())));
  await tick();
  const shownByB = await store.load('links'); // section B loads after the remote copy landed
  assert.equal(shownByB.channels[0].url, 'https://drive.google.com/drive/folders/NEWER');
  const gotA = [];
  const gotB = [];
  store.subscribe('links', (d) => gotA.push(d), shownByA);
  store.subscribe('links', (d) => gotB.push(d), shownByB);
  await tick();
  assert.equal(gotA.length, 1, 'A is behind and catches up');
  assert.equal(gotB.length, 0, 'B already shows it');
});

test('subscribing after load with the shown copy: a remote copy equal to it changes nothing', async () => {
  const f = deferredFetch();
  const store = createContentStore({ config: CONFIG, fetchImpl: f.fetchImpl, storage: memoryStorage(), bundled: BUNDLED, log: quietLog() });
  const shown = await store.load('links');
  const got = [];
  store.subscribe('links', (d) => got.push(d), shown);
  f.answer(respond(404, { error: { code: 404 } }));
  await tick();
  await tick();
  assert.equal(got.length, 0);
});
