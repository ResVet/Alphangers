// The portal shell from v3: loader, hero, scroll-driven heart and ECG, channel list, channel panel
// with the curtain transition, try out CBT, footer, class photo window and the Polyester easter egg.
// New features live in src/features and talk to this file only through the object it returns.
import { HeartGL } from './heart-gl.js';
import { RR, ecgV, ecgN, ECG3D } from './ecg.js';

export function startPortal(boot){
var H = document.documentElement, B = document.body;
H.classList.add('js');
var RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
var FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;
var TOUCH = !FINE;
if(FINE && !RM) H.classList.add('fine');
if(TOUCH) H.classList.add('touch');
if(RM) H.classList.add('static');
var LOW = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 3);

function $(s, r){ return (r || document).querySelector(s); }
function $$(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function clamp(x, a, b){ return x < a ? a : x > b ? b : x; }
function lerp(a, b, t){ return a + (b - a) * t; }
function sstep(a, b, x){ var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function damp(a, b, k, dt){ return lerp(a, b, 1 - Math.exp(-k * dt)); }
function bump(x, a, b, c, d){ return clamp((x - a) / (b - a), 0, 1) * (1 - clamp((x - c) / (d - c), 0, 1)); }
function hPush(st, u){ try{ history.pushState(st, '', u); }catch(e){} }
function hRepl(st, u){ try{ history.replaceState(st, '', u); }catch(e){} }
function store(k, v){ try{ if(v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); }catch(e){} return null; }
function esc(s){ return String(s).replace(/[&<>"']/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; }); }
function dprCap(max){ return Math.min(window.devicePixelRatio || 1, max); }

// data
var ICON = {
  lobby:'<path d="M3.5 10.5 12 4l8.5 6.5"/><path d="M5.5 9v10.5h13V9"/><path d="M12 11.5v5M9.5 14h5"/>',
  batu:'<ellipse cx="12" cy="18.2" rx="7.2" ry="2.5"/><ellipse cx="11.4" cy="12.9" rx="5.2" ry="2.35"/><ellipse cx="12.3" cy="8.1" rx="3.3" ry="1.95"/>',
  tryout:'<circle cx="12" cy="13.5" r="7.5"/><path d="M9.8 3h4.4M12 3v2.8M18.2 7.2l1.3-1.3"/><path d="M6.8 13.6h2.1l1.1-2.4 1.9 4.9 1.2-2.5h2.1"/>',
  it:'<path d="M12 6.5C10.2 5.2 7 4.6 3.5 5v13.5c3.5-.4 6.7.2 8.5 1.5 1.8-1.3 5-1.9 8.5-1.5V5c-3.5-.4-6.7.2-8.5 1.5z"/><path d="M12 6.5V20"/>',
  quiz:'<rect x="5.5" y="4.5" width="13" height="16" rx="2"/><path d="M9.5 3h5a1 1 0 0 1 1 1v1.5h-7V4a1 1 0 0 1 1-1z"/><path d="M9 12.8l2.2 2.2 4.3-4.6"/>',
  osce:'<path d="M6.5 3.5v5a5 5 0 0 0 10 0v-5"/><path d="M5.5 3.5h2M15.5 3.5h2"/><path d="M11.5 13.5v2.2a4.3 4.3 0 0 0 8.6 0v-2.4"/><circle cx="20.1" cy="11.6" r="1.9"/>',
  ospe:'<path d="M8.5 20.5h10"/><path d="M13.5 20.5a5.5 5.5 0 0 0 3.2-9.3"/><path d="M9 5.2l3-1.7 3.5 6.1-3 1.7z"/><path d="M11.5 12.2l1.2 2.1"/><path d="M6 15.5h7"/>',
  tutorial:'<path d="M4 5h10.5A1.5 1.5 0 0 1 16 6.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 4 5z"/><path d="M18.5 9h1a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H19v2.5L16 18h-4.5a1.5 1.5 0 0 1-1.5-1.5V16"/>',
  praktikum:'<path d="M9.5 3.5h5"/><path d="M10.5 3.5v5.2L5.3 17.6A2 2 0 0 0 7 20.5h10a2 2 0 0 0 1.7-2.9l-5.2-8.9V3.5"/><path d="M7.6 14h8.8"/>',
  kating:'<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4.4l2 2H19A1.5 1.5 0 0 1 20.5 9v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z"/><path d="M3.5 10.5h17"/>'
};
function svgI(id){ return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICON[id] || ICON.kating) + '</svg>'; }
var CH = [], BY = {}, URLS = {}, TOTAL = '00';
function setChannelData(data){
  CH = ((data && data.channels) || []).map(function(c){ return Object.assign({}, c); });
  BY = {}; URLS = {};
  CH.forEach(function(c, i){ c.num = (i < 9 ? '0' : '') + (i + 1); BY[c.id] = c; URLS[c.id] = c.url || ''; });
  TOTAL = (CH.length < 10 ? '0' : '') + CH.length;
}
setChannelData(boot.links);
function linkOf(id){
  var u = String(URLS[id] || '').trim();
  if(!u || /\s/.test(u)) return '';
  if(!/^https?:\/\//i.test(u)){ if(/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(u)) u = 'https://' + u; else return ''; }
  return u;
}
function prettyUrl(u){ return u.replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').replace(/\/$/, ''); }

// toast
var toastEl = $('#toast'), toastT = 0;
function toast(msg){
  toastEl.textContent = msg; toastEl.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(function(){ toastEl.classList.remove('on'); }, 2600);
}

// sound (Web Audio, off until the visitor turns it on)
var AC = null, master = null, soundOn = false;
function audio(){
  if(!AC){
    var C = window.AudioContext || window.webkitAudioContext; if(!C) return null;
    try{ AC = new C(); }catch(e){ return null; }
    master = AC.createGain(); master.gain.value = 0.85;
    var comp = AC.createDynamicsCompressor(); master.connect(comp); comp.connect(AC.destination);
  }
  if(AC.state === 'suspended'){ try{ AC.resume(); }catch(e){} }
  return AC;
}
function tone(t0, f0, f1, dur, g, type){
  var o = AC.createOscillator(), v = AC.createGain();
  o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t0);
  if(f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  v.gain.setValueAtTime(0.0001, t0); v.gain.exponentialRampToValueAtTime(g, t0 + 0.012); v.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(v); v.connect(master); o.start(t0); o.stop(t0 + dur + 0.03);
}
function lubdub(){
  if(!soundOn || !AC) return;
  var t = AC.currentTime + 0.005;
  tone(t, 880, 880, 0.08, 0.04, 'sine');
  tone(t, 60, 38, 0.2, 0.55); tone(t + 0.3, 74, 48, 0.14, 0.34);
}
function swish(){
  if(!soundOn || !AC) return;
  var t = AC.currentTime, len = 0.5, buf = AC.createBuffer(1, Math.round(AC.sampleRate * len), AC.sampleRate), d = buf.getChannelData(0);
  for(var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / d.length);
  var s = AC.createBufferSource(); s.buffer = buf;
  var f = AC.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2600, t + len);
  var g = AC.createGain(); g.gain.value = 0.09;
  s.connect(f); f.connect(g); g.connect(master); s.start(t);
}
var sndBtn = $('#snd'), sndS = $('#sndS');
sndBtn.addEventListener('click', function(){
  soundOn = !soundOn;
  if(soundOn && !audio()){ soundOn = false; toast('Browser ini belum dukung suara.'); }
  sndBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  sndS.textContent = soundOn ? 'on' : 'off';
  if(soundOn) lubdub();
});

// heartbeat clock: drives the halo, the BPM readout and the sound
var beat = { bpm: 72, kick: 0, phase: 0.55, lastR: 0, listeners: [] };
beat.lastR = Math.floor(beat.phase - 0.282);
function beatStep(dt, sv){
  var target = 72 + clamp(Math.abs(sv) / 2600, 0, 1) * 38 + beat.kick;
  beat.kick = damp(beat.kick, 0, 0.55, dt);
  beat.bpm = damp(beat.bpm, target, 1.8, dt);
  beat.phase += dt * beat.bpm / 60;
  var r = Math.floor(beat.phase - 0.282);
  if(r > beat.lastR){ beat.lastR = r; for(var i = 0; i < beat.listeners.length; i++) beat.listeners[i](); }
}

// hero line: one of four endings, same odds on every load
var ENDS = ['And yes this website is a bit vibecoded\u00a0:D', 'Semangat belajarnya!', 'Jangan tanya apa kepanjangan Resvet.', ''];
var ledeEnd = $('#ledeEnd'), endK = Math.floor(Math.random() * ENDS.length), polyBtn = null;
if(ledeEnd){
  if(ENDS[endK]) ledeEnd.textContent = ENDS[endK];
  else { ledeEnd.innerHTML = '<span class="nw"><button class="poly" type="button" id="polyBtn">100% Polyester</button>.</span>'; polyBtn = $('#polyBtn'); }
}

// hero title
var sk = $('#ttlSk'), ttlEl = $('#ttl'), word = sk.textContent.trim(), chars = [];
sk.textContent = '';
word.split('').forEach(function(ch, i){
  var s = document.createElement('span'); s.className = 'ch'; s.setAttribute('aria-hidden', 'true');
  s.style.setProperty('--cd', (0.1 + i * 0.045) + 's');
  var it = document.createElement('i'); it.textContent = ch; s.appendChild(it); sk.appendChild(s); chars.push(s);
});

// channel rows + hover preview
var chCount = $('#chCount');
var rowsEl = $('#rows'), peek = $('#peek'), peekIn = $('#peekIn');
function renderRows(again){
  if(chCount) chCount.textContent = 'Menu · ' + TOTAL + ' channel';
  rowsEl.textContent = ''; peekIn.textContent = '';
  CH.forEach(function(c, i){
    var li = document.createElement('li'); li.className = 'row rv' + (again ? ' in' : ''); li.style.setProperty('--d', (i * 0.045) + 's');
    li.innerHTML = '<button class="row-b" type="button" data-id="' + esc(c.id) + '" data-cur="buka" data-i="' + i + '">' +
      '<span class="row-i">' + c.num + '</span><span class="row-ic">' + svgI(c.id) + '</span>' +
      '<span class="row-n">' + esc(c.name) + (c.kind === 'tryout' ? '<em class="row-nb">baru</em>' : '') + '<small>' + esc(c.tag) + '</small></span>' +
      '<span class="row-a"><span>' + (c.kind === 'tryout' ? 'Mulai' : 'Drive') + '</span><b>→</b></span></button><span class="blip" aria-hidden="true"></span>';
    rowsEl.appendChild(li);
    if(c.kind === 'tryout') li.classList.add('row-new');
    var pk = document.createElement('div'); pk.className = 'pk';
    pk.innerHTML = '<span class="pk-n">' + c.num + '</span><span class="pk-ic">' + svgI(c.id) + '</span><span class="pk-t">' + esc(c.name) + '<small>' + (c.kind === 'tryout' ? 'Try out' : 'Folder Drive') + '</small></span>';
    peekIn.appendChild(pk);
  });
}
renderRows(false);
// newer channel data from the admin editor; the open panel, if any, keeps what it showed
function setChannels(data){
  setChannelData(data);
  renderRows(true);
}

// loader
var loader = $('#loader'), ldc = $('#ldc'), ldn = $('#ldn'), lctx = ldc.getContext('2d');
var quick = RM || store('alpha_seen') === '1';
var LD = RM ? 200 : (quick ? 1000 : 2300);
var ld0 = performance.now(), ldDone = false, ldW = 0, ldH = 0;
function ldSize(){ var r = ldc.getBoundingClientRect(), d = dprCap(2); ldW = r.width; ldH = r.height; ldc.width = Math.round(ldW * d); ldc.height = Math.round(ldH * d); lctx.setTransform(d, 0, 0, d, 0, 0); }
ldSize();
function ldDraw(p){
  lctx.clearRect(0, 0, ldW, ldH);
  var mid = ldH * 0.62, amp = ldH * 0.42, hx = p * ldW;
  lctx.lineJoin = 'round'; lctx.lineCap = 'round';
  for(var pass = 0; pass < 2; pass++){
    lctx.beginPath();
    for(var x = 0; x <= hx; x += 2){
      var t = (x / ldW) * 2.3 - 1.42;
      var v = (t < 0 ? 0 : ecgV(t)) + ecgN(t) * 0.8;
      var y = mid - v * amp;
      if(x === 0) lctx.moveTo(x, y); else lctx.lineTo(x, y);
    }
    lctx.strokeStyle = pass ? 'rgba(236,255,222,.95)' : 'rgba(126,240,90,.22)';
    lctx.lineWidth = pass ? 1.6 : 7; lctx.stroke();
  }
  var th = (hx / ldW) * 2.3 - 1.42, hy = mid - (th < 0 ? 0 : ecgV(th)) * amp;
  var g = lctx.createRadialGradient(hx, hy, 0, hx, hy, 26);
  g.addColorStop(0, 'rgba(236,255,222,.95)'); g.addColorStop(.3, 'rgba(126,240,90,.35)'); g.addColorStop(1, 'rgba(126,240,90,0)');
  lctx.fillStyle = g; lctx.fillRect(hx - 26, hy - 26, 52, 52);
}
function ldTick(now){
  if(ldDone) return;
  var t = clamp((now - ld0) / LD, 0, 1), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  var p = lerp(t, e, .5);
  ldn.textContent = ('00' + Math.round(p * 100)).slice(-3);
  ldDraw(p);
  if(t < 1) requestAnimationFrame(ldTick);
}
requestAnimationFrame(ldTick);
var fontsReady = (document.fonts && document.fonts.ready) ? Promise.race([document.fonts.ready, new Promise(function(r){ setTimeout(r, 2600); })]) : Promise.resolve();
var revealed = false;
function reveal(){
  if(revealed) return; revealed = true; ldDone = true;
  store('alpha_seen', '1');
  ldn.textContent = '100';
  loader.classList.add('flash');
  if(soundOn) lubdub();
  setTimeout(function(){ loader.classList.add('out'); }, RM ? 0 : 160);
  setTimeout(function(){
    loader.style.display = 'none';
    H.classList.remove('pre');
    B.classList.add('go');
    $$('.hero .rv').forEach(function(el){ el.classList.add('in'); });
    setTimeout(function(){ $('#totem').classList.remove('pre'); }, RM ? 0 : 380);
    setTimeout(function(){ chars.forEach(function(s){ s.style.setProperty('--cd', '0s'); }); ttlEl.classList.add('settled'); }, RM ? 0 : 2400);
    measureAll();
    if(RM) staticDraw();
    // after the title animation; this is a few ms of work, and the video loading runs off the main thread
    if(polyBtn) setTimeout(poly.warm, RM ? 200 : 2600);
  }, RM ? 60 : 900);
}
Promise.all([fontsReady, new Promise(function(r){ setTimeout(r, LD + 60); })]).then(reveal, reveal);
setTimeout(reveal, 5000);

// reveal on scroll
var io = null;
if('IntersectionObserver' in window){
  io = new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
  }, {threshold: .14, rootMargin: '0px 0px -6% 0px'});
  $$('.rv').forEach(function(el){ if(!el.closest('.hero')) io.observe(el); });
} else { $$('.rv').forEach(function(el){ el.classList.add('in'); }); }

// visibility of the heavy sections
var vis = { hero: true, pulse: false, foot: false };
if('IntersectionObserver' in window){
  var vo = new IntersectionObserver(function(es){
    es.forEach(function(e){ vis[e.target.getAttribute('data-vis')] = e.isIntersecting; });
  }, {rootMargin: '80px 0px 80px 0px'});
  [['.hero','hero'],['#siklus','pulse'],['.foot','foot']].forEach(function(a){ var el = $(a[0]); el.setAttribute('data-vis', a[1]); vo.observe(el); });
} else { vis.pulse = vis.foot = true; }

// scroll progress line (ECG across the top bar)
var pgSvg = $('#progSvg'), pgB = $('#pgB'), pgF = $('#pgF'), pgLen = 1;
function progBuild(){
  var w = Math.max(320, window.innerWidth), d = 'M0 7', x = 0, gap = w < 700 ? 130 : 180;
  while(x + gap * 0.55 + 48 <= w){
    var b = x + gap * 0.55;
    d += ' H' + b + ' L' + (b + 4) + ' 5 L' + (b + 8) + ' 7 H' + (b + 14) + ' L' + (b + 16) + ' 9 L' + (b + 19) + ' 0.5 L' + (b + 22) + ' 13 L' + (b + 24) + ' 7 H' + (b + 32) +
         ' C' + (b + 36) + ' 7 ' + (b + 37) + ' 4.5 ' + (b + 40) + ' 4.5 S' + (b + 44) + ' 7 ' + (b + 48) + ' 7';
    x += gap;
  }
  d += ' H' + w;
  pgSvg.setAttribute('viewBox', '0 0 ' + w + ' 14');
  pgB.setAttribute('d', d); pgF.setAttribute('d', d);
  try{ pgLen = pgF.getTotalLength(); }catch(e){ pgLen = w * 1.4; }
  pgF.style.strokeDasharray = pgLen + ' ' + pgLen;
}
var pgLast = -1;
function progFrame(y, force){
  if(y === pgLast && !force) return; pgLast = y;
  var max = document.documentElement.scrollHeight - window.innerHeight;
  var p = max > 0 ? clamp(y / max, 0, 1) : 0;
  pgF.style.strokeDashoffset = (pgLen * (1 - p)).toFixed(1);
}

// hero: emblem, halo, tilt
var totem = $('#totem'), tilt = $('#tilt'), halo = $('#halo'), hctx = halo.getContext('2d'), haloS = 0;
var bpmN = $('#bpmN'), bpmH = $('#bpmH');
function haloSize(){
  var r = halo.getBoundingClientRect(), d = dprCap(2);
  haloS = r.width; if(!haloS) return;
  halo.width = Math.round(haloS * d); halo.height = Math.round(haloS * d); hctx.setTransform(d, 0, 0, d, 0, 0);
}
var haloFlash = 0;
function haloDraw(){
  var S = haloS; if(!S) return;
  hctx.clearRect(0, 0, S, S);
  var cx = S / 2, cy = S / 2, R0 = S * 0.338, AMP = S * 0.066, BPR = 4, SPAN = 0.9, N = 240;
  var head = beat.phase, a0 = -Math.PI / 2 + (head / BPR) * Math.PI * 2;
  // bezel ticks
  hctx.lineCap = 'round';
  for(var k = 0; k < 60; k++){
    var an = k / 60 * Math.PI * 2, big = k % 5 === 0, r1 = S * 0.462, r2 = r1 + (big ? S * 0.018 : S * 0.009);
    hctx.strokeStyle = 'rgba(238,242,232,' + (big ? 0.16 : 0.08) + ')'; hctx.lineWidth = 1;
    hctx.beginPath(); hctx.moveTo(cx + Math.cos(an) * r1, cy + Math.sin(an) * r1); hctx.lineTo(cx + Math.cos(an) * r2, cy + Math.sin(an) * r2); hctx.stroke();
  }
  hctx.setLineDash([2, 5]); hctx.strokeStyle = 'rgba(126,240,90,.12)'; hctx.lineWidth = 1;
  hctx.beginPath(); hctx.arc(cx, cy, R0, 0, Math.PI * 2); hctx.stroke(); hctx.setLineDash([]);
  var pts = [];
  for(var i = 0; i <= N; i++){
    var f = i / N, bt = head - (1 - f) * SPAN * BPR, t = (bt - Math.floor(bt)) * RR;
    var an2 = a0 - (1 - f) * SPAN * Math.PI * 2, rr = R0 + (ecgV(t) + ecgN(bt * RR) * 0.6) * AMP;
    pts.push([cx + Math.cos(an2) * rr, cy + Math.sin(an2) * rr, f]);
  }
  hctx.lineJoin = 'round';
  hctx.globalCompositeOperation = 'lighter';
  var CH2 = 12, seg = Math.ceil(N / CH2);
  for(var pass = 0; pass < 2; pass++){
    for(var c = 0; c < N; c += seg){
      var e = Math.min(c + seg, N), fm = pts[e][2];
      hctx.strokeStyle = pass ? 'rgba(236,255,222,' + (0.95 * fm * fm) + ')' : 'rgba(126,240,90,' + (0.2 * fm * fm * (1 + haloFlash)) + ')';
      hctx.lineWidth = pass ? 1.5 : 6 + haloFlash * 4;
      hctx.beginPath(); hctx.moveTo(pts[c][0], pts[c][1]);
      for(var j = c + 1; j <= e; j++) hctx.lineTo(pts[j][0], pts[j][1]);
      hctx.stroke();
    }
  }
  var hp = pts[N], gr = hctx.createRadialGradient(hp[0], hp[1], 0, hp[0], hp[1], S * 0.05);
  gr.addColorStop(0, 'rgba(236,255,222,1)'); gr.addColorStop(.35, 'rgba(126,240,90,.4)'); gr.addColorStop(1, 'rgba(126,240,90,0)');
  hctx.fillStyle = gr; hctx.fillRect(hp[0] - S * .05, hp[1] - S * .05, S * .1, S * .1);
  hctx.globalCompositeOperation = 'source-over';
}
beat.listeners.push(function(){
  haloFlash = 1;
  bpmN.textContent = Math.round(beat.bpm);
  bpmH.classList.remove('beat'); void bpmH.offsetWidth; bpmH.classList.add('beat');
  if(vis.hero && !pulseActive && !openId) lubdub();
});
var tl = { rx: 0, ry: 0, trx: 0, try_: 0, spin: 0, spinT: 0, gy: null, gx: null, glow: 0 };
var hero = $('.hero');
if(FINE && !RM){
  hero.addEventListener('pointermove', function(e){
    var r = totem.getBoundingClientRect();
    tl.try_ = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 1.4), -1, 1) * 14;
    tl.trx = clamp((e.clientY - (r.top + r.height / 2)) / (r.height * 1.4), -1, 1) * -11;
  });
  hero.addEventListener('pointerleave', function(){ tl.trx = 0; tl.try_ = 0; });
}
if(!RM && TOUCH && window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== 'function'){
  window.addEventListener('deviceorientation', function(e){
    if(e.gamma == null || e.beta == null) return;
    tl.gy = clamp(e.gamma, -30, 30) * 0.5; tl.gx = clamp(e.beta - 40, -30, 30) * -0.35;
  });
}
function assemble(){
  if(RM) return;
  if(totem.classList.contains('burst')) return;
  totem.classList.add('burst'); tl.spinT = performance.now();
  beat.kick = 58;
  if(soundOn){ audio(); lubdub(); setTimeout(lubdub, 260); }
  setTimeout(function(){ totem.classList.remove('burst'); }, 460);
}
totem.addEventListener('click', assemble);
totem.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); assemble(); } });
var ttlSkew = 0;
function heroFrame(dt, T, y, sv){
  ttlSkew = damp(ttlSkew, clamp(-(sv || 0) * 0.0032, -7, 7), 7, dt);
  sk.style.transform = 'skewX(' + ttlSkew.toFixed(2) + 'deg)';
  var tx = tl.trx, ty = tl.try_;
  if(TOUCH){
    tx = Math.cos(T * 0.45) * 5; ty = Math.sin(T * 0.6) * 9 + y * 0.02;
    if(tl.gy !== null){ tx = tl.gx; ty = tl.gy + y * 0.02; }
  }
  tl.rx = damp(tl.rx, tx, 5, dt); tl.ry = damp(tl.ry, ty, 5, dt);
  var sp = 0;
  if(tl.spinT){ var k = (performance.now() - tl.spinT) / 1100; if(k >= 1){ tl.spinT = 0; } else { var e = 1 - Math.pow(1 - k, 3); sp = e * 360; } }
  tilt.style.transform = 'rotateX(' + tl.rx.toFixed(2) + 'deg) rotateY(' + (tl.ry + sp).toFixed(2) + 'deg)';
  totem.style.setProperty('--sx', (50 + tl.ry * 2.6).toFixed(1) + '%');
  totem.style.setProperty('--sy', (36 - tl.rx * 2.6).toFixed(1) + '%');
  haloFlash = damp(haloFlash, 0, 6, dt);
  tl.glow = damp(tl.glow, haloFlash, 12, dt);
  totem.style.setProperty('--gl', (0.8 + tl.glow * 0.35).toFixed(3));
  haloDraw();
}

