/* Retouche automatique de la peau d'un modèle VRoid pour le mettre nu :
 *  1. repère sur le modèle 3D la pointe des seins et l'entrejambe (rendu « UV » du corps),
 *  2. efface ce qui est peint sur la peau (collant, culotte…) en le remplaçant par la couleur de peau,
 *  3. dessine aréoles, tétons et sexe aux bons endroits.
 * Le fichier du modèle n'est jamais modifié : tout se fait en mémoire, au chargement. */
import * as THREE from './lib/three.module.js';

const isSkin = m => /body.*skin|skin.*body/i.test(m.name || '');

export function skinMaterials(vrm) {
  const out = new Set();
  vrm.scene.traverse(o => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (isSkin(m)) out.add(m); });
  });
  return [...out];
}

// Rendu spécial : chaque pixel du corps contient (u, v, profondeur)
function findPoints(vrm, renderer) {
  const W = 400, H = 800;
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 20);
  const bone = n => { const b = vrm.humanoid.getNormalizedBoneNode(n) || vrm.humanoid.getRawBoneNode(n); const v = new THREE.Vector3(); if (b) b.getWorldPosition(v); return v; };
  const neckW = bone('neck'), hipsW = bone('hips');
  const midY = (neckW.y + hipsW.y) / 2, span = Math.max(0.3, neckW.y - hipsW.y);
  cam.position.set(0, midY - span * 0.3, span * 3.4);
  cam.lookAt(0, midY - span * 0.3, 0);

  const mat = new THREE.ShaderMaterial({
    vertexShader: `#include <common>
#include <skinning_pars_vertex>
varying vec2 vUv; varying float vD;
void main(){ vUv = uv;
#include <skinbase_vertex>
#include <begin_vertex>
#include <skinning_vertex>
#include <project_vertex>
vD = -mvPosition.z; }`,
    fragmentShader: 'varying vec2 vUv; varying float vD; void main(){ gl_FragColor = vec4(vUv, vD, 1.0); }',
    side: THREE.DoubleSide,
  });
  const saved = [];
  vrm.scene.traverse(o => {
    if (!o.isMesh) return;
    saved.push([o, o.material, o.visible]);
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (ms.some(isSkin)) o.material = mat; else o.visible = false;
  });
  const scene = new THREE.Scene(); const parent = vrm.scene.parent; scene.add(vrm.scene);
  vrm.scene.updateMatrixWorld(true);
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
  const prevRT = renderer.getRenderTarget(), prevClear = renderer.getClearAlpha();
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
  const buf = new Float32Array(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  renderer.setRenderTarget(prevRT); renderer.setClearAlpha(prevClear);
  rt.dispose(); mat.dispose();
  saved.forEach(([o, m, v]) => { o.material = m; o.visible = v; });
  if (parent) parent.add(vrm.scene);

  const px = (x, y) => { const i = ((H - 1 - y) * W + x) * 4; return buf[i + 3] > 0 ? { u: buf[i], v: buf[i + 1], d: buf[i + 2] } : null; };
  const scr = w => { const v = w.clone().project(cam); return { x: Math.round((v.x + 1) / 2 * W), y: Math.round((1 - v.y) / 2 * H) }; };
  const neck = scr(neckW), hips = scr(hipsW), ls = scr(bone('leftUpperArm')), rs = scr(bone('rightUpperArm'));
  const y0 = neck.y + Math.round((hips.y - neck.y) * 0.15), y1 = neck.y + Math.round((hips.y - neck.y) * 0.55);
  const half = Math.max(10, Math.abs(ls.x - rs.x) / 2), cx = Math.round(W / 2);
  const res = {};
  for (const side of [-1, 1]) {
    let best = null;
    for (let y = y0; y < y1; y++) for (let k = Math.round(half * 0.1); k < half * 0.9; k++) {
      const p = px(cx + side * k, y); if (p && (!best || p.d < best.d)) best = p;
    }
    res[side < 0 ? 'breastA' : 'breastB'] = best;
  }
  let c = null;
  for (let y = hips.y; y < H; y++) { const p = px(cx, y); if (p) c = p; else if (c) break; }
  res.crotch = c;
  return res;
}

function boxBlur(src, w, h, r) { // flou rapide d'un masque (0..1)
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0; const row = y * w;
    for (let x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[row + x] = s / n; s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / n; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
  }
  return out;
}

