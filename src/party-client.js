// Supabase party session. Combat stays on the lockstep peers. This class
// only reads and writes the party, its chat, and public profile cards.
//
// The migration that creates these tables is in the repo and is not applied
// to the live project. Calls fail clearly until it is.

import { prepareChat } from './social-chat.js';
import { profileCard } from './party.js';

const PARTY_SELECT = 'id,code,leader_id,level_id,mode,difficulty,status,room_id,party_members(user_id,display_name,hero,ready,joined_at)';

function failMessage(error) {
  const text = `${error?.message || error?.details || error || ''}`;
  if (/party_full/.test(text)) return 'That party is full (4 commanders).';
  if (/hero_taken/.test(text)) return 'Another commander already rides that hero.';
  if (/already_in_party/.test(text)) return 'Leave your current party first.';
  if (/no_party/.test(text)) return 'No party uses that code.';
  if (/blocked/.test(text)) return 'A block stops that invite.';
  if (/not_leader/.test(text)) return 'Only the party leader can do that.';
  if (/chat_rate/.test(text)) return 'Slow down — party chat is limited.';
  if (/relation .* does not exist|schema cache|Could not find the function/i.test(text)) {
    return 'Parties are not on the server yet. The migration is in the repo and has not been applied.';
  }
  return text || 'Party update failed.';
}

function rowToParty(row) {
  if (!row) return null;
  const members = [...(row.party_members || [])]
    .sort((a, b) => String(a.joined_at || '').localeCompare(String(b.joined_at || '')))
    .map((m) => ({
      userId: m.user_id,
      name: m.display_name || 'Commander',
      hero: m.hero,
      ready: !!m.ready,
    }));
  return {
    id: row.id,
    code: row.code,
    leaderId: row.leader_id,
    levelId: row.level_id,
    mode: row.mode,
    difficulty: row.difficulty,
    status: row.status,
    roomId: row.room_id,
    members,
  };
}

export class PartyClient {
  constructor(sb, me, cb = {}) {
    this.sb = sb;
    this.me = me;
    this.cb = cb;
    this.party = null;
    this.chat = [];
    this.recentSends = [];
    this.mutes = new Set();
    this.blocks = new Set();
    this.channel = null;
    this._seenChat = new Set();
  }

  async start() {
    await this.loadMutes();
    await this.refresh();
    return this.party;
  }

  stop() {
    if (this.channel) this.sb.removeChannel(this.channel);
    this.channel = null;
  }

  async refresh() {
    const { data, error } = await this.sb.from('party_members')
      .select('party_id')
      .eq('user_id', this.me.id)
      .maybeSingle();
    if (error) throw new Error(failMessage(error));
    if (!data?.party_id) {
      this._setParty(null);
      return null;
    }
    return this._load(data.party_id);
  }

  async createParty() {
    const { data, error } = await this.sb.rpc('create_party');
    if (error) throw new Error(failMessage(error));
    return this._load(data);
  }

  async joinCode(code) {
    const { data, error } = await this.sb.rpc('join_party', { p_code: code });
    if (error) throw new Error(failMessage(error));
    return this._load(data);
  }

  async leave() {
    const { error } = await this.sb.rpc('leave_party');
    if (error) throw new Error(failMessage(error));
    this._setParty(null);
    return null;
  }

  async kick(userId) {
    const { error } = await this.sb.rpc('kick_party_member', { p_user: userId });
    if (error) throw new Error(failMessage(error));
    return this.refresh();
  }

  async handoff(userId) {
    const { error } = await this.sb.rpc('handoff_party', { p_user: userId });
    if (error) throw new Error(failMessage(error));
    return this.refresh();
  }

  async setHero(hero) {
    const { error } = await this.sb.rpc('set_party_hero', { p_hero: hero });
    if (error) throw new Error(failMessage(error));
    return this.refresh();
  }

  async setReady(ready) {
    const { error } = await this.sb.rpc('set_party_ready', { p_ready: !!ready });
    if (error) throw new Error(failMessage(error));
    return this.refresh();
  }

  async setSetup(patch) {
    const { error } = await this.sb.rpc('set_party_setup', {
      p_level: patch.levelId,
      p_mode: patch.mode,
      p_difficulty: patch.difficulty,
    });
    if (error) throw new Error(failMessage(error));
    return this.refresh();
  }

