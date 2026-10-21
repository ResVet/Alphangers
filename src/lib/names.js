// How a name from the class list is shown. The list is written in capitals, the way the tutors'
// attendance sheet has it; people write their names in title case. Shared by the try out server
// (netlify/lib/cbt.mjs), which shows the name when a student checks a NIM, and the admin page.

/**
 * DIMAS PRATAMA SAPUTRA as "Dimas Pratama Saputra". A word starts with a capital also after a
 * hyphen, a dot or a leading apostrophe: AZ-ZAHRA is "Az-Zahra", M.FARID "M.Farid", NUR 'AINI
 * "Nur 'Aini", while NUR'AINI stays "Nur'aini". A name that is not all capitals was typed by an
 * admin and stays as typed.
 */
export function displayName(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s.-])([^\p{L}\s]*)(\p{L})/gu, (_, sep, lead, ch) => sep + lead + ch.toUpperCase());
}
