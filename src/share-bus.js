// Signaling for a share link. The siege itself stays on NetSession lockstep.
//
// Two transports share one shape:
//   - browser: BroadcastChannel plus a localStorage lobby snapshot, so two
//     tabs on this origin join with no account and no server
//   - supabase: the existing anon realtime broadcast, so a friend on another
//     device can open the same URL when that channel is available
//
// SDP and ICE ride the live channel only. localStorage keeps the latest lobby
// so a tab that opens after the host copied the link still sees it.

// TURN and STUN from the deployment. Works without a signed-in lobby. A
// missing or offline auth config leaves the session on NetSession's STUN list.
export async function loadShareIceServers(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl('/api/auth-config', { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!response?.ok) return null;
    const config = await response.json();
    return Array.isArray(config?.iceServers) && config.iceServers.length ? config.iceServers : null;
  } catch {
    return null;
  }
}

export function createMemoryChannelFactory() {
  const rooms = new Map();
  return function MemoryChannel(name) {
    const members = rooms.get(name) || new Set();
    rooms.set(name, members);
    const self = {
      onmessage: null,
      postMessage(data) {
        for (const other of members) {
          if (other !== self && other.onmessage) other.onmessage({ data });
        }
      },
      close() { members.delete(self); },
    };
    members.add(self);
    return self;
  };
}

export function createBrowserHub({
  storage = globalThis.localStorage,
  Channel = globalThis.BroadcastChannel,
} = {}) {
  const channels = new Map();
  const key = (code) => `zillions.share.${code}`;
  const read = (code) => {
    try { return JSON.parse(storage?.getItem(key(code)) || 'null'); }
    catch { return null; }
  };
  const write = (code, record) => {
    try { storage?.setItem(key(code), JSON.stringify(record)); }
    catch { /* private mode or a full disk; the live channel still carries it */ }
  };
  const slot = (code) => {
    let entry = channels.get(code);
    if (entry) return entry;
    const channel = Channel ? new Channel(`zillions-share-${code}`) : null;
    entry = { channel, listeners: new Set() };
    if (channel) channel.onmessage = (event) => {
      for (const listener of entry.listeners) listener(event.data);
    };
    channels.set(code, entry);
    return entry;
  };
  return {
    publish(code, message) {
      const entry = slot(code);
      if (message?.t === 'lobby') write(code, { lobby: message.lobby });
      try { entry.channel?.postMessage(message); } catch { /* channel closed */ }
    },
    // Same-browser tabs learn liveness from the lobby snapshot. Presence is
    // the server path, used by the realtime hub below.
    track() {},
    onPresence() { return () => {}; },
    subscribe(code, listener, { replay = 'none' } = {}) {
      const entry = slot(code);
      entry.listeners.add(listener);
      if (replay === 'lobby') {
        const record = read(code);
        if (record?.lobby) listener({ t: 'lobby', lobby: record.lobby, id: `stored-${record.lobby.seenAt || 0}` });
      }
      const onStorage = (event) => {
        if (event.key !== key(code) || !event.newValue) return;
        try {
          const record = JSON.parse(event.newValue);
          if (record?.lobby) listener({ t: 'lobby', lobby: record.lobby, id: `stored-${record.lobby.seenAt || 0}` });
        } catch { /* ignore a torn write */ }
      };
      if (globalThis.window?.addEventListener) globalThis.window.addEventListener('storage', onStorage);
      return () => {
        entry.listeners.delete(listener);
        if (globalThis.window?.removeEventListener) globalThis.window.removeEventListener('storage', onStorage);
        if (!entry.listeners.size) { entry.channel?.close(); channels.delete(code); }
      };
    },
  };
}

// True only when a websocket push will be used. channel.send() falls back to
// POST /realtime/v1/api/broadcast whenever the socket cannot push, and that
// request was aborting (net::ERR_ABORTED) while the socket was still down.
export function canSocketSend(channelState, socketConnected) {
  const joined = channelState == null || channelState === 'joined';
  return joined && socketConnected !== false;
}

const RESUBSCRIBE_MS = [500, 1000, 2000, 4000, 8000];

function enqueueShare(pending, message) {
  if (message?.t === 'lobby') {
    const index = pending.findIndex((entry) => entry?.t === 'lobby');
    if (index >= 0) pending.splice(index, 1);
  }
  pending.push(message);
  if (pending.length > 40) pending.splice(0, pending.length - 40);
}

