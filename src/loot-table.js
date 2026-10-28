// The loot a match actually scatters, regenerated on the server.
//
// Game._scatterLoot() rolls every field item once, at match setup, from the
// match seed (Game opts.rngSeed), the level's map, the difficulty and the
// mode. The base, rarity and affix seed of a rolled key all come from that
// roll, so the only honest proof of a reported key is to run the same setup
// and see whether the key is on the ground.
//
// The scatter does not depend on the party (size, heroes, loadouts) or the
// culture; tests/match-rewards.test.mjs pins that, so a change that makes it
// party-dependent fails loudly instead of rejecting real co-op loot.
//
// Setup is pure: one terrain build plus one Game constructor (~150 ms on
// Node). Results are cached per (level, mode, difficulty, seed).
import { levelById, isLabyrinthLevel, DIFFICULTY } from './config.js';
import { Game } from './game.js';
import { TerrainField } from './terrain.js';
import { isRolledKey } from './items.js';

const CACHE_LIMIT = 64;
const cache = new Map();

export function scatteredLootKeys({ levelId, mode = 'campaign', difficulty = 'normal', seed, heroes = 'alexander' } = {}) {
  const level = levelById(levelId);
  if (!level || !Number.isInteger(seed) || !Object.hasOwn(DIFFICULTY, difficulty)) return new Set();
  if ((mode === 'labyrinth') !== isLabyrinthLevel(levelId)) return new Set();
  const id = `${levelId}|${mode}|${difficulty}|${seed >>> 0}|${JSON.stringify(heroes)}`;
  if (cache.has(id)) return cache.get(id);
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const game = new Game(map, difficulty, heroes, null, levelId, mode, { rngSeed: seed >>> 0 });
  const keys = new Set(game.loot.map((item) => item.key).filter(isRolledKey));
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(id, keys);
  return keys;
}
