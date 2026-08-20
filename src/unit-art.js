// Articulated procedural models for every troop and hero. One shared humanoid
// rig — separate hip and shoulder pivots the renderer's stride animation can
// swing — dressed per corps and per hero, so a ranger, a trooper and a sniper
// finally read apart at gameplay zoom and each hero is unmistakably themselves.
//
// Presentation only. Models never change the deterministic unit radius,
// collision, or any simulation state. The authored GLB path (art-slice) still
// wins where an authored asset exists; these are the "procedural fallback"
// the production-art rules keep alive — now worth looking at.
import * as THREE from 'three';
import { applyRim } from './tactical-visuals.js';
import { itemInfo } from './config.js';
import { COSMETIC_RENDERERS } from './cosmetics.js';

// Warm daylight rim on friendly silhouettes (same grammar main.js used).
const M = (c, e = 0) => applyRim(
  new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.38, color: c, emissive: e ? c : 0x000000, emissiveIntensity: e }),
  { color: 0xfff3e0, power: 2.2, strength: 0.42 },
);

const shade = (hex, f) => new THREE.Color(hex).multiplyScalar(f).getHex();

function mesh(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}
const box = (parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) =>
  mesh(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
const sph = (parent, mat, r, x, y, z, sx = 1, sy = 1, sz = 1) => {
  const m = mesh(parent, new THREE.SphereGeometry(r, 10, 8), mat, x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
};
// Capsule: the body-part primitive. Along +Y before rotation; smooth normals.
const cap = (parent, mat, r, len, x, y, z, rx = 0, ry = 0, rz = 0) =>
  mesh(parent, new THREE.CapsuleGeometry(r, len, 4, 10), mat, x, y, z, rx, ry, rz);
const cyl = (parent, mat, r1, r2, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 8) =>
  mesh(parent, new THREE.CylinderGeometry(r1, r2, h, seg), mat, x, y, z, rx, ry, rz);
const cone = (parent, mat, r, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 6) =>
  mesh(parent, new THREE.ConeGeometry(r, h, seg), mat, x, y, z, rx, ry, rz);

// ---------------- the shared rig ----------------
// Origin at the feet, +Z forward. Legs pivot at the hip, arms at the
// shoulder, all with rest rotation 0 — exactly what _syncUnits' stride
// animation expects of authored limbs.

function humanoid({
  bulk = 1, tall = 1,
  armor, cloth, boot = 0x26282c, shell = 0xd9d3c3,
  visor = 0x35ff70, visorWide = false, visorVisible = true, pack = 0x4a4d52,
  skirt = false, legless = false,
}) {
  const root = new THREE.Group();
  const W = bulk, H = tall;
  const armorM = M(armor), clothM = M(cloth ?? shade(armor, 0.55)), bootM = M(boot);
  const shellM = M(shell), packM = M(pack);

  const limbs = {};
  if (!legless) {
    for (const s of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(s * 0.09 * W, 0.42 * H, 0);
      cap(leg, clothM, 0.052 * W, 0.13 * H, 0, -0.1 * H, 0);               // thigh
      cap(leg, bootM, 0.046 * W, 0.13 * H, 0, -0.28 * H, 0.005);           // shin
      sph(leg, bootM, 0.055 * W, 0, -0.4 * H, 0.04, 1, 0.55, 1.6);         // boot
      root.add(leg);
      limbs[s < 0 ? 'legL' : 'legR'] = leg;
    }
    sph(root, clothM, 0.13 * W, 0, 0.45 * H, 0, 1.05, 0.6, 0.75);          // pelvis
  }
  const torso = new THREE.Group();
  torso.position.y = 0.5 * H;
  root.add(torso);
  cap(torso, armorM, 0.135 * W, 0.14 * H, 0, 0.16 * H, 0);                  // cuirass core
  const cuirass = sph(torso, armorM, 0.15 * W, 0, 0.2 * H, 0, 1.15, 1.05, 0.78); // barrel chest
  cuirass.castShadow = true;
  box(torso, shellM, 0.2 * W, 0.13 * H, 0.045, 0, 0.2 * H, 0.1 * W + 0.025); // chest plate
  if (skirt) cone(torso, clothM, 0.26 * W, 0.5 * H, 0, -0.16 * H, 0, 0, 0, 0, 10);

  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.2 * W, 0.78 * H, 0);
    sph(arm, armorM, 0.095 * W, s * 0.025 * W, 0.02, 0);                   // pauldron
    cap(arm, armorM, 0.042 * W, 0.1 * H, 0, -0.11 * H, 0);                 // upper arm
    cap(arm, clothM, 0.037 * W, 0.1 * H, 0, -0.27 * H, 0.015);             // forearm
    sph(arm, bootM, 0.048 * W, 0, -0.37 * H, 0.02, 1, 0.8, 1.15);          // glove
    root.add(arm);
    limbs[s < 0 ? 'armL' : 'armR'] = arm;
  }
  const head = new THREE.Group();
  head.position.y = 0.94 * H;
  root.add(head);
  sph(head, shellM, 0.105 * W, 0, 0.03, 0, 0.95, 1.05, 0.95);               // dome helmet
  if (visorVisible) mesh(head, new THREE.BoxGeometry(visorWide ? 0.15 * W : 0.12 * W, 0.042, 0.03), M(visor, 0.9), 0, 0.035, 0.095 * W);
  box(root, packM, 0.24 * W, 0.26 * H, 0.12, 0, 0.62 * H, -0.16 * W - 0.03); // life-support pack

  return { root, limbs, torso, head, armM: armorM, clothM, shellM, bootM };
}

