// Validators for the five content documents. The portal runs them on every
// copy that comes from Firestore or localStorage, and the admin runs them
// before every save, so both sides agree on what a valid document is.
//
// validate(key, value) never throws. It returns
//   { ok, data, errors, warnings }
// where data is a new object built only from known fields: unknown fields are
// dropped, strings are trimmed, stripped of control characters and capped,
// URLs must be https, dates and times must be real. If errors is not empty,
// ok is false and data must not be used. Warnings never block anything.
//
// Issue messages are Indonesian because the admin shows them as they are.

export const CONTENT_KEYS = ['links', 'announcements', 'schedule', 'dosen', 'heart'];
export const FORMAT_VERSION = 1;

// Firestore documents max out at 1 MiB. The rules allow 900 000 characters of
// JSON, and the admin checks bytes, which is the stricter of the two.
export const MAX_JSON_BYTES = 900_000;

export const ANNOUNCEMENT_TAGS = ['info', 'deadline', 'ujian', 'penting'];
export const SESSION_KINDS = ['kuliah', 'praktikum', 'skilllab', 'tutorial', 'ujian', 'pleno', 'mkdu', 'intro'];
export const CHANNEL_KINDS = ['tryout'];
export const HEART_GROUPS = ['umum', 'ruang', 'pembuluh_besar', 'koroner', 'vena_jantung', 'katup', 'konduksi'];

// The 3D model names its parts with these ids, so the list is fixed here and a
// test checks it against src/data/heart-parts.json and public/models/heart-meta.json.
export const HEART_IDS = [
  'heart', 'ra', 'ra_aur', 'rv', 'rvot', 'la', 'la_aur', 'lv', 'apex', 'ivs', 'ias', 'fossa',
  'aorta_asc', 'aorta_arch', 'aorta_desc', 'bct', 'lcca', 'lsa', 'pt', 'rpa', 'lpa', 'svc', 'ivc',
  'rspv', 'ripv', 'lspv', 'lipv', 'lig_art', 'rca', 'lmca', 'lad', 'diag', 'lcx', 'om', 'rmarg',
  'pda', 'gcv', 'mcv', 'scv', 'cs', 'tv', 'pv', 'mv', 'av', 'chordae', 'pap_lv', 'pap_rv',
  'modband', 'san', 'internodal', 'avn', 'his', 'lbb', 'rbb', 'purk',
];

// Upper bounds. They sit well above what the real data uses, so they only bite
// on a broken or hostile document.
export const LIMITS = {
  channels: 40, announcements: 100, bloks: 20, days: 120, sessions: 30, codes: 80, tags: 4,
  dosen: 1500, phones: 4, dosenBloks: 20, heartList: 16, heartRelated: 10,
  siteTexts: 600, divisi: 16, photos: 40, srcset: 6,
};

const ID_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const CODE_RE = /^[A-Z0-9]{1,8}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;
// Page text keys, e.g. "hero.lede" or "foot.credit".
const TEXT_KEY_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+){0,7}$/;
// Photos are served by this site only: bundled ones under /img/, uploaded ones under /media/.
// Every path segment starts with a letter or digit, so ".." can never appear.
export const MEDIA_RE = /^\/(?:img|media)(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}){1,4}$/;
// A tiny blurred preview kept inline; a few hundred bytes in practice.
const LQIP_RE = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]{8,4000}={0,2}$/;
const HEX_RE = /^#[0-9a-f]{6}$/;

// C0 and C1 controls except tab and newline, plus the bidi overrides that can
// make text read differently from how it is stored.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/* ---------- issue collection ---------- */

function makeCtx() {
  return { errors: [], warnings: [] };
}

function err(ctx, path, msg) {
  ctx.errors.push({ path: path.slice(), msg });
}

function warn(ctx, path, msg) {
  ctx.warnings.push({ path: path.slice(), msg });
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function noteUnknown(ctx, path, obj, known) {
  for (const k of Object.keys(obj)) {
    if (!known.includes(k)) warn(ctx, path.concat(k), 'Field tidak dikenal, dibuang.');
  }
}

/* ---------- primitives ---------- */

function cleanText(v, multiline) {
  let s = v.replace(/\r\n?/g, '\n').replace(CONTROL_RE, '');
  s = multiline ? s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s*\n\s*/g, ' ');
  return s.trim();
}

