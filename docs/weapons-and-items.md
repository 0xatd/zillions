# Weapons and Loot Depth

This system is shipped. This document records what was built and why, and the
decisions a change to it has to respect. Read `docs/skill-tree-integration.md`
for the Lattice, which this layer scales.

Owned by `src/items.js`. Checked by `scripts/item-check.mjs`,
`scripts/weapon-check.mjs`, `scripts/damage-type-check.mjs` and
`scripts/weapon-set-check.mjs`.

## The Blocker

An item is a string key into a static table. `ITEMS` in `src/config.js` holds
about forty authored entries. A character owns `items: ['oath_blade', ...]`.

The string reaches everywhere:

- `itemMods(items)` sums `ITEMS[key]` (`src/config.js:632`)
- the snapshot stores `loot: [key, x, z, hidden, cool]` (`src/game.js:257`)
- the hero pack stores keys (`src/game.js:2061`)
- the drop command addresses an index into that array (`src/game.js:2369`)
- profile grants dedupe with `items.includes(item)`
  (`src/mmo-characters.js:120`)

An action-RPG item is the opposite. It is an instance with rolled values, and
no two are alike. Rewriting Zillions to carry item instances means changing the
snapshot format, the lockstep hash, the drop command, the profile blob, and
every consumer at once. That is the change that would stall.

## The Resolution: Seeded Item Keys

Keep the string. Make the string a seed.

```
"scatter_mk2:7f3a91:62"   base : roll seed : item level
```

- Everything that stores, compares, serializes, or drops a string keeps
  working with no change.
- `itemMods()` gains a resolver. `resolveItem(key)` parses the key, generates
  the affixes, and caches the result.
- Generation is pure. The same key produces the same item on every peer, every
  machine, and every reload, forever.
- A key with no `:` resolves the old way. The forty authored items become
  uniques and every existing profile keeps working.

This is the whole trick, and it fits how this repository already works.
`galaxy.js`, `terrain.js` and `lanes.js` all generate their content from a
seed instead of storing it. Items become the fourth.

Two costs to accept:

- `recordMmoInstance()` dedupes with `.includes()`. Every rolled key is
  unique, so dedupe stops meaning anything. Replace it with a stash cap.
- Item names generate from the base and its affixes. Authored flavour moves
  into the base table and the affix table, which is where it belongs.

## Weapons Must Leave The Hero Definition

Today the weapon is the hero. `HEROES.scott` carries `dmg`, `range`, `rof`,
`speed`, `shotgun: true` and `splash: 1.7` directly. Nothing can be a weapon
while the weapon lives inside the class.

Split it:

- A new `WEAPONS` table owns `dmg`, `range`, `rof`, `crit`, `splash`, and the
  firing pattern.
- A hero definition keeps `hp`, `levelHp`, `levelDmg`, aura, ability, and a
  starting weapon reference.
- `heroDmg()`, `heroRange()` and the hero attack path read the equipped weapon
  instead of `h.def` (`src/game.js:2264`, `2302`, `2375`, `3490`, `3519`).

That is roughly six call sites. It is the highest-leverage refactor in this
plan, and every other system here waits on it.

Weapon classes then give the Lattice something to talk about. Scattergun,
marksman rifle, chainblade, sidearm and shield, heavy launcher, psi-focus.
Each is a different range, rate and splash profile, not a different number.
Scott becomes good with a scattergun instead of made of one.

## Damage Types Are The Prerequisite

This is the step that gets skipped, and then seven hundred tree nodes all feel
the same.

With one damage number, every affix and every node collapses into
`+X% damage`. Rolled gear is only interesting when rolls land on different
axes. Damage types are what make an affix a decision.

Zillions already has the seam. `_damageUnit(u, dmg, attacker)`
(`src/game.js:2952`) is a single choke point, and armour is already a
multiplicative reduction (`src/game.js:2873`, `2959`).

Use four types, not five: **Kinetic, Thermal, Shock, Void**. Enemies carry a
resistance per type. Four is the smallest number where a scattergun rolls
differently from a psi-focus and a resistance is worth reading.

Leave ailments out of the first release. Ignite, chill and shock stacks need
per-unit timers in the snapshot, they multiply the lockstep state, and a
twenty-minute run has no room for stack management.

## Take, Adapt, Refuse

