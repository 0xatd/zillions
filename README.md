# ZILLIONS

Zillions is a browser-based planet-conquest game: you are the hero, riding a
contested frontier, raising a city out of the ground with gold, and pushing the
front line outward until every hive on the map is ash.

- Build-by-standing economy with one resource: gold.
- **Continuous siege.** No day, no night, no bell. Both sides run an economy:
  your camps muster squads on a timer and push them out along a lane graph to
  take nodes; every living hive musters its own squads and sends them back.
- **Threat** is the clock — it rises with time, with every hive still standing,
  and with your own conquests, and every whole level makes every hive muster at
  once.
- Direct hero control (WASD) with auto-attack, visible hero stats, and one
  signature ability each.
- Grimdark space-marine heroes, procedural hordes, flow-field pathfinding.
- Campaign (5 maps, 5 bosses) and endless Survival mode.
- Production account gate, Supabase-backed profiles/stats/saves, and public/private rooms.

The production game runs on Vercel at `https://zillions.taborlin.co`. Static
local play remains as a development fallback, but production identity is
Google/Supabase account-based.

## Live URLs

- GitHub repository: https://github.com/0xatd/zillions
- Production game: https://zillions.taborlin.co
- Vercel fallback: https://zillions-iota.vercel.app
- Static fallback: https://0xatd.github.io/zillions/
- Asset browser: https://0xatd.github.io/zillions/assets.html

GitHub repo metadata should point to the production game, not the Vercel
fallback. The default branch is `main`. GitHub Pages is useful for static review
and asset review only; Vercel is the production host.

## Current State

Read `docs/agent-brief.md` before review or implementation work.

Use this source order when documents disagree:

1. Current code and `supabase/schema.sql`.
2. Automated checks in `scripts/`.
3. `docs/product-contract.md` for product boundaries.
4. `docs/agent-brief.md` for shipped systems and known pitfalls.
5. `docs/backend.md` for storage and service boundaries.
6. `docs/design-vision.md` for future direction only.

For a pull request, diff the full head against the pull request base. Run the
checks on the exact head. Do not use an old branch report as proof for `main`.

The shipped loop is continuous siege:

- Found a city at a flagged site.
- Build, upgrade and repair at any time by standing near plots and holding
  Space in Build mode or B anytime. Nothing pauses while you do it — that is
  the risk.
- Fight mode hides vacant foundation affordances; real buildings remain visible
  and auto-attacks keep running.
- Camps muster squads forever. Set the army stance and it pushes the lanes on
  its own, taking nodes as the front line moves.
- Every living hive musters its own squads on a timer that tightens as Threat
  climbs.
- Win a campaign map by razing every hive nest, then breaking the counterattack
  its champion leads. Lose it if the Keep falls.

`docs/design-vision.md` holds the longer-range direction. Folklore factions,
fog, landmarks, and a strategic galaxy simulation are not implemented. The
shipped campaign already opens an endless procedural galaxy after level 5.

Serve the repo locally for static development:

```bash
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/`
- `http://localhost:8000/assets.html`

## How It Plays

Each map is a contested planet with its own **landform**. Greenfall is open
rolling moorland; Rotmire is a drowned fen of causeways and fords; the Cinder
Wastes are ash plains cut by long crag canyons; Barrow Hills is a field of
grave mounds and hollows; the Black Vale is split by one great mountain rift
with three passes through it. The landform decides how much water, crag and
wood there is and where it sits, so the ground plays differently — not just
looks different — on every level.

Hive nests — the enemy's producing bases — lair in the ugly ground far from
you, a graph of **lane nodes** covers the ground between, and three flagged
**city sites** offer genuinely different ground to defend: a shore with fewer
ways in, a crag shelf, ore inside the walls. Ride up to a site and it tells you
what it is.

You start un-founded: ride the frontier, pick your site, press Space, and the
**city plan** rises there. Every level builds a different plan, always turned
to face the hives:

