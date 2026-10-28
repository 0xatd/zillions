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
import { REPLAY_VERSION } from '../src/match-replay.js';
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

function resultStore() {
  const calls = [];
  return {
    calls,
    async findReport() { return null; },
    async loadContext() {
      return { character: { id: 'c1', level: 1, xp: 0, progress_revision: 1 }, stats: { campaign_cleared: 3 }, membership: null, previousReports: [], items: [] };
    },
    async applyResult(args) { calls.push(args); return { ok: true, character: { level: args.p_result.level } }; },
  };
}

test('match-result: a personal best must carry a replay, and the replay decides', async () => {
  const { report, replay } = recorded();
  const ticket = signTicket(payload(), SECRET);
  const base = { requestId: 'req-replay-1', characterId: 'mmo_a', ticket, report };
  const run = (body, extra = {}) => processMatchResult({ userId: USER, body, store: extra.store || resultStore(), secret: SECRET, now: NOW, random: () => 1, ...extra });

  await assert.rejects(run(base), (e) => e.message === 'replay_required' && /personal_best/.test(e.detail));

  const okStore = resultStore();
  await run({ ...base, replay }, { store: okStore });
  assert.equal(okStore.calls[0].p_replay.status, 'verified');
  assert.equal(okStore.calls[0].p_ticket_id, payload().tid);

  const forgedStore = resultStore();
  const forged = { ...report, kills: report.kills + 50, coins: report.coins + 40 };
  const settled = await run({ ...base, report: forged, replay }, { store: forgedStore });
  const sent = forgedStore.calls[0];
  assert.equal(sent.p_replay.status, 'mismatch');
  assert.deepEqual(sent.p_replay.mismatch.sort(), ['coins', 'kills']);
  assert.equal(sent.p_result.report.kills, report.kills, 'the server-replayed counters pay out, not the claim');
  assert.equal(settled.report.kills, report.kills);

  // Seed 2: (seed 1 happens to reproduce the same short-run counters on the v3 Greenfall terrain.)
  const wrongSeed = signTicket(payload({ seed: 2 }), SECRET);
  const seedStore = resultStore();
  await run({ ...base, ticket: wrongSeed, replay }, { store: seedStore });
  assert.equal(seedStore.calls[0].p_replay.status, 'mismatch', 'a run played on another seed does not verify');

  await assert.rejects(run({ ...base, roomId: ROOM, replay }), /ticket_mismatch/, 'a solo ticket cannot be reported as co-op');
});

test('match-result: a replay timeout grants nothing, not even a forged claim, and is retryable', async () => {
  const { report, replay } = recorded();
  const ticket = signTicket(payload(), SECRET);
  // The reviewer's repro: claim far more than the run did (60 vs 10 kills).
  const forged = { ...report, kills: report.kills + 50, nests: report.nests, coins: report.coins + 40 };
  for (const claim of [forged, report]) {
    const store = resultStore();
    let t = 0;
    await assert.rejects(
      processMatchResult({
        userId: USER, body: { requestId: 'req-timeout-1', characterId: 'mmo_a', ticket, report: claim, replay },
        store, secret: SECRET, now: NOW, random: () => 1, replayBudgetMs: 1, clock: () => (t += 5),
      }),
      (e) => e.message === 'replay_retry_later' && e.status === 503 && e.retryAfterSeconds > 0,
    );
    assert.equal(store.calls.length, 0, 'nothing reaches apply_match_result: no XP, loot, Alloy, stats, and the ticket stays unspent');
  }
  // The same request with enough budget is judged on the server's replay.
  const store = resultStore();
  await processMatchResult({
    userId: USER, body: { requestId: 'req-timeout-1', characterId: 'mmo_a', ticket, report: forged, replay },
    store, secret: SECRET, now: NOW, random: () => 1,
  });
  assert.equal(store.calls[0].p_replay.status, 'mismatch');
  assert.equal(store.calls[0].p_result.report.kills, report.kills, 'the retry pays the replayed kills, not the claim');
});
