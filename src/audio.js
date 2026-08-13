// Procedural WebAudio: no sound assets, everything synthesized.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.musicGain = null;
    this.noiseBuf = null;
    this.lastGroan = 0;
    this.musicTimer = null;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);

    // Shared white noise buffer for percussive sounds.
    const len = this.ctx.sampleRate * 1.0;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startMusic();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }

  _noise(dur, { freq = 1200, q = 1, gain = 0.3, type = 'bandpass', attack = 0.002, sweep = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  _tone(dur, { freq = 440, type = 'sine', gain = 0.15, slide = 0, attack = 0.005, dest = null } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.now();
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  shoot(kind) {
    if (kind === 'ranger') {
      this._noise(0.08, { freq: 2400, q: 2, gain: 0.10, sweep: -1200 });
      this._tone(0.06, { freq: 900, type: 'triangle', gain: 0.05, slide: -500 });
    } else if (kind === 'sniper') {
      this._noise(0.25, { freq: 700, q: 0.8, gain: 0.30, sweep: -500 });
      this._tone(0.18, { freq: 160, type: 'square', gain: 0.10, slide: -110 });
    } else if (kind === 'tower') {
      this._noise(0.12, { freq: 500, q: 1.5, gain: 0.16, sweep: -300 });
      this._tone(0.1, { freq: 220, type: 'sawtooth', gain: 0.07, slide: -140 });
    } else {
      this._noise(0.12, { freq: 1500, q: 1.2, gain: 0.18, sweep: -900 });
      this._tone(0.08, { freq: 340, type: 'square', gain: 0.06, slide: -220 });
    }
  }

  melee() {
    this._noise(0.1, { freq: 900, q: 1.5, gain: 0.14, sweep: -500 });
    this._tone(0.07, { freq: 180, type: 'square', gain: 0.07, slide: -90 });
  }

  cast(key) {
    if (key === 'frag') {
      this._noise(0.35, { freq: 350, q: 0.8, gain: 0.3, type: 'lowpass', sweep: -220 });
      this._tone(0.25, { freq: 110, type: 'square', gain: 0.1, slide: -70 });
      return;
    }
    if (key === 'barrage') {
      // Sustained gunfire rattle.
      for (let i = 0; i < 10; i++) {
        setTimeout(() => this._noise(0.09, { freq: 1400, q: 1.4, gain: 0.14, sweep: -800 }), i * 70);
      }
      this._noise(0.8, { freq: 300, q: 0.7, gain: 0.2, type: 'lowpass', sweep: -150 });
      return;
    }
    if (key === 'quake' || key === 'storm') {
      this._noise(0.7, { freq: 220, q: 0.7, gain: 0.32, type: 'lowpass', sweep: -140 });
      this._tone(0.6, { freq: 70, type: 'sawtooth', gain: 0.14, slide: -40 });
    } else if (key === 'coil' || key === 'overcharge') {
      this._noise(0.25, { freq: 2600, q: 3, gain: 0.14, sweep: -1800 });
      this._tone(0.22, { freq: 1100, type: 'sawtooth', gain: 0.06, slide: -700 });
    } else if (key === 'repair') {
      for (let i = 0; i < 3; i++) setTimeout(() => this._tone(0.06, { freq: 600 + i * 150, type: 'triangle', gain: 0.08 }), i * 70);
    } else if (key === 'warcry') {
      this._tone(0.5, { freq: 190, type: 'sawtooth', gain: 0.12, slide: 70, attack: 0.03 });
      this._tone(0.5, { freq: 254, type: 'sawtooth', gain: 0.09, slide: 90, attack: 0.03 });
    } else {
      this._noise(0.3, { freq: 800, q: 1, gain: 0.2, sweep: -500 });
      this._tone(0.25, { freq: 300, type: 'square', gain: 0.08, slide: -150 });
    }
  }

  levelup() {
    const notes = [392, 523, 659, 784];
    notes.forEach((f, i) => setTimeout(() => this._tone(0.3, { freq: f, type: 'triangle', gain: 0.12 }), i * 90));
  }

  herodown() {
    this._tone(0.9, { freq: 200, type: 'sawtooth', gain: 0.13, slide: -140, attack: 0.02 });
    this._noise(0.6, { freq: 300, q: 0.8, gain: 0.18, type: 'lowpass', sweep: -180 });
  }

  revive() {
    [262, 392, 523].forEach((f, i) => setTimeout(() => this._tone(0.35, { freq: f, type: 'triangle', gain: 0.11 }), i * 110));
  }

  pickup(kind) {
    if (kind === 'gold') {
      this._tone(0.07, { freq: 900, type: 'triangle', gain: 0.1, slide: 250 });
      this._tone(0.1, { freq: 1350, type: 'triangle', gain: 0.08, slide: 200 });
    } else {
      this._tone(0.15, { freq: 520, type: 'sine', gain: 0.1, slide: 240 });
    }
  }

  zombieDeath() {
    this._noise(0.22, { freq: 300, q: 1.4, gain: 0.13, sweep: -180, type: 'lowpass' });
    this._tone(0.18, { freq: 130 + Math.random() * 60, type: 'sawtooth', gain: 0.05, slide: -80 });
  }

  groan() {
    const t = performance.now();
    if (t - this.lastGroan < 1400) return;
    this.lastGroan = t;
    const f = 70 + Math.random() * 50;
    this._tone(0.9, { freq: f, type: 'sawtooth', gain: 0.045, slide: -f * 0.4, attack: 0.25 });
    this._tone(0.9, { freq: f * 1.01, type: 'sawtooth', gain: 0.04, slide: -f * 0.35, attack: 0.3 });
  }

  build() {
    this._noise(0.15, { freq: 200, q: 1, gain: 0.22, type: 'lowpass' });
    this._tone(0.1, { freq: 520, type: 'triangle', gain: 0.08, slide: 300, attack: 0.001 });
  }

  demolish() { this._noise(0.4, { freq: 160, q: 0.8, gain: 0.25, type: 'lowpass', sweep: -80 }); }

  hitBuilding() { this._noise(0.09, { freq: 260, q: 1.4, gain: 0.08, type: 'lowpass' }); }

  click() { this._tone(0.05, { freq: 700, type: 'triangle', gain: 0.06, slide: 150 }); }
  deny() { this._tone(0.14, { freq: 220, type: 'square', gain: 0.06, slide: -80 }); }
  train() { this._tone(0.09, { freq: 520, type: 'triangle', gain: 0.09, slide: 260 }); this._tone(0.12, { freq: 780, type: 'triangle', gain: 0.07, slide: 200 }); }

  alarm() {
    for (let i = 0; i < 3; i++) {
      const t0 = i * 0.55;
      setTimeout(() => {
        this._tone(0.28, { freq: 660, type: 'square', gain: 0.10 });
        this._tone(0.28, { freq: 495, type: 'square', gain: 0.08 });
      }, t0 * 1000);
    }
  }

  infection() {
    this._tone(0.7, { freq: 300, type: 'sawtooth', gain: 0.1, slide: -220, attack: 0.02 });
    this._noise(0.5, { freq: 500, q: 1, gain: 0.14, sweep: -350 });
  }

  victory() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => this._tone(0.5, { freq: f, type: 'triangle', gain: 0.14 }), i * 160));
  }

  defeat() {
    const notes = [392, 330, 262, 196];
    notes.forEach((f, i) => setTimeout(() => this._tone(0.7, { freq: f, type: 'sawtooth', gain: 0.1 }), i * 260));
  }

  // Slow ambient minor-chord pad, cycling forever. Quiet, moody.
  startMusic() {
    if (this.musicTimer) return;
    const chords = [
      [110, 130.8, 164.8],   // Am
      [87.3, 110, 130.8],    // F
      [98, 123.5, 146.8],    // G
      [82.4, 110, 123.5],    // E-ish tension
    ];
    let i = 0;
    const playChord = () => {
      if (!this.ctx || this.muted) return;
      const chord = chords[i % chords.length];
      i++;
      for (const f of chord) {
        this._tone(7.5, { freq: f, type: 'triangle', gain: 0.05, attack: 2.5, dest: this.musicGain });
        this._tone(7.5, { freq: f * 2.003, type: 'sine', gain: 0.025, attack: 3.0, dest: this.musicGain });
      }
    };
    playChord();
    this.musicTimer = setInterval(playChord, 7000);
  }
}
