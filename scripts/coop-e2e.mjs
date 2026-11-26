// Two-browser invite flow.
//
// Default (CI and local): an in-process HTTP relay stands in for Supabase
// Realtime. Playwright opens two isolated browser contexts, which do not share
// storage, and both talk to that relay. This machine's CI job has no Supabase
// key, so it cannot open the production websocket.
//
// Live: `node scripts/coop-e2e.mjs --url https://zillions.taborlin.co`
// uses that site's real Supabase Realtime and does not install the relay.
// A Vercel preview will stop the guest on Deployment Protection unless that
// browser is already signed into the Vercel team. Production does not.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const liveUrl = process.argv.find((arg, index) => process.argv[index - 1] === '--url') || '';
const root = new URL('..', import.meta.url).pathname;

function relay() {
  const boxes = new Map();
  let seq = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://relay.local');
    if (req.method === 'POST' && url.pathname === '/pub') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const list = boxes.get(body.code) || [];
      list.push({ id: ++seq, message: body.message });
      boxes.set(body.code, list.slice(-80));
      res.writeHead(204); res.end(); return;
    }
    if (url.pathname === '/poll') {
      const code = url.searchParams.get('code');
      const after = Number(url.searchParams.get('after') || 0);
      const list = (boxes.get(code) || []).filter((entry) => entry.id > after);
      const cursor = list.length ? list.at(-1).id : after;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ cursor, messages: list.map((entry) => entry.message) }));
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      url: `http://127.0.0.1:${server.address().port}`,
    }));
  });
}

function staticServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
      const file = normalize(join(root, relative));
      if (!file.startsWith(root)) throw new Error('bad path');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      origin: `http://127.0.0.1:${server.address().port}`,
    }));
  });
}

const mailbox = liveUrl ? null : await relay();
const site = liveUrl ? null : await staticServer();
const origin = liveUrl || site.origin;
const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});

