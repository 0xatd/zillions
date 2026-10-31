// Party rules. A party is the persistent group of friends. The match is still
// a room: the leader starts one, members stay in the party when it ends.
// This module is pure so the client and the checks agree before any row
// is written.

import {
  LABYRINTH_PARTY_LIMIT, PARTY_LIMIT, SIEGE_HEROES, coopPressure,
} from './coop.js';

const MODES = new Set(['campaign', 'survival', 'labyrinth']);
const DIFFICULTIES = new Set(['casual', 'normal', 'brutal']);

export function normalizePartyCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function partyCodeFromSearch(search) {
  const params = new URLSearchParams(search.startsWith('?') || search === '' ? search : `?${search}`);
  const code = normalizePartyCode(params.get('party') || '');
  return code.length === 6 ? code : null;
}

export function inviteLink(origin, code) {
  const base = String(origin || '').replace(/\/$/, '');
  const party = normalizePartyCode(code);
  return `${base}/?party=${party}`;
}

export function firstFreeHero(members, prefer = null) {
  const taken = new Set((members || []).map((m) => m.hero));
  if (prefer && SIEGE_HEROES.includes(prefer) && !taken.has(prefer)) return prefer;
  return SIEGE_HEROES.find((key) => !taken.has(key)) || null;
}

export function createPartyState({
  id, code, leaderId, leaderName, hero = 'scott',
  levelId = 1, mode = 'campaign', difficulty = 'normal',
}) {
  const party = {
    id,
    code: normalizePartyCode(code),
    leaderId,
    levelId: Number(levelId) || 1,
    mode: MODES.has(mode) ? mode : 'campaign',
    difficulty: DIFFICULTIES.has(difficulty) ? difficulty : 'normal',
    status: 'together',
    roomId: null,
    members: [],
  };
  const seat = firstFreeHero([], hero) || 'scott';
  party.members.push({
    userId: leaderId, name: leaderName || 'Commander', hero: seat, ready: false,
  });
  return party;
}

export function addMember(party, { userId, name, hero = null }) {
  if (!party) return { ok: false, reason: 'no_party' };
  if (party.members.some((m) => m.userId === userId)) return { ok: true, reason: 'already' };
  if (party.members.length >= PARTY_LIMIT) return { ok: false, reason: 'party_full' };
  const seat = firstFreeHero(party.members, hero);
  if (!seat) return { ok: false, reason: 'party_full' };
  party.members.push({ userId, name: name || 'Commander', hero: seat, ready: false });
  return { ok: true };
}

export function setHero(party, userId, hero) {
  if (!SIEGE_HEROES.includes(hero)) return { ok: false, reason: 'bad_hero' };
  const me = party?.members.find((m) => m.userId === userId);
  if (!me) return { ok: false, reason: 'missing' };
  if (party.members.some((m) => m.userId !== userId && m.hero === hero)) {
    return { ok: false, reason: 'hero_taken' };
  }
  me.hero = hero;
  if (userId !== party.leaderId) me.ready = false;
  return { ok: true };
}

export function setReady(party, userId, ready) {
  const me = party?.members.find((m) => m.userId === userId);
  if (!me) return { ok: false, reason: 'missing' };
  if (userId === party.leaderId) return { ok: true };
  me.ready = !!ready;
  return { ok: true };
}

export function setSetup(party, actorId, patch = {}) {
  if (!party) return { ok: false, reason: 'no_party' };
  if (party.leaderId !== actorId) return { ok: false, reason: 'not_leader' };
  if (party.status !== 'together') return { ok: false, reason: 'locked' };
  const mode = patch.mode || party.mode;
  if (!MODES.has(mode)) return { ok: false, reason: 'bad_mode' };
  const difficulty = patch.difficulty || party.difficulty;
  if (!DIFFICULTIES.has(difficulty)) return { ok: false, reason: 'bad_difficulty' };
  let levelId = patch.levelId != null ? Number(patch.levelId) : party.levelId;
  if (mode === 'labyrinth') levelId = levelId >= 9001 ? levelId : 9001;
  else if (!(levelId >= 1) || levelId >= 9001) levelId = 1;
  const changed = levelId !== party.levelId || mode !== party.mode || difficulty !== party.difficulty;
  party.levelId = levelId;
  party.mode = mode;
  party.difficulty = difficulty;
  if (changed) {
    for (const member of party.members) {
      if (member.userId !== party.leaderId) member.ready = false;
    }
  }
  return { ok: true };
}

