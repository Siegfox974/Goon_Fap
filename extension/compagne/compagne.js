/* Compagne 3D : un modèle VRM (dossier modele/ de l'extension) affiché par-dessus la vidéo.
 * Elle bouge au rythme des beats, change d'expression selon le moment, « parle » avec la voix,
 * et peut se déshabiller au fil de la séance. Tout est animé par programme (aucune animation externe). */
import * as THREE from './lib/three.module.js';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from './lib/three-vrm.module.js';
import { nudify, clothes } from './nudify.js';

const cfg = { nude: 'strip', frame: 'buste' }; // nude : 'nue' | 'strip' | 'habillee' ; frame : 'buste' | 'entiere'
const st = { e: 0, phase: 0, lastBeat: 0, period: 600, mood: 'warm', state: 'play', talkUntil: 0, cumUntil: 0, stage: 0 };
let vrm = null, renderer, scene, camera, clock, skin = null, origTex = null, nudeRep = null, wear = [];

const post = m => parent.postMessage(Object.assign({ gf: 'compagne' }, m), '*');

async function findModel() {
  const files = await GF.listDir('modele');
  return files.find(f => /\.vrm$/i.test(f)) || null;
}

function setupScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  document.body.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const key = new THREE.DirectionalLight(0xffe0f0, 1.4); key.position.set(1, 2, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0xff5aa8, 0.9); rim.position.set(-2, 1.5, -1); scene.add(rim); // contre-jour rose
  camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.05, 30);
  clock = new THREE.Clock();
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); frame(); });
}

const B = n => vrm && (vrm.humanoid.getNormalizedBoneNode(n));
function boneY(n) { const b = B(n); const v = new THREE.Vector3(); if (b) b.getWorldPosition(v); return v; }

function frame() {
  if (!vrm) return;
  vrm.scene.updateMatrixWorld(true);
  const head = boneY('head'), hips = boneY('hips'), foot = boneY('leftFoot');
  const top = head.y + 0.16, bottom = cfg.frame === 'entiere' ? Math.min(foot.y, 0) - 0.05 : hips.y - 0.28;
  const h = top - bottom, cy = (top + bottom) / 2;
  const dist = (h / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
  camera.position.set(0, cy + h * 0.02, dist);
  camera.lookAt(0, cy, 0);
  window.__frame = { head: head.toArray().map(x => +x.toFixed(2)), hips: hips.toArray().map(x => +x.toFixed(2)), foot: foot.toArray().map(x => +x.toFixed(2)), size: [innerWidth, innerHeight], cam: camera.position.toArray().map(x => +x.toFixed(2)) };
}

// ---------- Déshabillage ----------
function applyWear() {
  if (!vrm) return;
  const n = cfg.nude === 'nue' ? wear.length : cfg.nude === 'habillee' ? 0 : Math.min(st.stage, wear.length);
  wear.forEach((w, i) => { w.mesh.visible = i >= n; });
  const naked = n >= wear.length;
  if (nudeRep && nudeRep.ok) setSkin(naked);
}
function setSkin(naked) {
  for (const m of skin.mats) {
    const t = naked ? nudeRep.tex : origTex.get(m);
    if (m.map !== t) { m.map = t; if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = t; m.needsUpdate = true; }
  }
}
// Groupes de vêtements : une étape = un type de pièce (toutes les parties de la robe partent ensemble)
function groupWear(items) {
  const groups = [];
  for (const it of items) { let g = groups.find(x => x.rank === it.rank); if (!g) groups.push(g = { rank: it.rank, meshes: [] }); g.meshes.push(it.mesh); }
  return groups.map(g => ({ mesh: { set visible(v) { g.meshes.forEach(m => { m.visible = v; }); } } }));
}
function stripMore(why) {
  if (cfg.nude !== 'strip' || st.stage >= wear.length) return;
  st.stage++;
  applyWear();
  post({ type: 'stripped', stage: st.stage, total: wear.length, why });
}

async function load() {
  setupScene();
  const path = await findModel();
  if (!path) { post({ type: 'ready', ok: false }); return; }
  const loader = new GLTFLoader();
  loader.register(p => new VRMLoaderPlugin(p));
  const url = chrome.runtime.getURL(path.split('/').map(encodeURIComponent).join('/'));
  const gltf = await loader.loadAsync(url);
  vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  scene.add(vrm.scene);
  vrm.update(0);
  // peau nue préparée une fois (en mémoire), appliquée quand elle est entièrement déshabillée
  const mats = []; vrm.scene.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (/body.*skin/i.test(m.name || '')) mats.push(m); }); });
  skin = { mats: [...new Set(mats)] };
  origTex = new Map(skin.mats.map(m => [m, m.map]));
  try { nudeRep = await nudify(vrm, renderer); if (nudeRep.ok) { nudeRep.tex = skin.mats[0].map; setSkin(false); } } catch (e) { nudeRep = null; }
  wear = groupWear(clothes(vrm));
  if (vrm.lookAt) vrm.lookAt.target = camera;
  restPose();
  frame();
  applyWear();
  const meta = vrm.meta || {};
  post({ type: 'ready', ok: true, name: meta.name || meta.title || path.split('/').pop(), author: (meta.authors && meta.authors.join(', ')) || meta.author || '', wear: wear.length, nude: !!(nudeRep && nudeRep.ok) });
  requestAnimationFrame(loop);
}

