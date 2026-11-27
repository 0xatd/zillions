import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { levelById, SIM_DT } from '../src/config.js';
import { stateHash } from '../src/lockstep-hash.js';
const make = ({level=2,difficulty='normal',mode='campaign',snap=null,opts={}}={}) => {
 const l=levelById(level);
 const map=new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests});
 const g=new Game(map,difficulty,'scott',snap,level,mode,opts);
 if(!snap) g.exec({t:'found',s:0,p:0});
 return g;
};

test('Iron Rain preparation varies by difficulty and survives save/load without restarting',()=>{
 for(const [difficulty,seconds] of [['casual',45],['normal',30],['brutal',20]]){
  const g=make({difficulty});
  assert.equal(g.ironRain.prep,seconds);
  const timers=g.nests.map(n=>n.musterT), threat=g.threat, count=g.zombies.length;
  g._updateSiege(seconds-1);
  assert.equal(g.ironRain.prep,1);
  assert.equal(g.threat,threat);
  assert.equal(g.zombies.length,count);
  assert.deepEqual(g.nests.map(n=>n.musterT),timers);
  const restored=make({difficulty,snap:g.snapshot()});
  assert.equal(restored.ironRain.prep,1);
  assert.equal(stateHash(restored),stateHash(g));
  restored._updateSiege(2);
  assert.equal(restored.ironRain.prep,0);
  assert.ok(restored.threat>threat);
  assert.ok(restored.nests.some((n,i)=>n.alive&&n.musterT<timers[i]));
 }
});

test('Iron Rain income requires a living building; capture alone is not passive income',()=>{
 const g=make();g._updateIncome(0);const base=g.incomeRate;
 const node=g.nodes.find(n=>!n.offMap);assert.ok(node);
 // Arrange captured ground and sufficient budget; exercise real construction/destruction.
 node.owner='player';g._updateIncome(0);assert.equal(g.incomeRate,base);
 const plot=g.plots.find(p=>p.nodeId===node.id);assert.ok(plot);
 g.gold=1000;g._construct(plot);
 const camp=g.buildings.find(b=>b.plotId===plot.id);assert.ok(camp);
 g._updateIncome(0);const built=g.incomeRate;assert.ok(built>base);
 g._construct(plot);g._updateIncome(0);assert.ok(g.incomeRate>built,'upgrading improves income');
 g._destroyBuilding(g.buildings.find(b=>b.plotId===plot.id),true);
 g._updateIncome(0);assert.equal(g.incomeRate,base,'losing the camp removes both its income and resource yield');
 const house=g.plots.find(p=>p.kind==='house');g._construct(house);g._updateIncome(0);assert.ok(g.incomeRate>base);
 g._destroyBuilding(g.buildings.find(b=>b.plotId===house.id),true);g._updateIncome(0);assert.equal(g.incomeRate,base);
});

test('razing bases lowers pressure, dead sources cannot muster, and victory never spawns from ruins',()=>{
 const g=make();g.ironRain.prep=0;
 const nests=g.nests.filter(n=>n.alive);assert.ok(nests.length>1);
 const threat=g.threat;
 for(const n of nests.slice(0,-1)){
  g._damageNest(n,n.hp+1);
  assert.equal(g.threat,threat,'conquest does not increase enemy threat');
  const count=g.zombies.length;g._hiveMuster(n,1);assert.equal(g.zombies.length,count);
 }
 const last=nests.at(-1);g._damageNest(last,1);
 assert.ok(g.boss && !g.boss.dead,'commander deploys while last source is alive');
 assert.ok(Math.hypot(g.boss.x-last.x,g.boss.z-last.z)<15);
 const restored=make({snap:g.snapshot()});assert.equal(restored.ironRain.commanderReleased,true);
 // Killing the commander before razing the last base must not win early.
 g.damageZombie(g.boss,g.boss.hp+1,0,0,null,null,true);g._updateSiege(SIM_DT);
 assert.equal(g.over,false);g._damageNest(last,last.hp+1);g._updateSiege(SIM_DT);
 assert.equal(g.won,true);
 const rn=restored.nests.find(n=>n.id===last.id);
 restored._damageNest(rn,rn.hp+1);
 const count=restored.zombies.length;
 restored._updateSiege(SIM_DT);
 assert.equal(restored.zombies.length,count,'no final wave materializes from destroyed sources');
 assert.equal(restored.over,false,'living commander must still be defeated');
 restored.damageZombie(restored.boss,restored.boss.hp+1,0,0,null,null,true);
 assert.equal(restored.over,true);assert.equal(restored.won,true);
});

test('Iron Rain is not applied to survival, daily, expedition armies or legacy saves',()=>{
 for(const mode of ['survival','daily']) assert.equal(make({mode}).ironRain,null);
 assert.equal(make({opts:{worldArmy:[5]}}).ironRain,null);
 const snap=make().snapshot();snap.v=15;delete snap.ironRain;
 assert.equal(make({snap}).ironRain,null);
});

test('preparation and commander release participate in multiplayer agreement',()=>{
 const g=make();const hash=stateHash(g);
 g.ironRain.prep-=1;assert.notEqual(stateHash(g),hash);
 g.ironRain.prep+=1;g.ironRain.commanderReleased=true;assert.notEqual(stateHash(g),hash);
});

// A completed revive must have one canonical state before and after reload.
test('hero revival consumes the timer without retaining a negative remainder',()=>{
 const g=make();const hero=g.hero;
 g._damageUnit(hero,hero.hp+100000);
 assert.equal(hero.dead,true);hero.reviveT=SIM_DT/2;
 g._updateHeroOne(hero,SIM_DT);
 assert.equal(hero.dead,false);assert.equal(hero.reviveT,0);
 const restored=make({snap:g.snapshot()});
 assert.equal(restored.hero.reviveT,hero.reviveT);
});
