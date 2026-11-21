// Serializable grid kit shared by map authors, previews and the live generator.
// Coordinates are integer tiles; rotations are clockwise quarter turns.
export const MAP_KIT_VERSION = 1;
export const MAP_PIECES = Object.freeze({
  grass: {family:'terrain', walkable:true, elevation:0, material:'grass'},
  dirt: {family:'terrain', walkable:true, elevation:0, material:'dirt'},
  stone: {family:'terrain', walkable:true, elevation:0, material:'stone'},
  water: {family:'terrain', walkable:false, elevation:0, material:'water'},
  cliff: {family:'terrain', walkable:false, elevation:1, material:'rock'},
  road: {family:'route', walkable:true, elevation:0, material:'stone'},
  plaza: {family:'route', walkable:true, elevation:0, material:'stone'},
  ramp: {family:'route', walkable:true, elevation:1, material:'stone'},
  wall: {family:'defense', walkable:false, elevation:0, material:'stone'},
  gate: {family:'defense', walkable:true, elevation:0, material:'stone'},
  building: {family:'building', walkable:false, elevation:0, material:'stone'},
  field: {family:'building', walkable:false, elevation:0, material:'dirt'},
  tower: {family:'defense', walkable:false, elevation:0, material:'stone'},
});
export function rotateTile([x,z], turns=0) {
  if(!Number.isInteger(turns))throw new Error('Kit rotation must be an integer quarter turn');
  for(let i=0;i<((turns%4)+4)%4;i++)[x,z]=[-z,x];
  return [x,z];
}
export function stampPrefab(prefab,{x=0,z=0,rotation=0}={}) {
  if(!prefab || !Array.isArray(prefab.cells))throw new Error('Invalid map prefab');
  if(!Number.isInteger(x)||!Number.isInteger(z))throw new Error('Prefab origin must be on the tile grid');
  return prefab.cells.map(cell=>{
    if(!Object.hasOwn(MAP_PIECES,cell.piece)||!Number.isInteger(cell.x)||!Number.isInteger(cell.z))throw new Error('Invalid map piece');
    const [dx,dz]=rotateTile([cell.x,cell.z],rotation);
    return {...cell,x:x+dx,z:z+dz};
  });
}
export function rectangle(piece,x,z,w,h) {
  if(!Object.hasOwn(MAP_PIECES,piece)||![x,z,w,h].every(Number.isInteger)||w<1||h<1)throw new Error('Invalid kit rectangle');
  return Array.from({length:w*h},(_,i)=>({piece,x:x+i%w,z:z+Math.floor(i/w)}));
}
// Each brush resolves exposed edges and corners from adjacent cells, not from
// per-map mesh guesses. N/E/S/W ports use bits 1/2/4/8.
export function resolveConnections(cells) {
  const byKey=new Map();
  for(const c of cells){if(!Object.hasOwn(MAP_PIECES,c.piece))throw new Error('Unknown map piece');const k=`${c.x},${c.z}`;if(byKey.has(k))throw new Error(`Overlapping map pieces at ${k}`);byKey.set(k,c);}
  return cells.map(c=>{
    const family=MAP_PIECES[c.piece].family;
    let ports=0;
    [[0,-1],[1,0],[0,1],[-1,0]].forEach(([dx,dz],i)=>{const n=byKey.get(`${c.x+dx},${c.z+dz}`);if(n&&(n.piece===c.piece||(family==='route'&&MAP_PIECES[n.piece].family==='route')))ports|=1<<i;});
    const n=ports.toString(2).replaceAll('0','').length;
    return {...c,ports,shape:n===4?'cross':n===3?'junction':n===2?(ports===5||ports===10?'straight':'corner'):n===1?'end':'isolated'};
  });
}
export const MAP_PREFABS = Object.freeze({
  gatehouse:{label:'Twin-tower gatehouse',cells:[...rectangle('wall',-4,0,3,1),...rectangle('gate',-1,0,3,1),...rectangle('wall',2,0,3,1),...rectangle('tower',-4,-2,2,2),...rectangle('tower',3,-2,2,2)]},
  courtyard:{label:'Keep courtyard',cells:rectangle('plaza',-4,-4,8,8)},
  boulevard:{label:'Three-tile boulevard',cells:rectangle('road',-1,-6,3,12)},
  lane:{label:'District lane',cells:rectangle('road',0,-5,2,10)},
  ramp:{label:'Three-tile ramp',cells:rectangle('ramp',-1,-3,3,6)},
  // A district is a placeable courtyard and four frontages, not loose props.
  residential:{label:'Residential court',cells:[...rectangle('plaza',-2,-2,4,4),...[[-5,-3],[-5,1],[3,-3],[3,1]].flatMap(([x,z])=>rectangle('building',x,z,2,2))],slots:[[-5,-3],[-5,1],[3,-3],[3,1]]},
  farmstead:{label:'Farm court',cells:[...rectangle('dirt',-2,-2,4,4),...[[-5,-3],[-5,1],[3,-3],[3,1]].flatMap(([x,z])=>rectangle('field',x,z,2,2))],slots:[[-5,-3],[-5,1],[3,-3],[3,1]]},
});

// One collision/elevation compiler for authored layouts and the workbench.
// Unpainted cells are grass. Refuse malformed layouts before returning any state.
export function compileMapLayout(layout) {
  const {size,cells,version}=layout||{};
  if(version!==MAP_KIT_VERSION||!Number.isInteger(size)||size<8||size>256||!Array.isArray(cells)||cells.length>size*size)throw new Error('Unsupported map layout');
  const resolved=resolveConnections(cells),walkable=new Uint8Array(size*size).fill(1),height=new Float32Array(size*size),ramp=new Uint8Array(size*size);
  for(const c of resolved){
    if(!Number.isInteger(c.x)||!Number.isInteger(c.z)||c.x<0||c.z<0||c.x>=size||c.z>=size)throw new Error('Map piece outside the grid');
    const h=c.elevation??MAP_PIECES[c.piece].elevation;
    if(!Number.isFinite(h)||h<0||h>16)throw new Error('Invalid map elevation');
    const k=c.z*size+c.x;walkable[k]=+MAP_PIECES[c.piece].walkable;height[k]=h;ramp[k]=+(c.piece==='ramp');
  }
  return {size,cells:resolved,walkable,height,ramp};
}
export function findMapRoute(map,start,end) {
  const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isInteger)&&p[0]>=0&&p[1]>=0&&p[0]<map.size&&p[1]<map.size;
  if(!valid(start)||!valid(end))return null;
  const N=map.size,s=start[1]*N+start[0],goal=end[1]*N+end[0];
  if(!map.walkable[s]||!map.walkable[goal])return null;
  const parent=new Int32Array(N*N).fill(-1),queue=[s];parent[s]=s;
  for(let i=0;i<queue.length;i++){
    const k=queue[i];if(k===goal){const path=[];let j=k;while(j!==s){path.push([j%N,Math.floor(j/N)]);j=parent[j];}path.push(start);return path.reverse();}
    const x=k%N,z=Math.floor(k/N);
    for(const [dx,dz] of [[0,-1],[1,0],[0,1],[-1,0]]){
      const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=N||nz>=N)continue;
      const j=nz*N+nx;if(parent[j]>=0||!map.walkable[j])continue;
      if(Math.abs(map.height[j]-map.height[k])>.25&&!map.ramp[k]&&!map.ramp[j])continue;
      parent[j]=k;queue.push(j);
    }
  }
  return null;
}
