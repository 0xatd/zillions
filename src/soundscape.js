// Web Audio manager: buses, a voice pool, distance, pitch, and music crossfades.
// Presentation only. It never reads or writes simulation state.

import {
  CUES, MUSIC_IDS, AMBIENT_IDS, STINGER_IDS,
  distanceGain, pitchScale, clamp01,
} from './audio-score.js';

const BED = { master: 0.8, music: 0.42, sfx: 0.9, ambient: 0.5, ui: 0.65 };
const POOL = 24;
const MUSIC_FADE = 1.35;
const AMBIENT_FADE = 1.6;

export class Soundscape {
  constructor(base = 'assets/audio/cc0/') {
    this.base = base;
    this.ctx = null;
    this.buses = null;
    this.buffers = new Map();
    this.cueCounts = new Map();
    this.volumes = { master: 1, music: 1, sfx: 1, ambient: 0.85, ui: 0.9 };
    this.muted = false;
    this.listener = null;
    this.voices = [];
    this._last = Object.create(null);
    this.musicId = null;
    this.ambientId = null;
    this.musicSlot = 'a';
    this.slots = null;
    this.ready = false;
    this.failed = false;
    this.logTime = 0;
    this.recording = null;
    this.readyPromise = new Promise((resolve) => { this._resolveReady = resolve; });
    this._loadStarted = false;
    this._resolved = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) { this._finish(false); return false; }
    this.ctx = new AC();
    const master = this.ctx.createGain();
    master.connect(this.ctx.destination);
    this.buses = { master };
    for (const name of ['music', 'sfx', 'ambient', 'ui']) {
      const g = this.ctx.createGain();
      g.connect(master);
      this.buses[name] = g;
    }
    this.slots = {
      a: this._slotGain(),
      b: this._slotGain(),
      ambA: this._slotGain('ambient'),
      ambB: this._slotGain('ambient'),
    };
    this.ambientSlot = 'ambA';
    this._applyGains();
    if (!this._loadStarted) {
      this._loadStarted = true;
      this._load();
    }
    return true;
  }

  _slotGain(bus = 'music') {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.buses[bus]);
    return g;
  }

  _finish(ok) {
    if (this._resolved) return;
    this._resolved = true;
    this.ready = !!ok;
    this.failed = !ok;
    this._resolveReady(!!ok);
    if (this.onReady) this.onReady(!!ok);
  }

  async _load() {
    try {
      const res = await fetch(this.base + 'index.json');
      if (!res.ok) throw new Error('audio index ' + res.status);
      const index = await res.json();
      const jobs = [];
      const queue = (rel, key) => jobs.push(this._decode(rel, key));
      for (const id of MUSIC_IDS) if (index.music?.[id]) queue(index.music[id], 'music:' + id);
      for (const id of AMBIENT_IDS) if (index.ambient?.[id]) queue(index.ambient[id], 'ambient:' + id);
      for (const [id, files] of Object.entries(index.cues || {})) {
        let n = 0;
        for (const rel of files) {
          queue(rel, `cue:${id}:${n}`);
          n++;
        }
        this.cueCounts.set(id, n);
      }
      await Promise.all(jobs);
      const hasBed = ['menu', 'build', 'combat'].every((id) => this.buffers.has('music:' + id));
      this._finish(hasBed);
    } catch (err) {
      console.warn('soundscape load failed', err);
      this._finish(false);
    }
  }

  async _decode(rel, key) {
    try {
      const res = await fetch(this.base + rel);
      if (!res.ok) return;
      const raw = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(raw.slice(0));
      this.buffers.set(key, buf);
    } catch { /* one missing file falls back to the procedural voice */ }
  }

  hasMusic() {
    return this.ready && this.buffers.has('music:menu');
  }

  setMuted(m) {
    this.muted = !!m;
    this._applyGains();
  }

  setBus(name, value) {
    if (!Object.prototype.hasOwnProperty.call(this.volumes, name)) return;
    this.volumes[name] = clamp01(value, name === 'master' ? 1 : this.volumes[name]);
    this._applyGains();
  }

  _applyGains() {
    if (!this.buses) return;
    const master = this.muted ? 0 : BED.master * this.volumes.master;
    this.buses.master.gain.value = master;
    for (const name of ['music', 'sfx', 'ambient', 'ui']) {
      this.buses[name].gain.value = BED[name] * this.volumes[name];
    }
  }

  setListener(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.listener = { x, z };
  }

  setLogTime(t) { this.logTime = t; }

  armRecording() { this.recording = { events: [] }; }

  setMusic(id) {
    if (!id || this.musicId === id) return;
    const prev = this.musicId;
    this.musicId = id;
    const fade = STINGER_IDS.has(id) ? 0.28 : MUSIC_FADE;
    this._record({ t: this.logTime || 0, type: 'music', id, fade });
    if (!this.ctx || !this.buffers.has('music:' + id)) return;
    const nextSlot = this.musicSlot === 'a' ? 'b' : 'a';
    if (prev) this._fadeGain(this.slots[this.musicSlot].gain, 0, fade);
    this._startLoop(this.slots[nextSlot], this.buffers.get('music:' + id), fade, !STINGER_IDS.has(id));
    this.musicSlot = nextSlot;
  }

  setAmbient(id) {
    if (this.ambientId === id) return;
    const prev = this.ambientId;
    this.ambientId = id;
    this._record({ t: this.logTime || 0, type: 'ambient', id: id || null, fade: AMBIENT_FADE });
    if (!this.ctx) return;
    const nextSlot = this.ambientSlot === 'ambA' ? 'ambB' : 'ambA';
    if (prev) this._fadeGain(this.slots[this.ambientSlot].gain, 0, AMBIENT_FADE);
    if (id && this.buffers.has('ambient:' + id)) {
      this._startLoop(this.slots[nextSlot], this.buffers.get('ambient:' + id), AMBIENT_FADE, true);
      this.ambientSlot = nextSlot;
    }
  }

  _fadeGain(param, value, seconds) {
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(Math.max(0.0001, param.value), t);
    param.linearRampToValueAtTime(Math.max(0.0001, value), t + Math.max(0.05, seconds));
  }

  _startLoop(gainNode, buffer, fade, loop) {
    if (gainNode._src) {
      try { gainNode._src.stop(); } catch { /* already ended */ }
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!loop;
    src.connect(gainNode);
    const t = this.ctx.currentTime;
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.linearRampToValueAtTime(1, t + Math.max(0.05, fade));
    src.start(t);
    if (!loop) src.stop(t + buffer.duration + 0.05);
    gainNode._src = src;
  }

  play(id, opts = {}) {
    const spec = CUES[id];
    if (!spec) return false;
    const count = this.cueCounts.get(id) || 0;
    if (!count) return false;
    const index = (Math.random() * count) | 0;
    const key = `cue:${id}:${index}`;
    const buffer = this.buffers.get(key);
    if (!buffer) return false;
    const stamp = this.recording ? (this.logTime || 0) : (this.ctx ? this.ctx.currentTime : 0);
    if (spec.cooldown && stamp - (this._last[id] || -999) < spec.cooldown) return true;
    this._last[id] = stamp;
    const jitter = opts.pitch != null ? opts.pitch : (spec.pitch || 0);
    const rate = Math.max(0.5, Math.min(2, (opts.rate || 1) * (jitter ? pitchScale(Math.random, jitter) : 1)));
    let gain = spec.gain * (opts.gain || 1);
    let cutoff = 0;
    const positional = spec.positional !== false && opts.x != null && opts.z != null && this.listener;
    if (positional) {
      const d = Math.hypot(opts.x - this.listener.x, opts.z - this.listener.z);
      gain *= distanceGain(d);
      cutoff = Math.max(700, 9000 - d * 160);
    }
    const delay = Math.max(0, opts.delay || 0);
    this._record({
      t: (this.logTime || 0) + delay,
      type: 'cue',
      id,
      bus: spec.bus,
      gain,
      rate,
      cutoff,
      bufferKey: key,
    });
    if (!this.ctx || this.muted) return true;
    this._voice(buffer, spec.bus, gain, rate, cutoff, delay);
    return true;
  }

  _voice(buffer, bus, gain, rate, cutoff, delay) {
    this._reap();
    if (this.voices.length >= POOL) {
      const old = this.voices.shift();
      try { old.src.stop(); } catch { /* already ended */ }
    }
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.setValueAtTime(rate, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, gain), t);
    if (cutoff) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(cutoff, t);
      src.connect(lp).connect(g);
    } else {
      src.connect(g);
    }
    g.connect(this.buses[bus] || this.buses.sfx);
    src.start(t);
    const dur = buffer.duration / rate;
    src.stop(t + dur + 0.05);
    this._track({ src, end: t + dur + 0.1, bus });
  }

  _track(voice) { this.voices.push(voice); }

  _reap() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
  }

  _record(event) {
    if (this.recording) this.recording.events.push(event);
  }

  // Offline mix of the recording, using the same buffers and bus gains.
  async renderOffline(duration = 20) {
    const rate = 44100;
    const length = Math.max(1, Math.ceil(duration * rate));
    const ctx = new OfflineAudioContext(2, length, rate);
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : BED.master * this.volumes.master;
    master.connect(ctx.destination);
    const buses = {};
    for (const name of ['music', 'sfx', 'ambient', 'ui']) {
      const g = ctx.createGain();
      g.gain.value = BED[name] * this.volumes[name];
      g.connect(master);
      buses[name] = g;
    }
    const events = (this.recording?.events || []).slice().sort((a, b) => a.t - b.t);
    this._scheduleBed(ctx, buses.music, events.filter((e) => e.type === 'music'), duration, true);
    this._scheduleBed(ctx, buses.ambient, events.filter((e) => e.type === 'ambient'), duration, false);
    for (const ev of events) {
      if (ev.type !== 'cue') continue;
      const buffer = this.buffers.get(ev.bufferKey);
      if (!buffer || ev.t >= duration) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = ev.rate || 1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.max(0.0001, ev.gain || 0.2), ev.t);
      if (ev.cutoff) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(ev.cutoff, ev.t);
        src.connect(lp).connect(g);
      } else {
        src.connect(g);
      }
      g.connect(buses[ev.bus] || buses.sfx);
      src.start(ev.t);
      src.stop(Math.min(duration, ev.t + buffer.duration / (ev.rate || 1) + 0.02));
    }
    return ctx.startRendering();
  }

  _scheduleBed(ctx, bus, events, duration, music) {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!ev.id || ev.t >= duration) continue;
      const prefix = music ? 'music:' : 'ambient:';
      const buffer = this.buffers.get(prefix + ev.id);
      if (!buffer) continue;
      const next = events[i + 1]?.t ?? duration;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = music ? !STINGER_IDS.has(ev.id) : true;
      const end = Math.min(duration, src.loop ? Math.max(ev.t + 0.05, next) : ev.t + buffer.duration);
      if (end <= ev.t + 0.02) continue;
      const fade = Math.min(ev.fade || 1, Math.max(0.05, (end - ev.t) / 2));
      const g = ctx.createGain();
      const fadeInEnd = Math.min(end - 0.01, ev.t + fade);
      g.gain.setValueAtTime(0.0001, ev.t);
      if (fadeInEnd > ev.t + 0.01) g.gain.linearRampToValueAtTime(1, fadeInEnd);
      else g.gain.setValueAtTime(1, ev.t);
      if (src.loop && next < duration && next > fadeInEnd + 0.05) {
        const fadeOutAt = Math.max(fadeInEnd + 0.02, next - fade);
        if (fadeOutAt < next) {
          g.gain.setValueAtTime(1, fadeOutAt);
          g.gain.linearRampToValueAtTime(0.0001, next);
        }
      }
      src.connect(g).connect(bus);
      src.start(ev.t);
      src.stop(end + 0.02);
    }
  }
}

export function audioBufferToWav(buffer) {
  const channels = buffer.numberOfChannels;
  const rate = buffer.sampleRate;
  const samples = buffer.length;
  const block = channels * 2;
  const dataSize = samples * block;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const writeStr = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * block, true);
  view.setUint16(32, block, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  const chans = [];
  for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return ab;
}