| Level | Plan | What it changes |
| --- | --- | --- |
| Greenfall Marches | **ringed bastion** | A round ring, four gates. Open on every side. |
| Rotmire | **square fort** | Bastioned corners, gridded streets, a solid back wall — three gates, and a safe rear quarter to build economy in. |
| Cinder Wastes | **star fort** | Five towered spurs, gates sunk in the valleys between them. No room inside: the farms go outside the wall. |
| Barrow Hills | **crescent hold** | A broad front arc and a dead-straight back wall. One heavy gate, one postern, one street between them. |
| The Black Vale | **throat keep** | A long walled throat jutting at the horde, lined with towers, plus a postern. They come up the corridor or not at all. |

### The ground builds half your fortress

You never wall what the land already walls. Where the rampart line crosses
crag, deep water or thick wood, nothing is built there — that stretch is free,
permanent wall. You pay only for the **gaps**, and since a barrier costs by the
tile, a site whose crags close half the line costs about half as much to
fortify. Across the campaign's fifteen city sites, the ground closes anywhere
from 2% to 77% of the wall line, so the same plan comes out a different
fortress on different ground. Ride up to a flagged site and the survey tells you
which kind of site it is before you commit.

Only an open stretch can carry a gate, so the terrain also decides **how many
ways in** your city has — two to four. Whatever it decides, the plan's two
principal gates are always cut open, so you can always sortie.

### Every entrance is a ward

Each gate gets the same kit: two flanking towers and its own muster camp, with a
road spur to the plaza. Defending a gate and pushing a lane out of it start in
the same place, so ordering **3 Push** sends squads out of the gate nearest the
front instead of marching them across town. Two plans (the square fort and the
throat keep) add an **inner ward** — a second wall around the Keep with towers
in the yard between the walls, and gate roads that bend through it.

### Fence the passes

Out on the approaches the map has its own chokepoints: a gap two to nine tiles
wide pinched between crags, woods or water. The three best of them near your
city come with a **palisade** plot and a watchtower behind it. A three-tile
fence costs almost nothing, always carries a gate for your own squads, and
turns a pass into a killing ground you own.

This is how fortification actually worked — promontory forts walling only the
neck, Great Zimbabwe running its walls between granite boulders, Krak des
Chevaliers' concentric wards and bent entrance, Maiden Castle's staggered gate,
an abatis thrown across a gap. `docs/fortress-inspiration.md` has the sources
and the mapping.

- **Build whenever you like — and it is never safe.** Walk to a glowing
  foundation and **hold Space in Build mode** or **hold B anytime**: coins arc
  out of your purse one by one into the coin slots above the plot while a ghost
  shows the building to come (partial payments persist). Hold the same input
  beside a built structure to upgrade it. Top-tier towers make you choose a
  doctrine: ballista (single-target sniper) or flame (splash), and **T** beside
  a tower changes what it shoots first — nearest, strongest, siege-first or
  ranged-first. Building upgrades accept 50 gold each second, so expensive
  tiers do not require long stationary holds.
- **Camps connect to the roads.** The militia, ranger and sniper camps sit off
  the main plaza, but each has dirt road apron/spur tiles touching the building
  footprint so army production reads as part of the city network.
- **Income is automatic; coins are earned.** Buildings and held nodes credit
  gold continuously. Physical coins now drop only from kills, captured nodes
  and razed hives — so the coin-hoover is a reward for fighting, not a chore
  at sunrise.
- **Nothing repairs itself.** Hold Space in Build mode, or B anytime, on a
  damaged building to repair it for gold, or on a ruin to rebuild it at half
  price. Damage is a bill.
- **Threat is the clock.** It climbs on its own, faster while hives stand, and
  a little every time you take ground. Every whole Threat level, every hive
  musters at once.
