/* Partagé entre popup, content script et offscreen : réglages par défaut + messages. */
/* eslint-disable no-var */
var GF = globalThis.GF || (globalThis.GF = (() => {
  const DEFAULTS = {
    power: 1,          // 100 % = le max de la manette
    pulse: 140,        // ms par vibration
    sens: 1.6,         // sensibilité de détection (plus petit = plus de beats)
    band: 'high',      // 'high' clics / 'all' / 'low' basses
    minGap: 160,       // ms mini entre deux beats
    predict: true,     // anticipation quand le tempo est stable
    offset: 30,        // ms d'avance des vibrations anticipées
    level: 'hot',      // 'soft' | 'hot'
    talk: 2,           // 0 aucun … 3 beaucoup
    tease: true,       // battements de cœur pendant les pauses
    nuance: false,     // force selon le volume du beat
    tempoBoost: false, // plus le tempo est rapide, plus c'est fort
    track: true,       // piste de beats visible
  };

  const SOFT = {
    warm: ['Doucement… prends ton temps 😏', 'Caresse lente. Profite de chaque vibration.', 'Suis le rythme. Rien que le rythme.',
      'Lentement… je veux que ça dure.', 'Respire. Détends-toi. Laisse-toi aller.'],
    medium: ['Un peu plus vite maintenant…', 'Bien. Garde ce rythme pour moi.', 'Tu sens la pression monter ? 🔥',
      'Ne lâche pas le tempo.', 'C\'est bon, hein ? Continue.'],
    fast: ['Plus vite ! 💦', 'Ne t\'arrête surtout pas !', 'Plus fort, plus vite, maintenant !',
      'Tiens le rythme… si tu peux 😈', 'Accélère, je veux te voir transpirer.'],
    tease: ['Petits coups… juste le bout.', 'Effleure à peine. Torture délicieuse.'],
    pause: ['STOP ✋ Mains en l\'air.', 'Lâche tout. Interdiction de toucher.', 'STOP. Mains sur les cuisses. Respire.',
      'On ne touche plus… tu attends mon signal.'],
    resume: ['On reprend… 😏', 'Allez, remets-toi au travail.', 'Tu m\'as manqué. Reprends.'],
    edge: ['Tu es au bord… ne craque pas.', 'Approche-toi du bord… mais pas plus loin.', 'Tiens bon. Tu n\'as pas la permission.'],
    cum: ['Maintenant… JOUIS ! 💦', 'Vas-y, lâche tout ! 💦'],
  };
  const HOT = {
    warm: ['Prends-toi en main… et caresse-toi lentement 😏', 'Doucement… sens chaque centimètre.',
      'Touche-toi comme si c\'était moi qui le faisais.', 'Lentement… je veux te voir savourer.',
      'Serre un peu plus… et descends tout doucement.', 'Laisse ton sexe gonfler sous tes doigts…',
      'Pose la manette contre toi… et laisse-la te faire du bien.'],
    medium: ['Branle-toi au rythme, rien d\'autre 😈', 'C\'est bon de se toucher comme ça, hein ?', 'Je veux t\'entendre gémir.',
      'Ton sexe adore cette vibration… continue.', 'T\'es tellement excité·e… ça se voit 🔥', 'Écarte bien les cuisses et suis le tempo.',
      'Regarde-les… et imagine que c\'est toi 🔥'],
    fast: ['Plus vite ! Branle-toi plus fort ! 💦', 'Ne t\'arrête pas, petit·e cochon·ne 😈', 'Défonce-toi au rythme, maintenant !',
      'Plus fort ! Je veux te voir trembler !', 'Tu mouilles, tu bandes… tu dégoulines. Encore !', 'Frotte la manette contre toi, fort ! 🎮💦'],
    tease: ['Juste le bout… effleure à peine 😏', 'Fais glisser la manette sur toi… sans appuyer.', 'Petits coups… je veux que tu supplies.'],
    pause: ['STOP ✋ Lâche-toi. Tu ne te touches plus.', 'Mains en l\'air ! Regarde comme t\'es excité·e…',
      'Ne touche plus. Laisse ton sexe palpiter tout seul.', 'Stop. Tu sens comme ça pulse ? Attends mon ordre.',
      'Interdiction de te toucher. Respire… et souffre un peu 😈'],
    resume: ['Reprends-toi en main… 😈', 'Allez, branle-toi, ça repart !', 'Tu as été sage. Tu peux te toucher à nouveau.'],
    edge: ['Tu vas jouir ? Interdit. Tiens bon 😈', 'Au bord… tu sens que ça monte ? Pas encore !',
      'Tu es tout près… retiens-toi pour moi.', 'Je te pousse jusqu\'au bord… et tu ne lâches rien.'],
    cum: ['JOUIS ! Maintenant ! Lâche tout ! 💦', 'Vas-y, jouis pour moi ! 💦', 'Gicle, explose, tu l\'as mérité ! 💦'],
  };

  function say(kind, level) {
    const pool = (level === 'hot' ? HOT : SOFT)[kind] || [];
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
  }
  const kindForBpm = bpm => (bpm < 90 ? 'warm' : bpm < 150 ? 'medium' : 'fast');

  return { DEFAULTS, SOFT, HOT, say, kindForBpm };
})());
