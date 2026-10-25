// Tests for src/lib/texts.js (the page texts engine) and the declared texts in src/copy/.
// Run: node --test tests/texts.test.mjs
// Keys here start with "t-" so they never meet a real one; the registry is shared by the whole file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  registerCopy, copyEntry, groupLabel, listCopy, varsOf, fill, defaultText, rawText, tx, kAttrs, kText, kHTML, kSet, kAttr,
  textFor, sourceFor, varsFor, apply, defaultAttr, setTexts, getTexts, onTexts, createTexts, shippedText, registerLabels, textLabel,
} from '../src/lib/texts.js';
import { GROUPS, GROUP_LABELS, groupOf } from '../src/copy/index.js';
import { validate } from '../src/lib/validate.js';

registerCopy('t-a', 'Grup A', {
  't-a.plain': 'Tidak ada kelas.',
  't-a.tpl': 'Jadwal setelah {blok} belum masuk, {blok} dulu.',
  't-a.ml': { d: 'Baris satu\nBaris dua', ml: true, h: 'Dua baris' },
  't-a.rich': { d: 'Disusun **Batu Alphangers**', rich: true },
  't-a.note': { d: '', opt: true, ml: true, ph: 'Catatan (kosong = tidak tampil)' },
  't-a.html': 'Tanda <b> & "kutip"',
  't-a.ph': 'Cari {apa}…',
});

// The parts of an element the engine uses, enough to run it without a browser.
function fakeEl({ text = '', attrs = {}, dataset = {}, parent = null } = {}) {
  const a = new Map(Object.entries(attrs));
  const el = {
    dataset: { ...dataset },
    textContent: text,
    childNodes: [],
    parent,
    isContentEditable: false,
    ownerDocument: { activeElement: null },
    setAttribute: (n, v) => a.set(n, String(v)),
    getAttribute: (n) => (a.has(n) ? a.get(n) : null),
    hasAttribute: (n) => a.has(n),
    removeAttribute: (n) => a.delete(n),
    toggleAttribute: (n, force) => {
      const on = force === undefined ? !a.has(n) : !!force;
      if (on) a.set(n, ''); else a.delete(n);
      return on;
    },
    // only the one selector the engine asks for: the line around an optional text
    closest: (sel) => {
      if (sel !== '[data-opt-line]') return null;
      for (let x = el; x; x = x.parent) if (x.hasAttribute('data-opt-line')) return x;
      return null;
    },
    matches: () => false,
    attrs: a,
  };
  return el;
}
const rootOf = (...els) => ({ querySelectorAll: () => els });

test('registerCopy stores defaults and flags; copyEntry and groupLabel read them back', () => {
  assert.deepEqual(copyEntry('t-a.plain'), { d: 'Tidak ada kelas.', group: 't-a' });
  assert.equal(copyEntry('t-a.ml').ml, true);
  assert.equal(copyEntry('t-a.ml').h, 'Dua baris');
  assert.equal(copyEntry('t-a.rich').rich, true);
  assert.equal(copyEntry('t-a.note').opt, true);
  assert.equal(copyEntry('t-a.note').d, '');
  assert.equal(copyEntry('t-nope'), null);
  assert.equal(groupLabel('t-a'), 'Grup A');
  assert.equal(groupLabel('t-nope'), null);
  registerCopy('t-b', null, { 't-b.x': { d: 42 } });
  assert.equal(copyEntry('t-b.x').d, '42', 'defaults are text');
  assert.equal(groupLabel('t-b'), 't-b', 'a group without a label is named by its id');
  registerCopy('t-b', 'Grup B', { 't-b.x': 'Lagi' });
  assert.equal(copyEntry('t-b.x').d, 'Lagi', 'registering a key again replaces it');
  assert.equal(groupLabel('t-b'), 'Grup B');
});

