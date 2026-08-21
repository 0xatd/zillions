import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLivingWorldPartyHandler, validatePartyBody } from '../api/living-world-party.js';
import { livingWorldProjectionToUi } from '../src/living-world-client.js';

const sql = readFileSync(new URL('../supabase/migrations/20260820214500_social_party_world_travel.sql', import.meta.url), 'utf8');
for (const marker of ['travel_mode','social_party_snapshot','create','leave','group_travel','party_not_assembled','expectedRevisions','for update loop']) assert.match(sql,new RegExp(marker),'missing party authority contract');
assert.match(sql,/world_parties wp on wp\.owner_user_id=m\.user_id[\s\S]*world_armies a on a\.party_id=wp\.id/,'party frames must use authoritative companies');
assert.match(sql,/order by wp\.id for update loop[\s\S]*insert into public\.world_movement_orders/,'group movement must lock every company before writes');
assert.match(sql,/travel_mode='grouped'/,'split members must be excluded from grouped movement');

const uuid = '8e604971-848f-4dc1-bfc6-8b29912d677e';
assert.throws(()=>validatePartyBody({requestId:'x',action:'group_travel',partyId:uuid,payload:{routeId:uuid,expectedRevisions:{victim:1}}}),/invalid_expected_revisions/);
assert.throws(()=>validatePartyBody({requestId:'x',action:'leave',partyId:uuid,payload:{actorId:'victim'}}),/unsupported_payload_field/);

const response=()=>({status:0,body:null,writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);},setHeader(){}});
const request=(method,body,auth='Bearer valid')=>({method,url:'/api/living-world-party',headers:{authorization:auth},async *[Symbol.asyncIterator](){if(body)yield Buffer.from(JSON.stringify(body));}});
const calls=[]; const handler=createLivingWorldPartyHandler({config:{url:'https://test.invalid',anonKey:'anon',serviceKey:'service'},authenticate:async(auth)=>auth==='Bearer valid'?{id:'actor-1'}:null,rateLimit:async()=>({allowed:true}),snapshot:async(actor)=>({id:'social-1',actor,members:[]}),command:async(actor,command)=>{calls.push({actor,command});return {ok:true};}});
let res=response(); await handler(request('GET'),res); assert.equal(res.body.party.actor,'actor-1');
res=response(); await handler(request('POST',{requestId:'leave-1',action:'leave',partyId:uuid,payload:{}}),res); assert.equal(calls[0].actor,'actor-1');
res=response(); await handler(request('POST',{requestId:'leave-2',action:'leave',partyId:uuid,payload:{},actorId:'victim'}),res); assert.equal(res.status,400);

const state=livingWorldProjectionToUi({shard:{id:'earth-1'},ownParties:[{id:uuid,revision:2}],locations:[]},{userId:'actor-1'}, {id:'social-1',name:'Wardens',members:[{id:'actor-1',name:'One',health:73,status:'Ready',companyStrength:44,location:'Greenfall',travelMode:'grouped'}],pendingInvites:[]});
assert.equal(state.party.members[0].companyStrength,44); assert.equal(state.party.members[0].self,true); assert.equal(state.party.socialPartyId,'social-1');
console.log('living-world-party-check: authority, API, frames and grouped/split contracts ✓');