function text(ctx, path, v, { max, required = false, multiline = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) err(ctx, path, 'Wajib diisi.');
    return '';
  }
  if (typeof v !== 'string') {
    err(ctx, path, 'Harus berupa teks.');
    return '';
  }
  let s = cleanText(v, multiline);
  if (required && !s) err(ctx, path, 'Wajib diisi.');
  if (s.length > max) {
    warn(ctx, path, `Kepanjangan, dipotong jadi ${max} karakter.`);
    s = s.slice(0, max).trimEnd();
  }
  return s;
}

function httpsUrl(ctx, path, v, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) err(ctx, path, 'Link wajib diisi.');
    return '';
  }
  if (typeof v !== 'string') {
    err(ctx, path, 'Link harus berupa teks.');
    return '';
  }
  const s = v.trim();
  if (s.length > 2048) {
    err(ctx, path, 'Link terlalu panjang.');
    return '';
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    err(ctx, path, 'Link tidak valid. Contoh: https://drive.google.com/...');
    return '';
  }
  if (u.protocol !== 'https:') {
    err(ctx, path, 'Link harus diawali https://');
    return '';
  }
  if (u.username || u.password) {
    err(ctx, path, 'Link tidak boleh berisi nama pengguna atau kata sandi.');
    return '';
  }
  if (!u.hostname.includes('.')) {
    err(ctx, path, 'Nama domain di link tidak valid.');
    return '';
  }
  return u.href;
}

export function isRealDate(s) {
  const m = typeof s === 'string' && DATE_RE.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2000 || y > 2100) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function isTime(s) {
  return typeof s === 'string' && TIME_RE.test(s);
}

export function toMinutes(hhmm) {
  const m = TIME_RE.exec(hhmm);
  return m ? +m[1] * 60 + +m[2] : NaN;
}

function date(ctx, path, v, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) err(ctx, path, 'Tanggal wajib diisi.');
    return '';
  }
  if (!isRealDate(v)) {
    err(ctx, path, 'Tanggal tidak valid (format YYYY-MM-DD).');
    return '';
  }
  return v;
}

function time(ctx, path, v, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) err(ctx, path, 'Jam wajib diisi.');
    return '';
  }
  if (!isTime(v)) {
    err(ctx, path, 'Jam tidak valid (format HH:MM, 00:00 sampai 23:59).');
    return '';
  }
  return v;
}

function dateTime(ctx, path, v) {
  if (v === undefined || v === null || v === '') return '';
  const m = typeof v === 'string' && DATETIME_RE.exec(v);
  if (!m || !isRealDate(m[1]) || !isTime(m[2])) {
    err(ctx, path, 'Tanggal dan jam tidak valid (format YYYY-MM-DDTHH:MM).');
    return '';
  }
  return v;
}

function id(ctx, path, v) {
  if (typeof v !== 'string' || !v) {
    err(ctx, path, 'ID wajib diisi.');
    return '';
  }
  if (v.length > 64 || !ID_RE.test(v)) {
    err(ctx, path, 'ID cuma boleh huruf kecil, angka, tanda - atau _.');
    return '';
  }
  return v;
}

function list(ctx, path, v, max, { required = true } = {}) {
  if (v === undefined || v === null) {
    if (required) err(ctx, path, 'Daftar wajib ada.');
    return [];
  }
  if (!Array.isArray(v)) {
    err(ctx, path, 'Harus berupa daftar.');
    return [];
  }
  if (v.length > max) {
    err(ctx, path, `Maksimal ${max} item.`);
    return [];
  }
  return v;
}

function flag(ctx, path, v) {
  if (v === undefined || v === null || v === false) return false;
  if (v === true) return true;
  err(ctx, path, 'Harus true atau false.');
  return false;
}

function uniqueIds(ctx, path, items, field = 'id') {
  const seen = new Set();
  items.forEach((it, i) => {
    const v = it && it[field];
    if (!v) return;
    if (seen.has(v)) err(ctx, path.concat(i, field), `"${v}" dipakai lebih dari sekali.`);
    seen.add(v);
  });
}

function root(ctx, value, listField, known) {
  if (!isObj(value)) {
    err(ctx, [], 'Dokumen harus berupa objek JSON.');
    return null;
  }
  if (value.v !== FORMAT_VERSION) {
    err(ctx, ['v'], `Versi format harus ${FORMAT_VERSION}.`);
  }
  if (!(listField in value)) {
    err(ctx, [listField], 'Daftar wajib ada.');
  }
  noteUnknown(ctx, [], value, known);
  return value;
}

