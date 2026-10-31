// Close-ups of each culture's rampart. Not part of npm run check.
//   SHOT_OUT=/opt/cursor/artifacts/terrain-proof/pass6 node scripts/wall-proof.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = new URL('..', import.meta.url).pathname;
const outDir = process.env.SHOT_OUT || '/tmp/wall-proof';
const chrome = ['google-chrome', 'google-chrome-stable', 'chromium'].find((name) =>
  spawnSync('which', [name], { stdio: 'ignore' }).status === 0);
if (!chrome) throw new Error('Chrome is not installed');

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webp': 'image/webp',
};
const serverPort = 4800 + (process.pid % 10000);
const debugPort = 38000 + (process.pid % 10000);
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

const profile = await mkdtemp(join(tmpdir(), 'zillions-wall-'));
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

  const cultures = (process.env.SHOT_CULTURES || 'european,asian,south_american,middle_eastern').split(',');
  for (const culture of cultures) {
    await command('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });
    await delay(400);
    let booted = false;
    for (let i = 0; i < 40 && !booted; i++) {
      await delay(200);
      booted = await evaluate('!!window.__app');
    }
    if (!booted) throw new Error('app did not boot');
    if (culture === 'european') {
      await evaluate(`(async () => {
        const app = window.__app;
        app.ui.selectedLevel = 1;
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
        const gates = app.game.plots.filter((p) => p.kind === 'wall' && p.gate && p.role !== 'outer');
        gates.sort((a, b) => b.gate[1] - a.gate[1]);
        const gate = gates[0];
        const gx = gate.gate[0] + 0.5, gz = gate.gate[1] + 0.5;
        const h = app.myHero();
        h.x = gx + 1.6;
        h.z = gz + 2.4;
        app.focus.set(gx, app.map.groundY(gx, gz), gz + 0.4);
        app.camDist = 18;
        return true;
      })()`);
      await delay(900);
      const rubbleShot = await command('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(outDir, 'wall-european-rubble.png'), Buffer.from(rubbleShot.data, 'base64'));
      console.log('wrote rubble');
      await command('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });
      await delay(400);
      let again = false;
      for (let i = 0; i < 40 && !again; i++) {
        await delay(200);
        again = await evaluate('!!window.__app');
      }
    }
    const info = await evaluate(`(async () => {
      const app = window.__app;
      app.ui.selectedLevel = 1;
      app.ui.selectedMode = 'campaign';
      app.ui.selectedCulture = '${culture}';
      app.tacticalVisuals.applyQuality('high', false);
      app.renderer.shadowMap.enabled = true;
      await app.startGame('normal', 'scott');
      app.game.foundCity(0, 0);
      let walls = 0;
      for (const plot of app.game.plots) {
        if (plot.kind === 'wall' && plot.tier === 0) { app.game._construct(plot, true); walls++; }
      }
      const hq = app.game.plots.find((p) => p.kind === 'hq');
      if (hq && hq.tier === 0) app.game._construct(hq, true);
      const near = app.game.plots.filter((p) => p.kind === 'house')
        .sort((a, b) => Math.hypot(a.cx - hq.cx, a.cz - hq.cz) - Math.hypot(b.cx - hq.cx, b.cz - hq.cz))[0];
      if (near) app.game._construct(near, true);
      app.paused = true;
      for (const id of ['banner', 'messages', 'combat-alert']) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      }
      const gates = app.game.plots.filter((p) => p.kind === 'wall' && p.gate && p.role !== 'outer');
      gates.sort((a, b) => (b.gate[1] - a.gate[1]) || (a.gate[0] - b.gate[0]));
      const gate = gates[0];
      const gx = gate.gate[0] + 0.5, gz = gate.gate[1] + 0.5;
      const h = app.myHero();
      h.x = gx + 1.6;
      h.z = gz + 2.4;
      app.focus.set(gx, app.map.groundY(gx, gz), gz + 0.4);
      app.camDist = 16;
      const rampart = app.scene.getObjectByName('rampart');
      return {
        culture: '${culture}',
        walls,
        gate: [gx, gz],
        children: rampart ? rampart.children.length : 0,
        ready: !!rampart,
      };
    })()`);
    console.log(JSON.stringify(info));
    await delay(1100);
    const { data } = await command('Page.captureScreenshot', { format: 'png' });
    const file = join(outDir, `wall-${culture}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log('wrote', file);
    await evaluate(`(() => {
      const app = window.__app;
      const hq = app.game.plots.find((p) => p.kind === 'hq');
      const h = app.myHero();
      h.x = hq.cx + 2.2;
      h.z = hq.cz + 3.2;
      app.focus.set(hq.cx, app.map.groundY(hq.cx, hq.cz), hq.cz);
      app.camDist = 36;
      return true;
    })()`);
    await delay(700);
    const keepShot = await command('Page.captureScreenshot', { format: 'png' });
    const keepFile = join(outDir, `keep-${culture}.png`);
    await writeFile(keepFile, Buffer.from(keepShot.data, 'base64'));
    console.log('wrote', keepFile);
  }
} finally {
  try { if (socket) socket.close(); } catch { /* already closed */ }
  try { browser.kill(); } catch { /* already gone */ }
  server.close();
  await delay(200);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
