// Formatting and naming shared by the editors, the diff view and history.

export const KEY_INFO = {
  links: { title: 'Link Drive', short: 'Link', list: 'channels', noun: 'channel' },
  announcements: { title: 'Pengumuman', short: 'Info', list: 'items', noun: 'pengumuman' },
  schedule: { title: 'Jadwal', short: 'Jadwal', list: 'bloks', noun: 'blok' },
  dosen: { title: 'Dosen', short: 'Dosen', list: 'list', noun: 'dosen' },
  heart: { title: 'Jantung 3D', short: 'Jantung', list: 'parts', noun: 'bagian' },
};

export const TAG_LABELS = { info: 'Info', deadline: 'Deadline', ujian: 'Ujian', penting: 'Penting' };

export const KIND_LABELS = {
  kuliah: 'Kuliah', praktikum: 'Praktikum', skilllab: 'Skill lab', tutorial: 'Tutorial',
  ujian: 'Ujian', pleno: 'Pleno', mkdu: 'MKDU', intro: 'Pembukaan',
};

export const GROUP_LABELS = {
  umum: 'Umum', ruang: 'Ruang jantung', pembuluh_besar: 'Pembuluh besar', koroner: 'Arteri koroner',
  vena_jantung: 'Vena jantung', katup: 'Katup', konduksi: 'Sistem konduksi',
};

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// '2026-08-18' -> 'Sel, 18 Agu 2026'. Calendar dates have no time zone, so read them as UTC.
export function fmtDay(iso, { weekday = true, year = true } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const core = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ' ' + d.getUTCFullYear() : ''}`;
  return weekday ? `${DAYS[d.getUTCDay()]}, ${core}` : core;
}

// A moment in time, shown in WIB (the class lives in Palembang).
export function fmtWhen(date) {
  if (!(date instanceof Date) || Number.isNaN(+date)) return '';
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return `${get('day')} ${get('month').replace('.', '')} ${get('year')}, ${get('hour')}.${get('minute')} WIB`;
}

export function fmtRelative(date, now = new Date()) {
  if (!(date instanceof Date)) return '';
  const s = Math.round((now - date) / 1000);
  if (s < 45) return 'barusan';
  if (s < 3600) return `${Math.round(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} hari lalu`;
  return fmtWhen(date);
}

// Today in WIB as YYYY-MM-DD.
export function todayWib(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function fmtBytes(n) {
  return n < 1000 ? `${n} B` : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} KB`;
}

export function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// Folds case and accents so "Sadakata" finds "sadakatá".
export function fold(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Field names as people say them, keyed by "list.field" first, then "field".
const FIELD_LABELS = {
  'days.s': 'Sesi', 'days.d': 'Tanggal', 'days.libur': 'Libur',
  's.s': 'Mulai', 's.e': 'Selesai', 's.t': 'Judul', 's.k': 'Jenis', 's.dz': 'Dosen', 's.pj': 'PJ', 's.tim': 'Tim', 's.n': 'Catatan',
  'bloks.days': 'Hari', 'bloks.codes': 'Kode dosen', 'bloks.title': 'Judul blok',
  'list.bloks': 'Blok', 'list.codes': 'Kode per blok',
  'numbers.k': 'Nama', 'numbers.v': 'Nilai', 'clinical.t': 'Judul', 'clinical.d': 'Isi',
  'items.date': 'Tanggal posting',
  v: 'Versi format', cls: 'Kelas', id: 'ID', kind: 'Jenis', name: 'Nama', tag: 'Label', sub: 'Deskripsi', url: 'Link',
  title: 'Judul', body: 'Isi', date: 'Tanggal', due: 'Tenggat', link: 'Link', pinned: 'Disematkan', until: 'Sembunyikan setelah',
  loc: 'Lokasi', ketua: 'Ketua blok', start: 'Mulai', end: 'Selesai', days: 'Hari', codes: 'Kode dosen',
  spec: 'Spesialisasi', phones: 'Telepon', bloks: 'Blok', list: 'Daftar dosen', channels: 'Channel', items: 'Pengumuman', parts: 'Bagian',
  latin: 'Latin', en: 'Inggris', group: 'Grup', summary: 'Ringkasan', anatomy: 'Anatomi', function: 'Fungsi',
  numbers: 'Angka penting', supply: 'Pendarahan dan persarafan', clinical: 'Klinis', ecg: 'EKG', related: 'Terkait',
};

export function fieldLabel(list, field) {
  return FIELD_LABELS[`${list}.${field}`] || FIELD_LABELS[field] || String(field);
}

// A short name for one element of a list, for diffs and issue lists.
export function itemLabel(list, item, index) {
  if (item === null || typeof item !== 'object') return `#${index + 1}`;
  switch (list) {
    case 'channels': return item.name || item.id || `Channel ${index + 1}`;
    case 'items': return item.title || `Pengumuman ${index + 1}`;
    case 'bloks': return item.name || item.id || `Blok ${index + 1}`;
    case 'days': return fmtDay(item.d) || `Hari ${index + 1}`;
    case 's': return [item.s, item.t].filter(Boolean).join(' ') || `Sesi ${index + 1}`;
    case 'list': return item.name || item.id || `Dosen ${index + 1}`;
    case 'phones': return item.f || item.n || `Nomor ${index + 1}`;
    case 'parts': return item.name || item.id;
    case 'numbers': return item.k || `Angka ${index + 1}`;
    case 'clinical': return item.t || `Poin ${index + 1}`;
    default: return `#${index + 1}`;
  }
}

// Turns a validator path like ['bloks', 0, 'days', 3, 's', 1, 'e'] into
// "Blok 1 › Sen, 24 Agu 2026 › 10:10 Pelanggaran Akademik › Selesai".
export function pathLabel(data, path) {
  const out = [];
  let node = data;
  let list = '';
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (typeof seg === 'number') {
      const item = Array.isArray(node) ? node[seg] : undefined;
      out.push(itemLabel(list, item, seg));
      node = item;
    } else {
      const next = node && typeof node === 'object' ? node[seg] : undefined;
      if (Array.isArray(next) && typeof path[i + 1] === 'number') {
        list = seg;
      } else {
        out.push(list === 'codes' || (path[i - 1] === 'codes') ? seg : fieldLabel(list, seg));
        if (seg === 'codes') list = 'codes';
      }
      node = next;
    }
  }
  return out.join(' › ') || 'Dokumen';
}
