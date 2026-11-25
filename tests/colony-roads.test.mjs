import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {LEVELS} from '../src/config.js';

for(const level of LEVELS)test(`${level.name}: built colony streets connect the court, gates and district frontages`,()=>{
  for(let si=0;si<3;si++){
    const map=new TerrainField(level.seed,level.theme,{size:level.size,nests:level.nests});
    const game=new Game(map,'normal','scott',null,level.id);game.foundCity(si,0);
    for(const p of game.plots)if(p.role!=='outer')game._construct(p,true);
    const hq=game.plots.find(p=>p.kind==='hq'),roads=hq.plan.roads;
    assert.ok(roads?.tiles.length,'colony has no connected street network');
    const N=map.size,tiles=new Set(roads.tiles.map(([x,z])=>z*N+x));
    for(const k of tiles){
      assert.ok(map.isWalkable(k%N,Math.floor(k/N)),'street crosses impassable ground');
      const id=game.occ[k];assert.ok(!id||game.gateIds.has(id),'street crosses a built footprint');
    }
    const hero=game.heroes[0];
    for(const route of roads.routes.filter(r=>r.primary)){
      if(!route.points.length)continue;
      [hero.x,hero.z]=route.points[0];
      for(const [x,z] of route.points.slice(1)){
        let ticks=0;
        while(Math.hypot(x-hero.x,z-hero.z)>.08&&ticks++<120){
          const d=Math.hypot(x-hero.x,z-hero.z);
          game._moveActor(hero,(x-hero.x)/d,(z-hero.z)/d,3,1/30);
        }
        assert.ok(ticks<120,`site ${si}: hero blocked on street to gate at ${x},${z}`);
      }
    }
    const seen=new Set(),stack=[tiles.values().next().value];
    while(stack.length){const k=stack.pop();if(seen.has(k))continue;seen.add(k);for(const j of [k-1,k+1,k-N,k+N])if(tiles.has(j)&&!seen.has(j))stack.push(j);}
    assert.equal(seen.size,tiles.size,'street has an isolated section');
    for(const p of game.plots){
      if(p.kind==='wall'){
        if(p.role==='rampart'&&p.gate)assert.ok(tiles.has(p.gate[1]*N+p.gate[0]),'gate has no street');
      }else if(p!==hq&&Math.hypot(p.cx-hq.cx,p.cz-hq.cz)<hq.plan.reach){
        let linked=false;
        for(let z=p.z-1;z<=p.z+p.size;z++)for(let x=p.x-1;x<=p.x+p.size;x++)if(tiles.has(z*N+x))linked=true;
        assert.ok(linked,`site ${si} ${p.kind} ${p.id} has no street frontage`);
      }
    }
  }
});
