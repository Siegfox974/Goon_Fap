/* Overlay GoonFap injecté sur le site : reçoit les beats, fait vibrer la manette en rythme,
 * affiche la piste, les messages et les boutons par-dessus la vidéo. */
(() => {
  'use strict';
  if (window.__goonfap) { window.__goonfap.show(); return; }

  // ---------- Réglages ----------
  let S = Object.assign({}, GF.DEFAULTS);
  chrome.storage.local.get('settings').then(r => { S = Object.assign({}, GF.DEFAULTS, r.settings || {}); onSettings(); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.settings) { S = Object.assign({}, GF.DEFAULTS, ch.settings.newValue || {}); onSettings(); }
  });
  const saveSettings = () => chrome.storage.local.set({ settings: S });

  // ---------- Manette ----------
  function pad() {
    try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).find(Boolean) || null; }
    catch (e) { return null; }
  }
  function rumble(ms, strong, weak = strong) {
    const p = pad();
    strong = Math.max(0, Math.min(1, strong)); weak = Math.max(0, Math.min(1, weak));
    if (p && p.vibrationActuator && p.vibrationActuator.playEffect) {
      p.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: Math.round(ms), strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
      return true;
    }
    if (p && p.hapticActuators && p.hapticActuators[0]) { try { p.hapticActuators[0].pulse(Math.max(strong, weak), ms); return true; } catch (e) {} }
    return false;
  }
  function stopRumble() {
    const p = pad();
    if (p && p.vibrationActuator) (p.vibrationActuator.reset ? p.vibrationActuator.reset() : p.vibrationActuator.playEffect('dual-rumble', { duration: 10, strongMagnitude: 0, weakMagnitude: 0 })).catch(() => {});
  }

  // ---------- Overlay (Shadow DOM, isolé du CSS du site) ----------
  const host = document.createElement('div');
  host.id = 'goonfap-host';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .vignette { position: fixed; inset: 0; pointer-events: none; opacity: 0;
    box-shadow: inset 0 0 120px 30px rgba(255,61,154,.85), inset 0 0 260px 60px rgba(155,92,255,.35); }
  .msg { position: fixed; left: 50%; top: 38%; transform: translate(-50%,-50%) scale(.96); width: min(92vw, 1000px);
    text-align: center; color: #fff; font-weight: 900; font-size: clamp(26px, 4.6vw, 60px); line-height: 1.15;
    text-shadow: 0 0 22px #ff3d9a, 0 0 6px #ff3d9a, 0 3px 8px #000; opacity: 0; transition: opacity .35s, transform .35s; pointer-events: none; }
  .msg.show { opacity: 1; transform: translate(-50%,-50%) scale(1); }
  .msg small { display: block; font-size: .42em; font-weight: 600; margin-top: 10px; }
  canvas { position: fixed; left: 0; right: 0; bottom: 0; width: 100%; height: 96px; pointer-events: none; }
  .panel { position: fixed; top: 14px; right: 14px; pointer-events: auto; color: #f6e9f2; width: 300px;
    background: rgba(26,8,30,.86); border: 1px solid rgba(255,92,170,.4); border-radius: 16px; padding: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,.5); backdrop-filter: blur(6px); font-size: 13px; transition: opacity .4s; }
  .panel.dim { opacity: .18; } .panel.dim:hover { opacity: 1; }
  .head { display: flex; align-items: center; gap: 8px; }
  .logo { font-weight: 900; font-size: 18px; } .logo b { color: #ff3d9a; text-shadow: 0 0 10px #ff3d9a; }
  .heart { font-size: 20px; transition: transform .08s; display: inline-block; }
  .bpm { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 700; color: #ff86c2; }
  .line { margin: 6px 0; color: #cfb3c6; font-size: 12px; }
  .meter { height: 6px; background: rgba(255,255,255,.1); border-radius: 3px; overflow: hidden; margin: 6px 0; }
  .meter i { display: block; height: 100%; width: 0; background: linear-gradient(90deg,#9b5cff,#ff3d9a); transition: width .08s; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  button { background: rgba(255,255,255,.08); color: #f6e9f2; border: 1px solid rgba(255,92,170,.35); border-radius: 999px;
    padding: 6px 10px; font-size: 13px; cursor: pointer; }
  button:hover { background: rgba(255,61,154,.3); }
  button.hot { background: linear-gradient(135deg,#ff3d9a,#9b5cff); border: none; font-weight: 700; }
  .pw { min-width: 46px; text-align: center; font-weight: 700; color: #ff86c2; align-self: center; }
  .mini { display: none; }
  .panel.min .full { display: none; } .panel.min { width: auto; } .panel.min .mini { display: inline; }
</style>
<div class="vignette"></div>
<div class="msg"></div>
<canvas></canvas>
<div class="panel">
  <div class="head">
    <span class="heart">💗</span><span class="logo">Goon<b>Fap</b></span>
    <span class="bpm">— BPM</span>
    <button data-a="min" title="Réduire">▁</button>
  </div>
  <div class="full">
    <div class="line pad">🎮 …</div>
    <div class="line sync">En attente du rythme… lance la vidéo ▶</div>
    <div class="meter"><i></i></div>
    <div class="row">
      <button data-a="down" title="Moins fort">−</button><span class="pw">100%</span><button data-a="up" title="Plus fort">+</button>
      <button data-a="play" title="Lecture / pause de la vidéo">⏯</button>
      <button data-a="immersive" title="Plein écran avec les messages">⛶</button>
      <button data-a="track" title="Afficher / masquer la piste">👁</button>
    </div>
    <div class="row">
      <button data-a="edge" class="hot">🥵 Au bord !</button>
      <button data-a="cum" class="hot">💦 Je jouis</button>
      <button data-a="stop" title="Arrêter GoonFap">✕</button>
    </div>
  </div>
</div>`;
  const $ = s => root.querySelector(s);
  const panel = $('.panel'), msgEl = $('.msg'), vignette = $('.vignette'), canvas = $('canvas'), cx = canvas.getContext('2d');
  (document.fullscreenElement && document.fullscreenElement.tagName !== 'VIDEO' ? document.fullscreenElement : document.documentElement).appendChild(host);

  // ---------- Messages ----------
  let msgTimer = null;
  function message(html, ms = 3200) {
    if (!html) return;
    msgEl.innerHTML = html;
    msgEl.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => msgEl.classList.remove('show'), ms);
  }

  // ---------- Synchronisation au rythme ----------
  const st = {
    last: 0, lastAudio: 0, iv: [], locked: false, period: 0, timer: null, missTimer: null, predAt: 0, lastS: 0.8,
    hits: [], onsets: 0, inPause: false, muteUntil: 0, fastSince: 0, nextTalk: 0, teaseTimer: null, flash: 0,
  };
  const median = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };

  function currentBpm() {
    if (st.locked) return 60000 / st.period;
    if (st.iv.length >= 2) return 60000 / median(st.iv);
    return 0;
  }

  function vibrate(s, now) {
    if (now < st.muteUntil) return;
    const bpm = currentBpm();
    let mag = S.power * (S.nuance ? s : 1);
    if (S.tempoBoost && bpm) mag *= 0.55 + 0.45 * Math.min(1, Math.max(0, (bpm - 60) / 140));
    const gap = st.locked ? st.period : (st.iv.length ? median(st.iv) : 1000);
    const ms = Math.max(40, Math.min(S.pulse, gap * 0.7));
    rumble(ms, mag, mag);
    st.flash = 1;
    st.hits.push(now);
  }

  // at = horloge audio (s) : intervalles précis, sans la gigue de la transmission
  function onOnset(s, at) {
    const now = performance.now();
    const audioMs = at != null ? at * 1000 : now;
    st.lastS = s;
    const tol = Math.max(70, st.period * 0.22);
    const covered = st.predAt && Math.abs(now - st.predAt) < tol;
    clearTimeout(st.timer); clearTimeout(st.missTimer);
    if (!covered) vibrate(s, now);
    st.predAt = 0;

    const d = audioMs - st.lastAudio;
    if (st.last && d < 2000) { st.iv.push(d); if (st.iv.length > 8) st.iv.shift(); } else st.iv = [];
    st.last = now; st.lastAudio = audioMs;
    st.onsets++;

    // Tempo stable sur les 4 derniers intervalles ? → on anticipe les beats suivants
    if (st.iv.length >= 4) {
      const last4 = st.iv.slice(-4), m = median(last4);
      st.locked = last4.every(x => Math.abs(x - m) < m * 0.1);
      if (st.locked) st.period = m;
    } else st.locked = false;
    if (S.predict && st.locked) schedule(now);

    if (st.inPause) {
      st.inPause = false;
      stopTease();
      if (S.talk > 0) message(GF.say('resume', S.level), 2500);
      st.nextTalk = now + 4000;
    }
  }

  function schedule(now) {
    const wait = Math.max(0, st.period - S.offset);
    st.timer = setTimeout(() => {
      const t = performance.now();
      vibrate(st.lastS, t);
      st.predAt = now + st.period;          // moment où le "vrai" beat devrait arriver
      // Si le beat attendu n'arrive pas : le rythme s'est arrêté, on cesse d'anticiper.
      st.missTimer = setTimeout(() => { st.locked = false; st.iv = []; st.predAt = 0; }, Math.max(70, st.period * 0.22) + S.offset);
    }, wait);
  }

  // Battement de cœur pendant les pauses
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

  // Boucle "lente" : pauses, messages réguliers, état de la manette
  const slow = setInterval(() => {
    const now = performance.now();
    const silent = now - st.last;
    if (!st.inPause && st.onsets >= 4 && silent > 2500) {
      st.inPause = true; st.locked = false; st.iv = [];
      message(GF.say('pause', S.level), 3500);
      startTease();
      st.nextTalk = now + 9000;
    }
    const bpm = currentBpm();
    if (bpm >= 150) { if (!st.fastSince) st.fastSince = now; } else st.fastSince = 0;

    if (S.talk > 0 && now >= st.nextTalk && now >= st.muteUntil) {
      let kind = null;
      if (st.inPause) kind = 'pause';
      else if (silent < 2500 && bpm) kind = st.fastSince && now - st.fastSince > 25000 && Math.random() < 0.5 ? 'edge' : GF.kindForBpm(bpm);
      if (kind) message(GF.say(kind, S.level));
      st.nextTalk = now + ([0, 22, 12, 6][S.talk] || 12) * 1000 * (0.7 + Math.random() * 0.6);
    }
    updatePanel(bpm, silent);
  }, 200);

  // ---------- Panneau ----------
  let level = 0;
  function updatePanel(bpm, silent) {
    $('.bpm').textContent = bpm && silent < 2500 ? `${Math.round(bpm)} BPM` : '— BPM';
    const p = pad();
    const canVibe = p && (p.vibrationActuator || (p.hapticActuators && p.hapticActuators[0]));
    $('.pad').textContent = !p ? '🎮 Appuie sur un bouton de la manette pour la connecter'
      : canVibe ? '🎮 Manette prête — vibrations à fond 💓' : '🎮 Manette sans vibration dans ce navigateur (utilise Chrome)';
    let sync;
    if (performance.now() < st.muteUntil) sync = '✋ Pause « au bord »… on reprend bientôt';
    else if (st.inPause) sync = '✋ Pause dans la vidéo' + (S.tease ? ' — battements de cœur 💓' : '');
    else if (!st.onsets || silent > 2500) sync = 'En attente du rythme… lance la vidéo ▶';
    else sync = st.locked ? '🔒 Calé sur le tempo (vibrations anticipées)' : '〰 Suit chaque beat du son';
    $('.sync').textContent = sync;
    $('.pw').textContent = Math.round(S.power * 100) + '%';
    $('.meter i').style.width = Math.min(100, level * 40) + '%';
  }

  // ---------- Piste ----------
  function draw() {
    if (!alive) return;
    requestAnimationFrame(draw);
    const now = performance.now();
    st.flash *= 0.86;
    vignette.style.opacity = (st.flash * 0.9).toFixed(3);
    $('.heart').style.transform = `scale(${1 + st.flash * 0.5})`;
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, w, h);
    if (!S.track) return;
    const look = 2200, tx = Math.max(60, w * 0.15), pps = (w - tx) / look, cy = h * 0.55;
    const g = cx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.4, 'rgba(25,0,25,.55)'); g.addColorStop(1, 'rgba(0,0,0,.75)');
    cx.fillStyle = g; cx.fillRect(0, 0, w, h);
    cx.strokeStyle = 'rgba(255,61,154,.35)'; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(0, cy); cx.lineTo(w, cy); cx.stroke();
    // cible
    cx.beginPath(); cx.arc(tx, cy, 22 + st.flash * 10, 0, Math.PI * 2);
    cx.strokeStyle = `rgba(255,134,194,${0.6 + st.flash * 0.4})`; cx.lineWidth = 3; cx.stroke();
    if (st.flash > 0.05) { cx.fillStyle = `rgba(255,61,154,${st.flash * 0.6})`; cx.fill(); }
    // beats passés (glissent vers la gauche)
    st.hits = st.hits.filter(t => now - t < 1500);
    for (const t of st.hits) heart(tx - (now - t) * pps, cy, 16, `rgba(255,134,194,${1 - (now - t) / 1500})`);
    // beats à venir (seulement quand le tempo est calé)
    if (st.locked && !st.inPause) {
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

  // ---------- Vidéo / plein écran ----------
  function mainVideo() {
    const vids = Array.from(document.querySelectorAll('video'));
    let best = null, area = 0;
    for (const v of vids) {
      const r = v.getBoundingClientRect(), a = r.width * r.height;
      if (a > area || (a === area && !v.paused)) { best = v; area = a; }
    }
    return best;
  }
  let immersiveVid = null;
  function toggleImmersive() {
    if (immersiveVid) { exitImmersive(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); return; }
    const v = mainVideo();
    if (!v) { message('Aucune vidéo trouvée sur cette page 🤔', 2500); return; }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    immersiveVid = v;
    v.classList.add('gf-immersive-video');
    document.documentElement.requestFullscreen().catch(() => {});
    panel.classList.add('dim');
  }
  function exitImmersive() {
    if (immersiveVid) immersiveVid.classList.remove('gf-immersive-video');
    immersiveVid = null;
    panel.classList.remove('dim');
  }
  // Quand le site passe en plein écran, on se glisse dans son conteneur pour rester visible
  const onFs = () => {
    const fe = document.fullscreenElement;
    if (!fe && immersiveVid) exitImmersive();
    const target = fe && fe.tagName !== 'VIDEO' ? fe : document.documentElement;
    if (host.parentNode !== target) target.appendChild(host);
    if (fe && fe.tagName === 'VIDEO') message('Utilise le bouton ⛶ de GoonFap pour garder les messages en plein écran 😉', 4000);
    panel.classList.toggle('dim', !!fe);
  };
  document.addEventListener('fullscreenchange', onFs);

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
      case 'play': { const v = mainVideo(); if (v) v.paused ? v.play().catch(() => {}) : v.pause(); break; }
      case 'immersive': toggleImmersive(); break;
      case 'track': S.track = !S.track; saveSettings(); break;
      case 'edge':
        st.muteUntil = now + 15000; stopRumble(); clearTimeout(st.timer);
        message(`${GF.say('pause', S.level)}<small>Au bord ? On coupe tout 15 secondes… respire.</small>`, 4500);
        setTimeout(() => { if (alive) message(GF.say('resume', S.level), 2500); }, 15000);
        break;
      case 'cum':
        message(GF.say('cum', S.level), 6000);
        rumble(4000, S.power, S.power);
        break;
      case 'stop': chrome.runtime.sendMessage({ type: 'gf-stop' }).catch(() => {}); remove(); break;
    }
    updatePanel(currentBpm(), performance.now() - st.last);
  });

  // ---------- Liaison avec le moteur audio (document offscreen) ----------
  let port = null, alive = true, retry = null;
  function connect() {
    if (!alive) return;
    try { port = chrome.runtime.connect({ name: 'goonfap' }); } catch (e) { remove(); return; } // extension rechargée
    port.onMessage.addListener(m => {
      if (m.type === 'onset') onOnset(m.s, m.at);
      else if (m.type === 'level') level = m.level;
      else if (m.type === 'hello') sendSettings();
    });
    port.onDisconnect.addListener(() => { port = null; if (alive) retry = setTimeout(connect, 1000); });
    sendSettings();
  }
  function sendSettings() {
    if (port) try { port.postMessage({ type: 'settings', settings: { sens: S.sens, band: S.band, minGap: S.minGap } }); } catch (e) {}
  }
  function onSettings() { sendSettings(); if (!S.tease) stopTease(); }

  chrome.runtime.onMessage.addListener(m => { if (m.type === 'gf-remove') remove(); });

  function remove() {
    if (!alive) return;
    alive = false;
    clearInterval(slow); clearTimeout(st.timer); clearTimeout(st.missTimer); clearTimeout(retry); stopTease(); stopRumble();
    exitImmersive();
    document.removeEventListener('fullscreenchange', onFs);
    if (port) try { port.disconnect(); } catch (e) {}
    host.remove();
    delete window.__goonfap;
  }

  window.__goonfap = {
    show() { if (!host.isConnected) document.documentElement.appendChild(host); },
    _state: st, // pour le débogage
  };
  connect();
  requestAnimationFrame(draw);
  message('GoonFap est prêt 😈<small>Lance la vidéo : la manette va vibrer sur chaque beat</small>', 3500);
})();
