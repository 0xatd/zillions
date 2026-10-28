// The match report a finished siege produces — built from a Game.
//
// Pure and headless: the browser calls it when a signed-in match ends, and the
// leaderboard verifier (src/match-replay.js verifyReplay) calls the SAME
// function on its own replayed Game, so a replay and a client claim are
// compared field for field.
import { PACK_SLOTS } from './config.js';

export const MATCH_REPORT_VERSION = 1;

export function buildMatchReport(game, { won = game?.won, heroIndex = 0, heroKey = null } = {}) {
  const g = game || {};
  const s = g.stats || {};
  const h = (g.heroes || [])[heroIndex] || null;
  const hq = (g.plots || []).find((plot) => plot.kind === 'hq');
  let standing = 0;
  for (const b of g.buildings || []) if (b.alive && b.kind !== 'wall') standing++;
  return {
    version: MATCH_REPORT_VERSION,
    mode: g.mode || 'campaign',
    levelId: g.levelId,
    difficulty: g.diffKey || 'normal',
    won: !!won,
    durationSeconds: Math.round(g.time || 0),
    threatLevel: g.threatLevel | 0,
    kills: s.kills | 0, coins: Math.floor(s.coins || 0), nests: s.nests | 0, nodes: s.nodes | 0,
    built: s.built | 0, lost: s.lost | 0, bestHeld: s.bestHeld | 0, heroDeaths: s.heroDeaths | 0,
    bossKillT: s.bossKillT == null ? null : Number(s.bossKillT),
    hqTier: hq?.tier | 0,
    standingBuildings: standing,
    pack: [...new Set(h?.pack || [])].slice(0, PACK_SLOTS),
    hero: h?.key || heroKey || null,
  };
}