- **Raze the hives.** Each nest musters squads forever until it is destroyed,
  spits defenders when attacked, and poisons the ground around it. Raze them
  all and the survivors call one last counterattack led by the map's champion —
  kill it and the planet is yours.
- **Barriers are bought whole.** Each rampart segment is ONE purchase at its
  gate — pay once and the entire stretch rises, never piece by piece.
  Upgrade the same way: Razorwire Fence → Plasteel Barricade → then choose
  its final form: **Shock Fence** (electrified, zaps and slows whatever
  chews it) or **Bastion Wall** (double armor).
- **Ruins are paid decisions.** Losing a building costs its function now, and
  rebuilding it spends gold that could have gone into the front line.
- **Supply comes from territory.** Your army ceiling is what the city can
  sustain plus what the ground you hold adds. When you are rich and stuck, the
  answer is always to go and take something.
- **Camps are faucets, not garrisons.** Every camp musters a fresh squad on a
  timer, forever, and sustains a standing force proportional to its tier — so
  buying more camps buys more army. Army control is blended: squads fight on
  their own, but you set the plan. **1 Defend** holds the city, **2 Follow**
  escorts your hero, and **3 Push** sends them out along the lanes.
- **Take and hold lane nodes.** Stand on a node with no enemies nearby and it
  flips to you. Held ground is ground you can fortify: every node carries a
  **Forward Camp**, a **watchtower**, and — where the land pinches nearby — a
  **palisade** across the gap. None of it is buildable until the node is
  actually yours, and losing the node ruins the whole fort with it.
- **The ground is terrain; the owner is a separate question.** Nodes are read
  out of the map itself — ore fields, fords pinched between water and crags,
  sheltered clearings, barrow shelves — so no two planets share a skeleton. What
  each one *is* you can read off the land. **Who holds it you cannot.** The hive
  already holds some of the best ground, some is merely guarded, and some is
  empty; a node stays *unsurveyed* on the map until one of your people gets
  close enough to look. An ore field being over there does not mean a hive is.
- **The frontier is hiding things.** Barrows have something under them, every
  hive sits on a hoard, travellers die in the passes with their packs on, and
  bosses always drop something. Caches stay invisible until a hero gets close,
  then you **walk over loot to pick it up** — straight into a 4-slot pack, felt
  immediately in your stats. Full pack? **G** drops the newest find on the
  ground. Whatever you are still carrying at the end of a run is yours to keep,
  in survival as well as campaign — which is the only way a survival run gets
  stronger wave after wave.
- **Ground has character.** An Ore Field pays double. A Quarry makes the Forward
  Camp built on it half again as tough. A Clearing lets it muster an extra
  trooper. A Ford is always well guarded, because whoever holds the pinch holds
  the road. A Barrow has something buried under it, once.
- **Campaign — the war for Earth, then the stars.** Raze every hive on each of
  Earth's 5 fronts, then break the counterattack its unique champion leads.
  Win all five and Earth is retaken — and turns out to be one star among many:
  the **procedural galaxy** opens. Frontier worlds are generated from their
  number alone (same galaxy for every player), recombining the landforms and
  city plans on bigger and bigger maps with harder hives and renamed elder
  bosses, without end. Every world you clear stays liberated on your profile —
  the level select is a map of the war, each planet drawn from its real
  terrain. **Survival**: endless siege, a boss every fifth Threat level — your
  record is the Threat you drove it to.

## Side Quests, Items & Campaign Persistence (WC3-style)

Every campaign map carries **3 side quests** (pause menu shows live progress).
Completing one on a victorious run permanently grants its reward: **hero
gear** (passive items — damage, HP, speed, cooldown, aura radius, coin
magnet…) or a **town relic** that empowers every city your civilization
founds (income, structure HP, troop & tower damage). Each campaign boss also
drops a signature item on first kill.

Heroes persist across the whole campaign like a WC3 campaign hero: levels,
XP and every item carry from map to map (shown on their hero card, saved in
your profile). In co-op, each player brings their own persistent hero, and
everyone's relics pool for the shared city.

