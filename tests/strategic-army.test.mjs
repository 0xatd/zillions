import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {levelById,SIM_DT} from '../src/config.js';
import {stateHash} from '../src/lockstep-hash.js';
import {buildShareReplay,replayShare} from '../src/share-replay.js';
import {buildMatchReport} from '../src/match-report.js';
const fresh=(snap=null)=>{const l=levelById(1);return new Game(new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),'normal',['scott'],snap,1,'campaign',{rngSeed:43,worldArmy:[4]});};
test('persistent troops spawn once, restore ownership and count only their own casualties',()=>{
 const g=fresh();g.foundCity(0,0);const army=g.units.filter(u=>u.expeditionOwner===0);assert.equal(army.length,4);
 const restored=fresh(g.snapshot());assert.equal(stateHash(g),stateHash(restored));assert.equal(restored.units.filter(u=>u.expeditionOwner===0).length,4);
 restored._damageUnit(restored.units.find(u=>u.expeditionOwner===0),100000);assert.equal(restored.expeditionLosses[0],1);
 assert.equal(buildMatchReport(restored,{won:true,heroIndex:0}).expeditionLosses,1);
 assert.equal(fresh(restored.snapshot()).expeditionLosses[0],1);
});
test('strategic army is carried into real replay simulation',()=>{
 const g=fresh();g.inputLog=[];g.exec({t:'found',s:0,p:0});for(let i=0;i<45;i++)g.update(SIM_DT);
 const replay=buildShareReplay(g);assert.deepEqual(replay.worldArmy,[4]);assert.equal(replayShare(replay).status,'verified');
});
