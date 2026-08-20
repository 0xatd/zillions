import assert from 'node:assert/strict';
import { combatAlert, runReview, storeRetry } from '../src/combat-readability.js';

const game = (overrides = {}) => ({
  over: false, phase: 'live', finalStand: false,
  heroes: [{ hp: 100, maxHp: 100 }],
  buildings: [{ kind: 'hq', alive: true, hp: 100, maxHp: 100 }],
  liveNests: () => 2, activeNodes: () => [{ id: 1 }], ...overrides,
});
assert.equal(combatAlert(game(), 0), null, 'healthy combat stays quiet');
assert.equal(combatAlert(game({ buildings: [{ kind: 'hq', alive: true, hp: 20, maxHp: 100 }] }), 0).key, 'keep-critical');
assert.equal(combatAlert(game({ heroes: [{ hp: 20, maxHp: 100 }] }), 0).key, 'hero-critical');
assert.equal(combatAlert(game({ finalStand: true, boss: { dead: false, enraged: true } }), 0).key, 'boss-enraged');
const keepLoss = runReview({ won: false, stats: { kills: 50, built: 6, lost: 4, bestHeld: 1 }, threat: 3,
  game: game({ buildings: [{ kind: 'hq', alive: false, hp: 0, maxHp: 100 }] }) });
assert.match(keepLoss.cause.title, /Keep/);
assert.match(keepLoss.action, /defense|Defend|warning/);
const explicitKeep = runReview({ won: false, stats: {}, game: game({ defeatCause: 'keep_destroyed', buildings: [], liveNests: () => 3 }) });
assert.match(explicitKeep.cause.title, /Keep/, 'authoritative Keep cause wins over live nests');
const exhausted = runReview({ won: false, stats: { heroDeaths: 3 }, game: game({ defeatCause: 'party_exhausted', liveNests: () => 3 }) });
assert.match(exhausted.cause.title, /lives/, 'authoritative party exhaustion wins over live nests');
const unknown = runReview({ won: false, stats: {}, game: game({ defeatCause: 'future_cause', liveNests: () => 2 }) });
assert.match(unknown.cause.title, /hives/, 'unknown causes retain legacy evidence fallback');
const empty = runReview({ won: false, stats: null, game: null });
assert.ok(empty.cause.title && empty.action, 'missing stats still yield useful copy');
assert.match(runReview({ won: true, stats: { built: 4, lost: 0 } }).cause.title, /held/);
const memory = new Map();
const storage = { setItem: (k, v) => memory.set(k, v), getItem: (k) => memory.get(k) ?? null };
assert.equal(storeRetry(storage, { level: 2, hero: 'scott', difficulty: 'casual' }), true);
assert.equal(storeRetry({ setItem: () => { throw new Error('blocked'); }, getItem: () => null }, { level: 2, hero: 'scott' }), false);
assert.equal(storeRetry(storage, { level: 2 }), false, 'invalid retry is never persisted');
console.log('combat readability checks passed');
