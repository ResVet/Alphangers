// Texts of src/features/divisi/divisi.js: the divisions. A division's name, full name, tag,
// description and photos are content with their own editor.
// Keys start with their group ("divisi.") and are used through kHTML() / kAttrs() / kText() / kSet() / tx()
// from src/lib/texts.js. Each default is the text the page showed before it became editable.
import { registerCopy, registerLabels } from '../lib/texts.js';
import { GROUP_LABELS } from './groups.js';

registerCopy('divisi', GROUP_LABELS.divisi, {
  'divisi.h1': 'orang-orang di balik',
  'divisi.h2': 'kelas ini.',
  'divisi.lede': { d: 'Delapan divisi, satu kelas. Ini mereka yang ngurus Class Alpha di balik layar.', h: 'Muncul kalau divisinya ada delapan' },
  'divisi.lede.other': { d: 'Divisi Class Alpha, yang ngurus kelas di balik layar.', h: 'Muncul kalau jumlah divisinya bukan delapan' },
  'divisi.note': { d: '', opt: true, ml: true, ph: 'Catatan di bawah judul (kosong = tidak tampil)' },
  'divisi.more': 'Lihat semua foto',
  'divisi.soon': { d: 'Foto menyusul', h: 'Di slot foto yang masih kosong' },
  'divisi.view.kick': { d: 'Divisi {no}', h: 'Di atas nama divisi pas fotonya dibuka penuh' },
});

// what each text is called in the editor's lists (Semua teks halaman, Ubah teks)
registerLabels({
  'divisi.h1': 'Judul: bagian tebal',
  'divisi.h2': 'Judul: bagian miring',
  'divisi.lede': 'Kalimat di bawah judul: delapan divisi',
  'divisi.lede.other': 'Kalimat di bawah judul: bukan delapan',
  'divisi.note': 'Catatan di bawah judul',
  'divisi.more': 'Tombol lihat semua foto',
  'divisi.soon': 'Tulisan di slot foto kosong',
  'divisi.view.kick': 'Layar foto: nomor divisi di atas nama',
});