  async setRoom(roomId, status) {
    const { error } = await this.sb.rpc('set_party_room', { p_room: roomId, p_status: status });
    if (error) throw new Error(failMessage(error));
    return this.refresh();
  }

  async sendChat(text) {
    if (!this.party) return null;
    const prepared = prepareChat(text, { channel: 'party', recent: this.recentSends });
    if (!prepared.ok) throw new Error(prepared.error === 'rate' ? 'Slow down — party chat is limited.' : 'Empty message.');
    this.recentSends = prepared.recent;
    const { error } = await this.sb.from('party_chat').insert({
      party_id: this.party.id,
      user_id: this.me.id,
      message: prepared.text,
    });
    if (error) throw new Error(failMessage(error));
    return prepared.text;
  }

  async loadProfile(userId) {
    const { data, error } = await this.sb.rpc('public_commander', { p_user: userId });
    if (error) throw new Error(failMessage(error));
    const row = Array.isArray(data) ? data[0] : data;
    return profileCard(row);
  }

  async loadMutes() {
    const { data, error } = await this.sb.from('player_mutes')
      .select('blocked_id,kind')
      .eq('blocker_id', this.me.id);
    if (error) {
      if (/does not exist|schema cache/i.test(error.message || '')) return;
      throw new Error(failMessage(error));
    }
    this.mutes = new Set();
    this.blocks = new Set();
    for (const row of data || []) {
      if (row.kind === 'block') this.blocks.add(row.blocked_id);
      if (row.kind === 'mute') this.mutes.add(row.blocked_id);
    }
  }

  async setRelation(userId, kind) {
    if (!userId || userId === this.me.id) return;
    const { error } = await this.sb.from('player_mutes').upsert({
      blocker_id: this.me.id,
      blocked_id: userId,
      kind,
    });
    if (error) throw new Error(failMessage(error));
    await this.loadMutes();
  }

  async clearRelation(userId, kind) {
    const { error } = await this.sb.from('player_mutes')
      .delete()
      .eq('blocker_id', this.me.id)
      .eq('blocked_id', userId)
      .eq('kind', kind);
    if (error) throw new Error(failMessage(error));
    await this.loadMutes();
  }

  allowsChat(userId) {
    return userId === this.me.id || (!this.mutes.has(userId) && !this.blocks.has(userId));
  }

  async _load(partyId) {
    const { data, error } = await this.sb.from('parties')
      .select(PARTY_SELECT)
      .eq('id', partyId)
      .maybeSingle();
    if (error) throw new Error(failMessage(error));
    this._setParty(rowToParty(data));
    if (this.party) await this._loadChat();
    return this.party;
  }

  async _loadChat() {
    const { data, error } = await this.sb.from('party_chat')
      .select('id,user_id,message,created_at')
      .eq('party_id', this.party.id)
      .order('created_at', { ascending: true })
      .limit(40);
    if (error) throw new Error(failMessage(error));
    this.chat = [];
    this._seenChat = new Set();
    for (const row of data || []) this._pushChat(row);
    if (this.cb.onChatReset) this.cb.onChatReset(this.chat);
  }

  _pushChat(row) {
    if (!row?.id || this._seenChat.has(row.id)) return;
    this._seenChat.add(row.id);
    if (!this.allowsChat(row.user_id)) return;
    const member = this.party?.members.find((m) => m.userId === row.user_id);
    const message = {
      id: row.id,
      user_id: row.user_id,
      name: row.user_id === this.me.id ? this.me.name : (member?.name || 'Commander'),
      text: row.message,
      created_at: row.created_at,
    };
    this.chat.push(message);
    if (this.chat.length > 40) this.chat.shift();
    if (this.cb.onChat) this.cb.onChat(message);
  }

  _setParty(party) {
    const prev = this.party?.id;
    this.party = party;
    if (party?.id !== prev) this._subscribe(party?.id || null);
    if (this.cb.onParty) this.cb.onParty(party);
  }

  _subscribe(partyId) {
    if (this.channel) this.sb.removeChannel(this.channel);
    this.channel = null;
    if (!partyId) return;
    this.channel = this.sb.channel(`zl-party-${partyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties', filter: `id=eq.${partyId}` }, () => {
        this._load(partyId).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'party_members', filter: `party_id=eq.${partyId}` }, () => {
        this._load(partyId).catch(() => {});
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'party_chat', filter: `party_id=eq.${partyId}` }, (payload) => {
        this._pushChat(payload.new);
      })
      .subscribe();
  }
}
