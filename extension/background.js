/* Service worker : démarre/arrête la capture et injecte l'overlay dans l'onglet. */
'use strict';
importScripts('common.js');

const getState = async () => (await chrome.storage.session.get({ active: false, tabId: null }));
const setState = s => chrome.storage.session.set(s);

async function hasOffscreen() {
  if (chrome.runtime.getContexts) {
    const c = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return c.length > 0;
  }
  return chrome.offscreen.hasDocument ? chrome.offscreen.hasDocument() : false;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html', reasons: ['USER_MEDIA'],
    justification: 'Analyse du rythme audio de l\'onglet pour faire vibrer la manette.',
  });
}

// Styles du plein écran GoonFap (classes posées par content.js uniquement pendant le plein écran)
const FS_CSS = `
.gf-fs:fullscreen{width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;background:#000!important;padding:0!important;margin:0!important;transform:none!important}
.gf-fs .gf-fs-chain{width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;min-height:0!important;padding:0!important;margin:0!important;top:0!important;left:0!important;transform:none!important;aspect-ratio:auto!important}
.gf-fs .gf-fs-video{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;object-fit:contain!important;transform:none!important;margin:0!important}
.gf-immersive-video{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483646!important;background:#000!important;object-fit:contain!important;transform:none!important;margin:0!important}`;

async function inject(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, css: FS_CSS });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['common.js', 'content.js'] });
}

async function settings() {
  const { settings: s } = await chrome.storage.local.get('settings');
  return Object.assign({}, GF.DEFAULTS, s || {});
}

async function start(tabId, testUrl) {
  const st = await getState();
  if (st.active) await stop();
  const streamId = testUrl ? null : await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  await setState({ active: true, tabId });
  await inject(tabId);
  const s = await settings();
  const res = await chrome.runtime.sendMessage(testUrl
    ? { target: 'offscreen', type: 'start-url', url: testUrl, settings: s }
    : { target: 'offscreen', type: 'start', streamId, settings: s });
  if (!res || !res.ok) { await stop(); throw new Error(res ? res.error : 'capture impossible'); }
}

async function stop() {
  const st = await getState();
  await setState({ active: false, tabId: null });
  if (await hasOffscreen()) {
    try { await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }); } catch (e) {}
    try { await chrome.offscreen.closeDocument(); } catch (e) {}
  }
  chrome.tts.stop();
  if (st.tabId != null) chrome.tabs.sendMessage(st.tabId, { type: 'gf-remove' }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg.target === 'offscreen') return;
  if (msg.type === 'gf-start') {
    start(msg.tabId, msg.testUrl).then(() => send({ ok: true }), e => send({ ok: false, error: e.message || String(e) }));
    return true;
  }
  if (msg.type === 'gf-stop') { stop().then(() => send({ ok: true })); return true; }
  if (msg.type === 'gf-status') { getState().then(send); return true; }
  if (msg.type === 'gf-say') { speak(msg.text, msg.opts || {}); return; }
  if (msg.type === 'gf-hush') { chrome.tts.stop(); return; }
  if (msg.type === 'gf-voices') { voices().then(v => send(v)); return true; }
});

// ---------- Voix (synthèse vocale) ----------
// chrome.tts ne passe pas par l'onglet : la voix n'est pas recapturée par la détection audio.
function voices() {
  return new Promise(res => chrome.tts.getVoices(v => res((v || []).filter(x => /^fr/i.test(x.lang || '')))));
}
// Les voix "Natural"/"Online"/neuronales sonnent humain ; les voix système sonnent robot.
function voiceScore(v) {
  const n = v.voiceName || '';
  let s = 0;
  if (/natural|neural|online/i.test(n)) s += 100;
  if (/google/i.test(n)) s += 50;
  if (/denise|vivienne|eloise|brigitte|coralie|jacqueline|yvette|celeste|ariane/i.test(n)) s += 20; // voix féminines
  if (/henri|remy|paul|claude|alain|jerome|maurice|yves|antoine|guillaume/i.test(n)) s -= 30;
  if (/fr-FR/i.test(v.lang || '')) s += 5;
  return s;
}
async function speak(text, o) {
  text = String(text || '').replace(/<[^>]+>/g, ' ').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/·e/g, 'e').trim();
  if (!text) return;
  let name = o.voiceName;
  if (!name) {
    const list = await voices();
    list.sort((a, b) => voiceScore(b) - voiceScore(a));
    name = list[0] && list[0].voiceName;
  }
  chrome.tts.speak(text, { voiceName: name || undefined, lang: name ? undefined : 'fr-FR', rate: o.rate || 0.95, pitch: o.pitch || 1.1, volume: o.volume ?? 1, enqueue: false });
}

// La page a changé (vidéo suivante…) : on remet l'overlay
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const st = await getState();
  if (st.active && st.tabId === tabId) inject(tabId).catch(() => {});
});
chrome.tabs.onRemoved.addListener(async tabId => {
  const st = await getState();
  if (st.active && st.tabId === tabId) stop();
});

