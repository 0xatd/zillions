import test from 'node:test';
import assert from 'node:assert/strict';
import {LOBBY_PROTOCOL_VERSION, roomCompatibility} from '../src/online.js';
test('siege/culture release refuses rooms from the previous production simulation', () => {
 for(const protocolVersion of [5,7,11,12,13,14,15]) assert.equal(roomCompatibility({metadata:{protocolVersion}}).compatible,false);
 assert.equal(roomCompatibility({metadata:{protocolVersion:LOBBY_PROTOCOL_VERSION}}).compatible,true);
});
