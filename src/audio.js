// Runtime audio: procedural WebAudio for core SFX, with generated MP3 barks
// layered in where they are wired.

const BARK_HERO = { alexander: 'alex', scott: 'scott', danny: 'danny' };

export class AudioSys {
  constructor() {
    this.barkIndex = null;
    this.lastBarkT = 0;
    this.barkEl = null;
    fetch('assets/audio/click-pack/index.json')
      .then((r) => r.json())
      .then((d) => { this.barkIndex = d; })
      .catch(() => {});
    this.ctx = null;
    this.muted = false;
    this.volMult = 1;
    this.musicMult = 1;
    this.master = null;
    this.musicGain = null;
    this.noiseBuf = null;
    this.lastGroan = 0;
    this.musicTimer = null;
  }

  // WC3-style hero click barks (pre-generated MP3s; silently no-ops if absent).
  bark(heroKey, category) {
    if (this.muted || !this.barkIndex) return;
    const now = performance.now();
    if (now - this.lastBarkT < 1400) return;
    const hero = this.barkIndex.heroes[BARK_HERO[heroKey]];
    if (!hero) return;
    const items = hero.categories[category];
    if (!items || !items.length) return;
    const pick = items[(Math.random() * items.length) | 0];
    this.lastBarkT = now;
    try {
      if (this.barkEl) this.barkEl.pause();
      this.barkEl = new Audio('assets/audio/click-pack/' + pick.file);
      this.barkEl.volume = 0.75;
      this.barkEl.play().catch(() => {});
    } catch { /* no-op */ }
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
    if (this.master) this.master.gain.value = m ? 0 : 0.55 * this.volMult;
  }

  // Settings-driven volume (0..1), persisted by the caller. Kept separate
  // from mute so the two compose: gain = 0.55 * volume, or 0 when muted.
  setVolume(v) {
    this.volMult = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.value = 0.55 * this.volMult;
  }

