/* Scènes animées par programme pour la compagne 3D (modèle VRM, regardant vers +Z après rotateVRM0) :
 *  - 'masturbation' : à genoux jambes écartées, une main entre les cuisses, l'autre sur un sein ;
 *  - 'fellation'    : à genoux, penchée vers un sexe masculin ; sa tête avance / recule selon la profondeur d.
 * d (0..1) = profondeur du mouvement à l'instant t (calée sur le funscript ou les beats).
 * Les mains sont placées par cinématique inverse (CCD) sur les os « normalisés » de three-vrm. */
import * as THREE from './lib/three.module.js';

const V = () => new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _a = V(), _b = V(), _c = V();

export function bone(vrm, n) { return vrm.humanoid.getNormalizedBoneNode(n); }
// Les angles sont écrits « vus du monde » (le modèle regarde vers +Z) : x>0 = pencher vers l'avant / vers le bas,
// z>0 = vers sa gauche. Les os normalisés d'un VRM 0 sont tournés de 180° : on inverse x et z.
export function setW(vrm, n, x, y, z) { const b = bone(vrm, n); if (b) b.rotation.set(-x, y, -z); }
export function addW(vrm, n, x, y, z) { const b = bone(vrm, n); if (b) { b.rotation.x -= x; b.rotation.y += y; b.rotation.z -= z; } }
export function wpos(node, out = V()) { node.updateWorldMatrix(true, false); return node.getWorldPosition(out); }

/** Mesures du modèle, prises une fois au repos. */
export function measure(vrm) {
  const p = n => { const b = bone(vrm, n); return b ? wpos(b).clone() : null; };
  const head = p('head'), hips = p('hips'), foot = p('leftFoot'), ul = p('leftUpperLeg'), ll = p('leftLowerLeg'), chest = p('chest') || p('spine');
  const shin = ll.distanceTo(foot);
  const s = Math.max(0.6, (head.y - foot.y) / 1.45); // échelle du personnage (1 ≈ 1,6 m)
  const hipsBone = bone(vrm, 'hips');
  return { head, hips, foot, chest, s, thigh: ul.distanceTo(ll), shin, hipToLeg: hips.y - ul.y, hipsRest: hipsBone.position.clone() };
}

/** Remet toutes les articulations au repos. */
export function resetPose(vrm, M) {
  for (const n of Object.keys(vrm.humanoid.humanBones)) { const b = bone(vrm, n); if (b) b.quaternion.identity(); }
  bone(vrm, 'hips').position.copy(M.hipsRest);
}

// Cinématique inverse CCD : amène l'extrémité (main) sur la cible, en tournant d'abord le coude puis l'épaule
function ccd(chain, effector, target, iters = 10) {
  for (let it = 0; it < iters; it++) {
    for (let i = chain.length - 1; i >= 0; i--) {
      const j = chain[i];
      wpos(j, _a); wpos(effector, _b);
      const v1 = _b.sub(_a).normalize(), v2 = _c.copy(target).sub(_a).normalize();
      if (v1.lengthSq() < 1e-8 || v2.lengthSq() < 1e-8) continue;
      _q.setFromUnitVectors(v1, v2);
      j.parent.updateWorldMatrix(true, false);
      j.parent.getWorldQuaternion(_q2);
      const wq = j.getWorldQuaternion(new THREE.Quaternion());
      wq.premultiply(_q);
      j.quaternion.copy(_q2.invert().multiply(wq));
      j.updateWorldMatrix(false, true);
    }
  }
}
/** Amène la main sur la cible : le poignet par IK, puis les doigts orientés selon fingerDir (monde). */
export function reach(vrm, side, target, fingerDir) {
  const s = side === 'left' ? 'left' : 'right';
  const ua = bone(vrm, s + 'UpperArm'), la = bone(vrm, s + 'LowerArm'), h = bone(vrm, s + 'Hand');
  if (!ua || !la || !h) return;
  const tip = bone(vrm, s + 'MiddleIntermediate') || bone(vrm, s + 'MiddleProximal');
  // coude légèrement plié pour que l'IK garde un pli naturel
  la.rotation.set(0, s === 'left' ? -0.6 : 0.6, 0);
  ua.rotation.set(0, 0, s === 'left' ? 1.0 : -1.0);
  h.quaternion.identity();
  vrm.scene.updateMatrixWorld(true);
  let wristTarget = target;
  if (tip && fingerDir) {
    const len = wpos(tip, V()).distanceTo(wpos(h, V()));
    wristTarget = target.clone().addScaledVector(fingerDir.clone().normalize(), -len);
  }
  ccd([ua, la], h, wristTarget, 12);
  if (tip && fingerDir) { // oriente la main : les doigts pointent vers fingerDir
    const w = wpos(h, V()), cur = wpos(tip, V()).sub(w).normalize();
    _q.setFromUnitVectors(cur, fingerDir.clone().normalize());
    h.parent.updateWorldMatrix(true, false); h.parent.getWorldQuaternion(_q2);
    const wq = h.getWorldQuaternion(new THREE.Quaternion()).premultiply(_q);
    h.quaternion.copy(_q2.invert().multiply(wq));
    h.updateWorldMatrix(false, true);
  }
  // écart restant entre le bout des doigts (ou le poignet) et la cible, en mètres
  return wpos(tip || h, V()).distanceTo(target);
}

