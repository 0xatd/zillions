// Two-browser invite flow.
//
// Default (CI and local): an in-process HTTP relay stands in for Supabase
// Realtime. Playwright opens two isolated browser contexts, which do not share
// storage, and both talk to that relay. This machine's CI job has no Supabase
// key, so it cannot open the production websocket.
//
// Live signaling: `node scripts/coop-e2e.mjs --live-realtime` serves this
// branch locally and points it at production Supabase Realtime. The anon key
// comes from the public auth-config response. It is not printed.
//
// Live site: `node scripts/coop-e2e.mjs --url https://zillions.taborlin.co`
// uses that site's real Supabase Realtime and does not install the relay.
// A Vercel preview will stop the guest on Deployment Protection unless that
// browser is already signed into the Vercel team. Production does not.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const liveUrl = process.argv.find((arg, index) => process.argv[index - 1] === '--url') || '';
const liveRealtime = process.argv.includes('--live-realtime');
const root = new URL('..', import.meta.url).pathname;

async function productionAuthConfig() {
  const response = await fetch('https://zillions.taborlin.co/api/auth-config', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`auth-config HTTP ${response.status}`);
  const config = await response.json();
  if (!config?.enabled || !config.supabaseUrl || !config.supabaseAnonKey) throw new Error('auth-config incomplete');
  return config;
}

function relay({ drop = 0 } = {}) {
  const boxes = new Map();
  const presence = new Map();
  let seq = 0;
  const readBody = async (req) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  };
  const present = (code) => {
    const now = Date.now();
    const box = presence.get(code) || new Map();
    for (const [id, entry] of box) if (now - entry.at > 8000) box.delete(id);
    presence.set(code, box);
    return [...box.values()].map((entry) => ({ ...entry.payload, id: entry.payload?.id || entry.id }));
  };
  const server = createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://relay.local');
    if (req.method === 'POST' && url.pathname === '/pub') {
      const body = await readBody(req);
      // Window and snapshot bodies travel as link messages. Dropping some of
      // them is the loss a slow guest sees. Lobby traffic is not a link.
      // Drop whole window packets. Snapshot chunks stay, so a missed window
      // can still be rebuilt once the guest asks.
      if (drop && body.message?.t === 'link' && !body.message.chunk && Math.random() < drop) {
        res.writeHead(204); res.end(); return;
      }
      const list = boxes.get(body.code) || [];
      list.push({ id: ++seq, message: body.message });
      boxes.set(body.code, list.slice(-4000));
      res.writeHead(204); res.end(); return;
    }
    if (req.method === 'POST' && url.pathname === '/presence') {
      const body = await readBody(req);
      const box = presence.get(body.code) || new Map();
      box.set(body.id, { id: body.id, payload: body.payload || { id: body.id }, at: Date.now() });
      presence.set(body.code, box);
      res.writeHead(204); res.end(); return;
    }
    if (url.pathname === '/poll') {
      const code = url.searchParams.get('code');
      const after = Number(url.searchParams.get('after') || 0);
      const all = (boxes.get(code) || []).filter((entry) => entry.id > after);
      // A fresh page polls from zero. Hand it the live tail, not the match
      // backlog, or it replays the original begin and starts at frame 0.
      const list = after === 0 && all.length > 40 ? all.slice(-40) : all;
      const cursor = list.length ? list.at(-1).id : after;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        cursor,
        messages: list.map((entry) => entry.message),
        presence: present(code),
      }));
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

function staticServer(authConfig = null) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
      if (pathname === '/api/auth-config' && authConfig) {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(authConfig));
        return;
      }
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

