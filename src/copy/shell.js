// Texts the page shell builds (src/legacy/app.js, src/main.js): top bar, hero, channel list, channel pages, footer, messages.
// Keys start with their group ("app.") and are used through kHTML() / kAttrs() / kText() / kSet() / tx()
// from src/lib/texts.js. Each default is the text the page showed before it became editable.
//
// Texts typed straight into index.html (loader, bar, hero, marquee, headings, notes, footer) are not
// declared here: the markup is their default. The heartbeat captions (siklus.cap<n>.*) are built by
// the shell with fixed texts but stay undeclared too: two of them hold a "<" ("<0,12 detik"), which a
// declared default may not, and they are always on the page, where their own text is the default.
import { registerCopy, registerLabels } from '../lib/texts.js';
import { GROUP_LABELS } from './groups.js';

registerCopy('bar', GROUP_LABELS.bar, {
  'bar.snd.on': { d: 'on', h: 'Tulisan di tombol Suara waktu nyala.' },
  'bar.snd.off': { d: 'off', h: 'Tulisan di tombol Suara waktu mati.' },
  'bar.snd.none': 'Browser ini belum dukung suara.',
});

registerCopy('hero', GROUP_LABELS.hero, {
  'hero.ttl': { d: 'ALPHANGERS', h: 'Judul besar di pembuka, paling panjang 24 huruf. Kalau diubah, hurufnya ikut disusun ulang.' },
  'hero.poly': { d: '100% Polyester', h: 'Tombol yang kadang muncul di akhir kalimat pembuka.' },
});

registerCopy('menu', GROUP_LABELS.menu, {
  'menu.count': 'Menu · {n} channel',
  'menu.row.new': 'baru',
  'menu.row.go': 'Mulai',
  'menu.row.drive': 'Drive',
  'menu.peek.try': { d: 'Try out', h: 'Kartu kecil yang ikut kursor di daftar channel (laptop).' },
  'menu.peek.drive': { d: 'Folder Drive', h: 'Kartu kecil yang ikut kursor di daftar channel (laptop).' },
});

registerCopy('ch', GROUP_LABELS.ch, {
  'ch.back': { d: 'Kembali', h: 'Tombol kembali di halaman channel dan di try out.' },
  'ch.crumb': 'Channel {n} / {total}',
  'ch.next': 'Channel berikutnya',
  'ch.folder.tab': 'Drive · {n}',
  'ch.folder.stamp': 'Class Alpha',
  'ch.folder.k': 'Folder Google Drive',
  'ch.folder.open': 'Buka folder',
  'ch.folder.wait': 'Link menyusul',
  'ch.folder.nourl': 'belum dipasang',
  'ch.nolink': 'Link Drive buat channel ini belum dipasang.',
});

registerCopy('foot', GROUP_LABELS.foot, {
  'foot.clock': 'Palembang · {time} WIB',
});

registerCopy('app', GROUP_LABELS.app, {
  'app.title': { d: 'ALPHANGERS · Class Alpha', h: 'Judul di tab browser.' },
  'app.title.ch': { d: '{name} · ALPHANGERS', h: 'Judul di tab browser waktu satu channel dibuka.' },
  // a section whose script did not load (src/main.js)
  'app.fail.info': 'Pengumuman gagal dimuat. Coba muat ulang halamannya.',
  'app.fail.jadwal': 'Jadwal gagal dimuat. Coba muat ulang halamannya.',
  'app.fail.dosen': 'Daftar dosen gagal dimuat. Coba muat ulang halamannya.',
  'app.fail.anatomi': 'Model jantung gagal dimuat. Coba muat ulang halamannya.',
  'app.fail.divisi': 'Divisi gagal dimuat. Coba muat ulang halamannya.',
  // the word in the round cursor over a link or button (data-cur), on screens with a mouse
  'app.cur.klik': { d: 'klik', h: 'Tulisan di kursor bulat (laptop).' },
  'app.cur.buka': { d: 'buka', h: 'Tulisan di kursor bulat (laptop).' },
  'app.cur.balik': { d: 'balik', h: 'Tulisan di kursor bulat (laptop).' },
  'app.cur.lanjut': { d: 'lanjut', h: 'Tulisan di kursor bulat (laptop).' },
  'app.cur.mulai': { d: 'mulai', h: 'Tulisan di kursor bulat (laptop).' },
  'app.cur.selesai': { d: 'selesai', h: 'Tulisan di kursor bulat (laptop).' },
  'app.cur.bahas': { d: 'bahas', h: 'Tulisan di kursor bulat (laptop).' },
  'app.cur.zoom': { d: 'zoom', h: 'Tulisan di kursor bulat (laptop).' },
  'app.cur.putar': { d: 'putar', h: 'Tulisan di kursor bulat (laptop).' },
});

