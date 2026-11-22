import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TILE,XP_RADIUS} from '../src/config.js';
import {stateHash} from '../src/lockstep-hash.js';
const map=()=>{const size=48;return {size,seed:81818,sites:[],nestSpots:[],nodeSpots:[],tiles:new Uint8Array(size*size).fill(TILE.GRASS),idx:(x,z)=>z*size+x,inBounds:(x,z)=>x>=0&&z>=0&&x<size&&z<size,isBuildable:(x,z)=>x>=0&&z>=0&&x<size&&z<size,isWalkable:(x,z)=>x>=0&&z>=0&&x<size&&z<size};};
function fresh(keys='alexander'){const g=new Game(map(),'normal',keys,null,1);g.zombies=[];g.nests=[];g.units=[...g.heroes];g.heroes.forEach((h,i)=>{h.x=20+i;h.z=20;h.cooldown=10;});return g;}
function enemy(g,type='spitter',x=24,z=20){const e=g._spawnZombie(type,x,z,true,false);e.targetU=g.heroes[0];e.atkT=0;e.retarget=1;return e;}
function ticks(g,n,dt=.1){for(let i=0;i<n;i++)g._updateZombies(dt);}
for(const type of ['spitter','brute'])test(`${type} commits a visible ground strike before damage; moving out avoids it`,()=>{
 const g=fresh(),h=g.heroes[0],e=enemy(g,type,type==='brute'?20.5:24);
 const hp=h.hp;ticks(g,1);assert.equal(h.hp,hp,'damage must not precede tell');assert.ok(e.windup);
 const point=[e.windup.x,e.windup.z];h.x+=4;ticks(g,8);
 assert.equal(h.hp,hp,'committed strike cannot home after the dodge');assert.equal(e.windup,null);
 assert.ok(g.events.some(e=>e.type==='groundstrike'&&e.x===point[0]&&e.z===point[1]));
});
test('standing in the tell takes exactly one hit; stun interrupts and dead casters do not hit',()=>{
 const g=fresh(),h=g.heroes[0],e=enemy(g);const hp=h.hp;ticks(g,1);ticks(g,8);
 assert.ok(h.hp<hp);const hitHp=h.hp;ticks(g,3);assert.equal(h.hp,hitHp,'no repeated damage during cooldown');
 e.atkT=0;ticks(g,1);e.stunT=1;ticks(g,10);assert.equal(h.hp,hitHp,'interrupted attack still landed');
 e.stunT=0;e.atkT=0;ticks(g,1);e.dead=true;ticks(g,10);assert.equal(h.hp,hitHp,'dead caster still struck');
});
test('ground impact does not reach through an intact barrier inside its radius',()=>{
 const g=fresh(),h=g.heroes[0];h.x=20.9;h.z=20.5;const e=enemy(g,'spitter',24,20.5);
 const hp=h.hp;ticks(g,1);h.x=22.1;g.occ[20*g.map.size+21]=999;
 ticks(g,8);assert.equal(h.hp,hp,'nearby wall must shield the pending impact');
});
test('windup and focus survive restore; pending impact enters peer hash',()=>{
 const g=fresh(),h=g.heroes[0],e=enemy(g);g.exec({t:'focus',p:0,id:e.id});ticks(g,1);
 assert.equal(h.focusId,e.id);const restored=new Game(map(),'normal','alexander',g.snapshot(),1);
 assert.equal(restored.heroes[0].focusId,e.id);assert.deepEqual(restored.zombies[0].windup,e.windup);
 assert.equal(stateHash(restored),stateHash(g));restored.zombies[0].windup.x+=1;assert.notEqual(stateHash(restored),stateHash(g));restored.zombies[0].windup.x-=1;
 ticks(g,8);ticks(restored,8);assert.equal(restored.heroes[0].hp,h.hp);assert.equal(restored.zombies[0].windup,null);
});
test('explicit focus prioritizes a farther in-range enemy without moving hero or army',()=>{
 const g=fresh(),h=g.heroes[0],near=enemy(g,'walker',21),far=enemy(g,'caller',23);
 const start=[h.x,h.z,g.stance];g.exec({t:'focus',p:0,id:far.id});g._updateUnits(.01);
 assert.equal(h.target,far);assert.deepEqual([h.x,h.z,g.stance],start);
 const hash=stateHash(g);g.exec({t:'focus',p:0,id:null});assert.notEqual(stateHash(g),hash);g._updateUnits(.01);assert.equal(h.target,near);
 for(const id of ['bad',999999,1.5]){g.exec({t:'focus',p:0,id});assert.equal(h.focusId,null);}
 far.x=45;g.exec({t:'focus',p:0,id:far.id});assert.equal(h.focusId,null,'unscouted/out-of-range focus accepted');
 far.x=23;g.exec({t:'focus',p:0,id:far.id});far.dead=true;g._updateUnits(.01);assert.equal(h.focusId,null);
});
test('nearby heroes share troop-kill XP, distant heroes do not farm it remotely',()=>{
 const g=fresh(['alexander','scott']),near=g.heroes[0],far=g.heroes[1];far.x=near.x+XP_RADIUS+3;
 const e=enemy(g,'walker',near.x+1);const xp=[near.xp,far.xp];g.damageZombie(e,10000,near.x+2,near.z);
 assert.ok(near.xp>xp[0]);assert.equal(far.xp,xp[1]);assert.ok(g.coins.length,'kill should leave collectible gold, regardless of last hitter');
});
