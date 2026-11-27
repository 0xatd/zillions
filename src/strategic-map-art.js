// Presentation only. These helpers never change fleet positions or world state.
const tau = Math.PI * 2;
const polygon=(ctx,points)=>{ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();};
const hash=text=>{let n=17;for(const c of String(text))n=(n*31+c.charCodeAt(0))>>>0;return n;};

export function drawPlanet(ctx,p,at,radius){
 const r=radius,seed=hash(p.id),color=p.color||'#7297aa';ctx.save();ctx.translate(at.x,at.y);
 // A quiet atmosphere and directional light distinguish spheres from UI dots.
 const halo=ctx.createRadialGradient(0,0,r*.8,0,0,r*1.4);halo.addColorStop(0,`${color}33`);halo.addColorStop(1,`${color}00`);ctx.fillStyle=halo;ctx.beginPath();ctx.arc(0,0,r*1.4,0,tau);ctx.fill();
 ctx.save();ctx.beginPath();ctx.arc(0,0,r,0,tau);ctx.clip();
 const surface=ctx.createRadialGradient(-r*.45,-r*.55,r*.05,r*.1,r*.15,r*1.3);surface.addColorStop(0,color);surface.addColorStop(.7,'#233f4a');surface.addColorStop(1,'#07111d');ctx.fillStyle=surface;ctx.fillRect(-r,-r,2*r,2*r);
 // Broad irregular land/strata patches, seeded only from the colony id.
 for(let k=0;k<6;k++){
  const phase=((seed>>(k*3))%31)/31*tau,cx=Math.cos(phase)*r*.55,cy=Math.sin(phase*1.7)*r*.55;
  const points=[];for(let j=0;j<10;j++){const a=j/10*tau,rr=r*(.16+.1*Math.sin(j*2.7+k*1.9));points.push([cx+Math.cos(a)*rr*1.7,cy+Math.sin(a)*rr]);}
  polygon(ctx,points);ctx.fillStyle=k%2?'#bfd4b524':'#091c2640';ctx.fill();
 }
 // Wisps are curved with the globe, not noisy screen-space texture.
 ctx.strokeStyle='#e7ede226';ctx.lineWidth=Math.max(.6,r*.035);
 for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(-r*.12,(i-1)*r*.38,r*.82,r*.16,-.28,.2,2.8);ctx.stroke();}
 const shade=ctx.createLinearGradient(-r,-r,r,r);shade.addColorStop(0,'#f3e5bd22');shade.addColorStop(.4,'#06121d00');shade.addColorStop(1,'#020915d9');ctx.fillStyle=shade;ctx.fillRect(-r,-r,2*r,2*r);ctx.restore();
 ctx.lineWidth=1;ctx.strokeStyle=`${color}99`;ctx.beginPath();ctx.arc(0,0,r,0,tau);ctx.stroke();
 // Orbital navigation arcs and a small docking station, subordinate to surface.
 ctx.strokeStyle='#b9d1df48';ctx.beginPath();ctx.ellipse(0,0,r*1.42,r*.46,-.28,0,tau);ctx.stroke();
 ctx.strokeStyle='#d7c28c99';ctx.beginPath();ctx.arc(0,0,r*1.19,-1.5,-.45);ctx.stroke();
 ctx.save();ctx.translate(r*1.28,-r*.27);ctx.rotate(-.28);ctx.fillStyle='#a9bec8';ctx.fillRect(-3,-2,6,4);ctx.fillStyle='#4b718b';ctx.fillRect(-7,-1,3,2);ctx.fillRect(4,-1,3,2);ctx.restore();ctx.restore();
}

