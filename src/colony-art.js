// Ground-level settlement composition. Geometry follows the proven street
// graph and wall footprints; it never invents a passage or collision object.
import * as THREE from 'three';
import { environmentMaterial } from './environment-art.js';

export function buildColonyStreets(map, roads) {
  const group=new THREE.Group();group.name='colony-streets';
  const make=(tiles,color,lift,inset=.16,kind='stone')=>{
    const pos=[],uv=[];
    const occupied=new Set(tiles.map(([x,z])=>`${x},${z}`));
    for(const [x,z] of tiles){
      const x0=x+(occupied.has(`${x-1},${z}`)?0:inset), x1=x+1-(occupied.has(`${x+1},${z}`)?0:inset);
      const z0=z+(occupied.has(`${x},${z-1}`)?0:inset), z1=z+1-(occupied.has(`${x},${z+1}`)?0:inset);
      const corners=[];
      const cut=.21;
      for(const [px,pz,sx,sz] of [[x0,z0,-1,-1],[x0,z1,-1,1],[x1,z1,1,1],[x1,z0,1,-1]]){
        if(!occupied.has(`${x+sx},${z}`)&&!occupied.has(`${x},${z+sz}`)){
          if(sx===sz)corners.push([px-sx*cut,pz],[px,pz-sz*cut]);
          else corners.push([px,pz-sz*cut],[px-sx*cut,pz]);
        }else corners.push([px,pz]);
      }
      const emit=([px,pz])=>{pos.push(px,map.groundY(px,pz)+lift,pz);uv.push(px,pz);};
      for(let i=0;i<corners.length;i++){emit([x+.5,z+.5]);emit(corners[i]);emit(corners[(i+1)%corners.length]);}
    }
    if(!pos.length)return;
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,environmentMaterial(kind,{color,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4}));mesh.receiveShadow=true;group.add(mesh);
  };
  // A single merged paving mesh avoids per-plot draws and crossing ribbons.
  if(roads.kit){
    // A dark stone kerb makes the route boundary legible against dirt/grass.
    const pavedKeys=new Set(roads.kit.cells.filter(c=>c.piece==='road'||c.piece==='plaza').map(c=>`${c.x},${c.z}`));
    for(const r of roads.routes)if(r.primary)for(const [x,z] of r.points)pavedKeys.add(`${Math.floor(x)},${Math.floor(z)}`);
    const paved=roads.tiles.filter(([x,z])=>pavedKeys.has(`${x},${z}`));
    const lanes=roads.tiles.filter(([x,z])=>!pavedKeys.has(`${x},${z}`));
    make(lanes,0xa7997c,.04,.10,'soil');
    make(paved,0x8a8774,.045,.04);
    make(paved,0xa8a18a,.065,.11);
  }else make(roads.tiles,0x99917c,.045);
  return group;
}

// Reusable cliff-top parapet. It occupies only existing impassable terrain:
// the natural cliff remains the simulation barrier. Gates stay actual openings.
export function buildFortressBoundary(map,plan,cx,cz) {
  const group=new THREE.Group();group.name='fortress-cliff-parapet';
  if(!plan?.kit)return group;
  const segments=[],merlons=[],caps=[];
  const N=map.size,ext=Math.ceil(plan.reach+2);
  for(let z=Math.floor(cz)-ext;z<=cz+ext;z++)for(let x=Math.floor(cx)-ext;x<=cx+ext;x++){
    if(x<1||z<1||x>=N-1||z>=N-1||map.isWalkable(x,z))continue;
    const d=Math.hypot(x+.5-cx,z+.5-cz);
    if(d<9||d>plan.reach+1)continue;
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      if(!map.isWalkable(x+dx,z+dz)||Math.hypot(x+dx+.5-cx,z+dz+.5-cz)>=d)continue;
      // Entire wall stays on the blocked half of this boundary.
      const px=x+.5+dx*.24,pz=z+.5+dz*.24;
      const y=map.groundY(x+dx+.5,z+dz+.5);
      const w=dx?.48:1.04,depth=dz?.48:1.04;
      segments.push([px,y-.45,pz,w,2.1,depth]);
      caps.push([px,y+.65,pz,w+.08,.16,depth+.08]);
      for(const offset of [-.28,.28])merlons.push([px+(dx?0:offset),y+.90,pz+(dz?0:offset),dx?.52:.26,.45,dz?.52:.26]);
    }
  }
  const add=(items,color)=>{
    const mat=environmentMaterial('stone',{color});
    const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),mat,items.length),matrix=new THREE.Matrix4();
    items.forEach(([x,y,z,w,h,d],i)=>{matrix.makeScale(w,h,d);matrix.setPosition(x,y,z);mesh.setMatrixAt(i,matrix);});
    mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  };
  add(segments,0x8a8d83);add(caps,0xb6b19a);add(merlons,0xa4a58e);
  return group;
}
