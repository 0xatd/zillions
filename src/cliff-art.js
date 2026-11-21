// Shared cliff crown: exposed stone remains readable even when the outward
// vertical face points away from the gameplay camera. Uses the SAME clipped
// tile geometry as terrain; no new collision, ramp or raised walkable tile.
import * as THREE from 'three';
import { TILE } from './config.js';
import { tileTris } from './terrace-mesh.js';
import { environmentMaterial } from './environment-art.js';

export function buildCliffCrown(map,tileCH) {
  const group=new THREE.Group();group.name='cliff-crown-kit';
  if(!tileCH||!map.ledgeW)return group;
  const positions=[],edges=new Map(),N=map.size;
  const raised=([x,z,y])=>[x,y+.56+.22*Math.sin(x*.43+z*.27)+.14*Math.sin(z*.71-x*.19),z];
  const key=v=>v.map(n=>n.toFixed(4)).join(',');
  const emit=(a,b,c)=>positions.push(...a,...b,...c);
  for(let z=1;z<N-1;z++)for(let x=1;x<N-1;x++){
    const k=z*N+x;if(map.tiles[k]!==TILE.MOUNTAIN||map.ledgeW[k]<.999)continue;
    // Leave graded ramp edges open and quiet. A crown must never read as an
    // obstruction across the only climb onto a plateau.
    let ramp=false;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)if(map.swRoad?.[(z+dz)*N+x+dx])ramp=true;
    if(ramp)continue;
    for(const tri of tileTris(map,tileCH,x,z)){
      const h=map.heightAt(x,z);
      if(tri.some(v=>v[2]<h-.5))continue; // the lowered half of a clipped rock is not its crest
      const top=tri.map(raised),center=[0,0,0];
      for(const v of top)for(let a=0;a<3;a++)center[a]+=v[a]/3;

      for(let i=0;i<3;i++){
        emit(top[i],top[(i+1)%3],center);
        const a=tri[i],b=tri[(i+1)%3],ak=key(a),bk=key(b),edge=ak<bk?`${ak}|${bk}`:`${bk}|${ak}`;
        if(edges.has(edge))edges.delete(edge);else edges.set(edge,[a,b]);
      }
    }
  }
  for(const [a,b] of edges.values()){
    const A=[a[0],a[2]-.04,a[1]],B=[b[0],b[2]-.04,b[1]],at=raised(a),bt=raised(b);
    emit(A,B,bt);emit(A,bt,at);
  }
  if(!positions.length)return group;
  // Weld shared vertices before computing normals: the crest is a broad rock
  // mass, not a repeating quilt of independently shaded tile triangles.
  const unique=[],indices=[],vertices=new Map();
  for(let i=0;i<positions.length;i+=3){
    const p=positions.slice(i,i+3),id=p.map(n=>n.toFixed(4)).join(',');
    if(!vertices.has(id)){vertices.set(id,unique.length/3);unique.push(...p);}indices.push(vertices.get(id));
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(unique,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const material=environmentMaterial('rock',{color:new THREE.Color(map.colorOf(TILE.MOUNTAIN)).lerp(new THREE.Color(0x929481),.65),side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='exposed-cliff-crown';mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  return group;
}
