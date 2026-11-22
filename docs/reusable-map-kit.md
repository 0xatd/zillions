# Zillions reusable map kit

Status: authored prototype, not a production release or finished art target.

## Current sci-fi override — 2026-11-21

Alex chose stronger sci-fi after rejecting the medieval walls and entrances.
The default human kit now uses `tools/art/toy_kit/frontier.py`: chamfered armor,
steel frames, functional machinery, retracted blast-door housings and deep gate
passages. Houses become habitat modules; farms use hydroponic grow beds; mills
use turbines; command buildings have communication towers. Stable asset IDs,
plot roles, costs and footprints remain unchanged. The later command-district pass relocates Black Vale economic plots and changes its reserved court; see the version note below. Other culture
kits retain their legacy architecture. Descriptions of timber/stone/roofed
assets below record the earlier draft and are superseded for the default kit.

Cliff-top defenses use continuous capped armor and observation blocks instead
of crenellations. Shared streets use broad service-slab material, not cobbles.
The wall path still follows the existing terrain: this pass does not reauthor
landforms or claim to solve every angular wall/cliff junction.

Alex rejected the streets-only #136 result on 2026-11-21. Technical connectivity
was not enough: the screenshot did not read as an intentional fortress. Alex
requested reusable map parts in the spirit of the Warcraft II editor. This is
an authoring model reference, not permission to copy Warcraft assets.

## Composition contract

A map is a composition of reusable pieces, not a single custom mesh. Keep the
existing painterly art standard. Plan districts and roads before placing their
buildings. Use a dominant keep, readable gatehouse, three-tile main street,
smaller district lanes, grouped residential and economic frontages, and defenses
anchored to real terrain. A road graph passing tests is not visual acceptance.

## Files and flow

```text
map-kit.js: piece definitions + rotatable prefab groups
   ├─ map-kit-page.js: placement workbench → versioned JSON export/import
   └─ fortress-plan.js: Black Vale main-site composition
          → plot positions + reserved court/street cells
          → colony-roads.js: connected, built-footprint-safe network
          → colony-art.js: paving + cliff-top parapet rendering
          → existing Game simulation, occupancy and movement
```

- `src/map-kit.js`: integer tile coordinates; clockwise quarter-turn rotation;
  terrain, roads, ramps, wall, gate and tower descriptors; N/E/S/W neighbor
  ports; reusable boulevard, lane, gatehouse, courtyard and district groups.
- `map-kit.html`: local authoring workbench. Place or rotate pieces/groups,
  undo edits, clear, export and import a versioned 48×48 layout. Test walking
  routes with the shared collision/elevation compiler. This is a
  composition tool, not a campaign loader. Exported maps do not yet become
  playable missions. Terrain colors are schematic, not final material previews.
- `src/fortress-plan.js`: first playable consumer. Black Vale's **first city
  site only** rearranges existing economic buildings into district frontages,
  keeps IDs/counts, reserves courts and avenue, and rejects placements that
  sever access. Alternate sites and other missions keep their existing plans.
- `src/colony-art.js`: parapets occupy existing impassable cliff-edge ground;
  they are a visual treatment of natural barriers, not free simulated buildable
  walls. Buildable gate walls use the existing stone kit from their first tier;
  their upgrade stats remain unchanged.

## Scope and limitations

This proves a reusable data/placement foundation and one in-game composition.
The workbench's terrain and defense palette is an authoring catalog; only court,
street and district definitions feed the first campaign consumer. Full campaign
import, campaign terrain adapter, elevation editing, arbitrary prefab save,
and automatic validation of user-authored missions are not implemented. Do not
claim the workbench can publish playable maps or that all five maps are redesigned.

Natural cliffs, graded ramps, gate locations and military plots remain. Changes
to economic building positions can affect combat; simulation equivalence to the
old layout is neither expected nor claimed. Validate actual movement, campaign
behavior, deterministic restore and art at gameplay distance.

Snapshot version 8 and lobby protocol 9 protect this new layout. Old in-progress
sieges cannot be resumed by this branch; original save archival and account
progression remain intact. Do not merge or deploy without reviewing that impact.

## Next reuse boundary

Design a second distinct authored composition from the same pieces before
expanding the palette. A future editor must compile walkability and elevations
from the same data used for rendering, refuse blocked gate exits and overlapping
footprints, and keep stable prefab/layout versions for saves and multiplayer.

## Cross-map reuse and visual acceptance

