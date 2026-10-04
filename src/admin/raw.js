// JSON mode: the whole draft as text, checked while typing. Valid JSON is
// taken into the draft right away; invalid JSON never touches it.
import { h, debounce, replace } from './dom.js';
import { validateJsonText, byteLength, MAX_JSON_BYTES } from '../lib/validate.js';
import { pathLabel, fmtBytes } from './format.js';

export function renderRaw(host, ctx) {
  const doc = ctx.doc;
  const area = h('textarea', { id: 'raw-json', class: 'raw', spellcheck: false, autocomplete: 'off', wrap: 'off', 'aria-describedby': 'raw-status' });
  area.value = JSON.stringify(doc.draft, null, 2);
  const status = h('div', { id: 'raw-status', class: 'raw-status', 'aria-live': 'polite' });
  ctx.ui.rawPending = false;

  const check = () => {
    const text = area.value;
    const res = validateJsonText(doc.key, text);
    const size = `${fmtBytes(byteLength(text))} dari ${fmtBytes(MAX_JSON_BYTES)}`;
    if (res.ok) {
      ctx.ui.rawPending = false;
      doc.replaceDraft(res.data);
      const w = res.warnings.length;
      replace(status, h('p', { class: 'ok-text' }, `JSON valid dan sudah masuk draf.${w ? ` ${w} peringatan.` : ''} ${size}.`), list(res.warnings, res.data, 'warn'));
    } else {
      ctx.ui.rawPending = true;
      replace(
        status,
        h('p', { class: 'err-text' }, `Belum dipakai: ${res.errors.length} error. ${size}.`),
        list(res.errors, safeParse(text), 'err'),
      );
    }
  };
  const later = debounce(check, 300);
  area.addEventListener('input', later);
  area.addEventListener('keydown', (e) => {
    // Tab indents instead of leaving the field; Escape then Tab still moves focus on.
    if (e.key === 'Tab' && !e.shiftKey && !area.dataset.escaped) {
      e.preventDefault();
      area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
      later();
    }
    if (e.key === 'Escape') area.dataset.escaped = '1';
    else if (e.key !== 'Tab') delete area.dataset.escaped;
  });

  host.append(
    h(
      'div',
      { class: 'bar' },
      h('p', { class: 'lede' }, 'Edit langsung sebagai JSON. Tab menambah spasi; tekan Esc dulu kalau mau pindah fokus pakai Tab.'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn ghost sm',
          onclick: () => {
            const res = validateJsonText(doc.key, area.value);
            if (!res.ok) return later.flush();
            area.value = JSON.stringify(res.data, null, 2);
            later.flush();
          },
        },
        'Rapikan',
      ),
    ),
    h('label', { htmlFor: 'raw-json', class: 'sr-only' }, 'JSON konten'),
    area,
    status,
  );
  check();
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function list(issues, data, kind) {
  if (!issues.length) return null;
  return h(
    'ul',
    { class: `issues ${kind}` },
    issues.slice(0, 12).map((i) => h('li', null, h('span', { class: 'issue-path' }, data ? pathLabel(data, i.path) : 'Dokumen'), ' ', i.msg)),
    issues.length > 12 ? h('li', null, `dan ${issues.length - 12} lainnya`) : null,
  );
}
