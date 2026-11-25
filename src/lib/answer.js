// Typed answers: a try out question of type "sa" is answered by typing, and the typed text is
// checked against the question's keys (its `a`, the answers as the question writers wrote them).
// Shared by the try out page (src/legacy/app.js), the seal script and the tests.
//
// A typed answer is right when it says what one of the keys says. Case, accents, punctuation and
// spacing do not count, and neither does a leading os, ossa, m., musculus, n., nervus, a., arteria,
// v., vena or regio in front of a name (on both sides, and only when a name follows it). A key
// written "X atau Y" takes X, Y, or the two with atau between them either way round. A key that
// lists several things, separated by commas, semicolons, &, +, new lines or the words dan, serta or
// and, takes the same things in any order. Anything else is for the student to judge: the page
// shows the key and lets them count their answer right themselves.

const LEAD = new Set(['os', 'ossa', 'm', 'mm', 'musculus', 'musculi', 'n', 'nn', 'nervus', 'nervi', 'a', 'aa', 'arteria', 'arteriae', 'v', 'vv', 'vena', 'venae', 'regio']);
const ITEMS = /[,;&+\n\r]|\s(?:dan|serta|and)\s/i;
const OR = /\s+atau\s+/i;

/** One name as compared: lower case, no accents or punctuation, single spaces, no leading os, m. … */
export function normName(s) {
  const w = String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (w.length > 1 && LEAD.has(w[0])) w.shift();
  return w.join(' ');
}

/** What an answer says, as compared: its names, in order, one per line ("" when it says nothing). */
export function answerForm(s) {
  return String(s ?? '')
    .split(ITEMS)
    .map(normName)
    .filter(Boolean)
    .sort()
    .join('\n');
}

/** "X atau Y" as compared, whichever way round it is written ("" without two sides to an atau). */
function eitherForm(s) {
  const sides = String(s ?? '').split(OR).map(answerForm).filter(Boolean);
  return sides.length > 1 ? 'atau:' + sides.sort().join('|') : '';
}

/** The forms a key accepts: the key itself and, for "X atau Y", each of X and Y and the pair either way round. */
export function keyForms(key) {
  const out = [];
  for (const part of [key, ...String(key ?? '').split(OR)]) {
    const f = answerForm(part);
    if (f && !out.includes(f)) out.push(f);
  }
  const either = eitherForm(key);
  if (either) out.push(either);
  return out;
}

/** True when the typed text matches one of the keys. */
export function answerOk(keys, typed) {
  const got = answerForm(typed);
  if (!got || !Array.isArray(keys)) return false;
  const either = eitherForm(typed);
  return keys.some((k) => {
    const forms = keyForms(k);
    return forms.includes(got) || (!!either && forms.includes(either));
  });
}
