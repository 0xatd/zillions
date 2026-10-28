import test from 'node:test';
import assert from 'node:assert/strict';
import {
  joinToken, roomSeed, signTicket, verifyJoinToken, verifyTicket,
} from '../api/_lib/match-ticket.js';
import { processMatchStart } from '../api/match-start.js';
import { processMatchResult } from '../api/match-result.js';
import { Game } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { SIM_DT, levelById } from '../src/config.js';
import { buildMatchReport } from '../src/match-report.js';
import { MATCH_LIMITS } from '../src/match-rewards.js';
import { REPLAY_VERSION, verifyReplay } from '../src/match-replay.js';
import { perkOffer } from '../src/perks.js';
import { makeRNG } from '../src/utils.js';

const SECRET = 'unit-test-secret-unit-test-secret-0123';
const USER = '11111111-1111-4111-8111-111111111111';
const GUEST = '55555555-5555-4555-8555-555555555555';
const ROOM = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-10-27T12:00:00Z');
const sec = Math.floor(NOW / 1000);

const payload = (over = {}) => ({
  tid: '44444444-4444-4444-8444-444444444444', uid: USER, lvl: 1, mode: 'campaign', diff: 'normal',
  seed: 4242, rid: null, iat: sec - 1800, exp: sec + 3600, ...over,
});

test('tickets verify only with the right secret, user and mission', () => {
  const ticket = signTicket(payload(), SECRET);
  assert.equal(verifyTicket(ticket, SECRET, { userId: USER, levelId: 1, mode: 'campaign', difficulty: 'normal', now: NOW }).ok, true);
  assert.equal(verifyTicket(ticket, 'another-secret-another-secret-0000', { now: NOW }).error, 'invalid_ticket');
  assert.equal(verifyTicket(ticket, SECRET, { userId: GUEST, now: NOW }).error, 'ticket_mismatch');
  assert.equal(verifyTicket(ticket, SECRET, { levelId: 2, now: NOW }).detail, 'level');
  assert.equal(verifyTicket(ticket, SECRET, { now: (sec + 3601) * 1000 }).error, 'ticket_expired');
  const [body, sig] = ticket.split('.');
  const forged = Buffer.from(JSON.stringify({ ...payload(), lvl: 9 })).toString('base64url');
  assert.equal(verifyTicket(`${forged}.${sig}`, SECRET, { now: NOW }).error, 'invalid_ticket');
  assert.equal(verifyTicket(`${body}.${sig}.x`, SECRET, { now: NOW }).error, 'invalid_ticket');
  assert.equal(verifyTicket(undefined, SECRET, { now: NOW }).error, 'missing_ticket');
});

test('join tokens and room seeds are bound to the room', () => {
  assert.equal(verifyJoinToken(ROOM, joinToken(ROOM, SECRET), SECRET), true);
  assert.equal(verifyJoinToken(GUEST, joinToken(ROOM, SECRET), SECRET), false);
  assert.equal(verifyJoinToken(ROOM, 'nope', SECRET), false);
  assert.equal(roomSeed(ROOM, SECRET), roomSeed(ROOM, SECRET));
  assert.notEqual(roomSeed(ROOM, SECRET), roomSeed(GUEST, SECRET));
});

function ticketStore() {
  const calls = [];
  const issued = new Date(NOW).toISOString();
  const expires = new Date(NOW + 48 * 3600e3).toISOString();
  return {
    calls,
    async createManualRoom(args) { calls.push(['room', args]); return ROOM; },
    async seatManualPlayer(args) { calls.push(['seat', args]); return 2; },
    async issueTicket(args) {
      calls.push(['ticket', args]);
      return { id: `4444444${calls.length}-4444-4444-8444-444444444444`, seed: args.p_seed, issued_at: issued, expires_at: expires };
    },
    async campaignCleared() { return 3; },
    async roomTicketPerks() { return null; },
  };
}

