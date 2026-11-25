// Headless in-match check for the marine heroes/troops (no visible window).
//   node scripts/marine-ingame-shots.mjs [outDir] [--gpu] [--army=200] [--variants=default,hi,old]
// Starts a static server + headless Chrome (CDP), starts a solo match with
// the defaults (marine heroes + troops on), parks every hero side by side,
// spawns an army of colony troops, and saves screenshots + frame timings.
// Variants: default (auto LOD), hi (?marineLod=hi), lo (?marineLod=lo),
// old (?marines=0&marineHeroes=0). Presentation-only; nothing is saved.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) || 'marine-ingame');
const gpu = args.includes('--gpu');
const army = Number((args.find((a) => a.startsWith('--army=')) || '--army=200').slice(7));
const variants = (args.find((a) => a.startsWith('--variants=')) || '--variants=default,hi,old').slice(11).split(',');
const QS = { default: '', hi: '?marineLod=hi', lo: '?marineLod=lo', old: '?marines=0&marineHeroes=0' };
await mkdir(outDir, { recursive: true });

const chrome = [process.env.CHROME, 'chromium', 'chromium-browser', 'google-chrome'].filter(Boolean)
  .find((name) => spawnSync('which', [name], { stdio: 'ignore' }).status === 0);
if (!chrome) { console.log('skipped: no Chrome'); process.exit(0); }

const root = new URL('..', import.meta.url).pathname;
const serverPort = 5000 + (process.pid % 20000);
const debugPort = 30000 + (process.pid % 20000);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.glb': 'model/gltf-binary', '.json': 'application/json', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const file = normalize(join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')));
    if (!file.startsWith(root)) throw new Error('bad path');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(serverPort, '127.0.0.1', r));

const profile = await mkdtemp(join(tmpdir(), 'zillions-marines-'));
const gl = gpu ? ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', ...gl,
  '--window-size=1440,900', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--ozone-platform=headless', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { gpu, chrome, army, variants: {} };
