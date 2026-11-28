// Pure helpers for the signed-in match record a peer keeps from match start to
// result: what a host may share with guests, how a guest reads it, and the
// replay payload sent with the report. Split out of src/main.js so they can be
// tested without a browser.
import { REPLAY_VERSION } from './match-replay.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The match fields a host shares with its guests. Never the host's ticket.
export function sharedMatchFields(match) {
  return match ? { seed: match.seed ?? null, roomId: match.roomId || null, joinToken: match.joinToken || null, ...(match.world ? {world:match.world} : {}) } : null;
}

// A guest's reading of the host's `start`/`resync` match fields. Anything
// malformed becomes null; the guest then simply has no co-op credit.
export function parseSharedMatch(raw) {
  return {
    ...(raw?.world && typeof raw.world.encounter==='string' && Array.isArray(raw.world.army) && raw.world.army.length<=4 && raw.world.army.every(n=>Number.isInteger(n)&&n>=0&&n<=40) ? {world:{encounter:raw.world.encounter.slice(0,96),army:raw.world.army,troops:raw.world.troops}} : {}),
    seed: Number.isInteger(raw?.seed) ? raw.seed : null,
    roomId: typeof raw?.roomId === 'string' && UUID.test(raw.roomId) ? raw.roomId : null,
    joinToken: typeof raw?.joinToken === 'string' ? raw.joinToken.slice(0, 128) : null,
  };
}

// The input log a leaderboard verifier can replay, or null when this game
// never recorded one.
export function matchReplayPayload(game, match, heroIndex) {
  if (!game?.inputLog || !match?.heroes) return null;
  const out = { v: REPLAY_VERSION, frames: game.steps, heroIndex, heroes: match.heroes, log: game.inputLog };
  // The base culture changes which army the camps muster; the replay must
  // run the same one. Omitted for the default so older payloads match.
  if (game.culture && game.culture !== 'european') out.culture = game.culture;
  if (game.worldArmy?.length) out.worldArmy = [...game.worldArmy];
  return out;
}