/** À genoux (spread = écartement des cuisses, en radians). */
function kneel(vrm, M, spread, lean, tilt = 0.15, pelvis = 0) {
  // tilt : cuisses penchées vers l'avant (0.15 = à genoux droite, ~0.9 = assise sur les talons)
  // pelvis : bascule du bassin (cambrure) ; jambes et dos sont compensés pour que seul le bassin bouge
  const hips = bone(vrm, 'hips');
  const legY = 0.06 * M.s + M.thigh * Math.cos(tilt);
  hips.position.y = M.hipsRest.y + (legY + M.hipToLeg - M.hips.y);
  const set = (n, x, y, z) => setW(vrm, n, x, y, z);
  set('hips', pelvis, 0, 0);
  set('leftUpperLeg', -tilt - pelvis, 0, spread); set('rightUpperLeg', -tilt - pelvis, 0, -spread);
  set('leftLowerLeg', 1.4 + tilt, 0, 0); set('rightLowerLeg', 1.4 + tilt, 0, 0); // tibias à plat au sol
  set('leftFoot', 0.6, 0, 0); set('rightFoot', 0.6, 0, 0);
  set('spine', lean - pelvis, 0, 0);
}

// ---------------------------------------------------------------------------
// Masturbation
// ---------------------------------------------------------------------------
export function poseMasturbation(vrm, M, d, t, intensity) {
  resetPose(vrm, M);
  kneel(vrm, M, 0.42, 0.28);
  setW(vrm, 'rightShoulder', 0.1, 0, 0.3);   // épaule droite qui descend vers son sexe
  const set = (n, x, y, z) => setW(vrm, n, x, y, z);
  const hips = bone(vrm, 'hips');
  set('hips', -0.10 + 0.14 * (d - 0.5) * intensity, 0, 0); // le bassin ondule au rythme
  set('chest', 0.06 - 0.05 * intensity * d, 0, 0);
  set('neck', -0.05, 0, 0);
  set('head', -0.12 - 0.25 * intensity * d, Math.sin(t * 0.6) * 0.15, Math.sin(t * 0.8) * 0.08); // tête en arrière quand c'est fort
  vrm.scene.updateMatrixWorld(true);
  const s = M.s, hp = wpos(hips, V());
  // main droite entre les cuisses : va-et-vient
  // haut du sexe (clitoris) : atteignable même avec des bras de personnage anime
  const crotch = new THREE.Vector3(-0.005 * s, hp.y - 0.068 * s, hp.z + 0.085 * s);
  crotch.y += (d - 0.5) * 0.032 * s; crotch.z += (0.5 - d) * 0.01 * s;
  const err = reach(vrm, 'right', crotch, new THREE.Vector3(0.05, -1, 0.15)); // doigts vers le bas, entre les cuisses
  // main gauche sur son sein gauche (côté +x) : elle le pétrit
  const ch = wpos(bone(vrm, 'chest') || bone(vrm, 'spine'), V());
  const breast = new THREE.Vector3(0.075 * s, ch.y + 0.02 * s + 0.01 * s * Math.sin(t * 3), ch.z + 0.12 * s);
  const err2 = reach(vrm, 'left', breast, new THREE.Vector3(-0.5, 0.55, 0.3)); // main qui empaume le sein
  return { sexe: err, sein: err2 };
}

