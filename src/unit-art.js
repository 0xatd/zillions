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

// Warm daylight rim on friendly silhouettes (same grammar main.js used).
const M = (c, e = 0) => applyRim(
  new THREE.MeshLambertMaterial({ color: c, emissive: e ? c : 0x000000, emissiveIntensity: e }),
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
  const m = mesh(parent, new THREE.SphereGeometry(r, 8, 6), mat, x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
};
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
  visor = 0x35ff70, visorWide = false, pack = 0x4a4d52,
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
      box(leg, clothM, 0.1 * W, 0.2 * H, 0.12, 0, -0.1 * H, 0);            // thigh
      box(leg, bootM, 0.088 * W, 0.2 * H, 0.1, 0, -0.29 * H, 0.005);       // shin
      box(leg, bootM, 0.1 * W, 0.055, 0.17, 0, -0.4 * H, 0.03);            // boot
      root.add(leg);
      limbs[s < 0 ? 'legL' : 'legR'] = leg;
    }
    box(root, clothM, 0.24 * W, 0.1 * H, 0.17, 0, 0.44 * H, 0);            // pelvis
  }
  const torso = new THREE.Group();
  torso.position.y = 0.5 * H;
  root.add(torso);
  box(torso, armorM, 0.32 * W, 0.32 * H, 0.22, 0, 0.16 * H, 0);            // cuirass
  box(torso, shellM, 0.22 * W, 0.14 * H, 0.05, 0, 0.19 * H, 0.12);         // chest plate
  if (skirt) cone(torso, clothM, 0.26 * W, 0.5 * H, 0, -0.16 * H, 0, 0, 0, 0, 8);

  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.21 * W, 0.78 * H, 0);
    sph(arm, armorM, 0.095 * W, s * 0.025 * W, 0.02, 0);                   // pauldron
    box(arm, armorM, 0.08 * W, 0.17 * H, 0.09, 0, -0.11 * H, 0);           // upper arm
    box(arm, clothM, 0.07 * W, 0.16 * H, 0.08, 0, -0.27 * H, 0.015);       // forearm
    box(arm, bootM, 0.08 * W, 0.06, 0.1, 0, -0.37 * H, 0.02);              // glove
    root.add(arm);
    limbs[s < 0 ? 'armL' : 'armR'] = arm;
  }
  const head = new THREE.Group();
  head.position.y = 0.94 * H;
  root.add(head);
  box(head, shellM, 0.2 * W, 0.19, 0.19, 0, 0.03, 0);                       // helmet
  mesh(head, new THREE.BoxGeometry(visorWide ? 0.17 * W : 0.14 * W, 0.045, 0.03), M(visor, 0.9), 0, 0.035, 0.105);
  box(root, packM, 0.26 * W, 0.28 * H, 0.13, 0, 0.62 * H, -0.19);          // life-support pack

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
    box(rig.limbs[s < 0 ? 'legL' : 'legR'], rig.shellM, 0.1, 0.07, 0.05, 0, -0.2, 0.07); // knee pad
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
    box(arm, ghost(0x79c8e8, 0.4), 0.07, 0.3, 0.08, 0, -0.13, 0.03);
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
  box(rig.torso, M(d.trim), 0.1, 0.24, 0.02, 0, 0.12, 0.135);              // trim chevron
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
  box(rig.torso, M(d.trim), 0.26, 0.18, 0.05, 0, 0.14, 0.115);              // white chest panel
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
  box(rig.torso, M(0x1c1a18), 0.33, 0.04, 0.23, 0, 0.08, 0);                // torso stripe
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

// ---------------- entry point ----------------

export function buildUnitModel(u) {
  const d = u.def;
  if (u.hero) return (HEROES[u.key] || genericHero)(d);
  return (TROOPS[u.key] || soldierModel)(d);
}