// Realtime broadcast on a public channel. No table. Messages stay queued
// until the websocket channel is SUBSCRIBED. Seat traffic never uses the
// REST broadcast fallback.
export function createSupabaseHub(client, { onStatus, presenceKey } = {}) {
  if (!client?.channel) throw new Error('share_relay_unavailable');
  try { client.realtime?.connect?.(); } catch { /* socket opens on subscribe */ }
  const channels = new Map();
  const selfKey = presenceKey || (globalThis.crypto?.randomUUID?.() || `seat-${Date.now()}`);
  const socketUp = () => (typeof client.realtime?.isConnected === 'function'
    ? client.realtime.isConnected()
    : true);

  const entryFor = (code) => {
    let entry = channels.get(code);
    if (entry) return entry;
    entry = {
      listeners: new Set(),
      presenceListeners: new Set(),
      pending: [],
      ready: false,
      tracked: null,
      channel: null,
      attempt: 0,
      timer: null,
      closed: false,
    };
    channels.set(code, entry);
    openChannel(code, entry);
    return entry;
  };

  const emitStatus = (status) => { try { onStatus?.(status); } catch { /* ui can be mid-render */ } };

  const flush = (entry) => {
    if (!entry.ready || !canSocketSend(entry.channel?.state, socketUp())) return;
    const batch = entry.pending.splice(0);
    for (const message of batch) {
      const sent = entry.channel.send({ type: 'broadcast', event: 'sig', payload: message });
      Promise.resolve(sent).then((result) => {
        if (result && result !== 'ok') {
          enqueueShare(entry.pending, message);
          scheduleResubscribe(entry.code, entry);
        }
      }).catch(() => {
        enqueueShare(entry.pending, message);
        scheduleResubscribe(entry.code, entry);
      });
    }
  };

  const trackNow = (entry) => {
    if (!entry.tracked || !entry.ready || typeof entry.channel?.track !== 'function') return;
    if (!canSocketSend(entry.channel?.state, socketUp())) return;
    Promise.resolve(entry.channel.track(entry.tracked)).catch(() => {});
  };

  function openChannel(code, entry) {
    entry.code = code;
    const channel = client.channel(`zl-share-${code}`, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: selfKey },
        private: false,
      },
    });
    entry.channel = channel;
    const emitPresence = () => {
      if (typeof channel.presenceState !== 'function') return;
      const state = channel.presenceState() || {};
      const members = [];
      for (const [key, row] of Object.entries(state)) {
        const list = Array.isArray(row) ? row : [row];
        for (const meta of list) {
          if (!meta || typeof meta !== 'object') continue;
          // The presence key is the commander id. A meta that lost its id
          // still has to count as that person, or the host treats them as gone.
          members.push({ ...meta, id: meta.id || key });
        }
      }
      for (const listener of entry.presenceListeners) listener(members);
    };
    channel.on('broadcast', { event: 'sig' }, (message) => {
      const payload = message?.payload;
      if (payload) for (const listener of entry.listeners) listener(payload);
    });
    channel.on('presence', { event: 'sync' }, emitPresence);
    channel.subscribe((status) => {
      if (entry.closed || entry.channel !== channel) return;
      if (status === 'SUBSCRIBED') {
        entry.ready = true;
        entry.attempt = 0;
        emitStatus('subscribed');
        flush(entry);
        trackNow(entry);
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        entry.ready = false;
        emitStatus('reconnecting');
        scheduleResubscribe(code, entry);
      }
    });
  }

  function scheduleResubscribe(code, entry) {
    if (entry.closed || entry.timer) return;
    entry.ready = false;
    const wait = RESUBSCRIBE_MS[Math.min(entry.attempt, RESUBSCRIBE_MS.length - 1)];
    entry.attempt += 1;
    emitStatus('reconnecting');
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (entry.closed) return;
      const old = entry.channel;
      entry.ready = false;
      try { client.realtime?.connect?.(); } catch { /* reconnect the socket first */ }
      openChannel(code, entry);
      if (old && old !== entry.channel) Promise.resolve(client.removeChannel?.(old)).catch(() => {});
    }, wait);
  }

  const dropIfIdle = (entry) => {
    if (entry.listeners.size || entry.presenceListeners.size) return;
    entry.closed = true;
    clearTimeout(entry.timer);
    entry.pending.length = 0;
    channels.delete(entry.code);
    if (entry.channel) Promise.resolve(client.removeChannel?.(entry.channel)).catch(() => {});
  };

  return {
    publish(code, message) {
      const entry = entryFor(code);
      enqueueShare(entry.pending, message);
      if (!entry.ready || !canSocketSend(entry.channel?.state, socketUp())) {
        if (entry.ready) scheduleResubscribe(code, entry);
        emitStatus(entry.ready ? 'reconnecting' : 'connecting');
        return;
      }
      flush(entry);
    },
    subscribe(code, listener) {
      const entry = entryFor(code);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
        dropIfIdle(entry);
      };
    },
    track(code, payload) {
      const entry = entryFor(code);
      entry.tracked = payload;
      trackNow(entry);
    },
    onPresence(code, listener) {
      const entry = entryFor(code);
      entry.presenceListeners.add(listener);
      return () => {
        entry.presenceListeners.delete(listener);
        dropIfIdle(entry);
      };
    },
    status(code) {
      const entry = channels.get(code);
      if (!entry) return 'connecting';
      return entry.ready && canSocketSend(entry.channel?.state, socketUp()) ? 'subscribed' : 'reconnecting';
    },
  };
}

