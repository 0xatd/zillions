// POST /api/match-result — the only path that grants signed-in progression.
//
// The client reports how a siege ended; this endpoint
//   1. authenticates the Supabase user,
//   2. loads the server's own record (character level/XP, quest ledger,
//      campaign progress, co-op membership),
//   3. validates the report against plausibility bounds and re-derives loot,
//      quests, XP, and Alloy with src/match-rewards.js,
//   4. writes everything in ONE transaction through apply_match_result()
//      (security definer, service_role only), which also enforces idempotency,
//      one reward per co-op room per player, and a per-account rate limit.
// Clients cannot write player_stats or match_history directly any more.
import { computeMatchRewards, itemPayload, validateMatchReport } from '../src/match-rewards.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const BODY_LIMIT = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_STATES = new Set(['starting', 'in_game', 'finished']);
// Errors raised by apply_match_result() and the HTTP status each maps to.
const RPC_ERRORS = {
  stale_progress: 409, duplicate_room_report: 409, request_in_progress: 409,
  rate_limited: 429, implausible_duration: 422, character_not_found: 404,
};

const send = (res, status, body) => { res.writeHead(status, JSON_HEADERS); res.end(JSON.stringify(body)); };
export const cleanText = (value, max = 128) => String(value || '').replace(/[^a-zA-Z0-9_:\-.]/g, '').slice(0, max);
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

// Supabase-backed storage. Every call uses the service role; the user id comes
// from the verified access token, never from the request body.
export function supabaseStore({ url, serviceKey, fetchImpl = fetch }) {
  const headers = { authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  const rows = async (path) => {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, { headers });
    if (!response.ok) throw httpError('progress_backend_unavailable', 503);
    return response.json();
  };
  return {
    async findReport(userId, requestId) {
      const found = await rows(`match_reports?select=response_payload&user_id=eq.${userId}&request_id=eq.${encodeURIComponent(requestId)}&limit=1`);
      return found[0] || null;
    },
    async loadContext(userId, clientCharacterId, roomId) {
      const [characters, stats, membership] = await Promise.all([
        rows(`game_characters?select=id,level,xp,progress_revision&user_id=eq.${userId}&client_character_id=eq.${encodeURIComponent(clientCharacterId)}&limit=1`),
        rows(`player_stats?select=campaign_cleared,quests_done,relics&user_id=eq.${userId}&limit=1`),
        roomId ? rows(`room_players?select=user_id,rooms(status,created_at)&room_id=eq.${roomId}&user_id=eq.${userId}&limit=1`) : Promise.resolve(null),
      ]);
      return { character: characters[0] || null, stats: stats[0] || {}, membership: membership ? membership[0] || null : null };
    },
    async applyResult(args) {
      const response = await fetchImpl(`${url}/rest/v1/rpc/apply_match_result`, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(args),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const code = String(result?.message || 'match_result_failed');
        throw httpError(RPC_ERRORS[code] ? code : 'match_result_failed', RPC_ERRORS[code] || 500);
      }
      return result;
    },
  };
}

// The whole decision, separated from HTTP so tests can drive it with a fake
// store. `now` is injectable for the co-op room age check.
export async function processMatchResult({ userId, body, store, now = Date.now() }) {
  const requestId = cleanText(body?.requestId, 64);
  if (!requestId || requestId.length < 8) throw httpError('missing_request_id', 400);
  const clientCharacterId = cleanText(body?.characterId, 96);
  if (!clientCharacterId) throw httpError('missing_character', 400);
  const roomId = body?.roomId == null || body.roomId === '' ? null : String(body.roomId);
  if (roomId && !UUID.test(roomId)) throw httpError('invalid_room', 400);

  const previous = await store.findReport(userId, requestId);
  if (previous) {
    if (previous.response_payload == null) throw httpError('request_in_progress', 409);
    return { ...previous.response_payload, duplicate: true };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const context = await store.loadContext(userId, clientCharacterId, roomId);
    if (!context.character) throw httpError('character_not_found', 404);
    const checked = validateMatchReport(body?.report, { campaignCleared: context.stats.campaign_cleared || 0 });
    if (!checked.ok) throw httpError(checked.error, 422, { detail: checked.detail || null });
    const report = checked.report;

    if (roomId) {
      // Co-op: only seated players of a room that actually launched may report
      // it, and the room must be old enough to have hosted a match this long.
      const room = context.membership?.rooms;
      if (!context.membership || !room) throw httpError('not_a_room_participant', 403);
      if (!ROOM_STATES.has(room.status)) throw httpError('room_not_started', 409);
      const roomAgeSeconds = (now - Date.parse(room.created_at || '')) / 1000;
      if (!(roomAgeSeconds + 120 >= report.durationSeconds)) throw httpError('implausible_duration', 422);
    }

    const rewards = computeMatchRewards(report, {
      character: { level: context.character.level, xp: context.character.xp },
      questsDone: context.stats.quests_done || {},
      relics: context.stats.relics || [],
    });
    const items = rewards.items.map((item) => {
      const payload = itemPayload(item.key, {
        source: `match_${item.source}`, request_id: requestId, mode: report.mode, level_id: report.levelId,
        ...(item.questId ? { quest_id: item.questId } : {}), ...(roomId ? { room_id: roomId } : {}),
      });
      return payload ? { ...payload, quest_id: item.questId || null } : null;
    }).filter(Boolean);

    try {
      const applied = await store.applyResult({
        p_actor: userId,
        p_request_id: requestId,
        p_client_character_id: clientCharacterId,
        p_room_id: roomId,
        p_expected_progress_revision: context.character.progress_revision,
        p_result: {
          report,
          level: rewards.level,
          xp: rewards.xp,
          xp_gained: rewards.xpGained,
          levels_gained: rewards.levelsGained,
          items,
          relics: rewards.relics,
          quests_completed: rewards.questsCompleted,
          alloy: rewards.alloy,
          stats: rewards.stats,
          progress: rewards.progress,
        },
      });
      return { ...applied, quests: rewards.quests, score: rewards.score };
    } catch (error) {
      // Another match for this character landed between our read and write.
      // Recompute once from the fresh record rather than overwrite it.
      if (error?.message === 'stale_progress' && attempt === 0) continue;
      throw error;
    }
  }
  throw httpError('stale_progress', 409);
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
    if (!url || !anonKey || !serviceKey) return send(res, 503, { ok: false, error: 'progress_backend_not_configured' });
    const user = await authenticatedUser(String(req.headers.authorization || ''), url, anonKey);
    if (!user?.id || !UUID.test(user.id)) return send(res, 401, { ok: false, error: 'sign_in_required' });
    const body = await parseBody(req);
    const result = await processMatchResult({ userId: user.id, body, store: supabaseStore({ url, serviceKey }) });
    return send(res, 200, result);
  } catch (error) {
    const status = error?.status || 500;
    return send(res, status, { ok: false, error: status === 500 ? 'match_result_error' : error.message, ...(error?.detail ? { detail: error.detail } : {}) });
  }
}
