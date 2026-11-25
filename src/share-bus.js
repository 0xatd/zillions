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

// Realtime broadcast on a public channel. No table. Messages queued until the
// socket subscribes, which is how the lobby already sends friend invites.
export function createSupabaseHub(client) {
  if (!client?.channel) throw new Error('share_relay_unavailable');
  const channels = new Map();
  const entryFor = (code) => {
    let entry = channels.get(code);
    if (entry) return entry;
    const listeners = new Set();
    const pending = [];
    let ready = false;
    const channel = client.channel(`zl-share-${code}`, { config: { broadcast: { self: false } } });
    channel.on('broadcast', { event: 'sig' }, (message) => {
      const payload = message?.payload;
      if (payload) for (const listener of listeners) listener(payload);
    });
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      ready = true;
      for (const message of pending.splice(0)) {
        channel.send({ type: 'broadcast', event: 'sig', payload: message }).catch(() => {});
      }
    });
    entry = { channel, listeners, pending, isReady: () => ready };
    channels.set(code, entry);
    return entry;
  };
  return {
    publish(code, message) {
      const entry = entryFor(code);
      if (!entry.isReady()) { entry.pending.push(message); return; }
      entry.channel.send({ type: 'broadcast', event: 'sig', payload: message }).catch(() => {});
    },
    subscribe(code, listener) {
      const entry = entryFor(code);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
        if (!entry.listeners.size) {
          entry.pending.length = 0; channels.delete(code);
          Promise.resolve(client.removeChannel(entry.channel)).catch(() => {});
        }
      };
    },
  };
}