  setMusicVolume(v) {
    this.musicMult = Math.max(0, Math.min(1, v));
    if (this.musicGain) this.musicGain.gain.value = 0.16 * this.musicMult;
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

  countdown(value) {
    this.init();
    const launch = Number(value) <= 0;
    this._tone(launch ? 0.32 : 0.13, {
      freq: launch ? 880 : 440 + Math.max(0, 5 - Number(value || 5)) * 45,
      type: launch ? 'sawtooth' : 'square',
      gain: launch ? 0.16 : 0.1,
      slide: launch ? 440 : 0,
    });
  }

  shoot(kind) {
    if (kind === 'ranger') {
      this._noise(0.08, { freq: 2400, q: 2, gain: 0.10, sweep: -1200 });
      this._tone(0.06, { freq: 900, type: 'triangle', gain: 0.05, slide: -500 });
    } else if (kind === 'sniper') {
      this._noise(0.25, { freq: 700, q: 0.8, gain: 0.30, sweep: -500 });
      this._tone(0.18, { freq: 160, type: 'square', gain: 0.10, slide: -110 });
    } else if (kind === 'shotgun') {
      this._noise(0.3, { freq: 420, q: 0.7, gain: 0.34, sweep: -300 });
      this._tone(0.2, { freq: 110, type: 'square', gain: 0.12, slide: -70 });
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

  hook() {
    this._noise(0.15, { freq: 1800, q: 2, gain: 0.14, sweep: -1200 });
    this._tone(0.2, { freq: 500, type: 'square', gain: 0.08, slide: -320 });
  }

  backstab() {
    this._noise(0.12, { freq: 3000, q: 2, gain: 0.16, sweep: -2000 });
    this._tone(0.15, { freq: 700, type: 'sawtooth', gain: 0.08, slide: -450 });
  }

  stealthOn() {
    this._noise(0.4, { freq: 900, q: 0.8, gain: 0.08, type: 'lowpass', sweep: -600 });
  }

  night() {
    // A distant, mournful howl.
    this._tone(1.4, { freq: 320, type: 'sine', gain: 0.06, slide: 90, attack: 0.5 });
    this._tone(1.6, { freq: 240, type: 'sine', gain: 0.05, slide: -60, attack: 0.7 });
  }

  bossHorn() {
    this._tone(1.2, { freq: 65, type: 'sawtooth', gain: 0.18, slide: -15, attack: 0.05 });
    this._tone(1.2, { freq: 98, type: 'sawtooth', gain: 0.12, slide: -20, attack: 0.08 });
    this._noise(1.0, { freq: 180, q: 0.7, gain: 0.2, type: 'lowpass', sweep: -80 });
  }

  roar() {
    this._noise(0.8, { freq: 2400, q: 1.2, gain: 0.22, sweep: -1800 });
    this._tone(0.7, { freq: 900, type: 'sawtooth', gain: 0.1, slide: -650, attack: 0.02 });
  }

  underattack() {
    this._tone(0.16, { freq: 520, type: 'square', gain: 0.09 });
    setTimeout(() => this._tone(0.16, { freq: 440, type: 'square', gain: 0.09 }), 180);
  }

  cast(key) {
    switch (key) {
      case 'hook':
      case 'assassinate':
        return; // handled by their own hit/shot sounds
      case 'shrapnel':
        this._noise(0.35, { freq: 350, q: 0.8, gain: 0.3, type: 'lowpass', sweep: -220 });
        this._tone(0.25, { freq: 110, type: 'square', gain: 0.1, slide: -70 });
        return;
      case 'sunstrike':
        this._noise(0.8, { freq: 220, q: 0.7, gain: 0.32, type: 'lowpass', sweep: -140 });
        this._tone(0.7, { freq: 70, type: 'sawtooth', gain: 0.14, slide: -40 });
        this._tone(0.5, { freq: 1200, type: 'sine', gain: 0.08, slide: -900, attack: 0.01 });
        return;
      case 'holy':
      case 'deathpulse':
        for (let i = 0; i < 3; i++) {
          setTimeout(() => this._tone(0.12, { freq: (key === 'holy' ? 620 : 380) + i * 140, type: 'triangle', gain: 0.09 }), i * 70);
        }
        return;
      case 'timelapse':
        this._tone(0.5, { freq: 1400, type: 'sine', gain: 0.1, slide: -1100 });
        this._tone(0.35, { freq: 250, type: 'triangle', gain: 0.09, slide: 700, attack: 0.02 });
        return;
      case 'smoke':
        this._noise(0.6, { freq: 600, q: 0.6, gain: 0.18, type: 'lowpass', sweep: -350 });
        return;
      case 'roots':
        this._noise(0.3, { freq: 280, q: 1.2, gain: 0.22, type: 'lowpass', sweep: 160 });
        this._tone(0.25, { freq: 90, type: 'sawtooth', gain: 0.08, slide: 60 });
        return;
      case 'teleport':
        this._tone(0.6, { freq: 400, type: 'sine', gain: 0.1, slide: 900, attack: 0.05 });
        this._tone(0.5, { freq: 800, type: 'triangle', gain: 0.06, slide: 700, attack: 0.1 });
        return;
      case 'swarm':
        this._noise(0.7, { freq: 1800, q: 4, gain: 0.1, sweep: -600 });
        return;
      case 'whirlwind':
        this._noise(0.7, { freq: 900, q: 0.8, gain: 0.2, sweep: -400 });
        return;
      case 'warcry':
        this._tone(0.5, { freq: 190, type: 'sawtooth', gain: 0.12, slide: 70, attack: 0.03 });
        this._tone(0.5, { freq: 254, type: 'sawtooth', gain: 0.09, slide: 90, attack: 0.03 });
        return;
      default:
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

  // Rising coin dings — pitch climbs with each rapid pickup, Thronefall-style.
  coin() {
    const t = performance.now();
    if (t - (this._coinT || 0) > 900) this._coinN = 0;
    this._coinT = t;
    const n = Math.min(this._coinN++, 12);
    const f = 780 * Math.pow(1.059, n);
    this._tone(0.09, { freq: f, type: 'triangle', gain: 0.09, slide: 120 });
    this._tone(0.12, { freq: f * 1.5, type: 'sine', gain: 0.05, slide: 90 });
  }

  payTick() {
    const t = performance.now();
    if (t - (this._payT || 0) < 90) return;
    this._payT = t;
    this._tone(0.05, { freq: 1200 + Math.random() * 300, type: 'triangle', gain: 0.045, slide: -200 });
  }

  bell() {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        this._tone(1.4, { freq: 340, type: 'triangle', gain: 0.16, attack: 0.005 });
        this._tone(1.4, { freq: 508, type: 'sine', gain: 0.08, attack: 0.005 });
        this._tone(1.0, { freq: 226, type: 'sine', gain: 0.07, attack: 0.005 });
      }, i * 900);
    }
  }

  dawn() {
    [392, 494, 587, 784].forEach((f, i) => setTimeout(() => this._tone(0.45, { freq: f, type: 'triangle', gain: 0.09 }), i * 130));
  }

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
