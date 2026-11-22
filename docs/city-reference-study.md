# City and terrain reference study

Alex's direction, 2026-11-21: use WoW cities, Game of Thrones/fan fantasy city
concepts and other strong city designs as inspiration, never exact copies.
Black Vale is the proving ground for tools and craft reusable across all maps.
The approved painterly Warcraft reference remains the finish target; "natural"
means convincing shapes, grounded architecture and transitions, not photorealism.

## Visually inspected references

- [Ironforge approach](https://wow.zamimg.com/uploads/screenshots/normal/87375-.jpg):
  architecture is seated into the mountain. The approach is cut into the slope,
  not a board floating beside it. Borrow wall/rock junction and ramp-support
  principles, not the gate design.
- [Thunder Bluff aerial](https://2.bp.blogspot.com/-b_onjQ7IBgI/TrPhZJE46dI/AAAAAAAABPg/Vjm37LcHoH0/s1600/WoWScrnShot_071111_074419.jpg):
  broad continuous cliff masses, visible shoulders, distinct grass caps,
  softened feet and readable links between terraces. Avoid thin cliff sheets,
  a necklace of identical spikes or repeated triangle facets.
- [Stormwind aerial](https://main.judgehype.com/images/news-bases/2026/404944-1769680024.webp):
  coherent districts, substantial gate/tower silhouettes, deliberate routes,
  varied building groups and breathing room. Borrow hierarchy and composition,
  not its street map, faction motifs, roof designs or assets.

These are third-party reference screenshots inspected on 2026-11-21, not
production assets or proof of current game versions. Image files remain in
local review evidence, not shipped with Zillions.

## Candidate fantasy-city references

Harry Platt's Eyrie (CK3 AGOT mod), Tobias White's Fortified Cliff Village,
Haygriv Modha's Frozen Citadel, and Kim Pope's Eyrie concept were found in search.
Their pages returned 403 during this session. They are leads, not visually
reviewed evidence. Inspect an accessible source before adopting specific visual
claims. No assets or exact compositions are copied.

## Shared design rules

1. Cliff tops must read as rock from the high side and normal gameplay camera;
   the outer vertical face is naturally occluded from some views. Use exposed
   crests, substantial rock volumes and material contrast, not x-ray rendering.
2. A wall has a grounded footing and a deliberate end at a cliff or gate. Avoid
   floating bases and thin disconnected segments. Natural barriers remain real
   simulation barriers; decoration must not imply a route that does not exist.
3. Ramps connect two readable elevations with a continuous supported roadbed.
   Their entrances stay visible and traversable with the base fully built.
4. Main streets, district lanes and working-earth tracks have distinct weight.
   Soften exposed corners and blend shoulders without obscuring route boundaries.
5. Place buildings as groups with intentional frontages; preserve map-specific
   landforms, choke points and strategic choices rather than clone a city stamp.
6. Reuse implementation and judgment together. A fix belongs in shared kit or
   rendering modules when its cause is shared. Site-specific data owns the city's
   composition. Verify a second contrasting map before calling a pattern reusable.
7. Inspect normal-camera near/far/side edges, high/low quality, phone, and a live
   battle. Do not hide fog, move the camera to a flattering angle, or substitute a
   concept image for gameplay acceptance. Technical tests are a separate gate.

## Current implementation boundaries

`src/cliff-art.js`, `src/terrace-mesh.js`, terrain material control and map rendering
are shared. `src/map-kit.js` supplies reusable pieces/prefabs and collision/elevation
contracts. `src/colony-art.js` supplies streets and grounded parapets. Black Vale's
first-site composition is still authored data/logic in `src/fortress-plan.js`.
Other city compositions have not been redesigned by this pass.
