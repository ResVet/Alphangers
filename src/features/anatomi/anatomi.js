// Heart explorer: a 3D heart where every part can be picked, with notes for each part.
// The text side (search, part list, notes) works on its own, so the section is still useful
// without WebGL; the 3D scene is loaded only when the section comes near the screen.
import './anatomi.css';
import { PARTS, INDEX, GROUPS, VIEW_FOR } from './palette.js';
import { ecgV, RR } from '../../legacy/ecg.js';

const MODEL_URL = '/models/heart.glb';
const META_URL = '/models/heart-meta.json';
const POSTER_URL = '/models/heart-poster.webp';
const MODES = [
  { id: 'whole', label: 'Utuh', hint: 'Bentuk luar, arteri koroner, dan vena jantung' },
  { id: 'cut', label: 'Belah', hint: 'Dibelah biar kelihatan ruang, katup, dan septum' },
  { id: 'ecg', label: 'Listrik', hint: 'Jalur listrik jantung, sinkron sama EKG' },
  { id: 'flow', label: 'Aliran darah', hint: 'Darah kaya dan miskin oksigen lewat ruang dan katupnya' },
];
const CUTS = [
  { id: 'front', label: 'Depan' },
  { id: 'four', label: 'Empat ruang' },
  { id: 'base', label: 'Dasar katup' },
];
// what happens during one beat, in ms after the SA node fires (matches the model's activation times)
const PHASES = [
  [0, 40, 'Nodus SA menembak', 'Impuls lahir di nodus SA dan mulai menyebar ke dinding atrium.'],
  [40, 95, 'Gelombang P', 'Kedua atrium terdepolarisasi, dari kanan ke kiri lewat berkas Bachmann.'],
  [95, 120, 'Segmen PR', 'Impuls ditahan sebentar di nodus AV, kasih waktu atrium ngisi ventrikel.'],
  [120, 165, 'Berkas His', 'Impuls turun lewat berkas His ke cabang kanan dan kiri di septum.'],
  [165, 235, 'Kompleks QRS', 'Purkinje nyebarin impuls, ventrikel terdepolarisasi dari septum dan apeks ke basis.'],
  [235, 330, 'Segmen ST', 'Seluruh ventrikel lagi terdepolarisasi dan berkontraksi, darah dipompa keluar.'],
  [330, 520, 'Gelombang T', 'Ventrikel repolarisasi dan mulai relaksasi.'],
  [520, 1e9, 'Diastol', 'Jantung istirahat dan terisi lagi sampai nodus SA menembak berikutnya.'],
];
const ECG_OFFSET = 0.035; // seconds between the SA node firing and the template's beat start

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