/* ---------- phones ---------- */

// Turns whatever was typed (0812..., +62 812..., 62812..., 0711 354088, a bare
// 7 digit Palembang number) into { n, f, wa }. n is digits starting with 0,
// f is the display form, wa is the wa.me number for mobiles and '' for
// landlines. Returns null when it does not look like an Indonesian number.
export function normalizePhone(input) {
  let d = String(input ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('62') && d.length >= 10) d = '0' + d.slice(2);
  else if (!d.startsWith('0')) d = d.length <= 8 ? '0711' + d : '0' + d;

  if (/^08\d{8,11}$/.test(d)) {
    return { n: d, f: `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}`, wa: '62' + d.slice(1) };
  }
  if (/^0711\d{6,8}$/.test(d)) {
    return { n: d, f: '0711-' + d.slice(4), wa: '' };
  }
  // Two digit area codes (Jakarta, Bandung, Semarang, Surabaya, Medan), then three digit ones.
  if (/^0(21|22|24|31|61)\d{7,8}$/.test(d)) {
    return { n: d, f: `${d.slice(0, 3)}-${d.slice(3)}`, wa: '' };
  }
  if (/^0[2-79]\d{2}\d{5,8}$/.test(d)) {
    return { n: d, f: `${d.slice(0, 4)}-${d.slice(4)}`, wa: '' };
  }
  return null;
}

/* ---------- links ---------- */

/* ---------- photos ---------- */

function mediaPath(ctx, path, v, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) err(ctx, path, 'Foto wajib ada.');
    return '';
  }
  if (typeof v !== 'string' || !MEDIA_RE.test(v)) {
    err(ctx, path, 'Alamat foto harus dari situs ini (/img/... atau /media/...).');
    return '';
  }
  return v;
}

function int(ctx, path, v, lo, hi) {
  if (!Number.isInteger(v) || v < lo || v > hi) {
    err(ctx, path, `Harus bilangan bulat ${lo} sampai ${hi}.`);
    return 0;
  }
  return v;
}

// One photo: the main file, its pixel size (so the page reserves the space before it loads),
// smaller copies for srcset, an optional AVIF set, the untouched original for zooming, and a
// blurred preview. Text fields are plain text, never HTML.
function photo(ctx, p, x) {
  if (!isObj(x)) {
    err(ctx, p, 'Foto harus berupa objek.');
    return null;
  }
  noteUnknown(ctx, p, x, ['src', 'w', 'h', 'alt', 'cap', 'set', 'avif', 'full', 'lq', 'bg']);
  const out = {
    src: mediaPath(ctx, p.concat('src'), x.src, { required: true }),
    w: int(ctx, p.concat('w'), x.w, 1, 20000),
    h: int(ctx, p.concat('h'), x.h, 1, 20000),
    alt: text(ctx, p.concat('alt'), x.alt, { max: 300 }),
    cap: text(ctx, p.concat('cap'), x.cap, { max: 600, multiline: true }),
  };
  for (const k of ['set', 'avif']) {
    if (x[k] === undefined || x[k] === null) continue;
    const items = list(ctx, p.concat(k), x[k], LIMITS.srcset, { required: false });
    const set = [];
    items.forEach((it, j) => {
      const ip = p.concat(k, j);
      if (!Array.isArray(it) || it.length !== 2) return err(ctx, ip, 'Harus [alamat, lebar].');
      const src = mediaPath(ctx, ip.concat(0), it[0], { required: true });
      const w = int(ctx, ip.concat(1), it[1], 1, 20000);
      if (src && w) set.push([src, w]);
    });
    if (set.length) out[k] = set;
  }
  const full = mediaPath(ctx, p.concat('full'), x.full);
  if (full) out.full = full;
  if (x.lq !== undefined && x.lq !== null && x.lq !== '') {
    if (typeof x.lq === 'string' && LQIP_RE.test(x.lq)) out.lq = x.lq;
    else warn(ctx, p.concat('lq'), 'Pratinjau buram tidak valid, dibuang.');
  }
  if (x.bg !== undefined && x.bg !== null && x.bg !== '') {
    if (typeof x.bg === 'string' && HEX_RE.test(x.bg)) out.bg = x.bg;
    else warn(ctx, p.concat('bg'), 'Warna latar tidak valid, dibuang.');
  }
  return out;
}

