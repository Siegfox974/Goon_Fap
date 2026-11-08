/* Compagne 3D : un modèle VRM (dossier modele/ de l'extension) affiché par-dessus la vidéo.
 * Elle bouge au rythme des beats, change d'expression selon le moment, « parle » avec la voix,
 * et peut se déshabiller au fil de la séance. Tout est animé par programme (aucune animation externe). */
import * as THREE from './lib/three.module.js';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from './lib/three-vrm.module.js';
import { nudify, clothes } from './nudify.js';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from './lib/three-vrm-animation.module.js';
import * as P from './poses.js';
import * as VMD from './vmd.js';
import { loadPmx, loadVmdFor } from './pmxrig.js';

// nude : 'nue' | 'strip' | 'habillee' ; frame : 'buste' | 'entiere'
// scene : 'auto' | 'danse' | 'masturbation' | 'fellation' ; view : 'pov' | 'cote'
const cfg = { nude: 'strip', frame: 'buste', scene: 'auto', view: 'pov', model: '', anim: '', animScenes: {} };
const st = { e: 0, phase: 0, lastBeat: 0, period: 600, mood: 'warm', state: 'play', talkUntil: 0, cumUntil: 0, stage: 0,
  pos: null, posAt: 0, scene: 'danse', sceneSince: 0 };
let M = null, F = null, R = null;            // mesures du modèle, fellation (sexe masculin), chevauche (gode)
const anims = {};                             // animations .vrma par scène (dossier animations/)
let mixer = null, action = null, actionScene = null;
let feetRest = null, vmdCur = null, vmdTime = 0;            // animation MMD en cours
let pmxMixer = null, pmxPlaying = null, resetPhys = false;    // modèle MMD : lecture native des .vmd, physique
let licenceOk = true; // la licence du modèle autorise-t-elle la nudité / le sexe ?
let vrm = null, renderer, scene, camera, clock, skin = null, origTex = null, nudeRep = null, wear = [];

const post = m => parent.postMessage(Object.assign({ gf: 'compagne' }, m), '*');

// Modèles disponibles : .vrm ou .pmx (MMD, avec ses textures dans le même dossier)
async function findModel() {
  try {
    const r = await chrome.storage.local.get('settings');
    if (r.settings && r.settings.compModel) cfg.model = r.settings.compModel;
    if (r.settings && r.settings.animScenes) cfg.animScenes = r.settings.animScenes; // scènes choisies à la main dans le popup
    if (r.settings) cfg.physics = r.settings.compPhysics !== false;
  } catch (e) {}
  const files = (await GF.listDir('modele')).filter(f => /\.(vrm|pmx)$/i.test(f));
  const want = files.find(f => f === cfg.model);
  return want || files[0] || null;
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
  camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.05, 30); // réglée sur la taille du modèle au chargement
  clock = new THREE.Clock();
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); frame(); });
}

const B = n => vrm && (vrm.humanoid.getNormalizedBoneNode(n));
function boneY(n) { const b = B(n); const v = new THREE.Vector3(); if (b) b.getWorldPosition(v); return v; }

function frame() {
  if (!vrm) return;
  vrm.scene.updateMatrixWorld(true);
  const head = boneY('head'), hips = boneY('hips'), foot = boneY('leftFoot');
  const s = M ? M.s : 1;
  const top = head.y + 0.16 * s, bottom = cfg.frame === 'entiere' ? Math.min(foot.y, 0) - 0.05 * s : hips.y - 0.28 * s;
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
  for (const it of items) { let g = groups.find(x => x.rank === it.rank); if (!g) groups.push(g = { rank: it.rank, meshes: [] }); g.meshes.push(it.mesh || it.mat); }
  return groups.map(g => ({ mesh: { set visible(v) { g.meshes.forEach(m => { m.visible = v; }); } } }));
}
function stripMore(why) {
  if (cfg.nude !== 'strip' || st.stage >= wear.length) return;
  st.stage++;
  applyWear();
  post({ type: 'stripped', stage: st.stage, total: wear.length, why });
}

