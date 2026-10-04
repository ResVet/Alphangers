// The WebGL side of the heart explorer: loads the model, colours every part in the shader,
// cuts it open, plays the conduction wave and the blood flow, and answers "what is under this pixel".
// Model space is the patient's: +x left, +y up, +z forward, in centimetres.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { PARTS, colorOf } from './palette.js';

const N = 64; // uniform array size, a little above the part count
const RR_MS = 60000 / 72; // one beat at 72 bpm, the same template the ECG strip uses
const NO_TIME = 65535;
const PULSE_MS = 2600;
const GREEN = new THREE.Color('#86f25e');

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function shared(meta) {
  const cols = [];
  for (let i = 0; i < N; i++) cols.push(new THREE.Color(colorOf(PARTS[i] || 'heart')).convertSRGBToLinear());
  return {
    uCol: { value: cols.map((c) => new THREE.Vector3(c.r, c.g, c.b)) },
    uVis: { value: new Array(N).fill(1) },
    uSel: { value: -1 },
    uHov: { value: -1 },
    uDim: { value: 0 },
    uClock: { value: 0 },
    uTime: { value: -1000 },
    uWave: { value: 0 },
    uXray: { value: 0 },
    uCutOn: { value: 0 },
    uGlow: { value: 1 },
    uPulse: { value: 0 },
  };
}

// MeshPhysicalMaterial with per-part colour, highlight, x-ray and the depolarisation wave patched in.
function tissue(U, kind) {
  const m = new THREE.MeshPhysicalMaterial({
    roughness: kind === 'valves' ? 0.6 : 0.52,
    metalness: 0,
    clearcoat: kind === 'conduction' ? 0.15 : 0.32,
    clearcoatRoughness: 0.42,
    sheen: 0.32,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color('#ffe2da'),
    side: kind === 'coronary' || kind === 'conduction' ? THREE.FrontSide : THREE.DoubleSide,
  });
  m.userData.kind = kind;
  const flag = '#define KIND_' + kind.toUpperCase() + '\n';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = flag + sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float _part;
        attribute float _t;
        attribute float _ao;
        uniform vec3 uCol[${N}];
        uniform float uVis[${N}];
        uniform float uSel, uHov;
        varying vec3 vCol;
        varying float vInner, vSel, vHov, vT, vVis, vAo;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float pid = _part;
        vInner = step(127.5, pid);
        pid -= 128.0 * vInner;
        int ip = int(pid + 0.5);
        vCol = uCol[ip];
        vVis = uVis[ip];
        vSel = 1.0 - step(0.5, abs(pid - uSel));
        vHov = 1.0 - step(0.5, abs(pid - uHov));
        vT = _t;
        vAo = _ao;
        if (vVis < 0.5) transformed *= 0.0;`);
    sh.fragmentShader = (flag + sh.fragmentShader)
      .replace('#include <common>', `#include <common>
        uniform float uDim, uClock, uTime, uWave, uXray, uCutOn, uGlow, uPulse;
        varying vec3 vCol;
        varying float vInner, vSel, vHov, vT, vVis, vAo;
        float waveFront(float t) {
          if (t > 60000.0) return 0.0;
          float age = uTime - t;
          return exp(-(age * age) / 300.0);
        }
        float wavePlateau(float t) {
          if (t > 60000.0) return 0.0;
          float age = uTime - t;
          float hold = t < 150.0 ? 210.0 : 250.0;
          return smoothstep(0.0, 8.0, age) * (1.0 - smoothstep(hold, hold + 90.0, age));
        }`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        vec3 base = vCol;
        #ifdef KIND_BODY
          base = mix(base, vec3(0.80, 0.42, 0.38), vInner * 0.35);
        #endif
        vec4 diffuseColor = vec4( base, opacity );`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        // baked occlusion: full strength on bounced light, partial on direct light so the
        // grooves read as depth without the key light going flat
        #ifdef KIND_CORONARY
          float occ = mix(1.0, vAo, 0.45);
        #else
          float occ = mix(1.0, vAo, 0.7);
        #endif
        reflectedLight.indirectDiffuse *= occ;
        reflectedLight.indirectSpecular *= occ;
        reflectedLight.directDiffuse *= mix(1.0, occ, 0.45);
        reflectedLight.directSpecular *= mix(1.0, occ, 0.6);
        #ifdef USE_SHEEN
          sheenSpecularIndirect *= occ;
        #endif
        #ifdef USE_CLEARCOAT
          clearcoatSpecularIndirect *= occ;
        #endif`)
      .replace('#include <opaque_fragment>', `
        vec3 nV = normalize(vViewPosition);
        float fr = pow(1.0 - abs(dot(normalize(normal), nV)), 2.2);
        vec3 green = vec3(0.53, 0.95, 0.37);
        #ifdef KIND_BODY
          if (!gl_FrontFacing) outgoingLight = mix(outgoingLight, vec3(0.42, 0.13, 0.11) * (0.75 + 0.5 * vCol.r), uCutOn);
        #endif
        #ifdef KIND_CONDUCTION
          outgoingLight = mix(outgoingLight, vCol * 0.9, 0.55 * uGlow);
        #endif
        // depolarisation: a bright front, then a held glow until the tissue repolarises
        float front = waveFront(vT) * uWave;
        float held = wavePlateau(vT) * uWave;
        // x-ray look for the walls when the inside is the point
        #ifdef KIND_BODY
          vec3 xr = mix(vec3(0.03, 0.07, 0.04), vec3(0.32, 0.62, 0.28), fr);
          xr += vec3(0.45, 0.85, 0.35) * held * 0.32 + vec3(0.9, 1.0, 0.8) * front * 0.75;
          outgoingLight = mix(outgoingLight, xr, uXray);
        #else
          outgoingLight += green * front * 1.6 + green * held * 0.35;
        #endif
        // a short pulse right after picking, then a steady highlight (no endless redraws)
        float pulse = 0.5 + 0.5 * sin(uClock * 3.6);
        outgoingLight *= mix(1.0, 0.62, uDim * (1.0 - vSel));
        outgoingLight += vSel * green * (0.12 + 0.1 * pulse * uPulse + fr * 0.75);
        outgoingLight += vHov * (1.0 - vSel) * vec3(0.09, 0.11, 0.08);
        #include <opaque_fragment>
        #ifdef KIND_BODY
          gl_FragColor.a = mix(gl_FragColor.a, clamp(0.035 + 0.42 * fr + 0.5 * front + 0.12 * held, 0.0, 1.0), uXray);
        #endif`);
  };
  // the patched shader differs per kind, so each kind needs its own program cache key
  m.customProgramCacheKey = () => 'heart-' + kind;
  return m;
}

function pickMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { uVis: U.uVis },
    clipping: true,
    toneMapped: false,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute float _part;
      uniform float uVis[${N}];
      varying float vPid;
      varying float vVis;
      #include <clipping_planes_pars_vertex>
      void main() {
        float p = _part;
        p -= 128.0 * step(127.5, p);
        vPid = p;
        vVis = uVis[int(p + 0.5)];
        #include <begin_vertex>
        #include <project_vertex>
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `
      varying float vPid;
      varying float vVis;
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        if (vVis < 0.5) discard;
        gl_FragColor = vec4((vPid + 1.0) / 255.0, 0.0, 0.0, 1.0);
      }`,
  });
}

// A soft round sprite for the blood particles.
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,.75)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Blood as particles drifting along the routes the model builder traced, faster during ejection.
function bloodFlow(meta) {
  const routes = Object.entries(meta.flows).map(([key, pts]) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(v3), false, 'centripetal');
    const len = curve.getLength();
    return { key, curve, len, pts: curve.getSpacedPoints(Math.max(60, Math.round(len * 8))), oxy: !meta.deoxy.includes(key) };
  });
  const per = (len) => Math.max(12, Math.round(len * 3.2));
  const items = [];
  routes.forEach((r, ri) => {
    for (let k = 0, n = per(r.len); k < n; k++) {
      items.push({ ri, u: Math.random(), off: new THREE.Vector3().randomDirection().multiplyScalar(0.12 + Math.random() * 0.22), s: 0.8 + Math.random() * 0.4 });
    }
  });
  const pos = new Float32Array(items.length * 3);
  const col = new Float32Array(items.length * 3);
  const blue = new THREE.Color('#5b82ff').convertSRGBToLinear();
  const red = new THREE.Color('#ff5a46').convertSRGBToLinear();
  items.forEach((it, i) => { const c = routes[it.ri].oxy ? red : blue; col.set([c.r, c.g, c.b], i * 3); });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.42, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  const tmp = new THREE.Vector3();
  function step(dt, phase) {
    // ejection runs through roughly the first 40% of the beat after the QRS
    const sys = Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (phase - 0.24) / 0.38))));
    const speed = 2.2 + 7.5 * sys;
    items.forEach((it, i) => {
      const r = routes[it.ri];
      it.u += (speed * it.s * dt) / r.len;
      if (it.u >= 1) it.u -= 1;
      const f = it.u * (r.pts.length - 1);
      const a = Math.floor(f);
      tmp.lerpVectors(r.pts[a], r.pts[Math.min(a + 1, r.pts.length - 1)], f - a).add(it.off);
      pos[i * 3] = tmp.x; pos[i * 3 + 1] = tmp.y; pos[i * 3 + 2] = tmp.z;
    });
    geo.attributes.position.needsUpdate = true;
  }
  step(0, 0);
  return { points, step, dispose() { geo.dispose(); mat.map.dispose(); mat.dispose(); } };
}

