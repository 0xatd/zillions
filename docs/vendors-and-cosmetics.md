# Vendors and Cosmetics

## Vendor catalogue

`src/vendor.js` defines three deterministic specialist vendors. The Frontier
Quartermaster sells weapons and off-hands. The Voidline Outfitter sells visible
armor. The Chassis Laboratory unlocks at level 12 and sells implants. Each has
a separate stock pool, stock size, and restock interval.

Clients can show quotes. They cannot complete transactions. Use
`purchaseRequest()` or `saleRequest()` to create an immutable versioned
contract. Pass it to `submitVendorMutation()`. The injected authority must
atomically validate identity, ownership, current stock and price, capacity,
currency, request-id idempotency, and the audit record. Until that authority
exists, the function returns `authority_unavailable`. Do not add browser-side
fallback mutations. Salvage Alloy is the only quoted currency.

## Cosmetic catalogue

`src/cosmetics.js` defines every launch Human and Robot appearance option.
Every option is free. Each entry points to a concrete renderer recipe with a
primitive, variant, scale, and material family. Shared colors use a material
recipe. The creator, paper doll, and live model must consume these recipes.

Do not add a catalogue entry without a renderer mapping. Run
`node scripts/cosmetic-check.mjs` to check this contract. Future cosmetics can
use the entitlement field, but no launch option is gated.
