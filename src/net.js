// Serverless manual co-op transport: WebRTC DataChannel with copy/paste
// signaling. Account-backed rooms can discover games, but the match itself is
// still peer-to-peer lockstep. STUN via Google's public server handles most
// home NATs.

const RTC_CONFIG = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

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
  constructor() {
    this.pc = null;
    this.ch = null;
    this.open = false;
    this.onMessage = null;   // (obj) => {}
    this.onOpen = null;
    this.onClose = null;
    this.isHost = false;
  }

  _wireChannel(ch) {
    this.ch = ch;
    ch.onopen = () => { this.open = true; if (this.onOpen) this.onOpen(); };
    ch.onclose = () => { this.open = false; if (this.onClose) this.onClose(); };
    ch.onmessage = (e) => {
      try { const m = JSON.parse(e.data); if (this.onMessage) this.onMessage(m); } catch { /* ignore */ }
    };
  }

  // Host: create an invite code to send to your friend.
  async host() {
    this.isHost = true;
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this._wireChannel(this.pc.createDataChannel('game', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await waitIce(this.pc);
    return enc(this.pc.localDescription);
  }

  // Host: paste the friend's reply code.
  async acceptReply(code) {
    await this.pc.setRemoteDescription(dec(code));
  }

  // Guest: paste the invite code, get a reply code to send back.
  async join(code) {
    this.isHost = false;
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc.ondatachannel = (e) => this._wireChannel(e.channel);
    await this.pc.setRemoteDescription(dec(code));
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await waitIce(this.pc);
    return enc(this.pc.localDescription);
  }

  send(obj) {
    if (this.open) this.ch.send(JSON.stringify(obj));
  }

  destroy() {
    try { if (this.ch) this.ch.close(); if (this.pc) this.pc.close(); } catch { /* ignore */ }
    this.open = false;
  }
}