export function drawFleet(ctx,f,at,color){
 ctx.save();ctx.translate(at.x,at.y);ctx.rotate(f.target?Math.atan2(f.target.z-f.z,f.target.x-f.x)+Math.PI/2:0);
 const moving=!!f.target&&!f.encounter;
 if(moving){const plume=ctx.createLinearGradient(0,8,0,22);plume.addColorStop(0,'#9ce4ffb0');plume.addColorStop(1,'#60bfff00');ctx.fillStyle=plume;polygon(ctx,[[-3,8],[3,8],[1,22],[-1,22]]);ctx.fill();}
 ctx.strokeStyle='#07131b';ctx.lineWidth=1.4;
 if(f.kind==='trader'){
  // Broad hauler pods and a narrow central bridge.
  for(const side of [-1,1]){ctx.fillStyle='#334b5a';ctx.fillRect(side<0?-11:5,-5,6,15);ctx.strokeRect(side<0?-11:5,-5,6,15);ctx.fillStyle=color;ctx.fillRect(side<0?-10:6,-3,4,3);ctx.fillRect(side<0?-10:6,3,4,3);}
  polygon(ctx,[[0,-15],[4,-9],[4,11],[-4,11],[-4,-9]]);
 }else if(f.kind==='hostile'){
  polygon(ctx,[[0,-16],[4,-6],[13,2],[10,11],[4,7],[0,12],[-4,7],[-10,11],[-13,2],[-4,-6]]);
 }else{
  // Armored frigate: pointed bridge, shoulder pylons and paired engines.
  polygon(ctx,[[0,-17],[5,-8],[5,-1],[11,3],[11,11],[5,8],[4,13],[-4,13],[-5,8],[-11,11],[-11,3],[-5,-1],[-5,-8]]);
 }
 const hull=ctx.createLinearGradient(-10,0,11,0);hull.addColorStop(0,'#405868');hull.addColorStop(.42,'#b3c4cb');hull.addColorStop(.55,'#78929e');hull.addColorStop(1,'#243e50');ctx.fillStyle=hull;ctx.fill();ctx.stroke();
 polygon(ctx,[[0,-12],[2,-7],[2,5],[-2,5],[-2,-7]]);ctx.fillStyle=color;ctx.fill();
 ctx.fillStyle='#0c2331';ctx.fillRect(-2,-6,4,3);ctx.fillStyle='#b1e4f7';ctx.fillRect(-1,-6,2,1);
 ctx.fillStyle=moving?'#a2dfff':color;ctx.fillRect(-4,10,2,3);ctx.fillRect(2,10,2,3);
 ctx.restore();
 if(f.mine||f.selected){ctx.save();ctx.strokeStyle=color;ctx.lineWidth=f.mine?1.3:1;for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(at.x,at.y,22,i*Math.PI/2+.1,i*Math.PI/2+1.1);ctx.stroke();}ctx.restore();}
 if(f.encounter){ctx.save();ctx.strokeStyle='#f2a06b';ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(at.x+17,at.y-20);ctx.lineTo(at.x+25,at.y-12);ctx.moveTo(at.x+25,at.y-20);ctx.lineTo(at.x+17,at.y-12);ctx.stroke();ctx.restore();}
}

const intersects=(a,b)=>a.x<b.x+b.width+4&&a.x+a.width+4>b.x&&a.y<b.y+b.height+3&&a.y+a.height+3>b.y;
// Greedy, stable screen-space label placement. Off-screen markers never pin
// names to an unrelated map edge. Crowded low-priority names may be omitted;
// their ships remain drawn and selectable at their actual positions.
export function layoutWorldLabels(labels,{width,height,obstacles=[]}={}){
 const occupied=[...obstacles],placed=[];
 for(const label of [...labels].sort((a,b)=>(b.priority||0)-(a.priority||0)||String(a.id).localeCompare(String(b.id)))){
  if(label.x<0||label.x>width||label.y<0||label.y>height)continue;
  const w=Math.min(width-24,label.width||String(label.text).length*7+16),h=label.height||22,gap=label.gap||28;
  const offsets=[];for(let ring=0;ring<8;ring++){const distance=gap+ring*25;offsets.push([-w/2,distance],[-w/2,-distance-h],[distance,-h/2],[-distance-w,-h/2]);}
  let box;
  for(const [dx,dy] of offsets){const candidate={x:Math.max(12,Math.min(width-w-12,label.x+dx)),y:label.y+dy,width:w,height:h};if(candidate.y<64||candidate.y+h>height-112)continue;if(occupied.some(other=>intersects(candidate,other)))continue;box=candidate;break;}
  if(!box)continue;occupied.push(box);placed.push({...label,...box,anchorX:label.x,anchorY:label.y});
 }
 return placed;
}
export function drawWorldLabels(ctx,labels){
 ctx.save();
 for(const l of labels){
  const cx=l.x+l.width/2,cy=l.y+l.height/2;
  if(Math.hypot(cx-l.anchorX,cy-l.anchorY)>45){ctx.strokeStyle='#a6bdcc55';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(l.anchorX,l.anchorY);ctx.lineTo(cx,cy);ctx.stroke();}
  ctx.fillStyle=l.kind==='port'?'#07121cdb':'#07121cc9';ctx.fillRect(l.x,l.y,l.width,l.height);
  if(l.mine){ctx.strokeStyle='#d4b97a66';ctx.lineWidth=.7;ctx.strokeRect(l.x,l.y,l.width,l.height);}
  ctx.fillStyle=l.color||'#d9e5e9';ctx.font=l.kind==='port'?'600 13px system-ui':'12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(l.text,cx,cy,l.width-12);
 }
 ctx.restore();
}
