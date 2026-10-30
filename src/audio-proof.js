// Headless frame stepper for the audio proof clip. Not part of a normal match.
// scripts/audio-proof.mjs drives it one 30 fps frame at a time.

import { audioBufferToWav } from './soundscape.js';

const FPS = 30;
const FRAMES = 600;
const MENU_FRAMES = 60;

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

  window.__audioProofReady = true;
  window.__audioProofStep = async () => {
    if (frame === MENU_FRAMES && !started) {
      started = true;
      app.ui.selectedMode = 'survival';
      app.ui.selectedLevel = 1;
      app.ui.selectedHero = 'alexander';
      await app.startGame('normal', 'alexander');
      app.paused = false;
      app.issue({ t: 'found', s: 0, p: 0 });
      app._proofPlot = nearestOpeningPlot(app);
    }
    if (started) steer(app);
    app._proofDt = 1 / FPS;
    app.frame();
    app._proofDt = null;
    frame += 1;
    return { frame, music: app.audio._sceneMusic, biome: app.map?.terrainKind || null };
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
    const ka = rank[a.kind] ?? 5;
    const kb = rank[b.kind] ?? 5;
    return (ka - kb) || (da - db);
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
  const ang = t * 0.65;
  app.issue({ t: 'hdir', p: 0, x: Math.cos(ang), z: Math.sin(ang), s: false });
  app.issue({ t: 'pay', p: 0, on: false });
  const near = (game.zombies || []).some((z) => !z.dead && (z.x - hero.x) ** 2 + (z.z - hero.z) ** 2 < 49);
  if (near && (hero.abilCd || 0) <= 0 && Math.floor(t * FPS) % 50 === 0) {
    app.issue({ t: 'cast', p: 0 });
  }
}
