# Toy kit (art pass phase 2)

The game's buildings, men, heroes, enemies and props are a scripted Blender
kit: low-poly, flat-shaded, vertex-coloured, sci-fi, all original designs.

- Source: `tools/art/toy_kit/` (`kit.py` primitives + export, `european.py`
  shapes, `cultures.py` palettes, `build.py` driver).
- Build: `~/apps/blender-4.2.3-linux-x64/blender --background --python tools/art/toy_kit/build.py -- --culture european`
- Output: `assets/kit/<culture>/*.glb` + `manifest.json`. Check: `node scripts/toy-kit-check.mjs` (in `npm run check`).
- Review: open `kit-preview.html` (`?only=castle&cols=4&step=7`).

## Conventions
- 1 unit = 1 tile. Models face **+Z** in game space (`u.facing = atan2(dx, dz)`), ground at y = 0.
- Two materials only: `toy` (matte Lambert, baked vertex colour) and `glow` (unlit).
- Animated parts are separate nodes with their pivot as origin:
  `part_turret` (tower/outpost head, sits at z = 0 so recoil works), `part_rotor`
  (spins in XY), `part_core`, figure limbs `leg_l leg_r arm_l arm_r`, enemy
  `body arms eyes` (arms pivot at the shoulder; eyes re-tinted per instance).
- Prop parts (`trunk`, `canopy`, `rock`) are white-ish so instance colour tints them per map palette.

## Tiers (fixed spots, grows in place)
Castle T1 keep → T2 curtain + four towers + gatehouse → T3 taller towers,
energy band, banners, men on the walls → T4 citadel spire with a floating core.
Towers, houses and outposts have four tiers; farm, mill, mine, camps, workshop
and hero forge have three. Walls stay procedural (`building-art.js`, per tile):
T1 low wall with a timber cap, T2 thicker and taller with merlons and coned
piers, T3 thicker again with an energy band, banners and sentries.

## Cultures
A culture = palette + building shape set + unit set (`src/cultures.js`,
`tools/art/toy_kit/cultures.py`, per-culture shape modules `european.py`,
`asian.py`, `south_american.py`, `middle_eastern.py`, shared parts in
`common.py`). All four are built (`assets/kit/<culture>/`) and playable; the
player picks one on the level screen (European is the default). Each culture
has its own keep, walls, gate, towers, houses and three unit models; farms,
mills and workshops are still shared European shapes recoloured.

Gameplay: every culture musters the same three trades from the same camps
(militia / ranger / sniper), but `CULTURE_ARMIES` in `src/config.js`
overrides their stats (evade, armour/thorns, splash, range, rate of fire,
speed) inside a narrow band of the European power level. Troopers in every
culture still drop a walker in the same number of shots:
- European (Star Knights): reference line.
- Asian (Jade Lantern Dynasty): evasive fast glaive guards, rapid short-reach
  repeaters, rocket fire-lances with splash.
- South American (Sun Terrace Guard): slow armoured shieldbearers that
  reflect melee, fastest jaguar scouts, sturdy solar atlatls.
- Middle Eastern (Mirage Court): heavy long-reach lancers, mounted dune
  riders, astrolabe longguns with the longest range.
The culture is part of the match (saved in replays) so the sim stays
deterministic. Stuck sweep per culture: set `CULTURE=<key>` for the stuck check.
