# Zillions Art Quality Standard

Owner: Alex. Established 2026-11-20. Status: standing art direction.

## The north star

**Warcraft III Reforged: Forsaken Kingdom — Definitive Edition graphics.**

Alex likes this specific new visual treatment, not merely the original
Warcraft III or generic low-poly RTS art. The working style name is
**painterly, stylized science-fiction RTS art**: sculpted, exaggerated forms,
painted material definition, rich but controlled color, and readable depth.
This is our descriptive shorthand, not Blizzard's official style name.

Aim for its finish and visual coherence in playable Zillions scenes. Do not
declare success because a texture was added or tests passed. Current art is
a work in progress; this document does not certify reference-quality parity.

## References and what they teach

- [Official campaign announcement](https://news.blizzard.com/en-us/article/24301511/wage-war-once-more-with-warcraft-iii-reforged-forsaken-kingdom)
- [Official panel recap and graphics description](https://worldofwarcraft.blizzard.com/en-us/news/24302500)
- [Official screenshot gallery](https://blizzard.gamespress.com/en/wc3forsakenkingdom)

The panel recap describes preserving classic silhouettes, readability and
stylized identity while improving models, environments, lighting and effects.
The gallery contains both gameplay and cinematic images: label which one is
being used. A close cinematic view is a material/shape reference, never proof
that an asset reads at the gameplay camera.

Reviewed gallery examples: screenshot 1 shows large masonry courses, strong
architectural trim and cloth; screenshot 5 shows articulated roof silhouettes,
warm windows, material separation and a composed settlement; screenshot 10
shows exaggerated armor planes, controlled edge highlights and color grouping.
These are close/cinematic views. Screenshots 2 and 3 provide elevated
in-engine views: broad quiet paving, readable unit silhouettes, inset masonry
and warm localized lighting. Use comparable gameplay views for final
camera-distance comparison. Keep source URLs and capture dates with reviews.

StarCraft remains a secondary reference for tactical readability: clear
approaches, faction recognition, negative space and elevation hierarchy.
It must not pull the approved painterly look back toward generic grey realism.

## Our identity stays ours

Borrow craft, not Blizzard assets, insignia, characters or building designs.
Keep Zillions' continuous hero-led siege, terrain-aware colony, four culture
kits, science-fiction systems and recognizable team colors. Alex explicitly
chose a stronger sci-fi direction on 2026-11-21. Replace
medieval colony silhouettes with armored expedition architecture.
Do not infer a new game genre, undead faction or new mechanics from a reference.

## Visual rules

| Surface | Required result | Reject |
| --- | --- | --- |
| Terrain | Broad painted color masses, irregular grass/earth transitions, local wear and biome identity | Uniform noisy carpet, obvious repeating squares, identical green treatment on snow or ash |
| Cliffs and ramps | Weighty rock forms, readable strata, grounded feet and clear continuous approaches | Thin stacked sheets, isolated floating rock teeth, decorative paths that contradict movement |
| Buildings | Strong base/body/crown hierarchy, dimensional armor and trim, readable entrance and purpose | A box with a colored pyramid; detail visible only when zoomed in |
| Base composition | Keep as landmark, subordinate districts, streets joining gates and entrances, purposeful breathing room | Identical postage-stamp pads or dressing that hides routes |
| Foliage | Grouped canopy masses, varied silhouette, darker undersides and calmer ground underneath | Gemstone crowns, a wall of identical spheres, evenly sprinkled noise |
| Materials | Distinct rock, concrete, armor, fabric and metal; painted highlights and restrained wear | One universal texture over every surface, glossy plastic or black creases everywhere |
| Lighting | Warm/cool separation, contact depth, readable illuminated tops and shadowed recesses | Flat full-bright color or muddy darkness used to conceal unfinished assets |
| Units and effects | Hero, allies, enemies and attacks stand out against quieter scenery | Decoration, glow or particle volume competing with the action |

Use large forms first, medium material features second, tiny accents last.
Silhouette and value grouping must work before adding ornament. Finish a
coherent asset family; do not make one hero building lavish and leave its
neighbors looking like placeholders. Variation must remain seeded or id-keyed.

## Workflow

1. Read this standard and the asset contract. Choose the weakest visible
   layer from actual gameplay screenshots, not from a code wishlist.
2. Save a before image with mission, seed, camera, viewport, quality and state.
3. Review the relevant reference at a comparable scale. Separate observed
   reference features from the proposed Zillions interpretation.
4. Model silhouette and medium detail in Blender where geometry is the gap.
   Use the existing reproducible `tools/art/toy_kit` pipeline and GLB exports.
   Textures, shaders and lighting complement modeling; they do not replace it.
5. Compare in the actual browser, then iterate. A Blender beauty render is
   useful for authoring, not the release gate.
6. Preserve source, exported assets, provenance, screenshots and validation
   results. Report remaining gaps honestly.

Alex identified Blender on the Alienware as an available authoring resource.
Discover current device access before claiming to use it. An offline machine
does not block reference research, source edits or local Blender work. Do not
describe a server render as an Alienware render.

## Acceptance checklist for every art PR

- [ ] Before/after images use the same gameplay camera, mission and state.
- [ ] The improvement is visible at normal play distance without explanation.
- [ ] Hero, enemy, building purpose, gate and ramp remain immediately readable.
- [ ] Inspect all five campaign biomes when a shared renderer/material changes.
- [ ] Inspect the built base and an active battle, not only an empty map.
- [ ] Inspect normal and silhouette views for changed models and all their tiers.
- [ ] Inspect laptop and phone landscape; High and Low quality remain usable.
- [ ] Inspect loading/fallback, construction, damage and upgraded states for
      changed models. Required sockets and ground-center origins survive.
- [ ] No art change alters collision, pathing, save state or lockstep hashes.
- [ ] Record triangle/draw-call costs and browser performance on the same
      machine/settings. CPU-rendered headless timing is not a GPU FPS claim.
- [ ] Asset checks, applicable regressions, full repository checks and local
      production build pass. No browser or WebGL errors.
- [ ] Identify what still falls short of this reference. Tests establish
      correctness; only visual comparison establishes progress toward the bar.

## Priority and maintenance

This standard overrides old "few/no textures", strict flat-color toy and
minimal-detail guidance. It does not override performance budgets, simulation
contracts or release authority. Follow `art-direction.md` for numerical budgets
and sockets and `art-pipeline.md` for export and fallback behavior.

Update this document when Alex changes the direction. Keep progress notes and
temporary findings in dated review reports rather than weakening this target.

## Reusable landscape kit

`src/landscape-art.js` authors merged procedural shapes and instances them
from independent presentation seeds. Broadleaf crowns, layered conifers,
branching trunks and undergrowth form groves rather than evenly repeated trees.
Outcrops and fallen timber belong on already-blocked ground. Reeds belong in
non-lava water. Do not place large decorative obstacles in traversable lanes.

Terrain control maps distinguish working earth, forest floor, exposed crag and
water. Grassy cliff shelves keep their turf. World-space rock strata and slow
water movement must stay subordinate to combat. Keep each biome's palette,
including snow and ash. Review these shared components across all five maps.

## Playable benchmark

Use [Black Vale benchmark](black-vale-benchmark.md) for the fixed scene, cameras,
battle duration and comparison rules. Review the combined landscape, colony,
hero and armies rather than judging each layer in isolation.

## Reusable city and terrain craft (2026-11-21)

Read [City reference study](city-reference-study.md) and [Reusable map kit](reusable-map-kit.md).
Alex wants Black Vale improvements to become shared components and repeatable
practice for all maps: cliff readability from both sides, natural wall/rock
junctions, supported ramps, deliberate streets and district composition. WoW
and fantasy-city concepts are inspiration only, never exact layouts or assets.

## Sci-fi direction — Alex, 2026-11-21

Fortress sci-fi: armored expedition settlements against hostile wilderness.
Warcraft remains a finish/readability reference, not a medieval asset brief.
Use chamfered ceramic hulls, exposed steel frames, recessed service entrances,
mechanical gatehouses and restrained amber/cyan functional lights. No crenellated
castle crowns, half-timbered homes or slate roofs in the default human kit.
Keep recognisable building roles and the hero-led siege loop. The default kit
is the first migration; other culture kits remain legacy until authored.