/* ---------- page texts and divisi (both live in the links document) ---------- */

function validateSite(ctx, p, v) {
  if (!isObj(v)) {
    err(ctx, p, 'Harus berupa objek.');
    return null;
  }
  noteUnknown(ctx, p, v, ['t', 'photo']);
  const out = { t: {} };
  if (v.t !== undefined && v.t !== null) {
    if (!isObj(v.t)) err(ctx, p.concat('t'), 'Harus berupa objek.');
    else {
      const entries = Object.entries(v.t);
      if (entries.length > LIMITS.siteTexts) err(ctx, p.concat('t'), `Maksimal ${LIMITS.siteTexts} teks.`);
      else {
        for (const [k, val] of entries) {
          const kp = p.concat('t', k);
          if (!TEXT_KEY_RE.test(k) || k.length > 64) err(ctx, kp, 'Kunci teks tidak valid.');
          else out.t[k] = text(ctx, kp, val, { max: 4000, multiline: true });
        }
      }
    }
  }
  if (v.photo !== undefined && v.photo !== null) {
    const ph = photo(ctx, p.concat('photo'), v.photo);
    if (ph) out.photo = ph;
  }
  return out;
}

function validateDivisi(ctx, p, v) {
  const items = list(ctx, p, v, LIMITS.divisi);
  uniqueIds(ctx, p, items);
  return items.map((d, i) => {
    const dp = p.concat(i);
    if (!isObj(d)) {
      err(ctx, dp, 'Divisi harus berupa objek.');
      return null;
    }
    noteUnknown(ctx, dp, d, ['id', 'name', 'full', 'tag', 'desc', 'photos']);
    const out = {
      id: id(ctx, dp.concat('id'), d.id),
      name: text(ctx, dp.concat('name'), d.name, { max: 40, required: true }),
      full: text(ctx, dp.concat('full'), d.full, { max: 100 }),
      tag: text(ctx, dp.concat('tag'), d.tag, { max: 80 }),
      desc: text(ctx, dp.concat('desc'), d.desc, { max: 3000, multiline: true }),
      photos: [],
    };
    for (const [j, ph] of list(ctx, dp.concat('photos'), d.photos, LIMITS.photos, { required: false }).entries()) {
      const x = photo(ctx, dp.concat('photos', j), ph);
      if (x) out.photos.push(x);
    }
    return out;
  });
}

function validateLinks(ctx, value) {
  const doc = root(ctx, value, 'channels', ['v', 'channels', 'site', 'divisi']);
  if (!doc) return null;
  const items = list(ctx, ['channels'], doc.channels, LIMITS.channels);
  uniqueIds(ctx, ['channels'], items);
  const channels = items.map((c, i) => {
    const p = ['channels', i];
    if (!isObj(c)) {
      err(ctx, p, 'Channel harus berupa objek.');
      return null;
    }
    noteUnknown(ctx, p, c, ['id', 'kind', 'name', 'tag', 'sub', 'url']);
    const out = { id: id(ctx, p.concat('id'), c.id) };
    if (c.kind !== undefined && c.kind !== null && c.kind !== '') {
      if (CHANNEL_KINDS.includes(c.kind)) out.kind = c.kind;
      else err(ctx, p.concat('kind'), 'Jenis channel tidak dikenal.');
    }
    out.name = text(ctx, p.concat('name'), c.name, { max: 60, required: true });
    out.tag = text(ctx, p.concat('tag'), c.tag, { max: 60 });
    out.sub = text(ctx, p.concat('sub'), c.sub, { max: 240 });
    if (out.kind !== 'tryout') {
      out.url = httpsUrl(ctx, p.concat('url'), c.url);
      if (out.url && new URL(out.url).hostname !== 'drive.google.com') {
        warn(ctx, p.concat('url'), 'Bukan link drive.google.com. Pastikan memang benar.');
      }
    }
    return out;
  });
  const result = { v: FORMAT_VERSION, channels };
  // Both optional: a document without them keeps the page's own texts and the bundled divisi.
  if (doc.site !== undefined && doc.site !== null) {
    const site = validateSite(ctx, ['site'], doc.site);
    if (site) result.site = site;
  }
  if (doc.divisi !== undefined && doc.divisi !== null) result.divisi = validateDivisi(ctx, ['divisi'], doc.divisi);
  return result;
}

