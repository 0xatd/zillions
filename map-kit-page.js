import { MAP_KIT_VERSION, MAP_PIECES, MAP_PREFABS, stampPrefab, resolveConnections, compileMapLayout, findMapRoute, rectangle } from './src/map-kit.js';
const canvas=document.querySelector('#map'),ctx=canvas.getContext('2d'),select=document.querySelector('#piece'),status=document.querySelector('#status');
const N=48,history=[],colors={grass:'#526d43',dirt:'#8c7351',stone:'#a9a28c',water:'#366574',cliff:'#596063',road:'#b6a680',plaza:'#c2b493',ramp:'#b89d6d',wall:'#c0c3b2',gate:'#96754a',tower:'#717e8c',building:'#688da6',field:'#8d9b4b'};
let route=[],walkStart=null;
let cells=new Map(),rotation=0,hover=null,tile=16,ox=0,oy=0;
for(const [key,piece] of Object.entries(MAP_PIECES))select.add(new Option(key[0].toUpperCase()+key.slice(1),`piece:${key}`));
for(const [key,prefab] of Object.entries(MAP_PREFABS))select.add(new Option(prefab.label,`group:${key}`));
select.value='group:gatehouse';
function shape(x,z){const [type,key]=select.value.split(':');return stampPrefab(type==='group'?MAP_PREFABS[key]:{cells:[{piece:key,x:0,z:0}]},{x,z,rotation});}
function save(){route=[];walkStart=null;history.push([...cells.values()].map(c=>({...c})));if(history.length>100)history.shift();}
function render(){
 const dpr=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);tile=Math.min(w/N,h/N);ox=(w-tile*N)/2;oy=(h-tile*N)/2;ctx.fillStyle='#1d2c26';ctx.fillRect(0,0,w,h);
 ctx.fillStyle='#40543c';ctx.fillRect(ox,oy,N*tile,N*tile);
 for(let z=0;z<N;z++)for(let x=0;x<N;x++){ctx.strokeStyle='#ffffff08';ctx.strokeRect(ox+x*tile,oy+z*tile,tile,tile);}
 const paint=(c,alpha=1)=>{ctx.globalAlpha=alpha;ctx.fillStyle=colors[c.piece];ctx.fillRect(ox+c.x*tile+.4,oy+c.z*tile+.4,tile-.8,tile-.8);if(c.piece==='wall'||c.piece==='tower'){ctx.fillStyle='#e0dac2';ctx.fillRect(ox+c.x*tile+tile*.2,oy+c.z*tile+tile*.2,tile*.6,tile*.24);}if(c.piece==='ramp'){ctx.strokeStyle='#e4cfa6';for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(ox+c.x*tile,oy+(c.z+i/4)*tile);ctx.lineTo(ox+(c.x+1)*tile,oy+(c.z+i/4)*tile);ctx.stroke();}}};
 for(const c of resolveConnections([...cells.values()])){paint(c);if(MAP_PIECES[c.piece].family==='route'){ctx.strokeStyle='#e5d5ad';ctx.lineWidth=tile*.17;const x=ox+(c.x+.5)*tile,y=oy+(c.z+.5)*tile;[[0,-1],[1,0],[0,1],[-1,0]].forEach(([dx,dz],i)=>{if(c.ports&(1<<i)){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+dx*tile*.5,y+dz*tile*.5);ctx.stroke();}});}}
 if(route.length){ctx.strokeStyle='#ffe38a';ctx.lineWidth=3;ctx.beginPath();route.forEach(([x,z],i)=>ctx[i?'lineTo':'moveTo'](ox+(x+.5)*tile,oy+(z+.5)*tile));ctx.stroke();}
 if(hover&&!document.querySelector('#walk').checked)for(const c of shape(...hover))if(c.x>=0&&c.z>=0&&c.x<N&&c.z<N)paint(c,.55);ctx.globalAlpha=1;
 document.querySelector('#angle').textContent=`${rotation*90}°`;
}
canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();hover=[Math.floor((e.clientX-r.left-ox)/tile),Math.floor((e.clientY-r.top-oy)/tile)];render();});
canvas.addEventListener('pointerleave',()=>{hover=null;render();});
canvas.addEventListener('pointerdown',e=>{const r=canvas.getBoundingClientRect(),x=Math.floor((e.clientX-r.left-ox)/tile),z=Math.floor((e.clientY-r.top-oy)/tile);if(document.querySelector('#walk').checked){if(!walkStart){walkStart=[x,z];route=[];status.textContent='Choose the destination.';}else{route=findMapRoute(compileMapLayout({version:MAP_KIT_VERSION,size:N,cells:[...cells.values()]}),walkStart,[x,z])||[];walkStart=null;status.textContent=route.length?'Walkable route shown. Choose a new start.':'No walkable route. Check walls, water, cliffs and ramp connections.';}render();return;}
 const placed=shape(x,z);if(placed.some(c=>c.x<0||c.z<0||c.x>=N||c.z>=N)){status.textContent='That group extends outside the map. Move it inward.';return;}save();for(const c of placed)cells.set(`${c.x},${c.z}`,c);status.textContent='Placed. R rotates the next piece; Undo restores the previous layout.';render();});
