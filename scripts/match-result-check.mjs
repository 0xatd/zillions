// Behaviour tests for server-authoritative match rewards.
// The server (api/match-result.js + apply_match_result()) is the only party
// that grants signed-in XP, loot, Alloy and stats. These tests pin the pure
// reward math, the report validation, the endpoint decision flow (with a fake
// store), and the source-level guarantees that clients no longer write stats.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  MATCH_LIMITS, MATCH_REPORT_VERSION, applyExperience, computeMatchRewards, evaluateQuests,
  itemPayload, matchAlloy, matchExperience, validateMatchReport, verifyLootKey, xpToNextLevel,
} from '../src/match-rewards.js';
import { BOSS_DROPS, DIFFICULTY, FIELD_LOOT, LEVELS, levelById, rollLootKey, worldItemLevel } from '../src/config.js';
import { xpToMmoLevel } from '../src/mmo-characters.js';
import handler, { processMatchResult } from '../api/match-result.js';
import { overlayServerProgress, serverProgress, AuthClient } from '../src/auth.js';
import { dropPendingMatch, queuePendingMatch, readPendingMatches, retryableMatchError } from '../src/match-outbox.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const report = (over = {}) => ({
  version: MATCH_REPORT_VERSION, mode: 'campaign', levelId: 1, difficulty: 'normal', won: true,
  durationSeconds: 900, threatLevel: 4, kills: 400, coins: 300, nests: 3, nodes: 5, built: 30, lost: 0,
  bestHeld: 4, heroDeaths: 0, bossKillT: 60, hqTier: 3, standingBuildings: 25, pack: [], hero: 'scott', ...over,
});
const valid = (over = {}, ctx = {}) => {
  const checked = validateMatchReport(report(over), ctx);
  assert.ok(checked.ok, `expected a valid report, got ${checked.error} ${checked.detail || ''}`);
  return checked.report;
};
const realLoot = (levelId, serial, rarity = 2, difficulty = 'normal') => {
  const level = levelById(levelId);
  return rollLootKey(`${level.seed}:${levelId}:${serial}`, worldItemLevel(levelId, level, DIFFICULTY[difficulty]), rarity, 0.4);
};

// ---- experience curve -------------------------------------------------------
for (const level of [1, 2, 10, 50, 99]) eq(xpToNextLevel(level), xpToMmoLevel(level), `guest and server XP curves agree at ${level}`);
eq(applyExperience({ level: 1, xp: 0 }, 174), { level: 1, xp: 174, levels: [] }, 'below threshold stays put');
const up = applyExperience({ level: 1, xp: 0 }, xpToNextLevel(1) + xpToNextLevel(2) + 5);
eq([up.level, up.xp, up.levels], [3, 5, [2, 3]], 'multi level-up carries the remainder');
eq(applyExperience({ level: 100, xp: 0 }, 1e6).level, 100, 'level cap 100');
eq(applyExperience({ level: 'x', xp: -50 }, -10), { level: 1, xp: 0, levels: [] }, 'garbage progress is normalised, negative XP ignored');

// ---- validation -------------------------------------------------------------
ok(!validateMatchReport(null).ok, 'null report rejected');
eq(validateMatchReport(report({ version: 99 })).error, 'unsupported_report_version', 'unknown version rejected');
eq(validateMatchReport(report({ mode: 'living_world' })).error, 'invalid_mode', 'removed MMO mode rejected');
eq(validateMatchReport(report({ levelId: 3 }), { campaignCleared: 1 }).error, 'level_locked', 'cannot report a locked campaign level');
ok(validateMatchReport(report({ levelId: 2 }), { campaignCleared: 1 }).ok, 'next campaign level is playable');
eq(validateMatchReport(report({ levelId: 9001 })).error, 'invalid_level', 'labyrinth id cannot pose as campaign');
ok(validateMatchReport(report({ mode: 'labyrinth', levelId: 9001 })).ok, 'labyrinth trial accepted in labyrinth mode');
eq(validateMatchReport(report({ durationSeconds: 5 })).error, 'implausible_duration', 'too-short match rejected');
eq(validateMatchReport(report({ durationSeconds: MATCH_LIMITS.maxDurationSeconds + 1 })).error, 'implausible_duration', 'too-long match rejected');
eq(validateMatchReport(report({ kills: 900 * 25 + 51 })).detail, 'kills', 'kill rate bounded');
eq(validateMatchReport(report({ nests: levelById(1).nests + 1 })).detail, 'nests', 'cannot raze more nests than the map has');
eq(validateMatchReport(report({ threatLevel: 50 })).detail, 'threatLevel', 'threat bounded by duration');
eq(validateMatchReport(report({ bossKillT: 5000 })).detail, 'bossKillT', 'boss kill must be inside the match');
eq(validateMatchReport(report({ difficulty: 'godmode' })).error, 'invalid_difficulty', 'unknown difficulty rejected');
eq(valid({ mode: 'survival', won: true }).won, false, 'survival cannot be reported as a win');

