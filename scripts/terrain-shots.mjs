// Gameplay-camera stills for the five campaign maps.
//   SHOT_ROOT=/workspace SHOT_OUT=/tmp/shots node scripts/terrain-shots.mjs
// Serves that tree and drives headless Chrome. Not part of npm run check.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = process.env.SHOT_ROOT || new URL('..', import.meta.url).pathname;
const outDir = process.env.SHOT_OUT || '/tmp/terrain-shots';
const chrome = ['google-chrome', 'google-chrome-stable', 'chromium'].find((name) =>
  spawnSync('which', [name], { stdio: 'ignore' }).status === 0);
if (!chrome) throw new Error('Chrome is not installed');

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.svg': 'image/svg+xml',
};
const serverPort = 4600 + (process.pid % 10000);
const debugPort = 36000 + (process.pid % 10000);
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

const profile = await mkdtemp(join(tmpdir(), 'zillions-shots-'));
const browser = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
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
  for (let level = 1; level <= 5; level++) {
    const name = names[level - 1];
    await command('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });
    await delay(400);
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
      await app.startGame('normal', 'scott');
      app.game.foundCity(0, 0);
      app.paused = true;
      for (const id of ['banner', 'messages', 'combat-alert']) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      }
      const h = app.myHero();
      return { plots: app.game.plots.length, hero: [h.x, h.z], phase: app.game.phase };
    })()`);
    console.log(name, 'build', JSON.stringify(info));
    await delay(700);
    await shot(`${name}-build.png`);

    if (level === 1) {
      const near = await evaluate(`(() => {
        const app = window.__app;
        const h = app.myHero();
        let best = null, bestD = 1e9;
        for (const plot of app.game.plots) {
          if (!plot || plot.tier > 0 || plot.kind === 'wall') continue;
          const d = Math.hypot(plot.cx - h.x, plot.cz - h.z);
          if (d < bestD) { bestD = d; best = plot; }
        }
        if (!best) return null;
        const [px, pz] = app.game.payPoint(best, h);
        h.x = px + 1.2; h.z = pz + 0.4;
        app.focus.set(h.x, app.map.groundY(h.x, h.z), h.z);
        app.camDist = 26;
        app.controlMode = 'build';
        return { kind: best.kind, x: h.x, z: h.z };
      })()`);
      console.log(name, 'close', JSON.stringify(near));
      await delay(600);
      await shot('greenfall-close.png');
      await evaluate(`(() => { const app = window.__app; app.camDist = 39; return true; })()`);
    }

    const wave = await evaluate(`(() => {
      const app = window.__app;
      const g = app.game;
      if (g.firstSiege && g.firstSiege.stage === 'opening') {
        g.firstSiege.stage = 'warning';
        const nest = g.nests[g.firstSiege.nestId];
        if (nest) nest.musterT = 0.4;
      }
      const dt = 1 / 30;
      let steps = 0;
      let armedAt = -1;
      const waveCount = () => g.zombies.filter((z) => z && !z.dead && z.wave).length;
      while (steps < 30 * 75) {
        g.update(dt);
        steps++;
        if (armedAt < 0 && waveCount() >= 4) armedAt = steps;
        if (armedAt >= 0 && steps > armedAt + 30 * 18) break;
      }
      app.paused = true;
      return { steps, zombies: waveCount(), stage: g.firstSiege && g.firstSiege.stage, threat: g.threatLevel };
    })()`);
    console.log(name, 'wave', JSON.stringify(wave));
    await delay(500);
    await shot(`${name}-wave.png`);
  }

  async function shot(file) {
    const { data } = await command('Page.captureScreenshot', { format: 'png' });
    const path = join(outDir, file);
    await writeFile(path, Buffer.from(data, 'base64'));
    console.log('wrote', path);
  }
} finally {
  try { if (socket) socket.close(); } catch { /* already closed */ }
  try { browser.kill(); } catch { /* already gone */ }
  server.close();
  await delay(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
