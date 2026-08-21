import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { autosimBattleAssignment } from '../src/living-world-battle.js';
import { verifyLivingWorldBattleReplay } from '../src/living-world-battle-replay.js';
import { Game } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { levelById } from '../src/config.js';

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
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),ui=readFileSync(new URL('../src/ui.js',import.meta.url),'utf8'),api=readFileSync(new URL('../api/living-world-battle.js',import.meta.url),'utf8');
for (const marker of ['world_encounter_open_engagement','world_engagements','autosim','hybrid','attackerPartyId','defenderPartyId','on conflict(encounter_id) do nothing']) assert.ok(sql.includes(marker), `${marker} missing`);
assert.match(sql, /after update of state on public\.world_encounters/);
assert.match(ui,/data-encounter="live"/,'active engagements must offer player command');
assert.match(main,/action:'launch'[\s\S]*configureLivingWorldBattle|action:'launch'[\s\S]*startGame/,'the client must launch the signed persistent assignment');
assert.match(main,/assignmentToken:battle\.token[\s\S]*replay/,'the client must return its deterministic command replay');
assert.match(api,/verifyLivingWorldBattleReplay[\s\S]*living_world_commit_battle/,'the server must derive and commit the played result');

const actor=randomUUID(),tactical={id:randomUUID(),requested_by:actor,force_snapshot:{...assignment.force_snapshot,engagementMode:'tactical',parties:[{id:attacker,owner_user_id:actor,morale:70,fatigue:4},{id:defender,owner_user_id:null,morale:65,fatigue:8}],stacks:[{id:randomUUID(),army_id:aa,unit_key:'freehold_spearman',healthy:8,tier:1},{id:randomUUID(),army_id:da,unit_key:'rotmire_raider',healthy:6,tier:1}]}};
const level=levelById(1),game=new Game(new TerrainField(Number(tactical.force_snapshot.seed),level.theme,{size:level.size,nests:level.nests}),'normal','alexander',null,1,'living_world_battle');
game.configureLivingWorldBattle(tactical);let completedTick=0;while(!game.over&&completedTick<108000){game.update(1/30);completedTick++;}
assert.equal(game.over,true,'the exact assigned forces must resolve in the tactical simulation');
const verified=verifyLivingWorldBattleReplay(tactical,{version:1,completedTick,commands:[]});
assert.equal(verified.winnerPartyId,game.won?attacker:defender);assert.ok(verified.casualties.length>0);assert.match(verified.stateHash,/^[a-f0-9]{64}$/);
console.log('tactical battle launch and autosim checks passed');
