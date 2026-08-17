// The horde, rendered. Every zombie type gets its own authored silhouette —
// ragged shamblers, sprinting runners, hulking brutes — built once as merged
// vertex-colored geometry and drawn as instanced meshes, so a thousand dead
// cost the same handful of draw calls the old boxes did.
//
// Each type is three instanced parts:
//   body  — legs, torso, head and gore, merged into one geometry
//   arms  — both arms merged, origin at the shoulder line so one rotation
//           swings them (reaching, pumping, digging — per-type cadence)
//   eyes  — unlit glow dots that burn through the night
//
// Presentation only: this module never reads or writes simulation state.
// Callers (the game renderer and the menu vignette) feed world transforms in
// through HordeArt.write(); nothing here can affect lockstep.
import * as THREE from 'three';
import { applyRim } from './tactical-visuals.js';

// ---------------- merged-geometry builder ----------------

const _euler = new THREE.Euler();
const _mat = new THREE.Matrix4();
const _vec = new THREE.Vector3();
const _col = new THREE.Color();

function merger() {
  const pos = [], nrm = [], col = [];
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    _mat.makeRotationFromEuler(_euler.set(rx, ry, rz));
    _mat.scale(_vec.set(sx, sy, sz));
    _mat.setPosition(x, y, z);
    g.applyMatrix4(_mat);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    _col.setHex(hex);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(_col.r, _col.g, _col.b);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
  };
  return {
    box: (hex, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) =>
      add(new THREE.BoxGeometry(w, h, d), hex, x, y, z, rx, ry, rz),
    sph: (hex, r, x, y, z, sx = 1, sy = 1, sz = 1, ws = 7, hs = 5) =>
      add(new THREE.SphereGeometry(r, ws, hs), hex, x, y, z, 0, 0, 0, sx, sy, sz),
    cyl: (hex, r1, r2, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 6) =>
      add(new THREE.CylinderGeometry(r1, r2, h, seg), hex, x, y, z, rx, ry, rz),
    cone: (hex, r, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 5) =>
      add(new THREE.ConeGeometry(r, h, seg), hex, x, y, z, rx, ry, rz),
    build: () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      return g;
    },
  };
}

const shade = (hex, f) => _col.setHex(hex).multiplyScalar(f).getHex();

// ---------------- the seven silhouettes ----------------
// All authored at type-scale 1 (config `scale` multiplies at draw time),
// origin at ground center, facing +Z. Ragged-survivor palette: dirty cloth
// over sickly skin, with each type's config hue baked into the skin so the
// horde still reads at strategy zoom.