// Weapon helpers. Ranged weapons ride the torso (steady aim); melee weapons
// ride a hand so the stride and the swing carry them.
function track(list, m) {
  m.userData.restPos = m.position.clone();
  m.userData.restRot = m.rotation.clone();
  list.push(m);
  return m;
}

function rifle(parent, weapons, { len = 0.62, barrel = 0x232426, stock = 0x3a3228, scope = 0, suppressor = 0, y = 0.56, x = 0.2 }) {
  const g = new THREE.Group();
  g.position.set(x, y, 0.18);
  parent.add(g);
  box(g, M(barrel), 0.07, 0.08, len, 0, 0, 0);
  box(g, M(stock), 0.06, 0.09, 0.14, 0, -0.01, -len * 0.42);
  box(g, M(barrel), 0.05, 0.09, 0.05, 0, -0.07, 0.06);                     // grip + mag
  if (scope) cyl(g, M(0x1a1b1d), 0.028, 0.028, 0.12, 0, 0.065, -0.04, Math.PI / 2, 0, 0, 6);
  if (suppressor) cyl(g, M(0x30322f), 0.035, 0.035, 0.16, 0, 0, len / 2 + 0.06, Math.PI / 2, 0, 0, 6);
  return track(weapons, g);
}

// ---------------- troops ----------------

function rangerModel(d) {
  const weapons = [];
  const rig = humanoid({ armor: d.color, cloth: 0x3d5236, bulk: 0.92, pack: 0x585444 });
  // Scout kit: hood thrown back, cloak, bedroll across the pack, light carbine.
  cone(rig.head, M(0x3d5236), 0.13, 0.14, 0, 0.02, -0.09, -0.5, 0, 0, 6); // hood, down
  box(rig.torso, M(0x33452e), 0.3, 0.3, 0.04, 0, 0.05, -0.16, 0.12, 0, 0); // cloak
  cyl(rig.root, M(0x6b5b40), 0.05, 0.05, 0.3, 0, 0.76, -0.21, 0, 0, Math.PI / 2, 6); // bedroll
  box(rig.root, M(0x585444), 0.08, 0.08, 0.06, 0.14, 0.47, 0.1);           // thigh pouch
  rifle(rig.root, weapons, { len: 0.5, y: 0.55 });
  return { node: rig.root, limbs: rig.limbs, weaponParts: weapons };
}

function soldierModel(d) {
  const weapons = [];
  const rig = humanoid({ armor: d.color, bulk: 1.12, visorWide: true });
  // Line trooper: extra plate everywhere and a heavy rifle with an underslung
  // lamp — the colony's standing wall.
  for (const s of [-1, 1]) {
    sph(rig.limbs[s < 0 ? 'armL' : 'armR'], rig.armM, 0.055, s * 0.03, 0.055, 0); // pauldron ridge
    sph(rig.limbs[s < 0 ? 'legL' : 'legR'], rig.shellM, 0.05, 0, -0.2, 0.05, 1.1, 0.9, 0.8); // knee pad
  }
  box(rig.torso, rig.armM, 0.34, 0.06, 0.24, 0, 0.33, 0);                  // collar ring
  box(rig.root, M(0x3d4045), 0.06, 0.3, 0.06, -0.1, 0.85, -0.2, 0, 0, 0.12); // antenna
  const r = rifle(rig.root, weapons, { len: 0.66, y: 0.58 });
  mesh(r, new THREE.BoxGeometry(0.04, 0.04, 0.06), M(0xffca6e, 0.8), 0, -0.06, 0.28); // lamp
  return { node: rig.root, limbs: rig.limbs, weaponParts: weapons };
}

function sniperModel(d) {
  const weapons = [];
  const rig = humanoid({ armor: d.color, cloth: 0x3a3344, bulk: 0.9, visor: 0xff5a4a });
  // Marksman: long coat panels, spotter optic instead of a visor strip, and a
  // rifle too long to pretend it's anything else.
  box(rig.torso, M(0x3a3344), 0.13, 0.34, 0.04, -0.1, -0.12, 0.1, 0.08, 0, 0);  // coat front L
  box(rig.torso, M(0x3a3344), 0.13, 0.34, 0.04, 0.1, -0.12, 0.1, 0.08, 0, 0);   // coat front R
  box(rig.torso, M(0x322c3b), 0.28, 0.38, 0.04, 0, -0.1, -0.13, -0.06, 0, 0);   // coat back
  cyl(rig.head, M(0x1a1b1d), 0.04, 0.04, 0.06, 0.06, 0.04, 0.1, Math.PI / 2, 0, 0, 6); // scope eye
  const r = rifle(rig.root, weapons, { len: 0.92, y: 0.6, scope: 1 });
  cyl(r, M(0x2b2d31), 0.02, 0.02, 0.2, 0, -0.05, 0.5, 0.5, 0, 0, 4);        // bipod leg
  return { node: rig.root, limbs: rig.limbs, weaponParts: weapons };
}