// marquee reacts to scroll speed and direction
var mq = $('#mq'), mqX = 0, mqW = 0, mqSk = 0, mqDir = 1;
function mqSize(){ mqW = mq.firstElementChild.getBoundingClientRect().width; }
function mqFrame(dt, sv){
  if(!mqW) return;
  if(sv > 30) mqDir = 1; else if(sv < -30) mqDir = -1;
  var speed = 42 + Math.min(Math.abs(sv), 3200) * 0.07;
  mqX -= speed * dt * mqDir;
  if(mqX <= -mqW) mqX += mqW; if(mqX > 0) mqX -= mqW;
  mqSk = damp(mqSk, clamp(-sv * 0.0035, -9, 9), 6, dt);
  mq.style.transform = 'translate3d(' + mqX.toFixed(1) + 'px,0,0) skewX(' + mqSk.toFixed(2) + 'deg)';
}

// the scroll-driven heart + ECG
var pulseActive = false;
var pulse = (function(){
  var sec = $('#siklus'), stage = $('#stage'), ecgC = $('#ecgc'), heartC = $('#heartc');
  var ecg = ECG3D(ecgC), heart = null;
  try{ heart = HeartGL(heartC, { steps: (LOW || TOUCH) ? 64 : 80 }); }catch(e){ heart = null; }
  if(!heart){ heartC.style.display = 'none'; $('#dragHint').style.display = 'none'; }
  var capsEl = $('#caps'), tagsEl = $('#tags'), railEl = $('#rail'), rail = $$('#rail li'), intro = $('#pIntro'), hrEl = $('#hr');
  var CAPS = [
    {k:'Gelombang P', d:'80 ms', t:'Merepresentasikan depolarisasi atrium (kontraksi atrium kiri dan kanan). Durasi normal &lt;0,12 detik.'},
    {k:'Interval PR', d:'160 ms', t:'Waktu dari awal depolarisasi atrium hingga awal depolarisasi ventrikel, mencerminkan konduksi impuls melalui nodus AV. Normal 0,12–0,20 detik.'},
    {k:'Kompleks QRS', d:'80 ms', t:'Merepresentasikan depolarisasi ventrikel. Durasi normal &lt;0,12 detik; pemanjangan mengindikasikan gangguan konduksi intraventrikular.'},
    {k:'Segmen ST', d:'100 ms', t:'Periode antara depolarisasi dan repolarisasi ventrikel. Elevasi atau depresi segmen ini merupakan indikator penting iskemia atau infark miokard.'},
    {k:'Gelombang T', d:'160 ms', t:'Merepresentasikan repolarisasi ventrikel.'},
    {k:'Irama sinus <em>normal</em>', d:'72 bpm', t:'Irama jantung dari nodus SA dengan laju 60–100x/menit, gelombang P selalu diikuti QRS, dan interval R-R teratur.', out:true}
  ];
  var MARKS = [ {t:.08,y:1.8,h:9,l:'P'}, {t:.165,y:.3,h:3.2,l:'PR'}, {t:.235,y:11.3,h:4,l:'QRS'}, {t:.33,y:.3,h:3.2,l:'ST'}, {t:.46,y:3.2,h:7,l:'T'} ];
  var capEls = CAPS.map(function(c){
    var d = document.createElement('div'); d.className = 'cap' + (c.out ? ' out' : '');
    d.innerHTML = '<span class="cap-k"><span>' + c.k + '</span><i>' + c.d + '</i></span><p>' + c.t + '</p>';
    capsEl.appendChild(d); return d;
  });
  MARKS.forEach(function(m){ m.h0 = m.h; m.bump = 0; m.bt = 0; });
  var tagEls = MARKS.map(function(m){ var s = document.createElement('span'); s.className = 'tag'; s.textContent = m.l; tagsEl.appendChild(s); return s; });
  // labels that would sit on top of each other (PR and ST on a compressed strip): lift the later one by lengthening its leader
  function declutter(anchors){
    var vis = {}, placed = [], order = [2, 0, 4, 1, 3];
    for(var i = 0; i < MARKS.length; i++){
      var a = anchors[i], m = MARKS[i]; m.bt = 0;
      if(!(a && a.on && a.a && a.b)) continue;
      var hNow = m.h0 + m.bump, ppm = hNow > 0 ? Math.abs(a.a[1] - a.b[1]) / hNow : 0, el = tagEls[i];
      if(!el.__w){ el.__w = el.offsetWidth; el.__h = el.offsetHeight; }
      vis[i] = { x: a.b[0], y0: a.a[1] - ppm * m.h0, w: el.__w, h: el.__h, ppm: ppm };
    }
    for(var k = 0; k < order.length; k++){
      var v = vis[order[k]]; if(!v) continue;
      var y = v.y0;
      for(var tries = 0; tries < 4; tries++){
        var hit = null;
        for(var j = 0; j < placed.length; j++){ var o = placed[j]; if(Math.abs(v.x - o.x) < (v.w + o.w) / 2 + 3 && Math.abs(y - o.y) < (v.h + o.h) / 2 + 3){ hit = o; break; } }
        if(!hit) break;
        y = hit.y - (v.h + hit.h) / 2 - 4;
      }
      v.y = y; placed.push(v);
      if(v.ppm > 0 && y < v.y0) MARKS[order[k]].bt = (v.y0 - y) / v.ppm;
    }
  }

  var P0 = 0.1, P1 = 0.78;
  var KEYS = [[0.5,0,0.04],[1,0.04,0.12],[1,0.12,0.2],[1.25,0.2,0.28],[1,0.28,0.38],[1.1,0.38,0.56],[0.45,0.56,0.62]];
  var KW = 0; KEYS.forEach(function(k){ KW += k[0]; });
  function headAt(p){
    if(p <= P0) return 0;
    if(p >= P1) return 0.62 + (p - P1) / (1 - P1) * RR * 1.6;
    var u = (p - P0) / (P1 - P0) * KW;
    for(var i = 0; i < KEYS.length; i++){ var k = KEYS[i]; if(u <= k[0]) return lerp(k[1], k[2], u / k[0]); u -= k[0]; }
    return 0.62;
  }
  var st = { ps: 0, W: 0, H: 0, dpr: 1, q: 1, frames: [], downs: 0, drag: 0, dragV: 0, down: false, lx: 0, mx: 0, my: 0, tmx: 0, tmy: 0, head: 0, cap: -2, capOn: -1 };
  function progress(){
    var r = sec.getBoundingClientRect(), total = sec.offsetHeight - stage.offsetHeight;
    return total > 0 ? clamp(-r.top / total, 0, 1) : 1;
  }
  function band(){
    var sr = stage.getBoundingClientRect(), L = Math.max(16, st.W * 0.05), R = st.W - L;
    if(st.W / st.H > 1.1 && heart){ var hr = heartC.getBoundingClientRect(); if(hr.width) R = Math.max(L + 200, hr.left - sr.left - 24); }
    st.bL = L; st.bR = R;
  }
  function heartSize(){
    if(!heart) return;
    if(!st.q0){ st.q0 = (TOUCH ? Math.max(0.75, dprCap(2) * 0.5) : dprCap(1.5) * 0.85) * (LOW ? 0.8 : 1); st.q = st.q0; }
    var hr = heartC.getBoundingClientRect(); if(hr.width) heart.resize(hr.width, hr.height, st.q);
  }
  function measure(){
    var r = stage.getBoundingClientRect(); if(!r.width) return;
    st.W = r.width; st.H = r.height;
    st.dpr = dprCap(TOUCH ? 1.75 : 2) * (st.downs > 2 ? 0.75 : 1);
    ecg.resize(st.W, st.H, st.dpr);
    tagEls.forEach(function(el){ el.__w = 0; });
    heartSize(); band();
    if(vis.pulse || RM) frame(0.016, T || 0, true);
  }
  if(heart){
    heartC.addEventListener('pointerdown', function(e){ st.down = true; st.lx = e.clientX; heartC.classList.add('drag'); try{ heartC.setPointerCapture(e.pointerId); }catch(er){} });
    heartC.addEventListener('pointermove', function(e){ if(!st.down) return; var dx = e.clientX - st.lx; st.lx = e.clientX; st.drag += dx * 0.012; st.dragV = dx * 0.012 * 60; });
    var up = function(){ st.down = false; heartC.classList.remove('drag'); };
    heartC.addEventListener('pointerup', up); heartC.addEventListener('pointercancel', up); heartC.addEventListener('lostpointercapture', up);
  }
  if(FINE){
    stage.addEventListener('pointermove', function(e){ st.tmx = (e.clientX / window.innerWidth) * 2 - 1; st.tmy = (e.clientY / window.innerHeight) * 2 - 1; });
  }
  function capIndex(ps, head){
    if(ps < P0 + 0.004) return -1;
    if(ps >= P1 + 0.03) return 5;
    if(head < 0.034) return -1;
    if(head < 0.12) return 0; if(head < 0.2) return 1; if(head < 0.28) return 2; if(head < 0.38) return 3; return 4;
  }
  function frame(dt, T, force){
    if(st.resizeHeart){ st.resizeHeart = false; heartSize(); }
    var p = RM ? P1 + 0.12 : progress();
    st.ps = (force || RM) ? p : damp(st.ps, p, 9, dt);
    var ps = st.ps, head = headAt(ps), prevHead = st.head; st.head = head;
    pulseActive = ps > P0 && ps < 1;
    // sound on each R peak the scrub passes
    if(soundOn && !RM){
      var rNow = Math.floor((head - 0.235) / RR), rPrev = Math.floor((prevHead - 0.235) / RR);
      if(head > prevHead && rNow > rPrev && head >= 0.235) lubdub();
    }
    var land = st.W / st.H > 1.1;
    var kIn = sstep(0, P0, ps), kOut = sstep(P1 - 0.02, P1 + 0.12, ps);
    st.mx = damp(st.mx, st.tmx, 3, dt); st.my = damp(st.my, st.tmy, 3, dt);
    var headX = head * 25;
    var cyc = head - Math.floor(head / RR) * RR;
    var tR = cyc - 0.235, pulseAmt = Math.exp(-tR * tR / 0.0012);
    var focal = land ? st.H * 0.95 : st.W * 1.3;
    // resolved view: a flat strip that fits the free band (left of the heart on wide screens)
    var shortLand = land && st.H < 540;
    var spanMM = shortLand ? 84 : (land ? 56 : 46), off = spanMM / 2 - 2, endX = (0.62 + RR * 1.6) * 25;
    var bw = Math.max(200, (st.bR || st.W * 0.9) - (st.bL || st.W * 0.05));
    var distR = clamp(focal * spanMM / bw, 40, 140), cxR = ((st.bL || 0) + (st.bR || st.W)) / 2 / st.W;
    for(var mi = 0; mi < MARKS.length; mi++){ var mm = MARKS[mi]; mm.bump = (force || RM) ? mm.bt : damp(mm.bump, mm.bt, 16, dt); mm.h = mm.h0 + mm.bump; }
    var anchors = ecg.draw({
      head: head, span: land ? 2.6 : 2.1, t0: -1.4,
      yaw: lerp(lerp(0.95, 0.62, kIn), 0, kOut) + st.mx * 0.05 * (1 - kOut),
      pitch: lerp(lerp(0.32, 0.2, kIn), 0.04, kOut) + st.my * 0.03 * (1 - kOut),
      dist: lerp(lerp(78, 58, kIn), distR, kOut),
      tx: lerp(headX - 12, Math.min(headX - off, endX - off), kOut), ty: 3,
      focal: focal,
      cx: lerp(land ? 0.45 : 0.5, cxR, kOut), cy: land ? lerp(shortLand ? 0.76 : 0.72, shortLand ? 0.85 : 0.8, kOut) : clamp(0.69 - (780 - st.H) / 220 * 0.05, 0.63, 0.69),
      fade: 0.4 + 0.6 * kIn, time: T, fogNear: 50, fogFar: 170, lineScale: clamp((land ? st.H : st.W * 1.4) / 900, 0.6, 1.5),
      pulse: pulseAmt, marks: MARKS
    });
    declutter(anchors);
    for(var i = 0; i < tagEls.length; i++){
      var a = anchors[i], el = tagEls[i];
      if(a && a.on && a.b && ps > P0){
        el.style.transform = 'translate(' + a.b[0].toFixed(1) + 'px,' + a.b[1].toFixed(1) + 'px) translate(-50%,-115%)';
        el.classList.add('on');
      } else el.classList.remove('on');
    }
    if(heart){
      var as = bump(cyc, .09, .14, .16, .24), vs = bump(cyc, .24, .32, .42, .56);
      if(!st.down){ st.drag += st.dragV * dt; st.dragV = damp(st.dragV, 0, 2.6, dt); }
      var yaw = st.drag + (Math.sin(T * 0.32) * 0.3 + (ps - 0.45) * 0.9) * (1 - kOut) + st.mx * 0.25;
      heart.draw({ time: T, cyc: head < 0.001 ? 0.6 : cyc, as: as, vs: vs, fade: 1, yaw: yaw, pitch: 0.06 + st.my * 0.06, zoom: 1, lift: 0, glow: 1 });
      if(!force && !RM){
        st.frames.push(dt);
        if(st.frames.length >= 30){
          var avg = 0; for(var f = 0; f < st.frames.length; f++) avg += st.frames[f]; avg /= st.frames.length; st.frames.length = 0;
          st.slow = avg > 0.024 ? (st.slow || 0) + 1 : 0;
          if((st.slow >= 2 || avg > 0.04) && st.downs < 5){ st.slow = 0; st.downs++; st.q = Math.max(0.3, st.q * (avg > 0.04 ? 0.7 : 0.8)); st.resizeHeart = true; }
        }
      }
    }
    var ci = capIndex(ps, head);
    if(ci !== st.cap){
      st.cap = ci;
      capEls.forEach(function(el, k){ el.classList.toggle('on', k === ci); el.classList.toggle('up', ci >= 0 && k < ci); });
      rail.forEach(function(li, k){ li.classList.toggle('on', k === ci); li.classList.toggle('done', ci > k); });
      railEl.classList.toggle('fin', ci === 5);
    }
    var io2 = 1 - sstep(P0 - 0.07, P0 + 0.005, ps);
    intro.style.opacity = io2.toFixed(3);
    intro.style.transform = 'translateY(' + ((1 - io2) * -30).toFixed(1) + 'px)';
    var hrS = ('00' + Math.round(beat.bpm)).slice(-3); if(hrS !== st.hrS){ st.hrS = hrS; hrEl.textContent = hrS; }
  }
  // reduced motion: one annotated frame plus the captions as a list
  function still(){
    B.classList.add('pulse-static');
    var list = document.createElement('div'); list.className = 'wrap caps-static';
    CAPS.forEach(function(c){ var d = document.createElement('div'); d.className = 'cap-s'; d.innerHTML = '<span class="cap-k"><span>' + c.k + '</span><i>' + c.d + '</i></span><p>' + c.t + '</p>'; list.appendChild(d); });
    sec.appendChild(list);
    capsEl.style.display = 'none'; $('#rail').style.display = 'none'; intro.style.display = 'none';
  }
  return { frame: frame, measure: measure, still: still, stage: stage };
})();