/* ---------- announcements ---------- */

function validateAnnouncements(ctx, value) {
  const doc = root(ctx, value, 'items', ['v', 'items']);
  if (!doc) return null;
  const items = list(ctx, ['items'], doc.items, LIMITS.announcements);
  uniqueIds(ctx, ['items'], items);
  const out = items.map((a, i) => {
    const p = ['items', i];
    if (!isObj(a)) {
      err(ctx, p, 'Pengumuman harus berupa objek.');
      return null;
    }
    noteUnknown(ctx, p, a, ['id', 'title', 'body', 'tag', 'date', 'due', 'link', 'pinned', 'until']);
    const item = {
      id: id(ctx, p.concat('id'), a.id),
      title: text(ctx, p.concat('title'), a.title, { max: 120, required: true }),
      body: text(ctx, p.concat('body'), a.body, { max: 2000, multiline: true }),
      tag: 'info',
      date: date(ctx, p.concat('date'), a.date, { required: true }),
    };
    if (ANNOUNCEMENT_TAGS.includes(a.tag)) item.tag = a.tag;
    else err(ctx, p.concat('tag'), 'Label harus info, deadline, ujian, atau penting.');
    const due = dateTime(ctx, p.concat('due'), a.due);
    if (due) item.due = due;
    else if (item.tag === 'deadline') warn(ctx, p.concat('due'), 'Label deadline tapi tenggatnya kosong.');
    const link = httpsUrl(ctx, p.concat('link'), a.link);
    if (link) item.link = link;
    if (flag(ctx, p.concat('pinned'), a.pinned)) item.pinned = true;
    const until = date(ctx, p.concat('until'), a.until);
    if (until) {
      item.until = until;
      if (item.date && until < item.date) warn(ctx, p.concat('until'), 'Tanggal sembunyi lebih awal dari tanggal posting.');
    }
    return item;
  });
  return { v: FORMAT_VERSION, items: out };
}

/* ---------- schedule ---------- */

function validateSession(ctx, p, x, codes) {
  if (!isObj(x)) {
    err(ctx, p, 'Sesi harus berupa objek.');
    return null;
  }
  noteUnknown(ctx, p, x, ['s', 'e', 't', 'k', 'dz', 'pj', 'tim', 'n', 'batal', 'alasan', 'online', 'tautan', 'label']);
  const s = time(ctx, p.concat('s'), x.s, { required: true });
  let e = null;
  if (x.e !== null && x.e !== undefined && x.e !== '') {
    e = time(ctx, p.concat('e'), x.e) || null;
    if (s && e && toMinutes(e) <= toMinutes(s)) err(ctx, p.concat('e'), 'Jam selesai harus setelah jam mulai.');
  }
  const out = { s, e, t: text(ctx, p.concat('t'), x.t, { max: 200, required: true }), k: 'kuliah', dz: [] };
  if (SESSION_KINDS.includes(x.k)) out.k = x.k;
  else err(ctx, p.concat('k'), 'Jenis sesi tidak dikenal.');
  const dz = list(ctx, p.concat('dz'), x.dz, 12, { required: false });
  for (const [j, c] of dz.entries()) {
    if (typeof c !== 'string' || !CODE_RE.test(c)) err(ctx, p.concat('dz', j), 'Kode dosen tidak valid.');
    else if (!codes.has(c)) err(ctx, p.concat('dz', j), `Kode ${c} belum ada di daftar kode blok.`);
    else if (!out.dz.includes(c)) out.dz.push(c);
  }
  if (flag(ctx, p.concat('pj'), x.pj)) out.pj = true;
  if (flag(ctx, p.concat('tim'), x.tim)) out.tim = true;
  const n = text(ctx, p.concat('n'), x.n, { max: 300 });
  if (n) out.n = n;
  // Cancelled sessions stay in the schedule, marked, so people can see what was dropped.
  if (flag(ctx, p.concat('batal'), x.batal)) {
    out.batal = true;
    const why = text(ctx, p.concat('alasan'), x.alasan, { max: 200 });
    if (why) out.alasan = why;
  }
  // Online: everyone joins from their own place, through the meeting link when there is one
  // (Zoom, Google Meet, Teams...). A link alone also marks the session online.
  const link = httpsUrl(ctx, p.concat('tautan'), x.tautan);
  if (flag(ctx, p.concat('online'), x.online) || link) {
    out.online = true;
    if (link) out.tautan = link;
  }
  // Tags of the admin's own, shown next to the session kind ("Kelas gabungan", "Bawa jas lab")
  const tags = list(ctx, p.concat('label'), x.label, LIMITS.tags, { required: false });
  const seenTag = new Set();
  for (const [j, raw] of tags.entries()) {
    const tag = text(ctx, p.concat('label', j), raw, { max: 30 });
    if (!tag || seenTag.has(tag.toLowerCase())) continue;
    seenTag.add(tag.toLowerCase());
    (out.label = out.label || []).push(tag);
  }
  return out;
}

