// Runtime audio uses generated MP3 assets first and keeps WebAudio fallback.

const BARK_HERO = { alexander: 'alex', scott: 'scott', danny: 'danny' };
const AUDIO_ROOT = 'assets/audio/';

const MUSIC_FALLBACKS = {
  hero_select: 'music/hero-select/midnight-operator-hero-select-loop-elevenlabs-music.mp3',
  portland_rainwood: 'music/maps/portland-rainwood-loop.mp3',
  chicago_ironfront: 'music/maps/chicago-ironfront-loop.mp3',
  san_francisco_fogspire: 'music/maps/san-francisco-fogspire-loop.mp3',
  midnight_bazaar: 'music/maps/midnight-bazaar-loop.mp3',
};

const VOICE_FALLBACKS = {
  alex: 'voices/alex-midnight-operator-elevenlabs-will.mp3',
  scott: 'voices/scott-chicago-elevenlabs-roger.mp3',
  danny: 'voices/danny-san-francisco-elevenlabs-charlie.mp3',
};

const LEVEL_MUSIC = {
  1: 'portland_rainwood',
  2: 'midnight_bazaar',
  3: 'chicago_ironfront',
  4: 'san_francisco_fogspire',
  5: 'midnight_bazaar',
};

const SFX_FALLBACKS = {
  acid_spit: 'aliens/acid_spit.mp3',
  alien_screech: 'aliens/alien_screech.mp3',
  psychic_pulse: 'aliens/psychic_pulse.mp3',
  spore_cloud_release: 'aliens/spore_cloud_release.mp3',
  mech_laser: 'robots/mech_laser.mp3',
  robot_death_spark: 'robots/robot_death_spark.mp3',
  servo_march: 'robots/servo_march.mp3',
  shield_overload: 'robots/shield_overload.mp3',
  construction_hammer: 'town/construction_hammer.mp3',
  generator_hum: 'town/generator_hum.mp3',
  mine_collapse: 'town/mine_collapse.mp3',
  town_bell_alarm: 'town/town_bell_alarm.mp3',
  hero_level_up_relic: 'ui/hero_level_up_relic.mp3',
  hero_revive_drop_pod: 'ui/hero_revive_drop_pod.mp3',
  horde_alarm_siren: 'ui/horde_alarm_siren.mp3',
  ui_click_dark_rts: 'ui/ui_click_dark_rts.mp3',
  ui_deny_grim: 'ui/ui_deny_grim.mp3',
  waypoint_ping_arcane: 'ui/waypoint_ping_arcane.mp3',
  bolter_burst: 'weapons/bolter_burst.mp3',
  chainsword_swing: 'weapons/chainsword_swing.mp3',
  flamethrower_burst: 'weapons/flamethrower_burst.mp3',
  grenade_explosion_dirt: 'weapons/grenade_explosion_dirt.mp3',
  lasgun_volley: 'weapons/lasgun_volley.mp3',
  plasma_rifle_charge: 'weapons/plasma_rifle_charge.mp3',
  sniper_railshot: 'weapons/sniper_railshot.mp3',
  brute_roar: 'zombies/brute_roar.mp3',
  flesh_impact: 'zombies/flesh_impact.mp3',
  infection_burst: 'zombies/infection_burst.mp3',
  zombie_horde_groan: 'zombies/zombie_horde_groan.mp3',
};

export class AudioSys {
  constructor() {
    this.barkIndex = null;
    this.factionIndex = null;
    this.sfxById = { ...SFX_FALLBACKS };
    this.musicById = { ...MUSIC_FALLBACKS };
    this.voiceByHero = { ...VOICE_FALLBACKS };
    this.lastBarkT = 0;
    this.lastFactionT = 0;
    this.lastSfxT = new Map();
    this.barkEl = null;
    this.activeClips = new Set();
    this.musicEl = null;
    this.musicKey = null;
    this.musicScene = { scene: 'menu', levelId: 1 };
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.musicGain = null;
    this.noiseBuf = null;
    this.lastGroan = 0;
    this.musicTimer = null;
    this.unlocked = false;
    this._loadManifests();
  }

