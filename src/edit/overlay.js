// Edit mode on the page itself.
//
// Things that can be edited are found by selector (each adapter in adapters.js names its own).
// With a mouse, hovering one outlines it and clicking selects it; on a touch screen a tap selects.
// The selected thing gets an action bar: next to it on wide screens, above the dock on phones.
// While edit mode is on, a click on something editable selects it instead of doing what it
// normally does (opening a lecturer, a channel, a photo), so nothing navigates away mid-edit.
// Texts marked with data-k (and divisi fields marked with data-f) are typed into directly and
// saved when the field loses focus.
import { h } from './sheet.js';

const FINE = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const PLAIN = (() => {
  const d = document.createElement('div');
  d.contentEditable = 'plaintext-only';
  return d.contentEditable === 'plaintext-only';
})();

export function createOverlay({ adapters, ctx }) {
  const layer = h('div', { class: 'ed-layer', 'aria-hidden': 'true' }, h('div', { class: 'ed-hl' }), h('div', { class: 'ed-sel' }));
  const hl = layer.children[0], sel = layer.children[1];
  const bar = h('div', { class: 'ed-bar', role: 'toolbar', 'aria-label': 'Aksi', hidden: true });
  document.body.append(layer, bar);
  let on = false, hovered = null, selected = null, frame = 0;
  const sectionTools = new Map();

  function find(target) {
    if (!target?.closest || target.closest('.ed-ui')) return null;
    for (const a of adapters) {
      if (!a.selector) continue;
      const el = target.closest(a.selector);
      if (el && (!a.accept || a.accept(el))) return { a, el };
    }
    return null;
  }

  function place(box, el) {
    if (!el?.isConnected) { box.style.opacity = '0'; return; }
    const r = el.getBoundingClientRect();
    box.style.opacity = '1';
    box.style.transform = `translate(${Math.round(r.left - 4)}px,${Math.round(r.top - 4)}px)`;
    box.style.width = Math.round(r.width + 8) + 'px';
    box.style.height = Math.round(r.height + 8) + 'px';
  }

  function placeBar() {
    if (bar.hidden || !selected) return;
    if (!FINE()) { bar.style.transform = ''; return; }
    const r = selected.el.getBoundingClientRect();
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let x = Math.min(Math.max(8, r.right - bw), innerWidth - bw - 8);
    let y = r.top - bh - 10;
    if (y < 70) y = Math.min(r.bottom + 10, innerHeight - bh - 90);
    bar.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }

  function tick() {
    frame = 0;
    // editing off: nothing stays outlined (the boxes are fixed to the screen, so a leftover one
    // would hang in place while the page scrolls under it)
    if (!on) { hl.style.opacity = sel.style.opacity = '0'; bar.hidden = true; return; }
    place(hl, hovered?.el !== selected?.el ? hovered?.el : null);
    place(sel, selected?.el);
    placeBar();
  }
  const queue = () => { if (!frame) frame = requestAnimationFrame(tick); };

  async function select(hit) {
    selected = hit;
    bar.textContent = '';
    if (!hit) { bar.hidden = true; queue(); return; }
    const acts = (await hit.a.actions(hit.el, ctx)) || [];
    if (selected !== hit) return;
    bar.append(h('span', { class: 'ed-bar-k', text: hit.a.label(hit.el, ctx) }));
    for (const act of acts) {
      if (!act) continue;
      bar.append(h('button', { type: 'button', class: 'ed-bar-b' + (act.danger ? ' is-danger' : '') + (act.primary ? ' is-pri' : ''), onclick: async () => {
        const keep = await act.run();
        if (keep !== true) select(null);
      } }, act.label));
    }
    bar.append(h('button', { type: 'button', class: 'ed-bar-b is-x', 'aria-label': 'Tutup', onclick: () => select(null) }, '×'));
    bar.hidden = false;
    queue();
  }

  // ---------- inline text
  function editable(el) {
    if (el.isContentEditable) return;
    el.contentEditable = PLAIN ? 'plaintext-only' : 'true';
    el.spellcheck = true;
    el.classList.add('ed-text');
  }
  function lock(el) {
    el.removeAttribute('contenteditable');
    el.classList.remove('ed-text');
  }
  function textTargets() {
    return document.querySelectorAll('[data-k], .dv-ch [data-f]');
  }
  function refreshTexts() {
    for (const el of textTargets()) {
      if (on && !el.closest('[inert], .ed-ui')) editable(el); else lock(el);
    }
  }
  let typing = null;
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('.ed-text');
    if (!el || !on) return;
    typing = { el, before: el.textContent };
  });
  document.addEventListener('focusout', (e) => {
    const t = typing;
    if (!t || e.target !== t.el) return;
    typing = null;
    const value = t.el.textContent.replace(/ /g, ' ');
    if (value === t.before) return;
    const res = t.el.dataset.k ? ctx.setText(t.el.dataset.k, value, t.el) : ctx.setField(t.el, value);
    if (res && !res.ok) { t.el.textContent = t.before; ctx.toast(res.errors?.[0] || 'Teks tidak bisa disimpan.'); }
  });
  document.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('.ed-text');
    if (!el || !on) return;
    const multi = el.dataset.f === 'desc' || el.dataset.ml != null;
    if (e.key === 'Escape') { if (typing) el.textContent = typing.before; el.blur(); e.stopPropagation(); }
    else if (e.key === 'Enter' && !multi) { e.preventDefault(); el.blur(); }
  }, true);
  if (!PLAIN) {
    document.addEventListener('paste', (e) => {
      const el = e.target.closest?.('.ed-text');
      if (!el) return;
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    }, true);
  }

  // ---------- pointer
  document.addEventListener('pointermove', (e) => {
    if (!on || e.pointerType !== 'mouse') return;
    const hit = find(e.target);
    if (hit?.el !== hovered?.el) { hovered = hit; queue(); }
  }, { passive: true });
  document.addEventListener('click', (e) => {
    if (!on) return;
    if (e.target.closest('.ed-ui, .ed-bar, dialog')) return;
    // typing into a text never triggers what the text sits on (a link, a button)
    if (e.target.closest('.ed-text')) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.closest('[data-edit-pass]')) return;
    const hit = find(e.target);
    if (!hit) { if (selected && !e.target.closest('.ed-bar')) select(null); return; }
    if (hit.a.pass?.(e.target, hit.el)) return;
    e.preventDefault();
    e.stopPropagation();
    select(hit);
  }, true);
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);

  // ---------- section tools
  function renderSectionTools() {
    for (const [, el] of sectionTools) el.remove();
    sectionTools.clear();
    if (!on) return;
    for (const a of adapters) {
      if (!a.section || !a.tools) continue;
      const host = document.querySelector(a.section);
      if (!host) continue;
      const tools = a.tools(ctx).filter(Boolean);
      if (!tools.length) continue;
      const strip = h('div', { class: 'ed-ui ed-tools', role: 'toolbar', 'aria-label': 'Ubah ' + (a.sectionLabel || '') },
        h('span', { class: 'ed-tools-k', text: a.sectionLabel || '' }),
        tools.map((t) => h('button', { type: 'button', class: 'ed-tools-b' + (t.primary ? ' is-pri' : ''), onclick: () => t.run() }, t.label)));
      host.prepend(strip);
      sectionTools.set(a.kind, strip);
    }
  }

  // sections re-render as drafts change: keep texts editable and tools present
  let moFrame = 0;
  const mo = new MutationObserver(() => {
    if (!on || moFrame) return;
    moFrame = requestAnimationFrame(() => {
      moFrame = 0;
      refreshTexts();
      if (selected && !selected.el.isConnected) select(null);
      if ([...sectionTools.values()].some((el) => !el.isConnected)) renderSectionTools();
      queue();
    });
  });

  return {
    setOn(v) {
      on = v;
      document.documentElement.classList.toggle('editing', v);
      refreshTexts();
      renderSectionTools();
      if (v) mo.observe(document.getElementById('home'), { childList: true, subtree: true });
      else { mo.disconnect(); hovered = null; selected = null; bar.hidden = true; hl.style.opacity = sel.style.opacity = '0'; }
      queue();
    },
    refresh() { refreshTexts(); renderSectionTools(); queue(); },
    deselect: () => select(null),
    get on() { return on; },
  };
}
