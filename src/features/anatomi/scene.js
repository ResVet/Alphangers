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

const KINDS = { body: 0, coronary: 1, valves: 2, conduction: 3 };

// MeshPhysicalMaterial with per-part colour, highlight, x-ray and the depolarisation wave patched in.
// The four meshes share one shader program: what differs per mesh (the cut face and x-ray of the
// body, the softer occlusion on the coronaries, the glow of the conduction system) is chosen by
// the uKind uniform, not by #defines, so the browser compiles one program instead of four.
// On phones and low-power machines the sheen lobe is left out: it is the most expensive term in
// the shader and the least visible at that screen size. Clearcoat stays, it carries the wet look.
function tissue(U, kind, lite) {
  const m = new THREE.MeshPhysicalMaterial({
    roughness: kind === 'valves' ? 0.6 : 0.52,
    metalness: 0,
    clearcoat: kind === 'conduction' ? 0.15 : 0.32,
    clearcoatRoughness: 0.42,
    sheen: lite ? 0 : 0.32,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color('#ffe2da'),
    side: THREE.DoubleSide,
  });
  m.userData.kind = kind;
  const uKind = { value: KINDS[kind] ?? 2 };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { uKind });
    sh.vertexShader = sh.vertexShader
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
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uDim, uClock, uTime, uWave, uXray, uCutOn, uGlow, uPulse, uKind;
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
        bool isBody = uKind < 0.5;
        vec3 base = vCol;
        if (isBody) base = mix(base, vec3(0.80, 0.42, 0.38), vInner * 0.35);
        vec4 diffuseColor = vec4( base, opacity );`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        // baked occlusion: full strength on bounced light, partial on direct light so the
        // grooves read as depth without the key light going flat (softer on the coronaries)
        float occ = mix(1.0, vAo, abs(uKind - 1.0) < 0.5 ? 0.45 : 0.7);
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
        if (isBody && !gl_FrontFacing) outgoingLight = mix(outgoingLight, vec3(0.42, 0.13, 0.11) * (0.75 + 0.5 * vCol.r), uCutOn);
        if (uKind > 2.5) outgoingLight = mix(outgoingLight, vCol * 0.9, 0.55 * uGlow);
        // depolarisation: a bright front, then a held glow until the tissue repolarises
        float front = waveFront(vT) * uWave;
        float held = wavePlateau(vT) * uWave;
        if (isBody) {
          // x-ray look for the walls when the inside is the point
          vec3 xr = mix(vec3(0.03, 0.07, 0.04), vec3(0.32, 0.62, 0.28), fr);
          xr += vec3(0.45, 0.85, 0.35) * held * 0.32 + vec3(0.9, 1.0, 0.8) * front * 0.75;
          outgoingLight = mix(outgoingLight, xr, uXray);
        } else {
          outgoingLight += green * front * 1.6 + green * held * 0.35;
        }
        // a short pulse right after picking, then a steady highlight (no endless redraws)
        float pulse = 0.5 + 0.5 * sin(uClock * 3.6);
        outgoingLight *= mix(1.0, 0.62, uDim * (1.0 - vSel));
        outgoingLight += vSel * green * (0.12 + 0.1 * pulse * uPulse + fr * 0.75);
        outgoingLight += vHov * (1.0 - vSel) * vec3(0.09, 0.11, 0.08);
        #include <opaque_fragment>
        if (isBody) gl_FragColor.a = mix(gl_FragColor.a, clamp(0.035 + 0.42 * fr + 0.5 * front + 0.12 * held, 0.0, 1.0), uXray);`);
  };
  // same source for every kind, so one cache key: the program is built once and shared
  m.customProgramCacheKey = () => 'heart-tissue';
  return m;
}

