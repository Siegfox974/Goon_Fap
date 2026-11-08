/* Génération / analyse / sauvegarde des beatmaps.
 * Format : { version, name, duration, beats: [{t, s, d?}], phases: [{t, end?, kind, label, msg}] }
 *   t = temps en secondes, s = force 0..1, d = durée de vibration forcée (ms)
 *   kind = 'stroke' | 'pause' | 'finale' | 'end'
 */
'use strict';

const Beatmap = (() => {
  const LEAD_IN = 3; // secondes avant le premier beat

  // ---------- Messages coquins ----------
  const MSG = {
    warm: [
      'Doucement… prends ton temps 😏', 'Caresse lente. Profite de chaque vibration.',
      'Suis le rythme. Rien que le rythme.', 'Lentement… je veux que ça dure.',
      'Respire. Détends-toi. Laisse-toi aller.',
    ],
    medium: [
      'Un peu plus vite maintenant…', 'Bien. Garde ce rythme pour moi.',
      'Tu sens la pression monter ? 🔥', 'Ne lâche pas le tempo.', 'C\'est bon, hein ? Continue.',
    ],
    fast: [
      'Plus vite ! 💦', 'Ne t\'arrête surtout pas !', 'Plus fort, plus vite, maintenant !',
      'Tiens le rythme… si tu peux 😈', 'Accélère, je veux te voir transpirer.',
    ],
    tease: [
      'Petits coups… juste le bout.', 'Joue avec toi-même… sans te presser.',
      'Effleure à peine. Torture délicieuse.',
    ],
    pause: [
      'STOP ✋ Mains en l\'air.', 'Lâche tout. Interdiction de toucher.',
      'STOP. Mains sur les cuisses. Respire.', 'On ne touche plus… tu attends mon signal.',
      'Arrête. Regarde-toi trembler 😏',
    ],
    edge: [
      'Tu es au bord… ne craque pas.', 'Approche-toi du bord… mais pas plus loin.',
      'Tiens bon. Tu n\'as pas la permission.', 'Juste au bord… et tu tiens.',
    ],
    cum: ['Maintenant… JOUIS ! 💦', 'Vas-y, lâche tout ! 💦', 'Tu l\'as mérité. JOUIS ! 💦'],
    ruin: ['STOP ! Lâche tout ! Orgasme ruiné 😈', 'Mains en l\'air ! Laisse-le se gâcher 😈'],
    denial: ['Pas aujourd\'hui. Range-le 🔒', 'Fini. Tu ne jouis pas ce soir 🔒', 'Déni. Tu reviendras demain 😈'],
  };

  // Version explicite (choisie avec « Ton des messages : Explicite »)
  const HOT = {
    warm: [
      'Prends-toi en main… et caresse-toi lentement 😏', 'Doucement… sens chaque centimètre.',
      'Touche-toi comme si c\'était moi qui le faisais.', 'Lentement… je veux te voir savourer.',
      'Serre un peu plus… et descends tout doucement.', 'Laisse ton sexe gonfler sous tes doigts…',
    ],
    medium: [
      'Branle-toi au rythme, rien d\'autre 😈', 'C\'est bon de se toucher comme ça, hein ?',
      'Je veux t\'entendre gémir.', 'Ton sexe adore cette vibration… continue.',
      'T\'es tellement excité·e… ça se voit 🔥', 'Écarte bien les cuisses et suis le tempo.',
    ],
    fast: [
      'Plus vite ! Branle-toi plus fort ! 💦', 'Ne t\'arrête pas, petit·e cochon·ne 😈',
      'Défonce-toi au rythme, maintenant !', 'Plus fort ! Je veux te voir trembler !',
      'Tu mouilles, tu bandes… tu dégoulines. Encore !', 'Frotte la manette contre toi, fort ! 🎮💦',
    ],
    tease: [
      'Juste le bout… effleure à peine 😏', 'Fais glisser la manette sur toi… sans appuyer.',
      'Petits coups… je veux que tu supplies.',
    ],
    pause: [
      'STOP ✋ Lâche-toi. Tu ne te touches plus.', 'Mains en l\'air ! Regarde comme t\'es excité·e…',
      'Ne touche plus. Laisse ton sexe palpiter tout seul.', 'Stop. Tu sens comme ça pulse ? Attends mon ordre.',
      'Interdiction de te toucher. Respire… et souffre un peu 😈',
    ],
    edge: [
      'Tu vas jouir ? Interdit. Tiens bon 😈', 'Au bord… tu sens que ça monte ? Pas encore !',
      'Tu es tout près… retiens-toi pour moi.', 'Je te pousse jusqu\'au bord… et tu ne lâches rien.',
    ],
    cum: ['JOUIS ! Maintenant ! Lâche tout ! 💦', 'Vas-y, jouis pour moi ! 💦', 'Gicle, explose, tu l\'as mérité ! 💦'],
    ruin: ['Lâche-le ! Mains en l\'air ! Regarde-toi jouir pour rien 😈', 'STOP ! Orgasme ruiné. Quel dommage… 😈'],
    denial: ['Pas le droit de jouir. Range ça 🔒', 'Fini. Tu resteras frustré·e ce soir 🔒', 'Déni. Tu y penseras toute la nuit 😈'],
  };

  /** Tire un message au hasard. kind = warm|medium|fast|tease|pause|edge|cum|ruin|denial, level = soft|hot */
  function say(kind, level = 'soft', r = Math.random) {
    const pool = level === 'hot' ? HOT[kind] : MSG[kind];
    return pool && pool.length ? pick(r, pool) : '';
  }
  const kindForBpm = bpm => bpm < 90 ? 'warm' : bpm < 150 ? 'medium' : 'fast';

  // ---------- Presets ----------
  const PRESETS = {
    douceur:   { name: 'Douceur', icon: '🌸', desc: 'Lent et sensuel, quelques pauses.',
                 bpm: [50, 110], ramp: 0.7, seg: [25, 50], pause: 0.12, pauseLen: [6, 12],
                 patterns: ['steady', 'steady', 'accent4', 'tease'] },
    montee:    { name: 'Montée en pression', icon: '📈', desc: 'Ça commence doux et ça finit très fort.',
                 bpm: [60, 200], ramp: 1, seg: [20, 40], pause: 0.18, pauseLen: [5, 12],
                 patterns: ['steady', 'accent4', 'double', 'steady'] },
    edging:    { name: 'Edging', icon: '🔥', desc: 'Pousse jusqu\'au bord… et STOP. Encore et encore.',
                 bpm: [80, 210], ramp: 0.6, seg: [20, 40], pause: 0.6, pauseLen: [10, 25], edge: true,
                 patterns: ['steady', 'double', 'gallop', 'accent4'] },
    hardcore:  { name: 'Hardcore', icon: '💀', desc: 'Rapide, brutal, presque sans répit.',
                 bpm: [140, 260], ramp: 0.5, seg: [15, 30], pause: 0.08, pauseLen: [4, 8],
                 patterns: ['steady', 'double', 'gallop', 'burst'] },
    roulette:  { name: 'Roulette', icon: '🎲', desc: 'Totalement imprévisible.',
                 bpm: [50, 240], ramp: 0, seg: [8, 30], pause: 0.3, pauseLen: [4, 20], edge: true,
                 patterns: ['steady', 'double', 'gallop', 'accent4', 'tease', 'burst'] },
  };

  // ---------- Utilitaires ----------
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const lerp = (a, b, k) => a + (b - a) * k;
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const between = (r, [a, b]) => lerp(a, b, r());
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function msgFor(r, bpm) {
    if (bpm < 90) return pick(r, MSG.warm);
    if (bpm < 150) return pick(r, MSG.medium);
    return pick(r, MSG.fast);
  }

  /** Ajoute les beats d'un segment de caresse, avec rampe de BPM et motif rythmique. */
  function pushStroke(beats, t0, dur, bpm0, bpm1, pattern) {
    let local = 0, n = 0;
    while (local < dur) {
      const bpm = lerp(bpm0, bpm1, local / dur);
      const iv = 60 / bpm;
      const t = t0 + local;
      switch (pattern) {
        case 'accent4': beats.push({ t, s: n % 4 === 0 ? 1 : 0.6 }); break;
        case 'double':  beats.push({ t, s: 0.9 }); beats.push({ t: t + iv * 0.5, s: 0.6 }); break;
        case 'gallop':  beats.push({ t, s: 1 }); beats.push({ t: t + iv * 0.25, s: 0.55 }); beats.push({ t: t + iv * 0.5, s: 0.7 }); break;
        case 'tease':   beats.push({ t, s: 0.4 }); break;
        case 'burst':   if (n % 8 < 6) beats.push({ t, s: n % 8 === 0 ? 1 : 0.8 }); break;
        default:        beats.push({ t, s: 0.8 });
      }
      local += iv; n++;
    }
  }

  /**
   * Génère un programme complet.
   * @param {string} presetKey
   * @param {number} duration secondes totales
   * @param {string} finale 'cum' | 'ruin' | 'denial' | 'choice'
   */
  function generate(presetKey, duration, finale = 'cum', seed = Date.now()) {
    const P = PRESETS[presetKey] || PRESETS.montee;
    const r = rng(seed);
    if (finale === 'choice') finale = pick(r, ['cum', 'cum', 'ruin', 'denial']);
    const beats = [], phases = [];
    const finaleLen = clamp(duration * 0.08, 15, 40);
    const bodyEnd = duration - finaleLen;
    let t = LEAD_IN, lastWasPause = true;

    phases.push({ t: 0, kind: 'pause', label: 'Prépare-toi', msg: 'Prépare-toi… 😏', end: LEAD_IN, quiet: true });

    while (t < bodyEnd - 5) {
      const p = clamp(t / bodyEnd, 0, 1);
      // Pause ?
      if (!lastWasPause && r() < P.pause) {
        const len = Math.min(between(r, P.pauseLen), bodyEnd - t - 2);
        if (len > 2) {
          phases.push({ t, end: t + len, kind: 'pause', label: 'STOP', mk: 'pause', msg: pick(r, MSG.pause) });
          t += len; lastWasPause = true; continue;
        }
      }
      // Segment de caresse
      const base = lerp(P.bpm[0], P.bpm[1], P.ramp * p + (1 - P.ramp) * r());
      const jitter = (P.bpm[1] - P.bpm[0]) * 0.12;
      let bpm0 = clamp(base + (r() - 0.5) * jitter, P.bpm[0], P.bpm[1]);
      let bpm1 = clamp(bpm0 + (r() - 0.3) * jitter * 1.5, P.bpm[0], P.bpm[1]);
      const pattern = pick(r, P.patterns);
      const isEdge = P.edge && p > 0.15 && r() < 0.5;
      if (isEdge) { bpm0 = Math.max(bpm0, lerp(P.bpm[0], P.bpm[1], 0.6)); bpm1 = P.bpm[1]; }
      const len = Math.min(between(r, P.seg), bodyEnd - t);
      phases.push({ t, end: t + len, kind: 'stroke',
        label: isEdge ? 'Au bord…' : (pattern === 'tease' ? 'Taquinerie' : `${Math.round(bpm0)} BPM`),
        mk: isEdge ? 'edge' : (pattern === 'tease' ? 'tease' : kindForBpm(bpm0)),
        msg: isEdge ? pick(r, MSG.edge) : (pattern === 'tease' ? pick(r, MSG.tease) : msgFor(r, bpm0)) });
      pushStroke(beats, t, len, bpm0, bpm1, pattern === 'tease' ? 'tease' : pattern);
      t += len; lastWasPause = false;
      // Après un edge, pause obligatoire
      if (isEdge && t < bodyEnd - 8) {
        const pl = between(r, P.pauseLen);
        phases.push({ t, end: t + pl, kind: 'pause', label: 'STOP', mk: 'pause', msg: pick(r, MSG.pause) });
        t += pl; lastWasPause = true;
      }
    }

    // ---- Finale ----
    const fStart = Math.max(t, bodyEnd);
    const climaxLen = finaleLen * 0.75;
    phases.push({ t: fStart, end: fStart + climaxLen, kind: 'finale', label: 'FINALE', mk: 'fast', msg: 'La dernière ligne droite… 🔥' });
    pushStroke(beats, fStart, climaxLen, Math.max(140, P.bpm[1] * 0.8), Math.max(200, P.bpm[1] * 1.1), 'steady');
    const climax = fStart + climaxLen;
    if (finale === 'cum') {
      beats.push({ t: climax, s: 1, d: 2500 });
      phases.push({ t: climax, kind: 'end', label: '💦', mk: 'cum', msg: pick(r, MSG.cum) });
    } else if (finale === 'ruin') {
      phases.push({ t: climax, kind: 'end', label: 'Ruiné', mk: 'ruin', msg: pick(r, MSG.ruin) });
    } else {
      phases.push({ t: climax - 3, kind: 'end', label: 'Déni', mk: 'denial', msg: pick(r, MSG.denial) });
      // On coupe les derniers beats juste avant le climax
      for (let i = beats.length - 1; i >= 0 && beats[i].t > climax - 3; i--) beats.pop();
    }

    return finalize({
      name: `${P.name} — ${Math.round(duration / 60)} min`,
      duration: Math.max(climax + 6, duration), beats, phases,
    });
  }

  // ---------- Analyse audio ----------
  /**
   * Détecte les beats dans la bande son d'un fichier (vidéo/audio).
   * @param {File} file
   * @param {{sensitivity:number, band:'all'|'high'|'low', minGap:number}} o
   */
  async function analyze(file, o, onProgress = () => {}) {
    onProgress('Lecture du fichier…');
    const buf = await file.arrayBuffer();
    onProgress('Décodage de l\'audio… (peut prendre un moment)');
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    let audio;
    try { audio = await ctx.decodeAudioData(buf); }
    finally { ctx.close && ctx.close(); }

    onProgress('Recherche des beats…');
    await new Promise(r => setTimeout(r, 20));
    const sr = audio.sampleRate;
    const n = audio.length;
    const chans = [];
    for (let c = 0; c < audio.numberOfChannels; c++) chans.push(audio.getChannelData(c));

    // Filtre simple (passe-bas/passe-haut 1 pôle) + énergie par trame
    const hop = Math.round(sr * 0.01); // 10 ms
    const frames = Math.floor(n / hop);
    const energy = new Float32Array(frames);
    const kLow = 1 - Math.exp(-2 * Math.PI * 150 / sr);
    const kHigh = 1 - Math.exp(-2 * Math.PI * 2000 / sr);
    let lp = 0, lpH = 0;
    for (let f = 0; f < frames; f++) {
      let e = 0;
      for (let i = f * hop, end = i + hop; i < end; i++) {
        let x = 0;
        for (let c = 0; c < chans.length; c++) x += chans[c][i];
        x /= chans.length;
        let y = x;
        if (o.band === 'low') { lp += kLow * (x - lp); y = lp; }
        else if (o.band === 'high') { lpH += kHigh * (x - lpH); y = x - lpH; }
        e += y * y;
      }
      energy[f] = Math.sqrt(e / hop);
    }

    // Flux d'énergie (montées uniquement), en échelle log
    const flux = new Float32Array(frames);
    for (let f = 1; f < frames; f++) {
      const d = Math.log1p(energy[f] * 100) - Math.log1p(energy[f - 1] * 100);
      flux[f] = d > 0 ? d : 0;
    }

    // Seuil adaptatif : moyenne + k * écart-type sur une fenêtre glissante de ±1 s
    const W = 100;
    const minGapF = Math.max(1, Math.round(o.minGap / 10));
    const k = o.sensitivity;
    let sum = 0, sum2 = 0, count = 0;
    const add = v => { sum += v; sum2 += v * v; count++; };
    const rem = v => { sum -= v; sum2 -= v * v; count--; };
    for (let f = 0; f < Math.min(W, frames); f++) add(flux[f]);

    const beats = [];
    let last = -Infinity, maxFlux = 1e-9;
    for (let f = 0; f < frames; f++) {
      if (f + W < frames) add(flux[f + W]);
      if (f - W - 1 >= 0) rem(flux[f - W - 1]);
      const mean = sum / count;
      const sd = Math.sqrt(Math.max(0, sum2 / count - mean * mean));
      const thr = mean + k * sd + 0.02;
      const v = flux[f];
      if (v > thr && v >= flux[f - 1] && v >= (flux[f + 1] || 0) && f - last >= minGapF) {
        beats.push({ t: f * 0.01, s: v });
        last = f;
        if (v > maxFlux) maxFlux = v;
      }
    }
    // Normalise les forces dans [0.45, 1]
    beats.forEach(b => { b.s = 0.45 + 0.55 * Math.min(1, b.s / (maxFlux * 0.6)); });

    const duration = n / sr;
    return finalize({
      name: `Auto — ${file.name}`, duration, beats,
      phases: autoPhases(beats, duration),
    });
  }

  /** Repère les silences (pauses) dans une liste de beats et crée les phases correspondantes. */
  function autoPhases(beats, duration) {
    const phases = [];
    const r = rng(beats.length * 7919 + 1);
    if (!beats.length) return phases;
    if (beats[0].t > 2) phases.push({ t: 0, end: beats[0].t, kind: 'pause', label: 'Prépare-toi', msg: 'Prépare-toi… 😏' });
    let segStart = beats[0].t;
    for (let i = 1; i <= beats.length; i++) {
      const gap = i < beats.length ? beats[i].t - beats[i - 1].t : Infinity;
      if (gap > 3 || i === beats.length) {
        const segBeats = beats.filter(b => b.t >= segStart && b.t <= beats[i - 1].t);
        const span = beats[i - 1].t - segStart;
        const bpm = span > 0 ? (segBeats.length - 1) / span * 60 : 0;
        phases.push({ t: segStart, end: beats[i - 1].t, kind: 'stroke', label: bpm ? `~${Math.round(bpm)} BPM` : 'Rythme', mk: kindForBpm(bpm), msg: msgFor(r, bpm) });
        if (i < beats.length) {
          phases.push({ t: beats[i - 1].t + 0.5, end: beats[i].t, kind: 'pause', label: 'STOP', mk: 'pause', msg: pick(r, MSG.pause) });
          segStart = beats[i].t;
        }
      }
    }
    return phases;
  }

  function fromRecording(taps, duration, name) {
    const beats = taps.slice().sort((a, b) => a.t - b.t);
    return finalize({ name: `Perso — ${name || 'sans titre'}`, duration, beats, phases: autoPhases(beats, duration) });
  }

  function finalize(map) {
    map.version = 1;
    map.beats = (map.beats || [])
      .filter(b => isFinite(b.t) && b.t >= 0)
      .map(b => ({ t: +b.t.toFixed(3), s: +clamp(b.s ?? 0.8, 0, 1).toFixed(2), ...(b.d ? { d: b.d } : {}) }))
      .sort((a, b) => a.t - b.t);
    map.phases = (map.phases || []).sort((a, b) => a.t - b.t);
    if (!map.duration) map.duration = map.beats.length ? map.beats[map.beats.length - 1].t + 3 : 60;
    return map;
  }

  function parse(text) {
    const m = JSON.parse(text);
    if (!m || !Array.isArray(m.beats)) throw new Error('Fichier invalide : pas de liste "beats".');
    return finalize(m);
  }

  function download(map) {
    const blob = new Blob([JSON.stringify(map)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (map.name || 'beatmap').replace(/[^\w\-]+/g, '_') + '.goonfap.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- Stockage local (beatmap associé à une vidéo) ----------
  const keyFor = file => `goonfap:map:${file.name}:${file.size}`;
  function saveForFile(file, map) { try { localStorage.setItem(keyFor(file), JSON.stringify(map)); } catch (e) {} }
  function loadForFile(file) { try { const s = localStorage.getItem(keyFor(file)); return s ? parse(s) : null; } catch (e) { return null; } }

  return { PRESETS, MSG, HOT, say, kindForBpm, generate, analyze, fromRecording, parse, download, saveForFile, loadForFile, finalize };
})();