// ---- loot proofs ------------------------------------------------------------
const legit = realLoot(1, 3);
ok(verifyLootKey(legit, { levelId: 1 }), 'a key the map really scatters verifies');
ok(verifyLootKey(FIELD_LOOT.rare[0], { levelId: 1 }), 'authored field finds verify');
ok(!verifyLootKey(realLoot(1, 3, 2, 'brutal'), { levelId: 1, difficulty: 'normal' }), 'item level must match the reported difficulty');
ok(!verifyLootKey(realLoot(2, 3), { levelId: 1 }), 'a key from another level does not verify');
const [base, seed, ilvl] = legit.split(':');
ok(!verifyLootKey(`${base}:${(parseInt(seed, 36) + 1).toString(36)}:${ilvl}:3`, { levelId: 1 }), 'forged seed rejected');
ok(!verifyLootKey(`${base}:${seed}:${Number(ilvl) + 20}:3`, { levelId: 1 }), 'inflated item level rejected');
ok(!verifyLootKey('zillion_eye', { levelId: 1 }), 'boss drops cannot be smuggled in as field finds');
eq(validateMatchReport(report({ pack: ['zillion_eye'] })).error, 'unverifiable_loot', 'unverifiable pack rejects the report');
eq(validateMatchReport(report({ pack: [legit, realLoot(1, 4), realLoot(1, 5), realLoot(1, 6), realLoot(1, 7)] })).detail, 'pack', 'pack capped at PACK_SLOTS');
eq(valid({ pack: [legit, legit] }).pack, [legit], 'duplicate pack keys collapse');

// ---- quests are re-evaluated, never trusted ---------------------------------
const q1 = evaluateQuests(valid({ kills: 149, lost: 2, bestHeld: 1 }));
ok(q1.every((q) => !q.done), 'no level-1 quest completes without meeting its check');
const q2 = evaluateQuests(valid({ kills: 150, lost: 0, bestHeld: 4 }));
eq(q2.map((q) => q.done), [true, true, true], 'level-1 quests re-evaluated from counters');
ok(evaluateQuests(valid({ won: false, kills: 5000 })).every((q) => !q.done), 'quests need a win');
ok(evaluateQuests(valid({ mode: 'survival' })).length === 0, 'survival has no quests');
const l4 = evaluateQuests(valid({ levelId: 4, standingBuildings: 20, nests: 3 }, { campaignCleared: 3 }));
ok(l4.find((q) => q.id === 'l4q3').done, 'standing-buildings quest uses the reported count');

