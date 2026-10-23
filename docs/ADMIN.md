# Memakai editor admin

Semua dikerjakan dari `alphangers.netlify.app/?admin`. Di sana ada tiga tampilan yang bisa dipindah kapan saja dari dock di bawah layar:

- **Lihat**: halaman persis seperti yang dilihat pengunjung.
- **Edit**: ubah langsung di halaman. Paling cepat buat perubahan sehari-hari: batalin sesi, ganti teks, nambah dosen, unggah foto divisi.
- **Panel**: editor formulir yang lengkap (formulir per blok jadwal dan per dosen, mode JSON, riwayat versi, impor dan ekspor, kembali ke versi bawaan), dibuka di atas halaman.

Ketiganya memakai draf yang sama. Teks yang kamu ketik di Edit sudah ada waktu Panel dibuka, dan yang kamu ubah atau simpan di Panel langsung kelihatan di halaman begitu kembali ke Lihat atau Edit. Panel yang sama juga masih bisa dibuka sendiri di `/admin/`; tombol **Ke halaman** di kanan atasnya membawa kembali ke `/?admin`.

Kalau Firebase belum disambungkan, panel admin menampilkan langkah setup. Ikuti [FIREBASE_SETUP.md](FIREBASE_SETUP.md) dulu.

Siapa yang boleh membuka try out diatur di tab **Peserta try out** di Panel. Lihat [Peserta try out](#peserta-try-out).

## Edit langsung di halaman

### Masuk

Gulir ke paling bawah portal dan ketuk **Admin** di sebelah kanan footer. Bisa juga buka `alphangers.netlify.app/?admin`, atau tekan **Ctrl+Shift+E** (**Cmd+Shift+E** di Mac). Pilih akun Google admin. Setelah sekali masuk di satu perangkat, dock editor muncul sendiri tiap kamu membuka portal di perangkat itu, sampai kamu keluar lewat menu **⋯ > Keluar**.

Pengunjung biasa tidak mengunduh apa pun dari editor. Tombol Admin cuma membuka layar login; tanpa akun yang terdaftar sebagai admin tidak ada yang bisa diubah.

### Dock

Dock ada di bawah tengah layar:

- **Lihat / Edit / Panel.** Pindah kapan saja; tampilan terakhir diingat selama tab terbuka. Selama Panel terbuka, menyimpan dilakukan dengan tombol **Simpan** di bawah panel; tombol urungkan dan Terbitkan di dock muncul lagi setelah kembali ke halaman.
- **↶ ↷** urungkan dan ulangi (**Ctrl+Z**, **Ctrl+Shift+Z**). Setiap perubahan bisa diurungkan sampai diterbitkan.
- **Terbitkan** (**Ctrl+S**). Angka di tombol itu jumlah bagian yang berubah. Semua perubahan tetap draf di perangkatmu sampai diterbitkan; pengunjung baru melihatnya setelah itu.
- **⋯** berisi: semua teks halaman dalam satu formulir, Panel, buang semua draf, kecilkan dock, dan keluar.

Draf disimpan di browser. Kalau tab tertutup sebelum terbit, waktu dibuka lagi muncul **Lanjutkan draf sebelumnya?**.

### Mengubah teks

Di mode Edit, semua teks yang bisa diubah diberi garis putus-putus. Ketuk, ketik, lalu ketuk di luar atau tekan Enter. Esc membatalkan ketikan itu. Kosongkan sebuah teks untuk kembali ke tulisan aslinya. Teks yang tidak bisa diketik langsung (misalnya akhiran kalimat pembuka di atas, satu per baris) ada di **⋯ > Semua teks halaman**.

Ada juga teks yang boleh kosong: catatan dan nama penyusun try out. Selama masih kosong, di mode Edit teks itu tampil sebagai kotak putus-putus dengan petunjuk (misalnya "Catatan buat halaman try out (kosong = tidak tampil)"), dan pengunjung tidak melihat apa-apa. Isi untuk menampilkannya, kosongkan lagi untuk menyembunyikannya.

### Mengubah kartu (sesi, dosen, channel, pengumuman, divisi, foto)

Di mode Edit, ketuk atau klik sebuah kartu. Kartu itu diberi bingkai hijau dan muncul bar aksi: di sebelah kartu kalau di laptop, di atas dock kalau di HP. Di mode Edit, klik pada kartu tidak membuka apa-apa (dosen, channel, foto), jadi tidak ada yang berpindah halaman di tengah-tengah edit. Tombol tanggal di jadwal dan panah di divisi tetap jalan seperti biasa.

Di atas tiap bagian ada baris alat untuk menambah: **+ Sesi**, **+ Dosen**, **+ Channel**, **+ Pengumuman**, **+ Divisi**, dan sebagainya.

### Jadwal dan pembatalan

- **Batalkan** di bar aksi sebuah sesi: isi alasannya (boleh kosong). Sesi tetap tampil, dengan label merah Dibatalkan, alasannya, dan pita merah di kartunya. Sesi yang dibatalkan tidak dihitung di "Lagi jalan", "Berikutnya", dan hitung mundur ujian, dan ikut terekspor ke kalender sebagai dibatalkan. **Aktifkan lagi** mengembalikannya.
- **Batalkan semua hari ini** di baris alat jadwal membatalkan semua sesi di tanggal yang sedang tampil. **Aktifkan semua** kebalikannya.
- **Online** di bar aksi sebuah sesi menandai sesi itu online (ikut dari tempat masing-masing) dan menyimpan link Zoom, Google Meet, atau sejenisnya. Di jadwal, label lokasi blok diganti label hijau Online, dan kalau ada linknya muncul tombol **Gabung online** yang membuka link itu di tab baru. Link harus `https://`. Link saja sudah cukup untuk menandai sesi online; hapus centang dan kosongkan link untuk kembali tatap muka. Sesi online yang dibatalkan tidak menampilkan tombol gabung. Di kalender, link ikut tersimpan sebagai lokasi acara.
- **Tag** ada di formulir **Ubah**: ketuk tag untuk memasang atau melepasnya, atau ketik tag baru lalu Enter. Maksimal 4 tag per sesi, masing-masing sampai 30 huruf. **Kelas gabungan** (kelas Alpha dan Beta bareng) selalu tersedia dan tampil kuning; tag lain yang pernah kamu pakai di sesi mana pun ikut muncul sebagai pilihan. Tag tampil di samping jenis sesi, bisa dicari di pencarian, dan ikut terekspor ke kalender.
- **+ Sesi** menambah sesi di tanggal yang sedang tampil. Dosen dipilih dengan mengetik namanya; kode dosen dibuat otomatis dan dicatat di jadwal dan di data dosen sekaligus.
- **Ubah** membuka formulir lengkap sesi itu (termasuk tag, online, dan pembatalan), juga untuk memindahnya ke tanggal lain. **Duplikat** menyalin sesi tepat sesudahnya.
- **Jam belum diumumkan** di formulir sesi dipakai kalau jadwal resmi belum mencantumkan jamnya (contohnya CBT dan Her OSPE Blok 4). Jadwal menampilkan "Jam menyusul" sebagai ganti jam, sesi itu tidak pernah dihitung "Lagi jalan", dan di kalender jadi acara seharian. Begitu jamnya keluar, buka **Ubah**, isi jam mulai (dan selesai kalau ada), lalu hapus centangnya.
- **Libur**, **Ubah blok**, dan **+ Blok** ada di baris alat. Ketuk tombol blok (Blok 1, Blok 2, ...) di mode Edit untuk mengubah atau menghapus blok itu.

### Halaman channel dan try out

Di mode Edit, ketuk sebuah channel di daftar Drive lalu **Buka** untuk masuk ke halamannya. Bisa juga buka halamannya dulu di Lihat, lalu pindah ke Edit.

Di halaman channel Drive:

- Ketuk judul halaman lalu **Ubah channel** untuk nama, label kecil, keterangan, dan link folder (formulir yang sama dengan di daftar).
- Ketuk gambar foldernya: **Ubah link**, atau **Buka folder** untuk mengecek linknya.
- Di bawah judul ada kotak **Catatan buat channel ini**. Ketik apa saja, misalnya "Laporan PA dikumpulkan tiap Jumat". Tiap channel punya catatannya sendiri.

Di halaman try out:

- Ketuk sebuah kartu blok lalu **Ubah teks**: nama blok, judul, semester, keterangan dan label kecil (untuk blok yang soalnya belum masuk), kata sebelum penyusun, penyusun, dan catatan di halaman blok itu. Misalnya, supaya tertulis "Dibuat oleh Tim Batu", isi **Kata sebelum penyusun** dengan `Dibuat oleh` dan **Penyusun** dengan `Tim Batu`. Kosongkan **Penyusun** untuk menyembunyikan baris itu. Kartu yang soalnya sudah ada juga punya tombol **Buka**.
- Nama, judul, dan semester blok yang diubah ikut berubah di semua layar try out (halaman blok, layar masuk, hasil, pembahasan).
- Di bawah kartu ada kotak **Catatan buat halaman try out**. Di halaman tiap blok ada catatan sendiri di bawah judulnya.
- Teks lain di halaman try out (kalimat di kotak akun, kalimat soal penyimpanan di bawah kartu, judul dan penjelasan di layar masuk) bisa diketik langsung.
- Ketuk judul halaman lalu **Ubah channel** untuk nama, label, dan keterangan channel Try Out CBT atau Try Out OSPE.
- Try Out CBT dan Try Out OSPE masing-masing punya kartu Blok 1 sampai Blok 4 dan catatan halamannya sendiri. Akun Google dan NIM yang sama membuka keduanya.

Untuk membuka halaman blok di mode Edit, kamu perlu masuk try out seperti teman sekelas (Google dan NIM), karena soalnya hanya terbuka untuk Kelas Alpha.

### Foto divisi dan foto kelas

- Ketuk sebuah foto di tumpukan divisi untuk **Ganti foto**, **Keterangan**, atau **Hapus foto**. Slot yang masih kosong ("Foto menyusul") punya tombol **Unggah foto**.
- **Kelola foto** di bar aksi divisi membuka semua foto divisi itu: urutan (tiga teratas jadi tumpukan, sisanya masuk galeri di tampilan lengkap), keterangan, teks untuk pembaca layar, hapus, dan **+ Tambah foto** (boleh pilih banyak sekaligus).
- Nama, kepanjangan, label, dan deskripsi divisi bisa diketik langsung di halaman. Kosongkan salah satunya untuk kembali ke teks bawaan, sama seperti teks halaman lainnya.
- Foto kelas di bagian paling bawah: ketuk lalu **Ganti foto**.

Foto langsung disiapkan di perangkatmu sebelum dikirim: file aslinya disimpan apa adanya buat zoom, tapi data tersembunyinya (lokasi GPS, nomor seri kamera, riwayat edit) dibuang tanpa mengubah piksel sedikit pun. Foto HP yang mengandalkan tanda rotasi disimpan ulang dalam posisi tegak. Dibuat juga salinan 640, 1280, dan 2048 px supaya HP tidak mengunduh file besar, plus pratinjau buram yang tampil sambil menunggu. Satu file maksimal sekitar 5,6 MB setelah disiapkan; foto yang lebih besar dikecilkan otomatis ke 4096 px. Format: JPG, PNG, WebP, AVIF. Foto HEIC dari iPhone diubah dulu ke JPG (Pengaturan > Kamera > Format > Paling Kompatibel).

Foto yang dilepas dari divisi tetap tersimpan di server, jadi Undo dan Riwayat bisa mengembalikannya.

### Menerbitkan

Ketuk **Terbitkan**, cek daftar bagian yang berubah, lalu **Terbitkan** lagi. Setiap bagian disimpan dengan cara yang sama seperti panel admin: versi sebelumnya masuk Riwayat. Kalau ada yang mengubah bagian yang sama dari tempat lain sejak kamu mulai, editor bertanya mau memakai versimu atau versi terbaru.

## Panel

Bagian ini berlaku untuk Panel di dock maupun `/admin/` yang dibuka sendiri.

### Masuk

Di dalam dock kamu sudah masuk. Di `/admin/`, klik **Masuk dengan Google** dan pilih akun admin. Login tersimpan di browser itu sampai kamu klik **Keluar** di kanan atas. Di komputer pinjaman atau komputer lab, selalu keluar setelah selesai.

Kalau muncul **Belum bisa masuk**, akun itu belum terdaftar sebagai admin. Halaman itu menampilkan UID akun dan cara mendaftarkannya.

### Tampilan

Daftar konten ada di kiri (laptop) atau di baris atas (HP). Titik kuning di sebelah nama berarti konten itu punya perubahan yang belum disimpan.

Di bawah judul tertulis versi yang sedang dipakai portal, misalnya "Firestore rev 4, disimpan 2 jam lalu oleh kamu", atau "Versi bawaan dari repo" kalau konten itu belum pernah disimpan.

Tiap konten punya tiga mode: **Form** untuk edit biasa, **JSON** untuk edit teks mentah, dan **Riwayat** untuk versi-versi lama. Tombol **Batalkan perubahan** dan **Simpan** selalu ada di bar paling bawah.

## Lima jenis konten

### Link dan halaman

Kartu-kartu link di portal. Urutan di editor sama dengan urutan di portal; pakai tombol panah untuk memindah. Link harus `https://`, dan editor memberi peringatan kalau bukan folder `drive.google.com`. Channel Try Out CBT dan Try Out OSPE tidak punya link karena membuka try out di portal.

Dokumen yang sama juga menyimpan daftar divisi beserta fotonya (`divisi`), foto kelas (`site.photo`), dan teks halaman yang sudah diubah (`site.t`). Ketiganya ada di bawah daftar channel, dengan kemampuan yang sama seperti mode Edit:

- **Divisi**: selama portal masih memakai daftar bawaan dari repo, klik **Ubah divisi** untuk menyalinnya ke sini. Setelah itu tiap divisi punya kolom nama, label, kepanjangan, dan deskripsi (kolom kosong menampilkan teks bawaannya samar), tombol urutan dan hapus, serta daftar fotonya: urutan (tiga teratas jadi tumpukan), keterangan, teks untuk pembaca layar, **Lepas**, dan **+ Tambah foto**. **Tambah divisi** membuat divisi baru.
- **Foto kelas**: **Ganti foto** mengunggah foto baru, **Pakai foto bawaan** kembali ke foto dari repo.
- **Teks halaman**: semua teks yang bisa diketik di mode Edit, plus akhiran kalimat pembuka. Kosongkan sebuah kolom untuk kembali ke tulisan bawaan.

### Pengumuman

Judul, isi, label (info, deadline, ujian, penting), tanggal posting, tenggat, link, dan tanggal sembunyi. Pengumuman yang disematkan tampil paling atas. Setelah lewat tanggal sembunyi, pengumuman hilang sendiri dari portal tanpa perlu dihapus. Pengumuman yang punya tenggat juga hilang begitu tenggatnya lewat, dan selama masih jalan portal menampilkan hitung mundurnya. Pengumuman dengan tanggal posting di masa depan baru muncul di hari itu. Isi ditampilkan sebagai teks biasa, jadi kode HTML tidak akan jalan.

### Jadwal

Pilih blok di tab atas. Di dalam blok ada info blok, daftar kode dosen, lalu hari dan sesi. Klik sesi untuk mengubah jam, judul, jenis, dosen, catatan, tag, online beserta linknya, dan pembatalan beserta alasannya. Centang **Jam belum diumumkan** untuk sesi yang jamnya belum keluar; jadwal lalu menampilkan "Jam menyusul". Tombol **Batalkan semua** di kepala tiap hari membatalkan semua sesi hari itu (**Aktifkan semua** kebalikannya). Untuk menambah dosen ke sesi, ketik sebagian namanya (tanpa gelar) lalu pilih; kode dosennya dibuat otomatis. **Duplikat** menyalin sesi, berguna untuk sesi yang mirip. Editor memberi peringatan kalau ada jam yang bentrok di hari yang sama.

### Dosen

Cari dengan nama, spesialisasi, atau sebagian nomor. Nomor telepon dirapikan otomatis setelah kamu pindah dari kolomnya (misalnya `081234567890` jadi `0812-3456-7890`), dan editor menunjukkan ke nomor WhatsApp mana tombol chat di portal akan mengarah. Nomor di sini tampil publik di portal. Kalau dosen masih dipakai di jadwal, menghapusnya akan memberi peringatan dulu. Kalau muncul banner kuning soal data blok, klik **Samakan dengan jadwal**.

### Jantung 3D

Teks untuk tiap bagian model jantung. Pilih bagian dari daftar atau pakai tombol sebelumnya dan berikutnya. ID bagian tidak bisa diubah karena terikat ke model 3D.

## Peserta try out

Tab **Peserta try out** di Panel mengatur siapa yang boleh membuka soal try out kelas: Try Out CBT (Blok 2, Blok 3) dan Try Out OSPE (Blok 3), serta blok berikutnya. Di sini tidak ada tombol Simpan: setiap tindakan langsung dikirim ke server dan berlaku saat itu juga.

Teman sekelas membuka try out dengan masuk pakai akun Google, lalu mencocokkan NIM sekali. Yang bisa masuk hanya orang yang ada di daftar kelas (dari absen tutor Kelas Alfa).

### Pertama kali: pasang kode setup

Kalau tertulis **Server try out belum siap**, server belum punya kode setup, jadi daftar kelas belum bisa dibuka dan belum ada yang bisa masuk try out. Buka link setup (yang berakhiran `#tryout/pasang=`), atau tempel kodenya (boleh juga link-nya) di kolom **Kode setup**, lalu tekan **Pasang**. Cukup sekali. Kode langsung dihapus dari alamat halaman dan tidak disimpan di perangkat. Kalau setelah login kolomnya masih kosong, buka link itu sekali lagi.

Kode yang sama juga bisa disimpan sebagai variabel lingkungan `CBT_SECRET` di pengaturan situs Netlify. Kalau sudah begitu, tab ini langsung siap dan langkah di atas tidak perlu. Simpan kode itu baik-baik dan jangan dibagikan: siapa pun yang memegangnya bisa membuka semua soal.

### Membaca daftar

- Angka di atas: orang di daftar, yang sudah masuk, dan yang diblokir.
- Tiap baris berisi nama dan NIM, lalu akun Google yang dipakai. Labelnya: **cocok via NIM** (email memuat NIM), **cocok**, **mirip** (hanya sebagian nama yang sama), **perlu dicek** (tidak ada yang mirip).
- Cari pakai nama, NIM, atau email. Saring: Semua, Sudah masuk, Belum masuk, Perlu dicek, Diblokir.
- Klik nama untuk melihat detail dan tombolnya.

### Tombol dan kapan dipakai

- **Blokir**: orang ini tidak bisa membuka soal. Dia tetap bisa masuk, tapi hanya melihat pesan netral, dan teman lain tidak bisa tahu. **Buka blokir** mengembalikan aksesnya.
- **Lepas akun**: akun Google yang terikat dilepas dari NIM ini, jadi NIM-nya bebas lagi. Pakai kalau ada yang salah ketik NIM atau masuk dengan akun yang salah. Akun itu masih bisa mengetik NIM yang belum terpakai.
- **Blokir akun Google ini**: untuk akun penyusup, misalnya akun asing yang memakai NIM teman. Akun itu tidak bisa membuka soal dengan NIM mana pun. Biarkan "Lepaskan juga NIM" tercentang supaya pemilik NIM bisa masuk dengan akunnya sendiri. Blokirnya bisa dibuka lagi di bagian **Akun Google yang diblokir**.
- **Tambah orang**: menambah nama dan NIM (angka saja, 6 sampai 20 digit).
- **Hapus dari daftar**: NIM itu tidak bisa dipakai lagi dan akunnya ikut dilepas. Akun itu masih bisa mengetik NIM lain yang belum terpakai, jadi untuk menutup satu akun sepenuhnya pakai **Blokir akun Google ini**.

### Catatan

Bagian **Catatan** menampilkan kejadian terbaru: akun yang mencoba NIM yang sudah dipakai akun lain (tanda kuning, sering jadi tanda penyusup), yang masuk dengan NIM yang diblokir, dan semua tindakan admin. Tombol **Lihat** membuka baris orangnya.

### Kapan berlaku

Perubahan berlaku begitu perangkat peserta mengecek ke server lagi, yaitu saat membuka bank soal, paling lama sekitar satu jam sekali selama online. Perangkat yang terus offline menyimpan kunci soal paling lama 7 hari. Untuk menutup satu bank seketika bagi semua yang pernah membukanya, kunci bank itu harus diganti lalu situs di-deploy ulang (lihat bagian Try out access di `docs/ARCHITECTURE.md`).

## Error dan peringatan

Error ditandai merah dan harus dibetulkan dulu; selama masih ada, simpan ditolak. Peringatan ditandai kuning dan boleh tetap disimpan.

Ringkasan masalah tampil di atas form. Klik salah satu untuk langsung loncat ke kolomnya.

## Menyimpan

1. Klik **Simpan**, atau tekan **Ctrl+S** (**Cmd+S** di Mac).
2. Muncul **Cek sebelum simpan** berisi semua perubahan: yang dihapus dicoret merah, yang baru hijau. Kalau mau, isi catatan singkat; catatan ini masuk riwayat.
3. Klik **Simpan sekarang**.

Pengunjung portal mendapat versi baru saat membuka atau memuat ulang portal. Portal tampil dulu dengan salinan terakhir yang dia punya, lalu berganti ke versi baru dalam sekitar satu detik.

## Draf otomatis

Selama kamu mengetik, draf disimpan di browser ini. Kalau tab tertutup atau baterai habis sebelum sempat simpan, buka lagi editornya: akan muncul **Ada draf yang belum disimpan** dengan pilihan **Pulihkan draf** atau **Buang**.

Draf hanya ada di perangkat dan browser tempat kamu mengetik, bukan di server. Kalau pindah halaman atau menutup tab saat masih ada perubahan, browser akan bertanya dulu.

## Kalau diedit dari dua tempat

Misalnya kamu membuka editor di laptop dan HP, lalu menyimpan dari keduanya. Simpan yang kedua tidak langsung menimpa. Editor menampilkan **Ada versi yang lebih baru** beserta apa yang berubah di server, dan tiga pilihan:

- **Gabungkan**: perubahan dari server diambil, lalu perubahanmu dipasang di atasnya. Kalau bagian yang sama diubah di dua tempat, versimu yang dipakai dan bagian itu didaftar supaya bisa kamu cek. Setelah itu kamu cek lagi sebelum simpan.
- **Timpa**: simpan versimu apa adanya. Versi server yang tertimpa tetap ada di Riwayat.
- **Pakai versi server**: buang perubahanmu.

## Riwayat

Setiap kali kamu menyimpan atau mengembalikan ke bawaan, versi sebelumnya disimpan. Tab **Riwayat** menampilkan 20 yang terakhir, lengkap dengan siapa, kapan, dan catatannya.

- **Lihat perubahan** menunjukkan beda versi itu dengan versi sesudahnya.
- **Pulihkan rev N** memuat versi itu ke draf. Belum ada yang berubah di portal sampai kamu simpan seperti biasa. Memulihkan tidak menghapus riwayat apa pun.

Simpan pertama tidak membuat entri riwayat, karena yang digantikan adalah versi bawaan yang sudah ada di repo.

## Kembalikan ke bawaan

**Kembalikan ke bawaan** menghapus dokumen konten itu dari Firestore, sehingga portal kembali memakai file JSON dari repo. Versi terakhir sebelum dihapus masuk Riwayat, jadi masih bisa dipulihkan.

## Kalau JSON di repo diubah

Blok jadwal yang baru ditambahkan ke repo (misalnya Blok 4 dari skrip `npm run data`) langsung tampil, walaupun jadwal di Firestore disimpan sebelum blok itu ada. Portal dan editor menambahkan blok baru itu ke versi Firestore tanpa mengubah apa pun yang sudah kamu terbitkan (pembatalan, link online, tag, sesi tambahan tetap ada), begitu juga dosen yang baru muncul di blok itu. Begitu kamu menerbitkan perubahan jadwal berikutnya, blok baru itu ikut tersimpan di Firestore; setelah itu, kalau blok itu kamu hapus, dia tidak muncul lagi. Blok baru tidak ditambahkan kalau di Firestore sudah ada blok berkode sama (misalnya `b4`) atau blok yang tanggalnya bertabrakan dengannya.

Begitu juga channel baru dari repo, misalnya **Try Out OSPE**: channel itu langsung muncul tepat setelah Try Out CBT, walaupun daftar channel di Firestore disimpan sebelum channel itu ada, dan channel lain serta teks halaman yang sudah kamu ubah tetap seperti semula. Setelah daftar channel diterbitkan lagi, channel itu ikut tersimpan; kalau kemudian kamu hapus, dia tidak muncul lagi.

Untuk perubahan lain di JSON repo, selama sebuah konten punya versi di Firestore, portal memakai versi Firestore itu dan mengabaikan file JSON di repo. Jadi perubahannya tidak terlihat di portal sampai kamu memilih salah satu:

- Setelah Netlify selesai deploy, buka konten itu di editor dan klik **Kembalikan ke bawaan**. Editor dan portal sekarang memakai file dari repo.
- Atau, kalau perubahan di Firestore juga mau dipertahankan, pakai **Impor JSON** dengan file baru itu, cek perubahannya, lalu simpan.

## Ekspor dan impor

- **Ekspor JSON** mengunduh isi draf saat ini sebagai file `alphangers-{konten}-{tanggal}.json`. Berguna sebagai cadangan sebelum perubahan besar.
- **Impor JSON** membaca file seperti itu. Isinya dicek dulu; kalau valid, isinya menggantikan draf dan kamu simpan seperti biasa.

## Mode JSON

Untuk perubahan besar sekaligus, misalnya menempel banyak data. Teks dicek setiap kali kamu berhenti mengetik, dan error ditampilkan dengan nomor baris dan kolom. Selama JSON belum valid, isinya tidak masuk draf. **Rapikan** merapikan indentasi. Tombol Tab menambah spasi; tekan Esc dulu kalau mau pindah fokus dengan Tab.

## Tombol keyboard

| Tombol | Fungsi |
| --- | --- |
| Ctrl+S atau Cmd+S | Simpan (membuka Cek sebelum simpan) |
| Esc | Menutup dialog |
| Tab | Pindah antar kolom (di mode JSON: Esc dulu) |
| Panah atas dan bawah | Memilih nama di daftar saran dosen, Enter untuk memilih |