test('listCopy groups the texts with their labels, flags and {names}', () => {
  const groups = listCopy();
  const a = groups.find((g) => g.id === 't-a');
  assert.equal(a.label, 'Grup A');
  assert.deepEqual(a.items.map((i) => i.key), ['t-a.plain', 't-a.tpl', 't-a.ml', 't-a.rich', 't-a.note', 't-a.html', 't-a.ph']);
  assert.deepEqual(a.items[1].vars, ['blok']);
  assert.deepEqual(a.items[2], { key: 't-a.ml', d: 'Baris satu\nBaris dua', ml: true, rich: false, opt: false, ph: '', h: 'Dua baris', label: '', vars: [] });
  assert.equal(a.items[4].opt, true);
  assert.equal(a.items[4].ph, 'Catatan (kosong = tidak tampil)');
  assert.equal(groups.find((g) => g.id === 't-b').label, 'Grup B');
});

test('varsOf and fill', () => {
  assert.deepEqual(varsOf('{a} dan {b_2}, lalu {a} lagi'), ['a', 'b_2']);
  assert.deepEqual(varsOf('{1x} { spasi } {} biasa'), []);
  assert.deepEqual(varsOf(null), []);
  assert.equal(fill('Halo {nama}, {n} soal', { nama: 'Alpha', n: 12 }), 'Halo Alpha, 12 soal');
  assert.equal(fill('Halo {nama}', {}), 'Halo {nama}', 'a name without a value stays');
  assert.equal(fill('Halo {nama}', { nama: null }), 'Halo {nama}');
  assert.equal(fill('{toString} {constructor}', {}), '{toString} {constructor}', 'only own values count');
  assert.equal(fill('Halo {nama}', null), 'Halo {nama}');
  assert.equal(fill(undefined, { a: 1 }), '');
});

test('a changed text left empty shows the default, unless the text may be empty', () => {
  setTexts({ 't-a.plain': '', 't-a.note': '' });
  try {
    assert.equal(tx('t-a.plain'), 'Tidak ada kelas.', 'an empty button or heading never shows');
    assert.equal(tx('t-a.note'), '');
    const credit = fakeEl({ text: 'Batu Alphangers', attrs: { 'data-opt': '' }, dataset: { k: 't-x.by' } });
    const label = fakeEl({ text: 'Disusun', dataset: { k: 't-x.byk' } });
    setTexts({ 't-x.by': '', 't-x.byk': '' });
    apply(rootOf(credit));
    apply(rootOf(label));
    assert.equal(credit.textContent, '', 'an optional text from the page can be emptied');
    assert.equal(label.textContent, 'Disusun', 'any other keeps its own text');
  } finally {
    setTexts({});
  }
});

test('tx shows the default, then the changed text, with {names} filled', () => {
  assert.equal(tx('t-a.tpl', { blok: 'Blok 4' }), 'Jadwal setelah Blok 4 belum masuk, Blok 4 dulu.');
  setTexts({ 't-a.tpl': 'Blok sesudah {blok} belum ada.', 't-a.plain': '' });
  assert.equal(tx('t-a.tpl', { blok: 'Blok 4' }), 'Blok sesudah Blok 4 belum ada.');
  assert.equal(tx('t-a.plain'), 'Tidak ada kelas.', 'left empty, a text that must show keeps its default');
  assert.equal(rawText('t-a.tpl'), 'Blok sesudah {blok} belum ada.');
  assert.equal(defaultText('t-a.tpl'), 'Jadwal setelah {blok} belum masuk, {blok} dulu.');
  setTexts(null);
  assert.deepEqual(getTexts(), {});
  assert.equal(tx('t-a.plain'), 'Tidak ada kelas.');
});

test('tx warns about an unregistered key and shows nothing', () => {
  const warn = console.warn;
  const seen = [];
  console.warn = (...a) => seen.push(a.join(' '));
  try {
    assert.equal(tx('t-unknown.key'), '');
    setTexts({ 't-unknown.key': 'Ada' });
    assert.equal(tx('t-unknown.key'), 'Ada', 'a changed text for an unregistered key still shows');
  } finally {
    console.warn = warn;
    setTexts({});
  }
  assert.equal(seen.length, 1);
  assert.match(seen[0], /unregistered key t-unknown\.key/);
});

