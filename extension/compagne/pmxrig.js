/* Modèles MMD (.pmx) : chargement, et « adaptateur » pour que les animations de GoonFap
 * (écrites pour les VRM) s'appliquent aux os MMD standard.
 * Les os MMD de three.js sont dans le repère du monde (pas d'inversion), au repos en pose A. */
import * as THREE from './lib/three.module.js';
import { MMDLoader } from './lib/MMDLoader.js';
import { MMDAnimationHelper } from './lib/MMDAnimationHelper.js';

const nk = s => (s || '').normalize('NFKC').trim();
// os « humains » (noms VRM) → noms d'os MMD (formes normalisées NFKC : chiffres et IK en demi-chasse)
const MAP = {
  hips: ['センター'], hipsPos: ['下半身'], spine: ['上半身'], chest: ['上半身2', '上半身'], upperChest: ['上半身3'],
  neck: ['首'], head: ['頭'],
};
for (const [jp, s] of [['左', 'left'], ['右', 'right']]) {
  Object.assign(MAP, {
    [s + 'Shoulder']: [jp + '肩'], [s + 'UpperArm']: [jp + '腕'], [s + 'LowerArm']: [jp + 'ひじ'], [s + 'Hand']: [jp + '手首'],
    [s + 'UpperLeg']: [jp + '足'], [s + 'LowerLeg']: [jp + 'ひざ'], [s + 'Foot']: [jp + '足首'], [s + 'Toes']: [jp + 'つま先'],
    [s + 'ThumbProximal']: [jp + '親指1'], [s + 'IndexProximal']: [jp + '人指1'], [s + 'MiddleProximal']: [jp + '中指1'],
    [s + 'MiddleIntermediate']: [jp + '中指2'], [s + 'RingProximal']: [jp + '薬指1'], [s + 'LittleProximal']: [jp + '小指1'],
  });
}
// expressions GoonFap → morphs MMD
const EXPR = { aa: ['あ'], ih: ['い'], ou: ['う'], ee: ['え'], oh: ['お'], blink: ['まばたき'], happy: ['笑い', 'にこり'], angry: ['怒り'], sad: ['困る'], relaxed: ['にこり', 'なごみ'], surprised: ['びっくり'] };

// vêtements : matériaux reconnus par leur nom (chinois, japonais, anglais) → ordre du strip-tease
const CLOTH = [
  [0, /heel|shoe|boot|鞋|靴|拖鞋|鞋底|sandal/i],
  [1, /shirt|top|jacket|coat|hoodie|sweater|衬衣|上衣|背心|外套|シャツ|上着|tank|☆top/i],
  [2, /short|jean|skirt|pant|trouser|短裤|短袴|裤|裙|スカート|ズボン|bar(?!lace)/i],
  [3, /bra|奶罩|胸罩|ブラ|乳貼|乳贴|nipcover|pastie/i],
  [4, /pant(y|ies)|胖次|内袴|内裤|パンツ|下着|thong|string/i],
  [5, /lace|stocking|sock|tights|袜|靴下|ストッキング|legging/i],
];
const NOT_CLOTH = /body|skin|face|脸|顔|肌|hair|髪|髮|刘海|马尾|前髪|後頭部|眉|睫|目|白目|口|歯|舌|tongue|eye|neck|pubes|汗|液|tattoo|乳纹|emotion|二重|呆毛/i;

export async function loadPmx(url, physicsWanted) {
  const loader = new MMDLoader();
  const mesh = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
  const bones = mesh.skeleton.bones;
  const byName = new Map(bones.map(b => [nk(b.name), b]));
  const map = {};
  for (const [k, list] of Object.entries(MAP)) for (const n of list) { const b = byName.get(nk(n)); if (b) { map[k] = b; break; } }

  const helper = new MMDAnimationHelper({ afterglow: 0 });
  let physics = false;
  if (physicsWanted && globalThis.Ammo) { try { helper.add(mesh, { physics: true }); physics = true; } catch (e) { helper.add(mesh, { physics: false }); } }
  else helper.add(mesh, { physics: false });
  const sorted = helper._sortBoneDataArray(mesh.geometry.userData.MMD.bones.slice());
  const grant = helper.createGrantSolver(mesh);
  const ik = helper._createCCDIKSolver(mesh);

  const dict = mesh.morphTargetDictionary || {};
  const morphIdx = {};
  for (const [k, list] of Object.entries(EXPR)) for (const n of list) { if (dict[n] !== undefined) { morphIdx[k] = dict[n]; break; } }

  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const clothes = [];
  mats.forEach(m => {
    const n = m.name || '';
    if (NOT_CLOTH.test(n) || m.opacity < 0.02) return;      // invisible par défaut : tenue « cachée » du modèle
    const hit = CLOTH.find(([, re]) => re.test(n));
    if (hit) clothes.push({ rank: hit[0], mat: m, name: n });
  });

  // l'adaptateur : même interface que ce qu'utilisent poses.js et compagne.js pour un VRM
  const rig = {
    isPmx: true, noFlip: true, mesh, scene: mesh, physics,
    humanoid: { humanBones: Object.fromEntries(Object.keys(map).map(k => [k, {}])), getNormalizedBoneNode: n => map[n] || null, getRawBoneNode: n => map[n] || null },
    resetAll() { mesh.pose(); },
    // après la pose : os automatiques (+ cinématique inverse pour les animations MMD)
    solve(withIK) { mesh.updateMatrixWorld(true); helper._animatePMXMesh(mesh, sorted, withIK ? ik : null, grant); mesh.updateMatrixWorld(true); },
    physicsStep(dt) { if (physics) { const o = helper.objects.get(mesh); o.physics.update(dt); } },
    resetPhysics() { if (physics) { const o = helper.objects.get(mesh); o.physics.reset(); } },
    setExpr(k, w) { const i = morphIdx[k]; if (i !== undefined) mesh.morphTargetInfluences[i] = Math.max(mesh.morphTargetInfluences[i], w); },
    clearExpr() { for (const i of Object.values(morphIdx)) mesh.morphTargetInfluences[i] = 0; },
    clothes: () => clothes,
    loader,
    meta: { name: nk(mesh.geometry.userData.MMD.modelName || ''), comment: '' },
  };
  return rig;
}

/** Charge une animation .vmd pour ce modèle (lecture native, avec IK et morphs). */
export function loadVmdFor(rig, url) {
  return new Promise((res, rej) => rig.loader.loadAnimation(url, rig.mesh, res, undefined, rej));
}