// ---------- Animations d'artistes (.vrma, dossier animations/) ----------
const sceneOf = f => { const m = cfg.animScenes[f]; return m === 'ignorer' ? null : (m || SCENE_OF(f)); };
const SCENE_OF = f => /mastur|fap|finger|touch|rub|solo/i.test(f) ? 'masturbation' : /blow|fella|suck|bj|oral|pipe/i.test(f) ? 'fellation'
  : /ride|riding|chevauch|dildo|gode|cowgirl/i.test(f) ? 'chevauche' : /twerk/i.test(f) ? 'twerk' : /dance|danse|idle|tease|strip/i.test(f) ? 'danse' : null;
async function loadAnims(loader) {
  const all = await GF.listDir('animations');
  // animations MMD (.vmd)
  const ignored = all.filter(x => /\.(vmd|vrma)$/i.test(x) && !sceneOf(x) && cfg.animScenes[x] !== 'ignorer');
  if (ignored.length) post({ type: 'anim-ignored', files: ignored.map(f => f.split('/').pop()) });
  for (const f of all.filter(x => /\.vmd$/i.test(x))) {
    const sc = sceneOf(f); if (!sc) continue;
    try {
      const buf = await (await fetch(chrome.runtime.getURL(f.split('/').map(encodeURIComponent).join('/')))).arrayBuffer();
      const clip = VMD.parseVmd(buf); clip.name = f.split('/').pop(); clip.path = f;
      if (vrm.isPmx) clip.pmxClip = await loadVmdFor(vrm, chrome.runtime.getURL(f.split('/').map(encodeURIComponent).join('/'))); // lecture native
      (anims[sc] = anims[sc] || []).push({ vmd: clip });
    } catch (e) { post({ type: 'anim-error', file: f, error: String(e && e.message || e) }); }
  }
  if (Object.values(anims).some(l => l.some(a => a.vmd))) { if (!vrm.isPmx) feetRest = VMD.restFeet(vrm, M); else pmxMixer = new THREE.AnimationMixer(vrm.mesh); restPose(); post({ type: 'anims', scenes: Object.keys(anims), list: Object.entries(anims).map(([k, l]) => k + ':' + l.map(a => a.vmd ? a.vmd.name + (a.vmd.cycle ? ' (cycle ' + a.vmd.cycle.toFixed(2) + ' s)' : '') + (a.vmd.pmxClip && a.vmd.pmxClip.userData.missing.length ? ` [${a.vmd.pmxClip.userData.missing.length}/${a.vmd.pmxClip.userData.used} os absents du modèle : ${a.vmd.pmxClip.userData.missing.slice(0, 12).join(' ')}]` : '') : 'vrma').join(',')) }); }
  const files = all.filter(f => /\.vrma$/i.test(f));
  if (!files.length || vrm.isPmx) return; // .vrma : modèles VRM seulement
  const l = new GLTFLoader(); l.register(p => new VRMAnimationLoaderPlugin(p));
  for (const f of files) {
    const sc = sceneOf(f); if (!sc) continue;
    try {
      const g = await l.loadAsync(chrome.runtime.getURL(f.split('/').map(encodeURIComponent).join('/')));
      const va = g.userData.vrmAnimations && g.userData.vrmAnimations[0];
      if (va) (anims[sc] = anims[sc] || []).push({ vrma: createVRMAnimationClip(va, vrm) });
    } catch (e) {}
  }
  if (Object.values(anims).some(l => l.some(a => a.vrma))) mixer = new THREE.AnimationMixer(vrm.scene);
}

// Pose une image d'une animation MMD : native sur un modèle MMD, adaptée sur un VRM
function poseVmd(clip, f) {
  if (vrm.isPmx && clip.pmxClip) {
    vrm.resetAll();
    if (pmxPlaying !== clip) { pmxMixer.stopAllAction(); clip.action = clip.action || pmxMixer.clipAction(clip.pmxClip); clip.action.play(); pmxPlaying = clip; }
    clip.action.time = (f / 30) % clip.pmxClip.duration; pmxMixer.update(0);
    vrm.solve(true);                                   // IK des jambes + os automatiques
    return null;                                        // les mimiques sont posées par l'animation elle-même
  }
  return VMD.applyVmd(vrm, M, clip, f, feetRest);
}

