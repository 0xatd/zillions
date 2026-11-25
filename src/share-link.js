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
// the room limit. A host heartbeat older than eight seconds means the host left.

import { HEROES } from './config.js';

export const SHARE_MAX_PLAYERS = 4;
export const SHARE_TTL_MS = 2 * 60 * 60 * 1000;
export const SHARE_STALE_MS = 8000;
export const SHARE_DISCOVER_MS = 8000;
export const SHARE_HEARTBEAT_MS = 2000;
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

export function shareUrl(origin, code) {
  const base = String(origin || '').replace(/\/$/, '');
  return `${base}/?coop=${code}`;
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

export function createLobby({ code, hostId, hostName, hero, now, mode = 'campaign', level = 1, difficulty = 'normal' }) {
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
    seats: [{ id, name: shareName(hostName), hero: shareHero(hero), host: true }],
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
    closed: !!lobby.closed,
    mode: lobby.mode,
    level: lobby.level,
    difficulty: lobby.difficulty,
    maxPlayers: lobby.maxPlayers === 3 ? 3 : SHARE_MAX_PLAYERS,
    seats: (lobby.seats || []).map((seat) => ({
      id: seat.id,
      name: shareName(seat.name),
      hero: shareHero(seat.hero),
      host: !!seat.host,
    })),
  };
}

function seatNumber(lobby, id) {
  const index = lobby.seats.findIndex((seat) => seat.id === id);
  return index < 0 ? 0 : index + 1;
}

// Decide whether `guest` may take a seat. Does not mutate the lobby.
export function admitGuest(lobby, guest, now) {
  if (!lobby || !CODE_RE.test(lobby.code) || !guest) return { ok: false, reason: 'invalid' };
  const id = shareId(guest.id);
  if (!id || id === lobby.hostId) return { ok: false, reason: 'invalid' };
  if (lobby.closed) return { ok: false, reason: 'host_left' };
  const at = Number(now) || 0;
  const seated = lobby.seats.find((seat) => seat.id === id && !seat.host);
  if (!lobby.started && at - Number(lobby.seenAt || 0) > SHARE_STALE_MS) return { ok: false, reason: 'host_left' };
  if (!lobby.started && at >= Number(lobby.expiresAt || 0)) return { ok: false, reason: 'expired' };
  if (lobby.started) {
    return seated
      ? { ok: true, seat: seatNumber(lobby, id), seated: true, started: true }
      : { ok: false, reason: 'started' };
  }
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
  }];
  return { lobby: touchLobby({ ...lobby, seats }, now), ...decision, seat: seats.length };
}

export function withSeatHero(lobby, id, hero, name, now) {
  if (!lobby?.seats?.some((seat) => seat.id === id)) return lobby;
  return touchLobby({
    ...lobby,
    seats: lobby.seats.map((seat) => (seat.id === id
      ? { ...seat, hero: shareHero(hero), name: name ? shareName(name) : seat.name }
      : seat)),
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

export function markStarted(lobby, now) {
  return touchLobby({ ...lobby, started: true }, now);
}

export function closeLobby(lobby, now) {
  return touchLobby({ ...lobby, closed: true }, now);
}

export function shareRoster(lobby, selfId) {
  return (lobby?.seats || []).map((seat, index) => ({
    seat: index + 1,
    name: seat.name,
    hero: seat.hero,
    host: !!seat.host,
    you: seat.id === selfId,
    state: 'connected',
  }));
}

export function shareFailureCopy(reason) {
  switch (reason) {
    case 'invalid': return 'This invite link is not valid.';
    case 'expired': return 'This invite has expired. Ask the host for a new link.';
    case 'full': return 'This siege is full.';
    case 'host_left': return 'The host left this siege.';
    case 'started': return 'This siege has already started. Friends join before the host launches, not mid-fight.';
    default: return 'Could not join this siege.';
  }
}
