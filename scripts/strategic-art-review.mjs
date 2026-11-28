import {startReviewServer} from './playability-static-server.mjs';
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';
const server=await startReviewServer(),out='/tmp/zillions-world-art';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto(`${server.url}/__art_review__`);
 await page.setContent('<style>body{margin:0;background:#07121c}canvas{display:block}</style><canvas id="map"></canvas>');
 for(const [name,width,height] of [['laptop',1366,768],['phone',390,844]]){
  await page.setViewportSize({width,height});
  await page.evaluate(async({width,height})=>{
   const {drawPlanet,drawFleet,layoutWorldLabels,drawWorldLabels}=await import('/src/strategic-map-art.js');
   const {newWorld,joinWorld,worldView}=await import('/src/strategic-world.js');
   const world=worldView(joinWorld(newWorld(0),{actor:'test',character:'pilot',name:'Pathfinder'},0),'test','pilot');
   const c=document.querySelector('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');
   const scale=Math.min(width/1050,height/760)*1.3,point=p=>({x:width/2+(p.x-300)*scale,y:height/2+(p.z-350)*scale});
   const gradient=ctx.createRadialGradient(width*.6,height*.3,0,width*.6,height*.3,width*.8);gradient.addColorStop(0,'#17364c');gradient.addColorStop(1,'#050c16');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
   const labels=[],obstacles=[];
   for(const p of world.ports){const at=point(p),radius=Math.max(13,24*scale);drawPlanet(ctx,p,at,radius);labels.push({id:p.id,text:p.name,kind:'port',x:at.x,y:at.y,width:p.name.length*8+16,priority:80,gap:radius+10});obstacles.push({x:at.x-radius,y:at.y-radius,width:radius*2,height:radius*2});}
   for(const f of world.fleets){const at=point(f),color=f.mine?'#f5d58b':f.kind==='hostile'?'#ef7867':f.kind==='patrol'?'#88b4f2':'#7fc9b6';drawFleet(ctx,f,at,color);labels.push({id:f.id,text:`${f.name} · ${f.troops}`,x:at.x,y:at.y,color,width:f.name.length*7+42,priority:f.mine?100:10,mine:f.mine});obstacles.push({x:at.x-18,y:at.y-18,width:36,height:36});}
   drawWorldLabels(ctx,layoutWorldLabels(labels,{width,height,obstacles}));
  },{width,height});
  await page.screenshot({path:`${out}/map-${name}.png`});
 }
 console.log(`Art samples: ${out}`);
}finally{await browser.close();await server.close();}
