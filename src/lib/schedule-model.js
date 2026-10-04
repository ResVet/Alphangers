// Schedule model for Class Alpha. Pure functions only: no DOM, no storage, no clock reads.
// Every function that cares about "now" takes it as an argument (ms since epoch or a Date),
// so the UI and the tests decide what time it is.

// Palembang runs on WIB. Indonesia has had no daylight saving since 1964, so a fixed
// +07:00 offset is exact and avoids depending on the device's time zone or its ICU data.
export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

// Some exams are listed as "08.00 - selesai". Calendars need an end, and "is it still running"
// needs one too, so those sessions are treated as four hours long (the CBT and Her Dini slots
// that do have an end time run four to four and a half hours).
export const OPEN_END_MINUTES = 240;

export const KIND_LABELS = {
  kuliah: 'Kuliah',
  praktikum: 'Praktikum',
  skilllab: 'Skill Lab',
  tutorial: 'Tutorial',
  ujian: 'Ujian',
  pleno: 'Pleno',
  mkdu: 'MKDU',
  intro: 'Pengantar blok',
};

export const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const DAYS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
export const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function kindLabel(kind) {
  return KIND_LABELS[kind] || (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'Sesi');
}

// ---------- calendar dates as 'YYYY-MM-DD' strings ----------

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value) {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  return toISO(Date.UTC(y, mo - 1, d)) === value;
}