function tigerCloneModel(d) {
  const weapons = [];
  const rig = humanoid({ armor: d.color, cloth: 0x2b2622, bulk: 0.98, visor: 0xffa64d });
  // Spectral pack-mate: Tiger's silhouette with the heat shimmered out of it.
  for (const s of [-1, 1]) {
    cone(rig.head, M(0x1c1a18), 0.045, 0.1, s * 0.07, 0.14, 0, 0, 0, s * -0.3, 4); // ears
    const blade = box(rig.limbs[s < 0 ? 'armL' : 'armR'], M(0xd8d2c2), 0.025, 0.09, 0.5, s * 0.02, -0.38, 0.22);
    track(weapons, blade);
  }
  rig.root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.transparent = true;
    o.material.opacity = 0.72;
    o.material.emissive = new THREE.Color(0xd8721f);
    o.material.emissiveIntensity = 0.22;
  });
  return { node: rig.root, limbs: rig.limbs, weaponParts: weapons };
}

function aaronSpiritModel(d) {
  const weapons = [];
  // The sentinel is not a person in a suit — it's a hooded shade that tapers
  // into nothing and burns cold cyan.
  const root = new THREE.Group();
  const ghost = (hex, e = 0.55) => {
    const m = M(hex, e);
    m.transparent = true;
    m.opacity = 0.6;
    m.depthWrite = false;
    return m;
  };
  cone(root, ghost(0x79c8e8, 0.35), 0.24, 0.7, 0, 0.4, 0, 0, 0, 0, 8);      // wisp tail
  box(root, ghost(0x8fd6ff, 0.45), 0.3, 0.32, 0.2, 0, 0.68, 0);             // chest
  cone(root, ghost(0x8fd6ff, 0.5), 0.2, 0.36, 0, 0.94, 0, 0, 0, 0, 8);      // mantled hood
  sph(root, ghost(0xeaffff, 0.9), 0.05, 0, 0.92, 0.1);                       // the gaze
  const limbs = {};
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.17, 0.78, 0);
    cap(arm, ghost(0x79c8e8, 0.4), 0.035, 0.2, 0, -0.13, 0.03);
    root.add(arm);
    limbs[s < 0 ? 'armL' : 'armR'] = arm;
  }
  const bow = box(root, ghost(0xd8f4ff, 0.7), 0.05, 0.4, 0.05, 0.2, 0.62, 0.16, 0.2, 0, 0);
  track(weapons, bow);
  return { node: root, limbs, weaponParts: weapons };
}

const TROOPS = {
  ranger: rangerModel,
  soldier: soldierModel,
  sniper: sniperModel,
  tiger_clone: tigerCloneModel,
  aaron_spirit: aaronSpiritModel,
};

// ---------------- heroes ----------------
// Base rig scaled up a touch by the caller (1.18×). Each hero keeps their
// config color/trim but earns a silhouette you can name from across the map.

function scottModel(d) {
  const weapons = [];
  const rig = humanoid({ armor: d.color, cloth: 0x33272a, bulk: 1.3, tall: 1.05, shell: d.trim, visorWide: true });
  // Siegebreaker: slab pauldrons with trim rims, twin shotgun barrels, and the
  // gravity hammer racked across his back.
  for (const s of [-1, 1]) {
    const arm = rig.limbs[s < 0 ? 'armL' : 'armR'];
    box(arm, M(d.trim), 0.15, 0.04, 0.15, s * 0.02, 0.09, 0);              // pauldron rim
    sph(arm, rig.armM, 0.12, s * 0.02, 0.045, 0);
  }
  box(rig.torso, M(d.trim), 0.1, 0.24, 0.02, 0, 0.12, 0.175);              // trim chevron
  const gun = new THREE.Group();
  gun.position.set(0.24, 0.6, 0.2);
  rig.root.add(gun);
  cyl(gun, M(0x1e1f21), 0.035, 0.035, 0.44, -0.02, 0.02, 0.1, Math.PI / 2, 0, 0, 6);
  cyl(gun, M(0x2b2d31), 0.035, 0.035, 0.44, 0.03, -0.02, 0.1, Math.PI / 2, 0, 0, 6);
  box(gun, M(0x3a3228), 0.08, 0.1, 0.16, 0, 0, -0.18);                     // stock
  track(weapons, gun);
  const haft = cyl(rig.root, M(0x3a3228), 0.03, 0.03, 0.8, -0.26, 0.75, -0.28, 0, 0, 0.55, 6);
  track(weapons, haft);
  const hammer = box(rig.root, M(0x35363a), 0.3, 0.18, 0.22, -0.5, 1.06, -0.28, 0, 0, 0.55);
  box(hammer, M(d.trim, 0.5), 0.31, 0.05, 0.05, 0, 0, 0.09);               // grav coils
  box(hammer, M(d.trim, 0.5), 0.31, 0.05, 0.05, 0, 0, -0.09);
  track(weapons, hammer);
  return { node: rig.root, limbs: rig.limbs, weaponParts: weapons };
}

