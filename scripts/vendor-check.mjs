import assert from 'node:assert/strict';
import { memoryBackend, setMetaBackend, resetMeta, loadMeta } from '../src/meta.js';
import { makeMmoCharacter } from '../src/mmo-characters.js';
import { vendorStock, vendorBuyPrice, vendorSellPrice, buyVendorItem, sellVendorItem } from '../src/vendor.js';

setMetaBackend(memoryBackend());
resetMeta();
const a = vendorStock('week-1', 35);
const b = vendorStock('week-1', 35);
assert.equal(a.length, 12);
assert.deepEqual(a.map((x) => x.key), b.map((x) => x.key), 'vendor stock must be deterministic');
assert.ok(a.every((x) => x.price === vendorBuyPrice(x.key)));
assert.ok(a.every((x) => vendorSellPrice(x.key) < x.price), 'vendor flipping must always lose Alloy');

const character = makeMmoCharacter('Shopper');
assert.equal(buyVendorItem(character, a[0]).reason, 'poor');
const meta = loadMeta(); meta.currency = 10000; meta.lifetime.earned = 10000;
const bought = buyVendorItem(character, a[0]);
assert.ok(bought.ok && character.items.length === 1);
const beforeSale = loadMeta().currency;
const sold = sellVendorItem(character, 0);
assert.ok(sold.ok && character.items.length === 0);
assert.equal(loadMeta().currency, beforeSale + sold.value);
console.log('vendor-check: deterministic stock and atomic buy/sell hold');
