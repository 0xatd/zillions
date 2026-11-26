// Drop-in co-op invite links.
//
// A host copies one URL. A friend opening it takes the next hero seat and
// rides the existing WebRTC lockstep session. No account is required.
//
// Late join rule: a link admits players only while the lobby is open, before
// the host starts the siege. The hero list is fixed when lockstep window 0
// begins, so a new hero mid-fight would fork the hash. After start, the same
// link reports `started`. A player who already holds a seat can stay; a
// stranger cannot take a new one. Dropped heroes are not replaced mid-siege.
//
// The link expires two hours after the host creates it, or as soon as the
// host closes it. Four seats is the cap (one host and three friends), matching
// the room limit. A guest decides the host left from its own receipt clock,
// or from server presence, never by subtracting the host's wall clock.

import { HEROES } from './config.js';
import { CLIENT_VERSION, LOBBY_PROTOCOL_VERSION } from './online.js';

export const SHARE_MAX_PLAYERS = 4;
export const SHARE_TTL_MS = 2 * 60 * 60 * 1000;
export const SHARE_STALE_MS = 20000;
export const SHARE_CONNECT_GRACE_MS = 20000;
export const SHARE_SILENCE_MS = 5000;
export const SHARE_ABSENT_MS = 8000;
export const SHARE_DISCOVER_MS = 8000;
export const SHARE_HEARTBEAT_MS = 2000;
export const SHARE_LINK_FALLBACK_MS = 4000;
export const SHARE_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const SHARE_CODE_LENGTH = 10;

const CODE_RE = new RegExp(`^[${SHARE_CODE_ALPHABET}]{${SHARE_CODE_LENGTH}}$`);
const ID_RE = /^[0-9a-f-]{8,40}$/i;

export function createShareCode(bytes) {
  if (!bytes || bytes.length < SHARE_CODE_LENGTH) throw new Error('share_code_bytes');
  let code = '';
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) code += SHARE_CODE_ALPHABET[bytes[i] % SHARE_CODE_ALPHABET.length];
  return code;
}

export function randomShareCode(cryptoObj = globalThis.crypto) {
  const bytes = new Uint8Array(SHARE_CODE_LENGTH);
  cryptoObj.getRandomValues(bytes);
  return createShareCode(bytes);
}

export function shareUrl(origin, code, search = '') {
  const base = String(origin || '').replace(/\/$/, '');
  const incoming = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const params = new URLSearchParams();
  const quality = incoming.get('quality');
  if (quality) params.set('quality', quality);
  params.set('coop', code);
  return `${base}/?${params.toString()}`;
}

// A live realtime relay is already carrying the match. A late WebRTC
// handshake must not replace it: the guest keeps sending on the relay,
// and the host would then drop those commands while the world keeps ticking.
export function preferLiveRelay({ live = false, relayOpen = false, incomingRelay = false } = {}) {
  return !!(live && relayOpen && !incomingRelay);
}

// null when the page is not an invite. { ok:false } when the parameter is
// present but not a code we issued.
export function parseShareLocation(search) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (!params.has('coop')) return null;
  const code = String(params.get('coop') || '').trim().toLowerCase();
  if (!CODE_RE.test(code)) return { ok: false, reason: 'invalid' };
  return { ok: true, code };
}

export function shareName(value) {
  const clean = String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
  return clean || 'Commander';
}

export function shareHero(key) {
  return Object.prototype.hasOwnProperty.call(HEROES, key) ? key : 'scott';
}

export function shareId(value) {
  const id = String(value || '');
  return ID_RE.test(id) ? id : '';
}

let shareSeq = 0;
export function shareMessageId(now = Date.now()) {
  shareSeq = (shareSeq + 1) % 1000000000;
  return `${now.toString(36)}-${shareSeq}`;
}

export function createLobby({ code, hostId, hostName, hero, now, mode = 'campaign', level = 1, difficulty = 'normal', unlockedLevel = 1 }) {
  if (!CODE_RE.test(code)) throw new Error('invalid_share_code');
  const id = shareId(hostId);
  if (!id) throw new Error('invalid_share_host');
  const at = Number(now) || 0;
  return {
    v: 1,
    code,
    hostId: id,
    hostName: shareName(hostName),
    createdAt: at,
    expiresAt: at + SHARE_TTL_MS,
    seenAt: at,
    started: false,
    closed: false,
    mode: mode === 'survival' || mode === 'labyrinth' ? mode : 'campaign',
    level: Math.max(1, Number(level) || 1),
    difficulty: typeof difficulty === 'string' ? difficulty : 'normal',
    maxPlayers: mode === 'labyrinth' ? 3 : SHARE_MAX_PLAYERS,
    protocolVersion: LOBBY_PROTOCOL_VERSION,
    clientVersion: CLIENT_VERSION,
    seats: [{
      id, name: shareName(hostName), hero: shareHero(hero), host: true, ready: true,
      unlockedLevel: shareUnlocked(unlockedLevel), joinedAt: at,
    }],
  };
}