function alexanderModel(d) {
  const weapons = [];
  const rig = humanoid({ armor: d.color, cloth: 0x2e3c2a, bulk: 1.05, tall: 1.05, visor: 0xf3c53d });
  // Field marshal at extreme range: scoped rifle, comms mast, nanite tank.
  box(rig.torso, M(0x4a4034), 0.06, 0.4, 0.05, -0.06, 0.02, 0.13, 0, 0, 0.6); // bandolier
  for (let i = 0; i < 3; i++) box(rig.torso, M(0x5c5244), 0.05, 0.06, 0.06, -0.11 + i * 0.09, 0.1 - i * 0.07, 0.14);
  cyl(rig.root, M(0x59c8b8, 0.5), 0.05, 0.05, 0.16, 0.12, 0.62, -0.22, 0, 0, 0, 8); // nanite tank
  box(rig.root, M(0x3d4045), 0.04, 0.5, 0.04, -0.11, 0.95, -0.22, 0, 0, 0.1);       // comms mast
  box(rig.root, M(d.trim, 0.7), 0.07, 0.05, 0.02, -0.14, 1.19, -0.21);
  rifle(rig.root, weapons, { len: 0.9, y: 0.62, x: 0.22, scope: 1 });
  return { node: rig.root, limbs: rig.limbs, weaponParts: weapons };
}

function dannyModel(d) {
  const weapons = [];
  const rig = humanoid({ armor: d.color, cloth: 0x15171c, bulk: 0.88, tall: 1.04, shell: 0x22242a, visor: 0x72cfff });
  // Ghost operative: cowl, wrapped scarf, suppressed rifle, knives where
  // knives go. Reads as a shadow with a blue slit for a face.
  cone(rig.head, M(0x15171c), 0.14, 0.2, 0, 0.08, -0.04, -0.35, 0, 0, 6);  // cowl
  box(rig.torso, M(0x1c1f26), 0.3, 0.1, 0.24, 0, 0.3, 0);                   // scarf wrap
  box(rig.torso, M(0x1c1f26), 0.1, 0.26, 0.04, -0.07, 0.02, -0.14, 0.2, 0, 0); // scarf tail
  box(rig.root, M(0x2b2d31), 0.03, 0.12, 0.05, 0.15, 0.44, 0.08);           // thigh knife
  box(rig.root, M(0x2b2d31), 0.03, 0.1, 0.05, -0.15, 0.4, 0.06);
  rifle(rig.root, weapons, { len: 0.78, y: 0.58, suppressor: 1 });
  return { node: rig.root, limbs: rig.limbs, weaponParts: weapons };
}

function turtleModel(d) {
  const weapons = [];
  const rig = humanoid({ armor: d.color, cloth: 0x2c3a34, bulk: 1.38, tall: 1.02, shell: 0xb8ae86 });
  // The wall: a tower shield as tall as he is and a mace he barely needs.
  box(rig.torso, rig.armM, 0.4, 0.08, 0.26, 0, 0.34, 0);                    // yoke plate
  box(rig.root, rig.armM, 0.3, 0.2, 0.1, 0, 0.72, -0.24, 0.3, 0, 0);        // shell hump
  const shield = new THREE.Group();
  shield.position.set(-0.06, -0.2, 0.1);
  rig.limbs.armL.add(shield);
  box(shield, M(shade(d.color, 1.15)), 0.06, 0.62, 0.4);
  box(shield, M(d.trim), 0.065, 0.5, 0.07, 0, 0, 0);                        // center rib
  mesh(shield, new THREE.BoxGeometry(0.07, 0.09, 0.09), M(0x8fd0ff, 0.8), 0, 0.08, 0); // ward core
  const mace = new THREE.Group();
  mace.position.set(0.02, -0.34, 0.12);
  rig.limbs.armR.add(mace);
  cyl(mace, M(0x3a3228), 0.025, 0.025, 0.34, 0, 0, 0.08, 0.9, 0, 0, 6);
  sph(mace, M(0x565c60), 0.09, 0, 0.05, 0.26);
  track(weapons, mace);
  return { node: rig.root, limbs: rig.limbs, weaponParts: weapons };
}