function walkerParts() {
  // The classic shambler: torn office clothes, slumped shoulders, head lolled
  // to one side, jaw hanging. The bulk of every horde.
  const SKIN = 0x94ac72, SKIN2 = 0x7d9463, SHIRT = 0x9a948a, PANTS = 0x565349;
  const HAIR = 0x38332c, BLOOD = 0x6e2a22;
  const b = merger();
  // uneven stance: left leg planted, right leg dragging
  b.box(PANTS, 0.115, 0.34, 0.125, -0.085, 0.17, 0.02, 0, 0, 0.06);
  b.box(shade(PANTS, 0.8), 0.115, 0.34, 0.125, 0.09, 0.16, -0.04, -0.18, 0, -0.05);
  b.box(HAIR, 0.115, 0.07, 0.19, -0.085, 0.035, 0.06);            // shoe
  b.box(HAIR, 0.115, 0.07, 0.19, 0.09, 0.035, -0.02, 0, 0.35, 0); // shoe, splayed
  b.box(PANTS, 0.3, 0.15, 0.21, 0, 0.4, 0);                        // hips
  b.box(SHIRT, 0.34, 0.4, 0.24, 0, 0.64, 0.02, 0.16, 0, 0.04);     // slumped torso
  b.box(SKIN, 0.11, 0.17, 0.03, 0.09, 0.58, 0.145, 0.16, 0, 0);    // torn shirt, belly showing
  b.box(BLOOD, 0.17, 0.13, 0.03, -0.07, 0.72, 0.155, 0.16, 0, 0);  // chest wound
  b.box(BLOOD, 0.1, 0.2, 0.03, 0.05, 0.66, -0.145, 0.16, 0, 0);    // exit smear on the back
  b.sph(SHIRT, 0.095, -0.19, 0.8, 0.02);                           // dropped shoulder
  b.sph(SHIRT, 0.095, 0.19, 0.85, 0);                              // raised shoulder
  b.sph(SKIN, 0.145, 0.025, 0.95, 0.05, 1, 1.08, 1);               // head, lolled
  b.box(SKIN2, 0.12, 0.07, 0.1, 0.03, 0.865, 0.12, 0.42, 0, 0.18); // hanging jaw
  b.sph(HAIR, 0.148, 0.02, 0.99, 0.015, 1, 0.72, 1);               // matted hair
  const a = merger(); // pivot at the shoulder line (0, 0.84, 0.02)
  a.box(SHIRT, 0.09, 0.09, 0.34, -0.19, -0.03, 0.2, 0.12, 0, 0);   // L arm reaching, sleeve
  a.box(SKIN, 0.075, 0.075, 0.16, -0.19, -0.06, 0.44);             // L forearm, bare
  a.box(SKIN2, 0.085, 0.06, 0.1, -0.19, -0.075, 0.55);             // L hand
  a.box(SKIN, 0.085, 0.085, 0.46, 0.19, 0, 0.24, -0.06, 0, 0);     // R arm, outstretched
  a.box(SKIN2, 0.09, 0.06, 0.11, 0.19, -0.01, 0.5);                // R hand
  return {
    body: b.build(), arms: a.build(),
    pivot: [0, 0.84, 0.02], swingAmp: 0.16, swingRate: 3.4,
    eyes: [[-0.035, 0.955, 0.175], [0.085, 0.95, 0.17]],
  };
}

function runnerParts() {
  // Fresh enough to sprint: lean, jaundiced, hooded, bent into the chase with
  // arms pumping. Reads as motion even before it moves.
  const SKIN = 0xb5a565, SKIN2 = 0x998a52, HOOD = 0x685e4e, PANTS = 0x49463f;
  const BLOOD = 0x6e2a22, DARK = 0x322e28;
  const b = merger();
  b.box(PANTS, 0.1, 0.34, 0.11, -0.075, 0.2, 0.1, -0.55, 0, 0);    // stride: leg forward
  b.box(PANTS, 0.1, 0.34, 0.11, 0.075, 0.15, -0.12, 0.6, 0, 0);    // leg trailing
  b.box(DARK, 0.1, 0.06, 0.17, -0.075, 0.05, 0.2);
  b.box(DARK, 0.1, 0.06, 0.17, 0.075, 0.06, -0.24, 0.5, 0, 0);
  b.box(PANTS, 0.26, 0.13, 0.19, 0, 0.4, 0);
  b.box(HOOD, 0.3, 0.38, 0.21, 0, 0.62, 0.09, 0.42, 0, 0);         // hard forward lean
  b.box(BLOOD, 0.14, 0.1, 0.03, 0.04, 0.6, 0.21, 0.42, 0, 0);
  b.box(SKIN, 0.09, 0.12, 0.03, -0.08, 0.55, 0.19, 0.42, 0, 0);    // ripped hoodie
  b.sph(SKIN, 0.125, 0, 0.85, 0.21, 1, 1.02, 1);                   // head thrust forward
  b.box(SKIN2, 0.1, 0.06, 0.09, 0, 0.78, 0.27, 0.5, 0, 0);         // open jaw
  b.cone(HOOD, 0.14, 0.2, 0, 0.9, 0.1, -0.5, 0, 0, 5);             // hood blown back
  const a = merger(); // pivot (0, 0.76, 0.06): pumping, elbows back
  a.box(HOOD, 0.08, 0.08, 0.3, -0.16, -0.05, -0.1, -0.5, 0, 0);
  a.box(SKIN, 0.07, 0.07, 0.2, -0.16, 0.05, 0.14, -0.3, 0, 0);
  a.box(HOOD, 0.08, 0.08, 0.3, 0.16, -0.05, 0.12, 0.35, 0, 0);
  a.box(SKIN, 0.07, 0.07, 0.18, 0.16, -0.16, -0.12, 0.6, 0, 0);
  return {
    body: b.build(), arms: a.build(),
    pivot: [0, 0.76, 0.06], swingAmp: 0.42, swingRate: 9.0,
    eyes: [[-0.045, 0.87, 0.31], [0.045, 0.87, 0.31]],
  };
}

