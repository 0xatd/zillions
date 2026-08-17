// Building mesh construction — the colony kit. Extracted from main.js so the
// builders can run headless (previews, tooling) and live beside unit-art and
// horde-art as the third leg of the procedural art layer.
//
// buildBuildingMesh(b, ctx) returns the authored GLB where one exists (hq,
// default towers, camps, mine — art-slice models loaded by assets.js) and the
// procedural colony-kit mesh otherwise. ctx carries what the wall polyline
// needs: { mapSize, wallTiles: Set<z*N+x> of all wall-plot tiles }.
// Presentation only: nothing here touches simulation state.
import * as THREE from 'three';
import { assetClone, assetPart } from './assets.js';

// Trampled-ground skirt: a soft dark footprint under every structure, so
// buildings sit IN the land instead of standing on untouched meadow.
// Presentation only — reads as worked earth from any zoom.
export function groundSkirt(b) {
  const r = Math.max(1.15, (b.size || 1.5) * 0.72);
  const geo = new THREE.CircleGeometry(r, 18);
  geo.rotateX(-Math.PI / 2);
  const skirt = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    color: 0x37322b, transparent: true, opacity: 0.42, depthWrite: false,
  }));
  skirt.position.y = 0.03;
  skirt.receiveShadow = true;
  return skirt;
}

function authoredBuildingMesh(b) {
  const tier = Math.max(1, Math.min(3, Number(b.plotTier) || 1));
  let key = null;
  if (b.kind === 'hq') key = `humanHqT${tier}`;
  else if (b.kind === 'tower' && !b.branch) key = `humanTowerT${tier}`;
  else if (b.kind.startsWith('camp_')) key = `humanBarracksT${tier}`;
  else if (b.kind === 'mine') key = 'humanMine';
  if (!key) return null;
  const model = assetClone(key);
  if (!model) return null;
  const g = new THREE.Group();
  g.add(model);
  g.add(groundSkirt(b));
  g.userData.authored = true;
  g.userData.head = assetPart(model, 'part_turret');
  g.userData.rotor = assetPart(model, 'part_rotor');
  g.userData.core = assetPart(model, 'part_core');
  return g;
}

