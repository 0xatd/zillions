import test from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/resolve-three.mjs';
const {GameMap}=await import('../src/map.js');
const {groundControl}=await import('../src/environment-art.js');
const {buildCliffCrown}=await import('../src/cliff-art.js');
const {tileCorners}=await import('../src/terrace-mesh.js');
const {LEVELS,TILE}=await import('../src/config.js');

test('cliff tops retain exposed rock from the high side, without changing routes or terrain heights',()=>{
 for(const level of LEVELS.filter(l=>[4,5].includes(l.id))){
  const m=new GameMap(level.seed,level.theme,{size:level.size,nests:level.nests});
  const before=m.tiles.slice(),heights=m.elev.slice(),N=m.size,cw=N+1,corners=new Float32Array(cw*cw);
  for(let z=0;z<=N;z++)for(let x=0;x<=N;x++)corners[z*cw+x]=m.cornerHeight(x,z);
  const control=groundControl(m);let checked=0;
  for(let k=0;k<m.tiles.length;k++)if(m.tiles[k]===TILE.MOUNTAIN&&m.isLedgeRock(k)){
    assert.ok(control.image.data[k*4+2]>128,'cliff crest is disguised as walkable turf');checked++;
  }
  assert.ok(checked>0);control.dispose();
  const root=buildCliffCrown(m,tileCorners(m,corners,cw));
  assert.ok(root.children.length,'no high-side cliff silhouette');
  root.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.getAttribute('position');for(let i=0;i<p.count;i++)assert.ok(Number.isFinite(p.getX(i))&&Number.isFinite(p.getY(i))&&Number.isFinite(p.getZ(i)));o.geometry.dispose();o.material.dispose();});
  assert.deepEqual(m.tiles,before);assert.deepEqual(m.elev,heights);
 }
});