function johnModel(d) {
  const weapons = [];
  const rig = humanoid({ armor: d.color, cloth: 0x26262a, bulk: 1.22, tall: 1.03, shell: d.trim, visor: 0xffb347 });
  // Bar-brawler in salvage plate: powerfists, a keg on his back, and a crest
  // that says he has never once walked away from a fight.
  box(rig.torso, M(d.trim), 0.26, 0.18, 0.05, 0, 0.14, 0.16);               // white chest panel
  for (const s of [-1, 1]) {
    const fist = box(rig.limbs[s < 0 ? 'armL' : 'armR'], M(0x565c60), 0.13, 0.12, 0.15, 0, -0.4, 0.04);
    box(fist, M(d.trim), 0.135, 0.04, 0.05, 0, 0.03, 0.05);                 // knuckle bar
    track(weapons, fist);
  }
  cyl(rig.root, M(0x6b5334), 0.11, 0.11, 0.3, 0, 0.66, -0.24, 0.2, 0, 0, 8); // the keg
  cyl(rig.root, M(0x3a3d42), 0.115, 0.115, 0.04, 0, 0.72, -0.26, 0.2, 0, 0, 8);
  box(rig.head, M(0xd84a3a), 0.04, 0.1, 0.18, 0, 0.14, -0.02);              // crest
  return { node: rig.root, limbs: rig.limbs, weaponParts: weapons };
}

function tigerModel(d) {
  const weapons = [];
  const rig = humanoid({ armor: d.color, cloth: 0x1c1a18, bulk: 0.98, tall: 1.06, visor: 0xffa64d });
  // The pack leader: twin blades, ear fins, and black stripes over the orange.
  for (const s of [-1, 1]) {
    const arm = rig.limbs[s < 0 ? 'armL' : 'armR'];
    box(arm, M(0x1c1a18), 0.1, 0.03, 0.11, s * 0.02, 0.055, 0);             // stripe
    box(arm, M(0x1c1a18), 0.09, 0.025, 0.1, s * 0.01, -0.02, 0);
    const blade = box(arm, M(0xd8d2c2), 0.03, 0.1, 0.56, s * 0.02, -0.4, 0.24);
    box(blade, M(0x1c1a18), 0.035, 0.05, 0.08, 0, -0.01, -0.24);            // hilt
    track(weapons, blade);
    cone(rig.head, M(0x1c1a18), 0.05, 0.11, s * 0.07, 0.15, 0, 0, 0, s * -0.3, 4); // ear fin
  }
  box(rig.torso, M(0x1c1a18), 0.37, 0.04, 0.27, 0, 0.08, 0);                // torso stripe
  box(rig.torso, M(0x1c1a18), 0.1, 0.3, 0.04, 0, 0.02, -0.135, 0.35, 0, 0); // scarf tail
  return { node: rig.root, limbs: rig.limbs, weaponParts: weapons };
}

function aaronModel(d) {
  const weapons = [];
  const rig = humanoid({
    armor: d.color, cloth: 0x453a66, bulk: 0.95, tall: 1.05,
    visor: 0xf0d060, skirt: true,
  });
  // Warlock of the expedition: robed, hooded, a staff crowned with a live
  // crystal — the only hero who fights with his hands mostly still.
  cone(rig.head, M(0x453a66), 0.15, 0.22, 0, 0.09, -0.05, -0.3, 0, 0, 6);   // hood
  for (const s of [-1, 1]) sph(rig.torso, M(d.trim, 0.45), 0.04, s * 0.14, 0.3, 0.04); // shoulder gems
  const staff = new THREE.Group();
  staff.position.set(0.02, -0.36, 0.1);
  rig.limbs.armR.add(staff);
  cyl(staff, M(0x3a3040), 0.022, 0.028, 0.85, 0, 0.18, 0, 0, 0, 0, 6);
  const crystal = mesh(staff, new THREE.OctahedronGeometry(0.07, 0), M(0xf0d060, 1.0), 0, 0.66, 0);
  crystal.userData.window = true;
  track(weapons, staff);
  return { node: rig.root, limbs: rig.limbs, weaponParts: weapons };
}

const HEROES = {
  scott: scottModel,
  alexander: alexanderModel,
  danny: dannyModel,
  turtle: turtleModel,
  john: johnModel,
  tiger: tigerModel,
  aaron: aaronModel,
};

function genericHero(d) {
  // Unknown hero key (future roster growth): a trimmed heavy with the right
  // colors and either a blade or a rifle, so nothing ever renders as boxes.
  const weapons = [];
  const rig = humanoid({ armor: d.color, bulk: 1.2, tall: 1.05, shell: d.trim });
  if (d.melee) {
    const blade = box(rig.limbs.armR, M(d.trim), 0.05, 0.12, 0.5, 0.02, -0.38, 0.22);
    track(weapons, blade);
  } else {
    rifle(rig.root, weapons, { len: 0.78, y: 0.6 });
  }
  return { node: rig.root, limbs: rig.limbs, weaponParts: weapons };
}

const APPEARANCE_COLORS = {
  iron: 0x8493a6, crimson: 0xb94b51, cobalt: 0x4679b8,
  bone: 0xb7aa8c, void: 0x6d568f, forest: 0x4f785d,
};

