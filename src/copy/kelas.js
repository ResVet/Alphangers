// Texts of src/features/kelas/kelas.js: the class photo.
// Keys start with their group ("kelas.") and are used through kHTML() / kAttrs() / kText() / kSet() / tx()
// from src/lib/texts.js. Each default is the text the page showed before it became editable.
import { registerCopy, registerLabels } from '../lib/texts.js';
import { GROUP_LABELS } from './groups.js';

// kelas.js builds no words of its own: the heading, kicker and line under the photo are in
// index.html (kelas.kick, kelas.h1, kelas.h2, kelas.sub), and the full view reads them from there.
registerCopy('kelas', GROUP_LABELS.kelas, {
});

// what each of these index.html texts is called in the editor's lists (Semua teks halaman, Ubah teks)
registerLabels({
  'kelas.kick': 'Tulisan kecil di atas judul',
  'kelas.h1': 'Judul: bagian tebal',
  'kelas.h2': 'Judul: bagian miring',
  'kelas.sub': 'Kalimat di bawah judul',
  'kelas.note': 'Catatan di bawah judul',
});
