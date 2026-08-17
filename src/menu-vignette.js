// Menu attract show: procedural last stands playing out on the menu backdrop.
// A trooper (the real in-game marine mesh) runs the real terrain with a horde
// of real instanced zombies on their heels. They kite, they shoot, the mob
// keeps growing, and eventually the ground runs out — cornered against crag or
// water, they go down, their lamp dies, and the hill goes dark. A beat later a
// new light comes in from another part of the screen and it happens again,
// never quite the same way twice.
//
// Presentation only. This never touches the deterministic sim: no Game, no
// commands, no snapshots — it may freely use Math.random(), and it is created
// and destroyed with the menu backdrop.
//
// Like terrain.js, this module never imports three.js, so the committed
// check (scripts/menu-vignette-check.mjs) can run the whole show headless in
// Node. Everything renderer-shaped comes in through the constructor: the
// caller's mesh factory, the shared horde writer (HordeArt), a scratch
// dummy/color pair, the squad lamp, and a screen projector.
import { FlowField } from './flowfield.js';
import { UNITS, ZOMBIES } from './config.js';
import { clamp, lerp } from './utils.js';

const MOB_CAP = 150;         // far below the shared instanced-pool capacity
const STAGE_R = 26;          // vignettes live where the orbiting camera can see
const FLOW_PERIOD = 0.45;    // horde pathing recompute cadence (seconds)
const SCENARIOS = [
  { id: 'runner', name: 'LONE SIGNAL', squad: [1, 1], hold: false, ramp: 1.35 },
  { id: 'checkpoint', name: 'BROKEN CHECKPOINT', squad: [3, 4], hold: true, ramp: 1.05 },
  { id: 'palisade', name: 'PALISADE BREACH', squad: [4, 5], hold: true, ramp: 1.15 },
  { id: 'evac', name: 'EVACUATION LINE', squad: [3, 4], hold: true, ramp: 1.28 },
  { id: 'dropship', name: 'CRASHED DROPSHIP', squad: [2, 4], hold: true, ramp: 1.18 },
  { id: 'keep', name: 'FINAL KEEP', squad: [5, 6], hold: true, ramp: 1.38 },
];

export class MenuVignette {
  constructor({ scene, map, makeUnitMesh, horde, burst, stream, addCorpse, dispose3D, light, dummy, color, project, initialCount = 0 }) {
    this.scene = scene;
    this.map = map;
    this.makeUnitMesh = makeUnitMesh;
    this.horde = horde;       // shared per-type instanced horde writer
    this.burst = burst;
    this.stream = stream;
    this.addCorpse = addCorpse;
    this.dispose3D = dispose3D;
    this.project = project;   // (x, y, z) -> NDC {x, y}, for keeping drama on screen

    this.flow = new FlowField(map);
    this.occ = new Int32Array(map.size * map.size); // no buildings on the menu
    this.flowT = 0;
    this.flowReady = false;

    this.troopers = [];
    this.zombies = [];
    this.phase = 'dark';      // 'dark' (between vignettes) | 'run'
    this.phaseT = 1.2;        // short beat before the first squad arrives
    this.elapsed = 0;
    this.spawnAcc = 0;
    this.observed = initialCount;
    this.scenario = SCENARIOS[0];
    this.outcome = 'pending';
    this.anchor = { x: map.size / 2, z: map.size / 2 };

    // The doomed squad's lamp — the light that "comes in" with each vignette
    // and dies with it.
    this.light = light;
    this.light.intensity = 0;
    this.lightTarget = 0;
    scene.add(this.light);

    this._dummy = dummy;
    this._color = color;
  }