function warnOverlaps(ctx, path, sessions) {
  for (let i = 0; i < sessions.length; i++) {
    const a = sessions[i];
    if (!a || !a.s || !a.e) continue;
    for (let j = i + 1; j < sessions.length; j++) {
      const b = sessions[j];
      if (!b || !b.s || !b.e) continue;
      if (toMinutes(a.s) < toMinutes(b.e) && toMinutes(b.s) < toMinutes(a.e)) {
        warn(ctx, path.concat(j), `Bentrok dengan sesi ${a.s}-${a.e}.`);
      }
    }
  }
}

function validateBlok(ctx, p, b) {
  if (!isObj(b)) {
    err(ctx, p, 'Blok harus berupa objek.');
    return null;
  }
  noteUnknown(ctx, p, b, ['id', 'name', 'title', 'loc', 'ketua', 'start', 'end', 'days', 'codes']);
  const out = {
    id: id(ctx, p.concat('id'), b.id),
    name: text(ctx, p.concat('name'), b.name, { max: 40, required: true }),
    title: text(ctx, p.concat('title'), b.title, { max: 160 }),
    loc: text(ctx, p.concat('loc'), b.loc, { max: 120 }),
    ketua: null,
    start: date(ctx, p.concat('start'), b.start, { required: true }),
    end: date(ctx, p.concat('end'), b.end, { required: true }),
    days: [],
    codes: {},
  };
  if (b.ketua !== null && b.ketua !== undefined && b.ketua !== '') out.ketua = id(ctx, p.concat('ketua'), b.ketua) || null;
  if (out.start && out.end && out.end < out.start) err(ctx, p.concat('end'), 'Tanggal selesai blok sebelum tanggal mulai.');

  if (!isObj(b.codes)) {
    err(ctx, p.concat('codes'), 'Daftar kode dosen harus berupa objek.');
  } else {
    const entries = Object.entries(b.codes);
    if (entries.length > LIMITS.codes) err(ctx, p.concat('codes'), `Maksimal ${LIMITS.codes} kode.`);
    else {
      for (const [code, dosenId] of entries) {
        const cp = p.concat('codes', code);
        if (!CODE_RE.test(code)) err(ctx, cp, 'Kode cuma boleh huruf kapital dan angka, maksimal 8.');
        else if (id(ctx, cp, dosenId)) out.codes[code] = dosenId;
      }
    }
  }
  const codes = new Set(Object.keys(out.codes));

  const days = list(ctx, p.concat('days'), b.days, LIMITS.days);
  uniqueIds(ctx, p.concat('days'), days, 'd');
  out.days = days.map((d, i) => {
    const dp = p.concat('days', i);
    if (!isObj(d)) {
      err(ctx, dp, 'Hari harus berupa objek.');
      return null;
    }
    noteUnknown(ctx, dp, d, ['d', 's', 'libur']);
    const day = { d: date(ctx, dp.concat('d'), d.d, { required: true }), s: [] };
    if (day.d && out.start && out.end && (day.d < out.start || day.d > out.end)) {
      warn(ctx, dp.concat('d'), 'Hari ini di luar tanggal mulai dan selesai blok.');
    }
    const sessions = list(ctx, dp.concat('s'), d.s, LIMITS.sessions);
    day.s = sessions.map((x, j) => validateSession(ctx, dp.concat('s', j), x, codes));
    warnOverlaps(ctx, dp.concat('s'), day.s);
    // Sorted by start time so the portal can rely on the order.
    day.s.sort((a, c) => (a && c ? toMinutes(a.s) - toMinutes(c.s) : 0));
    const libur = text(ctx, dp.concat('libur'), d.libur, { max: 120 });
    if (libur) day.libur = libur;
    return day;
  });
  out.days.sort((a, c) => (a && c ? (a.d < c.d ? -1 : a.d > c.d ? 1 : 0) : 0));
  return out;
}

