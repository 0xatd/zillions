# Zillions

Zillions is a browser siege game. Pick a hero, found a colony on a
terrain-shaped map, fund towers and camps with gold, push lane nodes, and burn
out every hive before Threat buries you. Play alone or with up to three friends
in lockstep co-op.

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
| Change gear, weapons, or the Lattice | `docs/weapons-and-items.md` and `docs/skill-tree-integration.md` |
| Give an agent compact context | `llms.txt` |

Use this source order when documents disagree:

1. Current code and `supabase/schema.sql`.
2. Automated checks in `scripts/`.
3. `docs/product-contract.md`.
4. `docs/architecture.md`.
5. `docs/agent-brief.md`.
6. Future documents, including `docs/design-vision.md`.

## The Game

Zillions is a siege game and nothing else. The persistent living world (the
overworld, planet hubs, galaxy map, parties, encounters, companies, markets
and the region workers behind them) was removed. Sign in, pick a character,
press **Deploy**, choose a mission, and play.

Zillions uses a continuous siege loop. There is no day, night, or bell phase.

1. Pick a hero and a city site.
2. Found a colony that follows the local terrain.
3. Hold the build input to fund plots with gold.
4. Use camps to produce autonomous squads.
5. Take lane nodes and build forward defenses.
6. Destroy each hive and its final champion.

Threat replaces a wave clock. Threat rises with time, living hives, and
captured ground. Each whole Threat level triggers a hive surge.

Living allied heroes and troops reveal the battlefield. The world outside
their soft vision circles is almost black, including the minimap.

## Modes

- **Campaign** contains the five authored Earth missions. Once Earth is won,
  procedurally generated campaign maps continue without end; each one is
  derived from its level number alone, so every player and every co-op peer
  gets the same map.
- **Survival** is an endless siege with a boss every fifth Threat level.
- **Labyrinth** trials are hero gauntlets with no colony.
- **Co-op** (Play Online) supports up to four players. Each player controls
  one hero; the players share gold, colony buildings, the enemy force, and the
  win condition. Rooms can be created, joined, rejoined, or watched.
- **Custom Games** separates Live Games (real rooms) from Arcade (prebuilt
  campaign, Survival, and Labyrinth maps that can be played or hosted).

## Accounts and Progression

Signed-in players log in with Google or an email magic link and keep
persistent characters (class, origin, appearance, level, gear, Lattice).
Character Info separates the overview, equipment, abilities, the Lattice, the
Market (Orbital Exchange) and the Forge.

**The server is the only thing that hands out XP, loot, Alloy, and stats.**
A signed-in match starts with a signed, single-use ticket from
`api/match-start.js` that fixes the player, mission, room and map seed. When
the match ends, the client sends the ticket, a match report and its input log
to `api/match-result.js`. The server verifies the session and ticket,
bounds-checks every number against the match duration and map, re-derives every looted item key
from the map seed, re-evaluates side quests itself, and then grants the
result in one transaction through the `apply_match_result()` database
function. The end screen shows only what the server confirmed. Clients have no
write access to `player_stats`, `match_history`, `game_characters`,
`item_instances`, or `player_wallets`. See `docs/backend.md`.

Guest (offline) play keeps its own progress in browser storage only. It is
never uploaded and never trusted by the server.

Market and Forge transactions go through `api/economy.js` against the same
server-owned inventory and Salvage Alloy ledger.

Supabase stores accounts, usernames, rooms, chat, characters, inventories,
wallets, stats, and match history. WebRTC carries co-op match commands. The
backend does not run the combat simulation.

## Heroes

The canonical roster is:

- Scott English
- Alexander Thomas
- Daniel Donovan
- Turtle Voss
- John Marlowe
- Tiger Reyes
- Aaron Whitlock

Heroes can reach level 100. Levels 2 through 10 grant upgrade points. Later
levels grant tapered stat growth.

`src/config.js` is the source of truth for hero stats and abilities.

## Characters, Gear and the Lattice

### Why This Exists

The goal was to give persistent characters real build depth by pairing them
with an action-RPG passive tree.

The reference is the Path of Exile 2 passive tree. The rule that governed every
decision: **copy structure, never content.** One shared graph with per-class
start positions, four node grades, a point budget far smaller than the node
count, legality by connectivity, paid respec, and separate damage types are all
mechanics, and mechanics are free to learn from. Node names, descriptions,
icons, coordinates and exported tree data are not. None of that was imported.
The Lattice is generated from a seed and a sector table written for this game,
and every term in it is a Zillions term.

The system earned its place because the plumbing was already half built and
doing nothing. `grantMmoExperience()` had granted one talent point per level
since persistent characters shipped, and nothing ever spent one — a level 40 character
held 39 dead points. The Lattice is the spend surface those points always
needed.

Weapons and damage types came before the tree on purpose. With one damage
number, every affix and every tree node collapses into `+X% damage`, and 646
nodes would all feel the same. Types are what make a roll a decision.

Four constraints shaped the implementation, and a change here has to keep them:

- The tactical minute stays readable. Gear, the Lattice and weapon sets all
  resolve to flat numbers before a run starts. The simulation never queries an
  item, an affix or a tree node while it runs.
- The simulation stays deterministic, and snapshot and restore keep working.
- Lockstep co-op keeps agreeing. Equipment, doctrines and the drawn weapon set
  reach the state hash, so mismatched peers fail before window 0.
