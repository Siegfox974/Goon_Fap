/* Détection de beats en temps réel (AudioWorklet) : flux d'énergie + seuil adaptatif. */
class GFOnset extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sens = 1.6; this.band = 'high'; this.minGap = 160;
    this.frame = 256;              // ~5,8 ms à 44,1 kHz
    this.acc = 0; this.n = 0; this.lp = 0; this.prevE = 0;
    this.mean = 0; this.var = 0; this.warm = 0; this.since = 1e9;
    this.levelEvery = Math.round(0.05 * sampleRate / this.frame); this.levelN = 0; this.levelMax = 0;
    this.kLow = 1 - Math.exp(-2 * Math.PI * 150 / sampleRate);
    this.kHigh = 1 - Math.exp(-2 * Math.PI * 2000 / sampleRate);
    this.port.onmessage = e => {
      const d = e.data || {};
      if (d.sens != null) this.sens = +d.sens;
      if (d.band) { this.band = d.band; this.lp = 0; }
      if (d.minGap != null) this.minGap = +d.minGap;
    };
  }

  process(inputs) {
    const inp = inputs[0];
    if (!inp || !inp.length || !inp[0]) return true;
    const L = inp[0].length, nc = inp.length;
    for (let i = 0; i < L; i++) {
      let x = 0;
      for (let c = 0; c < nc; c++) x += inp[c][i];
      x /= nc;
      let y = x;
      if (this.band === 'low') { this.lp += this.kLow * (x - this.lp); y = this.lp; }
      else if (this.band === 'high') { this.lp += this.kHigh * (x - this.lp); y = x - this.lp; }
      this.acc += y * y;
      if (++this.n === this.frame) { this.frameDone(); this.acc = 0; this.n = 0; }
    }
    return true;
  }

  frameDone() {
    const fs = this.frame / sampleRate;
    const e = Math.log1p(Math.sqrt(this.acc / this.frame) * 100);
    const flux = Math.max(0, e - this.prevE);
    this.prevE = e;
    this.since += fs * 1000;
    const sd = Math.sqrt(Math.max(0, this.var));
    const thr = this.mean + this.sens * sd + 0.02;
    if (this.warm > 40 && flux > thr && this.since >= this.minGap) {
      this.since = 0;
      const s = Math.max(0.3, Math.min(1, 0.45 + 0.55 * (flux - thr) / (thr + 1e-6)));
      this.port.postMessage({ type: 'onset', s, at: currentTime });
    }
    // statistiques glissantes (~1 s)
    const a = Math.min(1, fs / 1.0);
    const d = flux - this.mean;
    this.mean += a * d;
    this.var = (1 - a) * (this.var + a * d * d);
    this.warm++;
    if (e > this.levelMax) this.levelMax = e;
    if (++this.levelN >= this.levelEvery) {
      this.port.postMessage({ type: 'level', level: this.levelMax });
      this.levelN = 0; this.levelMax = 0;
    }
  }
}
registerProcessor('gf-onset', GFOnset);