// ---- reward computation -----------------------------------------------------
const win = valid({ kills: 400, nests: 3, pack: [legit] });
const rewards = computeMatchRewards(win, { character: { level: 1, xp: 0 }, questsDone: {}, relics: [] });
eq(rewards.xpGained, matchExperience(win), 'XP from the shared formula');
eq(rewards.xpGained, Math.max(25, Math.floor(400 * 0.35)) + 3 * 30 + 180 + 25, 'campaign XP formula unchanged');
ok(rewards.level > 1 && rewards.levelsGained.length > 0, 'a full win levels a fresh character');
ok(rewards.items.some((i) => i.key === BOSS_DROPS[1] && i.source === 'boss'), 'boss drop on a campaign win');
ok(rewards.items.some((i) => i.key === legit && i.source === 'field'), 'verified field find granted');
ok(rewards.items.some((i) => i.source === 'quest' && i.questId === 'l1q1'), 'quest reward item carries its quest id');
eq(rewards.questsCompleted, ['l1q1', 'l1q2', 'l1q3'], 'all three quests completed');
eq(rewards.stats.wins, 1, 'win counted');
eq(rewards.progress.campaignCleared, 1, 'campaign progress advanced by a win');
const again = computeMatchRewards(win, { character: { level: 1, xp: 0 }, questsDone: { l1q1: true, l1q2: true, l1q3: true } });
ok(!again.items.some((i) => i.source === 'quest') && again.questsCompleted.length === 0, 'quests pay once per account');
const l5 = computeMatchRewards(valid({ levelId: 5, bestHeld: 7, nests: 5 }, { campaignCleared: 4 }), { relics: [] });
ok(l5.relics.includes('warlord_crest'), 'relic quest rewards go to the relic ledger');
ok(!computeMatchRewards(valid({ levelId: 5, bestHeld: 7, nests: 5 }, { campaignCleared: 4 }), { relics: ['warlord_crest'] }).relics.length, 'owned relics are not re-granted');
const survival = computeMatchRewards(valid({ mode: 'survival', pack: [legit] }), {});
eq([survival.xpGained, survival.stats.wins, survival.progress.bestSurvival], [0, 0, 4], 'survival: no XP, no win, best threat recorded');
ok(survival.items.some((i) => i.key === legit), 'survival finds still survive the run');
const loss = computeMatchRewards(valid({ won: false }), {});
ok(!loss.items.some((i) => i.source === 'boss') && loss.stats.losses === 1, 'losses get no boss drop');
ok(matchAlloy(valid({ kills: 900 * 25, coins: 900 * 60 })) <= MATCH_LIMITS.maxAlloyPerMatch, 'Alloy per match is capped');
ok(matchAlloy(valid({ won: false, kills: 0, coins: 0, built: 0, lost: 200, nests: 0, nodes: 0, threatLevel: 1, bossKillT: null })) === 0, 'Alloy never negative');
eq(itemPayload('zillion_eye').rarity, 3, 'signature items stored inside the 1..3 rarity constraint');
eq(itemPayload(legit, { source: 'match_field' }).provenance.source, 'match_field', 'provenance attached');
eq(itemPayload('not_an_item'), null, 'unknown keys produce no row');

// ---- endpoint flow with a fake store ----------------------------------------
const USER = '11111111-1111-4111-8111-111111111111';
const ROOM = '22222222-2222-4222-8222-222222222222';
function fakeStore({ character = { id: 'c1', level: 1, xp: 0, progress_revision: 7 }, stats = {}, membership = null, stale = 0, existing = null } = {}) {
  const calls = [];
  return {
    calls,
    async findReport() { return existing; },
    async loadContext() { return { character, stats, membership }; },
    async applyResult(args) {
      calls.push(args);
      if (stale-- > 0) throw Object.assign(new Error('stale_progress'), { status: 409 });
      return { ok: true, duplicate: false, character: { level: args.p_result.level, xp: args.p_result.xp }, grantedItems: args.p_result.items.map((i) => i.legacy_key) };
    },
  };
}
const body = (over = {}) => ({ requestId: 'req-12345678', characterId: 'mmo_a', report: report(), ...over });
const store = fakeStore();
const applied = await processMatchResult({ userId: USER, body: body(), store });
ok(applied.ok && store.calls.length === 1, 'valid report applied once');
const args = store.calls[0];
eq(args.p_actor, USER, 'actor comes from the verified token');
eq(args.p_expected_progress_revision, 7, 'compare-and-set on progress_revision');
ok(args.p_result.items.every((i) => i.provenance?.request_id === 'req-12345678'), 'items carry request provenance');
ok(args.p_result.items.some((i) => i.quest_id === 'l1q1'), 'quest items are tagged so SQL can skip already-done quests');
ok(Array.isArray(applied.quests), 'response carries the server quest evaluation');
const dup = await processMatchResult({ userId: USER, body: body(), store: fakeStore({ existing: { response_payload: { ok: true, xpGained: 9 } } }) });
eq([dup.duplicate, dup.xpGained], [true, 9], 'a replayed requestId returns the original grant');
const retry = fakeStore({ stale: 1 });
await processMatchResult({ userId: USER, body: body(), store: retry });
eq(retry.calls.length, 2, 'stale progress is recomputed once');
await assert.rejects(processMatchResult({ userId: USER, body: body(), store: fakeStore({ stale: 2 }) }), /stale_progress/); checks++;
await assert.rejects(processMatchResult({ userId: USER, body: body(), store: fakeStore({ character: null }) }), (e) => e.status === 404); checks++;
await assert.rejects(processMatchResult({ userId: USER, body: body({ requestId: '' }), store }), (e) => e.message === 'missing_request_id'); checks++;
await assert.rejects(processMatchResult({ userId: USER, body: body({ report: report({ kills: 1e9 }) }), store }), (e) => e.status === 422); checks++;
await assert.rejects(processMatchResult({ userId: USER, body: body({ roomId: 'not-a-uuid' }), store }), (e) => e.message === 'invalid_room'); checks++;
await assert.rejects(processMatchResult({ userId: USER, body: body({ roomId: ROOM }), store: fakeStore() }), (e) => e.status === 403, 'non-participant rejected'); checks++;
const now = Date.parse('2026-10-26T12:00:00Z');
await assert.rejects(processMatchResult({ userId: USER, now, body: body({ roomId: ROOM }),
  store: fakeStore({ membership: { user_id: USER, rooms: { status: 'open', created_at: '2026-10-26T10:00:00Z' } } }) }), (e) => e.message === 'room_not_started'); checks++;
