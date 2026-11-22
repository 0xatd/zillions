import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TILE} from '../src/config.js';
import {LINA_KIT,SNIPER_KIT,AXE_KIT} from '../src/hero-kits.js';
import {spellState,updateSpells,spellMoveSpeed,spellAttackSpeed,spellAttack} from '../src/hero-spells.js';
import {stateHash} from '../src/lockstep-hash.js';
const map=()=>{const size=48;return {size,seed:81818,sites:[],nestSpots:[],nodeSpots:[],tiles:new Uint8Array(size*size).fill(TILE.GRASS),idx:(x,z)=>z*size+x,inBounds:(x,z)=>x>=0&&z>=0&&x<size&&z<size,isBuildable:(x,z)=>x>=0&&z>=0&&x<size&&z<size,isWalkable:(x,z)=>x>=0&&z>=0&&x<size&&z<size};};
function fresh(){const g=new Game(map(),'normal','scott',null,1);g.zombies=[];g.nests=[];g.heroes[0].def=LINA_KIT;const h=g.heroes[0];h.x=h.z=20;spellState(h);return g;}
function enemy(g,x,z){const e=g._spawnZombie('walker',x,z,true,false);e.hp=e.maxHp=5000;return e;}
test('Dragon Slave travels along the chosen line and hits each enemy only once',()=>{
 const g=fresh(),h=g.heroes[0],near=enemy(g,23,20),far=enemy(g,29,20),off=enemy(g,23,25);
 g.exec({t:'cast',slot:0,x:33,z:20});assert.equal(near.hp,5000);assert.equal(h.spells.mana,560);
 updateSpells(g,h,.15);assert.ok(near.hp<5000);assert.equal(far.hp,5000);const hp=near.hp;
 updateSpells(g,h,.5);assert.equal(near.hp,hp);assert.ok(far.hp<5000);assert.equal(off.hp,5000);
 assert.equal(h.spells.soul,2);assert.ok(spellAttackSpeed(h)>1);assert.ok(spellMoveSpeed(h)>1);
});
test('Light Strike locks its ground point and waits; moving out avoids it',()=>{
 const g=fresh(),h=g.heroes[0],stay=enemy(g,24,20),leave=enemy(g,24,21);
 g.exec({t:'cast',slot:1,x:24,z:20});updateSpells(g,h,.4);assert.equal(stay.hp,5000);
 leave.z+=5;updateSpells(g,h,.2);assert.ok(stay.hp<5000);assert.ok(stay.stunT>0);assert.equal(leave.hp,5000);
 const hp=stay.hp;updateSpells(g,h,1);assert.equal(stay.hp,hp,'blast must resolve once');
});
test('Laguna Blade hits only its selected enemy; illegal targeting spends nothing',()=>{
 const g=fresh(),h=g.heroes[0],a=enemy(g,24,20),b=enemy(g,25,20),far=enemy(g,42,20);
 const mana=h.spells.mana;
 for(const id of [far.id,99999])g.exec({t:'cast',slot:2,id});
 assert.equal(h.spells.mana,mana);assert.equal(h.abilityCds[2],0);
 g.exec({t:'cast',slot:2,id:b.id});updateSpells(g,h,.3);
 assert.equal(a.hp,5000);assert.ok(b.hp<5000);assert.equal(h.spells.mana,mana-150+1.5);
});
test('mana, cooldown, pending trajectory and hit history restore without duplicate damage',()=>{
 const g=fresh(),h=g.heroes[0];enemy(g,23,20);enemy(g,29,20);
 g.exec({t:'cast',slot:0,x:33,z:20});updateSpells(g,h,.15);
 const restored=new Game(map(),'normal','scott',g.snapshot(),1);restored.heroes[0].def=LINA_KIT;
 assert.equal(stateHash(g),stateHash(restored));
 updateSpells(g,h,.5);updateSpells(restored,restored.heroes[0],.5);
 assert.deepEqual(g.zombies.map(z=>z.hp),restored.zombies.map(z=>z.hp));assert.equal(stateHash(g),stateHash(restored));
 restored.heroes[0].spells.mana--;assert.notEqual(stateHash(g),stateHash(restored));
});
test('empty casts, invalid points and insufficient mana cannot generate buffs or effects',()=>{
 const g=fresh(),h=g.heroes[0];h.spells.mana=0;
 g.exec({t:'cast',slot:0,x:23,z:20});assert.equal(h.spells.effects.length,0);assert.equal(h.abilCd,0);
 h.spells.mana=650;
 for(const x of [NaN,Infinity,-1,40])g.exec({t:'cast',slot:0,x,z:20});
 assert.equal(h.spells.mana,650);assert.equal(h.spells.effects.length,0);assert.equal(h.spells.soul,0);
 g.exec({t:'cast',slot:0,x:25,z:20});updateSpells(g,h,2);assert.equal(h.spells.soul,0);
});