// ---------------------------------------------------------------------------
// Fellation
// ---------------------------------------------------------------------------
function fellationBody(vrm, M, d) {
  resetPose(vrm, M);
  kneel(vrm, M, 0.12, 0.22 + 0.13 * d);
  const set = (n, x, y, z) => setW(vrm, n, x, y, z);
  set('chest', 0.10 + 0.08 * d, 0, 0);
  set('neck', -0.22 - 0.08 * d, 0, 0);
  set('head', -0.45 - 0.08 * d, 0, 0); // elle lève les yeux vers toi
  vrm.scene.updateMatrixWorld(true);
}
export function mouthPos(vrm, M, out = V()) {
  const h = bone(vrm, 'head');
  h.updateWorldMatrix(true, false);
  return out.set(0, -0.005 * M.s, -0.082 * M.s).applyMatrix4(h.matrixWorld); // -z local = devant le visage
}

/** Prépare la scène fellation : trajectoire de la bouche et sexe masculin aligné dessus. */
export function setupFellation(vrm, M, scene) {
  fellationBody(vrm, M, 0); const m0 = mouthPos(vrm, M).clone();
  fellationBody(vrm, M, 1); const m1 = mouthPos(vrm, M).clone();
  resetPose(vrm, M);
  const axis = m1.clone().sub(m0).normalize();     // des lèvres (d=0) vers l'avant : le sexe est devant elle
  const len = 0.17 * M.s, r = 0.019 * M.s;
  const tip = m0.clone().addScaledVector(axis, 0.006 * M.s);
  const base = tip.clone().addScaledVector(axis, len);
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xe2ad98, roughness: 0.55 });
  const head = new THREE.MeshStandardMaterial({ color: 0xd88a8c, roughness: 0.4 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, len, 24, 1, true), skin);
  shaft.position.y = len / 2;
  const glans = new THREE.Mesh(new THREE.SphereGeometry(r * 1.12, 24, 16), head);
  glans.scale.set(1, 1.25, 1); glans.position.y = 0;
  const balls = new THREE.Mesh(new THREE.SphereGeometry(r * 1.9, 20, 14), skin);
  balls.scale.set(1.3, 0.8, 0.9); balls.position.set(0, len + r * 0.6, -r * 1.6);
  g.add(shaft, glans, balls);
  // l'axe Y local du groupe va de la pointe vers la base
  g.position.copy(tip);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  scene.add(g);
  return { group: g, tip, base, axis, m0, m1 };
}

export function poseFellation(vrm, M, F, d, t, intensity, handOnShaft) {
  fellationBody(vrm, M, d);
  addW(vrm, 'head', 0, Math.sin(t * 1.3) * 0.04, Math.sin(t * 0.9) * 0.05);
  vrm.scene.updateMatrixWorld(true);
  // main droite : sur la cuisse, ou qui branle la base quand ça va vite (elle suit sa bouche)
  const hp = wpos(bone(vrm, 'hips'), V());
  if (handOnShaft && F) {
    const grip = F.base.clone().lerp(F.tip, 0.25 + 0.3 * d);
    reach(vrm, 'right', grip, new THREE.Vector3(-0.6, 0.2, -0.2));
  } else reach(vrm, 'right', new THREE.Vector3(-0.11 * M.s, hp.y - 0.05 * M.s, hp.z + 0.17 * M.s), new THREE.Vector3(0, -0.3, 1));
  reach(vrm, 'left', new THREE.Vector3(0.11 * M.s, hp.y - 0.05 * M.s, hp.z + 0.17 * M.s), new THREE.Vector3(0, -0.3, 1)); // mains sur les cuisses
}