// Accessoire (sexe / gode) placé d'après le mouvement réel d'une animation MMD
function vmdSpan(clip) { return Math.min(clip.frames, clip.cycle ? Math.round(clip.cycle * 30 * 2) : clip.frames); }
function setupVmdProp(sc, clip) {
  if (clip.prop !== undefined) return clip.prop;
  const n = 24, span = vmdSpan(clip), pts = [], fwd = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    poseVmd(clip, (i / n) * span);
    if (sc === 'fellation') {
      pts.push(P.mouthPos(vrm, M).clone());
      const h = P.bone(vrm, 'head'); fwd.add(new THREE.Vector3(0, 0, vrm.noFlip ? 1 : -1).transformDirection(h.matrixWorld));
    } else pts.push(P.crotchPos(vrm, M).clone());
  }
  let prop = null;
  if (sc === 'fellation') {
    const axis = fwd.normalize();                       // devant son visage
    let mn = Infinity, mx = -Infinity, shallow = pts[0];
    for (const p of pts) { const d = p.dot(axis); if (d < mn) mn = d; if (d > mx) { mx = d; } }
    // pointe : là où sa bouche recule le plus ; le sexe s'étend vers l'avant
    shallow = pts.reduce((a, p) => (p.dot(axis) < a.dot(axis) ? p : a));
    const len = Math.max(0.15 * M.s, (mx - mn) + 0.08 * M.s);
    const g = P.penisMesh(M, len); g.position.copy(shallow); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    scene.add(g); prop = { group: g, tip: shallow.clone(), base: shallow.clone().addScaledVector(axis, len), axis };
  } else if (sc === 'chevauche') {
    const top = pts.reduce((a, p) => (p.y > a.y ? p : a));
    const axis = new THREE.Vector3(0, -1, 0), len = Math.max(0.14 * M.s, top.y);
    const g = P.dildoMesh(M, len); g.position.copy(top); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    scene.add(g); prop = { group: g, tip: top.clone(), base: top.clone().addScaledVector(axis, len), axis };
  }
  clip.prop = prop;
  return prop;
}