// The see-through body of the electrical and blood-flow views. The physical material spent most
// of its time on lighting (environment reflections, clearcoat) that the x-ray look then painted
// over, once per layer of wall behind every pixel. This draws the same picture directly: a
// simple lit surface that fades into the x-ray rim, the wave and the selection highlight.
function ghostMaterial(U) {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U, uLight: { value: new THREE.Vector3(-0.42, 0.55, 0.72).normalize() } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute float _part;
      attribute float _t;
      attribute float _ao;
      uniform vec3 uCol[${N}];
      uniform float uVis[${N}];
      uniform float uSel, uHov;
      varying vec3 vCol, vN, vV;
      varying float vInner, vSel, vHov, vT, vAo;
      void main() {
        float pid = _part;
        vInner = step(127.5, pid);
        pid -= 128.0 * vInner;
        int ip = int(pid + 0.5);
        vCol = uCol[ip];
        vSel = 1.0 - step(0.5, abs(pid - uSel));
        vHov = 1.0 - step(0.5, abs(pid - uHov));
        vT = _t;
        vAo = _ao;
        vec4 mv = modelViewMatrix * vec4(position * step(0.5, uVis[ip]), 1.0);
        vV = -mv.xyz;
        vN = normalMatrix * normal;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uDim, uClock, uTime, uWave, uXray, uPulse;
      uniform vec3 uLight;
      varying vec3 vCol, vN, vV;
      varying float vInner, vSel, vHov, vT, vAo;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(vV);
        float fr = pow(1.0 - abs(dot(n, v)), 2.2);
        vec3 nf = gl_FrontFacing ? n : -n;
        vec3 base = mix(vCol, vec3(0.80, 0.42, 0.38), vInner * 0.35);
        float occ = mix(1.0, vAo, 0.6);
        vec3 lit = base * (0.32 + 0.68 * max(dot(nf, uLight), 0.0)) * occ;
        float age = uTime - vT;
        bool timed = vT < 60000.0;
        float front = timed ? exp(-(age * age) / 300.0) * uWave : 0.0;
        float hold = vT < 150.0 ? 210.0 : 250.0;
        float held = timed ? smoothstep(0.0, 8.0, age) * (1.0 - smoothstep(hold, hold + 90.0, age)) * uWave : 0.0;
        vec3 xr = mix(vec3(0.03, 0.07, 0.04), vec3(0.32, 0.62, 0.28), fr);
        xr += vec3(0.45, 0.85, 0.35) * held * 0.32 + vec3(0.9, 1.0, 0.8) * front * 0.75;
        vec3 col = mix(lit, xr, uXray);
        vec3 green = vec3(0.53, 0.95, 0.37);
        float pulse = 0.5 + 0.5 * sin(uClock * 3.6);
        col *= mix(1.0, 0.62, uDim * (1.0 - vSel));
        col += vSel * green * (0.12 + 0.1 * pulse * uPulse + fr * 0.75);
        col += vHov * (1.0 - vSel) * vec3(0.09, 0.11, 0.08);
        float a = mix(1.0, clamp(0.035 + 0.42 * fr + 0.5 * front + 0.12 * held, 0.0, 1.0), uXray);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
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

// Hands the main thread back between the heavy setup steps, so taps and scrolling are not
// blocked for the whole of loading. scheduler.yield where available, a macrotask elsewhere.
const yieldNow = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0)));

