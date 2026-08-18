# Future Design: The Lattice

This document describes a future system. It is not a current-state
specification. Read `docs/product-contract.md` for shipped product rules.

The Lattice is a large shared passive tree for MMO characters. It borrows the
mechanical structure of an action-RPG passive tree. It uses Zillions names,
Zillions stat keys, and Zillions data only.

## Why This System

Three progression systems exist today and only two of them do a job.

| System | Owner | Scope | State |
| --- | --- | --- | --- |
| Hero upgrades | `src/config.js`, `src/game.js` | one run | shipped |
| Meta tree | `src/meta.js` | account | shipped as data, no screen |
| Character talent points | `src/mmo-characters.js` | character | granted, never spent |

`grantMmoExperience()` adds one talent point per level to level 100. Nothing
spends it. A character at level 40 holds 39 dead points. The Lattice is the
spend surface for those points.

Give each system one job:

- Hero upgrades own the minute and the planet. Four keys, rank 3, nine points.
- The Lattice owns the character. One point per level plus campaign points.
- The meta tree owns the account. Unlocks and economy only.

Move the meta tree's `warband` branch into the Lattice. Two systems that both
sell hero damage compete for the same balance budget and double-dip.

## What To Copy From The Reference Tree

Copy structure. Do not copy content.

Copy:

- One shared graph for every class. A class picks a start position, not a tree.
- Four node grades: attribute, small, notable, keystone.
- A point budget far smaller than the node count, so a build excludes more
  than it takes.
- Allocation legality by graph connectivity from the class start.
- Paid respec in an existing currency.
- A named subtree unlocked by a campaign milestone.
- Separate additive and multiplicative damage scaling.

Do not copy in the first release:

- Socketed jewels and radius effects. They need a spatial query system.
- Weapon-set node specialization, while every hero carries one fixed weapon.
  The feature would double the UI and the lockstep hash surface for no
  decision. `docs/weapons-and-items.md` revisits this. Once weapons become
  equipment, a second set is a real choice and the feature earns its cost.
- Node counts near two thousand. That is a decade of content maintenance.

Never copy:

- Node names, node descriptions, icons, coordinates, or exported tree JSON.
  That data belongs to its publisher. The official and community exports are
  reference material for structure, not a source to import.

## Naming

One term for one concept, everywhere it is shown.

| Reference concept | Zillions term |
| --- | --- |
| Passive skill tree | the Lattice |
| Passive point | Lattice point |
| Small passive | Trace |
| Notable passive | Relay |
| Keystone | Doctrine |
| Attribute node | Frame, Reflex, or Signal node |
| Class start | Origin |
| Tree region | Sector |
| Ascendancy | Allegiance |
| Respec | Rewire |
| Respec currency | Salvage Alloy |

## Shape

- About 720 nodes. About 90 Relays. About 14 Doctrines. 13 Origins on a ring,
  one for each entry in `MMO_CLASSES`.
- About 120 Lattice points at cap: 99 from levels, the rest from Earth
  missions and the quest table already in `LEVELS[].quests`.
- Three attributes: Frame, Reflex, Signal. An Origin sits near the arc that
  matches its class resource. A Frame character can still walk to Signal
  Sectors. The walk is the cost.
- A Trace grants one or two small values on the mod keys that already exist.
- A Relay grants a named payoff worth roughly four Traces.
- A Doctrine changes a rule and carries a stated downside.

## Effects Are Data

`src/meta.js` already states the rule this system must follow. A node's
payload is a bag of numbers. No node carries behaviour. The simulation reads
the bag once at run start.

Traces and Relays write to the keys `itemMods()` already speaks:

```
hp regen magnet dmg rof range speed cdr auraR troopDmg towerDmg buildingHp income
```

That is the whole integration for two node grades. `_spawnHero()` folds the
Lattice bag into `h.mods` beside `itemMods` and `_heroPassiveMods`, and every
consumer downstream keeps working.

Doctrines are the exception. A Doctrine cannot ship behaviour in data without
breaking snapshot restore and lockstep. A Doctrine is a flag:

