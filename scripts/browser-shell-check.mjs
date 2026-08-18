import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const chrome = ['chromium', 'chromium-browser', 'google-chrome'].find((name) =>
  spawnSync('which', [name], { stdio: 'ignore' }).status === 0);
if (!chrome) {
  console.log('browser shell check skipped: Chrome is unavailable');
  process.exit(0);
}

const root = new URL('..', import.meta.url).pathname;
const serverPort = 5000 + (process.pid % 20000);
const debugPort = 30000 + (process.pid % 20000);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.glb': 'model/gltf-binary' };
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

const profile = await mkdtemp(join(tmpdir(), 'zillions-browser-'));
const browser = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `http://127.0.0.1:${serverPort}/`,
], { stdio: 'ignore' });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await delay(150);
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json`).then((r) => r.json());
      target = pages.find((page) => page.type === 'page' && page.url.includes(`:${serverPort}`));
    } catch { /* Chrome is still starting */ }
  }
  assert.ok(target?.webSocketDebuggerUrl, 'browser target did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const runtimeErrors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
    if (!message.id || !pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  };
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, (message) => {
      if (message.result.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text));
      } else resolve(message.result.result.value);
    });
    socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  socket.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }));
  let appReady = false;
  for (let i = 0; i < 40 && !appReady; i++) {
    appReady = !!(await evaluate('!!window.__app'));
    if (!appReady) await delay(150);
  }
  assert.equal(appReady, true, `app did not start: ${runtimeErrors.join(' | ')} ${await evaluate('document.body.innerText.slice(0, 300)')}`);
  // Account/profile hydration finishes after the renderer is constructed and
  // can replace the initial page context. Wait for that startup work before
  // driving the real controls.
  await delay(1000);
  const entryDom = await evaluate(`JSON.stringify({
    url: location.href,
    connected: window.__app.ui.root.isConnected,
    html: window.__app.ui.root.innerHTML.length,
    offline: !!document.querySelector('#a-offline'),
    create: !!document.querySelector('#m-create-character'),
  })`);
  assert.equal(JSON.parse(entryDom).offline, true, `entry controls missing: ${entryDom}`);
  assert.equal(await evaluate(`(() => {
    const app = window.__app;
    const offline = document.querySelector('#a-offline');
    const create = document.querySelector('#m-create-character');
    const name = document.querySelector('#creator-name');
    const form = document.querySelector('#character-create-form');
    offline.click();
    create.click();
    name.value = 'Journey Test';
    form.requestSubmit();
    return app.ui.shell.base === 'overworld' && app.ui.overlayHidden() && app.ow?.world?.id === 'earth';
  })()`), true, 'new account must create a character and enter Earth');
  assert.equal(await evaluate(`(() => {
    const app = window.__app;
    app.ui._showScreen('help');
    document.querySelector('#h-back').click();
    return app.ui.shell.base === 'overworld' && app.ui.overlayHidden();
  })()`), true, 'Help must close back to the overworld');
  console.log('browser shell check passed');
} finally {
  try { socket?.close(); } catch { /* closed */ }
  browser.kill('SIGTERM');
  server.close();
  await Promise.race([
    new Promise((resolve) => browser.once('exit', resolve)),
    delay(1500),
  ]);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
