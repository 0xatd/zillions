import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {levelById,SIM_DT} from '../src/config.js';
import {TerrainField} from '../src/terrain.js';
test('a melee enemy releases a stale hero chase across a cliff and resumes its siege',()=>{
 const level=levelById(5),map=new TerrainField(level.seed,level.theme,{size:level.size,nests:level.nests});
 const g=new Game(map,'normal','axe',null,5);g.foundCity(0,0);g.zombies=[];
 const h=g.heroes[0];h.x=13.71587459633904;h.z=112.36414282530967;
 const z=g._spawnZombie('walker',17.142713731960708,110.74554174975967,true,true);z.targetU=h;
 const start=[z.x,z.z];let furthest=0;
 for(let i=0;i<360;i++){g.update(SIM_DT);furthest=Math.max(furthest,Math.hypot(z.x-start[0],z.z-start[1]));}
 assert.ok(furthest>3,`enemy lingered at the cliff: furthest movement ${furthest.toFixed(2)}`);
});