export function publicShareLobby(lobby) {
  return {
    v: 1,
    code: lobby.code,
    hostId: lobby.hostId,
    hostName: lobby.hostName,
    createdAt: lobby.createdAt,
    expiresAt: lobby.expiresAt,
    seenAt: lobby.seenAt,
    started: !!lobby.started,
    starting: !!lobby.starting,
    closed: !!lobby.closed,
    hostBoot: Number(lobby.hostBoot) || 0,
    endedReason: lobby.endedReason === 'host_reloaded' ? 'host_reloaded' : '',
    banned: (lobby.banned || []).filter((id) => shareId(id)),
    matchEnd: lobby.matchEnd?.reason ? {
      won: !!lobby.matchEnd.won,
      reason: String(lobby.matchEnd.reason).slice(0, 180),
    } : null,
    mode: lobby.mode,
    level: lobby.level,
    difficulty: lobby.difficulty,
    maxPlayers: lobby.maxPlayers === 3 ? 3 : SHARE_MAX_PLAYERS,
    protocolVersion: Number(lobby.protocolVersion) || 0,
    clientVersion: String(lobby.clientVersion || ''),
    seats: (lobby.seats || []).map((seat) => ({
      id: seat.id,
      name: shareName(seat.name),
      hero: shareHero(seat.hero),
      host: !!seat.host,
      ready: !!seat.host || !!seat.ready,
      linked: !!seat.linked,
      transport: seat.transport === 'relay' || seat.transport === 'webrtc' ? seat.transport : '',
      unlockedLevel: shareUnlocked(seat.unlockedLevel),
      joinedAt: Number(seat.joinedAt) || lobby.createdAt || 0,
    })),
  };
}

export function shareUnlocked(value) {
  const level = Math.floor(Number(value));
  return Number.isFinite(level) && level >= 1 && level < 1000000 ? level : 1;
}

// The lobby and the joining client must be this build. A missing claim is a
// heartbeat, not a new seat. A claim without both versions is an old tab.
export function shareClientMatch(lobby, guest = {}) {
  const lobbyOk = Number(lobby?.protocolVersion) === LOBBY_PROTOCOL_VERSION
    && String(lobby?.clientVersion || '') === CLIENT_VERSION;
  if (!lobbyOk) return { ok: false, reason: 'incompatible' };
  if (!guest.claim) return { ok: true };
  const guestOk = Number(guest.protocolVersion) === LOBBY_PROTOCOL_VERSION
    && String(guest.clientVersion || '') === CLIENT_VERSION;
  return guestOk ? { ok: true } : { ok: false, reason: 'incompatible' };
}

export function shareBlockers(lobby) {
  if ((lobby?.mode || 'campaign') !== 'campaign') return [];
  const level = Math.max(1, Math.floor(Number(lobby?.level) || 1));
  return (lobby?.seats || [])
    .filter((seat) => shareUnlocked(seat.unlockedLevel) < level)
    .map((seat) => ({ id: seat.id, name: seat.name, unlockedLevel: shareUnlocked(seat.unlockedLevel) }));
}

export function shareLaunchReady(lobby, openIds = new Set()) {
  const guests = (lobby?.seats || []).filter((seat) => !seat.host);
  const connectingSeats = guests.filter((seat) => !openIds.has(seat.id));
  const notReady = guests.filter((seat) => openIds.has(seat.id) && !seat.ready);
  const waiting = guests.filter((seat) => !seat.ready || !openIds.has(seat.id));
  const blockers = shareBlockers(lobby);
  return {
    ready: waiting.length === 0 && blockers.length === 0,
    waiting,
    blockers,
    connectingSeats,
    notReady,
    connecting: connectingSeats.length > 0,
  };
}

export function shareStartLabel(players, gate, soloCopy = '▶  START — TAKE THE PLANET') {
  const list = players || [];
  if (gate?.blockers?.length) {
    return `WAITING FOR ${gate.blockers.map((seat) => seat.name).join(', ')} — MISSION LOCKED`;
  }
  if (gate?.connectingSeats?.length) {
    return `WAITING FOR ${gate.connectingSeats.map((seat) => seat.name).join(', ')} TO CONNECT`;
  }
  if (gate?.notReady?.length) {
    return `WAITING FOR ${gate.notReady.map((seat) => seat.name).join(', ')} TO READY`;
  }
  if (list.length > 1) return `▶  START — ${list.length} HEROES`;
  return soloCopy;
}

