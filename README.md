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

- 🏗️ **Build** hab-tents (gold + colonists), hydro-farms (food), sawmills, quarries, gold mines, wind generators (energy), rockcrete walls, sentry towers and a barracks.
- ⚔️ **Train** scouts (quiet), troopers (loud) and snipers (very loud) — gunfire **attracts** the dead.
- ☣️ **Infection**: every hab-tent that falls to zombies spawns its residents into the horde.
- 🌙 **Day/night cycle**: zombies are faster and bolder at night.
- 🗺️ Hordes use flow-field pathfinding — they'll chew through walls or pour around them, whichever is faster.

## Heroes (Warcraft III-style)

Pick one of three space marines at the start. Your hero earns **XP from kills within 14 tiles**, levels **1–10** (full heal on level-up), and gains a **skill point per level** to spend on four abilities — ranks unlock at hero levels 1/3/5, the ultimate at **level 6**. If your hero falls, he revives at Fortress Command. Brutes drop **loot crates** (gold or medkits) worth scooping up.

| Hero | Role | Q | W | E | R (ultimate) |
|---|---|---|---|---|---|
| ⚔️ Brother-Captain Scott | melee tank | Chainblade Sweep | Battle Litany (ally dmg) | Seismic Stomp (stun) | Orbital Strike |
| 🎯 Brother Alexander | marksman | Bolt Barrage | Combat Stims (haste) | Hellfire Shells (slow, passive) | Frag Storm |
| 🔧 Tech-Brother Daniel | engineer | Machine Fury (tower haste) | Rites of Iron (repair) | Arc Lash (dmg + slow) | Sentry Servitor (turret) |

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

## Tech notes

- **Three.js r160** (vendored in `vendor/`), custom flat-shaded terrain mesh with per-tile vertex colors.
- Zombies are **instanced meshes** (thousands at 60 fps) driven by a multi-source **Dijkstra flow field**; units use A*.
- All **sound is synthesized** at runtime with WebAudio — zero audio assets.
- GPU particles (blood, dust, muzzle flashes, smoke), soft shadows, ACES tone mapping, day/night lighting.
- Fixed-timestep simulation (30 Hz) decoupled from rendering, with 1×/2×/4× game speed.