await assert.rejects(processMatchResult({ userId: USER, now, body: body({ roomId: ROOM }),
  store: fakeStore({ membership: { user_id: USER, rooms: { status: 'finished', created_at: '2026-10-26T11:58:00Z' } } }) }), (e) => e.message === 'implausible_duration', 'room younger than the match'); checks++;
const coop = fakeStore({ membership: { user_id: USER, rooms: { status: 'finished', created_at: '2026-10-26T10:00:00Z' } } });
await processMatchResult({ userId: USER, now, body: body({ roomId: ROOM }), store: coop });
eq(coop.calls[0].p_room_id, ROOM, 'co-op participant report carries the room for per-room dedupe');
const locked = fakeStore({ stats: { campaign_cleared: 0 } });
await assert.rejects(processMatchResult({ userId: USER, body: body({ report: report({ levelId: 2 }) }), store: locked }), (e) => e.message === 'level_locked'); checks++;

// HTTP shell: method, configuration, auth.
const fakeRes = () => { const r = { status: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; }; r.writeHead = (s) => { r.status = s; }; r.end = (b) => { r.body = JSON.parse(b); }; return r; };
let res = fakeRes(); await handler({ method: 'GET', headers: {} }, res); eq(res.status, 405, 'GET refused');
const savedEnv = { ...process.env };
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
res = fakeRes(); await handler({ method: 'POST', headers: {} }, res); eq(res.status, 503, 'unconfigured backend refuses');
Object.assign(process.env, { SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' });
res = fakeRes(); await handler({ method: 'POST', headers: {} }, res); eq(res.status, 401, 'no bearer token, no rewards');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
res = fakeRes(); await handler({ method: 'POST', headers: { authorization: 'Bearer forged' } }, res); eq(res.status, 401, 'token rejected by Supabase auth means 401');
globalThis.fetch = realFetch;
process.env = savedEnv;

// ---- client hydration ---------------------------------------------------------
eq(serverProgress({}), {}, 'pre-migration stats leave local progress alone');
eq(serverProgress({ campaign_cleared: 2, best_survival: 9, relics: ['x', 3], quests_done: { a: true }, labyrinth_clears: {} }).relics, ['x'], 'server relic ledger hydrates');
const overlaid = overlayServerProgress([{ id: 'mmo_a', level: 60, xp: 9 }, { id: 'mmo_b', level: 5 }],
  [{ client_character_id: 'mmo_a', level: 12, xp: 40, progress_revision: 3, stats: { kills: 5 } }, { client_character_id: 'mmo_b', level: 1 }]);
eq([overlaid[0].level, overlaid[0].xp, overlaid[1].level], [12, 40, 5], 'server level/XP overrides client metadata; pre-migration rows are ignored');
const auth = new AuthClient();
auth.session = { user: { id: 'u1', user_metadata: { campaign: 9 } } };
eq(auth.profileFromBundle({ profile: { handle: 't', username_set: true }, stats: { campaign_cleared: 2 } }).campaign, 2, 'server campaign progress beats client metadata');

// ---- outbox: unconfirmed reports are resent with the same requestId ------------
{
  const memory = new Map();
  globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)) };
  queuePendingMatch({ requestId: 'r1', report: {} });
  queuePendingMatch({ requestId: 'r1', report: {} });
  eq(readPendingMatches().length, 1, 'requeue keeps one copy per requestId');
  for (let i = 2; i <= 8; i++) queuePendingMatch({ requestId: `r${i}`, report: {} });
  eq(readPendingMatches().map((p) => p.requestId), ['r4', 'r5', 'r6', 'r7', 'r8'], 'outbox capped at the newest five');
  dropPendingMatch('r8');
  ok(!readPendingMatches().some((p) => p.requestId === 'r8'), 'confirmed report dropped');
  eq(readPendingMatches(Date.now() + 8 * 864e5), [], 'week-old reports expire');
  ok(retryableMatchError(new TypeError('fetch failed')) && retryableMatchError({ status: 503 }) && retryableMatchError({ status: 429 }), 'network/server/rate errors retry');
  ok(retryableMatchError({ status: 409, message: 'stale_progress' }) && !retryableMatchError({ status: 409, message: 'duplicate_room_report' }), 'only stale CAS conflicts retry');
  ok(!retryableMatchError({ status: 422 }) && !retryableMatchError({ status: 403 }), 'rejected reports are dropped');
  delete globalThis.localStorage;
}