test('kAttrs, kText and kHTML build escaped markup with the flags', () => {
  assert.equal(kAttrs('t-a.plain'), ' data-k="t-a.plain"');
  assert.equal(kAttrs('t-a.tpl', { blok: 'B "4" <x>' }), ' data-k="t-a.tpl" data-kv="{&quot;blok&quot;:&quot;B \\&quot;4\\&quot; &lt;x&gt;&quot;}"');
  assert.equal(kAttrs('t-a.tpl', {}), ' data-k="t-a.tpl"', 'no vars, no data-kv');
  assert.equal(kAttrs('t-a.ml'), ' data-k="t-a.ml" data-ml');
  assert.equal(kAttrs('t-a.rich'), ' data-k="t-a.rich" data-rich');
  assert.equal(kAttrs('t-a.note'), ' data-k="t-a.note" data-ml data-opt data-empty data-ph="Catatan (kosong = tidak tampil)"');
  assert.equal(kText('t-a.html'), 'Tanda &lt;b&gt; &amp; &quot;kutip&quot;');
  assert.equal(kText('t-a.rich'), 'Disusun <b>Batu Alphangers</b>');
  assert.equal(kText('t-a.tpl', { blok: '<i>4</i>' }), 'Jadwal setelah &lt;i&gt;4&lt;/i&gt; belum masuk, &lt;i&gt;4&lt;/i&gt; dulu.');
  assert.equal(kHTML('t-a.plain', null, 'p', 'jw-empty'), '<p class="jw-empty" data-k="t-a.plain">Tidak ada kelas.</p>');
  assert.equal(kHTML('t-a.note', null, 'p', 'k-note'), '<p class="k-note" data-k="t-a.note" data-ml data-opt data-empty data-ph="Catatan (kosong = tidak tampil)"></p>', 'an empty note renders empty and hidden');
  setTexts({ 't-a.rich': 'Dibuat oleh **Tim <Batu>** dan *teman*', 't-a.note': 'Bawa jas lab.' });
  try {
    assert.equal(kText('t-a.rich'), 'Dibuat oleh <b>Tim &lt;Batu&gt;</b> dan *teman*', 'only **double** marks make bold');
    assert.equal(kHTML('t-a.note', null, 'p', 'k-note'), '<p class="k-note" data-k="t-a.note" data-ml data-opt data-ph="Catatan (kosong = tidak tampil)">Bawa jas lab.</p>', 'a written note shows');
  } finally {
    setTexts({});
  }
});

test('kAttr writes a placeholder or title from a key, with its marker', () => {
  assert.equal(kAttr('kp', 't-a.ph', { apa: 'dosen' }), ' data-kp="t-a.ph" data-kpv="{&quot;apa&quot;:&quot;dosen&quot;}" placeholder="Cari dosen…"');
  assert.equal(kAttr('kt', 't-a.plain'), ' data-kt="t-a.plain" title="Tidak ada kelas."');
  assert.throws(() => kAttr('kx', 't-a.plain'), /unknown attribute kind/);
});

