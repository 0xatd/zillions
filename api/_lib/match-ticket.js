// Signed match tickets.
//
// POST /api/match-start issues one ticket per match. The ticket is
//   base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, MATCH_TICKET_SECRET))
// and its id is a row in public.match_tickets, so it can be spent once.
// /api/match-result refuses any report without a valid, unexpired, unused
// ticket that matches the reporting user and the mission being reported, and
// measures match length from the server's own issue time.
//
// Files under api/_lib are helpers, not routes (Vercel ignores "_" paths).
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const TICKET_VERSION = 1;
// A ticket must outlive a long match plus a resumed save.
export const TICKET_TTL_SECONDS = 48 * 3600;
const MIN_SECRET_LENGTH = 32;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (text) => Buffer.from(String(text), 'base64url');

export function ticketSecret(env = process.env) {
  const secret = env.MATCH_TICKET_SECRET || '';
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

const mac = (secret, text) => createHmac('sha256', secret).update(text).digest();

export function signTicket(payload, secret) {
  if (!secret) throw new Error('ticket_secret_missing');
  const body = b64url(JSON.stringify({ v: TICKET_VERSION, ...payload }));
  return `${body}.${b64url(mac(secret, `ticket:${body}`))}`;
}

// Returns { ok, payload } or { ok: false, error }. Checks signature, version,
// expiry, user and (when given) mission fields. Single use is enforced by the
// database when the report is applied.
export function verifyTicket(ticket, secret, { userId, levelId, mode, difficulty, roomId, now = Date.now() } = {}) {
  if (!secret) return { ok: false, error: 'ticket_secret_missing' };
  if (typeof ticket !== 'string' || ticket.length > 2048) return { ok: false, error: 'missing_ticket' };
  const [body, sig, extra] = ticket.split('.');
  if (!body || !sig || extra !== undefined) return { ok: false, error: 'invalid_ticket' };
  const expected = mac(secret, `ticket:${body}`);
  const given = fromB64url(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, error: 'invalid_ticket' };
  let payload;
  try { payload = JSON.parse(fromB64url(body).toString('utf8')); } catch { return { ok: false, error: 'invalid_ticket' }; }
  if (payload?.v !== TICKET_VERSION || typeof payload.tid !== 'string') return { ok: false, error: 'invalid_ticket' };
  if (!(Number(payload.exp) * 1000 > now)) return { ok: false, error: 'ticket_expired' };
  if (userId !== undefined && payload.uid !== userId) return { ok: false, error: 'ticket_mismatch', detail: 'user' };
  if (levelId !== undefined && payload.lvl !== levelId) return { ok: false, error: 'ticket_mismatch', detail: 'level' };
  if (mode !== undefined && payload.mode !== mode) return { ok: false, error: 'ticket_mismatch', detail: 'mode' };
  if (difficulty !== undefined && payload.diff !== difficulty) return { ok: false, error: 'ticket_mismatch', detail: 'difficulty' };
  if (roomId !== undefined && (payload.rid || null) !== (roomId || null)) return { ok: false, error: 'ticket_mismatch', detail: 'room' };
  return { ok: true, payload };
}

// Every peer in a room must run the same seed, and each peer fetches its own
// ticket, so room seeds are derived from the room id rather than random.
export function roomSeed(roomId, secret) {
  return mac(secret, `seed:${roomId}`).readUInt32BE(0);
}

export function soloSeed() {
  return randomInt(1, 0xffffffff);
}

// Invite-code co-op has no lobby. The signed-in host gets a private room and
// a join token; guests present it to be seated in that room.
export function joinToken(roomId, secret) {
  return b64url(mac(secret, `join:${roomId}`));
}

export function verifyJoinToken(roomId, token, secret) {
  if (!secret || typeof token !== 'string') return false;
  const expected = mac(secret, `join:${roomId}`);
  const given = fromB64url(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
