// Pure encounter rules. The authority layer supplies snapshots and persists results.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const TERRAIN = Object.freeze({
  plains: { escape: 0, concealment: 0, defense: 0 },
  forest: { escape: 8, concealment: 14, defense: 8 },
  hills: { escape: 3, concealment: 5, defense: 12 },
  mountains: { escape: -8, concealment: 9, defense: 20 },
  marsh: { escape: -12, concealment: 8, defense: 6 },
  urban: { escape: 4, concealment: 12, defense: 16 },
});

function terrainRules(terrain) {
  return TERRAIN[terrain] || TERRAIN.plains;
}

function armyMass(army = {}) {
  return Math.max(1, number(army.troops, 1));
}

function mobility(army = {}, terrain = 'plains') {
  const massPenalty = Math.log2(armyMass(army) + 1) * 1.8;
  const baggagePenalty = number(army.baggage, 0) * 0.12;
  const fatiguePenalty = number(army.fatigue, 0) * 0.18;
  return number(army.speed, 0) + number(army.scouting, 0) * 0.12
    - massPenalty - baggagePenalty - fatiguePenalty + terrainRules(terrain).escape;
}

export function evaluatePursuit({ pursuer = {}, caught = {}, terrain = 'plains', seed = 'pursuit' } = {}) {
  const pursuit = mobility(pursuer, terrain) + number(pursuer.scouting) * 0.18;
  const evasion = mobility(caught, terrain) + number(caught.scouting) * 0.25
    + terrainRules(terrain).concealment;
  const margin = pursuit - evasion;
  const escapeChance = clamp(Math.round(50 - margin * 2.5), 2, 98);
  const roll = seededUnit(`${seed}:pursuit`) * 100;
  return Object.freeze({
    pursuitScore: round(pursuit),
    evasionScore: round(evasion),
    escapeChance,
    caught: roll >= escapeChance,
    roll: round(roll),
  });
}

export function getCaughtForceOptions(context = {}) {
  const caught = context.caught || {};
  const pursuer = context.pursuer || {};
  const terrain = context.terrain || 'plains';
  const pursuit = evaluatePursuit({ ...context, caught, pursuer, terrain });
  const options = [
    option('fight', true),
    option('surrender', true),
    option('auto-command', true),
    option('parley', context.diplomacyAllowed !== false),
    option('call-allies', number(context.alliesInRange) > 0),
    option('escape', pursuit.escapeChance >= number(context.minimumEscapeChance, 10), { escapeChance: pursuit.escapeChance }),
    option('rearguard', armyMass(caught) >= 20, rearguardEstimate(caught, pursuer, terrain)),
    option('diversion', number(caught.baggage) > 0 || number(caught.supplies) > 0 || armyMass(caught) >= 10),
    option('fortify', terrainRules(terrain).defense >= 8 && number(context.timeToFortify, 0) > 0),
    option('scatter', armyMass(caught) >= 10 && context.canScatter !== false),
  ];
  return Object.freeze(options.filter((entry) => entry.available));
}

export function getPursuerOptions(context = {}) {
  const options = [
    option('press-attack', true),
    option('demand-surrender', true),
    option('accept-payment', context.parleyOffered === true),
    option('grant-safe-passage', context.parleyOffered === true),
    option('pursue-main-force', context.rearguardCommitted === true),
    option('engage-rearguard', context.rearguardCommitted === true),
    option('take-prisoners-and-release', context.surrenderOffered === true),
    option('disengage', true),
  ];
  return Object.freeze(options.filter((entry) => entry.available));
}

// Resolves only the strategic contact. `battle` means PR 7 must create and
// resolve the tactical engagement; this function never invents casualties.
export function resolveEncounterDecision(context = {}, caughtChoice, pursuerChoice) {
  const caughtOptions = new Set(getCaughtForceOptions(context).map(({ id }) => id));
  if (!caughtOptions.has(caughtChoice)) throw new Error('unavailable_caught_choice');
  const responseContext = {
    ...context,
    parleyOffered: caughtChoice === 'parley',
    surrenderOffered: caughtChoice === 'surrender',
    rearguardCommitted: caughtChoice === 'rearguard',
  };
  const pursuerOptions = new Set(getPursuerOptions(responseContext).map(({ id }) => id));
  if (!pursuerOptions.has(pursuerChoice)) throw new Error('unavailable_pursuer_choice');

  const pursuit = evaluatePursuit(context);
  const roll = seededUnit(`${context.seed || 'encounter'}:${caughtChoice}:${pursuerChoice}`) * 100;
  let outcome = 'battle';
  const effects = {};
  if (pursuerChoice === 'disengage' || pursuerChoice === 'grant-safe-passage') outcome = 'escaped';
  else if (caughtChoice === 'surrender' && ['demand-surrender', 'take-prisoners-and-release'].includes(pursuerChoice)) outcome = 'surrendered';
  else if (caughtChoice === 'parley' && pursuerChoice === 'accept-payment') outcome = 'negotiated';
  else if (caughtChoice === 'escape') outcome = roll < pursuit.escapeChance ? 'escaped' : 'battle';
  else if (caughtChoice === 'diversion') {
    const chance = clamp(pursuit.escapeChance + terrainRules(context.terrain).concealment + 12, 5, 95);
    outcome = roll < chance ? 'escaped' : 'battle'; effects.cargoSacrificed = true;
  } else if (caughtChoice === 'rearguard') {
    const estimate = rearguardEstimate(context.caught, context.pursuer, context.terrain, context.rearguardFraction);
    Object.assign(effects, estimate);
    outcome = pursuerChoice === 'pursue-main-force' ? 'battle' : 'rearguard-engaged';
  } else if (caughtChoice === 'scatter') {
    const chance = clamp(pursuit.escapeChance + terrainRules(context.terrain).concealment - 10, 5, 90);
    outcome = roll < chance ? 'scattered' : 'battle'; effects.cohesionLoss = 25;
  } else if (caughtChoice === 'call-allies') outcome = 'awaiting-allies';
  else if (caughtChoice === 'fortify') { outcome = 'battle'; effects.defenseBonus = terrainRules(context.terrain).defense; }
  return Object.freeze({ outcome, caughtChoice, pursuerChoice, roll: round(roll), pursuit, effects: Object.freeze(effects), tacticalPending: outcome === 'battle' || outcome === 'rearguard-engaged' });
}

