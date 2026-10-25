# Page texts

Every text a visitor reads on the portal can be changed by the admin, on the page itself (Edit
mode, type into it) or in the list of all page texts (dock menu, "Semua teks halaman", and the
admin panel). Changed texts are stored in the links document under `site.t`, keyed like
`jadwal.empty`. With no changed texts the page renders exactly as it ships.

The engine is `src/lib/texts.js`. The texts that scripts build are declared in `src/copy/*.js`;
`src/copy/groups.js` names the groups the editor lists them under.

## How a text gets on the page

- **Texts in `index.html`** carry `data-k="key"` on the element that holds them. The markup is their
  default (line breaks that only come from how the file is laid out are dropped); they are not
  registered anywhere else.
- **Texts built by scripts** are declared first, then written with the helpers:

```js
// src/copy/jadwal.js
registerCopy('jadwal', GROUP_LABELS.jadwal, {
  'jadwal.empty': 'Tidak ada kelas.',
  'jadwal.after': 'Jadwal setelah {blok} belum masuk.',
  'jadwal.note': { d: '', opt: true, ml: true, ph: 'Catatan di bawah judul (kosong = tidak tampil)' },
});

// src/features/jadwal/jadwal.js
import '../../copy/jadwal.js';
import { tx, kAttrs, kText, kHTML, kSet, kAttr } from '../../lib/texts.js';

'<p class="jw-empty"' + kAttrs('jadwal.empty') + '>' + kText('jadwal.empty') + '</p>'
kHTML('jadwal.after', { blok: blok.name }, 'p', 'jw-why')   // the same, in one call
kSet(el, 'jadwal.after', { blok: blok.name })               // an element built with the DOM
'<input' + kAttr('kp', 'jadwal.find.ph') + '>'              // a placeholder (kt: a title)
toast(tx('jadwal.copied'))                                  // a text that is not in the page
```

`apply()` repaints every marked element whenever the texts change, so a section does not need to
re-render for a changed text. It also runs on each section when it mounts and on the channel panel
whenever it is drawn.

Texts that come and go with data (a try out card, a channel's note) may use keys that are not
registered; their default is the text the element was built with, as for `index.html`.

## Entries

`'key': 'default'`, or an object:

| field | meaning |
| --- | --- |
| `d` | the default text |
| `ml` | multi-line: line breaks are kept (`[data-ml]` is `white-space: pre-line`), Enter types a new line |
| `rich` | `**bold**` parts show bold. The only markup a text can carry |
| `opt` | may be left empty: then it, or the element around it marked `data-opt-line`, is hidden from visitors (`[data-opt][data-empty]` in v3.css) and shows as a dashed spot in Edit mode. Any other text saved empty shows its default |
| `ph` | what Edit mode shows in an empty optional text, such as "Catatan (kosong = tidak tampil)" |
| `h` | a hint for the admin, shown next to the field in the list |
| `label` | the name the list shows the field under; usually given with `registerLabels()` instead, see below |

`{name}` parts are filled from the vars passed with the key. The editor shows the raw text (with the
`{name}` parts and `**` marks) while typing, so the admin edits the sentence, not one filled copy.

Attributes: `data-kp="key"` for a placeholder, `data-kt="key"` for a title; `kAttr()` writes both the
marker and the attribute.

## Names in the editor's lists

The list of page texts and the "Ubah teks" sheet show each text under a name that says where it
shows and what it is, such as "Layar nilai: judul" or "Kartu blok: penyusun". Each copy file ends
with a `registerLabels({ key: 'Name' })` call for its keys, the `index.html` keys of its groups
included. A key written as `to.*.title` names that text of every blok (and `ch.*.note` the note of
every channel); in the list those rows add which blok or channel it is ("Kartu blok: judul · Blok 3").
A key without a name shows its last part. `tests/texts.test.mjs` checks that every declared key,
every `index.html` key and the run-time keys it knows have a name, unique in their group, plain
and at most 60 characters.

## Rules for new keys

- Keys are lower case letters and digits, parts joined by `.`, `-` or `_`, at most 8 parts and 64
  characters. The first part is the group from `src/copy/groups.js`: `jadwal.mon.now`, `to.exam.next`.
- One key per meaning. A sentence with data in it is one key with `{vars}`, not fragments.
- Put `data-k` on the element that holds exactly that text and nothing else. If the text shares its
  element with icons or other parts, give the text its own `<span>`, and check the CSS for
  selectors that depend on the structure first.
- Content that already has its own editor stays out: session titles, lecturer names, announcements,
  channel names, divisi texts, heart notes, question banks.
- Day and month names, numbers and units are formatting, not copy, and stay in code.
- New wording follows the site's voice: casual Indonesian ("kamu", "nggak"), short, no filler.
- Give the key a name in the same file's `registerLabels()` call.
