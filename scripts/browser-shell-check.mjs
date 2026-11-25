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
  '--window-size=1440,1000', '--autoplay-policy=no-user-gesture-required',
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
  assert.equal(await evaluate(`(async () => {
    const app = window.__app;
    document.querySelector('#a-offline').click();
    await app._saveChapter({name:'Journey Chapter',color:'cobalt',emblem:'star'});
    const founderScreen = !document.querySelector('#screen-character-create').classList.contains('hidden');
    document.querySelector('#creator-cancel').click();
    const canResumeFounder = [...document.querySelectorAll('#character-list button')].some(b=>b.textContent==='CREATE YOUR FOUNDER');
    app.ui.showCharacterCreator();
    await app._createMmoCharacter({name:'Journey Test',appearance:'iron',raceKey:'human'});
    const selected = !document.querySelector('#screen-main').classList.contains('hidden');
    document.querySelector('#chapter-next').click();
    const choices=[...document.querySelectorAll('#herorow .herocard')].filter(c=>!c.classList.contains('hidden'));
    return founderScreen && canResumeFounder && selected && !document.querySelector('#screen-setup').classList.contains('hidden') && choices.length===1 && choices[0].querySelector('b').textContent==='Journey Test' && !app.ow && !app.owMap;
  })()`), true, 'new account creates a chapter and founder, then deploys straight to its first conquest');
  await evaluate("window.__app.ui._showScreen('character-create')");
  for (const [width, height] of [[390, 844], [844, 390], [1366, 768]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const creatorBounds = await evaluate(`(() => {
      const form = document.querySelector('.creator-form').getBoundingClientRect();
      return form.width > 0 && [...document.querySelectorAll('.creator-preview, .creator-controls, .creator-form fieldset, .creator-race, .creator-actions button')]
        .every(e => { const r = e.getBoundingClientRect(); return !r.width || (r.left >= form.left - 1 && r.right <= form.right + 1); });
    })()`);
    assert.equal(creatorBounds, true, `founder controls remain inside the form at ${width}px`);
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const recruitmentCopy = await evaluate(`(() => {
    const app = window.__app, original = app.profile.chapter.culture;
    const copy = {};
    for (const culture of ['coalition', 'human']) {
      app.profile.chapter.culture = culture;
      app.ui.setProfile(app.profile);
      copy[culture] = document.querySelector('#chapter-objective p').textContent;
    }
    app.profile.chapter.culture = original; app.ui.setProfile(app.profile);
    return copy;
  })()`);
  assert.match(recruitmentCopy.coalition, /Sniper/, 'Greenfall advertises its exploration recruit');
  assert.match(recruitmentCopy.coalition, /Lina/, 'Greenfall advertises its academy recruit');
  assert.match(recruitmentCopy.human, /Lina/, 'human chapters still see their academy recruit');
  assert.doesNotMatch(recruitmentCopy.human, /Sniper/, 'human chapters are not promised a restricted recruit');
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
      const controls = [...document.querySelectorAll('#character-list, .character-roster > button, .character-footer')].map(e => e.getBoundingClientRect());
      return JSON.stringify({ overlap: controls.some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top),
        guide: { left:a.left,right:a.right,top:a.top,bottom:a.bottom } });
    })()`));
    assert.equal(geometry.overlap, false, `first-hour guide overlaps usable controls at ${viewport.width}x${viewport.height}: ${JSON.stringify(geometry)}`);
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate(`(() => {
    const app=window.__app; app.ui.setProfile(app.profile); app.ui._showScreen('main');
    const noShoppingGate=document.querySelector('#first-hour-guide').classList.contains('hidden');
    document.querySelector('#chapter-services [data-service="shop"]').click();
    const armoryOpen=!document.querySelector('#screen-character-sheet').classList.contains('hidden') && document.querySelector('#sheet-tab-shop').classList.contains('sel');
    document.querySelector('#sheet-close').click();
    return noShoppingGate && armoryOpen && !document.querySelector('#chapter-next').disabled;
  })()`), true, 'chapter permits immediate deployment and optional quartermaster access');
  assert.equal(await evaluate(`(() => {
    const app = window.__app;
    const noWorld = !document.querySelector('[id^="ow-"]') && !document.querySelector('#living-world-map') && !document.querySelector('#screen-world-menu');
    const characterCustom = !!document.querySelector('#m-custom');
    app.ui._showScreen('main');
    app.ui._showScreen('help');
    document.querySelector('#h-back').click();
    return noWorld && characterCustom && !document.querySelector('#screen-main').classList.contains('hidden');
  })()`), true, 'the living world is gone: no overworld HUD or world map, Custom Games stays on Character Select, and Help closes back to it');
  assert.equal(await evaluate(`(() => {
    const app = window.__app;
    app.ui._customFrom = 'main';
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
    const app = window.__app;
    app.ui._showScreen('main');
    app._renderCharacterPreview(0);
    const preview = app.characterPreviews.get('roster-preview-canvas');
    const canvas = document.querySelector('#roster-preview-canvas');
    const name = document.querySelector('#character-name');
    const model = preview?.model;
    return !!model && model.userData.visualState?.role === 'frontline'
      && preview.renderer.info.render.calls > 0 && canvas.clientWidth >= 100 && canvas.clientHeight >= 100
      && !canvas.classList.contains('hidden') && name.textContent.includes('Journey Test')
      && !document.querySelector('#m-enter-world').disabled;
  })()`), true, 'Character Select must render the selected gameplay model with its name and usable Deploy action');
  // Deployment and navigation must be visible, not merely free of overflow.
  for (const [width, height] of [[390, 844], [844, 390], [1200, 655]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate(`(() => {
      window.__app.ui._showScreen('main');
      const screen = document.querySelector('#screen-main');
      screen.scrollTop = 0;
      return ['#chapter-map', '#chapter-next'].every(selector => {
        const button = document.querySelector(selector), r = button.getBoundingClientRect();
        return !button.disabled && r.width > 30 && r.height >= 28 && r.top >= 0
          && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
      });
    })()`), true, `Chapter map and primary deployment must fit above the fold at ${width}x${height}`);
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
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
  assert.equal(await evaluate(`(async () => {
    const {Game}=await import('/src/game.js');
    const {TerrainField}=await import('/src/terrain.js');
    const {levelById}=await import('/src/config.js');
    const level=levelById(1),map=new TerrainField(level.seed,level.theme,{size:level.size,nests:level.nests});
    const game=new Game(map,'normal','lina',null,1);
    const ui=window.__app.ui;
    ui.initHUD(game,0,{name:'Wrong founder',classKey:'vanguard',proxyHero:'scott'});
    const correctName=document.querySelector('#a-name').textContent==='Lina';
    ui.update(game,0,{controlMode:'fight'});
    ui._renderAbilitiesOverview({classKey:'arcanist',proxyHero:'lina'});
    const sheet=document.querySelector('#sheet-panel-abilities').textContent;
    return correctName && ['Dragon Slave','Light Strike Array','Laguna Blade','Fiery Soul'].every(name=>sheet.includes(name)) && !sheet.includes('Unassigned');
  })()`), true, 'battle identity must match the actual hero and the ability sheet must show its complete core kit');
  // Check actual spell buttons, not just the command bar's bounding box.
  for (const [width,height] of [[1366,768],[390,844],[844,390]]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    const bounds=await evaluate(`(async()=>{
      const {Game}=await import('/src/game.js'),{TerrainField}=await import('/src/terrain.js'),{levelById}=await import('/src/config.js');
      const l=levelById(1),bad=[];
      for(const key of ['lina','sniper','axe','sven']) {
        const g=new Game(new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),'normal',key,null,1);g.foundCity(0);
        __app.ui.initHUD(g,0);__app.ui.update(g,0,{controlMode:'fight'});
        for(const e of document.querySelectorAll('#bigaction,#ability-slots button')) {
          const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight)bad.push({key,slot:e.dataset.abilitySlot,rect:r.toJSON()});
        }
      }
      return bad;
    })()`);
    assert.deepEqual(bounds,[],`spell controls must fit ${width}x${height}`);
  }
  // Campaign UI regressions: explicit replay selection and maximum earned-item pressure.
  assert.equal(await evaluate(`(() => {
    const ui=__app.ui;ui.setCampaign(5);ui.showSetup({mode:'campaign',level:1});
    const explicit=ui.selectedLevel===1 && document.querySelector('[data-level="1"]').classList.contains('sel');
    ui.setCampaign(0);ui.showSetup({mode:'campaign',level:5});
    return explicit && ui.selectedLevel===1;
  })()`),true,'a clicked held city survives setup; a locked requested city cannot launch');
  for(const [width,height] of [[1366,768],[390,844],[844,390]]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<800});
    const result=await evaluate(`(async()=>{
      const {Game}=await import('/src/game.js'),{TerrainField}=await import('/src/terrain.js'),{ITEMS}=await import('/src/config.js');
      const g=new Game(new TerrainField(),'normal','scott',null,1),h=g.heroes[0],ui=__app.ui;
      h.items=Object.keys(ITEMS).filter(k=>!ITEMS[k].slot).slice(0,15);h.pack=h.items.slice(0,4);h.skillPoints=3;
      ui.hideOverlay();ui.initHUD(g,0);ui._itemsKey=null;ui._packKey=null;ui.update(g,0,{controlMode:'fight'});
      const pack=document.querySelector('.pack-open'),r=pack.getBoundingClientRect();
      const reachable=r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;
      pack.click();ui.update(g,0,{controlMode:'fight'});
      const opened=!document.querySelector('#battle-details').classList.contains('hidden')&&document.querySelector('#battle-details').textContent.includes('Automatic signature bonuses');
      return reachable&&opened;
    })()`);
    assert.equal(result,true,`earned items retain a reachable Pack at ${width}x${height}`);
  }
  // Runs last: showEnd replaces the overlay markup, as a finished match does.
  assert.equal(await evaluate(`(() => {
    const ui = window.__app.ui;
    const stats = { kills: 10, built: 2, lost: 0, coins: 50, nests: 0, nodes: 0, bestHeld: 0, heroDeaths: 0, bossKillT: null };
    ui.showEnd(true, stats, 3, 1, 'campaign', 0, { heroName: 'Journey Test', level: 1, pending: true, grants: [], quests: [] }, null);
    const pending = /Reporting the siege/.test(document.querySelector('#end-rewards').textContent) && document.querySelector('#end-unlock').classList.contains('hidden');
    ui.setEndRewards({ heroName: 'Journey Test', level: 2, xp: 300, levels: [2], alloy: 12, grants: ['targeting_optic'], skipped: [{ key: 'x', reason: 'stash_full' }],
      saved:true,campaignCleared:1, quests: [{ id: 'l1q1', name: 'First Blood', desc: 'Slay 150', reward: 'targeting_optic', done: true }], pending: false });
    const text = document.querySelector('#end-rewards').textContent;
    const granted = !document.querySelector('#end-unlock').classList.contains('hidden') && /level 2/.test(text) && text.includes('+300 XP') && text.includes('+12') && /First Blood/.test(text) && /Stash full/.test(text) && !/Reporting/.test(text);
    ui.setEndRewards({ pending: false, error: 'Command rejected this report (level_locked). No rewards were granted.', grants: [], quests: [] });
    const rejected = document.querySelector('#end-unlock').classList.contains('hidden') && /No rewards were granted/.test(document.querySelector('#end-rewards').textContent);
    const back = document.querySelector('#b-restart').textContent === 'Return to missions';
    return pending && granted && rejected && back;
  })()`), true, 'the end screen must show pending, then exactly the server-granted rewards (or the rejection)');
  assert.equal(await evaluate(`(async () => {
    const {HitFeedback}=await import('/src/hit-feedback.js');
    const feedback=new HitFeedback(__app.scene);
    for(let i=0;i<40;i++)feedback.show({heroKey:'lina',tx:20,tz:20,damage:57,crit:!!(i%2)});
    const capped=feedback.active.length===24;
    feedback.update(.1,()=>false);const fogCleared=feedback.active.length===0;
    feedback.show({heroKey:'lina',tx:20,tz:20,damage:57,crit:true});feedback.update(.7);
    return capped && fogCleared && feedback.active.length===0;
  })()`),true,'hit labels stay bounded, disappear under fog and expire');
  assert.equal(await evaluate(`(async () => {
    const app=__app;app.renderer.setAnimationLoop(null);
    const {AudioSys}=await import('/src/audio.js');const audio=new AudioSys();
    audio.setMuted(true);audio.setVolume(.4);audio.setMusicVolume(.3);audio.init();
    if(audio.master.gain.value!==0)return false;
    audio.setMuted(false);audio.updateScene({});
    const wait=async(fn)=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('audio timeout');};
    await wait(()=>audio.beds.slots.music?.id==='menu');
    const settings=Math.abs(audio.master.gain.value-.22)<.0001 && Math.abs(audio.beds.output.gain.value-.3)<.0001 && audio.musicGain.gain.value===0;
    const realFetch=window.fetch;
    try {
      window.fetch=async(url,...args)=>{
        if(String(url).endsWith('music/select.ogg'))throw Error('intentional missing-track fixture');
        if(String(url).endsWith('music/build.ogg'))await new Promise(r=>setTimeout(r,500));
        return realFetch(url,...args);
      };
      audio.updateScene({select:true});await wait(()=>audio.beds.failed.has('music/select'));
      const fallback=audio.musicGain.gain.value>0;
      audio.updateScene({inMatch:true,phase:'found',biome:'fen'});audio.updateScene({});
      await wait(()=>audio.beds.buffers.has('music/build'));
      return settings && fallback && audio.beds.slots.music.id==='menu' && audio.beds.slots.ambient===null;
    } finally {window.fetch=realFetch;audio.beds.dispose();clearInterval(audio.musicTimer);await audio.ctx.close();}
  })()`),true,'real audio settings, missing-file fallback and stale-load protection');
  assert.equal(await evaluate(`(async () => {
    const {AudioSys}=await import('/src/audio.js');
    async function render(muted=false,crit=false,calls=1) {
      const audio=new AudioSys();audio.ctx=new OfflineAudioContext(1,24000,48000);
      audio.master=audio.ctx.createGain();audio.master.connect(audio.ctx.destination);audio.setMuted(muted);
      for(let i=0;i<calls;i++)audio.hitConfirm(crit);
      const buffer=await audio.ctx.startRendering();
      return buffer.getChannelData(0).reduce((sum,sample)=>sum+sample*sample,0);
    }
    const normal=await render(),critical=await render(false,true),silent=await render(true),burst=await render(false,false,100);
    return normal>0 && critical>normal && silent===0 && burst===normal;
  })()`),true,'rendered hit confirmation obeys mute and bounds catch-up bursts');
  // Exercise the real HUD callback -> App.issue -> simulation boundary.
  assert.equal(await evaluate(`(async () => {
    const app=__app,{Game}=await import('/src/game.js'),{TerrainField}=await import('/src/terrain.js'),{levelById}=await import('/src/config.js');
    const level=levelById(1),g=new Game(new TerrainField(level.seed,level.theme,{size:level.size,nests:level.nests}),'normal','scott',null,1);
    g.foundCity(0);app.game=g;app.missionIntro=null;app.netMode=false;app.mpRole=null;
    app.ui.initHUD(g,0);app.ui.update(g,0);
    for(const stance of ['guard','attack','defend']) {
      const button=document.querySelector('[data-st="'+stance+'"]');
      if(button.tagName!=='BUTTON')return false;
      button.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));
      if(app.keys.has(' '))return false; // native activation cannot also hold Build/Dodge
      button.click();app.ui.update(g,0);
      if(g.stance!==stance||button.getAttribute('aria-pressed')!=='true')return false;
    }
    app.issue({t:'stance',s:'guard',p:0});g.hq.hp=g.hq.maxHp*.2;app.ui.update(g,0);
    const recall=document.querySelector('#recall-army');recall.focus();
    g.hq.hp-=1;app.ui.update(g,0);
    if(document.activeElement!==recall)return false; // live HP updates preserve the actionable button
    recall.click();if(g.stance!=='defend')return false;
    app.mpRole='spectator';document.querySelector('[data-st="attack"]').click();
    const readonly=g.stance==='defend';app.mpRole=null;
    const {freshCoach,coachApply}=await import('/src/first-run.js');
    app._coach=coachApply(freshCoach(),[{type:'move'},{type:'founded'},{type:'built'},
      {type:'stance',stance:'defend'},{type:'attack'},{type:'firstsiege'}]);
    g.stance='attack';g.events.length=0;
    document.querySelector('[data-st="attack"]').click();app._consumeEvents();
    const confirmed=app._coach===null;
    app.game=null;
    return readonly && confirmed;
  })()`),true,'army buttons dispatch orders, preserve focus under damage and respect spectator read-only mode');
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