// Try Out CBT. Private practice exams; everything is stored on this device only.
var TRY = (function(){
  var NS = 'alpha.to.v1.';
  var LS = (function(){ try{ var s = window.localStorage, k = NS + 'probe'; s.setItem(k, '1'); s.removeItem(k); return s; }catch(e){ return null; } })();
  var MEM = {}, warned = false;
  // localStorage is the source of truth; MEM only holds values it could not take
  function get(k, d){
    var raw = MEM[k];
    if(raw === undefined){ raw = null; if(LS){ try{ raw = LS.getItem(NS + k); }catch(e){ raw = null; } } }
    if(raw == null) return d;
    try{ return JSON.parse(raw); }catch(e){ return d; }
  }
  function put(k, v){
    var raw = JSON.stringify(v);
    if(LS){ try{ LS.setItem(NS + k, raw); delete MEM[k]; return; }catch(e){ if(!warned){ warned = true; toast('Memori browser penuh. Progres terbaru belum tersimpan.'); } } }
    MEM[k] = raw;
  }
  function del(k){ delete MEM[k]; if(LS){ try{ LS.removeItem(NS + k); }catch(e){} } }

  var BANK = null, bankP = null;
  // the question bank is its own chunk; it loads when the try out first opens (or earlier, when idle)
  function loadBank(){
    if(!bankP) bankP = import('../../content/bank/bank.json').then(function(m){ bank(m.default); }, function(){ bankP = null; });
    return bankP;
  }
  function bank(src){
    if(BANK) return BANK;
    if(!src) return { v: 1, blok: {} };
    BANK = JSON.parse(JSON.stringify(src));
    Object.keys(BANK.blok).forEach(function(k){
      var b = BANK.blok[k]; b.id = k; b.by = {};
      b.q.forEach(function(q, i){ q.i = i; b.by[q.id] = q; });
    });
    return BANK;
  }
  function B(id){ return bank().blok[id] || null; }
  var BLOKS = ['b1', 'b2', 'b3'];
  var TFK = ['B', 'S'], MCK = 'ABCDE';

  // stored data
  function stats(bid){ return get('stat.' + bid, {}); }            // id -> [seen, wrong, lastOk, ts]
  function stars(bid){ return get('star.' + bid, []); }
  function hist(bid){ return get('hist.' + bid, []); }
  function sessOf(bid){
    var s = get('sess.' + bid, null), b = B(bid);
    if(!s || s.v !== 1 || !b || !s.ids) return null;
    s.ids = s.ids.filter(function(id){ return !!b.by[id]; });
    if(!s.ids.length){ del('sess.' + bid); return null; }
    s.cur = clamp(s.cur | 0, 0, s.ids.length - 1);
    return s;
  }
  function bump(st, id, ok, now){
    var r = st[id] || [0, 0, 0, 0];
    st[id] = [r[0] + 1, r[1] + (ok ? 0 : 1), ok ? 1 : 0, now];
  }
  var PREF = get('pref', null) || {};
  function pref(){
    var d = { mode: 'latihan', n: 50, tp: [], ty: 'all', pool: 'all', sq: 1, so: 1, tm: 1 };
    Object.keys(d).forEach(function(k){ if(PREF[k] === undefined) PREF[k] = d[k]; });
    return PREF;
  }
  function savePref(){ put('pref', PREF); }

  function shuffle(a){ for(var i = a.length - 1; i > 0; i--){ var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function isOk(q, a){ return a != null && q.a.indexOf(a) >= 0; }
  function fmtT(sec){
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s).slice(-2);
  }
  function fmtDur(sec){
    sec = Math.round(sec); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
    if(h) return h + ' j ' + m + ' mnt'; if(m) return m + ' mnt'; return sec + ' dtk';
  }
  function fmtScore(x){ return (Math.round(x * 10) / 10).toFixed(1).replace('.', ','); }
  var BULAN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  function fmtDate(ts){
    var d = new Date(ts);
    return d.getDate() + ' ' + BULAN[d.getMonth()] + ', ' + ('0' + d.getHours()).slice(-2) + '.' + ('0' + d.getMinutes()).slice(-2);
  }
  function plural(n, w){ return n + ' ' + w; }

  // view state
  var V = { view: 'home', bid: 'b2', rid: null, filter: 'all', open: false };
  var S = null, LAST = null, root = null, bar = null, dlgEl = null, keysOn = false;
  var WIDE = matchMedia('(min-width: 1080px)');

  function depth(){ var s = history.state; return (s && s.ch === 'tryout' && s.d) ? s.d : 0; }
  function go(view, how, extra){
    var st = { ch: 'tryout', tv: view, d: depth() };
    if(extra) Object.keys(extra).forEach(function(k){ st[k] = extra[k]; });
    if(how === 'push'){ st.d = depth() + 1; hPush(st, '#tryout'); }
    else if(how === 'replace'){ hRepl(st, '#tryout'); }
    show(view, st);
  }
  function back(){ if(depth() > 0) history.back(); else closeViaHistory(); }

  // shell
  function mountTo(c){
    V.open = true;
    panel.innerHTML =
      '<div class="p-bar to-bar"><button class="back mag" type="button" id="toBack" data-cur="balik"><b>←</b> <span id="toBackT">Kembali</span></button>' +
      '<div class="to-bar-c" id="toBarC"></div><div class="to-prog" aria-hidden="true"><svg id="toProg" preserveAspectRatio="none"><path class="pg-b"/><path class="pg-f"/></svg></div></div>' +
      '<div class="to-view" id="toView"></div>';
    root = $('#toView', panel); bar = $('#toBarC', panel);
    $('#toBack', panel).addEventListener('click', onBack);
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onRadioKey);
    var st = history.state && history.state.ch === 'tryout' ? history.state : null;
    bindKeys(true);
    if(BANK){ show(st && st.tv ? st.tv : 'home', st || {}); return; }
    root.innerHTML = '<p class="to-load lbl">Nyiapin soal\u2026</p>';
    loadBank().then(function(){
      if(!V.open || !root) return;
      if(!BANK){ root.innerHTML = '<p class="to-load lbl">Soalnya gagal dimuat. Cek koneksi, lalu buka lagi.</p>'; return; }
      var s2 = history.state && history.state.ch === 'tryout' ? history.state : null;
      show(s2 && s2.tv ? s2.tv : 'home', s2 || {});
    });
  }
  function leave(){
    if(!V.open) return;
    pauseClock(); saveSess(); closeDlg(true); navOpen(false);
    bindKeys(false); V.open = false; root = bar = null;
  }
  function onBack(){
    if(V.view === 'home') closeViaHistory(); else back();
  }

  function show(view, st){
    if(!root) return;
    st = st || {};
    closeDlg(true); navOpen(false);
    if(view !== 'run') pauseClock();
    if(view === 'setup' || view === 'run' || view === 'result' || view === 'review'){
      if(st.b && B(st.b)) V.bid = st.b;
      if(!B(V.bid)){ view = 'home'; }
    }
    if(view === 'run'){
      S = S && S.blok === V.bid ? S : sessOf(V.bid);
      if(!S){ view = 'setup'; hRepl({ ch: 'tryout', tv: 'setup', b: V.bid, d: depth() }, '#tryout'); }
    }
    var res = null;
    if(view === 'result' || view === 'review'){
      var rid = st.rid || V.rid;
      res = (LAST && LAST.id === rid) ? LAST : hist(V.bid).filter(function(r){ return r.id === rid; })[0];
      if(!res){ view = 'setup'; hRepl({ ch: 'tryout', tv: 'setup', b: V.bid, d: Math.max(0, depth() - 1) }, '#tryout'); }
      else V.rid = res.id;
    }
    V.view = view;
    panel.classList.toggle('to-running', view === 'run');
    $('#toBackT', panel).textContent = view === 'run' ? 'Keluar' : 'Kembali';
    if(view === 'home') vHome();
    else if(view === 'setup') vSetup();
    else if(view === 'run') vRun();
    else if(view === 'result') vResult(res);
    else if(view === 'review') vReview(res);
    panel.scrollTop = 0; curReset();
    if(!RM){ root.classList.remove('enter'); void root.offsetWidth; root.classList.add('enter'); }
    bindCursor(panel);
    if(view !== 'home'){ try{ root.querySelector('[data-focus]').focus({ preventScroll: true }); }catch(e){} }
  }
  function pop(st){ show(st && st.tv ? st.tv : 'home', st || {}); }

  function setBar(html){ if(bar) bar.innerHTML = html; }
  function curReset(){ try{ if(cr) cr.classList.remove('big', 'lab'); }catch(e){} }
  function progSet(p){
    var svg = $('#toProg', panel); if(!svg) return;
    var w = Math.max(320, panel.clientWidth || window.innerWidth);
    if(svg.__w !== w){
      svg.__w = w;
      var d = 'M0 7', x = 0, gap = w < 700 ? 120 : 170;
      while(x + gap * 0.55 + 46 <= w){ var b = x + gap * 0.55; d += ' H' + b + ' L' + (b + 4) + ' 5 L' + (b + 8) + ' 7 H' + (b + 13) + ' L' + (b + 15) + ' 9 L' + (b + 18) + ' 0.5 L' + (b + 21) + ' 13 L' + (b + 23) + ' 7 H' + (b + 30) + ' C' + (b + 34) + ' 7 ' + (b + 35) + ' 4.5 ' + (b + 38) + ' 4.5 S' + (b + 42) + ' 7 ' + (b + 46) + ' 7'; x += gap; }
      d += ' H' + w;
      svg.setAttribute('viewBox', '0 0 ' + w + ' 14');
      var ps = svg.querySelectorAll('path'); ps[0].setAttribute('d', d); ps[1].setAttribute('d', d);
      try{ svg.__len = ps[1].getTotalLength(); }catch(e){ svg.__len = w * 1.4; }
      ps[1].style.strokeDasharray = svg.__len + ' ' + svg.__len;
    }
    svg.querySelectorAll('path')[1].style.strokeDashoffset = (svg.__len * (1 - clamp(p, 0, 1))).toFixed(1);
  }

  function heroHtml(c){
    var ttl = c.name.split(' ').map(function(w, k){ return '<span class="w"><i style="--cd:' + (0.14 + k * 0.08) + 's">' + esc(w) + '</i></span>'; }).join(' ');
    return '<div class="p-hero"><span class="p-num" aria-hidden="true">' + c.num + '</span>' +
      '<p class="lbl p-rv" style="--pd:.05s">' + esc(c.tag) + '</p><h2 class="p-ttl">' + ttl + '</h2>' +
      '<p class="p-sub p-rv" style="--pd:.35s">' + esc(c.sub) + '</p></div>';
  }
  function blokStats(bid){
    var b = B(bid); if(!b) return null;
    var st = stats(bid), seen = 0, ok = 0;
    b.q.forEach(function(q){ var r = st[q.id]; if(r && r[0]){ seen++; if(r[2]) ok++; } });
    var h = hist(bid), best = 0; h.forEach(function(r){ if(r.score > best) best = r.score; });
    return { n: b.q.length, seen: seen, ok: ok, tries: h.length, best: h.length ? best : null, last: h[0] || null };
  }

  function resumeCard(s){
    var b = B(s.blok), done = Object.keys(s.ans).length;
    var tm = s.limit ? 'sisa ' + fmtT(s.limit - s.used) : fmtT(s.used) + ' berjalan';
    return '<div class="to-resume p-rv" style="--pd:.3s"><div><p class="lbl">Sesi belum selesai · ' + esc(b.name) + '</p>' +
      '<p class="to-rs-t">' + (s.mode === 'ujian' ? 'Simulasi CBT' : 'Latihan') + ', soal ' + (s.cur + 1) + ' dari ' + s.ids.length + '</p>' +
      '<p class="to-rs-m">' + done + ' dijawab · ' + tm + '</p></div>' +
      '<div class="to-rs-b"><button class="to-btn pri" type="button" data-act="resume" data-b="' + s.blok + '" data-cur="lanjut">Lanjutkan</button>' +
      '<button class="to-btn ghost" type="button" data-act="drop" data-b="' + s.blok + '">Hapus sesi</button></div></div>';
  }

  // home: pick a blok
  function vHome(){
    var c = BY.tryout, i = CH.indexOf(c), nx = CH[(i + 1) % CH.length];
    setBar('<span class="p-crumb">Channel ' + c.num + ' / ' + TOTAL + '</span>'); progSet(0);
    var live = BLOKS.map(sessOf).filter(Boolean)[0];
    var cards = BLOKS.map(function(bid, k){
      var b = B(bid), n = k + 1;
      if(!b) return '<button class="to-blk off" type="button" data-act="soon" data-n="' + n + '" aria-disabled="true">' +
        '<span class="to-bn" aria-hidden="true">0' + n + '</span><span class="to-bt">Blok ' + n + '</span>' +
        '<span class="to-bs">Soalnya belum masuk</span><span class="to-bx">Segera</span></button>';
      var s = blokStats(bid), pct = s.n ? Math.round(s.seen / s.n * 100) : 0;
      return '<button class="to-blk on" type="button" data-act="blok" data-b="' + bid + '" data-cur="buka">' +
        '<span class="to-bn" aria-hidden="true">0' + n + '</span><span class="to-bt">' + esc(b.name) + '</span>' +
        '<span class="to-bs">' + esc(b.title) + '</span>' +
        '<span class="to-bm">' + s.n + ' soal · ' + Object.keys(b.topics).length + ' topik · ' + esc(b.sem) + '</span>' +
        '<span class="to-bp" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' +
        '<span class="to-bq">' + (s.seen ? 'Sudah dikerjakan ' + s.seen + '/' + s.n + (s.best != null ? ' · Terbaik ' + fmtScore(s.best) : '') : 'Belum pernah dikerjakan') + '</span>' +
        '<span class="to-bgo">Buka <b>→</b></span></button>';
    }).join('');
    root.innerHTML = '<div class="p-wrap to-wrap">' + heroHtml(c) + (live ? resumeCard(live) : '') +
      '<div class="to-bloks p-rv" style="--pd:.42s">' + cards + '</div>' +
      '<p class="to-priv p-rv" style="--pd:.5s">' + (LS ? 'Nilai dan progres kamu tersimpan di browser perangkat ini saja. Nggak ada leaderboard, nggak ada yang bisa lihat.' :
        'Browser ini nggak mengizinkan penyimpanan, jadi progres hilang kalau halaman ditutup.') + '</p>' +
      '<div class="p-next p-rv" style="--pd:.55s"><span class="lbl">' + c.num + ' / ' + TOTAL + '</span>' +
      '<button class="nextb" type="button" data-act="next" data-next="' + nx.id + '" data-cur="lanjut"><span class="lbl">Channel berikutnya</span><strong>' + esc(nx.name) + ' →</strong></button></div></div>';
  }

  // setup
  function chip(act, val, on, label, extra){ return '<button class="to-chip' + (on ? ' on' : '') + '" type="button" data-act="' + act + '" data-v="' + esc(val) + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + (extra || '') + '>' + label + '</button>'; }
  function sw(act, on, label, sub){
    return '<button class="to-sw" type="button" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" data-act="' + act + '"><span class="to-sw-t">' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span><i aria-hidden="true"></i></button>';
  }
  function poolCount(bid, pool){
    var b = B(bid), st = stats(bid), sr = {}; stars(bid).forEach(function(id){ sr[id] = 1; });
    return b.q.filter(function(q){ var r = st[q.id]; if(pool === 'new') return !r || !r[0]; if(pool === 'wrong') return r && r[0] && !r[2]; if(pool === 'star') return !!sr[q.id]; return true; }).length;
  }
  function candidates(bid){
    var P = pref(), b = B(bid), st = stats(bid), sr = {}; stars(bid).forEach(function(id){ sr[id] = 1; });
    return b.q.filter(function(q){
      if(P.tp.length && P.tp.indexOf(q.tp) < 0) return false;
      if(P.ty !== 'all' && q.t !== P.ty) return false;
      var r = st[q.id];
      if(P.pool === 'new') return !r || !r[0];
      if(P.pool === 'wrong') return !!(r && r[0] && !r[2]);
      if(P.pool === 'star') return !!sr[q.id];
      return true;
    }).map(function(q){ return q.id; });
  }
  function planN(avail){ var P = pref(); return P.n === 0 ? avail : Math.min(P.n, avail); }
  function vSetup(){
    var b = B(V.bid), P = pref(), s = blokStats(V.bid), live = sessOf(V.bid), h = hist(V.bid);
    setBar('<span class="p-crumb">Try Out · ' + esc(b.name) + '</span>'); progSet(0);
    var tpCount = {}; b.q.forEach(function(q){ tpCount[q.tp] = (tpCount[q.tp] || 0) + 1; });
    var avail = candidates(V.bid).length, n = planN(avail);
    var tps = chip('tp', '*', !P.tp.length, 'Semua topik') + Object.keys(b.topics).map(function(k){
      return chip('tp', k, P.tp.indexOf(k) >= 0, esc(b.topics[k]) + ' <em>' + tpCount[k] + '</em>');
    }).join('');
    var pools = [['all', 'Semua soal'], ['new', 'Belum dikerjakan'], ['wrong', 'Masih salah'], ['star', 'Ditandai']].map(function(p){
      var c = poolCount(V.bid, p[0]); return chip('pool', p[0], P.pool === p[0], p[1] + ' <em>' + c + '</em>');
    }).join('');
    var ns = [25, 50, 100, 0].map(function(x){ return chip('n', x, P.n === x, x ? String(x) : 'Semua'); }).join('');
    var mins = Math.round(n * 60 / 60);
    var hl = '';
    if(h.length){
      var pts = h.slice(0, 12).reverse();
      var spark = '';
      if(pts.length > 1){
        var W = 240, Hh = 56, xs = pts.map(function(r, k){ return (k / (pts.length - 1)) * (W - 12) + 6; }), ys = pts.map(function(r){ return Hh - 6 - r.score / 100 * (Hh - 12); });
        spark = '<svg class="to-spark" viewBox="0 0 ' + W + ' ' + Hh + '" aria-hidden="true"><path class="to-sp-g" d="M6 ' + (Hh - 6) + ' H' + (W - 6) + '"/>' +
          '<polyline points="' + xs.map(function(x, k){ return x.toFixed(1) + ',' + ys[k].toFixed(1); }).join(' ') + '"/>' +
          xs.map(function(x, k){ return '<circle cx="' + x.toFixed(1) + '" cy="' + ys[k].toFixed(1) + '" r="' + (k === xs.length - 1 ? 3.5 : 2.2) + '"/>'; }).join('') + '</svg>';
      }
      hl = '<section class="to-sec to-hist p-rv" style="--pd:.2s"><div class="to-sec-h"><h3>Riwayat</h3><span class="lbl">' + h.length + ' percobaan</span></div>' + spark +
        '<ol class="to-hl">' + h.map(function(r){
          return '<li><button type="button" class="to-hr" data-act="hist" data-rid="' + r.id + '"><span class="to-hr-s">' + fmtScore(r.score) + '</span>' +
            '<span class="to-hr-m"><b>' + (r.mode === 'ujian' ? 'Simulasi CBT' : 'Latihan') + ' · ' + r.benar + '/' + r.n + ' benar</b><small>' + fmtDate(r.at) + ' · ' + fmtDur(r.used) + (r.label ? ' · ' + esc(r.label) : '') + '</small></span><span class="to-hr-a" aria-hidden="true">→</span></button></li>';
        }).join('') + '</ol></section>';
    }
    root.innerHTML = '<div class="p-wrap to-wrap to-setup">' +
      '<div class="to-head"><p class="lbl">' + esc(b.name) + ' · ' + esc(b.sem) + '</p><h2 class="to-h" tabindex="-1" data-focus>' + esc(b.title) + '</h2>' +
        '<div class="to-kpis"><div><b>' + s.n + '</b><span>Total soal</span></div><div><b>' + s.seen + '</b><span>Sudah dikerjakan</span></div>' +
        '<div><b>' + s.ok + '</b><span>Terakhir benar</span></div><div><b>' + (s.best != null ? fmtScore(s.best) : '-') + '</b><span>Nilai terbaik</span></div></div></div>' +
      (live ? resumeCard(live) : '') +
      '<section class="to-sec"><div class="to-sec-h"><h3>Mode</h3></div><div class="to-modes" role="radiogroup" aria-label="Mode try out">' +
        '<button class="to-mode" type="button" role="radio" aria-checked="' + (P.mode === 'latihan') + '" data-act="mode" data-v="latihan"><b>Latihan</b><span>Cek jawaban tiap soal, pembahasan langsung muncul.</span></button>' +
        '<button class="to-mode" type="button" role="radio" aria-checked="' + (P.mode === 'ujian') + '" data-act="mode" data-v="ujian"><b>Simulasi CBT</b><span>Pakai timer, jawaban dan pembahasan dibuka setelah selesai.</span></button>' +
      '</div></section>' +
      '<section class="to-sec"><div class="to-sec-h"><h3>Topik</h3></div><div class="to-chips">' + tps + '</div></section>' +
      '<section class="to-sec"><div class="to-sec-h"><h3>Jenis soal</h3></div><div class="to-chips">' +
        chip('ty', 'all', P.ty === 'all', 'Semua') + chip('ty', 'mc', P.ty === 'mc', 'Pilihan ganda') + chip('ty', 'tf', P.ty === 'tf', 'Benar / salah') + '</div></section>' +
      '<section class="to-sec"><div class="to-sec-h"><h3>Ambil dari</h3></div><div class="to-chips">' + pools + '</div></section>' +
      '<section class="to-sec"><div class="to-sec-h"><h3>Jumlah soal</h3><span class="lbl">' + avail + ' tersedia</span></div><div class="to-chips">' + ns + '</div></section>' +
      '<section class="to-sec"><div class="to-sec-h"><h3>Pengaturan</h3></div><div class="to-sws">' +
        sw('sq', P.sq, 'Acak urutan soal') + sw('so', P.so, 'Acak urutan pilihan', 'Soal dengan pilihan "semua di atas" tetap urut') +
        (P.mode === 'ujian' ? sw('tm', P.tm, 'Timer 1 menit per soal', n ? 'Total ' + fmtDur(mins * 60) + ' untuk ' + n + ' soal' : '') : '') + '</div></section>' +
      '<div class="to-go"><button class="to-start" type="button" data-act="start" data-cur="mulai"' + (n ? '' : ' disabled') + '>' +
        (n ? 'Mulai ' + (P.mode === 'ujian' ? 'simulasi' : 'latihan') + ' · ' + n + ' soal' : 'Nggak ada soal yang cocok') + ' <b aria-hidden="true">→</b></button>' +
        (n ? '' : '<p class="to-hint">Longgarkan filter topik, jenis soal, atau sumbernya.</p>') + '</div>' +
      hl +
      '<div class="to-foot-links"><button type="button" class="to-link" data-act="reset">Hapus semua data try out ' + esc(b.name) + '</button></div>' +
    '</div>';
  }

  function start(ids, mode, label){
    var b = B(V.bid), P = pref(), perm = {};
    ids = ids.slice();
    if(P.sq) shuffle(ids);
    ids.forEach(function(id){
      var q = b.by[id];
      if(P.so && q.t === 'mc' && !q.ns){ var p = q.o.map(function(x, k){ return k; }); shuffle(p); perm[id] = p; }
    });
    S = { v: 1, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), blok: V.bid, mode: mode, ids: ids, perm: perm,
      ans: {}, chk: {}, flag: {}, cur: 0, limit: (mode === 'ujian' && P.tm) ? ids.length * 60 : 0, used: 0, t0: Date.now(), label: label || '', w5: 0, w1: 0 };
    saveSess();
    if(V.view === 'setup') go('run', 'push');
    else go('run', 'replace');
  }
  function startFromSetup(){
    var P = pref(), b = B(V.bid), ids = candidates(V.bid);
    if(!ids.length) return;
    shuffle(ids);
    ids = ids.slice(0, planN(ids.length));
    ids.sort(function(x, y){ return b.by[x].i - b.by[y].i; });
    var parts = [];
    if(P.tp.length === 1) parts.push(b.topics[P.tp[0]]); else if(P.tp.length) parts.push(P.tp.length + ' topik');
    if(P.ty !== 'all') parts.push(P.ty === 'mc' ? 'pilihan ganda' : 'benar/salah');
    if(P.pool !== 'all') parts.push({ new: 'belum dikerjakan', wrong: 'masih salah', star: 'ditandai' }[P.pool]);
    var go2 = function(){ start(ids, P.mode, parts.join(', ')); };
    if(sessOf(V.bid)) confirmBox({ title: 'Ganti sesi yang belum selesai?', body: 'Sesi lama dihapus dan belum masuk riwayat.', ok: 'Mulai baru', danger: true }, function(){ del('sess.' + V.bid); S = null; go2(); });
    else go2();
  }
  function saveSess(){ if(S) put('sess.' + S.blok, S); }

  // run
  var clk = { on: false, last: 0, iv: 0, n: 0 }, paused = false;
  function startClock(){
    if(clk.on || !S || V.view !== 'run' || paused || document.hidden) return;
    clk.on = true; clk.last = performance.now(); clk.iv = setInterval(tick, 250);
  }
  function stopClock(){ clk.on = false; clearInterval(clk.iv); clk.iv = 0; }
  function pauseClock(){
    if(!clk.on) return;
    var dt = (performance.now() - clk.last) / 1000;
    stopClock();
    if(S){ if(dt > 0 && dt <= 5) S.used += dt; if(S.limit && S.used > S.limit) S.used = S.limit; saveSess(); }
  }
  function tick(){
    if(!clk.on || !S) return;
    var now = performance.now(), dt = (now - clk.last) / 1000; clk.last = now;
    if(dt > 5) dt = 0.25;
    S.used += dt; drawClock();
    if(S.limit){
      var left = S.limit - S.used;
      if(left <= 300 && !S.w5 && S.limit > 600){ S.w5 = 1; toast('Sisa waktu 5 menit.'); }
      if(left <= 60 && !S.w1 && S.limit > 120){ S.w1 = 1; toast('Sisa waktu 1 menit.'); }
      if(left <= 0){ S.used = S.limit; stopClock(); finish(true); return; }
    }
    if(++clk.n % 20 === 0) saveSess();
  }
  function drawClock(){
    var el = $('#toTm', panel); if(!el || !S) return;
    var t = S.limit ? S.limit - S.used : S.used, txt = fmtT(t);
    if(el.__t !== txt){ el.__t = txt; el.textContent = txt; }
    if(S.limit){ var left = S.limit - S.used; el.classList.toggle('warn', left <= 300 && left > 60); el.classList.toggle('crit', left <= 60); }
  }
  document.addEventListener('visibilitychange', function(){ if(document.hidden) pauseClock(); else if(V.open && V.view === 'run') startClock(); });
  window.addEventListener('pagehide', function(){ pauseClock(); saveSess(); });

  function vRun(){
    var b = B(S.blok);
    paused = false;
    setBar('<div class="to-run-h"><span class="to-cnt" id="toCnt"></span>' +
      '<span class="to-tm' + (S.limit ? '' : ' up') + '" id="toTm" aria-label="' + (S.limit ? 'Sisa waktu' : 'Waktu berjalan') + '"></span>' +
      (S.mode === 'ujian' ? '<button class="to-ib" type="button" data-act="pause" aria-label="Jeda"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg></button>' : '') +
      '<button class="to-ib to-navb" type="button" data-act="nav" aria-label="Daftar soal" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="6" height="6" rx="1.2"/><rect x="14" y="14" width="6" height="6" rx="1.2"/></svg></button></div>');
    $('#toBarC', panel).onclick = onClick;
    root.innerHTML = '<div class="to-run">' +
      '<div class="to-main"><article class="to-q" id="toQ" aria-live="off"></article>' +
        '<div class="to-foot" id="toFoot"></div>' +
        (FINE ? '<p class="to-keys" id="toKeys" aria-hidden="true"></p>' : '') +
      '</div>' +
      '<div class="to-nav" id="toNav" role="region" aria-label="Daftar soal"></div>' +
      '<div class="to-scrim" id="toScrim" data-act="navx"></div>' +
      '<div class="to-live sr" id="toLive" aria-live="polite"></div>' +
    '</div>';
    buildNav(); renderQ(false); startClock(); drawClock();
    var qEl = $('#toQ', panel), sx = 0, sy = 0, st0 = 0, sp = null;
    qEl.addEventListener('pointerdown', function(e){ if(e.pointerType !== 'touch') return; sp = e.pointerId; sx = e.clientX; sy = e.clientY; st0 = performance.now(); }, { passive: true });
    qEl.addEventListener('pointerup', function(e){
      if(e.pointerId !== sp) return; sp = null;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if(Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && performance.now() - st0 < 700){ if(dx < 0) nav(1); else nav(-1); }
    }, { passive: true });
    qEl.addEventListener('pointercancel', function(){ sp = null; });
  }
  function qOrder(id){ var q = B(S.blok).by[id]; return S.perm[id] || q.o.map(function(x, k){ return k; }); }
  function keyOf(q, d){ return q.t === 'tf' ? TFK[d] : MCK[d]; }
  function optsHtml(q, order, chosen, reveal, name){
    if(name === 'none') return '<ul class="to-opts' + (q.t === 'tf' ? ' tf' : '') + '" aria-label="Pilihan jawaban">' + order.map(function(o, d){
      var ok = q.a.indexOf(o) >= 0, pick = chosen === o, cls = 'to-o' + (ok ? ' ok' : pick ? ' no' : ' dim');
      var sr = ok && pick ? ' (jawabanmu, benar)' : ok ? ' (jawaban benar)' : pick ? ' (jawabanmu)' : '';
      return '<li class="' + cls + '"><span class="to-k" aria-hidden="true">' + keyOf(q, d) + '</span><span class="to-ot">' + esc(q.o[o]) + '<span class="sr">' + sr + '</span></span>' +
        (ok ? '<span class="to-mk" aria-hidden="true">✓</span>' : pick ? '<span class="to-mk" aria-hidden="true">✕</span>' : '') + '</li>';
    }).join('') + '</ul>';
    return '<div class="to-opts' + (q.t === 'tf' ? ' tf' : '') + '" role="radiogroup" aria-label="Pilihan jawaban">' + order.map(function(o, d){
      var cls = 'to-o', pick = chosen === o, mark = '';
      if(pick) cls += ' pick';
      if(reveal){ if(q.a.indexOf(o) >= 0){ cls += ' ok'; mark = '✓'; } else if(pick){ cls += ' no'; mark = '✕'; } else cls += ' dim'; }
      return '<button class="' + cls + '" type="button" role="radio" aria-checked="' + (pick ? 'true' : 'false') + '"' + (reveal ? ' aria-disabled="true"' : '') +
        ' tabindex="' + ((pick || (chosen == null && d === 0)) ? '0' : '-1') + '" data-act="' + (name || 'pick') + '" data-o="' + o + '">' +
        '<span class="to-k" aria-hidden="true">' + keyOf(q, d) + '</span><span class="to-ot">' + esc(q.o[o]) + '</span>' + (mark ? '<span class="to-mk" aria-hidden="true">' + mark + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function fbHtml(q, order, chosen, blank){
    var ok = isOk(q, chosen), keys = q.a.map(function(o){ var d = order.indexOf(o); return (q.t === 'tf' ? '' : keyOf(q, d) + '. ') + esc(q.o[o]); });
    var v = blank ? '<b>Kosong.</b> ' : (ok ? '<b>Benar.</b> ' : '<b>Belum tepat.</b> ');
    return '<div class="to-fb ' + (ok ? 'ok' : 'no') + '"><p class="to-vd">' + v + (q.a.length > 1 ? 'Jawaban yang diterima: ' : 'Jawaban: ') + keys.join(' / ') + '</p>' +
      '<p class="to-ex">' + esc(q.e) + '</p>' + (q.n ? '<p class="to-nt"><span>Catatan</span>' + esc(q.n) + '</p>' : '') + '</div>';
  }
  function renderQ(focus){
    var b = B(S.blok), i = S.cur, id = S.ids[i], q = b.by[id], order = qOrder(id), a = S.ans[id];
    var chk = S.mode === 'latihan' && !!S.chk[id], st = stars(S.blok), starred = st.indexOf(id) >= 0;
    var qEl = $('#toQ', panel);
    qEl.innerHTML = '<div class="to-qm"><span class="to-tag">' + esc(b.topics[q.tp]) + '</span><span class="to-tag dim">' + (q.t === 'tf' ? 'Benar / salah' : 'Pilihan ganda') + '</span>' +
      '<span class="to-qa"><button class="to-ib sm' + (S.flag[id] ? ' on-f' : '') + '" type="button" data-act="flag" aria-pressed="' + (!!S.flag[id]) + '" title="Tandai ragu-ragu (F)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4M6 4h10l-2 4 2 4H6"/></svg><span>Ragu</span></button>' +
      '<button class="to-ib sm' + (starred ? ' on-s' : '') + '" type="button" data-act="star" aria-pressed="' + starred + '" title="Simpan ke daftar ditandai"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg><span>Simpan</span></button></span></div>' +
      '<p class="lbl to-no">Soal ' + (i + 1) + ' dari ' + S.ids.length + '</p>' +
      '<h3 class="to-qt" id="toQt" tabindex="-1" data-focus>' + esc(q.q) + '</h3>' +
      optsHtml(q, order, a, chk) +
      '<div class="to-fbw" id="toFb">' + (chk ? fbHtml(q, order, a, false) : '') + '</div>' +
      '<div class="to-pause" id="toPause" hidden><p class="lbl">Dijeda</p><p class="to-pz-t">Waktu berhenti. Soal disembunyikan sampai kamu lanjut.</p><button class="to-btn pri" type="button" data-act="unpause">Lanjutkan</button></div>';
    $('#toCnt', panel).innerHTML = (i + 1) + '<small>/' + S.ids.length + '</small>';
    progSet(Object.keys(S.ans).length / S.ids.length);
    renderFoot(); navSync();
    var kh = $('#toKeys', panel); if(kh) kh.innerHTML = (q.t === 'tf' ? '<kbd>B</kbd> / <kbd>S</kbd> pilih' : '<kbd>A</kbd>-<kbd>E</kbd> pilih') + ' · <kbd>Enter</kbd> ' + (S.mode === 'latihan' ? 'cek / lanjut' : 'lanjut') + ' · <kbd>←</kbd> <kbd>→</kbd> pindah soal · <kbd>F</kbd> ragu-ragu';
    if(focus){ try{ $('#toQt', panel).focus({ preventScroll: true }); }catch(e){} }
    curReset(); bindCursor(panel);
  }
  function renderFoot(){
    var id = S.ids[S.cur], chk = S.mode === 'latihan' && !!S.chk[id], a = S.ans[id], last = S.cur === S.ids.length - 1, main;
    if(S.mode === 'latihan' && !chk) main = '<button class="to-btn pri" type="button" data-act="check"' + (a == null ? ' disabled' : '') + '>Cek jawaban</button>';
    else if(last) main = '<button class="to-btn pri" type="button" data-act="finish" data-cur="selesai">Selesai</button>';
    else main = '<button class="to-btn pri" type="button" data-act="next">Soal berikutnya <b aria-hidden="true">→</b></button>';
    $('#toFoot', panel).innerHTML = '<button class="to-btn ghost" type="button" data-act="prev"' + (S.cur ? '' : ' disabled') + ' aria-label="Soal sebelumnya"><b aria-hidden="true">←</b><span> Sebelumnya</span></button>' +
      (S.mode === 'latihan' && !chk && !last ? '<button class="to-btn ghost skip" type="button" data-act="next">Lewati</button>' : '') + main;
  }
  function buildNav(){
    var b = B(S.blok), el = $('#toNav', panel);
    el.innerHTML = '<div class="to-nav-h"><p class="lbl">Daftar soal</p><button class="to-ib sm to-navx" type="button" data-act="navx" aria-label="Tutup daftar soal"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<p class="to-nav-s" id="toNavS"></p>' +
      '<div class="to-grid" id="toGrid">' + S.ids.map(function(id, k){ return '<button class="to-gi" type="button" data-act="jump" data-i="' + k + '">' + (k + 1) + '</button>'; }).join('') + '</div>' +
      '<div class="to-legend" aria-hidden="true"><span><i class="lg a"></i>Dijawab</span><span><i class="lg f"></i>Ragu</span>' + (S.mode === 'latihan' ? '<span><i class="lg ok"></i>Benar</span><span><i class="lg no"></i>Salah</span>' : '') + '</div>' +
      '<button class="to-btn pri wide" type="button" data-act="finish" data-cur="selesai">Selesai &amp; lihat nilai</button>';
  }
  function navSync(){
    var b = B(S.blok), g = $('#toGrid', panel); if(!g) return;
    var btns = g.children, na = 0, nf = 0;
    for(var k = 0; k < btns.length; k++){
      var id = S.ids[k], a = S.ans[id], f = !!S.flag[id], chk = S.mode === 'latihan' && S.chk[id], q = b.by[id];
      var c = 'to-gi' + (a != null ? ' a' : '') + (f ? ' f' : '') + (k === S.cur ? ' c' : '') + (chk ? (isOk(q, a) ? ' ok' : ' no') : '');
      if(btns[k].className !== c) btns[k].className = c;
      var lab = 'Soal ' + (k + 1) + (a != null ? ', dijawab' : ', kosong') + (f ? ', ragu-ragu' : '') + (chk ? (isOk(q, a) ? ', benar' : ', salah') : '');
      if(btns[k].getAttribute('aria-label') !== lab) btns[k].setAttribute('aria-label', lab);
      if(k === S.cur) btns[k].setAttribute('aria-current', 'true'); else btns[k].removeAttribute('aria-current');
      if(a != null) na++; if(f) nf++;
    }
    var s = $('#toNavS', panel); if(s) s.textContent = na + ' dijawab · ' + nf + ' ragu · ' + (S.ids.length - na) + ' kosong';
  }
  var navIsOpen = false, navReturn = null;
  function navOpen(on){
    var el = root && $('#toNav', panel);
    if(!el){ navIsOpen = false; return; }
    if(on && WIDE.matches){ var cur = $('#toGrid .c', panel); if(cur) cur.focus(); return; }
    if(on === navIsOpen) return;
    navIsOpen = on;
    el.classList.toggle('open', on); $('#toScrim', panel).classList.toggle('on', on);
    if(!el.__trap){ el.__trap = 1; el.addEventListener('keydown', function(e){
      if(e.key !== 'Tab' || !navIsOpen) return;
      var f = $$('button', el).filter(function(x){ return x.offsetParent !== null; }), i = f.indexOf(document.activeElement);
      if(e.shiftKey && i <= 0){ e.preventDefault(); f[f.length - 1].focus(); } else if(!e.shiftKey && i === f.length - 1){ e.preventDefault(); f[0].focus(); }
    }); }
    if(on){
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
      navReturn = document.activeElement;
      var c = $('#toGrid .c', panel); if(c){ try{ c.scrollIntoView({ block: 'center' }); }catch(e){} }
      setTimeout(function(){ var f = $('#toGrid .c', panel) || $('.to-navx', panel); if(f) f.focus({ preventScroll: true }); }, 30);
    } else {
      el.setAttribute('role', 'region'); el.removeAttribute('aria-modal');
      if(navReturn && navReturn.focus && document.contains(navReturn)){ try{ navReturn.focus({ preventScroll: true }); }catch(e){} }
    }
  }
  function nav(dir){ jump(S.cur + dir); }
  function jump(k){
    if(!S || k < 0 || k >= S.ids.length || k === S.cur) return;
    S.cur = k; saveSess(); renderQ(true);
    var q = $('#toQ', panel), top = q.getBoundingClientRect().top;
    if(top < 60 || top > window.innerHeight * 0.4) panel.scrollTop = 0;
  }
  function pick(o){
    var id = S.ids[S.cur];
    if(S.mode === 'latihan' && S.chk[id]) return;
    S.ans[id] = o; saveSess();
    var btns = $$('.to-o', panel);
    btns.forEach(function(bn){ var on = +bn.getAttribute('data-o') === o; bn.classList.toggle('pick', on); bn.setAttribute('aria-checked', on ? 'true' : 'false'); bn.tabIndex = on ? 0 : -1; });
    progSet(Object.keys(S.ans).length / S.ids.length);
    renderFoot(); navSync();
  }
  function check(){
    var b = B(S.blok), id = S.ids[S.cur], q = b.by[id], a = S.ans[id];
    if(S.mode !== 'latihan' || a == null || S.chk[id]) return;
    S.chk[id] = 1; saveSess();
    var st = stats(S.blok), ok = isOk(q, a); bump(st, id, ok, Date.now()); put('stat.' + S.blok, st);
    var order = qOrder(id), focusWas = document.activeElement;
    $('.to-opts', panel).outerHTML = optsHtml(q, order, a, true);
    $('#toFb', panel).innerHTML = fbHtml(q, order, a, false);
    $('#toLive', panel).textContent = (ok ? 'Benar.' : 'Belum tepat.') + ' Jawaban: ' + q.a.map(function(o){ return q.o[o]; }).join(' / ') + '. ' + q.e;
    renderFoot(); navSync();
    if(soundOn && AC){ try{ var t = AC.currentTime + 0.01; if(ok){ tone(t, 660, 990, 0.12, 0.05, 'sine'); tone(t + 0.1, 990, 990, 0.1, 0.035, 'sine'); } else tone(t, 220, 150, 0.22, 0.06, 'triangle'); }catch(e){} }
    var nb = $('#toFoot .pri', panel); if(nb && focusWas && focusWas.closest && focusWas.closest('#toFoot, .to-opts')) nb.focus({ preventScroll: true });
    var fb = $('#toFb', panel), r = fb.getBoundingClientRect(), foot = $('#toFoot', panel).getBoundingClientRect();
    if(r.bottom > foot.top - 8){ var d = Math.min(r.bottom - foot.top + 24, r.top - 120); if(d > 0) panel.scrollBy({ top: d, behavior: RM ? 'auto' : 'smooth' }); }
  }
  function flag(){ var id = S.ids[S.cur]; if(S.flag[id]) delete S.flag[id]; else S.flag[id] = 1; saveSess(); var btn = $('[data-act="flag"]', panel); if(btn){ btn.classList.toggle('on-f', !!S.flag[id]); btn.setAttribute('aria-pressed', !!S.flag[id]); } navSync(); }
  function starToggle(bid, id, btn){
    var st = stars(bid), k = st.indexOf(id);
    if(k >= 0) st.splice(k, 1); else st.push(id);
    put('star.' + bid, st);
    if(btn){ btn.classList.toggle('on-s', k < 0); btn.setAttribute('aria-pressed', k < 0 ? 'true' : 'false'); }
    toast(k < 0 ? 'Disimpan ke daftar "Ditandai".' : 'Dihapus dari daftar "Ditandai".');
  }
  function setPause(on){
    if(!S || S.mode !== 'ujian') return;
    paused = on; var p = $('#toPause', panel); if(p) p.hidden = !on;
    $('#toQ', panel).classList.toggle('paused', on);
    if(on){ pauseClock(); var u = $('#toPause .to-btn', panel); if(u) u.focus(); } else { startClock(); }
  }
  function askFinish(){
    var na = Object.keys(S.ans).length, blank = S.ids.length - na, nf = Object.keys(S.flag).length;
    var body = blank ? blank + ' soal masih kosong' + (nf ? ' dan ' + nf + ' ditandai ragu' : '') + '. Soal kosong dihitung salah.' :
      (nf ? nf + ' soal masih ditandai ragu. ' : 'Semua soal sudah dijawab. ') + 'Nilai langsung dihitung setelah ini.';
    navOpen(false);
    confirmBox({ title: 'Selesaikan try out?', body: body, ok: 'Selesai & lihat nilai', cancel: 'Cek lagi' }, function(){ finish(false); });
  }
  function finish(auto){
    if(!S) return;
    pauseClock(); closeDlg(true); navOpen(false);
    var b = B(S.blok), r = { benar: 0, salah: 0, kosong: 0, byTp: {} }, st = stats(S.blok), now = Date.now();
    S.ids.forEach(function(id){
      var q = b.by[id], a = S.ans[id], t = r.byTp[q.tp] || (r.byTp[q.tp] = [0, 0]); t[1]++;
      if(a == null) r.kosong++; else if(isOk(q, a)){ r.benar++; t[0]++; } else r.salah++;
      if(S.mode === 'latihan'){ if(!S.chk[id] && a != null) bump(st, id, isOk(q, a), now); }
      else bump(st, id, isOk(q, a), now);
    });
    put('stat.' + S.blok, st);
    var res = { id: S.id, blok: S.blok, mode: S.mode, at: now, n: S.ids.length, benar: r.benar, salah: r.salah, kosong: r.kosong,
      score: Math.round(r.benar / S.ids.length * 1000) / 10, used: Math.round(S.used), limit: S.limit, byTp: r.byTp,
      ids: S.ids, perm: S.perm, ans: S.ans, flag: S.flag, label: S.label, auto: !!auto };
    var h = hist(S.blok); h.unshift(res); if(h.length > 25) h.length = 25; put('hist.' + S.blok, h);
    del('sess.' + S.blok); S = null; LAST = res;
    if(auto) toast('Waktu habis. Jawaban dikumpulkan otomatis.');
    go('result', 'replace', { rid: res.id, b: res.blok });
  }

  // result
  function ecgPath(w, h, beats){
    var d = '', n = 220;
    for(var k = 0; k <= n; k++){
      var x = k / n * w, t = (k / n) * beats * RR - 0.12, tt = t - Math.floor(t / RR) * RR;
      var y = h * 0.62 - ecgV(tt) * h * 0.46;
      d += (k ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  }
  function vResult(res){
    var b = B(res.blok);
    setBar('<span class="p-crumb">Hasil · ' + esc(b.name) + '</span>'); progSet(1);
    var h = hist(res.blok), prev = h.filter(function(r){ return r.id !== res.id; })[0];
    var delta = prev ? res.score - prev.score : null;
    var tps = Object.keys(b.topics).filter(function(k){ return res.byTp[k]; }).map(function(k){
      var t = res.byTp[k], p = Math.round(t[0] / t[1] * 100);
      return '<li><span class="to-tp-n">' + esc(b.topics[k]) + '</span><span class="to-tp-b" aria-hidden="true"><i style="--w:' + p + '%"></i></span><span class="to-tp-v">' + t[0] + '/' + t[1] + '</span></li>';
    }).join('');
    var wrong = res.salah + res.kosong;
    root.innerHTML = '<div class="p-wrap to-wrap to-result">' +
      '<p class="lbl">' + (res.mode === 'ujian' ? 'Simulasi CBT' : 'Latihan') + ' · ' + esc(b.name) + (res.label ? ' · ' + esc(res.label) : '') + '</p>' +
      '<div class="to-mon"><svg class="to-mon-ecg" viewBox="0 0 600 90" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="' + ecgPath(600, 90, 3.2) + '"/></svg>' +
        '<div class="to-mon-r"><span class="lbl">Nilai</span><b class="to-score" id="toScore" tabindex="-1" data-focus data-v="' + res.score + '">' + fmtScore(res.score) + '</b>' +
        '<span class="to-mon-s">' + res.benar + ' benar dari ' + res.n + ' soal' + (delta != null ? ' · <em class="' + (delta >= 0 ? 'up' : 'down') + '">' + (delta >= 0 ? '+' : '') + fmtScore(delta) + ' dari sebelumnya</em>' : '') + '</span></div></div>' +
      '<div class="to-kpis four"><div><b>' + res.benar + '</b><span>Benar</span></div><div><b>' + res.salah + '</b><span>Salah</span></div><div><b>' + res.kosong + '</b><span>Kosong</span></div><div><b>' + fmtT(res.used) + '</b><span>' + (res.limit ? 'dari ' + fmtT(res.limit) : 'Waktu') + '</span></div></div>' +
      '<div class="to-acts"><button class="to-btn pri" type="button" data-act="review" data-cur="bahas">Bahas jawaban</button>' +
        (wrong ? '<button class="to-btn line" type="button" data-act="redo">Latihan ulang ' + wrong + ' soal yang salah</button>' : '') +
        '<button class="to-btn ghost" type="button" data-act="again">Try out baru</button></div>' +
      '<section class="to-sec"><div class="to-sec-h"><h3>Per topik</h3></div><ul class="to-tp">' + tps + '</ul></section>' +
    '</div>';
    if(!RM){
      var el = $('#toScore', panel), target = res.score, t0 = performance.now();
      el.textContent = '0,0';
      (function run(now){ var k = clamp((now - t0) / 1100, 0, 1), e = 1 - Math.pow(1 - k, 3); el.textContent = fmtScore(target * e); if(k < 1 && document.contains(el)) requestAnimationFrame(run); })(t0);
      if(soundOn && AC){ try{ lubdub(); }catch(e){} }
    }
  }

  // review
  function vReview(res){
    var b = B(res.blok), f = V.filter || 'all', sr = {}; stars(res.blok).forEach(function(id){ sr[id] = 1; });
    setBar('<span class="p-crumb">Pembahasan · ' + esc(b.name) + '</span>'); progSet(1);
    var counts = { all: 0, no: 0, blank: 0, flag: 0, ok: 0 };
    var items = res.ids.map(function(id, k){
      var q = b.by[id]; if(!q) return null;
      var a = res.ans[id], ok = isOk(q, a), blank = a == null, fl = !!(res.flag && res.flag[id]);
      counts.all++; if(blank) counts.blank++; else if(ok) counts.ok++; else counts.no++; if(fl) counts.flag++;
      return { id: id, k: k, q: q, a: a, ok: ok, blank: blank, fl: fl };
    }).filter(Boolean);
    var show2 = items.filter(function(x){ return f === 'all' || (f === 'no' && !x.ok && !x.blank) || (f === 'blank' && x.blank) || (f === 'flag' && x.fl) || (f === 'ok' && x.ok); });
    var fl = [['all', 'Semua'], ['no', 'Salah'], ['blank', 'Kosong'], ['flag', 'Ragu'], ['ok', 'Benar']].map(function(p){ return chip('rf', p[0], f === p[0], p[1] + ' <em>' + counts[p[0]] + '</em>'); }).join('');
    root.innerHTML = '<div class="p-wrap to-wrap to-review"><div class="to-head"><p class="lbl">' + fmtDate(res.at) + ' · ' + (res.mode === 'ujian' ? 'Simulasi CBT' : 'Latihan') + '</p>' +
      '<h2 class="to-h" tabindex="-1" data-focus>Pembahasan</h2><p class="to-rv-s">Nilai ' + fmtScore(res.score) + ' · ' + res.benar + '/' + res.n + ' benar</p></div>' +
      '<div class="to-chips to-rf">' + fl + '</div>' +
      (show2.length ? '<ol class="to-rl">' + show2.map(function(x){
        var order = (res.perm && res.perm[x.id]) || x.q.o.map(function(o, k){ return k; });
        return '<li class="to-rc ' + (x.blank ? 'blank' : x.ok ? 'ok' : 'no') + '"><div class="to-qm"><span class="to-tag">' + (x.k + 1) + '</span><span class="to-tag">' + esc(b.topics[x.q.tp]) + '</span>' +
          (x.fl ? '<span class="to-tag amb">Ragu</span>' : '') + '<span class="to-qa"><button class="to-ib sm' + (sr[x.id] ? ' on-s' : '') + '" type="button" data-act="rstar" data-id="' + x.id + '" aria-pressed="' + !!sr[x.id] + '" aria-label="Simpan soal ' + (x.k + 1) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg></button></span></div>' +
          '<p class="to-qt sm">' + esc(x.q.q) + '</p>' + optsHtml(x.q, order, x.a, true, 'none') + fbHtml(x.q, order, x.a, x.blank) + '</li>';
      }).join('') + '</ol>' : '<p class="to-empty">Nggak ada soal di kategori ini.</p>') +
      '<div class="to-acts"><button class="to-btn ghost" type="button" data-act="rback">← Kembali</button></div>' +
    '</div>';
  }

  // dialogs
  var dlgReturn = null;
  function confirmBox(o, onOk){
    closeDlg(true);
    dlgReturn = document.activeElement;
    dlgEl = document.createElement('div'); dlgEl.className = 'to-dlg';
    dlgEl.innerHTML = '<div class="to-dlg-s" data-dx="1"></div><div class="to-dlg-b" role="alertdialog" aria-modal="true" aria-labelledby="toDlgT" aria-describedby="toDlgD">' +
      '<h3 id="toDlgT">' + esc(o.title) + '</h3><p id="toDlgD">' + esc(o.body) + '</p><div class="to-dlg-a">' +
      '<button class="to-btn ghost" type="button" data-dx="1">' + esc(o.cancel || 'Batal') + '</button>' +
      '<button class="to-btn ' + (o.danger ? 'danger' : 'pri') + '" type="button" data-dok="1">' + esc(o.ok) + '</button></div></div>';
    panel.appendChild(dlgEl);
    dlgEl.addEventListener('click', function(e){
      if(e.target.closest('[data-dok]')){ closeDlg(); onOk(); }
      else if(e.target.closest('[data-dx]')) closeDlg();
    });
    dlgEl.addEventListener('keydown', function(e){
      if(e.key !== 'Tab') return;
      var f = $$('button', dlgEl), i = f.indexOf(document.activeElement);
      if(e.shiftKey && i <= 0){ e.preventDefault(); f[f.length - 1].focus(); } else if(!e.shiftKey && i === f.length - 1){ e.preventDefault(); f[0].focus(); }
    });
    requestAnimationFrame(function(){ if(dlgEl){ dlgEl.classList.add('on'); var ok = $('[data-dok]', dlgEl); if(ok) ok.focus(); } });
    bindCursor(dlgEl);
  }
  function closeDlg(silent){
    if(!dlgEl) return;
    var el = dlgEl; dlgEl = null; el.parentNode && el.parentNode.removeChild(el);
    if(!silent && dlgReturn && document.contains(dlgReturn)){ try{ dlgReturn.focus({ preventScroll: true }); }catch(e){} }
  }

  // events
  function onClick(e){
    var t = e.target.closest('[data-act]'); if(!t) return;
    var act = t.getAttribute('data-act'), P = pref();
    if(t.getAttribute('aria-disabled') === 'true' && act !== 'soon') return;
    switch(act){
      case 'soon': toast('Soal Blok ' + t.getAttribute('data-n') + ' belum masuk. Nanti muncul di sini.'); break;
      case 'blok': go('setup', 'push', { b: t.getAttribute('data-b') }); break;
      case 'next':
        if(t.hasAttribute('data-next')){ if(busy) return; var nid = t.getAttribute('data-next'); hRepl({ ch: nid }, '#' + nid); sweep(1, function(){ mount(BY[nid]); }); }
        else nav(1);
        break;
      case 'resume':
        V.bid = t.getAttribute('data-b'); S = sessOf(V.bid);
        if(V.view === 'home'){ go('setup', 'push', { b: V.bid }); }
        go('run', 'push', { b: V.bid });
        break;
      case 'drop':
        var bid = t.getAttribute('data-b');
        confirmBox({ title: 'Hapus sesi ini?', body: 'Jawaban di sesi ini hilang dan tidak masuk riwayat.', ok: 'Hapus', danger: true }, function(){ del('sess.' + bid); if(S && S.blok === bid) S = null; show(V.view, history.state || {}); });
        break;
      case 'mode': P.mode = t.getAttribute('data-v'); savePref(); keepScroll(vSetup); break;
      case 'tp':
        var v = t.getAttribute('data-v');
        if(v === '*') P.tp = []; else { var k = P.tp.indexOf(v); if(k >= 0) P.tp.splice(k, 1); else P.tp.push(v); if(P.tp.length === Object.keys(B(V.bid).topics).length) P.tp = []; }
        savePref(); keepScroll(vSetup); break;
      case 'ty': P.ty = t.getAttribute('data-v'); savePref(); keepScroll(vSetup); break;
      case 'pool': P.pool = t.getAttribute('data-v'); savePref(); keepScroll(vSetup); break;
      case 'n': P.n = +t.getAttribute('data-v'); savePref(); keepScroll(vSetup); break;
      case 'sq': case 'so': case 'tm': P[act] = P[act] ? 0 : 1; savePref(); keepScroll(vSetup); break;
      case 'start': startFromSetup(); break;
      case 'hist': V.filter = 'all'; go('review', 'push', { rid: t.getAttribute('data-rid'), b: V.bid }); break;
      case 'reset':
        confirmBox({ title: 'Hapus semua data try out?', body: 'Riwayat, nilai, soal yang ditandai, dan sesi yang belum selesai untuk ' + B(V.bid).name + ' dihapus dari perangkat ini.', ok: 'Hapus semua', danger: true }, function(){
          ['sess.', 'hist.', 'stat.', 'star.'].forEach(function(p){ del(p + V.bid); }); S = null; LAST = null; vSetup(); bindCursor(panel); toast('Data try out dihapus.');
        });
        break;
      case 'pick': pick(+t.getAttribute('data-o')); break;
      case 'check': check(); break;
      case 'prev': nav(-1); break;
      case 'flag': flag(); break;
      case 'star': starToggle(S.blok, S.ids[S.cur], t); break;
      case 'rstar': starToggle(V.bid, t.getAttribute('data-id'), t); break;
      case 'nav': navOpen(!navIsOpen); break;
      case 'navx': navOpen(false); break;
      case 'jump': navOpen(false); jump(+t.getAttribute('data-i')); break;
      case 'finish': askFinish(); break;
      case 'pause': setPause(true); break;
      case 'unpause': setPause(false); break;
      case 'review': var rr = findRes(); V.filter = rr && rr.salah ? 'no' : (rr && rr.kosong ? 'blank' : 'all'); go('review', 'push', { rid: V.rid, b: V.bid }); break;
      case 'rf': V.filter = t.getAttribute('data-v'); keepScroll(function(){ vReview(findRes()); }, true); break;
      case 'rback': back(); break;
      case 'again': back(); break;
      case 'redo':
        var r = findRes(), bb = B(r.blok); if(!r) return;
        var ids = r.ids.filter(function(id){ var q = bb.by[id]; return q && !isOk(q, r.ans[id]); });
        ids.sort(function(x, y){ return bb.by[x].i - bb.by[y].i; });
        V.bid = r.blok; start(ids, 'latihan', 'ulang yang salah');
        break;
    }
  }
  function findRes(){ return (LAST && LAST.id === V.rid) ? LAST : hist(V.bid).filter(function(r){ return r.id === V.rid; })[0]; }
  function keepScroll(fn, top){
    var y = panel.scrollTop, a = document.activeElement, sel = a && a.getAttribute && a.getAttribute('data-act') ? '[data-act="' + a.getAttribute('data-act') + '"][data-v="' + (a.getAttribute('data-v') || '') + '"]' : null;
    fn(); bindCursor(panel);
    panel.scrollTop = top ? Math.min(y, (root.querySelector('.to-rf') || root).offsetTop) : y;
    if(sel){ var n = root.querySelector(sel) || root.querySelector('[data-act="' + a.getAttribute('data-act') + '"]'); if(n){ try{ n.focus({ preventScroll: true }); }catch(e){} } }
  }
  function onRadioKey(e){
    var o = e.target.closest && e.target.closest('.to-o'); if(!o || V.view !== 'run') return;
    if(e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var list = $$('.to-o', o.parentNode), i = list.indexOf(o), n = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
    e.preventDefault(); n.focus(); if(!n.classList.contains('ok') && !n.classList.contains('no') && !n.classList.contains('dim')) pick(+n.getAttribute('data-o'));
  }
  function onKey(e){
    if(!V.open || V.view !== 'run' || !S || dlgEl || e.ctrlKey || e.metaKey || e.altKey) return;
    var tg = e.target; if(tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
    if(paused){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); setPause(false); } return; }
    var q = B(S.blok).by[S.ids[S.cur]], order = qOrder(S.ids[S.cur]), k = e.key, d = -1;
    if(q.t === 'tf'){ if(k === '1' || k === 'b' || k === 'B') d = 0; else if(k === '2' || k === 's' || k === 'S') d = 1; }
    else { var n = '12345'.indexOf(k); if(n < 0) n = 'abcde'.indexOf(k.toLowerCase()); if(k.length === 1 && n >= 0 && n < order.length) d = n; }
    if(d >= 0 && !navIsOpen){ e.preventDefault(); pick(order[d]); var bt = $$('.to-o', panel)[d]; if(bt) bt.focus({ preventScroll: true }); return; }
    if(k === 'ArrowRight' || k === 'j'){ if(!navIsOpen){ e.preventDefault(); nav(1); } return; }
    if(k === 'ArrowLeft' || k === 'k'){ if(!navIsOpen){ e.preventDefault(); nav(-1); } return; }
    if((k === 'f' || k === 'F') && !navIsOpen){ e.preventDefault(); flag(); return; }
    if(k === 'Enter' && !navIsOpen){
      var ae = document.activeElement;
      if(ae && ae.tagName === 'BUTTON' && !ae.classList.contains('to-o') && !ae.classList.contains('to-qt')) return;
      e.preventDefault();
      var id = S.ids[S.cur];
      if(S.mode === 'latihan' && !S.chk[id]){ if(S.ans[id] != null) check(); }
      else if(S.cur < S.ids.length - 1) nav(1); else askFinish();
    }
  }
  function bindKeys(on){
    if(on && !keysOn){ window.addEventListener('keydown', onKey); keysOn = true; }
    else if(!on && keysOn){ window.removeEventListener('keydown', onKey); keysOn = false; }
  }
  function esc2(){
    if(dlgEl){ closeDlg(); return true; }
    if(navIsOpen){ navOpen(false); return true; }
    if(paused && V.view === 'run'){ setPause(false); return true; }
    if(V.view !== 'home'){ back(); return true; }
    return false;
  }
  var onWide = function(){ if(navIsOpen) navOpen(false); };
  if(WIDE.addEventListener) WIDE.addEventListener('change', onWide); else if(WIDE.addListener) WIDE.addListener(onWide);

  return { preload: loadBank, mount: mountTo, leave: leave, pop: pop, esc: esc2, depth: depth, isOpen: function(){ return V.open; }, count: function(){ var b = B('b2'); return b ? b.q.length : 0; } };
})();


// channel list interactions
var peekOn = false, peekI = -1, pk = { x: 0, y: 0, tx: 0, ty: 0, r: 0, s: 0.6 };
if(FINE && !RM){
  rowsEl.addEventListener('pointerover', function(e){
    var b = e.target.closest('.row-b'); if(!b) return;
    var i = +b.getAttribute('data-i');
    if(i !== peekI){ peekI = i; peekIn.style.transform = 'translateY(' + (-i * 270) + 'px)'; }
    if(!peekOn){ peekOn = true; peek.classList.add('on'); }
  });
  rowsEl.addEventListener('pointerleave', function(){ peekOn = false; peek.classList.remove('on'); });
  window.addEventListener('pointermove', function(e){ pk.tx = e.clientX; pk.ty = e.clientY; }, {passive: true});
}
function peekFrame(dt){
  if(!FINE || RM) return;
  var ox = pk.x; pk.x = damp(pk.x, pk.tx + 150, 9, dt); pk.y = damp(pk.y, pk.ty, 9, dt);
  pk.r = damp(pk.r, clamp((pk.x - ox) * 0.6, -12, 12), 8, dt);
  pk.s = damp(pk.s, peekOn ? 1 : 0.6, 10, dt); var sc = pk.s.toFixed(3);
  peek.style.transform = 'translate(' + pk.x.toFixed(1) + 'px,' + pk.y.toFixed(1) + 'px) translate(-50%,-50%) rotate(' + pk.r.toFixed(2) + 'deg) scale(' + sc + ')';
}
rowsEl.addEventListener('click', function(e){
  var b = e.target.closest('.row-b'); if(!b) return;
  b.classList.add('tap'); setTimeout(function(){ b.classList.remove('tap'); }, 900);
  goChannel(b.getAttribute('data-id'), true);
});

// curtain (right to left in, left to right out)
var curtain = $('#curtain'), cs = $$('#curtain > i'), busy = false;
function setX(x, snap){
  if(snap) curtain.classList.remove('move');
  cs.forEach(function(el){ el.style.transform = 'translateX(' + x + ')'; });
  if(snap) void curtain.offsetWidth;
}
function sweep(dir, mid, done){
  busy = true;
  // without the animation, let a pending history.back() land before reconciling
  if(RM){ mid(); busy = false; if(done) done(); setTimeout(sync, 120); return; }
  swish();
  setX(dir > 0 ? '103%' : '-103%', true);
  curtain.classList.add('move');
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ setX('0%'); }); });
  setTimeout(function(){
    mid();
    requestAnimationFrame(function(){ requestAnimationFrame(function(){
      setX(dir > 0 ? '-103%' : '103%');
      setTimeout(function(){
        curtain.classList.remove('move'); setX('103%', true);
        busy = false; if(done) done(); sync();
      }, 760);
    }); });
  }, 740);
}

// channel panel
var panel = $('#panel'), home = $('#home'), openId = null, internal = false, lastFocus = null, internalT = 0;
function buildPanel(c){
  if(TRY.isOpen()) TRY.leave();
  if(c.kind === 'tryout'){ TRY.mount(c); bindCursor(panel); return; }
  var i = CH.indexOf(c), n = CH[(i + 1) % CH.length], url = linkOf(c.id);
  var ttl = c.name.split(' ').map(function(w, k){ return '<span class="w"><i style="--cd:' + (0.14 + k * 0.08) + 's">' + esc(w) + '</i></span>'; }).join(' ');
  panel.innerHTML =
    '<div class="p-bar"><button class="back mag" type="button" id="backBtn" data-cur="balik"><b>←</b> Kembali</button><span class="p-crumb">Channel ' + c.num + ' / ' + TOTAL + '</span></div>' +
    '<div class="p-wrap">' +
      '<div class="p-hero"><span class="p-num" aria-hidden="true">' + c.num + '</span>' +
        '<p class="lbl p-rv" style="--pd:.05s">' + esc(c.tag) + '</p>' +
        '<h2 class="p-ttl">' + ttl + '</h2>' +
        '<p class="p-sub p-rv" style="--pd:.35s">' + esc(c.sub) + '</p></div>' +
      '<a class="folder p-rv' + (url ? '' : ' empty') + '" style="--pd:.45s" data-cur="buka" ' +
        (url ? 'href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"' : 'href="#" role="button" aria-disabled="true"') + '>' +
        '<span class="f-back"><span class="f-tab">Drive · ' + c.num + '</span></span>' +
        '<span class="f-paper f-p1" aria-hidden="true"></span>' +
        '<span class="f-paper f-p2" aria-hidden="true"><b>' + esc(c.name) + '</b><span class="f-lines"></span><span class="f-stamp">Class Alpha</span></span>' +
        '<span class="f-front"><span class="f-k">Folder Google Drive</span>' +
          '<span class="f-t">' + (url ? 'Buka folder' : 'Link menyusul') + ' <i aria-hidden="true">↗</i></span>' +
          '<span class="f-u">' + esc(url ? prettyUrl(url) : 'belum dipasang') + '</span></span>' +
      '</a>' +
      '<div class="p-next p-rv" style="--pd:.55s"><span class="lbl">' + c.num + ' / ' + TOTAL + '</span>' +
        '<button class="nextb" type="button" data-next="' + n.id + '" data-cur="lanjut"><span class="lbl">Channel berikutnya</span><strong>' + esc(n.name) + ' →</strong></button></div>' +
    '</div>';
  panel.scrollTop = 0;
  $('#backBtn', panel).addEventListener('click', closeViaHistory);
  var fo = $('.folder', panel);
  fo.addEventListener('click', function(e){ if(fo.classList.contains('empty')){ e.preventDefault(); toast('Link Drive buat channel ini belum dipasang.'); } });
  $('.nextb', panel).addEventListener('click', function(){
    if(busy) return;
    var id = this.getAttribute('data-next'); hRepl({ch: id}, '#' + id);
    sweep(1, function(){ mount(BY[id]); });
  });
  bindCursor(panel);
}
function mount(c){
  buildPanel(c);
  panel.classList.remove('show');
  panel.classList.add('on');
  H.classList.add('lock');
  home.setAttribute('aria-hidden', 'true');
  openId = c.id;
  document.title = c.name + ' · ALPHANGERS';
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ panel.classList.add('show'); }); });
}
function unmount(){
  if(TRY.isOpen()) TRY.leave();
  panel.classList.remove('on', 'show', 'to-running'); panel.innerHTML = '';
  H.classList.remove('lock'); home.removeAttribute('aria-hidden');
  openId = null; document.title = 'ALPHANGERS · Class Alpha';
  if(lastFocus && lastFocus.focus){ try{ lastFocus.focus({preventScroll: true}); }catch(e){} }
}
function goChannel(id, push){
  var c = BY[id]; if(!c || busy) return;
  if(!openId) lastFocus = document.activeElement;
  if(push) hPush({ch: id}, '#' + id);
  sweep(1, function(){ mount(c); }, function(){ try{ panel.focus({preventScroll: true}); }catch(e){} });
}
function goHome(){ if(busy || !openId) return; sweep(-1, unmount); }
function closeViaHistory(){
  if(busy) return;
  if(history.state && history.state.ch){
    var n = 1 + ((history.state.ch === 'tryout' && history.state.d) ? history.state.d : 0);
    internal = true; clearTimeout(internalT); internalT = setTimeout(function(){ internal = false; }, 1200);
    if(n > 1) history.go(-n); else history.back();
  }
  goHome();
}
function sync(){
  var s = history.state, want = s && s.ch && BY[s.ch] ? s.ch : null;
  if(want === openId){ if(want === 'tryout' && TRY.isOpen()) TRY.pop(s); return; }
  if(want && !openId) goChannel(want, false);
  else if(!want && openId) sweep(-1, unmount);
  else if(want && openId) sweep(1, function(){ mount(BY[want]); });
}
window.addEventListener('popstate', function(){
  if(internal){ internal = false; return; }
  if(lbx.isOpen() && !(history.state && history.state.lbx)){ lbx.close(true); return; }
  if(!busy) sync();
});
window.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  if(lbx.isOpen()){ lbx.close(); return; }
  if(!openId) return;
  if(openId === 'tryout' && TRY.esc()) return;
  closeViaHistory();
});
// a channel hash typed or pasted into an already open tab
window.addEventListener('hashchange', function(){
  var h = location.hash.replace('#', '');
  if(!BY[h] || openId || busy || lbx.isOpen()) return;
  hRepl({ch: h}, '#' + h);
  goChannel(h, false);
});
var hash0 = location.hash.replace('#', '');
if(BY[hash0]){
  hRepl(null, location.href.split('#')[0]);
  hPush({ch: hash0}, '#' + hash0);
  mount(BY[hash0]);
}