const FRAME_CLASSES = new Set(['berserker', 'xenoshaper', 'vanguard', 'warden']);
const SIGNAL_CLASSES = new Set(['vox_officer', 'chaplain', 'psion', 'voidbound', 'arcanist']);
const roleFamily = (classKey) => FRAME_CLASSES.has(classKey) ? 'frontline'
  : SIGNAL_CLASSES.has(classKey) ? 'signal' : 'skirmisher';

export function playerHeroVisualState(u) {
  const style = u.characterStyle || {};
  const race = style.raceKey === 'robot' ? 'robot' : 'human';
  const custom = style.customization || {};
  const defaults = race === 'robot'
    ? { face: 'optic', body: 'strider', head: 'dish', legs: 'biped' }
    : { face: 'sentinel', body: 'standard', head: 'cropped', legs: 'field' };
  const identity = Object.fromEntries(Object.keys(defaults).map((slot) => {
    const family = COSMETIC_RENDERERS[race][slot][custom[slot]] ? custom[slot] : defaults[slot];
    return [slot, { family, recipe: COSMETIC_RENDERERS[race][slot][family] }];
  }));
  const equipment = style.equipment || u.equipment || {};
  const gearInfo = Object.fromEntries(['head', 'chest', 'hands', 'legs', 'boots'].map((slot) => {
    const value = equipment[slot] || (slot === 'chest' ? equipment.armor : null);
    const item = itemInfo(value);
    return [slot, {
      family: item?.base?.visual || item?.base?.id || '',
      rarity: Number(item?.rarity) || 1,
    }];
  }));
  const gear = Object.fromEntries(Object.entries(gearInfo).map(([slot, value]) => [slot, value.family]));
  return { race, appearance: style.appearance || 'iron', role: roleFamily(style.classKey), identity, gear, gearInfo };
}

