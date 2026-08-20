import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextAvailableRoomSeat } from '../src/online.js';

assert.equal(nextAvailableRoomSeat([{ seat: 1 }], 4), 2);
assert.equal(nextAvailableRoomSeat([{ seat: 1 }, { seat: 2 }, { seat: 3 }], 4), 4,
  'the fourth player must receive seat 4 instead of colliding with seat 3');
assert.equal(nextAvailableRoomSeat([{ seat: 1 }, { seat: 2 }, { seat: 3 }, { seat: 4 }], 4), null,
  'a full room must reject another player before writing a conflicting seat');
assert.equal(nextAvailableRoomSeat([{ seat: 1 }, { seat: 2 }, { seat: 3 }], 3), null,
  'legacy three-player rooms retain their advertised capacity');

const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260820020000_four_player_rooms.sql', import.meta.url), 'utf8');
assert.match(ui, /activateStart\(\)[\s\S]*this\.cb\.onStart\(this\.selectedDiff, this\.selectedHero\)/,
  'countdown completion must invoke launch even while its display button is disabled');
assert.match(ui, /if \(this\._startActivated\) return/,
  'duplicate countdown completion must not launch twice');
assert.match(main, /this\.ui\._startActivated = false;[\s\S]*for \(let count = 5/,
  'each accepted countdown must reset the one-shot launch guard');
for (const sql of [schema, migration]) {
  assert.match(sql, /max_players between 1 and 4/, 'database must admit the four seats shown by the UI');
  assert.match(sql, /seat between 1 and 4/, 'database must admit player seat 4');
}
assert.match(schema, /rooms_update_host[\s\S]*auth\.uid\(\) = host_user_id/);
assert.match(schema, /room_players_insert_self[\s\S]*auth\.uid\(\) = user_id/);
assert.match(schema, /room_players_update_self_or_host[\s\S]*auth\.uid\(\) = user_id[\s\S]*rooms\.host_user_id = auth\.uid\(\)/);

console.log('multiplayer lifecycle QA checks passed');
