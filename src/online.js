// Online lobby: Zillions production account + room/social model.
// Supabase config is loaded from /api/auth-config. Vercel Blob stays as a
// legacy/static compatibility path; signed-in social state lives in Supabase.

import { getSupabaseClient, loadSupabaseConfig } from './supabase.js';
const FRESH_MS = 2 * 60 * 1000;
const CURRENT_RULES = 'survival-plots';
// Increment this only when two browser builds cannot safely share a room.
// Rooms carry the value in metadata so stale tabs fail before taking a seat.
// v4: the Labyrinth mode — a new room mode older builds would simulate as a
// founding campaign run, a new lockstep `blessing` command they would drop,
// and changed found-phase flow-field semantics.
export const LOBBY_PROTOCOL_VERSION = 4;
export const CLIENT_VERSION = '0.1.0';
const CHAT_LIMIT = 500;
const CHANNEL_READY_MS = 8000;
const SIGNAL_ATTEMPTS = 3;
const SIGNAL_RETRY_MS = 350;
const ROOM_SELECT = 'id,code,name,host_user_id,visibility,status,rules,max_players,difficulty,metadata,created_at,updated_at,last_seen_at,room_players(user_id,seat,display_name,hero,ready,connection_state,unlocked_level)';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForSubscription(channel, timeoutMs = CHANNEL_READY_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('room connection timed out')), timeoutMs);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve(channel);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timer);
        reject(new Error(`room connection failed (${String(status).toLowerCase()})`));
      }
    });
  });
}

function safePublicName(value) {
  const text = String(value || '').trim().slice(0, 24);
  if (!text || text.includes('@')) return 'Commander';
  return text;
}

function chatText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_LIMIT);
}

function normalizeHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function profileName(profile, fallback = 'Commander') {
  return safePublicName(profile?.handle || profile?.display_name || fallback);
}

function roomToGame(row) {
  const hasRoster = Array.isArray(row.room_players);
  const players = row.room_players || [];
  const metadata = row.metadata || {};
  return {
    id: row.id,
    name: row.name,
    host_id: row.host_user_id,
    host_name: safePublicName(metadata.hostName || players.find((p) => p.user_id === row.host_user_id)?.display_name),
    visibility: row.visibility,
    join_code: row.code,
    level: metadata.level || 1,
    mode: metadata.mode || 'campaign',
    rules: row.rules,
    metadata,
    protocol_version: Number(metadata.protocolVersion || 0),
    client_version: String(metadata.clientVersion || 'legacy'),
    protocol_compatible: Number(metadata.protocolVersion || 0) === LOBBY_PROTOCOL_VERSION,
    difficulty: row.difficulty || 'normal',
    // A selected roster is authoritative. metadata.players is only a legacy
    // fallback for rows fetched without the nested relation.
    players: Math.max(1, hasRoster ? players.length : Number(metadata.players || 1)),
    max_players: row.max_players || 3,
    status: row.status,
    updated_at: row.updated_at || row.last_seen_at,
    _players: players,
  };
}

export function roomCompatibility(game) {
  const protocol = Number(game?.protocol_version ?? game?.metadata?.protocolVersion ?? 0);
  return {
    compatible: protocol === LOBBY_PROTOCOL_VERSION,
    expected: LOBBY_PROTOCOL_VERSION,
    actual: protocol,
    reason: protocol
      ? `This room uses multiplayer protocol ${protocol}; your game uses ${LOBBY_PROTOCOL_VERSION}. Refresh both players and create a new room.`
      : 'This room was created by an older game build. Refresh both players and create a new room.',
  };
}

export function assertRoomCompatibility(game) {
  const result = roomCompatibility(game);
  if (!result.compatible) throw new Error(result.reason);
  return result;
}

export function canRejoinRoom(game, userId) {
  return !!game && game.status === 'in_game' && !!userId && game.host_id !== userId
    && (game._players || []).some((player) => player.user_id === userId);
}