function bruteParts() {
  // A wall of grave-meat: shoulders like an ox yoke, a hump that swallows the
  // skull, knuckles that nearly drag. Scale 1.75 makes it tower in the field.
  const SKIN = 0x8b74a4, SKIN2 = 0x74608c, MUSCLE = 0x8a4650, HIDE = 0x584e66;
  const BONE = 0xcdc4ae, DARK = 0x36303e;
  const b = merger();
  b.box(SKIN2, 0.17, 0.34, 0.2, -0.17, 0.17, 0, 0, 0, 0.08);       // tree-trunk legs
  b.box(SKIN2, 0.17, 0.34, 0.2, 0.17, 0.17, 0, 0, 0, -0.08);
  b.box(DARK, 0.19, 0.09, 0.26, -0.17, 0.045, 0.03);
  b.box(DARK, 0.19, 0.09, 0.26, 0.17, 0.045, 0.03);
  b.box(HIDE, 0.5, 0.2, 0.34, 0, 0.42, 0);                          // ragged waist wrap
  b.box(SKIN, 0.6, 0.52, 0.42, 0, 0.72, 0, 0.24, 0, 0);             // barrel torso
  b.box(MUSCLE, 0.2, 0.3, 0.04, -0.12, 0.72, 0.225, 0.24, 0, 0);    // flayed pectoral
  b.box(MUSCLE, 0.14, 0.18, 0.04, 0.16, 0.66, 0.22, 0.24, 0, 0);
  b.sph(SKIN, 0.3, 0, 1.0, -0.14, 1.15, 0.85, 1);                   // the hump
  b.sph(SKIN2, 0.2, -0.3, 0.98, -0.02);                              // shoulder boulders
  b.sph(SKIN2, 0.2, 0.3, 0.98, -0.02);
  b.sph(SKIN, 0.115, 0, 0.94, 0.26);                                 // skull sunk in front
  b.box(SKIN2, 0.11, 0.06, 0.09, 0, 0.87, 0.3, 0.4, 0, 0);           // jaw
  b.cone(BONE, 0.05, 0.14, 0, 1.24, -0.1, 0.5, 0, 0, 4);             // spine ridge
  b.cone(BONE, 0.045, 0.12, 0, 1.16, -0.26, 0.9, 0, 0, 4);
  b.cone(BONE, 0.04, 0.1, 0, 1.0, -0.36, 1.2, 0, 0, 4);
  const a = merger(); // pivot (0, 0.98, 0): slab arms, fists low and forward
  a.box(SKIN, 0.17, 0.44, 0.19, -0.34, -0.24, 0.12, -0.35, 0, 0.12);
  a.box(SKIN2, 0.16, 0.34, 0.17, -0.38, -0.52, 0.26, -0.5, 0, 0);
  a.sph(SKIN2, 0.13, -0.4, -0.68, 0.36);                             // fist
  a.box(SKIN, 0.17, 0.44, 0.19, 0.34, -0.24, 0.12, -0.35, 0, -0.12);
  a.box(SKIN2, 0.16, 0.34, 0.17, 0.38, -0.52, 0.26, -0.5, 0, 0);
  a.sph(SKIN2, 0.13, 0.4, -0.68, 0.36);
  return {
    body: b.build(), arms: a.build(),
    pivot: [0, 0.98, 0], swingAmp: 0.11, swingRate: 2.6,
    eyes: [[-0.04, 0.96, 0.35], [0.04, 0.96, 0.35]],
  };
}

