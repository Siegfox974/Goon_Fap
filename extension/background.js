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

async function inject(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, css: '.gf-immersive-video{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483646!important;background:#000!important;object-fit:contain!important;transform:none!important;margin:0!important}' });
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
});

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

