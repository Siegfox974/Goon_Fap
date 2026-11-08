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
  }
}

chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (m.target !== 'offscreen') return;
  const done = p => p.then(() => send({ ok: true }), e => send({ ok: false, error: String(e && e.message || e) }));
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
// =====================================================================
const Vision = (() => {
  let lane = null, color = null, tol = 90, pendingPick = null, running = false;
  let tracks = [], nextId = 1, lastProf = 0;
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
      try { frame(f); } catch (e) { /* on ignore une image ratée */ } finally { f.close(); }
    }
  }

  function stop() {
    running = false;
    if (reader) { reader.cancel().catch(() => {}); reader = null; }
    tracks = [];
  }

  // Rectangle en pixels CSS de la page → pixels de l'image capturée (gère un éventuel letterbox)
  function mapRect(fw, fh, r, vw, vh) {
    const s = Math.min(fw / vw, fh / vh), ox = (fw - vw * s) / 2, oy = (fh - vh * s) / 2;
    return { x: ox + r.x * s, y: oy + r.y * s, w: r.w * s, h: r.h * s };
  }

  function frame(f) {
    const fw = f.displayWidth, fh = f.displayHeight, t = performance.now();
    if (pendingPick) {
      const p = pendingPick; pendingPick = null;
      const r = mapRect(fw, fh, { x: p.x - 2, y: p.y - 2, w: 5, h: 5 }, p.vw, p.vh);
      p2.drawImage(f, r.x, r.y, Math.max(1, r.w), Math.max(1, r.h), 0, 0, 5, 5);
      const d = p2.getImageData(0, 0, 5, 5).data;
      // médiane par canal : robuste aux bords du repère
      const ch = k => { const a = []; for (let i = k; i < d.length; i += 4) a.push(d[i]); a.sort((x, y) => x - y); return a[a.length >> 1]; };
      broadcast({ type: 'picked', color: [ch(0), ch(1), ch(2)] });
    }
    if (!lane || !color) return;

    const r = mapRect(fw, fh, lane, lane.vw, lane.vh);
    const W = Math.max(20, Math.min(400, Math.round(r.w))), H = Math.max(3, Math.min(24, Math.round(r.h)));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
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

    // Regroupe les colonnes en "repères"
    const blobs = [];
    let s = -1;
    for (let x = 0; x <= W; x++) {
      const v = x < W ? prof[x] : 0;
      if (v >= 0.12 && s < 0) s = x;
      else if (v < 0.12 && s >= 0) { blobs.push((s + x - 1) / 2 / W); s = -1; }
    }
    track(blobs, t);

    if (t - lastProf > 100) {
      lastProf = t;
      const N = 80, p = [];
      for (let k = 0; k < N; k++) p.push(Math.round(prof[Math.floor(k * W / N)] * 100) / 100);
      broadcast({ type: 'vprof', p, tx: lane.tx, n: blobs.length });
    }
  }

  // Suit chaque repère d'une image à l'autre, mesure sa vitesse, annonce son arrivée sur la cible
  function track(blobs, t) {
    const T = lane.tx, used = new Set(), next = [];
    for (const c of blobs) {
      let best = null, bd = 0.08;
      for (const tr of tracks) {
        if (used.has(tr)) continue;
        const dd = Math.abs(tr.c - c);
        if (dd < bd) { bd = dd; best = tr; }
      }
      if (best) {
        used.add(best);
        const dt = t - best.t;
        if (dt > 0) { const v = (c - best.c) / dt; best.v = best.n ? best.v * 0.6 + v * 0.4 : v; best.n++; }
        const prevD = best.c - T, dNow = c - T;
        best.c = c; best.t = t;
        if (!best.hit && (prevD === 0 || Math.sign(prevD) !== Math.sign(dNow))) { best.hit = true; broadcast({ type: 'vhit', id: best.id }); }
        next.push(best);
      } else next.push({ id: nextId++, c, t, v: 0, n: 0, hit: false });
    }
    // Repère disparu juste sur la cible = il a été "frappé"
    for (const tr of tracks) {
      if (!used.has(tr) && !tr.hit && tr.n >= 2 && Math.abs(tr.c - T) < Math.max(0.03, Math.abs(tr.v) * 80)) broadcast({ type: 'vhit', id: tr.id });
    }
    tracks = next;
    for (const tr of tracks) {
      if (tr.hit || tr.n < 2) continue;
      const d = tr.c - T;
      if (d * tr.v >= 0 || Math.abs(tr.v) < 1e-6) continue; // s'éloigne ou immobile
      const eta = -d / tr.v;
      if (eta < 1200) broadcast({ type: 'veta', id: tr.id, eta });
    }
  }

  return {
    start, stop,
    setLane(l, c, t) { lane = l; color = c; if (t) tol = t; tracks = []; },
    pick(p) { pendingPick = p; },
  };
})();

