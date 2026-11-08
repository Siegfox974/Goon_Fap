/* Pilotage DIRECT de la manette Sony (DualShock 4 / DualSense) en USB ou Bluetooth via WebHID.
 * Indépendant de la page web : plus besoin que le site « voie » la manette.
 * Formats des rapports repris des pilotes Linux hid-sony / hid-playstation. */
/* eslint-disable no-var */
var GFHID = globalThis.GFHID || (globalThis.GFHID = (() => {
  const SONY = 0x054c;
  const DS4 = [0x05c4, 0x09cc, 0x0ba0];         // DualShock 4 (v1, v2, adaptateur sans fil)
  const DSENSE = [0x0ce6, 0x0df2];              // DualSense, DualSense Edge
  const FILTERS = [{ vendorId: SONY }];
  const PINK = [255, 20, 147];                   // barre lumineuse rose GoonFap 💗

  let dev = null, busy = Promise.resolve(), seq = 0, offTimer = null;

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function putCrc(reportId, d) { // CRC32 sur [0xA2, id, données…] rangé dans les 4 derniers octets
    const crc = crc32([0xA2, reportId, ...d.subarray(0, d.length - 4)]);
    d[d.length - 4] = crc & 255; d[d.length - 3] = (crc >>> 8) & 255; d[d.length - 2] = (crc >>> 16) & 255; d[d.length - 1] = (crc >>> 24) & 255;
  }
  const hasOut = (d, id) => d.collections.some(c => (c.outputReports || []).some(r => r.reportId === id));
  const isSony = d => d.vendorId === SONY && (DS4.includes(d.productId) || DSENSE.includes(d.productId));

  function report(d, strong, weak) {
    const s = Math.round(255 * Math.max(0, Math.min(1, strong))), w = Math.round(255 * Math.max(0, Math.min(1, weak)));
    if (DS4.includes(d.productId)) {
      if (hasOut(d, 0x11)) { // Bluetooth
        const r = new Uint8Array(77);
        r[0] = 0xC0; r[2] = 0x07; r[5] = w; r[6] = s; r[7] = PINK[0]; r[8] = PINK[1]; r[9] = PINK[2];
        putCrc(0x11, r);
        return [0x11, r];
      }
      const r = new Uint8Array(31); // USB
      r[0] = 0x07; r[3] = w; r[4] = s; r[5] = PINK[0]; r[6] = PINK[1]; r[7] = PINK[2];
      return [0x05, r];
    }
    // DualSense
    if (hasOut(d, 0x31)) { // Bluetooth
      const r = new Uint8Array(77);
      r[0] = (seq++ & 0x0F) << 4; r[1] = 0x10; r[2] = 0x03; r[4] = w; r[5] = s;
      putCrc(0x31, r);
      return [0x31, r];
    }
    const r = new Uint8Array(47); // USB
    r[0] = 0x03; r[2] = w; r[3] = s;
    return [0x02, r];
  }

  function send(strong, weak) {
    if (!dev) return;
    const d = dev;
    // envoi en file : on ne mélange jamais deux rapports
    busy = busy.then(() => { const [id, data] = report(d, strong, weak); return d.sendReport(id, data); }).catch(() => {});
  }

  async function open(d) {
    if (!d || !isSony(d)) return null;
    if (!d.opened) await d.open();
    dev = d;
    send(0, 0); // allume la barre lumineuse en rose
    return d;
  }

  async function auto() {
    if (!navigator.hid) return null;
    if (dev && dev.opened) return dev;
    const list = await navigator.hid.getDevices();
    for (const d of list) { try { if (await open(d)) return dev; } catch (e) {} }
    return null;
  }

  if (navigator.hid) {
    navigator.hid.addEventListener('connect', e => { if (!dev) open(e.device).catch(() => {}); });
    navigator.hid.addEventListener('disconnect', e => { if (e.device === dev) dev = null; });
  }

  return {
    supported: !!navigator.hid,
    FILTERS,
    auto,
    // fenêtre de choix du navigateur (à appeler sur un clic)
    async request() {
      const list = await navigator.hid.requestDevice({ filters: FILTERS });
      for (const d of list) { try { if (await open(d)) return dev; } catch (e) {} }
      return null;
    },
    rumble(ms, strong, weak = strong) {
      if (!dev) return false;
      clearTimeout(offTimer);
      send(strong, weak);
      offTimer = setTimeout(() => send(0, 0), Math.max(20, ms));
      return true;
    },
    stop() { clearTimeout(offTimer); send(0, 0); },
    info() { return dev ? { name: dev.productName || 'Manette Sony', bt: hasOut(dev, 0x11) || hasOut(dev, 0x31) } : null; },
  };
})());
