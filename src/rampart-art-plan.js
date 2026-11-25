// Presentation contracts derived from each purchasable wall's own occupancy.
// Do not smooth across independently destroyed tiles or invent a blocked cell.
export function gateSupports(plot,map) {
  if (!plot.gate) return null;
  const opening=plot.arch || [plot.gate];
  const arch = new Set(opening.map(([x,z])=>`${x},${z}`));
  const solid = new Set(plot.tiles.filter(([x,z])=>!arch.has(`${x},${z}`)).map(([x,z])=>`${x},${z}`));
  const cx=opening.reduce((s,p)=>s+p[0],0)/opening.length;
  const cz=opening.reduce((s,p)=>s+p[1],0)/opening.length;
  let xx=0,zz=0,xz=0;
  for(const [x,z] of opening){xx+=(x-cx)**2;zz+=(z-cz)**2;xz+=(x-cx)*(z-cz);}
  const angle=.5*Math.atan2(2*xz,xx-zz),ux=Math.cos(angle),uz=Math.sin(angle);
  const projections=opening.map(([x,z])=>(x-cx)*ux+(z-cz)*uz);
  const candidates=new Map();
  for(const [x,z] of opening)for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){
    const px=x+dx,pz=z+dz,key=`${px},${pz}`;
    if(arch.has(key))continue;
    // Natural abutments may support gates whose wall chain ends in rock.
    if(!solid.has(key)&&(!map||px<1||pz<1||px>=map.size-1||pz>=map.size-1||map.isWalkable(px,pz)||map.swRoad?.[pz*map.size+px]))continue;
    candidates.set(key,[px,pz]);
  }
  const ends=[-1,1].map(sign=>{
    const edge=sign<0?Math.min(...projections):Math.max(...projections);
    return [...candidates.values()].filter(([x,z])=>sign*((x-cx)*ux+(z-cz)*uz-edge)>.35)
      .sort((a,b)=>{
        const score=([x,z])=>Math.hypot(x-cx-ux*(edge+sign),z-cz-uz*(edge+sign));
        return score(a)-score(b)||a[1]-b[1]||a[0]-b[0];
      })[0];
  });
  return ends.every(Boolean)?ends:null;
}

export function rampartPanels(x,z,N,tiles) {
  const nbs=[[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dz])=>tiles.has((z+dz)*N+x+dx));
  const straight=nbs.length===2&&nbs[0][0]===-nbs[1][0]&&nbs[0][1]===-nbs[1][1];
  const center=nbs.reduce((p,[dx,dz])=>[p[0]+dx*.26,p[1]+dz*.26],[0,0]);
  // One unbroken panel across a straight cell. Damage still removes exactly
  // that cell, while corners retain shared edge midpoints and a compact joint.
  const runs=straight?[[nbs[0].map(v=>v*.5),nbs[1].map(v=>v*.5)]]:
    nbs.map(([dx,dz])=>[center,[dx*.5,dz*.5]]);
  const diagonals=[[1,1],[1,-1],[-1,1],[-1,-1]].filter(([dx,dz])=>
    tiles.has((z+dz)*N+x+dx)&&!tiles.has(z*N+x+dx)&&!tiles.has((z+dz)*N+x));
  return {nbs,straight,center,runs,diagonals};
}