// ---------- Pose et animation ----------
function restPose() {
  const set = (n, x, y, z) => { const b = B(n); if (b) b.rotation.set(x, y, z); };
  set('leftUpperArm', 0, 0, 1.15); set('rightUpperArm', 0, 0, -1.15);
  set('leftLowerArm', 0, -0.25, 0); set('rightLowerArm', 0, 0.25, 0);
}
const EXP = ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh', 'blink'];
const target = {}; EXP.forEach(k => { target[k] = 0; });
const cur = {}; EXP.forEach(k => { cur[k] = 0; });
let nextBlink = 2;

function moodTargets(t) {
  EXP.forEach(k => { target[k] = 0; });
  const fast = st.mood === 'fast' || st.mood === 'faster';
  if (st.state === 'cum' && t < st.cumUntil) { target.happy = 0.9; target.oh = 0.8; target.blink = 0.55; return; }
  if (st.state === 'pause' || st.state === 'edge') { target.angry = 0.45; target.happy = 0.25; return; } // moue taquine
  if (st.state === 'final') { target.surprised = 0.3; target.oh = 0.35; target.blink = 0.3; return; }
  if (fast) { target.happy = 0.35; target.oh = 0.25 + 0.4 * st.e; target.blink = 0.35; }
  else if (st.mood === 'medium') { target.happy = 0.5; target.aa = 0.12 + 0.25 * st.e; }
  else { target.relaxed = 0.6; target.happy = 0.2; }
}