## Hero Roster

The kit is Thronefall-simple with Dota-style readability: heroes auto-attack on
their own, a passive aura hums around them, two passive upgrade paths shape
their stats, and the player controls the one special. Alt toggles Space between
Build mode and Fight mode. Q always casts intentionally. You steer.

| Hero | Style | Aura (passive) | Special (Space/Q) |
| --- | --- | --- | --- |
| Scott English | Shotgun brawler — short range, huge slow blasts with spread | Heavy Gravity — nearby dead move 35% slower | Gravity Hammer — cataclysmic AoE melee slam, ~10× his auto |
| Alexander Thomas | Long-range marksman | Nanite Swarm — heals nearby troops & heroes | Concussion Grenade — blast ahead flings the dead back, he hops backward |
| Danny Donovan | Long-range sniper | Nutrient Siphon — drains nearby dead, feeds the health back to him | The Weave — invisible and fast, walks through the horde cutting everything touched |

Heroes earn XP from kills within 14 tiles and can reach level 100. Levels 2–10
grant nine upgrade points. The player spends each point on Aura, Passive I,
Passive II, or Ult Damage. Later levels add tapered stat growth without adding
more upgrade points. The in-game hero plate shows damage, attack speed, range,
speed, regeneration, aura radius, and affected allies or enemies. A fallen hero
revives at the Keep.

## Controls

| Input | Action |
| --- | --- |
| W / S | Move north/up · south/down on the minimap |
| A / D | Move west/left · east/right on the minimap |
| Shift | Gallop (full health only, like Thronefall) |
| Alt | Toggle Build mode / Fight mode for Space |
| Space | Found the city at a site · in Build mode, hold at a foundation/building to build, upgrade, repair or rebuild · in Fight mode, cast your special |
| B (hold) | Build / upgrade / repair in either mode |
| Q | Cast your special |
| T | Cycle the targeting doctrine of the nearest tower |
| G | Drop the newest field find out of your pack |
| 1 / 2 / 3 | Army stance: Defend city / Follow hero / Push the lanes |
| Hero upgrade buttons | Spend level-up points on Aura, Passive I, Passive II, or Ult Damage |
| Mouse wheel | Zoom |
| P | Pause (solo) |
| Esc | Menu |
| M | Mute |

## Playing Together

Production play is account-gated. A player signs in with Google, then claims a
public username before the game shell opens. Other players see that username,
not the email address or Google account name. Stats, cloud save, match history,
and rooms are owned by the Zillions Supabase project (`skqggyvkblqtyggtcxbc`).

**Online lobby** (main menu → Play Online): players can see signed-in usernames,
global lobby chat, and real public rooms. Each room shows its players and the
host's mode, map, difficulty, hero, and player limit. The browser separates open
rooms from games in progress. A player can join an open room, rejoin a previous
seat, or watch an active game without taking a seat. Watch mode is read-only.
Public/private room records come from Supabase `rooms` and `room_players`.
Empty room lists show an empty state. Do not seed fake games or fake players.

The actual match uses peer-to-peer WebRTC lockstep for up to three players.
Each player controls one hero. The backend stores identity, rooms, saves, stats,
and results. The backend does not run the combat simulation.

The host cannot start until every listed player has a direct game connection.
Campaign rooms also require every player to unlock the selected level. After
the host starts, each guest loads the battlefield and sends `startReady`. The
host starts lockstep window 0 only after all guests are ready.

The host sequences one command window about every 66 ms. Each packet repeats
four recent windows. The host keeps 64 windows for repair requests. Guests hold
an adaptive buffer of 3–10 consecutive windows based on measured latency and
jitter. If a window is missing, the guest requests that exact window. The HUD
shows route, round-trip time, jitter, buffered windows, and device frame rate.
This data separates network catch-up from local rendering stalls.