test('kSet marks an element and writes its text; textFor, sourceFor and varsFor read it back', () => {
  const el = fakeEl();
  kSet(el, 't-a.tpl', { blok: 'Blok 4' });
  assert.equal(el.dataset.k, 't-a.tpl');
  assert.equal(el.dataset.kv, '{"blok":"Blok 4"}');
  assert.equal(el.textContent, 'Jadwal setelah Blok 4 belum masuk, Blok 4 dulu.');
  assert.equal(textFor(el), 'Jadwal setelah Blok 4 belum masuk, Blok 4 dulu.');
  assert.equal(sourceFor(el), 'Jadwal setelah {blok} belum masuk, {blok} dulu.', 'the editor types the raw text');
  assert.deepEqual(varsFor(el), { blok: 'Blok 4' });
  kSet(el, 't-a.plain');
  assert.equal(el.dataset.kv, undefined, 'old vars are dropped');
  assert.deepEqual(varsFor(el), {});
  assert.equal(el.textContent, 'Tidak ada kelas.');
  const line = fakeEl({ attrs: { 'data-opt-line': '' } });
  const note = kSet(fakeEl({ parent: line }), 't-a.note');
  assert.ok(note.hasAttribute('data-opt') && note.hasAttribute('data-ml'));
  assert.equal(note.getAttribute('data-ph'), 'Catatan (kosong = tidak tampil)');
  assert.equal(note.textContent, '');
  assert.ok(line.hasAttribute('data-empty'), 'an empty optional text hides the line around it');
  assert.ok(!note.hasAttribute('data-empty'));
  // a section redrawing a text the admin is typing into (a count, a clock) leaves it alone
  const typing = kSet(fakeEl(), 't-a.tpl', { blok: 'Blok 1' });
  typing.isContentEditable = true;
  typing.ownerDocument = { activeElement: typing };
  typing.textContent = 'setengah diketik';
  kSet(typing, 't-a.tpl', { blok: 'Blok 2' });
  assert.equal(typing.textContent, 'setengah diketik');
  assert.deepEqual(varsFor(typing), { blok: 'Blok 2' }, 'its vars follow, for the repaint after typing');
  kSet(typing, 't-a.plain');
  assert.equal(typing.textContent, 'setengah diketik');
  assert.equal(typing.dataset.k, 't-a.tpl', 'the key it is being typed under stays');
  assert.deepEqual(varsFor(typing), { blok: 'Blok 2' });
});

test('a text from index.html keeps its own text as the default, without the layout line breaks', () => {
  const el = fakeEl({ text: '\n      Kuliah, praktikum dan\n      ujian, satu tempat.\n    ', dataset: { k: 'hero.lede' } });
  assert.equal(defaultText('hero.lede', el), 'Kuliah, praktikum dan ujian, satu tempat.');
  assert.equal(shippedText(el), 'Kuliah, praktikum dan ujian, satu tempat.', 'the admin reads index.html the same way');
  apply(rootOf(el));
  assert.equal(el.textContent, 'Kuliah, praktikum dan ujian, satu tempat.', 'shown once without them');
  const spaced = fakeEl({ text: 'Kelas ', dataset: { k: 'kelas.kick' } });
  apply(rootOf(spaced));
  assert.equal(spaced.textContent, 'Kelas ', 'spaces that are not line breaks stay');
  setTexts({ 'hero.lede': 'Teks baru' });
  try {
    apply(rootOf(el));
    assert.equal(el.textContent, 'Teks baru');
    assert.equal(rawText('hero.lede', el), 'Teks baru');
    assert.equal(defaultText('hero.lede', el), 'Kuliah, praktikum dan ujian, satu tempat.');
  } finally {
    setTexts({});
  }
  apply(rootOf(el));
  assert.equal(el.textContent, 'Kuliah, praktikum dan ujian, satu tempat.', 'removing the change brings the text back');
});

test('apply fills vars, leaves a text being typed alone and hides empty optional ones', () => {
  const tpl = fakeEl({ dataset: { k: 't-a.tpl', kv: '{"blok":"Blok 2"}' } });
  const typing = fakeEl({ text: 'setengah diketik', dataset: { k: 't-a.plain' } });
  typing.isContentEditable = true;
  typing.ownerDocument = { activeElement: typing };
  const line = fakeEl({ attrs: { 'data-opt-line': '' } });
  const credit = fakeEl({ text: 'Batu Alphangers', attrs: { 'data-opt': '' }, dataset: { k: 'to.b9.by' }, parent: line });
  setTexts({ 't-a.tpl': '{blok} selesai.', 'to.b9.by': '' });
  try {
    apply(rootOf(tpl, typing, credit));
    assert.equal(tpl.textContent, 'Blok 2 selesai.');
    assert.equal(typing.textContent, 'setengah diketik');
    assert.equal(credit.textContent, '');
    assert.ok(line.hasAttribute('data-empty'));
  } finally {
    setTexts({});
  }
  apply(rootOf(credit));
  assert.equal(credit.textContent, 'Batu Alphangers', 'its own text comes back');
  assert.ok(!line.hasAttribute('data-empty'));
});

