/* Gestion de la manette (DualShock 4 / tout pad compatible Gamepad API) et vibrations. */
'use strict';

const Pad = (() => {
  // Mapping "standard" de la Gamepad API pour une DualShock 4
  const BTN = { CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7,
                SHARE: 8, OPTIONS: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, PS: 16, PAD: 17 };

  let index = null;
  let prev = [];
  let phoneFallback = false;
  const handlers = new Set();
  const statusHandlers = new Set();

  function pads() {
    try { return navigator.getGamepads ? Array.from(navigator.getGamepads()) : []; }
    catch (e) { return []; }
  }

  function get() {
    const list = pads();
    if (index !== null && list[index]) return list[index];
    const p = list.find(Boolean);
    if (p) { index = p.index; return p; }
    return null;
  }

  function canRumble(p = get()) {
    return !!(p && ((p.vibrationActuator && p.vibrationActuator.playEffect) ||
                    (p.hapticActuators && p.hapticActuators[0])));
  }

  function emitStatus() {
    const p = get();
    statusHandlers.forEach(fn => fn(p, canRumble(p)));
  }

  window.addEventListener('gamepadconnected', e => { index = e.gamepad.index; prev = []; emitStatus(); });
  window.addEventListener('gamepaddisconnected', e => { if (e.gamepad.index === index) index = null; emitStatus(); });

  /**
   * Fait vibrer la manette.
   * @param {number} duration ms
   * @param {number} strong 0..1 moteur lourd (gauche, grave)
   * @param {number} weak   0..1 moteur léger (droite, aigu)
   */
  function rumble(duration, strong, weak) {
    duration = Math.max(10, Math.round(duration));
    strong = clamp01(strong); weak = clamp01(weak);
    const p = get();
    if (p && p.vibrationActuator && p.vibrationActuator.playEffect) {
      p.vibrationActuator.playEffect('dual-rumble', {
        startDelay: 0, duration, strongMagnitude: strong, weakMagnitude: weak,
      }).catch(() => {});
      return true;
    }
    if (p && p.hapticActuators && p.hapticActuators[0]) {
      try { p.hapticActuators[0].pulse(Math.max(strong, weak), duration); return true; } catch (e) {}
    }
    if (phoneFallback && navigator.vibrate) { navigator.vibrate(duration); return true; }
    return false;
  }

  function stop() {
    const p = get();
    if (p && p.vibrationActuator) {
      if (p.vibrationActuator.reset) p.vibrationActuator.reset().catch(() => {});
      else rumble(10, 0, 0);
    }
    if (navigator.vibrate) navigator.vibrate(0);
  }

  /** À appeler à chaque frame : détecte les appuis (front montant) et notifie. */
  function poll() {
    const p = get();
    if (!p) return;
    const now = p.buttons.map(b => (typeof b === 'object' ? b.value : b));
    now.forEach((v, i) => {
      const was = prev[i] || 0;
      if (v > 0.5 && was <= 0.5) handlers.forEach(fn => fn(i, v, p));
    });
    prev = now;
  }

  function value(btn) {
    const p = get();
    if (!p || !p.buttons[btn]) return 0;
    const b = p.buttons[btn];
    return typeof b === 'object' ? b.value : b;
  }

  function clamp01(v) { return Math.max(0, Math.min(1, v || 0)); }

  // Certains navigateurs n'émettent "gamepadconnected" qu'au premier appui : on sonde régulièrement.
  let lastId = null;
  setInterval(() => {
    const p = get();
    const id = p ? p.id + p.index : null;
    if (id !== lastId) { lastId = id; emitStatus(); }
  }, 1000);

  return {
    BTN, get, rumble, stop, poll, value, canRumble,
    onPress(fn) { handlers.add(fn); return () => handlers.delete(fn); },
    onStatus(fn) { statusHandlers.add(fn); fn(get(), canRumble()); },
    setPhoneFallback(v) { phoneFallback = !!v; },
  };
})();
