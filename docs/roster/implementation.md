# Four-hero implementation — in progress

Alex reduced scope on 2026-11-23 to Lina, Sniper, Axe and Sven.
and the roster expansion is not approved for production. The chapter candidate
is PR140; expanded combat work is isolated on `codex/hero-roster` above it.

Reference inventory: 127 names/ability identifiers retrieved from OpenDota's
`dotaconstants` on 2026-11-22. This is an auditable inventory, not proof of the
latest official patch and not a source of imported art/audio/descriptions.

## Implemented locally

- Six independent ability slots; Q/E/R, secondary modifier for the other three.
- Point/enemy targeting, cancellation, bounded guest commands, mana and regen.
- Pending wave, delayed blast, delayed single-target bolt and ground-zone effects.
- Charge recovery, aim interruption, temporary aim buffs, on-hit passives.
- Snapshot/hash coverage for effects, targets, hit history, charges and cooldowns.
- Named leader mapping survives normalization instead of reverting to its class.
- Academy recruitment for Lina; conquest-discovered Sniper; human-only or open
  recruitment culture. Owned companions are retained when culture changes.
- Lina: Dragon Slave, Light Strike Array, Laguna Blade, Fiery Soul.
- Sniper: Shrapnel, Take Aim, Headshot, Assassinate, a knockback grenade and
  distance-scaled attack damage.

- Axe: Berserker's Call, Battle Hunger, Counter Helix and Culling Blade.

## Explicit remaining scope

- The other reference heroes are out of scope, not queued for implementation.
- Current four kits are siege adaptations, NOT exact Dota parity: three rank
  bands; no talent/facet system; Lina's Flame Cloak/Slow Burn are not implemented;
  Sniper's vision cone/reveal and some item-upgrade/kill-refresh rules are not
  implemented. His grenade currently staggers rather than applying disarm.
- Axe still lacks the One Man Army innate and allied Culling Blade kill buff;
  Battle Hunger currently slows regardless of enemy facing.
- Authored world encounter choices, factions beyond recruitment restrictions,
  numbered recruits and prime variants are unfinished.
- Legacy named leaders still exist to preserve characters; replacing them with
  distinct completed kits needs a deliberate nondestructive mapping.
- No new patch-specific innate/talent system or imported character art.
- Full signed-in reward/lobby/reconnect/Watch release smoke must be rerun for
  the expanded combat branch. Chapter PR140's evidence is not this branch's proof.

## Checks required for each kit

Cast effect, valid/invalid targets, resource costs, cooldowns, passives, interrupts,
rank changes, deaths, terrain interaction, snapshot continuation, lockstep guest
payloads and real mouse/touch controls. Never mark a name or reskinned generic
spell as a completed hero. Record remaining mechanics, not just a green count.

- Sven: Storm Hammer, Warcry, Gods Strength and Great Cleave. Siege-adapted numbers; no facets, talents or item upgrades.
