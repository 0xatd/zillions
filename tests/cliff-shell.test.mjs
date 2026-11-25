import test from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/resolve-three.mjs';
import {TILE} from '../src/config.js';
const {tileCorners,cliffSkirt}=await import('../src/terrace-mesh.js');

test('cliff faces meet without daylight cracks around a raised rock block',()=>{
 const N=16,tiles=new Uint8Array(N*N).fill(TILE.GRASS),heights=new Float32Array(N*N);
 for(let z=4;z<12;z++)for(let x=4;x<12;x++){tiles[z*N+x]=TILE.MOUNTAIN;heights[z*N+x]=3;}
 const map={size:N,tiles,ledgeW:new Float32Array(N*N).fill(1),swRoad:new Uint8Array(N*N),
  inBounds:(x,z)=>x>=0&&z>=0&&x<N&&z<N,heightAt:(x,z)=>heights[z*N+x]||0};
 const corners=tileCorners(map,new Float32Array((N+1)**2),N+1);
 const mesh=cliffSkirt(map,corners,0x888888,0x668844),p=mesh.geometry.attributes.position;
 const key=v=>v.map(n=>n.toFixed(4)).join(','),edges=new Map();
 for(let i=0;i<p.count;i+=3){
  const tri=[0,1,2].map(j=>[p.getX(i+j),p.getY(i+j),p.getZ(i+j)]);
  if(new Set(tri.map(key)).size<3)continue;
  for(let j=0;j<3;j++){
   const a=tri[j],b=tri[(j+1)%3],id=[key(a),key(b)].sort().join('|');
   const item=edges.get(id)||{a,b,count:0};item.count++;edges.set(id,item);
  }
 }
 const cracks=[...edges.values()].filter(({a,b,count})=>count===1&&!(Math.abs(a[1]-b[1])<.0001&&(a[1]<.001||a[1]>2.999)));
 assert.equal(cracks.length,0,'only the top and foot may be open; neighboring cliff faces must share edges');
 mesh.geometry.dispose();mesh.material.dispose();
});
