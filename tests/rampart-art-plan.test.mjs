import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {LEVELS} from '../src/config.js';
import {gateSupports,rampartPanels} from '../src/rampart-art-plan.js';

test('all 15 colonies seat every gate jamb outside the complete walkable opening',()=>{
 let checked=0;
 for(const level of LEVELS)for(let site=0;site<3;site++){
  const map=new TerrainField(level.seed,level.theme,{size:level.size,nests:level.nests});
  const game=new Game(map,'normal','scott',null,level.id);game.foundCity(site,0);
  const before=JSON.stringify(game.plots),tiles=map.tiles.slice();
  for(const plot of game.plots.filter(p=>p.kind==='wall'&&p.gate)){
   const supports=gateSupports(plot,map);assert.ok(supports,`${level.id}/${site}: unsupported gate`);
   assert.ok(Math.hypot(supports[0][0]-supports[1][0],supports[0][1]-supports[1][1])>=2,'opening too narrow');
   const arches=new Set(plot.arch.map(([x,z])=>z*map.size+x));
   const wall=new Set(plot.tiles.map(([x,z])=>z*map.size+x));
   for(const [x,z] of supports)for(const dx of [-.44,0,.44])for(const dz of [-.44,0,.44]){
    const tx=Math.floor(x+.5+dx),tz=Math.floor(z+.5+dz),k=tz*map.size+tx;
    assert.ok(!arches.has(k),'gate jamb occupies the open passage');
    assert.ok(wall.has(k)||!map.isWalkable(tx,tz),'gate jamb hides a walking lane');
    assert.ok(!map.swRoad?.[k],'gate jamb hides a ramp');
   }
   checked++;
  }
  assert.equal(JSON.stringify(game.plots),before);assert.deepEqual(map.tiles,tiles);
 }
 assert.ok(checked>=90);
});

test('straight armor has one full-width panel; corners meet the same edge midpoints',()=>{
 const N=20,tiles=new Set([5*N+4,5*N+5,5*N+6]);
 const straight=rampartPanels(5,5,N,tiles);
 assert.equal(straight.runs.length,1,'straight armor is split into repeated half panels');
 assert.equal(Math.hypot(...straight.runs[0][0].map((v,i)=>v-straight.runs[0][1][i])),1);
 const turn=rampartPanels(5,5,N,new Set([5*N+5,5*N+6,6*N+5]));
 assert.deepEqual(turn.runs.map(r=>r[1]),[[.5,0],[0,.5]]);
 // Removing a neighbor must expose the end, never bridge a destroyed tile.
 assert.equal(rampartPanels(5,5,N,new Set([5*N+5])).runs.length,0);
});

test('diagonal blocked cells receive a corner join without doubling a cardinal elbow',()=>{
 const N=20;
 const diagonal=rampartPanels(5,5,N,new Set([5*N+5,6*N+6]));
 assert.deepEqual(diagonal.diagonals,[[1,1]],'diagonal wall is an isolated post');
 assert.deepEqual(rampartPanels(5,5,N,new Set([5*N+5,5*N+6,6*N+6])).diagonals,[]);
});
