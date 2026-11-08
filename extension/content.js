/* Overlay GoonFap injecté sur le site :
 *  - reçoit les beats (barre rythmo à l'image, ou son), fait vibrer la manette pile dessus,
 *  - affiche piste, messages, GIF et boutons par-dessus la vidéo,
 *  - fait parler la voix et pilote l'ambiance sonore (dossier sons/). */
(() => {
  'use strict';
  if (window.__goonfap) { window.__goonfap.show(); return; }

  // ---------- Réglages ----------
  let S = Object.assign({}, GF.DEFAULTS);
  chrome.storage.local.get('settings').then(r => { S = Object.assign({}, GF.DEFAULTS, GF.migrate(r.settings)); onSettings(); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.soundIndex) send({ type: 'sound-index', files: ch.soundIndex.newValue || [] });
    if (area === 'local' && ch.settings) { S = Object.assign({}, GF.DEFAULTS, GF.migrate(ch.settings.newValue)); onSettings(); }
  });
  const saveSettings = () => chrome.storage.local.set({ settings: S });
  // Source réellement utilisée : funscript s'il y en a un, sinon la barre rythmo calée, sinon le son
  let fsData = null;
  function src() {
    if (S.source === 'auto') return fsData ? 'funscript' : (S.lane ? 'visual' : 'audio');
    if (S.source === 'funscript' && !fsData) return 'audio';
    return S.source;
  }

  // ---------- Manette ----------
  function pad() {
    try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).find(Boolean) || null; }
    catch (e) { return null; }
  }
  let mainPad = null; // manette vue depuis la page (second chemin)
  function rumble(ms, strong, weak = strong) {
    const p = pad();
    strong = Math.max(0, Math.min(1, strong)); weak = Math.max(0, Math.min(1, weak));
    if (!(p && (p.vibrationActuator || p.hapticActuators)) && mainPad && mainPad.vib) {
      window.postMessage({ __gfRumble: { ms: Math.round(ms), s: strong, w: weak } }, '*');
      return true;
    }
    if (p && p.vibrationActuator && p.vibrationActuator.playEffect) {
      p.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: Math.round(ms), strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
      return true;
    }
    if (p && p.hapticActuators && p.hapticActuators[0]) { try { p.hapticActuators[0].pulse(Math.max(strong, weak), ms); return true; } catch (e) {} }
    return false;
  }
  function stopRumble() {
    window.postMessage({ __gfRumble: { stop: true } }, '*');
    const p = pad();
    if (p && p.vibrationActuator) (p.vibrationActuator.reset ? p.vibrationActuator.reset() : p.vibrationActuator.playEffect('dual-rumble', { duration: 10, strongMagnitude: 0, weakMagnitude: 0 })).catch(() => {});
  }

  // ---------- Overlay (Shadow DOM, isolé du CSS du site) ----------
  const host = document.createElement('div');
  host.id = 'goonfap-host';
  host.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;z-index:2147483647;pointer-events:none;color-scheme:normal;';
  // « Couche du dessus » du navigateur : GoonFap reste visible par-dessus TOUT, même le plein écran du site
  const usePopover = typeof host.showPopover === 'function';
  if (usePopover) host.setAttribute('popover', 'manual');
  function raise() {
    // En plein écran, Chrome rend tout ce qui est hors de l'élément plein écran non cliquable :
    // GoonFap se place donc DANS le lecteur (sauf si c'est la balise vidéo elle-même).
    const fe = document.fullscreenElement;
    const parent = fe && fe.tagName !== 'VIDEO' ? fe : document.documentElement;
    if (host.parentNode !== parent) { try { if (usePopover && host.matches(':popover-open')) host.hidePopover(); } catch (e) {} parent.appendChild(host); }
    if (usePopover) {
      try { if (host.matches(':popover-open')) host.hidePopover(); host.showPopover(); } catch (e) {}
    } else {
      const fe = document.fullscreenElement;
      const target = fe && fe.tagName !== 'VIDEO' ? fe : document.documentElement;
      if (host.parentNode !== target) target.appendChild(host);
    }
  }
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .vignette { position: fixed; inset: 0; pointer-events: none; opacity: 0;
    box-shadow: inset 0 0 120px 30px rgba(255,61,154,.85), inset 0 0 260px 60px rgba(155,92,255,.35); }
  .gifs { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; pointer-events: none; background: transparent; color-scheme: normal; }
  .msg { position: fixed; left: 50%; top: 34%; transform: translate(-50%,-50%) scale(.96); width: min(92vw, 1000px);
    text-align: center; color: #fff; font-weight: 900; font-size: clamp(26px, 4.6vw, 60px); line-height: 1.15;
    text-shadow: 0 0 22px #ff3d9a, 0 0 6px #ff3d9a, 0 3px 8px #000; opacity: 0; transition: opacity .35s, transform .35s; pointer-events: none; }
  .msg.show { opacity: 1; transform: translate(-50%,-50%) scale(1); }
  .msg small { display: block; font-size: .42em; font-weight: 600; margin-top: 10px; }
  canvas.track { position: fixed; left: 0; right: 0; bottom: 0; width: 100%; height: 96px; pointer-events: none; }
  .panel { position: fixed; top: 14px; right: 14px; pointer-events: auto; color: #f6e9f2; width: 336px;
    background: rgba(26,8,30,.88); border: 1px solid rgba(255,92,170,.4); border-radius: 16px; padding: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,.5); backdrop-filter: blur(6px); font-size: 13px; transition: opacity .4s; }
  .panel.dim { opacity: .5; } .panel.dim:hover { opacity: 1; }
  .head { display: flex; align-items: center; gap: 8px; }
  .logo { font-weight: 900; font-size: 18px; } .logo b { color: #ff3d9a; text-shadow: 0 0 10px #ff3d9a; }
  .heart { font-size: 20px; transition: transform .08s; display: inline-block; }
  .bpm { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 700; color: #ff86c2; }
  .line { margin: 6px 0; color: #cfb3c6; font-size: 12px; }
  .meter { height: 6px; background: rgba(255,255,255,.1); border-radius: 3px; overflow: hidden; margin: 6px 0; }
  .meter i { display: block; height: 100%; width: 0; background: linear-gradient(90deg,#9b5cff,#ff3d9a); transition: width .08s; }
  canvas.prev { width: 100%; height: 34px; display: block; background: rgba(0,0,0,.35); border-radius: 6px; margin: 6px 0; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; align-items: center; }
  button { background: rgba(255,255,255,.08); color: #f6e9f2; border: 1px solid rgba(255,92,170,.35); border-radius: 999px;
    padding: 6px 10px; font-size: 13px; cursor: pointer; }
  button:hover { background: rgba(255,61,154,.3); }
  button.hot { background: linear-gradient(135deg,#ff3d9a,#9b5cff); border: none; font-weight: 700; }
  button.on { border-color: #ff3d9a; background: rgba(255,61,154,.25); }
  .row button { padding: 6px 9px; }
  .val { min-width: 40px; text-align: center; font-weight: 700; color: #ff86c2; }
  .lbl { color: #cfb3c6; font-size: 12px; }
  .panel.min .full { display: none; } .panel.min { width: auto; }
  .hidden { display: none !important; }
  .calib { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; background: rgba(0,0,0,.01); }
  .banner { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); max-width: min(90vw, 640px); text-align: center;
    background: rgba(26,8,30,.95); color: #fff; border: 2px solid #ff3d9a; border-radius: 14px; padding: 10px 16px; font-size: 15px; font-weight: 700;
    pointer-events: none; box-shadow: 0 6px 24px rgba(0,0,0,.6); }
  .banner small { display: block; font-weight: 400; font-size: 12px; opacity: .85; margin-top: 4px; }
  .sel { position: fixed; border: 2px dashed #ff3d9a; pointer-events: none; }
  .tgt { position: fixed; width: 2px; background: #3dff8b; pointer-events: none; box-shadow: 0 0 8px #3dff8b; }
  .tapzone { position: fixed; inset: 0; pointer-events: auto; cursor: pointer; background: rgba(255,61,154,.06); }
  .tapzone.flash { background: rgba(255,61,154,.25); }
  .diagbox { position: fixed; inset: 0; pointer-events: auto; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; }
  .dcard { background: #1a0b1f; color: #f6e9f2; border: 2px solid #ff3d9a; border-radius: 14px; padding: 14px; width: min(92vw, 640px); font-size: 13px; }
  .dcard textarea { width: 100%; height: 260px; margin: 8px 0; background: #000; color: #9f9; font: 11px monospace; border-radius: 8px; }
  .swatch { display: inline-block; width: 14px; height: 14px; border-radius: 4px; vertical-align: middle; border: 1px solid #fff; margin-left: 6px; }
</style>
<div class="vignette"></div>
<iframe class="gifs" allowtransparency="true"></iframe>
<div class="msg"></div>
<canvas class="track"></canvas>
<input type="file" class="fsfile hidden" accept=".funscript,.json,application/json">
<div class="tapzone hidden"><div class="banner"></div></div>
<div class="diagbox hidden"><div class="dcard"><b>🩺 Diagnostic</b> — copié dans le presse-papiers. Colle-le dans ta conversation.<textarea readonly></textarea><button data-a="diagclose">Fermer</button></div></div>
<div class="calib hidden"><div class="sel hidden"></div><div class="tgt hidden"></div><div class="banner"></div></div>
<div class="panel">
  <div class="head">
    <span class="heart">💗</span><span class="logo">Goon<b>Fap</b></span>
    <span class="bpm">— BPM</span>
    <button data-a="min" title="Réduire">▁</button>
  </div>
  <div class="full">
    <div class="line pad">🎮 …</div>
    <div class="line sync">…</div>
    <canvas class="prev hidden" width="290" height="34"></canvas>
    <div class="meter"><i></i></div>
    <div class="line"><span class="snd">🎧 …</span> <button data-a="sndtest" title="Tester les sons">▶</button></div>
    <div class="row">
      <button data-a="calib" class="hot" title="Montre à GoonFap où est la barre rythmo">🎯 Caler sur la barre rythmo</button>
      <button data-a="source" title="Ce que GoonFap suit : auto / funscript / barre rythmo / son">🎵</button>
      <button data-a="loadfs" title="Charger un fichier .funscript">📂</button>
      <button data-a="tapcal" title="Caler les vibrations au doigt : tape sur 12 beats">👆 Caler au doigt</button>
      <button data-a="diag" title="Copier un rapport de diagnostic">🩺</button>
    </div>
    <div class="row">
      <span class="lbl" title="Puissance">💪</span><button data-a="down">−</button><span class="val pw">100%</span><button data-a="up">+</button>
      <span class="lbl" title="Synchro : avance des vibrations">⏱</span><button data-a="early" title="Vibrer plus tôt">⏪</button><span class="val off">70</span><button data-a="late" title="Vibrer plus tard">⏩</button>
    </div>
    <div class="row">
      <button data-a="play" title="Lecture / pause de la vidéo">⏯</button>
      <button data-a="immersive" title="Plein écran en gardant les messages">⛶</button>
      <button data-a="track" title="Afficher / masquer la piste">👁</button>
      <button data-a="voice" title="Voix on/off">🔊</button>
      <button data-a="gifs" title="GIF on/off">🖼</button>
    </div>
    <div class="row">
      <button data-a="edge" class="hot">🥵 Au bord !</button>
      <button data-a="cum" class="hot">💦 Je jouis</button>
      <button data-a="stop" title="Arrêter GoonFap">✕</button>
    </div>
  </div>
</div>`;
  const $ = s => root.querySelector(s);
  const panel = $('.panel'), msgEl = $('.msg'), vignette = $('.vignette'), canvas = $('canvas.track'), cx = canvas.getContext('2d');
  const prev = $('canvas.prev'), px = prev.getContext('2d'), gifFrame = $('iframe.gifs');
  gifFrame.src = chrome.runtime.getURL('gifview.html');
  document.documentElement.appendChild(host);
  raise();

  // ---------- Messages, voix, GIF ----------
  let msgTimer = null;
  function message(text, ms = 3200, opts = {}) {
    if (!text) return;
    text = GF.fit(text, S.anatomy);
    msgEl.innerHTML = text;
    msgEl.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => msgEl.classList.remove('show'), ms);
    if (S.voice && opts.speak !== false) {
      chrome.runtime.sendMessage({ type: 'gf-say', text: text.replace(/<small>.*<\/small>/, ''), opts: { voiceName: S.voiceName, rate: S.voiceRate, pitch: S.voicePitch } }).catch(() => {});
    }
    if (opts.gif || (S.gifs && Math.random() < 0.35)) showGif();
  }
  // kind : warm|medium|fast|tease|pause|resume|edge|cum|start
  function talk(kind, ms, extra = {}) {
    message(GF.say(kind, S.level, S.anatomy) + (extra.small ? `<small>${extra.small}</small>` : ''), ms, extra);
    if (['start', 'pause', 'resume', 'praise', 'edge', 'final', 'cum', 'ruin', 'denial'].includes(kind)) send({ type: 'clip', kind });
  }

  let gifCount = 0, lastGif = 0;
  function showGif(n = 1) {
    if (!S.gifs || !gifCount) return;
    const now = performance.now();
    if (now - lastGif < 2500 && n === 1) return;
    lastGif = now;
    // Les GIF évitent la barre rythmo (sinon ils fausseraient la détection)
    const avoidTop = src() === 'visual' && laneNow ? laneNow.y / innerHeight : 0.82;
    for (let i = 0; i < n; i++) setTimeout(() => gifFrame.contentWindow && gifFrame.contentWindow.postMessage({ gf: 'show', avoidTop, size: S.gifSize, dur: S.gifDur * 1000 }, '*'), i * 400);
  }
  window.addEventListener('message', e => {
    if (e.source !== gifFrame.contentWindow || !e.data || e.data.gf !== 'count') return;
    gifCount = e.data.n;
  });

  // ---------- Moteur de rythme commun ----------
  const st = {
    last: 0, lastAudio: 0, iv: [], locked: false, period: 0, timer: null, missTimer: null, predAt: 0, lastS: 0.8,
    hits: [], beats: 0, inPause: false, muteUntil: 0, fastSince: 0, nextTalk: 0, nextGif: 0, teaseTimer: null, flash: 0,
    lastFire: 0, mood: null,
  };
  const median = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  function currentBpm() {
    if (st.locked) return 60000 / st.period;
    if (st.iv.length >= 2) return 60000 / median(st.iv);
    return 0;
  }
  const silenceLimit = () => Math.max(2500, st.iv.length ? median(st.iv) * 2.5 : 0);

  function vibrate(s, now) {
    if (now < st.muteUntil) return false;
    // anti-doublon : jamais deux vibrations trop rapprochées
    const recent = st.iv.slice(-3);
    // plancher fixe (80 ms ≈ 750 BPM) : l'anti-doublon ne peut pas s'emballer sur ses propres vibrations
    const minGap = Math.max(80, recent.length >= 2 ? median(recent) * 0.45 : 80);
    if (now - st.lastFire < minGap) return false;
    const gap = Math.min(now - st.lastFire, recent.length ? median(recent) : 1000);
    st.lastFire = now;
    const bpm = currentBpm();
    let mag = S.power * (S.nuance ? s : 1);
    if (S.tempoBoost && bpm) mag *= 0.55 + 0.45 * Math.min(1, Math.max(0, (bpm - 60) / 140));
    // Tempo rapide : pulsations courtes, et surtout le petit moteur (plus nerveux) pour que chaque beat reste net.
    // Le gros moteur met trop de temps à s'arrêter : sur un tempo rapide il ferait un bourdonnement continu.
    const ms = Math.max(25, Math.min(S.pulse, gap * 0.5));
    const heavy = Math.min(1, Math.max(0, (gap - 140) / 220));
    rumble(ms, mag * heavy, mag);
    st.flash = 1;
    st.hits.push(now);
    host.dataset.fires = (+(host.dataset.fires || 0) + 1);
    try { if (localStorage.getItem('gfDebug')) { const dv = mainVideo(); host.dataset.ft = (host.dataset.ft ? host.dataset.ft + ',' : '') + Math.round(now); host.dataset.fv = (host.dataset.fv ? host.dataset.fv + ',' : '') + (dv ? Math.round(videoMs(dv)) : -1); } } catch (e) {}
    send({ type: 'beat' });
    return true;
  }

  // Enregistre un beat (pour le BPM, les pauses, l'ambiance)
  function registerBeat(now, refMs) {
    const d = refMs - st.lastAudio;
    if (st.last && d < 2000) { st.iv.push(d); if (st.iv.length > 8) st.iv.shift(); } else st.iv = [];
    st.last = now; st.lastAudio = refMs;
    st.beats++;
    if (st.iv.length >= 4) {
      const last4 = st.iv.slice(-4), m = median(last4);
      st.locked = last4.every(x => Math.abs(x - m) < m * 0.12);
      if (st.locked) st.period = m;
    } else st.locked = false;
    if (st.inPause) {
      st.inPause = false;
      stopTease();
      if (S.talk > 0) talk('resume', 2500);
      st.nextTalk = now + 4000;
    }
    const bpm = currentBpm();
    if (bpm) setMood(GF.kindForBpm(bpm));
  }
  function setMood(kind) { if (kind !== st.mood) { st.mood = kind; send({ type: 'mood', kind }); } }

  // ----- Source "son" : chaque attaque sonore -----
  function onOnset(s, at) {
    if (src() !== 'audio') return;
    const now = performance.now();
    const audioMs = at != null ? at * 1000 : now;
    st.lastS = s;
    const tol = Math.max(70, st.period * 0.22);
    const covered = st.predAt && Math.abs(now - st.predAt) < tol;
    clearTimeout(st.timer); clearTimeout(st.missTimer);
    if (!covered) vibrate(s, now);
    st.predAt = 0;
    registerBeat(now, audioMs);
    if (S.predict && st.locked) {
      const base = now;
      st.timer = setTimeout(() => {
        vibrate(st.lastS, performance.now());
        st.predAt = base + st.period;
        st.missTimer = setTimeout(() => { st.locked = false; st.iv = []; st.predAt = 0; }, Math.max(70, st.period * 0.22) + S.offset);
      }, Math.max(0, st.period - S.offset));
    }
  }

  // ----- Source "barre rythmo" : repères qui arrivent sur la cible -----
  // Le moteur envoie, à chaque image, le temps d'arrivée (eta) de chaque repère qui approche.
  // On regroupe ces estimations par instant d'arrivée : un beat planifié = un repère.
  const vis = { pend: [], fired: [], ok: null, prof: null };
  function onVEtas(etas) {
    if (src() !== 'visual' || calib) return;
    const now = performance.now();
    const recent = st.iv.slice(-3);
    const tol = Math.max(30, Math.min(120, (recent.length ? median(recent) : 300) * 0.45));
    vis.fired = vis.fired.filter(t => now - t < 1000);
    for (const eta of etas) {
      const at = now + eta - S.vOffset;
      if (vis.fired.some(t => Math.abs(t - at) < tol)) continue;      // déjà vibré pour ce repère
      let p = vis.pend.find(q => Math.abs(q.at - at) < tol);
      if (p) p.at = p.at * 0.3 + at * 0.7; else { p = { at }; vis.pend.push(p); }
      clearTimeout(p.timer);
      const wait = p.at - now;
      if (wait <= 4) firePend(p); else p.timer = setTimeout(() => firePend(p), wait);
    }
  }
  function firePend(p) {
    clearTimeout(p.timer);
    const i = vis.pend.indexOf(p);
    if (i < 0) return;
    vis.pend.splice(i, 1);
    const now = performance.now();
    vis.fired.push(p.at);
    if (vibrate(1, now)) registerBeat(now, now);
  }
  function clearPend() { vis.pend.forEach(p => clearTimeout(p.timer)); vis.pend = []; }

  // ----- Source "funscript" : le fichier de mouvements de la vidéo (faptap…) -----
  // On connaît à l'avance l'instant exact de chaque coup : synchro parfaite, rien à caler.
  function parseFunscript(raw) {
    let acts = (raw.actions || []).filter(a => a && isFinite(a.at) && isFinite(a.pos)).map(a => ({ at: +a.at, pos: raw.inverted ? 100 - a.pos : +a.pos }));
    acts.sort((a, b) => a.at - b.at);
    acts = acts.filter((a, i) => i === 0 || a.at !== acts[i - 1].at);
    // Points de retournement : bas (fin d'un coup vers le bas) et haut
    const beats = [];
    for (let i = 1; i < acts.length - 1; i++) {
      const p = acts[i - 1].pos, q = acts[i].pos, n = acts[i + 1].pos;
      const low = q < p && q <= n, high = q > p && q >= n;
      if (!low && !high) continue;
      // force = amplitude du mouvement qui arrive
      let j = i - 1; while (j > 0 && Math.sign(acts[j].pos - acts[j - 1].pos) === Math.sign(q - p)) j--;
      const amp = Math.abs(q - acts[j].pos) / 100;
      if (amp < 0.08) continue; // micro-mouvement
      beats.push({ at: acts[i].at, s: Math.max(0.35, Math.min(1, amp * 1.4)), low });
    }
    return { acts, beats, all: beats, lows: beats.filter(b => b.low) };
  }
  function loadFunscript(raw, from) {
    try {
      const p = parseFunscript(raw);
      if (p.all.length < 4) return;
      const highs = p.all.filter(b => !b.low);
      fsData = { acts: p.acts, all: p.all, lows: p.lows, highs, from };
      fsData.beats = fsPick();
      fsState.next = -1;
      if (src() === 'funscript') message(`📜 Funscript ${from === 'file' ? 'chargé' : 'trouvé sur la page'}<small>${fsData.beats.length} coups — synchro parfaite, rien à caler</small>`, 3500, { speak: false });
    } catch (e) {}
  }
  const fsState = { next: -1, lastT: -1, timers: [], flowAt: 0 };
  function fsPick() { return S.fMode === 'both' ? fsData.all : S.fMode === 'highs' ? fsData.highs : fsData.lows; }

  // ----- Calage au doigt : tu tapes sur les beats, GoonFap en déduit le décalage et le bon côté du mouvement -----
  let tapCal = null;
  const tapzone = root.querySelector('.tapzone'), tapBanner = tapzone.querySelector('.banner');
  const TAPS = 12;
  function startTapCal() {
    const v = mainVideo();
    if (!v) { message('Aucune vidéo trouvée sur cette page 🤔', 2500, { speak: false }); return; }
    if (!fsData) { message('Charge d\'abord un funscript (📂), ou laisse GoonFap le trouver sur la page', 3500, { speak: false }); return; }
    if (v.paused) v.play().catch(() => {});
    tapCal = { taps: [], v };
    st.muteUntil = Infinity; fsReset(); stopRumble(); // pas de vibration pendant le calage : on veut ton ressenti
    tapzone.classList.remove('hidden');
    tapBanner.innerHTML = `👆 Tape sur chaque beat de la vidéo — 0/${TAPS}<small>Clic n'importe où ou touche Espace, pile sur le rythme · Échap pour annuler</small>`;
  }
  function tap() {
    if (!tapCal) return;
    tapCal.taps.push(videoMs(tapCal.v));
    tapzone.classList.add('flash'); setTimeout(() => tapzone.classList.remove('flash'), 90);
    tapBanner.innerHTML = `👆 Tape sur chaque beat — ${tapCal.taps.length}/${TAPS}<small>Continue, bien en rythme…</small>`;
    if (tapCal.taps.length >= TAPS) finishTapCal();
  }
  function endTapCal() { tapzone.classList.add('hidden'); tapCal = null; st.muteUntil = 0; fsReset(); }
  function finishTapCal() {
    const taps = tapCal.taps.slice(2); // les 2 premiers servent à prendre le rythme
    const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
    let best = null;
    for (const [mode, set] of [['strokes', fsData.lows], ['highs', fsData.highs], ['both', fsData.all]]) {
      if (set.length < 4) continue;
      const ds = [];
      for (const t of taps) {
        let lo = 0, hi = set.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (set[m].at < t) lo = m + 1; else hi = m; }
        const cand = [set[lo - 1], set[lo]].filter(Boolean);
        const n = cand.reduce((a, b) => (Math.abs(b.at - t) < Math.abs(a.at - t) ? b : a));
        ds.push(t - n.at);
      }
      const m = med(ds), spread = med(ds.map(d => Math.abs(d - m)));
      // "both" a deux fois plus de cibles : il colle toujours un peu mieux, on le pénalise
      // à précision égale, on préfère le plus petit décalage (sur un rythme régulier, bas+½ période ≈ haut)
      const score = spread + 0.15 * Math.abs(m) + (mode === 'both' ? 25 : 0);
      if (!best || score < best.score) best = { mode, m, spread, score };
    }
    endTapCal();
    if (!best || best.spread > 120) { message('Pas assez régulier pour caler 😅<small>Recommence en tapant bien sur le rythme</small>', 3500, { speak: false }); return; }
    S.fMode = best.mode;
    S.fOffset = Math.max(-300, Math.min(400, Math.round(50 - best.m))); // 50 ms : temps de démarrage des moteurs
    saveSettings();
    const where = { strokes: 'en bas du mouvement', highs: 'en haut du mouvement', both: 'en haut ET en bas' }[best.mode];
    message(`✅ Calé ! Vibrations ${where}<small>Avance réglée à ${S.fOffset} ms · précision ±${Math.round(best.spread)} ms</small>`, 4500, { speak: false });
  }
  tapzone.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); tap(); });
  tapzone.addEventListener('touchstart', e => { e.preventDefault(); tap(); }, { passive: false });
  window.addEventListener('keydown', e => {
    if (!tapCal) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) tap(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTapCal(); }
  }, true);

  // ----- Diagnostic : rapport à copier-coller -----
  function diagnostic() {
    const v = mainVideo(), fe = document.fullscreenElement, p = pad();
    const desc = el => el ? (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '')) : null;
    const rep = {
      goonfap: chrome.runtime.getManifest().version, site: location.hostname, browser: navigator.userAgent.replace(/.*(Chrome|Edg)\/(\d+).*/, '$1 $2'),
      video: v ? { size: [Math.round(v.getBoundingClientRect().width), Math.round(v.getBoundingClientRect().height)], inShadowOrIframe: !document.contains(v), t: +v.currentTime.toFixed(2), duration: +(v.duration || 0).toFixed(1), paused: v.paused, rvfc: !!v.requestVideoFrameCallback, clock: vclock.ok, parents: (() => { const a = []; for (let q = v.parentElement; q && a.length < 4; q = q.parentElement) a.push(desc(q)); return a; })() } : null,
      fullscreen: desc(fe), hostIn: desc(host.parentElement), popover: usePopover ? host.matches(':popover-open') : 'non', screen: [innerWidth, innerHeight],
      pad: p ? { id: p.id, vib: !!p.vibrationActuator } : null, padPage: mainPad,
      source: S.source, used: src(), fOffset: S.fOffset, fMode: S.fMode, vOffset: S.vOffset, lane: !!S.lane, vision: vis.ok,
      funscript: fsData ? { from: fsData.from, actions: fsData.acts.length, lows: fsData.lows.length, highs: fsData.highs.length, first: fsData.acts[0] && fsData.acts[0].at, last: fsData.acts[fsData.acts.length - 1].at } : null,
      beats: st.beats, bpm: Math.round(currentBpm()), sounds, beatSfx: S.beatSfx, beatKind: S.beatKind, moans: S.moans,
    };
    const txt = JSON.stringify(rep, null, 1);
    root.querySelector('.diagbox textarea').value = txt;
    root.querySelector('.diagbox').classList.remove('hidden');
    try { navigator.clipboard.writeText(txt).catch(() => {}); } catch (e) {}
  }
  // Horloge précise de la vidéo : currentTime n'avance que par à-coups (une image à la fois).
  // requestVideoFrameCallback donne l'instant exact de chaque image : on extrapole entre deux.
  const vclock = { v: null, mt: 0, pt: 0, ok: false };
  function videoMs(v) {
    if (vclock.v !== v) {
      vclock.v = v; vclock.ok = false;
      if (v.requestVideoFrameCallback) {
        const cb = (now, md) => { if (vclock.v !== v) return; vclock.mt = md.mediaTime * 1000; vclock.pt = md.expectedDisplayTime || now; vclock.ok = true; v.requestVideoFrameCallback(cb); };
        v.requestVideoFrameCallback(cb);
      }
    }
    const ct = v.currentTime * 1000;
    if (vclock.ok && !v.paused) {
      const est = vclock.mt + (performance.now() - vclock.pt) * (v.playbackRate || 1);
      if (Math.abs(est - ct) < 250) return est;
    }
    return ct;
  }
  function fsIndex(t) { // premier coup à partir de t
    const b = fsData.beats; let lo = 0, hi = b.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (b[m].at < t) lo = m + 1; else hi = m; }
    return lo;
  }
  function fsReset() { fsState.timers.forEach(clearTimeout); fsState.timers = []; fsState.next = -1; }
  function fsTick() {
    if (!fsData || src() !== 'funscript' || calib) return;
    const v = mainVideo();
    if (!v || v.paused || v.seeking) { if (fsState.timers.length) fsReset(); return; }
    const rate = v.playbackRate || 1;
    const t = videoMs(v) + S.fOffset * rate;
    if (fsState.next < 0 || t < fsState.lastT - 50 || t - fsState.lastT > 600) { fsReset(); fsState.next = fsIndex(t); } // saut dans la vidéo
    fsState.lastT = t;
    if (S.fMode === 'flow') { fsFlow(v, t); return; }
    const b = fsData.beats;
    while (fsState.next < b.length && b[fsState.next].at <= t + 60) {
      const beat = b[fsState.next++];
      const delay = Math.max(0, (beat.at - t) / rate);
      const id = setTimeout(() => { fsState.timers = fsState.timers.filter(x => x !== id); const now = performance.now(); if (vibrate(beat.s, now)) registerBeat(now, now); }, delay);
      fsState.timers.push(id);
    }
  }
  // Mode continu : la vibration suit la vitesse du mouvement (comme un stroker)
  function fsFlow(v, t) {
    const a = fsData.acts;
    let i = 0, lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].at < t) lo = m + 1; else hi = m; }
    i = lo;
    if (i <= 0 || i >= a.length) return;
    const speed = Math.abs(a[i].pos - a[i - 1].pos) / Math.max(1, a[i].at - a[i - 1].at); // pos/ms
    const mag = S.power * Math.min(1, speed / 0.5);
    const now = performance.now();
    if (now - fsState.flowAt > 45) { fsState.flowAt = now; if (now >= st.muteUntil) rumble(80, mag * 0.8, mag); }
    // un coup de plus à chaque passage par le bas (pour le BPM, les pauses, la voix)
    if (i !== fsState.flowIdx) {
      fsState.flowIdx = i;
      const p = a[i - 2], q = a[i - 1];
      if (p && q.pos < p.pos && q.pos <= a[i].pos) { st.flash = 1; registerBeat(now, now); }
    }
  }
  const fsLoop = setInterval(fsTick, 25);
  window.postMessage({ __gfAsk: 1 }, '*'); // funscripts déjà repérés avant le lancement de GoonFap

  // Funscripts repérés dans la page par fs-hook.js
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data) return;
    if (e.data.__gfPad) mainPad = e.data.__gfPad.none ? null : e.data.__gfPad;
    else if (e.data.__gfFunscript) loadFunscript(e.data.__gfFunscript, 'page');
    else if (e.data.__gfTry) chrome.runtime.sendMessage({ type: 'gf-fetch', url: e.data.__gfTry }).then(t => { if (t) try { loadFunscript(JSON.parse(t), 'page'); } catch (er) {} }).catch(() => {});
  });
  // Fichier choisi à la main
  const fsInput = root.querySelector('.fsfile');
  fsInput.addEventListener('change', async () => {
    const f = fsInput.files[0];
    if (!f) return;
    try { loadFunscript(JSON.parse(await f.text()), 'file'); if (!fsData) throw new Error(); if (S.source !== 'auto') { S.source = 'funscript'; saveSettings(); } }
    catch (e) { message('❌ Ce fichier n\'est pas un funscript valide', 3000, { speak: false }); }
    fsInput.value = '';
  });

  // Battements de cœur pendant les pauses
  function startTease() {
    if (!S.tease || st.teaseTimer) return;
    const beat = () => {
      rumble(120, 0.18 * S.power, 0.3 * S.power);
      setTimeout(() => rumble(160, 0.12 * S.power, 0.22 * S.power), 260);
    };
    beat();
    st.teaseTimer = setInterval(beat, 1300);
  }
  function stopTease() { clearInterval(st.teaseTimer); st.teaseTimer = null; }

  // Boucle lente : pauses, paroles régulières, GIF, état du panneau, position de la barre
  const slow = setInterval(() => {
    const now = performance.now();
    const silent = now - st.last;
    if (!st.inPause && st.beats >= 4 && silent > silenceLimit()) {
      st.inPause = true; st.locked = false; st.iv = [];
      // Pause DANS la vidéo (beats arrêtés alors qu'elle tourne) → STOP. Si c'est toi qui as mis pause, ou si c'est la fin : rien.
      const vp = mainVideo();
      const userStopped = (vp && (vp.paused || vp.ended)) || dir.done;
      if (!userStopped) { talk('pause', 3500); startTease(); }
      setMood('pause');
      st.nextTalk = now + 9000;
    }
    const bpm = currentBpm();
    if (bpm >= 150) { if (!st.fastSince) st.fastSince = now; } else st.fastSince = 0;
    const active = !st.inPause && st.beats > 0 && silent < silenceLimit();
    if (active) { if (!st.activeSince) st.activeSince = now; } else st.activeSince = 0;

    director(now, bpm, active);

    if (S.talk > 0 && now >= st.nextTalk && now >= st.muteUntil && !calib && !dir.countdown) {
      let kind = null;
      if (st.inPause) kind = 'pause';
      else if (active && bpm) {
        const r = Math.random();
        if (dir.finalSaid && r < 0.5) kind = 'final';                                     // la fin de la vidéo approche
        else if (st.fastSince && now - st.fastSince > 25000 && r < 0.4) kind = 'edge';    // longtemps à fond
        else if (st.activeSince && now - st.activeSince > 40000 && r < 0.35) kind = 'goon'; // longue séance : transe
        else kind = GF.kindForBpm(bpm);
      }
      if (kind) talk(kind);
      st.nextTalk = now + talkGap();
    }
    if (S.gifs && gifCount && now >= st.nextGif && !calib) {
      if (st.beats) showGif();
      st.nextGif = now + S.gifEvery * 1000 * (0.7 + Math.random() * 0.6);
    }
    updateLane();
    updatePanel(bpm, silent);
  }, 200);

  // ---------- Le « cerveau » de la voix : réagit à ce que fait la vidéo ----------
  const dir = { hist: [], lastHist: 0, lastTempoTalk: 0, finalSaid: false, countdown: false, lastN: 0, done: false };
  const talkGap = () => ([0, 22, 12, 6][S.talk] || 12) * 1000 * (0.7 + Math.random() * 0.6);
  function director(now, bpm, active) {
    if (calib) return;
    // 1. Accélérations / ralentissements de la vidéo
    if (now - dir.lastHist > 1000) {
      dir.lastHist = now;
      dir.hist.push(active ? bpm : 0);
      if (dir.hist.length > 6) dir.hist.shift();
      const old = dir.hist[0];
      if (S.talk > 0 && active && old && bpm && now - dir.lastTempoTalk > 9000 && now >= st.muteUntil && !dir.countdown) {
        const ratio = bpm / old;
        if (ratio > 1.18) { talk('faster', 2800); dir.lastTempoTalk = now; st.nextTalk = now + talkGap(); }
        else if (ratio < 0.8) { talk('slower', 2800); dir.lastTempoTalk = now; st.nextTalk = now + talkGap(); }
      }
    }
    // 2. Fin de la vidéo : annonce, compte à rebours, puis orgasme (ou ruiné / déni)
    const v = mainVideo();
    if (!v || !isFinite(v.duration) || v.duration < 60 || S.finale === 'off') return;
    const rem = v.duration - v.currentTime;
    if (rem > 100) { dir.finalSaid = dir.countdown = dir.done = false; dir.lastN = 0; return; } // retour en arrière / vidéo suivante
    if (v.paused || dir.done) return;
    if (rem <= 75 && !dir.finalSaid) { dir.finalSaid = true; talk('final', 4000); st.nextTalk = now + talkGap(); }
    if (rem <= 10.5 && !dir.countdown) { dir.countdown = true; dir.lastN = 11; }
    if (dir.countdown) {
      const n = Math.ceil(rem - 0.3);
      if (n >= 1 && n < dir.lastN) {
        dir.lastN = n;
        message(`<span style="font-size:1.8em">${n}</span>`, 950, { gif: false });
      }
      if (rem <= 0.6 || v.ended) { dir.done = true; dir.countdown = false; finale(); }
    }
  }
  function finale() {
    const kind = S.finale === 'ruin' ? 'ruin' : S.finale === 'denial' ? 'denial' : 'cum';
    if (kind === 'cum') {
      talk('cum', 7000, { gif: true });
      showGif(3);
      rumble(5000, S.power, S.power);
      st.muteUntil = performance.now() + 5000;
    } else {
      // ruiné / déni : on coupe tout, net
      clearPend(); clearTimeout(st.timer); stopRumble();
      st.muteUntil = performance.now() + 20000;
      talk(kind, 7000);
    }
    setTimeout(() => { if (alive) talk('after', 5000); }, 9000);
  }

  // ---------- Panneau ----------
  let level = 0, sounds = null;
  function soundsLine() {
    if (!sounds) return '🎧 Sons : …';
    const n = k => sounds[k] || 0;
    const moans = n('lent') + n('moyen') + n('rapide');
    if (!moans && !n('fap') && !n('beat') && !n('oral') && !n('jouis')) return '🎧 Aucun son (dossier sons/ vide)';
    return `🎧 ${n('fap')} fap · ${n('beat')} claquements · ${n('oral')} bouche · ${moans} gémissements · ${n('jouis')} orgasmes` + (S.beatSfx ? '' : ' (bruitage par beat coupé)');
  }
  function updatePanel(bpm, silent) {
    $('.bpm').textContent = bpm && silent < silenceLimit() ? `${Math.round(bpm)} BPM` : '— BPM';
    const p0 = pad();
    const p = p0 || (mainPad && mainPad.id ? mainPad : null);
    const canVibe = p0 ? (p0.vibrationActuator || (p0.hapticActuators && p0.hapticActuators[0])) : (p && p.vib);
    $('.pad').textContent = !p ? '🎮 Clique sur la page puis appuie sur un bouton de la manette pour la connecter'
      : canVibe ? '🎮 Manette prête — vibrations à fond 💓' : '🎮 Manette sans vibration dans ce navigateur (utilise Chrome/Edge)';
    let sync;
    const mode = src(), visual = mode === 'visual', fsMode = mode === 'funscript';
    if (calib) sync = '🎯 Calibration en cours…';
    else if (performance.now() < st.muteUntil) sync = '✋ Pause « au bord »… on reprend bientôt';
    else if (visual && !S.lane) sync = '👁 Mode barre rythmo : clique sur 🎯 pour la montrer à GoonFap';
    else if (visual && vis.ok === false) sync = '❌ Capture de l\'image impossible ici — passe en mode 🎵';
    else if (st.inPause) sync = '✋ Pause' + (S.tease ? ' — battements de cœur 💓' : '');
    else if (!st.beats || silent > silenceLimit()) sync = fsMode ? `📜 Funscript chargé (${fsData.beats.length} coups) — lance la vidéo ▶` : visual ? '👁 J\'attends que les repères bougent… lance la vidéo ▶' : '🎵 En attente du rythme… lance la vidéo ▶';
    else sync = fsMode ? '📜 Calé sur le funscript de la vidéo 🔒' : visual ? '👁 Calé sur la barre rythmo 🔒' : (st.locked ? '🎵 Calé sur le tempo du son 🔒' : '🎵 Suit chaque beat du son');
    $('.sync').textContent = sync;
    $('.pw').textContent = Math.round(S.power * 100) + '%';
    $('.off').textContent = (fsMode ? S.fOffset : visual ? S.vOffset : S.offset) + ' ms';
    $('[data-a="source"]').textContent = (S.source === 'auto' ? 'Auto : ' : '') + (fsMode ? '📜 Script' : visual ? '👁 Barre' : '🎵 Son');
    $('.snd').textContent = soundsLine();
    $('[data-a="voice"]').classList.toggle('on', !!S.voice);
    $('[data-a="gifs"]').classList.toggle('on', !!S.gifs);
    $('[data-a="gifs"]').title = gifCount ? `GIF on/off (${gifCount} GIF)` : 'Aucun GIF : mets-en dans le dossier gifs/ de l\'extension';
    $('.meter').classList.toggle('hidden', mode !== 'audio');
    prev.classList.toggle('hidden', !visual || !S.lane);
    $('.meter i').style.width = Math.min(100, level * 40) + '%';
  }

  function drawPreview() {
    const w = prev.width, h = prev.height;
    px.clearRect(0, 0, w, h);
    if (!vis.prof) return;
    const p = vis.prof.p, bw = w / p.length;
    px.fillStyle = S.lane && S.lane.color ? `rgb(${S.lane.color.join(',')})` : '#ff3d9a';
    p.forEach((v, i) => { const bh = Math.min(1, v * 1.5) * (h - 4); px.fillRect(i * bw, h - 2 - bh, Math.max(1, bw - 1), bh); });
    px.fillStyle = '#3dff8b'; px.fillRect(vis.prof.tx * w - 1, 0, 2, h);
  }

  // ---------- Piste + animations ----------
  function draw() {
    if (!alive) return;
    requestAnimationFrame(draw);
    const now = performance.now();
    st.flash *= 0.86;
    const visual = src() === 'visual';
    // En mode barre rythmo, pas de lueur ni de piste : elles fausseraient la capture de l'image
    vignette.style.opacity = visual ? '0' : (st.flash * 0.9).toFixed(3);
    $('.heart').style.transform = `scale(${1 + st.flash * 0.5})`;
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, w, h);
    if (!S.track || visual || calib) return;
    const look = 2200, tx = Math.max(60, w * 0.15), pps = (w - tx) / look, cy = h * 0.55;
    const g = cx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.4, 'rgba(25,0,25,.55)'); g.addColorStop(1, 'rgba(0,0,0,.75)');
    cx.fillStyle = g; cx.fillRect(0, 0, w, h);
    cx.strokeStyle = 'rgba(255,61,154,.35)'; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(0, cy); cx.lineTo(w, cy); cx.stroke();
    cx.beginPath(); cx.arc(tx, cy, 22 + st.flash * 10, 0, Math.PI * 2);
    cx.strokeStyle = `rgba(255,134,194,${0.6 + st.flash * 0.4})`; cx.lineWidth = 3; cx.stroke();
    if (st.flash > 0.05) { cx.fillStyle = `rgba(255,61,154,${st.flash * 0.6})`; cx.fill(); }
    st.hits = st.hits.filter(t => now - t < 1500);
    for (const t of st.hits) heart(tx - (now - t) * pps, cy, 16, `rgba(255,134,194,${1 - (now - t) / 1500})`);
    if (src() === 'funscript' && fsData) { // on connaît l'avenir : les vrais coups à venir
      const v = mainVideo();
      if (v) {
        const t = videoMs(v), rate = v.playbackRate || 1;
        let i = fsIndex(t);
        for (; i < fsData.beats.length; i++) {
          const b = fsData.beats[i], dtm = (b.at - t) / rate;
          if (dtm > look) break;
          heart(tx + dtm * pps, cy, 12 + 8 * b.s, '#ff3d9a');
        }
      }
    } else if (st.locked && !st.inPause) {
      for (let k = 1; ; k++) {
        const t = st.last + k * st.period;
        if (t - now > look) break;
        if (t > now) heart(tx + (t - now) * pps, cy, 18, '#ff3d9a');
      }
    }
  }
  function heart(x, y, r, color) {
    cx.save(); cx.translate(x, y); cx.scale(r / 16, r / 16);
    cx.beginPath(); cx.moveTo(0, 6);
    cx.bezierCurveTo(-16, -6, -8, -18, 0, -9); cx.bezierCurveTo(8, -18, 16, -6, 0, 6);
    cx.shadowColor = color; cx.shadowBlur = 12; cx.fillStyle = color; cx.fill(); cx.restore();
  }

  // ---------- Vidéo, plein écran ----------
  // Cherche la vidéo principale, y compris cachée dans un composant (shadow DOM) ou une iframe du même site.
  // Le résultat est gardé 1 s (la recherche complète coûte cher).
  const mv = { v: null, at: 0 };
  function allVideos(rootNode, out, depth = 0) {
    if (depth > 6) return out;
    rootNode.querySelectorAll('video').forEach(v => out.push(v));
    rootNode.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) allVideos(el.shadowRoot, out, depth + 1);
      if (el.tagName === 'IFRAME') { try { const d = el.contentDocument; if (d) allVideos(d, out, depth + 1); } catch (e) {} }
    });
    return out;
  }
  function mainVideo() {
    const now = performance.now();
    if (mv.v && mv.v.isConnected && now - mv.at < 1000) return mv.v;
    let best = null, area = 0;
    for (const v of allVideos(document, [])) {
      const r = v.getBoundingClientRect(), a = r.width * r.height;
      if (a > area || (a === area && !v.paused)) { best = v; area = a; }
    }
    mv.v = area > 0 ? best : null; mv.at = now;
    return mv.v;
  }
  // Zone réellement occupée par l'image dans l'élément <video> (bandes noires exclues)
  function videoBox(v) {
    const r = v.getBoundingClientRect();
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return { x: r.left, y: r.top, w: r.width, h: r.height };
    const s = Math.min(r.width / vw, r.height / vh), w = vw * s, h = vh * s;
    return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h };
  }
  // Plein écran GoonFap : comme le bouton plein écran du site (le lecteur passe en plein écran).
  // Si la vidéo ne remplit pas l'écran, on la plaque par-dessus tout le reste.
  let imm = null; // { v, anc:[], hadControls } quand la vidéo est plaquée
  function playerWrapper(v) {
    const vr = v.getBoundingClientRect(), va = Math.max(1, vr.width * vr.height);
    let best = null;
    for (let p = v.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const r = p.getBoundingClientRect();
      if (r.width * r.height > va * 2.2 + 1) break; // trop grand : ce n'est plus le lecteur
      best = p;
    }
    return best;
  }
  async function toggleImmersive() {
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); exitImmersive(); return; }
    const v = mainVideo();
    if (!v) { message('Aucune vidéo trouvée sur cette page 🤔', 2500, { speak: false }); return; }
    const wrap = playerWrapper(v);
    try { await (wrap || document.documentElement).requestFullscreen({ navigationUI: 'hide' }); }
    catch (e) {
      try { await document.documentElement.requestFullscreen(); }
      catch (e2) { message('Le navigateur a refusé le plein écran — appuie sur F11 😉', 3500, { speak: false }); return; }
    }
    setTimeout(() => {
      if (!document.fullscreenElement) return;
      const r = v.getBoundingClientRect();
      if (r.width < innerWidth * 0.9 && r.height < innerHeight * 0.9) plaque(v); // la vidéo est restée petite
    }, 500);
  }
  function plaque(v) {
    if (imm) return;
    const anc = [];
    for (let p = v.parentElement; p && p !== document.documentElement; p = p.parentElement) anc.push(p);
    imm = { v, anc, hadControls: v.controls };
    anc.forEach(e => e.classList.add('gf-fs-anc'));
    v.classList.add('gf-immersive-video');
    v.controls = true;
  }
  function exitImmersive() {
    if (!imm) return;
    imm.anc.forEach(e => e.classList.remove('gf-fs-anc'));
    imm.v.classList.remove('gf-immersive-video');
    imm.v.controls = imm.hadControls;
    imm = null;
  }
  const onFs = () => {
    const fe = document.fullscreenElement;
    if (!fe) exitImmersive();
    raise(); // repasse au-dessus du nouvel élément plein écran
    setTimeout(raise, 150); // Chrome finit parfois de placer l'élément plein écran juste après l'événement
    panel.classList.toggle('dim', !!fe);
  };
  document.addEventListener('fullscreenchange', onFs);

  // ---------- Barre rythmo : position et calibration ----------
  // S.lane = { ref:'video'|'viewport', x,y,w,h (fractions de la référence), tx (0..1 dans la barre), color:[r,g,b] }
  let laneNow = null, laneSent = '';
  function refBox() {
    const v = mainVideo();
    if (v) return { ref: 'video', ...videoBox(v) };
    return { ref: 'viewport', x: 0, y: 0, w: innerWidth, h: innerHeight };
  }
  function updateLane() {
    let msg = { type: 'lane', lane: null };
    laneNow = null;
    if (src() === 'visual' && S.lane && !calib) {
      const L = S.lane;
      const b = L.ref === 'video' && mainVideo() ? videoBox(mainVideo()) : { x: 0, y: 0, w: innerWidth, h: innerHeight };
      laneNow = { x: b.x + L.x * b.w, y: b.y + L.y * b.h, w: L.w * b.w, h: L.h * b.h, tx: L.tx, vw: innerWidth, vh: innerHeight };
      msg = { type: 'lane', lane: laneNow, color: L.color, tol: S.vTol };
    }
    const key = JSON.stringify(msg);
    if (key !== laneSent) { laneSent = key; send(msg); }
  }

  let calib = null;
  const layer = $('.calib'), sel = $('.sel'), tgt = $('.tgt'), banner = $('.banner');
  function startCalib() {
    const v = mainVideo();
    calib = { step: 1, v, wasPlaying: v && !v.paused };
    if (v) v.pause();
    S.source = 'visual';
    updateLane();
    layer.classList.remove('hidden'); sel.classList.add('hidden'); tgt.classList.add('hidden');
    banner.innerHTML = '1/3 — Trace un rectangle autour de la barre rythmo<small>Clique-glisse pour l\'encadrer bien serré (la vidéo est mise en pause). Échap pour annuler.</small>';
  }
  function endCalib(ok) {
    layer.classList.add('hidden');
    const c = calib; calib = null;
    if (c && c.v && c.wasPlaying) c.v.play().catch(() => {});
    if (ok) { saveSettings(); message('Calée ! Je suis ta barre rythmo à la lettre 😈', 3000, { speak: false }); }
    laneSent = '';
    updateLane();
  }
  let drag = null;
  layer.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    if (!calib) return;
    if (calib.step === 1) { drag = { x: e.clientX, y: e.clientY }; place(sel, e.clientX, e.clientY, 0, 0); sel.classList.remove('hidden'); }
    else if (calib.step === 2) {
      banner.innerHTML = 'Je lis la couleur…';
      calib.waitPick = true;
      send({ type: 'pick', x: e.clientX, y: e.clientY, vw: innerWidth, vh: innerHeight });
      setTimeout(() => { if (calib && calib.waitPick) { banner.innerHTML = '❌ Je ne reçois pas l\'image de l\'onglet. Relance GoonFap depuis l\'icône, ou utilise le mode 🎵.<small>Échap pour fermer</small>'; } }, 2000);
    } else if (calib.step === 3) {
      const r = calib.rect;
      const tx = Math.max(0, Math.min(1, (e.clientX - r.x) / r.w));
      const b = refBox();
      S.lane = { ref: b.ref, x: (r.x - b.x) / b.w, y: (r.y - b.y) / b.h, w: r.w / b.w, h: r.h / b.h, tx, color: calib.color };
      S.source = 'visual';
      endCalib(true);
    }
  });
  layer.addEventListener('mousemove', e => {
    if (!drag || !calib || calib.step !== 1) return;
    place(sel, Math.min(drag.x, e.clientX), Math.min(drag.y, e.clientY), Math.abs(e.clientX - drag.x), Math.abs(e.clientY - drag.y));
  });
  layer.addEventListener('mouseup', e => {
    if (!drag || !calib || calib.step !== 1) return;
    const r = { x: Math.min(drag.x, e.clientX), y: Math.min(drag.y, e.clientY), w: Math.abs(e.clientX - drag.x), h: Math.abs(e.clientY - drag.y) };
    drag = null;
    if (r.w < 40 || r.h < 6) { banner.innerHTML = 'Trop petit 😅 Recommence : encadre toute la barre rythmo.<small>Échap pour annuler</small>'; return; }
    calib.rect = r; calib.step = 2;
    banner.innerHTML = '2/3 — Clique au centre d\'un repère (losange, cercle…)<small>Je retiens sa couleur pour le suivre</small>';
  });
  function onPicked(color) {
    if (!calib || !calib.waitPick) return;
    calib.waitPick = false; calib.color = color; calib.step = 3;
    banner.innerHTML = `3/3 — Clique sur la zone de frappe<span class="swatch" style="background:rgb(${color.join(',')})"></span><small>Là où les repères doivent arriver pour que ça vibre</small>`;
    tgt.style.left = '-10px';
  }
  layer.addEventListener('mousemove', e => {
    if (!calib || calib.step !== 3) return;
    const r = calib.rect;
    tgt.classList.remove('hidden');
    place(tgt, Math.max(r.x, Math.min(r.x + r.w, e.clientX)) - 1, r.y - 6, 2, r.h + 12);
  });
  function place(el, x, y, w, h) { Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); }
  const onKey = e => { if (calib && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endCalib(false); } };
  window.addEventListener('keydown', onKey, true);

  // ---------- Boutons ----------
  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    const now = performance.now();
    switch (b.dataset.a) {
      case 'min': panel.classList.toggle('min'); break;
      case 'down': S.power = Math.max(0.1, +(S.power - 0.1).toFixed(2)); saveSettings(); rumble(120, S.power); break;
      case 'up': S.power = Math.min(1, +(S.power + 0.1).toFixed(2)); saveSettings(); rumble(120, S.power); break;
      case 'early': { const m = src(); if (m === 'funscript') S.fOffset = Math.min(400, S.fOffset + 10); else if (m === 'visual') S.vOffset = Math.min(400, S.vOffset + 10); else S.offset = Math.min(200, S.offset + 10); saveSettings(); break; }
      case 'late': { const m = src(); if (m === 'funscript') S.fOffset = Math.max(-200, S.fOffset - 10); else if (m === 'visual') S.vOffset = Math.max(-100, S.vOffset - 10); else S.offset = Math.max(0, S.offset - 10); saveSettings(); break; }
      case 'loadfs': fsInput.click(); break;
      case 'tapcal': startTapCal(); break;
      case 'diag': diagnostic(); break;
      case 'diagclose': root.querySelector('.diagbox').classList.add('hidden'); break;
      case 'sndtest': send({ type: 'test-sounds' }); break;
      case 'play': { const v = mainVideo(); if (v) v.paused ? v.play().catch(() => {}) : v.pause(); break; }
      case 'immersive': toggleImmersive(); break;
      case 'track': S.track = !S.track; saveSettings(); break;
      case 'voice': S.voice = !S.voice; if (!S.voice) chrome.runtime.sendMessage({ type: 'gf-hush' }).catch(() => {}); saveSettings(); break;
      case 'gifs': S.gifs = !S.gifs; saveSettings(); if (S.gifs) showGif(); break;
      case 'calib': startCalib(); break;
      case 'source':
        { const order = ['auto', 'funscript', 'visual', 'audio'];
          S.source = order[(order.indexOf(S.source) + 1) % order.length];
          if (S.source === 'funscript' && !fsData) S.source = 'visual';
          saveSettings();
          message({ auto: 'Auto : funscript, sinon barre rythmo, sinon le son', funscript: 'Je suis le funscript 📜', visual: 'Je suis la barre rythmo 👁', audio: 'Je suis le son 🎵' }[S.source], 2200, { speak: false });
          if (S.source === 'visual' && !S.lane) startCalib(); }
        break;
      case 'edge':
        st.muteUntil = now + 15000; stopRumble(); clearTimeout(st.timer);
        clearPend();
        talk('edge', 4500, { small: 'Au bord ? On coupe tout 15 secondes… respire.' });
        setMood('pause');
        setTimeout(() => { if (alive) talk(Math.random() < 0.5 ? 'praise' : 'resume', 3000); }, 15000);
        break;
      case 'cum':
        talk('cum', 6000, { gif: true });
        showGif(3);
        rumble(4000, S.power, S.power);
        break;
      case 'stop': chrome.runtime.sendMessage({ type: 'gf-stop' }).catch(() => {}); remove(); break;
    }
    updatePanel(currentBpm(), performance.now() - st.last);
  });

  // ---------- Liaison avec le moteur (document offscreen) ----------
  let port = null, alive = true, retry = null;
  function send(m) { if (port) try { port.postMessage(m); } catch (e) {} }
  function connect() {
    if (!alive) return;
    try { port = chrome.runtime.connect({ name: 'goonfap' }); } catch (e) { remove(); return; } // extension rechargée
    port.onMessage.addListener(m => {
      switch (m.type) {
        case 'onset': onOnset(m.s, m.at); break;
        case 'vetas': onVEtas(m.etas); break;
        case 'snd-test': message(m.ok ? '🎧 Tu dois entendre un bruit de fap, puis un orgasme' : '🎧 Aucun son trouvé : dézippe ton pack dans extension/sons/ puis recharge l\'extension', 4000, { speak: false }); break;
        case 'vprof': vis.prof = m; drawPreview(); break;
        case 'vision': vis.ok = m.ok; break;
        case 'picked': onPicked(m.color); break;
        case 'level': level = m.level; break;
        case 'sounds': sounds = m.sounds; break;
        case 'hello':
          if (m.sounds) sounds = m.sounds;
          sendSettings(); laneSent = ''; updateLane();
          chrome.storage.local.get('soundIndex').then(r => { if (r.soundIndex) send({ type: 'sound-index', files: r.soundIndex }); });
          break;
      }
    });
    port.onDisconnect.addListener(() => { port = null; if (alive) retry = setTimeout(connect, 1000); });
    sendSettings();
  }
  function sendSettings() {
    send({ type: 'settings', settings: { sens: S.sens, band: S.band, minGap: S.minGap, clips: S.clips, moans: S.moans, cumSnd: S.cumSnd, clipVol: S.clipVol, beatSfx: S.beatSfx, beatVol: S.beatVol, beatKind: S.beatKind } });
  }
  function onSettings() {
    if (fsData) { const nb = fsPick(); if (nb !== fsData.beats) { fsData.beats = nb; fsReset(); } }
    sendSettings(); if (!S.tease) stopTease(); laneSent = ''; updateLane(); }

  chrome.runtime.onMessage.addListener(m => { if (m.type === 'gf-remove') remove(); });

  function remove() {
    if (!alive) return;
    alive = false;
    clearInterval(slow); clearInterval(fsLoop); fsReset(); clearTimeout(st.timer); clearTimeout(st.missTimer); clearTimeout(retry); stopTease(); stopRumble();
    clearPend();
    exitImmersive();
    document.removeEventListener('fullscreenchange', onFs);
    if (usePopover) try { host.hidePopover(); } catch (e) {}
    window.removeEventListener('keydown', onKey, true);
    if (port) try { port.disconnect(); } catch (e) {}
    host.remove();
    delete window.__goonfap;
  }

  window.__goonfap = { show() { raise(); } };
  connect();
  requestAnimationFrame(draw);
  setTimeout(() => {
    if (!alive) return;
    talk('start', 3500, { small: fsData ? 'Funscript trouvé : je suis chaque coup de la vidéo' : src() === 'visual' ? 'Lance la vidéo : je suis la barre rythmo' : 'Pas de funscript trouvé : 📂 pour en charger un, ou 🎯 pour caler sur une barre rythmo' });
  }, 300);
})();
