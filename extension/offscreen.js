/* Document offscreen (invisible) :
 *  - capte le son ET l'image de l'onglet,
 *  - rejoue le son de l'onglet,
 *  - détecte les beats dans le son (AudioWorklet) ou dans la barre rythmo à l'image,
 *  - joue les sons du dossier sons/ (gémissements, bruitages) sans qu'ils soient recapturés.
 * Les événements sont envoyés directement au content script via un port runtime. */
'use strict';

let ctx = null, stream = null, media = null, node = null, src = null, reader = null;
const ports = new Set();

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'goonfap') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener(onPortMessage);
  port.postMessage({ type: 'hello', running: !!ctx, sounds: Sounds.summary() });
});

function broadcast(msg) { ports.forEach(p => { try { p.postMessage(msg); } catch (e) { ports.delete(p); } }); }

function onPortMessage(m) {
  switch (m.type) {
    case 'settings':
      if (node) node.port.postMessage(m.settings);
      Sounds.configure(m.settings);
      break;
    case 'lane': Vision.setLane(m.lane, m.color, m.tol); break;
    case 'pick': Vision.pick(m); break;
    case 'mood': Sounds.mood(m.kind); break;
    case 'beat': Sounds.beat(); break;
    case 'clip': Sounds.oneShot(m.kind); break;
    case 'sound-index': Sounds.setIndex(m.files); break;
    case 'test-sounds': Sounds.test().then(ok => broadcast({ type: 'snd-test', ok })); break;
  }
}

chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (m.target !== 'offscreen') return;
  const done = p => p.then(() => send({ ok: true }), e => send({ ok: false, error: String(e && e.message || e) }));
  if (m.soundIndex) Sounds.setIndex(m.soundIndex);
  if (m.type === 'start') done(startTab(m.streamId, m.settings));
  else if (m.type === 'start-url') done(startUrl(m.url, m.settings)); // utilisé pour les tests
  else if (m.type === 'stop') { stopAll(); send({ ok: true }); }
  return true;
});

async function graph(settings) {
  await ctx.audioWorklet.addModule('onset-worklet.js');
  node = new AudioWorkletNode(ctx, 'gf-onset', { numberOfOutputs: 1, outputChannelCount: [1] });
  const sink = ctx.createGain(); sink.gain.value = 0;
  src.connect(node); node.connect(sink).connect(ctx.destination);
  src.connect(ctx.destination); // on continue d'entendre le son de l'onglet
  node.port.onmessage = e => broadcast(e.data);
  if (settings) { node.port.postMessage(settings); Sounds.configure(settings); }
  Sounds.attach(ctx);
}

async function startTab(streamId, settings) {
  stopAll();
  const mandatory = { chromeMediaSource: 'tab', chromeMediaSourceId: streamId };
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory },
      video: { mandatory: { ...mandatory, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 60 } },
    });
  } catch (e) { // au pire, le son seul
    stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory }, video: false });
  }
  ctx = new AudioContext({ latencyHint: 'interactive' });
  src = ctx.createMediaStreamSource(stream);
  await graph(settings);
  const vt = stream.getVideoTracks()[0];
  if (vt) Vision.start(vt);
  broadcast({ type: 'hello', running: true, sounds: Sounds.summary() });
}

async function startUrl(url, settings) {
  stopAll();
  media = document.createElement('video');
  media.crossOrigin = 'anonymous';
  media.src = url;
  media.muted = false;
  ctx = new AudioContext({ latencyHint: 'interactive' });
  src = ctx.createMediaElementSource(media);
  await graph(settings);
  await media.play();
  const vt = media.captureStream && media.captureStream().getVideoTracks()[0];
  if (vt) Vision.start(vt);
  broadcast({ type: 'hello', running: true, sounds: Sounds.summary() });
}

function stopAll() {
  Vision.stop();
  Sounds.detach();
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (media) media.pause();
  if (ctx) ctx.close().catch(() => {});
  ctx = stream = media = node = src = null;
}