Black Vale is the proving ground, not a bespoke asset exception. Shared cliff
crowns and rock materials now apply to both ledge-bearing biomes (Barrow Hills
and Black Vale). Crown geometry derives from the same clipped terrain triangles
and leaves graded ramps clear; it does not change walkability or height queries.
The road renderer distinguishes main stone streets from quieter earth lanes.
`applyFortressComposition` accepts authored street/district data; Black Vale
selects `crownCourts`, while other maps retain their own layout until deliberately
authored. Reuse the rules and pieces, not the identical fortress footprint.

For every new composition, inspect near, far and both side cliffs from the normal
gameplay camera, plus overview, ramp approach, crowded combat, Low quality and
phone. Check all five biome overviews whenever shared terrain/materials change.
Keep wall bases seated in rock, ramps visibly open, road hierarchy clear and
district edges natural. Save actual screenshots and traversal results. A test
pass is necessary, but does not establish visual quality. See
[reference study](city-reference-study.md) for observed design principles.

## Composition refinement

`crown-courts-v2` replaces the long cross street with a bent main avenue,
a smaller keep court and quieter west-district lanes. Residential frontages
use authored staggered slots instead of a global row-alignment score. The
same clearance and accessibility solver checks every candidate. Economic
plot counts, IDs, military plots and graded ramps remain unchanged; positions
and approach geometry change, so this is not simulation-equivalent to v1.

The European starter keep now has an asymmetric watch tower, lower stair
turret and pitched great hall, authored in the existing Blender pipeline.
House height variation is ID-keyed and never enlarges its footprint. Cliff
crests use continuous varying height, not a scatter of isolated rock props.
Keep reusable shape rules separate from map-specific district coordinates.

## Shared architecture rebuild

The European kit now uses full-height defensive drums, timber-and-stone
homes with cross-gabled porches, corps-specific muster halls, barn/crop
farmsteads and taller windmills. Keep upgrades retain the starter hall-and-
watchtower silhouette instead of becoming a different miniature castle.
All tiers are authored in `tools/art/toy_kit/european.py`; no external assets
were copied. These building families are shared across campaign maps.

Homes, farms and workshops turn toward their actual connected street tile.
Turns are cardinal so square plot footprints remain valid. This is presentation
only; plot positions, IDs, costs, collision and the simulation RNG are unchanged.

The natural-boundary treatment uses spaced watch bastions on blocked ground,
not one tower per grid cell. Their entire footprint must clear walkable tiles
and graded ramps. They represent the natural fortification, not additional
weapons or independently damageable buildings. Ground materials use connected
earth clearings, narrow irregular turf transitions and quieter lane colors.
Foliage uses flatter overlapping broadleaf crowns and irregular fir tiers.

This is still a draft art pass. The tile-derived outer landform, repeated
settlement density and universal material treatment remain below the Forsaken
reference's authored finish. Do not describe this implementation as parity.

## Wall appearance and scale refinement

The natural-boundary kit now connects smoothed masonry half-spans through
blocked rim cells. Diagonal returns use a blocked elbow rather than cutting
across a walking corner. Battered footings, stone courses, capped battlements,
arrow slits and occasional blue banners establish a wall/body/crown hierarchy.
Every decorative footprint is checked against walkable and switchback tiles.
Watch bastions remain scenery, not new combat buildings.

European tier-2/3 wall and gate assets share that heavier masonry language.
Gate lintels have more headroom; their simulated openings are unchanged.
All four house tiers have taller inhabited bodies and entrances, without
expanding their footprint. The three mounted kit heroes no longer use the
old oversized display multiplier; selection/aura radii and collision remain
unchanged. Fallback heroes and other culture buildings retain their existing
proportions. Those are separate remaining consistency gaps.

Cliff skirts share exact boundary vertices. Per-face normal displacement was
removed because it opened cracks between adjacent faces; material fractures
provide surface detail without separating the shell. The seam regression uses
an independently specified raised block, not a screenshot or source-text check.

## Architectural run and silhouette refinement

The natural cliff-top boundary now traces connected rim chains and fits longer
straight runs inside their blocked strip. Runs stop at junctions, substantial
height changes, unsafe chords and a six-tile length limit. Compact joints mark
run endpoints instead of decorating each tile. Complete span footprints remain
clearance-checked against walkable ground and switchbacks. This does not move
terrain, simulated wall plots, gate openings or collision. Buildable gate-wall
sections retain their own existing kit assembly.

Default habitat tiers use stepped living/service pods and a sloped solar canopy.
Militia halls have vaulted shells; ranger facilities have separate low wings;
sniper facilities have offset sensor towers. Workshops use open gantries, and
fabricators use cylindrical chambers. These forms share the same armor palette
and existing asset IDs, but no longer share one box-shaped building body.
Rebuild through `frontier.py`; keep all tier, state and gameplay-distance checks.

