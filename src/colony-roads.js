// One connected street network, routed around the fully built colony.
// Fixed neighbour order; no simulation RNG or new walkability.
import { TILE } from './config.js';

export function colonyRoads(map, plots) {
  const hq = plots.find(p => p.kind === 'hq');
  if (!hq?.plan) return null;
  const N = map.size, blocked = new Uint8Array(N * N);
  const gates = [];
  for (const p of plots) {
    if (p.kind === 'wall') {
      const arch = new Set((p.arch || []).map(([x,z]) => z*N+x));
      for (const [x,z] of p.tiles) if (!arch.has(z*N+x)) blocked[z*N+x] = 1;
      if (p.role === 'rampart' && p.gate) gates.push(p.gate[1]*N+p.gate[0]);
    } else for (let z=p.z;z<p.z+p.size;z++) for (let x=p.x;x<p.x+p.size;x++) blocked[z*N+x]=1;
  }
  const reach = hq.plan.reach + 3;
  const open = k => k>=0 && k<N*N && !blocked[k] && map.isWalkable(k%N,Math.floor(k/N))
    && Math.hypot(k%N+.5-hq.cx,Math.floor(k/N)+.5-hq.cz)<reach;
  const margin = p => {
    const out=[];
    for (let z=p.z-1;z<=p.z+p.size;z++) for(let x=p.x-1;x<=p.x+p.size;x++) {
      if(x>=p.x&&x<p.x+p.size&&z>=p.z&&z<p.z+p.size)continue;
      if(x<1||z<1||x>=N-1||z>=N-1)continue;
      const k=z*N+x;if(open(k))out.push(k);
    }
    return out;
  };
  const network=new Set(margin(hq)), routes=[], connections=[];
  // Grow from the court to each gate, then each district frontage. Shortest
  // connectors join existing streets rather than radiating through buildings.
  const connect=(targets,plotId,primary=false)=>{
    const parent=new Int32Array(N*N).fill(-1),queue=[];
    for(const k of network){parent[k]=k;queue.push(k);}
    const goal=new Set(targets.filter(open));let found=-1;
    for(let head=0;head<queue.length;head++){
      const k=queue[head];if(goal.has(k)){found=k;break;}
      const x=k%N,z=Math.floor(k/N);
      for(const [dx,dz] of [[1,0],[0,1],[-1,0],[0,-1]]){
        const nx=x+dx,nz=z+dz;if(nx<1||nz<1||nx>=N-1||nz>=N-1)continue;
        const j=nz*N+nx;if(parent[j]>=0||!open(j))continue;
        parent[j]=k;queue.push(j);
      }
    }
    if(found<0)return;
    const path=[found];let k=found;
    while(parent[k]!==k){k=parent[k];path.push(k);}
    path.reverse();for(const j of path)network.add(j);
    routes.push({primary,points:path.map(j=>[j%N+.5,Math.floor(j/N)+.5])});
    connections.push({plotId,tile:found});
  };
  // Author-designed streets precede frontage connectors. Connect every piece
  // to the keep network so clipped terrain edges never leave isolated paving.
  const kitTiles=hq.plan.kit?.cells || [];
  for(const c of kitTiles)if(open(c.z*N+c.x))connect([c.z*N+c.x],null,false);
  gates.forEach(k=>connect([k],null,true));
  const buildings=plots.filter(p=>p.kind!=='wall'&&p!==hq&&Math.hypot(p.cx-hq.cx,p.cz-hq.cz)<hq.plan.reach)
    .sort((a,b)=>Math.hypot(a.cx-hq.cx,a.cz-hq.cz)-Math.hypot(b.cx-hq.cx,b.cz-hq.cz)||a.id-b.id);
  buildings.forEach(p=>connect(margin(p),p.id));
  for(const k of network)if(map.tiles[k]===TILE.GRASS)map.tiles[k]=TILE.PATH;
  return {kit:hq.plan.kit||null,routes,connections,tiles:[...network].map(k=>[k%N,Math.floor(k/N)])};
}
