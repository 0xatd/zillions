// Capture a 20 s, 30 fps gameplay clip and mix the soundscape offline.
// Usage: node scripts/audio-proof.mjs [frameCount]
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FRAMES = Number(process.argv[2] || 600);
const PORT = 4177;
const OUT = process.env.AUDIO_PROOF_DIR || '/opt/cursor/artifacts/audio-proof';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.glb': 'model/gltf-binary',
};

function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        const rel = decodeURIComponent(url.pathname);
        const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
        if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404); res.end();
      }
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message || 'cdp error'));
    else resolve(msg.result);
  });
  return (method, params = {}) => {
    const msgId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  };
}

async function main() {
  const server = await serve();
  const userDir = '/tmp/chrome-audio-proof';
  await rm(userDir, { recursive: true, force: true });
  const chrome = spawn('google-chrome', [
    '--headless=new',
    '--remote-debugging-port=9223',
    `--user-data-dir=${userDir}`,
    '--window-size=1280,720',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    `http://127.0.0.1:${PORT}/index.html?audioProof=1`,
  ], { stdio: 'ignore' });

  const deadline = Date.now() + 20000;
  let target = null;
  while (Date.now() < deadline && !target) {
    try {
      const list = await fetch('http://127.0.0.1:9223/json/list').then((r) => r.json());
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* chrome still booting */ }
    if (!target) await new Promise((r) => setTimeout(r, 200));
  }
  if (!target) throw new Error('chrome did not open a page');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const send = cdp(ws);
  await send('Page.enable');
  await send('Runtime.enable');

  const readyDeadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < readyDeadline && !ready) {
    const result = await send('Runtime.evaluate', {
      expression: 'window.__audioProofReady === true',
      returnByValue: true,
    });
    ready = result.result?.value === true;
    if (!ready) await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error('audio proof page did not become ready');

  const frameDir = path.join(OUT, 'frames');
  await mkdir(frameDir, { recursive: true });
  const started = Date.now();
  for (let i = 0; i < FRAMES; i++) {
    const step = await send('Runtime.evaluate', {
      expression: 'window.__audioProofStep()',
      awaitPromise: true,
      returnByValue: true,
    });
    if (step.exceptionDetails) throw new Error(step.exceptionDetails.text || 'step failed');
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 62 });
    await writeFile(path.join(frameDir, String(i).padStart(4, '0') + '.jpg'), Buffer.from(shot.data, 'base64'));
    if (i === 0 || i === 59 || i % 100 === 0) {
      console.log('frame', i, step.result?.value, 'elapsed', ((Date.now() - started) / 1000).toFixed(1) + 's');
    }
  }

  const wavResult = await send('Runtime.evaluate', {
    expression: 'window.__audioProofWav()',
    awaitPromise: true,
    returnByValue: true,
  });
  if (wavResult.exceptionDetails) throw new Error(wavResult.exceptionDetails.text || 'wav failed');
  const wavPath = path.join(OUT, 'mix.wav');
  await writeFile(wavPath, Buffer.from(wavResult.result.value, 'base64'));

  const mp4 = path.join(OUT, 'gameplay.mp4');
  await new Promise((resolve, reject) => {
    const ff = spawn('/usr/bin/ffmpeg', [
      '-y',
      '-framerate', '30',
      '-i', path.join(frameDir, '%04d.jpg'),
      '-i', wavPath,
      '-t', (FRAMES / 30).toFixed(3),
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-shortest',
      mp4,
    ], { stdio: 'inherit' });
    ff.on('exit', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg ' + code)));
  });
  console.log('wrote', mp4);
  ws.close();
  chrome.kill();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
