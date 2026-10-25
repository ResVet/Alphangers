// Texts of src/features/dosen/: the lecturer list and a lecturer's details, plus the phone
// buttons of contact.js (the schedule shows the same buttons).
// Keys start with their group ("dosen.") and are used through kHTML() / kAttrs() / kText() / kSet() / tx()
// from src/lib/texts.js. Each default is the text the page showed before it became editable.
import { registerCopy, registerLabels } from '../lib/texts.js';
import { GROUP_LABELS } from './groups.js';

const SR = 'Cuma dibacakan pembaca layar, nggak kelihatan';

registerCopy('dosen', GROUP_LABELS.dosen, {
  // heading
  'dosen.h1': 'dosennya',
  'dosen.h2': 'siapa?',
  'dosen.note': { d: '', opt: true, ml: true, ph: 'Catatan di bawah judul (kosong = tidak tampil)' },
  'dosen.count': '{n} dosen',
  'dosen.count.hit': { d: '{n} dari {total} dosen', h: 'Pas lagi dicari atau difilter' },

  // search and filters
  'dosen.find': 'Cari dosen',
  'dosen.find.ph': 'nama, spesialis, nomor HP, kode blok',
  'dosen.f.blok': 'Ngajar di',
  'dosen.f.spec': 'Spesialis',
  'dosen.clear': 'Hapus filter',
  'dosen.g.dokter': 'Dokter non-Sp',
  'dosen.g.nondokter': 'Non-dokter',
  'dosen.g.interna': 'Penyakit Dalam',
  'dosen.g.anak': 'Anak',
  'dosen.g.obgin': 'Obgin',
  'dosen.g.bedah': 'Bedah',
  'dosen.g.saraf': 'Saraf & Jiwa',
  'dosen.g.organ': 'Mata, THT, Kulit',
  'dosen.g.lab': 'Lab & Radiologi',
  'dosen.g.lain': { d: 'Lainnya', h: 'Spesialis yang belum masuk kelompok mana pun' },
  'dosen.active.blok': 'Cuma yang ngajar di {blok}',
  'dosen.active.spec': 'Cuma yang {spesialis}',
  'dosen.active.both': 'Cuma yang ngajar di {blok}, spesialis {spesialis}',
  'dosen.active.and': { d: 'dan', h: 'Kata sambung nama blok, misal "Blok 1 dan Blok 2"' },

  // the list
  'dosen.more': 'Lihat semua {n} dosen',
  'dosen.less': 'Ringkas daftar',
  'dosen.empty.h1': 'Nggak',
  'dosen.empty.h2': 'ketemu.',
  'dosen.empty.sub': 'Coba kata lain, atau hapus filternya.',
  'dosen.dock.find': { d: 'Cari dosen', h: 'Tombol di bawah layar pas daftarnya panjang' },
  'dosen.dock.less': { d: 'Ringkas', h: 'Tombol di bawah layar pas daftarnya panjang' },
  'dosen.dock.skip': { d: 'Lewati daftar', h: 'Tombol di bawah layar pas daftarnya panjang' },
  'dosen.spec.none': { d: 'Dosen', h: 'Muncul kalau spesialisnya kosong' },
  'dosen.row.teach': '{n} sesi di jadwal',

  // a lecturer's details
  'dosen.dlg.code': '{blok}, kode {kode}',
  'dosen.dlg.sub': 'Jadwal ngajar di kelas Alpha',
  'dosen.dlg.n': '{n} sesi',
  'dosen.dlg.none': 'Belum ada jadwal ngajar di kelas Alpha.',
  'dosen.se.pj': { d: '{jenis}, sebagai PJ', h: 'Sesi yang dosennya jadi PJ' },
  'dosen.se.next': 'berikutnya',

  // phone buttons (also in the schedule)
  'dosen.ph.none': 'Nomor belum ada.',
  'dosen.ph.call': 'Telp',
  'dosen.ph.wa': 'WA',
  'dosen.ph.copy': 'Salin',
  'dosen.ph.copied': 'Tersalin',
  'dosen.ph.fail': 'Gagal',
  'dosen.ph.sr.ok': { d: 'Nomor {nomor} disalin.', h: SR },
  'dosen.ph.sr.fail': { d: 'Gagal menyalin. Nomornya {nomor}.', h: SR },

  // read out while searching
  'dosen.sr.found': { d: '{n} dosen ketemu.', h: SR },
  'dosen.sr.none': { d: 'Nggak ketemu.', h: SR },
  'dosen.sr.folded': { d: 'Daftar diringkas.', h: SR },
});

