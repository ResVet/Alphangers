// Form controls bound straight to the draft. Each control lives in a wrapper
// carrying the validator path (data-path), so messages from validate() can be
// shown next to the right field.
import { h, nextId, $$ } from './dom.js';

const pathKey = (path) => path.join('.');

function wrap({ label, path, control, hint, wide, id }) {
  const msgId = `${id}-msg`;
  const hintId = hint ? `${id}-hint` : null;
  control.setAttribute('aria-describedby', [hintId, msgId].filter(Boolean).join(' '));
  return h(
    'div',
    { class: `fld${wide ? ' wide' : ''}`, dataset: { path: pathKey(path) } },
    h('label', { htmlFor: id }, label),
    control,
    hint ? h('p', { class: 'hint', id: hintId }, hint) : null,
    h('p', { class: 'msg', id: msgId }),
  );
}

// opts: { label, obj, prop, path, ctx, type, max, hint, wide, rows, placeholder,
//         read: v => string, write: string => value, onCommit, inputmode, list }
export function input(opts) {
  const { label, obj, prop, path, ctx, type = 'text', max, hint, wide, rows, placeholder, inputmode, list } = opts;
  const read = opts.read || ((v) => (v === undefined || v === null ? '' : String(v)));
  const write = opts.write || ((s) => s);
  const id = nextId();
  const control =
    type === 'textarea'
      ? h('textarea', { id, rows: rows || 3, maxLength: max, placeholder, spellcheck: true })
      : h('input', { id, type, maxLength: type === 'text' || type === 'url' || type === 'search' ? max : undefined, placeholder, inputMode: inputmode, autocomplete: 'off', spellcheck: type === 'text' });
  if (list) control.setAttribute('list', list);
  control.value = read(obj[prop]);
  control.addEventListener('input', () => {
    obj[prop] = write(control.value);
    ctx.changed();
    if (opts.onInput) opts.onInput(control);
  });
  if (opts.onCommit) control.addEventListener('change', () => opts.onCommit(control));
  return wrap({ label, path, control, hint, wide, id });
}

export function select(opts) {
  const { label, obj, prop, path, ctx, options, hint, wide } = opts;
  const id = nextId();
  const control = h(
    'select',
    { id },
    options.map(([value, text]) => h('option', { value }, text)),
  );
  control.value = obj[prop] ?? '';
  control.addEventListener('change', () => {
    obj[prop] = control.value;
    ctx.changed();
    if (opts.onCommit) opts.onCommit(control);
  });
  return wrap({ label, path, control, hint, wide, id });
}

// Optional flags are stored only when true, matching the data files.
export function checkbox({ label, obj, prop, path, ctx, hint, onCommit }) {
  const id = nextId();
  const control = h('input', { id, type: 'checkbox', checked: obj[prop] === true });
  control.addEventListener('change', () => {
    if (control.checked) obj[prop] = true;
    else delete obj[prop];
    ctx.changed();
    if (onCommit) onCommit(control);
  });
  const el = h(
    'div',
    { class: 'fld check', dataset: { path: pathKey(path) } },
    control,
    h('label', { htmlFor: id }, label),
    hint ? h('p', { class: 'hint' }, hint) : null,
    h('p', { class: 'msg' }),
  );
  return el;
}

// Writes optional fields the way the data files do: absent when empty.
export const optional = (s) => (s.trim() === '' ? undefined : s);
export function setOptional(obj, prop, value) {
  if (value === undefined || value === '') delete obj[prop];
  else obj[prop] = value;
}

// Puts validator messages next to their fields. Messages for fields that are
// not on screen are left to the issue summary at the top.
export function paintIssues(host, result) {
  for (const el of $$('.fld.is-err, .fld.is-warn', host)) {
    el.classList.remove('is-err', 'is-warn');
    const m = el.querySelector('.msg');
    if (m) m.textContent = '';
    for (const c of el.querySelectorAll('[aria-invalid]')) c.removeAttribute('aria-invalid');
  }
  if (!result) return;
  const byPath = new Map();
  for (const w of result.warnings) byPath.set(pathKey(w.path), { kind: 'warn', msg: w.msg });
  for (const e of result.errors) byPath.set(pathKey(e.path), { kind: 'err', msg: e.msg });
  for (const el of $$('.fld[data-path]', host)) {
    const issue = byPath.get(el.dataset.path);
    if (!issue) continue;
    el.classList.add(issue.kind === 'err' ? 'is-err' : 'is-warn');
    const m = el.querySelector('.msg');
    if (m) m.textContent = issue.msg;
    if (issue.kind === 'err') {
      const c = el.querySelector('input, textarea, select');
      if (c) c.setAttribute('aria-invalid', 'true');
    }
  }
}

// Issues that sit under a given path prefix (for badges on collapsed rows).
export function issuesUnder(result, prefix) {
  if (!result) return { errors: 0, warnings: 0 };
  const p = pathKey(prefix);
  const under = (i) => {
    const k = pathKey(i.path);
    return k === p || k.startsWith(p + '.');
  };
  return { errors: result.errors.filter(under).length, warnings: result.warnings.filter(under).length };
}

// A small marker on a card or row that says it has problems inside. It is
// repainted after every edit, so it stays right while fields are typed in.
export function issueBadge(result, prefix) {
  const el = h('span', { class: 'badge', dataset: { badge: pathKey(prefix) } });
  setBadge(el, result);
  return el;
}

function setBadge(el, result) {
  const { errors, warnings } = issuesUnder(result, el.dataset.badge.split('.'));
  el.className = `badge${errors ? ' err' : warnings ? ' warn' : ''}`;
  el.textContent = errors ? (errors === 1 ? '1 error' : `${errors} error`) : warnings ? 'Cek' : '';
  el.hidden = !errors && !warnings;
}

export function paintBadges(host, result) {
  for (const el of $$('[data-badge]', host)) setBadge(el, result);
}
