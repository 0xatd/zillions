// POST /api/match-start — issues the signed, single-use ticket a signed-in
// player needs to be credited for a match.
//
// Body: { characterId, levelId, mode, difficulty,
//         roomId?,              lobby room or invite-code room
//         joinToken?,           invite-code guests: the host's token
//         manualCoop?: { displayName, hero } }  invite-code host: make a room
//
// Response: { ok, ticket, ticketId, seed, roomId, joinToken?, expiresAt }
//
// The seed is the match seed every peer must run (Game opts.rngSeed). Room
// seeds are derived from the room id so each peer's own ticket carries the
// same seed; solo seeds are random.
import { DIFFICULTY, levelById, isLabyrinthLevel } from '../src/config.js';
import { MATCH_MODES } from '../src/match-rewards.js';
import {
  TICKET_TTL_SECONDS, joinToken, roomSeed, signTicket, soloSeed, ticketSecret, verifyJoinToken,
} from './_lib/match-ticket.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const BODY_LIMIT = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RPC_ERRORS = {
  rate_limited: 429, not_a_room_participant: 403, room_not_found: 404, room_not_started: 409,
  room_full: 409, profile_not_found: 404, invalid_ticket_request: 400, invalid_room_request: 400,
};

const send = (res, status, body) => { res.writeHead(status, JSON_HEADERS); res.end(JSON.stringify(body)); };
const cleanText = (value, max = 64) => String(value || '').replace(/[^a-zA-Z0-9_:\-. ]/g, '').trim().slice(0, max);
const httpError = (error, status, extra = {}) => Object.assign(new Error(error), { status, ...extra });

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > BODY_LIMIT) throw httpError('body_too_large', 413);
    chunks.push(Buffer.from(chunk));
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw httpError('invalid_json', 400); }
}

export function supabaseTicketStore({ url, serviceKey, fetchImpl = fetch }) {
  const headers = { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': 'application/json' };
  const rpc = async (name, args) => {
    const response = await fetchImpl(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const code = String(result?.message || 'match_start_failed');
      throw httpError(RPC_ERRORS[code] ? code : 'match_start_failed', RPC_ERRORS[code] || 503);
    }
    return result;
  };
  return {
    createManualRoom: (args) => rpc('create_manual_coop_room', args),
    seatManualPlayer: (args) => rpc('seat_manual_coop_player', args),
    issueTicket: (args) => rpc('issue_match_ticket', args),
  };
}

export async function processMatchStart({ userId, body, store, secret = ticketSecret(), now = Date.now() }) {
  if (!secret) throw httpError('match_tickets_not_configured', 503);
  const characterId = cleanText(body?.characterId, 96);
  if (!characterId) throw httpError('missing_character', 400);
  const levelId = Number(body?.levelId);
  const mode = String(body?.mode || '');
  const difficulty = String(body?.difficulty || '');
  if (!Number.isInteger(levelId) || levelId < 1 || levelId > 1e6 || !levelById(levelId)) throw httpError('invalid_level', 400);
  if (!MATCH_MODES.includes(mode)) throw httpError('invalid_mode', 400);
  if ((mode === 'labyrinth') !== isLabyrinthLevel(levelId)) throw httpError('invalid_level', 400);
  if (!Object.prototype.hasOwnProperty.call(DIFFICULTY, difficulty)) throw httpError('invalid_difficulty', 400);

  let roomId = body?.roomId == null || body.roomId === '' ? null : String(body.roomId);
  if (roomId && !UUID.test(roomId)) throw httpError('invalid_room', 400);
  let token = null;
  const displayName = cleanText(body?.manualCoop?.displayName ?? body?.displayName, 32);
  const hero = cleanText(body?.manualCoop?.hero ?? body?.hero, 32);
  if (!roomId && body?.manualCoop) {
    // Invite-code host: a private room so every player is credited as co-op.
    roomId = await store.createManualRoom({
      p_actor: userId, p_display_name: displayName, p_hero: hero, p_level_id: levelId, p_mode: mode, p_difficulty: difficulty,
    });
    if (!UUID.test(String(roomId))) throw httpError('match_start_failed', 503);
    token = joinToken(roomId, secret);
  } else if (roomId && body?.joinToken != null) {
    // Invite-code guest: the host's token proves they were handed this room.
    if (!verifyJoinToken(roomId, String(body.joinToken), secret)) throw httpError('invalid_join_token', 403);
    await store.seatManualPlayer({ p_actor: userId, p_room_id: roomId, p_display_name: displayName, p_hero: hero });
  }

  const seed = roomId ? roomSeed(roomId, secret) : soloSeed();
  const row = await store.issueTicket({
    p_actor: userId, p_client_character_id: characterId, p_level_id: levelId, p_mode: mode,
    p_difficulty: difficulty, p_seed: seed, p_room_id: roomId, p_ttl_seconds: TICKET_TTL_SECONDS,
  });
  if (!row?.id) throw httpError('match_start_failed', 503);
  const iat = Math.floor(Date.parse(row.issued_at) / 1000);
  const exp = Math.floor(Date.parse(row.expires_at) / 1000);
  if (!Number.isFinite(iat) || !Number.isFinite(exp) || exp * 1000 <= now) throw httpError('match_start_failed', 503);
  const ticketSeed = Number(row.seed);
  const ticket = signTicket({
    tid: row.id, uid: userId, lvl: levelId, mode, diff: difficulty, seed: ticketSeed, rid: roomId || null, iat, exp,
  }, secret);
  return {
    ok: true, ticket, ticketId: row.id, seed: ticketSeed, roomId: roomId || null,
    ...(token ? { joinToken: token } : {}), expiresAt: row.expires_at,
  };
}

async function authenticatedUser(authorization, url, anonKey) {
  if (!authorization.startsWith('Bearer ')) return null;
  const response = await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: anonKey } });
  return response.ok ? response.json() : null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return send(res, 405, { ok: false, error: 'method_not_allowed' }); }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey || !ticketSecret()) return send(res, 503, { ok: false, error: 'match_tickets_not_configured' });
    const user = await authenticatedUser(String(req.headers.authorization || ''), url, anonKey);
    if (!user?.id || !UUID.test(user.id)) return send(res, 401, { ok: false, error: 'sign_in_required' });
    const body = await parseBody(req);
    const result = await processMatchStart({ userId: user.id, body, store: supabaseTicketStore({ url, serviceKey }) });
    return send(res, 200, result);
  } catch (error) {
    const status = error?.status || 500;
    return send(res, status, { ok: false, error: status === 500 ? 'match_start_error' : error.message });
  }
}