// in-page jumps and the brand button
function jumpTo(el){
  var y = el.getBoundingClientRect().top + (window.scrollY || window.pageYOffset) - 40;
  window.scrollTo({ top: y, behavior: RM ? 'auto' : 'smooth' });
}
$$('[data-jump]').forEach(function(a){
  a.addEventListener('click', function(e){ e.preventDefault(); if(openId) return; jumpTo(document.getElementById(a.getAttribute('data-jump'))); });
});
$('#homeBtn').addEventListener('click', function(e){
  e.preventDefault();
  if(openId) closeViaHistory(); else window.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' });
});

// footer: filling wordmark and Palembang clock
var big = $('#big'), bigO = $('.big-o'), bigG = $('#bigG'), foot = $('.foot'), clock = $('#clock'), footP = 0;
beat.listeners.push(function(){
  if(RM || !vis.foot || openId || footP < 0.97 || !bigG.animate) return;
  try{ bigG.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.14 }, { opacity: 0 }], { duration: 950, easing: 'ease-out' }); }catch(e){}
});
function bigFit(){
  big.style.fontSize = '100px';
  var w = bigO.scrollWidth, cw = big.clientWidth;
  if(w > 0 && cw > 0) big.style.fontSize = Math.floor(100 * cw / w * 0.995 * 100) / 100 + 'px';
}
function footFrame(){
  var r = foot.getBoundingClientRect(), vh = window.innerHeight;
  var p = clamp((vh - r.top) / Math.max(1, Math.min(r.height, vh) * 0.95), 0, 1);
  footP = p;
  big.style.setProperty('--fill', ((1 - p) * 100).toFixed(1) + '%');
}
function tick(){
  var s = '';
  try{ s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
  catch(e){ var d = new Date(Date.now() + 7 * 3600e3); s = ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); }
  clock.innerHTML = '<i></i>Palembang · ' + s + ' WIB';
}
tick(); setInterval(tick, 15000);

