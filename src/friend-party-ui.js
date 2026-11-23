import {partyLink} from './friend-party.js';
// A small modal over the chapter, not another competing account home.
export function showFriendParty({client,userId,code='',hostRoom,joinRoom,onJoined=()=>{}}) {
 document.querySelector('#friend-party-dialog')?.close();
 const panel=document.createElement('dialog');panel.id='friend-party-dialog';panel.className='friend-party-dialog';
 panel.innerHTML='<header><h2>Play with friends</h2><button type="button" data-close aria-label="Close party">✕</button></header><p class="party-status" role="status">Loading your party…</p><div class="party-body"></div>';
 document.body.append(panel);const status=panel.querySelector('.party-status'),body=panel.querySelector('.party-body');
 let party=null,busy=false,timer=null,closed=false,generation=0;
 const node=(tag,text,className='')=>{const el=document.createElement(tag);el.textContent=text;el.className=className;return el;};
 const button=(text,fn)=>{const b=node('button',text,'menubtn');b.type='button';b.disabled=busy;b.onclick=()=>run(fn);return b;};
 const run=async(fn)=>{
  if(busy||closed)return;busy=true;generation++;body.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Updating…';
  try{await fn();if(!closed){party=await client.refresh();status.textContent='';draw();}}
  catch(e){if(!closed)status.textContent=e.message||'Could not update the party. Retry.';}
  finally{busy=false;if(!closed)body.querySelectorAll('button').forEach(b=>b.disabled=false);}
 };
 function draw(){
  body.replaceChildren();
  if(!party){
   body.append(button('CREATE PARTY',async()=>{party=await client.act('create');}));
   const form=document.createElement('form'),label=node('label','Party code'),input=document.createElement('input');
   input.name='party-code';input.maxLength=10;input.autocomplete='off';input.placeholder='10-character code';input.value=code;
   label.append(input);const join=node('button','JOIN PARTY','menubtn');join.type='submit';form.append(label,join);
   form.onsubmit=e=>{e.preventDefault();const raw=input.value.trim().toUpperCase();run(async()=>{party=await client.act('join',{code:raw});code='';onJoined();});};
   body.append(form);return;
  }
  const isLeader=party.leaderId===userId;
  const roster=document.createElement('ul');roster.className='party-roster';
  for(const member of party.members){
   const row=node('li',''),name=node('span',`@${member.name}${member.id===party.leaderId?' · Leader':''}${member.id===userId?' · You':''}`);row.append(name);
   if(isLeader&&member.id!==userId){
    const menu=node('details','','party-member-actions');menu.append(node('summary','Manage'),button('Make leader',()=>client.act('lead',{user:member.id})),button('Remove',()=>client.act('kick',{user:member.id})));row.append(menu);
   }roster.append(row);
  }body.append(roster);
  const invite=node('div','','party-invite'),link=document.createElement('input');link.readOnly=true;link.value=partyLink(location.origin,party.code);link.setAttribute('aria-label','Party invite link');
  invite.append(node('strong',`Code: ${party.code}`),link,button('COPY INVITE',async()=>{await navigator.clipboard.writeText(link.value);}));body.append(invite);
  const actions=node('div','','party-actions');
  if(party.room){
   actions.append(node('p',party.room.status==='open'?'Your party’s room is open. Ready up there.':'Your party is in a match. Existing players can reconnect.'));
   actions.append(button('OPEN PARTY ROOM',async()=>{await joinRoom(party.room);panel.close();}));
  }else if(isLeader){actions.append(button('HOST NEXT MATCH',async()=>{await hostRoom(client);panel.close();}));}
  else actions.append(node('p','Waiting for the leader to open the next match.'));
  actions.append(button('LEAVE PARTY',()=>client.act('leave')));body.append(actions);
  body.append(node('small','Your selected chapter leader joins the room. Parties stay together between matches.'));
 }
 async function refresh(){
  if(closed||busy||document.hidden)return;
  const request=generation;
  try{const next=await client.refresh();if(closed||busy||request!==generation)return;const changed=JSON.stringify(next)!==JSON.stringify(party);party=next;status.textContent='';if(changed||!body.childNodes.length)draw();}
  catch(e){if(!closed)status.textContent=e.message||'Connection lost. Retrying…';}
 }
 panel.querySelector('[data-close]').onclick=()=>panel.close();
 panel.addEventListener('close',()=>{closed=true;clearInterval(timer);panel.remove();},{once:true});
 panel.showModal();refresh();timer=setInterval(refresh,3000);return panel;
}
