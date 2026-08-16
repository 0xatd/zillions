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

The shipped loop is continuous siege:

- Found a city at a flagged site.
- Build, upgrade and repair at any time by standing near plots and holding
  Space/B. Nothing pauses while you do it — that is the risk.
- Camps muster squads forever. Set the army stance and it pushes the lanes on
  its own, taking nodes as the front line moves.
- Every living hive musters its own squads on a timer that tightens as Threat
  climbs.
- Win a campaign map by razing every hive nest, then breaking the counterattack
  its champion leads. Lose it if the Keep falls.

`docs/design-vision.md` holds the longer-range direction (folklore factions, fog
and landmarks, the planet and galaxy layers). Those are not implemented.

Serve the repo locally for static development:

```bash
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/`
- `http://localhost:8000/assets.html`

## How It Plays

Each map is a contested planet. Hive nests — the enemy's producing bases — ring
the wilds, a graph of **lane nodes** covers the ground between, and three
flagged **city sites** offer different ground to defend. You start un-founded:
ride the frontier,
pick your site, press Space, and the city plan appears there — the ground
inside the rampart is levelled clean, dirt lanes run from each gate to the
plaza, a ring of house plots surrounds the Keep, farm and mill lanes sit
behind them, gold mines wait on the ore veins, and a fully **closed** rampart
circles it all. The only ways in are the four gates, each flanked by a pair
of tower plots. Chokepoints, by design.

- **Build whenever you like — and it is never safe.** Walk to a glowing
  foundation and **hold Space**: coins arc out of your purse one by one into
  the coin slots above the plot while a ghost shows the building to come
  (partial payments persist). Hold Space beside a built structure to upgrade
  it. Top-tier towers make you choose a doctrine: ballista (single-target
  sniper) or flame (splash), and **T** beside a tower changes what it shoots
  first — nearest, strongest, siege-first or ranged-first.
- **Income is automatic; coins are earned.** Buildings and held nodes credit
  gold continuously. Physical coins now drop only from kills, captured nodes
  and razed hives — so the coin-hoover is a reward for fighting, not a chore
  at sunrise.
- **Nothing repairs itself.** Hold Space on a damaged building to repair it for
  gold, or on a ruin to rebuild it at half price. Damage is a bill.
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
- **Ruins rebuild free at dawn** — losing a building costs you its function for
  the night and its dawn payout, not the building itself.
- **Supply comes from territory.** Your army ceiling is what the city can
  sustain plus what the ground you hold adds. When you are rich and stuck, the
  answer is always to go and take something.
- **Camps are faucets, not garrisons.** Every camp musters a fresh squad on a
  timer, forever, and sustains a standing force proportional to its tier — so
  buying more camps buys more army. Army control is blended: squads fight on
  their own, but you set the plan. **1 Defend** holds the city, **2 Follow**
  escorts your hero, and **3 Push** sends them out along the lanes.
- **Take and hold lane nodes.** Stand on a node with no enemies nearby and it
  flips to you. Held nodes pay income, and you can raise a **Forward Camp** on
  one so squads muster at the front instead of walking there. Lose the node and
  you lose what you built on it.
- **The ground is terrain; the owner is a separate question.** Nodes are read
  out of the map itself — ore fields, fords pinched between water and crags,
  sheltered clearings, barrow shelves — so no two planets share a skeleton. What
  each one *is* you can read off the land. **Who holds it you cannot.** The hive
  already holds some of the best ground, some is merely guarded, and some is
  empty; a node stays *unsurveyed* on the map until one of your people gets
  close enough to look. An ore field being over there does not mean a hive is.
- **Ground has character.** An Ore Field pays double. A Quarry makes the Forward
  Camp built on it half again as tough. A Clearing lets it muster an extra
  trooper. A Ford is always well guarded, because whoever holds the pinch holds
  the road. A Barrow has something buried under it, once.
- **Campaign**: raze every hive on each of the 5 maps, then break the
  counterattack its unique champion leads. **Survival**: endless siege, a boss
  every fifth Threat level — your record is the Threat you drove it to.

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
their stats, and Space at night fires the one special. You steer.

| Hero | Style | Aura (passive) | Special (Space/Q) |
| --- | --- | --- | --- |
| Scott English | Shotgun brawler — short range, huge slow blasts with spread | Heavy Gravity — nearby dead move 35% slower | Gravity Hammer — cataclysmic AoE melee slam, ~10× his auto |
| Alexander Thomas | Long-range marksman | Nanite Swarm — heals nearby troops & heroes | Concussion Grenade — blast ahead flings the dead back, he hops backward |
| Danny Donovan | Long-range sniper | Nutrient Siphon — drains nearby dead, feeds the health back to him | The Weave — invisible and fast, walks through the horde cutting everything touched |

Heroes earn XP from kills within 14 tiles and level 1–10. Each level grants an
upgrade point that the player spends on Aura, Passive I, Passive II, or Ult
Damage. The in-game hero plate shows damage, attack speed, range, speed, regen,
aura radius, and how many allies/enemies are affected by the aura. A fallen
hero revives at the Keep.

## Controls

| Input | Action |
| --- | --- |
| W / S | Move north/up · south/down on the minimap |
| A / D | Move west/left · east/right on the minimap |
| Shift | Gallop (full health only, like Thronefall) |
| Space | THE interact key: found the city at a site · HOLD at a foundation to build, upgrade, repair or rebuild · cast your special anywhere else |
| B (hold) | Build / upgrade / repair (alias for holding Space) |
| Q | Cast your special |
| T | Cycle the targeting doctrine of the nearest tower |
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

**Online lobby** (main menu → Online Lobby): commanders can see signed-in lobby
presence, global lobby chat, and real public rooms. Public/private room records
come from Supabase `rooms` and `room_players`. Empty room lists show an empty
state. Do not seed fake games or fake players.

The actual match still uses peer-to-peer WebRTC lockstep (up to 3 players, one
hero each). The backend stores identity, rooms, saves, stats, and results. It
does not run the combat simulation yet.

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
- **Lobby chat and friends**: signed-in global chat uses Supabase
  `lobby_chat`. Friend requests, accepted friends, online state, and
  friend-to-room invites use Supabase `friendships`.
- **Room and game chat**: setup-room chat and in-game team chat share
  `room_chat`, separated by `channel = 'room'` and `channel = 'game'`.
- **Static fallback**: localStorage remains for local development and offline
  smoke tests. Do not present it as a production profile.
- **Autosave**: every run autosaves every 20 seconds and on tab close.

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
src/config.js           Balance, heroes, buildings, units, siege
src/audio.js            Runtime WebAudio synth
src/ui.js               DOM HUD, panels, picker, minimap
src/map.js              Procedural map
src/flowfield.js        Horde pathfinding
src/lanes.js            Lane graph: capture nodes, lanes, and squad routing
src/assets.js           GLB and hero media loader
src/net.js              Co-op WebRTC and lockstep networking
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
AGENTS.md               Agent handoff and review instructions
scripts/repo-check.mjs  Repo hygiene checks for stale rules/backend drift
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
- Lobby shows real rooms or a clean empty state.
- Audio changes do not break mute or browser autoplay behavior.
- Large assets are intentional and documented.

## Validation

Basic static validation:

```bash
python3 -m http.server 8000
```

Then open the game and asset browser in a real browser.

Useful checks:

```bash
npm run check
git diff --check
jq empty assets/audio/manifest.json
jq empty assets/audio/click-pack/index.json
jq empty assets/audio/faction-voice-pack/index.json
jq empty assets/audio/sfx-pack/index.json
```
