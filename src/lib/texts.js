// Page texts that the admin can change. Every element with a data-k attribute shows the text
// stored under that key in the links document (site.t), or, without one, the text it was built
// with. The original text is remembered per element, so removing a key brings it back.
// Plain text only: values go into textContent, never into HTML.

const original = new WeakMap();

export function createTexts(portal) {
  let t = {};
  function apply(root = document) {
    for (const el of root.querySelectorAll('[data-k]')) {
      // an element being typed into is left alone
      if (el.isContentEditable && el === document.activeElement) continue;
      if (!original.has(el)) original.set(el, el.textContent);
      const want = Object.prototype.hasOwnProperty.call(t, el.dataset.k) ? t[el.dataset.k] : original.get(el);
      if (el.textContent !== want) el.textContent = want;
    }
  }
  return {
    set(next) {
      t = next && typeof next === 'object' ? next : {};
      apply(document);
      portal?.setTexts?.(t);
    },
    apply,
    get: () => t,
    original: (el) => (original.has(el) ? original.get(el) : el.textContent),
  };
}
