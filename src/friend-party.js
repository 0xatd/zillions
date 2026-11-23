// Persistent coordination only. No hero catalog or reward/Ready state here:
// the selected chapter leader and existing room remain authoritative.
export function partyCode(search) {
 const code=new URLSearchParams(search).get('party');
 return code && /^[a-z0-9]{10}$/i.test(code) ? code.toUpperCase() : null;
}
export function partyLink(origin,code) {
 if(!/^[A-Z0-9]{10}$/.test(code))throw new Error('Invalid party code.');
 return `${origin}/?party=${code}`;
}
export function partyError(error) {
 const raw=String(error?.message||error||'');
 const messages={party_full:'That party is full (four players).',party_not_found:'That party is no longer available.',
 leave_current_party:'Leave your current party before joining another.',leader_only:'Only the party leader can do that.',
 invalid_party_code:'Enter the ten-character party code.',invalid_member:'That member is no longer available.',
 invalid_room:'Open a new private room before sharing it with your party.',sign_in_required:'Sign in to use parties.'};
 for(const [key,message]of Object.entries(messages))if(raw.includes(key))return message;
 if(/schema cache|does not exist|could not find.*function/i.test(raw))return 'Parties are temporarily unavailable. Existing rooms still work.';
 return 'Party update failed. Check your connection and retry.';
}
async function bounded(request) {
 let timer;
 try{return await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Party update timed out. Retry when your connection recovers.')),10000);})]);}
 finally{clearTimeout(timer);}
}
export class FriendParty {
 constructor(client){this.client=client;}
 async refresh(){const {data,error}=await bounded(this.client.rpc('friend_party_snapshot'));if(error)throw new Error(partyError(error));return data;}
 async act(action,{code=null,room=null,user=null}={}) {
  const {data,error}=await bounded(this.client.rpc('friend_party_action',{p_action:action,p_code:code,p_room:room,p_user:user}));
  if(error)throw new Error(partyError(error));return data;
 }
}
