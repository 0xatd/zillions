# 🧟 ZILLIONS

A polished, browser-based zombie survival RTS — *They Are Billions*-style colony defense fused with *Warcraft III*-style hero mechanics, wrapped in a grimdark space-marine aesthetic. Built with [Three.js](https://threejs.org/), no build step, no dependencies to install.

![genre](https://img.shields.io/badge/genre-survival%20RTS-red) ![tech](https://img.shields.io/badge/tech-three.js-blue) ![deps](https://img.shields.io/badge/npm%20install-not%20needed-brightgreen)

## Play

Any static file server works (ES modules need HTTP):

```bash
# from the repo root — pick one:
python3 -m http.server 8000
npx serve .
```

Then open **http://localhost:8000**.

## The game

The dead cover the earth. Found a colony on a procedurally generated map, grow its economy, and survive **10 days** — hordes strike on days 2, 4, 6 and 8, and a massive final wave hits from all directions on day 10.

- 🏗️ **Build** hab-tents (gold + colonists), hydro-farms (food), sawmills, quarries, gold mines, wind generators (energy), palisade walls, sentry towers and a barracks.
- ⚔️ **Train** scouts (quiet), troopers (loud) and snipers (very loud) — gunfire **attracts** the dead.
- ☣️ **Infection**: every hab-tent that falls to zombies spawns its residents into the horde.
- 🌙 **Day/night cycle**: zombies are faster and bolder at night.
- 🗺️ Hordes use flow-field pathfinding — they'll chew through walls or pour around them, whichever is faster.

## Heroes (Warcraft III-style)

Pick one of three space marines at the start. Your hero earns **XP from kills within 14 tiles**, levels **1–10** (full heal on level-up), and gains a **skill point per level** to spend on four abilities — ranks unlock at hero levels 1/3/5, the ultimate at **level 6**. If your hero falls, he revives at Fortress Command. Brutes drop **loot crates** (gold or medkits) worth scooping up.

Each kit honors the squad's favorite heroes from WC3/Dota/Diablo:

| Hero | Range | Q | W | E | R (ultimate) |
|---|---|---|---|---|---|
| ⚔️ Captain Scott | close (melee tank) | Whirlwind (spin while moving) | War Cry (ally dmg) | Purifying Light (heal + burn) | Sun Strike |
| 🌿 Alexander | mid | Entangling Roots (AoE root) | Teleportation (channel, then TP anywhere) | Marksman's Focus (passive: mini-stuns + permanent dmg per kill) | Assassinate (deletes the biggest zombie) |
| 🗡️ Danny | far (sniper) | Death Pulse (dmg + ally heal) | Beetle Swarm (latching DoT) | Cloak & Dagger (passive: fade invisible, huge backstab shot) | Time Lapse (5s rewind) |

## Built for old WC3 / Dota players

- **You are the hero.** The 🤖 **Overseer** bot runs the colony's economy and defenses — generators, farms, hab-tents, mines, tower rings, walls — so you fight instead of spreadsheet. Toggle it off any time to build manually (it always leaves you a gold reserve for troops).
- **The controls you remember:** `F` selects your hero (double-tap centers), `Q/W/E/R` casts, `T` selects your whole army, right-click moves, drag selects. Units fire while moving, Dota-style.
- Minimap **pings** on horde spawns and "colony under attack" warnings; day/night announcements; buildings slowly self-repair when zombies leave them alone.

## Controls

| Input | Action |
|---|---|
| WASD / arrows / screen edge | Pan camera |
| Mouse wheel | Zoom |
| Z / C | Rotate camera |
| F | Select hero (press twice to center camera on him) |
| Q / W / E / R | Cast hero abilities (while hero is selected) |
| Left click / drag | Select units (drag walls to build lines) |
| Right click | Move squad / cancel build |
| 1–9 | Build menu hotkeys |
| U / I / O | Train scout / trooper / sniper |
| Space | Pause · 1×/2×/4× speed buttons in the top bar |
| M / H / Esc | Mute / help / cancel |

## Co-op multiplayer (2 players, no server)

Click **🌐 Host co-op**, send the invite code to a friend, they click **🔗 Join co-op**, paste it, and send you back a reply code — connect, both pick heroes, the host picks a difficulty, and you're defending **one colony with two heroes**. Built on a WebRTC DataChannel (peer-to-peer, STUN only, zero infrastructure) running a **deterministic lockstep** simulation: only player commands cross the wire (~10 packets/sec), every zombie is simulated identically on both machines, and periodic state hashes detect desyncs. Both players should use the same browser family (e.g. both Chrome) — identical floating point is what keeps the worlds in perfect sync.

## Art & physics

- **CC0 3D assets** from [KayKit Dungeon Remastered](https://kaylousberg.com) (thanks Kay Lousberg!): stone rampart walls that auto-orient along your wall lines, torches, war banners, crates, barrels and a golden treasure chest for loot drops — with graceful procedural fallbacks if assets fail to load. See `assets/KAYKIT-LICENSE.txt`.
- **Ballistic corpse physics**: killed zombies launch away from whatever killed them, tumble, bounce, and sink into the mud — ultimates like Sun Strike also *knock back* survivors, so a max-rank ult sends thirty bodies arcing through the air.

## Tech notes

- **Three.js r160** (vendored in `vendor/`), custom flat-shaded terrain mesh with per-tile vertex colors.
- Zombies are **instanced meshes** (thousands at 60 fps) driven by a multi-source **Dijkstra flow field**; units use A*.
- Core **sound is synthesized** at runtime with WebAudio. Generated concept voice/music assets live in `assets/audio/` and are documented in `docs/hero-audio-pack.md`.
- GPU particles (blood, dust, muzzle flashes, smoke), soft shadows, ACES tone mapping, day/night lighting.
- Fixed-timestep simulation (30 Hz) decoupled from rendering, with 1×/2×/4× game speed (locked to 1× in co-op).
- Deterministic seeded RNG throughout the sim — the property that makes lockstep co-op possible.
