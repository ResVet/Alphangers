// Dialogs and toasts. Dialogs use the native <dialog> element, which gives
// focus trapping, Escape to close and an inert background for free.
import { h, $ } from './dom.js';

let toastHost = null;

export function toast(message, kind = 'ok', ms = 4200) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast toast-${kind}` }, message);
  toastHost.append(el);
  // Keep at most three on screen so they never cover the form.
  while (toastHost.children.length > 3) toastHost.firstElementChild.remove();
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

// Opens a modal dialog and resolves with the value of the button pressed,
// or null when it is dismissed with Escape or the close button.
// actions: [{ label, value, kind: 'primary' | 'danger' | 'ghost', autofocus }]
export function openDialog({ title, body = [], actions = [], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
    const close = h('button', { type: 'button', class: 'btn ghost icon dlg-x', 'aria-label': 'Tutup' }, '×');
    const foot = h('div', { class: 'dlg-foot' });
    const dlg = h(
      'dialog',
      { class: `dlg${wide ? ' wide' : ''}`, 'aria-labelledby': titleId },
      h('div', { class: 'dlg-head' }, h('h2', { id: titleId }, title), close),
      h('div', { class: 'dlg-body' }, body),
      foot,
    );
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    for (const a of actions) {
      foot.append(
        h('button', { type: 'button', class: `btn ${a.kind || 'ghost'}`, onclick: () => finish(a.value), autofocus: a.autofocus || false }, a.label),
      );
    }
    close.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(null);
    });
    document.body.append(dlg);
    dlg.showModal();
    if (onOpen) onOpen(dlg, finish);
    const auto = $('[autofocus]', dlg);
    if (auto) auto.focus();
  });
}

export function confirmDialog({ title, text, confirm = 'Lanjut', cancel = 'Batal', danger = false }) {
  return openDialog({
    title,
    body: Array.isArray(text) ? text.map((t) => (t instanceof Node ? t : h('p', null, t))) : [h('p', null, text)],
    actions: [
      { label: cancel, value: false, kind: 'ghost', autofocus: danger },
      { label: confirm, value: true, kind: danger ? 'danger' : 'primary', autofocus: !danger },
    ],
  }).then((v) => v === true);
}

export function alertDialog(title, text) {
  return openDialog({ title, body: (Array.isArray(text) ? text : [text]).map((t) => (t instanceof Node ? t : h('p', null, t))), actions: [{ label: 'Oke', value: true, kind: 'primary', autofocus: true }] });
}

// Copies text, falling back to selecting it when the clipboard API is not allowed.
export async function copyText(text, fallbackInput) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackInput) {
      fallbackInput.focus();
      fallbackInput.select();
    }
    return false;
  }
}

export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Asks for a .json file and returns its text, or null if nothing was picked.
export function pickJsonFile() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return resolve(null);
      if (file.size > 2_000_000) return resolve({ error: 'File lebih dari 2 MB, kemungkinan bukan file konten ini.' });
      resolve({ name: file.name, text: await file.text() });
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.append(input);
    input.click();
  });
}