function loop() {
  requestAnimationFrame(loop);
  try { step(); } catch (e) { window.__loopErr = String(e && e.stack || e); }
}
function step() {
  // le cadre peut changer de taille (affiché après coup, réglages…) : on suit
  const sz = renderer.getSize(new THREE.Vector2());
  if (innerWidth > 0 && innerHeight > 0 && (sz.x !== innerWidth || sz.y !== innerHeight)) {
    renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); frame();
  }
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
  st.e *= Math.pow(0.004, dt);                        // impulsion du beat qui retombe vite
  const sinceBeat = performance.now() - st.lastBeat;
  const active = sinceBeat < Math.max(2500, st.period * 2.5) && st.state !== 'pause';
  const amp = active ? (st.mood === 'fast' ? 1 : st.mood === 'medium' ? 0.75 : 0.5) : 0.15;
  const ph = active ? Math.min(1, sinceBeat / Math.max(120, st.period)) : 0;
  const stroke = Math.sin(ph * Math.PI * 2) * amp;      // va-et-vient calé sur le beat

  const hips = B('hips'), spine = B('spine'), chest = B('chest') || B('upperChest'), neck = B('neck'), head = B('head');
  const breathe = Math.sin(t * 1.6) * 0.02;
  if (hips) { hips.rotation.x = -0.10 * st.e * amp + 0.04 * stroke; hips.rotation.y = Math.sin(t * 0.7) * 0.05; hips.rotation.z = Math.sin(t * 0.9) * 0.04 * amp; hips.position.y = -0.025 * st.e * amp; }
  if (spine) spine.rotation.x = 0.06 * st.e * amp + breathe;
  if (chest) chest.rotation.x = 0.04 * st.e * amp - breathe * 0.5;
  if (neck) neck.rotation.x = -0.03 * st.e * amp;
  if (head) { head.rotation.z = Math.sin(t * 0.5) * 0.06; head.rotation.x = 0.04 * Math.sin(t * 0.8); }
  // bras droit : geste de va-et-vient (comme si elle te branlait) quand ça tourne
  const ru = B('rightUpperArm'), rl = B('rightLowerArm'), rh = B('rightHand');
  if (ru && rl) {
    const k = active && st.state !== 'edge' ? 1 : 0;
    ru.rotation.set(-0.55 * k + 0.12 * stroke * k, 0.25 * k, -1.15 + 0.55 * k);
    rl.rotation.set(0, 0.25 + 1.2 * k + 0.35 * stroke * k, 0);
    if (rh) rh.rotation.set(0, 0, 0.3 * k);
  }
  const lu = B('leftUpperArm');
  if (lu) lu.rotation.set(0, 0, 1.15 - 0.08 * Math.sin(t * 1.1));

  // expressions + clignements + bouche quand elle parle
  moodTargets(t);
  if (t > nextBlink) { target.blink = 1; if (t > nextBlink + 0.12) nextBlink = t + 2 + Math.random() * 3; }
  if (performance.now() < st.talkUntil) {
    const s = Math.abs(Math.sin(t * 13)) * 0.6 + Math.abs(Math.sin(t * 7.3)) * 0.3;
    target.aa = Math.max(target.aa, s * 0.7); target.oh = Math.max(target.oh, (1 - s) * 0.3);
  }
  const em = vrm.expressionManager;
  if (em) EXP.forEach(k => { cur[k] += (target[k] - cur[k]) * Math.min(1, dt * (k === 'blink' ? 30 : 10)); try { em.setValue(k, cur[k]); } catch (e) {} });
  vrm.update(dt);
  renderer.render(scene, camera);
}

// ---------- Messages de GoonFap ----------
addEventListener('message', e => {
  const m = e.data; if (!m || m.gf !== 'c') return;
  switch (m.type) {
    case 'cfg':
      Object.assign(cfg, m.cfg);
      if (m.cfg.nude === 'strip' && m.reset) st.stage = 0;
      frame(); applyWear(); break;
    case 'beat': {
      const now = performance.now(), iv = now - st.lastBeat;
      if (iv > 80 && iv < 2500) st.period = st.period * 0.6 + iv * 0.4;
      st.lastBeat = now; st.e = Math.min(1.4, st.e + (m.s || 1)); if (st.state === 'pause') st.state = 'play';
      break;
    }
    case 'mood': st.mood = m.kind; break;
    case 'state':
      if (m.state === 'resume') { st.state = 'play'; stripMore('reprise'); }
      else if (m.state === 'edge') { st.state = 'edge'; stripMore('au bord'); }
      else if (m.state === 'final') { st.state = 'final'; st.stage = wear.length; applyWear(); }
      else if (m.state === 'cum') { st.state = 'cum'; st.cumUntil = clock.elapsedTime + 7; st.stage = wear.length; applyWear(); }
      else st.state = m.state;
      break;
    case 'strip': stripMore(m.why || 'temps'); break;
    case 'talk': st.talkUntil = performance.now() + Math.min(9000, m.ms || 2000); break;
  }
});

load().catch(err => post({ type: 'ready', ok: false, error: String(err && err.message || err) }));
