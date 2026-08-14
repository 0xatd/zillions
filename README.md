# ZILLIONS

Zillions is a browser-based survival RTS.

It mixes:

- They Are Billions colony survival.
- Warcraft III hero control and ability leveling.
- StarCraft-style army orders and base pressure.
- Warhammer-style grim space-marine flavor.
- Procedural zombie hordes, flow-field pathfinding, and loud weapons that attract enemies.

The repo is a Three.js browser game. It still runs from a static file server for local play. The Vercel deployment also includes small backend APIs for cloud profile, settings, saves, game-summary JSON, and the public lobby.

## Live Pages

- Game: https://0xatd.github.io/zillions/
- Backend build: https://zillions-iota.vercel.app/
- Asset browser: https://0xatd.github.io/zillions/assets.html

If GitHub Pages is not live yet, serve the repo locally:

```bash
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/`
- `http://localhost:8000/assets.html`

## Current Game

The dead cover the map. You found a colony, build an economy, train defenders, and survive 10 days.

Current modes:

- **Survival**: the active mode. Play solo, or gather players in the online lobby and start co-op.
- **Labyrinth**: planned second mode. It is visible in the menu but not playable yet.

Hordes strike on days 2, 4, 6, and 8. A final wave attacks from all sides on day 10.

Core systems:

- Build hab-tents, hydro-farms, sawmills, quarries, gold mines, wind generators, walls, towers, and barracks.
- Train scouts, troopers, and snipers.
- Noise matters. Gunfire attracts nearby zombies.
- Infection matters. Destroyed hab-tents spawn their residents into the horde.
- Night matters. Zombies move faster and attack harder at night.
- The horde uses flow-field pathfinding. Zombies chew through walls or route around them.
- The Overseer bot can run colony economy and defenses so the player can fight as the hero.

## Hero Roster

Each hero is a space marine with Warcraft III / Dota-style abilities.

| Hero | Style | Q | W | E | R |
| --- | --- | --- | --- | --- | --- |
| Captain Scott | Close-range tank | Whirlwind | War Cry | Purifying Light | Sun Strike |
| Alexander | Mid-range map-control marksman | Entangling Roots | Teleportation | Marksman's Focus | Assassinate |
| Danny | Long-range stealth sniper | Death Pulse | Beetle Swarm | Cloak & Dagger | Time Lapse |

Hero rules:

- Heroes earn XP from kills within 14 tiles.
- Heroes level from 1 to 10.
- Each level gives one skill point.
- Normal ability ranks unlock at hero levels 1, 3, and 5.
- Ultimates unlock at hero level 6.
- A hero revives at Fortress Command after death.
- Brutes can drop loot crates.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows / mouse at screen edge | Pan camera |
| Mouse wheel | Zoom |
| Z / C | Rotate camera |
| F | Select hero |
| Double-tap F | Center camera on hero |
| Q / W / E / R | Cast selected hero ability |
| Left click / drag | Select units |
| Right click | Move squad or cancel build |
| T | Select whole army |
| 1-9 | Manual build hotkeys |
| U / I / O | Train scout / trooper / sniper |
| Space | Pause |
| M | Mute |
| H | Help |
| Esc | Cancel |

## Co-op multiplayer (up to 3 players, no server)

On the Vercel build, players can join the **Online Lobby** before a match. The lobby shows active players for Survival and includes simple chat. GitHub Pages and local static servers still run without the lobby backend.

Click **🌐 Host co-op** and send the invite code to a friend; they **🔗 Join co-op**, paste it, and send back a reply code. After the first friend connects the host can **➕ invite a third player** the same way. Everyone picks a hero, the host picks a difficulty, and you're defending **one colony with up to three heroes**.

Built on WebRTC DataChannels (peer-to-peer star around the host, STUN only, zero infrastructure) running **host-sequenced deterministic lockstep**: the host merges everyone's commands into numbered windows and broadcasts them (~10 tiny packets/sec regardless of zombie count); every machine simulates the identical world, and periodic state hashes detect desyncs. All players should use the same browser family (e.g. all Chrome) — identical floating point keeps the worlds in perfect sync.

## Profiles & Saved Games

- **Commander profile**: set your name on the menu; the game tracks lifetime wins/losses, total kills, best day reached, and remembers your favorite hero.
- **Settings**: mute state is persisted.
- **Autosave**: every run autosaves every 20 seconds (and on tab close). A **📂 Continue** button appears on the menu — works for solo runs *and* co-op: the host resumes the save with the same number of friends in the lobby, and the full snapshot is streamed to every player so everyone continues from the identical moment.
- **Backend mirror**: localStorage remains the offline source of truth. On Vercel, the browser mirrors `profile`, `settings`, latest `save`, and `game` summaries to `/api/state`, backed by Vercel Blob.

Backend endpoints:

```text
GET    /api/state?playerId=<id>
POST   /api/state  { playerId, kind: "profile" | "settings" | "save" | "game", id?, data }
DELETE /api/state?playerId=<id>&kind=save&id=latest

GET    /api/lobby?mode=survival
POST   /api/lobby  { action: "join" | "heartbeat" | "chat" | "leave", playerId, mode, name?, hero?, text? }
DELETE /api/lobby?mode=survival&playerId=<id>
```

## Deploying

GitHub Pages serves the static game and asset browser.

Vercel serves the same game plus `/api/state` and `/api/lobby`. The Vercel project needs a Blob store with `BLOB_READ_WRITE_TOKEN` configured. `vercel.json` adds cache headers for the 3D assets. Co-op still works on static hosts because networking is peer-to-peer from the players' browsers.

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
src/backend.js          Browser client for cloud state and lobby APIs
src/ui.js               DOM HUD, panels, picker, minimap
src/map.js              Procedural map
src/flowfield.js        Horde pathfinding
src/bot.js              Overseer economy/defense bot
src/assets.js           GLB and hero media loader
src/net.js              Co-op WebRTC and lockstep networking
src/utils.js            Shared helpers
vendor/three.module.js  Vendored Three.js
api/state.js            Vercel Blob-backed JSON state API
api/lobby.js            Vercel Blob-backed lobby presence and chat API
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

High-level rule: keep this a working browser game. Local play must keep working from a static file server. Backend code should stay optional and gracefully fall back to localStorage.

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
npm run check
git diff --check
jq empty assets/audio/manifest.json
jq empty assets/audio/click-pack/index.json
jq empty assets/audio/faction-voice-pack/index.json
jq empty assets/audio/sfx-pack/index.json
```

There is no automated test suite yet.
