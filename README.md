# ZILLIONS

Zillions is a browser-based zombie survival game in the spirit of **Thronefall**:
you are the hero, riding through a pre-designed city that you bring to life with
gold while hostile hive territory closes in around the map.

- Thronefall-style build-by-standing economy with one resource: gold.
- A wave every night; you decide when night falls by ringing the bell.
- Direct hero control (WASD) with auto-attack, visible hero stats, and one
  signature ability each.
- Grimdark space-marine heroes, procedural hordes, flow-field pathfinding.
- Campaign (5 maps, 5 bosses) and endless Survival mode.
- Production account gate, Supabase-backed profiles/stats/saves, and public/private rooms.

The current live build still uses a day, bell, night, and dawn loop. The next
intended migration is continuous siege: waves arrive on timers, building is
always available but dangerous, and the job is to clear the map by razing hive
nests and killing the boss while protecting the Keep.

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

## Current State And Next Direction

Read `docs/agent-brief.md` before review or implementation work.

Current shipped loop:

- Found a city at a flagged site.
- Build and upgrade by standing near plots and holding Space/B.
- Ring the bell at the Keep when ready.
- Fight the wave.
- Collect dawn income and repair.
- Win campaign maps by surviving the final night or razing every hive nest.

Next intended loop:

- Remove explicit night/day as a player-facing concept.
- Spawn waves every fixed interval.
- Let the player build and upgrade at any time.
- Make the main objective clear the map: protect the Keep, raze all hive nests,
  then defeat the boss or final counterattack.

Do not ship a partial migration that only changes copy. The simulation, UI,
tutorials, stats labels, save summaries, balance checks, and docs must move
together.

Serve the repo locally for static development:

```bash
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/`
- `http://localhost:8000/assets.html`

## How It Plays

Each map is a big castle-defense frontier (WC3 *Castle Defense* DNA): hive
nests — the enemy's bases — ring the wilds, and three flagged **city sites**
offer different ground to defend. You start un-founded: ride the frontier,
pick your site, press Space, and the city plan appears there — the ground
inside the rampart is levelled clean, dirt lanes run from each gate to the
plaza, a ring of house plots surrounds the Keep, farm and mill lanes sit
behind them, gold mines wait on the ore veins, and a fully **closed** rampart
circles it all. The only ways in are the four gates, each flanked by a pair
of tower plots. Chokepoints, by design.

- **Days are untimed.** Collect the coins your buildings paid out at dawn,
  then walk to a glowing foundation and **hold Space** — coins arc out of
  your purse one by one into the coin slots above the plot while a ghost
  shows the building to come (partial payments persist). Hold Space beside
  a built structure to upgrade it. Top-tier towers make you
  choose a doctrine: ballista (single-target sniper) or flame (splash).
- **Ring the bell** (Space) when ready — night falls, and the horde marches
  out of its hive nests (red-beaconed all day). Night ends when the wave dies.
- **Raze the hives.** Nests are guarded but destroyable — attack one by day
  and it never spawns again. Raze every nest on a campaign map and the land
  is won outright, boss or no boss.
- **Barriers are bought whole.** Each rampart segment is ONE purchase at its
  gate — pay once and the entire stretch rises, never piece by piece.
  Upgrade the same way: Razorwire Fence → Plasteel Barricade → then choose
  its final form: **Shock Fence** (electrified, zaps and slows whatever
  chews it) or **Bastion Wall** (double armor).
- **Ruins rebuild free at dawn** — losing a building costs you its function for
  the night and its dawn payout, not the building itself.
- **Camps field troops** that respawn each dawn. Army control is blended:
  squads fight on their own, but you set the plan. **1 Defend** holds the city,
  **2 Follow** escorts your hero, and **3 Hunt** sends them outward to kill
  enemies and push hive nests.
- **Campaign**: survive 10 nights (or raze every hive); a unique boss leads
  the final horde on each of the 5 maps. **Survival**: endless nights, a boss
  every fifth — your record is the number of nights you lasted.

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
| Space | THE interact key: found the city at a site · HOLD at a foundation to build · ring the bell at the Keep · cast your special at night |
| B (hold) | Build / upgrade (alias for holding Space) |
| Q | Cast your special |
| 1 / 2 / 3 | Army stance: Defend city / Follow hero / Hunt enemies and hives |
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

**Solo and co-op play the same game.** Same fixed-seed map and pre-planned
city per level, one shared gold purse (anyone's coins, anyone's hold-B), one
shared horde and boss. Each player brings their own hero with its own aura,
special, XP, levels, and upgrade choices — auras stack, so a good comp covers
slow + heal + drain. Waves grow +40% per extra player, any player may ring the bell, and
the deterministic lockstep sim means every command (move, build, cast, rally)
runs identically on every machine.

## Profiles And Saved Games

- **Zillions account**: Google/Supabase identity is the production profile. The
  visible player name is the claimed public username tied to that account.
- **Stats**: games, wins, kills, best day, favorite hero, and match history sync
  to Supabase.
- **Cloud save**: the latest solo/host save syncs to Supabase `save_slots`.
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
src/config.js           Balance, heroes, buildings, units, waves
src/audio.js            Runtime WebAudio synth
src/ui.js               DOM HUD, panels, picker, minimap
src/map.js              Procedural map
src/flowfield.js        Horde pathfinding
src/assets.js           GLB and hero media loader
src/net.js              Co-op WebRTC and lockstep networking
src/online.js           Supabase room adapter + Vercel lobby presence/chat
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
- Lighting uses soft shadows, ACES tone mapping, and a day/night cycle.
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
- City founding, plot build, bell, and first night wave work.
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
