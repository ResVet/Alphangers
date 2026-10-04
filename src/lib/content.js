// Content for the public portal.
//
// load(key) answers at once from the best copy already on hand: the Firestore
// copy if it arrived during this page load, else the last Firestore copy kept
// in localStorage, else the JSON bundled with the site. At the same time it
// asks Firestore (plain REST, no SDK, so the portal stays light) for the
// current document. When that copy is valid and differs from what was shown,
// subscribers get it.
//
//   const links = await load('links');
//   render(links);
//   subscribe('links', render);
//
// Call subscribe right after load. If the fresh copy landed in between, the
// subscriber still gets it. Treat returned data as read-only: the same object
// is handed to every caller.

import { firebaseConfig } from './firebase-config.js';
import { CONTENT_KEYS, MAX_JSON_BYTES, validate } from './validate.js';

export const KEYS = CONTENT_KEYS;

const CACHE_PREFIX = 'alpha.c.v1.';
const TIMEOUT_MS = 6000;

// Dynamic imports so each file becomes its own chunk and is only fetched when needed.
const BUNDLED = {
  links: () => import('../data/links.json'),
  announcements: () => import('../data/announcements.json'),
  schedule: () => import('../data/schedule.json'),
  dosen: () => import('../data/dosen.json'),
  heart: () => import('../data/heart-parts.json'),
};

export async function loadBundled(key, loaders = BUNDLED) {
  const mod = await loaders[key]();
  return mod && 'default' in mod ? mod.default : mod;
}

// localStorage can be missing, blocked (Safari private mode, strict cookie
// settings) or full. None of that should break the page.
export function safeStorage(getStore = () => globalThis.localStorage) {
  const store = () => {
    try {
      return getStore() || null;
    } catch {
      return null;
    }
  };
  return {
    get(k) {
      try {
        return store()?.getItem(k) ?? null;
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        store()?.setItem(k, v);
      } catch {
        /* quota or blocked: the cache is only a speed-up */
      }
    },
    remove(k) {
      try {
        store()?.removeItem(k);
      } catch {
        /* same */
      }
    },
  };
}

// Only accept a config that can't bend the request URL somewhere else.
function remoteFrom(config) {
  if (!config) return null;
  const { projectId, apiKey } = config;
  if (typeof projectId !== 'string' || !/^[a-z0-9-]{4,40}$/.test(projectId)) return null;
  if (typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(apiKey)) return null;
  return { projectId, apiKey };
}

class RemoteInvalid extends Error {}

export function createContentStore({
  config = firebaseConfig,
  fetchImpl = (...args) => globalThis.fetch(...args),
  storage = safeStorage(),
  bundled = BUNDLED,
  timeoutMs = TIMEOUT_MS,
  log = console,
} = {}) {
  const remote = remoteFrom(config);
  if (config && !remote) log.warn('[content] firebaseConfig looks wrong (projectId or apiKey); using bundled data only.');

  const states = new Map();
  function state(key) {
    if (!KEYS.includes(key)) throw new Error(`Unknown content key: ${key}`);
    if (!states.has(key)) {
      states.set(key, { fresh: null, fetching: false, served: null, bundledJson: null, subs: new Set() });
    }
    return states.get(key);
  }

  function readCache(key) {
    const raw = storage.get(CACHE_PREFIX + key);
    if (!raw) return null;
    try {
      const { json } = JSON.parse(raw);
      const res = validate(key, JSON.parse(json));
      if (res.ok) return { data: res.data, json: JSON.stringify(res.data) };
    } catch {
      /* fall through */
    }
    storage.remove(CACHE_PREFIX + key);
    return null;
  }

  async function bundledCopy(key) {
    const st = state(key);
    const data = await loadBundled(key, bundled);
    // Only needed to compare against a remote copy later.
    if (remote && st.bundledJson === null) st.bundledJson = JSON.stringify(data);
    return { data, json: st.bundledJson };
  }

  async function fetchRemote(key) {
    const url =
      `https://firestore.googleapis.com/v1/projects/${remote.projectId}/databases/(default)/documents/content/${key}` +
      `?key=${encodeURIComponent(remote.apiKey)}&mask.fieldPaths=json&mask.fieldPaths=rev`;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(url, {
        signal: ctrl?.signal,
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (res.status === 404) return { missing: true };
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { loud: true });
      const body = await res.json();
      const json = body?.fields?.json?.stringValue;
      const rev = Number(body?.fields?.rev?.integerValue ?? 0);
      if (typeof json !== 'string') throw new RemoteInvalid('missing json field');
      if (json.length > MAX_JSON_BYTES) throw new RemoteInvalid('json field too large');
      let parsed;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw new RemoteInvalid('json field is not JSON');
      }
      const res2 = validate(key, parsed);
      if (!res2.ok) {
        const first = res2.errors[0];
        throw new RemoteInvalid(`${res2.errors.length} problem(s), first at ${first.path.join('.') || '(root)'}: ${first.msg}`);
      }
      return { data: res2.data, json: JSON.stringify(res2.data), rev };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function deliver(st, copy) {
    for (const sub of st.subs) {
      if (sub.last === copy.json) continue;
      sub.last = copy.json;
      try {
        sub.fn(copy.data);
      } catch (e) {
        log.error('[content] subscriber failed', e);
      }
    }
  }

  function startFetch(key) {
    const st = state(key);
    if (!remote || st.fetching) return;
    st.fetching = true;
    fetchRemote(key)
      .then(async (got) => {
        if (got.missing) {
          // No document means the admin reset this key: go back to the bundled file.
          storage.remove(CACHE_PREFIX + key);
          st.fresh = await bundledCopy(key);
        } else {
          storage.set(CACHE_PREFIX + key, JSON.stringify({ rev: got.rev, json: got.json }));
          st.fresh = { data: got.data, json: got.json };
        }
        deliver(st, st.fresh);
      })
      .catch((e) => {
        // Offline or timed out: stay quiet, the page already has data.
        if (e instanceof RemoteInvalid) log.warn(`[content] Ignoring remote "${key}": ${e.message}. Using the cached or bundled copy.`);
        else if (e && e.loud) log.warn(`[content] Could not fetch "${key}" (${e.message}). Using the cached or bundled copy.`);
      });
  }

  async function load(key) {
    const st = state(key);
    if (st.fresh) {
      st.served = st.fresh.json;
      return st.fresh.data;
    }
    startFetch(key);
    const copy = readCache(key) || (await bundledCopy(key));
    // The fresh copy may have arrived while the bundled file was loading.
    if (st.fresh) {
      st.served = st.fresh.json;
      return st.fresh.data;
    }
    st.served = copy.json;
    return copy.data;
  }

  function subscribe(key, fn) {
    const st = state(key);
    const sub = { fn, last: st.served };
    st.subs.add(sub);
    if (st.fresh && st.fresh.json !== sub.last) queueMicrotask(() => st.subs.has(sub) && deliver(st, st.fresh));
    return () => st.subs.delete(sub);
  }

  return { load, subscribe };
}

const store = createContentStore();
export const load = store.load;
export const subscribe = store.subscribe;