export function buildBuildingMesh(b, ctx = {}) {
  const authored = authoredBuildingMesh(b);
  if (authored) return authored;
  const g = new THREE.Group();
  const M = (color, e = 0) => new THREE.MeshLambertMaterial({ color, emissive: e ? color : 0x000000, emissiveIntensity: e });
  const box = (w, h, dep, color, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), M(color));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m); return m;
  };
  const cyl = (r1, r2, h, color, x = 0, y = 0, z = 0, seg = 10) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), M(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m); return m;
  };
  const cone = (r, h, color, x = 0, y = 0, z = 0, seg = 4) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), M(color));
    m.position.set(x, y, z);
    m.rotation.y = Math.PI / 4;
    m.castShadow = true;
    g.add(m); return m;
  };
  // Always-lit accent: marker lights, sensor bands, holo panels.
  const lit = (w, h, dep, color, x = 0, y = 0, z = 0, i = 0.7) => {
    const m = box(w, h, dep, color, x, y, z);
    m.material.emissive.setHex(color);
    m.material.emissiveIntensity = i;
    m.castShadow = false;
    return m;
  };
  // The colony kit: one hull family + one trim so every structure on the
  // planet reads as the same expedition's prefab, never a random block.
  const HULL = 0xe6e0d0, HULL2 = 0xcfc9b8, PAD = 0x9c968a, TRIM = 0xe8843c, SOLAR = 0x31506b, GLOW = 0x5fd8c8;
  const windows = (n, y, r, color = 0xffca6e) => {
    // Emissive windows that glow at night (renderer toggles intensity).
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.03), M(color, 0.0));
      w.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      w.lookAt(Math.cos(a) * 2 * r, y, Math.sin(a) * 2 * r);
      w.userData.window = true;
      g.add(w);
    }
  };
  const tier = b.plotTier || 1;

  switch (b.kind) {
    case 'hq': {
      // Colony Command: a terraced landing terrace, the operations hall
      // with a lit sensor band, comm pylons that fill in as it grows, and
      // one tall control spire with a dish and a beacon you can find from
      // anywhere on the planet.
      box(4.6, 0.4, 4.6, PAD, 0, 0.2);
      box(3.9, 0.4, 3.9, 0xaba593, 0, 0.6);
      lit(3.92, 0.06, 3.92, TRIM, 0, 0.82, 0, 0.4);      // terrace edge light
      box(3.1, 1.5, 3.1, HULL, 0, 1.55);
      box(3.3, 0.24, 3.3, HULL2, 0, 2.4);                // hall cornice
      lit(3.14, 0.14, 3.14, GLOW, 0, 1.95, 0, 0.35);     // ops glass band
      const pylon = (x, z) => {
        cyl(0.3, 0.4, 2.7, HULL2, x, 1.8, z, 8);
        lit(0.24, 0.24, 0.24, TRIM, x, 3.25, z, 0.8);
      };
      pylon(1.35, 1.35);
      if (tier >= 2) pylon(-1.35, -1.35);
      if (tier >= 3) { pylon(1.35, -1.35); pylon(-1.35, 1.35); }
      // The spire: taller with every tier.
      const spireH = 2.2 + tier * 0.5;
      cyl(0.68, 0.9, spireH, HULL, 0, 2.4 + spireH / 2, 0, 12);
      lit(1.5, 0.12, 1.5, GLOW, 0, 2.4 + spireH * 0.62, 0, 0.3); // control ring
      cyl(0.95, 0.72, 0.3, HULL2, 0, 2.5 + spireH, 0, 12);        // crown deck
      // Comms dish, aimed at the sky.
      const dish = cyl(0.55, 0.08, 0.3, 0xd8d2c2, 0.45, 2.85 + spireH, 0.35, 10);
      dish.rotation.x = -0.7; dish.rotation.z = -0.35;
      box(0.07, 1.4, 0.07, 0x4a5058, -0.3, 3.15 + spireH, -0.25);
      const beacon = lit(0.2, 0.2, 0.2, tier >= 4 ? 0xf3c53d : TRIM, -0.3, 3.95 + spireH, -0.25, 1.0);
      // Holo-banner off the crown: the expedition's colors.
      const flag = lit(0.7, 0.4, 0.03, TRIM, 0.65, 2.9 + spireH, -0.2, 0.5);
      flag.material.transparent = true; flag.material.opacity = 0.85;
      g.userData.flag = flag;
      windows(6, 1.55, 1.62);
      windows(4, 2.4 + spireH * 0.4, 0.84);
      break;
    }
    case 'house': {
      // Hab unit: white prefab hull, tilted solar roof, lit door. Bigger
      // tiers stack a second module instead of growing a random block.
      // Variation is keyed off the plot id — deterministic, so peers and
      // rebuilds agree — and flips the roof pitch, door side and antenna,
      // so a street of habs reads as a neighborhood, not a print run.
      const vid = b.plotId || b.id || 0;
      const flip = vid % 2 ? 1 : -1;
      const hullVar = new THREE.Color(HULL).offsetHSL(0, 0.004 * (vid % 3), ((vid % 5) - 2) * 0.012).getHex();
      if (tier === 1) {
        box(1.5, 0.1, 1.3, PAD, 0, 0.05);                 // foundation skirt
        box(1.3, 0.7, 1.1, hullVar, 0, 0.4);
        const roof = box(1.36, 0.08, 1.16, SOLAR, 0, 0.83);
        roof.rotation.z = 0.07 * flip;
        lit(0.3, 0.44, 0.04, TRIM, 0.3 * flip, 0.29, 0.56, 0.4);
        if (vid % 3 === 0) box(0.04, 0.5, 0.04, 0x4a5058, -0.5 * flip, 1.0, -0.35);
      } else if (tier === 2) {
        box(1.7, 0.1, 1.5, PAD, 0, 0.05);
        box(1.5, 1.0, 1.3, hullVar, 0, 0.55);
        const roof = box(1.56, 0.09, 1.36, SOLAR, 0, 1.13);
        roof.rotation.z = 0.07 * flip;
        lit(0.32, 0.5, 0.04, TRIM, 0.32 * flip, 0.32, 0.66, 0.4);
        box(0.05, 0.7, 0.05, 0x4a5058, -0.55 * flip, 1.45, -0.4); // antenna
      } else {
        box(1.8, 0.1, 1.6, PAD, 0, 0.05);
        box(1.6, 1.4, 1.4, hullVar, 0, 0.75);
        box(1.0, 0.8, 1.0, HULL2, 0.45 * flip, 1.85, 0.25);
        const roof = box(1.06, 0.08, 1.06, SOLAR, 0.45 * flip, 2.31, 0.25);
        roof.rotation.z = 0.07 * flip;
        box(1.1, 0.1, 1.3, 0x6da06a, -0.4 * flip, 1.53, 0);      // roof garden
        for (const gx of [-0.7, -0.1]) {                          // garden rail
          box(0.04, 0.22, 0.04, 0x4a5058, gx * flip, 1.68, 0.6);
          box(0.04, 0.22, 0.04, 0x4a5058, gx * flip, 1.68, -0.6);
        }
        box(0.66, 0.03, 1.26, 0x565c60, -0.4 * flip, 1.79, 0);
        lit(0.32, 0.52, 0.04, TRIM, 0.3 * flip, 0.33, 0.72, 0.4);
      }
      // Lived-in kit: doorstep pad, an air handler with a hot exhaust eye,
      // and (some homes) a little comms dish aimed at the relay net.
      box(0.5, 0.05, 0.3, PAD, 0.3 * flip * (tier >= 3 ? 1 : 1), 0.03, tier >= 3 ? 0.86 : 0.72);
      box(0.26, 0.2, 0.2, 0x9c968a, -0.5 * flip, tier >= 3 ? 1.56 : tier === 2 ? 1.24 : 0.92, 0.3);
      lit(0.06, 0.06, 0.02, TRIM, -0.5 * flip, tier >= 3 ? 1.6 : tier === 2 ? 1.28 : 0.96, 0.41, 0.6);
      if (vid % 4 === 1) {
        const dish = cyl(0.16, 0.03, 0.1, 0xd8d2c2, 0.45 * flip, tier >= 3 ? 2.5 : tier === 2 ? 1.35 : 1.0, -0.35, 8);
        dish.rotation.x = -0.9;
      }
      windows(tier + 1, tier >= 3 ? 0.85 : 0.45, 0.72);
      break;
    }
    case 'farm': {
      // Hydroponic beds under greenhouse hoops, glowing faintly at the
      // rims, with a nutrient tank and drip line feeding the rows.
      box(1.9, 0.14, 1.9, HULL2, 0, 0.07);
      for (let r = 0; r < 3; r++) {
        box(1.7, 0.18, 0.36, tier >= 2 ? 0x5fd889 : 0x3fae64, 0, 0.2, -0.6 + r * 0.6);
        lit(1.72, 0.03, 0.38, GLOW, 0, 0.31, -0.6 + r * 0.6, 0.25);
        // Crop canopy bumps so the beds read as growth, not paint.
        for (let k = 0; k < 4; k++) {
          box(0.16, 0.1, 0.16, tier >= 2 ? 0x74e099 : 0x54c078, -0.6 + k * 0.4, 0.34, -0.6 + r * 0.6);
        }
      }
      // Greenhouse hoops: a thin white frame arched over the rows.
      for (const hx of [-0.8, 0, 0.8]) {
        box(0.05, 0.66, 0.05, HULL, hx, 0.33, -0.86);
        box(0.05, 0.66, 0.05, HULL, hx, 0.33, 0.86);
        box(0.05, 0.05, 1.82, HULL, hx, 0.68, 0);
      }
      box(1.7, 0.04, 0.05, HULL, 0, 0.68, -0.86);
      box(1.7, 0.04, 0.05, HULL, 0, 0.68, 0.86);
      if (tier >= 2) {
        cyl(0.28, 0.32, 0.6, HULL, 0.72, 0.44, 0.72, 8);  // nutrient tank
        lit(0.3, 0.05, 0.3, TRIM, 0.72, 0.77, 0.72, 0.5);
        box(0.05, 0.05, 1.1, 0x4a5058, 0.72, 0.16, 0.1);   // drip feed line
      }
      break;
    }
    case 'mill': {
      // Wind turbine: slender pylon, nacelle, three long blades — plus the
      // grid hardware that makes it a power plant: anchor struts, a charge
      // regulator with a live meter, and a cable run into the ground.
      const h = tier >= 2 ? 3.1 : 2.5;
      box(1.0, 0.16, 1.0, PAD, 0, 0.08);
      cyl(0.13, 0.24, h, HULL, 0, h / 2, 0, 8);
      for (let i = 0; i < 3; i++) {                       // anchor struts
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const strut = box(0.06, h * 0.42, 0.06, HULL2, Math.cos(a) * 0.34, h * 0.19, Math.sin(a) * 0.34);
        strut.rotation.z = Math.cos(a) * 0.32;
        strut.rotation.x = -Math.sin(a) * 0.32;
      }
      box(0.44, 0.4, 0.34, HULL2, 0.55, 0.36, -0.45);      // charge regulator
      lit(0.3, 0.08, 0.03, GLOW, 0.55, 0.44, -0.27, 0.5);  // live meter
      box(0.08, 0.06, 0.7, 0x4a5058, 0.28, 0.05, -0.2, 0); // buried cable run
      box(0.42, 0.3, 0.7, HULL2, 0, h + 0.1, 0.05);
      lit(0.1, 0.1, 0.1, TRIM, 0, h + 0.1, 0.42, 0.8);
      const rotor = new THREE.Group();
      rotor.position.set(0, h + 0.1, 0.42);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.7, 0.03), M(0xe9e3d4));
        blade.position.y = 0.88;
        blade.castShadow = true;
        const pivot = new THREE.Group();
        pivot.rotation.z = (i * Math.PI * 2) / 3;
        pivot.add(blade);
        rotor.add(pivot);
      }
      g.add(rotor);
      g.userData.rotor = rotor;
      break;
    }
    case 'mine': {
      box(1.9, 0.22, 1.9, PAD, 0, 0.11);
      box(0.8, 0.8, 0.8, HULL2, 0, 0.62);
      box(0.12, 1.8, 0.12, HULL, -0.45, 1.1, -0.45);
      box(0.12, 1.8, 0.12, HULL, 0.45, 1.1, -0.45);
      box(1.2, 0.14, 0.5, HULL2, 0, 2.0, -0.45);
      const wheel = cyl(0.34, 0.34, 0.16, 0xf3c53d, 0, 2.0, -0.45, 12);
      wheel.rotation.x = Math.PI / 2;
      g.userData.rotor = wheel;
      if (tier >= 2) box(1.0, 0.5, 0.7, HULL, 0.55, 0.25, 0.6);
      break;
    }
    case 'tower': {
      // Defense pylon: the tower silhouette kept (base plinth, tapering
      // shaft, flared gun deck wider than the shaft) but drawn in hull
      // plate with a sensor band and deck railing — not castle stone.
      const h = 2.3 + tier * 0.5;
      const hull = tier >= 3 ? 0xece6d6 : HULL;
      box(1.75, 0.36, 1.75, PAD, 0, 0.18);
      cyl(0.58, 0.78, h - 0.3, hull, 0, 0.3 + (h - 0.3) / 2, 0, 12);
      const band = cyl(0.63, 0.72, 0.16, GLOW, 0, h * 0.45, 0, 12);
      band.material.emissive.setHex(GLOW);
      band.material.emissiveIntensity = 0.5;
      cyl(0.92, 0.66, 0.42, HULL2, 0, h + 0.06, 0, 12);   // flared gun deck
      cyl(0.98, 0.98, 0.1, PAD, 0, h + 0.32, 0, 12);      // deck plate
      for (let i = 0; i < 6; i++) {                       // deck railing
        const a = (i / 6) * Math.PI * 2 + 0.26;
        box(0.06, 0.3, 0.06, 0x4a5058, Math.cos(a) * 0.86, h + 0.5, Math.sin(a) * 0.86);
      }
      lit(0.14, 0.14, 0.14, TRIM, 0, h + 0.32, 0.86, 0.9); // muzzle marker
      windows(2, h * 0.62, 0.68);
      const head = new THREE.Group();
      head.position.y = h + 0.52;
      if (b.branch === 'flame') {
        // Incinerator crown: armored fuel bowl, twin tanks racked on the
        // deck, feed hose, and a pilot light that never goes out.
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.28, 0.35, 8), M(0x3d4246));
        head.add(bowl);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 8), M(0x2f3338));
        collar.position.y = 0.18;
        head.add(collar);
        const fire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 6), M(0xff7a2e, 0.9));
        fire.position.y = 0.4;
        head.add(fire);
        g.userData.flame = fire;
        for (const side of [-1, 1]) {
          const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.4, 8), M(0xb0492a));
          tank.position.set(side * 0.3, -0.28, -0.34);
          tank.castShadow = true;
          head.add(tank);
          const band = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.05), M(0xe8a83c));
          band.position.set(side * 0.3, -0.2, -0.31);
          head.add(band);
        }
        const pilot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), M(0xffb45e, 1.0));
        pilot.position.set(0, 0.12, 0.42);
        head.add(pilot);
      } else {
        const bal = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, b.branch === 'ballista' ? 1.5 : 0.9), M(0x4a4440));
        bal.position.z = 0.1;
        bal.castShadow = true;
        head.add(bal);
        if (b.branch === 'ballista') {
          // Siege lance: throw arms, drawn cable, mounted bolt, ammo rack.
          for (const side of [-1, 1]) {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.07), M(0x565c60));
            arm.position.set(side * 0.34, 0.1, 0.5);
            arm.rotation.y = side * -0.5;
            head.add(arm);
          }
          const cable = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.025, 0.025), M(0x2b2d31));
          cable.position.set(0, 0.1, 0.28);
          head.add(cable);
          const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.01, 0.9, 5), M(0xd8d2c2));
          bolt.rotation.x = Math.PI / 2;
          bolt.position.set(0, 0.14, 0.3);
          head.add(bolt);
          const rack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.6), M(0x6b6152));
          rack.position.set(-0.3, -0.02, -0.35);
          head.add(rack);
        }
      }
      g.add(head);
      g.userData.head = head;
      break;
    }
    case 'wall': {
      // The rampart is drawn as a SMOOTHED POLYLINE, not a stack of
      // axis-aligned blocks. Each tile pulls its pier toward the average of
      // its wall neighbors — an L-corner chamfers into a 45° cut — and
      // hangs a rotated curtain panel out to the midpoint it shares with
      // each neighbor. Adjacent tiles meet exactly at those midpoints, so a
      // curving ring reads as a curve and a diagonal run as one straight
      // wall, while the sim keeps its plain tile occupancy untouched.
      const N = ctx.mapSize || 0;
      const wallTiles = ctx.wallTiles || new Set();
      const nbs = [];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (wallTiles.has((b.z + dz) * N + (b.x + dx))) nbs.push([dx, dz]);
      }
      // Chamfered pier position (local to the tile center).
      let scx = 0, scz = 0;
      for (const [dx, dz] of nbs) { scx += dx * 0.26; scz += dz * 0.26; }
      // One segment per neighbor: pier → shared midpoint on the tile edge.
      const segs = nbs.map(([dx, dz]) => {
        const ex = dx * 0.5, ez = dz * 0.5;
        return {
          mx: (scx + ex) / 2, mz: (scz + ez) / 2,
          len: Math.hypot(ex - scx, ez - scz) + 0.12,
          yaw: Math.atan2(ez - scz, ex - scx),
        };
      });
      const panel = (s, len, h, thick, color, y) => {
        const m = box(len, h, thick, color, s.mx, y, s.mz);
        m.rotation.y = -s.yaw;
        return m;
      };
      // Wall run direction (for orienting the gate) and its perpendicular.
      const run = nbs.length === 2
        ? Math.atan2(nbs[0][1] - nbs[1][1], nbs[0][0] - nbs[1][0])
        : nbs.length ? Math.atan2(nbs[0][1], nbs[0][0]) : 0;
      const pvx = -Math.sin(run), pvz = Math.cos(run);
      const passYaw = Math.atan2(pvz, pvx);
      // Barrier ladder: razorwire fence → hull-plate curtain → shock/bastion.
      const shock = b.branch === 'shock';
      const bastion = b.branch === 'bastion';
      const capCol = 0x8a8069;
      if (tier === 1 && !b.gate) {
        // Razorwire: gunmetal post + taut wire strands along each segment.
        box(0.16, 0.78, 0.16, 0x565c60, scx, 0.39, scz);
        box(0.2, 0.06, 0.2, 0xe8a83c, scx, 0.81, scz); // hazard cap
        for (const s of segs) {
          for (const wy of [0.3, 0.6]) panel(s, s.len, 0.045, 0.045, 0x9aa0a2, wy);
        }
        break;
      }
      const H = bastion ? 1.55 : tier >= 3 ? 1.1 : tier === 1 ? 0.8 : 0.95;
      const hull = bastion ? 0xece6d6 : tier === 1 ? 0xb9b19c : HULL;
      if (b.gate) {
        // The gate is UNMISTAKABLE: low lit wing-walls tie into the
        // rampart, two tall pylons stand astride the passage, a bright
        // portal arch spans them, and an amber threshold glows on the
        // ground through the opening — readable from across the map.
        for (const s of segs) {
          panel(s, s.len, H * 0.55, 0.32, hull, H * 0.275);
          panel(s, s.len + 0.05, 0.12, 0.38, capCol, H * 0.55 + 0.06);
        }
        const towH = H + 1.25;
        for (const side of [-1, 1]) {
          const px = pvx * side * 0.46, pz = pvz * side * 0.46;
          const pyl = box(0.44, towH, 0.44, hull, px, towH / 2, pz);
          pyl.rotation.y = -run;
          const cap = box(0.52, 0.14, 0.52, capCol, px, towH + 0.07, pz);
          cap.rotation.y = -run;
          const light = lit(0.56, 0.16, 0.56, TRIM, px, towH + 0.24, pz, 0.9);
          light.rotation.y = -run;
        }
        const arch = lit(1.06, 0.2, 0.2, TRIM, 0, towH - 0.2, 0, 0.75);
        arch.rotation.y = -passYaw;
        const threshold = lit(1.6, 0.05, 0.56, TRIM, 0, 0.05, 0, 0.45);
        threshold.rotation.y = -passYaw;
        threshold.material.transparent = true;
        threshold.material.opacity = 0.75;
        const ban = assetClone('banner', 0.7);
        if (ban) { ban.position.set(pvx * -0.9, 0, pvz * -0.9); g.add(ban); }
        break;
      }
      // Weathered plate: hull tint drifts a few percent per tile (keyed off
      // tile coords, so peers and rebuilds agree) and every curtain carries a
      // darker splash-guard base band — a long rampart reads as patched
      // fieldwork under siege, never one extruded part.
      const wear = (((b.x * 7 + b.z * 13) % 5) - 2) * 0.016;
      const hullWorn = new THREE.Color(hull).offsetHSL(0, 0, wear).getHex();
      const guard = new THREE.Color(hull).offsetHSL(0, 0.01, -0.09 + wear).getHex();
      // Rounded pier at the chamfered point, slightly proud of the curtains.
      cyl(0.3, 0.34, H + 0.14, hullWorn, scx, (H + 0.14) / 2, scz, 8);
      cyl(0.37, 0.37, 0.12, capCol, scx, H + 0.2, scz, 8);
      lit(0.16, 0.1, 0.16, TRIM, scx, H + 0.32, scz, 0.8); // perimeter marker light
      for (const s of segs) {
        panel(s, s.len, H, 0.34, hullWorn, H / 2);
        panel(s, s.len, 0.24, 0.4, guard, 0.12);            // splash-guard base
        panel(s, s.len + 0.05, 0.14, 0.42, capCol, H + 0.07);
        // Shock fence: a live plasma conduit runs the parapet.
        if (shock) {
          const strip = panel(s, s.len, 0.07, 0.1, 0x4dd8c8, H + 0.19);
          strip.material.emissive.setHex(0x4dd8c8);
          strip.material.emissiveIntensity = 0.9;
        }
      }
      if (shock) {
        const core = box(0.2, 0.2, 0.2, 0x4dd8c8, scx, H + 0.42, scz);
        core.material.emissive.setHex(0x4dd8c8);
        core.material.emissiveIntensity = 1.0;
      }
      if (!segs.length) box(0.9, H, 0.9, hull, 0, H / 2); // stranded stub (shouldn't happen)
      break;
    }
    case 'outpost': {
      // A staked claim: drop-pad, field dome, and a tall relay mast you can
      // pick out from across the map. Sandbag corners and a searchlight say
      // someone intends to hold it.
      box(1.9, 0.24, 1.9, PAD, 0, 0.12);
      cone(0.95, 1.05, HULL, -0.35, 0.55, -0.25, 8);
      box(0.34, 0.3, 0.06, 0x6a655a, -0.35, 0.42, 0.28);   // dome hatch
      box(0.9, 0.6, 0.7, HULL2, 0.55, 0.3, 0.5);
      for (const [sx, sz] of [[-0.85, 0.85], [0.85, -0.85], [-0.85, -0.85]]) {
        box(0.5, 0.18, 0.2, 0x8a8069, sx, 0.33, sz);        // sandbag line
        box(0.4, 0.16, 0.18, 0x9a907a, sx, 0.49, sz);
      }
      const lampArm = box(0.05, 0.05, 0.4, 0x4a5058, 0.85, 2.5, -0.55);
      lampArm.rotation.x = 0.3;
      lit(0.14, 0.12, 0.14, 0xfff2c8, 0.85, 2.42, -0.36, 0.9); // searchlight
      box(0.08, 3.4, 0.08, 0x4a5058, 0.85, 1.7, -0.7);
      lit(0.6, 0.4, 0.03, 0x59b06e, 0.5, 3.1, -0.7, 0.5);
      if (tier >= 2) {
        box(0.75, 0.85, 0.75, HULL2, -0.7, 0.42, 0.75);
        box(0.08, 3.4, 0.08, 0x4a5058, -0.85, 1.7, -0.7);
        lit(0.6, 0.4, 0.03, 0x59b06e, -0.5, 3.1, -0.7, 0.5);
        const head = new THREE.Group();
        head.position.set(0.25, 1.65, -0.15);
        const gun = new THREE.Mesh(new THREE.BoxGeometry(tier >= 3 ? 0.34 : 0.24, 0.2, tier >= 3 ? 1.25 : 0.78), M(tier >= 3 ? 0x4a4440 : 0x2f3a44));
        gun.position.z = 0.25;
        gun.castShadow = true;
        head.add(gun);
        if (tier >= 3) {
          const shield = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.62, 0.12), M(0x6b6152));
          shield.position.set(0, -0.05, -0.18);
          shield.castShadow = true;
          head.add(shield);
          box(1.8, 0.45, 0.28, 0x4d5560, 0, 0.8, -0.9);
        }
        g.add(head);
        g.userData.head = head;
      }
      break;
    }
    case 'workshop': {
      // Fabrication bay: the drone hall plus the tooling that explains it —
      // a gantry crane over a work slab, coil stack, and a hot vent.
      box(1.9, 0.25, 1.9, PAD, 0, 0.12);
      box(1.5, 1.0, 1.25, HULL, 0, 0.62);
      box(1.7, 0.16, 1.45, HULL2, 0, 1.15);
      lit(1.52, 0.07, 1.27, GLOW, 0, 1.06, 0, 0.3);
      box(0.1, 0.9, 0.1, 0x4a5058, -0.82, 0.45, 0.72);     // gantry legs
      box(0.1, 0.9, 0.1, 0x4a5058, 0.82, 0.45, 0.72);
      box(1.78, 0.1, 0.12, 0x565c60, 0, 0.95, 0.72);       // gantry beam
      box(0.12, 0.3, 0.1, 0xe8a83c, 0.25, 0.76, 0.72);     // hoist carriage
      box(0.7, 0.12, 0.5, 0x6a655a, 0.25, 0.2, 0.72);      // work slab
      cyl(0.12, 0.12, 0.5, 0x565c60, -0.6, 1.48, -0.45, 8); // coil stack
      lit(0.14, 0.06, 0.14, TRIM, -0.6, 1.76, -0.45, 0.7);
      box(0.3, 0.2, 0.2, 0x9c968a, 0.55, 1.33, -0.5);       // hot vent
      lit(0.22, 0.04, 0.14, 0xff9a4d, 0.55, 1.24, -0.5, 0.45);
      const rotor = new THREE.Group();
      rotor.position.set(0, 1.55, 0);
      for (let i = 0; i < 3 + tier; i++) {
        const a = (i / (3 + tier)) * Math.PI * 2;
        const drone = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.42), M(0x55ddeb, 0.7));
        drone.position.set(Math.cos(a) * (0.65 + tier * 0.12), Math.sin(a * 2) * 0.12, Math.sin(a) * (0.65 + tier * 0.12));
        rotor.add(drone);
      }
      g.add(rotor);
      g.userData.rotor = rotor;
      break;
    }
    case 'hero_forge': {
      // Ascension machine: stepped dais, four conduit pylons feeding the
      // levitating core, coolant lines snaking to the base.
      cyl(1.15, 1.4, 0.2, 0x8f897d, 0, 0.1, 0, 10);        // lower step
      cyl(1.0, 1.25, 0.45, PAD, 0, 0.32, 0, 10);
      lit(0.06, 0.04, 2.0, GLOW, 0, 0.43, 0, 0.4);          // inlaid power seams
      const seam = lit(0.06, 0.04, 2.0, GLOW, 0, 0.43, 0, 0.4);
      seam.rotation.y = Math.PI / 2;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        box(0.22, 1.8 + tier * 0.25, 0.22, HULL2, Math.cos(a) * 0.82, 0.9 + tier * 0.12, Math.sin(a) * 0.82);
        lit(0.1, 0.5, 0.1, GLOW, Math.cos(a) * 0.82, 1.4 + tier * 0.2, Math.sin(a) * 0.82, 0.35); // conduit glass
        const pipe = cyl(0.05, 0.05, 0.8, 0x4a5058, Math.cos(a) * 1.15, 0.18, Math.sin(a) * 1.15, 6);
        pipe.rotation.z = Math.cos(a) * 1.2;
        pipe.rotation.x = -Math.sin(a) * 1.2;
      }
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.48 + tier * 0.1, 0), M(tier >= 3 ? 0xffd75e : 0x72cfff, 1.0));
      core.position.y = 1.65 + tier * 0.2;
      core.userData.window = true;
      g.add(core);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85 + tier * 0.1, 0.08, 8, 32), M(0x72cfff, 0.8));
      ring.position.y = core.position.y;
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      g.userData.rotor = ring;
      break;
    }
    case 'camp_militia':
    case 'camp_ranger':
    case 'camp_sniper': {
      // Muster bay: a quonset prefab with a doctrine-colored light stripe,
      // so the three camp kinds read apart at a glance without clutter.
      const col = b.kind === 'camp_militia' ? 0x5f9ccf : b.kind === 'camp_ranger' ? 0x74c96a : 0xb98fe0;
      const hut = cyl(0.62, 0.62, 1.5, HULL, -0.25, 0.5, 0.05, 10);
      hut.rotation.z = Math.PI / 2;
      box(0.06, 1.24, 1.24, HULL2, 0.52, 0.5, 0.05); // end wall
      lit(1.52, 0.06, 0.1, col, -0.25, 0.98, 0.05, 0.7); // doctrine stripe
      box(1.5, 0.1, 1.9, PAD, -0.2, 0.05, 0);        // muster pad
      box(0.06, 1.7, 0.06, 0x4a5058, 0.85, 0.9, -0.7);
      lit(0.5, 0.3, 0.03, col, 0.58, 1.55, -0.7, 0.55); // holo banner
      if (tier >= 2) box(0.7, 0.5, 0.6, HULL2, -0.6, 0.3, 0.75);
      break;
    }
  }

  // CC0 prop dressing (skipped gracefully when assets are unavailable).
  const dress = (assetKey, fit, x, z, ry = 0) => {
    const a = assetClone(assetKey, fit);
    if (a) { a.position.set(x, 0, z); a.rotation.y = ry; g.add(a); }
  };
  if (b.kind === 'hq') {
    dress('banner', 0.85, -1.7, 0.6);
    dress('banner', 0.85, 1.7, 0.6, Math.PI);
    dress('crates', 1.1, -1.4, 1.5, 0.4);
    dress('torch', 0.45, 1.5, 1.6);
  } else if (b.kind.startsWith('camp') || b.kind === 'outpost') {
    dress('boxes', 0.9, -0.75, -0.6, 0.7);
    dress('torch', 0.42, 0.2, 0.85);
  } else if (b.kind === 'house' && tier >= 2) {
    dress('barrel', 0.5, 0.75, 0.6);
  } else if (b.kind === 'mine') {
    dress('crates', 0.9, 0.8, -0.8, 0.3);
  } else if (b.kind === 'tower') {
    dress('torch', 0.4, 0.7, 0.7);
  } else if (b.kind === 'mill') {
    dress('barrel', 0.5, 0.8, 0.6);
  }
  if (b.kind !== 'wall') g.add(groundSkirt(b));
  return g;
}