## All-map architectural assembly

All five campaign maps and their alternate founding sites use the shared
`rampart-art-plan.js` contracts. Straight cells draw one full panel instead of
paired half-panels. Corners retain shared tile-edge endpoints; diagonal-only cells meet at clipped corner returns entirely inside their
blocked footprint, and each damageable cell retains its own mesh, so destruction never leaves a long ghost curtain.
Default human starter walls use the armored defense family on every map.

Gate jambs sit on actual solid wall endpoint tiles or natural abutments outside
all arch tiles, including diagonal/stepped openings. Destroyed wall abutments
remove their jamb and canopy; gate meshes refresh from support occupancy without
replaying the construction animation. The canopy follows those
supports; its lowest beam is above the passage. The runtime assembles existing
authored post geometry with merged control-room and canopy volumes. Fixed-width
GLB gates remain the gallery/legacy-context fallback, not the in-game fitter.
`tests/rampart-art-plan.test.mjs` covers all 15 sites and their 94 gates.

All connected colony networks now distinguish paved main gate routes from earth
service lanes. Existing frontage orientation and role-specific buildings apply
across maps. This is shared architectural polish, not 15 relocated city plans:
Black Vale remains the only custom court/district layout. No new simulation,
plot-position, collision, economy, snapshot or protocol changes are introduced.

Use the installed `rts-fortress-design` skill for future wall/base work. Its
reusable craft and visual checks supplement this repository's exact contracts.

For the transformed gate-geometry regression, start a local developer game,
wait for its kit, then run in the browser console:

```js
await (await import('/scripts/rampart-art-proof.mjs')).proveGateClearance()
```

It checks 282 gate/tier combinations against actual open tiles using the
renderer's real meshes. It rejects unloaded assets instead of silently proving
the fallback. The baseline fixed-width gate fails on its first passage jamb.

## Culture × environment kit — command districts revision

`src/world-art-kit.js` separates construction identity from ecology.

- Culture owns road edge/paving palettes and command-court proportions. The
  architecture palette is a design contract; GLB generators still own actual
  building materials. Do not assume editing this metadata recolors models.
- Biome owns tree mixture/density/height, understory, cliff crown height/relief/tint,
  outcrop height, reeds and road dust. The five mission environments consume
  these profiles through landscape-art, cliff-art and colony-art.
- Collision, pathfinding, terrain tiles and simulation RNG do not use ecology
  values. Cliff triangles stay clipped to blocked cliff ground; trees remain
  inside forest tiles. Snow/ash colors still come from mission palettes.
- Culture is not a copied city footprint. Keep common HQ hierarchy, entrance
  scale, primary avenue and service lanes; fit district footprints to each site's
  gates, cliffs and resources. Existing solver/road clearance rules still apply.

### Reusable assets actually shipped in this draft

The default Expedition culture has four command-building tiers with a broad
foundation, deployment entrance and offset communications spine. All tiers use
existing HQ IDs; the renderer no longer widens them beyond the four-tile plot.
`frontier_units.py` shares an infantry rig with role-specific armor/weapons for
Soldier, Ranger and Sniper, retaining named animation joints. Scott keeps his
bike/weapon identity with matching armor. Other cultures keep their legacy units.
The existing gate fitter, wall joins and damage lifecycle remain shared.

Black Vale site 0 is the first command-district composition: an eight-tile court,
shifted habitat and hydroponic groups, and connected service approaches. The
other 14 founding sites keep their layouts while receiving shared rendering.
The initial command-district pass used snapshot 9 / lobby protocol 10 (superseded below);
older saves receive the existing incompatible-layout message. Account progress
is unaffected. Do not mix old/new simulation clients in multiplayer.

### Whole-game presentation

A shared deployment screen presents mission identity and real phase labels,
with an indeterminate track rather than invented percent progress. It clears
on success and failure. Title/login styling shares the steel/amber language.
The cinematics page explicitly states there is no cinematic content yet; this
change does not create movies or claim a complete menu/HUD redesign.

### Extension checklist

1. Add/select a biome profile; keep tile collision independent of decoration.
2. Use the culture's existing building/wall vocabulary and role proportions.
3. Compose different districts around local gates/resources, not a pasted city.
4. Check every affected mission at gameplay scale, plus Low and phone views.
5. Prove troop silhouettes in combat and entrances against actual occupants.
6. Run map/traversal, asset and targeted render tests, then production build.

Remaining art work: bespoke biome tree/rock meshes, textured terrain transitions,
non-default sci-fi culture kits, additional authored site compositions, cinematic
content and a broader menu/HUD pass. Profile-driven variation is a foundation,
not a claim these are finished environment art libraries.