export async function createScene(canvas, { meta, url, onProgress, reducedMotion = false, lowPower = false, touch = false }) {
  // Full resolution for still frames. While the heart moves, frames render at motionDpr, which
  // the frame timer below lowers on a slow GPU and raises again when there is headroom; the
  // first quiet frame after a movement is redrawn at full resolution.
  let dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 2, alpha: true, powerPreference: 'high-performance' });
  // Without a usable GPU the browser falls back to drawing WebGL on the CPU. The model still
  // works there, but only at a lower resolution and without the idle spin.
  const software = isSoftwareGL(renderer.getContext());
  if (software) { dpr = Math.min(dpr, 0.75); reducedMotion = true; }
  const lite = touch || lowPower || software;
  const minDpr = Math.min(dpr, software ? 0.5 : 0.75);
  let motionDpr = Math.min(dpr, touch ? 1.25 : lowPower ? 1 : 1.5);
  let curDpr = dpr;
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  await yieldNow();
  // Two ways to light the studio. Full: reflections of a soft room, the wet look on the muscle.
  // Light: the same room boiled down to an ambient probe plus one more highlight light, about
  // half the cost per pixel. Phones and low-power machines start light; a computer switches once
  // if even the lowest resolution cannot keep up (see timeFrame).
  let envTex = null;
  const ENV_INTENSITY = 0.55;
  const probe = new THREE.LightProbe();
  const spec = new THREE.DirectionalLight('#ffffff', 1.6);
  spec.position.set(4, 10, 26);
  // The room's light as 9 spherical harmonics, worked out once from the same RoomEnvironment
  // (LightProbeGenerator on a 128 px cube). It is grey, so one number per band.
  const ROOM_SH = [1.7114, 0.1481, -0.0014, 0.1213, 0.0796, -0.0437, -0.1706, 0.0246, -0.4931];
  ROOM_SH.forEach((v, i) => probe.sh.coefficients[i].setScalar(v));
  probe.intensity = ENV_INTENSITY * 2.5;
  async function lightRig() {
    scene.environment = null;
    scene.add(probe, spec);
    if (envTex) { envTex.dispose(); envTex = null; }
  }
  let lightLook = lite;
  if (lite) await lightRig();
  else {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = ENV_INTENSITY;
    pmrem.dispose();
  }
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
  // On a touch screen the stage must not trap the page: one finger sideways turns the heart,
  // one finger up or down scrolls the page as usual, two fingers zoom and tilt. Fullscreen
  // hands every gesture to the heart (setTouchScroll(false)).
  if (touch) {
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    canvas.style.touchAction = 'pan-y';
  }

  const U = shared(meta);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await yieldNow();
  const gltf = await loader.loadAsync(url, (e) => { if (e.total) onProgress?.(e.loaded / e.total); });
  await yieldNow();
  const meshes = {};
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      o.material = tissue(U, o.name, lite);
      o.frustumCulled = false;
      meshes[o.name] = o;
    }
  });
  meshes.valves && (meshes.valves.renderOrder = 1);
  meshes.conduction && (meshes.conduction.renderOrder = 1);
  if (meshes.body) meshes.body.renderOrder = 2;
  scene.add(gltf.scene);

  await yieldNow();
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
  // Every material keeps this one clipping plane for its whole life. Outside the cut view it is
  // parked far away, so it clips nothing, and switching views never changes a shader program
  // (adding or removing a plane would recompile all of them, a visible stall on some GPUs).
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.6);
  const PARKED = 1e5;
  let cutKey = 'front', cutOffset = 0;
  function applyCut() {
    const c = CUTS[cutKey];
    plane.normal.copy(c.normal);
    plane.constant = state.mode === 'cut' ? c.base + cutOffset : PARKED;
  }

  Object.values(meshes).forEach((m) => { m.material.clippingPlanes = [plane]; });

  // ---- state
  const state = { mode: 'whole', sel: -1, selAt: 0, hov: -1, playing: !reducedMotion, speed: 1, time: 0, active: true, coronary: true };
  const tween = { t: 0, dur: 0, fromP: new THREE.Vector3(), toP: new THREE.Vector3(), fromT: new THREE.Vector3(), toT: new THREE.Vector3() };
  const mix = { xray: 0, wave: 0, cut: 0, target: { xray: 0, wave: 0, cut: 0 } };
  let needs = true, last = performance.now(), raf = 0, tickCb = null, contextLost = false;

  const ghost = ghostMaterial(U);
  const solid = meshes.body?.material;
  const isGhost = () => state.mode === 'ecg' || state.mode === 'flow';
  function setMaterialsForMode() {
    const cut = state.mode === 'cut';
    applyCut();
    // into the see-through views the light ghost material takes over at once; on the way out it
    // stays until the x-ray has faded, then the solid material comes back (see frame())
    if (meshes.body && isGhost()) meshes.body.material = ghost;
    // the cut needs the solid material's clipping straight away, so that one switch is immediate
    if (meshes.body && cut && meshes.body.material === ghost) { meshes.body.material = solid; mix.xray = 0; U.uXray.value = 0; }
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

  // ---- picking: draw part ids into a tiny target around the pointer and read them back.
  // The read is asynchronous (a fence, not glReadPixels on the spot), so hovering never makes the
  // CPU wait for the GPU to finish the frame. One pick runs at a time; a hover that arrives while
  // one is in flight replaces the queued position instead of piling up.
  const pickMat = pickMaterial(U);
  pickMat.clippingPlanes = [plane];
  const pickRT = new THREE.WebGLRenderTarget(11, 11);
  const pickBuf = new Uint8Array(11 * 11 * 4);
  function pickRender(x, y, only) {
    const hidden = [];
    Object.entries(meshes).forEach(([name, m]) => { if (m.visible && only && !only.includes(name)) { m.visible = false; hidden.push(m); } });
    const pv = flow.points.visible; flow.points.visible = false;
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
  }
  function nearest() {
    let best = -1, bestD = Infinity;
    for (let j = 0; j < 11; j++) {
      for (let i = 0; i < 11; i++) {
        const v = pickBuf[(j * 11 + i) * 4];
        if (!v) continue;
        const d = (i - 5) ** 2 + (j - 5) ** 2;
        if (d < bestD) { bestD = d; best = v - 1; }
      }
    }
    return best;
  }
  async function pickPass(x, y, only) {
    pickRender(x, y, only);
    if (renderer.readRenderTargetPixelsAsync) await renderer.readRenderTargetPixelsAsync(pickRT, 0, 0, 11, 11, pickBuf);
    else renderer.readRenderTargetPixels(pickRT, 0, 0, 11, 11, pickBuf);
    return nearest();
  }
  let picking = null;
  async function pickNow(clientX, clientY) {
    if (contextLost) return -1;
    const r = canvas.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    // in the glowing modes the thin inner structures win over the see-through walls
    if (state.mode === 'ecg') {
      const p = await pickPass(x, y, ['conduction']);
      if (p >= 0) return p;
    }
    if (state.mode === 'flow') {
      const p = await pickPass(x, y, ['valves']);
      if (p >= 0) return p;
    }
    return pickPass(x, y, null);
  }
  // resolves with the part index under the point, or -1
  function pick(clientX, clientY) {
    const run = (picking || Promise.resolve()).then(() => pickNow(clientX, clientY)).catch(() => -1);
    picking = run.finally(() => { if (picking === tail) picking = null; });
    const tail = picking;
    return run;
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
    if (meshes.body && meshes.body.material === ghost && !isGhost() && mix.xray < 0.004) { meshes.body.material = solid; moving = true; }
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
    // the slow idle spin alone is drawn at half the frame rate: it looks the same and the GPU
    // (and a phone's battery) does half the work while someone reads the notes beside it
    const spinOnly = controls.autoRotate && tween.dur === 0 && !animating && !pulsing && !dragging;
    if (spinOnly && !needs) {
      spinSkip = !spinSkip;
      if (spinSkip) { raf = requestAnimationFrame(frame); return; }
    }
    if (needs || busy) {
      setDpr(busy ? motionDpr : dpr);
      renderer.render(scene, camera);
      needs = false;
      if (busy) timeFrame(dt);
    }
    if (busy) raf = requestAnimationFrame(frame);
    else {
      // the movement ended: one sharp frame at full resolution
      if (curDpr !== dpr) { setDpr(dpr); renderer.render(scene, camera); }
      samples.length = 0;
      armIdle();
    }
  }
  function setDpr(v) {
    if (v === curDpr) return;
    curDpr = v;
    renderer.setPixelRatio(v);
    renderer.setSize(W, H, false);
  }
  // Median frame interval over the last 12 moving frames picks the resolution for the next ones.
  const samples = [];
  let backoffs = 0;
  function timeFrame(dt) {
    if (software) return;
    samples.push(dt);
    if (samples.length < 12) return;
    const med = samples.sort((a, b) => a - b)[6];
    samples.length = 0;
    if (med > 0.021 && motionDpr > minDpr) {
      motionDpr = Math.max(minDpr, Math.round(motionDpr * 0.8 * 100) / 100);
      backoffs++;
    } else if (med > 0.028 && !lightLook) {
      // already at the lowest resolution and still slow: trade the reflections for speed, once
      lightLook = true;
      lightRig().then(() => {
        Object.values(meshes).forEach((m) => { if (m.material !== ghost) m.material.needsUpdate = true; });
        solid && (solid.needsUpdate = true);
        kick();
      });
    } else if (med < 0.0155 && motionDpr < dpr && backoffs < 4) {
      motionDpr = Math.min(dpr, Math.round(motionDpr * 1.12 * 100) / 100);
    }
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
  let dragging = false, spinSkip = false;
  controls.addEventListener('start', () => { dragging = true; clearTimeout(idleTimer); controls.autoRotate = false; tween.dur = 0; kick(); });
  controls.addEventListener('end', () => { dragging = false; });
  controls.addEventListener('change', kick);

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; api.onContextChange?.(false); });
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; resize(); kick(); api.onContextChange?.(true); });

  // Compile every program the views will need while the loading bar is still up: the solid
  // tissue, the see-through body, the blood particles and the picking shader. compileAsync lets the driver build them in
  // parallel off the main thread where it can (KHR_parallel_shader_compile).
  async function warm() {
    const parallel = renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile');
    const compile = (fn) => (parallel ? renderer.compileAsync(scene, camera) : Promise.resolve(renderer.compile(scene, camera))).then(fn, fn);
    // everything visible at once, so every program is built now rather than on a first switch
    flow.points.visible = true;
    const shown = Object.values(meshes).map((m) => [m, m.visible]);
    shown.forEach(([m]) => { m.visible = true; });
    await compile(() => {});
    await yieldNow();
    if (meshes.body) {
      meshes.body.material = ghost;
      await compile(() => {});
      meshes.body.material = solid;
      await yieldNow();
    }
    shown.forEach(([m, v]) => { m.visible = v; });
    pickRender(W / 2, H / 2, null);
  }
  try { await warm(); } catch { /* only a warm-up */ }
  setMaterialsForMode();
  kick();

  const api = {
    software,
    resize,
    pick,
    onTick(cb) { tickCb = cb; },
    setActive(on) { state.active = on; if (on) kick(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } },
    setTouchScroll(on) { if (touch) canvas.style.touchAction = on ? 'pan-y' : 'none'; },
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
      envTex?.dispose();
      gltf.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      ghost.dispose();
      solid?.dispose();
      renderer.dispose();
    },
  };
  return api;
}

export { GREEN, NO_TIME };
