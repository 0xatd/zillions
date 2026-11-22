import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {levelById,SIM_DT,PLOT_KINDS} from '../src/config.js';

// Independent cardinal route supplies WASD input, not a teleport or a mock
// movement function. All actual motion uses the hero and squad update paths.
function walkHero(g,goal) {
 const h=g.heroes[0],N=g.map.size,start=(h.z|0)*N+(h.x|0),end=(goal[1]|0)*N+(goal[0]|0);
 const parent=new Int32Array(N*N).fill(-1),q=[start];parent[start]=start;
 for(let i=0;i<q.length&&parent[end]<0;i++){
  const k=q[i],x=k%N,z=k/N|0;
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const nx=x+dx,nz=z+dz,nk=nz*N+nx;
   if(nx<0||nz<0||nx>=N||nz>=N||parent[nk]>=0||!g.map.isWalkable(nx,nz))continue;
   const occupied=g.occ[nk];if(occupied&&!g.gateIds.has(occupied))continue;
   parent[nk]=k;q.push(nk);
  }
 }
 assert.ok(parent[end]>=0,'fixture must have a genuine route');
 const route=[];for(let k=end;k!==start;k=parent[k])route.push([k%N+.5,(k/N|0)+.5]);route.reverse();
 for(const [x,z] of route){let steps=0;while(Math.hypot(h.x-x,h.z-z)>.13&&steps++<90){
  const dx=x-h.x,dz=z-h.z,L=Math.hypot(dx,dz);
  g.exec({t:'hdir',p:0,x:dx/L,z:dz/L});g._updateHero(SIM_DT);g._updateUnits(SIM_DT);
 }assert.ok(steps<90,`hero stuck at ${h.x},${h.z} toward ${x},${z}`);}
 g.exec({t:'hdir',p:0,x:0,z:0});
 assert.ok(Math.hypot(h.x-goal[0],h.z-goal[1])<.3);
}

test('Widow Bluff: real hero and escort traverse both approaches at every wall tier and after rebuilding',()=>{
 const l=levelById(5),m=new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),g=new Game(m,'normal','scott',null,5);g.foundCity(0,0);
 // Pin the screenshot's named landmark and adjacent road fort; do not let a
 // generator change silently turn this into a different, easier crossing.
 assert.ok(g.nodes.some(n=>n.name==='Widow Bluff'&&n.x===138.5&&n.z===87.5));
 assert.ok(g.plots.find(p=>p.kind==='hq').plan.perimeters.some(p=>p.kind==='fort'&&p.cx===123&&p.cz===79));
 const hero=g.heroes[0],origin=[120.5,105.5];[hero.x,hero.z]=origin;
 g.zombies=[];const troops=[];
 for(let i=0;i<6;i++){const u=g._spawnUnit('soldier',origin[0]+(i%3)*.1,origin[1]+Math.floor(i/3)*.1);u.squadId='crossing';u.squadIndex=i;u.squadSize=6;troops.push(u);}
 for(const p of g.plots)if(p.kind==='tower')g._construct(p,true);
 const walls=g.plots.filter(p=>p.kind==='wall');
 // Partial build followed by all three tiers, then a real breach and rebuild.
 const states=['partial',...PLOT_KINDS.wall.tiers.map((_,i)=>`tier${i+1}`),'breached','rebuilt'];
 const damagedPlot=walls.find(p=>p.role==='outer'&&p.keep[0]===123);
 for(const state of states){
  if(state==='partial')for(const p of walls.filter((_,i)=>i%2===0))g._construct(p,true);
  if(state.startsWith('tier'))for(const p of walls)while(p.tier<Number(state.slice(4))){const nt=g.nextTier(p);if(nt.branch)p.branch='bastion';assert.notEqual(g._construct(p,true),false);}
  if(state==='breached'){
   const b=g.buildings.find(b=>b.plotId===damagedPlot.id&&b.alive&&!g.gateIds.has(b.id));
   g._damageBuilding(b,b.maxHp+1);g.buildings=g.buildings.filter(b=>b.alive);
   assert.ok(g.plotHpState(damagedPlot).missing>0);
  }
  if(state==='rebuilt'){g._rebuildPlot(damagedPlot);assert.equal(g.plotHpState(damagedPlot).missing,0);}
  g.setStance('guard');
  for(const goal of [[123.5,79.5],[138.5,87.5],[123.5,79.5],origin]){
   // Move the hero while troops defend, then issue Follow and permit 120
   // seconds for the last rank to cross the narrow fort/cliff approaches.
   g.setStance('defend');walkHero(g,goal);g.setStance('guard');
   for(let i=0;i<3600;i++)g._updateUnits(SIM_DT);
   assert.ok(troops.every(u=>Math.hypot(u.x-hero.x,u.z-hero.z)<7),`${state}: escort stranded en route to ${goal}`);
  }
  g.setStance('defend');for(let i=0;i<3600;i++)g._updateUnits(SIM_DT);
  assert.ok(troops.every(u=>Math.hypot(u.x-u.holdX,u.z-u.holdZ)<2),`${state}: retreat to defense failed`);
 }
});

test('burrowers tunnel through barriers but attack occupied economic buildings',()=>{
 const l=levelById(2),m=new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),g=new Game(m,'normal','scott',null,l.id);g.foundCity(0,0);
 const farm=g.plots.find(p=>p.kind==='farm');g._construct(farm,true);
 const b=g.buildings.find(b=>b.plotId===farm.id),z=g._spawnZombie('burrower',b.x-.01,b.z+.5,true,true);
 z.atkT=-1;const before=b.hp;g._moveZombie(z,1,0,z.def.chase,SIM_DT,true);
 assert.ok(b.hp<before,'a surfaced burrower must attack the farm rather than tunnel into a flow-field minimum');
 assert.ok(z.x<b.x,'non-barrier footprint stops the burrower');
 const wall=g.plots.find(p=>p.kind==='wall');g._construct(wall,true);
 const wb=g.buildings.find(b=>b.plotId===wall.id);z.x=wb.x-.01;z.z=wb.z+.5;z.atkT=-1;const whp=wb.hp;
 g._moveZombie(z,1,0,z.def.chase,SIM_DT,true);
 assert.ok(z.x>=wb.x,'wall tunneling must remain intact');assert.equal(wb.hp,whp);
});