let socket;
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await delay(200);
    try { target = (await fetch(`http://127.0.0.1:${debugPort}/json`).then((r) => r.json())).find((p) => p.type === 'page'); } catch { /* starting */ }
  }
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const command = (method, params = {}) => new Promise((r) => { const rid = ++id; pending.set(rid, r); socket.send(JSON.stringify({ id: rid, method, params })); });
  const evaluate = async (expression, timeoutMs = 90000) => {
    const m = await Promise.race([
      command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      delay(timeoutMs).then(() => { throw new Error(`evaluate timed out: ${expression.slice(0, 80)}`); }),
    ]);
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || m.result.exceptionDetails.text);
    return m.result?.result?.value;
  };
  const shot = async (name) => {
    const m = await command('Page.captureScreenshot', { format: 'png' });
    const file = join(outDir, name);
    await writeFile(file, Buffer.from(m.result.data, 'base64'));
    return file;
  };
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Page.bringToFront');
  await command('Emulation.setFocusEmulationEnabled', { enabled: true });
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Frame timing over `ms` of real time + renderer counters for the last frame.
  // rAF fps (may stall in headless; capped by a timeout) and the cost of a
  // full app.frame() measured synchronously with a GPU sync (readPixels).
  const measure = (ms) => evaluate(`new Promise((done) => {
    const app = window.__app; const times = []; let last = performance.now(); const end = last + ${ms};
    const gl = app.renderer.getContext(); const px = new Uint8Array(4);
    const frameCost = () => { const c = []; for (let i = 0; i < 25; i++) { const t0 = performance.now(); app.frame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); c.push(performance.now() - t0); } c.sort((a, b) => a - b); return { frameMsP50: +c[12].toFixed(2), frameMsMax: +c[24].toFixed(2), syncFps: +(1000 / c[12]).toFixed(1) }; };
    let finished = false;
    const finish = () => { if (finished) return; finished = true;
      times.shift(); times.sort((a, b) => a - b);
      const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : NaN;
      const cost = frameCost();
      const info = app.renderer.info;
      let marines = 0, low = 0;
      for (const rec of app.unitMeshes.values()) { const n = rec.mesh.userData.marineNode; if (n) { marines++; if (n.userData.marineLod?.low) low++; } }
      done({ ...cost, rafFrames: times.length, rafFps: +(1000 / avg).toFixed(1), p50ms: +times[Math.floor(times.length * 0.5)]?.toFixed(1), p95ms: +times[Math.floor(times.length * 0.95)]?.toFixed(1),
        calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, units: app.game.units.length, marines, marinesLow: low, camDist: app.camDist });
    };
    const tick = (now) => { times.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else finish(); };
    requestAnimationFrame(tick);
    setTimeout(finish, ${ms} + 3000);
  })`);

  for (const variant of variants) {
    const url = `http://127.0.0.1:${serverPort}/${QS[variant] ?? ''}`;
    errors.length = 0;
    await command('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) { await delay(200); ready = !!(await evaluate('!!window.__app').catch(() => false)); }
    if (!ready) { report.variants[variant] = { error: 'app did not start', errors: [...errors] }; continue; }
    const v = report.variants[variant] = { url };
    v.webgl = await evaluate(`(() => { const g = window.__app.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); })()`);
    v.start = await evaluate(`(async () => {
      const app = window.__app;
      const t0 = performance.now();
      await app.startGame('normal', 'alexander');
      return { ms: Math.round(performance.now() - t0), units: app.game.units.length, heroes: app.game.units.filter((u) => u.hero).map((u) => u.key) };
    })()`);
    await delay(2500);
    // Park every hero in a row in front of the camera; freeze the sim so the
    // line-up stays put (render loop + idle animation keep running).
    v.heroes = await evaluate(`(() => {
      const app = window.__app, g = app.game;
      const lead = g.units.find((u) => u.hero) || { x: 64, z: 64 };
      const keys = ['alexander', 'danny', 'turtle', 'john', 'tiger', 'aaron', 'scott'];
      const fx = lead.x, fz = lead.z + 5;
      const before = new Set(g.units.map((u) => u.id));
      for (const k of keys) { try { g._spawnHero(k, fx, fz); } catch (e) { console.error('spawnHero', k, e.message); } }
      const fresh = g.units.filter((u) => u.hero && !before.has(u.id));
      const heroes = keys.map((k) => fresh.find((u) => u.key === k)).filter(Boolean);
      heroes.forEach((u, i) => { u.x = u.holdX = fx + (i - 3) * 2.4; u.z = u.holdZ = fz; u.path = null; u.facing = 0; });
      for (const z of g.zombies || []) z.hp = 0;
      app.__frozen = true;
      for (const k of ['update', 'step', 'tick']) if (typeof g[k] === 'function') g[k] = () => {};
      app.focus.set(fx, 0, fz);
      app._marineShotFocus = { x: fx, z: fz };
      app.frame(); // build the unit meshes now (headless rAF is throttled)
      return heroes.map((u) => {
        const rec = app.unitMeshes.get(u.id);
        let tris = 0, marine = false;
        rec?.mesh.traverse((o) => { if (o.isMesh && o.visible) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; if (/hood|reactor|pauldron|visor|helmet|backpack/i.test(o.name)) marine = true; });
        return { key: u.key, tris: Math.round(tris), marineArt: marine };
      });
    })()`);
    console.log(variant, 'heroes', JSON.stringify(v.heroes));
    const hold = (dist, yaw = null) => evaluate(`(() => { const app = window.__app; const f = app._marineShotFocus; app.focus.set(f.x, app.focus.y, f.z); app.camDist = ${dist}; ${yaw == null ? '' : `app.camYaw = ${yaw};`} return true; })()`);
    v.shots = [];
    for (const [name, dist] of [['heroes-close', 24], ['heroes-rts', 56]]) {
      await hold(dist); await delay(1500); await hold(dist);
      v.shots.push(await shot(`${variant}-${name}.png`));
    }
    // Army: a block of colony troops (soldier / ranger / sniper) behind the heroes.
    v.armySpawn = await evaluate(`(() => {
      const app = window.__app, g = app.game, f = app._marineShotFocus;
      const kinds = ['soldier', 'ranger', 'sniper'];
      const n = ${army}, cols = Math.ceil(Math.sqrt(n * 1.6));
      for (let i = 0; i < n; i++) {
        const x = f.x + ((i % cols) - (cols - 1) / 2) * 1.25, z = f.z - 3 - Math.floor(i / cols) * 1.25;
        const u = g._spawnUnit(kinds[i % 3], x, z, null); u.facing = 0;
      }
      return g.units.filter((u) => !u.hero).length;
    })()`);
    console.log(variant, 'army spawned', v.armySpawn, 'errors', JSON.stringify(errors.slice(0, 5)));
    for (const [name, dist] of [['army-rts', 56], ['army-close', 30], ['army-far', 90]]) {
      await hold(dist); await delay(1800); await hold(dist);
      const perf = await measure(4000);
      v[`perf_${name.replace("-", "_")}`] = perf;
      console.log(variant, name, JSON.stringify(perf));
      v.shots.push(await shot(`${variant}-${name}.png`));
    }
    v.errors = [...new Set(errors)].slice(0, 12);
    console.log(variant, JSON.stringify({ webgl: v.webgl, start: v.start, heroes: v.heroes, perf: [v.perf_army_rts, v.perf_army_close, v.perf_army_far], errors: v.errors }));
  }
} finally {
  socket?.close();
  browser.kill('SIGTERM');
  server.close();
  await delay(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
}
