# Menyambungkan Firebase

Panduan ini menyambungkan portal Alphangers ke Firebase supaya isi portal bisa diedit dari `/admin/` pakai akun Google kamu sendiri. Tanpa langkah ini pun portal tetap jalan: selama `src/lib/firebase-config.js` masih `null`, portal memakai JSON bawaan dari repo dan tidak menghubungi server mana pun.

Waktu yang dibutuhkan kira-kira 20 menit. Paket gratis (Spark) sudah cukup.

## Yang perlu disiapkan

- Akun Google yang akan jadi admin.
- Repo ini sudah ter-clone dan `npm install` sudah dijalankan (Node 20 atau lebih baru).
- Situs Netlify yang sudah jalan, dan kamu tahu domainnya. Contoh di panduan ini: `alphangers.netlify.app`. Ganti dengan domain kamu.

## Langkah wajib

### 1. Buat project Firebase

1. Buka [console.firebase.google.com](https://console.firebase.google.com) dan login dengan akun Google kamu.
2. Klik **Create a project**. Beri nama, misalnya `alphangers`.
3. Google Analytics tidak dipakai, boleh dimatikan.
4. Setelah jadi, catat **Project ID** (terlihat di Project settings). Bentuknya huruf kecil dan tanda hubung, misalnya `alphangers-1a2b3`.

### 2. Aktifkan login Google

1. Menu kiri: **Build > Authentication**, klik **Get started**.
2. Tab **Sign-in method**, pilih **Google**, nyalakan **Enable**.
3. Isi **Project support email** dengan email kamu, lalu **Save**.

Metode login lain tidak usah dinyalakan. Rules hanya menerima akun Google yang emailnya sudah terverifikasi.

### 3. Buat database Firestore

1. Menu kiri: **Build > Firestore Database**, klik **Create database**.
2. Kalau ditanya edisi, pilih **Standard**. Database ID biarkan `(default)`.
3. Lokasi: **asia-southeast2 (Jakarta)**. Lokasi tidak bisa diganti setelah dibuat.
4. Pilih **Start in production mode**, lalu **Create**.

Production mode menolak semua akses sampai rules dari repo dipasang di langkah 5.

### 4. Daftarkan web app dan isi config

1. Klik ikon gear di kiri atas, **Project settings**, tab **General**.
2. Di bagian **Your apps**, klik ikon web (`</>`). Nickname bebas, misalnya `portal`. Firebase Hosting tidak usah dicentang. Klik **Register app**.
3. Firebase menampilkan objek `firebaseConfig`. Salin empat nilai ini ke `src/lib/firebase-config.js`:

   ```js
   export const firebaseConfig = {
     apiKey: 'AIza...',
     authDomain: 'alphangers-1a2b3.firebaseapp.com',
     projectId: 'alphangers-1a2b3',
     appId: '1:1234567890:web:abc123',
   };
   ```

   Field lain (`storageBucket`, `messagingSenderId`, `measurementId`) tidak dipakai, boleh dibuang.

Nilai-nilai ini memang publik dan aman di-commit. Isinya cuma alamat project, bukan kunci akses. Yang menentukan siapa boleh baca dan tulis adalah rules di langkah 5, ditambah pembatasan API key di langkah 7.

### 5. Pasang rules dan index

Dari folder repo:

```sh
cp .firebaserc.example .firebaserc
# buka .firebaserc, ganti your-project-id dengan Project ID kamu

npx firebase login
npx firebase deploy --only firestore
```

Perintah terakhir memasang `firestore.rules` dan `firestore.indexes.json`. Index untuk tab Riwayat butuh beberapa menit sampai siap. Selama belum siap, tab Riwayat menampilkan "Index Firestore belum siap". Simpan dan baca tetap jalan.

Setiap kali `firestore.rules` diubah, jalankan lagi `npx firebase deploy --only firestore`.

### 6. Izinkan domain situs untuk login

1. **Build > Authentication**, tab **Settings**, bagian **Authorized domains**.
2. Klik **Add domain**, isi `alphangers.netlify.app` (tanpa `https://`).
3. Kalau pakai domain sendiri, tambahkan juga.

`localhost` sudah ada dari awal, jadi login juga jalan di `npm run dev`. Deploy preview Netlify punya domain berbeda, jadi login di sana memang tidak jalan kecuali domainnya ditambahkan.

### 7. Batasi API key

API key di config bisa dilihat siapa pun yang membuka portal. Batasi supaya hanya situs kamu yang bisa memakainya, dan hanya untuk layanan yang dipakai.

1. Buka [console.cloud.google.com](https://console.cloud.google.com), pilih project yang sama.
2. **APIs & Services > Credentials**. Di **API keys**, klik key yang namanya **Browser key (auto created by Firebase)**.
3. **Application restrictions**: pilih **Websites**, lalu tambahkan:
   - `https://alphangers.netlify.app/*`
   - `https://alphangers-1a2b3.firebaseapp.com/*` (ganti dengan Project ID kamu; halaman login Google memakai key yang sama dari domain ini)
   - `http://localhost:5173/*` kalau kamu mau login dari `npm run dev`
4. **API restrictions**: pilih **Restrict key**, centang:
   - **Cloud Firestore API**
   - **Identity Toolkit API**
   - **Token Service API**
5. **Save**. Perubahan butuh sampai 5 menit untuk berlaku.

### 8. Deploy dan login pertama

1. Commit `src/lib/firebase-config.js` (dan `.firebaserc` kalau mau), push, tunggu Netlify selesai build.
2. Buka `https://alphangers.netlify.app/admin/`, klik **Masuk dengan Google**.
3. Karena belum ada admin, halaman menampilkan **Belum bisa masuk** beserta UID kamu. Klik **Salin UID**.

### 9. Jadikan akun kamu admin

1. Firebase console, **Build > Firestore Database**, tab **Data**.
2. Klik **Start collection**. Collection ID: `admins`.
3. Document ID: tempel UID dari langkah 8.
4. Tambah satu field: nama `role`, tipe string, isi `owner`. Rules hanya mengecek dokumennya ada, isinya bebas.
5. **Save**, lalu muat ulang halaman admin. Editor terbuka.

Collection `admins` tidak bisa ditulis dari aplikasi, jadi dokumen ini hanya bisa dibuat dan dihapus dari console.

### 10. Coba

1. Di admin, buka **Link Drive**, ubah satu deskripsi, klik **Simpan**, cek perubahannya, lalu **Simpan sekarang**.
2. Buka portal di tab baru. Portal tampil dulu dengan data terakhir yang dia punya, lalu dalam sekitar satu detik berganti ke versi dari Firestore.

Panduan memakai editornya ada di [ADMIN.md](ADMIN.md).

## Menambah atau mencabut admin

- Tambah: orang itu login di `/admin/`, mengirim UID-nya ke kamu, kamu buat dokumen `admins/{UID}` seperti langkah 9.
- Cabut: hapus dokumennya. Rules mengecek setiap kali ada simpan, jadi pencabutan langsung berlaku.

Kalau ada admin kedua, pastikan dia juga memakai akun Google dengan verifikasi dua langkah.

## Kuota paket gratis

Paket Spark memberi 50.000 baca dan 20.000 tulis dokumen per hari. Satu kunjungan portal membaca paling banyak lima dokumen (satu per jenis konten yang dibuka), jadi kuota baru habis di sekitar 10.000 kunjungan sehari. Kalau kuota habis, portal tidak rusak: dia memakai salinan terakhir di browser atau data bawaan, sampai kuota pulih keesokan harinya.

## Opsional: App Check

App Check membuktikan bahwa permintaan ke Firebase datang dari aplikasi kamu, memakai reCAPTCHA Enterprise. Di proyek ini manfaatnya terbatas:

- Portal membaca Firestore lewat REST biasa tanpa token App Check (supaya tidak perlu memuat SDK Firebase yang berat). Jadi **jangan pernah klik Enforce untuk Cloud Firestore**. Kalau di-enforce, semua bacaan portal ditolak dan portal akan terus menampilkan data lama atau bawaan.
- Yang tersisa adalah metrik: kamu bisa melihat berapa permintaan admin yang terverifikasi.

Penjaga utama tetap rules: hanya admin yang bisa menulis, dan isi yang dibaca portal selalu divalidasi ulang. Kalau tetap mau memasang:

1. Google Cloud console, cari **reCAPTCHA Enterprise API**, klik **Enable**.
2. **Security > reCAPTCHA**, buat key tipe **Website**, domain `alphangers.netlify.app`. Salin site key-nya.
3. Firebase console, **Build > App Check**, tab **Apps**, pilih web app, provider **reCAPTCHA Enterprise**, tempel site key, **Save**.
4. Di `src/lib/firebase-config.js`, isi `export const appCheckSiteKey = '6Lc...';`.
5. Di `netlify.toml`, blok `/admin/*`, tambahkan host berikut ke CSP (daftarnya juga ada di komentar file itu):
   - `script-src`: `https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/`
   - `frame-src`: `https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/`
   - `connect-src`: `https://content-firebaseappcheck.googleapis.com`
6. Di pembatasan API key (langkah 7), centang juga **Firebase App Check API**.
7. Deploy, buka admin, lalu cek **App Check > APIs** di console: permintaan dari admin harus tercatat sebagai verified.

## Opsional: login lewat domain sendiri

Admin login memakai popup. Kalau popup diblokir, halaman pindah ke cara redirect. Cara redirect ini bisa gagal diam-diam di Safari, Firefox, dan browser lain yang memblokir storage pihak ketiga, karena halaman login ada di domain `firebaseapp.com`, bukan domain situs. Gejalanya: setelah memilih akun, kamu kembali ke halaman admin dalam keadaan belum login.

Solusi termudah: izinkan popup untuk situs ini. Kalau mau benar-benar beres, sajikan halaman login dari domain situs sendiri:

1. Di `netlify.toml`, buka komentar dua blok `[[redirects]]` di bagian bawah dan ganti `YOUR-PROJECT-ID`.
2. Di blok `/admin/*` pada file yang sama, ganti `frame-src https://*.firebaseapp.com` menjadi `frame-src 'self'`.
3. Di `src/lib/firebase-config.js`, ganti `authDomain` menjadi `alphangers.netlify.app`.
4. Google Cloud console, **APIs & Services > Credentials**, di **OAuth 2.0 Client IDs** klik **Web client (auto created by Google Service)**. Di **Authorized redirect URIs** tambahkan `https://alphangers.netlify.app/__/auth/handler`. **Save**.
5. Deploy, lalu coba login di Safari.

## Menguji rules di komputer sendiri

Butuh Java 21 untuk emulator Firestore.

```sh
npx firebase emulators:exec --only firestore --project demo-alphangers "node --test tests/firestore.rules.test.mjs"
```

Project ID yang diawali `demo-` membuat emulator tidak menyentuh project sungguhan.

## Kalau ada masalah

| Gejala | Penyebab dan solusi |
| --- | --- |
| Login: "Domain ini belum ada di Authorized domains" | Langkah 6 belum, atau domainnya salah ketik. |
| Login: "Login Google belum diaktifkan" | Langkah 2 belum. |
| Setelah login selalu "Belum bisa masuk" | Document ID di `admins` tidak sama persis dengan UID. Salin ulang dengan tombol **Salin UID**. |
| "Status admin tidak bisa dicek" | Rules belum di-deploy (langkah 5). |
| Simpan: "Server menolak" | Rules belum di-deploy, atau akun ini bukan admin lagi. |
| Riwayat: "Index Firestore belum siap" | Tunggu beberapa menit setelah langkah 5. |
| Setelah pilih akun Google, kembali ke admin tanpa login | Popup diblokir dan cara redirect gagal. Izinkan popup, atau lihat bagian login lewat domain sendiri. |
| Admin jalan tapi portal tidak berubah | Buka console browser di portal. Pesan `[content] Could not fetch` dengan HTTP 403 biasanya berarti pembatasan API key (langkah 7) belum memuat domain situs. |
| Portal tidak berubah, tanpa pesan apa pun | `firebase-config.js` masih `null` di versi yang ter-deploy. Cek Netlify sudah build commit terbaru. |
