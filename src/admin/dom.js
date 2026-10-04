// Tiny DOM helpers. Everything goes through textContent and properties, never
// innerHTML, so text from Firestore can not turn into markup.

let uid = 0;
export const nextId = (prefix = 'f') => `${prefix}-${++uid}`;

// h('button', { class: 'btn', onclick: fn, 'aria-label': 'x' }, 'Simpan', child)
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'innerHTML' || k === 'outerHTML' || k === 'style') throw new Error(`h(): ${k} is not allowed`);
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && !k.includes('-') && k !== 'list' && k !== 'form') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function debounce(fn, ms) {
  let t = null;
  const run = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  run.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return run;
}

// Focus something after the browser has painted a re-render.
export function focusSoon(getEl) {
  requestAnimationFrame(() => {
    const el = typeof getEl === 'function' ? getEl() : getEl;
    if (el && typeof el.focus === 'function') el.focus();
  });
}