// =====================================================================
// Vision : suit les repères d'une barre rythmo à l'image
//  1. profil horizontal : pour chaque colonne de la barre, part des pixels de la couleur des repères ;
//  2. vitesse de défilement mesurée sur TOUTE la barre (corrélation entre deux images),
//     séparément à gauche et à droite de la cible → robuste même quand les repères sont serrés ;
//  3. pour chaque repère qui approche : temps d'arrivée sur la cible (eta), envoyé au content script.
// =====================================================================
const Vision = (() => {
  let lane = null, color = null, tol = 90, pendingPick = null, running = false;
  let prevProf = null, prevTs = 0, lastProf = 0, tw = 0;
  const vel = { L: null, R: null };      // vitesse en px/ms (pixels du profil)
  const conf = { L: 0, R: 0 };           // nb d'images d'affilée où la vitesse est stable
  const cv = new OffscreenCanvas(400, 24), c2 = cv.getContext('2d', { willReadFrequently: true });
  const pc = new OffscreenCanvas(5, 5), p2 = pc.getContext('2d', { willReadFrequently: true });

  async function start(track) {
    stop();
    if (typeof MediaStreamTrackProcessor === 'undefined') { broadcast({ type: 'vision', ok: false }); return; }
    running = true;
    reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    broadcast({ type: 'vision', ok: true });
    const r = reader;
    while (running && r === reader) {
      let res;
      try { res = await r.read(); } catch (e) { break; }
      if (res.done) break;
      const f = res.value;
      try { frame(f); } catch (e) { /* image ratée : on ignore */ } finally { f.close(); }
    }
  }

  function stop() {
    running = false;
    if (reader) { reader.cancel().catch(() => {}); reader = null; }
    reset();
  }
  function reset() { prevProf = null; vel.L = vel.R = null; conf.L = conf.R = 0; tw = 0; }

  // Rectangle en pixels CSS de la page → pixels de l'image capturée (gère un éventuel letterbox)
  function mapRect(fw, fh, r, vw, vh) {
    const s = Math.min(fw / vw, fh / vh), ox = (fw - vw * s) / 2, oy = (fh - vh * s) / 2;
    return { x: ox + r.x * s, y: oy + r.y * s, w: r.w * s, h: r.h * s };
  }

  function frame(f) {
    const fw = f.displayWidth, fh = f.displayHeight;
    // horodatage de capture (µs) : intervalles précis même si le traitement a du retard
    const ts = f.timestamp != null ? f.timestamp / 1000 : performance.now();
    if (pendingPick) {
      const p = pendingPick; pendingPick = null;
      const r = mapRect(fw, fh, { x: p.x - 2, y: p.y - 2, w: 5, h: 5 }, p.vw, p.vh);
      p2.drawImage(f, r.x, r.y, Math.max(1, r.w), Math.max(1, r.h), 0, 0, 5, 5);
      const d = p2.getImageData(0, 0, 5, 5).data;
      const ch = k => { const a = []; for (let i = k; i < d.length; i += 4) a.push(d[i]); a.sort((x, y) => x - y); return a[a.length >> 1]; };
      broadcast({ type: 'picked', color: [ch(0), ch(1), ch(2)] });
    }
    if (!lane || !color) return;

    const r = mapRect(fw, fh, lane, lane.vw, lane.vh);
    const W = Math.max(40, Math.min(480, Math.round(r.w))), H = Math.max(3, Math.min(24, Math.round(r.h)));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; prevProf = null; }
    c2.drawImage(f, r.x, r.y, r.w, r.h, 0, 0, W, H);
    const d = c2.getImageData(0, 0, W, H).data;
    const prof = new Float32Array(W), tol2 = tol * tol, [cr, cg, cb] = color;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, dr = d[i] - cr, dg = d[i + 1] - cg, db = d[i + 2] - cb;
        if (dr * dr + dg * dg + db * db < tol2) prof[x]++;
      }
    }
    for (let x = 0; x < W; x++) prof[x] /= H;
    const T = lane.tx * W;

    // --- repères : groupes de colonnes, coupés en deux si deux repères se touchent ---
    const runs = [];
    let s = -1;
    for (let x = 0; x <= W; x++) {
      const v = x < W ? prof[x] : 0;
      if (v >= 0.12 && s < 0) s = x;
      else if (v < 0.12 && s >= 0) { runs.push([s, x - 1]); s = -1; }
    }
    if (runs.length) {
      const ws = runs.map(([a, b]) => b - a + 1).sort((a, b) => a - b);
      const m = ws[Math.floor(ws.length * 0.3)];
      tw = tw ? tw * 0.9 + m * 0.1 : m;
    }
    const blobs = [];
    for (const [a, b] of runs) {
      const w = b - a + 1, k = tw && w > tw * 1.7 ? Math.round(w / tw) : 1;
      for (let j = 0; j < k; j++) blobs.push(a + (j + 0.5) * w / k - 0.5);
    }

    // --- vitesse de défilement de chaque côté de la cible ---
    if (prevProf && ts > prevTs) {
      const dt = ts - prevTs;
      for (const side of ['L', 'R']) {
        const lo = side === 'L' ? 0 : Math.ceil(T), hi = side === 'L' ? Math.floor(T) : W;
        if (hi - lo < 8) continue;
        const v = vel[side];
        let sMin, sMax;
        if (v != null) { // on cherche près de la vitesse connue (évite de confondre deux repères voisins)
          const e = v * dt, win = Math.max(3, (tw || 6) * 1.2);
          sMin = Math.floor(e - win); sMax = Math.ceil(e + win);
        } else { sMax = Math.round(W * 0.12); sMin = -sMax; }
        const est = bestShift(prevProf, prof, lo, hi, sMin, sMax);
        if (est != null) {
          const nv = est / dt;
          // vitesse stable ? (sinon on attend avant de planifier : évite les doublons au démarrage)
          const stable = v != null && Math.abs(nv - v) <= Math.max(0.03, Math.abs(v) * 0.2);
          conf[side] = stable ? conf[side] + 1 : 0;
          vel[side] = v == null ? nv : v * 0.5 + nv * 0.5;
        }
      }
    }
    prevProf = prof; prevTs = ts;

    // --- temps d'arrivée de chaque repère qui approche de la cible ---
    const etas = [];
    for (const c of blobs) {
      const side = c < T ? 'L' : 'R', v = vel[side];
      if (v == null || Math.abs(v) < 0.005 || conf[side] < 3) continue; // barre immobile ou vitesse pas encore sûre
      if ((side === 'L' && v <= 0) || (side === 'R' && v >= 0)) continue; // s'éloigne de la cible
      const eta = (T - c) / v;
      if (eta >= -40 && eta < 1500) etas.push(Math.round(eta));
    }
    if (etas.length) broadcast({ type: 'vetas', etas });

    const now = performance.now();
    if (now - lastProf > 100) {
      lastProf = now;
      const N = 80, p = [];
      for (let k = 0; k < N; k++) p.push(Math.round(prof[Math.floor(k * W / N)] * 100) / 100);
      broadcast({ type: 'vprof', p, tx: lane.tx, n: blobs.length });
    }
  }

  // Décalage (en px, sous-pixel) qui superpose le mieux le profil précédent sur l'actuel
  function bestShift(a, b, lo, hi, sMin, sMax) {
    let best = -Infinity, bs = null, energy = 0;
    const scores = new Map();
    for (let x = lo; x < hi; x++) energy += b[x] * b[x];
    if (energy < 0.5) return null; // pas de repère de ce côté
    for (let sh = sMin; sh <= sMax; sh++) {
      let sc = 0, n = 0;
      for (let x = Math.max(lo, sh); x < Math.min(hi, a.length + sh); x++) { sc += b[x] * a[x - sh]; n++; }
      if (n < 8) continue;
      sc /= n;
      scores.set(sh, sc);
      if (sc > best) { best = sc; bs = sh; }
    }
    if (bs == null || best <= 0) return null;
    const l = scores.get(bs - 1), r = scores.get(bs + 1);
    if (l != null && r != null) { const den = l - 2 * best + r; if (den < 0) return bs + 0.5 * (l - r) / den; }
    return bs;
  }

  return {
    start, stop,
    setLane(l, c, t) { lane = l; color = c; if (t) tol = t; reset(); },
    pick(p) { pendingPick = p; },
  };
})();

