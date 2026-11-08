/* Document offscreen : capte le son de l'onglet, le rejoue, et y détecte les beats.
 * Les beats sont envoyés directement au content script via un port runtime. */
'use strict';

let ctx = null, stream = null, media = null, node = null, src = null;
const ports = new Set();

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'goonfap') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener(m => {
    if (m.type === 'settings' && node) node.port.postMessage(m.settings);
  });
  port.postMessage({ type: 'hello', running: !!ctx });
});

function broadcast(msg) { ports.forEach(p => { try { p.postMessage(msg); } catch (e) { ports.delete(p); } }); }

chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (m.target !== 'offscreen') return;
  const done = p => p.then(() => send({ ok: true }), e => send({ ok: false, error: String(e && e.message || e) }));
  if (m.type === 'start') done(startTab(m.streamId, m.settings));
  else if (m.type === 'start-url') done(startUrl(m.url, m.settings)); // utilisé pour les tests
  else if (m.type === 'stop') { stopAll(); send({ ok: true }); }
  return true;
});

async function graph(settings) {
  await ctx.audioWorklet.addModule('onset-worklet.js');
  node = new AudioWorkletNode(ctx, 'gf-onset', { numberOfOutputs: 1, outputChannelCount: [1] });
  const sink = ctx.createGain(); sink.gain.value = 0;
  src.connect(node); node.connect(sink).connect(ctx.destination);
  src.connect(ctx.destination); // on continue d'entendre le son de l'onglet
  node.port.onmessage = e => broadcast(e.data);
  if (settings) node.port.postMessage(settings);
}

async function startTab(streamId, settings) {
  stopAll();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false,
  });
  ctx = new AudioContext({ latencyHint: 'interactive' });
  src = ctx.createMediaStreamSource(stream);
  await graph(settings);
  broadcast({ type: 'hello', running: true });
}

async function startUrl(url, settings) {
  stopAll();
  media = new Audio(url);
  media.crossOrigin = 'anonymous';
  ctx = new AudioContext({ latencyHint: 'interactive' });
  src = ctx.createMediaElementSource(media);
  await graph(settings);
  await media.play();
  broadcast({ type: 'hello', running: true });
}

function stopAll() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (media) media.pause();
  if (ctx) ctx.close().catch(() => {});
  ctx = stream = media = node = src = null;
}
