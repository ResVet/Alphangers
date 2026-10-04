// Unit tests for src/lib/schedule-model.js and src/lib/ics.js.
// Run: node --test tests/schedule-model.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  createModel, todayWIB, wibParts, wibToMs, addDays, weekdayOf, startOfWeek, monthGrid, addMonths,
  formatDate, formatTime, formatCountdown, daysUntilLabel, relativeDay, compact, kindLabel, isISODate,
  KIND_LABELS, OPEN_END_MINUTES,
} from '../src/lib/schedule-model.js';
import {
  buildCalendar, dayCalendar, blokCalendar, sessionCalendar, foldLine, escapeText, googleCalendarUrl,
  endTime, CRLF,
} from '../src/lib/ics.js';

const root = new URL('..', import.meta.url);
const schedule = JSON.parse(readFileSync(new URL('src/data/schedule.json', root), 'utf8'));
const dosen = JSON.parse(readFileSync(new URL('src/data/dosen.json', root), 'utf8'));
const model = createModel(schedule, dosen);

// 'YYYY-MM-DD HH:MM' in WIB to an instant
const wib = (date, time = '00:00') => wibToMs(date, time);

describe('WIB clock', () => {
  test('today follows Palembang, not UTC', () => {
    assert.equal(todayWIB(Date.UTC(2026, 9, 2, 16, 59, 59)), '2026-10-02');
    assert.equal(todayWIB(Date.UTC(2026, 9, 2, 17, 0, 0)), '2026-10-03');
    assert.equal(todayWIB(new Date('2026-10-03T23:59:00+07:00')), '2026-10-03');
  });

  test('wibParts reads wall-clock time', () => {
    const p = wibParts(Date.UTC(2026, 9, 5, 2, 15, 30));
    assert.deepEqual([p.date, p.hh, p.mm, p.ss, p.minutes, p.weekday], ['2026-10-05', 9, 15, 30, 555, 1]);
  });

  test('wibToMs is the inverse', () => {
    assert.equal(wibToMs('2026-10-05', '08:00'), Date.UTC(2026, 9, 5, 1, 0));
    assert.equal(wibToMs('2026-10-05', '00:30'), Date.UTC(2026, 9, 4, 17, 30));
  });

  for (const tz of ['UTC', 'America/New_York', 'Pacific/Kiritimati', 'Asia/Jakarta']) {
    test('device in ' + tz + ' still gets WIB today', () => {
      const modelUrl = new URL('src/lib/schedule-model.js', root).href;
      const script = `
        import { todayWIB, createModel, wibToMs } from ${JSON.stringify(modelUrl)};
        const late = Date.UTC(2026, 9, 2, 17, 30);   // 00:30 WIB on Saturday 3 October
        const early = Date.UTC(2026, 9, 2, 16, 30);  // 23:30 WIB on Friday 2 October
        console.log(JSON.stringify({
          offset: new Date(late).getTimezoneOffset(),
          late: todayWIB(late), early: todayWIB(early),
          start: wibToMs('2026-10-05', '08:00'),
        }));`;
      const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, TZ: tz },
        encoding: 'utf8',
      }));
      const expectedOffset = { UTC: 0, 'America/New_York': 240, 'Pacific/Kiritimati': -840, 'Asia/Jakarta': -420 }[tz];
      assert.equal(out.offset, expectedOffset, 'child process really runs in ' + tz);
      assert.equal(out.late, '2026-10-03');
      assert.equal(out.early, '2026-10-02');
      assert.equal(out.start, Date.UTC(2026, 9, 5, 1, 0));
    });
  }
});