function watch(page, label) {
  const lines = [];
  page.on('pageerror', (error) => lines.push(`${label} error: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') lines.push(`${label} console: ${msg.text()}`);
  });
  return lines;
}

async function context(label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((relayUrl) => {
    window.__zillionsProbeEnabled = true;
    if (relayUrl) window.__zillionsShareRelay = relayUrl;
  }, mailbox?.url || '');
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const notes = watch(page, label);
  return { ctx, page, notes };
}

async function dump(page, notes) {
  const status = await page.locator('#share-status').textContent().catch(() => '');
  const start = await page.locator('#s-start').textContent().catch(() => '');
  const seat = await page.locator('.roomslot.host small').textContent().catch(() => '');
  const waiting = await page.locator('#waitind').textContent().catch(() => '');
  return { url: page.url(), status, start, seat, waiting, notes };
}

try {
  const host = await context('host');
  await host.page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await host.page.locator('#a-invite').click();
  await host.page.locator('#share-url').waitFor({ state: 'visible' });
  const invite = await host.page.locator('#share-url').inputValue();
  if (!invite.includes('coop=')) throw new Error(`invite was not created: ${invite} ${JSON.stringify(await dump(host.page, host.notes))}`);
  const address = host.page.url();
  if (!address.includes('coop=')) throw new Error(`address bar lost the room: ${address}`);
  const code = new URL(invite).searchParams.get('coop');
  await host.page.reload({ waitUntil: 'domcontentloaded' });
  await host.page.locator('#share-url').waitFor({ state: 'visible', timeout: 20000 });
  const afterRefresh = host.page.url();
  const refreshedInvite = await host.page.locator('#share-url').inputValue();
  if (!afterRefresh.includes(`coop=${code}`) || !refreshedInvite.includes(`coop=${code}`)) {
    throw new Error(`refresh dropped the room: ${afterRefresh} field=${refreshedInvite}`);
  }
  const guestUrl = new URL(refreshedInvite);
  const guestTarget = liveUrl ? refreshedInvite : `${origin}${guestUrl.pathname}${guestUrl.search}`;

  const guest = await context('guest');
  await guest.page.goto(guestTarget, { waitUntil: 'domcontentloaded' });
  await guest.page.getByText(/You're in as /).waitFor({ timeout: 20000 }).catch(async (error) => {
    const body = await guest.page.locator('body').innerText().catch(() => '');
    throw new Error(`${error.message}\nGUEST BODY:\n${body.slice(0, 1500)}\n${JSON.stringify({ host: await dump(host.page, host.notes), guest: await dump(guest.page, guest.notes) }, null, 2)}`);
  });
  await host.page.locator('.roomslot:not(.host):not(.open) small').filter({ hasText: 'Vanguard' }).waitFor({ timeout: 20000 }).catch(async (error) => {
    const body = await host.page.locator('#room-roster').innerText().catch(() => '');
    throw new Error(`${error.message}\nHOST ROSTER:\n${body}\n${JSON.stringify(await dump(host.page, host.notes))}`);
  });
  const hostSeat = await host.page.locator('.roomslot.host small').innerText();
  if (/Scott English/i.test(hostSeat)) throw new Error(`seat subtitle used the hero kit: ${hostSeat}`);
  if (!/Vanguard/i.test(hostSeat)) throw new Error(`seat subtitle was not the founder: ${hostSeat}`);

  await host.page.waitForFunction(() => {
    const button = document.querySelector('#s-start');
    return button && !button.disabled && /START/i.test(button.textContent || '');
  }, null, { timeout: 25000 }).catch(async (error) => {
    throw new Error(`${error.message} host=${JSON.stringify(await dump(host.page, host.notes))} guest=${JSON.stringify(await dump(guest.page, guest.notes))}`);
  });
  await host.page.locator('#s-start').click();
  await host.page.locator('#screen-setup').waitFor({ state: 'hidden', timeout: 90000 });
  await guest.page.locator('#screen-setup').waitFor({ state: 'hidden', timeout: 90000 });
  const probe = (page) => page.evaluate(() => globalThis.__zillionsProbe?.() || null);
  let synced = null;
  const deadline = Date.now() + 90000;
  let last = null;
  while (Date.now() < deadline) {
    const hostProbe = await probe(host.page);
    const guestProbe = await probe(guest.page);
    last = { hostProbe, guestProbe };
    if (hostProbe?.net && guestProbe?.net && !hostProbe.barrier && !guestProbe.barrier
      && hostProbe.frame > 20 && Math.abs(hostProbe.frame - guestProbe.frame) <= 30
      && hostProbe.gold != null && hostProbe.gold === guestProbe.gold) {
      synced = last;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!synced) {
    throw new Error(`sims did not tick together ${JSON.stringify(last)} host=${JSON.stringify(await dump(host.page, host.notes))} guest=${JSON.stringify(await dump(guest.page, guest.notes))}`);
  }

  const beforeDrop = await probe(host.page);
  await guest.page.reload({ waitUntil: 'domcontentloaded' });
  let rejoined = null;
  let lastRejoin = null;
  const rejoinDeadline = Date.now() + 120000;
  while (Date.now() < rejoinDeadline) {
    const hostProbe = await probe(host.page);
    const guestProbe = await probe(guest.page);
    lastRejoin = { beforeDrop, hostProbe, guestProbe };
    if (guestProbe?.role === 'guest' && guestProbe.net && hostProbe?.role === 'host'
      && guestProbe.frame + 15 >= beforeDrop.frame
      && Math.abs(hostProbe.frame - guestProbe.frame) <= 45
      && hostProbe.gold != null && hostProbe.gold === guestProbe.gold) {
      rejoined = lastRejoin;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!rejoined) {
    const body = await guest.page.locator('body').innerText().catch(() => '');
    throw new Error(`guest did not rejoin the running sim ${JSON.stringify(lastRejoin)}\nGUEST:\n${body.slice(0, 800)}`);
  }
  console.log(liveUrl ? 'coop e2e passed against the live URL' : 'coop e2e passed against the in-process relay');
} finally {
  await browser.close();
  mailbox?.server.close();
  site?.server.close();
}
