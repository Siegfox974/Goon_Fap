/* Animations MMD (.vmd) appliquées à un modèle VRM.
 * Conversion : repère main gauche de MMD → main droite (comme three.js : q → (-x,-y,z,w), p → (x,y,-z)),
 * puis vers les os normalisés du VRM (tournés de 180° : x et z inversés),
 * pose de repos en « A » (bras à ~35°) → pose en « T » du VRM, et cinématique inverse des jambes (足ＩＫ). */
import * as THREE from './lib/three.module.js';
import { Parser } from './lib/mmdparser.module.js';
import * as P from './poses.js';

const nk = s => (s || '').normalize('NFKC').trim();
const FINGERS = { '親指0': 'ThumbMetacarpal', '親指1': 'ThumbProximal', '親指2': 'ThumbDistal' };
['人指', '中指', '薬指', '小指'].forEach((j, i) => {
  const f = ['Index', 'Middle', 'Ring', 'Little'][i];
  FINGERS[j + '1'] = f + 'Proximal'; FINGERS[j + '2'] = f + 'Intermediate'; FINGERS[j + '3'] = f + 'Distal';
});
const BONES = { 'センター': 'center', 'グルーブ': 'groove', '腰': 'waist', '下半身': 'lower', '上半身': 'upper', '上半身2': 'chest', '首': 'neck', '頭': 'head', '全ての親': 'root' };
for (const [jp, side] of [['左', 'left'], ['右', 'right']]) {
  Object.assign(BONES, {
    [jp + '肩']: side + 'Shoulder', [jp + '腕']: side + 'UpperArm', [jp + '腕捩']: side + 'ArmTwist', [jp + 'ひじ']: side + 'LowerArm',
    [jp + '手捩']: side + 'HandTwist', [jp + '手首']: side + 'Hand', [jp + '足']: side + 'UpperLeg', [jp + 'ひざ']: side + 'LowerLeg',
    [jp + '足首']: side + 'Foot', [jp + 'つま先']: side + 'Toes', [jp + '足IK']: side + 'FootIK',
  });
  for (const [k, v] of Object.entries(FINGERS)) BONES[jp + k] = side + v;
}
const MORPHS = { 'あ': 'aa', 'い': 'ih', 'う': 'ou', 'え': 'ee', 'お': 'oh', 'まばたき': 'blink', '笑い': 'happy', 'にこり': 'happy', '怒り': 'angry', '困る': 'sad', 'ウィンク': 'blinkLeft', 'ウィンク右': 'blinkRight', 'びっくり': 'surprised' };

const conv = (r) => new THREE.Quaternion(-r[0], -r[1], r[2], r[3]);           // monde MMD → monde three (le modèle regarde vers +Z)
const convP = (p) => new THREE.Vector3(p[0], p[1], -p[2]);
const toLocal = q => new THREE.Quaternion(-q.x, q.y, -q.z, q.w);              // monde → os normalisé d'un VRM 0 (tourné de 180°)
const A_POSE = 0.61;                                                           // les bras MMD sont au repos à ~35° sous l'horizontale
const OFF = { left: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -A_POSE), right: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), A_POSE) };

/** Lit un fichier .vmd (ArrayBuffer) et prépare l'échantillonnage. */
export function parseVmd(buffer) {
  const vmd = new Parser().parseVmd(buffer, false);
  const tracks = new Map(), morphs = new Map();
  let last = 0;
  for (const m of vmd.motions) {
    const key = BONES[nk(m.boneName)]; if (!key) continue;
    if (!tracks.has(key)) tracks.set(key, []);
    tracks.get(key).push({ f: m.frameNum, q: conv(m.rotation), p: convP(m.position) });
    last = Math.max(last, m.frameNum);
  }
  for (const m of vmd.morphs) {
    const key = MORPHS[nk(m.morphName)]; if (!key) continue;
    if (!morphs.has(key)) morphs.set(key, []);
    morphs.get(key).push({ f: m.frameNum, w: m.weight });
    last = Math.max(last, m.frameNum);
  }
  tracks.forEach(t => t.sort((a, b) => a.f - b.f));
  morphs.forEach(t => t.sort((a, b) => a.f - b.f));
  const useIK = ['leftFootIK', 'rightFootIK'].some(k => (tracks.get(k) || []).some(x => x.p.lengthSq() > 1e-6 || Math.abs(x.q.w) < 0.9999));
  const clip = { tracks, morphs, frames: Math.max(1, last), useIK, duration: Math.max(1, last) / 30 };
  clip.cycle = findCycle(clip);
  return clip;
}

function sampleTrack(t, f) {
  if (!t || !t.length) return null;
  if (f <= t[0].f) return t[0];
  if (f >= t[t.length - 1].f) return t[t.length - 1];
  let lo = 0, hi = t.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m].f <= f) lo = m; else hi = m; }
  const a = t[lo], b = t[hi], k = (f - a.f) / Math.max(1, b.f - a.f);
  return { q: a.q.clone().slerp(b.q, k), p: a.p.clone().lerp(b.p, k) };
}
const Q = (clip, k, f) => { const s = sampleTrack(clip.tracks.get(k), f); return s ? s.q : new THREE.Quaternion(); };
const Pp = (clip, k, f) => { const s = sampleTrack(clip.tracks.get(k), f); return s ? s.p : new THREE.Vector3(); };

