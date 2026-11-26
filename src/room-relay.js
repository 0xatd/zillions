// Private per-sender channels: RLS permits only the named sender to publish,
// and only the two named room peers to receive. Never trust a payload's `from`.
import { packShareLink, unpackShareLink } from './share-bus.js';
export class RoomRelay {
  constructor(sb, { room, self, remote, session }) {
    for (const value of [room, self, remote, session]) {
      if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error('Invalid room connection identity');
    }
    this.subscriptionTimers = new Set();
    this.sb = sb; this.open = false; this.relay = true; this.closed = false;
    this.pending = new Map(); this.outstanding = new Map(); this.seen = new Set(); this.seq = 0; this.packetSeq = 0; this.lastReceipt = 0;
    this.outTopic = `zl-link:${room}:${self}:${remote}:${session}`;
    this.inTopic = `zl-link:${room}:${remote}:${self}:${session}`;
  }
  async connect() {
    const subscribe = (topic, receive) => new Promise((resolve, reject) => {
      const channel = this.sb.channel(topic, { config: { private: true, broadcast: { ack: true } } });
      this.channels ??= []; this.channels.push(channel);
      if (receive) channel.on('broadcast', { event: 'packet' }, ({ payload }) => this.receive(payload));
      const timeout = setTimeout(() => reject(new Error('Private room relay timed out')), 10000);
      this.subscriptionTimers.add(timeout);
      channel.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') { clearTimeout(timeout); resolve(channel); }
        else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) {
          clearTimeout(timeout); reject(new Error(`Private room relay unavailable (${status}): ${error?.message || 'connection closed'}`));
          if (this.open) this.destroy();
        }
      });
    });
    try {
      const [, out] = await Promise.all([subscribe(this.inTopic, true), subscribe(this.outTopic, false)]);
      if (this.closed) return;
      this.out = out; this.started = performance.now();
      this.beat = setInterval(() => {
        if (performance.now() - (this.lastReceipt || this.started) > 10000) { this.destroy(); return; }
        this.emit({ ping: true });
        for (const packet of this.outstanding.values()) this.emit(packet);
      }, 1000);
      this.emit({ ping: true });
    } catch (error) { this.destroy(); throw error; }
  }
  emit(payload) {
    if (this.closed || !this.out) return;
    this.out.send({ type: 'broadcast', event: 'packet', payload }).catch(() => {});
  }
  receive(payload) {
    if (this.closed || !payload || typeof payload !== 'object') return;
    this.lastReceipt = performance.now();
    if (payload.ping) { this.emit({ pong: true }); return; }
    if (payload.pong) {
      if (!this.open && this.out) { this.open = true; this.onOpen?.(); }
      return;
    }
    if (Number.isSafeInteger(payload.ack)) { this.outstanding.delete(payload.ack); return; }
    if (!this.open || !Number.isSafeInteger(payload.id) || payload.id < 1) return;
    this.emit({ ack: payload.id });
    if (this.seen.has(payload.id)) return;
    this.seen.add(payload.id);
    if (this.seen.size > 4096) this.seen.delete(this.seen.values().next().value);
    if (payload.chunk && (!Number.isSafeInteger(payload.n) || payload.n < 1 || payload.n > 1024
      || !Number.isSafeInteger(payload.i) || payload.i < 0 || payload.i >= payload.n
      || typeof payload.part !== 'string' || payload.part.length > 12000
      || (!this.pending.has(payload.chunk) && this.pending.size >= 8))) return;
    const body = unpackShareLink(this.pending, payload);
    if (body) this.onMessage?.(body);
  }
  send(body) {
    if (!this.open) return;
    for (const part of packShareLink(body, String(++this.seq))) {
      if (this.outstanding.size >= 1024) { this.destroy(); return; }
      const packet = { ...part, id: ++this.packetSeq };
      this.outstanding.set(packet.id, packet); this.emit(packet);
    }
  }
  sendFast(body) { this.send(body); }
  destroy() {
    if (this.closed) return;
    this.closed = true; this.open = false; clearInterval(this.beat);
    for (const timer of this.subscriptionTimers) clearTimeout(timer);
    this.subscriptionTimers.clear();
    for (const channel of this.channels || []) this.sb.removeChannel(channel);
    this.pending.clear(); this.outstanding.clear(); this.onClose?.();
  }
}
