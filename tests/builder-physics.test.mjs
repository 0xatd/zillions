import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {levelById} from '../src/config.js';
import {updateBuilders} from '../src/builders.js';
function fresh(){const l=levelById(5),g=new Game(new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),'normal','scott',null,5);g.foundCity(0,0);g.gold=400;g.zombies=[];return g;}
function open(g,b){const id=g.occ[(b.z|0)*g.map.size+(b.x|0)];return g.map.isWalkable(b.x|0,b.z|0)&&(!id||g.gateIds.has(id));}
test('manual construction ejects even a paused crew from a fresh foundation',()=>{
 const g=fresh(),b=g.builders,p=g.plots.find(p=>p.kind==='farm'&&p.tier===0);
 b.x=p.cx;b.z=p.cz;b.route=[[p.cx+4,p.cz]];
 g._construct(p,true);
 assert.ok(open(g,b),'crew is not left inside a solid building');assert.deepEqual(b.route,[],'ejection invalidates route from old position');
});

test('blocked retreat respects its replan cooldown rather than searching every tick',()=>{
 const g=fresh(),b=g.builders;b.replan=0;
 g.zombies=[{x:b.x+6,z:b.z,hp:10,dead:false}];
 let checks=0;const cx=b.x|0,cz=b.z|0;
 g.map.isWalkable=(x,z)=>{checks++;return x===cx&&z===cz;};
 updateBuilders(g,1/60);assert.equal(b.status,'Retreating');assert.equal(b.route.length,0);assert.ok(checks>0);
 const first=checks,position=[b.x,b.z],gold=g.gold;
 for(let i=0;i<60;i++)updateBuilders(g,1/60);
 assert.equal(checks,first,'no repeated route search during cooldown');assert.deepEqual([b.x,b.z],position);assert.equal(g.gold,gold);
 for(let i=0;i<65;i++)updateBuilders(g,1/60);
 assert.ok(checks>first,'blocked retreat retries after cooldown');
});
