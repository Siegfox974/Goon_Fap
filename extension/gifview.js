/* Affiche les GIF/images/vidéos du dossier gifs/ de l'extension par-dessus la page. */
'use strict';
const EXT = /\.(gif|webp|png|jpe?g|avif|mp4|webm)$/i;
let files = [], recent = [];

const list = () => GF.listDir('gifs').then(f => f.filter(x => EXT.test(x)));
GF.indexSounds();

list().then(f => { files = f; parent.postMessage({ gf: 'count', n: files.length }, '*'); });

function pick() {
  const pool = files.filter(f => !recent.includes(f));
  const f = (pool.length ? pool : files)[Math.floor(Math.random() * (pool.length || files.length))];
  recent.push(f); if (recent.length > Math.min(6, files.length - 1)) recent.shift();
  return f;
}

function show({ avoidTop = 0.82, size = 0.38, dur = 6000 }) {
  if (!files.length || document.querySelectorAll('.g').length >= 3) return;
  const f = pick(), isVid = /\.(mp4|webm)$/i.test(f);
  const el = document.createElement(isVid ? 'video' : 'img');
  if (isVid) { el.muted = true; el.loop = true; el.autoplay = true; el.playsInline = true; }
  el.className = 'g';
  el.src = chrome.runtime.getURL(f.split('/').map(encodeURIComponent).join('/'));
  const W = innerWidth, H = innerHeight;
  const h = Math.round(H * size);
  const place = () => {
    const ratio = isVid ? (el.videoWidth / el.videoHeight || 16 / 9) : (el.naturalWidth / el.naturalHeight || 1);
    let ew = Math.min(W * 0.45, h * ratio), eh = ew / ratio;
    const maxY = Math.max(0, avoidTop * H - eh - 10);
    // à gauche ou à droite, pour ne pas cacher le centre de la vidéo ni les messages
    const left = Math.random() < 0.5;
    const x = left ? 10 + Math.random() * W * 0.08 : W - ew - 10 - Math.random() * W * 0.08;
    const y = Math.random() * maxY;
    Object.assign(el.style, { width: ew + 'px', height: eh + 'px', left: x + 'px', top: y + 'px', transform: `rotate(${(Math.random() - 0.5) * 8}deg) scale(.9)` });
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('show'); el.style.transform = el.style.transform.replace('scale(.9)', 'scale(1)'); }));
    setTimeout(() => { el.classList.remove('show'); el.style.opacity = 0; setTimeout(() => el.remove(), 700); }, dur);
  };
  if (isVid) el.addEventListener('loadedmetadata', place, { once: true });
  else el.addEventListener('load', place, { once: true });
  el.addEventListener('error', () => el.remove(), { once: true });
}

addEventListener('message', e => { if (e.data && e.data.gf === 'show') show(e.data); });