test('match-start: solo, invite-code host, invite-code guest', async () => {
  const start = { characterId: 'mmo_a', levelId: 1, mode: 'campaign', difficulty: 'normal' };
  const solo = await processMatchStart({ userId: USER, body: start, store: ticketStore(), secret: SECRET, now: NOW });
  assert.equal(solo.roomId, null);
  assert.equal(verifyTicket(solo.ticket, SECRET, { userId: USER, levelId: 1, now: NOW }).payload.seed, solo.seed);

  const hostStore = ticketStore();
  const host = await processMatchStart({ userId: USER, body: { ...start, manualCoop: { displayName: 'Host', hero: 'scott' } }, store: hostStore, secret: SECRET, now: NOW });
  assert.equal(host.roomId, ROOM);
  assert.ok(host.joinToken);
  assert.deepEqual(hostStore.calls.map((c) => c[0]), ['room', 'ticket']);

  const guestStore = ticketStore();
  const guest = await processMatchStart({ userId: GUEST, body: { ...start, roomId: ROOM, joinToken: host.joinToken }, store: guestStore, secret: SECRET, now: NOW });
  assert.deepEqual(guestStore.calls.map((c) => c[0]), ['seat', 'ticket']);
  assert.equal(guest.seed, host.seed, 'every peer in a room gets the same seed');
  assert.equal(verifyTicket(guest.ticket, SECRET, { userId: GUEST, roomId: ROOM, now: NOW }).ok, true);

  await assert.rejects(processMatchStart({ userId: GUEST, body: { ...start, roomId: ROOM, joinToken: 'bad' }, store: ticketStore(), secret: SECRET, now: NOW }), /invalid_join_token/);
  await assert.rejects(processMatchStart({ userId: USER, body: { ...start, levelId: -5 }, store: ticketStore(), secret: SECRET, now: NOW }), /invalid_level/);
  await assert.rejects(processMatchStart({ userId: USER, body: start, store: ticketStore(), secret: null, now: NOW }), /match_tickets_not_configured/);

  const perk = perkOffer([])[0];
  const fresh = ticketStore();
  fresh.campaignCleared = async () => 0;
  await assert.rejects(processMatchStart({ userId: USER, body: { ...start, perks: [perk] }, store: fresh, secret: SECRET, now: NOW }), /invalid_perks/);
  fresh.campaignCleared = async () => 1;
  const signed = await processMatchStart({ userId: USER, body: { ...start, perks: [perk] }, store: fresh, secret: SECRET, now: NOW });
  assert.deepEqual(verifyTicket(signed.ticket, SECRET, { userId: USER, now: NOW }).payload.perks, [perk]);
  assert.deepEqual(fresh.calls.find((call) => call[0] === 'ticket')[1].p_perks, [perk]);

  const roomStore = ticketStore();
  roomStore.roomTicketPerks = async () => [perk];
  roomStore.campaignCleared = async () => 0;
  const echoed = await processMatchStart({
    userId: GUEST, body: { ...start, roomId: ROOM, joinToken: joinToken(ROOM, SECRET), perks: [perk] }, store: roomStore, secret: SECRET, now: NOW,
  });
  assert.deepEqual(echoed.perks, [perk], 'a guest runs the room ticket stack even with no personal clears');
  await assert.rejects(processMatchStart({
    userId: GUEST, body: { ...start, roomId: ROOM, joinToken: joinToken(ROOM, SECRET), perks: [] }, store: roomStore, secret: SECRET, now: NOW,
  }), /ticket_mismatch/);
});

// A short recorded match, played the way the browser plays it.
function recorded(seed = 4242, steps = 3600) {
  const level = levelById(1);
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const game = new Game(map, 'normal', 'alexander', null, 1, 'campaign', { rngSeed: seed });
  game.inputLog = [];
  const rng = makeRNG(3);
  game.exec({ t: 'found', s: 0, p: 0 });
  while (game.steps < steps && !game.over) {
    if (rng() < 0.3) game.exec({ t: 'hdir', p: 0, x: Math.floor(rng() * 3) - 1, z: Math.floor(rng() * 3) - 1 });
    game.update(SIM_DT);
  }
  const report = buildMatchReport(game);
  return { report, replay: { v: REPLAY_VERSION, frames: game.steps, heroIndex: 0, heroes: 'alexander', log: game.inputLog } };
}

