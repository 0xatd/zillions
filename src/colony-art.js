// Ground-level settlement composition. Geometry follows the proven street
// graph and wall footprints; it never invents a passage or collision object.
import { biomeKit, cultureKit } from './world-art-kit.js';
import * as THREE from 'three';
import { environmentMaterial } from './environment-art.js';

export function buildColonyStreets(map, roads, culture = 'european') {
  const group=new THREE.Group();group.name='colony-streets';
  const palette=cultureKit(culture).roads,environment=biomeKit(map);
  const make=(tiles,color,lift,inset=.16,kind='armor')=>{
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
  if(roads.routes){
    // A dark stone kerb makes the route boundary legible against dirt/grass.
    const pavedKeys=new Set((roads.kit?.cells||[]).filter(c=>c.piece==='road'||c.piece==='plaza').map(c=>`${c.x},${c.z}`));
    for(const r of roads.routes)if(r.primary)for(const [x,z] of r.points)pavedKeys.add(`${Math.floor(x)},${Math.floor(z)}`);
    const paved=roads.tiles.filter(([x,z])=>pavedKeys.has(`${x},${z}`));
    const lanes=roads.tiles.filter(([x,z])=>!pavedKeys.has(`${x},${z}`));
    make(lanes,environment.roads.dust,.04,.10,'soil');
    make(paved,palette.edge,.045,.04);
    make(paved,palette.surface,.065,.11);
  }else make(roads.tiles,0x99917c,.045);
  return group;
}

// Connected armored revetments on the existing blocked rim. Clearance-checked
// runs simplify tile staircases without moving the simulated boundary.
// No visual part may enter a walkable/ramp tile.
export function buildFortressBoundary(map,plan,cx,cz) {
  const group=new THREE.Group();group.name='fortress-cliff-parapet';
  if(!plan?.kit)return group;
  const N=map.size,ext=Math.ceil(plan.reach+2),nodes=new Map();
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  const stone=[],footings=[],coping=[],merlons=[],recesses=[],banners=[],towerBodies=[];
  const safe=(x,z,w,d,ry=0)=>{
    // Sample the complete footprint, including interior tiles of long spans.
    const c=Math.cos(ry),s=Math.sin(ry);
    for(let u=-w/2;u<=w/2+.001;u+=w/Math.max(2,Math.ceil(w/.2)))
      for(let v=-d/2;v<=d/2+.001;v+=d/Math.max(2,Math.ceil(d/.2))){
        const tx=Math.floor(x+c*u+s*v),tz=Math.floor(z-s*u+c*v);
        if(tx<0||tz<0||tx>=N||tz>=N||map.isWalkable(tx,tz)||map.swRoad?.[tz*N+tx])return false;
      }
    return true;
  };
  const box=(items,x,y,z,w,h,d,ry=0)=>{if(safe(x,z,w,d,ry))items.push([x,y,z,w,h,d,ry]);};
  for(let z=Math.floor(cz)-ext;z<=cz+ext;z++)for(let x=Math.floor(cx)-ext;x<=cx+ext;x++){
    if(x<1||z<1||x>=N-1||z>=N-1||map.isWalkable(x,z))continue;
    const distance=Math.hypot(x+.5-cx,z+.5-cz);
    if(distance<9||distance>plan.reach+1)continue;
    const inside=dirs.filter(([dx,dz])=>map.isWalkable(x+dx,z+dz)&&Math.hypot(x+dx+.5-cx,z+dz+.5-cz)<distance);
    if(!inside.length||map.swRoad?.[z*N+x])continue;
    const y=Math.max(...inside.map(([dx,dz])=>map.groundY(x+dx+.5,z+dz+.5)));
    nodes.set(z*N+x,{x,z,y,px:x+.5,pz:z+.5});
  }
  // A rasterized diagonal can expose only corner-touching rim cells.
  // Join through the blocked elbow, never bridge diagonally across the
  // walkable corner. Keep the same wall height through that short return.
  for(const a of [...nodes.values()])for(const [dx,dz] of [[1,1],[1,-1],[2,0],[0,2]]){
    const b=nodes.get((a.z+dz)*N+a.x+dx);
    if(!b||Math.abs(a.y-b.y)>.65)continue;
    const candidates=Math.abs(dx)+Math.abs(dz)===2&&dx&&dz?[[a.x+dx,a.z],[a.x,a.z+dz]]:[[a.x+dx/2,a.z+dz/2]];
    if(candidates.some(([x,z])=>nodes.has(z*N+x)))continue;
    for(const [x,z] of candidates){
      if(map.isWalkable(x,z)||map.swRoad?.[z*N+x])continue;
      nodes.set(z*N+x,{x,z,y:(a.y+b.y)/2,px:x+.5,pz:z+.5});break;
    }
  }
  for(const n of nodes.values()){
    n.neighbors=dirs.map(([dx,dz])=>nodes.get((n.z+dz)*N+n.x+dx)).filter(b=>b&&Math.abs(n.y-b.y)<.65);
    for(const b of n.neighbors){n.px+=(b.x-n.x)*.12;n.pz+=(b.z-n.z)*.12;}
  }
  const span=(a,b,y)=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),ry=-Math.atan2(dz,dx),x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
    box(footings,x,y+.12,z,len+.04,.55,.58,ry);
    box(stone,x,y+1.10,z,len+.04,1.65,.48,ry);
    box(coping,x,y+1.91,z,len+.04,.18,.56,ry);
    box(coping,x,y+.46,z,len+.04,.12,.53,ry);
  };
  // Follow complete rim chains before drawing. Long chords are allowed only
  // within the blocked strip, never over a walking corner or a ramp mouth.
  const visited=new Set(),edge=(a,b)=>[a.z*N+a.x,b.z*N+b.x].sort((a,b)=>a-b).join(':');
  const chains=[];
  const walk=(a,b)=>{
    const chain=[a];
    while(b&&!visited.has(edge(a,b))){
      visited.add(edge(a,b));chain.push(b);
      const next=b.neighbors.length===2?b.neighbors.find(n=>n!==a):null;
      a=b;b=next;
    }
    chains.push(chain);
  };
  for(const n of nodes.values())if(n.neighbors.length!==2)for(const b of n.neighbors)walk(n,b);
  for(const n of nodes.values())for(const b of n.neighbors)if(!visited.has(edge(n,b)))walk(n,b);
  const clear=(a,b)=>{
    const dx=b.px-a.px,dz=b.pz-a.pz;
    return safe((a.px+b.px)/2,(a.pz+b.pz)/2,Math.hypot(dx,dz)+.04,.62,-Math.atan2(dz,dx));
  };
  const joints=new Set();
  for(const chain of chains){
    const runs=simplifyRimChain(chain,clear);
    for(const [a,b] of runs){
      span([a.px,a.pz],[b.px,b.pz],(a.y+b.y)/2);
      for(const n of [a,b]){
        const key=n.z*N+n.x;
        if(joints.has(key))continue;
        joints.add(key);
        // Compact structural joints only at run endpoints, not every tile.
        box(footings,n.px,n.y+.98,n.pz,.55,1.88,.55);
        box(coping,n.px,n.y+1.96,n.pz,.59,.14,.59);
      }
    }
  }
  const towers=[];
  for(const n of nodes.values()){
    const vx=n.x+.5-cx,vz=n.z+.5-cz,l=Math.hypot(vx,vz)||1;
    const x=n.x+.5+vx/l*.72,z=n.z+.5+vz/l*.72;
    if(towers.some(t=>Math.hypot(t.x-x,t.z-z)<8)||!safe(x,z,1.48,1.48))continue;
    towers.push({x,z,y:n.y});
    // Armored plinth, structural shaft and recessed observation band.
    // These are architectural anchors, not new weapons.
    box(footings,x,n.y+.05,z,1.48,.60,1.48);
    box(towerBodies,x,n.y+1.65,z,1.25,3.5,1.25);
    box(coping,x,n.y+2.92,z,1.36,.20,1.36);
    box(coping,x,n.y+3.21,z,1.48,.24,1.48);
    box(merlons,x,n.y+3.52,z,1.20,.42,1.20);
    box(coping,x,n.y+3.77,z,1.30,.12,1.30);
    for(const [dx,dz] of dirs){
      const ry=dx?Math.PI/2:0;
      box(recesses,x+dx*.631,n.y+2.1,z+dz*.631,.52,.28,.022,ry);
      box(coping,x+dx*.65,n.y+1.91,z+dz*.65,.60,.10,.07,ry);
      box(banners,x+dx*.638,n.y+.83,z+dz*.638,.36,.16,.025,ry);
    }
    // Seat the tower into its nearest curtain without crossing the rim.
    span([n.px,n.pz],[x,z],n.y);
  }
  const add=(items,color,name)=>{
    if(!items.length)return;
    const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),environmentMaterial('armor',{color}),items.length);
    mesh.name=name;
    const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),pos=new THREE.Vector3(),scale=new THREE.Vector3();
    items.forEach(([x,y,z,w,h,d,ry],i)=>{q.setFromAxisAngle(new THREE.Vector3(0,1,0),ry);matrix.compose(pos.set(x,y,z),q,scale.set(w,h,d));mesh.setMatrixAt(i,matrix);});
    mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  };
  add(stone,0xa7b0af,'armored-curtain');add(footings,0x485b62,'reinforced-footings');
  add(towerBodies,0xc3c9c5,'watch-bastion-bodies');add(coping,0xd3d6cd,'armor-coping');
  add(merlons,0x456876,'steel-reinforcement');add(recesses,0x283b45,'sensor-recesses');add(banners,0xeaa45a,'identification-panels');
  return group;
}

// Constrained line simplification for presentation only. Keep height steps,
// junctions and the original landform; clearance is supplied by the caller.
function simplifyRimChain(chain,clear){
  const runs=[];
  for(let i=0;i<chain.length-1;){
    let end=i+1;
    for(let j=i+2;j<chain.length;j++){
      const a=chain[i],b=chain[j],dx=b.px-a.px,dz=b.pz-a.pz,len=Math.hypot(dx,dz);
      if(len>6)break;
      if(len<.01)continue;
      const fits=chain.slice(i,j+1).every(n=>Math.abs(n.y-a.y)<.25&&Math.abs(dx*(n.pz-a.pz)-dz*(n.px-a.px))/len<.80);
      if(fits&&clear(a,b))end=j;
    }
    runs.push([chain[i],chain[end]]);i=end;
  }
  return runs;
}