test('apply changes placeholders and titles under data-kp / data-kt, and brings them back', () => {
  const input = fakeEl({ attrs: { placeholder: 'Cari nama dosen' }, dataset: { kp: 'dosen.ph' } });
  const tip = fakeEl({ attrs: { title: 'Cari {apa}…' }, dataset: { kt: 't-a.ph', ktv: '{"apa":"sesi"}' } });
  apply(rootOf(input, tip));
  assert.equal(input.getAttribute('placeholder'), 'Cari nama dosen');
  assert.equal(tip.getAttribute('title'), 'Cari sesi…', 'a registered key fills its vars');
  assert.equal(defaultAttr(input, 'placeholder'), 'Cari nama dosen');
  assert.equal(defaultAttr(tip, 'title'), 'Cari {apa}…');
  setTexts({ 'dosen.ph': 'Nama atau nomor' });
  try {
    apply(rootOf(input));
    assert.equal(input.getAttribute('placeholder'), 'Nama atau nomor');
  } finally {
    setTexts({});
  }
  apply(rootOf(input));
  assert.equal(input.getAttribute('placeholder'), 'Cari nama dosen');
});

test('onTexts listeners run on every change; one that throws does not stop the others', () => {
  const error = console.error;
  console.error = () => {};
  const got = [];
  const offBad = onTexts(() => { throw new Error('boom'); });
  const off = onTexts((t) => got.push(t));
  try {
    setTexts({ 't-a.plain': 'Satu' });
    off();
    setTexts({ 't-a.plain': 'Dua' });
  } finally {
    offBad();
    console.error = error;
    setTexts({});
  }
  assert.deepEqual(got, [{ 't-a.plain': 'Satu' }]);
});

test('createTexts hands the texts to the portal shell and keeps the editor API', () => {
  const seen = [];
  const texts = createTexts({ setTexts: (t) => seen.push(t) });
  texts.set({ 'hero.ends': 'a|b' });
  assert.deepEqual(seen, [{ 'hero.ends': 'a|b' }]);
  assert.deepEqual(texts.get(), { 'hero.ends': 'a|b' });
  for (const fn of ['apply', 'original', 'defaultText', 'defaultAttr', 'rawText', 'textFor', 'sourceFor', 'varsFor', 'listCopy', 'copyEntry', 'groupLabel', 'varsOf', 'fill']) {
    assert.equal(typeof texts[fn], 'function', fn);
  }
  assert.equal(texts.original({ dataset: { k: 't-a.plain' } }), 'Tidak ada kelas.');
  assert.equal(texts.original(fakeEl({ text: 'Dari markup', dataset: { k: 'foot.meta' } })), 'Dari markup');
  texts.set(null);
  assert.deepEqual(seen.at(-1), {});
});

// --- the real keys ---

const linksWith = (t) => {
  const d = JSON.parse(readFileSync(new URL('../src/data/links.json', import.meta.url), 'utf8'));
  d.site = { ...(d.site || {}), t };
  return d;
};

function realKeys() {
  return listCopy().filter((g) => !g.id.startsWith('t-')).flatMap((g) => g.items.map((i) => ({ ...i, group: g.id })));
}

test('the groups have unique ids and labels', () => {
  const ids = GROUPS.map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(GROUPS.map(([, l]) => l)).size, ids.length);
  assert.equal(groupOf('jadwal.empty'), 'jadwal');
  assert.equal(groupOf('to.b1.name'), 'to');
  assert.equal(groupOf('zzz.x'), 'lain');
  assert.equal(groupOf('constructor.x'), 'lain');
});

test('every declared key can be saved: the validator takes it, and it sits in its own group', () => {
  const items = realKeys();
  for (const it of items) {
    assert.ok(GROUP_LABELS[it.group], 'unknown group ' + it.group);
    assert.equal(groupOf(it.key), it.group, it.key + ' is not under ' + it.group + '.');
    assert.equal(listCopy().find((g) => g.id === it.group).label, GROUP_LABELS[it.group], it.group + ' is registered with its label');
  }
  // the links document takes at most 600 changed texts at once
  for (let i = 0; i < items.length; i += 500) {
    const t = Object.fromEntries(items.slice(i, i + 500).map((it) => [it.key, it.d || 'x']));
    const r = validate('links', linksWith(t));
    assert.equal(r.ok, true, JSON.stringify(r.errors.slice(0, 3)));
  }
});

