import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { autosimBattleAssignment } from '../src/living-world-battle.js';

const attacker = randomUUID(), defender = randomUUID(), aa = randomUUID(), da = randomUUID();
const assignment = { force_snapshot: { engagementId: randomUUID(), engagementMode: 'autosim', attackerPartyId: attacker, defenderPartyId: defender, seed: 77, startedTick: 10, terrain: { kind: 'hills' }, parties: [{ id: attacker, morale: 70, fatigue: 4 }, { id: defender, morale: 65, fatigue: 8 }], armies: [{ id: aa, party_id: attacker }, { id: da, party_id: defender }], stacks: [{ id: randomUUID(), army_id: aa, healthy: 80, tier: 2 }, { id: randomUUID(), army_id: da, healthy: 55, tier: 1 }] } };
const one = autosimBattleAssignment(assignment), two = autosimBattleAssignment(assignment);
assert.deepEqual(one, two, 'autosim must replay exactly from its immutable assignment');
assert.match(one.stateHash, /^[a-f0-9]{64}$/);
assert.ok(one.casualties.length > 0);
assert.equal(one.casualties.every((row) => row.killed >= 0 && row.wounded >= 0), true);
assert.throws(() => autosimBattleAssignment({ force_snapshot: {} }), /invalid_force_snapshot/);
assert.throws(() => autosimBattleAssignment({ force_snapshot: { ...assignment.force_snapshot, engagementMode: 'hybrid' } }), /autosim_not_available/);

const sql = readFileSync(new URL('../supabase/migrations/20260820223000_tactical_battle_autosim.sql', import.meta.url), 'utf8');
for (const marker of ['world_encounter_open_engagement','world_engagements','autosim','hybrid','attackerPartyId','defenderPartyId','on conflict(encounter_id) do nothing']) assert.ok(sql.includes(marker), `${marker} missing`);
assert.match(sql, /after update of state on public\.world_encounters/);
console.log('tactical battle launch and autosim checks passed');
