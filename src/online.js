// Online lobby: Zillions production account + room model.
// Supabase config is loaded from /api/auth-config. The global lobby chat and
// presence use the existing Vercel Blob route until room chat is fully moved.
import {
  getLobby,
  heartbeatLobby,
  joinLobby,
  sendLobbyChat,
} from './backend.js';

const SUPABASE_JS = 'https://esm.sh/@supabase/supabase-js@2.45.4';
const FRESH_MS = 2 * 60 * 1000;
const CURRENT_RULES = 'survival-plots';

function safePublicName(value) {
  const text = String(value || '').trim().slice(0, 24);
  if (!text || text.includes('@')) return 'Commander';
  return text;
}

function randomCode(n = 6) {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += abc[(Math.random() * abc.length) | 0];
  return s;
}

async function loadSupabaseClient() {
  const response = await fetch('/api/auth-config', {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('account backend unavailable');
  const config = await response.json();
  if (!config?.enabled || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('account backend not configured');
  }
  const { createClient } = await import(SUPABASE_JS);
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storageKey: 'zillions.supabase.auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
}

function roomToGame(row) {
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
    difficulty: row.difficulty || 'normal',
    players: Math.max(1, players.length || Number(metadata.players || 1)),
    max_players: row.max_players || 3,
    status: row.status,
    updated_at: row.updated_at || row.last_seen_at,
    _players: players,
  };
}

export class OnlineLobby {
  constructor(cb = {}) {
    this.cb = cb; // {onChat, onGames, onOnline, onInvite, onKnock, onSignal, onError}
    this.sb = null;
    this.me = null;          // {id, code, name}
    this.online = new Map(); // playerId -> name (lobby presence)
    this.game = null;        // the game row we host or joined
    this.gameChan = null;
    this.connected = false;
  }

  async connect(name) {
    if (this.sb) return this.me;
    this.sb = await loadSupabaseClient();
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
    await this.sb.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id);
    this.connected = true;
    await this._refreshPresence(true);
    this._presenceBeat = setInterval(() => this._refreshPresence(false), 15 * 1000);

    this.sb.channel('zl-rooms-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => this.refreshGames())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players' }, () => this.refreshGames())
      .subscribe();

    this.sb.channel('zl-user-' + this.me.id)
      .on('broadcast', { event: 'invite' }, (m) => this.cb.onInvite && this.cb.onInvite(m.payload))
      .subscribe();

    return this.me;
  }

  async setName(name) {
    // Display names are account data, not an always-editable lobby field.
    if (!this.me) return;
    this.me.name = this.me.name || name || 'Commander';
    await this._refreshPresence(true);
  }

  // ---------- chat ----------

  async _refreshPresence(join = false) {
    if (!this.me) return null;
    const payload = {
      mode: 'survival',
      name: this.me.name,
      hero: this.me.hero,
      rules: CURRENT_RULES,
      status: this.game ? `room ${this.game.join_code}` : 'lobby',
    };
    const state = join ? await joinLobby(payload) : await heartbeatLobby(payload);
    const lobby = state?.lobby || (await getLobby('survival'))?.lobby;
    if (!lobby) return null;
    this.online.clear();
    for (const p of lobby.players || []) this.online.set(p.playerId, p.name);
    if (this.cb.onOnline) this.cb.onOnline(this.online);
    if (this.cb.onChat) {
      const seen = this._seenChat || new Set();
      for (const m of lobby.messages || []) {
        const id = m.id || `${m.playerId}-${m.createdAt}-${m.text}`;
        if (seen.has(id)) continue;
        seen.add(id);
        this.cb.onChat({
          name: m.name,
          text: m.text,
          created_at: m.createdAt,
        });
      }
      this._seenChat = seen;
    }
    return lobby;
  }

  async loadChat() {
    const lobby = (await getLobby('survival'))?.lobby;
    return (lobby?.messages || []).map((m) => ({
      name: m.name,
      text: m.text,
      created_at: m.createdAt,
    }));
  }

  async sendChat(text) {
    text = String(text).slice(0, 400).trim();
    if (!text) return;
    await sendLobbyChat(text, {
      mode: 'survival',
      name: this.me.name,
      hero: this.me.hero,
      rules: CURRENT_RULES,
      status: this.game ? `room ${this.game.join_code}` : 'lobby',
    });
    await this._refreshPresence(false);
  }

  // ---------- games ----------

  async refreshGames() {
    const since = new Date(Date.now() - FRESH_MS).toISOString();
    const { data, error } = await this.sb.from('rooms')
      .select('id,code,name,host_user_id,visibility,status,rules,max_players,difficulty,metadata,created_at,updated_at,last_seen_at,room_players(user_id,seat,display_name,hero,ready,connection_state)')
      .eq('visibility', 'public')
      .eq('status', 'open')
      .gt('last_seen_at', since)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    const games = (data || []).map(roomToGame);
    if (this.cb.onGames) this.cb.onGames(games);
    return games;
  }

  async createGame({ visibility = 'public', level = 1, mode = 'campaign' } = {}) {
    const metadata = { level, mode, hostName: this.me.name, players: 1 };
    const { data, error } = await this.sb.from('rooms').insert({
      name: `${this.me.name}'s frontier`,
      host_user_id: this.me.id,
      visibility,
      rules: CURRENT_RULES,
      difficulty: 'normal',
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
      ready: false,
      connection_state: 'online',
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'room_id,user_id' });
    if (seatError) throw new Error(seatError.message);
    this.game = roomToGame({ ...data, room_players: [{ user_id: this.me.id, display_name: this.me.name, hero: this.me.hero }] });
    this._joinGameChannel(data.id, true);
    // Heartbeat so the listing stays fresh; stops when the page dies.
    this._beat = setInterval(() => this.touchGame({}), 45 * 1000);
    window.addEventListener('beforeunload', () => this.endGame());
    await this.refreshGames();
    return this.game;
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
    await heartbeatLobby({
      mode: 'survival',
      name: this.me.name,
      hero: this.me.hero,
      rules: CURRENT_RULES,
      status: `room ${this.game.join_code}`,
    });
  }

  async endGame() {
    if (!this.game) return;
    clearInterval(this._beat);
    try { await this.sb.from('rooms').update({ status: 'finished' }).eq('id', this.game.id); } catch { /* closing */ }
    this.game = null;
  }

  async findByCode(code) {
    const { data } = await this.sb.from('rooms')
      .select('id,code,name,host_user_id,visibility,status,rules,max_players,difficulty,metadata,created_at,updated_at,last_seen_at,room_players(user_id,seat,display_name,hero,ready,connection_state)')
      .eq('code', String(code).trim().toUpperCase())
      .eq('status', 'open')
      .limit(1);
    return data?.[0] ? roomToGame(data[0]) : null;
  }

  // Join a game's signaling channel. Signals are {t, to, from, ...} — every
  // client sees every signal and ignores ones not addressed to it.
  _joinGameChannel(gameId, asHost) {
    this.gameChan = this.sb.channel('zl-game-' + gameId);
    this.gameChan
      .on('broadcast', { event: 'sig' }, (m) => {
        const s = m.payload;
        if (asHost && s.t === 'knock' && this.cb.onKnock) this.cb.onKnock(s);
        else if (s.to === this.me.id && this.cb.onSignal) this.cb.onSignal(s);
      })
      .subscribe();
  }

  signal(payload) {
    if (!this.gameChan) return;
    this.gameChan.send({ type: 'broadcast', event: 'sig', payload: { ...payload, from: this.me.id } });
  }

  async joinGame(game) {
    this.game = game;
    const used = new Set((game._players || []).map((p) => Number(p.seat || 0)));
    let seat = 2;
    while (used.has(seat) && seat <= 3) seat++;
    const { error } = await this.sb.from('room_players').upsert({
      room_id: game.id,
      user_id: this.me.id,
      seat: Math.min(seat, 3),
      display_name: this.me.name,
      hero: this.me.hero,
      ready: false,
      connection_state: 'online',
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'room_id,user_id' });
    if (error) throw new Error(error.message);
    this._joinGameChannel(game.id, false);
    // Give the websocket a beat to subscribe before knocking.
    await new Promise((r) => setTimeout(r, 800));
    this.signal({ t: 'knock', name: this.me.name });
  }

}

