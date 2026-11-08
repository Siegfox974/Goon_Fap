/* Partagé entre popup, content script, offscreen et service worker : réglages par défaut + messages. */
/* eslint-disable no-var */
var GF = globalThis.GF || (globalThis.GF = (() => {
  const DEFAULTS = {
    power: 1,          // 100 % = le max de la manette
    pulse: 140,        // ms par vibration
    source: 'audio',   // 'visual' = suit la barre rythmo à l'image, 'audio' = suit le son
    lane: null,        // calibration de la barre rythmo
    vOffset: 70,       // ms d'avance des vibrations en mode barre rythmo
    vTol: 90,          // tolérance de couleur des repères
    sens: 1.6,         // sensibilité de détection audio (plus petit = plus de beats)
    band: 'high',      // 'high' clics / 'all' / 'low' basses
    minGap: 160,       // ms mini entre deux beats
    predict: true,     // anticipation quand le tempo est stable (audio)
    offset: 30,        // ms d'avance des vibrations anticipées (audio)
    level: 'hard',     // 'soft' | 'hot' | 'hard'
    anatomy: 'cock',   // 'cock' | 'pussy' | 'any'
    talk: 2,           // 0 aucun … 3 beaucoup
    voice: true,       // lire les messages à voix haute
    voiceName: '',     // '' = meilleure voix française trouvée
    voiceRate: 0.95,
    voicePitch: 1.1,
    clips: true,       // jouer les sons du dossier sons/ quand il y en a
    moans: true,       // ambiance : gémissements en continu selon le tempo
    clipVol: 0.9,
    beatSfx: false,    // un bruitage (dossier sons/beat) sur chaque beat
    beatVol: 0.7,
    gifs: true,        // afficher les GIF du dossier gifs/
    gifEvery: 15,      // secondes entre deux GIF
    gifDur: 6,         // durée d'affichage d'un GIF
    gifSize: 0.38,     // taille (fraction de la hauteur d'écran)
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
    start: ['Prêt·e ? On commence… 😏'],
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
    start: ['Prends-toi en main… on commence 😈'],
  };

  // Niveau « Salope » : elle te parle, crûment. Listes par anatomie + listes communes.
  const HARD = {
    any: {
      warm: ['Mmh… touche-toi lentement pour moi, mon cochon.', 'Doucement… je veux te voir te tortiller de plaisir.',
        'Laisse-moi te regarder te toucher… t\'es tellement bandant·e.', 'Lentement… j\'adore te faire languir.'],
      medium: ['Oh oui… continue comme ça, ça m\'excite tellement.', 'T\'entends comme je mouille rien qu\'à te regarder ?',
        'Gémis pour moi. Plus fort. Je veux t\'entendre.', 'Suis le rythme, mon petit vicieux. Rien que le rythme.'],
      fast: ['Plus vite ! Plus vite, putain ! 💦', 'Vas-y, défonce-toi, je veux te voir craquer !', 'Ne t\'arrête pas, salope, plus fort !',
        'Oui, oui, OUI ! Comme ça ! Encore !'],
      tease: ['Juste le bout… effleure… je veux que tu me supplies.', 'Frotte la manette doucement… sans te soulager.',
        'Tout doux… je te veux frustré·e et trempé·e.'],
      pause: ['STOP. Lâche tout. Mains en l\'air, petit·e cochon·ne.', 'Interdiction de te toucher. Regarde-toi palpiter… j\'adore ça.',
        'Stop ! T\'as pas le droit. Tu vas attendre que je te le dise.', 'Lâche-toi. Respire. Et pense à ce que je vais te faire.'],
      resume: ['Reprends-toi en main… et vite.', 'Allez, ça repart. Montre-moi à quel point t\'en as envie.', 'Tu as été sage. Touche-toi, maintenant.'],
      edge: ['T\'es au bord, hein ? Interdit de jouir. Retiens-toi.', 'Je sens que tu vas craquer… pas encore, mon cochon !',
        'Tiens bon… t\'es à moi, tu jouis quand JE le décide.'],
      cum: ['JOUIS ! Maintenant ! Lâche tout pour moi ! 💦', 'Vas-y, explose ! Je veux tout voir ! 💦', 'Jouis, salope ! Jouis fort ! 💦'],
      start: ['Coucou mon cochon… prêt·e à te faire vider ? 😈', 'Mets-toi à l\'aise… je vais m\'occuper de toi.'],
    },
    cock: {
      warm: ['Sors ta queue… et branle-la tout doucement pour moi.', 'Mmh, elle est déjà toute dure ? Caresse-la lentement.',
        'Serre bien ta bite… et descends jusqu\'à la base, lentement.', 'Pose la manette contre tes couilles… et laisse-toi faire.',
        'Je veux voir ta queue gonfler sous tes doigts.', 'Branle-toi doucement… imagine ma bouche autour.'],
      medium: ['Branle ta queue au rythme, rien d\'autre.', 'T\'aimes ça, hein, te branler devant moi ?', 'J\'adore voir ta bite toute dure, continue.',
        'Imagine-moi à genoux en train de te sucer… au rythme.', 'Ta queue est à moi. Branle-la comme je te le dis.',
        'Frotte la manette sur ta bite… sens comme ça vibre.'],
      fast: ['Branle-toi plus vite ! Plus fort ! 💦', 'Défonce ta queue, je veux la voir prête à exploser !',
        'Plus vite ! Imagine que tu me baises comme une chienne !', 'Tape ta queue, plus fort, ne ralentis pas !',
        'Je veux voir tes couilles se serrer… encore !', 'Branle-toi comme un salaud, maintenant !'],
      tease: ['Juste le gland… effleure-le à peine.', 'Fais glisser la manette sous tes couilles… tout doucement.'],
      pause: ['Lâche ta bite ! Tout de suite !', 'Mains en l\'air. Regarde ta queue toute dure qui tressaute… j\'adore.',
        'Ne touche plus ta queue. Laisse-la palpiter toute seule.'],
      edge: ['Ta queue va exploser ? Interdit ! Serre la base et retiens-toi !', 'Je vois ta bite qui coule… pas encore, mon cochon !',
        'Tes couilles sont pleines… garde tout pour moi.'],
      cum: ['Gicle ! Vide tes couilles pour moi ! 💦', 'Jouis ! Mets-en partout ! 💦', 'Vas-y, crache tout, je veux voir ton foutre ! 💦'],
    },
    pussy: {
      warm: ['Écarte les cuisses… et caresse ta chatte tout doucement.', 'Mmh, tu mouilles déjà ? Frotte ton clito lentement.',
        'Pose la manette sur ta chatte… et laisse-la vibrer.', 'Glisse un doigt… tout doucement, pour moi.'],
      medium: ['Frotte ton clito au rythme, rien d\'autre.', 'T\'es trempée, hein ? Continue.', 'Doigte-toi en suivant le tempo, ma salope.',
        'Appuie la manette contre ton clito… sens comme ça vibre.'],
      fast: ['Plus vite ! Défonce ta chatte ! 💦', 'Frotte ton clito comme une folle, maintenant !', 'Deux doigts, plus fort, plus vite !',
        'Je veux t\'entendre crier, ne ralentis pas !'],
      tease: ['Juste effleurer ton clito… à peine.', 'Fais glisser la manette sur tes lèvres… sans appuyer.'],
      pause: ['Retire tes doigts ! Tout de suite !', 'Mains en l\'air. Sens ta chatte qui palpite toute seule…'],
      edge: ['Tu vas jouir ? Interdit ! Retire tes doigts !', 'Ta chatte se contracte… pas encore, ma salope !'],
      cum: ['Jouis ! Laisse ta chatte exploser ! 💦', 'Gicle pour moi, ma salope ! 💦', 'Jouis fort, je veux te voir trembler ! 💦'],
    },
  };

  /** Tire un message. kind = warm|medium|fast|tease|pause|resume|edge|cum|start */
  function say(kind, level, anatomy = 'any') {
    let pool;
    if (level === 'hard') {
      pool = (HARD.any[kind] || []).concat(anatomy !== 'any' && HARD[anatomy] ? (HARD[anatomy][kind] || []) : []);
      // l'anatomie compte double pour coller au mieux
      if (anatomy !== 'any' && HARD[anatomy] && HARD[anatomy][kind]) pool = pool.concat(HARD[anatomy][kind]);
    } else pool = (level === 'hot' ? HOT : SOFT)[kind] || SOFT[kind] || [];
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
  }
  /** Accorde les « ·e » selon l'anatomie : cock → masculin, pussy → féminin. */
  function fit(text, anatomy) {
    if (anatomy === 'cock') return text.replace(/·ne\b/g, '').replace(/·e\b/g, '');
    if (anatomy === 'pussy') return text.replace(/·ne\b/g, 'ne').replace(/·e\b/g, 'e');
    return text;
  }
  const kindForBpm = bpm => (bpm < 90 ? 'warm' : bpm < 150 ? 'medium' : 'fast');

  return { DEFAULTS, SOFT, HOT, HARD, say, fit, kindForBpm };
})());
