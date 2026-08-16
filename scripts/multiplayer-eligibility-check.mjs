import assert from 'node:assert/strict';
import { highestUnlockedLevel, roomLevelEligibility } from '../src/multiplayer-eligibility.js';

assert.equal(highestUnlockedLevel(0), 1);
assert.equal(highestUnlockedLevel(4), 5);

const game = {
  mode: 'campaign',
  level: 5,
  _players: [
    { user_id: 'host', display_name: 'host', unlocked_level: 5 },
    { user_id: 'guest', display_name: 'friend', unlocked_level: 2 },
  ],
};
assert.deepEqual(roomLevelEligibility(game), {
  eligible: false,
  level: 5,
  blockers: [{ userId: 'guest', name: 'friend', unlockedLevel: 2 }],
});
assert.equal(roomLevelEligibility({ ...game, level: 2 }).eligible, true);
assert.equal(roomLevelEligibility({ ...game, mode: 'survival' }).eligible, true);

console.log('Multiplayer level eligibility check passed.');
