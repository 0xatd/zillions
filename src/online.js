// Online lobby: player identity, friends, public game list, global chat and
// automatic WebRTC signaling — built on Supabase (Postgres + Realtime).
// The anon key is a publishable client key (RLS is on); no secrets live here.
import { createClient } from '../vendor/supabase.js';

const SUPABASE_URL = 'https://qgvpfkncgpqtxxozatax.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PBjvMyJzhJMO4XhZHABmaw_VmA7BQDg';

const FRESH_MS = 2 * 60 * 1000; // games with no heartbeat for 2min are stale

function randomCode(n = 6) {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += abc[(Math.random() * abc.length) | 0];
  return s;
}

export class OnlineLobby {
  constructor(cb = {}) {
    this.cb = cb; // {onChat, onGames, onOnline, onInvite, onKnock, onSignal, onError}
    this.sb = null;
    this.me = null;          // {id, code, name}
    this.friends = [];
    this.online = new Map(); // playerId -> name (lobby presence)
    this.game = null;        // the game row we host or joined
    this.gameChan = null;
    this.connected = false;
  }

  async connect(name) {
    if (this.sb) return this.me;
    this.sb = createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { params: { eventsPerSecond: 5 } } });
    // Device identity: a uuid minted once and kept in localStorage.
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('zillions_online') || 'null'); } catch { /* ignore */ }
    if (!stored || !stored.id) {
      stored = { id: crypto.randomUUID(), code: randomCode() };
      try { localStorage.setItem('zillions_online', JSON.stringify(stored)); } catch { /* ignore */ }
    }
    this.me = { id: stored.id, code: stored.code, name: name || 'Commander' };
    const { error } = await this.sb.from('zillions_players').upsert({
      id: this.me.id, code: this.me.code, name: this.me.name, last_seen: new Date().toISOString(),
    });
    if (error) throw new Error('lobby unreachable: ' + error.message);
    this.connected = true;

    // Global chat + game list live updates.
    this.sb.channel('zl-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'zillions_chat' },
        (p) => this.cb.onChat && this.cb.onChat(p.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zillions_games' },
        () => this.refreshGames())
      .subscribe();

    // Lobby presence: who's online.
    this.presence = this.sb.channel('zl-lobby', { config: { presence: { key: this.me.id } } });
    this.presence
      .on('presence', { event: 'sync' }, () => {
        this.online.clear();
        const state = this.presence.presenceState();
        for (const [id, metas] of Object.entries(state)) this.online.set(id, metas[0]?.name || '?');
        if (this.cb.onOnline) this.cb.onOnline(this.online);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await this.presence.track({ name: this.me.name });
      });

    // My personal channel: friend invites arrive here.
    this.sb.channel('zl-user-' + this.me.id)
      .on('broadcast', { event: 'invite' }, (m) => this.cb.onInvite && this.cb.onInvite(m.payload))
      .subscribe();

    return this.me;
  }

  async setName(name) {
    if (!this.me) return;
    this.me.name = name;
    await this.sb.from('zillions_players').update({ name }).eq('id', this.me.id);
    if (this.presence) await this.presence.track({ name });
  }

  // ---------- chat ----------

  async loadChat() {
    const { data } = await this.sb.from('zillions_chat')
      .select('name,text,created_at').order('created_at', { ascending: false }).limit(40);
    return (data || []).reverse();
  }

  async sendChat(text) {
    text = String(text).slice(0, 400).trim();
    if (!text) return;
    await this.sb.from('zillions_chat').insert({ player_id: this.me.id, name: this.me.name, text });
  }

  // ---------- games ----------

  async refreshGames() {
    const since = new Date(Date.now() - FRESH_MS).toISOString();
    const { data } = await this.sb.from('zillions_games')
      .select('*').eq('visibility', 'public').eq('status', 'open')
      .gt('updated_at', since).order('created_at', { ascending: false }).limit(20);
    if (this.cb.onGames) this.cb.onGames(data || []);
    return data || [];
  }

  async createGame({ visibility = 'public', level = 1, mode = 'campaign' } = {}) {
    const join_code = randomCode();
    const { data, error } = await this.sb.from('zillions_games').insert({
      name: `${this.me.name}'s war`, host_id: this.me.id, host_name: this.me.name,
      visibility, join_code, level, mode,
    }).select().single();
    if (error) throw new Error(error.message);
    this.game = data;
    this._joinGameChannel(data.id, true);
    // Heartbeat so the listing stays fresh; stops when the page dies.
    this._beat = setInterval(() => this.touchGame({}), 45 * 1000);
    window.addEventListener('beforeunload', () => this.endGame());
    return data;
  }

  async touchGame(fields) {
    if (!this.game) return;
    await this.sb.from('zillions_games')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', this.game.id);
  }

  async endGame() {
    if (!this.game) return;
    clearInterval(this._beat);
    try { await this.sb.from('zillions_games').update({ status: 'ended' }).eq('id', this.game.id); } catch { /* closing */ }
    this.game = null;
  }

  async findByCode(code) {
    const { data } = await this.sb.from('zillions_games')
      .select('*').eq('join_code', String(code).trim().toUpperCase()).eq('status', 'open').limit(1);
    return data && data[0];
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
    this._joinGameChannel(game.id, false);
    // Give the websocket a beat to subscribe before knocking.
    await new Promise((r) => setTimeout(r, 800));
    this.signal({ t: 'knock', name: this.me.name });
  }

  // ---------- friends ----------

  async addFriend(code) {
    code = String(code).trim().toUpperCase();
    const { data } = await this.sb.from('zillions_players').select('id,name,code').eq('code', code).limit(1);
    const f = data && data[0];
    if (!f) return { ok: false, why: 'No commander with that code.' };
    if (f.id === this.me.id) return { ok: false, why: 'That is your own code.' };
    await this.sb.from('zillions_friends').upsert({ player_id: this.me.id, friend_id: f.id });
    // Friendship is mutual — write the reverse row too so they see you.
    await this.sb.from('zillions_friends').upsert({ player_id: f.id, friend_id: this.me.id });
    await this.loadFriends();
    return { ok: true, name: f.name };
  }

  async loadFriends() {
    const { data } = await this.sb.from('zillions_friends')
      .select('friend_id, zillions_players!zillions_friends_friend_id_fkey(id,name,code)')
      .eq('player_id', this.me.id);
    this.friends = (data || []).map((r) => r.zillions_players).filter(Boolean);
    return this.friends;
  }

  // Ping a friend's personal channel with a join-me invite.
  async inviteFriend(friendId) {
    if (!this.game) return;
    const ch = this.sb.channel('zl-user-' + friendId);
    await new Promise((resolve) => ch.subscribe((s) => s === 'SUBSCRIBED' && resolve()));
    ch.send({
      type: 'broadcast', event: 'invite',
      payload: { gameId: this.game.id, joinCode: this.game.join_code, fromName: this.me.name, mode: this.game.mode, level: this.game.level },
    });
    setTimeout(() => this.sb.removeChannel(ch), 3000);
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
  '🌪️ Your special ranks up automatically at hero levels 4 and 7 — hunt creeps by day for XP.',
  '🧱 Walls are not for stopping the horde. They are for choosing where it stands while your towers work.',
  '🎯 Ballista towers delete brutes and bosses; flame towers erase packed walkers. Mix them.',
  '⚔️ Press 1 at the gate before the wave hits — an army standing WITH you fights twice as well.',
  '⛏️ Gold mines pay double a manor — and the dead know it. Guard tower first, mine second.',
  '💀 In Survival, the horde never stops growing. Every night you survive is the record you\'ll brag about.',
  '🤝 Add friends with their commander code — invite them straight into your war from the lobby.',
];
