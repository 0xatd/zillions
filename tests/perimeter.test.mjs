import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {LEVELS,PLOT_KINDS} from '../src/config.js';
function flood(g,start,pass){const N=g.map.size,seen=new Set([start]),q=[start];for(let i=0;i<q.length;i++){const k=q[i],x=k%N,z=k/N|0;for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz,ni=nz*N+nx;if(nx<0||nz<0||nx>=N||nz>=N||seen.has(ni)||!pass(nx,nz,ni))continue;seen.add(ni);q.push(ni);}}return seen;}
for(const l of LEVELS)test(`${l.name}: base and fortified expansions stay closed and traversable at every wall tier`,()=>{
 for(let site=0;site<3;site++){
 const m=new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),g=new Game(m,'normal','scott',null,l.id);g.foundCity(site,0);
 const plans=g.plots.find(p=>p.kind==='hq').plan.perimeters;assert.ok(plans?.length);
 for(const p of g.plots)if(p.kind==='tower'||p.kind.startsWith('camp_'))g._construct(p,true);
 for(let tier=1;tier<=PLOT_KINDS.wall.tiers.length;tier++){
 for(const p of g.plots.filter(p=>p.kind==='wall')){const nt=g.nextTier(p);if(nt?.branch)p.branch=Object.keys(nt.options)[0];g._construct(p,true);}
 for(const plan of plans){
 const N=m.size,seat=g._reseat(plan.cx+.5,plan.cz+.5,5);assert.ok(seat);const start=Math.floor(seat[1])*N+Math.floor(seat[0]);
 // Close gates for the enclosure proof; no terrain/wall may be bypassed.
 const enclosed=flood(g,start,(x,z,k)=>m.isWalkable(x,z)&&!g.occ[k]);
 assert.ok([...enclosed].every(k=>Math.hypot(k%N-plan.cx,(k/N|0)-plan.cz)<plan.radius+4),`site ${site} ${plan.kind} ${plan.cx},${plan.cz} tier ${tier}: boundary leak`);
 const open=flood(g,start,(x,z,k)=>m.isWalkable(x,z)&&(!g.occ[k]||g.gateIds.has(g.occ[k])));
 assert.ok([...open].some(k=>Math.hypot(k%N-plan.cx,(k/N|0)-plan.cz)>plan.radius+5),`site ${site} ${plan.kind} ${plan.cx},${plan.cz} start ${start%N},${start/N|0} tier ${tier}: no usable exit`);
 for(const t of plan.tiles.filter(t=>t.kind==='gate'))assert.ok(open.has(t.z*N+t.x),`site ${site} tier ${tier}: inaccessible gate ${t.x},${t.z}`);
 }
 }
 for(const gate of g.plots.filter(p=>p.role==='outer'&&p.gate)) {
   const defenders=g.plots.filter(p=>p.outerDefense===gate.id);
   assert.ok(defenders.length,`site ${site}: outer gate ${gate.id} lacks a defender`);
   assert.ok(defenders.some(p=>Math.hypot(p.cx-gate.cx,p.cz-gate.cz)<PLOT_KINDS.tower.tiers[0].range),'outer tower cannot cover gate');
 }
 for(const p of g.plots.filter(p=>p.outerDefense)){
 const gate=g.plots.find(w=>w.id===p.outerDefense),[cx,cz]=p.keep,gx=gate.gate[0]+.5,gz=gate.gate[1]+.5;
 const L=Math.hypot(cx-gx,cz-gz),ix=(cx-gx)/L,iz=(cz-gz)/L;
 assert.ok(Math.abs(-(p.cx-gx)*iz+(p.cz-gz)*ix)>=2,'outer tower crowds central approach');
 }
 // Satellite forts remain their compact, open footprint; no invented rings.
 for(const p of g.plots.filter(p=>p.kind==='outpost')) {
   g.nodes[p.nodeId].owner='player';
   for(let tier=1;tier<=PLOT_KINDS.outpost.tiers.length;tier++) {
     g._construct(p,true);
     const building=g.buildings.find(b=>b.plotId===p.id&&b.alive);
     assert.equal(p.tier,tier);assert.ok(building);
     for(let z=p.z;z<p.z+2;z++)for(let x=p.x;x<p.x+2;x++)assert.equal(g.occ[z*m.size+x],building.id,'satellite footprint changes across tiers');
     assert.equal(building.size,2,'satellite must remain an open compact position');
   }
 }
 }
});

test('standing in a legal gate does not let a hero walk through its solid jamb',()=>{
 const l=LEVELS[0],m=new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),g=new Game(m,'normal','scott',null,l.id);g.foundCity(0,0);
 for(const p of g.plots.filter(p=>p.kind==='wall'))g._construct(p,true);
 const N=m.size;let pair;
 for(let k=0;k<g.occ.length&&!pair;k++)if(g.gateIds.has(g.occ[k]))for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
 const x=k%N,z=k/N|0,id=g.occ[(z+dz)*N+x+dx];if(id&&!g.gateIds.has(id)&&m.isWalkable(x+dx,z+dz)){pair={x,z,dx,dz};break;}}
 assert.ok(pair,'fixture needs a gate with a solid adjacent jamb');
 const h=g.heroes[0],{x,z,dx,dz}=pair;h.x=x+.5+dx*.49;h.z=z+.5+dz*.49;
 const before=[h.x,h.z];g._moveActor(h,dx,dz,3,1/30);assert.deepEqual([h.x,h.z],before,'gate must not activate trapped-actor collision bypass');
});

test('hero and squad cannot squeeze diagonally through a closed wall corner',()=>{
 const l=LEVELS[0],m=new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),g=new Game(m,'normal','scott',null,l.id);g.foundCity(0,0);
 for(const p of g.plots.filter(p=>p.kind==='wall'))g._construct(p,true);
 const N=m.size,solid=(x,z)=>!m.isWalkable(x,z)||(g.occ[z*N+x]&&!g.gateIds.has(g.occ[z*N+x]));let corner;
 for(let z=1;z<N-1&&!corner;z++)for(let x=1;x<N-1&&!corner;x++)for(const dx of [-1,1])for(const dz of [-1,1]){
 if(m.isWalkable(x,z)&&!g.occ[z*N+x]&&m.isWalkable(x+dx,z+dz)&&!g.occ[(z+dz)*N+x+dx]&&solid(x+dx,z)&&solid(x,z+dz)&&(g.occ[z*N+x+dx]||g.occ[(z+dz)*N+x]))corner={x,z,dx,dz};}
 assert.ok(corner,'fixture must contain a closed diagonal wall corner');
 const {x,z,dx,dz}=corner;
 for(const actor of [g.heroes[0],g._spawnUnit('soldier',x+.5,z+.5)]){
  actor.x=x+.5+dx*.49;actor.z=z+.5+dz*.49;
  g._moveActor(actor,dx/Math.SQRT2,dz/Math.SQRT2,3,1/30);
  assert.deepEqual([Math.floor(actor.x),Math.floor(actor.z)],[x,z],`${actor.hero?'hero':'squad'} must not cross the solid corner`);
 }
});
