# ZILLIONS

Zillions is a browser-based zombie survival game in the spirit of **Thronefall**:
you are the hero, riding through a pre-designed city that you bring to life with
gold — by day you build and collect, by night you fight the horde.

- Thronefall-style build-by-standing economy with one resource: gold.
- A wave every night; you decide when night falls by ringing the bell.
- Direct hero control (WASD) with auto-attack and one signature ability each.
- Grimdark space-marine heroes, procedural hordes, flow-field pathfinding.
- Campaign (5 maps, 5 bosses) and endless Survival mode.
- Online lobby with public/private games, global chat, lore, and friends.

The repo is a static Three.js game. There is no build step and no package install is required.

## Live Pages

- Game: https://0xatd.github.io/zillions/
- Asset browser: https://0xatd.github.io/zillions/assets.html

If GitHub Pages is not live yet, serve the repo locally:

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
  then walk to a glowing foundation and **hold B** — coins arc out of your
  purse one by one until the building pops up (partial payments persist).
  Hold B beside a built structure to upgrade it. Top-tier towers make you
  choose a doctrine: ballista (single-target sniper) or flame (splash).
- **Ring the bell** (Space) when ready — night falls, and the horde marches
  out of its hive nests (red-beaconed all day). Night ends when the wave dies.
- **Raze the hives.** Nests are guarded but destroyable — attack one by day
  and it never spawns again. Raze every nest on a campaign map and the land
  is won outright, boss or no boss.
- **Ruins rebuild free at dawn** — losing a building costs you its function for
  the night and its dawn payout, not the building itself.
- **Camps field troops** that respawn each dawn. Press 1/2/3 to rally the
  army / militia / ranged to follow you, press again to hold position.
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

The kit is Thronefall-simple: heroes auto-attack on their own, a passive aura
hums around them, and Space at night fires the one special. You steer.

| Hero | Style | Aura (passive) | Special (Space/Q) |
| --- | --- | --- | --- |
| Scott English | Shotgun brawler — short range, huge slow blasts with spread | Heavy Gravity — nearby dead move 35% slower | Gravity Hammer — cataclysmic AoE melee slam, ~10× his auto |
| Alexander Thomas | Long-range marksman | Nanite Swarm — heals nearby troops & heroes | Concussion Grenade — blast ahead flings the dead back, he hops backward |
| Danny Donovan | Long-range sniper | Nutrient Siphon — drains nearby dead, feeds the health back to him | The Weave — invisible and fast, walks through the horde cutting everything touched |

Heroes earn XP from kills within 14 tiles, level 1–10, and their special ranks
up automatically at levels 4 and 7. A fallen hero revives at the Keep.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Move your hero (camera follows) |
| Shift | Sprint |
| Space | Found the city (at a site) · Day: ring the bell · Night: cast your special |
| B (hold) | Build / upgrade the foundation you're standing at |
| Q | Cast your special |
| 1 / 2 / 3 | Rally army / militia / ranged (toggle follow ↔ hold) |
| Mouse wheel | Zoom |
| Z / C | Rotate camera |
| P | Pause (solo) |
| Esc | Menu |
| M | Mute |

## Playing together

**Online lobby** (main menu → Online Lobby): a global chat where commanders
hang out, read the lore, and see every public war currently open. Create a
public or private game (private games are joined by 6-letter code), add
friends by trading commander codes, see who's online, and invite friends
straight into your game. Matchmaking signaling runs over Supabase Realtime;
the actual gameplay is peer-to-peer WebRTC lockstep (up to 3 players, one
hero each). The Supabase publishable key in `src/online.js` is a client-side
key by design (row-level security is enabled); the lobby tables are
namespaced `zillions_*`.

**Manual invite codes** (lobby → "Manual invite codes"): the serverless
fallback — trade invite/reply codes over any chat channel, no lobby backend
needed.

**Solo and co-op play the same game.** Same fixed-seed map and pre-planned
city per level, one shared gold purse (anyone's coins, anyone's hold-B), one
shared horde and boss. Each player brings their own hero with its own aura,
special, XP and levels — auras stack, so a good comp covers slow + heal +
drain. Waves grow +40% per extra player, any player may ring the bell, and
the deterministic lockstep sim means every command (move, build, cast, rally)
runs identically on every machine.

## Profiles & saved games

- **Commander profile** (localStorage): set your name on the menu; the game tracks lifetime wins/losses, total kills, best day reached, and remembers your favorite hero.
- **Autosave**: every run autosaves every 20 seconds (and on tab close). A **📂 Continue** button appears on the menu — works for solo runs *and* co-op: the host resumes the save with the same number of friends in the lobby, and the full snapshot is streamed to every player so everyone continues from the identical moment.

## Deploying (Vercel)

It's a pure static site — import the repo into Vercel (framework preset: *Other*, no build command) and it deploys as-is; `vercel.json` adds cache headers for the 3D assets. Co-op works on any static host since networking is peer-to-peer from the players' browsers.

## Art And Physics

- CC0 3D assets come from [KayKit Dungeon Remastered](https://kaylousberg.com): stone rampart walls, torches, war banners, crates, barrels, and a golden treasure chest. See `assets/KAYKIT-LICENSE.txt`.
- The game has procedural fallbacks if model assets fail to load.
- Zombies use ballistic corpse physics. Killed zombies launch away from the hit, tumble, bounce, and sink into the mud.
- Big hits can knock back survivors. Sun Strike can send many bodies into the air at max rank.

## Audio Assets

Runtime audio is still synthesized through WebAudio. Generated concept assets are stored in `assets/audio/` and can be reviewed in the asset browser.

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
src/bot.js              Overseer economy/defense bot
src/assets.js           GLB and hero media loader
src/net.js              Co-op WebRTC and lockstep networking
src/utils.js            Shared helpers
vendor/three.module.js  Vendored Three.js
assets/heroes/          Generated hero portraits and cinematic clips
assets/audio/           Generated audio assets and manifests
docs/                   Asset notes and production docs
AGENTS.md               Agent handoff and review instructions
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
- Generated music, voice, and SFX files are concept assets. Runtime integration is partial and should stay explicit in code and docs.

## Agent Handoff

Read `AGENTS.md` before changing the repo.

High-level rule: keep this a working static game. Do not add a build pipeline, server, framework, or package dependency unless the task truly needs it.

When reviewing or changing gameplay, check:

- The game still starts from a static file server.
- The hero picker works.
- Basic camera, selection, right-click move, and ability hotkeys work.
- The Overseer can still be toggled.
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
git diff --check
jq empty assets/audio/manifest.json
jq empty assets/audio/click-pack/index.json
jq empty assets/audio/faction-voice-pack/index.json
jq empty assets/audio/sfx-pack/index.json
```

There is no automated test suite yet.