  _loadManifests() {
    fetch(AUDIO_ROOT + 'click-pack/index.json')
      .then((r) => r.json())
      .then((d) => { this.barkIndex = d; })
      .catch(() => {});
    fetch(AUDIO_ROOT + 'faction-voice-pack/index.json')
      .then((r) => r.json())
      .then((d) => { this.factionIndex = d; })
      .catch(() => {});
    fetch(AUDIO_ROOT + 'sfx-pack/index.json')
      .then((r) => r.json())
      .then((d) => {
        for (const sound of d.sounds || []) this.sfxById[sound.id] = sound.file;
      })
      .catch(() => {});
    fetch(AUDIO_ROOT + 'manifest.json')
      .then((r) => r.json())
      .then((d) => {
        for (const track of d.music || []) this.musicById[track.id] = track.file;
        for (const voice of d.voices || []) this.voiceByHero[voice.hero] = voice.file;
        this._refreshRecordedMusic();
      })
      .catch(() => {});
  }

  _url(path) {
    if (!path) return '';
    if (/^https?:\/\//.test(path) || path.startsWith('assets/')) return path;
    return AUDIO_ROOT + path;
  }

  _playClip(path, volume = 0.7) {
    if (this.muted || !path) return false;
    try {
      const el = new Audio(this._url(path));
      el.volume = volume;
      this.activeClips.add(el);
      const done = () => this.activeClips.delete(el);
      el.addEventListener('ended', done, { once: true });
      el.addEventListener('error', done, { once: true });
      el.play().catch(done);
      return true;
    } catch {
      return false;
    }
  }

  _playSfx(id, volume = 0.65, cooldownMs = 0) {
    if (this.muted) return false;
    const path = this.sfxById[id];
    if (!path) return false;
    const now = performance.now();
    const key = `sfx:${id}`;
    if (cooldownMs && now - (this.lastSfxT.get(key) || 0) < cooldownMs) return true;
    this.lastSfxT.set(key, now);
    return this._playClip(`sfx-pack/${path}`, volume);
  }

  setScene(scene = 'menu', levelId = 1) {
    this.musicScene = { scene, levelId };
    this._refreshRecordedMusic();
  }

  _musicId() {
    const { scene, levelId } = this.musicScene || {};
    if (scene === 'game') return LEVEL_MUSIC[levelId] || 'portland_rainwood';
    return 'hero_select';
  }

  _stopRecordedMusic() {
    if (!this.musicEl) return;
    try { this.musicEl.pause(); } catch { /* ignore */ }
    this.musicEl = null;
    this.musicKey = null;
  }

  _refreshRecordedMusic() {
    if (!this.unlocked) return false;
    if (this.muted) {
      if (this.musicEl) this.musicEl.muted = true;
      return true;
    }
    const musicKey = this._musicId();
    const file = this.musicById[musicKey];
    if (!file) return this._startSynthMusic();
    if (this.musicEl && this.musicKey === musicKey) {
      this.musicEl.muted = false;
      this.musicEl.volume = this.musicScene.scene === 'game' ? 0.2 : 0.18;
      this.musicEl.play().catch(() => this._startSynthMusic());
      return true;
    }
    this._stopSynthMusic();
    this._stopRecordedMusic();
    try {
      const el = new Audio(this._url(file));
      el.loop = true;
      el.preload = 'auto';
      el.volume = this.musicScene.scene === 'game' ? 0.2 : 0.18;
      el.muted = this.muted;
      this.musicEl = el;
      this.musicKey = musicKey;
      el.play().catch(() => {
        if (this.musicEl === el) {
          this._stopRecordedMusic();
          this._startSynthMusic();
        }
      });
      return true;
    } catch {
      return this._startSynthMusic();
    }
  }

  _stopSynthMusic() {
    if (!this.musicTimer) return;
    clearInterval(this.musicTimer);
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
      this.barkEl = new Audio(AUDIO_ROOT + 'click-pack/' + pick.file);
      this.barkEl.volume = 0.78;
      this.barkEl.play().catch(() => {});
    } catch { /* no-op */ }
  }