// what each text is called in the editor's lists (Semua teks halaman, Ubah teks): declared, then index.html, then each channel's note
registerLabels({
  'bar.snd.on': 'Tombol suara: tulisan saat nyala',
  'bar.snd.off': 'Tombol suara: tulisan saat mati',
  'bar.snd.none': 'Pesan kalau suara tidak didukung',
  'hero.ttl': 'Judul besar',
  'hero.poly': 'Tombol 100% Polyester di akhir kalimat',
  'menu.count': 'Jumlah channel di samping judul',
  'menu.row.new': 'Tanda baru di baris try out',
  'menu.row.go': 'Tulisan di ujung baris: try out',
  'menu.row.drive': 'Tulisan di ujung baris: Drive',
  'menu.peek.try': 'Kartu kecil ikut kursor: try out',
  'menu.peek.drive': 'Kartu kecil ikut kursor: Drive',
  'ch.back': 'Tombol kembali',
  'ch.crumb': 'Nomor channel di samping tombol kembali',
  'ch.next': 'Tombol ke channel berikutnya',
  'ch.folder.tab': 'Gambar folder: tulisan di tab',
  'ch.folder.stamp': 'Gambar folder: cap di kertas',
  'ch.folder.k': 'Gambar folder: label kecil di depan',
  'ch.folder.open': 'Gambar folder: tulisan utama, ada link',
  'ch.folder.wait': 'Gambar folder: tulisan utama, tanpa link',
  'ch.folder.nourl': 'Gambar folder: baris alamat, tanpa link',
  'ch.nolink': 'Pesan kalau folder belum ada link',
  'foot.clock': 'Jam di baris paling bawah',
  'app.title': 'Judul tab browser: halaman utama',
  'app.title.ch': 'Judul tab browser: saat channel dibuka',
  'app.fail.info': 'Tulisan kalau pengumuman gagal dimuat',
  'app.fail.jadwal': 'Tulisan kalau jadwal gagal dimuat',
  'app.fail.dosen': 'Tulisan kalau daftar dosen gagal dimuat',
  'app.fail.anatomi': 'Tulisan kalau jantung 3D gagal dimuat',
  'app.fail.divisi': 'Tulisan kalau divisi gagal dimuat',
  'app.cur.klik': 'Kursor bulat: lambang di pembuka',
  'app.cur.buka': 'Kursor bulat: channel, folder, dan link',
  'app.cur.balik': 'Kursor bulat: tombol kembali',
  'app.cur.lanjut': 'Kursor bulat: tombol lanjut',
  'app.cur.mulai': 'Kursor bulat: tombol mulai try out',
  'app.cur.selesai': 'Kursor bulat: tombol selesai try out',
  'app.cur.bahas': 'Kursor bulat: tombol bahas jawaban',
  'app.cur.zoom': 'Kursor bulat: foto yang dibuka penuh',
  'app.cur.putar': 'Kursor bulat: jantung di Siklus jantung',
  'loader.brand': 'Nama portal di kiri atas',
  'loader.msg': 'Pesan memuat di kanan atas',
  'loader.meta': 'Label kecil di kanan bawah',
  'bar.brand': 'Nama portal di kiri',
  'bar.nav.jadwal': 'Tautan menu: Jadwal',
  'bar.nav.menu': 'Tautan menu: Drive',
  'bar.nav.dosen': 'Tautan menu: Dosen',
  'bar.nav.anatomi': 'Tautan menu: Jantung 3D',
  'bar.nav.divisi': 'Tautan menu: Divisi',
  'bar.meta': 'Label kecil di kanan',
  'bar.find': 'Tombol cari',
  'bar.snd': 'Tombol suara',
  'bar.menu': 'Tombol Menu ke daftar channel',
  'hero.kick': 'Tulisan kecil di atas kalimat pembuka',
  'hero.lede': 'Kalimat pembuka',
  'hero.cta': 'Tombol ke daftar channel',
  'hero.asm': 'Kata dilingkari di bawah judul besar',
  'hero.cue': 'Petunjuk scroll di kiri bawah',
  'hero.mq.name': 'Teks berjalan: nama portal',
  'hero.mq.cheer': 'Teks berjalan: seruan',
  'hero.mq.class': 'Teks berjalan: nama kelas',
  'hero.mq.fk': 'Teks berjalan: nama fakultas',
  'hero.mq.year': 'Teks berjalan: tahun angkatan',
  'app.wait.jadwal': 'Tulisan saat jadwal dimuat',
  'menu.h1': 'Judul: bagian tebal',
  'menu.h2': 'Judul: bagian miring',
  'menu.note': 'Catatan di bawah judul',
  'app.wait.dosen': 'Tulisan saat daftar dosen dimuat',
  'app.wait.divisi': 'Tulisan saat divisi dimuat',
  'foot.big': 'Nama portal ukuran raksasa',
  'foot.credit.t': 'Tautan pembuat portal: keterangan saat disorot',
  'foot.credit': 'Tautan pembuat portal',
  'foot.meta': 'Label kecil di samping tombol Admin',
  'foot.admin': 'Tombol Admin',
  'ch.*.note': 'Catatan di bawah judul channel',
});