| Reference system | Verdict | Reason |
| --- | --- | --- |
| Item bases with implicit mods | Take | Free once keys are seeded |
| Prefix and suffix pools with tiers | Take | This is the depth the request means |
| Item level gating affix tiers | Take | One number, and it ties loot to Threat and world tier |
| Rarity grades | Take | An affix-count budget and nothing more |
| Damage types and resistances | Take, staged | Prerequisite for all item depth |
| Weapon classes | Take | Unlocks weapons and the tree together |
| Critical strikes | Take | One weapon stat, one clean node axis |
| Local and global mod split | Adapt | Without it, weapon percent mods double-dip |
| Currency crafting | Adapt, later | A small deterministic bench, not twenty orbs |
| Sockets and support gems | Adapt, later | One ability per hero, so supports modify that ability |
| Six-plus equipment slots | Take, trimmed | Five slots, not ten |
| Flasks | Refuse | The run is twenty minutes and the input is already loaded |
| Ailment stacks | Refuse initially | Snapshot and lockstep cost |
| Trade and a player economy | Refuse | No server authority, and no way to make an item unforgeable |

## Slots

Head, chest, hands, legs, boots, weapon, off-hand, and two implants. Weapon and
off-hand also have a second set. Eleven equipment positions are available.
The field pack stays at `PACK_SLOTS = 4` and keeps its current job: what this
run picked up.

The equipment screen is a stub today. `src/ui.js:887` still renders
`No persistent equipment yet`. That stub is the place this lands.

## Attributes Gate Weapons

The Lattice document proposes three attributes: Frame, Reflex and Signal.
Give them a job here. A weapon base requires an attribute, and tree attribute
nodes are how a character reaches a weapon its class did not start near.

That turns the attribute walk into a real decision instead of a stat tax. A
Vox Officer that walks into Frame territory is buying a heavy launcher, not
buying a number.

## The Cheating Problem, Stated Plainly

Seeded keys mean a client can mint any item by writing a key. The backend is
not server-authoritative (`AGENTS.md`) and anti-cheat enforcement is
explicitly not shipped (`docs/design-vision.md`).

Two mitigations cost almost nothing:

- Every peer regenerates every item from its key at match start and folds the
  result into the lockstep hash. A forged key fails before window 0. This
  protects co-op, which is the part that matters.
- Derive the roll seed from the drop context: the run seed, the kill, and the
  world. An item that could not have dropped from any real run stays
  detectable later, without needing server authority now.

Do not build trade until a server owns item creation. Trade is what turns one
player's cheating into everyone's problem.

## Keep The Minute Readable

`docs/design-vision.md` commits to a direct and readable tactical game. Every
system in this document is chosen to resolve **before** the run starts and to
read as a plain number **during** it.

Gear, weapons, affixes and the Lattice all fold into the same mod bag in
`characterCamp()`. The simulation never queries an item, an affix, or a tree
node while it runs. Depth belongs between runs. The minute stays one hero, one
gold resource, and one input.

## What Shipped

All seven stages, in this order. Weapons and damage types came before the tree,
because they are what make tree nodes differ from each other.

1. Seeded item keys and the resolver. No new content; old keys still resolve.
2. The weapon block left the hero definition. Signature weapons are generated
   from each hero's own stats, so no balance value moved.
3. Affix pools, item level and rarity, then world loot rolling.
4. Damage types and resistances through the existing damage choke point.
5. The equipment screen, replacing the stub.
6. The Lattice, sized against real weapons and real damage types.
7. Weapon-set swap, and Lattice nodes pinned to a set.

Stage 7 reversed an earlier recommendation. Rejecting weapon-set specialisation
was right while every hero carried one fixed weapon; once stage 2 shipped, a
second set became a real decision and the feature earned its cost.

## Rules A Change Here Must Keep

- An unequipped hero fights with their signature weapon, and that weapon is
  generated from the hero definition. `weapon-check.mjs` asserts it byte for
  byte at levels 1, 10, 40 and 100. Weapons must never move a bare hero's
  numbers.
- Item generation is pure and uses its own stream. It must never touch the
  simulation random source.
- Local weapon mods never enter the global bag.
- A damage source that passes no type split takes the pre-types path exactly.
- Read items through `itemInfo()`. A direct `ITEMS[key]` read renders a blank
  for anything the world rolled, and `character-sheet-check.mjs` fails on one.
- Equipment, doctrines, resolved weapon stats and the drawn set are in the
  lockstep hash. Keep them there.

## Still Not Built

- Sockets and support gems.
- Currency crafting.
- Trade. This one is a hard block, not a backlog item: seeded keys mean a
  client can mint any item, and there is no server authority. Peers regenerate
  every item from its key and hash the result, which protects co-op. Trade
  would turn one player's cheating into everyone's problem, and it must wait
  for a server that owns item creation.
- Ailment stacks.

## Hub Vendor

The Orbital Exchange uses deterministic rotating stock. Item value is derived
from item level, rarity, and affix count. The buy multiplier is higher than the
sell multiplier, so a player cannot create Alloy by buying and reselling.
`src/vendor.js` owns this rule. `scripts/vendor-check.mjs` proves stable stock,
insufficient-funds rejection, stash limits, and the no-flip invariant.

The current transaction path is the offline/local implementation. Do not turn
on trade or paid inventory until the same contract is enforced by a server.
