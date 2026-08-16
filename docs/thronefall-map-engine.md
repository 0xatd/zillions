# Why Thronefall's maps feel better than ours — and the engine that closes the gap

Research notes + design doc. Part 1 is what Thronefall actually does (from the
fan wikis, dev interviews and postmortems). Part 2 is the honest audit of our
own pipeline. Part 3 is the engine: what landed on this branch, and the
roadmap for the rest.

---

## Part 1 — How Thronefall builds a map

Thronefall (Grizzly Games: Paul Schnepf + Jonas Tyroller, the Islanders team)
ships 10 maps: 1 tutorial + 9 campaign maps, all German toponyms. The map is
the content unit — nearly every map introduces ~2 buildings and 2–4 enemies,
and each layout is reused ~6 times via quests/mutators before a new one is
authored.

### The level catalog

| Map | Theme | Topology | Spawns / lanes | The map's thesis |
|---|---|---|---|---|
| Neuland | Meadow | Small enclosed plain | 1 spawn (E) | Tutorial: build → upgrade → defend |
| Nordfels | Alpine valley | Mountain wall N, U-shaped river border | 4 ground lanes + fly-only W/S/NE | Concentric zones: outer eco, castle front, inner keep |
| Durststein | Desert | Bowl ringed by cliffs | 4 spawns, one per cardinal | Open all-round defense; ramps as ranged vantage |
| Frostsee | Tundra | Icy ring + lakes, ice-cave mouth | 5 spawns incl. cave | A detached outpost splits your defense |
| Uferwind | Coast | Peninsula: rugged coast vs open grass | Land lanes + ships/fliers on coast | One flank walls can never protect |
| Sturmklamm | Storm ravine | Hilltop keep over ravine corridors | 4 bridge funnels (1 broken = mole lane), fly-only behind hills | 4 wall plots vs 24 tower plots — towers-over-walls |
| Wildbach | River archipelago | Islands joined by bridges | All sides except the keep's end | Every ground lane is a bridge funnel |
| Moorweg | Swamp forest | Marsh paths | Multiple forest lanes | (1.0 map, sources thin) |
| Freifort | Autumn hills | Fortress on a big hill | Approaches up the slopes | Elevation-led concentric fort |
| Totend | Dead land | Fortress + lake | Multi-directional; final wave spawns **inside** the walls | The finale breaks the perimeter rule |

### The base anatomy

- **Fixed, typed plots.** No free placement anywhere. Every buildable thing is
  a predefined slot with a predefined building and upgrade tree. Dev-stated
  reason: it "opens up tons of level design possibilities" — the designer can
  enumerate every possible base and tune waves exactly against it.
