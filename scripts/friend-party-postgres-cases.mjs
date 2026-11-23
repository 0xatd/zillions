import assert from 'node:assert/strict';
export async function checkFriendParties(q, connect) {
 const ids=Array.from({length:5},(_,i)=>`23232323-2323-2323-2323-${String(i+1).padStart(12,'0')}`);
 for(let i=0;i<ids.length;i++){
  await q('insert into auth.users(id,email) values($1,$2)',[ids[i],`private${i}@example.test`]);
  await q('update profiles set handle=$2 where id=$1',[ids[i],`party_test_${i}`]);
 }
 await q(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$`);
 const as=async(id,sql,args=[])=>{await q('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await q('set role authenticated');try{return await q(sql,args);}finally{await q('reset role');}};
 const act=(id,action,code=null,room=null,user=null)=>as(id,'select friend_party_action($1,$2,$3,$4) p',[action,code,room,user]).then(r=>r.rows[0].p);
 const snapshot=id=>as(id,'select friend_party_snapshot() p').then(r=>r.rows[0].p);
 let party=await act(ids[0],'create');const code=party.code;
 assert.equal((await act(ids[0],'create')).id,party.id,'create retry keeps one group');
 assert.equal(await snapshot(ids[1]),null,'outsider cannot read private group');
 await assert.rejects(as(ids[0],'select * from friend_parties'),/permission denied/);
 await assert.rejects(as(ids[0],"insert into friend_party_members(party_id,user_id) values($1,$2)",[party.id,ids[1]]),/permission denied/);
 for(const id of ids.slice(1,3))await act(id,'join',code);
 const contenders=await Promise.all(ids.slice(3).map(async id=>{
   const connection=await connect();
   try{
     await connection.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
     await connection.query('set role authenticated');
     const result=await connection.query("select friend_party_action('join',$1) p",[code]);
     return {id,ok:true,party:result.rows[0].p};
   }catch(error){return {id,ok:false,error:error.message};}
   finally{await connection.end();}
 }));
 assert.equal(contenders.filter(r=>r.ok).length,1,'only one concurrent join wins the last seat');
 assert.match(contenders.find(r=>!r.ok).error,/party_full/);
 // Normalize the winner for the following role/rotation checks.
 if(contenders.find(r=>r.ok).id===ids[4]){await act(ids[4],'leave');await act(ids[3],'join',code);}

 assert.equal((await act(ids[1],'join',code)).members.length,4,'join retry keeps one seat');
 await assert.rejects(act(ids[4],'join',code),/party_full/);
 await assert.rejects(act(ids[1],'kick',null,null,ids[0]),/leader_only/);
 await assert.rejects(act(ids[1],'room',null,'ffffffff-ffff-ffff-ffff-ffffffffffff'),/leader_only/);
 await assert.rejects(act(ids[0],'room',null,'ffffffff-ffff-ffff-ffff-ffffffffffff'),/invalid_room/);
 assert.ok(!JSON.stringify(await snapshot(ids[0])).includes('@example.test'),'public roster never exposes email');
 const room=(await q("insert into rooms(name,host_user_id,visibility,status,last_seen_at) values('Party QA',$1,'private','open',now()) returning id",[ids[0]])).rows[0].id;
 await act(ids[0],'room',null,room);
 assert.equal((await snapshot(ids[1])).room.id,room);
 await q("update rooms set status='finished' where id=$1",[room]);
 assert.equal((await snapshot(ids[1])).room,null,'finished match clears the next-match action');
 assert.equal((await snapshot(ids[1])).members.length,4,'match finish retains the group');
 party=await act(ids[0],'kick',null,null,ids[3]);assert.notEqual(party.code,code,'kick invalidates old invite');
 await assert.rejects(act(ids[3],'join',code),/party_not_found/);
 assert.equal(await snapshot(ids[3]),null,'removed user loses read access');
 await act(ids[3],'join',party.code);
 party=await act(ids[0],'lead',null,null,ids[1]);assert.equal(party.leaderId,ids[1]);assert.equal(party.room,null);
 await act(ids[1],'leave');party=await snapshot(ids[0]);assert.notEqual(party.leaderId,ids[1],'leader departure elects a remaining member');
 for(const id of [ids[0],ids[2],ids[3]])await act(id,'leave');
 assert.equal((await q('select count(*)::int n from friend_parties')).rows[0].n,0,'last departure removes group');
 await q("select set_config('request.jwt.claim.sub','',false)");
 await q('set role anon');try{await assert.rejects(q("select friend_party_action('create')"),/permission denied/);}finally{await q('reset role');}
 await q('delete from rooms where id=$1',[room]);
 for(const id of ids)await q('delete from auth.users where id=$1',[id]);
 console.log('friend-party-postgres: membership, permissions, capacity, invites, leader transfer and rematch persistence passed');
}
