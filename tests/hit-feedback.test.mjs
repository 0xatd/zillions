import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TILE} from '../src/config.js';
function fixture() {
 const size=48,map={size,seed:777,sites:[],nestSpots:[],nodeSpots:[],tiles:new Uint8Array(size*size).fill(TILE.GRASS),idx:(x,z)=>z*size+x,inBounds:(x,z)=>x>=0&&z>=0&&x<size&&z<size,isBuildable:()=>true,isWalkable:()=>true};
 const g=new Game(map,'normal','scott',null,1);g.zombies=[];g.nests=[];
 const h=g.heroes[0];h.x=h.z=20;
 const z=g._spawnZombie('walker',21,20,true);z.hp=z.maxHp=10000;z.armor=.35;
 h.target=z;h.cooldown=0;return {g,h,z};
}
test('hero hit feedback reports the actual primary HP loss and existing critical roll',()=>{
 for(const chance of [0,1]) {
  const {g,h,z}=fixture();h.weapon={...h.weapon,critChance:chance};h.mods.critChance=0;h.auraCrit=0;
  const before=z.hp;for(let i=0;i<30&&!g.events.some(e=>e.type==='heroimpact');i++){g._updateHero(1/30);g._updateUnits(1/30);}
  const shot=g.events.find(e=>e.type==='heroimpact' && e.fromId===h.id);
  assert.ok(shot,'hero fired at the target');assert.equal(shot.crit,chance===1);
  assert.ok(shot.damage>0);assert.equal(shot.damage,before-z.hp);
 }
});
