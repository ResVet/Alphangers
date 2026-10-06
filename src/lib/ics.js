// iCalendar (RFC 5545) export for schedule sessions, plus a Google Calendar link.
// Builders are pure; only downloadICS touches the DOM.

import { WIB_OFFSET_MS, formatDate, formatTime, OPEN_END_MINUTES } from './schedule-model.js';

export const CRLF = '\r\n';
export const TZID = 'Asia/Jakarta';
const PRODID = '-//Alphangers//Jadwal Kelas Alpha//ID';

// Jakarta has used +07:00 all year since 1964, so one STANDARD block with no recurrence is the full rule set.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:' + TZID,
  'X-LIC-LOCATION:' + TZID,
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0700',
  'TZOFFSETTO:+0700',
  'TZNAME:WIB',
  'DTSTART:19700101T000000',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** TEXT value escaping from RFC 5545 section 3.3.11. */
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const encoder = new TextEncoder();

/**
 * Folds one content line so no physical line is longer than 75 octets (excluding CRLF).
 * Counts UTF-8 bytes and never splits a character; continuation lines start with one space,
 * which counts toward their 75.
 */
export function foldLine(line) {
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = ' ';
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join(CRLF);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** '2026-10-05' + '08:00' to '20261005T080000' (local time, used with TZID). */
export function localStamp(iso, hhmm) {
  return iso.replaceAll('-', '') + 'T' + hhmm.replace(':', '') + '00';
}

/** An instant as a UTC DATE-TIME, e.g. '20261003T013000Z'. */
export function utcStamp(ms) {
  const t = new Date(ms);
  return t.getUTCFullYear() + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate()) + 'T' +
    pad(t.getUTCHours()) + pad(t.getUTCMinutes()) + pad(t.getUTCSeconds()) + 'Z';
}

/** WIB wall-clock end of a session as 'HH:MM', estimating one when the schedule says "selesai". */
export function endTime(session) {
  if (session.end) return session.end;
  const wib = new Date(session.endAt + WIB_OFFSET_MS);
  return pad(wib.getUTCHours()) + ':' + pad(wib.getUTCMinutes());
}

function lecturerLine(session) {
  if (session.tim) return 'Dosen: tim, per kelompok';
  const names = session.lecturers.map((l) => {
    if (!l.dosen) return 'kode ' + l.code;
    const phone = l.dosen.phones?.[0]?.f;
    return l.dosen.name + (phone ? ' (' + phone + ')' : '');
  });
  if (!names.length) return '';
  return (session.pj ? 'PJ: ' : 'Dosen: ') + names.join('; ');
}

/** Plain-text description shared by the .ics file and the Google Calendar link. */
export function describe(session) {
  const blok = session.blok;
  const lines = [session.kindLabel + ', ' + blok.name + (blok.title ? ' (' + blok.title + ')' : '')];
  const who = lecturerLine(session);
  if (who) lines.push(who);
  if (session.cancelled) lines.push('Sesi ini dibatalkan' + (session.cancelReason ? ': ' + session.cancelReason : '.'));
  if (session.note) lines.push('Catatan: ' + session.note);
  if (session.online) lines.push('Online' + (session.link ? ': ' + session.link : ', dari tempat masing-masing.'));
  if (session.tags && session.tags.length) lines.push('Tag: ' + session.tags.join(', '));
  if (session.openEnd) {
    lines.push('Di jadwal tertulis ' + formatTime(session.start) + ' sampai selesai. Di kalender dibuat ' + OPEN_END_MINUTES / 60 + ' jam.');
  }
  lines.push('Kelas Alpha, PSPD FK Unsri');
  return lines.join('\n');
}

function eventLines(session, stamp) {
  return [
    'BEGIN:VEVENT',
    'UID:' + session.uid + '@alphangers',
    'DTSTAMP:' + utcStamp(stamp),
    'DTSTART;TZID=' + TZID + ':' + localStamp(session.date, session.start),
    'DTEND;TZID=' + TZID + ':' + localStamp(session.date, endTime(session)),
    'SUMMARY:' + escapeText((session.cancelled ? 'DIBATALKAN: ' : '') + session.title),
    // calendar apps show a cancelled event struck through instead of dropping it
    session.cancelled ? 'STATUS:CANCELLED' : null,
    // online sessions: the meeting link (or just "Online") instead of the block's room
    session.online ? 'LOCATION:' + escapeText(session.link || 'Online') : session.blok.loc ? 'LOCATION:' + escapeText(session.blok.loc) : null,
    session.online && /^https:\/\/[^\s]+$/i.test(session.link) ? 'URL:' + session.link : null,
    'DESCRIPTION:' + escapeText(describe(session)),
    'CATEGORIES:' + [session.kindLabel, ...(session.tags || [])].map(escapeText).join(','),
    'END:VEVENT',
  ].filter(Boolean);
}

/**
 * A complete VCALENDAR for any list of sessions.
 * `stamp` (ms) fills DTSTAMP; pass a fixed value for reproducible output.
 */
export function buildCalendar(sessions, { name = 'Jadwal Kelas Alpha', stamp = Date.now() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:' + PRODID,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeText(name),
    'X-WR-TIMEZONE:' + TZID,
    ...VTIMEZONE,
  ];
  for (const s of sessions) lines.push(...eventLines(s, stamp));
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

export function sessionCalendar(session, opts = {}) {
  return buildCalendar([session], { name: session.title, ...opts });
}

export function dayCalendar(sessions, date, opts = {}) {
  return buildCalendar(sessions, { name: 'Kelas Alpha, ' + formatDate(date, 'medium'), ...opts });
}

export function blokCalendar(sessions, blok, opts = {}) {
  return buildCalendar(sessions, { name: 'Kelas Alpha, ' + blok.name, ...opts });
}

function slug(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sesi';
}

export function sessionFilename(session) {
  return 'alpha-' + session.date + '-' + slug(session.title) + '.ics';
}

export function dayFilename(date) {
  return 'alpha-' + date + '.ics';
}

export function blokFilename(blok) {
  return 'alpha-' + slug(blok.name) + '.ics';
}

/** Google Calendar "add event" link. Times are WIB wall-clock, pinned with ctz. */
export function googleCalendarUrl(session) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: session.title,
    dates: localStamp(session.date, session.start) + '/' + localStamp(session.date, endTime(session)),
    ctz: TZID,
    details: describe(session),
  });
  if (session.online) params.set('location', session.link || 'Online');
  else if (session.blok.loc) params.set('location', session.blok.loc);
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

/** Saves text as a .ics file through a temporary object URL. Browser only. */
export function downloadICS(text, filename) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoking right away can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
