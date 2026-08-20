import assert from 'node:assert/strict';
import { makeMmoCharacter } from '../src/mmo-characters.js';
import { VENDORS, vendorStock, vendorRotation, vendorEligibility, vendorBuyPrice, vendorSellPrice, purchaseRequest, saleRequest, submitVendorMutation } from '../src/vendor.js';

const character = makeMmoCharacter('Shopper');
const rotation = vendorRotation('quartermaster', Date.UTC(2026, 7, 19));
for (const vendor of Object.values(VENDORS)) {
  assert.ok(vendorEligibility(vendor.id, { level: 100 }).ok);
  const a = vendorStock(vendor.id, rotation, 100);
  const b = vendorStock(vendor.id, rotation, 100);
  assert.equal(a.length, vendor.size);
  assert.deepEqual(a.map((offer) => offer.key), b.map((offer) => offer.key), `${vendor.id} stock drifted`);
  assert.ok(a.every((offer) => vendor.slots.includes(offer.item.slot)), `${vendor.id} leaked another vendor's slot`);
  assert.ok(a.every((offer) => offer.price === vendorBuyPrice(offer.key)));
  assert.ok(a.every((offer) => vendorSellPrice(offer.key) < offer.price), 'vendor flipping must lose Alloy');
}
assert.deepEqual(vendorStock('cyberneticist', 'week-1', 1), [], 'progression-locked stock must stay hidden');
assert.equal(vendorEligibility('cyberneticist', character).requiredLevel, 12);

const offer = vendorStock('quartermaster', rotation, 35)[0];
const buy = purchaseRequest({ requestId: 'req-buy-1', actorId: 'user-1', characterId: character.id, vendorId: 'quartermaster', offer });
assert.ok(buy.ok && Object.isFrozen(buy.request));
const before = JSON.stringify(character);
assert.deepEqual(await submitVendorMutation(null, buy), { ok: false, reason: 'authority_unavailable' });
assert.equal(JSON.stringify(character), before, 'vendor domain mutated the character without authority');

let received = null;
const authority = { executeVendorMutation: async (request) => { received = request; return { ok: true, auditId: 'audit-1' }; } };
assert.deepEqual(await submitVendorMutation(authority, buy), { ok: true, auditId: 'audit-1' });
assert.deepEqual(received, buy.request, 'authority must receive the exact immutable contract');

const sale = saleRequest({ requestId: 'req-sell-1', actorId: 'user-1', characterId: character.id, vendorId: 'outfitter', itemInstanceId: 'item-1', itemKey: offer.key });
assert.ok(sale.ok);
assert.equal(sale.request.action, 'vendor_sale');
assert.equal(sale.request.quotedPrice, vendorSellPrice(offer.key));
assert.equal(purchaseRequest({}).reason, 'invalid_identity');
console.log('vendor-check: specialist pools, deterministic restocks, quotes, and injected authority hold');
