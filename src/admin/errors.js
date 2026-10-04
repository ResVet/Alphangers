// Thrown by save and reset when the server copy moved on since this tab loaded it.
export class ConflictError extends Error {
  constructor(remote) {
    super('Content changed on the server since it was loaded.');
    this.name = 'ConflictError';
    this.remote = remote;
  }
}

// Turns SDK and network errors into one short Indonesian sentence.
export function explain(e) {
  const code = (e && e.code) || '';
  if (code.endsWith('permission-denied')) return 'Server menolak. Cek apakah akun ini admin dan rules sudah di-deploy.';
  if (code.endsWith('unavailable') || code === 'auth/network-request-failed') return 'Gagal tersambung ke server. Cek internet lalu coba lagi.';
  if (code.endsWith('failed-precondition')) return 'Index Firestore belum siap. Kalau baru di-deploy, tunggu beberapa menit. Kalau belum, jalankan npx firebase deploy --only firestore';
  if (code.endsWith('resource-exhausted')) return 'Kuota Firestore habis untuk hari ini.';
  if (code === 'auth/unauthorized-domain') return 'Domain ini belum ada di Authorized domains (Firebase Auth > Settings).';
  if (code === 'auth/operation-not-allowed') return 'Login Google belum diaktifkan di Firebase Auth.';
  if (code === 'auth/user-disabled') return 'Akun ini dinonaktifkan di Firebase Auth.';
  if (code === 'auth/web-storage-unsupported') return 'Browser ini memblokir data pihak ketiga (misalnya di jendela Incognito), jadi login Google tidak bisa jalan. Buka di jendela biasa, atau izinkan cookie pihak ketiga untuk situs ini.';
  if (code === 'app/redirect-lost') return 'Login lewat halaman Google tidak selesai di browser ini. Izinkan pop-up untuk situs ini, lalu klik Masuk lagi.';
  return 'Ada yang gagal: ' + ((e && e.message) || String(e));
}