### Verification — 2026-11-21

Local production build and full `npm run check` passed (54 test cases in the
final test runner, plus the script checks and five traversal simulations).
Targeted environment tests pass for all five missions. Browser checks verified
loading success/failure cleanup and all four HQ meshes within 4×4 plots.
Captured all five maps at full-map/gameplay scales, plus title, loading and
empty cinematics on laptop/phone, Low detail and combat.

Visual limitation: the existing landscape-phone HUD consumes much of the
vertical play area. This kit pass does not fix that HUD layout; keep it visible
in follow-up presentation review rather than calling phone polish complete.

## Playable showcase follow-through — 2026-11-22

This pass builds on the command court, HQ tiers and culture/biome layer above.
It does not relocate another plot or change the save/protocol contract.

- Verified paved routes receive a single merged amber lane-guide mesh. Marks
  stay inside straight road tiles, drape to the terrain and leave junctions
  quiet. The same rule applies to all five default-culture missions.
- Expedition Soldier has a wider powered shoulder/pack silhouette; Sniper has
  an asymmetric sensor hood. Ranger retains the lighter reconnaissance rig.
  These are the existing three troop roles, not new balance classes.
- Scott has a sealed red command helmet, armored rider and gravity maul on
  his existing heavy hoverbike. Other named heroes and character-customized
  rigs are unchanged. All named limb pivots remain; there are no new stats.
- Fresh solo campaign starts have a four-second skippable in-engine arrival:
  fixed-yaw camera dolly, mission title and objective. Simulation and commands
  wait until it ends. Resume, multiplayer, Watch and reduced-motion users skip
  it. Escape ends arrival before opening pause. Failure cleanup restores the
  HUD and camera. This is a short arrival, not a standalone cinematic film.
- Landscape-phone command HUD is 88px high. Portrait has its own fitted layout.
  Upgrade choices use contextual panels rather than disappearing at small
  viewports or squeezing four choices into a desktop HUD cell. Main mission
  panels and debrief reuse the steel/amber presentation language.

Browser proof, from a loaded developer page at 844 × 390:

```js
await (await import('/scripts/showcase-browser-proof.mjs')).proveArrivalAndHUD()
```

It checks real arrival input/simulation freeze, skip, restore exclusion, actual
upgrade spending and HUD bounds. Use a fresh page for visual captures after
this lifecycle test; startGame now removes/disposes the previous terrain on rejoin or restore.
Use a fresh page per map when reviewing other transient scene objects.

Remaining quality gaps are authored cliff contours, crowd overlap and finished
skeletal animation. Non-default cultures and other named heroes still need their
own coherent sci-fi migration. The arrival does not constitute a film library.


## Gate defenders and command deck — 2026-11-22

- Gate towers use a bounded interior search against their own entrance, not
  the generic six-tile spiral. Reserve all gate defenders before camps.
- A tight pair of adjacent Rotmire gates shares its central bastion rather
  than placing a defender outside useful gate coverage. `gateDefenses` records
  this relationship; the aperture and approach reservations remain clear.
- Tests cover all 42 main entrances across 15 campaign sites. Dedicated
  defenders stay within 5.5 tiles of their gate center; a shared bastion can
  serve a second gate within 6 tiles, inside the first tower tier's range.
- Placement changes require snapshot 10 / multiplayer protocol 11. Do not
  resume a positional old save by changing only its version number.
- Login and roster now share a responsive command-deck shell. Roster previews
  use the existing gameplay model pipeline, including race, class and gear.
  Retired CSS mannequins must not return; they clipped the entire model through
  colliding `.avatar-body` rules. Preview remains local, not an auth operation.
- Farm/house income is automatic, accumulated fractionally and paid every four
  seconds during a live siege. Building `income` is per 40 seconds, not per tick.
  The HUD and build descriptions show gold/minute including map/relic modifiers.
- Repeated mission initialization must remove and dispose its old terrain.
  The previous code retained it, producing overlapping landforms and buried
  actors. `proveArrivalAndHUD` checks the actual restore lifecycle.

- At Black Vale (114.5, 100.5), the camera-facing ridge also hides Recon in a
  fresh mission. The own-hero occlusion shell inherits animated mesh transforms
  and uses GreaterDepth: only hidden fragments get an amber silhouette. A
  bounded terrain-height sightline enables it; open ground leaves it off.
  This is presentation-only, does not expose enemies, and does not move units,
  change camera yaw, flatten terrain or alter collision. High and Low need
  separate actual frame proof; mesh-count tests cannot prove rendered visibility.

