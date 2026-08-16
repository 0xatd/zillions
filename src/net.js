// Co-op transport: WebRTC DataChannels. Two signaling paths share this class:
// copy/paste invite codes (manual, non-trickle) and lobby-relayed trickle ICE
// (Supabase broadcast). STUN via Google's public server handles most home
// NATs; deployments can add TURN servers through /api/auth-config so strict
// NATs get a relay path instead of a broken or terrible route.
//
// Two channels per peer:
//  - 'game' (ordered, reliable): lobby/control traffic, guest commands, hashes.
//  - 'w' (unordered, reliable): lockstep command windows. Windows are numbered
//    and self-describing, so out-of-order delivery is fine — and without
//    ordering, one late packet no longer head-of-line blocks every window
//    behind it, which was the biggest source of guest freezes.

const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

const enc = (obj) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))));
const dec = (str) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(str.trim()), (c) => c.charCodeAt(0))));

function waitIce(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const t = setTimeout(resolve, 4000); // don't hang forever on odd networks
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    });
  });
}

export class NetSession {
  constructor(iceServers = null) {
    this.pc = null;
    this.ch = null;      // ordered control channel
    this.chFast = null;  // unordered window channel
    this.open = false;
    this.onMessage = null;   // (obj) => {}
    this.onOpen = null;
    this.onClose = null;
    this.onIce = null;       // trickle mode: (candidateJSON|null) => {}
    this.onDiagnostics = null;
    this.isHost = false;
    this.rtcConfig = {
      iceServers: Array.isArray(iceServers) && iceServers.length ? iceServers : DEFAULT_ICE,
    };
    this._pendingIce = [];
    this._remoteSet = false;
    this._statsTimer = null;
    this._lastRttMs = null;
    this._jitterMs = 0;
  }

  _makePc(trickle) {
    this.pc = new RTCPeerConnection(this.rtcConfig);
    if (trickle) {
      this.pc.onicecandidate = (e) => {
        if (this.onIce) this.onIce(e.candidate ? e.candidate.toJSON() : null);
      };
    }
    return this.pc;
  }

  _wireChannel(ch) {
    const fast = ch.label === 'w';
    if (fast) this.chFast = ch;
    else this.ch = ch;
    ch.onopen = () => {
      if (fast) return; // 'game' opening is what counts as connected
      this.open = true;
      this._logRoute();
      this._startDiagnostics();
      if (this.onOpen) this.onOpen();
    };
    ch.onclose = () => {
      if (fast) { this.chFast = null; return; }
      this.open = false;
      this._stopDiagnostics();
      if (this.onClose) this.onClose();
    };
    ch.onmessage = (e) => {
      try { const m = JSON.parse(e.data); if (this.onMessage) this.onMessage(m); } catch { /* ignore */ }
    };
  }

  // Console breadcrumb: which route ICE actually picked (host/srflx/relay).
  // "relay" or a huge RTT here means the lag is the network path, not the game.
  async _logRoute() {
    try {
      const stats = await this.pc.getStats();
      for (const s of stats.values()) {
        if (s.type === 'candidate-pair' && (s.selected || s.nominated) && s.state === 'succeeded') {
          const local = stats.get(s.localCandidateId);
          console.info('[net] route:', local?.candidateType || '?', 'rtt:', s.currentRoundTripTime != null ? Math.round(s.currentRoundTripTime * 1000) + 'ms' : '?');
          break;
        }
      }
    } catch { /* stats are best-effort */ }
  }

  _startDiagnostics() {
    this._stopDiagnostics();
    const sample = () => this._sampleDiagnostics();
    sample();
    this._statsTimer = setInterval(sample, 1500);
  }

  _stopDiagnostics() {
    if (this._statsTimer) clearInterval(this._statsTimer);
    this._statsTimer = null;
  }