// Durée d'un cycle du mouvement (va-et-vient), par autocorrélation de la hauteur du bassin et de la main droite
function findCycle(clip) {
  const n = Math.min(clip.frames, 30 * 40);
  if (n < 40) return null;
  const sig = [];
  for (let f = 0; f < n; f++) {
    const p = Pp(clip, 'center', f).y + Pp(clip, 'groove', f).y;
    const q = Q(clip, 'rightLowerArm', f), q2 = Q(clip, 'lower', f);
    sig.push(p + 2 * (1 - Math.abs(q.w)) + 2 * (1 - Math.abs(q2.w)));
  }
  const mean = sig.reduce((a, b) => a + b, 0) / n, x = sig.map(v => v - mean);
  const e0 = x.reduce((a, b) => a + b * b, 0); if (e0 < 1e-6) return null;
  let best = 0, lagB = 0;
  for (let lag = 9; lag <= Math.min(90, n / 2); lag++) {
    let s = 0; for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    s /= e0; if (s > best) { best = s; lagB = lag; }
  }
  return best > 0.3 ? lagB / 30 : null;
}

/** Applique l'image f (en images MMD, 30/s) au modèle. Renvoie les poids d'expressions du visage. */
export function applyVmd(vrm, M, clip, f, rest) {
  P.resetPose(vrm, M);
  const set = (name, q) => { const b = P.bone(vrm, name); if (b) b.quaternion.copy(toLocal(q)); };
  // bassin : tout-parent × centre × taille × bas du corps ; le dos annule la part « bas du corps »
  const lower = Q(clip, 'waist', f).multiply(Q(clip, 'lower', f));
  const hipsQ = Q(clip, 'root', f).multiply(Q(clip, 'center', f)).multiply(lower);
  set('hips', hipsQ);
  set('spine', lower.clone().invert().multiply(Q(clip, 'waist', f)).multiply(Q(clip, 'upper', f)));
  set('chest', Q(clip, 'chest', f));
  set('neck', Q(clip, 'neck', f)); set('head', Q(clip, 'head', f));
  const scale = 0.078 * M.s;
  const off = Pp(clip, 'root', f).add(Pp(clip, 'center', f)).add(Pp(clip, 'groove', f)).multiplyScalar(scale);
  const hips = P.bone(vrm, 'hips');
  hips.position.set(M.hipsRest.x - off.x, M.hipsRest.y + off.y, M.hipsRest.z - off.z); // monde → os normalisé (x et z inversés)
  // bras : pose en A → T (épaule), puis os enfants conjugués
  for (const s of ['left', 'right']) {
    const o = OFF[s], oi = o.clone().invert();
    set(s + 'Shoulder', Q(clip, s + 'Shoulder', f));
    set(s + 'UpperArm', Q(clip, s + 'UpperArm', f).multiply(o));
    const conj = q => oi.clone().multiply(q).multiply(o);
    set(s + 'LowerArm', conj(Q(clip, s + 'ArmTwist', f).multiply(Q(clip, s + 'LowerArm', f))));
    set(s + 'Hand', conj(Q(clip, s + 'HandTwist', f).multiply(Q(clip, s + 'Hand', f))));
    for (const fn of Object.values(FINGERS)) if (clip.tracks.has(s + fn)) set(s + fn, conj(Q(clip, s + fn, f)));
  }
  // jambes : rotations directes, ou cinématique inverse vers la position des 足ＩＫ
  for (const s of ['left', 'right']) {
    set(s + 'UpperLeg', Q(clip, s + 'UpperLeg', f));
    set(s + 'LowerLeg', Q(clip, s + 'LowerLeg', f));
    set(s + 'Foot', Q(clip, s + 'Foot', f));
  }
  vrm.scene.updateMatrixWorld(true);
  if (clip.useIK && rest) {
    for (const s of ['left', 'right']) {
      const ul = P.bone(vrm, s + 'UpperLeg'), ll = P.bone(vrm, s + 'LowerLeg'), ft = P.bone(vrm, s + 'Foot');
      if (!ul || !ll || !ft) continue;
      const target = rest[s].clone().add(Pp(clip, s + 'FootIK', f).multiplyScalar(scale));
      ll.quaternion.copy(toLocal(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.25))); // genou plié vers l'avant
      P.ccd([ul, ll], ft, target, 12);
      // orientation du pied = celle de l'os IK
      const want = Q(clip, s + 'FootIK', f).multiply(rest[s + 'Q']);
      ft.parent.updateWorldMatrix(true, false);
      const pq = ft.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      ft.quaternion.copy(pq.multiply(want));
    }
    vrm.scene.updateMatrixWorld(true);
  }
  const w = {};
  clip.morphs.forEach((t, k) => {
    if (!t.length) return;
    let lo = 0; while (lo + 1 < t.length && t[lo + 1].f <= f) lo++;
    const a = t[lo], b = t[Math.min(t.length - 1, lo + 1)], kk = b.f > a.f ? Math.min(1, Math.max(0, (f - a.f) / (b.f - a.f))) : 0;
    w[k] = a.w + (b.w - a.w) * kk;
  });
  return w;
}

/** Positions et orientations des pieds au repos (pour la cinématique inverse). */
export function restFeet(vrm, M) {
  P.resetPose(vrm, M); vrm.scene.updateMatrixWorld(true);
  const r = {};
  for (const s of ['left', 'right']) {
    const ft = P.bone(vrm, s + 'Foot');
    r[s] = P.wpos(ft).clone(); r[s + 'Q'] = ft.getWorldQuaternion(new THREE.Quaternion());
  }
  return r;
}
