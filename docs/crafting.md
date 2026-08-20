# Crafting Domain

`src/crafting.js` owns pure crafting and socket rules. It does not own an
inventory, a material balance, Salvage Alloy, or persistence.

## Item input

The authority layer supplies an item instance with this shape:

```js
{
  instanceId: 'stable-item-id',
  ownerId: 'character-id',
  itemKey: 'scatter_mk3:seed:70:3',
  revision: 4,
  sockets: [{ color: 'frame', type: 'optic', component: null }]
}
```

`itemKey` uses the deterministic item schema in `src/items.js`. Crafting
preserves `instanceId` and `itemKey`. Each successful mutation adds one to
`revision`.

Old string-only items do not have enough identity for secure crafting. The
authority migration must wrap each old item in one stable instance record.
Do not derive a production instance ID from the item key. Two identical keys
can represent two different owned items.

## Socket language

Socket colors use the existing character attributes: Frame, Reflex, Signal,
and Prismatic. A Prismatic socket accepts any color.

Socket types follow equipment function. Optic sockets belong to weapons and
hands. Ward sockets belong to visible defensive armor. Drive sockets belong
to off-hands and implants.

An item can have one to three sockets. Item slot, item level, and rarity set
the cap. Components have a stable instance ID, one type, one color, and ranks
one through five. Each component defines a bounded per-rank effect with the
existing `MOD_KEYS` vocabulary. `socketComponentMods()` resolves equipped
component effects and de-duplicates component instance IDs.

## Authority integration

Call `evaluateRecipe()`, `evaluateSocketInsert()`, or
`evaluateSocketRemove()`. A successful result contains the expected and next
revision, the next item snapshot, costs, provenance, and a UI message. The
mutation also declares component `consume` and `return` operations. Insertions
consume the loose component instance. Removals return that same instance.

The authority layer must apply all inputs and outputs in one transaction. It
must lock the item revision, verify ownership again, debit costs, consume or
return component instances, store provenance, and record `requestId` before it
commits. A repeated request returns `duplicate_request`. A competing mutation
returns `stale_revision`.

The domain result is a proposal. It is not proof that the mutation committed.
The UI must display success only after the authority layer commits it.

## Check

Run `node scripts/crafting-check.mjs`. The check covers deterministic results,
ownership, replay rejection, stale revisions, socket compatibility, caps,
costs, component upgrades, removal capacity, and provenance.
