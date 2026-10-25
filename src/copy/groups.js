// The groups the editor lists page texts under, in the order they come on the page, with the
// label it shows. A key's group is the part before its first dot: "jadwal.empty" is in Jadwal.
// Texts typed straight into index.html are grouped the same way.
export const GROUPS = [
  ['loader', 'Layar pembuka'],
  ['bar', 'Bar atas'],
  ['hero', 'Pembuka'],
  ['info', 'Pengumuman'],
  ['jadwal', 'Jadwal'],
  ['menu', 'Channel'],
  ['ch', 'Halaman channel'],
  ['to', 'Try out'],
  ['dosen', 'Dosen'],
  ['siklus', 'Siklus jantung'],
  ['anatomi', 'Jantung 3D'],
  ['divisi', 'Divisi'],
  ['kelas', 'Foto kelas'],
  ['foot', 'Kaki halaman'],
  ['find', 'Pencarian'],
  ['viewer', 'Foto dan detail'],
  ['app', 'Pesan umum'],
];

export const GROUP_LABELS = Object.fromEntries(GROUPS);

/** The group id of a key, or 'lain' when its first part is not a known group. */
export function groupOf(key) {
  const g = String(key).split('.')[0];
  return Object.prototype.hasOwnProperty.call(GROUP_LABELS, g) ? g : 'lain';
}
