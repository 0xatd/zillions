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
      for (const row of Object.values(state)) {
        const list = Array.isArray(row) ? row : [row];
        for (const meta of list) if (meta && typeof meta === 'object') members.push(meta);
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
export function createRelayHub(relayUrl) {
  const listeners = new Map();
  const cursors = new Map();
  let timer = null;
  const pump = async () => {
    for (const [code, set] of listeners) {
      if (!set.size) continue;
      try {
        const response = await fetch(`${relayUrl}/poll?code=${encodeURIComponent(code)}&after=${cursors.get(code) || 0}`);
        if (!response.ok) continue;
        const body = await response.json();
        cursors.set(code, body.cursor || cursors.get(code) || 0);
        for (const message of body.messages || []) {
          for (const listener of set) listener(message);
        }
      } catch { /* the next poll retries */ }
    }
  };
  const ensure = () => {
    if (timer) return;
    timer = setInterval(() => { pump().catch(() => {}); }, 200);
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
        if (!listeners.size && timer) { clearInterval(timer); timer = null; }
      };
    },
    track() {},
    onPresence() { return () => {}; },
    status() { return 'subscribed'; },
  };
}