// class photo window, opened from "Made with love by Resvet"
function photoSrc(){ return '/img/classphoto.webp'; }
var lbx = (function(){
  var el = null, vw = null, img = null, on = false, ret = null;
  var s = 1, tx = 0, ty = 0, P = {}, n = 0, st = null, pin = null, moved = false, drop = 0, tapT = 0, tapX = 0, tapY = 0;
  function build(){
    el = document.createElement('div'); el.className = 'lbx';
    el.innerHTML = '<div class="lbx-s" data-x="1"></div>' +
      '<div class="lbx-w" role="dialog" aria-modal="true" aria-labelledby="lbxT">' +
        '<div class="lbx-bar"><span class="lbx-dot" aria-hidden="true"></span><p class="lbx-t" id="lbxT">Class Alpha · FK Unsri 2026</p>' +
          '<span class="lbx-h" aria-hidden="true">' + (TOUCH ? 'ketuk 2x buat zoom' : 'klik 2x buat zoom') + '</span>' +
          '<button class="lbx-x" type="button" data-x="1" aria-label="Tutup foto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
        '<div class="lbx-v" data-cur="zoom"><img alt="Foto bersama Class Alpha di lobi Fakultas Kedokteran Universitas Sriwijaya" draggable="false" decoding="async"></div>' +
      '</div>';
    document.body.appendChild(el);
    vw = el.querySelector('.lbx-v'); img = vw.querySelector('img');
    img.onload = function(){ vw.classList.add('ld'); };
    if(photoSrc()) img.src = PHOTO;
    else document.addEventListener('DOMContentLoaded', function(){ img.src = photoSrc(); });
    el.addEventListener('click', function(e){ if(e.target.closest('[data-x]')) close(); });
    el.addEventListener('keydown', function(e){
      if(e.key === 'Tab'){ e.preventDefault(); el.querySelector('.lbx-x').focus(); }
      else if(e.key === '+' || e.key === '='){ var b = box(); zoomAt(s * 1.5, b.l + b.w / 2, b.t + b.h / 2, true); }
      else if(e.key === '-'){ var b2 = box(); zoomAt(s / 1.5, b2.l + b2.w / 2, b2.t + b2.h / 2, true); }
      else if(e.key === '0'){ reset(true); }
    });
    vw.addEventListener('pointerdown', down);
    vw.addEventListener('pointermove', move);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function(t){ vw.addEventListener(t, up); });
    vw.addEventListener('wheel', function(e){ e.preventDefault(); zoomAt(s * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022)), e.clientX, e.clientY, false); }, { passive: false });
    window.addEventListener('resize', function(){ if(on) reset(false); });
    bindCursor(el);
  }
  function box(){ var r = vw.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; }
  function apply(anim){
    img.style.transition = (anim && !RM) ? 'transform .4s cubic-bezier(.16,1,.3,1)' : 'none';
    img.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
    vw.classList.toggle('z', s > 1.01);
  }
  function bound(){ var b = box(), mx = Math.max(0, (s - 1) * b.w / 2), my = Math.max(0, (s - 1) * b.h / 2); tx = clamp(tx, -mx, mx); ty = clamp(ty, -my, my); }
  function zoomAt(ns, px, py, anim){
    var b = box(), cx = b.l + b.w / 2, cy = b.t + b.h / 2, lx = (px - cx - tx) / s, ly = (py - cy - ty) / s;
    s = clamp(ns, 1, 4); tx = px - cx - s * lx; ty = py - cy - s * ly;
    if(s < 1.01){ s = 1; tx = ty = 0; }
    bound(); apply(anim);
  }
  function reset(anim){ s = 1; tx = ty = 0; if(img) apply(anim); }
  function pts(){ return Object.keys(P).map(function(k){ return P[k]; }); }
  function down(e){
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    try{ vw.setPointerCapture(e.pointerId); }catch(er){}
    P[e.pointerId] = { x: e.clientX, y: e.clientY }; n = Object.keys(P).length;
    if(n === 1){ st = { x: e.clientX, y: e.clientY, tx: tx, ty: ty }; moved = false; }
    else if(n === 2){ var p = pts(); pin = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, s: s, mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2, tx: tx, ty: ty }; moved = true; drop = 0; }
  }
  function move(e){
    if(!P[e.pointerId]) return;
    P[e.pointerId] = { x: e.clientX, y: e.clientY };
    if(n >= 2 && pin){
      var p = pts(), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
      var b = box(), cx = b.l + b.w / 2, cy = b.t + b.h / 2, lx = (pin.mx - cx - pin.tx) / pin.s, ly = (pin.my - cy - pin.ty) / pin.s;
      s = clamp(pin.s * d / pin.d, 1, 4); tx = mx - cx - s * lx; ty = my - cy - s * ly; bound(); apply(false);
      return;
    }
    if(n !== 1 || !st) return;
    var dx = e.clientX - st.x, dy = e.clientY - st.y;
    if(Math.abs(dx) + Math.abs(dy) > 6) moved = true;
    if(s > 1.01){ tx = st.tx + dx; ty = st.ty + dy; bound(); apply(false); }
    else if(e.pointerType !== 'mouse' && moved){
      drop = dy; img.style.transition = 'none'; img.style.transform = 'translate(0,' + dy.toFixed(1) + 'px) scale(' + (1 - Math.min(Math.abs(dy), 300) / 3000).toFixed(3) + ')';
      el.style.setProperty('--fade', (1 - Math.min(Math.abs(dy), 320) / 480).toFixed(3));
    }
  }
  function up(e){
    if(!P[e.pointerId]) return;
    delete P[e.pointerId]; n = Object.keys(P).length;
    if(n < 2) pin = null;
    if(n === 1){ var q = pts()[0]; st = { x: q.x, y: q.y, tx: tx, ty: ty }; return; }
    if(n) return;
    st = null;
    if(drop){ var d = drop; drop = 0; el.style.removeProperty('--fade'); if(Math.abs(d) > 110){ close(); } else apply(true); return; }
    if(moved || e.type !== 'pointerup') return;
    var now = performance.now();
    if(now - tapT < 320 && Math.abs(e.clientX - tapX) < 28 && Math.abs(e.clientY - tapY) < 28){ tapT = 0; if(s > 1.01) zoomAt(1, e.clientX, e.clientY, true); else zoomAt(2.5, e.clientX, e.clientY, true); }
    else { tapT = now; tapX = e.clientX; tapY = e.clientY; }
  }
  function open(){
    if(on || openId || busy) return;
    if(!el) build();
    ret = document.activeElement; on = true; reset(false);
    el.classList.add('show'); H.classList.add('lbx-lock');
    hPush({ lbx: 1 }, location.href);
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ el.classList.add('on'); }); });
    setTimeout(function(){ try{ el.querySelector('.lbx-x').focus({ preventScroll: true }); }catch(e){} }, 40);
  }
  function close(fromPop){
    if(!on) return;
    on = false; P = {}; n = 0; pin = null; st = null; drop = 0;
    el.classList.remove('on'); el.style.removeProperty('--fade'); H.classList.remove('lbx-lock');
    setTimeout(function(){ if(!on){ el.classList.remove('show'); reset(false); } }, RM ? 0 : 420);
    if(!fromPop && history.state && history.state.lbx){ internal = true; clearTimeout(internalT); internalT = setTimeout(function(){ internal = false; }, 1200); history.back(); }
    if(ret && ret.focus){ try{ ret.focus({ preventScroll: true }); }catch(e){} }
  }
  return { open: open, close: close, isOpen: function(){ return on; } };
})();
$('#loveBtn').addEventListener('click', function(){ lbx.open(); });

