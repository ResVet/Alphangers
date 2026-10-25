// Edit mode on the page itself.
//
// Things that can be edited are found by selector (each adapter in adapters.js names its own).
// With a mouse, hovering one outlines it and clicking selects it; on a touch screen a tap selects.
// The selected thing gets an action bar: next to it on wide screens, above the dock on phones.
// While edit mode is on, a click on something editable selects it instead of doing what it
// normally does (opening a lecturer, a channel, a photo, following a link or pressing a button),
// so nothing navigates away mid-edit; the bar's Buka or Klik does it on purpose.
//
// Texts marked with data-k (and divisi fields marked with data-f) are typed into directly and
// saved when the field loses focus. A text with {name} parts or **bold** shows its raw form while
// it is typed, with a hint naming what each {name} becomes. A text inside a button, a link or
// another control is not typed into (a space would press it, and phones type badly into buttons),
// and neither is a text inside a card an adapter selects (a session, an announcement, a lecturer
// row, a divisi chapter, the heart notes): there it is a label every card like it shares, and it
// sits where people tap to select the card. Either way the control or the card is selected, and
// its texts change from "Ubah teks" (or "Teks lain" next to a card's own form).
//
// The whole page is watched, overlays included (the channel panel, the search, the photo viewer,
// a lecturer's details), so whatever is drawn later is editable too. Inside a modal dialog of the
// page the outlines, the bar and the hint move into that dialog's top layer, or they would sit
// under it and could not be pressed.
import { h, textHints, paintHints } from './sheet.js';

const FINE = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const PLAIN = (() => {
  const d = document.createElement('div');
  d.contentEditable = 'plaintext-only';
  return d.contentEditable === 'plaintext-only';
})();
const POP = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

/** Elements that do something when clicked: a text inside one is changed from a form, not typed. */
export const CONTROL = 'button, a[href], [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=switch], [role=radio], [role=checkbox], label, summary, select';
const KEYED = '[data-k], [data-kp], [data-kt]';
const MARKS = '[data-k], [data-kp], .dv-ch [data-f]';
/** The editor's own interface: never edited, never watched. */
export const EDITOR_UI = '.ed-ui, .ed-layer, .ed-bar, .ed-tip, .ed-dlg';