const rotate=()=>{rotation=(rotation+1)%4;render();},undo=()=>{route=[];walkStart=null;if(history.length)cells=new Map(history.pop().map(c=>[`${c.x},${c.z}`,c]));render();};
document.querySelector('#rotate').onclick=rotate;document.querySelector('#undo').onclick=undo;document.querySelector('#clear').onclick=()=>{save();cells.clear();render();};select.onchange=render;
addEventListener('keydown',e=>{if(e.target.tagName==='SELECT')return;if(e.key.toLowerCase()==='r')rotate();if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo();}});
document.querySelector('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({name:'Zillions map layout',version:MAP_KIT_VERSION,size:N,cells:[...cells.values()]},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='zillions-map-layout.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.querySelector('#import').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>500000)throw new Error('Layout file is too large');const data=JSON.parse(await file.text());if(data.version!==MAP_KIT_VERSION||data.size!==N||!Array.isArray(data.cells)||data.cells.length>N*N)throw new Error('Unsupported layout');for(const c of data.cells)if(!Object.hasOwn(MAP_PIECES,c.piece)||!Number.isInteger(c.x)||!Number.isInteger(c.z)||c.x<0||c.z<0||c.x>=N||c.z>=N)throw new Error('Invalid layout piece');compileMapLayout(data);save();cells=new Map(data.cells.map(c=>[`${c.x},${c.z}`,{piece:c.piece,x:c.x,z:c.z,...(c.elevation===undefined?{}:{elevation:c.elevation})}]));status.textContent='Layout imported.';render();}catch(err){status.textContent=err.message;}finally{e.target.value='';}};
// Show a composed sample immediately; blank-canvas work stays one click away.
for(const c of [...rectangle('wall',7,7,34,1),...rectangle('wall',7,34,34,1),...rectangle('wall',7,8,1,26),...rectangle('wall',40,8,1,26),...[[7,7],[39,7],[7,33],[39,33]].flatMap(([x,z])=>rectangle('tower',x,z,2,2))])cells.set(`${c.x},${c.z}`,c);
for(const c of [...rectangle('road',23,18,3,17),...rectangle('road',13,17,23,2)])cells.set(`${c.x},${c.z}`,c);
for(const [name,x,z,rotation] of [['courtyard',24,15,0],['boulevard',24,26,0],['gatehouse',24,34,0],['residential',13,17,0],['farmstead',35,17,1]])for(const c of stampPrefab(MAP_PREFABS[name],{x,z,rotation}))cells.set(`${c.x},${c.z}`,c);
for(const c of rectangle('building',22,13,4,4))cells.set(`${c.x},${c.z}`,c);
new ResizeObserver(render).observe(canvas);render();
