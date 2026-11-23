// Presentation-only score, reusing the licensed music/ambience from PR #132.
export function scoreFor(scene = {}) {
  if (!scene.inMatch) return { music: scene.select ? 'select' : 'menu', ambient: null };
  if (scene.over) return { music: scene.won ? 'victory' : 'defeat', ambient: null };
  const ambient = ({moor:'meadow',fen:'swamp',wastes:'volcanic',hills:'snow',vale:'valley',labyrinth:'volcanic'})[scene.biome] || 'meadow';
  return { music: scene.combat && scene.phase !== 'found' ? 'combat' : 'build', ambient };
}

export class AudioBeds {
  constructor(ctx, destination, onMusic = () => {}) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.connect(destination);
    this.onMusic = onMusic;
    this.buffers = new Map();
    this.pending = new Map();
    this.failed = new Set();
    this.slots = {music:null,ambient:null};
    this.desired = {music:null,ambient:null};
    this.disposed = false;
  }
  setVolume(volume) { this.output.gain.value = Math.max(0, Math.min(1, Number(volume) || 0)); }
  setScene(scene) {
    const score = scoreFor(scene);
    for (const kind of ['music','ambient']) {
      const id = score[kind];
      this.desired[kind] = id;
      if (!id) { this._stop(kind); continue; }
      const key = `${kind}/${id}`;
      if (this.slots[kind]?.id === id) continue;
      if (this.buffers.has(key)) this._play(kind,id,this.buffers.get(key));
      else {
        this._stop(kind);
        if (kind === 'music') this.onMusic(false);
        if (!this.failed.has(key) && !this.pending.has(key)) {
          const job = this._load(kind,id).finally(()=>this.pending.delete(key));
          this.pending.set(key,job);
        }
      }
    }
  }
  async _load(kind,id) {
    const key = `${kind}/${id}`;
    try {
      const response = await fetch(`assets/audio/cc0/${key}.ogg`, {signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
      if (this.disposed) return;
      this.buffers.set(key,buffer);
      if (this.desired[kind] === id) this._play(kind,id,buffer);
    } catch (error) {
      this.failed.add(key);
      console.warn(`Audio bed unavailable: ${key}`, error.message);
    }
  }
  _stop(kind) {
    const old=this.slots[kind];
    if (!old) return;
    this.slots[kind]=null;
    const now=this.ctx.currentTime;
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(old.gain.gain.value,now);
    old.gain.gain.linearRampToValueAtTime(0,now+1.2);
    try { old.source.stop(now+1.25); } catch { /* ended sting */ }
  }
  _play(kind,id,buffer) {
    if (this.disposed || this.slots[kind]?.id === id) return;
    this._stop(kind);
    const source=this.ctx.createBufferSource(), gain=this.ctx.createGain();
    source.buffer=buffer;
    source.loop=kind==='ambient' || !['victory','defeat'].includes(id);
    source.connect(gain).connect(this.output);
    const now=this.ctx.currentTime;
    gain.gain.setValueAtTime(0,now);
    gain.gain.linearRampToValueAtTime(kind==='ambient' ? 0.35 : 0.5,now+1.2);
    source.onended=()=>{source.disconnect();gain.disconnect();};
    source.start();
    this.slots[kind]={id,source,gain};
    if (kind==='music') this.onMusic(true);
  }
  duck() {
    const now=this.ctx.currentTime;
    if (now-(this.lastDuck ?? -Infinity)<0.65) return;
    this.lastDuck=now;
    // Duck only beds: combat SFX and the global warning remain unchanged.
    for (const kind of ['music','ambient']) {
      const slot=this.slots[kind];if(!slot)continue;
      const base=kind==='music' ? 0.5 : 0.35;
      slot.gain.gain.cancelScheduledValues(now);
      slot.gain.gain.setValueAtTime(slot.gain.gain.value,now);
      slot.gain.gain.linearRampToValueAtTime(base*0.34,now+0.05);
      slot.gain.gain.setValueAtTime(base*0.34,now+1.25);
      slot.gain.gain.linearRampToValueAtTime(base,now+2);
    }
  }
  dispose() {
    this.disposed=true;
    for(const kind of ['music','ambient'])this._stop(kind);
    this.buffers.clear();
    this.onMusic(false);
  }
}