export class OnlineLobby {
  constructor(cb = {}) {
    this.cb = cb; // {onChat, onRoomChat, onGames, onOnline, onFriends, onInvite, onKnock, onSignal, onRoomClosed, onError}
    this.sb = null;
    this.me = null;          // {id, code, name}
    this.online = new Map(); // playerId -> name (lobby presence)
    this.game = null;        // the game row we host or joined
    this.gameChan = null;
    this.roomChatChan = null;
    this.connected = false;
    this.profileCache = new Map();
    this.iceServers = null;   // optional TURN/STUN list from /api/auth-config
    this.matchActive = false; // true while a lockstep match runs — quiesce lobby churn
  }

  // While a match is running, the lobby stops doing main-thread work the game
  // doesn't need (feed refreshes, friend reloads, presence list queries). The
  // signaling channel and room heartbeats stay live for reconnects.
  setMatchActive(active) {
    this.matchActive = !!active;
  }

  async connect(name, existingClient = null) {
    if (this.sb) return this.me;
    const config = await loadSupabaseConfig();
    this.sb = existingClient || await getSupabaseClient();
    this.iceServers = Array.isArray(config.iceServers) && config.iceServers.length ? config.iceServers : null;
    const { data: sessionData, error: sessionError } = await this.sb.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData?.session?.user;
    if (!user) throw new Error('sign in required');
    const { data: profile, error: profileError } = await this.sb
      .from('profiles')
      .select('id,handle,display_name,selected_hero,username_set')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.username_set || !profile?.handle) throw new Error('choose a username first');
    this.me = {
      id: user.id,
      code: (profile?.handle || user.id.slice(0, 6)).toUpperCase().slice(0, 12),
      name: profile.handle,
      hero: profile?.selected_hero || 'alexander',
    };
    this.profileCache.set(user.id, this.me.name);
    await this._touchPresence();
    this.connected = true;
    await this.refreshOnline();
    this._presenceBeat = setInterval(() => {
      if (this.matchActive) {
        // Keep presence/room rows fresh, skip the who's-online query + UI work.
        this._touchPresence().catch(() => {});
        return;
      }
      this._touchPresence().then(() => this.refreshOnline()).catch(() => {});
      // Poll the games list too: realtime events on rooms depend on the
      // supabase_realtime publication, so the browse list must self-heal even
      // when no postgres_changes event arrives.
      this.refreshGames().catch(() => {});
    }, 15 * 1000);

