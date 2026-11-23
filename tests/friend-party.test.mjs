import test from 'node:test';
import assert from 'node:assert/strict';
import {partyCode,partyLink,partyError,FriendParty} from '../src/friend-party.js';
test('invites round-trip their exact code; malformed and appended codes are rejected',()=>{
 const link=partyLink('https://zillions.taborlin.co','AB12CD34EF');
 assert.equal(partyCode(new URL(link).search),'AB12CD34EF');
 assert.equal(partyCode('?party=ab12cd34ef'),'AB12CD34EF');
 for(const code of ['','12345','AB12CD34EFextra','<script>','AB12-CD34EF'])assert.equal(partyCode('?party='+encodeURIComponent(code)),null);
 assert.throws(()=>partyLink('https://zillions.taborlin.co','<script>'));
});
test('unavailable party backend gives a recoverable player-facing message, not SQL internals',async()=>{
 const c=new FriendParty({rpc:async()=>({data:null,error:{message:'Could not find the function public.friend_party_snapshot in the schema cache'}})});
 await assert.rejects(c.refresh(),/temporarily unavailable.*Existing rooms still work/);
 assert.equal(partyError({message:'party_full'}),'That party is full (four players).');
 assert.equal(partyError({message:'internal secret-bearing database error'}),'Party update failed. Check your connection and retry.');
});
