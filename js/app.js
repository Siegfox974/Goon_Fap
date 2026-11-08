/* Interface : porte 18+, configuration, lancement des séances. */
'use strict';

(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const state = {
    mode: 'program',
    preset: 'montee',
    videoFile: null,
    videoUrl: null,
    autoMap: null,      // résultat de l'analyse audio
    fileMap: null,      // beatmap chargé depuis un .json
    lastMap: null,      // beatmap de la dernière séance
    session: null,
  };

  // ---------- Écrans ----------
  function show(id) {
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    // Le fond (potentiellement explicite) n'apparaît jamais avant la confirmation de l'âge
    $('#bg-layer').classList.toggle('hidden', id === 'age-gate' || !bg.has);
  }

  // ---------- Paramètres persistants ----------
  const SETTINGS = ['power', 'pulse', 'mix', 'minutes', 'sens', 'gap', 'band', 'finale', 'phone-vibe', 'click-sound', 'bgop', 'level', 'talk'];
  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('goonfap:settings') || '{}'); } catch (e) {}
    SETTINGS.forEach(id => {
      const el = document.getElementById(id);
      if (!el || saved[id] === undefined) return;
      if (el.type === 'checkbox') el.checked = !!saved[id]; else el.value = saved[id];
    });
    if (saved.preset && Beatmap.PRESETS[saved.preset]) state.preset = saved.preset;
  }
  function saveSettings() {
    const o = { preset: state.preset };
    SETTINGS.forEach(id => { const el = document.getElementById(id); o[id] = el.type === 'checkbox' ? el.checked : el.value; });
    try { localStorage.setItem('goonfap:settings', JSON.stringify(o)); } catch (e) {}
  }
  function opts() {
    return {
      power: +$('#power').value,
      pulse: +$('#pulse').value,
      mix: +$('#mix').value,
      click: $('#click-sound').checked,
      level: $('#level').value,
      talk: +$('#talk').value,
    };
  }

  // Affichage des valeurs des sliders
  const fmt = {
    power: v => Math.round(v * 100) + '%', pulse: v => v + ' ms', mix: v => v < 0.35 ? 'grave' : v > 0.65 ? 'aigu' : 'équilibré',
    minutes: v => v + ' min', sens: v => (+v).toFixed(1), gap: v => v + ' ms', bgop: v => Math.round(v * 100) + '%',
  };
  Object.keys(fmt).forEach(id => {
    const el = document.getElementById(id), out = document.getElementById('o-' + id);
    const upd = () => { out.textContent = fmt[id](el.value); };
    el.addEventListener('input', upd);
    el.addEventListener('change', saveSettings);
    state['upd_' + id] = upd;
  });
  ['band', 'finale', 'phone-vibe', 'click-sound', 'level', 'talk'].forEach(id => document.getElementById(id).addEventListener('change', saveSettings));
  $('#phone-vibe').addEventListener('change', e => Pad.setPhoneFallback(e.target.checked));

  // ---------- Porte 18+ ----------
  $('#age-check').addEventListener('change', e => { $('#age-yes').disabled = !e.target.checked; });
  $('#age-yes').addEventListener('click', () => {
    try { localStorage.setItem('goonfap:adult', '1'); } catch (e) {}
    show('setup');
  });

  // ---------- Statut manette ----------
  Pad.onStatus((p, rumble) => {
    const box = $('#pad-status'), label = $('#pad-label');
    box.classList.remove('on', 'off', 'warn');
    if (!p) { box.classList.add('off'); label.textContent = 'Aucune manette — branche-la et appuie sur un bouton'; }
    else if (!rumble) { box.classList.add('warn'); label.textContent = `${shortName(p.id)} — vibration non supportée par ce navigateur (essaie Chrome/Edge)`; }
    else { box.classList.add('on'); label.textContent = `${shortName(p.id)} — prête à vibrer 💓`; }
  });
  function shortName(id) {
    if (/054c|sony|dualshock|wireless controller/i.test(id)) return 'DualShock 4';
    if (/dualsense|0ce6/i.test(id)) return 'DualSense';
    return id.replace(/\(.*?\)/g, '').trim().slice(0, 32) || 'Manette';
  }

  // ---------- Tests de vibration ----------
  $('#test-light').addEventListener('click', () => vibeTest([[0, 150, 0.25]]));
  $('#test-strong').addEventListener('click', () => vibeTest([[0, 400, 1]]));
  $('#test-tease').addEventListener('click', () => vibeTest([[0, 90, 0.5], [350, 90, 0.5], [700, 90, 0.7], [950, 90, 0.7], [1150, 90, 0.9], [1300, 600, 1]]));
  function vibeTest(seq) {
    const o = opts();
    seq.forEach(([at, d, s]) => setTimeout(() => {
      const m = s * o.power;
      const ok = Pad.rumble(d, m * Math.min(1, 2 * (1 - o.mix)), m * Math.min(1, 2 * o.mix));
      if (!ok && at === 0) toast('Pas de manette avec vibration détectée. Branche ta DualShock 4 et appuie sur un bouton.');
    }, at));
  }

  // ---------- Presets ----------
  const presetsBox = $('#presets');
  Object.entries(Beatmap.PRESETS).forEach(([key, p]) => {
    const b = document.createElement('button');
    b.className = 'preset'; b.dataset.key = key;
    b.innerHTML = `<b>${p.icon} ${p.name}</b><span>${p.desc}</span>`;
    b.addEventListener('click', () => { state.preset = key; refreshPresets(); saveSettings(); });
    presetsBox.appendChild(b);
  });
  function refreshPresets() { $$('.preset').forEach(b => b.classList.toggle('active', b.dataset.key === state.preset)); }

  // ---------- Onglets ----------
  $$('#mode-tabs .tab').forEach(tab => tab.addEventListener('click', () => {
    state.mode = tab.dataset.mode;
    $$('#mode-tabs .tab').forEach(t => t.classList.toggle('active', t === tab));
    $$('.tabpane').forEach(p => p.classList.toggle('active', p.dataset.pane === state.mode));
  }));

  // ---------- Vidéo ----------
  $('#video-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    setVideo(f);
  });
  $('#video-url-go').addEventListener('click', () => {
    const u = $('#video-url').value.trim();
    if (!/^https?:[/][/]/i.test(u)) { toast('Colle un lien qui commence par http(s)://'); return; }
    setVideo({ name: u, size: 0, url: u });
  });
  $('#clear-video').addEventListener('click', () => setVideo(null));
  // f = File local, ou { name, size: 0, url } pour un lien
  function setVideo(f) {
    if (state.videoUrl && state.videoUrl.startsWith('blob:')) URL.revokeObjectURL(state.videoUrl);
    state.videoFile = f; state.videoUrl = f ? (f.url || URL.createObjectURL(f)) : null;
    $('#video').removeAttribute('src');
    $('#video-url').value = f && f.url ? f.url : '';
    state.autoMap = null;
    $('#analyze-status').textContent = '';
    $('#video-name').textContent = f ? `🎬 ${f.name}` : 'Choisir une vidéo…';
    $('#clear-video').classList.toggle('hidden', !f);
    $('#video-file').value = '';
    const saved = f && Beatmap.loadForFile(f);
    const hint = $('#saved-map-hint');
    if (saved) {
      state.fileMap = saved;
      $('#map-name').textContent = `💾 ${saved.name} (${saved.beats.length} beats, sauvegardé pour cette vidéo)`;
      hint.textContent = 'Un beatmap enregistré pour cette vidéo a été retrouvé — il est sélectionné dans « Charger un beatmap ».';
      hint.classList.remove('hidden');
      $('[data-mode="file"]').click();
    } else hint.classList.add('hidden');
  }

  // ---------- Analyse auto ----------
  $('#analyze').addEventListener('click', () => runAnalysis().catch(() => {}));
  async function runAnalysis() {
    const st = $('#analyze-status');
    if (!state.videoFile) { st.textContent = 'Charge d\'abord une vidéo 😉'; throw new Error('no video'); }
    $('#analyze').disabled = true;
    try {
      let src = state.videoFile;
      if (src.url) {
        st.textContent = 'Téléchargement de la vidéo pour l\'analyser…';
        const res = await fetch(src.url).catch(() => { throw new Error('le site bloque le téléchargement — télécharge la vidéo et choisis le fichier'); });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        src = new File([await res.blob()], src.name);
      }
      state.autoMap = await Beatmap.analyze(src, {
        sensitivity: +$('#sens').value, band: $('#band').value, minGap: +$('#gap').value,
      }, msg => { st.textContent = msg; });
      const n = state.autoMap.beats.length;
      st.textContent = n
        ? `✅ ${n} beats détectés. Trop ou pas assez ? Ajuste la sensibilité et relance.`
        : '😕 Aucun beat détecté. Baisse la sensibilité ou change de fréquences.';
      if (!n) throw new Error('empty');
      return state.autoMap;
    } catch (e) {
      if (e.message !== 'empty') st.textContent = '❌ Impossible de décoder l\'audio de ce fichier (' + (e.message || e) + '). Essaie un .mp4 ou enregistre le rythme au doigt.';
      throw e;
    } finally {
      $('#analyze').disabled = false;
    }
  }
  ['sens', 'band', 'gap'].forEach(id => document.getElementById(id).addEventListener('change', () => { state.autoMap = null; }));

  // ---------- Fichier beatmap ----------
  $('#map-file').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      state.fileMap = Beatmap.parse(await f.text());
      $('#map-name').textContent = `📄 ${state.fileMap.name || f.name} (${state.fileMap.beats.length} beats)`;
    } catch (err) {
      state.fileMap = null;
      $('#map-name').textContent = '❌ ' + err.message;
    }
  });

  // ---------- Lancement ----------
  $('#start').addEventListener('click', () => start().catch(err => { if (err && err.message) toast(err.message); }));

  async function videoDuration() {
    const v = $('#video');
    if (!state.videoUrl) return 0;
    if (v.src !== state.videoUrl) v.src = state.videoUrl;
    if (isFinite(v.duration) && v.duration > 0) return v.duration;
    await new Promise((res, rej) => {
      v.addEventListener('loadedmetadata', res, { once: true });
      v.addEventListener('error', () => rej(new Error('Ce navigateur ne sait pas lire cette vidéo.')), { once: true });
    });
    return v.duration;
  }

  async function start() {
    saveSettings();
    const dur = await videoDuration();
    let map = null;
    const record = state.mode === 'record';

    if (state.mode === 'program') {
      const seconds = dur || (+$('#minutes').value * 60);
      map = Beatmap.generate(state.preset, seconds, $('#finale').value);
    } else if (state.mode === 'auto') {
      if (!state.videoFile) throw new Error('La détection auto a besoin d\'une vidéo.');
      map = state.autoMap || await runAnalysis();
    } else if (state.mode === 'file') {
      if (!state.fileMap) throw new Error('Choisis d\'abord un fichier beatmap.');
      map = state.fileMap;
    } else if (record) {
      if (!state.videoFile) throw new Error('Pour enregistrer le rythme, charge une vidéo.');
      map = { beats: [], phases: [], duration: dur };
    }

    state.lastMap = record ? null : map;
    launch(map, record);
  }

  function launch(map, record) {
    const video = state.videoUrl ? $('#video') : null;
    $('#game').classList.toggle('novideo', !video);
    $('#pause-overlay').classList.add('hidden');
    $('#hud-phase').textContent = record ? '⏺ Enregistrement' : '';
    $('#hud-power').textContent = '100%';
    $('#rec-zone').classList.toggle('hidden', !record);
    $('#game-controls .edge').classList.toggle('hidden', record);
    show('game');
    wake();

    const s = new Session(map, { ...opts(), record }, video, {
      onMessage: message,
      onPhase: label => { if (!record) $('#hud-phase').textContent = label; },
      onHud: h => { $('#hud-bpm').textContent = h.bpm; $('#hud-time').textContent = h.time; },
      onPower: m => { $('#hud-power').textContent = Math.round(m * 100) + '%'; },
      onEnd: (stats, taps) => onEnd(stats, taps, record),
    });
    state.session = s;
    if (record) message('Tape le rythme !<small>Espace / clic gauche = normal · B / clic droit = fort · Échap pour terminer</small>', 4000);
    s.start();
    // Plein écran (si autorisé)
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function onEnd(stats, taps, record) {
    state.session = null;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (record) {
      const dur = $('#video').duration || 0;
      state.lastMap = Beatmap.fromRecording(taps || [], dur, state.videoFile && state.videoFile.name);
      if (state.videoFile && state.lastMap.beats.length) {
        Beatmap.saveForFile(state.videoFile, state.lastMap);
        state.fileMap = state.lastMap;
        $('#map-name').textContent = `💾 ${state.lastMap.name} (${state.lastMap.beats.length} beats)`;
      }
      $('#end-title').textContent = 'Rythme enregistré ⏺';
      $('#end-msg').textContent = state.lastMap.beats.length
        ? 'Ton beatmap est sauvegardé pour cette vidéo. Clique sur « Rejouer » pour le tester avec les vibrations.'
        : 'Aucun beat enregistré…';
    } else {
      $('#end-title').textContent = stats.finished || 'Séance interrompue 😮‍💨';
      $('#end-msg').textContent = stats.finished ? pickEnd(stats) : 'Trop chaud ? Reviens quand tu veux… 😏';
    }
    $('#end-stats').innerHTML = [
      ['Durée', fmtTime(stats.elapsed)],
      [record ? 'Taps' : 'Vibrations', stats.beats],
      ...(record ? [] : [['BPM max', stats.maxBpm || '—'], ['Fois « au bord »', stats.edges]]),
    ].map(([k, v]) => `<li>${k} : <b>${v}</b></li>`).join('');
    $('#export').disabled = !(state.lastMap && state.lastMap.beats.length);
    show('end');
  }

  function pickEnd(stats) {
    if (stats.edges >= 3) return `${stats.edges} fois au bord… quelle endurance 😈`;
    if (stats.maxBpm > 200) return 'Tu as tenu des tempos de malade 🔥';
    return 'Bien joué. Reviens quand tu veux… 😏';
  }

  $('#again').addEventListener('click', () => {
    if (state.lastMap && state.lastMap.beats.length) launch(state.lastMap, false);
    else start().catch(err => toast(err.message));
  });
  $('#export').addEventListener('click', () => state.lastMap && Beatmap.download(state.lastMap));
  $('#back').addEventListener('click', () => show('setup'));
  $('#resume').addEventListener('click', () => togglePause(false));
  $('#quit').addEventListener('click', quit);

  function togglePause(v) {
    const s = state.session;
    if (!s) return;
    const want = v === undefined ? !s.paused : v;
    s.setPaused(want);
    $('#pause-overlay').classList.toggle('hidden', !want);
  }
  function quit() { if (state.session) state.session.finish(); }

  // ---------- Messages ----------
  let msgTimer = null;
  function message(html, ms = 3000) {
    const el = $('#message');
    el.innerHTML = html;
    el.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  function toast(text) {
    const st = $('#analyze-status');
    alert(text);
    if (st) st.textContent = text;
  }

  // ---------- Entrées ----------
  // La manette sert uniquement de vibro : ses boutons ne déclenchent rien
  // (on la frotte contre soi, les appuis seraient accidentels).

  // ---------- Boutons à l'écran ----------
  $$('#game-controls .gc').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const s = state.session;
    if (!s) return;
    switch (btn.dataset.act) {
      case 'pause': togglePause(); break;
      case 'quit': quit(); break;
      case 'up': s.adjust(+0.1); break;
      case 'down': s.adjust(-0.1); break;
      case 'edge': s.edge(); break;
      case 'track': s.showHighway = !s.showHighway; break;
    }
  }));
  const rec = $('#rec-zone');
  rec.addEventListener('mousedown', e => { e.preventDefault(); if (state.session) state.session.tap(e.button === 2 ? 1 : 0.75); });
  rec.addEventListener('touchstart', e => { e.preventDefault(); if (state.session) state.session.tap(0.75); }, { passive: false });
  rec.addEventListener('contextmenu', e => e.preventDefault());

  // Masque boutons et curseur quand la souris ne bouge plus
  let idleTimer = null;
  function wake() {
    $('#game').classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (state.session && !state.session.paused) $('#game').classList.add('idle'); }, 2500);
  }
  ['mousemove', 'touchstart', 'keydown'].forEach(ev => document.addEventListener(ev, wake, { passive: true }));

  document.addEventListener('keydown', e => {
    const s = state.session;
    if (!s) return;
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); s.opts.record ? s.tap(0.75) : togglePause(); }
    else if (k === 'escape') quit();
    else if (k === 'p') togglePause();
    else if (s.opts.record && k === 'b') s.tap(1);
    else if (!s.opts.record && k === 'e') s.edge();
    else if (k === 'h') s.showHighway = !s.showHighway;
    else if (k === 'arrowup' || k === '+') s.adjust(+0.1);
    else if (k === 'arrowdown' || k === '-') s.adjust(-0.1);
  });

  // ---------- Boucle principale ----------
  function loop() {
    Pad.poll();
    if (state.session) state.session.update();
    requestAnimationFrame(loop);
  }

  // ---------- Fond personnalisé (GIF / image / vidéo) ----------
  // Fichier stocké dans IndexedDB (trop gros pour localStorage), lien stocké dans localStorage.
  const bg = { has: false, objUrl: null };
  const isVidUrl = u => /[.](mp4|webm)([?#]|$)/i.test(u);
  const idb = () => new Promise((res, rej) => {
    const r = indexedDB.open('goonfap', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  async function idbSet(key, val) {
    const db = await idb();
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      if (val === null) tx.objectStore('kv').delete(key); else tx.objectStore('kv').put(val, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  async function idbGet(key) {
    const db = await idb();
    return new Promise((res, rej) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  function applyBg(src, isVideo, name) {
    const img = $('#bg-img'), vid = $('#bg-vid');
    if (bg.objUrl && bg.objUrl !== src) { URL.revokeObjectURL(bg.objUrl); bg.objUrl = null; }
    img.removeAttribute('src'); vid.removeAttribute('src');
    bg.has = !!src;
    if (src) {
      if (isVideo) { vid.src = src; vid.play().catch(() => {}); } else img.src = src;
      if (src.startsWith('blob:')) bg.objUrl = src;
    }
    $('#bg-name').textContent = src ? `🔥 ${name}` : 'Choisir un GIF de fond…';
    $('#bg-clear').classList.toggle('hidden', !src);
    const active = $$('.screen').find(s => s.classList.contains('active'));
    $('#bg-layer').classList.toggle('hidden', !bg.has || (active && active.id === 'age-gate'));
  }
  $('#bg-file').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    applyBg(URL.createObjectURL(f), f.type.startsWith('video/'), f.name);
    e.target.value = '';
    try { localStorage.setItem('goonfap:bgurl', ''); await idbSet('bg', f); } catch (err) {}
  });
  $('#bg-url-go').addEventListener('click', async () => {
    const u = $('#bg-url').value.trim();
    if (!/^https?:[/][/]/i.test(u)) { toast('Colle un lien qui commence par http(s)://'); return; }
    applyBg(u, isVidUrl(u), u.split('/').pop().slice(0, 40));
    try { localStorage.setItem('goonfap:bgurl', u); await idbSet('bg', null); } catch (err) {}
  });
  $('#bg-clear').addEventListener('click', async () => {
    applyBg(null);
    $('#bg-url').value = '';
    try { localStorage.setItem('goonfap:bgurl', ''); await idbSet('bg', null); } catch (err) {}
  });
  $('#bgop').addEventListener('input', e => document.documentElement.style.setProperty('--bgop', e.target.value));
  async function restoreBg() {
    document.documentElement.style.setProperty('--bgop', $('#bgop').value);
    try {
      const u = localStorage.getItem('goonfap:bgurl');
      if (u) { $('#bg-url').value = u; applyBg(u, isVidUrl(u), u.split('/').pop().slice(0, 40)); return; }
      const f = await idbGet('bg');
      if (f) applyBg(URL.createObjectURL(f), (f.type || '').startsWith('video/'), f.name || 'fond');
    } catch (err) {}
  }

  // ---------- Init ----------
  loadSettings();
  Object.keys(fmt).forEach(id => state['upd_' + id]());
  Pad.setPhoneFallback($('#phone-vibe').checked);
  refreshPresets();
  let adult = false;
  try { adult = localStorage.getItem('goonfap:adult') === '1'; } catch (e) {}
  show(adult ? 'setup' : 'age-gate');
  restoreBg();
  requestAnimationFrame(loop);
})();
