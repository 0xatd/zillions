import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { resolveAutosimRound } from './world-encounter.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set(['attacker_victory', 'defender_victory', 'retreat', 'surrender', 'draw']);
const b64 = (value) => Buffer.from(value).toString('base64url');

function signature(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signBattleAssignment(assignment, secret) {
  if (!secret || secret.length < 32) throw new Error('battle_signing_secret_too_short');
  const payload = b64(JSON.stringify({
    assignmentId: assignment.id,
    engagementId: assignment.engagement_id,
    encounterId: assignment.encounter_id,
    encounterRevision: Number(assignment.encounter_revision),
    requestedBy: assignment.requested_by,
    nonce: assignment.nonce,
    expiresAt: assignment.expires_at,
  }));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyBattleAssignment(token, secret, now = Date.now()) {
  if (!secret || secret.length < 32) throw new Error('battle_signing_secret_too_short');
  const [payload, supplied, extra] = String(token || '').split('.');
  if (!payload || !supplied || extra) throw new Error('invalid_battle_assignment');
  const expected = signature(payload, secret);
  const left = Buffer.from(supplied); const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error('invalid_battle_assignment');
  let claim;
  try { claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new Error('invalid_battle_assignment'); }
  if (!UUID.test(claim.assignmentId) || !UUID.test(claim.engagementId) || !UUID.test(claim.encounterId) || !UUID.test(claim.requestedBy)
    || !claim.nonce || !Number.isInteger(claim.encounterRevision)) throw new Error('invalid_battle_assignment');
  if (!Number.isFinite(Date.parse(claim.expiresAt)) || Date.parse(claim.expiresAt) <= now) throw new Error('battle_assignment_expired');
  return claim;
}

export function validateBattleResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_battle_result');
  const allowed = new Set(['outcome', 'winnerPartyId', 'casualties', 'morale', 'cargoTransfers', 'prisoners', 'retreatRoutes', 'stateHash', 'completedTick']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('unsupported_battle_result_field');
  if (!OUTCOMES.has(value.outcome) || (value.winnerPartyId != null && !UUID.test(value.winnerPartyId))) throw new Error('invalid_battle_result');
  if (!Array.isArray(value.casualties) || value.casualties.length > 256) throw new Error('invalid_casualties');
  for (const row of value.casualties) {
    if (!row || !UUID.test(row.stackId) || !Number.isInteger(row.killed) || row.killed < 0
      || !Number.isInteger(row.wounded) || row.wounded < 0) throw new Error('invalid_casualties');
  }
  if (!value.morale || typeof value.morale !== 'object' || Array.isArray(value.morale)
    || Object.keys(value.morale).sort().join(',') !== 'attacker,defender') throw new Error('invalid_morale');
  for (const score of Object.values(value.morale)) if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('invalid_morale');
  if (!Array.isArray(value.cargoTransfers) || value.cargoTransfers.length > 128) throw new Error('invalid_cargo_transfers');
  for (const row of value.cargoTransfers) if (!row || !UUID.test(row.fromPartyId) || !UUID.test(row.toPartyId)
    || !/^[a-z0-9:_-]{1,64}$/i.test(row.commodityKey) || !Number.isFinite(Number(row.quantity)) || !(Number(row.quantity) >= 0)) throw new Error('invalid_cargo_transfers');
  if (!Array.isArray(value.prisoners) || value.prisoners.length > 128) throw new Error('invalid_prisoners');
  for (const row of value.prisoners) if (!row || !UUID.test(row.captorPartyId) || !UUID.test(row.sourcePartyId)
    || !/^[a-z0-9:_-]{1,64}$/i.test(row.unitKey) || !Number.isInteger(row.tier) || row.tier < 1 || row.tier > 10
    || !Number.isInteger(row.quantity) || row.quantity < 0) throw new Error('invalid_prisoners');
  if (!Array.isArray(value.retreatRoutes) || value.retreatRoutes.length > 2) throw new Error('invalid_retreat_routes');
  for (const row of value.retreatRoutes) if (!row || !UUID.test(row.partyId) || !UUID.test(row.routeId)) throw new Error('invalid_retreat_routes');
  if (!/^[a-f0-9]{32,128}$/i.test(String(value.stateHash || '')) || !Number.isInteger(value.completedTick) || value.completedTick < 0) throw new Error('invalid_battle_result');
  return value;
}

const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function autosimBattleAssignment(assignment, { maxRounds = 60 } = {}) {
  const snapshot = assignment?.force_snapshot;
  if (!snapshot || !UUID.test(snapshot.attackerPartyId) || !UUID.test(snapshot.defenderPartyId)) throw new Error('invalid_force_snapshot');
  if (snapshot.engagementMode !== 'autosim') throw new Error('autosim_not_available');
  const armies = new Map((snapshot.armies || []).map((army) => [army.id, army]));
  const suppliesByParty=new Map();for(const row of snapshot.supplies||[])suppliesByParty.set(row.party_id,(suppliesByParty.get(row.party_id)||0)+Math.max(0,numeric(row.quantity)));
  const stacksByParty = new Map([[snapshot.attackerPartyId, []], [snapshot.defenderPartyId, []]]);
  for (const stack of snapshot.stacks || []) {
    const partyId = armies.get(stack.army_id)?.party_id;
    if (stacksByParty.has(partyId)) stacksByParty.get(partyId).push(stack);
  }
  const makeForce = (partyId) => {
    const stacks = stacksByParty.get(partyId) || [];
    const troops = stacks.reduce((sum, stack) => sum + Math.max(0, numeric(stack.healthy)), 0);
    const weightedTier = stacks.reduce((sum, stack) => sum + numeric(stack.healthy) * numeric(stack.tier, 1), 0);
    const party = (snapshot.parties || []).find((row) => row.id === partyId) || {};
    return { troops, initialTroops: troops, morale: numeric(party.morale, 50), quality: troops ? weightedTier / troops : 1, supplies: snapshot.supplies ? (suppliesByParty.get(partyId)||0) : 50, fatigue: numeric(party.fatigue) };
  };
  const attacker = makeForce(snapshot.attackerPartyId), defender = makeForce(snapshot.defenderPartyId);
  if (attacker.troops < 1 || defender.troops < 1) throw new Error('empty_battle_force');
  const rounds = [];
  for (let round = 1; round <= maxRounds && attacker.troops > 0 && defender.troops > 0 && attacker.morale > 5 && defender.morale > 5; round++) {
    const resolved = resolveAutosimRound({ engagementId: snapshot.engagementId, round, seed: snapshot.seed, attacker, defender, terrain: snapshot.terrain?.kind || snapshot.terrain?.type || 'plains' });
    attacker.troops = Math.max(0, attacker.troops - resolved.attackerLosses);
    defender.troops = Math.max(0, defender.troops - resolved.defenderLosses);
    attacker.morale = Math.max(0, attacker.morale + resolved.attackerMoraleDelta);
    defender.morale = Math.max(0, defender.morale + resolved.defenderMoraleDelta);
    rounds.push(resolved);
  }
  const attackerWon = defender.troops === 0 || defender.morale <= 5 || (attacker.troops > defender.troops && rounds.length === maxRounds);
  const defenderWon = attacker.troops === 0 || attacker.morale <= 5 || (defender.troops > attacker.troops && rounds.length === maxRounds);
  const winnerPartyId = attackerWon === defenderWon ? null : attackerWon ? snapshot.attackerPartyId : snapshot.defenderPartyId;
  const outcome = winnerPartyId === snapshot.attackerPartyId ? 'attacker_victory' : winnerPartyId === snapshot.defenderPartyId ? 'defender_victory' : 'draw';
  const casualties = [];
  for (const [partyId, finalForce] of [[snapshot.attackerPartyId, attacker], [snapshot.defenderPartyId, defender]]) {
    let remainingLoss = finalForce.initialTroops - finalForce.troops;
    const stacks = [...(stacksByParty.get(partyId) || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (let index = 0; index < stacks.length; index++) {
      const healthy = Math.max(0, numeric(stacks[index].healthy));
      const loss = index === stacks.length - 1 ? remainingLoss : Math.min(remainingLoss, Math.round((finalForce.initialTroops - finalForce.troops) * healthy / finalForce.initialTroops));
      if (loss > 0) casualties.push({ stackId: stacks[index].id, killed: Math.max(0, Math.floor(loss * 0.8)), wounded: Math.max(0, loss - Math.floor(loss * 0.8)) });
      remainingLoss -= loss;
    }
  }
  const completedTick = Math.max(0, numeric(snapshot.startedTick)) + rounds.length;
  const canonical = { engagementId: snapshot.engagementId, outcome, winnerPartyId, casualties, rounds, completedTick };
  return validateBattleResult({ outcome, winnerPartyId, casualties, morale: { attacker: attacker.morale, defender: defender.morale }, cargoTransfers: [], prisoners: [], retreatRoutes: [], stateHash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'), completedTick });
}