    this.sb.channel('zl-rooms-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => { if (!this.matchActive) this.refreshGames(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players' }, () => { if (!this.matchActive) this.refreshGames(); })
      .subscribe();

    this.sb.channel('zl-lobby-chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lobby_chat', filter: 'scope=eq.global' }, (m) => {
        this._emitLobbyChat(m.new).catch(() => {});
      })
      .subscribe();

    this.sb.channel('zl-friends-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => { if (!this.matchActive) this.loadFriends().catch(() => {}); })
      .subscribe();

    this.userChan = this.sb.channel('zl-user-' + this.me.id)
      .on('broadcast', { event: 'invite' }, (m) => this.cb.onInvite && this.cb.onInvite(m.payload))
      .subscribe();

    return this.me;
  }

  async setName(name) {
    // Display names are account data, not an always-editable lobby field.
    if (!this.me) return;
    this.me.name = this.me.name || name || 'Commander';
    await this._touchPresence();
  }

  // ---------- presence and social ----------

  async _touchPresence() {
    if (!this.me) return null;
    const now = new Date().toISOString();
    await this.sb.from('profiles').update({ last_seen_at: now }).eq('id', this.me.id);
    if (this.game) {
      await this.sb.from('room_players')
        .update({ connection_state: 'online', last_seen_at: now })
        .eq('room_id', this.game.id)
        .eq('user_id', this.me.id);
      if (this.game.host_id === this.me.id) {
        await this.sb.from('rooms').update({ last_seen_at: now }).eq('id', this.game.id);
      }
    }
    return now;
  }

  async refreshOnline() {
    if (!this.sb) return this.online;
    const since = new Date(Date.now() - FRESH_MS).toISOString();
    const { data, error } = await this.sb.from('profiles')
      .select('id,handle,display_name,last_seen_at')
      .gt('last_seen_at', since)
      .limit(100);
    if (error) throw error;
    this.online.clear();
    for (const p of data || []) {
      const name = profileName(p);
      this.online.set(p.id, name);
      this.profileCache.set(p.id, name);
    }
    if (this.cb.onOnline) this.cb.onOnline(this.online);
    return this.online;
  }

  async _nameFor(userId) {
    if (this.profileCache.has(userId)) return this.profileCache.get(userId);
    const { data, error } = await this.sb.from('profiles')
      .select('id,handle,display_name')
      .eq('id', userId)
      .maybeSingle();
    if (error) return 'Commander';
    const name = profileName(data);
    this.profileCache.set(userId, name);
    return name;
  }

  async loadFriends() {
    if (!this.me) return [];
    const { data, error } = await this.sb.from('friendships')
      .select('id,requester_id,addressee_id,status,created_at,updated_at')
      .or(`requester_id.eq.${this.me.id},addressee_id.eq.${this.me.id}`)
      .order('updated_at', { ascending: false });
    if (error) throw error;

    const ids = [...new Set((data || []).map((f) => f.requester_id === this.me.id ? f.addressee_id : f.requester_id))];
    const profiles = new Map();
    if (ids.length) {
      const { data: rows, error: profileError } = await this.sb.from('profiles')
        .select('id,handle,display_name,last_seen_at')
        .in('id', ids);
      if (profileError) throw profileError;
      for (const p of rows || []) {
        const name = profileName(p);
        profiles.set(p.id, p);
        this.profileCache.set(p.id, name);
      }
    }

    const fresh = Date.now() - FRESH_MS;
    const friends = (data || []).map((f) => {
      const userId = f.requester_id === this.me.id ? f.addressee_id : f.requester_id;
      const p = profiles.get(userId);
      const online = p?.last_seen_at ? new Date(p.last_seen_at).getTime() > fresh : this.online.has(userId);
      return {
        id: f.id,
        userId,
        name: profileName(p, userId.slice(0, 6)),
        status: f.status,
        direction: f.requester_id === this.me.id ? 'outgoing' : 'incoming',
        online,
      };
    });
    if (this.cb.onFriends) this.cb.onFriends(friends);
    return friends;
  }

  async addFriend(handle) {
    const wanted = normalizeHandle(handle);
    if (!wanted) throw new Error('enter a username');
    if (wanted === normalizeHandle(this.me.name)) throw new Error('that is you');
    const { data: profile, error } = await this.sb.from('profiles')
      .select('id,handle,display_name')
      .eq('handle', wanted)
      .maybeSingle();
    if (error) throw error;
    if (!profile) throw new Error('no player with that username');
    const { error: insertError } = await this.sb.from('friendships').insert({
      requester_id: this.me.id,
      addressee_id: profile.id,
      status: 'pending',
    });
    if (insertError) throw new Error(insertError.code === '23505' ? 'friend request already exists' : insertError.message);
    return this.loadFriends();
  }

  async acceptFriend(friendshipId) {
    const { error } = await this.sb.from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId);
    if (error) throw error;
    return this.loadFriends();
  }

  async removeFriend(friendshipId) {
    const { error } = await this.sb.from('friendships')
      .delete()
      .eq('id', friendshipId);
    if (error) throw error;
    return this.loadFriends();
  }

  async inviteFriend(userId) {
    if (!this.game) throw new Error('create or join a room first');
    const payload = {
      fromId: this.me.id,
      fromName: this.me.name,
      joinCode: this.game.join_code,
      mode: this.game.mode,
      roomId: this.game.id,
    };
    const channel = this.sb.channel('zl-user-' + userId);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('invite channel timeout')), 2500);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await channel.send({ type: 'broadcast', event: 'invite', payload });
    this.sb.removeChannel(channel);
    return payload;
  }

  async loadChat() {
    const { data, error } = await this.sb.from('lobby_chat')
      .select('id,user_id,message,created_at,profiles(handle,display_name)')
      .eq('scope', 'global')
      .order('created_at', { ascending: false })
      .limit(80);
    if (error) throw error;
    // Chat is a living room, not an archive: anything older than a day reads
    // as a ghost town ("days-old messages still there"). Keep the freshest
    // 80, then drop whatever fell outside the last 24 hours.
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const rows = (data || []).reverse()
      .filter((m) => new Date(m.created_at).getTime() >= dayAgo)
      .map((m) => ({
      id: m.id,
      user_id: m.user_id,
      name: profileName(m.profiles, this.profileCache.get(m.user_id)),
      text: m.message,
      created_at: m.created_at,
    }));
    for (const m of rows) this.profileCache.set(m.user_id, m.name);
    return rows;
  }

  async sendChat(text) {
    text = chatText(text);
    if (!text || !this.me) return;
    const { data, error } = await this.sb.from('lobby_chat').insert({
      scope: 'global',
      user_id: this.me.id,
      message: text,
    }).select('id,user_id,message,created_at').single();
    if (error) throw error;
    if (data) await this._emitLobbyChat(data);
  }

  async _emitLobbyChat(row) {
    const seen = this._seenLobbyChat || new Set();
    if (seen.has(row.id)) return;
    seen.add(row.id);
    this._seenLobbyChat = seen;
    const name = row.user_id === this.me?.id ? this.me.name : await this._nameFor(row.user_id);
    if (this.cb.onChat) this.cb.onChat({
      id: row.id,
      user_id: row.user_id,
      name,
      text: row.message,
      created_at: row.created_at,
    });
  }

  async loadRoomChat(roomId = this.game?.id, channel = 'room') {
    if (!roomId) return [];
    const { data, error } = await this.sb.from('room_chat')
      .select('id,room_id,user_id,channel,message,created_at,profiles(handle,display_name)')
      .eq('room_id', roomId)
      .eq('channel', channel)
      .order('created_at', { ascending: false })
      .limit(80);
    if (error) throw error;
    const rows = (data || []).reverse().map((m) => ({
      id: m.id,
      room_id: m.room_id,
      channel: m.channel || 'room',
      user_id: m.user_id,
      name: profileName(m.profiles, this.profileCache.get(m.user_id)),
      text: m.message,
      created_at: m.created_at,
    }));
    for (const m of rows) this.profileCache.set(m.user_id, m.name);
    return rows;
  }

  async sendRoomChat(text, channel = 'room') {
    text = chatText(text);
    if (!text || !this.me || !this.game) return;
    const { data, error } = await this.sb.from('room_chat').insert({
      room_id: this.game.id,
      user_id: this.me.id,
      channel,
      message: text,
    }).select('id,room_id,user_id,channel,message,created_at').single();
    if (error) throw error;
    if (data) await this._emitRoomChat(data);
  }

  async _emitRoomChat(row) {
    const seen = this._seenRoomChat || new Set();
    if (seen.has(row.id)) return;
    seen.add(row.id);
    this._seenRoomChat = seen;
    const name = row.user_id === this.me?.id ? this.me.name : await this._nameFor(row.user_id);
    if (this.cb.onRoomChat) this.cb.onRoomChat({
      id: row.id,
      room_id: row.room_id,
      channel: row.channel || 'room',
      user_id: row.user_id,
      name,
      text: row.message,
      created_at: row.created_at,
    });
  }

  // ---------- games ----------

  // Open rooms you can join, plus in-progress games: the world should see wars
  // being fought, and players who dropped can find their game and rejoin it.
  async refreshGames() {
    const since = new Date(Date.now() - FRESH_MS).toISOString();
    const { data, error } = await this.sb.from('rooms')
      .select(ROOM_SELECT)
      .eq('visibility', 'public')
      .in('status', ['open', 'starting', 'in_game'])
      .gt('last_seen_at', since)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    const games = (data || [])
      .map(roomToGame)
      .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1));
    if (this.cb.onGames) this.cb.onGames(games);
    return games;
  }

  async createGame({ visibility = 'public', level = 1, mode = 'campaign', difficulty = 'normal', unlockedLevel = 1 } = {}) {
    const metadata = {
      level,
      mode,
      hostName: this.me.name,
      players: 1,
      protocolVersion: LOBBY_PROTOCOL_VERSION,
      clientVersion: CLIENT_VERSION,
    };
    const { data, error } = await this.sb.from('rooms').insert({
      name: `${this.me.name}'s frontier`,
      host_user_id: this.me.id,
      visibility,
      rules: CURRENT_RULES,
      difficulty,
      metadata,
      last_seen_at: new Date().toISOString(),
    }).select('id,code,name,host_user_id,visibility,status,rules,max_players,difficulty,metadata,created_at,updated_at,last_seen_at').single();
    if (error) throw new Error(error.message);
    const { error: seatError } = await this.sb.from('room_players').upsert({
      room_id: data.id,
      user_id: this.me.id,
      seat: 1,
      display_name: this.me.name,
      hero: this.me.hero,
      ready: true,
      connection_state: 'online',
      unlocked_level: Math.max(1, Number(unlockedLevel) || 1),
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'room_id,user_id' });
    if (seatError) throw new Error(seatError.message);
    this._seatedRoomId = data.id;
    this._localRoomPlayer = {
      room_id: data.id,
      user_id: this.me.id,
      seat: 1,
      display_name: this.me.name,
      hero: this.me.hero,
      ready: true,
      connection_state: 'online',
      unlocked_level: Math.max(1, Number(unlockedLevel) || 1),
    };
    this.game = roomToGame({ ...data, room_players: [{ user_id: this.me.id, display_name: this.me.name, hero: this.me.hero }] });
    await this._joinGameChannel(data.id, true);
    // Heartbeat so the listing stays fresh; stops when the page dies.
    this._beat = setInterval(() => this.touchGame({}), 45 * 1000);
    this._installPageHide();
    await this.refreshCurrentGame();
    await this.refreshGames();
    return this.game;
  }

  _installPageHide() {
    if (this._pageHide) window.removeEventListener('pagehide', this._pageHide);
    this._pageHide = () => {
      if (!this.game?.id || !this.me?.id) return;
      this.sb.from('room_players').update({
        connection_state: 'offline',
        last_seen_at: new Date().toISOString(),
      }).eq('room_id', this.game.id).eq('user_id', this.me.id).then(() => {}).catch(() => {});
    };
    window.addEventListener('pagehide', this._pageHide);
  }

  async touchGame(fields) {
    if (!this.game) return;
    const status = fields.status === 'playing' ? 'in_game' : fields.status;
    const metadata = { ...(this.game.metadata || {}), players: fields.players || this.game.players || 1 };
    await this.sb.from('rooms')
      .update({
        ...(status ? { status } : {}),
        metadata,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', this.game.id);
    await this._touchPresence();
  }

  async updateGameSettings(fields = {}) {
    if (!this.game || this.game.host_id !== this.me?.id) return this.game;
    const metadata = {
      ...(this.game.metadata || {}),
      ...(fields.level ? { level: fields.level } : {}),
      ...(fields.mode ? { mode: fields.mode } : {}),
    };
    const patch = { metadata, last_seen_at: new Date().toISOString() };
    if (fields.difficulty) patch.difficulty = fields.difficulty;
    const { error } = await this.sb.from('rooms').update(patch).eq('id', this.game.id);
    if (error) throw new Error(error.message);
    const setupChanged = fields.level || fields.mode || fields.difficulty;
    if (setupChanged) {
      // A Ready vote is consent to one exact setup. Changing any host-owned
      // setting invalidates every guest vote, as in modern competitive lobbies.
      const { error: readyError } = await this.sb.from('room_players')
        .update({ ready: false })
        .eq('room_id', this.game.id)
        .neq('user_id', this.me.id);
      if (readyError) throw new Error(`Room updated, but Ready reset failed: ${readyError.message}`);
    }
    this.game = {
      ...this.game,
      metadata,
      level: metadata.level || this.game.level,
      mode: metadata.mode || this.game.mode,
      difficulty: fields.difficulty || this.game.difficulty,
    };
    if (this.cb.onRoom) this.cb.onRoom(this.game);
    return this.game;
  }

  // Room-row churn (heartbeats, reconnect upserts) fires postgres events
  // constantly; mid-match the full re-select matters little and costs main
  // thread + network, so it gets throttled hard while a match runs.
  _refreshCurrentThrottled() {
    const gapMs = this.matchActive ? 12000 : 0;
    const now = Date.now();
    if (now - (this._lastRoomRefresh || 0) < gapMs) return;
    this._lastRoomRefresh = now;
    this.refreshCurrentGame().catch((e) => this.cb.onError && this.cb.onError(e));
  }

  // A room refresh improves the first roster sent to a guest, but it must not
  // hold the WebRTC handshake open when Supabase is slow or unreachable.
  async refreshCurrentGameBounded(timeoutMs = 1500) {
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(this.game), Math.max(0, timeoutMs));
    });
    try {
      return await Promise.race([
        this.refreshCurrentGame().catch(() => this.game),
        timeout,
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async refreshCurrentGame() {
    if (!this.game?.id) return null;
    const gameId = this.game.id;
    const requestId = (this._roomRefreshRequestId || 0) + 1;
    this._roomRefreshRequestId = requestId;
    const { data, error } = await this.sb.from('rooms')
      .select(ROOM_SELECT)
      .eq('id', gameId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    // Joining produces several overlapping reads: the seat insert, realtime
    // event, hero update and explicit refresh. An older one-player response
    // must not arrive last and erase the newer roster from the screen.
    if (requestId !== this._roomRefreshRequestId || this.game?.id !== gameId) return this.game;
    // A successful seat write is stronger evidence than an occasionally
    // incomplete nested room_players read. Keep this client's verified seat
    // visible until it explicitly leaves; watchers never set _seatedRoomId,
    // so this cannot manufacture a spectator seat.
    if (this._seatedRoomId === gameId && this.me?.id) {
      const players = [...(data.room_players || [])];
      if (!players.some((player) => player.user_id === this.me.id)) {
        const local = (this.game?._players || []).find((player) => player.user_id === this.me.id)
          || this._localRoomPlayer;
        if (local) data.room_players = [...players, local];
      }
    }
    this.game = roomToGame(data);
    if (this.cb.onRoom) this.cb.onRoom(this.game);
    return this.game;
  }

  async updateRoomPlayer(fields = {}) {
    if (!this.game?.id || !this.me?.id) return null;
    const patch = { last_seen_at: new Date().toISOString() };
    if (fields.hero) {
      patch.hero = fields.hero;
      this.me.hero = fields.hero;
    }
    if (typeof fields.ready === 'boolean') patch.ready = fields.ready;
    if (fields.connection_state) patch.connection_state = fields.connection_state;
    const { error } = await this.sb.from('room_players')
      .update(patch)
      .eq('room_id', this.game.id)
      .eq('user_id', this.me.id);
    if (error) throw new Error(error.message);
    return this.refreshCurrentGame();
  }

  _clearRoomState() {
    clearInterval(this._beat);
    if (this._pageHide) window.removeEventListener('pagehide', this._pageHide);
    this._pageHide = null;
    if (this.gameChan) this.sb.removeChannel(this.gameChan);
    if (this.roomChatChan) this.sb.removeChannel(this.roomChatChan);
    this.gameChan = null;
    this.roomChatChan = null;
    this._seatedRoomId = null;
    this._localRoomPlayer = null;
    this.game = null;
  }

  // Leave staging explicitly. Hosts close the room (the FK removes seats and
  // room chat); guests remove only their own seat. Do not use this for a
  // temporary mid-match disconnect because that seat is needed for Rejoin.
  async leaveRoom() {
    if (!this.game || !this.me) return;
    const game = this.game;
    const isHost = game.host_id === this.me.id;
    if (isHost) {
      try { await this.signal({ t: 'roomClosed', to: 'all', reason: 'host_closed' }); } catch { /* database deletion is authoritative */ }
      const { error } = await this.sb.from('rooms').delete().eq('id', game.id);
      if (error) throw new Error(error.message);
    } else if (this._seatedRoomId === game.id) {
      const { error } = await this.sb.from('room_players')
        .delete()
        .eq('room_id', game.id)
        .eq('user_id', this.me.id);
      if (error) throw new Error(error.message);
    }
    this._clearRoomState();
    await this.refreshGames();
  }

  async removeRoomPlayer(userId) {
    if (!this.game || this.game.host_id !== this.me?.id || !userId || userId === this.me.id) return;
    try { await this.signal({ t: 'roomClosed', to: userId, reason: 'removed' }); } catch { /* seat deletion is authoritative */ }
    const { error } = await this.sb.from('room_players')
      .delete()
      .eq('room_id', this.game.id)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    await this.refreshCurrentGame();
  }

  async endGame() {
    if (!this.game) return;
    const game = this.game;
    try {
      if (game.host_id === this.me?.id) {
        await this.sb.from('rooms').update({ status: 'finished' }).eq('id', game.id);
      } else if (this._seatedRoomId === game.id) {
        await this.sb.from('room_players').update({ connection_state: 'offline' })
          .eq('room_id', game.id).eq('user_id', this.me.id);
      }
    } finally {
      this._clearRoomState();
    }
  }

  async findByCode(code) {
    const { data } = await this.sb.from('rooms')
      .select(ROOM_SELECT)
      .eq('code', String(code).trim().toUpperCase())
      .in('status', ['open', 'in_game'])
      .limit(1);
    return data?.[0] ? roomToGame(data[0]) : null;
  }

  // Join a game's signaling channel. Signals are {t, to, from, ...} — every
  // client sees every signal and ignores ones not addressed to it.
  async _joinGameChannel(gameId, asHost) {
    if (this.gameChan) this.sb.removeChannel(this.gameChan);
    if (this.roomChatChan) this.sb.removeChannel(this.roomChatChan);
    this.gameChan = this.sb.channel('zl-game-' + gameId);
    this.gameChan
      .on('broadcast', { event: 'sig' }, (m) => {
        const s = m.payload;
        if (asHost && s.t === 'knock') {
          // The knocker has already written their seat row; re-read the room
          // so the roster shows them even if no postgres_changes event fires.
          this._refreshCurrentThrottled();
          if (this.cb.onKnock) this.cb.onKnock(s);
        } else if ((s.to === this.me.id || s.to === 'all') && this.cb.onSignal) this.cb.onSignal(s);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${gameId}` }, () => {
        this._refreshCurrentThrottled();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${gameId}` }, (event) => {
        if (event.eventType === 'DELETE') {
          if (this.cb.onRoomClosed) this.cb.onRoomClosed('host_closed');
        } else this._refreshCurrentThrottled();
      });
    await waitForSubscription(this.gameChan);
    this.roomChatChan = this.sb.channel('zl-room-chat-' + gameId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_chat', filter: `room_id=eq.${gameId}` }, (m) => {
        this._emitRoomChat(m.new).catch(() => {});
      })
    await waitForSubscription(this.roomChatChan);
  }

  async signal(payload) {
    if (!this.gameChan) throw new Error('room connection is not ready');
    let lastStatus = 'unknown';
    for (let attempt = 1; attempt <= SIGNAL_ATTEMPTS; attempt++) {
      lastStatus = await this.gameChan.send({
        type: 'broadcast',
        event: 'sig',
        payload: { ...payload, from: this.me.id },
      });
      if (lastStatus === 'ok') return;
      if (attempt < SIGNAL_ATTEMPTS) await delay(SIGNAL_RETRY_MS * attempt);
    }
    throw new Error(`room message was not delivered (${lastStatus})`);
  }

  async joinGame(game, unlockedLevel = 1) {
    assertRoomCompatibility(game);
    this.game = game;
    const used = new Set((game._players || []).map((p) => Number(p.seat || 0)));
    let seat = 2;
    while (used.has(seat) && seat <= 3) seat++;
    const localPlayer = {
      room_id: game.id,
      user_id: this.me.id,
      seat: Math.min(seat, 3),
      display_name: this.me.name,
      hero: this.me.hero,
      ready: false,
      connection_state: 'online',
      unlocked_level: Math.max(1, Number(unlockedLevel) || 1),
      last_seen_at: new Date().toISOString(),
    };
    const { error } = await this.sb.from('room_players').upsert(localPlayer, { onConflict: 'room_id,user_id' });
    if (error) throw new Error(error.message);
    this._seatedRoomId = game.id;
    this._localRoomPlayer = localPlayer;
    this.game = roomToGame({
      ...game,
      room_players: [
        ...(game._players || []).filter((player) => player.user_id !== this.me.id),
        localPlayer,
      ],
    });
    await this._joinGameChannel(game.id, false);
    this._installPageHide();
    await this.refreshCurrentGame();
    await this.signal({ t: 'knock', name: this.me.name });
  }

  async watchGame(game) {
    assertRoomCompatibility(game);
    this.game = game;
    await this._joinGameChannel(game.id, false);
    await this.signal({ t: 'knock', role: 'spectator', name: this.me.name });
  }

}

// The lobby is also a place to read about the world.
export const LORE = [
  ['The Long Dusk', 'Nobody agrees on when the plague began — only that the frontier stopped answering, west to east, until the maps went quiet. What was left of the Marches learned a simple arithmetic: the dead do not sleep. They gather where the hives feed, and every league of ground you take makes them answer.'],
  ['The Keeps', 'The old kingdoms built their keeps on ley-crossings — plazas ringed by housing, mills at the treelines, gold veins within riding distance. That is why every ruin you reclaim feels planned: it was. You are not building a city. You are waking one up and pushing its roads back into the dark.'],
  ['The Company', 'Scott English walks slow because everything near him does — space thickens around that man, and his shotgun ends arguments the gravity started. Alexander Thomas kills from a horizon away while a cloud of nanites stitches his troops back together; when the dead close in, the grenade goes forward and he goes backward. Danny Donovan? The horde has never seen Danny Donovan. It only feels itself getting thinner. Turtle Voss has not taken a backward step since the Marches, and neither has whatever is standing behind him. John Marlowe fights like the bar is already closing and gets meaner every time he hits the ground. Tiger Reyes never arrives alone — by the time you count the copies it is too late to matter. And Aaron Whitlock wins most of his fights before the first shot, mending and quickening everyone near him while something he called stands and fights in his place.'],
  ['The Front Line', 'Camps do not wait for orders. They muster, march, and hold what they can. Hives do the same in reverse. The war is the line between those two economies, and the best commanders move that line before it moves them.'],
  ['The Zillion', 'At the bottom of the Black Vale something wears the plague like a crown. The chronicles call it The Zillion because the scouts who counted its horde never agreed on a number, only on a magnitude. Five keeps stand between it and the last planet. Yours is one of them.'],
];

export const TIPS = [
  '🪙 Coins on the ground never expire — but uncollected coins are towers you don\'t have yet.',
  '🏰 Hive pressure is visible on the map. Spend where the front line is bending.',
  '🌪️ Hero levels grant upgrade points — choose Aura, Passive I, Passive II, or Ult Damage from the hero panel.',
  '🧱 Walls are not for stopping the horde. They are for choosing where it stands while your towers work.',
  '🎯 Ballista towers delete brutes and bosses; flame towers erase packed walkers. Mix them.',
  '⚔️ Press 1 when the Keep is under pressure — an army standing WITH you fights twice as well.',
  '⛏️ Gold mines pay double a manor — and the dead know it. Guard tower first, mine second.',
  '💀 In Survival, the horde never stops growing. The Threat level you reach is the record you\'ll brag about.',
  '🔐 Private rooms use join codes. Share the code with the commanders you want in the run.',
];