function isSoftwareGL(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(name));
  } catch {
    return false;
  }
}

export async function createScene(canvas, { meta, url, onProgress, reducedMotion = false, lowPower = false }) {
  let dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 2, alpha: true, powerPreference: 'high-performance' });
  // Without a usable GPU the browser falls back to drawing WebGL on the CPU. The model still
  // works there, but only at a lower resolution and without the idle spin.
  const software = isSoftwareGL(renderer.getContext());
  if (software) { dpr = Math.min(dpr, 0.75); reducedMotion = true; }
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  const key = new THREE.DirectionalLight('#fff1e6', 2.1);
  key.position.set(-14, 18, 22);
  const rim = new THREE.DirectionalLight('#9dff7a', 1.15);
  rim.position.set(16, 6, -22);
  const fill = new THREE.HemisphereLight('#f2fff0', '#1a0d0b', 0.55);
  scene.add(key, rim, fill);

  const [lo, hi] = meta.bounds.map(v3);
  const centre = lo.clone().add(hi).multiplyScalar(0.5);
  const radius = lo.distanceTo(hi) * 0.5;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 300);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.rotateSpeed = 0.75;
  controls.zoomSpeed = 0.9;
  controls.screenSpacePanning = true;
  controls.minDistance = 6;
  controls.maxDistance = radius * 6;
  controls.autoRotateSpeed = 0.55;

  const U = shared(meta);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url, (e) => { if (e.total) onProgress?.(e.loaded / e.total); });
  const meshes = {};
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      o.material = tissue(U, o.name);
      o.frustumCulled = false;
      meshes[o.name] = o;
    }
  });
  meshes.valves && (meshes.valves.renderOrder = 1);
  meshes.conduction && (meshes.conduction.renderOrder = 1);
  if (meshes.body) meshes.body.renderOrder = 2;
  scene.add(gltf.scene);

  const flow = bloodFlow(meta);
  flow.points.visible = false;
  scene.add(flow.points);

  // ---- cut planes
  const L = meta.landmarks;
  const apex = v3(L.apex), mvC = v3(L.mv), tvC = v3(L.tv), pvC = v3(L.pv);
  const fourN = new THREE.Vector3().crossVectors(mvC.clone().sub(apex), tvC.clone().sub(apex)).normalize();
  if (fourN.dot(pvC.clone().sub(apex)) > 0) fourN.negate(); // keep the side away from the outflow tracts
  const CUTS = {
    front: { normal: new THREE.Vector3(0, 0, -1), base: 0.6, range: [-2.4, 3.2], view: new THREE.Vector3(0.1, 0.12, 1) },
    four: { normal: fourN, base: -fourN.dot(apex), range: [-2.2, 2.2], view: fourN.clone().negate().add(new THREE.Vector3(0, 0.15, 0)) },
    base: { normal: new THREE.Vector3(0, -1, 0), base: 1.45, range: [-1.2, 3.4], view: new THREE.Vector3(0.05, 1, 0.32) },
  };
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.6);
  let cutKey = 'front', cutOffset = 0;
  function applyCut() {
    const c = CUTS[cutKey];
    plane.normal.copy(c.normal);
    plane.constant = c.base + cutOffset;
  }

  // ---- state
  const state = { mode: 'whole', sel: -1, selAt: 0, hov: -1, playing: !reducedMotion, speed: 1, time: 0, active: true, coronary: true };
  const tween = { t: 0, dur: 0, fromP: new THREE.Vector3(), toP: new THREE.Vector3(), fromT: new THREE.Vector3(), toT: new THREE.Vector3() };
  const mix = { xray: 0, wave: 0, cut: 0, target: { xray: 0, wave: 0, cut: 0 } };
  let needs = true, last = performance.now(), raf = 0, tickCb = null, contextLost = false;

  function setMaterialsForMode() {
    const cut = state.mode === 'cut';
    Object.values(meshes).forEach((m) => {
      m.material.clippingPlanes = cut ? [plane] : null;
      m.material.needsUpdate = true;
    });
    const body = meshes.body?.material;
    if (body) {
      const ghost = state.mode === 'ecg' || state.mode === 'flow';
      body.transparent = ghost;
      body.depthWrite = !ghost;
    }
    if (meshes.coronary) meshes.coronary.visible = state.coronary && (state.mode === 'whole' || state.mode === 'cut');
    if (meshes.conduction) meshes.conduction.visible = state.mode === 'cut' || state.mode === 'ecg';
    if (meshes.valves) meshes.valves.visible = state.mode !== 'whole' || state.sel >= 0 && isValvePart(state.sel);
    flow.points.visible = state.mode === 'flow';
    mix.target.xray = state.mode === 'ecg' ? 1 : state.mode === 'flow' ? 0.85 : 0;
    mix.target.wave = state.mode === 'ecg' ? 1 : 0;
    mix.target.cut = cut ? 1 : 0;
    U.uGlow.value = state.mode === 'ecg' ? 1 : 0.6;
    controls.autoRotate = false;
    needs = true;
  }
  const VALVE_SET = new Set(['tv', 'pv', 'mv', 'av', 'chordae', 'pap_lv', 'pap_rv', 'modband'].map((id) => PARTS.indexOf(id)));
  function isValvePart(i) { return VALVE_SET.has(i); }

  // ---- sizing
  let W = 1, H = 1;
  // Pixels covered by the overlay controls at the top and bottom of the stage. The picture is
  // shifted and fitted into the space left between them instead of hiding behind them.
  const inset = { top: 0, bottom: 0 };
  function applyOffset() {
    const dy = (inset.bottom - inset.top) / 2;
    if (Math.abs(dy) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(W, H, 0, dy, W, H);
  }
  function fitDistance() {
    const free = Math.max(0.35, (H - inset.top - inset.bottom) / H);
    const vf = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * free);
    const hf = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
    return (radius * 1.02) / Math.sin(Math.min(vf, hf));
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    applyOffset();
    camera.updateProjectionMatrix();
    kick();
  }
  const homeDir = new THREE.Vector3(-0.22, 0.18, 1).normalize();
  function homePose() {
    const d = fitDistance();
    return { target: centre.clone(), pos: centre.clone().addScaledVector(homeDir, d) };
  }
  resize();
  const h0 = homePose();
  camera.position.copy(h0.pos);
  controls.target.copy(h0.target);
  controls.update();

  function flyTo(target, pos, instant) {
    if (instant || reducedMotion) {
      controls.target.copy(target);
      camera.position.copy(pos);
      controls.update();
      needs = true;
      return;
    }
    tween.fromP.copy(camera.position); tween.toP.copy(pos);
    tween.fromT.copy(controls.target); tween.toT.copy(target);
    tween.t = 0; tween.dur = 0.95;
  }
  function viewFor(dir, target, dist) {
    return { target, pos: target.clone().addScaledVector(dir.clone().normalize(), dist) };
  }

  // ---- picking: draw part ids into a tiny target around the pointer and read them back
  const pickMat = pickMaterial(U);
  const pickRT = new THREE.WebGLRenderTarget(11, 11);
  const pickBuf = new Uint8Array(11 * 11 * 4);
  function pickPass(x, y, only) {
    const hidden = [];
    Object.entries(meshes).forEach(([name, m]) => { if (m.visible && only && !only.includes(name)) { m.visible = false; hidden.push(m); } });
    const pv = flow.points.visible; flow.points.visible = false;
    pickMat.clippingPlanes = state.mode === 'cut' ? [plane] : null;
    pickMat.needsUpdate = true;
    scene.overrideMaterial = pickMat;
    camera.setViewOffset(W, H, x - 5, y - 5 + (inset.bottom - inset.top) / 2, 11, 11);
    renderer.setRenderTarget(pickRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    applyOffset();
    scene.overrideMaterial = null;
    flow.points.visible = pv;
    hidden.forEach((m) => { m.visible = true; });
    renderer.readRenderTargetPixels(pickRT, 0, 0, 11, 11, pickBuf);
    let best = -1, bestD = Infinity;
    for (let j = 0; j < 11; j++) {
      for (let i = 0; i < 11; i++) {
        const v = pickBuf[(j * 11 + i) * 4];
        if (!v) continue;
        const d = (i - 5) ** 2 + (j - 5) ** 2;
        if (d < bestD) { bestD = d; best = v - 1; }
      }
    }
    needs = true;
    return best;
  }
  function pick(clientX, clientY) {
    if (contextLost) return -1;
    const r = canvas.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    // in the glowing modes the thin inner structures win over the see-through walls
    if (state.mode === 'ecg') {
      const p = pickPass(x, y, ['conduction']);
      if (p >= 0) return p;
    }
    if (state.mode === 'flow') {
      const p = pickPass(x, y, ['valves']);
      if (p >= 0) return p;
    }
    return pickPass(x, y, null);
  }

  // ---- loop
  function frame(now) {
    raf = 0;
    if (!state.active || contextLost) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let moving = false;
    if (tween.dur > 0) {
      tween.t = Math.min(1, tween.t + dt / tween.dur);
      const e = 1 - Math.pow(1 - tween.t, 3);
      camera.position.lerpVectors(tween.fromP, tween.toP, e);
      controls.target.lerpVectors(tween.fromT, tween.toT, e);
      if (tween.t >= 1) tween.dur = 0;
      moving = true;
    }
    for (const k of ['xray', 'wave', 'cut']) {
      const d = mix.target[k] - mix[k];
      if (Math.abs(d) > 0.002) { mix[k] += d * Math.min(1, dt * (reducedMotion ? 60 : 6)); moving = true; } else mix[k] = mix.target[k];
    }
    U.uXray.value = mix.xray;
    U.uWave.value = mix.wave;
    U.uCutOn.value = mix.cut;
    if (controls.update(dt)) moving = true;
    const timed = state.mode === 'ecg' || state.mode === 'flow';
    // a paused beat needs no redraws until the scrubber or a mode change asks for one
    const animating = timed && state.playing;
    if (timed) {
      if (state.playing) state.time = (state.time + dt * 1000 * state.speed) % RR_MS;
      U.uTime.value = state.time;
      if (state.mode === 'flow' && state.playing) flow.step(dt * state.speed, state.time / RR_MS);
      tickCb?.(state.time, RR_MS);
    }
    const since = now - state.selAt;
    const pulsing = state.sel >= 0 && !reducedMotion && since < PULSE_MS;
    U.uPulse.value = pulsing ? 1 - since / PULSE_MS : 0;
    if (pulsing) U.uClock.value += dt;
    const busy = moving || animating || pulsing || controls.autoRotate;
    if (needs || busy) {
      renderer.render(scene, camera);
      needs = false;
    }
    if (busy) raf = requestAnimationFrame(frame);
    else armIdle();
  }
  // after a few quiet seconds the whole heart turns slowly by itself
  let idleTimer = 0;
  function armIdle() {
    clearTimeout(idleTimer);
    if (reducedMotion) return;
    idleTimer = setTimeout(() => {
      if (state.active && state.mode === 'whole' && state.sel < 0 && tween.dur === 0) { controls.autoRotate = true; kick(); }
    }, 5000);
  }
  function kick() {
    needs = true;
    if (!raf && state.active && !contextLost) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  controls.addEventListener('start', () => { clearTimeout(idleTimer); controls.autoRotate = false; tween.dur = 0; kick(); });
  controls.addEventListener('change', kick);

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; api.onContextChange?.(false); });
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; resize(); kick(); api.onContextChange?.(true); });

  setMaterialsForMode();
  applyCut();
  // compile every program now, so the first mode switch does not stall
  try { renderer.compile(scene, camera); } catch { /* compile is only a warm-up */ }
  kick();

  const api = {
    software,
    resize,
    pick,
    onTick(cb) { tickCb = cb; },
    setActive(on) { state.active = on; if (on) kick(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } },
    setMode(mode) { state.mode = mode; setMaterialsForMode(); kick(); },
    setCut(k, offset = cutOffset) {
      if (k && CUTS[k] && k !== cutKey) { cutKey = k; cutOffset = 0; } else cutOffset = offset;
      applyCut();
      kick();
    },
    setInsets(top, bottom) {
      inset.top = Math.max(0, top || 0);
      inset.bottom = Math.max(0, bottom || 0);
      applyOffset();
      camera.updateProjectionMatrix();
      kick();
    },
    cutInfo() { const c = CUTS[cutKey]; return { key: cutKey, offset: cutOffset, range: c.range }; },
    viewCut(k) {
      const c = CUTS[k || cutKey];
      const v = viewFor(c.view, centre.clone().add(new THREE.Vector3(0, -0.8, 0)), fitDistance() * 0.86);
      flyTo(v.target, v.pos);
      kick();
    },
    setSelected(i) {
      if (i !== state.sel) { state.selAt = performance.now(); U.uClock.value = -Math.PI / 7.2; }
      state.sel = i;
      U.uSel.value = i;
      U.uDim.value = i > 0 ? 1 : 0;
      if (meshes.valves) meshes.valves.visible = state.mode !== 'whole' || (i >= 0 && isValvePart(i));
      if (i >= 0) controls.autoRotate = false;
      kick();
    },
    setHover(i) { if (state.hov === i) return; state.hov = i; U.uHov.value = i; kick(); },
    setCoronary(on) { state.coronary = on; setMaterialsForMode(); kick(); },
    focus(id) {
      const a = meta.anchors[id];
      if (!a) { api.home(); return; }
      const target = v3(a.c);
      const dist = THREE.MathUtils.clamp(a.r * 4.2 + 7, 10, fitDistance() * 0.9);
      let dir = camera.position.clone().sub(controls.target).normalize();
      if (state.mode === 'cut') dir = CUTS[cutKey].view.clone().normalize();
      const v = viewFor(dir, target, dist);
      flyTo(v.target, v.pos);
      kick();
    },
    home(instant) { const h = homePose(); flyTo(h.target, h.pos, instant); kick(); },
    zoom(f) {
      const off = camera.position.clone().sub(controls.target).multiplyScalar(f);
      const d = THREE.MathUtils.clamp(off.length(), controls.minDistance, controls.maxDistance);
      flyTo(controls.target.clone(), controls.target.clone().add(off.setLength(d)));
      kick();
    },
    rotate(dx, dy) {
      const off = camera.position.clone().sub(controls.target);
      const s = new THREE.Spherical().setFromVector3(off);
      s.theta += dx; s.phi = THREE.MathUtils.clamp(s.phi + dy, 0.12, Math.PI - 0.12);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
      controls.update();
      kick();
    },
    setPlaying(on) { state.playing = on; kick(); },
    setSpeed(s) { state.speed = s; },
    setTime(ms) { state.time = ((ms % RR_MS) + RR_MS) % RR_MS; U.uTime.value = state.time; if (state.mode === 'flow') flow.step(0, state.time / RR_MS); kick(); },
    get time() { return state.time; },
    beatMs: RR_MS,
    debug: import.meta.env.DEV ? { renderer, scene, camera, meshes, controls, U } : null,
    snapshot() { renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
    dispose() {
      state.active = false;
      clearTimeout(idleTimer);
      if (raf) cancelAnimationFrame(raf);
      controls.dispose();
      flow.dispose();
      pickRT.dispose();
      pickMat.dispose();
      envTex.dispose();
      gltf.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      renderer.dispose();
    },
  };
  return api;
}

export { GREEN, NO_TIME };
