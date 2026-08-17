export const MAX_VISION_SOURCES = 64;
export const HERO_VISION_RADIUS = 15;
export const TROOP_VISION_RADIUS = 8.5;

// Presentation-only visibility. The simulation stays authoritative and
// unchanged; each client derives the shroud from its allied unit list.
export function fogVisionSources(game, limit = MAX_VISION_SOURCES) {
  if (!game || !Array.isArray(game.units) || limit <= 0) return [];
  const living = game.units.filter((unit) => unit && !unit.dead);
  const heroes = living.filter((unit) => unit.hero);
  const troops = living.filter((unit) => !unit.hero);
  return [...heroes, ...troops].slice(0, limit).map((unit) => ({
    x: Number(unit.x) || 0,
    z: Number(unit.z) || 0,
    radius: unit.hero ? HERO_VISION_RADIUS : TROOP_VISION_RADIUS,
  }));
}