function spitterParts() {
  // Bloated and back-tilted, throat straining around the acid load. The bright
  // sac is the tell — and the target.
  const SKIN = 0xa8b26c, SKIN2 = 0x8c9657, SAC = 0xdff04a, CLOTH = 0x6f7258;
  const DARK = 0x3a3b30, BLOOD = 0x6e2a22;
  const b = merger();
  b.box(SKIN2, 0.095, 0.32, 0.1, -0.08, 0.16, 0, 0, 0, 0.1);       // spindly legs
  b.box(SKIN2, 0.095, 0.32, 0.1, 0.08, 0.16, 0, 0, 0, -0.1);
  b.box(DARK, 0.1, 0.06, 0.16, -0.08, 0.03, 0.03);
  b.box(DARK, 0.1, 0.06, 0.16, 0.08, 0.03, 0.03);
  b.box(CLOTH, 0.28, 0.16, 0.2, 0, 0.38, -0.01);                    // rotted skirt
  b.sph(SKIN, 0.27, 0, 0.58, 0.03, 1.04, 0.92, 1.14);               // distended belly
  b.sph(SAC, 0.2, 0, 0.55, 0.14, 1, 0.82, 1);                        // acid gut, glowing hue
  b.box(SKIN, 0.26, 0.2, 0.2, 0, 0.82, -0.03, -0.12, 0, 0);          // chest, tipped back
  b.cyl(SAC, 0.07, 0.09, 0.14, 0, 0.93, 0.08, 0.35, 0, 0, 6);        // straining throat
  b.sph(SKIN, 0.12, 0, 1.02, 0.05, 1, 1, 1);                          // head thrown back
  b.box(SKIN2, 0.1, 0.05, 0.1, 0, 0.95, 0.13, 0.8, 0, 0);             // jaw cranked open
  b.box(BLOOD, 0.05, 0.12, 0.02, 0.03, 0.86, 0.15, 0.3, 0, 0);        // drool track
  const a = merger(); // pivot (0, 0.82, 0): arms wrapped forward around the load
  for (const s of [-1, 1]) {
    a.box(SKIN, 0.08, 0.09, 0.2, s * 0.24, 0, 0.06, 0.15, s * -0.35, 0);   // upper, clearing the belly
    a.box(SKIN, 0.07, 0.075, 0.24, s * 0.29, -0.03, 0.24, 0.2, 0, 0);      // forearm
    a.box(SKIN2, 0.08, 0.05, 0.1, s * 0.29, -0.055, 0.4);                  // hand
  }
  return {
    body: b.build(), arms: a.build(),
    pivot: [0, 0.82, 0], swingAmp: 0.12, swingRate: 3.0,
    eyes: [[-0.04, 1.04, 0.14], [0.04, 1.04, 0.14]],
  };
}

function burrowerParts() {
  // Bent double, crusted in the dirt it swims through, forearms ending in
  // bone shovels. Low profile — easy to lose against churned ground, on purpose.
  const SKIN = 0x8a70bd, SKIN2 = 0x715a9c, CRUST = 0x4c4234, CLAW = 0xd6cbb2;
  const DARK = 0x322c26;
  const b = merger();
  b.box(SKIN2, 0.1, 0.24, 0.11, -0.09, 0.12, -0.08, 0.55, 0, 0);   // crouched legs
  b.box(SKIN2, 0.1, 0.24, 0.11, 0.09, 0.12, -0.08, 0.55, 0, 0);
  b.box(DARK, 0.1, 0.05, 0.15, -0.09, 0.03, -0.02);
  b.box(DARK, 0.1, 0.05, 0.15, 0.09, 0.03, -0.02);
  b.box(SKIN, 0.3, 0.34, 0.24, 0, 0.42, 0.06, 0.62, 0, 0);          // torso folded forward
  b.box(CRUST, 0.32, 0.12, 0.26, 0, 0.56, -0.02, 0.62, 0, 0);       // caked-on soil
  b.box(CRUST, 0.2, 0.09, 0.18, 0.04, 0.62, -0.12, 0.62, 0, 0.2);
  b.sph(SKIN, 0.12, 0, 0.56, 0.26);                                  // head down and forward
  b.box(SKIN2, 0.1, 0.05, 0.09, 0, 0.5, 0.32, 0.5, 0, 0);
  const a = merger(); // pivot (0, 0.52, 0.12): digging churn
  for (const s of [-1, 1]) {
    a.box(SKIN, 0.09, 0.09, 0.26, s * 0.17, -0.04, 0.12, 0.3, 0, 0);
    a.box(CLAW, 0.1, 0.06, 0.12, s * 0.17, -0.1, 0.28, 0.3, 0, 0);   // bone shovel
    a.cone(CLAW, 0.035, 0.14, s * 0.21, -0.12, 0.36, 1.4, 0, 0, 4);  // claws
    a.cone(CLAW, 0.035, 0.16, s * 0.17, -0.12, 0.38, 1.4, 0, 0, 4);
    a.cone(CLAW, 0.035, 0.14, s * 0.13, -0.12, 0.36, 1.4, 0, 0, 4);
  }
  return {
    body: b.build(), arms: a.build(),
    pivot: [0, 0.52, 0.12], swingAmp: 0.3, swingRate: 5.5,
    eyes: [[-0.04, 0.58, 0.36], [0.04, 0.58, 0.36]],
  };
}

