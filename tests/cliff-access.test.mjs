import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainField } from '../src/terrain.js';
import { Game } from '../src/game.js';
import { generatePlots } from '../src/plots.js';
import { LEVELS, TILE, TILE_INFO } from '../src/config.js';
import { rimRadius } from '../src/site-plan.js';

for (const level of LEVELS.filter(l => [4, 5].includes(l.id))) {
  test(`${level.name}: founding preserves the cliff around each ramp`, () => {
    const initial = new TerrainField(level.seed, level.theme, {size:level.size,nests:level.nests});
    for (let siteIndex=0; siteIndex<initial.sites.length; siteIndex++) {
      const map = new TerrainField(level.seed, level.theme, {size:level.size,nests:level.nests});
      const site=map.sites[siteIndex], before=map.tiles.slice();
      generatePlots(map,site,{siteIdx:siteIndex});
      const breaches=[];
      for(let z=1;z<map.size-1;z++) for(let x=1;x<map.size-1;x++) {
        const k=z*map.size+x, dx=x+.5-site.x,dz=z+.5-site.z;
        const radius=rimRadius(site.rim,Math.atan2(dz,dx)-site.rim.facing);
        if(Math.hypot(dx,dz)<radius || Math.hypot(dx,dz)>radius+12) continue;
        if(before[k]===TILE.MOUNTAIN && TILE_INFO[map.tiles[k]].walk && map.ledgeW[k]>.99)
          breaches.push([x,z]);
      }
      assert.deepEqual(breaches,[],`site ${siteIndex} bulldozed its cliff`);
    }
  });
}

for (const level of LEVELS.filter(l => [4, 5].includes(l.id))) {
  test(`${level.name}: ramps are the only way between plateau and valley`, () => {
    const map=new TerrainField(level.seed,level.theme,{size:level.size,nests:level.nests});
    // A sheer height change cannot be an ordinary walkable grid edge.
    for(let z=1;z<map.size-1;z++) for(let x=1;x<map.size-1;x++) {
      const i=z*map.size+x;
      if(!map.isWalkable(x,z)||map.ledgeW[i]<.99) continue;
      for(const [dx,dz] of [[1,0],[0,1],[1,1],[-1,1]]) {
        const j=i+dx+dz*map.size;
        if(map.isWalkable(x+dx,z+dz)&&map.ledgeW[j]>=.99)
          assert.ok(Math.abs(map.ledgeH[i]-map.ledgeH[j])<=.75,`walkable cliff at ${x},${z}`);
      }
    }
    // Block just the intended roads: no other route may leak down the cliff.
    for(let i=0;i<map.tiles.length;i++) if(map.swRoad[i]) map.tiles[i]=TILE.MOUNTAIN;
    for(const site of map.sites) {
      // Player steering allows diagonal steps, so a corner-sized gap counts.
      const seen=new Uint8Array(map.size*map.size), stack=[[Math.round(site.x),Math.round(site.z)]];
      while(stack.length) {
        const [x,z]=stack.pop(),i=z*map.size+x;
        if(seen[i]||!map.isWalkable(x,z)) continue;
        seen[i]=1;
        for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]])
          if(map.inBounds(x+dx,z+dz)) stack.push([x+dx,z+dz]);
      }
      for(let i=0;i<seen.length;i++) if(seen[i])
        assert.ok(Math.hypot(i%map.size-site.x,Math.floor(i/map.size)-site.z)<40,'unmarked exit bypasses ramp');
    }
  });
}

test('campaign terrain keeps every objective reachable and paints the reserved gate streets',()=>{
  for(const level of LEVELS) {
    const map=new TerrainField(level.seed,level.theme,{size:level.size,nests:level.nests});
    const start=map.sites[0],seen=map._floodWalkable(Math.round(start.x),Math.round(start.z));
    for(const p of [...map.sites,...map.nodeSpots,...map.nestSpots.map(([x,z])=>({x,z}))])
      assert.ok(seen[Math.round(p.z)*map.size+Math.round(p.x)],`${level.name}: unreachable objective ${p.x},${p.z}`);
    const plots=generatePlots(map,start),hq=plots.find(p=>p.kind==='hq');
    for(const gate of plots.filter(p=>p.kind==='wall'&&p.role==='rampart'&&p.gate)) {
      assert.ok(hq.plan.streets.some(line=>line.some(([x,z])=>x===gate.gate[0]+.5&&z===gate.gate[1]+.5)),`${level.name}: street does not reach gate`);
    }
  }
});

test('painted switchback centerlines stay walkable after founding at every cliff site',()=>{
  for(const level of LEVELS.filter(l=>[4,5].includes(l.id))) {
    const first=new TerrainField(level.seed,level.theme,{size:level.size,nests:level.nests});
    for(let si=0;si<first.sites.length;si++) {
      const map=new TerrainField(level.seed,level.theme,{size:level.size,nests:level.nests});
      const site=map.sites[si];generatePlots(map,site,{siteIdx:si});
      for(const road of site.switchbacks) for(let q=1;q<road.length;q++) {
        const [a,b]=[road[q-1],road[q]],steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*4);
        for(let k=0;k<=steps;k++) {
          const x=Math.floor(a[0]+(b[0]-a[0])*k/steps),z=Math.floor(a[1]+(b[1]-a[1])*k/steps);
          assert.ok(map.isWalkable(x,z),`${level.name} site ${si}: painted ramp blocked at ${x},${z}`);
        }
      }
    }
  }
});

test('hero can walk each Black Vale ramp both ways with the base built',()=>{
  const level=LEVELS.find(l=>l.id===5);
  for(let si=0;si<3;si++) {
    const map=new TerrainField(level.seed,level.theme,{size:level.size,nests:level.nests});
    const game=new Game(map,'normal','scott',null,level.id,'campaign');
    game.foundCity(0,si);
    for(const plot of game.plots) if(plot.kind==='wall'||plot.kind==='tower') game._construct(plot,true);
    const hero=game.heroes[0];
    for(const road of map.sites[si].switchbacks) for(const points of [road,[...road].reverse()]) {
      hero.x=points[0][0];hero.z=points[0][1];
      for(const [x,z] of points.slice(1)) {
        let steps=0;
        while(Math.hypot(x-hero.x,z-hero.z)>.12&&steps++<400) {
          const distance=Math.hypot(x-hero.x,z-hero.z);
          game._moveActor(hero,(x-hero.x)/distance,(z-hero.z)/distance,3,1/30);
        }
        assert.ok(steps<400,`site ${si}: hero stuck walking ramp toward ${x},${z}`);
      }
    }
  }
});