// "100% Polyester": each click drops the clip somewhere random for exactly 3.5 s, sound included.
// The windows are muted videos that ignore the pointer, so whatever sits under them stays clickable.
// The sound runs through Web Audio because iPhones let only one unmuted video play at a time,
// and spam-clicking should stack every copy.
var poly = (function(){
  var DUR = 3.5, CAP = TOUCH ? 6 : 10;
  var layer = null, C = null, ci = 0, noVideo = false, players = [], pool = [], live = [], zTop = 0, warmed = false;
  var buf = null, bufP = null, lead = 0, bus = null, busAC = null, sessPrev = null, restT = 0;

  // formats the browser claims it can play, best first
  function cands(){
    if(C) return C;
    var t = document.createElement('video'), rank = { probably: 2, maybe: 1 };
    var f = [
      { url: '/media/poly.mp4', type: 'video/mp4', r: rank[t.canPlayType('video/mp4; codecs="avc1.64001F"')] || 0 },
      { url: '/media/poly.webm', type: 'video/webm', r: rank[t.canPlayType('video/webm; codecs="vp9"')] || 0 }
    ];
    var ok = f.filter(function(x){ return x.r > 0; }); if(!ok.length) ok = f;
    ok.sort(function(a, b){ return b.r - a.r; });
    C = ok.map(function(x){ return { type: x.type, url: x.url }; });
    if(!C.length) noVideo = true;
    return C;
  }
  function urlOf(c){ return c.url; }
  function ready(){
    if(noVideo) return false;
    if(!layer){ layer = document.createElement('div'); layer.className = 'poly-l'; layer.setAttribute('aria-hidden', 'true'); B.appendChild(layer); }
    cands();
    return !noVideo;
  }

  // players are reusable video windows; an instance is one click
  function player(){
    var w = document.createElement('div'), v = document.createElement('video');
    w.className = 'poly-w';
    v.muted = true; v.defaultMuted = true; v.setAttribute('muted', '');
    v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    v.setAttribute('disablepictureinpicture', ''); v.setAttribute('disableremoteplayback', ''); v.setAttribute('x-webkit-airplay', 'deny');
    v.preload = 'auto'; v.tabIndex = -1;
    w.appendChild(v); layer.appendChild(w);
    var P = { w: w, v: v, ci: ci, I: null, gen: 0, loaded: false, anim: null };
    v.addEventListener('loadeddata', function(){ P.loaded = true; });
    v.addEventListener('playing', function(){ if(P.I && P.I.pend) begin(P.I); });
    v.addEventListener('seeked', function(){ if(P.I && P.I.pend && !v.paused) begin(P.I); });
    v.addEventListener('error', function(){ fail(P); });
    players.push(P);
    v.src = urlOf(C[ci]);
    return P;
  }
  function kick(P){
    var I = P.I, gen = ++P.gen, pr;
    try{ pr = P.v.play(); }catch(e){}
    if(pr && pr.catch) pr.catch(function(err){
      if(P.gen !== gen || !I || P.I !== I || !I.pend) return;
      if(err && err.name === 'NotAllowedError'){ P.I = null; I.P = null; park(P); begin(I); }
    });
  }
  function park(P){
    P.gen++;
    P.w.classList.remove('on');
    if(P.anim){ try{ P.anim.cancel(); }catch(e){} P.anim = null; }
    try{ P.v.pause(); }catch(e){}
    try{ if(P.v.currentTime > 0.001) P.v.currentTime = 0; }catch(e){}
    if(players.indexOf(P) >= 0 && pool.indexOf(P) < 0) pool.push(P);
  }
  function scrap(P){
    var k = players.indexOf(P); if(k < 0) return;
    players.splice(k, 1);
    var j = pool.indexOf(P); if(j >= 0) pool.splice(j, 1);
    var I = P.I; P.I = null; P.gen++;
    try{ P.v.pause(); P.v.removeAttribute('src'); P.v.load(); }catch(e){}
    if(P.w.parentNode) P.w.parentNode.removeChild(P.w);
    if(I){ I.P = null; if(I.pend) begin(I); }
  }
  function fail(P){
    if(players.indexOf(P) < 0 || !P.v.error) return;
    // it played before, so this device ran out of decoders: keep fewer windows from now on
    if(P.loaded){ CAP = Math.max(2, Math.min(CAP, players.length - 1)); scrap(P); return; }
    if(P.ci === ci) ci++;
    if(ci >= C.length){ noVideo = true; players.slice().forEach(scrap); return; }
    P.ci = ci; P.v.src = urlOf(C[ci]);
    if(P.I && P.I.pend) kick(P);
  }
  function place(P){
    var W = layer.clientWidth || window.innerWidth, H = layer.clientHeight || window.innerHeight, cs = getComputedStyle(layer);
    var L = parseFloat(cs.paddingLeft) || 0, T = parseFloat(cs.paddingTop) || 0;
    var R = W - (parseFloat(cs.paddingRight) || 0), Bo = H - (parseFloat(cs.paddingBottom) || 0), vv = window.visualViewport;
    if(vv && vv.scale > 1.01){ L = Math.max(L, vv.offsetLeft); T = Math.max(T, vv.offsetTop); R = Math.min(R, vv.offsetLeft + vv.width); Bo = Math.min(Bo, vv.offsetTop + vv.height); }
    var m = Math.min(W, H) < 500 ? 10 : 18, aw = R - L - 2 * m, ah = Bo - T - 2 * m;
    // about 8% of the screen area: small on phones, medium on laptops and monitors
    var w = Math.max(96, Math.min(clamp(Math.sqrt(W * H) * 0.37, 150, 520), aw, ah * 16 / 9)), h = w * 9 / 16;
    var x = L + m + Math.random() * Math.max(0, aw - w), y = T + m + Math.random() * Math.max(0, ah - h);
    var s = P.w.style;
    s.width = Math.round(w) + 'px'; s.height = Math.round(h) + 'px'; s.left = Math.round(x) + 'px'; s.top = Math.round(y) + 'px';
  }
  // the window's whole life as one compositor animation: a quick pop in, then gone at exactly 3.5 s
  // even if the page is busy (the timer below only tidies up afterwards)
  function life(el){
    if(!el.animate) return null;
    var ms = DUR * 1000, k = [{ transform: 'none', offset: 0 }, { transform: 'none', offset: 1 - 0.5 / ms }, { transform: 'scale(0)', offset: 1 }];
    if(!RM) k = [{ transform: 'scale(.86)', offset: 0, easing: 'cubic-bezier(.2,.8,.3,1)' }, { transform: 'scale(1.02)', offset: 132 / ms, easing: 'cubic-bezier(.2,.8,.3,1)' }, { transform: 'none', offset: 240 / ms }].concat(k.slice(1));
    try{ return el.animate(k, { duration: ms, fill: 'forwards' }); }catch(e){ return null; }
  }
  function spawn(){
    var I = { P: null, pend: true, t0: 0, timer: 0, safe: 0, src: null, g: null }, P = null;
    live.push(I);
    if(ready()){
      P = pool.pop() || null;
      if(!P && players.length < CAP) P = player();
      // at the cap the oldest window jumps here and starts over
      for(var i = 0; !P && i < live.length - 1; i++){ if(live[i].P){ P = live[i].P; live[i].P = null; P.I = null; end(live[i], true); } }
    }
    if(!P){ begin(I); return; }
    I.P = P; P.I = I;
    P.w.classList.remove('on');
    if(P.anim){ try{ P.anim.cancel(); }catch(e){} P.anim = null; }
    place(P);
    try{ if(P.v.currentTime > 0.001) P.v.currentTime = 0; }catch(e){}
    kick(P);
    if(P.v.readyState >= 3 && !P.v.seeking) begin(I);
    else I.safe = setTimeout(function(){
      if(!I.pend) return;
      if(I.P){ var q = I.P; q.I = null; I.P = null; park(q); }
      begin(I);
    }, 1500);
  }
  function begin(I){
    if(!I.pend) return;
    I.pend = false; clearTimeout(I.safe);
    var a = null;
    if(I.P){ var P = I.P; P.w.style.zIndex = String(++zTop); P.w.classList.add('on'); a = P.anim = life(P.w); }
    I.t0 = performance.now();
    // the animation's clock starts at the first painted frame, so tidy up when it says so; the timer is a safety net
    if(a && a.finished){ a.finished.then(function(){ end(I, false); }, function(){}); I.timer = setTimeout(function(){ end(I, false); }, DUR * 1000 + 1500); }
    else I.timer = setTimeout(function(){ end(I, false); }, DUR * 1000);
    voice(I, 0); mix();
  }
  function end(I, early){
    var k = live.indexOf(I); if(k < 0) return;
    live.splice(k, 1);
    clearTimeout(I.timer); clearTimeout(I.safe); I.pend = false;
    hush(I, early);
    var P = I.P; I.P = null;
    if(P){ P.I = null; park(P); }
    mix(); rest();
  }

  // sound
  // bus -> compressor (tames stacked copies) -> soft clipper (rounds off whatever still pokes above full scale)
  function busOf(ac){
    if(bus && busAC === ac) return bus;
    busAC = ac; bus = ac.createGain(); bus.gain.value = 1;
    var lim = ac.createDynamicsCompressor(), pre = ac.createGain(), sh = ac.createWaveShaper();
    try{ lim.threshold.value = -2; lim.knee.value = 1; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1; }catch(e){}
    pre.gain.value = 0.5; sh.curve = softCurve();
    bus.connect(lim); lim.connect(pre); pre.connect(sh); sh.connect(ac.destination);
    return bus;
  }
  // input is pre-scaled by 0.5, so the curve covers -2..2: straight up to 0.86, then eases into 1.0
  function softCurve(){
    var n = 2048, c = new Float32Array(n), K = 0.86;
    for(var i = 0; i < n; i++){
      var u = (i / (n - 1)) * 4 - 2, a = Math.abs(u), y = a <= K ? a : K + (1 - K) * Math.tanh((a - K) / (1 - K));
      c[i] = u < 0 ? -y : y;
    }
    return c;
  }
  function decodeWith(ctx, u){
    return new Promise(function(res){
      var fin = false; function d(b){ if(!fin){ fin = true; res(b || null); } }
      try{ var r = ctx.decodeAudioData(u.buffer.slice(0), d, function(){ d(null); }); if(r && r.then) r.then(d, function(){ d(null); }); }catch(e){ d(null); }
    });
  }
  function decode(){
    if(bufP) return bufP;
    bufP = fetch('/media/poly.mp3').then(function(r){ return r.ok ? r.arrayBuffer() : null; }).catch(function(){ return null; }).then(function(ab){
      if(!ab) return null;
      var u = new Uint8Array(ab), O = window.OfflineAudioContext || window.webkitOfflineAudioContext, oc = null;
      try{ if(O) oc = new O(2, 48000, 48000); }catch(e){ oc = null; }
      return (oc ? decodeWith(oc, u) : Promise.resolve(null)).then(function(b){ return b || (AC ? decodeWith(AC, u) : null); });
    }).then(function(b){ if(b) setBuf(b); else bufP = null; return b; });
    return bufP;
  }
  function setBuf(b){
    buf = b; lead = 0;
    // some MP3 decoders keep the encoder's lead-in silence; skip it so picture and sound start together
    try{
      var chs = [], n = Math.min(b.length, Math.round(b.sampleRate * 0.08));
      for(var c = 0; c < b.numberOfChannels; c++) chs.push(b.getChannelData(c));
      search: for(var i = 0; i < n; i++){ for(var k = 0; k < chs.length; k++){ if(Math.abs(chs[k][i]) > 0.02){ lead = i / b.sampleRate; break search; } } }
    }catch(e){ lead = 0; }
    // clicks that came in before the sound was ready join in at the right spot
    var now = performance.now();
    live.forEach(function(I){ if(!I.pend && !I.src) voice(I, (now - I.t0) / 1000); });
    mix();
  }
  function voice(I, off){
    if(!buf || !AC || !bus || I.src) return;
    off = off || 0;
    var from = lead + off, dur = Math.min(DUR - off, buf.duration - from);
    if(dur < 0.03) return;
    try{
      var s = AC.createBufferSource(), g = AC.createGain();
      s.buffer = buf; s.connect(g); g.connect(bus);
      s.onended = function(){ try{ s.disconnect(); g.disconnect(); }catch(e){} };
      s.start(AC.currentTime, from, dur);
      I.src = s; I.g = g;
    }catch(e){}
  }
  function hush(I, early){
    var s = I.src, g = I.g; I.src = I.g = null;
    if(!s || !early || !AC) return;
    try{ var t = AC.currentTime; g.gain.setTargetAtTime(0, t, 0.008); s.stop(t + 0.06); }catch(e){}
  }
  // scale the bus by 1/sqrt(copies) so a stack of copies stays about as loud as one
  function mix(){
    if(!bus || !AC) return;
    var n = 0; for(var i = 0; i < live.length; i++) if(live[i].src) n++;
    try{ bus.gain.setTargetAtTime(1 / Math.sqrt(Math.max(1, n)), AC.currentTime, 0.03); }catch(e){}
  }
  // iPhone: play through the silent switch like a normal video would
  function session(){
    var a = navigator.audioSession; if(!a) return;
    try{ if(sessPrev === null) sessPrev = a.type; if(a.type !== 'playback') a.type = 'playback'; }catch(e){}
  }
  // after the last clip: hand the audio session back and let the audio context sleep
  function rest(){
    clearTimeout(restT);
    if(live.length) return;
    restT = setTimeout(function(){
      if(live.length || soundOn) return;
      var a = navigator.audioSession;
      if(a && sessPrev !== null){ try{ a.type = sessPrev; }catch(e){} sessPrev = null; }
      if(AC && AC.state === 'running'){ try{ AC.suspend(); }catch(e){} }
    }, 1500);
  }

  function play(){
    session();
    var ac = audio();
    if(ac){ busOf(ac); decode(); }
    spawn();
  }
  // get the first click ready ahead of time: sound decoded, two windows loaded
  function warm(){
    if(warmed || !polyBtn) return;
    warmed = true;
    if(!ready()) return;
    decode();
    while(!noVideo && players.length < Math.min(2, CAP)) pool.push(player());
  }
  function stopAll(){ live.slice().forEach(function(I){ end(I, true); }); }
  document.addEventListener('visibilitychange', function(){ if(document.hidden) stopAll(); });
  window.addEventListener('pagehide', stopAll);
  if(polyBtn){
    polyBtn.addEventListener('click', play);
    polyBtn.addEventListener('mousedown', function(e){ if(e.detail > 1) e.preventDefault(); });
    polyBtn.addEventListener('pointerenter', warm);
    polyBtn.addEventListener('focus', warm);
    polyBtn.addEventListener('touchstart', warm, { passive: true });
  }
  return { warm: warm };
})();

