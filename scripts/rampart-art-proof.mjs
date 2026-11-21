// Developer-only visual regression proof; not imported by the game.
export async function proveGateClearance(){
  const {hasKit}=await import('../src/assets.js');
  if(!hasKit('wall_t2_seg'))throw new Error('Start a local game and await its kit before running this proof');
  const {Game}=await import('../src/game.js'),{TerrainField}=await import('../src/terrain.js'),{LEVELS}=await import('../src/config.js');
  const {buildBuildingMesh}=await import('../src/building-art.js'),{gateSupports}=await import('../src/rampart-art-plan.js');
  const {Vector3}=await import('three');let gates=0,vertices=0;const failures=[];
  for(const l of LEVELS)for(let si=0;si<3;si++){
   const m=new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests});const g=new Game(m,'normal','scott',null,l.id);g.foundCity(si,0);
   const walls=g.plots.filter(p=>p.kind==='wall'),N=m.size,wallTiles=new Set(walls.flatMap(p=>p.tiles.map(([x,z])=>z*N+x))),archTiles=new Set(walls.flatMap(p=>(p.arch||[]).map(([x,z])=>z*N+x)));
   for(const p of walls.filter(p=>p.gate)){
    const key=p.gate[1]*N+p.gate[0];
    for(const tier of [1,2,3]){
     const b={kind:'wall',x:p.gate[0],z:p.gate[1],gate:true,plotTier:tier};
     const root=buildBuildingMesh(b,{mapSize:N,wallTiles,archTiles,gateMain:new Set([key]),gateSupports:new Map([[key,gateSupports(p,m)]]),armoredWalls:true,center:[g.plots[0].cx,g.plots[0].cz]});
     root.updateMatrixWorld(true);
     root.traverse(o=>{if(!o.isMesh)return;const pos=o.geometry.getAttribute('position');for(let i=0;i<pos.count;i++){
      const v=new Vector3().fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);if(v.y<.03||v.y>1.8)continue;
      const x=Math.floor(v.x+b.x+.5),z=Math.floor(v.z+b.z+.5),k=z*N+x;vertices++;
      if(archTiles.has(k)||(!wallTiles.has(k)&&m.isWalkable(x,z)))if(failures.length<12)failures.push({level:l.id,site:si,tier,gate:p.gate,x,z,y:v.y});
     }});
     root.traverse(o=>{if(o.isMesh)o.geometry.dispose();});gates++;
    }
   }
  }
  if(failures.length)throw new Error('Gate jamb intrudes into a walking lane: '+JSON.stringify(failures));
  return {gates,vertices,failures};
}