export function createOverlay({ adapters, ctx, textTools = [] }) {
  const layer = h('div', { class: 'ed-layer', 'aria-hidden': 'true' }, h('div', { class: 'ed-hl' }), h('div', { class: 'ed-sel' }));
  const hl = layer.children[0], sel = layer.children[1];
  const bar = h('div', { class: 'ed-bar', role: 'toolbar', 'aria-label': 'Aksi', hidden: true });
  const hint = h('div', { class: 'ed-tip', id: 'ed-tip', role: 'note', hidden: true });
  document.body.append(layer, bar, hint);
  let on = false, hovered = null, selected = null, frame = 0, host = null;
  const sectionTools = new Map();
  // the cards the adapters select by selector (the control adapter matches by code instead)
  const CARDS = adapters.filter((a) => a.selector).map((a) => a.selector).join(', ');
  const inCard = (el) => !!CARDS && !!el.closest(CARDS);

  function find(target) {
    if (!target?.closest || target.closest(EDITOR_UI)) return null;
    for (const a of adapters) {
      const el = a.match ? a.match(target) : a.selector ? target.closest(a.selector) : null;
      if (el && (!a.accept || a.accept(el))) return { a, el };
    }
    return null;
  }

  // ---------- where the editor's own pieces live: the body, or the page's open modal dialog
  function modalOf(el) {
    const d = el?.closest?.('dialog[open]');
    if (!d || d.matches(EDITOR_UI)) return null;
    try { return d.matches(':modal') ? d : null; } catch { return d; }
  }
  function show(el, visible) {
    if (el.popover) {
      if (visible && !el.matches(':popover-open')) try { el.showPopover(); } catch { /* not connected */ }
      if (!visible && el.matches(':popover-open')) el.hidePopover();
    }
    el.hidden = !visible;
  }
  function mountIn(next) {
    if (next === host && (next ? next.open : true)) return;
    host = next && next.open ? next : null;
    for (const el of [layer, bar, hint]) {
      const visible = !el.hidden;
      if (el.popover && el.matches(':popover-open')) el.hidePopover();
      (host || document.body).append(el);
      if (host && POP) el.popover = 'manual'; else el.removeAttribute('popover');
      show(el, visible);
    }
  }
  // a dialog closing takes the editor's pieces back to the body
  document.addEventListener('close', (e) => {
    if (e.target !== host) return;
    if (selected && host.contains(selected.el)) select(null);
    if (typing && host.contains(typing.el)) hideHint();
    mountIn(null);
  }, true);

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
    // above a selection low on the screen it would land on the dock: it stops just over it
    y = Math.min(y, floorOf(innerHeight) - bh - 8);
    bar.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }

  // How far down the page can be seen: the screen's bottom, or the top of the dock (and of the
  // action bar on a phone) where they cover it. Behind an on-screen keyboard they do not count.
  function floorOf(bottom) {
    let y = bottom;
    for (const el of [document.querySelector('.ed-dock.is-in'), !FINE() && !bar.hidden ? bar : null]) {
      const t = el ? el.getBoundingClientRect().top : Infinity;
      if (t > 0 && t < y) y = t;
    }
    return y;
  }

  // the hint sits under the text being typed, or above it when the keyboard, the dock (or the
  // screen's edge) leaves no room below
  function placeHint() {
    if (hint.hidden || !typing?.el.isConnected) return;
    const r = typing.el.getBoundingClientRect();
    const vv = window.visualViewport;
    const top = vv ? vv.offsetTop : 0, bottom = floorOf(vv ? vv.offsetTop + vv.height : innerHeight);
    const left = vv ? vv.offsetLeft : 0, right = vv ? vv.offsetLeft + vv.width : innerWidth;
    const hw = hint.offsetWidth, hh = hint.offsetHeight;
    const x = Math.min(Math.max(left + 8, r.left), right - hw - 8);
    let y = r.bottom + 10;
    const above = y + hh > bottom - 8 && r.top - hh - 10 >= top + 8;
    if (above) y = r.top - hh - 10;
    y = Math.max(top + 8, Math.min(y, bottom - hh - 8));
    hint.classList.toggle('is-above', above);
    hint.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }

  function tick() {
    frame = 0;
    // editing off: nothing stays outlined (the boxes are fixed to the screen, so a leftover one
    // would hang in place while the page scrolls under it)
    if (!on) { hl.style.opacity = sel.style.opacity = '0'; show(bar, false); show(hint, false); barUp(false); return; }
    place(hl, hovered?.el !== selected?.el ? hovered?.el : null);
    place(sel, selected?.el);
    placeBar();
    placeHint();
    barUp(!bar.hidden && !FINE());
  }
  // the phone's action bar is up: the page's messages move above it (edit.css)
  function barUp(up) {
    const root = document.documentElement;
    root.classList.toggle('ed-bar-up', up);
    if (up) root.style.setProperty('--ed-bar-h', bar.offsetHeight + 'px');
  }
  // On a phone the bar sits low on the screen, over whatever is there: a selection it covers is
  // scrolled up until it ends just above the bar, or, taller than the room there, until its top
  // is just under the page's top bar.
  function uncover(hit) {
    const el = hit.el;
    if (selected !== hit || bar.hidden || !el.isConnected) return;
    const r = el.getBoundingClientRect(), floor = bar.getBoundingClientRect().top - 8, top = 76;
    if (r.bottom <= floor) return;
    const fits = r.height <= floor - top;
    const keep = [el.style.scrollMarginTop, el.style.scrollMarginBottom];
    if (fits) el.style.scrollMarginBottom = Math.round(innerHeight - floor) + 'px';
    else el.style.scrollMarginTop = top + 'px';
    el.scrollIntoView({ block: fits ? 'end' : 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    [el.style.scrollMarginTop, el.style.scrollMarginBottom] = keep;
  }
  const queue = () => { if (!frame) frame = requestAnimationFrame(tick); };

  async function select(hit) {
    selected = hit;
    bar.textContent = '';
    if (!hit) { show(bar, false); queue(); return; }
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
    mountIn(modalOf(hit.el));
    show(bar, true);
    queue();
    if (!FINE()) requestAnimationFrame(() => uncover(hit));
  }

  // ---------- inline text
  function editable(el) {
    el.classList.remove('ed-ctl-k');
    if (el.isContentEditable) return;
    el.contentEditable = PLAIN ? 'plaintext-only' : 'true';
    el.spellcheck = true;
    el.classList.add('ed-text');
  }
  function lock(el) {
    if (el.classList.contains('ed-text')) el.removeAttribute('contenteditable');
    el.classList.remove('ed-text', 'ed-ctl-k', 'ed-kp');
  }
  function mark(el) {
    if (!on || el.closest(EDITOR_UI) || el.closest('[inert]')) { lock(el); return; }
    if (el.matches('[data-kp]')) el.classList.add('ed-kp');
    if (!el.matches('[data-k], .dv-ch [data-f]')) return;
    if (el.dataset.k && (el.closest(CONTROL) || inCard(el))) {
      // a text in a button, a link or a card: marked, selected with it, changed from Ubah teks
      if (el.classList.contains('ed-text')) el.removeAttribute('contenteditable');
      el.classList.remove('ed-text');
      el.classList.add('ed-ctl-k');
      return;
    }
    editable(el);
  }
  function process(root) {
    if (root?.nodeType !== 1 || root.closest(EDITOR_UI)) return;
    if (root.matches(MARKS)) mark(root);
    for (const el of root.querySelectorAll(MARKS)) mark(el);
  }
  function unmarkAll() {
    for (const el of document.querySelectorAll('.ed-text, .ed-ctl-k, .ed-kp')) lock(el);
  }

  // Typing. A text with {name} parts or **bold** is typed in its raw form; on blur the raw text
  // is saved and the page fills the values in again. Escape gives back what was there.
  let typing = null, again = null;
  const caretEnd = (el) => {
    const s = getSelection();
    if (!s) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    s.removeAllRanges();
    s.addRange(r);
  };
  // where the caret is in el, counted in characters, and putting it back there
  const caretOf = (el) => {
    const s = getSelection();
    if (!s?.rangeCount || !el.contains(s.anchorNode)) return null;
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(s.anchorNode, s.anchorOffset);
    return r.toString().length;
  };
  const caretTo = (el, n) => {
    const s = getSelection();
    if (!s || n == null) { caretEnd(el); return; }
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      if (n <= t.length) { s.collapse(t, n); return; }
      n -= t.length;
    }
    caretEnd(el);
  };
  // A section that redraws a text while it is being typed (a count, a clock) would throw the
  // typing away, or get its filled-in text saved as the text itself: what was typed is put back.
  const guard = new MutationObserver(() => {
    const t = typing;
    if (!t || !t.el.isConnected || t.el.textContent === t.draft) return;
    t.el.textContent = t.draft;
    caretTo(t.el, Math.min(t.caret ?? t.draft.length, t.draft.length));
  });
  function watch(t) {
    guard.disconnect();
    if (!t) return;
    t.draft = t.el.textContent;
    t.caret = caretOf(t.el);
    guard.observe(t.el, { childList: true, characterData: true, subtree: true });
  }
  // the caret's place, for putting it back after such a redraw (the redraw itself moves it, but
  // only after the text is back)
  document.addEventListener('selectionchange', () => {
    if (!typing) return;
    const c = caretOf(typing.el);
    if (c != null) typing.caret = c;
  });
  function entryOf(el) {
    const key = el.dataset.k;
    const T = ctx.texts;
    const e = T.copyEntry?.(key);
    const def = T.original(el);
    return { key, def, raw: T.sourceFor(el), vals: T.varsFor(el), vars: T.varsOf(def), rich: !!e?.rich || el.hasAttribute('data-rich'), opt: !!e?.opt || el.hasAttribute('data-opt'), h: e?.h || '' };
  }
  function showHint(t) {
    const lines = textHints(t.el.textContent, { vars: t.vars, vals: Object.keys(t.vals).length ? t.vals : null, rich: t.rich });
    if (!paintHints(hint, lines, 'ed-tip-l')) { hideHint(); return; }
    t.el.setAttribute('aria-describedby', 'ed-tip');
    mountIn(modalOf(t.el));
    if (hint.hidden) {
      hint.classList.remove('is-in');
      show(hint, true);
      placeHint();
      requestAnimationFrame(() => hint.classList.add('is-in'));
    }
    queue();
  }
  function hideHint() {
    hint.classList.remove('is-in');
    show(hint, false);
    document.querySelector('[aria-describedby="ed-tip"]')?.removeAttribute('aria-describedby');
  }
  const repaint = (el) => {
    const go = () => { if (el.isConnected && document.activeElement !== el) ctx.texts.apply(el); };
    go();
    requestAnimationFrame(go);
  };

  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('.ed-text');
    if (!el || !on || typing?.el === el) return;
    // A field typed inside a card (a divisi's name or description) selects the card with it: its
    // actions stay a tap away (on a phone, once the keyboard is down) while it is typed.
    const card = find(el);
    if (card) { if (selected?.el !== card.el) select(card); } else if (selected) select(null);
    if (!el.dataset.k) { typing = { el, before: el.textContent }; watch(typing); return; }
    const t = { el, ...entryOf(el) };
    t.withRaw = t.rich || Object.keys(t.vals).length > 0 || t.vars.length > 0 || ctx.texts.varsOf(t.raw).length > 0;
    if (again?.el === el) { t.before = again.before; again = null; }
    else {
      if (t.withRaw && el.textContent !== t.raw) { el.textContent = t.raw; caretEnd(el); }
      t.before = t.withRaw ? t.raw : el.textContent;
    }
    typing = t;
    watch(t);
    if (t.withRaw) showHint(t);
  });
  // what has been typed so far, noted before any of the page's own listeners run (one of them
  // returning would let the guard see the new text first and take it for a redraw)
  addEventListener('input', (e) => {
    if (!typing || e.target !== typing.el) return;
    typing.draft = typing.el.textContent;
    typing.caret = caretOf(typing.el) ?? typing.caret;
    if (typing.withRaw) showHint(typing);
  }, true);
  document.addEventListener('focusout', (e) => {
    const t = typing;
    if (!t || e.target !== t.el) return;
    typing = null;
    watch(null);
    hideHint();
    const el = t.el;
    const value = el.textContent.replace(/\u00a0/g, ' ');
    // a text typed away to nothing is left truly empty (a browser may leave a line break behind),
    // so an optional one hides and shows its placeholder
    if (!value.trim() && el.firstChild) el.textContent = '';
    if (value === t.before) { if (t.withRaw) repaint(el); return; }
    const res = el.dataset.k ? ctx.setText(el.dataset.k, value, el) : ctx.setField(el, value);
    if (res && !res.ok && !res.cancelled) {
      ctx.toast(res.errors?.[0] || 'Teks ini belum bisa disimpan.');
      if (res.keep) {
        // too long: the text stays as typed, to be shortened
        again = { el, before: t.before };
        requestAnimationFrame(() => { el.focus(); caretEnd(el); });
        return;
      }
      el.textContent = t.before;
    }
    if (el.dataset.k) repaint(el);
  });
  // Keys typed into a text stay there: page shortcuts ("/" opens the search, arrows flip photos,
  // Escape closes a dialog) do not fire. Registered on the window, before any of the page's own.
  addEventListener('keydown', (e) => {
    if (!on) return;
    const el = e.target.closest?.('.ed-text');
    if (!el) {
      if (e.key === 'Escape' && selected && !e.target.closest?.('.ed-dlg, dialog[open]')) select(null);
      return;
    }
    const multi = el.dataset.f === 'desc' || el.hasAttribute('data-ml');
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (typing?.el === el) { typing.draft = typing.before; el.textContent = typing.before; }
      el.blur();
    } else if (e.key === 'Enter' && !multi && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      el.blur();
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey) e.stopPropagation();
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
    if (hit?.el !== hovered?.el) {
      hovered = hit;
      if (hit) mountIn(modalOf(hit.el));
      queue();
    }
  }, { passive: true });
  document.addEventListener('click', (e) => {
    if (!on) return;
    if (e.target.closest?.(EDITOR_UI)) return;
    // typing into a text never triggers what the text sits on
    if (e.target.closest('.ed-text')) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.closest('[data-edit-pass]')) return;
    const hit = find(e.target);
    if (!hit) { if (selected) select(null); return; }
    if (hit.a.pass?.(e.target, hit.el)) return;
    e.preventDefault();
    e.stopPropagation();
    select(hit);
  }, true);
  // capture: the channel panel and the lists scroll inside their own boxes, not the window
  addEventListener('scroll', queue, { passive: true, capture: true });
  addEventListener('resize', queue);
  window.visualViewport?.addEventListener('resize', queue);
  window.visualViewport?.addEventListener('scroll', queue);

  // ---------- section tools, each with "Teks": the list of page texts opened at that section
  function strip(label, tools, kind) {
    return h('div', { class: 'ed-ui ed-tools', role: 'toolbar', 'aria-label': 'Ubah ' + label, 'data-kind': kind },
      h('span', { class: 'ed-tools-k', text: label }),
      tools.map((t) => h('button', { type: 'button', class: 'ed-tools-b' + (t.primary ? ' is-pri' : '') + (t.quiet ? ' is-q' : ''), onclick: () => t.run() }, t.label)));
  }
  const textsTool = (group) => ({ label: 'Teks', quiet: true, run: () => ctx.openTexts?.(group) });
  function renderSectionTools() {
    for (const [, el] of sectionTools) el.remove();
    sectionTools.clear();
    if (!on) return;
    for (const a of adapters) {
      if (!a.section || !a.tools) continue;
      const host = document.querySelector(a.section);
      if (!host) continue;
      const tools = a.tools(ctx).filter(Boolean);
      if (a.group) tools.push(textsTool(a.group));
      if (!tools.length) continue;
      const s = strip(a.sectionLabel || '', tools, a.kind);
      host.prepend(s);
      sectionTools.set(a.kind, s);
    }
    for (const spot of textTools) {
      const at = document.querySelector(spot.at);
      if (!at || at.closest('[inert]')) continue;
      const group = typeof spot.group === 'function' ? spot.group(at) : spot.group;
      if (!group) continue;
      const s = strip(spot.label?.(group) || ctx.texts.groupLabel?.(group) || group, [textsTool(group)], 'texts-' + spot.id);
      if (spot.before) at.before(s); else at.prepend(s);
      sectionTools.set('texts-' + spot.id, s);
    }
  }
  // a strip went away with its section, or a place for one appeared (a channel page opened)
  function toolsStale() {
    if ([...sectionTools.values()].some((el) => !el.isConnected)) return true;
    for (const spot of textTools) {
      const at = document.querySelector(spot.at);
      if (!!at !== sectionTools.has('texts-' + spot.id)) return true;
    }
    return false;
  }

  // Sections re-render as drafts change and overlays are drawn and redrawn: keep their texts
  // editable and the tools present. One pass per frame at most; the schedule's monitor changes
  // text every second, which adds no element and costs nothing here.
  const pend = new Set();
  let moFrame = 0, gone = false;
  const isUi = (n) => !!(n.nodeType === 1 ? n : n.parentElement)?.closest?.(EDITOR_UI);
  const mo = new MutationObserver((records) => {
    if (!on) return;
    for (const r of records) {
      if (r.type === 'attributes') { if (!isUi(r.target)) pend.add(r.target); continue; }
      for (const n of r.addedNodes) if (n.nodeType === 1 && !isUi(n)) pend.add(n);
      for (const n of r.removedNodes) if (n.nodeType === 1) gone = true;
    }
    if ((pend.size || gone) && !moFrame) moFrame = requestAnimationFrame(flush);
  });
  function flush() {
    moFrame = 0;
    const nodes = [...pend];
    pend.clear();
    gone = false;
    for (const n of nodes) if (n.isConnected) process(n);
    if (selected && !selected.el.isConnected) select(null);
    if (typing && !typing.el.isConnected) { typing = null; watch(null); hideHint(); }
    if (toolsStale()) renderSectionTools();
    queue();
  }

  return {
    setOn(v) {
      on = v;
      document.documentElement.classList.toggle('editing', v);
      if (v) {
        process(document.body);
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-k', 'data-kp', 'data-kt', 'inert'] });
      } else {
        mo.disconnect();
        pend.clear();
        unmarkAll();
        hovered = null;
        selected = null;
        typing = null;
        watch(null);
        bar.textContent = '';
        hideHint();
        mountIn(null);
        show(bar, false);
        hl.style.opacity = sel.style.opacity = '0';
      }
      renderSectionTools();
      queue();
    },
    refresh() { process(document.body); renderSectionTools(); queue(); },
    deselect: () => select(null),
    get on() { return on; },
  };
}
