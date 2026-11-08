'use strict';
const $ = s => document.querySelector(s);
const FIELDS = ['compModel', 'compScene', 'compView', 'compagne', 'compNude', 'compFrame', 'compSide', 'compSize', 'cumSnd', 'fMode', 'fOffset', 'finale', 'beatKind', 'source', 'power', 'pulse', 'vOffset', 'vTol', 'tease', 'tempoBoost', 'level', 'anatomy', 'talk', 'voice', 'voiceName',
  'voiceRate', 'voicePitch', 'clips', 'moans', 'clipVol', 'beatSfx', 'beatVol', 'gifs', 'gifEvery', 'gifDur', 'gifSize',
  'sens', 'band', 'minGap', 'predict', 'offset'];
const NUM = new Set(['compSize', 'fOffset', 'power', 'pulse', 'vOffset', 'vTol', 'talk', 'voiceRate', 'voicePitch', 'clipVol', 'beatVol', 'gifEvery', 'gifDur', 'gifSize', 'sens', 'minGap', 'offset']);
const pct = v => Math.round(v * 100) + '%';
const FMT = { compSize: v => Math.round(v * 100) + '%', fOffset: v => v + ' ms', power: pct, pulse: v => v + ' ms', vOffset: v => v + ' ms', vTol: v => v, voiceRate: v => (+v).toFixed(2), voicePitch: v => (+v).toFixed(2),
  clipVol: pct, beatVol: pct, gifEvery: v => v + ' s', gifDur: v => v + ' s', gifSize: pct, sens: v => (+v).toFixed(1), minGap: v => v + ' ms', offset: v => v + ' ms' };
let S = Object.assign({}, GF.DEFAULTS);

async function init() {
  const { adult, settings } = await chrome.storage.local.get(['adult', 'settings']);
  S = Object.assign({}, GF.DEFAULTS, GF.migrate(settings));
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
$('#reset').addEventListener('click', () => { const lane = S.lane, sndExclude = S.sndExclude; S = Object.assign({}, GF.DEFAULTS, { lane, sndExclude }); fill(); chrome.storage.local.set({ settings: S }); });
$('#voice-test').addEventListener('click', () => chrome.runtime.sendMessage({
  type: 'gf-say', text: GF.fit(GF.say('warm', S.level, S.anatomy), S.anatomy), opts: { voiceName: S.voiceName, rate: S.voiceRate, pitch: S.voicePitch },
}));
$('#open-ext').addEventListener('click', e => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id }); });

$('#age').addEventListener('change', e => { $('#age-ok').disabled = !e.target.checked; });
$('#age-ok').addEventListener('click', async () => {
  await chrome.storage.local.set({ adult: true });
  $('#gate').classList.add('hidden'); $('#app').classList.remove('hidden');
});

const listDir = GF.listDir;
const urlOf = f => chrome.runtime.getURL(f.split('/').map(encodeURIComponent).join('/'));
let player = null;
function playFile(f) { if (player) player.pause(); player = new Audio(urlOf(f)); player.play().catch(() => {}); }
// Liste des sons par catégorie : écouter / exclure
function renderSoundList(files) {
  const box = $('#snd-list'); box.textContent = '';
  const groups = {};
  files.forEach(f => { const k = GF.classifySound(f); if (k) (groups[k] = groups[k] || []).push(f); });
  for (const [k, list] of Object.entries(groups)) {
    const d = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = `${LABELS[k] || k} (${list.length}) `;
    const rnd = document.createElement('button'); rnd.className = 'small-btn'; rnd.textContent = '▶ au hasard';
    rnd.addEventListener('click', e => { e.preventDefault(); playFile(list[Math.floor(Math.random() * list.length)]); });
    sum.appendChild(rnd); d.appendChild(sum);
    list.slice(0, 200).forEach(f => {
      const row = document.createElement('div'); row.className = 'sndrow';
      const name = document.createElement('span'); name.textContent = f.replace(/^sons\//, ''); name.title = f;
      const pl = document.createElement('button'); pl.textContent = '▶'; pl.addEventListener('click', () => playFile(f));
      const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Ne plus jouer ce son';
      x.addEventListener('click', async () => { S.sndExclude = (S.sndExclude || []).concat(f); await chrome.storage.local.set({ settings: S }); counts(); });
      row.append(pl, x, name); d.appendChild(row);
    });
    box.appendChild(d);
  }
  if ((S.sndExclude || []).length) {
    const r = document.createElement('button'); r.className = 'link'; r.textContent = `Réintégrer les ${S.sndExclude.length} son(s) exclus`;
    r.addEventListener('click', async () => { S.sndExclude = []; await chrome.storage.local.set({ settings: S }); counts(); });
    box.appendChild(r);
  }
}
const LABELS = { fap: 'fap', lent: 'gémissements doux', moyen: 'gémissements', rapide: 'gros gémissements', beat: 'claquements', oral: 'bouche', jouis: 'orgasmes féminins',
  debut: 'début', taquin: 'taquin', stop: 'stop', reprise: 'reprise', bord: 'au bord' };
async function counts() {
  const mods = (await listDir('modele')).filter(f => /\.(vrm|pmx)$/i.test(f));
  const selM = $('#compModel');
  for (const f of mods) { if (![...selM.options].some(o => o.value === f)) { const o = document.createElement('option'); o.value = f; o.textContent = f.replace(/^modele\//, '') + (/\.pmx$/i.test(f) ? ' (MMD)' : ' (VRM)'); selM.appendChild(o); } }
  selM.value = S.compModel || '';
  $('#comp-info').textContent = mods.length ? `${mods.length} modèle(s) trouvé(s).` : 'Aucun modèle : dépose un .vrm, ou le dossier complet d\'un modèle MMD (.pmx + textures), dans modele/, puis recharge l\'extension.';
  const g = await listDir('gifs');
  $('#gif-count').textContent = g.length ? `${g.length} fichier(s) dans gifs/.` : 'Aucun GIF : dépose tes .gif / .webp / .mp4 dans le dossier gifs/ de l\'extension, puis recharge-la.';
  const s = await GF.indexSounds();
  const by = {}; let ignored = 0;
  s.forEach(f => { const k = GF.classifySound(f); if (k) by[k] = (by[k] || 0) + 1; else ignored++; });
  const parts = Object.entries(by).map(([k, v]) => `${LABELS[k] || k} : ${v}`);
  renderSoundList(s, by);
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

// Manette pilotée en direct (WebHID) : la connexion se fait dans un onglet (la fenêtre de choix y est fiable)
$('#padconnect').addEventListener('click', () => chrome.tabs.create({ url: 'manette.html' }));
(async () => {
  try {
    const list = navigator.hid ? await navigator.hid.getDevices() : [];
    const d = list.find(x => x.vendorId === 0x054c);
    $('#padinfo').textContent = d ? `✅ ${d.productName || 'Manette Sony'} autorisée — GoonFap la pilote en direct.` : 'Manette pas encore connectée à GoonFap.';
    if (d) $('#padconnect').textContent = '🎮 Manette : tester / reconnecter';
  } catch (e) {}
})();

init();