function siegerParts() {
  // The battering ram: rust-hided bulk under slabs of grown bone armor,
  // forearms fused into blunt maces. It isn't looking at your army at all.
  const SKIN = 0xb5713f, SKIN2 = 0x94582f, PLATE = 0xd5ccba, PLATE2 = 0xbfb49e;
  const DARK = 0x453227;
  const b = merger();
  b.box(SKIN2, 0.16, 0.32, 0.19, -0.16, 0.16, 0, 0, 0, 0.07);
  b.box(SKIN2, 0.16, 0.32, 0.19, 0.16, 0.16, 0, 0, 0, -0.07);
  b.box(PLATE2, 0.18, 0.16, 0.21, -0.16, 0.26, 0.01);                // bone greaves
  b.box(PLATE2, 0.18, 0.16, 0.21, 0.16, 0.26, 0.01);
  b.box(DARK, 0.18, 0.08, 0.25, -0.16, 0.04, 0.02);
  b.box(DARK, 0.18, 0.08, 0.25, 0.16, 0.04, 0.02);
  b.box(SKIN, 0.52, 0.46, 0.4, 0, 0.62, 0, 0.18, 0, 0);              // bulk torso
  b.box(PLATE, 0.46, 0.2, 0.06, 0, 0.76, 0.21, 0.3, 0, 0);           // chest slab, upper
  b.box(PLATE2, 0.4, 0.16, 0.06, 0, 0.58, 0.235, 0.14, 0, 0);        // chest slab, lower
  b.box(PLATE, 0.5, 0.3, 0.1, 0, 0.94, -0.16, -0.5, 0, 0);           // back carapace
  b.sph(PLATE, 0.17, -0.3, 0.92, 0, 1.2, 0.8, 1.1);                  // pauldron slabs
  b.sph(PLATE, 0.17, 0.3, 0.92, 0, 1.2, 0.8, 1.1);
  b.sph(SKIN2, 0.1, 0, 0.9, 0.22);                                    // small head
  b.box(PLATE2, 0.14, 0.08, 0.12, 0, 0.97, 0.22, -0.2, 0, 0);         // bone helm
  b.cone(PLATE2, 0.04, 0.12, 0, 1.04, 0.26, 0.5, 0, 0, 4);            // crest horn
  const a = merger(); // pivot (0, 0.94, 0.04): ram arms, held low and ready
  for (const s of [-1, 1]) {
    a.box(SKIN, 0.15, 0.38, 0.17, s * 0.32, -0.2, 0.1, -0.3, 0, s * 0.1);
    a.cyl(PLATE2, 0.11, 0.13, 0.3, s * 0.36, -0.45, 0.22, -0.6, 0, 0, 6); // fused mace
    a.sph(PLATE, 0.14, s * 0.37, -0.58, 0.3);                            // blunt cap
  }
  return {
    body: b.build(), arms: a.build(),
    pivot: [0, 0.94, 0.04], swingAmp: 0.1, swingRate: 2.4,
    eyes: [[-0.035, 0.92, 0.3], [0.035, 0.92, 0.3]],
  };
}

