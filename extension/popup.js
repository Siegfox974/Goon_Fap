'use strict';
const $ = s => document.querySelector(s);
const FIELDS = ['power', 'pulse', 'sens', 'band', 'minGap', 'predict', 'offset', 'level', 'talk', 'tease', 'nuance', 'tempoBoost'];
const FMT = { power: v => Math.round(v * 100) + '%', pulse: v => v + ' ms', sens: v => (+v).toFixed(1), minGap: v => v + ' ms', offset: v => v + ' ms' };
let S = Object.assign({}, GF.DEFAULTS);

async function init() {
  const { adult, settings } = await chrome.storage.local.get(['adult', 'settings']);
  S = Object.assign({}, GF.DEFAULTS, settings || {});
  fill();
  $(adult ? '#app' : '#gate').classList.remove('hidden');
  refresh();
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
    const v = el.type === 'checkbox' ? el.checked : (el.tagName === 'SELECT' && id !== 'talk' ? el.value : +el.value);
    S[id] = v;
    const out = document.querySelector(`output[data-for="${id}"]`);
    if (out) out.textContent = FMT[id](el.value);
    chrome.storage.local.set({ settings: S });
  });
});
$('#reset').addEventListener('click', () => { S = Object.assign({}, GF.DEFAULTS); fill(); chrome.storage.local.set({ settings: S }); });

$('#age').addEventListener('change', e => { $('#age-ok').disabled = !e.target.checked; });
$('#age-ok').addEventListener('click', async () => {
  await chrome.storage.local.set({ adult: true });
  $('#gate').classList.add('hidden'); $('#app').classList.remove('hidden');
});

let active = false;
async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const s = await chrome.runtime.sendMessage({ type: 'gf-status' });
  active = !!(s && s.active);
  const here = active && tab && s.tabId === tab.id;
  $('#go').textContent = here ? '■ Arrêter' : active ? '▶ Lancer ici (arrête l\'autre onglet)' : '▶ Lancer sur cet onglet';
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
  if (!tab || /^(chrome|edge|about|chrome-extension):/.test(tab.url || '')) {
    st.textContent = '❌ Ouvre d\'abord la page de ta vidéo.'; return;
  }
  st.textContent = 'Démarrage…';
  const r = await chrome.runtime.sendMessage({ type: 'gf-start', tabId: tab.id });
  st.textContent = r && r.ok ? '💓 C\'est parti ! Lance la vidéo.' : '❌ ' + (r ? r.error : 'erreur inconnue');
  if (r && r.ok) setTimeout(() => window.close(), 900);
  refresh();
});

init();