Both cliff-foot occlusion and stale-map overlap are independently reproduced.
The exact inbound screenshot still lacks its start/continue/rejoin sequence;
these fixes do not imply that every cliff art-quality issue is finished.
The live site still serves the pre-draft release until #137 is reviewed/landed.

## Readability refinement — second pass, 2026-11-22

The commander deck keeps deployment and utility navigation above the fold at
390×844 and 844×390. Roster rows retain their size and scroll inside the roster;
long names wrap. The empty roster presents one creation action without a blank
model stage or disabled deployment controls. Keyboard focus remains visible.

Desktop combat gives the ability grid more width and two-line names. Economic
upgrade prompts show current → upgraded gold/min; new buildings show their
output without payout bookkeeping. Income timing and balance are unchanged.
No tower positions, terrain, unit meshes, collision or snapshot versions change
in this refinement. The existing gate and hero-visibility proofs still apply.

`scripts/browser-shell-check.mjs` verifies actual deployment/navigation button
bounds at phone, landscape and compact-laptop sizes, not just page overflow.

## Perimeter ownership and battlefield feedback — November 22 follow-up

The simulation now publishes `hq.plan.perimeters`: one main boundary and the
fortified road outposts. Each tile belongs to natural terrain, a wall plot or a
gate. Cliff cladding reads this plan and stays away from functional wall/gate
sections; it must never invent a parallel defensive line. Unbuilt walls and
combat breaches remain real openings. Natural terrain is not a paid wall.

Road forts fit to natural barriers. Gate candidates must connect their interior
to open ground; secondary war-road crossings can add side gates. Their towers
sit on gate flanks with reserved courtyard routes, not in the middle of transit.
Compact flag-centered satellites remain open positions, not enclosed bases.

`tests/perimeter.test.mjs` checks all 15 founding sites at every wall tier:
closure with gates blocked, reachability with gates open, and outer defenders'
position/range. Movement regressions cover gate-jamb collision and diagonal
wall/terrain corners. `tests/fortress-boundary-art.test.mjs` checks transformed
cladding against the shared plan, actual walking ground and ramp clearance.
These do not establish every possible crowd formation or every screenshot's
exact movement history; retain the full playthrough and real-camera review.

Damaged buildings offer Repair before Upgrade. Repair restores HP without
changing tier; one completed hold cannot silently become an upgrade. Ruins
still use Rebuild. Wall repairs redistribute purchased HP across damaged
sections rather than wasting the share allocated to nearly-full pieces.
The prompt names the action during payment; repair uses cyan progress and HP.

Damaged-building bars use the mesh height and a readable minimum screen size.
Critical damage is red. Walls show the weakest damaged segment per plot to
avoid a stack of overlapping bars. Full-health buildings have no bar.

Click/tap a visible unit for read-only stats. Hidden enemies cannot be inspected;
selection clears when the unit dies or leaves vision. The Items button exposes
named field-pack and equipped-item details without relying on hover tooltips.
No individual unit commands, movement orders or economy actions are added.
Run `scripts/battlefield-feedback-proof.mjs` in the developer battlefield and
capture laptop, portrait phone and landscape results.

Layout/movement/payment changes use snapshot 11 and lobby protocol 12. Previous
siege saves are rejected through the existing incompatible-layout flow; account
progression and server data are unchanged.

### Direct-goal movement through Widow Bluff

A local pathfinding window is not a reachability boundary. Escort and defense
orders fall back to the shared whole-map goal field when the local flood cannot
connect their positions. Direct-goal steering keeps that detour until the entire
line to the goal is clear; a clear six-tile prefix does not justify turning back
into a cliff. Attack lane waypoints retain their local formation steering.
Goal fields remain occupancy-stamped, bounded and shared, not per-actor state.

`tests/perimeter-traversal.test.mjs` walks the hero with actual directional
commands and moves six escorts using Follow/Defend across the Black Vale fort
beside Widow Bluff. It checks both directions between the main base, fort and
node, partial construction, every wall tier, a breach and a rebuild. The prior
movement fails the return trip. This is a controlled traversal scene, not proof
of every possible battle crowd, and does not close external roads outside forts.

Burrowers tunnel through wall barriers but attack other occupied structures.
Tunneling into economic buildings put them inside zero-distance flow sources,
where they could circle without attacking. A separate regression preserves wall
tunneling while requiring a bite against a farm.

Squads validate the swept movement segment rather than just its destination.
This prevents cutting through a closed wall/terrain corner while preserving
legal off-centre turns. Applying the hero's stricter two-side-cell rule to all
squads stalled formations; endpoint-only checks let them tunnel corners. The
shared perimeter regression exercises both hero and troop corner collision.
