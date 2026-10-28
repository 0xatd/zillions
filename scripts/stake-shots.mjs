// Close shots of a survey stake, the build hologram, and an upgrade hologram.
//   node scripts/stake-shots.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = new URL('..', import.meta.url).pathname;
const outDir = '/opt/cursor/artifacts/stakes';
const chrome = ['google-chrome', 'google-chrome-stable', 'chromium'].find((name) =>
  spawnSync('which', [name], { stdio: 'ignore' }).status === 0);
if (!chrome) throw new Error('Chrome is not installed');
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg', '.svg': 'image/svg+xml',
};
const serverPort = 4700 + (process.pid % 8000);
const debugPort = 37000 + (process.pid % 8000);
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
const profile = await mkdtemp(join(tmpdir(), 'zillions-stakes-'));
const browser = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--window-size=1280,800', '--force-device-scale-factor=1',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
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
    } catch { /* starting */ }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('no browser');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') {
      console.error(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
    if (!message.id || !pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  };
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, (message) => {
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result || {});
    });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });
  let booted = false;
  for (let i = 0; i < 40 && !booted; i++) { await delay(200); booted = await evaluate('!!window.__app'); }
  if (!booted) throw new Error('app did not boot');
  const info = await evaluate(`(async () => {
    const app = window.__app;
    app.ui.selectedLevel = 2;
    app.ui.selectedMode = 'campaign';
    app.ui.selectedCulture = 'european';
    app.tacticalVisuals.applyQuality('high', false);
    await app.startGame('normal', 'scott');
    app.game.foundCity(0, 0);
    app.paused = true;
    app.camDist = 18;
    for (const id of ['banner', 'messages', 'combat-alert']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    const hq = app.game.plots.find((p) => p.kind === 'hq');
    const plot = app.game.plots.filter((p) => p.kind === 'house' && p.tier === 0)
      .sort((a, b) => Math.hypot(b.cx - hq.cx, b.cz - hq.cz) - Math.hypot(a.cx - hq.cx, a.cz - hq.cz))[0];
    const h = app.myHero();
    h.x = plot.cx; h.z = plot.cz + 8;
    app.focus.set(plot.cx, app.map.groundY(plot.cx, plot.cz), plot.cz + 4);
    app.camDist = 22;
    return { kind: plot.kind, x: plot.cx, z: plot.cz, hx: h.x, hz: h.z };
  })()`);
  console.log('stake', JSON.stringify(info));
  await delay(800);
  await shot('stake-empty.png');

  const ghost = await evaluate(`(() => {
    const app = window.__app;
    const hq = app.game.plots.find((p) => p.kind === 'hq');
    const plot = app.game.plots.filter((p) => p.kind === 'house' && p.tier === 0)
      .sort((a, b) => Math.hypot(b.cx - hq.cx, b.cz - hq.cz) - Math.hypot(a.cx - hq.cx, a.cz - hq.cz))[0];
    const h = app.myHero();
    const [px, pz] = app.game.payPoint(plot, h);
    h.x = px; h.z = pz + 1.2;
    app.focus.set(plot.cx, app.map.groundY(plot.cx, plot.cz), plot.cz);
    app.camDist = 18;
    app.controlMode = 'build';
    return { x: h.x, z: h.z };
  })()`);
  console.log('ghost', JSON.stringify(ghost));
  await delay(700);
  await shot('stake-ghost.png');

  const up = await evaluate(`(() => {
    const app = window.__app;
    const hq = app.game.plots.find((p) => p.kind === 'hq');
    const plot = app.game.plots.filter((p) => p.kind === 'house' && p.tier === 0)
      .sort((a, b) => Math.hypot(b.cx - hq.cx, b.cz - hq.cz) - Math.hypot(a.cx - hq.cx, a.cz - hq.cz))[0];
    app.game._construct(plot);
    const h = app.myHero();
    const [px, pz] = app.game.payPoint(plot, h);
    h.x = px; h.z = pz + 1.4;
    app.focus.set(plot.cx, app.map.groundY(plot.cx, plot.cz), plot.cz);
    app.camDist = 18;
    return { tier: plot.tier };
  })()`);
  console.log('upgrade', JSON.stringify(up));
  await delay(900);
  await shot('stake-upgrade.png');

  const wave = await evaluate(`(() => {
    const app = window.__app;
    const g = app.game;
    const dt = 1 / 30;
    let steps = 0;
    const marching = () => g.zombies.filter((z) => z && !z.dead && z.wave).length;
    while (steps < 30 * 40 && marching() < 4) { g.update(dt); steps++; }
    // Let the render fade the stakes out.
    return { steps, zombies: marching() };
  })()`);
  console.log('wave', JSON.stringify(wave));
  await delay(700);
  await shot('stake-wave.png');

  async function shot(file) {
    const { data } = await command('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, file), Buffer.from(data, 'base64'));
    console.log('wrote', join(outDir, file));
  }
} finally {
  try { if (socket) socket.close(); } catch { /* closed */ }
  try { browser.kill(); } catch { /* gone */ }
  server.close();
  await delay(200);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
