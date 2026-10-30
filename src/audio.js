// Runtime audio. CC0 samples play through Soundscape (buses, pool, music
// crossfades). The procedural voices stay as the fallback when a sample is
// missing, and hero barks stay on the pre-recorded click pack.

import { Soundscape } from './soundscape.js';
import {
  shotCue, proceduralShotKind, abilityCue, selectMusic, nextCombat, biomeAmbient, clamp01,
} from './audio-score.js';

const BARK_HERO = { alexander: 'alex', scott: 'scott', danny: 'danny' };

export class AudioSys {
  constructor() {
    this.barkIndex = null;
    this.lastBarkT = 0;
    this.barkEl = null;
    this.scape = new Soundscape();
    this.scape.onReady = (ok) => this._onSamples(ok);
    fetch('assets/audio/click-pack/index.json')
      .then((r) => r.json())
      .then((d) => { this.barkIndex = d; })
      .catch(() => {});
    this.ctx = null;
    this.muted = false;
    this.volMult = 1;
    this.musicMult = 1;
    this.sfxMult = 1;
    this.ambientMult = 0.85;
    this.uiMult = 0.9;
    this.master = null;
    this.sfxBus = null;
    this.musicGain = null;
    this.noiseBuf = null;
    this.lastGroan = 0;
    this.musicTimer = null;
    this._samplesReady = false;
    this._wantMusic = false;
    this._sceneMusic = 'menu';
    this._combat = false;
    this._combatUntil = 0;
    this._pendingAmbient = null;
  }

  get ready() { return this.scape.readyPromise; }

  _onSamples(ok) {
    this._samplesReady = !!ok && this.scape.hasMusic();
    if (!this._wantMusic) return;
    if (this._samplesReady) {
      this._stopPad();
      this.scape.setMusic(this._sceneMusic || 'menu');
      if (this._pendingAmbient) this.scape.setAmbient(this._pendingAmbient);
    } else {
      this._startPad();
    }
  }