function playerHero(u) {
  const style = u.characterStyle || {};
  const state = playerHeroVisualState(u);
  const { race, identity, gear, gearInfo } = state;
  const custom = Object.fromEntries(Object.entries(identity).map(([slot, value]) => [slot, value.family]));
  const color = APPEARANCE_COLORS[style.appearance] || u.def.color || 0x8493a6;
  const bodyScale = identity.body.recipe.scale;
  const bulk = bodyScale[0] * 1.12;
  const rig = humanoid({
    armor: color, cloth: race === 'robot' ? shade(color, .48) : 0x33383e,
    shell: race === 'robot' ? 0xb8c4ca : 0xd8c6ad,
    bulk, tall: bodyScale[1] * (race === 'robot' ? 1.08 : 1.03),
    visor: race === 'robot' ? 0x5ee8ff : 0x8fd0ff,
    visorWide: ['visor', 'faceless'].includes(custom.face),
    visorVisible: false,
  });
  rig.root.userData.visualState = state;
  rig.root.scale.z = bodyScale[2];
  const weapons = [];
  // Identity parts stay visible beneath gear.
  if (race === 'human') {
    // Replace the shared dome with a human cranium, face plane, jaw and neck.
    // These large forms remain readable at creator and gameplay scale.
    rig.head.children[0].visible = false;
    const skin = M(0xd8c6ad), shadow = M(0x7b5747), mark = M(custom.face === 'nomad' ? 0x315b66 : 0x4a3229);
    box(rig.head, skin, .18, .18, .14, 0, .035, .005);
    box(rig.head, skin, .145, .12, .045, 0, .015, .088);
    box(rig.head, shadow, .12, .045, .105, 0, -.085, .018);
    box(rig.head, skin, .075, .07, .075, 0, -.105, -.005);
    for (const x of [-.046, .046]) box(rig.head, M(0x18212a), .033, .018, .012, x, .04, .118);
    cone(rig.head, skin, .025, .06, 0, .005, .132, Math.PI / 2, 0, 0, 5);
    box(rig.head, M(0x6d493b), .075, .012, .012, 0, -.045, .116);
    if (custom.face === 'sentinel') { box(rig.head, M(0x3b2d25), .17, .025, .014, 0, .08, .114); box(rig.head, M(0x5c4435), .085, .025, .014, 0, -.075, .105); }
    if (custom.face === 'ranger') box(rig.head, mark, .12, .022, .014, 0, .082, .116, 0, 0, -.12);
    if (custom.face === 'veteran') box(rig.head, M(0xa77969), .018, .115, .014, .055, .005, .118, 0, 0, -.28);
    if (custom.face === 'nomad') { box(rig.head, mark, .18, .025, .014, 0, .06, .116); box(rig.head, skin, .07, .035, .02, 0, -.055, .12); }
    for (const arm of [rig.limbs.armL, rig.limbs.armR]) arm.children[0].scale.set(.48, .5, .55);
    if (custom.head === 'cropped') box(rig.head, M(0x342a24), .18, .035, .14, 0, .115, -.005);
    if (custom.head === 'swept') { box(rig.head, M(0x5a3f2d), .19, .045, .15, -.018, .125, -.005, 0, 0, -.16); cone(rig.head, M(0x5a3f2d), .045, .16, .075, .19, -.02, 0, 0, -.35); }
    if (custom.head === 'shaved') sph(rig.head, M(0xb89c83), .107, 0, .045, 0, .97, 1.02, .96);
  }
  if (custom.head === 'crest') box(rig.head, M(0xe4bf55), .045, .13, .16, 0, .14, -.02);
  if (custom.head === 'antenna' || custom.head === 'dish') {
    box(rig.head, M(0x343a40), .025, .22, .025, .07, .18, 0, 0, 0, .15);
    if (custom.head === 'dish') sph(rig.head, M(0x6fc8e8, .55), .055, .07, .29, 0, 1.4, .35, 1.4);
  }
  if (custom.head === 'hooded') cone(rig.head, M(0x252c35), .145, .2, 0, .08, -.04, -.35, 0, 0, 7);
  if (race === 'robot') {
    // Replace the shared dome and ball pauldrons. Angular head/torso masses
    // and segmented limbs preserve synthetic origin beneath shared equipment.
    rig.head.children[0].visible = false;
    rig.torso.children[0].visible = false;
    rig.torso.children[1].visible = false;
    const sharedPelvis = rig.root.children.find((node) => node.isMesh);
    if (sharedPelvis) sharedPelvis.visible = false;
    box(rig.head, M(shade(color, .82)), .22, .135, .16, 0, .035, 0);
    box(rig.head, M(0x202a31), .17, .065, .04, 0, .035, .1);
    box(rig.torso, M(shade(color, .62)), .4, .12, .22, 0, .31, 0);
    box(rig.torso, M(shade(color, .72)), .3, .27, .2, 0, .16, .015);
    box(rig.root, M(shade(color, .58)), .24, .1, .16, 0, .45, 0);
    for (const arm of [rig.limbs.armL, rig.limbs.armR]) {
      arm.children[0].visible = false;
      box(arm, M(shade(color, .72)), .17, .09, .19, 0, .045, 0, 0, 0, .12);
    }
    for (const [index, leg] of [rig.limbs.legL, rig.limbs.legR].entries()) {
      box(leg, M(shade(color, .52)), .075, .17, .07, 0, -.3, -.015, index ? .24 : -.24, 0, 0);
      box(leg, M(0x202a31), .12, .055, .18, 0, -.4, .075);
    }
    if (custom.face === 'optic') cyl(rig.head, M(0x5ee8ff, 1), .045, .045, .055, 0, .04, .125, Math.PI / 2, 0, 0, 8);
    if (custom.face === 'visor') box(rig.head, M(0x5ee8ff, 1), .19, .045, .03, 0, .04, .125);
    if (custom.face === 'tri-eye') for (const x of [-.065, 0, .065]) box(rig.head, M(0x5ee8ff, 1), .035, .045, .03, x, .04, .125);
    if (custom.face === 'faceless') box(rig.head, M(0x111719), .19, .075, .03, 0, .035, .125);
    if (custom.head === 'smooth') box(rig.head, M(shade(color, .88)), .23, .045, .17, 0, .12, -.005);
  }

  if (state.role === 'frontline') {
    for (const arm of [rig.limbs.armL, rig.limbs.armR]) box(arm, M(shade(color, .62)), .18, .07, .2, 0, .09, 0);
    box(rig.torso, M(0x2a3036), .08, .28, .08, 0, .18, -.2);
  } else if (state.role === 'signal') {
    sph(rig.torso, M(0x8eeaff, .8), .035, 0, .2, .18, 1, 1, .45);
    for (const x of [-.11, .11]) box(rig.root, M(0x4a5963), .018, .22, .018, x, .88, -.19, 0, 0, x * 1.2);
  } else {
    box(rig.torso, M(0x303943), .07, .22, .06, -.14, .1, -.16, 0, 0, -.18);
    box(rig.head, M(0x79dcff, .65), .04, .025, .02, .085, .075, .095);
  }

  // Base legs retain origin identity even when armor is worn.
  for (const leg of [rig.limbs.legL, rig.limbs.legR]) {
    if (custom.legs === 'armored' || custom.legs === 'heavy') box(leg, M(shade(color, .62)), .125, .23, .12, 0, -.2, 0);
    if (custom.legs === 'scout' || custom.legs === 'reverse-joint') {
      leg.rotation.x = custom.legs === 'reverse-joint' ? -.18 : .05;
      box(leg, M(race === 'robot' ? 0x3a464d : 0x48523f), .055, .18, .055, 0, -.32, -.04, custom.legs === 'reverse-joint' ? .38 : 0);
    }
  }

  if (gear.chest) {
    const chestScale = /powered|siege|bulwark/.test(gear.chest) ? 1.18 : /weave|ghost|shroud/.test(gear.chest) ? .98 : 1.08;
    box(rig.torso, M(shade(color, .8)), .34 * chestScale, .31, .16, 0, .19, .01);
    if (gear.chest === 'flak') for (const x of [-.09, .09]) box(rig.torso, M(shade(color, .68)), .13, .22, .035, x, .19, .105, 0, 0, x * -.8);
    if (/weave|ghost|shroud/.test(gear.chest)) cone(rig.torso, M(shade(color, .48)), .23, .42, 0, -.12, -.02, 0, 0, 0, 9);
    if (/powered|siege|bulwark/.test(gear.chest)) for (const x of [-.18, .18]) box(rig.torso, M(shade(color, .62)), .12, .12, .16, x, .28, 0);
    if (gear.chest === 'powered') sph(rig.torso, M(0x70e6ff, .8), .04, 0, .2, .18, 1.4, 1, .45);
  }
  if (gear.head) {
    const helm = gear.head;
    if (race === 'robot') {
      box(rig.head, M(shade(color, helm === 'ghost' ? .5 : .82)), .25, .07, .18, 0, .105, -.005);
      box(rig.head, M(shade(color, .58)), .035, .13, .16, -.13, .035, 0);
      box(rig.head, M(shade(color, .58)), .035, .13, .16, .13, .035, 0);
    } else {
      // Crown/back shell leaves the Human face plane and jaw exposed.
      box(rig.head, M(shade(color, helm === 'ghost' ? .5 : .82)), .205, .08, .16, 0, .105, -.005);
      box(rig.head, M(shade(color, .68)), .19, .1, .04, 0, .035, -.085);
    }
    if (helm === 'sentinel') box(rig.head, M(0xe4bf55), .18, .025, .03, 0, .12, .02);
    if (helm === 'frontier') box(rig.head, M(shade(color, .65)), .24, .025, .15, 0, .12, .01);
    if (helm === 'ghost') cone(rig.head, M(0x222732), .16, .22, 0, .08, -.04, -.35, 0, 0, 8);
  }
  if (race === 'robot') {
    // Origin marks are applied after equipment so shared sets cannot turn a
    // Robot back into the Human silhouette.
    box(rig.torso, M(0x202a31), .42, .035, .23, 0, .34, 0);
    box(rig.torso, M(0x5ee8ff, .85), .075, .075, .025, 0, .2, .19);
  }
  if (gear.hands) for (const arm of [rig.limbs.armL, rig.limbs.armR]) {
    const siege = gear.hands === 'siege';
    box(arm, M(gear.hands === 'relay' ? 0x4e9db5 : shade(color, .7)), siege ? .145 : .11, siege ? .17 : .13, siege ? .15 : .12, 0, -.34, .02);
  }
  if (gear.legs) for (const leg of [rig.limbs.legL, rig.limbs.legR]) box(leg, M(shade(color, gear.legs === 'bulwark' ? .5 : .68)), gear.legs === 'bulwark' ? .135 : .105, gear.legs === 'strider' ? .15 : .22, .1, 0, -.25, .01);
  if (gear.boots) for (const leg of [rig.limbs.legL, rig.limbs.legR]) {
    box(leg, M(gear.boots === 'phase' ? 0x496e86 : 0x25282c), gear.boots === 'siege' ? .145 : .12, gear.boots === 'siege' ? .14 : .1, gear.boots === 'trail' ? .21 : .18, 0, -.4, .05);
    if (gear.boots === 'phase') sph(leg, M(0x5ee8ff, .8), .025, 0, -.4, .15);
  }
  // Rarity is a controlled equipment accent, never a full-body recolor.
  // Marked gear gets one cyan pip; Prime gear adds a paired amber pip.
  const rarityAccent = (parent, rarity, x, y, z) => {
    if (rarity < 2) return;
    sph(parent, M(rarity >= 3 ? 0xe0b34b : 0x6fa8dc, .75), .018, x, y, z, 1, 1, .5);
    if (rarity >= 3) sph(parent, M(0xe0b34b, .75), .018, -x, y, z, 1, 1, .5);
  };
  rarityAccent(rig.head, gearInfo.head.rarity, .055, .1, .12);
  rarityAccent(rig.torso, gearInfo.chest.rarity, .1, .29, .19);
  rarityAccent(rig.limbs.armR, gearInfo.hands.rarity, .035, -.31, .1);
  rarityAccent(rig.limbs.legR, gearInfo.legs.rarity, .03, -.23, .09);
  rarityAccent(rig.limbs.legL, gearInfo.boots.rarity, .03, -.39, .14);
  rifle(rig.root, weapons, { len: .72, y: .58 });
  return { node: rig.root, limbs: rig.limbs, weaponParts: weapons };
}

// ---------------- entry point ----------------

export function buildUnitModel(u) {
  const d = u.def;
  if (u.hero && u.characterStyle) return playerHero(u);
  if (u.hero) return (HEROES[u.key] || genericHero)(d);
  return (TROOPS[u.key] || soldierModel)(d);
}