// ---------- Choix de la scène ----------
const naked = () => cfg.nude === 'nue' || st.stage >= wear.length;
// animation choisie à la main (bouton ▶ du popup) : sa scène, et elle seule
function forcedAnim() {
  if (!cfg.anim) return null;
  for (const [sc, list] of Object.entries(anims)) { const a = list.find(x => x.vmd && x.vmd.path === cfg.anim); if (a) return { sc, clip: a.vmd }; }
  return null;
}
function wantedScene(now) {
  if (!licenceOk) return 'danse';
  const fa = forcedAnim(); if (fa) return fa.sc;
  if (cfg.scene !== 'auto') return cfg.scene;
  if (st.state === 'pause' || st.state === 'edge') return st.scene === 'danse' ? 'danse' : st.scene; // elle se fige, la moue aux lèvres
  if (cfg.nude === 'habillee' || !naked()) return 'danse';                                           // d'abord le strip-tease
  if (st.state === 'final' || st.state === 'cum') return 'fellation';
  // rythme rapide : elle alterne fellation / chevauche ; moyen : masturbation / twerk
  const fastSet = ['fellation', 'chevauche'], midSet = ['masturbation', 'twerk'];
  const pickIn = set => set.includes(st.scene) && now - st.sceneSince < 45000 ? st.scene : set[(set.indexOf(st.scene) + 1) % set.length] || set[0];
  if (st.mood === 'fast' || st.mood === 'faster') return pickIn(fastSet);
  if (st.mood === 'medium') return pickIn(midSet);
  return st.scene === 'danse' ? 'twerk' : st.scene;
}
// ---------- Cadrage automatique : elle est toujours visible EN ENTIER ----------
// Pour chaque scène, on calcule (une fois) la sphère qui contient tout son corps et les accessoires
// sur l'ensemble du mouvement, puis on place la caméra pour que cette sphère tienne dans l'image.
const VIEW_DIR = {
  danse: { pov: [0, 0.12, 1], cote: [0.8, 0.12, 0.6] },
  masturbation: { pov: [0, 0.35, 1], cote: [1, 0.2, 0.55] },
  fellation: { pov: [0.35, 0.5, 1], cote: [1, 0.15, 0.05] },
  chevauche: { pov: [0.25, -0.02, -1], cote: [1, 0.15, -0.4] },
  twerk: { pov: [0.3, 0.1, -1], cote: [1, 0.1, -0.25] },
};
const fits = {};
function poseScene(sc, d, t = 0) {
  const vm = (anims[sc] || []).find(a => a.vmd);
  if (vm) { poseVmd(vm.vmd, d * vmdSpan(vm.vmd)); return; }
  if (sc === 'masturbation') P.poseMasturbation(vrm, M, d, t, 1);
  else if (sc === 'fellation') P.poseFellation(vrm, M, F, d, t, 1, false);
  else if (sc === 'chevauche') P.poseRiding(vrm, M, R, d, t, 1);
  else if (sc === 'twerk') P.poseTwerk(vrm, M, d, t, 1);
  else { P.resetPose(vrm, M); restPose(); }
  if (vrm.isPmx && !vm) vrm.solve(false);
  vrm.scene.updateMatrixWorld(true);
}
function computeFit(sc) {
  const pts = [];
  const names = ['head', 'neck', 'hips', 'chest', 'leftHand', 'rightHand', 'leftLowerArm', 'rightLowerArm', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot', 'leftToes', 'rightToes'];
  for (const d of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    poseScene(sc, d);
    for (const n of names) { const b = B(n); if (b) pts.push(P.wpos(b).clone()); }
    const h = B('head'); if (h) pts.push(new THREE.Vector3(0, 0.17 * M.s, 0).applyMatrix4(h.matrixWorld)); // haut du crâne
  }
  const vmProp = (anims[sc] || []).find(a => a.vmd);
  const prop = vmProp ? vmProp.vmd.prop : sc === 'fellation' ? F : sc === 'chevauche' ? R : null;
  if (prop) { pts.push(prop.tip.clone()); if (prop.base) pts.push(prop.base.clone()); else pts.push(prop.tip.clone().addScaledVector(prop.axis, 0.2 * M.s)); }
  const box = new THREE.Box3().setFromPoints(pts);
  const center = box.getCenter(new THREE.Vector3());
  let radius = 0; for (const p of pts) radius = Math.max(radius, p.distanceTo(center));
  return { center, radius: radius + 0.06 * M.s };
}
function fitCamera(sc) {
  if (cfg.frame === 'buste' && sc === 'danse') { frame(); return; }
  const key = sc;
  if (!fits[key]) { const saved = vrm.scene.matrixWorld.clone(); fits[key] = computeFit(sc); }
  const f = fits[key];
  const dir = new THREE.Vector3(...(VIEW_DIR[sc] || VIEW_DIR.danse)[cfg.view === 'cote' ? 'cote' : 'pov']).normalize();
  const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const dist = f.radius / Math.sin(Math.min(vfov, hfov) / 2) * 1.02;
  camera.position.copy(f.center).addScaledVector(dir, dist);
  camera.lookAt(f.center);
}

function switchScene(sc) {
  if (sc === st.scene) return;
  st.scene = sc; st.sceneSince = performance.now(); resetPhys = true;
  if (sc !== 'danse' && cfg.nude !== 'habillee' && !naked()) { st.stage = wear.length; applyWear(); } // elle se met nue pour ça
  const vlist = (anims[sc] || []).filter(a => a.vmd);
  const fa = forcedAnim();
  vmdCur = fa && fa.sc === sc ? fa.clip : vlist.length ? vlist[Math.floor(Math.random() * vlist.length)].vmd : null; vmdTime = 0;
  Object.values(anims).flat().forEach(a => { if (a.vmd && a.vmd.prop) a.vmd.prop.group.visible = false; });
  if (vmdCur) { setupVmdProp(sc, vmdCur); if (vmdCur.prop) vmdCur.prop.group.visible = true; }
  if (!vmdCur && sc === 'fellation' && !F) F = P.setupFellation(vrm, M, scene);
  if (!vmdCur && sc === 'chevauche' && !R) R = P.setupRiding(vrm, M, scene);
  if (F) F.group.visible = sc === 'fellation' && !vmdCur;
  if (R) R.group.visible = sc === 'chevauche' && !vmdCur;
  delete fits[sc];
  if (!fits[sc]) fits[sc] = computeFit(sc);
  // petit fondu pour masquer le changement de pose
  renderer.domElement.style.transition = 'none'; renderer.domElement.style.opacity = '0';
  requestAnimationFrame(() => { renderer.domElement.style.transition = 'opacity .45s'; renderer.domElement.style.opacity = '1'; });
  if (action) { action.fadeOut(0.3); action = null; actionScene = null; }
  post({ type: 'scene', scene: sc });
}
// profondeur 0..1 : position du funscript si on l'a (bas = profond), sinon le rythme des beats
function depth(now) {
  if (st.pos != null && now - st.posAt < 400) return 1 - st.pos;
  const ph = Math.min(1, (now - st.lastBeat) / Math.max(120, st.period));
  return 0.5 + 0.5 * Math.cos(ph * Math.PI * 2);
}

async function load() {
  setupScene();
  const path = await findModel();
  if (!path) { post({ type: 'ready', ok: false }); return; }
  if (/\.pmx$/i.test(path)) return loadPmxModel(path);
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
  M = P.measure(vrm);
  loadAnims(loader).catch(() => {});
  restPose();
  frame();
  applyWear();
  const meta = vrm.meta || {};
  // Licence inscrite dans le fichier : VRM 0 (sexualUssageName) ou VRM 1 (allowExcessivelySexualUsage)
  const sexual = meta.metaVersion === '0' ? /allow/i.test(meta.sexualUssageName || '') && !/disallow/i.test(meta.sexualUssageName || '') : meta.allowExcessivelySexualUsage === true;
  const modif = meta.metaVersion === '0' ? true : meta.modification !== 'prohibited';
  licenceOk = sexual && modif;
  if (!licenceOk) { cfg.nude = 'habillee'; st.stage = 0; applyWear(); } // on respecte la licence : elle reste habillée
  // bilan des poses : les mains atteignent-elles leurs cibles ?
  const r = P.poseMasturbation(vrm, M, 0.5, 0, 1) || {};
  P.resetPose(vrm, M); restPose();
  const rp = (bone) => { const b = B(bone); return b ? +P.wpos(b).y.toFixed(2) : null; };
  post({ type: 'ready', ok: true, name: meta.name || meta.title || path.split('/').pop(), author: (meta.authors && meta.authors.join(', ')) || meta.author || '',
    wear: wear.length, nude: !!(nudeRep && nudeRep.ok), licence: { sexual, modif, raw: meta.sexualUssageName || meta.allowExcessivelySexualUsage, vrm: meta.metaVersion },
    report: { taille: +(M.s * 1.6).toFixed(2), tete: rp('head'), bassin: rp('hips'), pointsPeau: nudeRep && nudeRep.pts ? Object.fromEntries(Object.entries(nudeRep.pts).map(([k, v]) => [k, v ? [+v.u.toFixed(3), +v.v.toFixed(3)] : null])) : null,
      vetements: clothes(vrm).length, ecartMainSexeCm: r.sexe != null ? Math.round(r.sexe * 100) : null, ecartMainSeinCm: r.sein != null ? Math.round(r.sein * 100) : null } });
  requestAnimationFrame(loop);
}

// ---------- Modèle MMD (.pmx) ----------
async function loadPmxModel(path) {
  // physique (cheveux, seins…) : moteur Ammo, chargé si possible
  // (délai maximum : si le moteur ne démarre pas, elle s'affiche quand même, sans physique)
  try {
    if (typeof Ammo === 'function') {
      const lib = await Promise.race([Ammo(), new Promise(r => setTimeout(() => r(null), 6000))]);
      globalThis.Ammo = lib || undefined;
    }
  } catch (e) { globalThis.Ammo = undefined; }
  const url = chrome.runtime.getURL(path.split('/').map(encodeURIComponent).join('/'));
  vrm = await loadPmx(url, cfg.physics !== false && !!globalThis.Ammo && typeof globalThis.Ammo !== 'function');
  scene.add(vrm.mesh);
  M = P.measure(vrm);
  camera.near = 0.03 * M.s; camera.far = 80 * M.s; camera.updateProjectionMatrix();
  wear = groupWear(vrm.clothes());
  licenceOk = true; // pas de licence lisible dans un .pmx : c'est à toi de vérifier celle du modèle
  loadAnims(null).catch(e => post({ type: 'anim-error', file: 'animations', error: String(e && e.message || e) }));
  P.resetPose(vrm, M); vrm.solve(false);
  applyWear();
  const r = P.poseMasturbation(vrm, M, 0.5, 0, 1) || {};
  P.resetPose(vrm, M); vrm.solve(false); vrm.resetPhysics();
  post({ type: 'ready', ok: true, name: vrm.meta.name || path.split('/').pop(), author: '', wear: wear.length, nude: true, licence: { format: 'pmx', note: 'licence non lisible dans un .pmx : vérifie-la toi-même' },
    report: { format: 'MMD (.pmx)', physique: vrm.physics, vetements: vrm.clothes().map(c => c.name), osTrouves: Object.keys(vrm.humanoid.humanBones).length, ecartMainSexeCm: r.sexe != null ? Math.round(r.sexe / M.s * 160) : null, ecartMainSeinCm: r.sein != null ? Math.round(r.sein / M.s * 160) : null } });
  requestAnimationFrame(loop);
  // textures : bilan quelques secondes plus tard (elles se chargent après le modèle)
  setTimeout(() => post({ type: 'tex', ok: vrm.texInfo.ok, failed: vrm.texInfo.failed.slice(0, 20), nFailed: vrm.texInfo.failed.length }), 6000);
}

// ---------- Pose et animation ----------
function restPose() {
  if (vrm && vrm.isPmx) return; // un modèle MMD est déjà au repos bras le long du corps (pose A)
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

  const now = performance.now();
  if (vrm.isPmx) vrm.clearExpr();
  const want = wantedScene(now);
  if (want !== st.scene && now - st.sceneSince > 8000) switchScene(want); // pas plus d'un changement toutes les 8 s
  const intensity = st.mood === 'fast' || st.mood === 'faster' ? 1 : st.mood === 'medium' ? 0.7 : 0.45;
  const d = active ? depth(now) : 0.15;
  const clips = (anims[st.scene] || []).filter(a => a.vrma).map(a => a.vrma);
  let vmdFace = null;
  if (vmdCur) {
    // animation MMD : chaque cycle calé sur un nombre entier de beats (vitesse proche de l'originale)
    let rate = 1;
    if (active && vmdCur.cycle) { const beat = st.period / 1000, k = Math.max(1, Math.round(vmdCur.cycle / beat)); rate = Math.max(0.4, Math.min(2.5, vmdCur.cycle / (k * beat))); }
    else if (!active) rate = 0.35;
    vmdTime += dt * rate;
    vmdFace = poseVmd(vmdCur, (vmdTime * 30) % vmdCur.frames);
  } else if (mixer && clips && clips.length && !vrm.isPmx) {
    // animation d'artiste : on la joue, à une vitesse calée sur le tempo
    if (actionScene !== st.scene) { action = mixer.clipAction(clips[Math.floor(Math.random() * clips.length)]); action.reset().fadeIn(0.3).play(); actionScene = st.scene; }
    const clipDur = action.getClip().duration;
    action.timeScale = active ? Math.max(0.3, Math.min(3, clipDur < 2.5 ? clipDur / (st.period / 1000) : (60000 / st.period) / 110)) : 0.4;
    mixer.update(dt);
  } else if (st.scene === 'masturbation') {
    P.poseMasturbation(vrm, M, d, t, intensity);
  } else if (st.scene === 'fellation') {
    P.poseFellation(vrm, M, F, d, t, intensity, intensity >= 1 || st.state === 'final');
  } else if (st.scene === 'chevauche') {
    P.poseRiding(vrm, M, R, d, t, intensity);
  } else if (st.scene === 'twerk') {
    P.poseTwerk(vrm, M, d, t, intensity);
  } else {
    P.resetPose(vrm, M); restPose();
    const hips = B('hips'), spine = B('spine'), chest = B('chest') || B('upperChest'), neck = B('neck'), head = B('head');
    const breathe = Math.sin(t * 1.6) * 0.02, fl = vrm.noFlip ? -1 : 1; // sens des axes selon le type de modèle
    if (hips) { hips.rotation.x = fl * (-0.10 * st.e * amp + 0.04 * stroke); hips.rotation.y = Math.sin(t * 0.7) * 0.05; hips.rotation.z = fl * Math.sin(t * 0.9) * 0.04 * amp; hips.position.y = M.hipsRest.y - 0.025 * M.s * st.e * amp; }
    if (spine) spine.rotation.x = fl * (0.06 * st.e * amp + breathe);
    if (chest) chest.rotation.x = fl * (0.04 * st.e * amp - breathe * 0.5);
    if (neck) neck.rotation.x = fl * -0.03 * st.e * amp;
    if (head) { head.rotation.z = fl * Math.sin(t * 0.5) * 0.06; head.rotation.x = fl * 0.04 * Math.sin(t * 0.8); }
    // bras droit : geste de va-et-vient (comme si elle te branlait) quand ça tourne
    const ru = B('rightUpperArm'), rl = B('rightLowerArm'), rh = B('rightHand');
    if (ru && rl && !vrm.isPmx) {
      const k = active && st.state !== 'edge' ? 1 : 0;
      ru.rotation.set(-0.55 * k + 0.12 * stroke * k, 0.25 * k, -1.15 + 0.55 * k);
      rl.rotation.set(0, 0.25 + 1.2 * k + 0.35 * stroke * k, 0);
      if (rh) rh.rotation.set(0, 0, 0.3 * k);
    }
    const lu = B('leftUpperArm');
    if (lu && !vrm.isPmx) lu.rotation.set(0, 0, 1.15 - 0.08 * Math.sin(t * 1.1));
  }
  if (vrm.isPmx && !vmdCur) vrm.solve(false); // os automatiques après une pose calculée
  fitCamera(st.scene);

  // expressions + clignements + bouche quand elle parle
  moodTargets(t);
  if (vmdFace) for (const [k, w] of Object.entries(vmdFace)) if (k in target) target[k] = Math.max(target[k], w);
  if (st.scene === 'fellation') { target.oh = 0.85; target.aa = 0.2; target.blink = Math.max(target.blink, 0.2); target.happy = 0.15; }
  else if (st.scene === 'chevauche') { target.oh = Math.max(target.oh, 0.35 + 0.4 * d * intensity); target.blink = Math.max(target.blink, 0.35); target.happy = Math.max(target.happy, 0.35); }
  else if (st.scene === 'twerk') { target.happy = Math.max(target.happy, 0.6); target.aa = Math.max(target.aa, 0.1 + 0.15 * d); }
  else if (st.scene === 'masturbation') { target.oh = Math.max(target.oh, 0.25 + 0.45 * d * intensity); target.blink = Math.max(target.blink, 0.3 + 0.25 * intensity); target.happy = Math.max(target.happy, 0.3); }
  if (t > nextBlink) { target.blink = 1; if (t > nextBlink + 0.12) nextBlink = t + 2 + Math.random() * 3; }
  if (performance.now() < st.talkUntil && st.scene !== 'fellation') { // bouche prise : elle ne parle pas
    const s = Math.abs(Math.sin(t * 13)) * 0.6 + Math.abs(Math.sin(t * 7.3)) * 0.3;
    target.aa = Math.max(target.aa, s * 0.7); target.oh = Math.max(target.oh, (1 - s) * 0.3);
  }
  EXP.forEach(k => { cur[k] += (target[k] - cur[k]) * Math.min(1, dt * (k === 'blink' ? 30 : 10)); });
  if (vrm.isPmx) {
    EXP.forEach(k => vrm.setExpr(k, cur[k]));
    if (resetPhys) { vrm.resetPhysics(); resetPhys = false; }
    vrm.physicsStep(dt);                                // cheveux, seins…
  } else {
    const em = vrm.expressionManager;
    if (em) EXP.forEach(k => { try { em.setValue(k, cur[k]); } catch (e) {} });
    vrm.update(dt);
  }
  renderer.render(scene, camera);
}

// ---------- Messages de GoonFap ----------
addEventListener('message', e => {
  const m = e.data; if (!m || m.gf !== 'c') return;
  switch (m.type) {
    case 'cfg':
      const prevAnim = cfg.anim;
      Object.assign(cfg, m.cfg);
      if (!licenceOk) cfg.nude = 'habillee';
      if (vrm && cfg.anim !== prevAnim) { const fa = forcedAnim(); if (fa) { st.scene = null; st.sceneSince = 0; switchScene(fa.sc); } } // ▶ : tout de suite
      if (m.cfg.nude === 'strip' && m.reset) st.stage = 0;
      if (vrm && cfg.scene !== 'auto' && cfg.scene !== st.scene) { st.sceneSince = 0; switchScene(cfg.scene); }
      frame(); applyWear(); break;
    case 'beat': {
      const now = performance.now(), iv = now - st.lastBeat;
      if (iv > 80 && iv < 2500) st.period = st.period * 0.6 + iv * 0.4;
      st.lastBeat = now; st.e = Math.min(1.4, st.e + (m.s || 1)); if (st.state === 'pause') st.state = 'play';
      break;
    }
    case 'mood': st.mood = m.kind; break;
    case 'pos': st.pos = m.p; st.posAt = performance.now(); break;
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
