'use strict';
const log = t => { document.getElementById('log').textContent = t; };
async function buzz() {
  for (const [d, s] of [[300, 1], [150, 0], [150, 1], [150, 0], [600, 1]]) {
    if (s) GFHID.rumble(d, 1, 1); await new Promise(r => setTimeout(r, d));
  }
}
async function refresh() {
  if (!GFHID.supported) { log('❌ Ce navigateur ne gère pas WebHID. Utilise Chrome ou Edge à jour.'); return; }
  const d = await GFHID.auto();
  const i = GFHID.info();
  log(d ? `✅ Connectée : ${i.name} (${i.bt ? 'Bluetooth' : 'USB'})` : 'Pas encore connectée.');
}
document.getElementById('connect').addEventListener('click', async () => {
  try {
    const d = await GFHID.request();
    if (!d) { log('Aucune manette Sony choisie.'); return; }
    await refresh(); buzz();
  } catch (e) { log('❌ ' + e.message + ' — ferme DS4Windows/Steam s\'ils tournent, puis réessaie.'); }
});
document.getElementById('test').addEventListener('click', async () => {
  if (!(await GFHID.auto())) { log('Connecte d\'abord la manette.'); return; }
  buzz(); log('💓 Ça doit vibrer (et la barre lumineuse est rose).');
});
refresh();
