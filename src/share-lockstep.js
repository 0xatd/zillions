// The host's window order, extracted so a two-peer siege can be checked
// without a browser. Every peer executes the same bundle, then the same tick.
// A gap is not skipped: callers feed the windows they already agreed on.

import { SIM_DT } from './config.js';
import { stateHash } from './lockstep-hash.js';

export const LOCKSTEP_WINDOW_TICKS = 2;

export function runLockstepPeers(games, { ticks, commandsForWindow }) {
  const hashes = [];
  for (let frame = 0; frame < ticks; frame++) {
    if (frame % LOCKSTEP_WINDOW_TICKS === 0) {
      const bundle = commandsForWindow(frame / LOCKSTEP_WINDOW_TICKS) || [];
      for (const game of games) {
        for (const command of bundle) game.exec(command);
      }
    }
    for (const game of games) game.update(SIM_DT);
    if (frame > 0 && frame % 30 === 0) hashes.push(games.map((game) => stateHash(game)));
  }
  const finalHash = stateHash(games[0]);
  return {
    hashes,
    agree: games.every((game) => stateHash(game) === finalHash),
    hash: finalHash,
  };
}
