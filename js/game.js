/* Moteur de séance : horloge, déclenchement des vibrations, rendu de la piste façon "Hero". */
'use strict';

class Session {
  /**
   * @param {object} map beatmap
   * @param {object} opts { power, pulse, mix, click, record }
   * @param {HTMLVideoElement|null} video
   * @param {object} ui callbacks { onEnd(stats), onMessage(html, ms), onPhase(label) }
   */
  constructor(map, opts, video, ui) {
    this.map = map;
    this.opts = opts;
    this.video = video;
    this.ui = ui;
    this.beats = map ? map.beats : [];
    this.phases = map ? map.phases : [];
    this.duration = video && isFinite(video.duration) ? video.duration : (map ? map.duration : 0);
    this.next = 0;
    this.phaseIdx = -1;
    this.mult = 1;
    this.muteUntil = -1;
    this.paused = false;
    this.ended = false;
    this.flash = 0;
    this.showHighway = !opts.record;
    this.taps = [];
    this.stats = { beats: 0, edges: 0, maxBpm: 0, start: performance.now() };
    this.clock = { base: 0, startedAt: 0 };

    this.canvas = document.getElementById('highway');
    this.ctx = this.canvas.getContext('2d');
    this.pulseBg = document.getElementById('pulse-bg');
    this.audio = null;
    if (opts.click) {
      try { this.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();

    if (video) {
      this.onSeek = () => { this.next = this.indexAt(this.now()); this.phaseIdx = -1; };
      this.onEndedVid = () => this.finish();
      video.addEventListener('seeked', this.onSeek);
      video.addEventListener('ended', this.onEndedVid);
    }
  }

  // ---------- Horloge ----------
  now() {
    if (this.video) return this.video.currentTime;
    if (this.paused) return this.clock.base;
    return this.clock.base + (performance.now() - this.clock.startedAt) / 1000;
  }

  start() {
    this.clock.startedAt = performance.now();
    if (this.video) {
      this.video.currentTime = 0;
      const p = this.video.play();
      if (p && p.catch) p.catch(() => {});
    }
  }

  setPaused(v) {
    if (v === this.paused || this.ended) return;
    if (v) {
      this.clock.base = this.now();
      this.paused = true;
      if (this.video) this.video.pause();
      Pad.stop();
    } else {
      this.paused = false;
      this.clock.startedAt = performance.now();
      if (this.video) this.video.play().catch(() => {});
    }
  }

  indexAt(t) {
    let lo = 0, hi = this.beats.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.beats[m].t < t) lo = m + 1; else hi = m; }
    return lo;
  }

  // ---------- Contrôles live ----------
  adjust(delta) {
    this.mult = Math.max(0.2, Math.min(1.6, +(this.mult + delta).toFixed(2)));
    this.ui.onPower(this.mult);
    Pad.rumble(80, this.opts.power * this.mult * 0.6, this.opts.power * this.mult * 0.6);
  }

  edge() {
    if (this.opts.record) return;
    const t = this.now();
    this.muteUntil = t + 15;
    this.stats.edges++;
    Pad.stop();
    this.ui.onMessage('Au bord ?! STOP ✋<small>Mains en l\'air, respire… on reprend dans 15 s</small>', 4000);
  }

  tap(strength) {
    if (!this.opts.record) return;
    this.taps.push({ t: this.now(), s: strength });
    this.fire({ s: strength }, 0.5);
  }