  update(dt, t) {
    dt = Math.min(dt, 0.1);
    if (this.phase === 'dark') {
      this.phaseT -= dt;
      this.lightTarget = 0;
      this._disperseMob(dt, t);
      if (this.phaseT <= 0 && !this.zombies.length) this._beginVignette();
    } else {
      this.elapsed += dt;
      this.lightTarget = 2.7;
      this._updateTroopers(dt, t);
      this._spawnMob(dt);
      this._updateMob(dt, t);
      if (!this.troopers.some((tr) => !tr.dead)) {
        // The squad is gone. Hold on the feeding mob for a beat, then dark.
        this.phase = 'dark';
        this.phaseT = 3.2;
      }
      if (this.outcome === 'victory') {
        this.phaseT -= dt;
        if (this.phaseT <= 0) { this.phase = 'dark'; this.phaseT = 3.2; }
      }
    }
    this._updateLight(dt);
    this._updateFallen(dt);
    this._writeMob(t);
  }

  dispose() {
    this.scene.remove(this.light);
    for (const tr of this.troopers) {
      this.scene.remove(tr.mesh);
      this.dispose3D(tr.mesh);
    }
    this.troopers = [];
    this.zombies = [];
    this.horde.clear();
  }

  // ---------------- vignette setup ----------------

  _beginVignette() {
    const anchor = this._pickStage();
    if (!anchor) { this.phaseT = 0.8; return; } // try again next beat

    // Clear any fallen marine still settling from the last stand.
    for (const tr of this.troopers) {
      this.scene.remove(tr.mesh);
      this.dispose3D(tr.mesh);
    }

    this.observed++;
    this.scenario = SCENARIOS[(this.observed - 1) % SCENARIOS.length];
    this.outcome = this.observed % 100 === 0 ? 'victory' : 'pending';
    this.phaseT = this.outcome === 'victory' ? 999 : 0;
    this.anchor = anchor;
    // Never quite the same story: squad size, corps, entry heading, and how
    // fast the planet's hunger ramps all reroll every time.
    const [lo, hi] = this.scenario.squad;
    const squadSize = lo + ((Math.random() * (hi - lo + 1)) | 0);
    const kinds = ['soldier', 'soldier', 'ranger', 'sniper'];
    const kind = kinds[(Math.random() * kinds.length) | 0];
    const heading = Math.random() * Math.PI * 2;

    this.troopers = [];
    for (let i = 0; i < squadSize; i++) {
      const def = UNITS[kind];
      const mesh = this.makeUnitMesh({ hero: false, def, key: kind });
      const x = anchor.x + (Math.random() - 0.5) * 1.6;
      const z = anchor.z + (Math.random() - 0.5) * 1.6;
      mesh.position.set(x, this.map.groundY(x, z), z);
      this.scene.add(mesh);
      this.troopers.push({
        mesh, def, x, z,
        hp: def.hp,
        dirX: Math.sin(heading), dirZ: Math.cos(heading),
        threatX: 0, threatZ: 0,
        speed: 3.05 + Math.random() * 0.25,
        fireT: Math.random() * 0.3,
        steerT: 0,
        attackT: 0,
        cornered: this.scenario.hold,
        dead: false,
        fallT: -1,
        seed: Math.random() * 1000,
      });
    }

    this.zombies = [];
    this.elapsed = 0;
    this.spawnAcc = 0;
    this.flowT = 0;
    this.flowReady = false;
    // Growth reroll: how quickly this world's zillions close the noose.
    this.mobRamp = this.scenario.ramp * (0.9 + Math.random() * 0.25);
    this.hungerRamp = 0.016 + Math.random() * 0.012;
    this.phase = 'run';
    // The horde comes in mostly from behind the squad's heading, with a wide
    // scatter so some of it is always cutting across the escape line.
    this.mobHeading = heading + Math.PI;
    this.light.position.set(anchor.x, this.map.groundY(anchor.x, anchor.z) + 3, anchor.z);
  }