export function kickMember(party, actorId, userId) {
  if (!party) return { ok: false, reason: 'no_party' };
  if (party.leaderId !== actorId) return { ok: false, reason: 'not_leader' };
  if (userId === actorId) return { ok: false, reason: 'not_self' };
  const next = party.members.filter((m) => m.userId !== userId);
  if (next.length === party.members.length) return { ok: false, reason: 'missing' };
  party.members = next;
  return { ok: true };
}

export function handoff(party, actorId, userId) {
  if (!party) return { ok: false, reason: 'no_party' };
  if (party.leaderId !== actorId) return { ok: false, reason: 'not_leader' };
  if (userId === actorId) return { ok: false, reason: 'already' };
  if (!party.members.some((m) => m.userId === userId)) return { ok: false, reason: 'missing' };
  party.leaderId = userId;
  return { ok: true };
}

export function leaveParty(party, userId) {
  if (!party) return { ok: false, reason: 'no_party' };
  const members = party.members.filter((m) => m.userId !== userId);
  if (members.length === party.members.length) return { ok: false, reason: 'missing' };
  if (!members.length) return { ok: true, dissolved: true, party: null };
  party.members = members;
  if (party.leaderId === userId) party.leaderId = members[0].userId;
  return { ok: true, dissolved: false, party };
}

export function canStart(party, userId) {
  if (!party) return { ok: false, reason: 'no_party' };
  if (party.leaderId !== userId) return { ok: false, reason: 'not_leader' };
  if (party.status === 'in_match' || party.status === 'staging') return { ok: false, reason: 'busy' };
  if (party.mode === 'labyrinth' && party.members.length > LABYRINTH_PARTY_LIMIT) {
    return { ok: false, reason: 'labyrinth_cap' };
  }
  const waiting = party.members.filter((m) => m.userId !== party.leaderId && !m.ready);
  if (waiting.length) return { ok: false, reason: 'need_ready' };
  return { ok: true };
}

export function attachRoom(party, actorId, roomId, status) {
  if (!party) return { ok: false, reason: 'no_party' };
  if (party.leaderId !== actorId) return { ok: false, reason: 'not_leader' };
  if (!['together', 'staging', 'in_match'].includes(status)) return { ok: false, reason: 'bad_status' };
  party.status = status;
  party.roomId = status === 'together' ? null : (roomId || null);
  if (status === 'together') {
    for (const member of party.members) member.ready = false;
  }
  return { ok: true };
}

export function pressureLabel(memberCount) {
  const mult = coopPressure(memberCount);
  return `Horde ×${mult.toFixed(1)}`;
}

// Public card. Level, planets, and matches come from server-owned rows.
// The portrait is the hero the player chose to show.
export function profileCard(row) {
  if (!row) return null;
  const hero = SIEGE_HEROES.includes(row.selected_hero) ? row.selected_hero : 'scott';
  const favorite = SIEGE_HEROES.includes(row.favorite_hero) ? row.favorite_hero : null;
  return {
    id: row.id,
    name: row.handle || row.display_name || 'commander',
    hero,
    favorite,
    level: Math.max(1, Number(row.level) || 1),
    planets: Math.max(0, Number(row.campaign_cleared) || 0),
    matches: Math.max(0, Number(row.games_played) || 0),
    wins: Math.max(0, Number(row.wins) || 0),
  };
}