  // ---------- Boucle ----------
  update() {
    if (this.ended) return;
    const t = this.now();

    if (!this.paused) {
      // Phases (messages)
      let pi = this.phaseIdx;
      while (pi + 1 < this.phases.length && this.phases[pi + 1].t <= t) pi++;
      if (pi !== this.phaseIdx) {
        this.phaseIdx = pi;
        const ph = this.phases[pi];
        if (ph) {
          this.ui.onPhase(ph.label || '');
          const msg = (ph.mk && Beatmap.say(ph.mk, this.opts.level)) || ph.msg;
          if (msg && (this.opts.talk > 0 || ph.kind === 'end' || ph.kind === 'pause')) {
            this.ui.onMessage(msg, ph.kind === 'end' ? 6000 : 3500);
          }
          this.nextTalk = t + this.talkGap();
          if (ph.kind === 'end') { this.endAt = t + 7; this.stats.finished = msg; }
        }
      }

      // Messages coquins réguliers pendant qu'on se touche
      if (this.opts.talk > 0 && !this.opts.record && t >= (this.nextTalk || 0) && t >= this.muteUntil) {
        const ph = this.phases[this.phaseIdx];
        const bpm = this.currentBpm(t);
        let kind = null;
        if (ph && ph.kind === 'pause' && ph.end - t > 4) kind = 'pause';
        else if (bpm) kind = ph && (ph.mk === 'edge' || ph.mk === 'tease') && Math.random() < 0.5 ? ph.mk : Beatmap.kindForBpm(bpm);
        if (kind && (!ph || ph.kind !== 'end')) this.ui.onMessage(Beatmap.say(kind, this.opts.level), 3200);
        this.nextTalk = t + this.talkGap();
      }

      // Beats
      while (this.next < this.beats.length && this.beats[this.next].t <= t) {
        const b = this.beats[this.next];
        if (t - b.t < 0.25 && t >= this.muteUntil) {
          const nb = this.beats[this.next + 1];
          this.fire(b, nb ? nb.t - b.t : 1);
        }
        this.next++;
      }

      if (this.muteUntil > 0 && t >= this.muteUntil) {
        this.muteUntil = -1;
        this.ui.onMessage('Reprends… doucement 😏', 2000);
      }

      if (!this.video && !this.opts.record) {
        const endT = this.endAt || this.duration;
        if (t >= endT) this.finish();
      } else if (this.endAt && t >= this.endAt && !this.opts.record) {
        this.finish();
      }
    }

    this.render(t);
    this.updateHud(t);
  }

  talkGap() {
    const base = [0, 22, 12, 6][this.opts.talk] || 12;
    return base * (0.7 + Math.random() * 0.6);
  }

  fire(b, gap) {
    const o = this.opts;
    let dur = b.d || o.pulse;
    if (!b.d) dur = Math.max(30, Math.min(dur, gap * 1000 * 0.7));
    const mag = Math.min(1, o.power * this.mult * (b.s ?? 0.8));
    // mix : 0 = moteur lourd uniquement, 1 = moteur léger uniquement
    const strong = mag * Math.min(1, 2 * (1 - o.mix));
    const weak = mag * Math.min(1, 2 * o.mix);
    Pad.rumble(dur, strong, weak);
    this.flash = Math.max(0.35, b.s ?? 0.8);
    this.stats.beats++;
    if (this.audio) this.click(b.s ?? 0.8);
  }

  click(s) {
    const a = this.audio, t = a.currentTime;
    const osc = a.createOscillator(), g = a.createGain();
    osc.frequency.value = 900 + 500 * s;
    g.gain.setValueAtTime(0.25 * s, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(g).connect(a.destination);
    osc.start(t); osc.stop(t + 0.06);
  }

  currentBpm(t) {
    const i = Math.min(Math.max(this.indexAt(t), 1), this.beats.length - 1);
    if (i < 1) return 0;
    const a = this.beats[i - 1], b = this.beats[i];
    if (!a || !b) return 0;
    const d = b.t - a.t;
    if (d <= 0 || d > 3 || t - a.t > 3) return 0;
    return 60 / d;
  }

  updateHud(t) {
    const bpm = Math.round(this.currentBpm(t));
    if (bpm > this.stats.maxBpm && bpm < 600) this.stats.maxBpm = bpm;
    this.ui.onHud({
      bpm: this.opts.record ? `${this.taps.length} taps` : (bpm ? `${bpm} BPM` : '— BPM'),
      time: fmtTime(t) + (this.duration ? ' / ' + fmtTime(this.duration) : ''),
    });
  }

  // ---------- Rendu ----------
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, r.width * dpr);
    this.canvas.height = Math.max(1, r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width; this.h = r.height;
  }

