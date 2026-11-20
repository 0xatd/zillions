import test from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/resolve-three.mjs';
const {GameMap}=await import('../src/map.js');
const {buildForest,buildLandscapeEdges}=await import('../src/landscape-art.js');
const {LEVELS,TILE,TILE_INFO}=await import('../src/config.js');
const {Matrix4,Vector3}=await import('three');

// Render-only scenery must not invent collision: every tall prop remains on
// impassable terrain, reeds remain in water, and generation cannot edit tiles.
for(const level of LEVELS.filter(l=>l.id<=5))test(`${level.name}: landscape leaves routes and terrain state intact`,()=>{
  const map=new GameMap(level.seed,level.theme,{size:level.size,nests:level.nests});
  const tiles=map.tiles.slice(),elev=map.elev.slice();
  const roots=[buildForest(map),buildLandscapeEdges(map)];
  let count=0;
  const matrix=new Matrix4(),position=new Vector3();
  for(const root of roots)root.traverse(mesh=>{
    if(!mesh.isInstancedMesh)return;
    for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);
      assert.ok(matrix.elements.every(Number.isFinite),'non-finite scenery transform');
      const tile=tiles[map.idx(Math.floor(position.x),Math.floor(position.z))];
      assert.ok(!TILE_INFO[tile].walk,`${mesh.name} occupies a walkable tile`);
      if(mesh.name==='shore-reeds'){assert.equal(tile,TILE.WATER);assert.equal(map.isLava(),false);}
      count++;
    }
    mesh.geometry.dispose();mesh.material.dispose();
  });
  assert.ok(count>0,'empty environment');
  assert.deepEqual(map.tiles,tiles);assert.deepEqual(map.elev,elev);
});