export function parseISO(iso) {
  const m = ISO_RE.exec(iso || '');
  if (!m) throw new Error('Not a YYYY-MM-DD date: ' + iso);
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// ms is read with UTC getters, so callers pass a UTC midnight or an already shifted WIB instant
function toISO(ms) {
  const t = new Date(ms);
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}

function isoToUTC(iso) {
  const { y, m, d } = parseISO(iso);
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso, n) {
  return toISO(isoToUTC(iso) + n * DAY_MS);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((isoToUTC(toIso) - isoToUTC(fromIso)) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday, same as Date#getDay */
export function weekdayOf(iso) {
  return new Date(isoToUTC(iso)).getUTCDay();
}

export function isWeekend(iso) {
  const w = weekdayOf(iso);
  return w === 0 || w === 6;
}

/** Monday of the week that contains iso. Indonesian calendars start the week on Monday. */
export function startOfWeek(iso) {
  return addDays(iso, -((weekdayOf(iso) + 6) % 7));
}

export function monthOf(iso) {
  const { y, m } = parseISO(iso);
  return { y, m };
}

export function addMonths(y, m, n) {
  const idx = y * 12 + (m - 1) + n;
  return { y: Math.floor(idx / 12), m: (idx % 12 + 12) % 12 + 1 };
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Six Monday-first weeks covering the month, so the calendar never changes height. */
export function monthGrid(y, m) {
  const first = y + '-' + pad(m) + '-01';
  let day = startOfWeek(first);
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// ---------- WIB clock ----------

export function toMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number' && Number.isFinite(now)) return now;
  throw new TypeError('now must be a Date or a number of ms');
}

/** Wall-clock reading in Palembang for an instant, whatever the device's own time zone is. */
export function wibParts(now) {
  const t = new Date(toMs(now) + WIB_OFFSET_MS);
  const hh = t.getUTCHours();
  const mm = t.getUTCMinutes();
  return {
    date: toISO(t.getTime()),
    hh,
    mm,
    ss: t.getUTCSeconds(),
    minutes: hh * 60 + mm,
    weekday: t.getUTCDay(),
  };
}

export function todayWIB(now) {
  return wibParts(now).date;
}

/** The instant (ms since epoch) of a WIB wall-clock time on a date. */
export function wibToMs(iso, hhmm = '00:00') {
  const { y, m, d } = parseISO(iso);
  const [h, mi] = String(hhmm).split(':').map(Number);
  return Date.UTC(y, m - 1, d, h || 0, mi || 0) - WIB_OFFSET_MS;
}

// ---------- formatting ----------

export function formatTime(hhmm) {
  return hhmm ? hhmm.replace(':', '.') : '';
}

export function formatDate(iso, style = 'long') {
  const { y, m, d } = parseISO(iso);
  const w = weekdayOf(iso);
  switch (style) {
    case 'short': return DAYS_SHORT[w] + ', ' + d + ' ' + MONTHS_SHORT[m - 1];
    case 'medium': return DAYS[w] + ', ' + d + ' ' + MONTHS_SHORT[m - 1];
    case 'day': return d + ' ' + MONTHS[m - 1];
    case 'dayShort': return d + ' ' + MONTHS_SHORT[m - 1];
    case 'month': return MONTHS[m - 1] + ' ' + y;
    default: return DAYS[w] + ', ' + d + ' ' + MONTHS[m - 1] + ' ' + y;
  }
}

/** 'hari ini', 'besok', 'kemarin', 'lusa' or '' relative to today (both ISO dates). */
export function relativeDay(iso, today) {
  const diff = daysBetween(today, iso);
  if (diff === 0) return 'hari ini';
  if (diff === 1) return 'besok';
  if (diff === 2) return 'lusa';
  if (diff === -1) return 'kemarin';
  return '';
}

export function countdownParts(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor(total / 3600) % 24,
    minutes: Math.floor(total / 60) % 60,
    seconds: total % 60,
    totalSeconds: total,
  };
}

/** Under a day: 'HH:MM:SS'. A day or more: '2 hari 4 jam'. */
export function formatCountdown(ms) {
  const p = countdownParts(ms);
  if (p.days >= 1) return p.days + ' hari' + (p.hours ? ' ' + p.hours + ' jam' : '');
  return pad(p.hours) + ':' + pad(p.minutes) + ':' + pad(p.seconds);
}

/** Whole calendar days until a date, phrased the way people say it. */
export function daysUntilLabel(iso, today) {
  const diff = daysBetween(today, iso);
  if (diff === 0) return 'hari ini';
  if (diff === 1) return 'besok';
  if (diff < 0) return Math.abs(diff) + ' hari lalu';
  return diff + ' hari lagi';
}

// ---------- text matching ----------

/** Lower case, accents and punctuation removed: 'Sp.OG' and 'SpOG' both become 'spog'. */
export function compact(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function queryTokens(query) {
  return String(query ?? '')
    .split(/\s+/)
    .map(compact)
    .filter(Boolean);
}

function hashString(text) {
  // FNV-1a, 32 bit. Enough to tell two titles on the same slot apart.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ---------- the model ----------

function resolveLecturers(codes, blok, dosenById) {
  return (Array.isArray(codes) ? codes : []).map((code) => {
    const id = blok.codes?.[code] ?? null;
    const dosen = id ? dosenById.get(id) || null : null;
    return { code, id, dosen };
  });
}

function resolveSession(raw, blok, date, dosenById) {
  const start = typeof raw.s === 'string' && raw.s ? raw.s : '00:00';
  const end = typeof raw.e === 'string' && raw.e ? raw.e : null;
  const startAt = wibToMs(date, start);
  let endAt = end ? wibToMs(date, end) : startAt + OPEN_END_MINUTES * 60000;
  if (endAt <= startAt) endAt = startAt + OPEN_END_MINUTES * 60000;
  const title = String(raw.t ?? '').trim() || kindLabel(raw.k);
  return {
    uid: '',
    blokId: blok.id,
    blok,
    date,
    start,
    end,
    openEnd: !end,
    startAt,
    endAt,
    title,
    kind: raw.k || 'kuliah',
    kindLabel: kindLabel(raw.k || 'kuliah'),
    note: raw.n ? String(raw.n) : '',
    pj: !!raw.pj,
    tim: !!raw.tim,
    lecturers: resolveLecturers(raw.dz, blok, dosenById),
  };
}

function sessionHaystack(s) {
  const people = s.lecturers.map((l) => (l.dosen ? l.dosen.name : '') + ' ' + l.code).join(' ');
  return compact([s.title, s.kindLabel, s.note, people, s.blok.name, s.tim ? 'tim' : ''].join('|'));
}

/**
 * Builds lookups over schedule.json and dosen.json.
 * Tolerates missing pieces: unknown lecturer codes keep their code with dosen null,
 * days without sessions stay listed (with their libur note), bad dates are skipped.
 */
export function createModel(schedule, dosenData) {
  const dosenList = Array.isArray(dosenData?.list) ? dosenData.list : [];
  const dosenById = new Map(dosenList.map((p) => [p.id, p]));

  const bloks = (Array.isArray(schedule?.bloks) ? schedule.bloks : [])
    .filter((b) => b && isISODate(b.start) && isISODate(b.end))
    .map((b) => ({
      id: b.id,
      name: b.name || b.id,
      title: b.title || '',
      loc: b.loc || '',
      ketua: b.ketua || null,
      start: b.start,
      end: b.end,
      codes: b.codes || {},
      raw: b,
    }))
    .sort((a, b) => (a.start < b.start ? -1 : 1));

  const days = new Map();
  const sessions = [];
  const uids = new Set();

  for (const blok of bloks) {
    for (const day of Array.isArray(blok.raw.days) ? blok.raw.days : []) {
      if (!day || !isISODate(day.d)) continue;
      const info = days.get(day.d) || { date: day.d, blok, libur: '', sessions: [] };
      if (day.libur) info.libur = String(day.libur);
      for (const raw of Array.isArray(day.s) ? day.s : []) {
        if (!raw) continue;
        const s = resolveSession(raw, blok, day.d, dosenById);
        // built from what the session is, not where it sits in the file, so a rebuilt
        // schedule keeps the same UID and calendar apps update the event instead of duplicating it
        const base = 'alpha-' + blok.id + '-' + day.d.replaceAll('-', '') + 't' + s.start.replace(':', '') + '-' + hashString(s.title);
        let uid = base;
        for (let n = 2; uids.has(uid); n++) uid = base + '-' + n;
        uids.add(uid);
        s.uid = uid;
        info.sessions.push(s);
        sessions.push(s);
      }
      days.set(day.d, info);
    }
  }

  for (const info of days.values()) info.sessions.sort((a, b) => a.startAt - b.startAt);
  sessions.sort((a, b) => a.startAt - b.startAt || (a.title < b.title ? -1 : 1));

  const dates = [...days.values()].filter((d) => d.sessions.length).map((d) => d.date).sort();
  const firstDate = dates[0] || bloks[0]?.start || null;
  const lastDate = dates[dates.length - 1] || bloks[bloks.length - 1]?.end || null;

  const byDosen = new Map();
  for (const s of sessions) {
    for (const l of s.lecturers) {
      if (!l.id) continue;
      if (!byDosen.has(l.id)) byDosen.set(l.id, []);
      const list = byDosen.get(l.id);
      if (list[list.length - 1] !== s) list.push(s);
    }
  }

  const haystacks = new Map(sessions.map((s) => [s, sessionHaystack(s)]));

  function blokFor(iso) {
    return bloks.find((b) => iso >= b.start && iso <= b.end) || null;
  }

  function blokById(id) {
    return bloks.find((b) => b.id === id) || null;
  }

  function dayInfo(iso) {
    const info = days.get(iso);
    if (info) return info;
    return { date: iso, blok: blokFor(iso), libur: '', sessions: [] };
  }

  function sessionsOn(iso) {
    return days.get(iso)?.sessions || [];
  }

  function hasSessions(iso) {
    return sessionsOn(iso).length > 0;
  }

  /** First date with sessions strictly after iso, or null. */
  function nextDate(iso) {
    return dates.find((d) => d > iso) || null;
  }

  /** Last date with sessions strictly before iso, or null. */
  function prevDate(iso) {
    for (let i = dates.length - 1; i >= 0; i--) if (dates[i] < iso) return dates[i];
    return null;
  }

  /** iso itself when it has sessions, else the next class day, else the previous one. */
  function nearestDate(iso) {
    if (hasSessions(iso)) return iso;
    return nextDate(iso) || prevDate(iso);
  }

  /**
   * What is happening at `now`: sessions running (more than one when the official
   * schedule overlaps), the next one to start, and today's date in WIB.
   */
  function nowAndNext(now) {
    const t = toMs(now);
    const running = [];
    let next = null;
    for (const s of sessions) {
      if (s.startAt <= t && t < s.endAt) running.push(s);
      else if (s.startAt > t) {
        next = s;
        break;
      }
    }
    return { today: todayWIB(t), running, next, now: t };
  }

  /** The first exam that has not finished yet, optionally within one blok. */
  function nextUjian(now, blokId) {
    const t = toMs(now);
    return sessions.find((s) => s.kind === 'ujian' && s.endAt > t && (!blokId || s.blokId === blokId)) || null;
  }

  function nextUjianPerBlok(now) {
    return bloks.map((blok) => ({ blok, ujian: nextUjian(now, blok.id) }));
  }

  function sessionsByDosen(id) {
    return byDosen.get(id) || [];
  }

  /** Dates with sessions in a month (m is 1-12), for the calendar dots. */
  function datesInMonth(y, m) {
    const prefix = y + '-' + pad(m) + '-';
    return new Set(dates.filter((d) => d.startsWith(prefix)));
  }

  /** Sessions whose title, kind, note, lecturer name or code contain every word of the query. */
  function search(query, limit = Infinity) {
    const tokens = queryTokens(query);
    if (!tokens.length) return [];
    const out = [];
    for (const s of sessions) {
      const hay = haystacks.get(s);
      if (tokens.every((t) => hay.includes(t))) {
        out.push(s);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  return {
    bloks,
    sessions,
    dates,
    firstDate,
    lastDate,
    dosenById,
    blokFor,
    blokById,
    dayInfo,
    sessionsOn,
    hasSessions,
    nextDate,
    prevDate,
    nearestDate,
    nowAndNext,
    nextUjian,
    nextUjianPerBlok,
    sessionsByDosen,
    datesInMonth,
    search,
  };
}
