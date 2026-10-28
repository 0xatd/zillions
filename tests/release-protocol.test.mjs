import test from 'node:test';
import assert from 'node:assert/strict';
import {LOBBY_PROTOCOL_VERSION, roomCompatibility} from '../src/online.js';
test('siege/culture release refuses rooms from the previous production simulation', () => {
 assert.equal(roomCompatibility({metadata:{protocolVersion:5}}).compatible,false);
 assert.equal(roomCompatibility({metadata:{protocolVersion:LOBBY_PROTOCOL_VERSION}}).compatible,true);
});