// ---- source-level guarantees ---------------------------------------------------
const main = read('src/main.js');
const authSource = read('src/auth.js');
const signedIn = main.slice(main.indexOf('  _recordGameEnd(won) {'), main.indexOf('  _recordGuestGameEnd('));
ok(signedIn.includes('_submitMatchResult(') && !/recordMmoInstance|awardRun|grantMmoExperience|questsDone\[/.test(signedIn),
  'signed-in match end computes nothing locally and defers to the server');
ok(!/from\('player_stats'\)\.(upsert|insert|update)|from\('match_history'\)\.insert|recordMatch\(/.test(authSource + main),
  'the client never writes player_stats or match_history');
const migration = read('supabase/migrations/20261027000100_server_authoritative_progress.sql');
for (const policy of ['player_stats_insert_self', 'player_stats_update_self', 'match_history_insert_self']) {
  ok(migration.includes(`drop policy if exists ${policy}`), `${policy} dropped`);
  ok(!read('supabase/schema.sql').includes(`create policy ${policy}`), `schema.sql no longer creates ${policy}`);
}
ok(/grant execute on function public\.apply_match_result\([^)]*\) to service_role/.test(migration)
  && /revoke all on function public\.apply_match_result\([^)]*\) from public, anon, authenticated/.test(migration), 'apply_match_result is service-role only');
ok(/security definer/.test(migration) && /pg_advisory_xact_lock/.test(migration) && /match_reports_one_per_room/.test(migration), 'RPC serialises per account and dedupes rooms');
const destructive = read('supabase/migrations/20261027000000_drop_living_world_DESTRUCTIVE.sql');
ok(/REVIEW BEFORE APPLYING/.test(destructive) && /drop table if exists public\.world_shards cascade/.test(destructive), 'destructive migration is labelled and drops the world tables');
ok(!/drop table if exists public\.(player_stats|match_history|game_characters|item_instances|player_wallets|profiles)\b/.test(destructive), 'destructive migration leaves siege tables alone');
ok(read('api/economy.js').includes("import { itemPayload } from '../src/match-rewards.js'"), 'vendor and loot share one item row builder');
ok(!JSON.parse(read('vercel.json')).crons, 'no scheduled living-world workers remain');
ok(existsSync(new URL('../.github/workflows/ci.yml', import.meta.url)), 'CI workflow exists');
ok(LEVELS.length >= 5, 'campaign levels present');

console.log(`match-result-check: ${checks} checks passed (validation, loot proofs, quests, XP/Alloy, endpoint flow, client hydration, RLS)`);