```js
camp.doctrines = ['scorched_supply', 'lone_command'];
```

`src/game.js` owns an explicit rule for each flag in simulation code. Adding a
Doctrine is a code change with a regression check, not a data row. Cap the
count at what the simulation can carry.

## Additive And Multiplicative

Hero mods are additive today. `game.js` applies `1 + h.mods.dmg`. Ten sources
of `+10%` produce `2.0`. That is correct at the current source count and wrong
at 120 allocated nodes.

Adopt the split before the tree ships, not after:

- Traces and Relays grant additive percent. They sum into `h.mods`.
- A Doctrine may grant a multiplier. Multipliers apply after the additive sum.

This is one new mod group in `_refreshHeroDerived()` and it is the single most
valuable mechanic to take from the reference design.

## Generation, Not Authoring

Do not hand-place 720 nodes. Generate them, the way `terrain.js`, `lanes.js`
and `galaxy.js` already generate their structures.

`src/skilltree.js` builds the graph from a fixed seed plus an authored Sector
table. The authored table holds Sector identity, Relay payoffs and Doctrine
rules. The generator fills Traces, positions, and edges. Roughly 200 lines of
authored data produce the whole tree, and the result is stable across
sessions, peers, and machines because the seed is fixed.

The module stays headless and Three-free, like `terrain.js` and `meta.js`, so
`scripts/skilltree-check.mjs` can drive the whole surface in plain Node.

## Storage And Migration

An allocation is a set of node ids. Store it sorted and compact on the
character, next to a tree version:

```js
{ treeV: 1, alloc: [12, 48, 49, 130, ...], doctrines: [...] }
```

Character state syncs through `user_metadata.mmo_characters` in `src/auth.js`,
capped at eight characters. A compact id array fits. A real `characters` table
is the right destination once the Lattice ships; the blob is the weak link in
this path, not the Lattice.

`normalizeMmoCharacters()` must prune the same way `normalizeMeta()` prunes:
drop any node that is unknown, or unreachable from the Origin, and refund its
point. A tree that changes shape between releases must never brick a
character. Rewire follows the same path with a Salvage Alloy cost.

## Determinism

- Resolve the allocation to a mod bag and a Doctrine list at run start, in
  `characterCamp()`. Nothing reads the tree during a run.
- `main.js` already folds `upgrades` into the lockstep hash. Fold `alloc` and
  `doctrines` in with it. Two peers with different allocations must fail the
  check before window 0, not desync at minute six.
- The generator uses its own fixed seed. It must never touch the simulation
  random source.

## Delivery

One focused pull request each. Each lands with a committed check.

`docs/weapons-and-items.md` puts weapons and damage types ahead of this
sequence. Follow that order. Tree nodes cannot differ from each other until
damage has more than one axis, so the Lattice is sized after weapons ship.

1. `src/skilltree.js` and `scripts/skilltree-check.mjs`. Generator, validators,
   `treeBonuses(alloc)`. No UI. No game hookup. Verifies every node reachable,
   every Relay in a Sector, point budget under node count, stable output for a
   fixed seed.
2. Character wiring. Spend, refund, prune, cloud sync, lockstep hash. Extends
   `scripts/mmo-character-check.mjs`.
3. The screen. Pan and zoom canvas in `src/ui.js` on the character sheet.
   Search, path preview, Rewire.
4. Run integration. `characterCamp()` folds the bag. `game.js` reads Doctrine
   flags. Additive and multiplicative split. Extends
   `scripts/balance-check.mjs`.
5. Meta tree cleanup. Retire the `warband` branch, refund its Alloy.
6. Allegiance subtrees. One per class, unlocked by an Earth milestone, sized
   at six points. This is where the Folk direction in `docs/design-vision.md`
   attaches to a character.

Stages 1 and 2 are safe to build before the art and copy exist. Stage 4 is the
one that touches the simulation, and it is the one that needs the browser
smoke test in `AGENTS.md`.
