import assert from 'node:assert/strict';
import { createLivingWorldEntryHandler } from '../api/living-world-entry.js';

function request(payload,method='POST') { return {method,headers:{authorization:'Bearer valid'},async *[Symbol.asyncIterator](){ yield Buffer.from(JSON.stringify(payload)); }}; }
function response(){ return {status:0,headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);},end(value){this.body=JSON.parse(value);}}; }
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const character='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let called;
let limited;
const handler=createLivingWorldEntryHandler({config:{url:'x',anonKey:'x',serviceKey:'x'},authenticate:async()=>({id:actor}),rateLimit:async(user,scope,limit,windowSeconds)=>{limited={user,scope,limit,windowSeconds};return {allowed:true};},complete:async()=>({ok:true}),enter:async(user,id)=>{called={user,id};return {ok:true,partyId:'party'};}});
let res=response(); await handler(request({characterId:character}),res);
assert.equal(res.status,200); assert.deepEqual(called,{user:actor,id:character});
assert.deepEqual(limited,{user:actor,scope:'world:entry',limit:6,windowSeconds:300});
res=response(); await handler(request({characterId:character,userId:actor}),res); assert.equal(res.status,400);
res=response(); await createLivingWorldEntryHandler({config:{url:'x',anonKey:'x',serviceKey:'x'},authenticate:async()=>null})(request({characterId:character}),res); assert.equal(res.status,401);
res=response(); await handler(request({},'GET'),res); assert.equal(res.status,405);
console.log('living world entry API check passed');
