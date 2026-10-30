// Deterministic gameplay clip. Each frame advances the sim by 1/30 s, renders,
// and is saved before the next frame. ffmpeg then packs those frames at a
// constant 30 fps, so a slow VM cannot drop or bunch frames.
//
//   SHOT_OUT=/opt/cursor/artifacts/terrain-proof node scripts/terrain-clip.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = process.env.SHOT_ROOT || new URL('..', import.meta.url).pathname;
const outDir = process.env.SHOT_OUT || '/tmp/terrain-clip';
const frames = Math.max(300, Math.min(750, Number(process.env.CLIP_FRAMES) || 360));
const chrome = ['google-chrome', 'google-chrome-stable', 'chromium'].find((name) =>
  spawnSync('which', [name], { stdio: 'ignore' }).status === 0);
if (!chrome) throw new Error('Chrome is not installed');

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};
const serverPort = 4800 + (process.pid % 8000);
const debugPort = 38000 + (process.pid % 8000);
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) throw new Error('bad path');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((resolve) => server.listen(serverPort, '127.0.0.1', resolve));
const frameDir = join(outDir, 'frames');
await mkdir(frameDir, { recursive: true });

const profile = await mkdtemp(join(tmpdir(), 'zillions-clip-'));
const browser = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=1280,720', '--force-device-scale-factor=1',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await delay(150);
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json`).then((r) => r.json());
      target = pages.find((page) => page.type === 'page');
    } catch { /* Chrome is still starting */ }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('browser target did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') {
      console.error('page exception', message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
    if (!message.id || !pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  };
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, (message) => {
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result || {});
    });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  };

  await command('Page.enable');
  await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
  });
  await command('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });
  await delay(400);
  let booted = false;
  for (let i = 0; i < 40 && !booted; i++) {
    await delay(200);
    booted = await evaluate('!!window.__app');
  }
  if (!booted) throw new Error('app did not boot');

  const boot = await evaluate(`(async () => {
    const app = window.__app;
    app.ui.selectedLevel = 1;
    app.ui.selectedMode = 'campaign';
    app.ui.selectedCulture = 'european';
    app.tacticalVisuals.applyQuality('high', false);
    app.renderer.shadowMap.enabled = true;
    app.autoQualityDropped = true;
    await app.startGame('normal', 'scott');
    app.game.foundCity(0, 0);
    for (const id of ['banner', 'messages', 'combat-alert']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    const hq = app.game.plots.find((p) => p.kind === 'hq');
    app._hq = { x: hq.cx, z: hq.cz };
    app.focus.set(hq.cx, app.map.groundY(hq.cx, hq.cz), hq.cz);
    app.camDist = 46;
    app.renderer.setAnimationLoop(null);
    app.paused = false;
    const STEP = 1 / 30;
    app.clock.elapsedTime = 0;
    app.clock.getDelta = () => {
      app.clock.elapsedTime += STEP;
      return STEP;
    };
    app._clipEase = 0;
    const updateCam = app._updateCamera.bind(app);
    app._updateCamera = (dt) => {
      const h = app.myHero();
      const e = app._clipEase || 0;
      const ang = -2.4 + e * 1.7;
      const rad = 11 - e * 3;
      const tx = app._hq.x + Math.cos(ang) * rad;
      const tz = app._hq.z + Math.sin(ang) * rad;
      let ox, oz;
      if (h) { ox = h.x; oz = h.z; h.x = tx; h.z = tz; }
      updateCam(dt);
      if (h) { h.x = ox; h.z = oz; }
    };
    app._updateHeroInput = () => {
      const e = app._clipEase || 0;
      const ang = -0.3 + e * 0.9;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang) * 0.35;
      const last = app.lastDir || { x: 9, z: 9, s: true };
      if (Math.abs(dx - last.x) > 0.02 || Math.abs(dz - last.z) > 0.02) {
        app.lastDir = { x: dx, z: dz, s: false };
        app.issue({ t: 'hdir', p: app.myPlayer, x: dx, z: dz, s: false });
      }
    };
    return { shadows: app.renderer.shadowMap.enabled, map: app.sun.shadow.mapSize.x, quality: app.tacticalVisuals.quality };
  })()`);
  console.log('boot', JSON.stringify(boot), 'frames', frames);

  for (let i = 0; i < frames; i++) {
    const info = await evaluate(`(() => {
      const app = window.__app;
      const u = ${frames} <= 1 ? 1 : ${i} / (${frames} - 1);
      const e = u * u * (3 - 2 * u);
      app._clipEase = e;
      app.camDist = 46 + (34 - 46) * e;
      app.frame();
      const h = app.myHero();
      return { t: Math.round(app.clock.elapsedTime * 1000) / 1000, x: h && Math.round(h.x * 10) / 10, z: h && Math.round(h.z * 10) / 10 };
    })()`);
    const { data } = await command('Page.captureScreenshot', { format: 'png' });
    const name = `f${String(i).padStart(4, '0')}.png`;
    await writeFile(join(frameDir, name), Buffer.from(data, 'base64'));
    if (i % 30 === 0) console.log('frame', i, JSON.stringify(info));
  }
  console.log('saved', frames, 'frames to', frameDir);
} finally {
  try { if (socket) socket.close(); } catch { /* already closed */ }
  try { browser.kill(); } catch { /* already gone */ }
  server.close();
  await delay(200);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
