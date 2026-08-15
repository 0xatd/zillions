# Agent Brief

Read this before you review, audit, or change Zillions.

## Current Live State

- Production URL: `https://zillions.taborlin.co`.
- Production host: Vercel project `zillions`.
- GitHub repo: `0xatd/zillions`, default branch `main`.
- Account backend: Supabase project `zillions`, ref `skqggyvkblqtyggtcxbc`.
- Static GitHub Pages is only a fallback/review build.

The live game is a sci-fi Thronefall-style conquest defense game. The player
signs in with Google, claims a public username, picks a hero, founds a city at a
flagged site, funds pre-planned plots with gold, defends the Keep, razes hive
nests, and clears campaign maps.

The current shipped combat loop still has the old day/bell/night phase model:
the player builds during day, rings the bell at the Keep, fights a wave, then
collects dawn income. Do not pretend this has already been migrated.

## Next Gameplay Direction

Alex's current preferred direction is to remove the explicit day/night concept.
The intended next loop is continuous siege:

- Waves arrive every fixed interval.
- Building and upgrading can happen at any time.
- Building during a wave is allowed but dangerous.
- The core job is to clear the map, not survive a fixed number of nights.
- The win path is: protect the Keep, raze all hive nests, then defeat the map
  boss or final counterattack.

Do not half-migrate this by only changing copy. A real migration must update the
simulation, UI, tutorials, save summaries, stats labels, balance checks, and
docs together.

## Product Boundaries

- Google email is private login identity only.
- Public identity is the claimed `@username`.
- Never show email addresses or Google profile names in profile, lobby, chat,
  room, invite, or presence surfaces.
- Do not show fake rooms, fake players, fake stats, fake population, or seeded
  production activity.
- Empty lobbies should show a clean empty state.
- Do not point Zillions at Soshi, Weather.fun, or any other product backend.
- Do not restore old free-build RTS, asset-browser launcher, or debug profile
  surfaces.

## Gameplay Invariants

- Movement is fixed to world/minimap orientation, not camera-relative.
- W moves north/up, A west/left, S south/down, D east/right.
- Camera yaw stays fixed during gameplay.
- Hold Space/B to build or upgrade.
- Upgrades must work from all sides of a building footprint.
- Army control is blended: squads fight automatically, but the player sets the
  global stance. `1 Defend` holds the city line, `2 Follow` escorts the hero,
  and `3 Hunt` pushes enemies and hive nests. Do not add individual unit micro.
- Hero level-ups grant visible upgrade points. The player chooses Aura,
  Passive I, Passive II, or Ult Damage from the hero panel. Aura upgrades must
  stay visually obvious in world and reflected in affected ally/enemy stats.
- Campaign economy must be balanced against collectible gold.

## Key Files

- `src/game.js`: simulation, waves, economy, combat, save snapshots.
- `src/main.js`: renderer, input, camera, event FX, app orchestration.
- `src/ui.js`: account gate, menus, HUD, lobby, minimap.
- `src/config.js`: heroes, buildings, items, levels, economy, waves.
- `src/plots.js`: city layout, ramparts, gates, build plots.
- `src/auth.js`: Supabase auth, username, profile/save/stat sync.
- `src/online.js`: account-backed room/lobby adapter.
- `api/`: Vercel routes.
- `supabase/schema.sql`: schema and RLS source of truth.

## Required Checks

Run these before claiming a change is good:

```bash
npm run check
git diff --check
jq empty assets/audio/manifest.json
jq empty assets/audio/click-pack/index.json
jq empty assets/audio/faction-voice-pack/index.json
jq empty assets/audio/sfx-pack/index.json
```

For gameplay work, also run a browser smoke on local and production when
practical. Cover account gate, username display, city founding, building,
upgrade from all sides, camera edge follow, attack visibility, waves, and lobby
empty/real-room behavior.