// cursor and magnetic buttons (fine pointers only)
var cd = $('#cd'), cr = $('#cr'), crt = $('#crt'), cur = { x: -100, y: -100, rx: -100, ry: -100, seen: false };
function bindCursor(root){
  if(!FINE || RM) return;
  $$('[data-cur], a, button, .heart-c', root).forEach(function(el){
    if(el.__cur) return; el.__cur = 1;
    el.addEventListener('pointerenter', function(){
      var lab = el.getAttribute('data-cur') || (el.classList.contains('heart-c') ? 'putar' : '');
      if(lab && lab !== 'true'){ crt.textContent = lab; cr.classList.add('lab'); } else cr.classList.add('big');
    });
    el.addEventListener('pointerleave', function(){ cr.classList.remove('big', 'lab'); });
  });
  $$('.mag', root).forEach(function(el){
    if(el.__mag) return; el.__mag = 1;
    el.addEventListener('pointermove', function(e){
      var r = el.getBoundingClientRect();
      el.style.transform = 'translate(' + ((e.clientX - (r.left + r.width / 2)) * 0.2).toFixed(1) + 'px,' + ((e.clientY - (r.top + r.height / 2)) * 0.2).toFixed(1) + 'px)';
    });
    el.addEventListener('pointerleave', function(){ el.style.transform = ''; });
  });
}
if(FINE && !RM){
  window.addEventListener('pointermove', function(e){
    cur.x = e.clientX; cur.y = e.clientY;
    if(!cur.seen){ cur.seen = true; cur.rx = cur.x; cur.ry = cur.y; }
    cd.style.transform = 'translate(' + cur.x + 'px,' + cur.y + 'px)';
  }, {passive: true});
  document.addEventListener('pointerleave', function(){ cd.style.opacity = cr.style.opacity = '0'; });
  document.addEventListener('pointerenter', function(){ cd.style.opacity = cr.style.opacity = '1'; });
}
bindCursor(document);
function cursorFrame(dt){
  if(!FINE || RM) return;
  cur.rx = damp(cur.rx, cur.x, 14, dt); cur.ry = damp(cur.ry, cur.y, 14, dt);
  cr.style.transform = 'translate(' + cur.rx.toFixed(1) + 'px,' + cur.ry.toFixed(1) + 'px)';
}

