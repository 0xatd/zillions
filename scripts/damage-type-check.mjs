// Damage types are the axis that makes rolled gear and tree nodes differ from
// each other. This check holds two things at once: that the axis works, and
// that adding it changed nothing for any damage source that does not use it.
import { Game } from '../src/game.js';
import { TILE, ZOMBIES, DAMAGE_TYPES, RESIST_CAP, VOID_ARMOR_SHARE } from '../src/config.js';

let failures = 0;
const fail = (msg) => { console.error(`FAIL: ${msg}`); failures++; };
const ok = (cond, msg) => { if (!cond) fail(msg); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

function fakeMap() {
  const size = 48;
  return {
    size, seed: 777, sites: [], nestSpots: [], nodeSpots: [],
    tiles: new Uint8Array(size * size).fill(TILE.GRASS),
    idx: (x, z) => z * size + x,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isBuildable: () => true, isWalkable: () => true,
  };
}
const game = new Game(fakeMap(), 'normal', ['scott'], null, 1, 'campaign');

// A bare target with whatever armour and resistance the case needs.
const target = (armor = 0, resist = null) => ({ hp: 1e9, maxHp: 1e9, armor, def: { resist }, resist: null });
const hit = (t, dmg, types) => game._resolveTypedDamage(t, dmg, types);

// ---------- the untyped path is byte-identical to the old one ----------
for (const armor of [0, 0.1, 0.35, 0.6, 0.9]) {
  for (const dmg of [1, 37.5, 1000]) {
    const expected = armor ? dmg * (1 - armor) : dmg;
    ok(near(hit(target(armor), dmg, null), expected),
      `untyped damage changed at armour ${armor}: got ${hit(target(armor), dmg, null)}, expected ${expected}`);
  }
}

// ---------- a pure type against no resistance equals the untyped path ----------
for (const type of DAMAGE_TYPES) {
  const t = target(0.3);
  const typed = hit(t, 100, { [type]: 1 });
  const untyped = hit(t, 100, null);
  if (type === 'void') {
    ok(typed > untyped, 'void did not bypass any armour');
    ok(near(typed, 100 * (1 - 0.3 * VOID_ARMOR_SHARE)), 'void armour share is not being applied');
  } else {
    ok(near(typed, untyped), `${type} against no resistance diverged from the untyped path`);
  }
}

// ---------- resistance reduces, vulnerability amplifies ----------
ok(hit(target(0, { thermal: 0.5 }), 100, { thermal: 1 }) < 100, 'resistance did not reduce damage');
ok(near(hit(target(0, { thermal: 0.5 }), 100, { thermal: 1 }), 50), 'resistance math is wrong');
ok(hit(target(0, { thermal: -0.5 }), 100, { thermal: 1 }) > 100, 'negative resistance did not amplify');
ok(near(hit(target(0, { thermal: -0.5 }), 100, { thermal: 1 }), 150), 'vulnerability math is wrong');
ok(near(hit(target(0, { shock: 0.4 }), 100, { thermal: 1 }), 100), 'the wrong resistance applied');

// A resistance can never make anything immune.
const capped = hit(target(0, { thermal: 5 }), 100, { thermal: 1 });
ok(capped > 0, 'a huge resistance produced immunity');
ok(near(capped, 100 * (1 - RESIST_CAP)), `resistance cap not enforced: ${capped}`);

// ---------- a split weapon resolves each part separately ----------
{
  const t = target(0, { thermal: 0.5, kinetic: 0 });
  const split = hit(t, 100, { thermal: 0.5, kinetic: 0.5 });
  ok(near(split, 50 * 0.5 + 50), `split damage resolved wrong: ${split}`);
}
// Shares always represent the same total damage before resistance.
{
  const t = target(0);
  for (const types of [{ kinetic: 1 }, { thermal: 0.5, shock: 0.5 }, { kinetic: 0.25, thermal: 0.25, shock: 0.25, void: 0.25 }]) {
    const total = hit(t, 100, types);
    const expected = types.void ? 100 : 100;
    ok(near(total, expected), `a ${Object.keys(types).join('/')} weapon changed total damage: ${total}`);
  }
}

// ---------- the authored resistances actually create a choice ----------
{
  const brute = target(0, ZOMBIES.brute.resist);
  ok(hit(brute, 100, { thermal: 1 }) > hit(brute, 100, { kinetic: 1 }), 'thermal should beat kinetic against a brute');
  ok(hit(brute, 100, { shock: 1 }) < hit(brute, 100, { kinetic: 1 }), 'shock should be poor against a brute');

  const sieger = target(0, ZOMBIES.sieger.resist);
  ok(hit(sieger, 100, { shock: 1 }) > hit(sieger, 100, { kinetic: 1 }), 'shock should beat kinetic against a sieger');

  const caller = target(0, ZOMBIES.caller.resist);
  ok(hit(caller, 100, { void: 1 }) > hit(caller, 100, { kinetic: 1 }), 'void should beat kinetic against a caller');

  // And the common horde must be untouched, or the whole early game moved.
  for (const type of ['walker', 'runner']) {
    ok(!ZOMBIES[type].resist, `${type} carries a resistance — the common horde must stay neutral`);
  }
}

// ---------- resistances are legal ----------
for (const [key, def] of Object.entries(ZOMBIES)) {
  if (!def.resist) continue;
  for (const [type, value] of Object.entries(def.resist)) {
    ok(DAMAGE_TYPES.includes(type), `${key}: resists unknown type "${type}"`);
    ok(value >= -1 && value <= 1, `${key}: resistance ${type}=${value} is out of range`);
  }
}

// ---------- a signature weapon still hits for exactly what it always did ----------
{
  const h = game.heroes[0];
  const zb = target(0.25);
  const raw = game.heroDmg(h);
  ok(near(hit(zb, raw, h.weapon.types), hit(zb, raw, null)),
    'a signature weapon no longer deals its pre-types damage');
}

if (failures) {
  console.error(`\ndamage-type-check: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`damage-type-check: ok (${DAMAGE_TYPES.length} types, untyped path unchanged, cap at ${RESIST_CAP})`);
