# Colony builder orders

A siege has one shared, visible crew. It starts paused when the city is founded.
The host chooses an order beside the army controls. Other players see its work
but cannot change the shared spending policy. The host may still pause or
change policy while their hero is down. Manual construction still works.
Labyrinth has no crew or builder controls.

## Orders

- Maintain repairs and rebuilds existing structures without buying upgrades.
- Develop balances income, camps and gate towers in existing holdings.
- Fortify constructs and upgrades walls, gate towers and the Keep.
- Prosper prioritises income improvements in existing holdings.
- Mobilize prioritises troop-production camps in existing holdings.
- Expand secures one reachable frontier fort or captured node before moving to
  another. Road-fort defenses come before other work. It does not capture nodes
  or place new plots; the hero and army must hold the ground.

An existing road fort means all its planned walls and gate defenders have been
built. A captured satellite becomes an existing holding after its first camp.
Ordinary repair is available everywhere safe; severely damaged structures and
breaches outrank new work. Outside Maintain, trivial wear is left for later so
it cannot consume every purchase. Buildings under immediate enemy pressure are
not safe work sites: escort the crew or push enemies back.

## Spending and choices

The default protected reserve is 10 gold, adjustable from 0 to 1000. A new job
requires its full price above the reserve; coins stream only while the crew is
at a valid work position. If another player spends during work, the crew waits
without violating the reserve. Pause, order changes, invalid targets, manual
work on the same plot and retreat refund uncompleted construction escrow.
Already restored health is never refunded. Completed work uses the same cost,
repair budget, construction and rebuild methods as manual work.

Tower and wall specialisations default to Ask me. Set Long range / Anti-horde
and Armor / Shock to authorise future crew choices. Existing choices never
change. A queued specialisation is committed only when construction completes;
cancelling unfinished work does not consume that choice. With Ask me, the crew skips those upgrades and reports Choose a
specialisation if nothing else can be done. These preferences make a complete
builder-led mission possible without a hidden irreversible choice.

## Crew lifecycle

The crew follows a cardinal global route to a reachable work point outside a
new structure's footprint. It rechecks occupied route tiles and current target
state. Unsafe routes are skipped. It retreats toward the Keep when enemies
come close. An aggro melee enemy with no other living target can bite the crew at its
normal attack cooldown. The bite has the same visible attack event as combat;
stunned, idle and already-engaged enemies cannot inflict proximity damage.
If overwhelmed, it
recovers at the Keep after 25 seconds without a replacement fee or reward.
It cannot attack, scout territory, capture nodes or join army formations.

## State and validation

`src/builders.js` owns deterministic scoring, routing, crew state and refundable
construction escrow. `Game` integrates commands, founding, updates and
snapshots. The full crew state affects the lockstep hash, including its route,
job, policy, timers and escrow. Commands require host seat zero, an existing host
hero, a live siege and valid order/reserve/doctrine values. The host can manage
orders while their hero is down. No backend or account
economy is involved.

## Verification

`tests/builders.test.mjs` exercises real spending, movement, work completion,
reserve and authority guards, pause refunds, manual precedence, recovery,
strategy eligibility, existing holdings, pinned expansion, branch preferences,
minor-damage starvation, and snapshot/hash agreement.

`node scripts/playthrough-stuck-check.mjs 1 20 --builders --report` runs the hero
combat bot with Develop and explicit wall/tower preferences; it never issues a
manual purchase. It retains the normal movement and mid-fight restore checks.
This verifies a complete mission, not subjective combat quality.

### Physical construction and blocked retreats

The crew participates in the same fresh-foundation and sealed-pocket ejection
as troops, including while paused. Ejection clears its old route so the next
job approach is recomputed from the new position. A blocked retreat does not
teleport the crew or repeatedly search every frame: it retries after the
normal two-second planning cooldown. `tests/builder-physics.test.mjs` covers
both cases with failing-before regressions.
