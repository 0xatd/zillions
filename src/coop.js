// Co-op rules that both peers must share. Presentation (name markers) stays
// out of the simulation; pressure and revives do not.

export const PARTY_LIMIT = 4;
export const LABYRINTH_PARTY_LIMIT = 3;

// The siege roster. Keys match HEROES in config.js.
export const SIEGE_HEROES = Object.freeze([
  'scott', 'alexander', 'danny', 'turtle', 'john', 'tiger', 'aaron',
]);

// Each extra hero adds forty percent of a solo hive's muster. One shared
// colony spends one gold pile, so the horde has to grow with the party or
// four heroes erase the map. Capped at the party limit so a bad roster
// cannot explode the spawn.
export function coopPressure(heroCount) {
  const n = Math.max(1, Math.min(PARTY_LIMIT, Number(heroCount) || 1));
  return 1 + 0.4 * (n - 1);
}

// A living friend inside this radius channels a pull-up. Farther away, the
// downed hero still returns at the Keep on their own timer.
export const ALLY_REVIVE_RANGE = 2.4;
export const ALLY_REVIVE_CHANNEL = 1.6;

// World labels for other heroes. Nothing under your own feet, and nothing
// but a name — or DOWN, so a friend can walk to the body.
export function allyMarker(hero, { local = false } = {}) {
  if (!hero || hero.fallen) return null;
  const name = String(hero.name || 'Ally').slice(0, 18);
  if (hero.dead) {
    if (local) return null;
    return { key: `down:${name}`, text: name, sub: 'DOWN' };
  }
  if (local) return null;
  return { key: `name:${name}`, text: name, sub: '' };
}
