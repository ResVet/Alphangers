// Typed answers (src/lib/answer.js): when a typed text counts as one of a question's keys.
// The keys here are made up for the tests; none is from a real bank.
// Run: node --test tests/answer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { normName, answerForm, keyForms, answerOk } from '../src/lib/answer.js';

const right = (key, ...typed) => { for (const t of typed) assert.equal(answerOk([key], t), true, `${JSON.stringify(t)} for ${JSON.stringify(key)}`); };
const wrong = (key, ...typed) => { for (const t of typed) assert.equal(answerOk([key], t), false, `${JSON.stringify(t)} for ${JSON.stringify(key)}`); };

test('case, accents, punctuation and spacing do not count', () => {
  right('Mitokondria', 'mitokondria', 'MITOKONDRIA', '  mitokondria. ', 'Mitokóndria', '"Mitokondria"');
  right('Nucleus pulposus(?)', 'nucleus pulposus', 'Nucleus  pulposus');
  right('Corpus vitreum', 'corpus-vitreum', 'corpus_vitreum');
  wrong('Incus', 'inkus', 'incu', 'incus s');
  wrong('Mitokondria', 'mito kondria', 'ribosom');
});

test('a leading os, m., n., a., v. or regio is left out on both sides, only in front of a name', () => {
  right('M. masseter', 'masseter', 'musculus masseter', 'm masseter', 'M.masseter');
  right('Masseter', 'M. masseter', 'mm. masseter');
  right('N. facialis', 'facialis', 'nervus facialis', 'n.facialis');
  right('A. maxillaris', 'maxillaris', 'arteria maxillaris');
  right('Vena lingualis', 'v. lingualis', 'lingualis');
  right('Regio frontalis', 'frontalis');
  right('Os frontale', 'frontale', 'ossa frontale');
  wrong('M. masseter', 'm', 'musculus', 'm.');
  assert.equal(normName('M.'), 'm', 'a word alone stays');
  assert.equal(normName('Os os sphenoidale'), 'sphenoidale');
  assert.equal(normName('Musculus'), 'musculus');
});

test('a key that lists several things takes them in any order, with any of the separators', () => {
  const k = 'Malleus dan incus';
  right(k, 'malleus dan incus', 'Incus, malleus', 'incus & malleus', 'malleus + incus', 'malleus; incus', 'malleus\nincus', 'malleus serta incus', 'incus and malleus', 'os incus, os malleus');
  wrong(k, 'malleus', 'incus', 'malleus, incus, stapes', 'malleus, malleus', 'malleusdanincus');
  right('Sudan', 'sudan', 'SUDAN');
  wrong('Sudan', 'su dan');
  assert.equal(answerForm('B, a dan C'), 'a\nb\nc');
  assert.equal(answerForm(' , ; '), '');
});

test('a key written "X atau Y" takes X, Y, or the two with atau between them either way round', () => {
  const k = 'Temporalis atau masseter';
  right(k, 'temporalis', 'Masseter', 'm. masseter', 'temporalis atau masseter', 'masseter atau temporalis', 'M. masseter atau m. temporalis');
  wrong(k, 'pterygoideus lateralis', 'temporal', 'temporalis dan masseter', 'temporalis atau buccinator', 'temporalis atau masseter atau buccinator');
  assert.deepEqual(keyForms(k), ['temporalis atau masseter', 'temporalis', 'masseter', 'atau:masseter|temporalis']);
  assert.deepEqual(keyForms('Incus'), ['incus'], 'one form when there is no "atau"');
  wrong('Masseter', 'masseter atau temporalis', 'temporalis atau masseter');
});

test('any of several keys will do; nothing typed or no keys is never right', () => {
  assert.equal(answerOk(['Mitokondria', 'Mitochondria'], 'mitochondria'), true);
  assert.equal(answerOk(['Mitokondria', 'Mitochondria'], 'mitokondria'), true);
  assert.equal(answerOk(['Mitokondria'], 'mitochondria'), false);
  for (const t of ['', '   ', '...', '\n', null, undefined]) assert.equal(answerOk(['Mitokondria'], t), false, JSON.stringify(t));
  assert.equal(answerOk([], 'mitokondria'), false);
  assert.equal(answerOk(undefined, 'mitokondria'), false);
  assert.equal(answerOk('Mitokondria', 'mitokondria'), false, 'the keys are a list');
});
