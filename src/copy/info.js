// Texts of src/features/info/info.js: the announcements board.
// Keys start with their group ("info.") and are used through kHTML() / kAttrs() / kText() / kSet() / tx()
// from src/lib/texts.js. Each default is the text the page showed before it became editable.
// The day words on a card ("hari ini", "besok") are the schedule's ('jadwal.day.*').
import { registerCopy, registerLabels } from '../lib/texts.js';
import { GROUP_LABELS } from './groups.js';

registerCopy('info', GROUP_LABELS.info, {
  'info.h': 'Pengumuman',
  'info.n': '{n} aktif',
  'info.tag.info': 'Info',
  'info.tag.deadline': 'Deadline',
  'info.tag.ujian': 'Ujian',
  'info.tag.penting': 'Penting',
  'info.pin': 'Disematkan',
  'info.more': 'Selengkapnya',
  'info.less': 'Ringkas',
  'info.due': 'Tenggat',
  'info.left': { d: '{time} lagi', h: '{time} diisi sisa waktunya, misalnya 2 hari 4 jam' },
  'info.link': 'Buka tautan',
  'info.all': 'Lihat {n} pengumuman lain',
  'info.fewer': 'Tampilkan lebih sedikit',
});

// what each text is called in the editor's lists (Semua teks halaman, Ubah teks)
registerLabels({
  'info.h': 'Judul di atas kartu',
  'info.n': 'Samping judul: jumlah yang aktif',
  'info.tag.info': 'Kartu: tag info',
  'info.tag.deadline': 'Kartu: tag deadline',
  'info.tag.ujian': 'Kartu: tag ujian',
  'info.tag.penting': 'Kartu: tag penting',
  'info.pin': 'Kartu: tanda disematkan',
  'info.more': 'Kartu: tombol selengkapnya',
  'info.less': 'Kartu: tombol ringkas',
  'info.due': 'Kartu: label tenggat',
  'info.left': 'Kartu: sisa waktu tenggat',
  'info.link': 'Kartu: tombol buka tautan',
  'info.all': 'Bawah daftar: tombol lihat semua',
  'info.fewer': 'Bawah daftar: tombol lebih sedikit',
});
