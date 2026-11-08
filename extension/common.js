/* Partagé entre popup, content script, offscreen et service worker : réglages par défaut + messages. */
/* eslint-disable no-var */
var GF = globalThis.GF || (globalThis.GF = (() => {
  const DEFAULTS = {
    _v: 4,
    power: 1,          // 100 % = le max de la manette
    pulse: 140,        // ms par vibration
    source: 'auto',    // 'auto' | 'funscript' | 'visual' (barre rythmo à l'image) | 'audio' (le son)
    fOffset: 60,       // ms d'avance des vibrations en mode funscript (temps de réaction des moteurs)
    fMode: 'strokes',  // funscript : 'strokes' = un coup par aller-retour, 'both' = aller ET retour, 'flow' = vibration continue selon la vitesse
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
    voiceRate: 0.92,
    voicePitch: 1.05,
    finale: 'cum',     // fin de vidéo : 'cum' | 'ruin' | 'denial' | 'off'
    beatKind: 'fap',   // bruitage sur chaque beat : 'fap' (branlette) | 'beat' (claquements) | 'oral' | 'mix'
    clips: true,       // jouer les sons du dossier sons/ quand il y en a
    moans: true,       // ambiance : gémissements en continu selon le tempo
    clipVol: 0.9,
    beatSfx: true,     // un bruitage (claquement) sur chaque beat, s'il y a des sons
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

  // Niveau « Salope » : une maîtresse de gooning, vicieuse, qui ne te lâche jamais et te parle crûment.
  // Elle réagit à la vidéo (accélérations, ralentissements, pauses, fin qui approche).
  // Listes communes (any) + listes selon l'anatomie (cock / pussy). Les « ·e » sont accordés par fit().
  const HARD = {
    any: {
      start: ['Mmh… te voilà, mon petit gooner. Installe-toi… je vais te vider la tête.',
        'Coucou mon cochon… t\'es venu te faire sucer le cerveau ? Allez, mets-toi à l\'aise.',
        'Éteins tout le reste. Il n\'y a plus que moi, la vidéo et ta main.',
        'Ce soir tu ne réfléchis plus. Tu suis le rythme et tu m\'obéis. C\'est tout.'],
      warm: ['Mmh… doucement… savoure chaque caresse pour moi.', 'Lentement… je veux te voir fondre, centimètre par centimètre.',
        'T\'es tout chaud déjà, hein ? Moi aussi je mouille en te regardant…', 'Laisse ta tête se vider… il n\'y a plus que le rythme.',
        'Respire… et touche-toi comme si c\'était ma langue.', 'Doucement… on a tout le temps. Je vais te faire goon pendant des heures.'],
      medium: ['Oh oui… continue comme ça, t\'es tellement bon·ne quand tu obéis.', 'Gémis pour moi. Plus fort. Je veux t\'entendre.',
        'Suis le rythme, mon petit vicieux… rien que le rythme.', 'C\'est bon, hein ? Ta main, mes mots… t\'es à moi.',
        'Regarde-la… et imagine que c\'est moi qui te fais ça.', 'T\'entends ce bruit ? C\'est le son d\'un gooner qui perd la tête.'],
      fast: ['Plus vite ! Plus vite, putain ! 💦', 'Vas-y, défonce-toi, je veux te voir craquer !', 'Ne t\'arrête pas, salope ! Plus fort !',
        'Oui, oui, OUI ! Comme ça ! Encore !', 'Tiens le rythme ! Je veux tes gémissements !', 'T\'es un animal maintenant. Pompe !'],
      faster: ['Elle accélère… suis-la ! Ne décroche pas !', 'Oh oui, ça s\'emballe… plus vite pour moi !', 'Ça monte ! Accélère, mon cochon, accélère !',
        'T\'as vu ? Elle s\'excite. Toi aussi. Plus vite !'],
      slower: ['Ralentis… doucement… savoure.', 'On redescend… tout doucement… ne lâche pas le rythme.', 'Lentement maintenant… je veux que ça dure encore.'],
      goon: ['Pompe… pompe… pompe pour moi. Ne pense à rien.', 'Ton cerveau fond, hein ? Laisse-le fondre. T\'es fait pour ça.',
        'T\'es un bon gooner. Un bon gooner ne s\'arrête jamais.', 'Plus rien n\'existe. Juste ta main, le rythme et moi.',
        'Encore un peu… et encore… t\'es accro, avoue.', 'Regarde-toi… complètement vidé·e de toute pensée. J\'adore.',
        'Tu vas goon pour moi jusqu\'à en trembler.'],
      tease: ['Juste le bout… effleure… je veux que tu me supplies.', 'Frotte la manette doucement… sans te soulager.',
        'Tout doux… je te veux frustré·e et dégoulinant·e.'],
      pause: ['STOP. Lâche tout. Mains en l\'air, petit·e cochon·ne.', 'Interdiction de te toucher. Regarde-toi palpiter… j\'adore ça.',
        'Stop ! T\'as pas le droit. Tu attends que je te le dise.', 'Lâche-toi. Respire. Et pense à ce que je vais te faire après.',
        'Mains en l\'air. Tu sens comme t\'en crèves d\'envie ? C\'est exactement là que je te veux.'],
      resume: ['Reprends-toi en main… et vite.', 'Allez, ça repart ! Montre-moi à quel point t\'en as envie.', 'Tu as été sage. Touche-toi, maintenant.',
        'Vas-y… reprends là où je t\'ai laissé·e.'],
      praise: ['T\'as tenu ? Bon gooner. Je suis fière de toi.', 'T\'es resté·e au bord sans craquer… t\'es parfait·e.',
        'Mmh, t\'as obéi… tu mérites que je te fasse encore plus mal au bord.'],
      edge: ['T\'es au bord, hein ? Interdit de jouir. Retiens-toi.', 'Je sens que tu vas craquer… pas encore, mon cochon !',
        'Tiens bon… t\'es à moi, tu jouis quand JE le décide.', 'Au bord… reste là… souffre un peu pour moi.'],
      final: ['La fin approche… je veux que tu sois au bord pour moi.', 'Plus que quelques instants… prépare-toi à tout lâcher.',
        'Tiens bon, mon gooner… bientôt je te donne la permission.', 'Ça arrive… sens-le monter… ne jouis pas avant mon signal.'],
      cum: ['JOUIS ! Maintenant ! Lâche tout pour moi ! 💦', 'Vas-y, explose ! Je veux tout voir ! 💦', 'Jouis, salope ! Jouis fort ! 💦'],
      ruin: ['STOP ! Lâche tout ! Mains en l\'air ! Regarde-le se gâcher… 😈', 'Ruiné ! Ne touche plus ! T\'aurais cru que j\'allais te laisser jouir ? 😈'],
      denial: ['Non. Pas ce soir. Range ça et va dormir frustré·e. 😈', 'Pas de permission aujourd\'hui. Tu reviendras me supplier demain. 🔒'],
      after: ['Mmh… c\'était bon, hein ? Reviens me voir quand tu veux, mon gooner.', 'T\'as été parfait·e. Respire… je suis là.'],
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
      faster: ['Elle accélère ! Branle ta queue plus vite !', 'Plus vite sur ta bite ! Suis-la, mon cochon !'],
      goon: ['Pompe ta queue… pompe… t\'es né pour ça.', 'Ta bite dirige, ton cerveau ne sert plus à rien.', 'Une queue dure, une tête vide. Parfait.'],
      tease: ['Juste le gland… effleure-le à peine.', 'Fais glisser la manette sous tes couilles… tout doucement.'],
      pause: ['Lâche ta bite ! Tout de suite !', 'Mains en l\'air. Regarde ta queue toute dure qui tressaute… j\'adore.',
        'Ne touche plus ta queue. Laisse-la palpiter toute seule.'],
      edge: ['Ta queue va exploser ? Interdit ! Serre la base et retiens-toi !', 'Je vois ta bite qui coule… pas encore, mon cochon !',
        'Tes couilles sont pleines… garde tout pour moi.'],
      final: ['Tes couilles sont pleines… bientôt je te laisse tout vider.', 'Garde ta queue au bord… le final arrive.'],
      cum: ['Gicle ! Vide tes couilles pour moi ! 💦', 'Jouis ! Mets-en partout ! 💦', 'Vas-y, crache tout, je veux voir ton foutre ! 💦'],
    },
    pussy: {
      warm: ['Écarte les cuisses… et caresse ta chatte tout doucement.', 'Mmh, tu mouilles déjà ? Frotte ton clito lentement.',
        'Pose la manette sur ta chatte… et laisse-la vibrer.', 'Glisse un doigt… tout doucement, pour moi.'],
      medium: ['Frotte ton clito au rythme, rien d\'autre.', 'T\'es trempée, hein ? Continue.', 'Doigte-toi en suivant le tempo, ma salope.',
        'Appuie la manette contre ton clito… sens comme ça vibre.'],
      fast: ['Plus vite ! Défonce ta chatte ! 💦', 'Frotte ton clito comme une folle, maintenant !', 'Deux doigts, plus fort, plus vite !',
        'Je veux t\'entendre crier, ne ralentis pas !'],
      faster: ['Elle accélère ! Frotte ton clito plus vite !'],
      goon: ['Ta chatte dégouline, ta tête est vide. Parfait.'],
      tease: ['Juste effleurer ton clito… à peine.', 'Fais glisser la manette sur tes lèvres… sans appuyer.'],
      pause: ['Retire tes doigts ! Tout de suite !', 'Mains en l\'air. Sens ta chatte qui palpite toute seule…'],
      edge: ['Tu vas jouir ? Interdit ! Retire tes doigts !', 'Ta chatte se contracte… pas encore, ma salope !'],
      final: ['Ta chatte tremble… bientôt je te laisse exploser.'],
      cum: ['Jouis ! Laisse ta chatte exploser ! 💦', 'Gicle pour moi, ma salope ! 💦', 'Jouis fort, je veux te voir trembler ! 💦'],
    },
  };

  // Évite de répéter les dernières phrases
  const recent = [];
  function draw(pool) {
    if (!pool.length) return '';
    const fresh = pool.filter(p => !recent.includes(p));
    const src = fresh.length ? fresh : pool;
    const t = src[Math.floor(Math.random() * src.length)];
    recent.push(t); if (recent.length > 24) recent.shift();
    return t;
  }

  /** Tire un message. kind = start|warm|medium|fast|faster|slower|goon|tease|pause|resume|praise|edge|final|cum|ruin|denial|after */
  function say(kind, level, anatomy = 'any') {
    let pool;
    if (level === 'hard') {
      const a = HARD.any[kind] || [], b = anatomy !== 'any' && HARD[anatomy] ? (HARD[anatomy][kind] || []) : [];
      pool = a.concat(b, b); // l'anatomie compte double pour coller au mieux
      if (!pool.length) pool = HARD.any.medium;
    } else {
      const fb = { faster: 'fast', slower: 'warm', goon: 'medium', praise: 'resume', final: 'edge', ruin: 'pause', denial: 'pause', after: 'resume' };
      const L = level === 'hot' ? HOT : SOFT;
      pool = L[kind] || L[fb[kind]] || SOFT[kind] || SOFT[fb[kind]] || [];
    }
    return draw(pool);
  }
  /** Accorde les « ·e » selon l'anatomie : cock → masculin, pussy → féminin. */
  function fit(text, anatomy) {
    if (anatomy === 'cock') return text.replace(/·ne\b/g, '').replace(/·e\b/g, '');
    if (anatomy === 'pussy') return text.replace(/·ne\b/g, 'ne').replace(/·e\b/g, 'e');
    return text;
  }
  /**
   * Range automatiquement un son d'après son chemin (dossier + nom) — permet de déposer
   * un pack entier (ex. OpenNSFW) tel quel dans sons/.
   * Renvoie : debut|lent|moyen|rapide|taquin|stop|reprise|bord|jouis|beat|oral|null
   */
  const KINDS = ['debut', 'lent', 'moyen', 'rapide', 'taquin', 'stop', 'reprise', 'bord', 'jouis', 'fap', 'beat', 'oral'];
  function classifySound(path) {
    const parts = path.toLowerCase().split('/');
    // 1) rangé à la main dans un de nos dossiers ?
    for (const p of parts.slice(0, -1)) if (KINDS.includes(p)) return p;
    const s = parts.join('/');
    // 2) sinon, d'après les mots du chemin
    if (/material|ambien|music|musique|room|bed ?creak|furniture|body noise/.test(s)) return null;
    // voix masculines : jamais (on ne veut que des voix de femme)
    if (/\[m\]|\(m\)|[-_ ]m[-_ ]?voice|male|\bmasc|lewddmon|\bguy\b|\bhomme/.test(s) && !/female/.test(s)) return null;
    const voice = /moan|gemi|gémi|breath|pant|whimper|voice|vocal|\[f\]|female|\bva\b|_va_/.test(s);
    // orgasme : seulement des voix de femme qui jouissent (pas les bruitages de sperme)
    if (/climax|orgasm|cumming|jouis/.test(s) && voice) return 'jouis';
    if (/\bcum|ejac|creampie|squirt|spurt|splat/.test(s)) return null;
    // bruit de branlette (main mouillée)
    if (/fap|stroke|handjob|hand ?job|jerk|lotion|squish|squelch|wet|in ?(&|and|-|_)? ?out/.test(s)) return 'fap';
    if (/plap|clap|slap|spank|thrust|pound/.test(s)) return 'beat';
    if (voice) {
      if (/\bhigh|intense|loud|hard|heavy|scream|fort/.test(s)) return 'rapide';
      if (/\blow|soft|light|gentle|quiet|whisper|doux/.test(s)) return 'lent';
      return 'moyen';
    }
    if (/oral|mouth|suck|slurp|blow|gag|lick|kiss|spit|drool/.test(s)) return 'oral';
    return null;
  }

  /** Liste récursive d'un dossier de l'extension (pages de l'extension seulement : popup, gifview). */
  function listDir(name) {
    return new Promise(resolve => {
      if (!chrome.runtime.getPackageDirectoryEntry) return resolve([]);
      chrome.runtime.getPackageDirectoryEntry(root => root.getDirectory(name, {}, dir => {
        const out = []; let pending = 0;
        const walk = d => {
          pending++;
          const rd = d.createReader(), all = [];
          const more = () => rd.readEntries(es => {
            if (es.length) { all.push(...es); return more(); }
            all.forEach(e => {
              if (e.isDirectory) walk(e);
              else if (!e.name.startsWith('.') && !/\.(txt|md)$/i.test(e.name)) out.push(e.fullPath.replace(/^\/(crxfs\/)?/, ''));
            });
            if (--pending === 0) resolve(out);
          }, () => { if (--pending === 0) resolve(out); });
          more();
        };
        walk(dir);
      }, () => resolve([])));
    });
  }
  const AUDIO_RE = /\.(wav|mp3|ogg|oga|m4a|aac|flac|webm|opus)$/i;
  /** Liste les sons et l'enregistre pour le moteur audio (qui, lui, ne peut pas lire le dossier). */
  async function indexSounds() {
    const files = (await listDir('sons')).filter(f => AUDIO_RE.test(f));
    try { await chrome.storage.local.set({ soundIndex: files }); } catch (e) {}
    return files;
  }

  /** Met à jour d'anciens réglages enregistrés. */
  function migrate(s) {
    s = Object.assign({}, s || {});
    if ((s._v || 0) < 3) { s.beatSfx = true; s.source = 'auto'; }
    if ((s._v || 0) < 4) { s.beatKind = 'fap'; s._v = 4; }
    return s;
  }

  const kindForBpm = bpm => (bpm < 90 ? 'warm' : bpm < 150 ? 'medium' : 'fast');

  return { DEFAULTS, SOFT, HOT, HARD, KINDS, say, fit, classifySound, migrate, listDir, indexSounds, kindForBpm };
})());
