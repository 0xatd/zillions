import assert from 'node:assert/strict';
import {newWorld,joinWorld,commandWorld,ownedFleet,settleWorldBattle} from '../src/strategic-world.js';
export async function checkStrategicWorld(q){
 const actor='7359ac11-993e-4777-8777-777777777777',other='845dff12-a74e-4888-8888-888888888888';
 await q("insert into auth.users(id,email,raw_user_meta_data) values($1,'world-a@example.test','{\"display_name\":\"worlda\"}'),($2,'world-b@example.test','{\"display_name\":\"worldb\"}')",[actor,other]);
 const character=(await q("insert into game_characters(user_id,client_character_id,name,class_key,race_key) values($1,'world-test','World Pilot','vanguard','human') returning id",[actor])).rows[0].id;
 await q('insert into player_wallets(user_id,salvage_alloy) values($1,100) on conflict(user_id) do update set salvage_alloy=100',[actor]);
 let state=joinWorld(newWorld(0),{actor,character,name:'World Pilot'},0);
 const commit=(revision,s=state,charge=0,id=null,who=actor)=>q('select strategic_commit($1,$2,$3,$4,$5,$6,$7) r',[who,character,revision,s,id,charge,{ok:true}]).then(r=>r.rows[0].r);
 const first=await commit(0);assert.equal(first.revision,1);
 state=commandWorld(state,{actor,character,action:'recruit',now:0}).state;
 const second=await commit(1,state,12,'recruit-once');assert.equal(second.balance,88);
 const repeat=await commit(1,state,12,'recruit-once');assert.equal(repeat.duplicate,true);assert.equal(repeat.balance,88);
 await assert.rejects(commit(1,state,12,'stale-request'),/world_revision_conflict/);
 assert.equal(Number((await q('select salvage_alloy from player_wallets where user_id=$1',[actor])).rows[0].salvage_alloy),88);
 await assert.rejects(commit(2,state,0,'wrong-owner',other),/unauthorized_ownership/);
 await assert.rejects(commit(2,state,100,'too-expensive'),/insufficient_alloy/);
 assert.equal(Number((await q("select revision from strategic_realms where id='sol-frontier'")).rows[0].revision),2);
 await assert.rejects(commit(2,null,0,'null-state'),/invalid_world_state/);
 await assert.rejects(commit(2,state,-12,'negative-debit'),/invalid_charge/);
 state=commandWorld(state,{actor,character,action:'siege',now:0}).state;
 state=commandWorld(state,{actor,character,action:'battle',now:0}).state;
 await commit(2,state,0,'start-battle');
 const ticket=(await q("select issue_match_ticket($1,'world-test',1,'campaign','normal',7,null,3600) t",[actor])).rows[0].t;
 const linked=(await q("select strategic_link_match($1,'world-test','encounter-1',$2) r",[actor,ticket.id])).rows[0].r;
 assert.equal(linked.troops,5);
 await assert.rejects(q("select strategic_link_match($1,'world-test','wrong-encounter',$2)",[actor,ticket.id]),/encounter_not_started/);
 await q('set role authenticated');
 try{await assert.rejects(q('select * from strategic_realms'),/permission denied/);await assert.rejects(commit(3),/permission denied/);}finally{await q('reset role');}
 // Two authenticated characters join one encounter, then bind actual room
 // seats and independently issued tickets to a frozen ordered army.
 const otherCharacter=(await q("insert into game_characters(user_id,client_character_id,name,class_key,race_key) values($1,'world-other','Other Pilot','vanguard','human') returning id",[other])).rows[0].id;
 const now=Date.now();state=joinWorld(newWorld(now),{actor,character,name:'World Pilot'},now);state.nextEncounter=10;
 state=joinWorld(state,{actor:other,character:otherCharacter,name:'Other Pilot'},now);
 ownedFleet(state,actor,character).troops=5;ownedFleet(state,other,otherCharacter).troops=7;
 state=commandWorld(state,{actor,character,action:'siege',now}).state;
 state=commandWorld(state,{actor:other,character:otherCharacter,action:'join',target:{encounter:'encounter-10'},allies:[actor],now}).state;
 const current=()=>q("select state,revision from strategic_realms where id='sol-frontier'").then(r=>r.rows[0]);
 const save=async()=>commit((await current()).revision,state);
 await save();
 const solo=(await q("select issue_match_ticket($1,'world-test',1,'campaign','normal',7,null,3600) t",[actor])).rows[0].t;
 await assert.rejects(q("select strategic_link_match($1,'world-test','encounter-10',$2)",[actor,solo.id]),/encounter_room_required/);
 const room=(await q("insert into rooms(host_user_id,name,status,metadata) values($1,'World encounter test','in_game','{\"level\":1,\"mode\":\"campaign\"}') returning id,code",[actor])).rows[0];
 await q("insert into room_players(room_id,user_id,seat,display_name,hero,ready) values($1,$2,1,'worlda','scott',true),($1,$3,2,'worldb','alexander',true)",[room.id,actor,other]);
 const roomContext={id:room.id,code:room.code,host:actor,level:1,mode:'campaign',members:[actor,other]};
 state=commandWorld(state,{actor,character,action:'room',target:{id:room.id,actors:[actor]},room:roomContext,now}).state;await save();
 const ownTicket=(await q("select issue_match_ticket($1,'world-test',1,'campaign','normal',77,$2,3600) t",[actor,room.id])).rows[0].t;
 await assert.rejects(q("select strategic_link_match($1,'world-test','encounter-10',$2)",[actor,ownTicket.id]),/encounter_member_missing/);
 state=commandWorld(state,{actor,character,action:'room',target:{id:room.id,actors:[actor,other]},room:roomContext,now}).state;await save();
 await assert.rejects(q("select strategic_link_match($1,'world-test','encounter-10',$2)",[actor,solo.id]),/ticket_mismatch/);
 const ownLink=(await q("select strategic_link_match($1,'world-test','encounter-10',$2) r",[actor,ownTicket.id])).rows[0].r;
 assert.deepEqual(ownLink.army,[5,7]);assert.equal(ownLink.troops,5);
 const otherTicket=(await q("select issue_match_ticket($1,'world-other',1,'campaign','normal',77,$2,3600) t",[other,room.id])).rows[0].t;
 const otherLink=(await q("select strategic_link_match($1,'world-other','encounter-10',$2) r",[other,otherTicket.id])).rows[0].r;
 assert.deepEqual(otherLink.army,[5,7]);assert.equal(otherLink.troops,7);assert.notEqual(ownLink.ticket.id,otherLink.ticket.id);
 const repeatLink=(await q("select strategic_link_match($1,'world-test','encounter-10',$2) r",[actor,ownTicket.id])).rows[0].r;
 assert.equal(repeatLink.ticket.id,ownLink.ticket.id);assert.deepEqual(repeatLink.army,[5,7]);
 await q('update match_tickets set used_at=now() where id=$1',[ownTicket.id]);
 await assert.rejects(q("select strategic_link_match($1,'world-test','encounter-10',$2)",[actor,ownTicket.id]),/battle_report_already_accepted/);
 // Settlement below exercises the pure accepted-report reducer over the
 // actual database-produced reservation, not a simulated reward payout.
 state=(await current()).state;
 state=settleWorldBattle(state,{actor,character,encounter:'encounter-10',won:true,troopsLost:2,now:Date.now()});await save();
 assert.equal(ownedFleet(state,actor,character).troops,3);assert.equal(ownedFleet(state,other,otherCharacter).encounter,'encounter-10');
 state=settleWorldBattle(state,{actor:other,character:otherCharacter,encounter:'encounter-10',won:true,troopsLost:1,now:Date.now()});await save();
 assert.equal(ownedFleet(state,other,otherCharacter).troops,6);assert.equal(ownedFleet(state,other,otherCharacter).encounter,null);
 state=settleWorldBattle(state,{actor,character,encounter:'encounter-10',won:true,troopsLost:2,now:Date.now()});assert.equal(ownedFleet(state,actor,character).troops,3);
 console.log('strategic world database checks passed: ownership, CAS, idempotence, atomic debit, RLS, two-account encounter/room ticket binding, frozen shared armies, used-ticket rejection and independent settlement');
}
