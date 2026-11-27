import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from '../src/game.js';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/corner-routes.json',import.meta.url)));
for(const [i,f] of fixtures.entries())test(`click route escapes concave corner ${i+1} without crossing blockers`,()=>{
 const n=24,walls=new Set(f.walls),g=Object.create(Game.prototype);
 g.map={size:n,isWalkable:(x,z)=>x>=0&&z>=0&&x<n&&z<n&&!walls.has(`${x},${z}`)};g.occ=new Int32Array(n*n);g.gateIds=new Set();
 const a={hero:true,x:f.start[0],z:f.start[1],buffs:[]};
 assert.ok(g._fieldReach(a,...f.goal,true)>=0);
 for(let t=0;t<800;t++){const dx=f.goal[0]-a.x,dz=f.goal[1]-a.z,d=Math.hypot(dx,dz);if(d<.45)break;g._moveActor(a,dx/d,dz/d,4,1/30,...f.goal);assert.ok(g.map.isWalkable(a.x|0,a.z|0),'no clipping');}
 assert.ok(Math.hypot(a.x-f.goal[0],a.z-f.goal[1])<.45,`stalled at ${a.x},${a.z}`);
});
