import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {levelById} from '../src/config.js';
import {stateHash} from '../src/lockstep-hash.js';
const fresh=(snap=null,opts={})=>{const l=levelById(1);return new Game(new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),'normal','alexander',snap,1,'campaign',{rngSeed:42,...opts});};
test('learning phase does not farm income and first purchase starts income',()=>{
 const g=fresh();g.foundCity(0);const gold=g.gold,acc=g._incomeAcc;
 for(let i=0;i<180;i++)g._updateIncome(1);
 assert.equal(g.gold,gold);assert.equal(g._incomeAcc,acc);assert.equal(g.incomeRate,0);
 g._construct(g.plots.find(p=>p.kind==='camp_militia'));
 assert.equal(g.firstSiege.stage,'warning');const after=g.gold;
 for(let i=0;i<60;i++)g._updateIncome(1);
 assert.ok(g.gold>after);
});
test('fresh defense has mixed starter squad exactly once across reload',()=>{
 const g=fresh();g.foundCity(0);const squad=g.units.filter(u=>!u.hero);
 assert.deepEqual(squad.map(u=>u.key).sort(),['ranger','ranger','ranger','soldier','soldier']);
 const restored=fresh(g.snapshot());assert.equal(stateHash(g),stateHash(restored));
 restored.foundCity(0);assert.equal(restored.units.filter(u=>!u.hero).length,5);
});
test('legacy expedition army is not duplicated by the starter squad',()=>{
 const g=fresh(null,{worldArmy:[4]});g.foundCity(0);assert.equal(g.units.filter(u=>!u.hero).length,4);
});
test('first attack status distinguishes cleanup after relief expires',()=>{
 const g=fresh();g.foundCity(0);g.firstSiege.stage='defend';g.firstSiege.startedAt=0;g.firstSiege.waveIds=[100];
 g.time=20;assert.match(g.firstSiegeStatus().title,/FIRST ATTACK/);
 g.time=240;assert.match(g.firstSiegeStatus().title,/REINFORCEMENTS ACTIVE/);
});