**Manual invite codes** (lobby → "Manual invite codes"): the serverless
fallback — trade invite/reply codes over any chat channel, no lobby backend
needed.

**Solo and co-op play the same game.** Same fixed-seed map, lane graph and
pre-planned city per level, one shared gold purse (anyone's coins, anyone's
hold-B), one shared horde and boss. Each player brings their own hero with its
own aura, special, XP, levels, and upgrade choices — auras stack, so a good comp
covers slow + heal + drain. Hive output grows +40% per extra player, and the
deterministic lockstep sim means every command (move, build, cast, stance) runs
identically on every machine.

## Profiles And Saved Games

- **Zillions account**: Google/Supabase identity is the production profile. The
  visible player name is the claimed public username tied to that account.
- **Stats**: games, wins, kills, best Threat reached, favorite hero, and match
  history sync to Supabase. The backend's `best_day` column now carries the
  Threat level a run reached.
- **Cloud save**: the latest solo/host save syncs to Supabase `save_slots`.
  If restore fails, the game removes the corrupt save and returns to the menu.
- **Lobby chat and friends**: signed-in global chat uses Supabase
  `lobby_chat`. Friend requests, accepted friends, online state, and
  friend-to-room invites use Supabase `friendships`.
- **Room and game chat**: setup-room chat and in-game team chat share
  `room_chat`, separated by `channel = 'room'` and `channel = 'game'`.
- **Static fallback**: localStorage remains for local development and offline
  smoke tests. Do not present it as a production profile.
- **Autosave**: every run autosaves every 20 seconds and on tab close.
- **Runtime guard**: an uncaught frame error stops the battlefield and shows a
  reload message. The game does not continue in a partially updated state.

## Deploying

Vercel is the production host. It serves the static game and same-origin API
routes:

- `api/auth-config.js`
- `api/state.js`
- `api/lobby.js`

Run `npm run check` before pushing. Vercel needs Supabase anon config and Blob
credentials in project env. Do not put env values in the repo.

## Art And Physics