function resultStore({ previousReports = [] } = {}) {
  const calls = [];
  return {
    calls,
    async findReport() { return null; },
    async loadContext() {
      return { character: { id: 'c1', level: 1, xp: 0, progress_revision: 1 }, stats: { campaign_cleared: 3 }, membership: null, previousReports, items: [] };
    },
    async applyResult(args) { calls.push(args); return { ok: true, character: { level: args.p_result.level } }; },
  };
}

const MATCH = { levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242 };

test('match-result: pays on the cheap checks and never replays inline', async () => {
  const { report, replay } = recorded();
  const ticket = signTicket(payload(), SECRET);
  const base = { requestId: 'req-review-1', characterId: 'mmo_a', ticket, report };
  const run = (body, store = resultStore()) => processMatchResult({ userId: USER, body, store, secret: SECRET, now: NOW }).then(() => store.calls[0]);

  // A personal best keeps its input log (with the server-known camp) for a
  // future leaderboard check. It pays straight away.
  const kept = await run({ ...base, replay });
  assert.deepEqual(kept.p_review.reasons, ['personal_best']);
  assert.equal(kept.p_review.flagged, false);
  assert.equal(kept.p_review.log.log.length, replay.log.length);
  assert.equal(kept.p_ticket_id, payload().tid);
  assert.equal(kept.p_result.report.kills, report.kills);

  // No log, or a malformed one, never blocks the payout.
  const noLog = await run(base);
  assert.equal(noLog.p_review.log, null);
  assert.ok(noLog.p_result, 'paid without a log');
  const badLog = await run({ ...base, replay: { v: REPLAY_VERSION, frames: -1 } });
  assert.equal(badLog.p_review.log, null);
  assert.ok(badLog.p_review.reasons.includes('invalid_log'));

  // Not a best and not suspicious: nothing to keep.
  const beaten = await run({ ...base, replay }, resultStore({ previousReports: [{ ...report, won: true, kills: 9999, threatLevel: 99 }] }));
  assert.deepEqual(beaten.p_review, { reasons: [], flagged: false, log: null });

  await assert.rejects(run({ ...base, roomId: ROOM, replay }), /ticket_mismatch/, 'a solo ticket cannot be reported as co-op');
});

test('match-result: suspicious runs are flagged, and the stored log can verify them later', async () => {
  const { report, replay } = recorded();
  const ticket = signTicket(payload(), SECRET);
  // Claim far more than the run did, but still inside the hard bounds.
  const killCap = Math.max(1, report.durationSeconds) * MATCH_LIMITS.killsPerSecond + MATCH_LIMITS.killSlack;
  const forged = { ...report, kills: Math.floor(killCap * 0.9), coins: report.coins + 40 };
  const store = resultStore();
  await processMatchResult({ userId: USER, body: { requestId: 'req-flag-1', characterId: 'mmo_a', ticket, report: forged, replay }, store, secret: SECRET, now: NOW });
  const sent = store.calls[0];
  assert.ok(sent.p_review.reasons.some((r) => r.startsWith('suspicious_')), sent.p_review.reasons.join(','));
  assert.equal(sent.p_review.flagged, true);
  assert.equal(sent.p_result.report.kills, forged.kills, 'inside the bounds the claim pays as reported (like comparable games)');

  // What a future leaderboard does with its top / flagged entries.
  const verdict = verifyReplay({ match: MATCH, report: forged, replay: JSON.parse(JSON.stringify(sent.p_review.log)) });
  assert.equal(verdict.status, 'mismatch');
  assert.deepEqual(verdict.mismatch.sort(), ['coins', 'kills']);
  assert.equal(verifyReplay({ match: MATCH, report, replay: sent.p_review.log }).status, 'verified');
  // Seed 2: (seed 1 happens to reproduce the same short-run counters on the v3 Greenfall terrain.)
  assert.equal(verifyReplay({ match: { ...MATCH, seed: 2 }, report, replay: sent.p_review.log }).status, 'mismatch', 'a run played on another seed does not verify');
});