  // A vignette needs walkable ground with room to run, close enough to the
  // orbit's focus that the whole chase stays on screen.
  _pickStage() {
    const c = this.map.size / 2;
    let fallback = null;
    for (let tries = 0; tries < 60; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * (STAGE_R - 8);
      const x = Math.round(c + Math.sin(a) * r);
      const z = Math.round(c + Math.cos(a) * r);
      if (!this.map.isWalkable(x, z)) continue;
      let open = 0;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) if (this.map.isWalkable(x + dx, z + dz)) open++;
      }
      if (open < 17) continue;
      if (!fallback) fallback = { x, z };
      const p = this.project(x, this.map.groundY(x, z), z);
      if (p && Math.abs(p.x) < 0.72 && Math.abs(p.y) < 0.85) return { x, z };
    }
    return fallback;
  }

  // ---------------- the squad ----------------

  _updateTroopers(dt, t) {
    // Horde center of mass: what the squad is running FROM.
    let mx = 0, mz = 0, alive = 0;
    for (const zb of this.zombies) { mx += zb.x; mz += zb.z; alive++; }
    if (alive) { mx /= alive; mz /= alive; }

    for (const tr of this.troopers) {
      if (tr.dead) continue;
      if (alive) {
        const ax = tr.x - mx, az = tr.z - mz;
        const ad = Math.hypot(ax, az) || 1;
        tr.threatX = ax / ad; tr.threatZ = az / ad;
      }

      // Steering: repick an escape heading a few times a second. When every
      // way out scores as a wall or a wall of dead, the trooper is cornered —
      // the terrain has done its work, and the last stand begins.
      tr.steerT -= dt;
      if (tr.steerT <= 0) {
        tr.steerT = 0.35;
        const dir = this.scenario.hold ? null : this._pickFleeDir(tr);
        if (dir) { tr.dirX = dir[0]; tr.dirZ = dir[1]; tr.cornered = false; }
        else tr.cornered = true;
      }

      let moving = false;
      if (!tr.cornered && alive) {
        const nx = tr.x + tr.dirX * tr.speed * dt;
        const nz = tr.z + tr.dirZ * tr.speed * dt;
        if (this.map.isWalkable(nx | 0, nz | 0)) { tr.x = nx; tr.z = nz; moving = true; }
        else tr.cornered = true;
      }

      // Fire on the closest of the dead. Cornered marines dump the mag.
      tr.fireT -= dt;
      if (tr.fireT <= 0) {
        const target = this._nearestZombie(tr.x, tr.z, tr.def.range + 1.5);
        if (target) {
          tr.fireT = 1 / (tr.def.rof * (tr.cornered ? 1.8 : 1));
          tr.attackT = 0.16;
          this._fireAt(tr, target);
        } else tr.fireT = 0.08;
      }
      tr.attackT = Math.max(0, tr.attackT - dt);

      // Contact damage: enough teeth in reach and the suit fails.
      let biting = 0;
      for (const zb of this.zombies) {
        const d2 = (zb.x - tr.x) ** 2 + (zb.z - tr.z) ** 2;
        if (d2 < 1.15) {
          biting++;
          zb.lungeT = 0.32;
          if (this.outcome !== 'victory') tr.hp -= zb.def.dmg * 0.9 * dt;
        }
      }
      if (tr.hp <= 0) {
        tr.dead = true;
        tr.fallT = 0;
        // The visor cuts out.
        this.burst(tr.x, this.map.groundY(tr.x, tr.z) + 0.9, tr.z,
          { count: 8, color: 0x35ff70, speed: 1.2, life: 0.4, size: 0.5, up: 0.8, spread: 0.3 });
        continue;
      }

      // Pose: reuse the game's procedural gait on the game's own mesh.
      const mesh = tr.mesh;
      mesh.position.set(tr.x, this.map.groundY(tr.x, tr.z), tr.z);
      const target = biting || tr.cornered ? this._nearestZombie(tr.x, tr.z, 12) : null;
      mesh.rotation.y = target
        ? Math.atan2(target.x - tr.x, target.z - tr.z)
        : Math.atan2(tr.dirX, tr.dirZ);
      const body = mesh.userData.body;
      if (body) {
        const pulse = tr.attackT > 0 ? Math.sin((tr.attackT / 0.16) * Math.PI) : 0;
        if (moving) {
          body.position.y = Math.abs(Math.sin(t * 10 + tr.seed)) * 0.09;
          body.rotation.x = 0.12;
          body.rotation.z = Math.sin(t * 10 + tr.seed) * 0.05;
        } else {
          body.position.y = Math.sin(t * 1.8 + tr.seed) * 0.02;
          body.rotation.x = 0;
          body.rotation.z = 0;
        }
        body.position.z = pulse * 0.13;
        body.rotation.x += pulse * -0.24;
      }
    }
  }

  _pickFleeDir(tr) {
    const c = this.map.size / 2;
    let best = null, bestScore = 0.8; // below this, nowhere is worth running
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const dx = Math.sin(a), dz = Math.cos(a);
      let clear = 0;
      for (let s = 1; s <= 5; s++) {
        if (!this.map.isWalkable((tr.x + dx * s) | 0, (tr.z + dz * s) | 0)) break;
        clear = s;
      }
      if (!clear) continue;
      // Don't run into the mob's arms.
      let mobPenalty = 0;
      for (const zb of this.zombies) {
        const zx = zb.x - tr.x, zz = zb.z - tr.z;
        const d = Math.hypot(zx, zz);
        if (d < 6 && (zx * dx + zz * dz) / (d || 1) > 0.6) mobPenalty += (6 - d) * 0.5;
      }
      const away = dx * tr.threatX + dz * tr.threatZ;
      const px = tr.x + dx * 6, pz = tr.z + dz * 6;
      const offStage = Math.hypot(px - c, pz - c) > STAGE_R + 8 ? -2.4 : 0;
      const keep = dx * tr.dirX + dz * tr.dirZ;
      const score = clear * 0.55 + away * 2.6 + keep * 0.4 + offStage - mobPenalty;
      if (score > bestScore) { bestScore = score; best = [dx, dz]; }
    }
    return best;
  }

  _nearestZombie(x, z, range) {
    let best = null, bestD2 = range * range;
    for (const zb of this.zombies) {
      const d2 = (zb.x - x) ** 2 + (zb.z - z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = zb; }
    }
    return best;
  }

  _fireAt(tr, zb) {
    const gy = this.map.groundY(tr.x, tr.z);
    const dx = zb.x - tr.x, dz = zb.z - tr.z;
    const d = Math.hypot(dx, dz) || 1;
    const mx = tr.x + (dx / d) * 0.48, mz = tr.z + (dz / d) * 0.48;
    // Same FX language as a live match: muzzle flash, tracer streak, impact.
    this.burst(mx, gy + 0.74, mz, { count: 4, color: 0xffe08a, speed: 1.0, life: 0.14, size: 0.5, spread: 0.1, up: 0.3 });
    this.stream(mx, gy + 0.74, mz, zb.x, this.map.groundY(zb.x, zb.z) + 0.55, zb.z,
      { count: 3, color: 0xfff2b0, size: 0.34, life: 0.16 });
    zb.hp -= tr.def.dmg;
    if (zb.hp <= 0) {
      zb.dead = true;
      const zgy = this.map.groundY(zb.x, zb.z);
      this.burst(zb.x, zgy + 0.5, zb.z, { count: 4, color: 0xffd75e, speed: 1.4, life: 0.26, size: 0.4, up: 1.0, spread: 0.15 });
      this.addCorpse({
        x: zb.x, y: zgy + 0.5, z: zb.z, gy: zgy,
        vx: (dx / d) * 3 + (Math.random() - 0.5), vy: 2.2 + Math.random() * 2.4, vz: (dz / d) * 3 + (Math.random() - 0.5),
        rx: Math.random() * Math.PI * 2, ry: Math.random() * Math.PI * 2, rz: 0,
        wx: (Math.random() - 0.5) * 10, wy: (Math.random() - 0.5) * 6,
        life: 5 + Math.random() * 3, scale: zb.def.scale,
        color: zb.def.color,
      });
    }
  }

  // ---------------- the horde ----------------

  _spawnMob(dt) {
    // The trickle becomes a flood: spawn rate ramps for the whole vignette,
    // so kiting buys time but never safety.
    if (this.outcome === 'victory' && this.elapsed > 18) {
      if (!this.zombies.length && this.phase === 'run') this.phaseT = Math.min(this.phaseT, 4.5);
      return;
    }
    const rate = Math.min(24, (3 + this.elapsed * this.mobRamp) * 1.1);
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1 && this.zombies.length < MOB_CAP) {
      this.spawnAcc -= 1;
      this._spawnZombie();
    }
  }

  _spawnZombie() {
    const lead = this.troopers.find((tr) => !tr.dead) || this.troopers[0];
    if (!lead) return;
    // Mostly from the pursuit heading, sometimes flanking across the line.
    const a = this.mobHeading + (Math.random() - 0.5) * (Math.random() < 0.25 ? Math.PI * 1.7 : Math.PI * 0.9);
    const r = 14 + Math.random() * 8;
    for (let tries = 0; tries < 8; tries++) {
      const x = lead.x + Math.sin(a + tries * 0.4) * r + (Math.random() - 0.5) * 3;
      const z = lead.z + Math.cos(a + tries * 0.4) * r + (Math.random() - 0.5) * 3;
      if (!this.map.isWalkable(x | 0, z | 0)) continue;
      const roll = Math.random();
      const type = roll < 0.72 || this.elapsed < 6 ? 'walker' : roll < 0.94 ? 'runner' : 'brute';
      const def = ZOMBIES[type];
      this.zombies.push({
        x, z, type, def,
        hp: def.hp * (type === 'brute' ? 0.4 : 1), // menu brutes die for drama, not stats
        phase: Math.random() * Math.PI * 2,
        speed: def.chase * (0.85 + Math.random() * 0.3),
        dirX: 0, dirZ: 0,
        lungeT: 0,
        dead: false,
        fade: 1,
      });
      return;
    }
  }

  _updateMob(dt, t) {
    this.flowT -= dt;
    if (this.flowT <= 0) {
      this.flowT = FLOW_PERIOD;
      const sources = [];
      for (const tr of this.troopers) {
        if (tr.dead) continue;
        const i = (tr.z | 0) * this.map.size + (tr.x | 0);
        if (i >= 0 && i < this.occ.length) sources.push(i);
      }
      if (sources.length) {
        this.flow.compute(this.occ, sources);
        this.flowReady = true;
      }
    }

    // The planet gets hungrier the longer the chase runs — eventually the mob
    // simply outpaces the squad, and the story ends the only way it can.
    const hunger = 0.8 + this.elapsed * this.hungerRamp;
    for (const zb of this.zombies) {
      if (zb.dead) continue;
      zb.lungeT = Math.max(0, zb.lungeT - dt);
      let dir = this.flowReady ? this.flow.dirAt(zb.x | 0, zb.z | 0) : null;
      if (!dir) {
        const lead = this.troopers.find((tr) => !tr.dead);
        if (!lead) continue;
        const dx = lead.x - zb.x, dz = lead.z - zb.z;
        const d = Math.hypot(dx, dz) || 1;
        dir = [dx / d, dz / d];
      }
      // A little lateral weave so the horde reads as a mob, not a queue.
      const wob = Math.sin(t * 1.3 + zb.phase) * 0.3;
      let dx = dir[0] - dir[1] * wob, dz = dir[1] + dir[0] * wob;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      const sp = zb.speed * hunger;
      const nx = zb.x + dx * sp * dt;
      const nz = zb.z + dz * sp * dt;
      if (this.map.isWalkable(nx | 0, nz | 0)) { zb.x = nx; zb.z = nz; }
      zb.dirX = dx; zb.dirZ = dz;
    }
    this.zombies = this.zombies.filter((zb) => !zb.dead);
    if (this.outcome === 'victory' && this.elapsed > 18) {
      for (const zb of this.zombies) zb.hp = Math.min(zb.hp, 1);
    }
  }

  // Between vignettes the leftover mob loses interest: it drifts off the
  // kill and thins out until the stage is empty for the next arrival.
  _disperseMob(dt, t) {
    for (const zb of this.zombies) {
      zb.fade -= dt * 0.55;
      const a = zb.phase + t * 0.2;
      const nx = zb.x + Math.sin(a) * zb.def.speed * dt;
      const nz = zb.z + Math.cos(a) * zb.def.speed * dt;
      if (this.map.isWalkable(nx | 0, nz | 0)) { zb.x = nx; zb.z = nz; }
    }
    this.zombies = this.zombies.filter((zb) => zb.fade > 0);
  }

  // ---------------- presentation ----------------

  _updateLight(dt) {
    const lead = this.troopers.find((tr) => !tr.dead);
    if (lead) {
      const k = 1 - Math.exp(-5 * dt);
      const gy = this.map.groundY(lead.x, lead.z);
      this.light.position.x += (lead.x - this.light.position.x) * k;
      this.light.position.y += (gy + 3 - this.light.position.y) * k;
      this.light.position.z += (lead.z - this.light.position.z) * k;
    }
    // Fade up on arrival, gutter out on death — slower down than up, so the
    // dark lands as a beat instead of a cut.
    const rate = this.lightTarget > this.light.intensity ? 2.2 : 1.4;
    this.light.intensity += (this.lightTarget - this.light.intensity) * (1 - Math.exp(-rate * dt));
  }

  cameraState() {
    const lead = this.troopers.find((tr) => !tr.dead) || this.troopers[0];
    return {
      phase: this.phase,
      progress: this.phase === 'run' ? clamp(this.elapsed / 4.5, 0, 1) : 0,
      x: lead?.x ?? this.anchor.x,
      z: lead?.z ?? this.anchor.z,
      scenario: this.scenario.name,
      observed: this.observed,
      outcome: this.outcome,
      survivors: this.troopers.filter((tr) => !tr.dead).length,
    };
  }

  setSurfaceVisible(visible) {
    for (const tr of this.troopers) tr.mesh.visible = visible;
    this.surfaceVisible = visible;
    if (!visible) this.horde.clear();
  }

  // Fallen troopers keel over where they died and settle into the ground.
  _updateFallen(dt) {
    for (let i = this.troopers.length - 1; i >= 0; i--) {
      const tr = this.troopers[i];
      if (!tr.dead || tr.fallT < 0) continue;
      tr.fallT += dt;
      const fall = clamp(tr.fallT / 0.7, 0, 1);
      tr.mesh.rotation.x = lerp(0, -Math.PI / 2, fall * fall);
      const gy = this.map.groundY(tr.x, tr.z);
      const sink = clamp((tr.fallT - 2.2) / 1.6, 0, 1);
      tr.mesh.position.y = gy + fall * 0.1 - sink * 0.9;
      if (sink >= 1) {
        this.scene.remove(tr.mesh);
        this.dispose3D(tr.mesh);
        this.troopers.splice(i, 1);
      }
    }
  }

  // Write the mob through the shared horde writer — the exact transform
  // and palette grammar the in-game renderer uses, so the menu horde IS the
  // game's horde.
  _writeMob(t) {
    if (this.surfaceVisible === false) { this.horde.clear(); return; }
    const c = this._color;
    const n = Math.min(this.zombies.length, MOB_CAP);
    this.horde.begin();
    for (let i = 0; i < n; i++) {
      const zb = this.zombies[i];
      const bob = this.map.groundY(zb.x, zb.z) + Math.sin(t * 7 + zb.phase) * 0.05;
      const yaw = Math.atan2(zb.dirX, zb.dirZ);
      const lunge = zb.lungeT > 0 ? Math.sin((zb.lungeT / 0.32) * Math.PI) * 0.42 : 0;
      const s = zb.def.scale * clamp(zb.fade, 0, 1);
      if (lunge > 0.01) c.setRGB(1.7, 0.65, 0.55);
      else c.setRGB(1, 1, 1);
      this.horde.write(
        zb.type,
        zb.x + zb.dirX * lunge, bob, zb.z + zb.dirZ * lunge,
        0.22 + lunge * 0.8, yaw, Math.sin(t * 5 + zb.phase) * 0.06,
        s * (1 + lunge * 0.25), s * (1 - lunge * 0.2), s * (1 + lunge * 0.25),
        t, zb.phase, lunge,
        c, 0xff4636, // the hunt is always on
      );
    }
    this.horde.commit();
  }
}