- CC0 3D assets come from [KayKit Dungeon Remastered](https://kaylousberg.com): stone rampart walls, torches, war banners, crates, barrels, and a golden treasure chest. See `assets/KAYKIT-LICENSE.txt`.
- The game has procedural fallbacks if model assets fail to load.
- Zombies use ballistic corpse physics. Killed zombies launch away from the hit, tumble, bounce, and sink into the mud.
- Big hits can knock back survivors. Upgraded specials can throw, stun, or shred
  whole packs.

## Audio Assets

Runtime audio is mostly procedural WebAudio. Hero click barks use generated MP3s
from `assets/audio/click-pack/`. Other generated assets are stored in
`assets/audio/` and can be reviewed in the asset browser.

Current saved packs:

- `assets/audio/music/` - hero-select loop and map soundtrack loops.
- `assets/audio/voices/` - first-pass hero voice samples.
- `assets/audio/click-pack/` - 60 generated hero click barks.
- `assets/audio/faction-voice-pack/` - 80 generated faction barks for army, robots, townsfolk, aliens, and zombies.
- `assets/audio/sfx-pack/` - 29 generated sound effects for UI, weapons, creatures, robots, and town/colony events.

Useful docs:

- `docs/hero-audio-pack.md`
- `docs/faction-audio-pack.md`

## Repo Map

```text
index.html              Game entry point
assets.html             Audio and asset browser
style.css               Game HUD and menu styles
assets-page.css         Asset browser styles
assets-page.js          Asset browser renderer
src/main.js             Bootstraps renderer, UI, and game loop
src/game.js             Main simulation and rules
src/runtime-guard.js    Save recovery and frame-loop failure guard
src/config.js           Balance, heroes, buildings, units, siege
src/audio.js            Runtime WebAudio synth
src/ui.js               DOM HUD, panels, picker, minimap
src/terrain.js          Landform archetypes, city sites, hive lairs, node features
src/map.js              Map rendering: terrain mesh, foliage, minimap
src/plots.js            City plans: rampart silhouettes, gates, districts
src/flowfield.js        Horde pathfinding
src/lanes.js            Lane graph: capture nodes, lanes, and squad routing
src/assets.js           GLB and hero media loader
src/net.js              Co-op WebRTC and lockstep networking
src/multiplayer-*.js    Room readiness, level eligibility, and jitter helpers
src/online.js           Supabase room, lobby chat, friends, and game chat adapter
src/auth.js             Supabase auth/profile/save/stat sync
src/backend.js          Vercel API helpers
api/                    Vercel backend routes
supabase/schema.sql     Zillions Supabase schema and RLS
src/utils.js            Shared helpers
vendor/three.module.js  Vendored Three.js
assets/heroes/          Generated hero portraits and cinematic clips
assets/audio/           Generated audio assets and manifests
docs/product-contract.md Product source of truth for agents
docs/agent-brief.md    Quick current-state and pitfall brief
docs/backend.md         Backend source of truth
docs/fortress-inspiration.md  Historical fortification rules the city generator implements
AGENTS.md               Agent handoff and review instructions
scripts/repo-check.mjs  Repo hygiene checks for stale rules/backend drift
scripts/map-check.mjs   Builds every level's map and city and checks it plays
scripts/multiplayer-*.mjs  Multiplayer start, eligibility, pacing, and repair checks
```

## Tech Notes

- Three.js r160 is vendored in `vendor/`.
- The terrain is a custom flat-shaded mesh with per-tile vertex colors.
- Zombies are instanced meshes. This keeps large hordes fast.
- Zombies use a multi-source Dijkstra flow field. Player units use A*.
- The game uses GPU particles for blood, dust, muzzle flashes, and smoke.
- Lighting uses soft shadows and ACES tone mapping. There is no day/night
  cycle: the light bleeds out of the sky as Threat climbs, so a late siege
  looks like one without gating the player on a clock.
- The simulation runs at a fixed 30 Hz step. Rendering is separate.
- Game speed supports 1x, 2x, and 4x in solo mode. Co-op locks to 1x.
- Seeded RNG is used throughout the simulation. This supports lockstep co-op.
- Generated music, voice, and SFX runtime integration is partial and should stay
  explicit in code and docs.

## Agent Handoff

Read `AGENTS.md` and `docs/agent-brief.md` before changing the repo.

High-level rule: keep the current Thronefall-style gameplay base, and keep the
production backend/account files intact unless Alex explicitly replaces them.

When reviewing or changing gameplay, check:

- Production is account-gated on Vercel.
- Static local development still works as fallback.
- The hero picker works.
- City founding, plot build, repair/rebuild, node capture, and hive musters work.
- Lobby shows real usernames and rooms, or a clean empty state.
- Room settings, roster, start readiness, and level eligibility stay visible.
- Active games allow read-only Watch without adding a player seat.
- Multiplayer startup waits for every guest to load.
- Network catch-up shows diagnostics and repairs missing windows.
- Corrupt saves return to the menu. Frame errors show a recovery message.
- Audio changes do not break mute or browser autoplay behavior.
- Large assets are intentional and documented.

## Validation

Basic static validation:

```bash
python3 -m http.server 8000
```

Then open the game and asset browser in a real browser.

Required repository checks:

```bash
npm run check
git diff --check
jq empty assets/audio/manifest.json
jq empty assets/audio/click-pack/index.json
jq empty assets/audio/faction-voice-pack/index.json
jq empty assets/audio/sfx-pack/index.json
```

`npm run check` runs syntax, balance, determinism, map, signaling, multiplayer,
room-refresh, and repository checks. Run a real browser smoke for UI, graphics,
auth, or multiplayer changes. Do not call a branch deployable until the local
production build also passes. For the Vercel project, use:

```bash
npx vercel build --prod
```
