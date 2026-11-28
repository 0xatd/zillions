import {drawPlanet,drawFleet,layoutWorldLabels,drawWorldLabels} from './strategic-map-art.js';
import {worldRequest} from './backend.js';
import {newWorld,joinWorld,commandWorld,worldView,settleWorldBattle,WORLD_PORTS,WORLD_LIMITS} from './strategic-world.js';
import {readLocalWorld,commitLocalWorld} from './local-strategic-store.js';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const friendly={world_storage_unavailable:'Your browser could not save this change. No purchase is confirmed; free storage and retry.',world_setup_locked:'This battle is already reserved. Keep the original difficulty, resume your save, or withdraw with troop losses.',encounter_party_required:'Join the commander’s friend party before joining their encounter.',battle_report_already_accepted:'This battle has already finished. Recover its result to return to the world.',world_save_invalid:'This local world save could not be read. It has not been overwritten.',world_not_configured:'The shared world is not available on this server yet.',sign_in_required:'Sign in to enter the shared world.',arrival_required:'Travel to the colony before using its services.',insufficient_alloy:'You need 12 Alloy to recruit a soldier.',campaign_locked:'Liberate the previous colony first.',battle_report_pending:'Battle rewards are still saving. Retry when the report is accepted.',encounter_pending:'Resolve this encounter before travelling.',out_of_range:'Move closer to make contact.'};
export class StrategicMap {
 constructor(host,options){
  this.host=host;this.options=options;this.camera={x:500,z:350,zoom:1};this.selected=null;this.busy=false;this.active=false;this.generation=0;
  host.classList.add('live-world');
  this.root=el('section','strategic-map');host.append(this.root);
  this.canvas=el('canvas','strategic-canvas');this.canvas.setAttribute('aria-label','Star system map. Click to travel; drag to pan; scroll to zoom.');this.canvas.tabIndex=0;this.root.append(this.canvas);
  this.header=el('header','strategic-header');const back=host.querySelector('#world-back')||el('button','','Characters');back.textContent='Characters';back.onclick=()=>options.onBack();this.header.append(back,el('strong','','SOL FRONTIER'));this.mode=el('span');this.header.append(this.mode);this.root.append(this.header);
  this.resources=el('div','strategic-resources');this.root.append(this.resources);
  this.panel=el('aside','strategic-panel hidden');this.root.append(this.panel);
  this.status=el('p','strategic-status','Connecting to the world…');this.status.setAttribute('role','status');this.root.append(this.status);
  this.controls=el('nav','strategic-controls');for(const [name,fn] of [['Center fleet',()=>{const f=this.self();if(f){this.camera.x=f.x;this.camera.z=f.z;this.camera.zoom=1.6;}}],['Stop',()=>this.send('stop')],['−',()=>this.camera.zoom=Math.max(.65,this.camera.zoom/1.3)],['+',()=>this.camera.zoom=Math.min(4,this.camera.zoom*1.3)]]){const b=el('button','',name);b.onclick=fn;this.controls.append(b);}this.root.append(this.controls);
  this.canvas.addEventListener('pointerdown',e=>{this.drag={x:e.clientX,y:e.clientY,cx:this.camera.x,cz:this.camera.z,moved:false};this.canvas.setPointerCapture(e.pointerId);});
  this.canvas.addEventListener('pointermove',e=>{if(!this.drag)return;const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;if(Math.hypot(dx,dy)>5)this.drag.moved=true;if(this.drag.moved){this.camera.x=this.drag.cx-dx/this.scale;this.camera.z=this.drag.cz-dy/this.scale;}});
  this.canvas.addEventListener('pointerup',e=>{const d=this.drag;this.drag=null;if(d&&!d.moved)this.pick(e);});
  this.canvas.addEventListener('pointercancel',()=>this.drag=null);
  this.canvas.addEventListener('contextmenu',e=>e.preventDefault());
  this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.camera.zoom=Math.max(.65,Math.min(4,this.camera.zoom*Math.exp(-e.deltaY*.001)));},{passive:false});
 }
 self(){return this.view?.fleets.find(f=>f.id===this.view.self);}
 async show(){
  if(this.active)return;this.active=true;const generation=++this.generation;
  this.status.textContent='Connecting to the world…';this.view=null;this.selected=null;this.dialoguePort=null;this.character=this.options.character();this.offline=!this.options.signedIn();this.mode.textContent=this.offline?'Offline expedition · local save':'Shared realm';
  this.frame();
  try{await this.send('enter');if(this.generation!==generation)return;const f=this.self();if(f){this.camera.x=f.x+140;this.camera.z=f.z;this.camera.zoom=1.3;}}catch{}
  if(this.generation===generation)this.timer=setInterval(()=>{if(!this.busy)this.send(this.view?'snapshot':'enter');},2000);
 }
 hide(){this.active=false;this.generation++;clearInterval(this.timer);cancelAnimationFrame(this.raf);}
 async send(action,target=null){
  if(this.busy||!this.character)return null;this.busy=true;const generation=this.generation;
  try{
   let response;
   if(this.offline){
    const key=`zillions-world-v1:${this.character.id}`;const now=Date.now();let state=await readLocalWorld(key);const before=state;let cost=0;
    if(state && state.v!==1)throw new Error('world_save_invalid');
    if(!state)state=newWorld(now);
    if(action==='enter')state=joinWorld(state,{actor:'offline',character:this.character.id,name:this.character.name},now);
    let result={};
    if(action!=='enter'){
     const next=commandWorld(state,{actor:'offline',character:this.character.id,action,target,now,campaignCleared:this.options.cleared()});
     cost=next.charge;state=next.state;result=next.result;

    }
    const saved=await commitLocalWorld(key,state,{charge:cost,beforeState:before});response={ok:true,...result,balance:saved.balance,world:worldView(state,'offline',this.character.id)};
   }else response=await worldRequest(action,{characterId:this.character.id,requestId:crypto.randomUUID(),target,...(action==='resolve'?{encounter:this.view?.encounter?.id}:{})});
   if(generation!==this.generation)return response;
   this.status.classList.remove('error');
   this.view=response.world;this.received=performance.now();this.balance=response.balance;
   const f=this.self();this.status.textContent=f?.encounter?'Fleet encounter · choose your next move':f?.target?'Under way · click a destination to change course':'Click to travel · drag to look around · scroll to zoom';
   this.resources.textContent=`Alloy ${this.balance??0}  ·  Troops ${f?.troops||0}`;
   if(this.view.encounter)this.selected={type:'encounter',id:this.view.encounter.id};
   if(!this.dialoguePort)this.renderPanel();return response;
  }catch(e){if(generation!==this.generation)return null;this.status.textContent=friendly[e.message]||'The world could not be updated. Your last confirmed position is kept.';this.status.classList.add('error');return null;}
  finally{this.busy=false;}
 }
 position(f){
  if(!f.target||f.encounter)return f;
  const dt=Math.min(2,Math.max(0,(performance.now()-this.received)/1000)),d=Math.hypot(f.target.x-f.x,f.target.z-f.z),r=Math.min(1,dt*f.speed/(d||1));
  return {...f,x:f.x+(f.target.x-f.x)*r,z:f.z+(f.target.z-f.z)*r};
 }
 point(p){return {x:this.width/2+(p.x-this.camera.x)*this.scale,y:this.height/2+(p.z-this.camera.z)*this.scale};}
 pick(e){
  if(!this.view)return;const box=this.canvas.getBoundingClientRect(),x=e.clientX-box.left,y=e.clientY-box.top;
  const fleet=this.view.fleets.find(f=>{const p=this.point(this.position(f));return Math.hypot(x-p.x,y-p.y)<20;});
  const p=this.view.ports.find(p=>{const at=this.point(p);return Math.hypot(x-at.x,y-at.y)<34;});
  if(fleet&&!fleet.mine)this.selected={type:'fleet',id:fleet.id};
  else if(p)this.selected={type:'port',id:p.id};
  else{this.selected=null;this.send('move',{x:Math.max(0,Math.min(1000,this.camera.x+(x-this.width/2)/this.scale)),z:Math.max(0,Math.min(700,this.camera.z+(y-this.height/2)/this.scale))});}
  this.renderPanel();
 }
 button(label,fn,disabled=false){const b=el('button','',label);b.disabled=disabled;b.onclick=fn;this.panel.append(b);return b;}
 renderPanel(){
  this.dialoguePort=null;this.panel.replaceChildren();this.panel.classList.toggle('hidden',!this.selected);if(!this.selected)return;
  const close=el('button','strategic-close','Close');close.onclick=()=>{this.selected=null;this.renderPanel();};this.panel.append(close);
  const me=this.self();if(!me)return;
  if(this.selected.type==='port'){
   const p=this.view.ports.find(p=>p.id===this.selected.id);if(!p)return;
   this.panel.append(el('small','',p.role),el('h2','',p.name));
   const arrived=!me.target&&Math.hypot(me.x-p.x,me.z-p.z)<=WORLD_LIMITS.portRadius;
   this.panel.append(el('p','',arrived?'Your fleet is in orbit.':`${Math.round(Math.hypot(me.x-p.x,me.z-p.z))} navigation units away`));
   if(!arrived)this.button(`Travel to ${p.name}`,()=>this.send('move',{x:p.x,z:p.z}));
   else{
    this.button('Trade equipment',()=>this.options.onTrade(p));
    this.button('Recruit soldier · 12 Alloy',()=>this.send('recruit'),me.troops>=40||this.balance<12);
    this.button('Speak to the port commander',()=>this.dialogue(p));
    this.button('Launch siege',async()=>{await this.send('siege');},p.level>this.options.cleared()+1);
   }
  }else if(this.selected.type==='fleet'){
   const f=this.view.fleets.find(f=>f.id===this.selected.id);if(!f)return;
   this.panel.append(el('small','',f.kind==='player'?'Commander':`NPC · ${f.kind}`),el('h2','',f.name),el('p','',`${f.troops} troops · ${f.encounter?'In an encounter':f.target?'Under way':'Holding position'}`));
   if(f.encounter&&!this.offline)this.button('Join party encounter',async()=>{const r=await this.send('join',{encounter:f.encounter});if(r)this.renderPanel();});
   this.button('Approach fleet',()=>this.send('move',{x:f.x,z:f.z}));
   this.button(f.kind==='hostile'?'Intercept':'Hail fleet',async()=>{const r=await this.send('intercept',{id:f.id});if(r?.contact)this.panel.append(el('p','',f.kind==='trader'?'We carry supplies between the colonies. Keep clear of the Ash raiders in the eastern routes.':f.kind==='patrol'?'Our patrol watches the western colonies. Travel with us if you need cover.':'Use Friends to form a party with this commander.'));});
  }else{
   const e=this.view.encounter;if(!e){this.selected=null;this.panel.classList.add('hidden');return;}
   this.panel.append(el('small','',e.kind==='siege'?'PLANETARY ASSAULT':'FLEET CONTACT'),el('h2','',e.kind==='siege'?'Prepare the landing':'Hostile fleet'),el('p','',`${me.troops} troops ready. Other fleets continue travelling while you prepare.`));
   if(e.status==='pending'){
    if(!this.offline){
     if(e.room)this.button('Enter encounter room',()=>this.options.onCoop(e.level,e.id,me.troops,e.room));
     else if(e.participants[0]===me.id)this.button('Prepare with friends',()=>this.options.onCoop(e.level,e.id,me.troops,null));
    }
    if(e.participants.length===1&&!e.room)this.button('Prepare battle',async()=>{const r=await this.send('battle');if(r)this.options.onBattle(r.level,r.encounter,r.troops);});
    this.button('Withdraw',async()=>{const r=await this.send('retreat');if(r){this.selected=null;this.renderPanel();}});
   }else{
    if(this.options.savedEncounter?.()===e.id)this.button('Resume saved battle',()=>this.options.onResume());
    else this.button('Continue battle preparation',()=>this.options.onBattle(e.level,e.id,me.troops));
    if(!this.offline)this.button('Recover battle result',()=>this.send('resolve'));
    this.button('Abandon battle…',()=>{this.dialoguePort='confirm';this.panel.replaceChildren();this.panel.append(el('h2','','Withdraw to Greenfall?'),el('p','',`All ${me.troops} troops in this expedition will be lost. No battle rewards are granted by withdrawing.`));this.button('Confirm withdrawal',()=>{this.dialoguePort=null;this.send('surrender');});this.button('Keep fighting',()=>this.renderPanel());});
   }
  }
 }
 dialogue(p){
  this.dialoguePort=p.id;
  this.panel.replaceChildren();this.panel.append(el('small','',`${p.name} · Port commander`),el('h2','','Welcome, commander.'),el('p','','Our colonies need safe routes and a standing defense. What do you need?'));
  this.button('Tell me about this colony',()=>{this.panel.append(el('p','',`${p.name} is a ${p.role.toLowerCase()}. You can equip your commander and recruit soldiers here. The siege site is level ${p.level}.`));});
  this.button('Where is the fighting?',()=>{this.panel.append(el('p','','Ash raiders patrol the eastern routes. Your fleet can outrun them, avoid their route, or approach to engage. Planetary sieges begin from orbit.'));});
  this.button('Return to orbit',()=>{this.dialoguePort=null;this.renderPanel();});
 }
 frame(){
  if(!this.active)return;this.draw();this.raf=requestAnimationFrame(()=>this.frame());
 }
 draw(){
  const c=this.canvas,ctx=c.getContext('2d'),r=c.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1);
  this.width=r.width;this.height=r.height;this.scale=Math.min(r.width/1050,r.height/760)*this.camera.zoom;
  if(c.width!==Math.round(r.width*dpr)||c.height!==Math.round(r.height*dpr)){c.width=Math.round(r.width*dpr);c.height=Math.round(r.height*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#07111c';ctx.fillRect(0,0,r.width,r.height);
  const glow=ctx.createRadialGradient(r.width*.65,r.height*.3,0,r.width*.65,r.height*.3,r.width*.7);glow.addColorStop(0,'#17364c');glow.addColorStop(1,'#050c16');ctx.fillStyle=glow;ctx.fillRect(0,0,r.width,r.height);
  for(let i=0;i<400;i++){const x=((i*7919%10000)/10000*r.width-this.camera.x*.03+r.width)%r.width,y=((i*3571%10000)/10000*r.height-this.camera.z*.03+r.height)%r.height;ctx.fillStyle=i%7?'#7892a977':'#e2f2ff';ctx.fillRect(x,y,i%7?1:1.6,i%7?1:1.6);}
  if(!this.view)return;
  // Travel lanes provide scale and readable routes; they are not movement rails.
  ctx.strokeStyle='#9dbdd21a';ctx.setLineDash([3,9]);ctx.beginPath();for(let i=1;i<WORLD_PORTS.length;i++){const a=this.point(WORLD_PORTS[i-1]),b=this.point(WORLD_PORTS[i]);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}ctx.stroke();ctx.setLineDash([]);
  const self=this.self();if(self?.target){const a=this.point(this.position(self)),b=this.point(self.target);ctx.strokeStyle='#e3c88688';ctx.setLineDash([6,6]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);ctx.strokeRect(b.x-4,b.y-4,8,8);}
  const labels=[],obstacles=[];
  for(const p of this.view.ports){
   const at=this.point(p),radius=Math.max(13,24*this.scale);drawPlanet(ctx,p,at,radius);
   ctx.font='600 13px system-ui';labels.push({id:p.id,text:p.name,kind:'port',x:at.x,y:at.y,width:ctx.measureText(p.name).width+16,priority:80,gap:radius+10});
   obstacles.push({x:at.x-radius,y:at.y-radius,width:radius*2,height:radius*2});
  }
  for(const f of this.view.fleets){
   const at=this.point(this.position(f)),selected=this.selected?.id===f.id,color=f.mine?'#f5d58b':f.kind==='hostile'?'#ef7867':f.kind==='player'?'#b1a7f5':f.kind==='patrol'?'#88b4f2':'#7fc9b6';
   drawFleet(ctx,{...f,selected},at,color);
   const text=`${f.name} · ${f.troops}${f.kind==='player'&&!f.online?' · offline':''}`;ctx.font='12px system-ui';
   labels.push({id:f.id,text,x:at.x,y:at.y,color,width:ctx.measureText(text).width+16,priority:f.mine?100:selected?90:10,mine:f.mine});
   obstacles.push({x:at.x-18,y:at.y-18,width:36,height:36});
  }
  drawWorldLabels(ctx,layoutWorldLabels(labels,{width:r.width,height:r.height,obstacles}));
 }
}

export async function settleLocalEncounter(world,outcome){
 if(!world?.characterId)return;const key=`zillions-world-v1:${world.characterId}`;const state=await readLocalWorld(key);if(!state)return;
 const next=settleWorldBattle(state,{actor:'offline',character:world.characterId,encounter:world.encounter,...outcome,now:Date.now()});
 await commitLocalWorld(key,next,{beforeState:state});
}

export async function reserveLocalEncounter(world){
 const key=`zillions-world-v1:${world.characterId}`;const before=await readLocalWorld(key);const state=structuredClone(before);
 const e=state?.encounters.find(e=>e.id===world.encounter);if(!e||!['pending','battle'].includes(e.status))throw new Error('encounter_not_found');
 e.status='battle';e.startedAt=Date.now();await commitLocalWorld(key,state,{beforeState:before});
}
