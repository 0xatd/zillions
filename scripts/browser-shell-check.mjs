import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
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
  '--window-size=1440,1000',
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
  const command = (method, params = {}) => new Promise((resolve) => {
    const requestId = ++id;
    pending.set(requestId, resolve);
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  socket.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }));
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
  });
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
    const selected = !document.querySelector('#screen-main').classList.contains('hidden');
    document.querySelector('#m-enter-world').click();
    return selected && app.ui.shell.base === 'overworld' && app.ui.overlayHidden() && app.ow?.world?.id === 'earth';
  })()`), true, 'new account must create a character, return to Character Select, and enter Earth');
  await evaluate(`(() => {
    const app = window.__app;
    const character = app.profile.mmoCharacters[0];
    character.firstHourGuideDismissed = false;
    character.items = [];
    character.equipment = {};
    app.ui.setProfile(app.profile);
    app.ui._showScreen('main');
  })()`);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 900, height: 800 }, { width: 700, height: 900 }]) {
    await command('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: viewport.width < 800 });
    await delay(80);
    const geometry = JSON.parse(await evaluate(`(() => {
      const a = document.querySelector('#first-hour-guide').getBoundingClientRect();
      const b = document.querySelector('.character-roster').getBoundingClientRect();
      return JSON.stringify({ overlap: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
        guide: { left:a.left,right:a.right,top:a.top,bottom:a.bottom }, roster: { left:b.left,right:b.right,top:b.top,bottom:b.bottom } });
    })()`));
    assert.equal(geometry.overlap, false, `first-hour guide overlaps roster at ${viewport.width}x${viewport.height}: ${JSON.stringify(geometry)}`);
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate(`(() => {
    const app = window.__app;
    const character = app.profile.mmoCharacters[0];
    const originalDirty = app.ui.cb.onProfileDirty;
    const originalAuthority = app.ui.cb.useAuthoritativeEconomy;
    const originalCampaign = app.ui.cb.onCampaignMap;
    const original = {
      items: structuredClone(character.items),
      equipment: structuredClone(character.equipment),
      hadDismissal: Object.prototype.hasOwnProperty.call(character, 'firstHourGuideDismissed'),
      dismissal: character.firstHourGuideDismissed,
    };
    let result = false;
    try {
      character.firstHourGuideDismissed = false;
      character.items = [];
      character.equipment = {};
      app.ui.setProfile(app.profile);
      app.ui._showScreen('main');
      const guide = document.querySelector('#first-hour-guide');
      const action = guide.querySelector('[data-guide-action]');
      const skip = guide.querySelector('[data-guide-skip]');
      let campaignOpened = 0;
      app.ui.cb.onCampaignMap = () => { campaignOpened++; };
      const offlineWired = !guide.classList.contains('hidden') && action?.textContent === 'ENTER WORLD'
        && /sign in/i.test(guide.textContent) && !!skip;
      action.click();
      const offlineRouted = campaignOpened === 1;
      app.ui.cb.useAuthoritativeEconomy = () => true;
      app.ui._showScreen('main');
      app.ui.setProfile(app.profile);
      const onlineAction = document.querySelector('#first-hour-guide [data-guide-action]');
      const onlineWired = onlineAction?.textContent === 'OPEN MARKET';
      onlineAction.click();
      const routed = !document.querySelector('#screen-character-sheet').classList.contains('hidden')
        && document.querySelector('#sheet-tab-shop').classList.contains('sel');
      let dirtied = 0;
      app.ui.cb.onProfileDirty = () => { dirtied++; };
      app.ui._showScreen('main');
      app.ui.setProfile(app.profile);
      document.querySelector('#first-hour-guide [data-guide-skip]').click();
      const skipped = character.firstHourGuideDismissed === true
        && document.querySelector('#first-hour-guide').classList.contains('hidden') && dirtied === 1;
      result = offlineWired && offlineRouted && onlineWired && routed && skipped;
    } finally {
      app.ui.cb.onProfileDirty = originalDirty;
      app.ui.cb.useAuthoritativeEconomy = originalAuthority;
      app.ui.cb.onCampaignMap = originalCampaign;
      character.items = original.items;
      character.equipment = original.equipment;
      if (original.hadDismissal) character.firstHourGuideDismissed = original.dismissal;
      else delete character.firstHourGuideDismissed;
      app.ui.setProfile(app.profile);
      if (!original.hadDismissal) delete character.firstHourGuideDismissed;
      app.ui.hideOverlay();
    }
    return result;
  })()`), true, 'first-deployment guide must route offline players to a mission, signed-in players to Market, and persist its per-character skip');
  assert.equal(await evaluate(`(() => {
    const app = window.__app;
    const noCustom = !document.querySelector('#ow-custom-quick') && !document.querySelector('#ow-custom');
    const characterCustom = !!document.querySelector('#m-custom');
    const party = document.querySelector('#ow-party');
    const map = document.querySelector('#ow-map');
    map.click();
    const mapOpened = !document.querySelector('#living-world-map').classList.contains('hidden');
    document.querySelector('#lw-close').click();
    return noCustom && characterCustom && !!party && !!map && mapOpened;
  })()`), true, 'the overworld HUD must expose Party and World Map while Custom Games remains character-menu only');
  assert.equal(await evaluate(`(() => {
    const app = window.__app;
    const gate = app.owMap.overworldLayout.gates.find((entry) => !entry.portal && entry.levelId === 1);
    let launches = 0;
    let rallies = 0;
    app._launchGateMission = () => { launches++; };
    app._joinGateRally = () => { rallies++; };
    app._onOverworldEvent({ t: 'gate', gate, state: { locked: false, cleared: false } });
    document.querySelector('#gate-go').click();
    return launches === 1 && rallies === 0 && document.querySelector('#gate-confirm').classList.contains('hidden');
  })()`), true, 'ENTER MISSION must launch the selected map in one click instead of silently creating a rally');
  assert.equal(await evaluate(`(() => {
    const app = window.__app;
    app.ui._showScreen('help');
    document.querySelector('#h-back').click();
    return app.ui.shell.base === 'overworld' && app.ui.overlayHidden();
  })()`), true, 'Help must close back to the overworld');
  assert.equal(await evaluate(`(() => {
    const app = window.__app;
    app.ui._customFrom = 'world-menu';
    app.ui.showCustomBrowser({ games: [], offline: true, hostName: 'journey' });
    app.ui._showScreen('custom');
    const live = [...document.querySelectorAll('.custom-primary-tab')].find((button) => button.dataset.view === 'live');
    const arcade = [...document.querySelectorAll('.custom-primary-tab')].find((button) => button.dataset.view === 'arcade');
    const liveEmpty = document.querySelector('#cu-note').textContent.includes('Offline');
    arcade.click();
    const maps = document.querySelectorAll('.custom-map-row');
    maps[0].click();
    const playable = !document.querySelector('#cu-join').disabled && document.querySelector('#cu-join').textContent === 'PLAY NOW';
    document.querySelector('#cu-join').click();
    return !!live && liveEmpty && maps.length >= 6 && playable && !document.querySelector('#screen-setup').classList.contains('hidden');
  })()`), true, 'Custom Games must separate live rooms from a playable Arcade catalog');
  assert.equal(await evaluate(`(() => {
    const avatar = document.querySelector('#character-avatar');
    const loadout = document.querySelectorAll('#character-loadout span');
    return !!avatar && avatar.dataset.class === 'vanguard'
      && document.querySelectorAll('#character-avatar .avatar-body > span').length >= 7
      && loadout.length === 4;
  })()`), true, 'Character Select must stage a full character silhouette and visible loadout, not only a class icon');
  assert.equal(await evaluate(`(() => {
    const ui = window.__app.ui;
    const room = { join_code: 'ABC123', visibility: 'public', mode: 'campaign', level: 1, difficulty: 'normal', max_players: 4 };
    const players = [
      { seat: 1, name: 'Host', host: true, hero: 'scott', state: 'connected', ready: true },
      { seat: 2, name: 'Journey Test', you: true, hero: 'maya', state: 'connected', ready: false },
    ];
    ui.showSetup({ online: room, mode: 'campaign' });
    ui.setRoomSettings({ level: 1, difficulty: 'normal', isHost: false, mode: 'campaign' });
    ui.roomRoster(players, { maxPlayers: 4, isHost: false, code: room.join_code, mode: room.mode, level: room.level, difficulty: room.difficulty });
    ui.setRoomReady({ visible: true, ready: false });
    const guestLocked = [...document.querySelectorAll('#levelrow .levelcard')].every((node) => node.disabled)
      && [...document.querySelectorAll('#diffseg .diffbtn')].every((node) => node.disabled);
    const guestState = document.querySelector('#screen-setup').classList.contains('room-guest')
      && document.querySelectorAll('.roomslot').length === 4
      && !document.querySelector('#room-ready').classList.contains('hidden')
      && !!document.querySelector('.room-commandbar')
      && !!document.querySelector('#roomchat-input');
    ui.setRoomSettings({ level: 1, difficulty: 'normal', isHost: true, mode: 'campaign' });
    const hostEditable = [...document.querySelectorAll('#diffseg .diffbtn')].some((node) => !node.disabled)
      && document.querySelector('#screen-setup').classList.contains('room-host');
    return guestLocked && guestState && hostEditable;
  })()`), true, 'Staging lobby must expose four seats, chat, guest-ready state, and host-only room controls');
  assert.equal(await evaluate(`(() => {
    const ui = window.__app.ui;
    const original = ui.cb.onStart;
    let launches = 0;
    try {
      ui.cb.onStart = () => { launches++; };
      ui._startActivated = false;
      ui.showRoomCountdown(0);
      const disabled = document.querySelector('#s-start').disabled;
      ui.activateStart();
      ui.activateStart();
      return disabled && launches === 1;
    } finally {
      ui.cb.onStart = original;
      ui._startActivated = false;
    }
  })()`), true, 'Countdown completion must launch once even though its presentation button remains disabled');
  assert.equal(await evaluate(`(() => {
    const ui = window.__app.ui;
    ui.showLocationBanner(
      'OLD CROSSROADS',
      'Open ground on every side. Everything can reach you — and you can reach everything.',
      10000,
    );
    const banner = document.querySelector('#banner');
    const title = banner.querySelector('.banner-title');
    const detail = banner.querySelector('.banner-detail');
    const titleBox = title?.getBoundingClientRect();
    const detailBox = detail?.getBoundingClientRect();
    const bannerBox = banner.getBoundingClientRect();
    return window.innerWidth === 1440 && window.innerHeight === 1000
      && !!titleBox && !!detailBox
      && titleBox.bottom + 6 <= detailBox.top
      && bannerBox.left >= 12 && bannerBox.right <= window.innerWidth - 12
      && bannerBox.bottom <= window.innerHeight - 12;
  })()`), true, 'mission location title and description must remain separate, legible lines at 1440x1000');
  const heroMetrics = async (race, classKey, parts, equipment = {}) => evaluate(`(() => {
    window.__app.ui._showCharacterCreator();
    window.__app._setCharacterPreview({ raceKey: ${JSON.stringify(race)}, classKey: ${JSON.stringify(classKey)},
      appearance: 'cobalt', customization: ${JSON.stringify(parts)}, equipment: ${JSON.stringify(equipment)},
      proxyHero: 'scott', canvasId: 'creator-preview-canvas' });
    const model = window.__app.characterPreviews.get('creator-preview-canvas').model;
    let meshes = 0, triangles = 0;
    model.traverse((node) => {
      if (!node.isMesh || !node.visible) return;
      meshes++;
      triangles += (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3;
    });
    return { meshes, triangles, state: model.userData.visualState };
  })()`);
  const humanMetrics = await heroMetrics('human', 'vanguard',
    { face: 'veteran', body: 'heavy', head: 'hooded', legs: 'armored' },
    { head: 'sentinel_helm:1:35:3', chest: 'powered_shell:2:45:3', hands: 'siege_gauntlets:3:35:3', legs: 'bulwark_greaves:4:40:3', boots: 'phase_boots:5:35:3' });
  const robotMetrics = await heroMetrics('robot', 'arcanist',
    { face: 'tri-eye', body: 'bulwark', head: 'crest', legs: 'heavy' },
    { head: 'sentinel_helm:1:35:3', chest: 'powered_shell:2:45:3', hands: 'siege_gauntlets:3:35:3', legs: 'bulwark_greaves:4:40:3', boots: 'phase_boots:5:35:3' });
  assert.equal(humanMetrics.state.race, 'human');
  assert.equal(humanMetrics.state.role, 'frontline');
  assert.equal(robotMetrics.state.race, 'robot');
  assert.equal(robotMetrics.state.role, 'signal');
  assert.equal(robotMetrics.state.gearInfo.chest.rarity, 3, 'rolled Prime chest rarity must reach the renderer');
  for (const metrics of [humanMetrics, robotMetrics]) {
    assert.ok(metrics.triangles <= 8000, `procedural hero exceeded 8,000 triangle budget: ${metrics.triangles}`);
    assert.ok(metrics.meshes <= 70, `procedural hero exceeded 70-mesh fallback budget: ${metrics.meshes}`);
  }
  if (process.env.ZILLIONS_VISUAL_QA_DIR) {
    const capture = async (name, race, parts, equipment = {}, angle = 0) => {
      await evaluate(`(() => {
        const ui = window.__app.ui;
        ui._showCharacterCreator();
        const wanted = ${JSON.stringify(parts)};
        ui._creatorRace = ${JSON.stringify(race)};
        ui._creatorParts = wanted;
        for (const [index, node] of document.querySelectorAll('#creator-races button').entries()) node.classList.toggle('sel', index === ${race === 'robot' ? 1 : 0});
        ui._buildCreatorParts();
        ui._renderCreatorSummary();
        window.__app._setCharacterPreview({ raceKey: ${JSON.stringify(race)}, classKey: 'vanguard', appearance: 'cobalt', customization: wanted,
          equipment: ${JSON.stringify(equipment)}, proxyHero: 'scott', canvasId: 'creator-preview-canvas' });
        window.__app.characterPreviews.get('creator-preview-canvas').model.rotation.y = ${angle};
        document.querySelector('#character-create-form').scrollIntoView({ block: 'start' });
        return true;
      })()`);
      await delay(180);
      const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(join(process.env.ZILLIONS_VISUAL_QA_DIR, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
    };
    for (const face of ['sentinel', 'ranger', 'veteran', 'nomad']) await capture(`human-face-${face}`, 'human', { face, body: 'standard', head: 'cropped', legs: 'field' });
    for (const face of ['optic', 'visor', 'tri-eye', 'faceless']) await capture(`robot-face-${face}`, 'robot', { face, body: 'warden', head: 'smooth', legs: 'biped' });
    await capture('human-light-scout-no-gear', 'human', { face: 'ranger', body: 'light', head: 'swept', legs: 'scout' }, {}, -.3);
    await capture('human-heavy-armored-no-gear', 'human', { face: 'veteran', body: 'heavy', head: 'hooded', legs: 'armored' }, {}, -.3);
    await capture('robot-strider-reverse-joint-no-gear', 'robot', { face: 'optic', body: 'strider', head: 'antenna', legs: 'reverse-joint' }, {}, -.3);
    await capture('robot-bulwark-heavy-full-gear', 'robot', { face: 'tri-eye', body: 'bulwark', head: 'crest', legs: 'heavy' }, {
      head: 'sentinel_helm', chest: 'powered_shell', hands: 'siege_gauntlets', legs: 'bulwark_greaves', boots: 'phase_boots',
    }, -.3);
  }
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
