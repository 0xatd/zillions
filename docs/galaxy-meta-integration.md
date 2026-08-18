# Galaxy and Meta-Progression Integration

`src/galaxy.js` and `src/meta.js` ship complete, headless, and validated by
`scripts/galaxy-check.mjs`. Nothing in the shell calls them yet. This page is
the wiring list for the follow-up change. It touches `src/main.js` and
`src/ui.js` only.

## What each module owns

`src/galaxy.js` generates the galaxy: star systems on spiral arms, one to three
worlds each, Sol at the hub. It decides where a world sits and what kind it is.
It never invents level data — landform, palette, hives, boss and difficulty all
come from `levelById()`.

`src/meta.js` owns what a player keeps between runs: Salvage Alloy, a
twelve-node upgrade tree, and the bonus payload a run starts with. Node effects
are data, never behavior.

## Galaxy wiring

`src/overworld.js` keeps its current shape and is not modified. The galaxy
module produces the same descriptors and the same destination fields, so the
swap is a resolver change.

| Today in `src/main.js` | After |
| --- | --- |
| `galaxyWorldDescriptor(worldId, campaign)` | `descriptorForWorldId(knownGalaxy(), worldId, campaign)` |
| `galaxyDestinations(campaign, 12)` | `galaxyDestinationList(knownGalaxy(), campaign)` |

`galaxyDestinationList()` returns every field the current galaxy screen reads
(`id`, `name`, `subtitle`, `levelId`, `unlocked`, `cleared`, `threat`) plus
`kind`, `kindLabel`, `kindIcon`, `tier`, `tierLabel`, `mult`, `system`, and
`position`. A galaxy map can draw arms from `position`; the existing list UI
works with no change.

Two behaviors need a decision at the call site:

1. **Mission mode.** `worldMissionMode(world)` returns `survival` for a holdout
   and `campaign` for everything else. The descriptor carries the same value as
   `descriptor.mode`. Pass it where `main.js` currently hard-codes `campaign`
   for a frontier gate. Note that `Game._gameOver()` judges side quests in
   campaign mode only, so a holdout's quests are flavour until the shell either
   runs holdouts as campaign landings or extends quest judging to survival.
2. **Chart depth.** `metaBonuses().unlock.galaxyDepth` is how many extra systems
   the Deep Scanner and Extraction Harness nodes reveal. Feed it to
   `galaxyDestinationList(galaxy, campaign, depth)` when the shell wants a
   limited chart.

A derelict world's descriptor carries a bounded `labyrinth` region. It reaches
`overworldLayout()` as `layout.cave` with the existing trials attached, exactly
like Earth's labyrinth mouth, so the current cave handler already covers it.

## Factions

`src/factions.js` ships seven authored factions and mints more from their
number. A world carries `factionId` and `faction`; a system carries the same
plus `presence[]`, its roaming occupants.

The rule that matters at the call site: **presence sites are not worlds.** They
carry no level id and nothing to land on. A galaxy map draws them; a travel
handler must not try to resolve one into a world descriptor. Filter on
`system.worlds` for destinations and `system.presence` for decoration.

`galaxyDestinationList()` now carries `factionId`, `faction`, `factionName`,
`factionIcon`, `factionColor` and `hostile`, so a map can colour by owner with
no extra lookup.

Two things stay deliberately unwired:

- **Ownership state.** `systemOwner()` is a projection over the baseline. When
  the player takes a world, that belongs in `meta.js` as a delta beside
  `cleared`, applied at read time — not written back onto the generated galaxy.
- **Faction on the battlefield.** Nothing a faction declares reaches the sim
  yet. When it does, faction assignment must move into `src/config.js` keyed by
  the level id, exactly like `galaxyWorldKind(id)`, so `levelById()` stays the
  one lookup the simulation uses. `factionForWorld()` is already pure in its
  arguments so it can move unchanged.

## Meta wiring

Four calls, all in `src/main.js`:

```js
import { runScore } from './game.js';
import { loadMeta, awardRun, spend, metaBonuses } from './meta.js';
```

1. **At boot.** `loadMeta()` once, so the menu can show the balance.
2. **When a run ends.** `awardRun(runScore(this.game))` inside the existing
   end-of-run profile update. `runScore()` reads the game and writes nothing;
   calling it cannot perturb the simulation or a lockstep hash. A holdout world
   never sets `won`, so pass `cleared` explicitly when a survival landing should
   count: `awardRun({ ...runScore(game), cleared: survivedLongEnough })`.
3. **At run start.** `metaBonuses()` returns:

   ```js
   {
     economy: { startGold, income },        // add to the level's economy
     hero:    { hp, dmg, speed, cdr },      // the mod keys itemMods() speaks
     unlock:  { saveSlots, galaxyDepth, packSlots, currencyRate },
     nodes:   ['supply_cache', ...],
   }
   ```

   `economy` adds to the level's economy block before `new Game(...)`. `hero`
   adds to the hero modifier bag alongside item mods. `unlock.saveSlots` and
   `unlock.packSlots` are counts the shell adds to its own baselines.
4. **In the meta screen.** `metaTreeView()` returns the branches, their nodes in
   tier order, and each node's state (`owned`, `available`, `unaffordable`,
   `locked`). `spend(nodeId)` returns `{ ok, reason, node }` and writes nothing
   when it refuses.

## Storage

Meta state lives in local storage under `zillions_meta`, the same namespace as
`zillions_profile` and `zillions_save`. `setMetaBackend({ read, write })` hands
the same state to a server later. The two methods are synchronous and both may
fail; a write-behind client over an in-memory mirror satisfies the contract.

## Rules the wiring must keep

- Do not copy level data out of `src/galaxy.js`. `levelById()` stays the one
  lookup the simulation uses.
- Do not let a meta node change behavior. Effects are read once at run start.
- Do not let a labyrinth trial count as a world cleared. `applyAward()` already
  refuses it; the shell must not work around that.
- Update `GALAXY_HASH` in `scripts/galaxy-check.mjs` only when the galaxy layout
  is meant to change.
