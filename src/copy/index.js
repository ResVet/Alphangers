// Every declared page text, loaded together for the editor's list of page texts. Each section
// imports its own file when it loads; the editor imports this one to see them all.
import './shell.js';
import './tryout.js';
import './info.js';
import './jadwal.js';
import './find.js';
import './dosen.js';
import './anatomi.js';
import './divisi.js';
import './kelas.js';
import './viewer.js';

export { listCopy, copyEntry } from '../lib/texts.js';
export { GROUPS, GROUP_LABELS, groupOf } from './groups.js';
