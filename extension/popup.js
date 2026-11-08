'use strict';
const $ = s => document.querySelector(s);
const FIELDS = ['finale', 'beatKind', 'source', 'power', 'pulse', 'vOffset', 'vTol', 'tease', 'tempoBoost', 'level', 'anatomy', 'talk', 'voice', 'voiceName',
  'voiceRate', 'voicePitch', 'clips', 'moans', 'clipVol', 'beatSfx', 'beatVol', 'gifs', 'gifEvery', 'gifDur', 'gifSize',
  'sens', 'band', 'minGap', 'predict', 'offset'];
const NUM = new Set(['power', 'pulse', 'vOffset', 'vTol', 'talk', 'voiceRate', 'voicePitch', 'clipVol', 'beatVol', 'gifEvery', 'gifDur', 'gifSize', 'sens', 'minGap', 'offset']);
const pct = v => Math.round(v * 100) + '%';
const FMT = { power: pct, pulse: v => v + ' ms', vOffset: v => v + ' ms', vTol: v => v, voiceRate: v => (+v).toFixed(2), voicePitch: v => (+v).toFixed(2),
  clipVol: pct, beatVol: pct, gifEvery: v => v + ' s', gifDur: v => v + ' s', gifSize: pct, sens: v => (+v).toFixed(1), minGap: v => v + ' ms', offset: v => v + ' ms' };
let S = Object.assign({}, GF.DEFAULTS);

async function init() {
  const { adult, settings } = await chrome.storage.local.get(['adult', 'settings']);
  S = Object.assign({}, GF.DEFAULTS, settings || {});
  await loadVoices();
  fill();
  $(adult ? '#app' : '#gate').classList.remove('hidden');
  refresh();
  counts();
  chrome.extension.isAllowedIncognitoAccess(ok => { if (!ok) $('#incog').classList.remove('hidden'); });
}

async function loadVoices() {
  const list = (await chrome.runtime.sendMessage({ type: 'gf-voices' })) || [];
  const score = n => (/natural|neural|online/i.test(n) ? 2 : /google/i.test(n) ? 1 : 0);
  list.sort((a, b) => score(b.voiceName) - score(a.voiceName));
  for (const v of list) {
    const o = document.createElement('option');
    o.value = v.voiceName;
    o.textContent = (score(v.voiceName) ? '⭐ ' : '') + v.voiceName;
    $('#voiceName').appendChild(o);
  }
}

function fill() {
  FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el.type === 'checkbox') el.checked = !!S[id]; else el.value = S[id];
    const out = document.querySelector(`output[data-for="${id}"]`);
    if (out) out.textContent = FMT[id](el.value);
  });
}

FIELDS.forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    S[id] = el.type === 'checkbox' ? el.checked : NUM.has(id) ? +el.value : el.value;
    const out = document.querySelector(`output[data-for="${id}"]`);
    if (out) out.textContent = FMT[id](el.value);
    chrome.storage.local.set({ settings: S });
  });
});
$('#reset').addEventListener('click', () => { const lane = S.lane; S = Object.assign({}, GF.DEFAULTS, { lane }); fill(); chrome.storage.local.set({ settings: S }); });
$('#voice-test').addEventListener('click', () => chrome.runtime.sendMessage({
  type: 'gf-say', text: GF.fit(GF.say('warm', S.level, S.anatomy), S.anatomy), opts: { voiceName: S.voiceName, rate: S.voiceRate, pitch: S.voicePitch },
}));
$('#open-ext').addEventListener('click', e => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id }); });

$('#age').addEventListener('change', e => { $('#age-ok').disabled = !e.target.checked; });
$('#age-ok').addEventListener('click', async () => {
  await chrome.storage.local.set({ adult: true });
  $('#gate').classList.add('hidden'); $('#app').classList.remove('hidden');
});

// Liste récursive d'un dossier de l'extension
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
const LABELS = { lent: 'gémissements doux', moyen: 'gémissements', rapide: 'gros gémissements', beat: 'claquements', oral: 'bouche', jouis: 'orgasmes',
  debut: 'début', taquin: 'taquin', stop: 'stop', reprise: 'reprise', bord: 'au bord' };
async function counts() {
  const g = await listDir('gifs');
  $('#gif-count').textContent = g.length ? `${g.length} fichier(s) dans gifs/.` : 'Aucun GIF : dépose tes .gif / .webp / .mp4 dans le dossier gifs/ de l\'extension, puis recharge-la.';
  const s = (await listDir('sons')).filter(f => /\.(wav|mp3|ogg|oga|m4a|aac|flac|webm|opus)$/i.test(f));
  const by = {}; let ignored = 0;
  s.forEach(f => { const k = GF.classifySound(f); if (k) by[k] = (by[k] || 0) + 1; else ignored++; });
  const parts = Object.entries(by).map(([k, v]) => `${LABELS[k] || k} : ${v}`);
  $('#snd-count').textContent = parts.length
    ? `${s.length} sons trouvés — ` + parts.join(' · ') + (ignored ? ` · ${ignored} non utilisés (ambiances, matières…)` : '')
    : 'Aucun son : dézippe ton pack dans le dossier sons/ de l\'extension, puis recharge-la.';
}

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const s = await chrome.runtime.sendMessage({ type: 'gf-status' });
  const here = !!(s && s.active && tab && s.tabId === tab.id);
  $('#go').textContent = here ? '■ Arrêter' : (s && s.active) ? '▶ Lancer ici (arrête l\'autre onglet)' : '▶ Lancer sur cet onglet';
  $('#go').classList.toggle('stop', here);
  $('#go').dataset.here = here ? '1' : '';
  if (here) $('#status').textContent = '💓 Actif sur cet onglet.';
}

$('#go').addEventListener('click', async () => {
  const st = $('#status');
  if ($('#go').dataset.here) {
    await chrome.runtime.sendMessage({ type: 'gf-stop' });
    st.textContent = 'Arrêté.';
    return refresh();
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || /^(chrome|edge|about|chrome-extension):/.test(tab.url || '')) { st.textContent = '❌ Ouvre d\'abord la page de ta vidéo.'; return; }
  st.textContent = 'Démarrage…';
  const r = await chrome.runtime.sendMessage({ type: 'gf-start', tabId: tab.id });
  st.textContent = r && r.ok ? '💓 C\'est parti ! Lance la vidéo.' : '❌ ' + (r ? r.error : 'erreur inconnue');
  if (r && r.ok) setTimeout(() => window.close(), 900);
  refresh();
});

init();