function callerParts() {
  // The shrieker: too tall, too thin, neck craned back mid-howl, arms thrown
  // up goading the horde. Kill it first — and its shape says so.
  const SKIN = 0x6cc0a4, SKIN2 = 0x57a189, ROBE = 0x3e5f57, CREST = 0xa5f2da;
  const DARK = 0x2c3a35;
  const b = merger();
  b.box(SKIN2, 0.09, 0.42, 0.1, -0.08, 0.21, 0, 0, 0, 0.05);       // stilt legs
  b.box(SKIN2, 0.09, 0.42, 0.1, 0.08, 0.21, 0, 0, 0, -0.05);
  b.box(DARK, 0.09, 0.05, 0.14, -0.08, 0.025, 0.02);
  b.box(DARK, 0.09, 0.05, 0.14, 0.08, 0.025, 0.02);
  b.box(ROBE, 0.26, 0.24, 0.17, 0, 0.5, 0);                          // hanging rags
  b.box(SKIN, 0.24, 0.34, 0.16, 0, 0.78, 0, -0.08, 0, 0);            // gaunt chest
  b.box(SKIN2, 0.16, 0.2, 0.03, 0, 0.78, 0.085);                     // ribs showing
  b.cyl(SKIN, 0.05, 0.06, 0.18, 0, 1.02, 0.02, -0.3, 0, 0, 6);       // craned neck
  b.sph(SKIN, 0.11, 0, 1.14, 0.06, 1, 1.05, 1);                       // head thrown back
  b.box(SKIN2, 0.09, 0.05, 0.1, 0, 1.06, 0.13, 1.0, 0, 0);            // jaw wide open, skyward
  b.cone(CREST, 0.05, 0.2, 0, 1.26, -0.02, -0.4, 0, 0, 4);            // signal crest
  b.cone(CREST, 0.04, 0.14, 0, 1.2, -0.12, -0.9, 0, 0, 4);
  const a = merger(); // pivot (0, 0.92, 0): arms thrown up and out, chained from the shoulder
  for (const s of [-1, 1]) {
    a.box(SKIN, 0.07, 0.26, 0.08, s * 0.17, 0.08, 0.02, 0, 0, s * -0.45);  // upper, angled out
    a.box(SKIN2, 0.06, 0.24, 0.07, s * 0.275, 0.29, 0.025, 0, 0, s * -0.2); // forearm, reaching up
    a.box(SKIN2, 0.085, 0.09, 0.05, s * 0.315, 0.44, 0.03);                // splayed hand
  }
  return {
    body: b.build(), arms: a.build(),
    pivot: [0, 0.92, 0], swingAmp: 0.24, swingRate: 3.8,
    eyes: [[-0.035, 1.15, 0.15], [0.035, 1.15, 0.15]],
  };
}

const BUILDERS = {
  walker: walkerParts, runner: runnerParts, brute: bruteParts,
  spitter: spitterParts, burrower: burrowerParts, sieger: siegerParts,
  caller: callerParts,
};

// A felled body for the ragdoll pool: limbs splayed, one merged geometry.
// Instance color still tints it, so brutes stay purple in death.
export function buildCorpseGeometry() {
  const SKIN = 0xa8a89a, CLOTH = 0x8c887c, DARK = 0x4c4a42, BLOOD = 0x77332a;
  const b = merger();
  b.box(CLOTH, 0.34, 0.44, 0.22, 0, 0.42, 0);                    // torso
  b.box(BLOOD, 0.2, 0.16, 0.03, 0.04, 0.46, 0.115);
  b.sph(SKIN, 0.13, 0.03, 0.72, 0.03);                            // head, askew
  b.box(DARK, 0.1, 0.3, 0.11, -0.1, 0.14, 0.05, 0.25, 0, 0.3);    // legs, splayed
  b.box(DARK, 0.1, 0.3, 0.11, 0.11, 0.14, -0.03, -0.15, 0, -0.35);
  b.box(SKIN, 0.08, 0.28, 0.09, -0.24, 0.5, 0.04, 0, 0, 1.1);     // arms, flung
  b.box(SKIN, 0.08, 0.26, 0.09, 0.24, 0.44, -0.02, 0, 0, -1.25);
  const geo = b.build();
  geo.translate(0, -0.42, 0); // center it: corpses tumble around their middle
  return geo;
}

