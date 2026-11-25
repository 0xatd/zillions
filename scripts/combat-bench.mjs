// Repeatable 300-enemy combat benchmark.
//
// Serves the repo, opens it in headless Chrome with SwiftShader (software
// GL, the weak-laptop case), starts a campaign, spawns 300 zombies inside
// hero vision plus a stream of projectiles, and reports average FPS, 1% low
// FPS, draw calls, triangles, and simulation milliseconds per tick.
//
//   node scripts/combat-bench.mjs [quality]
//
// quality is high, medium, low, or auto. The page starts paused behind the
// menu; this script drives the real renderer. It does not change simulation
// rules. 1% low is the FPS of the 99th-percentile frame time.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const quality = process.argv[2] || 'high';
const enemies = Number(process.argv[3] || 300);
const PORT = Number(process.env.BENCH_PORT || 8765);
const DEBUG = Number(process.env.BENCH_DEBUG || 9334);
const CHROME = process.env.CHROME || 'google-chrome';

const PAGE_FN = `async ({ quality, enemies }) => {
  const app = window.__app;
  if (!app) throw new Error('app missing');
  app.profile.games = 99;
  app.profile.tutorialDone = true;
  app.ui.selectedLevel = 1;
  app.ui.selectedMode = 'campaign';
  const apply = app.tacticalVisuals.applyQuality.bind(app.tacticalVisuals);
  apply(quality, false);
  await app.startGame('normal', 'scott');
  app._finishMissionIntro();
  app.setSpeed(1);
  app.paused = false;
  // Hold an explicit preset steady. Auto is allowed to step down.
  if (quality !== 'auto') app.autoQualityDropped = true;
  const game = app.game;
  const hero = game.heroes[0];
  const types = ['walker', 'runner', 'walker', 'spitter', 'brute', 'walker', 'burrower'];
  let spawned = 0;
  for (let i = 0; i < enemies; i++) {
    const a = (i / enemies) * Math.PI * 2;
    const ring = 3 + (i % 14);
    const zb = game._spawnZombie(types[i % types.length], hero.x + Math.cos(a) * ring, hero.z + Math.sin(a) * ring, true, true);
    if (zb) spawned++;
  }
  app.focus.set(hero.x, 0, hero.z);
  app.camDist = 46;
  const orig = game.update.bind(game);
  let simMs = 0, simTicks = 0;
  game.update = (dt) => {
    const t0 = performance.now();
    const out = orig(dt);
    simMs += performance.now() - t0;
    simTicks++;
    return out;
  };
  const renderer = app.renderer;
  renderer.info.autoReset = false;
  const WARMUP = 24;
  const SAMPLE = 72;
  const samples = [];
  let frames = 0;
  let draws = 0;
  let tris = 0;
  let gapMs = [];
  let lastStart = performance.now();
  const fire = () => {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + frames;
      app._spawnProjectile({
        fx: hero.x, fz: hero.z, fy: 1.1,
        tx: hero.x + Math.cos(a) * 10, tz: hero.z + Math.sin(a) * 10,
        kind: i % 3 === 0 ? 'tower' : 'soldier',
        fromId: hero.id,
      });
    }
  };
  fire();
  const origFrame = app.frame.bind(app);
  await new Promise((resolve) => {
    app.frame = function () {
      const start = performance.now();
      const gap = start - lastStart;
      lastStart = start;
      renderer.info.reset();
      origFrame();
      frames++;
      if (frames % 20 === 0) fire();
      if (frames > WARMUP) {
        samples.push(performance.now() - start);
        gapMs.push(gap);
        draws = renderer.info.render.calls;
        tris = renderer.info.render.triangles;
      }
      if (samples.length >= SAMPLE) {
        app.frame = origFrame;
        resolve();
      }
    };
  });
  const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const pct = (xs, p) => {
    const s = xs.slice().sort((a, b) => a - b);
    const i = Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1));
    return s[i];
  };
  const work = mean(samples);
  const presented = mean(gapMs);
  const presentedLow = pct(gapMs, 0.99);
  return {
    qualityRequested: quality,
    quality: app.tacticalVisuals.quality,
    choice: app.tacticalVisuals.choice || app.tacticalVisuals.quality,
    enemies: spawned,
    zombies: game.zombies.length,
    frames: samples.length,
    avgFps: 1000 / presented,
    low1Fps: 1000 / presentedLow,
    workFps: 1000 / work,
    simMsPerTick: simTicks ? simMs / simTicks : 0,
    simTicks,
    drawCalls: draws,
    triangles: tris,
    pixelRatio: renderer.getPixelRatio(),
    shadows: renderer.shadowMap.enabled,
  };
}`;