// `receivedAt` is when THIS client last heard the host. `hostPresent` is the
// server presence bit. Without either, fall back to the lobby timestamp,
// which is only meaningful on the host's own clock.
export function hostStillHere(lobby, now, { receivedAt = null, hostPresent = false } = {}) {
  if (!lobby || lobby.closed) return false;
  if (lobby.started) return true;
  if (hostPresent) return true;
  const basis = receivedAt == null ? Number(lobby.seenAt || 0) : Number(receivedAt);
  if (!basis) return false;
  return Number(now) - basis <= SHARE_STALE_MS;
}

// Drop guests the host has not heard from. joinedAt is that clock: a heartbeat
// (`here`) or any later signal refreshes it. A linked seat is not immortal.
// A hidden tab and a slow client keep sending heartbeats from a worker, so
// they stay. A closed tab stops, and about five seconds of silence removes it.
// Presence is only a hint: a hidden tab can drop presence while the heartbeat
// continues, and that tab must stay seated.
export function reapStaleSeats(lobby, now, {
  silenceMs = SHARE_SILENCE_MS,
} = {}) {
  if (!lobby || lobby.started) return { lobby, dropped: [] };
  const at = Number(now) || 0;
  const limit = Number(silenceMs) > 0 ? Number(silenceMs) : SHARE_SILENCE_MS;
  const dropped = [];
  const seats = (lobby.seats || []).filter((seat) => {
    if (seat.host) return true;
    const since = Number(seat.joinedAt || lobby.createdAt || 0);
    if (at - since >= limit) { dropped.push(seat); return false; }
    return true;
  });
  if (!dropped.length) return { lobby, dropped };
  return { lobby: touchLobby({ ...lobby, seats }, at), dropped };
}

export function markStarting(lobby, now) {
  return touchLobby({ ...lobby, starting: true }, now);
}

export function touchSeatActivity(lobby, id, now) {
  if (!lobby?.seats?.some((seat) => seat.id === id)) return lobby;
  return touchLobby({
    ...lobby,
    seats: lobby.seats.map((seat) => (seat.id === id ? { ...seat, joinedAt: Number(now) || seat.joinedAt } : seat)),
  }, now);
}

export function seatDisplayName({ accountName = '', username = '', founderName = '', profileName = '' } = {}) {
  return shareName(accountName || username || founderName || profileName);
}