// The lobby is also a place to read about the world.
export const LORE = [
  ['The Long Dusk', 'Nobody agrees on when the plague began — only that the bells stopped ringing one by one, west to east, until the maps went quiet. What was left of the Marches learned a simple arithmetic: the dead do not sleep, but they do wait. They gather in the dark between the pines, and every sunset they remember you.'],
  ['The Keeps', 'The old kingdoms built their keeps on ley-crossings — plazas ringed by housing, mills at the treelines, gold veins within riding distance. That is why every ruin you reclaim feels planned: it was. You are not building a city. You are waking one up.'],
  ['The Three', 'Scott English walks slow because everything near him does — space thickens around that man, and his shotgun ends arguments the gravity started. Alexander Thomas kills from a horizon away while a cloud of nanites stitches his troops back together; when the dead close in, the grenade goes forward and he goes backward. And Danny Donovan? The horde has never seen Danny Donovan. It only feels itself getting thinner.'],
  ['The Bell', 'Ringing the bell is the oldest tactic in the survivor codex: choose your night, do not let it choose you. A city that hides from the dark starves; a city that greets it with ballistas eats well. Ring when ready — never before, rarely long after.'],
  ['The Zillion', 'At the bottom of the Black Vale something wears the plague like a crown. The chronicles call it The Zillion because the scouts who counted its horde never agreed on a number, only on a magnitude. Five keeps stand between it and the last dawn. Yours is one of them.'],
];

export const TIPS = [
  '🪙 Coins on the ground never expire — but uncollected coins are towers you don\'t have yet.',
  '🏰 The horde beacons are visible ALL day. Spend where the arrows point.',
  '🌪️ Hero levels grant upgrade points — choose Aura, Passive I, Passive II, or Ult Damage from the hero panel.',
  '🧱 Walls are not for stopping the horde. They are for choosing where it stands while your towers work.',
  '🎯 Ballista towers delete brutes and bosses; flame towers erase packed walkers. Mix them.',
  '⚔️ Press 1 at the gate before the wave hits — an army standing WITH you fights twice as well.',
  '⛏️ Gold mines pay double a manor — and the dead know it. Guard tower first, mine second.',
  '💀 In Survival, the horde never stops growing. Every night you survive is the record you\'ll brag about.',
  '🔐 Private rooms use join codes. Share the code with the commanders you want in the run.',
];