// ---------------- instanced writer ----------------

const _d = new THREE.Object3D();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _c = new THREE.Color();

export class HordeArt {
  constructor(scene, max) {
    this.scene = scene;
    this.max = max;
    this.sets = {};
    for (const [type, buildParts] of Object.entries(BUILDERS)) {
      const parts = buildParts();
      const bodyMat = applyRim(
        new THREE.MeshLambertMaterial({ vertexColors: true }),
        { color: 0x9fb4de, power: 2.0, strength: 0.58 },
      );
      // body and arms share one rimmed material (clone() would drop the
      // onBeforeCompile rim hook); both meshes are instanced+colored, so the
      // compiled program is identical for the pair.
      const body = new THREE.InstancedMesh(parts.body, bodyMat, max);
      const arms = new THREE.InstancedMesh(parts.arms, bodyMat, max);
      const eyeGeo = merger();
      for (const [x, y, z] of parts.eyes) eyeGeo.box(0xffffff, 0.055, 0.045, 0.045, x, y, z);
      const eyes = new THREE.InstancedMesh(eyeGeo.build(), new THREE.MeshBasicMaterial({ vertexColors: true }), max);
      for (const m of [body, arms, eyes]) {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.castShadow = m !== eyes;
        m.frustumCulled = false;
        m.count = 0;
        scene.add(m);
      }
      this.sets[type] = {
        body, arms, eyes, cursor: 0,
        pivot: new THREE.Matrix4().makeTranslation(parts.pivot[0], parts.pivot[1], parts.pivot[2]),
        swingAmp: parts.swingAmp, swingRate: parts.swingRate,
      };
    }
  }

  begin() {
    for (const set of Object.values(this.sets)) set.cursor = 0;
  }

  // One zombie, one call. Transform grammar matches the old shared-pool
  // writer: position (bob/lunge already applied by the caller), pitch/yaw/roll,
  // per-axis squash scale. `tint` is any {r,g,b}; `eyeHex` a packed color.
  write(type, x, y, z, pitch, yaw, roll, sx, sy, sz, t, phase, lunge, tint, eyeHex) {
    const set = this.sets[type] || this.sets.walker;
    const i = set.cursor;
    if (i >= this.max) return;
    set.cursor = i + 1;
    _d.position.set(x, y, z);
    _d.rotation.set(pitch, yaw, roll);
    _d.scale.set(sx, sy, sz);
    _d.updateMatrix();
    set.body.setMatrixAt(i, _d.matrix);
    set.eyes.setMatrixAt(i, _d.matrix);
    // Arms swing at the type's own cadence, and haul up into the lunge.
    const swing = Math.sin(t * set.swingRate + phase * 1.7) * set.swingAmp - lunge * 0.9;
    _m1.makeRotationX(swing);
    _m2.copy(_d.matrix).multiply(set.pivot).multiply(_m1);
    set.arms.setMatrixAt(i, _m2);
    _c.setRGB(tint.r, tint.g, tint.b);
    set.body.setColorAt(i, _c);
    set.arms.setColorAt(i, _c);
    _c.setHex(eyeHex);
    set.eyes.setColorAt(i, _c);
  }

  commit() {
    for (const set of Object.values(this.sets)) {
      for (const m of [set.body, set.arms, set.eyes]) {
        m.count = set.cursor;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  clear() {
    for (const set of Object.values(this.sets)) {
      set.cursor = 0;
      for (const m of [set.body, set.arms, set.eyes]) {
        m.count = 0;
        m.instanceMatrix.needsUpdate = true;
      }
    }
  }

  dispose() {
    for (const set of Object.values(this.sets)) {
      for (const m of [set.body, set.arms, set.eyes]) {
        this.scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
        m.dispose();
      }
    }
    this.sets = {};
  }
}
