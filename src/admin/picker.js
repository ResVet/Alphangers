// Lecturer search box (ARIA combobox with a listbox popup). Type part of a
// name, arrow keys to move, Enter to pick, Escape to close.
import { h, nextId, clear } from './dom.js';
import { fold } from './format.js';

const TITLES = new Set(['dr', 'drg', 'prof', 'h', 'hj', 'ir', 'dra', 'drs']);

// Words of a name without academic titles, for search and for codes.
export function nameWords(name) {
  const main = String(name || '').split(',')[0];
  return fold(main)
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !TITLES.has(w));
}

export function searchPeople(people, q, max = 8) {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored = [];
  for (const p of people) {
    const hay = `${fold(p.name)} ${fold(p.spec)} ${p.id}`;
    if (!terms.every((t) => hay.includes(t))) continue;
    const words = nameWords(p.name);
    const score = terms.reduce((s, t) => s + (words.some((w) => w.startsWith(t)) ? 2 : 1), 0);
    scored.push([score, p]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name, 'id'));
  return scored.slice(0, max).map((x) => x[1]);
}

// opts: { label, people: () => list, onPick(person), describe(person) -> string, placeholder }
export function dosenPicker(opts) {
  const id = nextId('pick');
  const listId = `${id}-list`;
  const input = h('input', {
    id,
    type: 'text',
    role: 'combobox',
    autocomplete: 'off',
    spellcheck: false,
    placeholder: opts.placeholder || 'Ketik nama dosen',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
  });
  const list = h('ul', { id: listId, role: 'listbox', class: 'pick-list', hidden: true, 'aria-label': 'Hasil pencarian dosen' });
  let results = [];
  let active = -1;

  function open(on) {
    list.hidden = !on;
    input.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (!on) input.removeAttribute('aria-activedescendant');
  }

  function paint() {
    clear(list);
    results.forEach((p, i) => {
      const extra = opts.describe ? opts.describe(p) : '';
      list.append(
        h(
          'li',
          {
            id: `${listId}-${i}`,
            role: 'option',
            'aria-selected': i === active ? 'true' : 'false',
            class: i === active ? 'on' : '',
            onmousedown: (e) => e.preventDefault(),
            onclick: () => pick(i),
          },
          h('span', { class: 'pick-name' }, p.name),
          h('span', { class: 'pick-meta' }, [p.spec, extra].filter(Boolean).join(' · ')),
        ),
      );
    });
    if (!results.length && input.value.trim()) list.append(h('li', { class: 'pick-none', role: 'presentation' }, 'Tidak ketemu. Tambahkan dulu di tab Dosen.'));
    if (active >= 0) input.setAttribute('aria-activedescendant', `${listId}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function pick(i) {
    const p = results[i];
    if (!p) return;
    input.value = '';
    results = [];
    active = -1;
    open(false);
    opts.onPick(p);
  }

  input.addEventListener('input', () => {
    results = searchPeople(opts.people(), input.value);
    active = results.length ? 0 : -1;
    paint();
    open(input.value.trim() !== '');
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      open(true);
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      paint();
      document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (!list.hidden && active >= 0) {
        e.preventDefault();
        pick(active);
      }
    } else if (e.key === 'Escape') {
      if (!list.hidden) {
        e.preventDefault();
        e.stopPropagation();
        open(false);
      }
    }
  });
  input.addEventListener('blur', () => setTimeout(() => open(false), 120));

  return h('div', { class: 'fld pick' }, h('label', { htmlFor: id }, opts.label || 'Tambah dosen'), h('div', { class: 'pick-box' }, input, list));
}
