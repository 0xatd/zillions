// Headless frame stepper for the audio proof clip. Not part of a normal match.
// scripts/audio-proof.mjs drives it one 30 fps frame at a time.

import { audioBufferToWav } from './soundscape.js';

const FPS = 30;
const FRAMES = 900;
const SELECT_AT = 120;   // 4s: planet / mission select
const MATCH_AT = 270;    // 9s: found the colony and build
const WAVE_AT = 540;     // 18s: a heavy wave on the camera

export async function bootAudioProof(app) {
  app.tacticalVisuals.applyQuality('low', false);
  app.renderer.shadowMap.enabled = false;
  app.renderer.setPixelRatio(1);
  app.audio.scape.armRecording();
  app.audio.init();
  await app.audio.ready;
  app._proofT = 0;
  let frame = 0;
  let started = false;
  let waved = false;

  window.__audioProofReady = true;
  window.__audioProofStep = async () => {
    if (frame === SELECT_AT) app.ui.showSetup({ mode: 'campaign' });
    if (frame === MATCH_AT && !started) {
      started = true;
      app.ui.selectedMode = 'survival';
      app.ui.selectedLevel = 1;
      app.ui.selectedHero = 'alexander';
      await app.startGame('normal', 'alexander');
      app.paused = false;
      app.issue({ t: 'found', s: 0, p: 0 });
      app._proofPlot = nearestOpeningPlot(app);
    }
    if (started && frame === WAVE_AT && !waved) {
      waved = true;
      bringWave(app);
    }
    if (started && frame < WAVE_AT) steer(app);
    else if (started) fight(app);
    app._proofDt = 1 / FPS;
    app.frame();
    app._proofDt = null;
    frame += 1;
    return { frame, music: app.audio._sceneMusic, biome: app.map?.terrainKind || null, zombies: app.game?.zombies?.length || 0 };
  };

  window.__audioProofWav = async () => {
    const rendered = await app.audio.scape.renderOffline(FRAMES / FPS);
    const bytes = new Uint8Array(audioBufferToWav(rendered));
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  };
}

function nearestOpeningPlot(app) {
  const hero = app.game?.heroes?.[0];
  const plots = (app.game?.plots || []).filter((p) => p.tier === 0 && p.kind !== 'hq' && p.kind !== 'wall');
  if (!hero || !plots.length) return null;
  const rank = { tower: 0, house: 1, farm: 2, camp_militia: 3 };
  plots.sort((a, b) => {
    const da = (a.cx - hero.x) ** 2 + (a.cz - hero.z) ** 2;
    const db = (b.cx - hero.x) ** 2 + (b.cz - hero.z) ** 2;
    return ((rank[a.kind] ?? 5) - (rank[b.kind] ?? 5)) || (da - db);
  });
  return plots[0];
}

function steer(app) {
  const game = app.game;
  if (!game || game.over) return;
  const hero = game.heroes[0];
  if (!hero || hero.dead) return;
  const plot = app._proofPlot;
  if (plot && plot.tier === 0 && game.phase === 'live') {
    const [px, pz] = game.payPoint(plot, hero);
    const dx = px - hero.x;
    const dz = pz - hero.z;
    const len = Math.hypot(dx, dz) || 1;
    if (len > 1.2) {
      app.issue({ t: 'hdir', p: 0, x: dx / len, z: dz / len, s: false });
      app.issue({ t: 'pay', p: 0, on: false });
    } else {
      app.issue({ t: 'hdir', p: 0, x: 0, z: 0, s: false });
      app.issue({ t: 'pay', p: 0, on: true });
    }
    return;
  }
  const t = app._proofT || 0;
  app.issue({ t: 'hdir', p: 0, x: Math.cos(t * 0.7), z: Math.sin(t * 0.7), s: false });
  app.issue({ t: 'pay', p: 0, on: false });
}

function fight(app) {
  const game = app.game;
  const hero = game?.heroes?.[0];
  if (!game || !hero || hero.dead) return;
  const near = (game.zombies || []).find((z) => !z.dead);
  if (!near) {
    app.issue({ t: 'hdir', p: 0, x: 0, z: 0, s: false });
    return;
  }
  const dx = near.x - hero.x;
  const dz = near.z - hero.z;
  const len = Math.hypot(dx, dz) || 1;
  app.issue({ t: 'hdir', p: 0, x: dx / len, z: dz / len, s: false });
  app.issue({ t: 'pay', p: 0, on: false });
  if ((hero.abilCd || 0) <= 0 && len < 9) app.issue({ t: 'cast', p: 0 });
}

// Proof-only: muster every hive, then stand that wave on the camera so the
// clip can hear a crowd. The match simulation code is not changed.
function bringWave(app) {
  const game = app.game;
  const hq = game.hq;
  if (!hq) return;
  const before = new Set(game.zombies.map((z) => z.id));
  for (const nest of game.nests) {
    if (nest.alive) game._hiveMuster(nest, 10, false);
  }
  const fresh = game.zombies.filter((z) => !before.has(z.id) && !z.dead);
  fresh.forEach((zombie, i) => {
    const a = (i / Math.max(1, fresh.length)) * Math.PI * 2;
    const r = 7 + (i % 6) * 0.8;
    const x = hq.cx + Math.cos(a) * r;
    const zz = hq.cz + Math.sin(a) * r;
    if (game.map.isWalkable(x | 0, zz | 0)) {
      zombie.x = x;
      zombie.z = zz;
    }
    zombie.state = 2;
  });
  app.audio.alarm();
}