// Test relay. Two browser contexts do not share BroadcastChannel, so the
// coop end-to-end test points both pages at this same HTTP mailbox.
// Presence on the test relay follows the same shape as Supabase: a sync of
// who is currently tracked, a join when an id appears, and a leave when that
// id stops heartbeating. The mailbox is shared, so two browser profiles see
// one presence set. Supabase keys that set by commander id; so does this.
export function createRelayHub(relayUrl, { presenceMs = 2000, absentMs = 8000 } = {}) {
  const listeners = new Map();
  const presenceListeners = new Map();
  const lastPresence = new Map();
  const lastSync = new Map();
  let worker = null;
  let timer = null;
  let pumping = false;
  let sawPoll = false;
  const notifyPresence = (code, members, reason) => {
    const set = presenceListeners.get(code);
    if (!set) return;
    for (const listener of set) listener(members, reason);
  };
  const applyPoll = (code, body) => {
    sawPoll = true;
    const messageSet = listeners.get(code);
    const presenceSet = presenceListeners.get(code);
    if (messageSet) {
      for (const message of body?.messages || []) {
        for (const listener of messageSet) listener(message);
      }
    }
    if (!presenceSet) return;
    const members = Array.isArray(body?.presence) ? body.presence : [];
    const ids = members.map((member) => member?.id).filter(Boolean).sort().join(',');
    const previous = lastPresence.get(code);
    const now = Date.now();
    const changed = previous !== ids;
    const due = now - (lastSync.get(code) || 0) >= presenceMs;
    if (!changed && !due) return;
    let reason = 'sync';
    if (changed && previous) {
      const before = new Set(previous.split(',').filter(Boolean));
      const after = new Set(ids.split(',').filter(Boolean));
      const joined = [...after].filter((id) => !before.has(id));
      const left = [...before].filter((id) => !after.has(id));
      reason = joined.length && !left.length ? 'join' : left.length && !joined.length ? 'leave' : 'sync';
    } else if (changed) reason = 'join';
    lastPresence.set(code, ids);
    lastSync.set(code, now);
    notifyPresence(code, members, reason);
  };
  const syncWorker = () => {
    if (!worker) return;
    const codes = [...new Set([...listeners.keys(), ...presenceListeners.keys()])];
    worker.postMessage({ codes });
  };
  // Main-thread fallback if a blob worker cannot fetch. One poll at a time.
  const cursors = new Map();
  const pump = async () => {
    const codes = [...new Set([...listeners.keys(), ...presenceListeners.keys()])];
    for (const code of codes) {
      try {
        const response = await fetch(`${relayUrl}/poll?code=${encodeURIComponent(code)}&after=${cursors.get(code) || 0}`);
        if (!response.ok) continue;
        const body = await response.json();
        cursors.set(code, body.cursor || cursors.get(code) || 0);
        applyPoll(code, body);
      } catch { /* the next poll retries */ }
    }
  };
  const ensure = () => {
    if (worker || timer) { syncWorker(); return; }
    const period = Math.min(30, presenceMs);
    try {
      // The poll has to run while the sim occupies the page thread. A guest
      // whose poll waits on that thread sits a second behind the host, and
      // a click lands in a window it has not reached yet.
      const src = `
        const relayUrl = ${JSON.stringify(relayUrl)};
        const cursors = new Map();
        let codes = [];
        let busy = false;
        const poll = async () => {
          if (busy || !codes.length) return;
          busy = true;
          try {
            for (const code of codes) {
              const response = await fetch(relayUrl + '/poll?code=' + encodeURIComponent(code) + '&after=' + (cursors.get(code) || 0));
              if (!response.ok) continue;
              const body = await response.json();
              cursors.set(code, body.cursor || cursors.get(code) || 0);
              postMessage({ code, body });
            }
          } catch (error) { /* the page falls back if this keeps failing */ }
          busy = false;
        };
        setInterval(() => { poll(); }, ${period});
        self.onmessage = (event) => { codes = event.data?.codes || []; poll(); };
      `;
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = (event) => applyPoll(event.data?.code, event.data?.body);
      worker.onerror = () => {
        const failed = worker;
        worker = null;
        try { failed?.terminate(); } catch { /* already gone */ }
        // Replaying the mailbox from zero would run the original begin again.
        if (sawPoll || timer) return;
        timer = setInterval(() => { if (!pumping) { pumping = true; pump().finally(() => { pumping = false; }); } }, period);
      };
      syncWorker();
    } catch {
      timer = setInterval(() => {
        if (pumping) return;
        pumping = true;
        pump().finally(() => { pumping = false; });
      }, period);
      pump().catch(() => {});
    }
  };
  return {
    publish(code, message) {
      fetch(`${relayUrl}/pub`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, message }),
      }).catch(() => {});
    },
    subscribe(code, listener) {
      const set = listeners.get(code) || new Set();
      set.add(listener);
      listeners.set(code, set);
      ensure();
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(code);
        syncWorker();
      };
    },
    track(code, payload) {
      const id = payload?.id || '';
      if (!id) return;
      fetch(`${relayUrl}/presence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, id, payload }),
      }).catch(() => {});
      ensure();
    },
    onPresence(code, listener) {
      const set = presenceListeners.get(code) || new Set();
      set.add(listener);
      presenceListeners.set(code, set);
      ensure();
      return () => {
        set.delete(listener);
        if (!set.size) presenceListeners.delete(code);
        syncWorker();
      };
    },
    status() { return 'subscribed'; },
    presenceTiming: { presenceMs, absentMs },
  };
}

// Lockstep fallback when the data channel never opens. Windows are numbered,
// so the broadcast channel does not have to deliver them in order. Bodies
// larger than one broadcast (a snapshot) are split and reassembled.
export const SHARE_LINK_CHUNK = 12000;

export function packShareLink(body, chunkId) {
  const json = JSON.stringify(body ?? null);
  if (json.length <= SHARE_LINK_CHUNK) return [{ body }];
  const parts = [];
  for (let i = 0; i < json.length; i += SHARE_LINK_CHUNK) parts.push(json.slice(i, i + SHARE_LINK_CHUNK));
  return parts.map((part, index) => ({ chunk: chunkId, i: index, n: parts.length, part }));
}

export function unpackShareLink(pending, message) {
  if (!message || typeof message !== 'object') return null;
  if (message.body !== undefined && !message.chunk) return message.body;
  if (!message.chunk) return null;
  const box = pending.get(message.chunk) || { n: message.n, parts: [] };
  box.n = message.n;
  box.parts[message.i] = message.part;
  pending.set(message.chunk, box);
  if (box.parts.filter((part) => part != null).length < box.n) return null;
  pending.delete(message.chunk);
  try { return JSON.parse(box.parts.join('')); }
  catch { return null; }
}

// Same send/sendFast/onMessage shape as a WebRTC peer, over the share channel.
export function createShareRelayPeer(id) {
  let open = false;
  const queued = [];
  const peer = {
    shareId: id,
    relay: true,
    get open() { return open; },
    send(obj) { peer._emit?.(obj); },
    sendFast(obj) { peer.send(obj); },
    deliver(obj) {
      if (!open) { queued.push(obj); return; }
      try { peer.onMessage?.(obj); } catch { /* a bad command does not kill the seat */ }
    },
    markOpen() {
      if (open) return;
      open = true;
      try { peer.onOpen?.(); } catch { /* ignore */ }
      for (const obj of queued.splice(0)) {
        try { peer.onMessage?.(obj); } catch { /* ignore */ }
      }
    },
    destroy() {
      const was = open;
      open = false;
      queued.length = 0;
      if (was) { try { peer.onClose?.(); } catch { /* ignore */ } }
    },
  };
  return peer;
}
