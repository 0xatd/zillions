import { TILE, LEVELS } from './config.js';
import { MAP_KIT_VERSION, MAP_PIECES, MAP_PREFABS, stampPrefab, rectangle, resolveConnections } from './map-kit.js';

// Plan first, then place buildings beside its reserved streets. Original plot
// IDs and economy counts remain, but positions change: snapshot version must bump.
export function composeFortress(map,plots,hq) {
  if(hq?.plan?.key!=='keyhole'||map.seed!==LEVELS.find(l=>l.id===5)?.seed)return;
  const first=map.sites?.[0];
  if(!first||Math.hypot(hq.cx-first.x,hq.cz-first.z)>3)return;
  return applyFortressComposition(map,plots,hq,FORTRESS_COMPOSITIONS.crownCourts);
}

// Map-specific composition data. The placement, clearance and rendering rules
// below are shared; another map supplies its own courts and street rectangles.
export const FORTRESS_COMPOSITIONS=Object.freeze({
  crownCourts:{id:'crown-courts-v1',name:'Crown & Courts fortress',
    streets:[[4,-13,3,27],[-13,4,20,3]],
    courts:[{kind:'residential',x:-7,z:-5,preferenceAxis:[-1,0]},{kind:'farmstead',x:10,z:2,preferenceAxis:[1,0]}]},
});
export function applyFortressComposition(map,plots,hq,design){
  if(!design?.streets?.length||design.courts?.length!==2)throw new Error('Fortress composition needs streets and two districts');
  const N=map.size,cx=Math.round(hq.cx),cz=Math.round(hq.cz),reach=hq.plan.reach;
  const buildings=plots.filter(p=>p.kind!=='wall'&&p!==hq&&Math.hypot(p.cx-cx,p.cz-cz)<reach);
  const movable=buildings.filter(p=>!p.kind.startsWith('camp_')&&p.kind!=='tower'&&p.kind!=='mine');
  const moving=new Set(movable),blocked=new Set(),reserved=new Set(),cells=new Map();
  const key=(x,z)=>z*N+x;
  for(const p of plots){
    if(moving.has(p))continue;
    if(p.kind==='wall'){const arch=new Set((p.arch||[]).map(([x,z])=>key(x,z)));for(const [x,z] of p.tiles)if(!arch.has(key(x,z)))blocked.add(key(x,z));}
    else for(let z=p.z;z<p.z+p.size;z++)for(let x=p.x;x<p.x+p.size;x++)blocked.add(key(x,z));
  }
  const open=(x,z)=>x>1&&z>1&&x<N-2&&z<N-2&&map.isWalkable(x,z)&&Math.hypot(x+.5-cx,z+.5-cz)<reach-1;
  // One straight spine beside the keep; district courts meet it through a
  // broad cross street. Gate connectors are derived after the layout exists.
  const avenue=design.streets.flatMap(([x,z,w,h])=>rectangle('road',cx+x,cz+z,w,h));
  const courts=design.courts.map(c=>({...c,x:cx+c.x,z:cz+c.z}));
  const raw=[...stampPrefab(MAP_PREFABS.courtyard,{x:cx,z:cz}),...avenue,...courts.flatMap(c=>stampPrefab(MAP_PREFABS[c.kind],c))];
  for(const c of raw)if(MAP_PIECES[c.piece].walkable&&open(c.x,c.z)&&!blocked.has(key(c.x,c.z))){reserved.add(key(c.x,c.z));cells.set(key(c.x,c.z),c);}
  const candidates=[];
  for(let z=cz-16;z<=cz+16;z++)for(let x=cx-16;x<=cx+16;x++){
    if(!open(x,z)||!open(x+1,z+1))continue;
    candidates.push([x,z]);
  }
  const occupied=new Set(blocked),placements=[];
  const fits=(x,z)=>{
    for(let dz=-1;dz<=2;dz++)for(let dx=-1;dx<=2;dx++)if(!open(x+dx,z+dz)||occupied.has(key(x+dx,z+dz)))return false;
    for(let dz=0;dz<2;dz++)for(let dx=0;dx<2;dx++)if(reserved.has(key(x+dx,z+dz)))return false;
    return true;
  };
  const frontage=p=>{
    const out=[];for(let z=p.z-1;z<=p.z+p.size;z++)for(let x=p.x-1;x<=p.x+p.size;x++)if(x<p.x||z<p.z||x>=p.x+p.size||z>=p.z+p.size)out.push(key(x,z));return out;
  };
  const accessible=(x,z)=>{
    const trial=new Set(occupied);for(let dz=0;dz<2;dz++)for(let dx=0;dx<2;dx++)trial.add(key(x+dx,z+dz));
    const seeds=frontage(hq).filter(k=>open(k%N,Math.floor(k/N))&&!trial.has(k));
    const seen=new Set(),queue=seeds.length?[seeds[0]]:[];
    for(let i=0;i<queue.length;i++){
      const k=queue[i];if(seen.has(k))continue;seen.add(k);
      for(const j of [k-1,k+1,k-N,k+N])if(!seen.has(j)&&!trial.has(j)&&open(j%N,Math.floor(j/N)))queue.push(j);
    }
    const required=[...plots.filter(p=>p!==hq&&!moving.has(p)&&p.kind!=='wall'&&Math.hypot(p.cx-cx,p.cz-cz)<reach-3),...placements.map(a=>({x:a.x,z:a.z,size:2})),{x,z,size:2}];
    return required.every(p=>frontage(p).some(k=>seen.has(k)));
  };
  // Groups share authored frontage slots. Remaining plots extend aligned rows
  // within the same district, rather than a randomized scatter score.
  for(const p of [...movable].sort((a,b)=>(a.kind<b.kind?-1:a.kind>b.kind?1:a.id-b.id))){
    const residential=p.kind==='house'||p.kind==='hero_forge'||p.kind==='workshop';
    const district=courts[residential?0:1];
    const anchors=MAP_PREFABS[district.kind].slots.map(([x,z])=>[x+district.x,z+district.z]);
    const sorted=[...candidates].sort((a,b)=>{
      const score=([x,z])=>Math.min(...anchors.map(([ax,az])=>Math.abs(x-ax)+Math.abs(z-az)))+Math.abs((z-cz+30)%3)*1.4+Math.max(0,-(x-cx)*district.preferenceAxis[0]-(z-cz)*district.preferenceAxis[1])*2;
      return score(a)-score(b)||a[1]-b[1]||a[0]-b[0];
    });
    const spot=sorted.find(([x,z])=>fits(x,z)&&accessible(x,z));
    if(!spot)throw new Error(`Fortress kit has no valid frontage for ${p.kind} ${p.id}`);
    const [x,z]=spot;placements.push({p,x,z,district:district.kind});
    for(let dz=0;dz<2;dz++)for(let dx=0;dx<2;dx++)occupied.add(key(x+dx,z+dz));
  }
  for(const {p,x,z,district} of placements){p.x=x;p.z=z;p.cx=x+p.size/2;p.cz=z+p.size/2;p.district=district;}
  // Remove old interior road traces; preserve actual graded approach ramps.
  for(let z=cz-Math.ceil(reach);z<=cz+Math.ceil(reach);z++)for(let x=cx-Math.ceil(reach);x<=cx+Math.ceil(reach);x++){
    if(open(x,z)&&map.tiles[key(x,z)]===TILE.PATH&&!map.swRoad?.[key(x,z)])map.tiles[key(x,z)]=TILE.GRASS;
  }
  // Renderer and connector consume these same authored tiles.
  hq.plan.kit={version:MAP_KIT_VERSION,name:design.name,composition:design.id,courts,cells:resolveConnections([...cells.values()])};
  hq.plan.label=design.name;
}
