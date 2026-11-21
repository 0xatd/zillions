import test from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/resolve-three.mjs';
const {Matrix4,Vector3}=await import('three');
import {Game} from '../src/game.js';
const {buildFortressBoundary}=await import('../src/colony-art.js');
import {TerrainField} from '../src/terrain.js';
import {levelById} from '../src/config.js';

test('all fortress masonry leaves walkable ground and ramp tiles clear',()=>{
 const l=levelById(5),m=new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests});
 const g=new Game(m,'normal','scott',null,5);
 g.foundCity(0,0);
 const h=g.plots.find(p=>p.kind==='hq');
 const map=g.map,tiles=map.tiles.slice(),elev=map.elev.slice();
 const root=buildFortressBoundary(map,h.plan,h.cx,h.cz);
 const matrix=new Matrix4(),scale=new Vector3(),pos=new Vector3();let towers=0;
 for(const mesh of root.children){
  for(let i=0;i<mesh.count;i++){
   mesh.getMatrixAt(i,matrix);scale.setFromMatrixScale(matrix);pos.setFromMatrixPosition(matrix);
   // The actual transformed footprint, including rotated curtain corners,
   // must stay inside the simulation's natural barrier.
   for(let u=-.5;u<=.501;u+=.1)for(let v=-.5;v<=.501;v+=.1){
    const point=new Vector3(u,0,v).applyMatrix4(matrix);
    const x=Math.floor(point.x),z=Math.floor(point.z);
    assert.equal(map.isWalkable(x,z),false,`${mesh.name} hides walkable ground`);
    assert.ok(!map.swRoad?.[z*map.size+x],`${mesh.name} hides a ramp`);
   }
   if(scale.y<3)continue;
   towers++;
   for(const dx of [-.68,0,.68])for(const dz of [-.68,0,.68]){
    const x=Math.floor(pos.x+dx),z=Math.floor(pos.z+dz);
    assert.equal(map.isWalkable(x,z),false,'bastion projects into walking ground');
    assert.ok(!map.swRoad?.[z*map.size+x],'bastion hides a graded ramp');
   }
  }
  mesh.geometry.dispose();mesh.material.dispose();
 }
 assert.ok(towers>=3,'fortress is missing its spaced defensive anchors');
 assert.deepEqual(map.tiles,tiles);assert.deepEqual(map.elev,elev);
});