// ---------------------------------------------------------------------------
// Chevauche : à genoux, de dos, elle monte et descend sur un gode posé au sol
// ---------------------------------------------------------------------------
function ridingBody(vrm, M, d) {
  resetPose(vrm, M);
  const tilt = 0.25 + 0.55 * d;                 // d=1 : elle descend jusqu'en bas
  kneel(vrm, M, 0.38, -0.12, tilt, 0.45);        // bassin basculé : reins cambrés, fesses en arrière, buste droit
  addW(vrm, 'spine', 0, 0.12, 0);
  setW(vrm, 'chest', -0.12, 0.22, 0);           // le buste se tourne vers la caméra
  setW(vrm, 'neck', 0.05, 0.35, 0);
  setW(vrm, 'head', 0.10, 0.75, -0.08);         // elle te regarde par-dessus son épaule
  vrm.scene.updateMatrixWorld(true);
}
function crotchPos(vrm, M, out = V()) {
  const h = bone(vrm, 'hips'); h.updateWorldMatrix(true, false);
  return out.set(0, -0.085 * M.s, -0.045 * M.s).applyMatrix4(h.matrixWorld); // sous le bassin (z local inversé : -z = devant)
}
export function setupRiding(vrm, M, scene) {
  ridingBody(vrm, M, 0); const c0 = crotchPos(vrm, M).clone();
  ridingBody(vrm, M, 1); const c1 = crotchPos(vrm, M).clone();
  resetPose(vrm, M);
  const axis = c1.clone().sub(c0).normalize();   // vers le bas, le long de sa descente
  const tip = c0.clone().addScaledVector(axis, 0.025 * M.s);
  // longueur : jusqu'au sol
  const len = Math.max(0.16 * M.s, (tip.y - 0.0) / Math.max(0.3, -axis.y));
  const r = 0.024 * M.s;
  const mat = new THREE.MeshStandardMaterial({ color: 0xd4123c, roughness: 0.28, metalness: 0.05 });
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.12, len, 28, 1, true), mat); shaft.position.y = len / 2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(r * 1.15, 24, 16), mat); head.scale.set(1, 1.3, 1);
  const balls = new THREE.Mesh(new THREE.SphereGeometry(r * 2.1, 22, 16), mat); balls.scale.set(1.35, 0.85, 1); balls.position.set(0, len - r * 1.2, r * 1.5);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 2.4, r * 2.6, r * 0.6, 28), mat); base.position.y = len;
  g.add(shaft, head, balls, base);
  g.position.copy(tip);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  scene.add(g);
  return { group: g, tip, axis, c0, c1 };
}
export function poseRiding(vrm, M, R, d, t, intensity) {
  ridingBody(vrm, M, d);
  addW(vrm, 'hips', 0, Math.sin(t * 0.8) * 0.05, 0); // petit roulement des hanches
  vrm.scene.updateMatrixWorld(true);
  const hp = wpos(bone(vrm, 'hips'), V());
  // mains posées à plat sur le haut des cuisses, devant elle
  reach(vrm, 'right', new THREE.Vector3(-0.12 * M.s, hp.y - 0.06 * M.s, hp.z + 0.16 * M.s), new THREE.Vector3(0, -0.4, 1));
  reach(vrm, 'left', new THREE.Vector3(0.12 * M.s, hp.y - 0.06 * M.s, hp.z + 0.16 * M.s), new THREE.Vector3(0, -0.4, 1));
}