// =====================================================================
// Sons : dossier sons/<moment>/ de l'extension
// =====================================================================
const Sounds = (() => {
  const KINDS = ['debut', 'lent', 'moyen', 'rapide', 'taquin', 'stop', 'reprise', 'bord', 'jouis', 'beat'];
  const MAP = { start: 'debut', warm: 'lent', medium: 'moyen', fast: 'rapide', tease: 'taquin', pause: 'stop', resume: 'reprise', edge: 'bord', cum: 'jouis' };
  const LOOP = new Set(['lent', 'moyen', 'rapide', 'taquin']);
  const AUDIO = /\.(wav|mp3|ogg|oga|m4a|aac|flac|webm|opus)$/i;
  const files = {}; KINDS.forEach(k => { files[k] = []; });
  const buffers = new Map();
  let actx = null, opts = { clips: true, clipVol: 0.9, beatSfx: false, beatVol: 0.7, moans: true }, current = null, cur = null, gapTimer = null;

  // Liste les fichiers du dossier sons/ (lecture du répertoire de l'extension)
  const ready = new Promise(resolve => {
    if (!chrome.runtime.getPackageDirectoryEntry) return resolve();
    chrome.runtime.getPackageDirectoryEntry(root => {
      root.getDirectory('sons', {}, dir => {
        let pending = 0;
        const walk = (d, kind) => {
          pending++;
          const rd = d.createReader(), all = [];
          const more = () => rd.readEntries(es => {
            if (es.length) { all.push(...es); more(); return; }
            for (const e of all) {
              if (e.isDirectory) { const k = kind || (KINDS.includes(e.name.toLowerCase()) ? e.name.toLowerCase() : null); if (k) walk(e, k); }
              else if (kind && AUDIO.test(e.name)) files[kind].push(e.fullPath.replace(/^\/(crxfs\/)?/, ''));
            }
            if (--pending === 0) resolve();
          }, () => { if (--pending === 0) resolve(); });
          more();
        };
        walk(dir, null);
      }, () => resolve());
    });
  });
  ready.then(() => broadcast({ type: 'sounds', sounds: summary() }));

  function summary() { const o = {}; KINDS.forEach(k => { o[k] = files[k].length; }); return o; }

  async function buffer(path) {
    if (buffers.has(path)) return buffers.get(path);
    const p = fetch(chrome.runtime.getURL(path)).then(r => r.arrayBuffer()).then(b => actx.decodeAudioData(b));
    buffers.set(path, p);
    p.catch(() => buffers.delete(path));
    if (buffers.size > 60) buffers.delete(buffers.keys().next().value);
    return p;
  }
  const pick = list => list[Math.floor(Math.random() * list.length)];

  async function play(kind, vol, onEnd) {
    if (!actx || !files[kind] || !files[kind].length) return null;
    try {
      const b = await buffer(pick(files[kind]));
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
    const kind = current;
    play(kind, opts.clipVol, () => {
      if (cur && cur.kind === kind) gapTimer = setTimeout(loopMood, 300 + Math.random() * 2500);
    }).then(s => { cur = s ? { s, kind } : null; if (!s) gapTimer = setTimeout(loopMood, 4000); });
  }

  function stopCurrent() { clearTimeout(gapTimer); if (cur) { try { cur.s.onended = null; cur.s.stop(); } catch (e) {} cur = null; } }

  return {
    summary,
    attach(c) { actx = c; },
    detach() { stopCurrent(); actx = null; current = null; },
    configure(s) {
      Object.assign(opts, {
        clips: s.clips !== false, clipVol: s.clipVol ?? opts.clipVol, beatSfx: !!s.beatSfx, beatVol: s.beatVol ?? opts.beatVol,
        moans: s.moans !== false,
      });
      if (!opts.clips || !opts.moans) stopCurrent();
    },
    // Changement d'ambiance (lent/moyen/rapide/stop/bord…) : on enchaîne sur un son de ce moment
    mood(kind) {
      const k = MAP[kind] || kind;
      if (k === current) return;
      current = LOOP.has(k) ? k : null;   // seuls lent/moyen/rapide/taquin tournent en boucle
      if (!current) { stopCurrent(); return; }
      if (!opts.clips || !files[k].length) return;
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
    beat() { if (opts.beatSfx) play('beat', opts.beatVol); },
    has(kind) { const k = MAP[kind] || kind; return !!(files[k] && files[k].length); },
  };
})();
