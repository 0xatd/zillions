// Pure helpers for the signed-in match record a peer keeps from match start to
// result: what a host may share with guests, how a guest reads it, and the
// replay payload sent with the report. Split out of src/main.js so they can be
// tested without a browser.
import { REPLAY_VERSION } from './match-replay.js';
import { normalizeUpgradeIds } from './meta.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The match fields a host shares with its guests. Never the host's ticket.
export function sharedMatchFields(match) {
  if (!match) return null;
  const upgrades = normalizeUpgradeIds(match.upgrades);
  return {
    seed: match.seed ?? null, roomId: match.roomId || null, joinToken: match.joinToken || null,
    ...(upgrades.length ? { upgrades } : {}),
  };
}

// A guest's reading of the host's `start`/`resync` match fields. Anything
// malformed becomes null; the guest then simply has no co-op credit.
export function parseSharedMatch(raw) {
  return {
    seed: Number.isInteger(raw?.seed) ? raw.seed : null,
    roomId: typeof raw?.roomId === 'string' && UUID.test(raw.roomId) ? raw.roomId : null,
    joinToken: typeof raw?.joinToken === 'string' ? raw.joinToken.slice(0, 128) : null,
    upgrades: normalizeUpgradeIds(raw?.upgrades),
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
  // The Supply Line the sim actually used. Omitted when empty so a log from
  // before upgrades existed still replays against an unboosted treasury.
  const upgrades = normalizeUpgradeIds(match.upgrades);
  if (upgrades.length) out.upgrades = upgrades;
  return out;
}
