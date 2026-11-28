import {Game} from '../src/game.js';
let seed=1907;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const n=24,failures=[];
for(let scene=0;scene<12;scene++){
 const walls=new Set();for(let k=0;k<12;k++){const x=2+(rand()*18|0),z=2+(rand()*18|0),w=1+(rand()*4|0),h=1+(rand()*4|0);for(let dx=0;dx<w;dx++)for(let dz=0;dz<h;dz++)walls.add(`${x+dx},${z+dz}`);}
 const g=Object.create(Game.prototype);g.map={size:n,isWalkable:(x,z)=>x>=0&&z>=0&&x<n&&z<n&&!walls.has(`${x},${z}`)};g.occ=new Int32Array(n*n);g.gateIds=new Set();
 for(let k=0;k<70;k++){const a={hero:true,x:1+rand()*21,z:1+rand()*21,buffs:[]},tx=1+rand()*21,tz=1+rand()*21;const start=[a.x,a.z];if(!g.map.isWalkable(a.x|0,a.z|0)||!g.map.isWalkable(tx|0,tz|0)||g._fieldReach(a,tx,tz,true)<0)continue;
 let steps=0;for(;steps<800;steps++){const dx=tx-a.x,dz=tz-a.z,d=Math.hypot(dx,dz);if(d<.45)break;g._moveActor(a,dx/d,dz/d,4,1/30,tx,tz);}
 if(steps===800){failures.push({scene,start,goal:[tx,tz],end:[a.x,a.z],walls:[...walls]});if(failures.length>=3)break;}
 }if(failures.length>=3)break;
}
console.log(JSON.stringify(failures));
