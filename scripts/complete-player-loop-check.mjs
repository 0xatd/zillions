import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveStrategicConsequences } from '../src/living-world-battle.js';
import './living-world-battle-outbox-check.mjs';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
assert.match(ui, /data-travel="travel"/, 'normal travel must be an explicit choice');
assert.match(ui, /data-travel="fast"/, 'fast travel must be an explicit choice');
assert.match(ui, /data-trade="buy"[\s\S]*data-trade="sell"/, 'market exposes buy and sell actions');
assert.match(ui, /setInterval\([^\n]+onLivingWorldViewport/, 'open strategic map must poll authoritative movement');
assert.match(main, /type: 'trade_market'/, 'market UI must reach the authority command');
assert.match(main, /deliverBattleOutbox/, 'verified battle replay must use the durable tested outbox');
const attacker = '10000000-0000-4000-8000-000000000001', defender = '10000000-0000-4000-8000-000000000002';
const army = '20000000-0000-4000-8000-000000000002', stack = '30000000-0000-4000-8000-000000000002';
const result = deriveStrategicConsequences({ attackerPartyId: attacker, defenderPartyId: defender, armies: [{ id: army, party_id: defender }], stacks: [{ id: stack, army_id: army, unit_key: 'militia', tier: 1, healthy: 30 }], cargo: [{ party_id: defender, commodity_key: 'grain', quantity: 20, reserved_quantity: 0 }] }, attacker, [{ stackId: stack, killed: 3, wounded: 2 }]);
assert.ok(result.prisoners.length && result.cargoTransfers.length, 'victory produces reachable prisoner and cargo consequences');
console.log('complete player loop client contract passed');
