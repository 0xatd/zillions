import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { levelById, SIEGE } from '../src/config.js';
const fresh=()=>{const l=levelById(5);const m=new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests});const g=new Game(m,'normal',{k:'scott',camp:'camp_militia'},null,5,'campaign');g.foundCity(0,0);return g;};
for(const kind of ['farm','house'])test(`${kind}: payouts, upgrades, ruins and fractional carry`,()=>{
 const g=fresh(),plot=g.plots.find(p=>p.kind===kind);g._construct(plot,true);
 const b=g.buildings.find(b=>b.plotId===plot.id);assert.ok(b?.alive);
 // Isolate this real constructed building from keep and node income.
 g.buildings=[b];g.nodes=[];g.gold=0;g.stats.coins=0;g.incomeT=SIEGE.incomeTick;g._incomeAcc=0;
 for(let i=0;i<10;i++)g._updateIncome(4);
 const expected=b.def.income*g.economy.income;
 assert.equal(g.gold,Math.floor(expected+1e-8));assert.ok(Math.abs(g.gold+g._incomeAcc-expected)<1e-8);
 const firstRate=g.incomeRate;g._construct(plot,true);g._updateIncome(4);assert.ok(g.incomeRate>firstRate,'upgrade must increase income');
 for(const building of g.buildings)building.alive=false;
 const balance=g.gold,carry=g._incomeAcc;g._updateIncome(40);
 assert.equal(g.incomeRate,0);assert.equal(g.gold,balance+Math.floor(carry));
 assert.ok(g._incomeAcc<1,'fractional remainder must not be discarded');
});
test('normal simulation clock credits income only after founding',()=>{
 const g=fresh(),before=g.gold;
 // Full siege-clock update, not a synthetic wallet write.
 for(let i=0;i<241;i++)g._updateSiege(1/60);
 assert.ok(g.gold>before);assert.ok(g.events.some(e=>e.type==='income'&&e.v>0));
 const frozen=g.gold;g.phase='found';g._updateSiege(40);assert.equal(g.gold,frozen);
});