function radial(g, x, y, r, rgb, a0, a1 = 0, stop = 1) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${rgb},${a0})`); gr.addColorStop(stop, `rgba(${rgb},${a0 * 0.85})`); gr.addColorStop(1, `rgba(${rgb},${a1})`);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

/** Met le modèle nu (en mémoire). Renvoie un petit rapport. */
export async function nudify(vrm, renderer) {
  const mats = skinMaterials(vrm);
  const m0 = mats.find(m => m.map && m.map.image);
  if (!m0) return { ok: false, why: 'peau du corps introuvable' };
  const pts = findPoints(vrm, renderer);
  const img = m0.map.image, W = img.width, H = img.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, W, H), d = id.data;
  const at = (u, v) => [Math.round(u * W), Math.round(v * H)];

  // Couleur de peau de référence : le ventre (entre les seins et l'entrejambe)
  let ref = [250, 228, 214];
  if (pts.breastA && pts.crotch) {
    const [x, y] = at(0.5, pts.breastA.v + (pts.crotch.v - pts.breastA.v) * 0.45);
    let r = 0, gg = 0, b = 0, n = 0;
    for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) { const k = ((y + j) * W + x + i) * 4; if (d[k + 3] > 200) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++; } }
    if (n) ref = [r / n, gg / n, b / n];
  }
  const refBR = ref[2] / ref[0], refL = (ref[0] + ref[1] + ref[2]) / 3;

  // 1. Masque de ce qui n'est pas de la peau (plus bleu/gris que la peau, ou trop sombre)
  const mask = new Float32Array(W * H);
  let lmin = 255, lmax = 0;
  for (let p = 0, k = 0; p < W * H; p++, k += 4) {
    if (d[k + 3] < 10) continue;
    const r = d[k] + 1, b = d[k + 2] + 1, l = (d[k] + d[k + 1] + d[k + 2]) / 3;
    if (b / r > refBR * 1.12 || l < refL * 0.55) { mask[p] = 1; if (l < lmin) lmin = l; if (l > lmax) lmax = l; }
  }
  // zone élargie (les bords des motifs) + ombrage tiré d'une luminosité très floutée (pas de fantôme des motifs)
  const soft = boxBlur(mask, W, H, 6);
  const lum = new Float32Array(W * H);
  for (let p = 0, k = 0; p < W * H; p++, k += 4) lum[p] = mask[p] ? (d[k] + d[k + 1] + d[k + 2]) / 3 : (lmin + lmax) / 2;
  const lumB = boxBlur(boxBlur(lum, W, H, 12), W, H, 12);
  for (let p = 0, k = 0; p < W * H; p++, k += 4) {
    const a = Math.min(1, Math.max(mask[p], soft[p] * 3));
    if (a <= 0) continue;
    const shade = 0.95 + 0.06 * Math.min(1, Math.max(0, (lumB[p] - lmin) / Math.max(1, lmax - lmin)));
    for (let c = 0; c < 3; c++) d[k + c] = d[k + c] * (1 - a) + Math.min(255, ref[c] * shade) * a;
  }
  g.putImageData(id, 0, 0);

  // 2. Seins : aréoles et tétons
  const S = Math.min(W, H);
  for (const b of [pts.breastA, pts.breastB]) {
    if (!b) continue;
    const [x, y] = at(b.u, b.v);
    radial(g, x, y, S * 0.015, '212,124,124', 0.8, 0, 0.6);      // aréole
    radial(g, x, y, S * 0.0048, '182,88,98', 0.95, 0.35, 0.6);   // téton
    radial(g, x - S * 0.0012, y - S * 0.0014, S * 0.0013, '255,225,225', 0.7); // reflet
  }
  // 3. Sexe : petite fente juste au-dessus de l'entrejambe (vers l'avant du bassin)
  if (pts.crotch) {
    const [x, y] = at(pts.crotch.u, pts.crotch.v);
    const len = S * 0.03, w = S * 0.0075, top = y - len - S * 0.002;
    g.save(); g.translate(x, top + len / 2); g.scale(1, len / w);
    radial(g, 0, 0, w * 1.3, '232,160,156', 0.35);              // lèvres : ombrage très doux
    g.restore();
    // fente : trait fin qui s'estompe aux deux bouts
    const gr = g.createLinearGradient(x, top, x, y);
    gr.addColorStop(0, 'rgba(170,86,96,0)'); gr.addColorStop(0.25, 'rgba(170,86,96,0.8)'); gr.addColorStop(0.85, 'rgba(170,86,96,0.85)'); gr.addColorStop(1, 'rgba(170,86,96,0.2)');
    g.strokeStyle = gr; g.lineWidth = Math.max(1.2, S * 0.001); g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, top + len * 0.05); g.quadraticCurveTo(x + S * 0.0005, top + len * 0.55, x, y - S * 0.001); g.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = m0.map.flipY; tex.colorSpace = m0.map.colorSpace; tex.wrapS = m0.map.wrapS; tex.wrapT = m0.map.wrapT;
  tex.needsUpdate = true;
  for (const m of mats) {
    if (m.map) m.map = tex;
    if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = tex;
    m.needsUpdate = true;
  }
  return { ok: true, pts, ref: ref.map(Math.round), canvas: cv };
}

/** Pièces de vêtements du modèle, dans un ordre de strip-tease. */
export function clothes(vrm) {
  const order = [/acc|access/i, /shoe|boot|chaus/i, /onepiece|dress|robe/i, /tops?_|top\b|shirt|haut/i, /bottom|skirt|pant|jupe/i, /under|bra|panty|lingerie/i];
  const items = [];
  vrm.scene.traverse(o => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    const n = ms.map(m => m.name || '').join(' ');
    if (/cloth/i.test(n) && !ms.some(isSkin)) {
      let rank = order.findIndex(re => re.test(n)); if (rank < 0) rank = 2;
      items.push({ mesh: o, rank, name: n });
    }
  });
  return items.sort((a, b) => a.rank - b.rank);
}