// what each text is called in the editor's lists (Semua teks halaman, Ubah teks)
registerLabels({
  'dosen.h1': 'Judul: bagian awal',
  'dosen.h2': 'Judul: bagian miring',
  'dosen.note': 'Catatan di bawah judul',
  'dosen.count': 'Samping judul: jumlah dosen',
  'dosen.count.hit': 'Samping judul: jumlah saat dicari atau difilter',
  'dosen.find': 'Cari dosen: judul di atas kolom',
  'dosen.find.ph': 'Cari dosen: tulisan samar di kolom',
  'dosen.f.blok': 'Filter blok: judul baris',
  'dosen.f.spec': 'Filter spesialis: judul baris',
  'dosen.clear': 'Tombol hapus filter',
  'dosen.g.dokter': 'Filter spesialis: dokter non-Sp',
  'dosen.g.nondokter': 'Filter spesialis: non-dokter',
  'dosen.g.interna': 'Filter spesialis: penyakit dalam',
  'dosen.g.anak': 'Filter spesialis: anak',
  'dosen.g.obgin': 'Filter spesialis: obgin',
  'dosen.g.bedah': 'Filter spesialis: bedah',
  'dosen.g.saraf': 'Filter spesialis: saraf dan jiwa',
  'dosen.g.organ': 'Filter spesialis: mata, THT, kulit',
  'dosen.g.lab': 'Filter spesialis: lab dan radiologi',
  'dosen.g.lain': 'Filter spesialis: lainnya',
  'dosen.active.blok': 'Filter aktif: hanya blok',
  'dosen.active.spec': 'Filter aktif: hanya spesialis',
  'dosen.active.both': 'Filter aktif: blok dan spesialis',
  'dosen.active.and': 'Filter aktif: kata sambung antar blok',
  'dosen.more': 'Bawah daftar: tombol lihat semua',
  'dosen.less': 'Bawah daftar: tombol ringkas',
  'dosen.empty.h1': 'Hasil kosong: judul bagian awal',
  'dosen.empty.h2': 'Hasil kosong: judul bagian miring',
  'dosen.empty.sub': 'Hasil kosong: saran di bawah judul',
  'dosen.dock.find': 'Bawah layar: tombol cari dosen',
  'dosen.dock.less': 'Bawah layar: tombol ringkas',
  'dosen.dock.skip': 'Bawah layar: tombol lewati daftar',
  'dosen.spec.none': 'Pengganti spesialis yang kosong',
  'dosen.row.teach': 'Baris dosen: jumlah sesi di jadwal',
  'dosen.dlg.code': 'Detail dosen: kode per blok',
  'dosen.dlg.sub': 'Detail dosen: judul daftar sesi',
  'dosen.dlg.n': 'Detail dosen: jumlah sesi',
  'dosen.dlg.none': 'Detail dosen: belum ada jadwal ngajar',
  'dosen.se.pj': 'Detail dosen: jenis sesi sebagai PJ',
  'dosen.se.next': 'Detail dosen: tanda sesi berikutnya',
  'dosen.ph.none': 'Nomor HP: kalau belum ada',
  'dosen.ph.call': 'Nomor HP: tombol telepon',
  'dosen.ph.wa': 'Nomor HP: tombol WhatsApp',
  'dosen.ph.copy': 'Nomor HP: tombol salin',
  'dosen.ph.copied': 'Nomor HP: tombol salin (berhasil)',
  'dosen.ph.fail': 'Nomor HP: tombol salin (gagal)',
  'dosen.ph.sr.ok': 'Pembaca layar: nomor berhasil disalin',
  'dosen.ph.sr.fail': 'Pembaca layar: nomor gagal disalin',
  'dosen.sr.found': 'Pembaca layar: jumlah dosen ketemu',
  'dosen.sr.none': 'Pembaca layar: dosen tidak ketemu',
  'dosen.sr.folded': 'Pembaca layar: daftar diringkas',
});
