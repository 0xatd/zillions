// Deterministic colony crew. Jobs use the existing plot actions and costs;
// only travel, prioritisation and the refundable construction escrow live here.
import {PLOT_KINDS, PAY_RADIUS, PAY_RATE, UPGRADE_PAY_RATE, SIEGE} from './config.js';
export const BUILDER_ORDERS = Object.freeze({maintain:'Maintain',develop:'Develop',expand:'Expand',fortify:'Fortify',prosper:'Prosper',mobilize:'Mobilize'});
const ECON = new Set(['house','farm','mill','mine']);
const MILITARY = k => k.startsWith('camp_');
export function createBuilders(g) {
 const h=g.heroes[0];
 return {order:'maintain',paused:true,reserve:10,x:h.x,z:h.z,hp:180,maxHp:180,job:null,route:[],paid:0,replan:0,recover:0,status:'Paused',frontier:null,branches:{tower:'ask',wall:'ask'},completed:0,spent:0};
}
function open(g,x,z) {const n=g.map.size;return x>=0&&z>=0&&x<n&&z<n&&g.map.isWalkable(x,z)&&(!g.occ[z*n+x]||g.gateIds.has(g.occ[z*n+x]));}
function cancel(g,b) {
 if(b.paid>0){g.gold+=b.paid;g.stats.spent-=b.paid;b.spent-=b.paid;}
 b.paid=0;b.job=null;b.route=[];
}
export function builderCommand(g,c) {
 if(c.p!==0||!g.heroes[0]||g.heroes[0].dead||g.mode==='labyrinth'||g.phase!=='live'||g.over)return;
 const b=g.builders;if(!b)return;
 if(c.t==='builderOrder'&&Object.hasOwn(BUILDER_ORDERS,c.s)){cancel(g,b);b.order=c.s;b.paused=false;b.replan=0;}
 if(c.t==='builderPause'&&typeof c.on==='boolean'){b.paused=c.on;if(c.on)cancel(g,b);b.replan=0;}
 if(c.t==='builderDoctrine'&&['tower','wall'].includes(c.kind)&&(['ask',...(c.kind==='tower'?['ballista','flame']:['shock','bastion'])].includes(c.branch))){cancel(g,b);b.branches[c.kind]=c.branch;b.replan=0;}
 if(c.t==='builderReserve'&&Number.isInteger(c.gold)&&c.gold>=0&&c.gold<=1000){b.reserve=c.gold;if(g.gold<b.reserve)cancel(g,b);}
}
function threat(g,x,z,r=7) {return g.zombies.some(e=>!e.dead&&e.hp>0&&Math.hypot(e.x-x,e.z-z)<r);}
function local(g,p) {const base=g.plots.find(q=>q.kind==='hq')?.plan?.perimeters?.find(q=>q.kind==='base');return base&&Math.hypot(p.cx-base.cx,p.cz-base.cz)<base.radius+2&&p.role!=='outer'&&p.outerDefense==null&&p.nodeId==null;}
function holdingKey(p){return p.keep?`fort:${p.keep.join(',')}`:p.nodeId!=null?`node:${p.nodeId}`:null;}
function established(g,p){
 if(p.nodeId!=null)return p.tier>0&&!p.ruined;
 if(!p.keep)return false;
 return g.plots.filter(q=>q.keep?.[0]===p.keep[0]&&q.keep?.[1]===p.keep[1]&&(q.kind==='wall'||q.outerDefense!=null)).every(q=>q.tier>0&&!q.ruined);
}
function frontierSafe(g,p) {
 if(p.nodeId!=null)return g.nodes[p.nodeId]?.owner==='player';
 return g.units.some(u=>!u.dead&&u.hp>0&&Math.hypot(u.x-p.cx,u.z-p.cz)<12);
}
function actionKey(p,a){return `${p.id}:${p.tier}:${a.mode}:${p.branch||''}`;}
// No automatic irreversible branch choice. The crew skips it and the UI
// reports that the player must choose a specialisation when no other job exists.
export function builderCandidates(g,b) {
 const choices=[];let branches=false;
 for(const p of g.plots){
  if(!g.firstSiegePlotActionable(p))continue;
  let a=g.plotAction(p);if(!a)continue;if(a.mode==='branch'){
   const branch=b.branches?.[p.kind],def=a.nt.options[branch];
   if(!def){branches=true;continue;}
   a={mode:'build',cost:def.cost,def,branch};
  }
  const inBase=local(g,p),inHolding=inBase||established(g,p),damage=a.mode==='repair'||a.mode==='rebuild';
  if(!inHolding&&!frontierSafe(g,p))continue;
  if(threat(g,p.cx,p.cz,5))continue;
  const hp=g.plotHpState(p),ratio=hp.hp/Math.max(1,hp.maxHp);
  const critical=damage&&(p.ruined||ratio<(p.kind==='hq'?.65:.35));
  if(a.mode==='repair'&&b.order!=='maintain'&&!critical&&hp.maxHp-hp.hp<Math.max(30,hp.maxHp*.15))continue;
  let score=0;
  if(damage)score=critical?1000:200;
  else {
   if(b.order==='maintain')continue;
   if(!inHolding&&b.order!=='expand')continue;
   if(b.order==='fortify'&&!['wall','tower','hq'].includes(p.kind))continue;
   if(b.order==='prosper'&&!ECON.has(p.kind)&&p.kind!=='hq')continue;
   if(b.order==='mobilize'&&!MILITARY(p.kind)&&p.kind!=='hq')continue;
   if(b.order==='expand'&&!inHolding){
    if(b.frontier&&holdingKey(p)!==b.frontier)continue;
    // Secure the selected road fort before its non-defensive structures.
    const keep=p.keep;const needsDefense=keep&&g.plots.some(q=>q.keep?.[0]===keep[0]&&q.keep?.[1]===keep[1]&&q.tier===0&&(q.kind==='wall'||q.outerDefense!=null));
    if(needsDefense&&p.kind!=='wall'&&p.outerDefense==null)continue;
    score=500+(p.kind==='wall'?60:p.outerDefense!=null?40:0);
   }else if(b.order==='expand')score=50;
   else if(b.order==='fortify')score=p.kind==='wall'?500:p.kind==='tower'?450:100;
   else if(b.order==='prosper')score=400+((a.def?.income||0)-(g.tierDef(p,p.tier)?.income||0))*100/Math.max(1,a.cost);
   else if(b.order==='mobilize')score=MILITARY(p.kind)?500:100;
   else {
    const econ=g.plots.filter(q=>ECON.has(q.kind)&&q.tier>0).length;
    const camps=g.plots.filter(q=>MILITARY(q.kind)&&q.tier>0).length;
    const towers=g.plots.filter(q=>q.kind==='tower'&&q.tier>0).length;
    // Start income, then a camp, then balanced development; don't build every
    // house before fielding the first squad.
    score=ECON.has(p.kind)?(econ===0?600:econ<3?390:250):MILITARY(p.kind)?(camps===0?550:camps<2?420:240):p.kind==='tower'?(towers===0?500:towers<3?380:230):p.kind==='wall'?150:100;
   }
  }
  score-=p.tier*45+Math.hypot(b.x-p.cx,b.z-p.cz)*.8+a.cost*.1;
  choices.push({p,a,score,key:actionKey(p,a),branch:a.branch});
 }
 choices.sort((a,c)=>c.score-a.score||a.p.id-c.p.id);
 return {choices,branches};
}
function routeTo(g,b,accept) {
 const n=g.map.size,start=(b.z|0)*n+(b.x|0),previous=new Int32Array(n*n).fill(-2),queue=new Int32Array(n*n);let head=0,tail=1,end=-1;
 queue[0]=start;previous[start]=-1;
 while(head<tail){const k=queue[head++],x=k%n,z=k/n|0;if(accept(x+.5,z+.5)){end=k;break;}
  for(const [dx,dz] of [[1,0],[0,1],[-1,0],[0,-1]]){const nx=x+dx,nz=z+dz,ni=nz*n+nx;if(!open(g,nx,nz)||previous[ni]!==-2)continue;previous[ni]=k;queue[tail++]=ni;}
 }
 if(end<0)return null;if(end===start)return [[start%n+.5,(start/n|0)+.5]];const path=[];for(let k=end;k!==start;k=previous[k])path.push([k%n+.5,(k/n|0)+.5]);return path.reverse();
}
function atWork(g,p,x,z){
 // Stay outside a purchased footprint so completing it cannot bury the crew.
 if(p.kind!=='wall'&&x>=p.x&&x<p.x+p.size&&z>=p.z&&z<p.z+p.size)return false;
 const [px,pz]=g.payPoint(p,{x,z});return Math.hypot(px-x,pz-z)<=Math.min(PAY_RADIUS-.2,2.2);
}
function walk(g,b,dt){
 while(b.route.length&&Math.hypot(b.route[0][0]-b.x,b.route[0][1]-b.z)<1e-6)b.route.shift();
 const target=b.route[0];if(!target)return;
 if(!open(g,target[0]|0,target[1]|0)){b.route=[];b.replan=0;return;}
 const dx=target[0]-b.x,dz=target[1]-b.z,d=Math.hypot(dx,dz),step=Math.min(d,3.4*dt);
 b.x+=dx/d*step;b.z+=dz/d*step;
}
export function updateBuilders(g,dt) {
 const b=g.builders;if(!b||g.mode==='labyrinth'||g.phase!=='live'||g.over)return;
 b.replan=Math.max(0,b.replan-dt);
 if(b.recover>0){b.recover=Math.max(0,b.recover-dt);b.status='Crew recovering';if(!b.recover){const seat=g._reseat(g.hq.cx,g.hq.cz,8);if(seat){[b.x,b.z]=seat;b.hp=b.maxHp;}else b.recover=2;}return;}
 // A crew caught in melee takes damage and returns to HQ after a recovery
 // delay. No permanent soft-lock and no free replacement gold reward.
 const attackers=g.zombies.filter(e=>!e.dead&&e.hp>0&&Math.hypot(e.x-b.x,e.z-b.z)<1.7);
 for(const e of attackers)b.hp-=Math.max(1,e.def?.dmg||5)*dt;
 if(b.hp<=0){cancel(g,b);b.hp=0;b.recover=25;b.status='Crew recovering';return;}
 if(threat(g,b.x,b.z)){
  if(b.job){cancel(g,b);b.replan=0;}b.status='Retreating';
  if(!b.route.length||b.replan===0){b.route=routeTo(g,b,(x,z)=>Math.hypot(x-g.hq.cx,z-g.hq.cz)<5&&!threat(g,x,z))||[];b.replan=2;}
  walk(g,b,dt);return;
 }
 if(b.paused){b.status='Paused';return;}
 if(b.hp<b.maxHp&&Math.hypot(b.x-g.hq.cx,b.z-g.hq.cz)<6)b.hp=Math.min(b.maxHp,b.hp+8*dt);
 const manuallyUsed=new Set(g.heroes.filter(h=>!h.dead&&h.payHold).map(h=>g.buildTargetFor(h)?.plot.id));
 if(b.frontier){const target=g.plots.find(p=>holdingKey(p)===b.frontier);if(!target||established(g,target)||!frontierSafe(g,target))b.frontier=null;}
 let p=b.job&&g.plots.find(p=>p.id===b.job.id),a=p&&g.plotAction(p);
 if(b.job&&(!a||actionKey(p,a)!==b.job.key||g.plotLocked(p)||(!local(g,p)&&!established(g,p)&&!frontierSafe(g,p))||manuallyUsed.has(p.id)||p.paid>0||threat(g,p.cx,p.cz,5))){cancel(g,b);b.replan=1;p=null;a=null;}
 // Reconsider discretionary work at a bounded cadence when a genuine
 // emergency appears; the interrupted purchase is completely refundable.
 if(b.job&&b.replan===0){
  const emergency=builderCandidates(g,b).choices.find(c=>c.score>800&&(c.a.mode==='repair'||c.a.mode==='rebuild'));
  if(emergency&&emergency.p.id!==b.job.id){cancel(g,b);p=null;a=null;}
  else b.replan=2;
 }
 if(!b.job&&b.replan===0){
  const {choices,branches}=builderCandidates(g,b);let poor=false,blocked=false;
  for(const c of choices.slice(0,20)){
   if(manuallyUsed.has(c.p.id)||c.p.paid>0)continue;
   if(g.gold-b.reserve<c.a.cost){poor=true;if(c.score>800)break;continue;}
   const route=routeTo(g,b,(x,z)=>atWork(g,c.p,x,z));if(route===null){blocked=true;continue;}
   if(route.some(([x,z])=>threat(g,x,z,4))){blocked=true;continue;}
   if(c.branch){c.p.branch=c.branch;c.a=g.plotAction(c.p);c.key=actionKey(c.p,c.a);}
   if(b.order==='expand'&&!local(g,c.p)&&!established(g,c.p))b.frontier=holdingKey(c.p);
   b.job={id:c.p.id,key:c.key,mode:c.a.mode,cost:c.a.cost};b.route=route;p=c.p;a=c.a;break;
  }
  b.replan=2;
  if(!b.job)b.status=poor?'Saving gold':blocked?'Route blocked':branches?'Choose a specialisation':'No eligible work';
 }
 if(!b.job)return;
 if(!atWork(g,p,b.x,b.z)){
  if(!b.route.length){b.route=routeTo(g,b,(x,z)=>atWork(g,p,x,z))||[];if(!b.route.length){cancel(g,b);b.status='Route blocked';b.replan=2;return;}}
  b.status='Travelling';walk(g,b,dt);return;
 }
 b.route=[];
 const rate=a.mode==='build'&&p.tier>0?UPGRADE_PAY_RATE:PAY_RATE;
 const need=a.mode==='repair'?a.cost:b.job.cost-b.paid;
 const pay=Math.min(rate*dt,Math.max(0,g.gold-b.reserve),need);
 if(pay<=0){b.status='Saving gold';return;}
 g.gold-=pay;g.stats.spent+=pay;b.spent+=pay;p.payFx=.3;
 b.status=a.mode==='repair'?'Repairing':a.mode==='rebuild'?'Rebuilding':p.tier?'Upgrading':'Building';
 if(a.mode==='repair'){
  g._repairPlot(p,pay*SIEGE.repairHpPerGold);g.stats.repaired+=pay;
  if(g.plotAction(p)?.mode!=='repair'){b.completed++;b.job=null;b.replan=1;}
 }else{
  b.paid+=pay;
  if(b.paid>=b.job.cost-1e-6){b.paid=0;if(a.mode==='rebuild')g._rebuildPlot(p);else g._construct(p);b.completed++;b.job=null;b.replan=1;}
 }
}
export function builderStatus(g){const b=g.builders;if(!b)return '';const p=b.job&&g.plots.find(p=>p.id===b.job.id);return p?`${b.status} ${PLOT_KINDS[p.kind]?.name||p.kind} · ${Math.ceil(Math.max(0,b.job.mode==='repair'?(g.plotAction(p)?.cost||0):b.job.cost-b.paid))} gold`:b.status;}
