// Ground-level settlement composition. Geometry follows the proven street
// graph and wall footprints; it never invents a passage or collision object.
import * as THREE from 'three';
import { environmentMaterial } from './environment-art.js';

export function buildColonyStreets(map, roads) {
  const group=new THREE.Group();group.name='colony-streets';
  const make=(tiles,color,lift)=>{
    const pos=[],uv=[];
    const occupied=new Set(tiles.map(([x,z])=>`${x},${z}`));
    for(const [x,z] of tiles){
      const x0=x+(occupied.has(`${x-1},${z}`)?0:.16), x1=x+1-(occupied.has(`${x+1},${z}`)?0:.16);
      const z0=z+(occupied.has(`${x},${z-1}`)?0:.16), z1=z+1-(occupied.has(`${x},${z+1}`)?0:.16);
      const corners=[[x0,z0],[x0,z1],[x1,z1],[x1,z0]];
      for(const i of [0,1,2,0,2,3]){const [px,pz]=corners[i];pos.push(px,map.groundY(px,pz)+lift,pz);uv.push(px,pz);}
    }
    if(!pos.length)return;
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,environmentMaterial('stone',{color,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4}));mesh.receiveShadow=true;group.add(mesh);
  };
  // A single merged paving mesh avoids per-plot draws and crossing ribbons.
  make(roads.tiles,0x99917c,.045);
  return group;
}