// =====================================================================
// Sons : dossier sons/<moment>/ de l'extension
// =====================================================================
const Sounds = (() => {
  const KINDS = GF.KINDS;
  const MAP = { start: 'debut', warm: 'lent', medium: 'moyen', fast: 'rapide', tease: 'taquin', pause: 'stop', resume: 'reprise', praise: 'reprise', edge: 'bord', final: 'bord', cum: 'jouis', ruin: 'stop', denial: 'stop' };
  const LOOP = new Set(['lent', 'moyen', 'rapide', 'taquin']);
  const AUDIO = /\.(wav|mp3|ogg|oga|m4a|aac|flac|webm|opus)$/i;
  const files = {}; KINDS.forEach(k => { files[k] = []; });
  const buffers = new Map();
  let actx = null, opts = { clips: true, clipVol: 0.9, beatSfx: false, beatVol: 0.7, moans: true, beatKind: 'beat' }, current = null, cur = null, gapTimer = null;
  // Si un moment n'a pas de son, on prend le plus proche
  const FALLBACK = { lent: ['moyen', 'rapide'], moyen: ['lent', 'rapide'], rapide: ['moyen', 'lent'], taquin: ['lent', 'oral', 'moyen'] };
  const avail = k => (files[k] && files[k].length ? k : (FALLBACK[k] || []).find(f => files[f].length) || null);

  // La liste des sons est fournie par l'extension (un document offscreen ne peut pas lire son dossier)
  let readyResolve;
  const ready = new Promise(r => { readyResolve = r; });
  function setIndex(paths) {
    KINDS.forEach(k => { files[k] = []; });
    (paths || []).forEach(p => { const k = GF.classifySound(p); if (k) files[k].push(p); });
    readyResolve();
    broadcast({ type: 'sounds', sounds: summary() });
  }

  function summary() { const o = {}; KINDS.forEach(k => { o[k] = files[k].length; }); return o; }

  async function buffer(path) {
    if (buffers.has(path)) return buffers.get(path);
    // chaque morceau du chemin est encodé : les noms des packs contiennent des espaces, [ ], &, #…
    const url = chrome.runtime.getURL(path.split('/').map(encodeURIComponent).join('/'));
    const p = fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(b => actx.decodeAudioData(b));
    buffers.set(path, p);
    p.catch(() => buffers.delete(path));
    if (buffers.size > 60) buffers.delete(buffers.keys().next().value);
    return p;
  }
  const pick = list => list[Math.floor(Math.random() * list.length)];

  async function play(kind, vol, onEnd, maxDur) {
    if (!actx || !files[kind] || !files[kind].length) return null;
    try {
      const path = pick(files[kind]);
      const b = await buffer(path);
      if (maxDur && b.duration > maxDur) { // trop long pour un bruitage de beat : on l'écarte
        files[kind] = files[kind].filter(p => p !== path);
        return files[kind].length ? play(kind, vol, onEnd, maxDur) : null;
      }
      const s = actx.createBufferSource(), g = actx.createGain();
      g.gain.value = vol;
      s.buffer = b; s.connect(g).connect(actx.destination);
      if (onEnd) s.onended = onEnd;
      s.start();
      return s;
    } catch (e) { return null; }
  }

  // Ambiance : un gémissement après l'autre, selon le tempo du moment
  function loopMood() {
    clearTimeout(gapTimer);
    if (!opts.clips || !opts.moans || !current || !actx) return;
    const kind = avail(current);
    if (!kind) return;
    play(kind, opts.clipVol, () => {
      if (cur && cur.kind === kind) gapTimer = setTimeout(loopMood, 300 + Math.random() * 2500);
    }).then(s => { cur = s ? { s, kind } : null; if (!s) gapTimer = setTimeout(loopMood, 4000); });
  }

  function stopCurrent() { clearTimeout(gapTimer); if (cur) { try { cur.s.onended = null; cur.s.stop(); } catch (e) {} cur = null; } }

  return {
    summary, setIndex,
    attach(c) { actx = c; },
    detach() { stopCurrent(); actx = null; current = null; },
    configure(s) {
      Object.assign(opts, {
        clips: s.clips !== false, clipVol: s.clipVol ?? opts.clipVol, beatSfx: !!s.beatSfx, beatVol: s.beatVol ?? opts.beatVol,
        moans: s.moans !== false, beatKind: s.beatKind || opts.beatKind,
      });
      if (!opts.clips || !opts.moans) stopCurrent();
    },
    // Changement d'ambiance (lent/moyen/rapide/stop/bord…) : on enchaîne sur un son de ce moment
    mood(kind) {
      const k = MAP[kind] || kind;
      if (k === current) return;
      current = LOOP.has(k) ? k : null;   // seuls lent/moyen/rapide/taquin tournent en boucle
      if (!current) { stopCurrent(); return; }
      if (!opts.clips || !avail(k)) return;
      if (cur && cur.kind === avail(k)) return; // même famille de sons : on laisse finir
      stopCurrent();
      loopMood();
    },
    // Son ponctuel (début, stop, reprise, au bord, jouis), puis l'ambiance reprend
    oneShot(kind) {
      const k = MAP[kind] || kind;
      if (!opts.clips || !files[k] || !files[k].length) return;
      stopCurrent();
      play(k, opts.clipVol, () => { if (current) gapTimer = setTimeout(loopMood, 800); }).then(s => { cur = s ? { s, kind: k } : null; });
    },
    beat() {
      if (!opts.beatSfx) return;
      const fam = ['fap', 'beat', 'oral'].filter(k => files[k].length);
      if (!fam.length) return;
      const want = opts.beatKind === 'mix' ? fam[Math.floor(Math.random() * fam.length)] : opts.beatKind;
      play(fam.includes(want) ? want : fam[0], opts.beatVol, null, 1.2);
    },
    // Test : un claquement puis un orgasme (ou ce qu'on trouve)
    async test() {
      await ready;
      const order = ['fap', 'beat', 'oral', 'jouis', 'rapide', 'moyen', 'lent'].filter(k => files[k].length);
      if (!order.length || !actx) return false;
      const s = await play(order[0], opts.beatVol || 0.8, null, 1.2);
      if (order[1]) setTimeout(() => play(order.includes('jouis') ? 'jouis' : order[1], opts.clipVol), 700);
      return !!s;
    },
    has(kind) { const k = MAP[kind] || kind; return !!(files[k] && files[k].length); },
  };
})();
