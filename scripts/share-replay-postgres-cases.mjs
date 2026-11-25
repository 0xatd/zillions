import assert from 'node:assert/strict';
export async function checkSharedReplays(q, connect) {
 const actor='88888888-8888-4888-8888-888888888888', other='99999999-9999-4999-8999-999999999999';
 await q('insert into auth.users(id) values ($1),($2)',[actor,other]);
 const body={v:1,sim:1,mode:'campaign',seed:1,levelId:1,difficulty:'normal',culture:'european',leaders:['scott'],frames:30,hash:1,won:false,log:[]};
 let serial=0;
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ';const rid=()=> 'TEST'+alphabet[Math.floor(serial/400)%20]+alphabet[Math.floor(serial/20)%20]+alphabet[(serial++)%20]+'Z';
 const publish=(actor,ip,doc=body,board=false,digest=null,run=q)=>run('select publish_replay($1,$2,$3,$4,$5,$6,$7) r',[rid(),actor,ip,digest||serial.toString(16).padStart(64,'0'),JSON.stringify(doc).length,board,doc]).then(r=>r.rows[0].r);
 const ip='a'.repeat(64);
 const first=await publish(actor,ip,body,false,'1'.repeat(64));
 const dupe=await publish(actor,'b'.repeat(64),body,false,'1'.repeat(64));assert.equal(dupe.id,first.id);
 assert.equal((await q("select has_table_privilege('anon','replays','SELECT') s")).rows[0].s,false);
 assert.equal((await q("select has_table_privilege('authenticated','replays','INSERT') s")).rows[0].s,false);
 assert.equal((await q("select has_function_privilege('anon','publish_replay(text,uuid,text,text,integer,boolean,jsonb)','EXECUTE') s")).rows[0].s,false);
 assert.equal((await q("select has_table_privilege('service_role','replays','SELECT') s")).rows[0].s,true);
 // Eleven rows, then competing actors sharing an IP: only one gets slot 12.
 for(let i=0;i<10;i++)await publish(null,ip);
 const c1=await connect(),c2=await connect();try{
  const results=await Promise.allSettled([publish(actor,ip,body,false,null,c1.query.bind(c1)),publish(other,ip,body,false,null,c2.query.bind(c2))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/rate_limited/);
 }finally{await c1.end();await c2.end();}
 const count=Number((await q('select count(*) n from replays where user_id=$1',[other])).rows[0].n);
 for(let i=count;i<11;i++)await publish(other,(i+100).toString(16).padStart(64,'0'));
 const a=await connect(),b=await connect();try{
  const results=await Promise.allSettled([publish(other,'c'.repeat(64),body,false,null,a.query.bind(a)),publish(other,'d'.repeat(64),body,false,null,b.query.bind(b))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 }finally{await a.end();await b.end();}
 const daily={...body,mode:'daily',day:'2026-11-25',hash:5};
 const score=async(doc,n)=>q('select submit_daily_score($1,$2,1,$3,0,0,100,1,false,\'scott\',\'tester\',$4,$5)',[actor,doc.day,n,doc.hash,{frames:doc.frames,log:doc.log}]);
 await score(daily,1);const old=await publish(actor,'e'.repeat(64),daily,true,'e'.repeat(64));
 const newer={...daily,hash:6,frames:31};await score(newer,2);const next=await publish(actor,'e'.repeat(64),newer,true,'f'.repeat(64));assert.notEqual(old.id,next.id);
 assert.equal((await q('select body->>\'hash\' h from replays where id=$1',[old.id])).rows[0].h,'5');
 await assert.rejects(publish(actor,'e'.repeat(64),daily,true,'e'.repeat(64)),/stale_daily_replay/);
 assert.equal((await q('select id from replays where user_id=$1 and board',[actor])).rows[0].id,next.id);
 console.log('share replay Postgres: grants, dedupe, concurrent IP/account quotas, immutable URLs and stale-best rejection passed');
}