  render(t) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    this.flash *= 0.88;
    this.pulseBg.style.opacity = (this.flash * 0.9).toFixed(3);
    if (!this.showHighway) return;

    const look = 2.6;
    const tx = Math.max(60, w * 0.12);
    const pps = (w - tx) / look;
    const cy = h * 0.55;

    // Fond de piste
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, 'rgba(20,0,20,.65)'); g.addColorStop(1, 'rgba(0,0,0,.85)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,61,154,.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();

    // Zones de pause
    for (const ph of this.phases) {
      if (ph.kind !== 'pause' || ph.end === undefined) continue;
      if (ph.end < t - 1 || ph.t > t + look) continue;
      const x0 = tx + (ph.t - t) * pps, x1 = tx + (ph.end - t) * pps;
      ctx.fillStyle = 'rgba(155,92,255,.18)';
      ctx.fillRect(x0, cy - 26, x1 - x0, 52);
      ctx.fillStyle = 'rgba(220,190,255,.8)';
      ctx.font = '700 13px system-ui';
      ctx.fillText('✋ STOP', Math.max(x0 + 6, tx + 30), cy - 32);
    }

    // Muet (bouton "au bord")
    if (this.muteUntil > t) {
      ctx.fillStyle = 'rgba(155,92,255,.25)';
      ctx.fillRect(tx, cy - 26, (this.muteUntil - t) * pps, 52);
    }

    // Cible
    const fr = 22 + this.flash * 10;
    ctx.beginPath(); ctx.arc(tx, cy, fr, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,134,194,${0.6 + this.flash * 0.4})`; ctx.lineWidth = 3; ctx.stroke();
    if (this.flash > 0.05) {
      ctx.fillStyle = `rgba(255,61,154,${this.flash * 0.6})`; ctx.fill();
    }

    // Beats
    const from = this.indexAt(t - 0.3);
    for (let i = from; i < this.beats.length; i++) {
      const b = this.beats[i];
      if (b.t > t + look) break;
      const x = tx + (b.t - t) * pps;
      const past = b.t < t;
      const r = 10 + 12 * (b.s ?? 0.8);
      const muted = b.t < this.muteUntil;
      ctx.globalAlpha = past ? Math.max(0, 1 - (t - b.t) / 0.3) : 1;
      drawHeart(ctx, x, cy, r, muted ? '#6b4a8a' : ((b.s ?? 0.8) > 0.85 ? '#ff3d9a' : '#ff86c2'));
      if (b.d) { // vibration longue
        ctx.fillStyle = 'rgba(255,61,154,.5)';
        ctx.fillRect(x, cy - 4, (b.d / 1000) * pps, 8);
      }
    }
    ctx.globalAlpha = 1;
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    Pad.stop();
    if (this.video) this.video.pause();
    this.destroy();
    this.stats.elapsed = (performance.now() - this.stats.start) / 1000;
    this.ui.onEnd(this.stats, this.opts.record ? this.taps : null);
  }

  destroy() {
    window.removeEventListener('resize', this.resize);
    if (this.video) {
      this.video.removeEventListener('seeked', this.onSeek);
      this.video.removeEventListener('ended', this.onEndedVid);
    }
    if (this.audio && this.audio.close) this.audio.close().catch(() => {});
  }
}

function drawHeart(ctx, x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(r / 16, r / 16);
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.bezierCurveTo(-16, -6, -8, -18, 0, -9);
  ctx.bezierCurveTo(8, -18, 16, -6, 0, 6);
  ctx.closePath();
  ctx.shadowColor = color; ctx.shadowBlur = 14;
  ctx.fillStyle = color; ctx.fill();
  ctx.restore();
}

function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
