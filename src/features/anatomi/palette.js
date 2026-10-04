// Colours and grouping for the 55 parts of the heart model. The index order must match
// scripts/heart/parts.py, because that index is what the model stores on every vertex.
export const PARTS = [
  'heart',
  'ra', 'ra_aur', 'rv', 'rvot', 'la', 'la_aur', 'lv', 'apex', 'ivs', 'ias', 'fossa',
  'aorta_asc', 'aorta_arch', 'aorta_desc', 'bct', 'lcca', 'lsa', 'pt', 'rpa', 'lpa',
  'svc', 'ivc', 'rspv', 'ripv', 'lspv', 'lipv', 'lig_art',
  'rca', 'lmca', 'lad', 'diag', 'lcx', 'om', 'rmarg', 'pda',
  'gcv', 'mcv', 'scv', 'cs',
  'tv', 'pv', 'mv', 'av', 'chordae', 'pap_lv', 'pap_rv', 'modband',
  'san', 'internodal', 'avn', 'his', 'lbb', 'rbb', 'purk',
];
export const INDEX = Object.fromEntries(PARTS.map((id, i) => [id, i]));

export const GROUPS = {
  umum: 'Umum',
  ruang: 'Ruang dan dinding',
  pembuluh_besar: 'Pembuluh besar',
  koroner: 'Arteri koroner',
  vena_jantung: 'Vena jantung',
  katup: 'Katup dan penyangganya',
  konduksi: 'Sistem konduksi',
};

// Textbook convention: oxygen-rich vessels red, oxygen-poor blue, valves pale, conduction in the
// site's green so it reads as "the electrical part" at a glance. Muscle is a deep, slightly cool red.
const MUSCLE = '#8a2c27';
const COLORS = {
  heart: MUSCLE,
  ra: '#97392f', ra_aur: '#a04035', rv: '#8c2f29', rvot: '#94352d',
  la: '#953a33', la_aur: '#9c4137', lv: '#802823', apex: '#882c26',
  ivs: '#a84c40', ias: '#b05547', fossa: '#cf9478',
  aorta_asc: '#b93b32', aorta_arch: '#bd4035', aorta_desc: '#b4392f',
  bct: '#c3463a', lcca: '#c74b3e', lsa: '#c04237',
  pt: '#2c71ad', rpa: '#3176b2', lpa: '#3378b4',
  svc: '#2865a3', ivc: '#26619d',
  rspv: '#b84c46', ripv: '#b54843', lspv: '#bc514a', lipv: '#b94d47',
  lig_art: '#cbb49c',
  rca: '#e4503a', lmca: '#ea5a42', lad: '#e6553e', diag: '#ec674e', lcx: '#e2513c', om: '#e86449', rmarg: '#e96f53', pda: '#df4d38',
  gcv: '#3f7fc4', mcv: '#3d7bbe', scv: '#4b8bcc', cs: '#3571b5',
  tv: '#e6d6bd', pv: '#e2cfb4', mv: '#ebdcc3', av: '#e7d2b6',
  chordae: '#f1e6d2', pap_lv: '#a94b40', pap_rv: '#ae5044', modband: '#b85e4d',
  san: '#86f25e', internodal: '#7be852', avn: '#a6ff7e', his: '#8ff567', lbb: '#78e64e', rbb: '#78e64e', purk: '#5fd13c',
};

export function colorOf(id) {
  return COLORS[id] || MUSCLE;
}

// Parts that sit inside the heart and need the cut view, and the cut that shows each one best.
export const VIEW_FOR = {
  ivs: { mode: 'cut', cut: 'four' }, ias: { mode: 'cut', cut: 'four' }, fossa: { mode: 'cut', cut: 'four' },
  tv: { mode: 'cut', cut: 'base' }, pv: { mode: 'cut', cut: 'base' }, mv: { mode: 'cut', cut: 'base' }, av: { mode: 'cut', cut: 'base' },
  chordae: { mode: 'cut', cut: 'four' }, pap_lv: { mode: 'cut', cut: 'front' }, pap_rv: { mode: 'cut', cut: 'four' }, modband: { mode: 'cut', cut: 'four' },
  san: { mode: 'ecg' }, internodal: { mode: 'ecg' }, avn: { mode: 'ecg' }, his: { mode: 'ecg' }, lbb: { mode: 'ecg' }, rbb: { mode: 'ecg' }, purk: { mode: 'ecg' },
};
