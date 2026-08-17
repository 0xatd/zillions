# Zillions

Zillions is the current playable foundation for a new browser-based
science-fantasy MMO. Create a persistent character, travel between worlds, and
enter planetary adventures. The current planet-conquest art and siege loop are
temporary content while the larger game develops.

Production: https://zillions.taborlin.co

Repository: https://github.com/0xatd/zillions

## Start Here

Choose the document that matches your task:

| Task | Read first |
| --- | --- |
| Play or understand the game | This README |
| Change code | `AGENTS.md`, then `docs/architecture.md` |
| Review a pull request | `docs/review-guide.md` |
| Change product behavior | `docs/product-contract.md` |
| Change Supabase or Vercel code | `docs/backend.md` |
| Change maps or fortresses | `docs/thronefall-map-engine.md` and `docs/fortress-inspiration.md` |
| Change unit or building art | `docs/art-direction.md` and `docs/art-pipeline.md` |
| Plan future systems | `docs/design-vision.md` |
| Give an agent compact context | `llms.txt` |

Use this source order when documents disagree:

1. Current code and `supabase/schema.sql`.
2. Automated checks in `scripts/`.
3. `docs/product-contract.md`.
4. `docs/architecture.md`.
5. `docs/agent-brief.md`.
6. Future documents, including `docs/design-vision.md`.

## Current Playable Game

Normal play now moves through the title screen, character roster, last
planetary location, Orbital Lift, and galaxy map. Each planet is a persistent
shared hub with its own presence channel and entrances to playable instances.
The profile remembers the last world.

Zillions uses a continuous siege loop. There is no day, night, or bell phase.

1. Pick a hero and a city site.
2. Found a colony that follows the local terrain.
3. Hold the build input to fund plots with gold.
4. Use camps to produce autonomous squads.
5. Take lane nodes and build forward defenses.
6. Destroy each hive and its final champion.

Threat replaces a wave clock. Threat rises with time, living hives, and
captured ground. Each whole Threat level triggers a hive surge.

The five Earth missions use distinct landforms and colony plans. After Earth,
the galaxy map opens deterministic frontier planets. Each planet currently
contains a Zillions-style warzone instance and a route back to orbit. Future
destinations can use other art and adventure structures.

Living allied heroes and troops reveal the battlefield. The world outside
their soft vision circles is almost black, including the minimap.

## Modes

- **Play Online** is the primary mode. Create, join, rejoin, or watch a room.
- **Story Campaign** contains the five Earth missions and later frontier worlds.
- **Survival** is an endless siege with a boss every fifth Threat level.

Online matches support up to three players. Each player controls one hero. The
players share gold, colony buildings, the enemy force, and the win condition.

Supabase stores accounts, usernames, rooms, chat, saves, and match history.
WebRTC carries match commands. The backend does not run the combat simulation.

## Heroes

The canonical roster is:

- Scott English
- Alexander Thomas
- Danny Donovan
- Turtle Voss
- John Marlowe
- Tiger Reyes
- Aaron Whitlock

Heroes can reach level 100. Levels 2 through 10 grant upgrade points. Later
levels grant tapered stat growth.

`src/config.js` is the source of truth for hero stats and abilities.

## Controls

| Input | Action |
| --- | --- |
| W, A, S, D | Move in world and minimap directions |
| C | Open or close the character and equipment screen in the persistent world |
| Shift | Gallop at full health |
| Alt | Change Space between Build mode and Fight mode |
| Space | Found, build, or cast, based on the current mode |
| B | Build, upgrade, repair, or rebuild |
| Q | Cast the hero special |
| T | Change the nearest tower target rule |
| G | Drop the newest field item |
| 1, 2, 3 | Set Defend, Follow, or Push stance |
| P | Pause a solo game |
| Esc | Open the game menu |
| M | Mute audio |

Movement is not camera-relative. W always moves north on the minimap.

## Local Development

Requirements:

- Node.js 20 or later
- npm
- A browser with WebGL

Install dependencies:

```bash
npm ci
```

Start a static server:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/`.

The local build can use local browser storage. Production requires the
Zillions Google and Supabase account flow.

## Validation

Run the complete repository check:

```bash
npm run check
```

The command checks syntax, balance invariants, deterministic restore, all five
maps, hero abilities, multiplayer signaling, room lifecycle, lobby behavior,
and repository documentation.

Also run these checks before you open a pull request:

```bash
git diff --check
jq empty assets/audio/manifest.json
jq empty assets/audio/click-pack/index.json
jq empty assets/audio/faction-voice-pack/index.json
jq empty assets/audio/sfx-pack/index.json
```

Run a local production build before you call a pull request deployable:

```bash
vercel build
```

See `docs/review-guide.md` for the full review procedure.

## Deployment

Vercel is the production host. The production project is `zillions`.

Vercel serves the static game and these same-origin API routes:

- `api/auth-config.js`
- `api/state.js`
- `api/lobby.js`

Do not commit credentials or environment values. See `docs/backend.md` for the
required services and data ownership rules.

## Important Product Rules

- Show public usernames. Never show Google names or email addresses.
- Show only real rooms, players, and statistics.
- Keep all simulation changes deterministic.
- Require every occupied multiplayer seat to be compatible, connected, and
  eligible before match start.
- Keep all guests behind the battlefield load barrier before lockstep starts.
- Do not replace terrain-derived maps with one generic layout.
- Do not restore the removed day and night loop.

## License and Assets

Third-party model terms are in `assets/KAYKIT-LICENSE.txt`.

Three.js terms are in `vendor/THREE-LICENSE.md`.

Use `assets.html` to review audio assets. Use `art-slice.html` to review
production GLBs at gameplay distance and in silhouette mode. The production
game does not link to either page.