export function mountAnatomi(root, { heart, portal }) {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE_CURSOR = document.documentElement.classList.contains('fine');
  const LOW = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 3);
  let parts = new Map((heart?.parts || []).map((p) => [p.id, p]));

  // ---------- markup
  const wrap = el('div', 'hx');
  wrap.dataset.mode = 'whole';
  const stage = el('div', 'hx-stage');
  const canvas = el('canvas', 'hx-c');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Model jantung 3D. Seret buat memutar, scroll atau cubit buat zoom, klik bagian mana aja buat baca catatannya. Daftar bagian ada di samping.');
  canvas.setAttribute('aria-describedby', 'hxKeys');
  const keysHelp = el('p', 'sr', 'Panah buat memutar, plus dan minus buat zoom, Home buat balik ke posisi awal, Escape buat batal pilih.');
  keysHelp.id = 'hxKeys';
  const load = el('div', 'hx-load');
  const loadBar = el('i', 'hx-load-b');
  const loadT = el('span', 'hx-load-t lbl', 'Memuat model jantung');
  load.append(el('span', 'hx-load-r', null), loadT);
  load.firstChild.append(loadBar);
  const tip = el('div', 'hx-tip');
  tip.setAttribute('aria-hidden', 'true');

  const modes = el('div', 'hx-modes');
  modes.setAttribute('role', 'radiogroup');
  modes.setAttribute('aria-label', 'Tampilan model');
  MODES.forEach((m, i) => {
    const b = el('button', 'hx-mode', m.label);
    b.type = 'button';
    b.dataset.mode = m.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
    b.tabIndex = i === 0 ? 0 : -1;
    b.title = m.hint;
    modes.append(b);
  });

  const cutBox = el('div', 'hx-cut');
  cutBox.hidden = true;
  const cutBtns = el('div', 'hx-seg');
  cutBtns.setAttribute('role', 'group');
  cutBtns.setAttribute('aria-label', 'Arah belahan');
  CUTS.forEach((c, i) => {
    const b = el('button', 'hx-segb', c.label);
    b.type = 'button';
    b.dataset.cut = c.id;
    b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    cutBtns.append(b);
  });
  const cutRange = el('input', 'hx-range');
  cutRange.type = 'range';
  cutRange.min = '-1'; cutRange.max = '1'; cutRange.step = '0.01'; cutRange.value = '0';
  cutRange.setAttribute('aria-label', 'Geser bidang belahan');
  const cutLab = el('label', 'hx-rl lbl', 'Geser belahan');
  cutLab.append(cutRange);
  cutBox.append(cutBtns, cutLab);

  const ecgBox = el('div', 'hx-ecg');
  ecgBox.hidden = true;
  const ecgC = el('canvas', 'hx-ecg-c');
  ecgC.setAttribute('aria-hidden', 'true');
  const ecgK = el('p', 'hx-ecg-k', '');
  const ecgP = el('p', 'hx-ecg-p', '');
  const ecgLive = el('p', 'sr');
  ecgLive.setAttribute('aria-live', 'polite');
  const ecgCtl = el('div', 'hx-ecg-ctl');
  const playB = el('button', 'hx-tbtn', RM ? 'Putar' : 'Jeda');
  playB.type = 'button';
  playB.setAttribute('aria-pressed', RM ? 'false' : 'true');
  const slowB = el('button', 'hx-tbtn', 'Pelan');
  slowB.type = 'button';
  slowB.setAttribute('aria-pressed', 'false');
  slowB.title = 'Putar seperempat kecepatan';
  const scrub = el('input', 'hx-range');
  scrub.type = 'range';
  scrub.min = '0'; scrub.max = '833'; scrub.step = '1'; scrub.value = '0';
  scrub.setAttribute('aria-label', 'Waktu dalam satu detak, milidetik');
  ecgCtl.append(playB, slowB, scrub);
  ecgBox.append(ecgC, ecgK, ecgP, ecgCtl, ecgLive);

  const flowKey = el('div', 'hx-flow');
  flowKey.hidden = true;
  flowKey.innerHTML = '<span><i class="o2-lo"></i>Darah miskin O₂</span><span><i class="o2-hi"></i>Darah kaya O₂</span>';
  const flowPhase = el('b', 'hx-flow-p', '');
  flowKey.append(flowPhase);

  const tools = el('div', 'hx-tools');
  const tool = (label, txt, cls = '') => {
    const b = el('button', 'hx-tool ' + cls, txt);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    tools.append(b);
    return b;
  };
  const zoomIn = tool('Perbesar', '+');
  const zoomOut = tool('Perkecil', '−');
  const homeB = tool('Balik ke posisi awal', '', 'hx-home');
  homeB.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>';
  const corB = tool('Tampilkan pembuluh koroner', '', 'hx-cor');
  corB.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c-1 4-5 5-5 9s3 5 3 9"/><path d="M12 3c1 4 6 4 6 8s-4 6-4 10"/></svg>';
  corB.setAttribute('aria-pressed', 'true');
  const fsB = tool('Layar penuh', '', 'hx-fs');
  fsB.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  if (!wrap.requestFullscreen) fsB.hidden = true;

  const hint = el('p', 'hx-hint lbl', matchMedia('(hover: hover)').matches ? 'Seret buat muter, scroll buat zoom, klik bagian mana aja' : 'Geser buat muter, cubit buat zoom, ketuk bagian mana aja');
  const peek = el('div', 'hx-peek');
  peek.hidden = true;
  const peekN = el('b', 'hx-peek-n');
  const peekS = el('p', 'hx-peek-s');
  const peekGo = el('button', 'hx-peek-go', 'Baca catatannya');
  peekGo.type = 'button';
  const peekX = el('button', 'hx-peek-x', '×');
  peekX.type = 'button';
  peekX.setAttribute('aria-label', 'Tutup');
  peek.append(peekN, peekS, peekGo, peekX);

  stage.append(canvas, keysHelp, load, tip, modes, cutBox, ecgBox, flowKey, tools, hint, peek);

  const side = el('aside', 'hx-side');
  side.setAttribute('aria-label', 'Bagian jantung');
  const find = el('div', 'hx-find');
  const q = el('input', 'hx-q');
  q.type = 'search';
  q.placeholder = 'Cari bagian, misal: mitral, LAD, nodus AV';
  q.setAttribute('aria-label', 'Cari bagian jantung');
  q.autocomplete = 'off';
  q.spellcheck = false;
  const list = el('nav', 'hx-list');
  list.setAttribute('aria-label', 'Daftar bagian jantung');
  find.append(q, list);
  const info = el('article', 'hx-info');
  info.id = 'hxInfo';
  info.tabIndex = -1;
  side.append(find, info);
  wrap.append(stage, side);
  root.append(wrap);

  // ---------- part list
  function renderList() {
    list.textContent = '';
    const term = fold(q.value.trim());
    const groups = new Map();
    for (const p of parts.values()) {
      if (term) {
        const hay = fold([p.name, p.latin, p.en, p.id].join(' '));
        if (!term.split(/\s+/).every((t) => hay.includes(t))) continue;
      }
      if (!groups.has(p.group)) groups.set(p.group, []);
      groups.get(p.group).push(p);
    }
    if (!groups.size) {
      list.append(el('p', 'hx-none', 'Gak ketemu. Coba nama Latin atau singkatannya.'));
      return;
    }
    for (const [g, items] of groups) {
      const box = el('div', 'hx-grp');
      box.append(el('p', 'hx-grp-h lbl', `${GROUPS[g] || g} · ${items.length}`));
      const ul = el('ul', 'hx-items');
      items.forEach((p) => {
        const li = el('li');
        const b = el('button', 'hx-item');
        b.type = 'button';
        b.dataset.id = p.id;
        b.append(el('span', 'hx-item-n', p.name), el('span', 'hx-item-l', p.en));
        if (p.id === current) b.setAttribute('aria-current', 'true');
        li.append(b);
        ul.append(li);
      });
      box.append(ul);
      list.append(box);
    }
  }

  // ---------- notes for one part (plain text only, never HTML)
  function section(title, body) {
    const s = el('section', 'hx-sec');
    s.append(el('h4', 'hx-sec-h lbl', title));
    if (body) s.append(body);
    return s;
  }
  function renderInfo(id) {
    const p = parts.get(id) || parts.get('heart');
    info.textContent = '';
    if (!p) return;
    const head = el('header', 'hx-ih');
    head.append(el('p', 'hx-kick kick', GROUPS[p.group] || p.group));
    head.append(el('h3', 'hx-name', p.name));
    const names = el('p', 'hx-alt');
    names.append(el('i', null, p.latin));
    if (p.en) names.append(document.createTextNode(' · ' + p.en));
    head.append(names);
    info.append(head);
    if (p.summary) info.append(el('p', 'hx-sum', p.summary));
    if (p.anatomy?.length) {
      const ul = el('ul', 'hx-pts');
      p.anatomy.forEach((t) => {
        const li = el('li');
        const m = /^([^:]{2,40}):\s*(.*)$/s.exec(t);
        if (m) { li.append(el('b', null, m[1] + '. ')); li.append(document.createTextNode(m[2])); } else li.textContent = t;
        ul.append(li);
      });
      info.append(section('Anatomi', ul));
    }
    if (p.function) info.append(section('Fungsi', el('p', null, p.function)));
    if (p.numbers?.length) {
      const dl = el('dl', 'hx-num');
      p.numbers.forEach((n) => { dl.append(el('dt', null, n.k), el('dd', null, n.v)); });
      info.append(section('Angka penting', dl));
    }
    if (p.supply) info.append(section('Perdarahan', el('p', null, p.supply)));
    if (p.clinical?.length) {
      const box = el('div', 'hx-clin');
      p.clinical.forEach((c) => {
        const d = el('div', 'hx-card');
        d.append(el('b', null, c.t), el('p', null, c.d));
        box.append(d);
      });
      info.append(section('Klinis', box));
    }
    if (p.ecg) info.append(section('Di EKG', el('p', null, p.ecg)));
    if (p.related?.length) {
      const r = el('div', 'hx-rel');
      p.related.forEach((rid) => {
        const rp = parts.get(rid);
        if (!rp) return;
        const b = el('button', 'hx-chip', rp.name);
        b.type = 'button';
        b.dataset.id = rid;
        r.append(b);
      });
      info.append(section('Terkait', r));
    }
    const note = el('p', 'hx-src', 'Ringkasan belajar dari buku ajar dan rujukan klinis. Buat ujian, tetap cek slide dan buku pegangan blok.');
    info.append(note);
  }

  // ---------- selection
  let current = 'heart';
  let scene = null;
  function select(id, { fly = false, focusInfo = false, fromModel = false } = {}) {
    if (!parts.has(id)) id = 'heart';
    current = id;
    renderInfo(id);
    list.querySelectorAll('.hx-item').forEach((b) => {
      if (b.dataset.id === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    const want = VIEW_FOR[id];
    if (want && scene && !fromModel) {
      if (want.mode !== mode) setMode(want.mode, { keepSel: true });
      if (want.cut && want.mode === 'cut') setCut(want.cut);
    }
    if (scene) {
      scene.setSelected(id === 'heart' ? -1 : INDEX[id]);
      if (id === 'heart' && fly) scene.home();
      else if (fly) scene.focus(id);
    }
    if (fromModel && id !== 'heart' && matchMedia('(max-width: 899px)').matches) {
      const p = parts.get(id);
      peekN.textContent = p.name;
      peekS.textContent = p.summary || '';
      peek.hidden = false;
    } else peek.hidden = true;
    if (focusInfo) { info.scrollTop = 0; info.focus({ preventScroll: true }); }
    else info.scrollTop = 0;
  }

  // ---------- modes
  let mode = 'whole';
  function setMode(m, { keepSel = false } = {}) {
    mode = m;
    wrap.dataset.mode = m;
    modes.querySelectorAll('.hx-mode').forEach((b) => {
      const on = b.dataset.mode === m;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    cutBox.hidden = m !== 'cut';
    ecgBox.hidden = m !== 'ecg';
    flowKey.hidden = m !== 'flow';
    if (!scene) return;
    scene.setMode(m);
    fitInsets();
    if (m === 'cut') scene.viewCut();
    else if (!keepSel) scene.home();
    if (m === 'ecg' || m === 'flow') { scene.setPlaying(playing); drawEcg(scene.time); }
  }
  function setCut(k) {
    cutBtns.querySelectorAll('.hx-segb').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cut === k ? 'true' : 'false'));
    if (!scene) return;
    scene.setCut(k, 0);
    cutRange.value = '0';
    scene.viewCut(k);
  }

  // ---------- ECG strip and phase text
  let playing = !RM, phaseIdx = -1;
  const ectx = ecgC.getContext('2d');
  function drawEcg(ms) {
    if (ecgBox.hidden && flowKey.hidden) return;
    const ph = PHASES.findIndex(([a, b]) => ms >= a && ms < b);
    if (ph !== phaseIdx) {
      phaseIdx = ph;
      const [, , k, d] = PHASES[ph];
      ecgK.textContent = k;
      ecgP.textContent = d;
      flowPhase.textContent = ms >= 165 && ms < 520 ? 'Sistol' : 'Diastol';
      if (!playing) ecgLive.textContent = `${k}. ${d}`;
    }
    if (ecgBox.hidden) return;
    const r = ecgC.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (!w || !h) return;
    if (ecgC.width !== w || ecgC.height !== h) { ecgC.width = w; ecgC.height = h; }
    ectx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height, mid = H * 0.68, amp = H * 0.5;
    ectx.clearRect(0, 0, W, H);
    ectx.strokeStyle = 'rgba(238,242,232,.07)';
    ectx.lineWidth = 1;
    for (let x = 0; x < W; x += 12) { ectx.beginPath(); ectx.moveTo(x + 0.5, 0); ectx.lineTo(x + 0.5, H); ectx.stroke(); }
    const span = RR, head = (ms / 1000);
    const trace = (from, to, style, lw) => {
      ectx.beginPath();
      for (let x = Math.floor(from); x <= to; x += 1.5) {
        const t = (x / W) * span;
        const y = mid - ecgV(t + ECG_OFFSET) * amp;
        if (x === Math.floor(from)) ectx.moveTo(x, y); else ectx.lineTo(x, y);
      }
      ectx.strokeStyle = style;
      ectx.lineWidth = lw;
      ectx.stroke();
    };
    const hx = (head / span) * W;
    trace(0, W, 'rgba(238,242,232,.18)', 1.2);
    trace(0, hx, 'rgba(134,242,94,.95)', 1.8);
    const hy = mid - ecgV(head + ECG_OFFSET) * amp;
    ectx.fillStyle = '#eaffde';
    ectx.beginPath(); ectx.arc(hx, hy, 3, 0, Math.PI * 2); ectx.fill();
    if (!scrubbing) scrub.value = String(Math.round(ms));
  }
  let scrubbing = false;
  scrub.addEventListener('input', () => {
    scrubbing = true;
    if (playing) togglePlay(false);
    scene?.setTime(+scrub.value);
    drawEcg(+scrub.value);
  });
  scrub.addEventListener('change', () => { scrubbing = false; });
  function togglePlay(on = !playing) {
    playing = on;
    playB.textContent = on ? 'Jeda' : 'Putar';
    playB.setAttribute('aria-pressed', on ? 'true' : 'false');
    scene?.setPlaying(on);
  }
  playB.addEventListener('click', () => togglePlay());
  slowB.addEventListener('click', () => {
    const on = slowB.getAttribute('aria-pressed') !== 'true';
    slowB.setAttribute('aria-pressed', on ? 'true' : 'false');
    scene?.setSpeed(on ? 0.25 : 1);
  });

  // ---------- events on the UI
  modes.addEventListener('click', (e) => {
    const b = e.target.closest('.hx-mode');
    if (b) setMode(b.dataset.mode);
  });
  modes.addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const i = MODES.findIndex((m) => m.id === mode);
    const next = MODES[(i + keys[e.key] + MODES.length) % MODES.length].id;
    setMode(next);
    modes.querySelector(`[data-mode="${next}"]`).focus();
  });
  cutBtns.addEventListener('click', (e) => {
    const b = e.target.closest('.hx-segb');
    if (b) setCut(b.dataset.cut);
  });
  cutRange.addEventListener('input', () => {
    if (!scene) return;
    const { range } = scene.cutInfo();
    const v = +cutRange.value;
    scene.setCut(null, v < 0 ? -v * range[0] : v * range[1]);
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.hx-item');
    if (b) select(b.dataset.id, { fly: true });
  });
  info.addEventListener('click', (e) => {
    const b = e.target.closest('.hx-chip');
    if (b) select(b.dataset.id, { fly: true, focusInfo: true });
  });
  q.addEventListener('input', renderList);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = list.querySelector('.hx-item');
      if (first) { e.preventDefault(); select(first.dataset.id, { fly: true }); }
    }
  });
  peekGo.addEventListener('click', () => {
    peek.hidden = true;
    info.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' });
    info.focus({ preventScroll: true });
  });
  peekX.addEventListener('click', () => { peek.hidden = true; });
  zoomIn.addEventListener('click', () => scene?.zoom(0.8));
  zoomOut.addEventListener('click', () => scene?.zoom(1.25));
  homeB.addEventListener('click', () => { select('heart'); scene?.home(); });
  corB.addEventListener('click', () => {
    const on = corB.getAttribute('aria-pressed') !== 'true';
    corB.setAttribute('aria-pressed', on ? 'true' : 'false');
    scene?.setCoronary(on);
  });
  fsB.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else wrap.requestFullscreen?.().catch(() => {});
  });
  const onFs = () => {
    wrap.classList.toggle('fs', document.fullscreenElement === wrap);
    requestAnimationFrame(() => scene?.resize());
  };
  document.addEventListener('fullscreenchange', onFs);

  // pointer: a quick tap or click picks, a drag rotates
  let down = null, hoverT = 0, lastHover = -2;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || !scene) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 450;
    down = null;
    if (moved > 7 || !quick) return;
    const i = scene.pick(e.clientX, e.clientY);
    if (i > 0) select(PARTS[i], { fromModel: true });
    else if (current !== 'heart') select('heart', { fromModel: true });
  });
  canvas.addEventListener('dblclick', (e) => {
    if (!scene) return;
    const i = scene.pick(e.clientX, e.clientY);
    if (i > 0) { select(PARTS[i], { fromModel: true }); scene.focus(PARTS[i]); }
  });
  const cr = document.getElementById('cr'), crt = document.getElementById('crt');
  function showHover(i, e) {
    const name = i > 0 ? parts.get(PARTS[i])?.name : '';
    canvas.style.cursor = name ? 'pointer' : 'grab';
    if (FINE_CURSOR && cr && crt) {
      if (name) { crt.textContent = name; cr.classList.add('lab'); } else { crt.textContent = 'putar'; cr.classList.add('lab'); }
      return;
    }
    if (!name) { tip.classList.remove('on'); return; }
    tip.textContent = name;
    const r = stage.getBoundingClientRect();
    tip.style.transform = `translate(${Math.round(e.clientX - r.left + 14)}px, ${Math.round(e.clientY - r.top + 14)}px)`;
    tip.classList.add('on');
  }
  canvas.addEventListener('pointermove', (e) => {
    if (!scene || e.pointerType !== 'mouse' || e.buttons) return;
    const now = performance.now();
    if (now - hoverT < 70) return;
    hoverT = now;
    const i = scene.pick(e.clientX, e.clientY);
    if (i !== lastHover) { lastHover = i; scene.setHover(i > 0 ? i : -1); }
    showHover(i, e);
  });
  canvas.addEventListener('pointerleave', () => {
    lastHover = -2;
    scene?.setHover(-1);
    tip.classList.remove('on');
    if (FINE_CURSOR && cr) cr.classList.remove('lab', 'big');
  });
  canvas.addEventListener('keydown', (e) => {
    if (!scene) return;
    const step = 0.12;
    const k = {
      ArrowLeft: () => scene.rotate(-step, 0), ArrowRight: () => scene.rotate(step, 0),
      ArrowUp: () => scene.rotate(0, -step), ArrowDown: () => scene.rotate(0, step),
      '+': () => scene.zoom(0.85), '=': () => scene.zoom(0.85), '-': () => scene.zoom(1.18),
      Home: () => scene.home(), Escape: () => select('heart'),
    }[e.key];
    if (k) { e.preventDefault(); k(); }
  });

  // ---------- start
  renderList();
  select('heart');

  let disposed = false, vis = false;
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
    vis = es.some((x) => x.isIntersecting);
    scene?.setActive(vis && !document.hidden);
  }, { rootMargin: '120px 0px' }) : null;
  io?.observe(stage);
  const onVis = () => scene?.setActive(vis && !document.hidden);
  document.addEventListener('visibilitychange', onVis);
  // keep the heart clear of whatever control strip is showing over the stage
  function fitInsets() {
    if (!scene) return;
    const sr = stage.getBoundingClientRect();
    const panel = [cutBox, ecgBox, flowKey].find((p) => !p.hidden);
    const top = modes.getBoundingClientRect().bottom - sr.top;
    const bottom = panel ? sr.bottom - panel.getBoundingClientRect().top : 0;
    scene.setInsets(Math.max(0, top), Math.max(0, bottom));
  }
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { scene?.resize(); fitInsets(); }) : null;

  function noWebgl(msg) {
    // a still picture of the model, so the stage is not an empty box
    const img = el('img', 'hx-poster');
    img.src = POSTER_URL;
    img.alt = 'Gambar model jantung dari depan';
    img.decoding = 'async';
    stage.prepend(img);
    wrap.classList.add('hx-off');
    load.classList.add('hx-load-off');
    loadT.textContent = msg;
    modes.hidden = tools.hidden = hint.hidden = true;
  }

  if (!webglOK()) {
    noWebgl('Browser ini belum bisa nampilin 3D. Catatan tiap bagian tetap bisa dibaca dari daftar di samping.');
  } else {
    Promise.all([import('./scene.js'), fetch(META_URL).then((r) => { if (!r.ok) throw new Error('meta ' + r.status); return r.json(); })])
      .then(([mod, meta]) => mod.createScene(canvas, {
        meta,
        url: MODEL_URL,
        reducedMotion: RM,
        lowPower: !!LOW,
        onProgress: (f) => { loadBar.style.transform = `scaleX(${f.toFixed(3)})`; },
      }))
      .then((s) => {
        if (disposed) { s.dispose(); return; }
        scene = s;
        if (import.meta.env.DEV) window.__hx = s;
        scene.onTick((ms) => drawEcg(ms));
        scene.onContextChange = (ok) => { wrap.classList.toggle('hx-lost', !ok); };
        // a CPU-only renderer cannot keep up with the beat, so it starts paused like reduced motion
        if (s.software && playing) togglePlay(false);
        if (RM || s.software) scene.setTime(200);
        ro?.observe(stage);
        scene.resize();
        fitInsets();
        scene.home(true);
        scene.setActive(vis && !document.hidden);
        if (current !== 'heart') select(current);
        load.classList.add('done');
        wrap.classList.add('ready');
        setTimeout(() => { load.hidden = true; }, 700);
      })
      .catch((err) => {
        console.error(err);
        noWebgl('Model 3D-nya gagal dimuat. Catatan tiap bagian tetap bisa dibaca dari daftar di samping.');
      });
  }

  return {
    update({ heart: fresh }) {
      if (!fresh?.parts) return;
      parts = new Map(fresh.parts.map((p) => [p.id, p]));
      renderList();
      renderInfo(current);
    },
    select: (id) => select(id, { fly: true }),
    destroy() {
      disposed = true;
      io?.disconnect();
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('fullscreenchange', onFs);
      scene?.dispose();
      wrap.remove();
    },
  };
}
