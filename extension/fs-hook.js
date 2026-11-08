/* Exécuté DANS la page (monde "MAIN") : repère les funscripts que le site télécharge
 * (faptap.net et autres) et les transmet au content script GoonFap via window.postMessage.
 * Un funscript = JSON { actions: [{ at: ms, pos: 0..100 }, …] }. Rien n'est envoyé hors de ton navigateur. */
(() => {
  if (window.__gfHook) { window.__gfHook.scan(); window.__gfHook.resend(); return; }

  // --- Manette, côté page : second chemin pour les vibrations (au cas où GoonFap ne la voit pas de son côté) ---
  const gp = () => { try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).find(Boolean) || null; } catch (e) { return null; } };
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || !e.data.__gfRumble) return;
    const r = e.data.__gfRumble, p = gp();
    if (!p) return;
    const a = p.vibrationActuator;
    if (r.stop) { if (a && a.reset) a.reset().catch(() => {}); return; }
    if (a && a.playEffect) a.playEffect('dual-rumble', { startDelay: 0, duration: r.ms, strongMagnitude: r.s, weakMagnitude: r.w }).catch(() => {});
    else if (p.hapticActuators && p.hapticActuators[0]) { try { p.hapticActuators[0].pulse(Math.max(r.s, r.w), r.ms); } catch (er) {} }
  });
  setInterval(() => {
    const p = gp();
    window.postMessage({ __gfPad: p ? { id: p.id, vib: !!((p.vibrationActuator && p.vibrationActuator.playEffect) || (p.hapticActuators && p.hapticActuators[0])) } : { none: true } }, '*');
  }, 1000);
  const seen = new Set();
  const found = []; // funscripts trouvés (renvoyés quand GoonFap démarre après le chargement de la page)
  const post = s => window.postMessage({ __gfFunscript: s }, '*');
  window.addEventListener('message', e => { if (e.source === window && e.data && e.data.__gfAsk) found.forEach(post); });

  function looksLikeScript(o) {
    return o && Array.isArray(o.actions) && o.actions.length > 4 &&
      typeof o.actions[0].at === 'number' && typeof o.actions[0].pos === 'number';
  }
  // Cherche un funscript dans une réponse JSON (parfois imbriqué : { script: { actions } }, { data: … })
  function find(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 4) return null;
    if (looksLikeScript(o)) return o;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string' && v.length > 50 && v.includes('"actions"')) { try { const p = find(JSON.parse(v), depth + 1); if (p) return p; } catch (e) {} }
      else if (v && typeof v === 'object') { const p = find(v, depth + 1); if (p) return p; }
    }
    return null;
  }
  function offer(text, url) {
    if (!text || text.length < 30 || !text.includes('"actions"')) return;
    try {
      const s = find(JSON.parse(text));
      if (!s) return;
      const key = s.actions.length + ':' + s.actions[s.actions.length - 1].at;
      if (seen.has(key)) return;
      seen.add(key);
      const item = { actions: s.actions, url: String(url || ''), inverted: !!s.inverted };
      found.push(item); if (found.length > 5) found.shift();
      post(item);
    } catch (e) {}
  }

  // 1. Les prochains téléchargements de la page
  const of = window.fetch;
  if (of) {
    window.fetch = function (...args) {
      const p = of.apply(this, args);
      p.then(r => {
        try {
          const ct = r.headers.get('content-type') || '';
          if (/json|text|octet/i.test(ct) || /script/i.test(r.url)) r.clone().text().then(t => offer(t, r.url)).catch(() => {});
        } catch (e) {}
      }).catch(() => {});
      return p;
    };
  }
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__gfUrl = u; return oo.call(this, m, u, ...rest); };
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener('load', () => {
      try {
        if (this.responseType === '' || this.responseType === 'text') offer(this.responseText, this.__gfUrl);
        else if (this.responseType === 'json') offer(JSON.stringify(this.response), this.__gfUrl);
      } catch (e) {}
    });
    return os.apply(this, a);
  };

  // 2. Ce qui a déjà été téléchargé avant l'arrivée de GoonFap : on le redemande (même origine, mêmes cookies)
  const tried = new Set();
  function scan() {
    const urls = performance.getEntriesByType('resource').map(e => e.name)
      .concat(Array.from(document.querySelectorAll('a[href]')).map(a => a.href))
      .filter(u => /funscript|script|haptic|action/i.test(u) && !/\.(js|mjs|css|png|jpe?g|gif|webp|svg|woff2?|mp4|m3u8|ts|webm)(\?|$)/i.test(u));
    for (const u of urls.slice(0, 30)) {
      if (tried.has(u)) continue;
      tried.add(u);
      // si la page ne peut pas le relire (autre domaine), GoonFap le demandera lui-même
      of.call(window, u, { credentials: 'include' }).then(r => r.text()).then(t => offer(t, u))
        .catch(() => window.postMessage({ __gfTry: u }, '*'));
    }
  }
  window.__gfHook = { scan, resend: () => found.forEach(post) };
  scan();
  // Les sites qui chargent la vidéo suivante sans recharger la page
  setInterval(scan, 4000);
})();