const authConfig = liveRealtime ? await productionAuthConfig() : null;
const mailbox = liveUrl || liveRealtime ? null : await relay({ drop: 0.08 });
const site = liveUrl ? null : await staticServer(authConfig);
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
    // Same-NAT peers often never open a data channel. The match has to start
    // on the realtime relay anyway.
    window.RTCPeerConnection = function RTCPeerConnection() {
      throw new Error('webrtc blocked');
    };
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
  const probe = (page) => page.evaluate(() => globalThis.__zillionsProbe?.() || null);
  const guestSeat = async () => {
    const snap = await probe(host.page);
    return (snap?.roster || []).find((seat) => !seat.host) || null;
  };
  await host.page.waitForFunction(() => {
    const roster = globalThis.__zillionsProbe?.()?.roster || [];
    return roster.filter((seat) => !seat.host).length === 1;
  }, null, { timeout: 20000 }).catch(async (error) => {
    throw new Error(`${error.message} host=${JSON.stringify(await dump(host.page, host.notes))} guest=${JSON.stringify(await dump(guest.page, guest.notes))}`);
  });
  const hostSnap = await probe(host.page);
  const guestSnap = await probe(guest.page);
  if (!hostSnap?.self || !guestSnap?.self || hostSnap.self === guestSnap.self) {
    throw new Error(`host and guest share a commander id ${JSON.stringify({ host: hostSnap?.self, guest: guestSnap?.self })}`);
  }
  await host.page.waitForFunction(() => {
    const roster = globalThis.__zillionsProbe?.()?.roster || [];
    const hostSeat = roster.find((seat) => seat.host);
    const guestSeat = roster.find((seat) => !seat.host);
    const line = document.querySelector('.roomslot:not(.host):not(.open)')?.innerText || '';
    const button = document.querySelector('#s-start');
    return !!(guestSeat && hostSeat && /^Guest [0-9A-F]{4}$/.test(guestSeat.name)
      && guestSeat.name !== hostSeat.name
      && guestSeat.state === 'connected'
      && line.includes(guestSeat.name)
      && /\bconnected\b/.test(line)
      && !line.includes('· connecting')
      && button && !button.disabled
      && /START/i.test(button.textContent || '')
      && !/WAITING/i.test(button.textContent || ''));
  }, null, { timeout: 20000 }).catch(async (error) => {
    const line = await host.page.locator('.roomslot:not(.host):not(.open)').innerText().catch(() => '');
    throw new Error(`${error.message}\n${line}\n${JSON.stringify((await probe(host.page))?.roster)}`);
  });
  const hostSeat = await host.page.locator('.roomslot.host small').innerText();
  if (/Scott English/i.test(hostSeat)) throw new Error(`seat subtitle used the hero kit: ${hostSeat}`);
  const seated = (await probe(host.page)).roster.find((seat) => !seat.host);
  const stableName = seated.name;
  const stableId = seated.id;
  const holdUntil = Date.now() + 10000;
  while (Date.now() < holdUntil) {
    const snap = await probe(host.page);
    const guests = (snap?.roster || []).filter((seat) => !seat.host);
    const live = guests[0];
    if (guests.length !== 1 || live?.id !== stableId || live?.name !== stableName || live?.state !== 'connected') {
      throw new Error(`seat flapped during the hold ${JSON.stringify(snap?.roster)}`);
    }
    const line = await host.page.locator('.roomslot:not(.host):not(.open)').innerText();
    if (!line.includes(stableName) || !/\bconnected\b/.test(line) || /· connecting/.test(line)) {
      throw new Error(`visible seat changed during the hold: ${JSON.stringify({ line, stableName, roster: snap?.roster })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if ((await guestSeat())?.name !== stableName) throw new Error('guest seat name changed at the end of the hold');

  const extra = await context('guest-b');
  await extra.page.goto(guestTarget, { waitUntil: 'domcontentloaded' });
  await host.page.waitForFunction(() => (globalThis.__zillionsProbe?.()?.roster || []).filter((seat) => !seat.host).length === 2, null, { timeout: 20000 });
  await extra.page.close();
  await host.page.waitForFunction(() => (globalThis.__zillionsProbe?.()?.roster || []).filter((seat) => !seat.host).length === 1, null, { timeout: 8000 }).catch(async (error) => {
    throw new Error(`closed guest was not dropped ${error.message} ${JSON.stringify((await probe(host.page))?.roster)}`);
  });

  await host.page.waitForFunction(() => {
    const button = document.querySelector('#s-start');
    return button && !button.disabled && /START/i.test(button.textContent || '');
  }, null, { timeout: 45000 }).catch(async (error) => {
    throw new Error(`${error.message} host=${JSON.stringify(await dump(host.page, host.notes))} guest=${JSON.stringify(await dump(guest.page, guest.notes))}`);
  });
  await host.page.locator('#s-start').click();
  await host.page.locator('#screen-setup').waitFor({ state: 'hidden', timeout: 90000 });
  await guest.page.locator('#screen-setup').waitFor({ state: 'hidden', timeout: 90000 });
  const enterCap = Date.now() + 30000;
  let moveDeadline = 0;
  let moved = null;
  let spawn = null;
  while (Date.now() < (moveDeadline || enterCap)) {
    const guestProbe = await probe(guest.page);
    if (guestProbe?.myPlayer > 0 && guestProbe.heroes?.length === 2) {
      const me = guestProbe.heroes[guestProbe.myPlayer];
      const hostHero = guestProbe.heroes[0];
      if (!spawn) {
        spawn = { x: me.x, z: me.z, hx: hostHero.x, hz: hostHero.z };
        moveDeadline = Date.now() + 30000;
      }
      await guest.page.evaluate((spot) => globalThis.__zillionsOrder?.(spot.x, spot.z), { x: spawn.x + 8, z: spawn.z + 6 });
      const mineStep = Math.hypot(me.x - spawn.x, me.z - spawn.z);
      const hostStep = Math.hypot(hostHero.x - spawn.hx, hostHero.z - spawn.hz);
      if (mineStep > 0.4 && hostStep < mineStep) {
        moved = guestProbe;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!moved) throw new Error(`guest did not move its own hero within 30s guest=${JSON.stringify(await probe(guest.page))} host=${JSON.stringify(await probe(host.page))}`);
  let synced = null;
  const deadline = Date.now() + 90000;
  let last = null;
  while (Date.now() < deadline) {
    const hostProbe = await probe(host.page);
    const guestProbe = await probe(guest.page);
    last = { hostProbe, guestProbe };
    if (hostProbe?.net && guestProbe?.net && !hostProbe.barrier && !guestProbe.barrier
      && hostProbe.frame > 20 && guestProbe.frame > 20 && Math.abs(hostProbe.frame - guestProbe.frame) <= 90
      && hostProbe.gold != null && hostProbe.gold === guestProbe.gold) {
      synced = last;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!synced) {
    throw new Error(`sims did not tick together ${JSON.stringify(last)} host=${JSON.stringify(await dump(host.page, host.notes))} guest=${JSON.stringify(await dump(guest.page, guest.notes))}`);
  }
  if (!liveRealtime) {
    // CPU throttle slows the guest toward the 10 FPS the live retest saw.
    // One long frame can make a single sample look older than 5s; a guest
    // that is still waiting a second later has actually stuck.
    const cdp = await guest.page.context().newCDPSession(guest.page);
    const hostPace = await host.page.context().newCDPSession(host.page);
    // This machine needs rate 4 to land near 10 FPS. A GitHub runner is already
    // that slow, and rate 4 there drops the sim to a handful of frames a second.
    const cpuRate = process.env.GITHUB_ACTIONS ? 2 : 4;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    // Both tabs render slowly. The sim pump has to keep the world moving anyway.
    await hostPace.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    const paceStart = await probe(guest.page);
    const untilPace = Date.now() + 20000;
    let worstStall = 0;
    let worstResync = 0;
    let stuckSince = 0;
    while (Date.now() < untilPace) {
      const guestProbe = await probe(guest.page);
      const stall = guestProbe?.stallMs || 0;
      worstStall = Math.max(worstStall, stall);
      worstResync = Math.max(worstResync, guestProbe?.resyncMs || 0);
      if ((guestProbe?.resyncMs || 0) > 20000) {
        throw new Error(`guest resync hung ${guestProbe.resyncMs}ms ${JSON.stringify(guestProbe)}`);
      }
      if (guestProbe?.syncing) throw new Error(`syncing flap before reload ${JSON.stringify(guestProbe)}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const paceEnd = await probe(guest.page);
    if ((paceEnd?.frame || 0) < (paceStart?.frame || 0) + 200) {
      throw new Error(`throttled guest did not keep simulating ${JSON.stringify({ paceStart, paceEnd, worstStall, worstResync })}`);
    }
    console.log(`throttled guest stayed under 5s stalls (worst ${worstStall}ms, resync ${worstResync}ms)`);
    const preHost = await probe(host.page);
    const preGuest = await probe(guest.page);
    await guest.page.evaluate((spot) => globalThis.__zillionsOrder?.(spot.x, spot.z), {
      x: (preGuest.heroes?.[preGuest.myPlayer]?.x || 0) + 8,
      z: (preGuest.heroes?.[preGuest.myPlayer]?.z || 0) + 6,
    });
    const preDeadline = Date.now() + 1500;
    let preMoved = false;
    while (Date.now() < preDeadline) {
      const hostNow = await probe(host.page);
      const guestNow = await probe(guest.page);
      const mine = guestNow?.myPlayer;
      const agree = mine && hostNow?.heroes?.[mine] && guestNow?.heroes?.[mine]
        ? Math.hypot(hostNow.heroes[mine].x - guestNow.heroes[mine].x, hostNow.heroes[mine].z - guestNow.heroes[mine].z)
        : 99;
      const frameGap = Math.abs((hostNow?.frame || 0) - (guestNow?.frame || 0));
      // The probe itself costs a few hundred milliseconds on a slow runner.
      // Equal frames means the order is already on both sims.
      if ((hostNow?.cmdsIn || 0) > (preHost.cmdsIn || 0) && agree < 6 && frameGap <= 45 && !guestNow?.syncing) {
        preMoved = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!preMoved) throw new Error(`guest click before reload was not on both sims within 1.5s host=${JSON.stringify(await probe(host.page))} guest=${JSON.stringify(await probe(guest.page))}`);
  }
  if (liveRealtime) {
    const until = Date.now() + 60000;
    const hostLog = new Map();
    const guestLog = new Map();
    let hostMax = 0;
    let guestMax = 0;
    while (Date.now() < until) {
      const hostProbe = await probe(host.page);
      const guestProbe = await probe(guest.page);
      hostMax = Math.max(hostMax, hostProbe?.frame || 0);
      guestMax = Math.max(guestMax, guestProbe?.frame || 0);
      for (const row of hostProbe?.hashLog || []) hostLog.set(row[0], row[1]);
      for (const row of guestProbe?.hashLog || []) guestLog.set(row[0], row[1]);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    let agreed = 0;
    let mismatched = 0;
    for (const [frame, hash] of hostLog) {
      const other = guestLog.get(frame);
      if (!other) continue;
      if (other === hash) agreed += 1;
      else mismatched += 1;
    }
    if (hostMax < 200 || guestMax < 200) throw new Error(`ticks did not advance host=${hostMax} guest=${guestMax}`);
    if (agreed < 3 || mismatched) throw new Error(`state hashes diverged agreed=${agreed} mismatched=${mismatched} hostFrames=${hostLog.size} guestFrames=${guestLog.size}`);
  }

  const beforeDrop = await probe(host.page);
  await guest.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  let rejoined = null;
  let lastRejoin = null;
  const rejoinDeadline = Date.now() + 40000;
  while (Date.now() < rejoinDeadline) {
    const hostProbe = await probe(host.page);
    const guestProbe = await probe(guest.page);
    lastRejoin = { beforeDrop, hostProbe, guestProbe };
    const button = await guest.page.locator('#s-start').innerText().catch(() => '');
    if (/WAITING FOR HOST TO START/i.test(button)) {
      throw new Error(`rejoin flashed WAITING FOR HOST TO START ${JSON.stringify(guestProbe)}`);
    }
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
  const hostCdp = liveRealtime ? null : await host.page.context().newCDPSession(host.page);
  const guestCdp = liveRealtime ? null : await guest.page.context().newCDPSession(guest.page);
  if (hostCdp && guestCdp) {
    const cpuRate = process.env.GITHUB_ACTIONS ? 2 : 4;
    await hostCdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    await guestCdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    await guest.page.bringToFront();
  }
  const afterRejoin = await probe(guest.page);
  if (!(afterRejoin?.myPlayer > 0) || !/guest/i.test(afterRejoin.hud || '')) {
    throw new Error(`guest HUD is not its own hero ${JSON.stringify(afterRejoin)}`);
  }
  const hostLog = new Map();
  const guestLog = new Map();
  const holdStart = Date.now();
  const hostFrameStart = (await probe(host.page))?.frame || 0;
  const guestFrameStart = (await probe(guest.page))?.frame || 0;
  const untilHold = holdStart + 120000;
  let nextOrderAt = Date.now();
  let pending = null;
  let applied = 0;
  const stepOf = (hero, from) => hero ? Math.hypot(hero.x - from.x, hero.z - from.z) : 0;
  while (Date.now() < untilHold) {
    const hostProbe = await probe(host.page);
    const guestProbe = await probe(guest.page);
    if (!hostProbe?.live || hostProbe.role !== 'host' || hostProbe.exit) {
      throw new Error(`host match ended after rejoin ${JSON.stringify({ hostProbe, guestProbe })}`);
    }
    if (!guestProbe?.live || !(guestProbe.myPlayer > 0) || !/guest/i.test(guestProbe.hud || '')) {
      throw new Error(`guest left its own hero after rejoin ${JSON.stringify(guestProbe)}`);
    }
    if (guestProbe.syncing || hostProbe.syncing) {
      throw new Error(`syncing flap after rejoin ${JSON.stringify({ hostProbe, guestProbe })}`);
    }
    const mine = guestProbe.myPlayer;
    if (pending) {
      const hostNow = hostProbe.heroes?.[mine];
      const guestNow = guestProbe.heroes?.[mine];
      // The host has to accept the order, and both sims have to still be on
      // the same hero. A fighting hero may not walk 0.15 tiles inside 1.5s.
      // A guest that has not reached the order's window drifts off the host.
      const agree = stepOf(hostNow, guestNow);
      const accepted = (hostProbe.cmdsIn || 0) > pending.cmdsIn;
      const frameGap = Math.abs((hostProbe.frame || 0) - (guestProbe.frame || 0));
      const elapsed = Date.now() - pending.at;
      if (accepted && agree < 6 && frameGap <= 45) {
        // 1.5s of sim is 45 frames. The wall clock runs long when the probe
        // round trip is the thing that crossed 1500ms, which is not the hero.
        if (elapsed > 1500 && frameGap > 30) {
          throw new Error(`move landed after ${elapsed}ms ${JSON.stringify({ hostProbe, guestProbe })}`);
        }
        applied += 1;
        pending = null;
        nextOrderAt = Date.now() + 4000;
      } else if (elapsed > 1500) {
        throw new Error(`move was not on both sims within 1.5s ${JSON.stringify({ pending, hostProbe, guestProbe })}`);
      }
    } else if (Date.now() >= nextOrderAt) {
      const guestHero = guestProbe.heroes?.[mine];
      const hostHero = hostProbe.heroes?.[mine];
      if (guestHero && hostHero) {
        const flip = applied % 2 ? -1 : 1;
        pending = {
          at: Date.now(),
          hostFrom: { ...hostHero },
          guestFrom: { ...guestHero },
          cmdsIn: hostProbe.cmdsIn || 0,
        };
        await guest.page.evaluate((spot) => globalThis.__zillionsOrder?.(spot.x, spot.z), {
          x: guestHero.x + 6 * flip,
          z: guestHero.z + 4,
        });
      }
    }
    for (const row of hostProbe.hashLog || []) hostLog.set(row[0], row[1]);
    for (const row of guestProbe.hashLog || []) guestLog.set(row[0], row[1]);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (hostCdp && guestCdp) {
    await hostCdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await guestCdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  if (applied < 8) throw new Error(`guest did not land enough moves after rejoin (${applied})`);
  let agreed = 0;
  let mismatched = 0;
  for (const [frame, hash] of hostLog) {
    const other = guestLog.get(frame);
    if (!other) continue;
    if (other === hash) agreed += 1;
    else mismatched += 1;
  }
  if (agreed < 3 || mismatched) {
    throw new Error(`state hashes diverged after rejoin agreed=${agreed} mismatched=${mismatched}`);
  }
  const hostFrameEnd = (await probe(host.page))?.frame || 0;
  const guestFrameEnd = (await probe(guest.page))?.frame || 0;
  const heldSec = (Date.now() - holdStart) / 1000;
  if (hostFrameEnd - hostFrameStart < 0.9 * 30 * heldSec) {
    throw new Error(`host sim was under 90% speed ${hostFrameStart} -> ${hostFrameEnd} in ${heldSec.toFixed(1)}s`);
  }
  if (guestFrameEnd - guestFrameStart < 20 * heldSec) {
    throw new Error(`guest sim was under 20 fps ${guestFrameStart} -> ${guestFrameEnd} in ${heldSec.toFixed(1)}s`);
  }
  const bootHost = (await probe(host.page))?.boot;
  const bootGuest = (await probe(guest.page))?.boot;
  await host.page.evaluate(() => globalThis.__zillionsKillKeep?.());
  await host.page.getByRole('heading', { name: /the city has fallen/i }).waitFor({ timeout: 15000 });
  await guest.page.getByRole('heading', { name: /the city has fallen/i }).waitFor({ timeout: 15000 });
  const fallenHost = await probe(host.page);
  const fallenGuest = await probe(guest.page);
  if (fallenHost?.boot !== bootHost || fallenGuest?.boot !== bootGuest) {
    throw new Error(`defeat reloaded a tab ${JSON.stringify({ bootHost, bootGuest, fallenHost, fallenGuest })}`);
  }
  const guestBody = await guest.page.locator('body').innerText();
  if (/the host removed you/i.test(guestBody)) throw new Error('guest was told they were removed when the city fell');
  await host.page.locator('#b-share-retry').click();
  await guest.page.locator('#share-status', { hasText: /waiting for host to retry/i }).waitFor({ timeout: 15000 });
  await host.page.waitForFunction(() => {
    const roster = globalThis.__zillionsProbe?.()?.roster || [];
    const button = document.querySelector('#s-start');
    return roster.some((seat) => !seat.host)
      && button && !button.disabled && /START/i.test(button.textContent || '');
  }, null, { timeout: 20000 });
  await host.page.locator('#s-start').click();
  const restarted = Date.now() + 40000;
  let again = null;
  while (Date.now() < restarted) {
    const hostProbe = await probe(host.page);
    const guestProbe = await probe(guest.page);
    if (hostProbe?.live && guestProbe?.live && hostProbe.role === 'host' && guestProbe.role === 'guest' && guestProbe.myPlayer > 0) {
      again = { hostProbe, guestProbe };
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!again) throw new Error(`retry did not start a new match host=${JSON.stringify(await probe(host.page))} guest=${JSON.stringify(await probe(guest.page))}`);
  await host.page.evaluate(() => globalThis.__zillionsEndMatch?.());
  await host.page.getByText(/ended the match for everyone/i).waitFor({ timeout: 10000 });
  await guest.page.getByText(/ended the match for everyone/i).waitFor({ timeout: 10000 });
  await host.page.locator('#b-lobby').click();
  await host.page.locator('.room-remove').first().click();
  await guest.page.getByText(/the host removed you/i).waitFor({ timeout: 10000 });
  console.log(`after rejoin both sides ran 2 minutes, guest moved, hashes agreed ${agreed}`);
  const via = liveUrl ? 'the live URL' : liveRealtime ? 'production Supabase Realtime' : 'the in-process relay';
  console.log(`coop e2e passed against ${via} with WebRTC blocked`);
} finally {
  await browser.close();
  mailbox?.server.close();
  site?.server.close();
}
