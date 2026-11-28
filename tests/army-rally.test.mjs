import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {levelById} from '../src/config.js';
import {stateHash} from '../src/lockstep-hash.js';
import {guestCommand} from '../src/multiplayer-command.js';
function fresh(snap=null){const l=levelById(5);return new Game(new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),'normal','scott',snap,5);}
test('rally is a persistent army order, not a hero movement command',()=>{
 const g=fresh();g.foundCity(0,0);const h=g.heroes[0],before=[h.x,h.z],hash=stateHash(g);
 g.exec({t:'rally',x:h.x,z:h.z,p:0});
 assert.equal(g.stance,'rally');assert.deepEqual([h.x,h.z],before);assert.notEqual(stateHash(g),hash);
 const restored=fresh(g.snapshot());assert.deepEqual(restored.armyRally,g.armyRally);assert.equal(stateHash(restored),stateHash(g));
 const point={...g.armyRally};g.exec({t:'rally',x:Infinity,z:0,p:0});assert.deepEqual(g.armyRally,point);
 g.exec({t:'stance',s:'guard',p:0});assert.equal(g.stance,'guard');
});
test('remote rally follows authenticated seat and rejects invalid positions',()=>{
 assert.deepEqual(guestCommand({t:'rally',x:8,z:9},1,2),{t:'rally',p:1,x:8,z:9});
 for(const x of [-1,NaN,Infinity,513])assert.equal(guestCommand({t:'rally',x,z:0},1,2),null);
 assert.equal(guestCommand({t:'rally',x:8,z:9,p:0},1,2),null);
});
test('troop casualties count once and survive restore without counting hero falls as troop losses',()=>{
 const g=fresh();const u={id:999,x:40,z:40,hp:10,def:{},buffs:[],hero:false};
 g._damageUnit(u,100);g._damageUnit(u,100);
 assert.equal(g.stats.troopsLost,1);
 assert.equal(fresh(g.snapshot()).stats.troopsLost,1);
 g._damageUnit(g.heroes[0],100000);
 assert.equal(g.stats.troopsLost,1);assert.equal(g.stats.heroDeaths,1);
});