// A joiner who never chose a name gets Guest plus their own id. Vanguard is
// the automatic founder, not a name anyone picked. The host's name is never
// reused, or the blocker line reads as two copies of the host.
const UNNAMED_JOINER = new Set(['', 'commander', 'vanguard']);
export function shareGuestName({ name = '', id = '', hostName = '' } = {}) {
  const clean = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
  const host = String(hostName || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
  const tail = (String(id || '').replace(/[^0-9a-z]/gi, '').slice(-4) || '0000').toUpperCase();
  const unnamed = !clean || UNNAMED_JOINER.has(clean.toLowerCase());
  if (unnamed || (host && clean.toLowerCase() === host.toLowerCase())) return `Guest ${tail}`;
  return clean;
}

// The seat label and START share this. Connected means the chosen transport
// has carried a message both ways. A seat that is only present is still connecting.
export function shareSeatState(seat) {
  const linked = !!seat?.host || !!seat?.linked;
  return {
    state: linked ? 'connected' : 'connecting',
    ready: !!seat?.host || !!seat?.ready,
  };
}

function seatNumber(lobby, id) {
  const index = lobby.seats.findIndex((seat) => seat.id === id);
  return index < 0 ? 0 : index + 1;
}

// Host is player 0. Every other seat keeps the index it had when the heroes
// were created, which is its place among guests. A peer-array slot can move
// after a rejoin; the seat does not.
export function sharePlayerIndex(lobby, id) {
  if (!lobby || !id) return 0;
  if (id === lobby.hostId) return 0;
  const seat = (lobby.seats || []).find((entry) => entry.id === id);
  if (!seat || seat.host) return 0;
  const guests = (lobby.seats || []).filter((entry) => !entry.host);
  const index = guests.findIndex((entry) => entry.id === id);
  return index < 0 ? 0 : index + 1;
}

// Decide whether `guest` may take a seat. Does not mutate the lobby.
export function admitGuest(lobby, guest, now, liveness = {}) {
  if (!lobby || !CODE_RE.test(lobby.code) || !guest) return { ok: false, reason: 'invalid' };
  const id = shareId(guest.id);
  if (!id || id === lobby.hostId) return { ok: false, reason: 'invalid' };
  if ((lobby.banned || []).includes(id)) return { ok: false, reason: 'removed' };
  if (lobby.closed) return { ok: false, reason: 'host_left' };
  const at = Number(now) || 0;
  const seated = lobby.seats.find((seat) => seat.id === id && !seat.host);
  if (!lobby.started && !hostStillHere(lobby, at, liveness)) return { ok: false, reason: 'host_left' };
  if (!lobby.started && at >= Number(lobby.expiresAt || 0)) return { ok: false, reason: 'expired' };
  if (lobby.started) {
    return seated
      ? { ok: true, seat: seatNumber(lobby, id), seated: true, started: true }
      : { ok: false, reason: 'started' };
  }
  const versions = shareClientMatch(lobby, guest);
  if (!versions.ok) return versions;
  if (seated) return { ok: true, seat: seatNumber(lobby, id), rejoining: true };
  const cap = lobby.maxPlayers === 3 ? 3 : SHARE_MAX_PLAYERS;
  if (lobby.seats.length >= cap) return { ok: false, reason: 'full' };
  return { ok: true, seat: lobby.seats.length + 1 };
}

export function touchLobby(lobby, now) {
  return { ...lobby, seenAt: Number(now) || lobby.seenAt };
}

export function seatGuest(lobby, guest, now) {
  const decision = admitGuest(lobby, guest, now);
  if (!decision.ok || decision.rejoining || decision.seated) return { lobby, ...decision };
  const seats = [...lobby.seats, {
    id: shareId(guest.id),
    name: shareName(guest.name),
    hero: shareHero(guest.hero),
    host: false,
    ready: !!guest.ready,
    linked: false,
    transport: '',
    unlockedLevel: shareUnlocked(guest.unlockedLevel),
    joinedAt: Number(now) || 0,
  }];
  return { lobby: touchLobby({ ...lobby, seats }, now), ...decision, seat: seats.length };
}

export function withSeatHero(lobby, id, hero, name, now) {
  if (!lobby?.seats?.some((seat) => seat.id === id)) return lobby;
  return touchLobby({
    ...lobby,
    seats: lobby.seats.map((seat) => {
      if (seat.id !== id) return seat;
      const nextHero = shareHero(hero);
      return {
        ...seat,
        hero: nextHero,
        name: name ? shareName(name) : seat.name,
        ready: seat.host ? true : nextHero !== seat.hero ? false : !!seat.ready,
      };
    }),
  }, now);
}

// Free a seat only before the siege starts. After start the hero fights on.
export function releaseGuest(lobby, id, now) {
  if (!lobby || lobby.started) return lobby;
  return touchLobby({
    ...lobby,
    seats: lobby.seats.filter((seat) => seat.host || seat.id !== id),
  }, now);
}

// Remove a guest even after the siege has started, and refuse that tab if it
// tries to sit down again on its own.
export function evictGuest(lobby, id, now) {
  if (!lobby || !id) return lobby;
  const banned = [...new Set([...(lobby.banned || []), id])];
  return touchLobby({
    ...lobby,
    banned,
    seats: (lobby.seats || []).filter((seat) => seat.host || seat.id !== id),
  }, now);
}

export function markStarted(lobby, now) {
  return touchLobby({ ...lobby, started: true }, now);
}

export function closeLobby(lobby, now) {
  return touchLobby({ ...lobby, closed: true }, now);
}

export function clearGuestReady(lobby, now) {
  return touchLobby({
    ...lobby,
    seats: (lobby?.seats || []).map((seat) => (seat.host ? { ...seat, ready: true } : { ...seat, ready: false })),
  }, now);
}

export function setSeatReady(lobby, id, ready, now) {
  return touchLobby({
    ...lobby,
    seats: (lobby?.seats || []).map((seat) => (seat.id === id && !seat.host ? { ...seat, ready: !!ready } : seat)),
  }, now);
}

export function shareRoster(lobby, selfId) {
  return (lobby?.seats || []).map((seat, index) => {
    const view = shareSeatState(seat);
    return {
      seat: index + 1,
      id: seat.id,
      name: seat.name,
      hero: seat.hero,
      host: !!seat.host,
      you: seat.id === selfId,
      ready: view.ready,
      unlockedLevel: shareUnlocked(seat.unlockedLevel),
      state: view.state,
    };
  });
}

export function shareFailureCopy(reason) {
  switch (reason) {
    case 'invalid': return 'This invite link is not valid.';
    case 'expired': return 'This invite has expired. Ask the host for a new link.';
    case 'full': return 'This siege is full.';
    case 'incompatible': return 'This invite is from a different game version. Refresh both browsers and make a new link.';
    case 'host_left': return 'The host left this siege.';
    case 'started': return 'This siege has already started. Friends join before the host launches, not mid-fight.';
    case 'removed': return 'The host removed you.';
    default: return 'Could not join this siege.';
  }
}
