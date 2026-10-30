// Play-zoom stills. Gameplay video is scripts/terrain-clip.mjs (fixed timestep).
//   SHOT_OUT=/opt/cursor/artifacts/terrain-proof node scripts/terrain-proof.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = process.env.SHOT_ROOT || new URL('..', import.meta.url).pathname;
const outDir = process.env.SHOT_OUT || '/tmp/terrain-proof';
const chrome = ['google-chrome', 'google-chrome-stable', 'chromium'].find((name) =>
  spawnSync('which', [name], { stdio: 'ignore' }).status === 0);
if (!chrome) throw new Error('Chrome is not installed');

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.svg': 'image/svg+xml',
};
const serverPort = 4700 + (process.pid % 10000);
const debugPort = 37000 + (process.pid % 10000);
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
await mkdir(outDir, { recursive: true });

const profile = await mkdtemp(join(tmpdir(), 'zillions-proof-'));
const browser = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=1600,900', '--force-device-scale-factor=1',
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
    width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  const names = ['greenfall', 'rotmire', 'cinder', 'barrow', 'vale'];
  async function boot(level) {
    await command('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });
    await delay(500);
    let booted = false;
    for (let i = 0; i < 40 && !booted; i++) {
      await delay(200);
      booted = await evaluate('!!window.__app');
    }
    if (!booted) throw new Error('app did not boot');
    const info = await evaluate(`(async () => {
      const app = window.__app;
      app.ui.selectedLevel = ${level};
      app.ui.selectedMode = 'campaign';
      app.ui.selectedCulture = 'european';
      app.tacticalVisuals.applyQuality('high', false);
      app.renderer.shadowMap.enabled = true;
      await app.startGame('normal', 'scott');
      app.game.foundCity(0, 0);
      app.paused = true;
      for (const id of ['banner', 'messages', 'combat-alert']) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      }
      const hq = app.game.plots.find((p) => p.kind === 'hq');
      app.focus.set(hq.cx, app.map.groundY(hq.cx, hq.cz), hq.cz);
      app.camDist = 39;
      const h = app.myHero();
      return {
        plots: app.game.plots.length,
        hq: [hq.cx, hq.cz],
        hero: h && [h.x, h.z],
        shadows: app.renderer.shadowMap.enabled,
        map: app.renderer.shadowMap.mapSize?.x || app.sun.shadow.mapSize.x,
        quality: app.tacticalVisuals.quality,
      };
    })()`);
    console.log(names[level - 1], 'boot', JSON.stringify(info));
    await delay(900);
    return info;
  }

  async function shot(file) {
    const { data } = await command('Page.captureScreenshot', { format: 'png' });
    const path = join(outDir, file);
    await writeFile(path, Buffer.from(data, 'base64'));
    console.log('wrote', path);
  }

  const only = (process.env.SHOT_LEVELS || '1,2,3,4,5').split(',').map((n) => Number(n));
  for (let level = 1; level <= 5; level++) {
    if (!only.includes(level)) continue;
    const name = names[level - 1];
    await boot(level);
    await shot(`${name}-play.png`);
    await evaluate(`(() => { const app = window.__app; app.camDist = 72; return true; })()`);
    await delay(400);
    await shot(`${name}-overview.png`);
  }

  if (process.env.SHOT_SCALE === '0') {
    /* stills only */
  } else if (only.includes(1)) await (async () => {
  await boot(1);
  const scale = await evaluate(`(() => {
    const app = window.__app;
    const g = app.game;
    const hq = g.plots.find((p) => p.kind === 'hq');
    const house = g.plots.filter((p) => p.kind === 'house').sort((a, b) => Math.hypot(a.cx - hq.cx, a.cz - hq.cz) - Math.hypot(b.cx - hq.cx, b.cz - hq.cz))[0];
    const tower = g.plots.filter((p) => p.kind === 'tower').sort((a, b) => Math.hypot(a.cx - hq.cx, a.cz - hq.cz) - Math.hypot(b.cx - hq.cx, b.cz - hq.cz))[0];
    if (house) g._construct(house, true);
    if (tower) g._construct(tower, true);
    const h = app.myHero();
    const ax = house ? house.cx : hq.cx;
    const az = house ? house.cz : hq.cz;
    h.x = ax + 3.2;
    h.z = az + 1.4;
    app.focus.set(ax + 1.2, app.map.groundY(ax, az), az + 0.6);
    app.camDist = 39;
    return { house: house && [house.cx, house.cz], tower: !!tower, hero: [h.x, h.z] };
  })()`);
  console.log('scale', JSON.stringify(scale));
  await delay(800);
  await shot('greenfall-scale.png');
  })();
} finally {
  try { if (socket) socket.close(); } catch { /* already closed */ }
  try { browser.kill(); } catch { /* already gone */ }
  server.close();
  await delay(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