function validateSchedule(ctx, value) {
  const doc = root(ctx, value, 'bloks', ['v', 'cls', 'bloks']);
  if (!doc) return null;
  const items = list(ctx, ['bloks'], doc.bloks, LIMITS.bloks);
  uniqueIds(ctx, ['bloks'], items);
  return {
    v: FORMAT_VERSION,
    cls: text(ctx, ['cls'], doc.cls, { max: 40 }),
    bloks: items.map((b, i) => validateBlok(ctx, ['bloks', i], b)),
  };
}

/* ---------- dosen ---------- */

function validateDosen(ctx, value) {
  const doc = root(ctx, value, 'list', ['v', 'list']);
  if (!doc) return null;
  const items = list(ctx, ['list'], doc.list, LIMITS.dosen);
  uniqueIds(ctx, ['list'], items);
  const out = items.map((x, i) => {
    const p = ['list', i];
    if (!isObj(x)) {
      err(ctx, p, 'Data dosen harus berupa objek.');
      return null;
    }
    noteUnknown(ctx, p, x, ['id', 'name', 'spec', 'phones', 'bloks', 'codes']);
    const person = {
      id: id(ctx, p.concat('id'), x.id),
      name: text(ctx, p.concat('name'), x.name, { max: 120, required: true }),
      spec: text(ctx, p.concat('spec'), x.spec, { max: 60 }),
      phones: [],
      bloks: [],
      codes: {},
    };
    // f and wa are always rebuilt from n, so a document can never show one
    // number and send WhatsApp to another.
    for (const [j, ph] of list(ctx, p.concat('phones'), x.phones, LIMITS.phones).entries()) {
      const raw = isObj(ph) ? ph.n : ph;
      const norm = normalizePhone(typeof raw === 'string' ? raw : '');
      if (!norm) err(ctx, p.concat('phones', j), 'Nomor telepon tidak dikenali.');
      else if (!person.phones.some((q) => q.n === norm.n)) person.phones.push(norm);
    }
    for (const [j, b] of list(ctx, p.concat('bloks'), x.bloks, LIMITS.dosenBloks, { required: false }).entries()) {
      const bid = id(ctx, p.concat('bloks', j), b);
      if (bid && !person.bloks.includes(bid)) person.bloks.push(bid);
    }
    if (x.codes !== undefined && x.codes !== null) {
      if (!isObj(x.codes)) err(ctx, p.concat('codes'), 'Harus berupa objek.');
      else {
        for (const [bid, code] of Object.entries(x.codes).slice(0, LIMITS.dosenBloks)) {
          if (ID_RE.test(bid) && typeof code === 'string' && CODE_RE.test(code)) person.codes[bid] = code;
          else err(ctx, p.concat('codes', bid), 'Kode tidak valid.');
        }
      }
    }
    return person;
  });
  return { v: FORMAT_VERSION, list: out };
}

/* ---------- heart ---------- */

