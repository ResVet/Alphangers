# Memakai editor admin

Editor ada di `/admin/` (misalnya `https://alphangers.netlify.app/admin/`). Halaman ini sengaja tidak ditautkan dari portal dan tidak muncul di mesin pencari, jadi simpan sebagai bookmark.

Kalau Firebase belum disambungkan, halaman ini menampilkan langkah setup. Ikuti [FIREBASE_SETUP.md](FIREBASE_SETUP.md) dulu.

## Masuk

Klik **Masuk dengan Google** dan pilih akun admin. Login tersimpan di browser itu sampai kamu klik **Keluar** di kanan atas. Di komputer pinjaman atau komputer lab, selalu keluar setelah selesai.

Kalau muncul **Belum bisa masuk**, akun itu belum terdaftar sebagai admin. Halaman itu menampilkan UID akun dan cara mendaftarkannya.

## Tampilan

Daftar konten ada di kiri (laptop) atau di baris atas (HP). Titik kuning di sebelah nama berarti konten itu punya perubahan yang belum disimpan.

Di bawah judul tertulis versi yang sedang dipakai portal, misalnya "Firestore rev 4, disimpan 2 jam lalu oleh kamu", atau "Versi bawaan dari repo" kalau konten itu belum pernah disimpan.

Tiap konten punya tiga mode: **Form** untuk edit biasa, **JSON** untuk edit teks mentah, dan **Riwayat** untuk versi-versi lama. Tombol **Batalkan perubahan** dan **Simpan** selalu ada di bar paling bawah.

## Lima jenis konten

### Link Drive

Kartu-kartu link di portal. Urutan di editor sama dengan urutan di portal; pakai tombol panah untuk memindah. Link harus `https://`, dan editor memberi peringatan kalau bukan folder `drive.google.com`. Channel Try Out tidak punya link karena membuka CBT di portal.

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
