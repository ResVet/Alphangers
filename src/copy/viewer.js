// Texts of src/features/viewer/viewer.js: the photo and detail viewer. The words around the photo
// (kicker, title, caption, description) come from the section that opens it.
// Keys start with their group ("viewer.") and are used through kHTML() / kAttrs() / kText() / kSet() / tx()
// from src/lib/texts.js. Each default is the text the page showed before it became editable.
import { registerCopy, registerLabels } from '../lib/texts.js';
import { GROUP_LABELS } from './groups.js';

registerCopy('viewer', GROUP_LABELS.viewer, {
  'viewer.hint.touch': { d: 'Ketuk 2x atau cubit buat zoom, geser buat ganti foto', h: 'Di HP dan tablet' },
  'viewer.hint.mouse': { d: 'Scroll atau klik 2x buat zoom, panah buat ganti foto', h: 'Di laptop, pakai mouse' },
});

// what each text is called in the editor's lists (Semua teks halaman, Ubah teks)
registerLabels({
  'viewer.hint.touch': 'Petunjuk di atas foto: HP dan tablet',
  'viewer.hint.mouse': 'Petunjuk di atas foto: laptop',
});
