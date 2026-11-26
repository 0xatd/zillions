import test from 'node:test';
import assert from 'node:assert/strict';
import {LOBBY_PROTOCOL_VERSION, roomCompatibility} from '../src/online.js';
import {SIM_VERSION} from '../src/share-replay.js';
test('opening-siege release refuses rooms from the previous production simulation', () => {
 for(const protocolVersion of [5,7,11,12,13,14,15,16,17,18,23]) assert.equal(roomCompatibility({metadata:{protocolVersion}}).compatible,false);
 assert.equal(LOBBY_PROTOCOL_VERSION >= 19, true);
 assert.equal(LOBBY_PROTOCOL_VERSION >= SIM_VERSION, true, 'lobby protocol must move with the simulation salt');
 assert.equal(roomCompatibility({metadata:{protocolVersion:LOBBY_PROTOCOL_VERSION}}).compatible,true);
 assert.equal(roomCompatibility({metadata:{protocolVersion:18}}).reason.includes('18'), true);
});
