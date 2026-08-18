import assert from 'node:assert/strict';
import fs from 'node:fs';
import { authorized, eventPath, projectState } from '../api/galaxy-state.js';

const events = [
  { worldId: 'earth', outcome: 'failed', createdAt: '2026-01-01T00:00:00.000Z' },
  { worldId: 'frontier-6', outcome: 'liberated', createdAt: '2026-01-02T00:00:00.000Z' },
];
const state = projectState(events);
assert.equal(state.earth.owner, 'free', 'Earth must start free');
assert.equal(state['frontier-6'].owner, 'free', 'a valid liberation must project to free');
assert.equal(state['frontier-7'].owner, 'hive', 'untouched frontier worlds must remain Hive-held');

assert.equal(eventPath('battle-1'), eventPath('battle-1'), 'event keys must be deterministic');
assert.notEqual(eventPath('battle-1'), eventPath('battle-2'), 'different battles must not collide');
assert.match(eventPath('../../escape'), /^galaxy\/battles\/[a-f0-9]{64}\.json$/, 'battle ids must not control blob paths');

process.env.GALAXY_WRITE_SECRET = 'correct-horse';
assert.equal(authorized({ headers: { authorization: 'Bearer correct-horse' } }), true);
assert.equal(authorized({ headers: { authorization: 'Bearer wrong' } }), false);
assert.equal(authorized({ headers: {} }), false);
delete process.env.GALAXY_WRITE_SECRET;

const api = fs.readFileSync(new URL('../api/galaxy-state.js', import.meta.url), 'utf8');
assert.ok(api.includes('allowOverwrite: false'), 'battle events must be immutable');
assert.ok(api.includes('BODY_LIMIT'), 'request bodies must be bounded');
assert.ok(!api.includes('playerId'), 'the write boundary must not trust a client player id');

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
assert.ok(main.includes('await getGalaxyState()'), 'the live star map must read shared ownership');
assert.ok(ui.includes('ownership[destination.id]') && ui.includes('RECENT WAR CHANGES'), 'the map must render ownership and its event feed');

console.log('galaxy-state-check: secure event log and live map integration passed');
