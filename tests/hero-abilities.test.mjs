import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {HEROES,TILE} from '../src/config.js';
import {stateHash} from '../src/lockstep-hash.js';
import {guestCommand} from '../src/multiplayer-command.js';
import {heroAbility,abilityCooldown} from '../src/hero-abilities.js';
const map=()=>{const size=48;return {size,seed:81818,sites:[],nestSpots:[],nodeSpots:[],tiles:new Uint8Array(size*size).fill(TILE.GRASS),idx:(x,z)=>z*size+x,inBounds:(x,z)=>x>=0&&z>=0&&x<size&&z<size,isBuildable:(x,z)=>x>=0&&z>=0&&x<size&&z<size,isWalkable:(x,z)=>x>=0&&z>=0&&x<size&&z<size};};
function fresh(){const g=new Game(map(),'normal','scott',null,1);g.zombies=[];g.nests=[];const h=g.heroes[0];h.x=h.z=20;return g;}
function installFixture(g){g.heroes[0].def={...g.heroes[0].def,abilities:[HEROES.scott.ability,{...HEROES.scott.ability,key:'fixture',cd:5},null,{name:'Passive',passive:true}]};}
test('slot commands preserve seat ownership and reject malformed indexes',()=>{
 for(const slot of [0,1,2,3,4,5])assert.deepEqual(guestCommand({t:'cast',slot},1,2),{t:'cast',p:1,slot});
 for(const slot of [-1,6,Infinity,NaN,1.5,'1',null])assert.equal(guestCommand({t:'cast',slot},1,2),null);
 assert.equal(guestCommand({t:'cast',slot:1,p:0},1,2),null);
});
test('casting a second ability neither spends nor bypasses the first cooldown',()=>{
 const g=fresh();installFixture(g);const h=g.heroes[0];
 g.exec({t:'cast',slot:0});const first=h.abilCd;assert.ok(first>0);
 g.exec({t:'cast',slot:1});assert.equal(h.abilCd,first);assert.equal(abilityCooldown(h,1),5);
 const events=g.events.filter(e=>e.type==='cast').length;
 g.exec({t:'cast',slot:1});assert.equal(g.events.filter(e=>e.type==='cast').length,events);
 g._updateHeroOne(h,1);assert.equal(abilityCooldown(h,0),first-1);assert.equal(abilityCooldown(h,1),4);
});
test('empty, passive, and malformed slots cannot consume resources or cast',()=>{
 const g=fresh();installFixture(g);const before=g.snapshot();
 for(const slot of [2,3,6,-1,'0',NaN])g.castAbility(0,slot);
 assert.deepEqual(g.snapshot(),before);assert.equal(heroAbility(HEROES.scott,1),null);
});
test('all slot cooldowns survive restore and participate in peer agreement',()=>{
 const g=fresh();installFixture(g);g.castAbility(0,0);g.castAbility(0,1);
 const restored=new Game(map(),'normal','scott',g.snapshot(),1);installFixture(restored);
 assert.equal(stateHash(restored),stateHash(g));
 restored.heroes[0].abilityCds[1]+=.1;assert.notEqual(stateHash(restored),stateHash(g));
 restored.heroes[0].abilityCds[1]-=.1;
 g._updateHeroOne(g.heroes[0],.25);restored._updateHeroOne(restored.heroes[0],.25);
 assert.equal(stateHash(restored),stateHash(g));
});
test('legacy saves retain the original active cooldown and leave other slots empty',()=>{
 const g=fresh();g.castAbility();const snap=g.snapshot();delete snap.heroes[0].abilityCds;
 const restored=new Game(map(),'normal','scott',snap,1);
 assert.equal(restored.heroes[0].abilCd,g.heroes[0].abilCd);
 assert.equal(abilityCooldown(restored.heroes[0],1),0);
});