- Nothing already saved breaks. Item keys without a `:` still resolve to the
  authored items, and a reshaped tree refunds rather than bricking a character.

`docs/weapons-and-items.md` and `docs/skill-tree-integration.md` record what was
built, the rules a change has to respect, and what was deliberately left out.

### What A Character Carries

A character carries its own build between sieges.

Gear is rolled. An item is a key such as `scatter_mk2:7f3a91:62:2` — base, roll
seed, item level and rarity — and it resolves to the same item on every machine
without storing anything but the key. Item level comes from the mission and its
difficulty, so loot gets better the deeper into the campaign you go. Characters choose a Human or Robot
origin and assemble face, body, head, and leg variants. Head, chest, hands,
legs, boots, weapons, and off-hands change the procedural model. Two implants
remain internal stat gear. The weapon and off-hand exist twice: press X to draw
the other set mid-fight.

The Character Info market tab opens the Orbital Exchange. Its stock rotates
deterministically and scales with character level. Players buy and sell with
Salvage Alloy. Mission gold remains inside each mission.

The Lattice is one shared 646-node passive tree. All thirteen classes allocate
into the same tree from thirteen different starting positions, so a class
decides where you begin, not what you can become. You earn one point per level
plus campaign points, and 122 points against 646 nodes means every build leaves
most of the tree behind. Nodes can be pinned to one weapon set.

Weapons carry the damage numbers, split across kinetic, thermal, shock and
void. Enemies resist some and are vulnerable to others. A hero with nothing
equipped fights with their signature weapon, which is exactly the numbers that
hero always had.

`src/items.js` owns gear and weapons. `src/skilltree.js` owns the Lattice.

## Controls

The layout follows Path of Exile 2's WASD mode, adapted where Zillions has a
system it does not. Every key below can be rebound in **Settings → Controls**,
which reads the same table the game dispatches through.

| Input | Action |
| --- | --- |
| W, A, S, D | Move in map and minimap directions |
| Shift | Gallop at full health |
| Space | Build mode: build/pay. Fight mode: dodge roll |
| Q | Fight mode: primary ability (your hero special) |
| E, R | Ability II and III — reserved; heroes carry one ability today |
| X | Draw the other weapon set |
| Ctrl | Secondary ability bar — reserved |
| 1, 2 | Consumable slots — reserved; Zillions has no flask system |
| B | Secondary Build-mode key: build, upgrade, repair, or rebuild |
| Alt | Switch between Build mode and Fight mode |
| F1, F2, F3 | Set Defend, Follow, or Push stance |
| T | Change the nearest tower target rule |
| Z | Drop the newest field item |
| C | Character and equipment screen |
| G | The Lattice |
| Enter | Team chat |
| P | Pause a solo game |
| M | Mute audio |
| Esc | Open the game menu |

Movement is not camera-relative. W always moves north on the minimap.

Two places deviate from Path of Exile deliberately. Army stances take F1–F3
rather than the number row, because Zillions commands squads and Path of Exile
does not — that freed 1 and 2 for a future consumable system. Alt switches the
action context because founding and funding a colony is the half of this game
an action-RPG layout has no opinion about. WASD remains shared. In Build mode,
Space and B build. In Fight mode, Space dodges and Q uses the primary ability.
A round button above the command bar uses that same cast, with the cooldown drawn across it.

## Local Development

Requirements:

- Node.js 22 (CI uses 22; 20 works except `check:browser`, which needs the
  global `WebSocket`)
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

A static server plays as a guest with local browser storage. Signed-in play
and the API routes need Supabase; copy `.env.example` to `.env.local`, fill it
in, and run `vercel dev`. Never commit real values.

## Validation

Run the complete repository check:

```bash
npm run check
```

The command runs `precheck` first (auth, economy, crafting, shell state) and
then checks syntax, balance invariants, deterministic restore, all five maps,
generated campaign maps, server match-reward rules
(`scripts/match-result-check.mjs`), hero abilities, multiplayer signaling,
room lifecycle, lobby behavior, and repository documentation.

Two more checks need local tooling:

```bash
npm run check:postgres   # schema + every migration on a throwaway local Postgres
npm run check:browser    # headless Chrome shell journey
```

`check:postgres` never connects to a real Supabase project. CI
(`.github/workflows/ci.yml`) runs `npm ci`, `npm run check`, and
`npm run check:postgres` on every pull request.

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

- `api/auth-config.js` — public Supabase and ICE configuration
- `api/match-start.js` — signed match tickets (seed, co-op room)
- `api/match-result.js` — the only grant path for signed-in XP, loot, Alloy,
  and stats
- `api/economy.js` — Market, stash, equipment, and Forge transactions
- `api/account-upgrades.js` — account upgrade tree, one-time local import,
  paid Lattice rewire

There are no scheduled crons. `.env.example` lists every environment
variable. Do not commit credentials or environment values. See
`docs/backend.md` for the required services and data ownership rules.

Database changes live in `supabase/migrations/`. They are applied by hand in
the Supabase SQL editor after review; nothing in this repository applies them
automatically. `20261027000000_drop_living_world_DESTRUCTIVE.sql` permanently
drops the living-world tables — review it and back up first.

## Important Product Rules

- Show public usernames. Never show Google names or email addresses.
- Show only real rooms, players, and statistics.
- Keep all simulation changes deterministic.
- Grant signed-in XP, loot, Alloy, and stats only on the server.
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
