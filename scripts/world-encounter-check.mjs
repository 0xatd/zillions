import assert from 'node:assert/strict';
import {
  applyTacticalContribution, evaluateSealedEngagement, getCaughtForceOptions,
  getPursuerOptions, rearguardEstimate, resolveAutosimRound, resolveEncounterDecision,
} from '../src/world-encounter.js';

const ids = (options) => options.map((x) => x.id);
const pinned = getCaughtForceOptions({
  seed: 'pinned', terrain: 'plains', minimumEscapeChance: 20,
  caught: { troops: 8, speed: 4, scouting: 0, fatigue: 90, baggage: 0, supplies: 0 },
  pursuer: { troops: 500, speed: 18, scouting: 50 }, alliesInRange: 0, timeToFortify: 0,
});
assert(!ids(pinned).includes('escape'), 'impossible escape must be withheld');
assert(!ids(pinned).includes('rearguard'), 'tiny force cannot split a rearguard');
assert(!ids(pinned).includes('call-allies'), 'allies out of range must be withheld');

const rear = rearguardEstimate({ troops: 100 }, { troops: 140 }, 'forest', 0.25);
assert.equal(rear.committedTroops, 25);
assert.equal(rear.escapingTroops, 75);
assert(rear.expectedDelayMinutes > 0);
assert(rear.rearguardCaptureRisk >= 75);

assert.equal(evaluateSealedEngagement({ mutualAgreement: true, expectedDurationMinutes: 40, hostileContacts: [{ id: 'late', arrivalMinutes: 50 }] }).eligible, true);
const unsafe = evaluateSealedEngagement({ mutualAgreement: true, expectedDurationMinutes: 40, hostileContacts: [{ id: 'near', arrivalMinutes: 20 }] });
assert.equal(unsafe.eligible, false);
assert.deepEqual(unsafe.interferingIds, ['near']);
assert.equal(evaluateSealedEngagement({ mutualAgreement: false }).eligible, false);

const roundInput = {
  engagementId: 'e-1', round: 3, seed: 'world-42', terrain: 'hills',
  attacker: { troops: 200, quality: 1.2, morale: 75, supplies: 70, fatigue: 10 },
  defender: { troops: 180, quality: 1.1, morale: 80, supplies: 65, fatigue: 5 },
};
assert.deepEqual(resolveAutosimRound(roundInput), resolveAutosimRound(roundInput), 'autosim must replay exactly');
assert.notDeepEqual(resolveAutosimRound(roundInput), resolveAutosimRound({ ...roundInput, round: 4 }), 'round seed must change outcome');

const base = { attackerTroops: 100, defenderTroops: 80, attackerMorale: 70, defenderMorale: 60, appliedContributionIds: [] };
const contribution = { id: 'battle-result-7', deltas: { attackerTroops: -5, defenderTroops: -20, attackerMorale: 4, defenderMorale: -9 } };
const once = applyTacticalContribution(base, contribution);
const twice = applyTacticalContribution(once, contribution);
assert.deepEqual(twice, once, 'replayed tactical result must be a no-op');
assert.equal(once.defenderTroops, 60);

const strategic = {
  seed: 'contact-42', terrain: 'forest', minimumEscapeChance: 5,
  caught: { troops: 80, speed: 8, scouting: 35, fatigue: 20, baggage: 10, supplies: 40 },
  pursuer: { troops: 120, speed: 9, scouting: 30, fatigue: 10 },
  alliesInRange: 1, timeToFortify: 2,
};
const escape = resolveEncounterDecision(strategic, 'escape', 'press-attack');
assert.deepEqual(escape, resolveEncounterDecision(strategic, 'escape', 'press-attack'), 'strategic decision must replay exactly');
assert.equal(typeof escape.tacticalPending, 'boolean');
assert.throws(() => resolveEncounterDecision({ ...strategic, alliesInRange: 0 }, 'call-allies', 'press-attack'), /unavailable_caught_choice/);
const rearDecision = resolveEncounterDecision(strategic, 'rearguard', 'engage-rearguard');
assert.equal(rearDecision.outcome, 'rearguard-engaged');
assert.equal(rearDecision.tacticalPending, true);
assert(ids(getPursuerOptions({ rearguardCommitted: true })).includes('pursue-main-force'));

console.log('world encounter checks passed');