test('every {name} in a default is a plain name, and defaults are plain text', () => {
  for (const it of realKeys()) {
    assert.ok(!/[<>]/.test(it.d), it.key + ' has markup in its default');
    assert.ok(!/\{(?![a-zA-Z][a-zA-Z0-9_]*\})/.test(it.d), it.key + ' has a { that is not a {name}');
    assert.ok(it.d.length <= 4000, it.key);
  }
});

test('index.html keys are in known groups, valid, and not declared again', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-k[pt]?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 19);
  const declared = new Set(realKeys().map((i) => i.key));
  for (const k of keys) {
    assert.notEqual(groupOf(k), 'lain', 'unknown group: ' + k);
    assert.ok(!declared.has(k), k + ' is in index.html and declared in src/copy');
  }
  const r = validate('links', linksWith(Object.fromEntries(keys.map((k) => [k, 'x']))));
  assert.equal(r.ok, true, JSON.stringify(r.errors.slice(0, 3)));
});

test('registerLabels names texts, a blok\'s own texts once for every blok', () => {
  registerCopy('t-l', 'Grup L', { 't-l.a': 'Satu', 't-l.b': { d: 'Dua', label: 'Nama di entri' } });
  registerLabels({ 't-l.a': 'Teks satu', 't-l.*.name': 'Nama tiap blok' });
  assert.equal(textLabel('t-l.a'), 'Teks satu');
  assert.equal(textLabel('t-l.b'), 'Nama di entri');
  assert.equal(textLabel('t-l.b9.name'), 'Nama tiap blok');
  assert.equal(textLabel('t-l.zz'), '');
  // which blok, in a list that holds them all
  assert.equal(textLabel('t-l.b9.name', (part) => (part === 'b9' ? 'Blok 9' : '')), 'Nama tiap blok · Blok 9');
  assert.equal(textLabel('t-l.b9.name', () => ''), 'Nama tiap blok · b9');
  assert.equal(textLabel('t-l.a', () => 'x'), 'Teks satu');
  assert.equal(listCopy().find((g) => g.id === 't-l').items.find((i) => i.key === 't-l.a').label, 'Teks satu');
});

test('every text has a plain name in the editor lists, unique in its group', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...new Set([...realKeys().map((i) => i.key), ...[...html.matchAll(/data-k[pt]?="([^"]+)"/g)].map((m) => m[1])])];
  // a blok's own texts (src/edit/adapters.js CARD_FIELDS) come with the bank, named once for all,
  // and so does a channel page's note; the heartbeat captions are drawn by the shell
  for (const f of ['name', 'title', 'sem', 'soon', 'badge', 'byk', 'by', 'note']) keys.push('to.zz9.' + f);
  keys.push('ch.zz9.note');
  for (let i = 0; i < 6; i++) keys.push(...['k', 'd', 't'].map((f) => 'siklus.cap' + i + '.' + f));
  keys.push('siklus.cap5.em');
  const missing = keys.filter((k) => !textLabel(k));
  assert.deepEqual(missing, [], missing.length + ' texts have no name');
  const seen = new Map();
  for (const k of keys) {
    const name = textLabel(k);
    assert.ok(name.length <= 60, k + ': name longer than 60 characters');
    assert.ok(!/[.\s]$/.test(name) && name === name.trim(), k + ': name ends with a period or a space');
    assert.ok(!/[<>{}*\u2014]/.test(name), k + ': name has markup, a {name}, ** or a long dash');
    const at = groupOf(k) + '|' + name.toLowerCase();
    assert.ok(!seen.has(at), k + ' and ' + seen.get(at) + ' have the same name');
    seen.set(at, k);
  }
});