  _sample(id, opts) {
    return this.scape.play(id, opts);
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
      this.barkEl.volume = this.muted ? 0 : 0.75 * this.volMult;
      this.barkEl.play().catch(() => {});
    } catch { /* no-op */ }
  }

  init() {
    if (!this.scape.init()) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    this.ctx = this.scape.ctx;
    this.master = this.scape.buses.master;
    this.sfxBus = this.scape.buses.sfx;
    this.musicGain = this.scape.buses.music;
    this.scape.setMuted(this.muted);
    this.scape.setBus('master', this.volMult);
    this.scape.setBus('music', this.musicMult);
    this.scape.setBus('sfx', this.sfxMult);
    this.scape.setBus('ambient', this.ambientMult);
    this.scape.setBus('ui', this.uiMult);

    const len = this.ctx.sampleRate * 1.0;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startMusic();
  }

  setMuted(m) {
    this.muted = !!m;
    this.scape.setMuted(this.muted);
    if (this.barkEl) this.barkEl.volume = this.muted ? 0 : 0.75 * this.volMult;
  }

  setVolume(v) {
    this.volMult = clamp01(v, 1);
    this.scape.setBus('master', this.volMult);
    if (this.barkEl && !this.muted) this.barkEl.volume = 0.75 * this.volMult;
  }

  setMusicVolume(v) {
    this.musicMult = clamp01(v, 1);
    this.scape.setBus('music', this.musicMult);
  }

  setSfxVolume(v) {
    this.sfxMult = clamp01(v, 1);
    this.scape.setBus('sfx', this.sfxMult);
  }

  setAmbientVolume(v) {
    this.ambientMult = clamp01(v, 0.85);
    this.scape.setBus('ambient', this.ambientMult);
  }

  setUiVolume(v) {
    this.uiMult = clamp01(v, 0.9);
    this.scape.setBus('ui', this.uiMult);
  }

  setLogTime(t) { this.scape.setLogTime(t); }

  _nowSec() {
    return this.scape.recording ? (this.scape.logTime || 0) : performance.now() / 1000;
  }

  forceCombat(seconds) {
    const hold = Math.max(0, seconds);
    if (this.scape.recording) this._combatUntilLog = (this.scape.logTime || 0) + hold;
    else this._combatUntil = performance.now() + hold * 1000;
  }

  // Presentation read of the match. Does not write simulation state.
  setScene(scene = {}) {
    const forced = this.scape.recording
      ? (this._combatUntilLog || 0) > (this.scape.logTime || 0)
      : (this._combatUntil && performance.now() < this._combatUntil);
    const aggro = forced ? Math.max(scene.aggro || 0, 99) : (scene.aggro || 0);
    this._combat = nextCombat(this._combat, aggro);
    const music = selectMusic({ ...scene, combat: this._combat });
    this._sceneMusic = music;
    if (scene.listener) this.scape.setListener(scene.listener.x, scene.listener.z);
    this._pendingAmbient = scene.inMatch ? biomeAmbient(scene.biome) : null;
    if (!this._samplesReady) return;
    this._stopPad();
    this.scape.setMusic(music);
    this.scape.setAmbient(this._pendingAmbient);
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }

  _sfxOpen() { return this.ctx && !this.muted && this.sfxMult > 0; }

  _noise(dur, { freq = 1200, q = 1, gain = 0.3, type = 'bandpass', attack = 0.002, sweep = 0 } = {}) {
    if (!this._sfxOpen()) return;
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
    src.connect(f).connect(g).connect(this.sfxBus || this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  _tone(dur, { freq = 440, type = 'sine', gain = 0.15, slide = 0, attack = 0.005, dest = null } = {}) {
    if (!this.ctx || this.muted) return;
    const music = dest && dest === this.musicGain;
    if (!music && this.sfxMult <= 0) return;
    const t = this.now();
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.sfxBus || this.master);
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

  shoot(kind, x, z) {
    if (this._sample(shotCue(kind), { x, z })) return;
    const procedural = proceduralShotKind(kind);
    if (procedural === 'ranger') {
      this._noise(0.08, { freq: 2400, q: 2, gain: 0.10, sweep: -1200 });
      this._tone(0.06, { freq: 900, type: 'triangle', gain: 0.05, slide: -500 });
    } else if (procedural === 'sniper') {
      this._noise(0.25, { freq: 700, q: 0.8, gain: 0.30, sweep: -500 });
      this._tone(0.18, { freq: 160, type: 'square', gain: 0.10, slide: -110 });
    } else if (procedural === 'shotgun') {
      this._noise(0.3, { freq: 420, q: 0.7, gain: 0.34, sweep: -300 });
      this._tone(0.2, { freq: 110, type: 'square', gain: 0.12, slide: -70 });
    } else if (procedural === 'tower') {
      this._noise(0.12, { freq: 500, q: 1.5, gain: 0.16, sweep: -300 });
      this._tone(0.1, { freq: 220, type: 'sawtooth', gain: 0.07, slide: -140 });
    } else {
      this._noise(0.12, { freq: 1500, q: 1.2, gain: 0.18, sweep: -900 });
      this._tone(0.08, { freq: 340, type: 'square', gain: 0.06, slide: -220 });
    }
  }

  impact(kind, x, z) {
    const cue = kind === 'flame' ? 'impact.flame' : 'impact.hit';
    const delay = kind === 'melee' ? 0.04 : 0.12;
    this._sample(cue, { x, z, delay });
  }

  melee(x, z) {
    if (this._sample('attack.melee', { x, z })) return;
    this._noise(0.1, { freq: 900, q: 1.5, gain: 0.14, sweep: -500 });
    this._tone(0.07, { freq: 180, type: 'square', gain: 0.07, slide: -90 });
  }

  footstep(x, z) { this._sample('hero.step', { x, z }); }

  hover() { this._sample('ui.hover'); }

  hook() {
    if (this._sample('ability.hook')) return;
    this._noise(0.15, { freq: 1800, q: 2, gain: 0.14, sweep: -1200 });
    this._tone(0.2, { freq: 500, type: 'square', gain: 0.08, slide: -320 });
  }

  backstab() {
    if (this._sample('attack.melee')) return;
    this._noise(0.12, { freq: 3000, q: 2, gain: 0.16, sweep: -2000 });
    this._tone(0.15, { freq: 700, type: 'sawtooth', gain: 0.08, slide: -450 });
  }

  stealthOn() {
    if (this._sample('ability.magic')) return;
    this._noise(0.4, { freq: 900, q: 0.8, gain: 0.08, type: 'lowpass', sweep: -600 });
  }

  night() {
    this._tone(1.4, { freq: 320, type: 'sine', gain: 0.06, slide: 90, attack: 0.5 });
    this._tone(1.6, { freq: 240, type: 'sine', gain: 0.05, slide: -60, attack: 0.7 });
  }

  bossHorn() {
    if (this._sample('wave.horn')) return;
    this._tone(1.2, { freq: 65, type: 'sawtooth', gain: 0.18, slide: -15, attack: 0.05 });
    this._tone(1.2, { freq: 98, type: 'sawtooth', gain: 0.12, slide: -20, attack: 0.08 });
    this._noise(1.0, { freq: 180, q: 0.7, gain: 0.2, type: 'lowpass', sweep: -80 });
  }

  roar() {
    if (this._sample('zombie.groan')) return;
    this._noise(0.8, { freq: 2400, q: 1.2, gain: 0.22, sweep: -1800 });
    this._tone(0.7, { freq: 900, type: 'sawtooth', gain: 0.1, slide: -650, attack: 0.02 });
  }

  underattack() {
    if (this._sample('wave.horn', { gain: 0.7 })) return;
    this._tone(0.16, { freq: 520, type: 'square', gain: 0.09 });
    setTimeout(() => this._tone(0.16, { freq: 440, type: 'square', gain: 0.09 }), 180);
  }

  cast(key, x, z) {
    if (this._sample(abilityCue(key), { x, z })) return;
    switch (key) {
      case 'hook':
      case 'assassinate':
        return;
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
    if (this._sample('build.upgrade')) return;
    const notes = [392, 523, 659, 784];
    notes.forEach((f, i) => setTimeout(() => this._tone(0.3, { freq: f, type: 'triangle', gain: 0.12 }), i * 90));
  }

  herodown() {
    if (this._sample('zombie.death', { rate: 0.8 })) return;
    this._tone(0.9, { freq: 200, type: 'sawtooth', gain: 0.13, slide: -140, attack: 0.02 });
    this._noise(0.6, { freq: 300, q: 0.8, gain: 0.18, type: 'lowpass', sweep: -180 });
  }

  revive() {
    if (this._sample('build.upgrade', { rate: 1.15 })) return;
    [262, 392, 523].forEach((f, i) => setTimeout(() => this._tone(0.35, { freq: f, type: 'triangle', gain: 0.11 }), i * 110));
  }

  pickup(kind) {
    if (kind === 'gold') {
      if (this._sample('coin')) return;
      this._tone(0.07, { freq: 900, type: 'triangle', gain: 0.1, slide: 250 });
      this._tone(0.1, { freq: 1350, type: 'triangle', gain: 0.08, slide: 200 });
    } else {
      this._tone(0.15, { freq: 520, type: 'sine', gain: 0.1, slide: 240 });
    }
  }

  zombieDeath(x, z) {
    if (this._sample('zombie.death', { x, z })) return;
    this._noise(0.22, { freq: 300, q: 1.4, gain: 0.13, sweep: -180, type: 'lowpass' });
    this._tone(0.18, { freq: 130 + Math.random() * 60, type: 'sawtooth', gain: 0.05, slide: -80 });
  }

  zombieAttack(x, z) { this._sample('zombie.attack', { x, z }); }

  groan(x, z) {
    const t = this._nowSec();
    if (t - (this._groanSec || 0) < 1.4) return;
    this._groanSec = t;
    if (this._sample('zombie.groan', { x, z })) return;
    const f = 70 + Math.random() * 50;
    this._tone(0.9, { freq: f, type: 'sawtooth', gain: 0.045, slide: -f * 0.4, attack: 0.25 });
    this._tone(0.9, { freq: f * 1.01, type: 'sawtooth', gain: 0.04, slide: -f * 0.35, attack: 0.3 });
  }

  build(x, z) {
    if (this._sample('build.place', { x, z })) return;
    this._noise(0.15, { freq: 200, q: 1, gain: 0.22, type: 'lowpass' });
    this._tone(0.1, { freq: 520, type: 'triangle', gain: 0.08, slide: 300, attack: 0.001 });
  }

  upgrade(x, z) {
    if (this._sample('build.upgrade', { x, z })) return;
    this._tone(0.12, { freq: 520, type: 'triangle', gain: 0.1, slide: 280 });
    this._tone(0.16, { freq: 780, type: 'triangle', gain: 0.08, slide: 220 });
  }

  demolish(x, z) {
    if (this._sample('build.demolish', { x, z })) return;
    this._noise(0.4, { freq: 160, q: 0.8, gain: 0.25, type: 'lowpass', sweep: -80 });
  }

  hitBuilding(x, z) {
    if (this._sample('keep.hit', { x, z })) return;
    this._noise(0.09, { freq: 260, q: 1.4, gain: 0.08, type: 'lowpass' });
  }

  coin(x, z) {
    const t = this._nowSec();
    if (t - (this._coinT || 0) > 0.9) this._coinN = 0;
    this._coinT = t;
    const n = Math.min(this._coinN++, 12);
    const rate = Math.pow(1.059, n);
    if (this._sample('coin', { x, z, rate })) return;
    const f = 780 * rate;
    this._tone(0.09, { freq: f, type: 'triangle', gain: 0.09, slide: 120 });
    this._tone(0.12, { freq: f * 1.5, type: 'sine', gain: 0.05, slide: 90 });
  }

  payTick() {
    const t = this._nowSec();
    if (t - (this._payT || 0) < 0.09) return;
    this._payT = t;
    if (this._sample('coin', { rate: 1.2, gain: 0.55 })) return;
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

  click() { if (this._sample('ui.click')) return; this._tone(0.05, { freq: 700, type: 'triangle', gain: 0.06, slide: 150 }); }
  deny() { if (this._sample('ui.deny')) return; this._tone(0.14, { freq: 220, type: 'square', gain: 0.06, slide: -80 }); }
  train() {
    if (this._sample('build.place', { gain: 0.7, rate: 1.2 })) return;
    this._tone(0.09, { freq: 520, type: 'triangle', gain: 0.09, slide: 260 });
    this._tone(0.12, { freq: 780, type: 'triangle', gain: 0.07, slide: 200 });
  }

  alarm() {
    this.forceCombat(8);
    if (this._sample('wave.horn')) return;
    for (let i = 0; i < 3; i++) {
      const t0 = i * 0.55;
      setTimeout(() => {
        this._tone(0.28, { freq: 660, type: 'square', gain: 0.10 });
        this._tone(0.28, { freq: 495, type: 'square', gain: 0.08 });
      }, t0 * 1000);
    }
  }

  infection() {
    if (this._sample('zombie.death', { rate: 0.85 })) return;
    this._tone(0.7, { freq: 300, type: 'sawtooth', gain: 0.1, slide: -220, attack: 0.02 });
    this._noise(0.5, { freq: 500, q: 1, gain: 0.14, sweep: -350 });
  }

  victory() { this._playStinger('victory', [523, 659, 784, 1047], 'triangle', 0.14, 160, 0.5); }

  defeat() { this._playStinger('defeat', [392, 330, 262, 196], 'sawtooth', 0.1, 260, 0.7); }

  _playStinger(id, notes, type, gain, gap, dur) {
    this._sceneMusic = id;
    if (this._samplesReady) {
      this._stopPad();
      this.scape.setMusic(id);
      return;
    }
    notes.forEach((f, i) => setTimeout(() => this._tone(dur, { freq: f, type, gain }), i * gap));
  }

  _stopPad() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  startMusic() {
    this._wantMusic = true;
    if (this._samplesReady) {
      this._stopPad();
      this.scape.setMusic(this._sceneMusic || 'menu');
      return;
    }
    if (this.scape.failed) this._startPad();
  }

  _startPad() {
    if (this.musicTimer || this._samplesReady) return;
    const chords = [
      [110, 130.8, 164.8],
      [87.3, 110, 130.8],
      [98, 123.5, 146.8],
      [82.4, 110, 123.5],
    ];
    let i = 0;
    const playChord = () => {
      if (!this.ctx || this.muted || this._samplesReady) return;
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
