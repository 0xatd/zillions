import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TILE} from '../src/config.js';
import {stateHash} from '../src/lockstep-hash.js';
import {guestCommand} from '../src/multiplayer-command.js';
const map=()=>{const size=48;return {size,seed:81818,sites:[],nestSpots:[],nodeSpots:[],tiles:new Uint8Array(size*size).fill(TILE.GRASS),idx:(x,z)=>z*size+x,inBounds:(x,z)=>x>=0&&z>=0&&x<size&&z<size,isBuildable:(x,z)=>x>=0&&z>=0&&x<size&&z<size,isWalkable:(x,z)=>x>=0&&z>=0&&x<size&&z<size};};
function fresh(key='scott') { const g=new Game(map(),'normal',key,null,1);g.zombies=[];g.nests=[];g.units=[...g.heroes];const h=g.heroes[0];h.x=h.z=20;h.cooldown=0;const z=g._spawnZombie('walker',21,20,true,false);z.hp=z.maxHp=10000;return {g,h,z}; }
// Exercise real hero movement and unit combat, without enemy movement obscuring the attack boundary.
function tick(g,n=1) { for(let i=0;i<n;i++){g._updateUnits(1/30);g._updateHero(1/30);} }
function order(g,z,k='attack'){g.exec({t:'horder',p:0,k,x:z.x,z:z.z,...(k==='attack'?{id:z.id}:{})});}
function until(g,fn){for(let i=0;i<120&&!fn();i++)tick(g);assert.ok(fn(),'expected combat transition within four seconds');}

test('wind-up can be cancelled without damage; released shot survives move and lands once',()=>{
 const {g,h,z}=fresh();order(g,z);tick(g);assert.equal(z.hp,10000);assert.ok(h.attack);
 order(g,{x:25,z:20},'move');tick(g,10);assert.equal(z.hp,10000);assert.equal(h.attack,null);assert.ok(h.x>20);
 order(g,z);until(g,()=>h.attackShots.length>0);assert.equal(z.hp,10000,'release is not impact');const cd=h.cooldown;
 order(g,{x:30,z:20},'move');tick(g,15);assert.ok(z.hp<10000);assert.equal(g.events.filter(e=>e.type==='heroimpact').length,1);assert.ok(h.cooldown<cd);
});
test('repeated target orders cannot cancel wind-up or bypass attack cooldown',()=>{
 const {g,h,z}=fresh();let count=0;
 for(let i=0;i<90;i++){order(g,z);tick(g);}
 const releases=g.events.filter(e=>e.type==='herorelease');count=releases.length;
 assert.ok(count>=2);assert.ok(count<=Math.ceil(3*h.weapon.rof)+1,'click spam increases rate');assert.ok(z.hp<10000);
});
test('stop cancels and suppresses attacks; hold attacks in range without pursuing',()=>{
 const {g,h,z}=fresh();order(g,z);tick(g);g.exec({t:'hhalt',p:0,k:'stop'});tick(g,30);assert.equal(z.hp,10000);assert.equal(h.x,20);
 g.exec({t:'hhalt',p:0,k:'hold'});until(g,()=>z.hp<10000);z.x=40;tick(g,60);assert.equal(h.x,20);
 assert.equal(guestCommand({t:'hhalt',k:'hold'},1,2).k,'hold');assert.equal(guestCommand({t:'hhalt',k:'teleport'},1,2),null);
});
test('explicit attack pursues chosen enemy instead of shooting a closer bystander',()=>{
 const {g,h,z}=fresh();const far=g._spawnZombie('walker',30,20,true,false);far.hp=10000;order(g,far);tick(g,12);
 assert.ok(h.x>20);assert.equal(z.hp,10000);until(g,()=>far.hp<10000);assert.equal(z.hp,10000);
});
test('attack-move pauses for a contact and resumes its original destination after death',()=>{
 const {g,h,z}=fresh();g.exec({t:'horder',p:0,k:'attack',x:30,z:20});tick(g,8);assert.equal(h.x,20);z.dead=true;z.hp=0;tick(g,10);assert.ok(h.x>20);assert.equal(h.orderX,30);
});
test('melee damage lands at the end of wind-up, with no projectile',()=>{
 const {g,h,z}=fresh('sven');order(g,z);tick(g);assert.equal(z.hp,10000);assert.ok(h.attack);until(g,()=>z.hp<10000);assert.equal(h.attackShots.length,0);assert.equal(g.events.filter(e=>e.type==='heroimpact').length,1);
});
test('wind-up and in-flight damage survive save/restore with exact peer hashes',()=>{
 for(const stage of ['windup','flight']){
  const {g,h,z}=fresh();order(g,z);tick(g);if(stage==='flight')until(g,()=>h.attackShots.length>0);
  const restored=new Game(map(),'normal','scott',g.snapshot(),1);assert.equal(stateHash(restored),stateHash(g));
  for(let i=0;i<90;i++){tick(g);tick(restored);assert.equal(stateHash(restored),stateHash(g),stage+' tick '+i);}
 }
});
test('moving target leaves melee reach before release: no phantom hit',()=>{
 const {g,h,z}=fresh('sven');g.exec({t:'hhalt',p:0,k:'hold'});tick(g);assert.ok(h.attack);z.x=40;tick(g,20);assert.equal(z.hp,10000);assert.equal(h.attack,null);
});


test('restore during movement preserves the next attack decision in actual update order',()=>{
 const {g,h,z}=fresh();order(g,{x:30,z:20},'move');tick(g,6);assert.ok(h.moving);
 const restored=new Game(map(),'normal','scott',g.snapshot(),1);
 for(const sim of [g,restored])sim.exec({t:'horder',p:0,k:'attack',x:30,z:20});
 for(let i=0;i<60;i++){tick(g);tick(restored);assert.equal(stateHash(restored),stateHash(g));}
});

test('released projectile survives shooter death; cancelled melee never damages',()=>{
 const {g,h,z}=fresh();order(g,z);until(g,()=>h.attackShots.length>0);h.dead=true;tick(g,10);
 assert.ok(z.hp<10000);assert.equal(g.events.filter(e=>e.type==='heroimpact').length,1);
 const f=fresh('sven');order(f.g,f.z);tick(f.g);f.h.dead=true;tick(f.g,20);assert.equal(f.z.hp,10000);
});

test('Sniper Headshot commits its roll at release but staggers only on impact, including restore',()=>{
 const {g,h,z}=fresh('sniper');z.x=30;g.exec({t:'cast',p:0,slot:1});order(g,z);
 until(g,()=>h.attackShots.length>0);
 assert.equal(z.hp,10000);assert.equal(z.stunT||0,0,'Headshot must not stun during projectile flight');assert.equal(z.x,30,'knockback must wait for contact');
 const restored=new Game(map(),'normal','sniper',g.snapshot(),1);
 // Aim can expire in flight; the committed proc must not be rerolled or lost.
 h.spells.aimT=0;restored.heroes[0].spells.aimT=0;
 g.exec({t:'hhalt',p:0,k:'stop'});restored.exec({t:'hhalt',p:0,k:'stop'});
 for(let i=0;i<30&&z.hp===10000;i++){tick(g);tick(restored);assert.equal(stateHash(g),stateHash(restored));}
 assert.ok(z.hp<10000);assert.ok(z.stunT>0);assert.equal(z.x,30.5);
 const hp=z.hp;tick(g,20);assert.equal(z.hp,hp,'one projectile produces one hit');
});
