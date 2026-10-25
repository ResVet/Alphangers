// Texts of src/features/find/find.js: the search over the whole site.
// Keys start with their group ("find.") and are used through kHTML() / kAttrs() / kText() / kSet() / tx()
// from src/lib/texts.js. Each default is the text the page showed before it became editable.
// A session's time and kind in a result use the schedule's words ('jadwal.time.tba', 'jadwal.kind.*').
import { registerCopy, registerLabels } from '../lib/texts.js';
import { GROUP_LABELS } from './groups.js';

registerCopy('find', GROUP_LABELS.find, {
  'find.ph': 'Cari materi, dosen, channel, bagian jantung',
  'find.close': { d: 'Esc', h: 'Tombol tutup di kotak pencarian' },
  'find.k.pick': 'pilih',
  'find.k.enter': 'Enter',
  'find.k.open': 'buka',
  'find.k.esc': 'Esc',
  'find.k.close': 'tutup',
  'find.g.section': 'Lompat ke',
  'find.g.channel': 'Channel',
  'find.g.session': 'Jadwal',
  'find.g.dosen': 'Dosen',
  'find.g.heart': 'Jantung 3D',
  'find.sec.jadwal.t': 'Jadwal kuliah',
  'find.sec.jadwal.s': 'Hari ini, kalender, ujian berikutnya',
  'find.sec.menu.t': 'Drive dan channel',
  'find.sec.menu.s': 'Semua folder kelas',
  'find.sec.dosen.t': 'Daftar dosen',
  'find.sec.dosen.s': 'Nama, spesialis, nomor HP',
  'find.sec.anatomi.t': 'Jantung 3D',
  'find.sec.anatomi.s': 'Model yang bisa dibongkar',
  'find.today': { d: 'Hari ini', h: 'Pengganti tanggal di hasil pencarian, untuk sesi hari ini' },
  'find.dosen': { d: 'Dosen', h: 'Muncul di bawah nama dosen yang spesialisnya belum diisi' },
  'find.none': { d: '**Nggak ketemu.** Coba kata lain, misalnya nama dosen, judul kuliah, atau "mitral".', rich: true },
});

// what each text is called in the editor's lists (Semua teks halaman, Ubah teks)
registerLabels({
  'find.ph': 'Kotak pencarian: tulisan samar di kolom',
  'find.close': 'Kotak pencarian: tombol tutup',
  'find.k.pick': 'Petunjuk keyboard: kata setelah panah',
  'find.k.enter': 'Petunjuk keyboard: tombol Enter',
  'find.k.open': 'Petunjuk keyboard: kata setelah Enter',
  'find.k.esc': 'Petunjuk keyboard: tombol Esc',
  'find.k.close': 'Petunjuk keyboard: kata setelah Esc',
  'find.g.section': 'Judul kelompok: bagian halaman',
  'find.g.channel': 'Judul kelompok: channel',
  'find.g.session': 'Judul kelompok: sesi jadwal',
  'find.g.dosen': 'Judul kelompok: dosen',
  'find.g.heart': 'Judul kelompok: bagian jantung 3D',
  'find.sec.jadwal.t': 'Lompat ke jadwal: nama',
  'find.sec.jadwal.s': 'Lompat ke jadwal: deskripsi',
  'find.sec.menu.t': 'Lompat ke channel: nama',
  'find.sec.menu.s': 'Lompat ke channel: deskripsi',
  'find.sec.dosen.t': 'Lompat ke dosen: nama',
  'find.sec.dosen.s': 'Lompat ke dosen: deskripsi',
  'find.sec.anatomi.t': 'Lompat ke jantung 3D: nama',
  'find.sec.anatomi.s': 'Lompat ke jantung 3D: deskripsi',
  'find.today': 'Hasil sesi: pengganti tanggal hari ini',
  'find.dosen': 'Hasil dosen: pengganti spesialis kosong',
  'find.none': 'Pesan kalau tidak ada hasil',
});