- **Castle Center** is win condition and tech gate: upgrading it unlocks more
  plots (Nordfels' unit production only opens at castle tier 3).
- **Walls are purchasable perimeter segments**; an unbought segment is a hole,
  and racer enemies beeline through holes — buy order is strategy.
- **The risk gradient** is the single most-cited layout pattern: keep
  innermost → houses in the inner ring → walls/towers on the perimeter →
  mills, fields, mines, harbours **outside**. Yield rises and safety falls
  monotonically with distance from the keep.
- **Ratio skew gives each map a thesis**: 4 walls / 24 towers (Sturmklamm),
  harbour-heavy coast (Uferwind), the detached outpost (Frostsee).

### Terrain–gameplay blending

- **Ring first**: every map is bordered by impassable mountain/cliff/water;
  the playable space is the hole in the ring.
- **Spawns are gaps in the ring** — bridge mouths, cave openings, shorelines,
  passes. Lanes are carved *negatively*, by what you can't cross, never drawn
  as roads.
- **Every ground lane funnels through at least one choke** on mid+ maps.
- **One flank is always unwallable**, served by a wall-ignoring enemy class:
  fliers over lakes, ships on coasts, moles under the broken bridge. Terrain
  state encodes which enemy uses a lane.
- **Elevation is hierarchy**: the keep sits visibly high (Sturmklamm,
  Freifort); ramps and plateaus are ranged-unit value spots.

### Waves

- **Full preview, zero ambush**: red spawn icons during the day show exactly
  how many and what type come from where at nightfall. Reviewers consistently
  name this as why building feels like puzzle-solving.
- **Progressive activation**: night 1 uses 1–2 spawn points; later nights open
  more directions; the finale breaks the rules once (all directions, or inside
  the walls).
- Each new map introduces the enemy that counters the previous map's dominant
  strategy.

### Aesthetics

Low-poly, few/no textures, flat shading, clean silhouettes. One high-contrast
palette per biome. Hard cool daylight → warm point-lit night carries the phase
change. Prop density stays low enough that plots, lanes and enemies dominate
the image. Camera locked to the monarch; maps are small dioramas readable at
max zoom.

### The 15 rules (distilled, engine-ready)

1. Ring first — border the diorama with impassable terrain; play in the hole.
2. Spawns are gaps in the ring.
3. Lanes by negative space, ≥1 real chokepoint per ground lane.
4. Keep at the center of a monotonic risk/yield gradient.
5. Fixed typed plots — emit a plot graph, not build zones.
6. Gate plots by keep tier.
7. Skew one plot ratio per map to give it a thesis.
8. Always one unwallable flank, served by a wall-ignoring threat.
9. Bind enemy classes to terrain features.
10. Telegraph every wave at its spawn point; escalate by opening spawns.
11. One resource, forgiving loss.
12. Reuse each layout ~6× (quests/mutators) before authoring a new one.
13. Elevation = hierarchy; keep on high ground, ramps as value spots.
14. Readability over decoration.
15. Small enough to ride — no two defense points far apart.

---

## Part 2 — Where zillions actually stood

The systems layer was already unusually strong — closer to Thronefall than it
looked: fixed typed plots funded by walking up and paying (rule 5), city plans
whose ramparts anchor on crag/water/wood so the land is part of the wall,
gates that always face the war, chokepoint detection with named gaps, lane
nodes read out of the terrain, a flow field that makes hordes prefer gates
over walls, and a Node-executable validator (`scripts/map-check.mjs`).

What made the maps feel not up to snuff was almost entirely presentation:

1. **The maps were literally flat.** `TerrainField` computed a smooth
   elevation field, then threw it away; height was re-derived from the tile
   enum — water −0.55, mountain 1.5, *everything walkable exactly 0*.
2. **Hard tile edges.** One flat hex per tile, all 6 verts; every biome
   boundary an axis-aligned staircase. No blending, no textures, ±2.5%
   lightness noise as the only variation.
3. **80%+ of every map had zero props.** Trees on forest, rocks on crag,
   crystals on ore — and nothing at all on the grass/sand/path the war is
   fought on. No ruins, no landmarks, no monuments.
4. **Named ground didn't look like anything.** A Ford, a Barrow, "The Neck" —
   all just unmarked grass with a HUD ring. Hive lairs were a prop on clean
   grass.
5. Chokepoints detected (16) but mostly inert; ore placed by pure random walk;
   uniform-random creep scatter; no fog of war.

## Part 3 — The engine

### Landed on this branch

- **Real relief** (`terrain.js`): the elevation field survives generation.
  `heightAt(x,z)` derives world height fresh from `(elev, tile)` — walkable
  ground rolls 0.05–0.9 and never dips under the waterline (causeways read as
  built-up ground), crag climbs 1.1–2.6 with the field so ranges have peaks,
  water deepens with the basin. Walkability stays tile-based: the sim, the
  flow field and lockstep hashes are untouched. `groundY` is bilinear over
  corner heights, so units glide on slopes; `GameMap` caches the corner grid
  at mesh-build time.
- **Corner-blended color** (`map.js`): color lives on corners (average of the
  4 meeting tiles) like height always did. Interiors stay clean cel fields;
  every shore/treeline/crag-foot/path edge is now a one-tile gradient. Baked
  sunlit relief: high corners lift, hollows sink. Real vertex normals now do
  actual Lambert shading over the roll.
- **Elevation is hierarchy** (`terrain.js`): site scoring gets a prominence
  bonus (ground above its surroundings makes a keep that overlooks the
  approaches), and site flattening pulls terrain toward *the site's own level*
  instead of global mid-height — a Craghold really stands on a shelf, a
  lakeshore city really sits by the water. On founding, `generatePlots` grades
  the interior toward the keep's ground (hard at the plaza, fading at the
  wall) so districts sit on terraced ground while the rampart keeps its hill.
- **Set dressing** (`map.js _buildDetail`, 5 instanced meshes): grass tufts
  and pebbles over open ground, rare boulders clear of the sites, 4–6 ruined
  stone circles out on the frontier, and — the Thronefall move — **named
  ground now looks like its name**: monolith pairs flanking every detected
  chokepoint, cairns on barrows, timber crossing-posts at fords, moot stones
  at clearings, cut blocks at quarries. Blight-stained ground is baked into
  the vertex colors around every hive lair.
- **Everything sits on the land** (`main.js`): buildings, units, zombies,
  plots/beacons/ghosts, site flags, nest mounds, loot, coins, corpses (they
  bounce off the real floor), health bars, wave markers, node banners,
  projectile muzzles/impacts. The camera focus rides the relief softly.
- **Robustness**: every site is now guaranteed at least one outer chokepoint
  work (nearest-pinch fallback in `pickOuterWorks`).

Rules covered: 3 (partially — chokes now visible), 4–5 (already had), 13, 14.

### Roadmap (next phases, in impact order)

1. **Telegraph the war (rule 10).** Hives already muster on timers — surface
   it: a spawn-direction marker per hive during calm, with composition preview
   on surge warnings. Most feeling-per-line item left.
2. **Risk gradient audit (rule 4).** City plans mostly keep farms inside; push
   mills/farms to the rampart edge and outside (star fort already does this).
   Make outside-the-wall eco meaningfully richer (`income × exposure`).
3. **One unwallable flank + a wall-ignoring threat (rules 8–9).** Flyers that
   cross water/crag straight at the keep on high-threat levels; the fen's
   thesis becomes "the water is not your friend"; burrowers that ignore
   palisades on the wastes.
4. **Per-level thesis skew (rule 7).** Vary plot ratios per plan: keyhole gets
   double towers and half walls; fen city gets extra outer works; wastes get
   cheap palisades. One exaggerated ratio per level.
5. **Fog of war.** Flagged in `docs/design-vision.md` already; the reveal
   makes scouting, the minimap, and the ruin rings pay off.
6. **Structural rivers/roads.** War roads and bridges currently bulldoze
   straight lines; route them through detected chokes and fords instead, so
   the guarantees reinforce the landform instead of eroding it.
7. **Ore follows geology.** Seed ore patches near crag feet and river bends
   instead of uniform random — prospecting becomes map-reading.

### How to check it

`npm run check` runs everything (syntax, balance sim, determinism, map
validation). `node scripts/map-check.mjs --report` prints the per-level
readout. The terrain signature uniqueness check still guarantees no two
planets read the same.