  faction(factionKey, category) {
    if (this.muted || !this.factionIndex) return;
    const now = performance.now();
    if (now - this.lastFactionT < 2400) return;
    const faction = this.factionIndex.factions?.[factionKey];
    if (!faction) return;
    const items = faction.categories[category];
    if (!items || !items.length) return;
    const pick = items[(Math.random() * items.length) | 0];
    this.lastFactionT = now;
    this._playClip(`faction-voice-pack/${pick.file}`, factionKey === 'zombies' ? 0.52 : 0.62);
  }

  voiceSample(heroKey) {
    const key = BARK_HERO[heroKey] || heroKey;
    this._playClip(this.voiceByHero[key], 0.72);
  }

  init(scene = null, levelId = null) {
    if (scene) this.musicScene = { scene, levelId: levelId || 1 };
    this.unlocked = true;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this._refreshRecordedMusic();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.16;
      this.musicGain.connect(this.master);

      // Shared white noise buffer for percussive fallback sounds.
      const len = this.ctx.sampleRate * 1.0;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }

    this._refreshRecordedMusic();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
    if (this.musicEl) this.musicEl.muted = m;
    if (!m) this._refreshRecordedMusic();
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
    if (kind === 'sniper' && this._playSfx('sniper_railshot', 0.52, 900)) return;
    if (kind === 'tower' && this._playSfx('plasma_rifle_charge', 0.44, 900)) return;
    if (kind === 'ranger' && this._playSfx('lasgun_volley', 0.36, 900)) return;
    if (this._playSfx('bolter_burst', 0.42, 900)) return;
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
    if (this._playSfx('chainsword_swing', 0.46, 600)) return;
    this._noise(0.1, { freq: 900, q: 1.5, gain: 0.14, sweep: -500 });
    this._tone(0.07, { freq: 180, type: 'square', gain: 0.07, slide: -90 });
  }

  hook() {
    if (this._playSfx('chainsword_swing', 0.45, 600)) return;
    this._noise(0.15, { freq: 1800, q: 2, gain: 0.14, sweep: -1200 });
    this._tone(0.2, { freq: 500, type: 'square', gain: 0.08, slide: -320 });
  }

  backstab() {
    if (this._playSfx('chainsword_swing', 0.48, 500)) return;
    this._noise(0.12, { freq: 3000, q: 2, gain: 0.16, sweep: -2000 });
    this._tone(0.15, { freq: 700, type: 'sawtooth', gain: 0.08, slide: -450 });
  }

  stealthOn() {
    if (this._playSfx('psychic_pulse', 0.34, 1200)) return;
    this._noise(0.4, { freq: 900, q: 0.8, gain: 0.08, type: 'lowpass', sweep: -600 });
  }

  night() {
    if (this._playSfx('zombie_horde_groan', 0.32, 10000)) return;
    // A distant, mournful howl.
    this._tone(1.4, { freq: 320, type: 'sine', gain: 0.06, slide: 90, attack: 0.5 });
    this._tone(1.6, { freq: 240, type: 'sine', gain: 0.05, slide: -60, attack: 0.7 });
  }

  bossHorn() {
    if (this._playSfx('brute_roar', 0.58, 3000)) return;
    this._tone(1.2, { freq: 65, type: 'sawtooth', gain: 0.18, slide: -15, attack: 0.05 });
    this._tone(1.2, { freq: 98, type: 'sawtooth', gain: 0.12, slide: -20, attack: 0.08 });
    this._noise(1.0, { freq: 180, q: 0.7, gain: 0.2, type: 'lowpass', sweep: -80 });
  }

  roar() {
    if (this._playSfx('brute_roar', 0.56, 2500)) return;
    this._noise(0.8, { freq: 2400, q: 1.2, gain: 0.22, sweep: -1800 });
    this._tone(0.7, { freq: 900, type: 'sawtooth', gain: 0.1, slide: -650, attack: 0.02 });
  }

  underattack() {
    this._playSfx('town_bell_alarm', 0.42, 6500);
    this._tone(0.16, { freq: 520, type: 'square', gain: 0.09 });
    setTimeout(() => this._tone(0.16, { freq: 440, type: 'square', gain: 0.09 }), 180);
  }

  cast(key) {
    switch (key) {
      case 'hook':
      case 'assassinate':
        return; // handled by their own hit/shot sounds
      case 'shrapnel':
        if (this._playSfx('grenade_explosion_dirt', 0.56, 800)) return;
        this._noise(0.35, { freq: 350, q: 0.8, gain: 0.3, type: 'lowpass', sweep: -220 });
        this._tone(0.25, { freq: 110, type: 'square', gain: 0.1, slide: -70 });
        return;
      case 'sunstrike':
        if (this._playSfx('flamethrower_burst', 0.6, 1000)) return;
        this._noise(0.8, { freq: 220, q: 0.7, gain: 0.32, type: 'lowpass', sweep: -140 });
        this._tone(0.7, { freq: 70, type: 'sawtooth', gain: 0.14, slide: -40 });
        this._tone(0.5, { freq: 1200, type: 'sine', gain: 0.08, slide: -900, attack: 0.01 });
        return;
      case 'holy':
      case 'deathpulse':
        if (this._playSfx(key === 'holy' ? 'hero_level_up_relic' : 'infection_burst', key === 'holy' ? 0.36 : 0.45, 1000)) return;
        for (let i = 0; i < 3; i++) {
          setTimeout(() => this._tone(0.12, { freq: (key === 'holy' ? 620 : 380) + i * 140, type: 'triangle', gain: 0.09 }), i * 70);
        }
        return;
      case 'timelapse':
        if (this._playSfx('shield_overload', 0.42, 1000)) return;
        this._tone(0.5, { freq: 1400, type: 'sine', gain: 0.1, slide: -1100 });
        this._tone(0.35, { freq: 250, type: 'triangle', gain: 0.09, slide: 700, attack: 0.02 });
        return;
      case 'smoke':
        if (this._playSfx('spore_cloud_release', 0.38, 1000)) return;
        this._noise(0.6, { freq: 600, q: 0.6, gain: 0.18, type: 'lowpass', sweep: -350 });
        return;
      case 'roots':
        if (this._playSfx('spore_cloud_release', 0.42, 1000)) return;
        this._noise(0.3, { freq: 280, q: 1.2, gain: 0.22, type: 'lowpass', sweep: 160 });
        this._tone(0.25, { freq: 90, type: 'sawtooth', gain: 0.08, slide: 60 });
        return;
      case 'teleport':
        if (this._playSfx('psychic_pulse', 0.42, 1000)) return;
        this._tone(0.6, { freq: 400, type: 'sine', gain: 0.1, slide: 900, attack: 0.05 });
        this._tone(0.5, { freq: 800, type: 'triangle', gain: 0.06, slide: 700, attack: 0.1 });
        return;
      case 'swarm':
        if (this._playSfx('alien_screech', 0.38, 1000)) return;
        this._noise(0.7, { freq: 1800, q: 4, gain: 0.1, sweep: -600 });
        return;
      case 'whirlwind':
        if (this._playSfx('chainsword_swing', 0.5, 700)) return;
        this._noise(0.7, { freq: 900, q: 0.8, gain: 0.2, sweep: -400 });
        return;
      case 'warcry':
        if (this._playSfx('horde_alarm_siren', 0.34, 1000)) return;
        this._tone(0.5, { freq: 190, type: 'sawtooth', gain: 0.12, slide: 70, attack: 0.03 });
        this._tone(0.5, { freq: 254, type: 'sawtooth', gain: 0.09, slide: 90, attack: 0.03 });
        return;
      default:
        this._noise(0.3, { freq: 800, q: 1, gain: 0.2, sweep: -500 });
        this._tone(0.25, { freq: 300, type: 'square', gain: 0.08, slide: -150 });
    }
  }

  levelup() {
    if (this._playSfx('hero_level_up_relic', 0.58, 1200)) return;
    const notes = [392, 523, 659, 784];
    notes.forEach((f, i) => setTimeout(() => this._tone(0.3, { freq: f, type: 'triangle', gain: 0.12 }), i * 90));
  }

  herodown() {
    if (this._playSfx('brute_roar', 0.42, 1500)) return;
    this._tone(0.9, { freq: 200, type: 'sawtooth', gain: 0.13, slide: -140, attack: 0.02 });
    this._noise(0.6, { freq: 300, q: 0.8, gain: 0.18, type: 'lowpass', sweep: -180 });
  }

  revive() {
    if (this._playSfx('hero_revive_drop_pod', 0.52, 1500)) return;
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
    if (this._playSfx('flesh_impact', 0.45, 450)) return;
    this._noise(0.22, { freq: 300, q: 1.4, gain: 0.13, sweep: -180, type: 'lowpass' });
    this._tone(0.18, { freq: 130 + Math.random() * 60, type: 'sawtooth', gain: 0.05, slide: -80 });
  }

  groan() {
    const t = performance.now();
    if (t - this.lastGroan < 1400) return;
    this.lastGroan = t;
    if (this._playSfx('zombie_horde_groan', 0.26, 5000)) return;
    const f = 70 + Math.random() * 50;
    this._tone(0.9, { freq: f, type: 'sawtooth', gain: 0.045, slide: -f * 0.4, attack: 0.25 });
    this._tone(0.9, { freq: f * 1.01, type: 'sawtooth', gain: 0.04, slide: -f * 0.35, attack: 0.3 });
  }

  build() {
    if (this._playSfx('construction_hammer', 0.48, 900)) return;
    this._noise(0.15, { freq: 200, q: 1, gain: 0.22, type: 'lowpass' });
    this._tone(0.1, { freq: 520, type: 'triangle', gain: 0.08, slide: 300, attack: 0.001 });
  }

  demolish() {
    if (this._playSfx('mine_collapse', 0.54, 900)) return;
    this._noise(0.4, { freq: 160, q: 0.8, gain: 0.25, type: 'lowpass', sweep: -80 });
  }

  hitBuilding() {
    if (this._playSfx('flesh_impact', 0.32, 500)) return;
    this._noise(0.09, { freq: 260, q: 1.4, gain: 0.08, type: 'lowpass' });
  }

  click() {
    if (this._playSfx('ui_click_dark_rts', 0.44, 80)) return;
    this._tone(0.05, { freq: 700, type: 'triangle', gain: 0.06, slide: 150 });
  }

  deny() {
    if (this._playSfx('ui_deny_grim', 0.5, 180)) return;
    this._tone(0.14, { freq: 220, type: 'square', gain: 0.06, slide: -80 });
  }

  train() {
    if (this._playSfx('construction_hammer', 0.42, 900)) return;
    this._tone(0.09, { freq: 520, type: 'triangle', gain: 0.09, slide: 260 });
    this._tone(0.12, { freq: 780, type: 'triangle', gain: 0.07, slide: 200 });
  }

  alarm() {
    if (this._playSfx('horde_alarm_siren', 0.58, 3500)) return;
    for (let i = 0; i < 3; i++) {
      const t0 = i * 0.55;
      setTimeout(() => {
        this._tone(0.28, { freq: 660, type: 'square', gain: 0.10 });
        this._tone(0.28, { freq: 495, type: 'square', gain: 0.08 });
      }, t0 * 1000);
    }
  }

  infection() {
    if (this._playSfx('infection_burst', 0.55, 1000)) return;
    this._tone(0.7, { freq: 300, type: 'sawtooth', gain: 0.1, slide: -220, attack: 0.02 });
    this._noise(0.5, { freq: 500, q: 1, gain: 0.14, sweep: -350 });
  }

  victory() {
    if (this._playSfx('hero_level_up_relic', 0.55, 1500)) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => this._tone(0.5, { freq: f, type: 'triangle', gain: 0.14 }), i * 160));
  }

  defeat() {
    if (this._playSfx('town_bell_alarm', 0.46, 1500)) return;
    const notes = [392, 330, 262, 196];
    notes.forEach((f, i) => setTimeout(() => this._tone(0.7, { freq: f, type: 'sawtooth', gain: 0.1 }), i * 260));
  }

  // Slow ambient minor-chord pad fallback, cycling forever. Quiet, moody.
  _startSynthMusic() {
    if (!this.ctx || this.musicEl) return false;
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
    return true;
  }
}