  async _sampleDiagnostics() {
    if (!this.pc || !this.onDiagnostics) return;
    try {
      const stats = await this.pc.getStats();
      for (const pair of stats.values()) {
        if (pair.type !== 'candidate-pair' || pair.state !== 'succeeded' || !(pair.selected || pair.nominated)) continue;
        const local = stats.get(pair.localCandidateId);
        const remote = stats.get(pair.remoteCandidateId);
        const rttMs = Math.max(0, Number(pair.currentRoundTripTime || 0) * 1000);
        if (this._lastRttMs != null) {
          const delta = Math.abs(rttMs - this._lastRttMs);
          this._jitterMs = this._jitterMs ? this._jitterMs * 0.72 + delta * 0.28 : delta;
        }
        this._lastRttMs = rttMs;
        this.onDiagnostics({
          route: local?.candidateType || remote?.candidateType || 'unknown',
          rttMs: Math.round(rttMs),
          jitterMs: Math.round(this._jitterMs),
          bufferedBytes: (this.ch?.bufferedAmount || 0) + (this.chFast?.bufferedAmount || 0),
        });
        return;
      }
    } catch { /* stats are best-effort; gameplay never depends on them */ }
  }

  _createChannels() {
    this._wireChannel(this.pc.createDataChannel('game', { ordered: true }));
    this._wireChannel(this.pc.createDataChannel('w', { ordered: false }));
  }

  // ---- manual copy/paste path (non-trickle, full ICE gather) ----

  // Host: create an invite code to send to your friend.
  async host() {
    this.isHost = true;
    this._makePc(false);
    this._createChannels();
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await waitIce(this.pc);
    return enc(this.pc.localDescription);
  }

  // Guest: paste the invite code, get a reply code to send back.
  async join(code) {
    this.isHost = false;
    this._makePc(false);
    this.pc.ondatachannel = (e) => this._wireChannel(e.channel);
    await this.pc.setRemoteDescription(dec(code));
    this._remoteSet = true;
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await waitIce(this.pc);
    return enc(this.pc.localDescription);
  }

  // ---- lobby-relayed trickle path: offers ship instantly, candidates ----
  // ---- stream through signaling, and ICE converges on the best route ----

  async hostTrickle() {
    this.isHost = true;
    this._makePc(true);
    this._createChannels();
    await this.pc.setLocalDescription(await this.pc.createOffer());
    return enc(this.pc.localDescription);
  }

  async joinTrickle(code) {
    this.isHost = false;
    this._makePc(true);
    this.pc.ondatachannel = (e) => this._wireChannel(e.channel);
    await this.pc.setRemoteDescription(dec(code));
    this._remoteSet = true;
    await this._flushIce();
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    return enc(this.pc.localDescription);
  }

  // Host: paste/accept the friend's reply code (both paths).
  async acceptReply(code) {
    await this.pc.setRemoteDescription(dec(code));
    this._remoteSet = true;
    await this._flushIce();
  }

  // Trickled candidate from the far side. Candidates can outrun the SDP over
  // the signaling channel, so buffer until the remote description lands.
  async addIce(cand) {
    if (!this.pc) return;
    if (!this._remoteSet) { this._pendingIce.push(cand); return; }
    try { await this.pc.addIceCandidate(cand || null); } catch { /* stale/dup candidate */ }
  }

  async _flushIce() {
    const queued = this._pendingIce;
    this._pendingIce = [];
    for (const cand of queued) {
      try { await this.pc.addIceCandidate(cand || null); } catch { /* stale/dup candidate */ }
    }
  }

  send(obj) {
    if (this.open) this.ch.send(JSON.stringify(obj));
  }

  // Lockstep windows ride the unordered channel when it's up, so one late
  // packet can't stall the ones behind it. Falls back to the ordered channel.
  sendFast(obj) {
    if (this.chFast && this.chFast.readyState === 'open') this.chFast.send(JSON.stringify(obj));
    else this.send(obj);
  }

  destroy() {
    this._stopDiagnostics();
    try {
      if (this.ch) this.ch.close();
      if (this.chFast) this.chFast.close();
      if (this.pc) this.pc.close();
    } catch { /* ignore */ }
    this.open = false;
  }
}
