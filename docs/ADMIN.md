# Memakai editor admin

Semua dikerjakan dari `alphangers.netlify.app/?admin`. Di sana ada tiga tampilan yang bisa dipindah kapan saja dari dock di bawah layar:

- **Lihat**: halaman persis seperti yang dilihat pengunjung.
- **Edit**: ubah langsung di halaman. Paling cepat buat perubahan sehari-hari: batalin sesi, ganti teks, nambah dosen, unggah foto divisi.
- **Panel**: editor formulir yang lengkap (formulir per blok jadwal dan per dosen, mode JSON, riwayat versi, impor dan ekspor, kembali ke versi bawaan), dibuka di atas halaman.

Ketiganya memakai draf yang sama. Teks yang kamu ketik di Edit sudah ada waktu Panel dibuka, dan yang kamu ubah atau simpan di Panel langsung kelihatan di halaman begitu kembali ke Lihat atau Edit. Panel yang sama juga masih bisa dibuka sendiri di `/admin/`; tombol **Ke halaman** di kanan atasnya membawa kembali ke `/?admin`.

Kalau Firebase belum disambungkan, panel admin menampilkan langkah setup. Ikuti [FIREBASE_SETUP.md](FIREBASE_SETUP.md) dulu.

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

### Mengubah kartu (sesi, dosen, channel, pengumuman, divisi, foto)

Di mode Edit, ketuk atau klik sebuah kartu. Kartu itu diberi bingkai hijau dan muncul bar aksi: di sebelah kartu kalau di laptop, di atas dock kalau di HP. Di mode Edit, klik pada kartu tidak membuka apa-apa (dosen, channel, foto), jadi tidak ada yang berpindah halaman di tengah-tengah edit. Tombol tanggal di jadwal dan panah di divisi tetap jalan seperti biasa.

Di atas tiap bagian ada baris alat untuk menambah: **+ Sesi**, **+ Dosen**, **+ Channel**, **+ Pengumuman**, **+ Divisi**, dan sebagainya.

### Jadwal dan pembatalan

- **Batalkan** di bar aksi sebuah sesi: isi alasannya (boleh kosong). Sesi tetap tampil, dengan label merah Dibatalkan, alasannya, dan pita merah di kartunya. Sesi yang dibatalkan tidak dihitung di "Lagi jalan", "Berikutnya", dan hitung mundur ujian, dan ikut terekspor ke kalender sebagai dibatalkan. **Aktifkan lagi** mengembalikannya.
- **Batalkan semua hari ini** di baris alat jadwal membatalkan semua sesi di tanggal yang sedang tampil. **Aktifkan semua** kebalikannya.
- **+ Sesi** menambah sesi di tanggal yang sedang tampil. Dosen dipilih dengan mengetik namanya; kode dosen dibuat otomatis dan dicatat di jadwal dan di data dosen sekaligus.
- **Ubah** membuka formulir lengkap sesi itu, termasuk memindahnya ke tanggal lain. **Duplikat** menyalin sesi tepat sesudahnya.
- **Libur**, **Ubah blok**, dan **+ Blok** ada di baris alat. Ketuk tombol blok (Blok 1, Blok 2, ...) di mode Edit untuk mengubah atau menghapus blok itu.

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

### Link Drive

Kartu-kartu link di portal. Urutan di editor sama dengan urutan di portal; pakai tombol panah untuk memindah. Link harus `https://`, dan editor memberi peringatan kalau bukan folder `drive.google.com`. Channel Try Out tidak punya link karena membuka CBT di portal.

Dokumen yang sama juga menyimpan teks halaman yang sudah diubah (`site.t`), foto kelas (`site.photo`), dan daftar divisi beserta fotonya (`divisi`). Ketiganya paling enak diubah langsung dari halaman portal; di panel admin kelihatan di mode JSON. Selama `divisi` belum ada di dokumen, portal memakai daftar divisi bawaan dari repo.

### Pengumuman

Judul, isi, label (info, deadline, ujian, penting), tanggal posting, tenggat, link, dan tanggal sembunyi. Pengumuman yang disematkan tampil paling atas. Setelah lewat tanggal sembunyi, pengumuman hilang sendiri dari portal tanpa perlu dihapus. Pengumuman yang punya tenggat juga hilang begitu tenggatnya lewat, dan selama masih jalan portal menampilkan hitung mundurnya. Pengumuman dengan tanggal posting di masa depan baru muncul di hari itu. Isi ditampilkan sebagai teks biasa, jadi kode HTML tidak akan jalan.

### Jadwal

Pilih blok di tab atas. Di dalam blok ada info blok, daftar kode dosen, lalu hari dan sesi. Klik sesi untuk mengubah jam, judul, jenis, dan dosennya. Untuk menambah dosen ke sesi, ketik sebagian namanya (tanpa gelar) lalu pilih; kode dosennya dibuat otomatis. **Duplikat** menyalin sesi, berguna untuk sesi yang mirip. Editor memberi peringatan kalau ada jam yang bentrok di hari yang sama.

### Dosen

Cari dengan nama, spesialisasi, atau sebagian nomor. Nomor telepon dirapikan otomatis setelah kamu pindah dari kolomnya (misalnya `081234567890` jadi `0812-3456-7890`), dan editor menunjukkan ke nomor WhatsApp mana tombol chat di portal akan mengarah. Nomor di sini tampil publik di portal. Kalau dosen masih dipakai di jadwal, menghapusnya akan memberi peringatan dulu. Kalau muncul banner kuning soal data blok, klik **Samakan dengan jadwal**.

### Jantung 3D

Teks untuk tiap bagian model jantung. Pilih bagian dari daftar atau pakai tombol sebelumnya dan berikutnya. ID bagian tidak bisa diubah karena terikat ke model 3D.

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

Selama sebuah konten punya versi di Firestore, portal memakai versi Firestore itu dan mengabaikan file JSON di repo. Jadi kalau JSON di repo diperbarui (misalnya jadwal blok baru dari skrip `npm run data`), perubahannya tidak terlihat di portal sampai kamu memilih salah satu:

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
