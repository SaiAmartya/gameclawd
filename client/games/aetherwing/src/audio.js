// Procedural sound — no audio files, everything synthesized with WebAudio.
export class SFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.4, this.ctx.currentTime, 0.04);
    }
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.4;
      this.master.connect(this.ctx.destination);

      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  blip(freq, t0, dur, type = 'triangle', peak = 0.3, slideTo = null) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noiseHit(t0, dur, freq, q, peak) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t0 + dur);
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  flap() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    this.noiseHit(t, 0.13, 700, 1.2, 0.35); // wing whoosh
    this.blip(240, t, 0.1, 'sine', 0.12, 180);
  }

  score(n) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    // little pentatonic climb that rises with your streak
    const base = 660 * Math.pow(2, (n % 5) * 2 / 12);
    this.blip(base, t, 0.12, 'triangle', 0.25);
    this.blip(base * 1.5, t + 0.08, 0.18, 'triangle', 0.22);
  }

  crash() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    this.noiseHit(t, 0.4, 900, 0.8, 0.55);
    this.blip(220, t, 0.45, 'sawtooth', 0.3, 45);
  }

  start() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    [523, 659, 784].forEach((f, i) => this.blip(f, t + i * 0.07, 0.14, 'triangle', 0.18));
  }
}

// Generative ambient soundtrack — detuned pads, pentatonic plucks and a
// soft bass over Am7 → Fmaj7 → Cmaj7 → G, in key with the score chimes.
// Like everything else here: no audio files, synthesized live.
const BAR = 3.4; // seconds per chord (~70 bpm, 4 beats)
const CHORDS = [
  { bass: 110.00, pad: [220.00, 261.63, 329.63, 392.00], arp: [440.00, 523.25, 659.25, 783.99] }, // Am7
  { bass:  87.31, pad: [174.61, 220.00, 261.63, 349.23], arp: [349.23, 440.00, 523.25, 698.46] }, // Fmaj7
  { bass: 130.81, pad: [261.63, 329.63, 392.00, 493.88], arp: [523.25, 659.25, 783.99, 987.77] }, // Cmaj7
  { bass:  98.00, pad: [196.00, 246.94, 293.66, 392.00], arp: [392.00, 493.88, 587.33, 783.99] }, // G
];
const ARP_STEPS = [0, 2, 1, 3, 2, 0, 3, 1];

const MOODS = {
  menu:    { bus: 0.50, arp: 0.14, bass: 0.30, cut: 1700, lag: 1.2 },
  playing: { bus: 0.62, arp: 0.50, bass: 0.62, cut: 3400, lag: 0.9 },
  dead:    { bus: 0.16, arp: 0.00, bass: 0.10, cut: 600,  lag: 0.22 },
};

export class Music {
  constructor(sfx) {
    this.sfx = sfx;
    this.running = false;
    this.mood = 'menu';
    this.bar = 0;
  }

  start() {
    if (this.running || !this.sfx.ensure()) return;
    const ctx = (this.ctx = this.sfx.ctx);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1700;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.0001;
    this.bus.connect(this.filter).connect(this.sfx.master);

    this.pads = this.lane(0.9);
    this.arps = this.lane(0.14);
    this.basses = this.lane(0.3);

    this.nextBar = ctx.currentTime + 0.15;
    this.running = true;
    this.setMood(this.mood, true);
    this.timer = setInterval(() => this.schedule(), 200);
    this.schedule();
  }

  lane(gain) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    g.connect(this.bus);
    return g;
  }

  setMood(mood, force = false) {
    if (mood === this.mood && !force) return;
    this.mood = mood;
    if (!this.running) return;
    const m = MOODS[mood];
    const t = this.ctx.currentTime;
    this.bus.gain.setTargetAtTime(m.bus, t, m.lag);
    this.arps.gain.setTargetAtTime(m.arp, t, m.lag);
    this.basses.gain.setTargetAtTime(m.bass, t, m.lag);
    this.filter.frequency.setTargetAtTime(m.cut, t, m.lag);
  }

  // lookahead scheduler — wide enough to survive background-tab throttling
  schedule() {
    while (this.nextBar < this.ctx.currentTime + 1.4) {
      this.scheduleBar(this.nextBar, CHORDS[this.bar % CHORDS.length]);
      this.nextBar += BAR;
      this.bar++;
    }
  }

  scheduleBar(t0, chord) {
    chord.pad.forEach((f) => this.pad(f, t0));
    this.bass(chord.bass, t0);
    const step = BAR / 8;
    for (let i = 0; i < 8; i++) {
      if (this.mood !== 'playing' && i % 2 === 1) continue; // sparser on the menu
      const f = chord.arp[ARP_STEPS[(i + this.bar) % ARP_STEPS.length]];
      this.pluck(f, t0 + i * step + (i % 2) * 0.02);
    }
  }

  pad(freq, t0) {
    const dur = BAR + 1.6; // bars crossfade into each other
    for (const cents of [-6, 5]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq * Math.pow(2, cents / 1200);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 1.4);
      g.gain.setValueAtTime(0.05, t0 + dur - 1.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this.pads);
      o.start(t0);
      o.stop(t0 + dur + 0.1);
    }
  }

  pluck(freq, t0) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
    o.connect(g).connect(this.arps);
    o.start(t0);
    o.stop(t0 + 0.65);
  }

  bass(freq, t0) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.4);
    g.gain.setValueAtTime(0.5, t0 + BAR - 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + BAR + 0.2);
    o.connect(g).connect(this.basses);
    o.start(t0);
    o.stop(t0 + BAR + 0.3);
  }
}