function validateHeart(ctx, value) {
  const doc = root(ctx, value, 'parts', ['v', 'parts']);
  if (!doc) return null;
  const items = list(ctx, ['parts'], doc.parts, HEART_IDS.length);
  uniqueIds(ctx, ['parts'], items);
  const parts = items.map((x, i) => {
    const p = ['parts', i];
    if (!isObj(x)) {
      err(ctx, p, 'Bagian harus berupa objek.');
      return null;
    }
    noteUnknown(ctx, p, x, ['id', 'name', 'latin', 'en', 'group', 'summary', 'anatomy', 'function', 'numbers', 'supply', 'clinical', 'ecg', 'related']);
    if (!HEART_IDS.includes(x.id)) err(ctx, p.concat('id'), 'ID bagian ini tidak ada di model 3D.');
    const out = {
      id: x.id,
      name: text(ctx, p.concat('name'), x.name, { max: 80, required: true }),
      latin: text(ctx, p.concat('latin'), x.latin, { max: 160 }),
      en: text(ctx, p.concat('en'), x.en, { max: 80 }),
      group: HEART_GROUPS.includes(x.group) ? x.group : (err(ctx, p.concat('group'), 'Grup tidak dikenal.'), ''),
      summary: text(ctx, p.concat('summary'), x.summary, { max: 600, multiline: true }),
      anatomy: list(ctx, p.concat('anatomy'), x.anatomy, LIMITS.heartList)
        .map((s, j) => text(ctx, p.concat('anatomy', j), s, { max: 1200, multiline: true }))
        .filter(Boolean),
      function: text(ctx, p.concat('function'), x.function, { max: 1500, multiline: true }),
      numbers: list(ctx, p.concat('numbers'), x.numbers, LIMITS.heartList)
        .map((n, j) => {
          const np = p.concat('numbers', j);
          if (!isObj(n)) return err(ctx, np, 'Harus berupa objek {k, v}.'), null;
          return { k: text(ctx, np.concat('k'), n.k, { max: 120, required: true }), v: text(ctx, np.concat('v'), n.v, { max: 200, required: true }) };
        })
        .filter(Boolean),
      supply: text(ctx, p.concat('supply'), x.supply, { max: 1500, multiline: true }),
      clinical: list(ctx, p.concat('clinical'), x.clinical, LIMITS.heartList)
        .map((c, j) => {
          const cp = p.concat('clinical', j);
          if (!isObj(c)) return err(ctx, cp, 'Harus berupa objek {t, d}.'), null;
          return { t: text(ctx, cp.concat('t'), c.t, { max: 120, required: true }), d: text(ctx, cp.concat('d'), c.d, { max: 1200, multiline: true }) };
        })
        .filter(Boolean),
      ecg: text(ctx, p.concat('ecg'), x.ecg, { max: 1500, multiline: true }),
      related: [],
    };
    for (const [j, r] of list(ctx, p.concat('related'), x.related, LIMITS.heartRelated, { required: false }).entries()) {
      if (!HEART_IDS.includes(r) || r === x.id) err(ctx, p.concat('related', j), 'Bagian terkait tidak dikenal.');
      else if (!out.related.includes(r)) out.related.push(r);
    }
    return out;
  });
  const have = new Set(parts.map((x) => x && x.id));
  const missing = HEART_IDS.filter((x) => !have.has(x));
  if (missing.length) err(ctx, ['parts'], `Bagian hilang: ${missing.join(', ')}.`);
  return { v: FORMAT_VERSION, parts };
}

/* ---------- entry points ---------- */

const VALIDATORS = {
  links: validateLinks,
  announcements: validateAnnouncements,
  schedule: validateSchedule,
  dosen: validateDosen,
  heart: validateHeart,
};

export function validate(key, value) {
  const ctx = makeCtx();
  const fn = VALIDATORS[key];
  if (!fn) {
    err(ctx, [], `Kunci konten tidak dikenal: ${key}`);
    return { ok: false, data: null, ...ctx };
  }
  let data = null;
  try {
    data = fn(ctx, value);
  } catch (e) {
    // A validator should never throw, but a bad document must not take the page down if one does.
    err(ctx, [], 'Dokumen tidak bisa dibaca: ' + (e && e.message ? e.message : String(e)));
  }
  const ok = ctx.errors.length === 0 && data !== null;
  return { ok, data: ok ? data : null, errors: ctx.errors, warnings: ctx.warnings };
}

// For text that comes from a file, a textarea or Firestore.
export function validateJsonText(key, raw) {
  if (typeof raw !== 'string') return { ok: false, data: null, errors: [{ path: [], msg: 'Isi harus berupa teks JSON.' }], warnings: [] };
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > MAX_JSON_BYTES) {
    return { ok: false, data: null, errors: [{ path: [], msg: `Terlalu besar (${Math.round(bytes / 1000)} KB, batas ${MAX_JSON_BYTES / 1000} KB).` }], warnings: [] };
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    return { ok: false, data: null, errors: [{ path: [], msg: 'JSON tidak valid: ' + jsonErrorWhere(raw, e) }], warnings: [] };
  }
  return validate(key, value);
}

function jsonErrorWhere(raw, e) {
  const msg = e && e.message ? e.message : String(e);
  const m = /position (\d+)/.exec(msg);
  if (!m) return msg;
  const pos = +m[1];
  const before = raw.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  return `baris ${line}, kolom ${col}.`;
}

export function byteLength(s) {
  return new TextEncoder().encode(s).length;
}
