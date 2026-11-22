import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {levelById} from '../src/config.js';

const level=levelById(5);
const map=()=>new TerrainField(level.seed,level.theme,{size:level.size,nests:level.nests});
for(const site of [0,1])test(`site ${site}: a legacy colony save cannot silently restore into a different layout`,()=>{
  const game=new Game(map(),'normal','scott',null,5);
  game.foundCity(site,0);
  const camp=game.plots.find(p=>p.kind==='camp_ranger');
  game._construct(camp,true);
  const saved=game.snapshot();
  const original=JSON.stringify(saved);
  for(const v of [5,6,7,10,11]) {
    const legacy={...saved,v};
    assert.throws(()=>new Game(map(),'normal','scott',legacy,5),/older colony layout/);
  }
  assert.equal(JSON.stringify(saved),original,'rejecting an old save must not alter the source');
  const restored=new Game(map(),'normal','scott',saved,5);
  assert.equal(restored.plots.find(p=>p.id===camp.id).kind,'camp_ranger');
  assert.equal(restored.buildings.find(b=>b.plotId===camp.id).kind,'camp_ranger');
});