// ---------------------------------------------------------------------------
// Twerk : debout, jambes fléchies, penchée en avant, mains sur les genoux, les fesses qui claquent
// ---------------------------------------------------------------------------
export function poseTwerk(vrm, M, d, t, intensity) {
  resetPose(vrm, M);
  const thighA = 1.0, kneeA = 1.45, shinA = kneeA - thighA; // cuisses vers l'avant, tibias légèrement vers l'arrière
  const hips = bone(vrm, 'hips');
  const legY = M.foot.y + M.shin * Math.cos(shinA) + M.thigh * Math.cos(thighA);
  hips.position.y = M.hipsRest.y + (legY + M.hipToLeg - M.hips.y);
  hips.position.z = M.hipsRest.z + 0.0;
  const pop = (d - 0.5) * 2 * (0.22 + 0.25 * intensity);
  const pelvis = 0.45 + pop;                       // la bascule du bassin = le twerk
  setW(vrm, 'hips', pelvis, 0, Math.sin(t * 1.7) * 0.04);
  setW(vrm, 'leftUpperLeg', -thighA - pelvis, 0, 0.18); setW(vrm, 'rightUpperLeg', -thighA - pelvis, 0, -0.18);
  setW(vrm, 'leftLowerLeg', kneeA, 0, 0); setW(vrm, 'rightLowerLeg', kneeA, 0, 0);
  setW(vrm, 'leftFoot', -shinA, 0, 0); setW(vrm, 'rightFoot', -shinA, 0, 0);
  setW(vrm, 'spine', 1.05 - pelvis, 0, 0);        // buste penché en avant, stable pendant que les fesses bougent
  setW(vrm, 'chest', 0.15, 0.25, 0);
  setW(vrm, 'neck', -0.15, 0.35, 0);
  setW(vrm, 'head', -0.1, 0.7, -0.08); // regard par-dessus l'épaule
  vrm.scene.updateMatrixWorld(true);
  // mains sur les genoux
  const kn = s => wpos(bone(vrm, s + 'LowerLeg'), V());
  const kl = kn('left'), kr = kn('right');
  reach(vrm, 'left', kl.clone().add(new THREE.Vector3(0.0, 0.05 * M.s, 0.05 * M.s)), new THREE.Vector3(0.2, -0.6, 0.8));
  reach(vrm, 'right', kr.clone().add(new THREE.Vector3(0.0, 0.05 * M.s, 0.05 * M.s)), new THREE.Vector3(-0.2, -0.6, 0.8));
}

/** Position de caméra pour une scène et une vue ('pov' | 'cote'). */
export function cameraFor(scene, view, vrm, M, F, cam) {
  const s = M.s;
  if (scene === 'fellation' && F) {
    const mid = F.m0.clone().lerp(F.base, 0.35);
    if (view === 'cote') { cam.position.set(0.85 * s, mid.y + 0.05 * s, mid.z); cam.lookAt(mid.x, mid.y - 0.02 * s, mid.z); }
    else { cam.position.set(0, F.base.y + 0.34 * s, F.base.z + 0.34 * s); cam.lookAt(F.m0.x, F.m0.y - 0.04 * s, F.m0.z - 0.03 * s); } // vue d'en haut : tes yeux
    return;
  }
  if (scene === 'chevauche' && F) {
    const mid = F.c0.clone().lerp(F.c1, 0.5);
    if (view === 'cote') { cam.position.set(1.05 * s, mid.y + 0.28 * s, mid.z - 0.55 * s); cam.lookAt(0, mid.y + 0.22 * s, mid.z); }
    else { cam.position.set(0.22 * s, Math.max(0.15 * s, mid.y - 0.05 * s), mid.z - 1.6 * s); cam.lookAt(0, mid.y + 0.42 * s, mid.z); } // de dos, en contre-plongée, visage visible
    return;
  }
  if (scene === 'twerk') {
    const hp = wpos(bone(vrm, 'hips'), V());
    if (view === 'cote') { cam.position.set(1.3 * s, hp.y + 0.15 * s, -0.35 * s); cam.lookAt(0, hp.y + 0.05 * s, 0); }
    else { cam.position.set(0.3 * s, hp.y + 0.1 * s, -1.75 * s); cam.lookAt(0, hp.y + 0.2 * s, 0.1 * s); } // de dos
    return;
  }
  if (scene === 'masturbation') {
    const hp = wpos(bone(vrm, 'hips'), V());
    if (view === 'cote') { cam.position.set(0.95 * s, hp.y + 0.35 * s, 1.0 * s); cam.lookAt(0, hp.y + 0.12 * s, 0); }
    else { cam.position.set(0, hp.y + 0.62 * s, 1.75 * s); cam.lookAt(0, hp.y + 0.2 * s, 0); }
  }
}
