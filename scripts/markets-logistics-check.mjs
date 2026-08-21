import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { logisticsConsumption, marketPrice, resolveRaid } from '../src/living-world-logistics.js';

assert.equal(marketPrice(10, 0, 100, 'buy'), 17);
assert.equal(marketPrice(10, 100, 100, 'sell'), 8);
assert.deepEqual(logisticsConsumption({ troops: 100, moving: true, wounded: 5 }), { food: .15, medicine: .01, parts: .02 });
const raid = resolveRaid({ raidId: 'raid-1', tick: 12, attackerPower: 200, defenderPower: 50, cargo: 40 });
assert.deepEqual(raid, resolveRaid({ raidId: 'raid-1', tick: 12, attackerPower: 200, defenderPower: 50, cargo: 40 }));
assert.equal(raid.success, true); assert.ok(raid.stolen > 0 && raid.stolen <= 28);
const sql = readFileSync(new URL('../supabase/migrations/20260820223000_markets_logistics.sql', import.meta.url), 'utf8');
for (const marker of ['world_caravan_plans','world_raid_orders','world_logistics_ticks','create_world_raid','process_world_region_logistics','region_lease_required','idempotency_conflict','future_logistics_tick','target_stock','caravansProcessed','siege_state','world_company_members','fully_paid']) assert.match(sql, new RegExp(marker));
assert.match(sql, /primary key\(region_id,world_tick\)/); assert.match(sql, /order by resolve_tick,id for update/); assert.doesNotMatch(sql, /random\s*\(/i);
assert.match(sql, /world_markets set stock=stock-moved/,'caravan loading must conserve market stock');
assert.match(sql, /world_cargo set quantity=quantity-moved/,'caravan delivery must conserve cargo');
console.log('markets, caravans, raids, and logistics checks passed');