// sizing
function fitTitle(){
  ttlEl.style.fontSize = '100px';
  var w = sk.offsetWidth, cw = ttlEl.parentElement.clientWidth;
  var shortLand = window.innerWidth > window.innerHeight && window.innerHeight < 540;
  if(w > 0 && cw > 0) ttlEl.style.fontSize = (100 * cw * (shortLand ? 0.68 : 1) / w * 0.994).toFixed(2) + 'px';
}
function measureAll(){
  try{ fitTitle(); }catch(e){}
  try{ haloSize(); }catch(e){}
  try{ mqSize(); }catch(e){}
  try{ progBuild(); progFrame(window.scrollY || 0, true); }catch(e){}
  try{ pulse.measure(); }catch(e){}
  try{ bigFit(); }catch(e){}
  try{ ldSize(); }catch(e){}
}
var rsT = 0, lastW = window.innerWidth, lastH = window.innerHeight;
window.addEventListener('resize', function(){
  clearTimeout(rsT);
  rsT = setTimeout(function(){
    var w = window.innerWidth, h = window.innerHeight;
    // phones fire resize when the address bar slides; svh-based layout does not change, so skip the work
    if(TOUCH && w === lastW && Math.abs(h - lastH) < 160){ lastH = h; return; }
    lastW = w; lastH = h;
    measureAll(); if(RM) staticDraw();
  }, 140);
});
if(document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ try{ fitTitle(); bigFit(); mqSize(); haloSize(); pulse.measure(); }catch(e){} });
measureAll();

// main loop
var last = performance.now(), sy = window.scrollY || 0, sv = 0, T = 0, raf = 0;
function frame(now){
  var dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now; T += dt;
  var y = window.scrollY || window.pageYOffset || 0;
  var v = (y - sy) / dt; sy = y; sv = damp(sv, openId ? 0 : v, 8, dt);
  beatStep(dt, sv);
  if(!openId){
    progFrame(y);
    if(vis.hero) heroFrame(dt, T, y, sv);
    mqFrame(dt, sv);
    if(vis.pulse) pulse.frame(dt, T); else pulseActive = false;
    if(vis.foot) footFrame();
    peekFrame(dt);
  }
  cursorFrame(dt);
  raf = requestAnimationFrame(frame);
}
function staticDraw(){
  progFrame(window.scrollY || 0);
  heroFrame(0.016, 0, 0);
  pulse.frame(0.016, 1.5, true);
  footFrame();
}
if(RM){
  pulse.still();
  staticDraw();
  window.addEventListener('scroll', function(){ progFrame(window.scrollY || 0); footFrame(); }, {passive: true});
} else {
  raf = requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', function(){
    if(document.hidden){ cancelAnimationFrame(raf); raf = 0; }
    else if(!raf){ last = performance.now(); raf = requestAnimationFrame(frame); }
  });
}

// warm the try out bank once the page is idle
if(window.requestIdleCallback) requestIdleCallback(function(){ TRY.preload(); }, { timeout: 8000 }); else setTimeout(TRY.preload, 4000);

return {
  toast: toast,
  jumpTo: jumpTo,
  setChannels: setChannels,
  beat: beat,
  panelOpen: function(){ return !!openId; },
  relayout: measureAll,
  observeReveal: function(root){ $$('.rv', root).forEach(function(el){ if(io) io.observe(el); else el.classList.add('in'); }); },
  lubdub: lubdub
};
}