describe('date helpers', () => {
  test('addDays crosses months and years', () => {
    assert.equal(addDays('2026-09-30', 1), '2026-10-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  test('weekday and Monday weeks', () => {
    assert.equal(weekdayOf('2026-10-03'), 6);
    assert.equal(startOfWeek('2026-10-03'), '2026-09-28');
    assert.equal(startOfWeek('2026-10-04'), '2026-09-28');
    assert.equal(startOfWeek('2026-10-05'), '2026-10-05');
  });

  test('monthGrid is six Monday-first weeks', () => {
    const grid = monthGrid(2026, 10);
    assert.equal(grid.length, 6);
    assert.ok(grid.every((w) => w.length === 7));
    assert.equal(grid[0][0], '2026-09-28');
    assert.equal(grid[0][3], '2026-10-01');
    assert.equal(grid[5][6], '2026-11-08');
  });

  test('addMonths wraps years', () => {
    assert.deepEqual(addMonths(2026, 12, 1), { y: 2027, m: 1 });
    assert.deepEqual(addMonths(2026, 1, -1), { y: 2025, m: 12 });
  });

  test('isISODate rejects impossible dates', () => {
    assert.ok(isISODate('2026-10-05'));
    assert.ok(!isISODate('2026-02-30'));
    assert.ok(!isISODate('5/10/2026'));
    assert.ok(!isISODate(undefined));
  });

  test('Indonesian formatting', () => {
    assert.equal(formatDate('2026-10-05'), 'Senin, 5 Oktober 2026');
    assert.equal(formatDate('2026-10-05', 'medium'), 'Senin, 5 Okt');
    assert.equal(formatDate('2026-10-05', 'short'), 'Sen, 5 Okt');
    assert.equal(formatDate('2026-08-17', 'month'), 'Agustus 2026');
    assert.equal(formatTime('08:00'), '08.00');
    assert.equal(relativeDay('2026-10-04', '2026-10-03'), 'besok');
    assert.equal(relativeDay('2026-10-09', '2026-10-03'), '');
    assert.equal(daysUntilLabel('2026-10-26', '2026-10-03'), '23 hari lagi');
    assert.equal(daysUntilLabel('2026-10-03', '2026-10-03'), 'hari ini');
  });

  test('countdown text', () => {
    assert.equal(formatCountdown(3725000), '01:02:05');
    assert.equal(formatCountdown(0), '00:00:00');
    assert.equal(formatCountdown(-5000), '00:00:00');
    assert.equal(formatCountdown((2 * 24 + 4) * 3600e3 + 59e3), '2 hari 4 jam');
    assert.equal(formatCountdown(24 * 3600e3), '1 hari');
  });

  test('compact folds titles, case and accents', () => {
    assert.equal(compact('Sp.OG(K)'), 'spogk');
    assert.equal(compact('Dr. dr. Aryani Azis'), 'drdraryaniazis');
    assert.equal(compact('Café'), 'cafe');
  });

  test('kind labels in Indonesian', () => {
    assert.equal(kindLabel('skilllab'), 'Skill Lab');
    assert.equal(kindLabel('intro'), 'Pengantar blok');
    assert.equal(Object.keys(KIND_LABELS).length, 8);
    assert.equal(kindLabel('seminar'), 'Seminar');
  });
});

describe('schedule model', () => {
  test('counts match the data', () => {
    assert.equal(model.bloks.length, 3);
    assert.equal(model.sessions.length, 119);
    assert.equal(model.dates.length, 52, '53 days, one of them a holiday without sessions');
    assert.equal(model.firstDate, '2026-08-18');
    assert.equal(model.lastDate, '2026-10-30');
  });

  test('sessions for a date resolve lecturers to dosen objects', () => {
    const day = model.sessionsOn('2026-10-05');
    assert.equal(day.length, 3);
    assert.equal(day[0].title, 'Tutorial 1 Skenario A');
    assert.equal(day[0].tim, true);
    assert.deepEqual(day[0].lecturers, []);
    const ri = day[1].lecturers[0];
    assert.equal(ri.code, 'RI');
    assert.equal(ri.id, 'rara-inggarsih');
    assert.equal(ri.dosen.name, 'Rara Inggarsih, S.S.T., M.Kes');
    assert.equal(day[1].blok.loc, 'Kampus FK Unsri KM.6');
    assert.equal(day[1].kindLabel, 'Kuliah');
  });

  test('PJ sessions keep every listed lecturer', () => {
    const pedigree = model.sessionsOn('2026-10-12')[1];
    assert.equal(pedigree.pj, true);
    assert.deepEqual(pedigree.lecturers.map((l) => l.id), ['triwani', 'djoko-marwoto']);
  });

  test('blok for a date', () => {
    assert.equal(model.blokFor('2026-08-18').id, 'b1');
    assert.equal(model.blokFor('2026-09-25').id, 'b2');
    assert.equal(model.blokFor('2026-10-03').id, 'b3', 'weekend inside blok 3');
    assert.equal(model.blokFor('2026-09-05'), null, 'weekend between blok 1 and 2');
    assert.equal(model.blokFor('2026-12-01'), null);
  });

  test('weekend: no sessions, jumps go to Monday or back to Friday', () => {
    assert.equal(model.hasSessions('2026-10-03'), false);
    assert.equal(model.nextDate('2026-10-03'), '2026-10-05');
    assert.equal(model.prevDate('2026-10-03'), '2026-10-02');
    assert.equal(model.nearestDate('2026-10-03'), '2026-10-05');
    assert.equal(model.nearestDate('2026-10-05'), '2026-10-05');
  });

  test('holiday keeps its note', () => {
    const info = model.dayInfo('2026-08-25');
    assert.equal(info.libur, 'Maulid Nabi Muhammad SAW');
    assert.equal(info.sessions.length, 0);
    assert.equal(info.blok.id, 'b1');
    assert.equal(model.hasSessions('2026-08-25'), false);
  });

  test('dates outside every blok', () => {
    assert.equal(model.dayInfo('2026-07-01').blok, null);
    assert.equal(model.nearestDate('2026-07-01'), '2026-08-18');
    assert.equal(model.nextDate('2026-12-01'), null);
    assert.equal(model.nearestDate('2026-12-01'), '2026-10-30');
    assert.equal(model.prevDate('2026-08-18'), null);
  });

  test('a session running at now, and the one after it', () => {
    const r = model.nowAndNext(wib('2026-10-05', '09:15'));
    assert.equal(r.today, '2026-10-05');
    assert.deepEqual(r.running.map((s) => s.title), ['Tutorial 1 Skenario A']);
    assert.equal(r.next.title, 'Mekanisme Kontrol Molekuler Siklus Sel');
  });

  test('start is inclusive, end is exclusive', () => {
    assert.deepEqual(model.nowAndNext(wib('2026-10-05', '08:00')).running.map((s) => s.start), ['08:00']);
    const atEnd = model.nowAndNext(wib('2026-10-05', '10:30'));
    assert.deepEqual(atEnd.running.map((s) => s.title), ['Mekanisme Kontrol Molekuler Siklus Sel']);
  });

  test('overlapping official slots both count as running', () => {
    const r = model.nowAndNext(wib('2026-08-27', '10:20'));
    assert.deepEqual(r.running.map((s) => s.kind), ['skilllab', 'kuliah']);
  });

  test('a weekend points to Monday morning', () => {
    const r = model.nowAndNext(wib('2026-10-03', '12:00'));
    assert.deepEqual(r.running, []);
    assert.equal(r.next.date, '2026-10-05');
    assert.equal(r.next.start, '08:00');
    assert.equal(r.next.startAt - wib('2026-10-03', '12:00'), (44 * 60) * 60000);
  });

  test('device time zone does not change running detection', () => {
    // 01:30 UTC is 08:30 WIB; a device in New York would call this 21:30 the day before
    const r = model.nowAndNext(Date.UTC(2026, 9, 5, 1, 30));
    assert.equal(r.running[0]?.title, 'Tutorial 1 Skenario A');
  });

  test('after the last blok there is nothing next', () => {
    const r = model.nowAndNext(wib('2026-11-02', '08:00'));
    assert.deepEqual(r.running, []);
    assert.equal(r.next, null);
    assert.equal(model.nextUjian(wib('2026-11-02')), null);
  });

  test('open-ended exams last the assumed length', () => {
    const ospe = model.sessionsOn('2026-10-26')[0];
    assert.equal(ospe.openEnd, true);
    assert.equal(ospe.end, null);
    assert.equal(ospe.endAt - ospe.startAt, OPEN_END_MINUTES * 60000);
    assert.equal(model.nowAndNext(wib('2026-10-26', '11:00')).running[0], ospe);
    assert.deepEqual(model.nowAndNext(wib('2026-10-26', '12:30')).running, []);
  });

  test('next ujian overall and per blok', () => {
    const now = wib('2026-10-03', '12:00');
    const u = model.nextUjian(now);
    assert.equal(u.title, 'Ujian OSPE Blok 3');
    assert.equal(u.date, '2026-10-26');
    assert.equal(model.nextUjian(now, 'b2'), null);
    const per = model.nextUjianPerBlok(now);
    assert.deepEqual(per.map((x) => [x.blok.id, x.ujian?.date ?? null]), [['b1', null], ['b2', null], ['b3', '2026-10-26']]);
    assert.equal(model.nextUjian(wib('2026-09-01'), 'b1').title, 'Ujian CBT Blok 1');
  });

  test('an exam in progress is still the next ujian', () => {
    assert.equal(model.nextUjian(wib('2026-10-27', '09:00')).title, 'Ujian CBT Blok 3');
  });

  test('all sessions taught by a dosen, in order', () => {
    const zm = model.sessionsByDosen('ziske-maritska');
    assert.equal(zm.length, 7);
    assert.equal(zm[0].kind, 'intro');
    assert.ok(zm.every((s, i) => i === 0 || zm[i - 1].startAt <= s.startAt));
    assert.equal(model.sessionsByDosen('sadakata-sinulingga').filter((s) => s.blokId === 'b2').length, 2);
    assert.deepEqual(model.sessionsByDosen('abarham-martadiansyah'), []);
    assert.deepEqual(model.sessionsByDosen('nobody'), []);
  });

  test('calendar dots for a month', () => {
    const oct = model.datesInMonth(2026, 10);
    assert.ok(oct.has('2026-10-05'));
    assert.ok(!oct.has('2026-10-03'));
    assert.ok(!oct.has('2026-10-29'));
    assert.equal(oct.size, 21);
    assert.equal(model.datesInMonth(2026, 8).has('2026-08-25'), false, 'holiday has no dot');
    assert.equal(model.datesInMonth(2027, 1).size, 0);
  });

  test('text search over sessions', () => {
    assert.deepEqual(model.search('pedigree').map((s) => s.date), ['2026-10-12']);
    assert.equal(model.search('ziske').length, 7);
    assert.ok(model.search('ujian blok 3').every((s) => s.kind === 'ujian'));
    assert.equal(model.search('PB-5')[0]?.title, 'PB-5 Kariotyping');
    assert.equal(model.search('praktikum', 3).length, 3);
    assert.deepEqual(model.search('   '), []);
    assert.deepEqual(model.search('zzzz-nothing'), []);
  });

  test('UIDs are unique and stable across builds', () => {
    const uids = model.sessions.map((s) => s.uid);
    assert.equal(new Set(uids).size, uids.length);
    assert.deepEqual(createModel(schedule, dosen).sessions.map((s) => s.uid), uids);
    assert.match(uids[0], /^alpha-b1-20260818t0800-[a-z0-9]+$/);
  });

  test('unknown codes, missing lecturers and broken input do not throw', () => {
    const odd = {
      bloks: [{
        id: 'b9', name: 'Blok 9', title: 'Uji', loc: '', start: '2027-01-04', end: '2027-01-08',
        codes: { KN: 'ghost-id' },
        days: [
          { d: '2027-01-04', s: [{ s: '08:00', e: '09:00', t: 'Tanpa kode', k: 'kuliah', dz: ['XX', 'KN'] }, { s: '10:00', t: 'Tanpa dz', k: 'pleno' }] },
          { d: 'not-a-date', s: [{ s: '08:00', e: '09:00', t: 'x', k: 'kuliah', dz: [] }] },
          null,
        ],
      }, { id: 'bad', start: 'nope', end: 'nope' }],
    };
    const m = createModel(odd, null);
    const s = m.sessionsOn('2027-01-04');
    assert.equal(s.length, 2);
    assert.deepEqual(s[0].lecturers, [{ code: 'XX', id: null, dosen: null }, { code: 'KN', id: 'ghost-id', dosen: null }]);
    assert.deepEqual(s[1].lecturers, []);
    assert.equal(s[1].openEnd, true);
    assert.equal(m.bloks.length, 1);
    assert.deepEqual(createModel(undefined, undefined).sessions, []);
    assert.equal(createModel({}, {}).nearestDate('2026-10-03'), null);
  });
});

describe('ics export', () => {
  const stamp = Date.UTC(2026, 9, 3, 5, 0, 0);
  const day = model.sessionsOn('2026-10-05');
  const text = dayCalendar(day, '2026-10-05', { stamp });
  const physical = text.split(CRLF);

  test('CRLF line endings only', () => {
    assert.ok(text.endsWith(CRLF));
    assert.equal(text.replaceAll(CRLF, '').includes('\n'), false);
    assert.equal(text.includes('\r\r'), false);
  });

  test('no physical line longer than 75 octets', () => {
    for (const line of physical) assert.ok(Buffer.byteLength(line) <= 75, line);
  });

  test('calendar structure with Asia/Jakarta VTIMEZONE', () => {
    assert.equal(physical[0], 'BEGIN:VCALENDAR');
    assert.ok(physical.includes('VERSION:2.0'));
    assert.ok(physical.includes('BEGIN:VTIMEZONE'));
    assert.ok(physical.includes('TZID:Asia/Jakarta'));
    assert.ok(physical.includes('TZOFFSETTO:+0700'));
    assert.equal(physical.filter((l) => l === 'BEGIN:VEVENT').length, 3);
    assert.ok(physical.includes('DTSTART;TZID=Asia/Jakarta:20261005T080000'));
    assert.ok(physical.includes('DTEND;TZID=Asia/Jakarta:20261005T103000'));
    assert.ok(physical.includes('DTSTAMP:20261003T050000Z'));
  });

  test('unfolded text keeps escaped values intact', () => {
    const unfolded = text.replaceAll(CRLF + ' ', '');
    assert.match(unfolded, /\r\nSUMMARY:Mekanisme Kontrol Molekuler Siklus Sel\r\n/);
    assert.match(unfolded, /\r\nLOCATION:Kampus FK Unsri KM\.6\r\n/);
    assert.match(unfolded, /DESCRIPTION:Kuliah\\, Blok 3 \(Karakter Biologi Tubuh Manusia\)\\nDosen: Rara Inggarsih\\, S\.S\.T\.\\, M\.Kes \(0831-7858-0581\)/);
    assert.match(unfolded, /DESCRIPTION:Tutorial\\, Blok 3.*\\nDosen: tim\\, per kelompok/);
  });

  test('UIDs are stable per session', () => {
    const again = dayCalendar(model.sessionsOn('2026-10-05'), '2026-10-05', { stamp: stamp + 1000 });
    const uidsOf = (t) => t.replaceAll(CRLF + ' ', '').split(CRLF).filter((l) => l.startsWith('UID:'));
    assert.deepEqual(uidsOf(again), uidsOf(text));
    assert.equal(new Set(uidsOf(text)).size, 3);
  });

  test('open-ended exam gets an estimated end', () => {
    const ospe = model.sessionsOn('2026-10-26')[0];
    assert.equal(endTime(ospe), '12:00');
    const t = sessionCalendar(ospe, { stamp }).replaceAll(CRLF + ' ', '');
    assert.match(t, /DTEND;TZID=Asia\/Jakarta:20261026T120000/);
    assert.match(t, /sampai selesai/);
  });

  test('whole blok export', () => {
    const b3 = model.bloks[2];
    const t = blokCalendar(model.sessions.filter((s) => s.blokId === 'b3'), b3, { stamp });
    assert.equal(t.split(CRLF).filter((l) => l === 'BEGIN:VEVENT').length, 53);
    assert.match(t, /X-WR-CALNAME:Kelas Alpha\\, Blok 3/);
  });

  test('escaping', () => {
    assert.equal(escapeText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
    assert.equal(escapeText('x\r\ny'), 'x\\ny');
  });

  test('folding counts bytes and never splits a character', () => {
    const long = 'DESCRIPTION:' + 'é'.repeat(80) + '🫀'.repeat(10);
    const folded = foldLine(long);
    for (const line of folded.split(CRLF)) {
      assert.ok(Buffer.byteLength(line) <= 75);
      assert.equal(line.includes('�'), false);
    }
    assert.equal(folded.replaceAll(CRLF + ' ', ''), long);
    assert.equal(foldLine('SHORT:1'), 'SHORT:1');
    assert.equal(foldLine('X'.repeat(75)), 'X'.repeat(75));
    assert.equal(foldLine('X'.repeat(76)), 'X'.repeat(75) + CRLF + ' X');
  });

  test('empty calendar is still valid', () => {
    const t = buildCalendar([], { stamp });
    assert.match(t, /^BEGIN:VCALENDAR\r\n/);
    assert.match(t, /END:VCALENDAR\r\n$/);
  });

  test('Google Calendar link', () => {
    const url = new URL(googleCalendarUrl(day[1]));
    assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
    assert.equal(url.searchParams.get('action'), 'TEMPLATE');
    assert.equal(url.searchParams.get('text'), 'Mekanisme Kontrol Molekuler Siklus Sel');
    assert.equal(url.searchParams.get('dates'), '20261005T103000/20261005T121000');
    assert.equal(url.searchParams.get('ctz'), 'Asia/Jakarta');
    assert.equal(url.searchParams.get('location'), 'Kampus FK Unsri KM.6');
    assert.match(url.searchParams.get('details'), /Rara Inggarsih/);
  });
});

test('no em or en dashes in the jadwal and dosen sources', () => {
  const files = [
    'src/lib/schedule-model.js', 'src/lib/ics.js',
    'src/features/jadwal/jadwal.js', 'src/features/jadwal/jadwal.css',
    'src/features/dosen/dosen.js', 'src/features/dosen/dosen.css',
    'src/features/dosen/contact.js', 'src/features/dosen/contact.css',
    'dev/jadwal.html', 'dev/dosen.html', 'tests/jadwal-dosen.e2e.mjs',
  ];
  for (const file of files) {
    const src = readFileSync(fileURLToPath(new URL(file, root)), 'utf8');
    assert.equal(/[\u2013\u2014]/.test(src), false, file);
  }
});