export function rearguardEstimate(caught = {}, pursuer = {}, terrain = 'plains', fraction = 0.25) {
  const committed = clamp(Math.ceil(armyMass(caught) * clamp(fraction, 0.1, 0.6)), 1, armyMass(caught) - 1);
  const delay = Math.max(1, Math.round(committed / Math.max(1, armyMass(pursuer)) * 30 + terrainRules(terrain).defense / 4));
  return Object.freeze({
    committedTroops: committed,
    escapingTroops: armyMass(caught) - committed,
    expectedDelayMinutes: delay,
    rearguardCaptureRisk: clamp(Math.round(75 + armyMass(pursuer) / Math.max(1, committed) * 4), 75, 98),
  });
}

export function evaluateSealedEngagement({ mutualAgreement = false, hostileContacts = [], expectedDurationMinutes = 0, interferenceHorizonMinutes = 0 } = {}) {
  const horizon = Math.max(number(expectedDurationMinutes), number(interferenceHorizonMinutes));
  const interfering = hostileContacts.filter((contact) => number(contact.arrivalMinutes, Infinity) <= horizon);
  const reasons = [];
  if (!mutualAgreement) reasons.push('mutual-agreement-required');
  if (interfering.length) reasons.push('hostile-force-within-interference-horizon');
  return Object.freeze({ eligible: reasons.length === 0, horizonMinutes: horizon, interferingIds: interfering.map((x) => x.id), reasons });
}

export function resolveAutosimRound({ engagementId, round, seed, attacker, defender, terrain = 'plains' } = {}) {
  const a = forcePower(attacker, 0);
  const d = forcePower(defender, terrainRules(terrain).defense);
  const varianceA = 0.9 + seededUnit(`${seed}:${engagementId}:${round}:a`) * 0.2;
  const varianceD = 0.9 + seededUnit(`${seed}:${engagementId}:${round}:d`) * 0.2;
  const total = Math.max(1, a * varianceA + d * varianceD);
  const intensity = clamp(number(attacker?.intensity, 1), 0.25, 2);
  const attackerLosses = clamp(Math.round(armyMass(attacker) * (d * varianceD / total) * 0.035 * intensity), 0, armyMass(attacker));
  const defenderLosses = clamp(Math.round(armyMass(defender) * (a * varianceA / total) * 0.035 * intensity), 0, armyMass(defender));
  return Object.freeze({
    engagementId, round,
    attackerLosses, defenderLosses,
    attackerMoraleDelta: -clamp(Math.round(attackerLosses / armyMass(attacker) * 100), 0, 20),
    defenderMoraleDelta: -clamp(Math.round(defenderLosses / armyMass(defender) * 100), 0, 20),
    momentum: roundValue((a * varianceA - d * varianceD) / total),
  });
}

export function applyTacticalContribution(state = {}, contribution = {}) {
  const applied = Array.isArray(state.appliedContributionIds) ? state.appliedContributionIds : [];
  if (!contribution.id) throw new Error('Tactical contribution requires a stable id');
  if (applied.includes(contribution.id)) return Object.freeze({ ...state, appliedContributionIds: [...applied] });
  const deltas = contribution.deltas || {};
  return Object.freeze({
    ...state,
    attackerTroops: Math.max(0, number(state.attackerTroops) + number(deltas.attackerTroops)),
    defenderTroops: Math.max(0, number(state.defenderTroops) + number(deltas.defenderTroops)),
    attackerMorale: clamp(number(state.attackerMorale) + number(deltas.attackerMorale), 0, 100),
    defenderMorale: clamp(number(state.defenderMorale) + number(deltas.defenderMorale), 0, 100),
    appliedContributionIds: [...applied, contribution.id],
  });
}

function forcePower(force = {}, defenseBonus = 0) {
  return armyMass(force) * Math.max(0.1, number(force.quality, 1))
    * (0.5 + clamp(number(force.morale, 50), 0, 100) / 100)
    * (0.6 + clamp(number(force.supplies, 50), 0, 100) / 125)
    * (1 - clamp(number(force.fatigue), 0, 100) / 250)
    * (1 + defenseBonus / 100);
}

function option(id, available, details = {}) { return Object.freeze({ id, available: Boolean(available), ...details }); }
function round(value) { return Math.round(value * 100) / 100; }
function roundValue(value) { return Math.round(value * 10000) / 10000; }
function seededUnit(input) {
  let hash = 2166136261;
  for (const char of String(input)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  hash += hash << 13; hash ^= hash >>> 7; hash += hash << 3; hash ^= hash >>> 17; hash += hash << 5;
  return (hash >>> 0) / 4294967296;
}