test('Shrapnel charges limit casts, regenerate sequentially and preserve delayed zones',()=>{
 const g=fresh(),h=g.heroes[0];h.def=SNIPER_KIT;h.spells=null;spellState(h);const e=enemy(g,24,20);
 for(let i=0;i<3;i++){h.abilCd=0;g.exec({t:'cast',slot:0,x:24,z:20});}
 assert.equal(h.spells.charges[0].count,0);const mana=h.spells.mana;h.abilCd=0;
 g.exec({t:'cast',slot:0,x:24,z:20});assert.equal(h.spells.mana,mana);
 updateSpells(g,h,1);assert.equal(e.hp,5000);updateSpells(g,h,.5);assert.ok(e.hp<5000 && e.hp>4980,'overlapping Shrapnel from one caster must not triple damage');assert.equal(e.slowMul,.75);
 const restored=new Game(map(),'normal','scott',g.snapshot(),1);restored.heroes[0].def=SNIPER_KIT;
 assert.equal(stateHash(restored),stateHash(g));
 updateSpells(g,h,34);assert.equal(h.spells.charges[0].count,1);assert.ok(h.spells.charges[0].t>34);
});
test('Take Aim trades movement for range and guaranteed headshots then expires',()=>{
 const g=fresh(),h=g.heroes[0];h.def=SNIPER_KIT;h.spells=null;spellState(h);const e=enemy(g,24,20);
 const range=g.heroRange(h);g.exec({t:'cast',slot:1});assert.equal(g.heroRange(h),range+1);assert.equal(spellMoveSpeed(h),.35);
 assert.ok(spellAttack(g,h,e,30)>50);assert.ok(e.stunT>0);assert.ok(e.x>24);
 updateSpells(g,h,3.1);assert.equal(g.heroRange(h),range);assert.equal(spellMoveSpeed(h),1);
});
test('Assassinate aim is interrupted by movement and death, never silently retargets',()=>{
 for(const interrupt of ['move','death','target-death','none']){
  const g=fresh(),h=g.heroes[0];h.def=SNIPER_KIT;h.spells=null;spellState(h);const e=enemy(g,24,20),other=enemy(g,25,20);
  g.exec({t:'cast',slot:2,id:e.id});updateSpells(g,h,1);assert.equal(e.hp,5000);
  if(interrupt==='move')h.mx=1;if(interrupt==='death')h.dead=true;if(interrupt==='target-death')e.dead=true;
  updateSpells(g,h,1.1);assert.equal(other.hp,5000);
  assert.equal(e.hp<5000,interrupt==='none');
 }
});

test('Berserkers Call captures nearby targets, adds armor and expires without permanent control',()=>{
 const g=fresh(),h=g.heroes[0];h.def=AXE_KIT;h.spells=null;spellState(h);
 const e=enemy(g,22,20),far=enemy(g,30,20);g.exec({t:'cast',slot:0});
 assert.equal(e.targetU,h);assert.notEqual(far.targetU,h);assert.ok(h.fortifyArmor>0);
 const hp=h.hp;g._damageUnit(h,10,e);assert.ok(h.hp>hp-10);
 g._updateHeroOne(h,3.1);assert.equal(h.fortifyArmor,0);assert.equal(h.spells.effects.length,0);
});
test('Battle Hunger ends when the cursed enemy kills a unit, including ranged sources',()=>{
 const g=fresh(),h=g.heroes[0];h.def=AXE_KIT;h.spells=null;spellState(h);const e=enemy(g,24,20);
 g.exec({t:'cast',slot:1,id:e.id});updateSpells(g,h,1);assert.ok(e.hp<5000);const hp=e.hp;
 const ally=g._spawnUnit('soldier',24,21);g._damageUnit(ally,9999,null,e);
 assert.equal(e.killCount,1);updateSpells(g,h,1);assert.equal(e.hp,hp);assert.equal(h.spells.effects.length,0);
});
test('Counter Helix counts incoming attacks, not environmental damage, and ignores armor',()=>{
 const g=fresh(),h=g.heroes[0];h.def=AXE_KIT;h.spells=null;spellState(h);const e=enemy(g,22,20);e.armor=.9;
 g._damageUnit(h,1);assert.equal(h.spells.helixHits,0);
 for(let i=0;i<6;i++)g._damageUnit(h,1,e);assert.equal(e.hp,5000);
 const restored=new Game(map(),'normal','scott',g.snapshot(),1);restored.heroes[0].def=AXE_KIT;
 g._damageUnit(h,1,e);restored._damageUnit(restored.heroes[0],1,restored.zombies[0]);
 assert.equal(e.hp,4900);assert.equal(stateHash(g),stateHash(restored));
});
test('Culling Blade respects range, spends mana and deals pure damage',()=>{
 const g=fresh(),h=g.heroes[0];h.def=AXE_KIT;h.spells=null;spellState(h);const e=enemy(g,21,20);e.armor=.9;
 g.exec({t:'cast',slot:2,id:e.id});updateSpells(g,h,.4);assert.equal(e.hp,4725);
 assert.ok(h.abilityCds[2]>0);assert.ok(h.spells.mana<420);
});
test('new kit stats remain finite and every available rank point has a real destination',()=>{
 for(const key of ['lina','sniper','axe']){
  const g=new Game(map(),'normal',key,null,1),h=g.heroes[0];h.level=100;g._refreshHeroDerived(h);
  for(const choice of g.heroUpgradeChoices(h)){g.upgradeHero(0,choice.key);g.upgradeHero(0,choice.key);}
  assert.equal(h.skillPoints,0);
  for(const [k,v] of Object.entries(g.heroStats(h)))assert.ok(Number.isFinite(v),`${key}/${k} is not finite`);
 }
});
