// POST /api/match-result — the only path that grants signed-in progression.
//
// The client reports how a siege ended; this endpoint
//   1. authenticates the Supabase user,
//   2. loads the server's own record (character level/XP, quest ledger,
//      campaign progress, co-op membership),
//   3. validates the report against plausibility bounds and re-derives loot,
//      quests, XP, and Alloy with src/match-rewards.js,
//   4. requires the signed match ticket from /api/match-start: right user,
//      right mission, unexpired, unused; match length is checked against the
//      server's own clock from the ticket's issue time,
//   5. replays the recorded input log headlessly (src/match-replay.js) when
//      the run is a personal best, looks suspicious, carries loot, or is
//      spot-checked; a replay that disagrees pays out what the SERVER's sim
//      produced and flags the report,
//   6. writes everything in ONE transaction through apply_match_result()
//      (security definer, service_role only), which also spends the ticket
//      and enforces idempotency, one reward per co-op room per player, and a
//      per-account rate limit.
// Clients cannot write player_stats or match_history directly any more.
import { computeMatchRewards, itemPayload, matchScore, validateMatchReport } from '../src/match-rewards.js';
import { socketComponentMods } from '../src/crafting.js';
import { diffReports, replayMatch, replayReasons, validateReplayPayload, withServerCamp } from '../src/match-replay.js';
import { ticketSecret, verifyTicket } from './_lib/match-ticket.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
// Reports carry the replay input log (a few hundred KB for a long match).
const BODY_LIMIT = 2 * 1024 * 1024;
// Inline replay budget. Runs that need longer are stored and verified by
// scripts/verify-replays.mjs; they pay out on the claim and are flagged.
const DEFAULT_REPLAY_BUDGET_MS = 8000;
// Solo games can run at 2x; lockstep co-op runs at 1x.
const SPEED_CAP = { solo: 2, room: 1 };
const CLOCK_SLACK_SECONDS = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_STATES = new Set(['starting', 'in_game', 'finished']);
// Errors raised by apply_match_result() and the HTTP status each maps to.
const RPC_ERRORS = {
  stale_progress: 409, duplicate_room_report: 409, request_in_progress: 409,
  rate_limited: 429, implausible_duration: 422, character_not_found: 404,
  missing_ticket: 422, invalid_ticket: 422, ticket_used: 409, ticket_expired: 422, ticket_mismatch: 422,
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
    async loadContext(userId, clientCharacterId, roomId, { levelId = null, mode = null } = {}) {
      const [characters, stats, membership, previous] = await Promise.all([
        rows(`game_characters?select=id,level,xp,progress_revision&user_id=eq.${userId}&client_character_id=eq.${encodeURIComponent(clientCharacterId)}&limit=1`),
        rows(`player_stats?select=campaign_cleared,best_survival,labyrinth_clears,quests_done,relics&user_id=eq.${userId}&limit=1`),
        roomId ? rows(`room_players?select=user_id,rooms(status,created_at)&room_id=eq.${roomId}&user_id=eq.${userId}&limit=1`) : Promise.resolve(null),
        Number.isInteger(levelId) && mode
          ? rows(`match_reports?select=report&user_id=eq.${userId}&level_id=eq.${levelId}&mode=eq.${encodeURIComponent(mode)}&order=created_at.desc&limit=50`)
          : Promise.resolve([]),
      ]);
      const character = characters[0] || null;
      const items = character
        ? await rows(`item_instances?select=legacy_key,location,equip_slot,sockets&character_id=eq.${character.id}&location=in.(stash,equipped)&order=created_at.asc`)
        : [];
      return {
        character, stats: stats[0] || {}, membership: membership ? membership[0] || null : null,
        previousReports: previous.map((row) => row.report).filter(Boolean), items,
      };
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

// What the server knows about the reporter's hero, for the replay.
export function serverHero(context) {
  const items = Array.isArray(context.items) ? context.items : [];
  const equipped = items.filter((item) => item.location === 'equipped');
  return {
    level: context.character?.level || 1,
    xp: Number(context.character?.xp) || 0,
    items: items.filter((item) => item.location === 'stash').map((item) => item.legacy_key),
    equipment: Object.fromEntries(equipped.filter((item) => item.equip_slot).map((item) => [item.equip_slot, item.legacy_key])),
    socketMods: socketComponentMods(equipped),
    relics: Array.isArray(context.stats?.relics) ? context.stats.relics : [],
  };
}

// Decide whether to replay, run it, and settle which report pays out.
// Returns { report, replay } where replay is what apply_match_result stores.
export function settleReplay({ report, ticket, body, context, serverElapsedSeconds, random, budgetMs, clock }) {
  const best = context.previousReports.reduce((max, prior) => Math.max(max, matchScore(prior)), -Infinity);
  const reasons = replayReasons(report, {
    bestScore: Number.isFinite(best) ? best : null,
    campaignCleared: context.stats.campaign_cleared || 0,
    bestSurvival: context.stats.best_survival || 0,
    labyrinthClears: context.stats.labyrinth_clears || {},
    serverElapsedSeconds,
  }, random);
  if (!reasons.length) return { report, replay: { status: 'not_required', reasons } };
  if (body?.replay == null) throw httpError('replay_required', 422, { detail: reasons.join(',') });
  const checked = validateReplayPayload(body.replay);
  if (!checked.ok) throw httpError(checked.error, 422, { detail: checked.detail || null });
  const players = Array.isArray(checked.replay.heroes) ? checked.replay.heroes.length : 1;
  if (!ticket.rid && players !== 1) throw httpError('invalid_replay', 422, { detail: 'solo_players' });
  const replay = withServerCamp(checked.replay, serverHero(context));
  const started = clock();
  const result = replayMatch({
    levelId: ticket.lvl, mode: ticket.mode, difficulty: ticket.diff, seed: ticket.seed,
    replay, now: clock, deadline: started + budgetMs,
  });
  if (result.status === 'timeout') {
    // Not a verdict. Pay on the bounds-checked claim, flag it, and keep the
    // log for the offline verifier.
    return { report, replay: { status: 'deferred', reasons, log: checked.replay } };
  }
  if (result.status !== 'complete') throw httpError(result.error || 'replay_invalid', 422, { detail: result.detail || null });
  const mismatch = diffReports(report, result.report);
  if (!mismatch.length) return { report, replay: { status: 'verified', reasons } };
  // The server's own run is what pays out. Re-validate it like any report.
  const replayed = validateMatchReport({ ...result.report, hero: report.hero }, { campaignCleared: context.stats.campaign_cleared || 0 });
  if (!replayed.ok) throw httpError('replay_mismatch', 422, { detail: mismatch.join(',') });
  return { report: replayed.report, replay: { status: 'mismatch', reasons, mismatch, claimed: report } };
}

// The whole decision, separated from HTTP so tests can drive it with a fake
// store. `now`, `random`, `clock` and the secret are injectable.
export async function processMatchResult({
  userId, body, store, now = Date.now(), secret = ticketSecret(), random = Math.random,
  replayBudgetMs = DEFAULT_REPLAY_BUDGET_MS, clock = () => performance.now(),
}) {
  const requestId = cleanText(body?.requestId, 64);
  if (!requestId || requestId.length < 8) throw httpError('missing_request_id', 400);
  const clientCharacterId = cleanText(body?.characterId, 96);
  if (!clientCharacterId) throw httpError('missing_character', 400);
  const claimedRoom = body?.roomId == null || body.roomId === '' ? null : String(body.roomId);
  if (claimedRoom && !UUID.test(claimedRoom)) throw httpError('invalid_room', 400);

  const previous = await store.findReport(userId, requestId);
  if (previous) {
    if (previous.response_payload == null) throw httpError('request_in_progress', 409);
    return { ...previous.response_payload, duplicate: true };
  }

  if (!secret) throw httpError('match_tickets_not_configured', 503);
  const verified = verifyTicket(body?.ticket, secret, { userId, now });
  if (!verified.ok) throw httpError(verified.error, 422, { detail: verified.detail || null });
  const ticket = verified.payload;
  // The room comes from the ticket, which was issued against a server-side
  // seat. A report cannot move itself into or out of a room.
  const roomId = ticket.rid || null;
  if (claimedRoom && claimedRoom !== roomId) throw httpError('ticket_mismatch', 422, { detail: 'room' });
  const serverElapsedSeconds = Math.max(0, Math.floor((now - Number(ticket.iat) * 1000) / 1000));

  for (let attempt = 0; attempt < 2; attempt++) {
    const context = await store.loadContext(userId, clientCharacterId, roomId, { levelId: ticket.lvl, mode: ticket.mode });
    if (!context.character) throw httpError('character_not_found', 404);
    context.previousReports ||= [];
    const checked = validateMatchReport(body?.report, { campaignCleared: context.stats.campaign_cleared || 0 });
    if (!checked.ok) throw httpError(checked.error, 422, { detail: checked.detail || null });
    const ticketCheck = verifyTicket(body.ticket, secret, {
      userId, now, levelId: checked.report.levelId, mode: checked.report.mode, difficulty: checked.report.difficulty,
    });
    if (!ticketCheck.ok) throw httpError(ticketCheck.error, 422, { detail: ticketCheck.detail || null });
    const speedCap = roomId ? SPEED_CAP.room : SPEED_CAP.solo;
    if (checked.report.durationSeconds > serverElapsedSeconds * speedCap + CLOCK_SLACK_SECONDS) {
      throw httpError('implausible_duration', 422, { detail: 'server_clock' });
    }
    const settled = settleReplay({
      report: checked.report, ticket, body, context, serverElapsedSeconds, random, budgetMs: replayBudgetMs, clock,
    });
    const report = settled.report;

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
        p_ticket_id: ticket.tid,
        p_replay: settled.replay,
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
      return { ...applied, quests: rewards.quests, score: rewards.score, report };
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
    const budget = Number(process.env.MATCH_REPLAY_BUDGET_MS);
    const result = await processMatchResult({
      userId: user.id, body, store: supabaseStore({ url, serviceKey }),
      ...(Number.isFinite(budget) && budget > 0 ? { replayBudgetMs: budget } : {}),
    });
    return send(res, 200, result);
  } catch (error) {
    const status = error?.status || 500;
    return send(res, status, { ok: false, error: status === 500 ? 'match_result_error' : error.message, ...(error?.detail ? { detail: error.detail } : {}) });
  }
}