function startServer() {
  const child = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

function startChrome() {
  const child = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
    '--window-size=1280,720',
    `--remote-debugging-port=${DEBUG}`,
    `--user-data-dir=/tmp/zillions-combat-bench-${DEBUG}-${quality}-${process.pid}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

async function debugTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG}/json/new?http://127.0.0.1:${PORT}/`, { method: 'PUT' });
      if (res.ok) return await res.json();
    } catch { /* chrome still booting */ }
    await delay(250);
  }
  throw new Error('Chrome DevTools did not come up');
}

function cdpSocket(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const slot = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(JSON.stringify(msg.error)));
      else slot.resolve(msg.result);
    } else {
      for (const fn of listeners) fn(msg);
    }
  });
  return {
    ws,
    on: (fn) => listeners.add(fn),
    send(method, params = {}, timeoutMs = 180000) {
      const msgId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(msgId);
          reject(new Error(`CDP timeout ${method}`));
        }, timeoutMs);
        pending.set(msgId, {
          resolve: (v) => { clearTimeout(timer); resolve(v); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        });
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    },
  };
}

const server = startServer();
const chrome = startChrome();
let failed = false;
try {
  await delay(400);
  const target = await debugTarget();
  const client = cdpSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    client.ws.addEventListener('open', resolve);
    client.ws.addEventListener('error', reject);
  });
  const logs = [];
  client.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params?.args || []).map((a) => a.value || a.description || '').join(' ');
      if (msg.params?.type === 'error') logs.push(text.slice(0, 300));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      logs.push(String(msg.params?.exceptionDetails?.text || 'exception').slice(0, 300));
    }
  });
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  const qualityQuery = encodeURIComponent(quality);
  await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?quality=${qualityQuery}` });
  const ready = await client.send('Runtime.evaluate', {
    expression: `new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (window.__app && window.__app.ui) resolve(true);
        else if (Date.now() - start > 30000) reject(new Error('app boot timeout'));
        else setTimeout(tick, 50);
      };
      tick();
    })`,
    awaitPromise: true,
    returnByValue: true,
  }, 40000);
  if (ready.exceptionDetails) throw new Error(JSON.stringify(ready.exceptionDetails).slice(0, 500));
  const result = await client.send('Runtime.evaluate', {
    expression: `(${PAGE_FN})(${JSON.stringify({ quality, enemies })})`,
    awaitPromise: true,
    returnByValue: true,
  }, 240000);
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 800));
  }
  const report = result.result.value;
  report.viewport = '1280x720';
  report.renderer = 'headless Chrome + SwiftShader';
  report.warmupFrames = 24;
  report.sampleFrames = 72;
  report.notes = 'Presented FPS uses the gap between frame starts. 1% low is the 99th percentile frame gap. Draw calls and triangles are the last sampled frame, with info.autoReset off so every pass in that frame is counted. Sim ms is the mean of Game.update during the sample.';
  if (logs.length) report.consoleErrors = logs.slice(0, 8);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  failed = true;
  console.error(error);
  process.exitCode = 1;
} finally {
  chrome.kill('SIGKILL');
  server.kill('SIGKILL');
  if (failed) process.exitCode = 1;
}
