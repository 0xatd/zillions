// Rendering, input and orchestration — Thronefall-style direct hero control.
import * as THREE from 'three';
import {
  PLOT_KINDS, SIM_DT, MAP_SIZE, LEVELS, levelById, PAY_RADIUS, THREAT, SIEGE, TOWER_PRIORITY,
  ITEMS, BOSS_DROPS, UNITS, TILE,
} from './config.js';
import { GameMap } from './map.js';
import { surveySite } from './plots.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { AudioSys } from './audio.js';
import { loadAssets, assetClone } from './assets.js';
import { NetSession } from './net.js';
import { OnlineLobby, LORE, TIPS, canRejoinRoom } from './online.js';
import { AuthClient } from './auth.js';
import { clamp, lerp } from './utils.js';
import { TacticalVisuals } from './tactical-visuals.js';
import { roomConnectionReadiness } from './multiplayer-readiness.js';

const ZMAX = 1700;
const NET_STEP = 2;          // one lockstep command window every 2 sim ticks (~66ms)
const NET_GUEST_BUFFER = 2;  // windows a guest keeps banked before it will run
const NET_REDUNDANCY = 3;    // past windows repeated in every window packet
const NET_PACE_SLOW = 0.94;  // guest sim rate when the bank is running dry
const NET_PACE_FAST = 1.06;  // guest sim rate when the bank is overfull

class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 600);
    this.tacticalVisuals = new TacticalVisuals(this.renderer, this.scene, this.camera);
    this.focus = new THREE.Vector3(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    this.camDist = 30;
    this.camYaw = 0;
    this.menuYaw = Math.PI * 0.25;
    this.shake = 0;

    this.speed = 1;
    this.paused = true;        // starts paused behind the menu
    this.acc = 0;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, gx: 0, gz: 0 };
    this.lastDir = { x: 0, z: 0, s: false };
    this.controlMode = 'build'; // Alt toggles whether Space builds or fires the special.
    this.buttonPay = false;     // command-bar build button held state
    this.lastPay = false;       // build pay held state, mirrored into the sim
    this.payCoins = [];         // arcing purse-coins in flight (Thronefall build FX)
    this.projectiles = [];      // visible bullets/bolts/globs, slower than damage
    this.abilityFx = [];        // presentation-only hero ability telegraphs/shockwaves
    this.zombieAttacks = new Map();
    this.payTickT = 0;

    this.audio = new AudioSys();
    this.ui = new UI(document.getElementById('ui'), {
      onStart: (d, hero) => {
        if (this.mpRole === 'guest') return; // host launches the match
        const mode = this.ui.selectedMode || 'campaign';
        if (this.mpRole === 'host' && (this.peers.length || this.onlineMode)) {
          if (this.onlineMode && this.lobby?.game) {
            const readiness = roomConnectionReadiness(this.lobby.game, this.peers.length + 1);
            if (!readiness.ready) {
              this.ui.onlineStatus(`⏳ ${readiness.pending} player${readiness.pending === 1 ? '' : 's'} still connecting. START unlocks when everyone is linked.`);
              this._onRoomUpdate(this.lobby.game);
              return;
            }
          }
          const level = this.ui.selectedLevel || 1;
          const heroes = [{ k: hero, camp: this.campFor(hero) }, ...this.peers.map((_, i) => this.guestHeroes[i] || 'scott')];
          this.peers.forEach((p, i) => p.send({ t: 'start', d, heroes, you: i + 1, level, mode }));
          this.startGame(d, null, { heroes, myPlayer: 0, role: 'host', level, mode });
          if (this.lobby && this.lobby.game) this.lobby.touchGame({ status: 'playing' });
        } else {
          this.startGame(d, hero);
        }
      },
      onCast: () => this.tryCast(),
      onControlMode: () => this.toggleControlMode(),
      onBuildHold: (on) => { this.buttonPay = !!on; },
      onRally: (g) => { this.audio.init(); this.issue({ t: 'rally', g, p: this.myPlayer }); },
      onBranch: (id, b) => this.issue({ t: 'choose', id, b, p: this.myPlayer }),
      onSpeed: (s) => this.setSpeed(s),
      onMute: () => { this.audio.setMuted(!this.audio.muted); this.ui.setMuteUI(this.audio.muted); },
      onQuality: () => this.ui.setQualityUI(this.tacticalVisuals.toggleQuality()),
      onHost: () => this.hostGame(),
      onJoin: (code) => this.joinGame(code),
      onHostAccept: (code) => this.pendingPeer && this.pendingPeer.acceptReply(code).catch(() => this.ui.mpStatus('❌ Bad reply code.')),
      onAddPeer: () => this._newInvite(),
      onHeroPick: (k) => this._pickHero(k),
      onFound: () => this._tryFound(),
      onHeroUpgrade: (key) => this.issue({ t: 'heroUpgrade', key, p: this.myPlayer }),
      onStance: (s) => this.issue({ t: 'stance', s, p: this.myPlayer }),
      onRestart: () => location.reload(),
      onQuit: () => location.reload(),
      onPause: () => this.togglePauseMenu(),
      onResume: () => this.closePauseMenu(),
      onContinue: () => this.continueGame(),
      onSignIn: () => this._signIn(),
      onOfflineContinue: () => this.ui.setAccount({ ready: true, enabled: false, signedIn: false, reason: 'static', name: this.profile.name }),
      onUsername: (username) => this._claimUsername(username),
      onLobbyOpen: () => this._openLobby(),
      onChatSend: (text) => this._sendLobbyChat(text),
      onRoomChatSend: (text) => this._sendRoomChat(text, 'room'),
      onGameChatSend: (text) => this._sendGameChat(text),
      onAddFriend: (handle) => this._addFriend(handle),
      onAcceptFriend: (id) => this._acceptFriend(id),
      onRemoveFriend: (id) => this._removeFriend(id),
      onInviteFriend: (userId) => this._inviteFriend(userId),
      onCreateGame: (visibility) => this.createOnlineGame(visibility),
      onJoinCode: (code) => this.joinByCode(code),
      onLevelPick: (id) => this.showMenuBackdrop(id),
    });

    this._setupLights();
    this._setupParticles();
    this._setupZombieMeshes();
    this._setupCoins();
    this._setupBars();
    this._setupCorpses();
    this._setupInput();

    this.buildingMeshes = new Map();  // building id -> {mesh, b, spawnT}
    this.unitMeshes = new Map();
    this.plotMeshes = new Map();      // plot id -> {group, state fields}
    this.waveMarkers = [];

    // Co-op lockstep state (up to 3 players, host-sequenced star topology).
    this.myPlayer = 0;
    this.mpRole = null;
    this.net = null;
    this.peers = [];
    this.spectators = [];
    this.pendingSpectators = [];
    this.pendingPeer = null;
    this.guestHeroes = [];
    this.guestNames = [];
    this.guestCmdQueues = [];
    this.peerUserIds = [];    // online rooms: account id per peer slot, for reconnects
    this.netMode = false;
    this.outbox = [];
    this.simFrame = 0;
    this.inbox = new Map();
    this.hashes = { local: new Map() };
    this._recentWindows = []; // host: last few windows, resent for redundancy

    // Terrain readability: pulses + one-time warnings when a hero shoves
    // against impassable ground (lava, deep water, woods, crags).
    this.blockFx = [];
    this._blockT = 0;
    this._blockWarned = {};
    this.desynced = false;
    this.netPrimed = false;
    this.netStallT = 0;
    this.slowFrameT = 0;
    this.autoQualityDropped = false;

    // Profiles & saves. Production identity comes from Supabase; localStorage is only
    // a development/offline mirror.
    this.auth = new AuthClient();
    this.authStatus = { ready: false, enabled: false, signedIn: false };
    this.profile = this._loadProfile();
    this.autosaveT = 20;
    window.addEventListener('beforeunload', () => this._autosave(true));

    this.groanAcc = 0;
    this.deathSfxT = 0;
    this.bhitSfxT = 0;
    this.smokeT = 0;
    this.minimapT = 0;

    this.ui.setProfile(this.profile);
    this.ui.setQualityUI(this.tacticalVisuals.quality);
    this.ui.setAccount(this.authStatus);
    this.ui.setCampaign(this.profile.campaign || 0);
    if (this.profile.lastHero) this.ui.preselectHero(this.profile.lastHero);
    const save = this._loadSave();
    if (save) this.ui.setContinue(save.snap);
    this._initAuth();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.clock = new THREE.Clock();

    // WC3-style menu: the battlefield lives behind the buttons.
    this.showMenuBackdrop(this.ui.selectedLevel || 1);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------- menu backdrop ----------------

  showMenuBackdrop(levelId) {
    if (this.game) return;
    const level = levelById(levelId || 1);
    if (this.menuLevelId === level.id) return;
    this.menuLevelId = level.id;
    if (this.menuTerrain) { this.scene.remove(this.menuTerrain); this.menuTerrain = null; }
    const map = new GameMap(level.seed, level.theme);
    this.menuTerrain = map.buildTerrain();
    this.scene.add(this.menuTerrain);
  }

  // ---------------- game start ----------------

  async startGame(difficulty, heroKey, mp = null, snap = null) {
    this.audio.init();
    if (!this.assetsLoaded) {
      this.ui.showBanner('Loading…', '', 1500);
      await loadAssets();
      this.assetsLoaded = true;
    }
    if (this.menuTerrain) { this.scene.remove(this.menuTerrain); this.menuTerrain = null; this.menuLevelId = null; }
    const levelId = snap ? snap.level || 1 : mp ? mp.level || 1 : this.ui.selectedLevel || 1;
    const mode = snap ? snap.mode || 'campaign' : mp ? mp.mode || 'campaign' : this.ui.selectedMode || 'campaign';
    const level = levelById(levelId);
    const seed = snap ? snap.seed : level.seed;
    this.map = new GameMap(seed, level.theme, { size: level.size, nests: level.nests });
    this.pal = level.theme.palette; // drives sky/fog grading
    const heroKeys = snap ? snap.heroKeys : mp ? mp.heroes : { k: heroKey, camp: this.campFor(heroKey) };
    this.game = new Game(this.map, difficulty, heroKeys, snap, levelId, mode);
    this.slowFrameT = 0;
    this.autoQualityDropped = false;
    this._wallTiles = null; // wall adjacency cache is per-map
    for (const c of this.payCoins) this.scene.remove(c.mesh);
    this.payCoins = [];
    for (const p of this.projectiles) this._destroyProjectile(p);
    this.projectiles = [];
    this.zombieAttacks.clear();
    this.lastPay = false;
    this._endExtras = null;
    if (!snap && heroKey) { this.profile.lastHero = heroKey; this._saveProfile(); }
    this.myPlayer = mp ? mp.myPlayer : 0;
    this.netMode = !!mp;
    this._netPumpStop();
    if (this.netMode) {
      this.mpRole = mp.role;
      this.simFrame = 0;
      this.outbox = [];
      this.inbox = new Map();
      this.hashes = { local: new Map() };
      this.netPrimed = false;
      this.netStallT = 0;
      this.speed = 1;
      this.desynced = false;
      this._recentWindows = [];
      this._netClockLast = performance.now();
      // Co-op keeps the graphics the player chose. The sim pump below keeps
      // windows flowing even when the render loop hitches, so guests no
      // longer pay for the host's frame drops.
      this._netPumpStart();
      if (this.onlineMode && this.lobby) this.lobby.setMatchActive(true);
    }
    for (const f of this.blockFx) this.scene.remove(f.mesh);
    this.blockFx = [];
    this._blockT = 0;
    this._blockWarned = {};
    this.terrain = this.map.buildTerrain();
    this.scene.add(this.terrain);
    // The plaza and city appear where (and when) the city is founded.
    if (this.plaza) { this.scene.remove(this.plaza); this.plaza = null; }
    this._clearSiteMarkers();
    this._clearNestMeshes();
    this._clearLootMeshes();
    if (this.game.site >= 0) {
      const s = this.map.sites[this.game.site];
      this.plaza = this._buildPlaza(s.x, s.z);
      this.scene.add(this.plaza);
    } else {
      this._makeSiteMarkers();
      this._clearNodeMarkers();
    }
    this.map.drawMinimap(document.getElementById('minimap-base'));
    this.ui.hideStart();
    this.ui.initHUD(this.game, this.myPlayer);
    this.ui.setGameChatEnabled(this.netMode);
    if (this.netMode) this.ui.gameChatFill([]);
    this.setSpeed(1);
    // Gameplay uses a fixed world/minimap orientation: left in the viewport is
    // left on the minimap. The menu can orbit, but a run must not inherit it.
    this.camYaw = 0;
    this.lastDir = { x: 0, z: 0, s: false };
    this.ui.showBanner(mode === 'survival'
      ? `${level.name} — SURVIVAL. The siege never stops. A boss walks every fifth surge. How long can you last?`
      : `${level.name} — raze every hive, then break the counterattack. ${level.boss.icon} ${level.boss.name} leads it.`, '', 4500);
    const h = this.myHero();
    if (h) this.focus.set(h.x, 0, h.z);
    if (!this.profile.games && this.mpRole !== 'spectator') this._startTutorial();
  }

  // A cobbled plaza + a lane out to every gate this city actually has — the
  // city looks designed even before anything is built, and it looks like ITS
  // plan: a square fort gets a square plaza, a crescent gets two lanes, not
  // four. Falls back to a plain ring if the plan is not known yet.
  _buildPlaza(cx, cz) {
    const g = new THREE.Group();
    const hq = (this.game && this.game.plots || []).find((p) => p.kind === 'hq');
    const plan = hq && hq.plan;
    const squarePlaza = plan && plan.key === 'fort';
    const disc = new THREE.Mesh(
      squarePlaza ? new THREE.PlaneGeometry(12.6, 12.6) : new THREE.CircleGeometry(7.2, 40),
      new THREE.MeshLambertMaterial({ color: 0x565149 }),
    );
    disc.rotation.x = -Math.PI / 2;
    if (squarePlaza) disc.rotation.z = -plan.facing;
    disc.position.set(cx, 0.015, cz);
    disc.receiveShadow = true;
    g.add(disc);
    const laneMat = new THREE.MeshLambertMaterial({ color: 0x51504a });
    const lanes = plan && plan.gates.length ? plan.gates : [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    const len = plan ? Math.max(9, plan.reach - 4) : 10.5;
    for (const a of lanes) {
      const lane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, len), laneMat);
      lane.rotation.x = -Math.PI / 2;
      lane.rotation.z = -a;
      lane.position.set(cx + Math.cos(a) * (len / 2 + 4), 0.012, cz + Math.sin(a) * (len / 2 + 4));
      g.add(lane);
    }
    return g;
  }

  // ---------------- city sites & hive nests ----------------

  _makeSiteMarkers() {
    this.siteMarkers = [];
    for (let i = 0; i < this.map.sites.length; i++) {
      const s = this.map.sites[i];
      const gr = new THREE.Group();
      const ringGeo = new THREE.RingGeometry(5.4, 6.0, 48);
      ringGeo.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.5, depthWrite: false }));
      ring.position.set(s.x, 0.06, s.z);
      gr.add(ring);
      gr.userData.ring = ring;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 6), new THREE.MeshLambertMaterial({ color: 0x3a3228 }));
      pole.position.set(s.x, 2.5, s.z);
      gr.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.05), new THREE.MeshLambertMaterial({ color: 0xc9a44a }));
      flag.position.set(s.x + 0.85, 4.4, s.z);
      gr.add(flag);
      gr.userData.flag = flag;
      const label = this._makeLabelSprite('🏳️', (s.name || `SITE ${i + 1}`).toUpperCase());
      label.position.set(s.x, 6.3, s.z);
      label.scale.set(4.2, 2.1, 1);
      gr.add(label);
      this.scene.add(gr);
      this.siteMarkers.push(gr);
    }
  }

  _clearSiteMarkers() {
    for (const m of this.siteMarkers || []) this.scene.remove(m);
    this.siteMarkers = [];
    this._surveyed = null;
  }

  // Ride up to a flagged site and the ground tells you what it is. The three
  // sites on a map are different bargains — a shore with fewer ways in, a
  // crag shelf, ore inside the walls — so the player needs to be told which is
  // which before they commit the run to one.
  _surveySites() {
    if (!this.game || this.game.phase !== 'found') return;
    const h = this.myHero();
    if (!h || h.dead) return;
    this._surveyed = this._surveyed || new Set();
    this.map.sites.forEach((s, i) => {
      if (this._surveyed.has(i)) return;
      if ((h.x - s.x) ** 2 + (h.z - s.z) ** 2 > 10 * 10) return;
      this._surveyed.add(i);
      // Survey the ground the way a real siege engineer would: how much of the
      // wall line does the land itself already close?
      const survey = surveySite(this.map, s, { levelId: this.game.levelId, siteIdx: i });
      const pct = Math.round(survey.natural * 100);
      const wall = pct >= 45 ? `The land itself closes ${pct}% of the wall line — you build the gaps.`
        : pct >= 18 ? `Crag and wood close ${pct}% of the wall line; the rest you build.`
          : 'Open on nearly every side: you will be building the whole wall.';
      // The survey is the authoritative claim about this ground, so drop the
      // generic "open on every side" flavour when the wall line says otherwise.
      const hint = (s.kind === 'crossroads' && pct >= 30) ? '' : `${s.hint || ''} `;
      this.ui.showBanner(`🏳️ ${s.name || `Site ${i + 1}`} — ${hint}${wall}`,
        `A ${survey.plan.label} would stand here · SPACE to found the city`, 5600);
    });
  }

  _makeNestMesh(n) {
    const g = new THREE.Group();
    const mound = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), new THREE.MeshLambertMaterial({ color: 0x3a2a4a }));
    mound.scale.y = 0.55;
    mound.position.y = 0.4;
    mound.castShadow = true;
    g.add(mound);
    g.userData.mound = mound;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.3 + (i % 2) * 0.7, 5), new THREE.MeshLambertMaterial({ color: 0x2c2038 }));
      spike.position.set(Math.cos(a) * 1.5, 0.9, Math.sin(a) * 1.5);
      spike.rotation.z = Math.cos(a) * 0.5;
      spike.rotation.x = -Math.sin(a) * 0.5;
      spike.castShadow = true;
      g.add(spike);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 1.1;
      const blob = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6),
        new THREE.MeshLambertMaterial({ color: 0xb44dff, emissive: 0xb44dff, emissiveIntensity: 1.8 }));
      blob.position.set(Math.cos(a) * 1.1, 1.05, Math.sin(a) * 1.1);
      g.add(blob);
    }
    g.position.set(n.x, 0, n.z);
    return g;
  }

  _syncNests(t) {
    if (!this.game) return;
    this.nestMeshes = this.nestMeshes || new Map();
    for (const n of this.game.nests) {
      let mesh = this.nestMeshes.get(n.id);
      if (n.alive && !mesh) {
        mesh = this._makeNestMesh(n);
        this.scene.add(mesh);
        this.nestMeshes.set(n.id, mesh);
      } else if (!n.alive && mesh) {
        this.scene.remove(mesh);
        this.nestMeshes.delete(n.id);
      }
      if (mesh) {
        const beat = 1 + Math.sin(t * 2.2 + n.id * 2) * 0.05;
        mesh.userData.mound.scale.set(beat, 0.55 * beat, beat);
      }
    }
  }

  // Field loot: a small floating find with its own icon over it. Hidden caches
  // are not drawn at all — you have to walk near them to spot them.
  _syncLoot(t) {
    if (!this.game) return;
    this.lootMeshes = this.lootMeshes || new Map();
    const live = new Set();
    for (const l of this.game.loot) {
      if (l.hidden) continue;
      live.add(l.id);
      let mesh = this.lootMeshes.get(l.id);
      if (!mesh) {
        const it = ITEMS[l.key];
        mesh = new THREE.Group();
        const gem = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.34, 0),
          new THREE.MeshLambertMaterial({ color: 0xffd75e, emissive: 0xa8791a, emissiveIntensity: 0.6 }),
        );
        gem.castShadow = true;
        mesh.add(gem);
        mesh.userData.gem = gem;
        const label = this._makeLabelSprite(it ? it.icon : '📦', '');
        label.position.y = 1.5;
        label.scale.set(2.2, 1.1, 1);
        mesh.add(label);
        mesh.position.set(l.x, 0, l.z);
        this.scene.add(mesh);
        this.lootMeshes.set(l.id, mesh);
      }
      mesh.position.set(l.x, 0.55 + Math.sin(t * 2.4 + l.id) * 0.12, l.z);
      mesh.userData.gem.rotation.y = t * 1.4 + l.id;
    }
    for (const [id, mesh] of this.lootMeshes) {
      if (live.has(id)) continue;
      this.scene.remove(mesh);
      this.lootMeshes.delete(id);
    }
  }

  _clearLootMeshes() {
    for (const m of (this.lootMeshes || new Map()).values()) this.scene.remove(m);
    this.lootMeshes = new Map();
  }

  _clearNestMeshes() {
    for (const m of (this.nestMeshes || new Map()).values()) this.scene.remove(m);
    this.nestMeshes = new Map();
  }

  // Found the city at the nearest site — if the hero is standing on one.
  _tryFound() {
    const h = this.myHero();
    if (!h || h.dead || !this.game || this.game.phase !== 'found') return;
    let best = -1, bd = 8 * 8;
    this.map.sites.forEach((s, i) => {
      const d = (h.x - s.x) ** 2 + (h.z - s.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    if (best < 0) {
      this.ui.showBanner('🏳️ Ride to a marked site to found your city there.', '', 2200);
      this.audio.deny();
      return;
    }
    this.issue({ t: 'found', s: best, p: this.myPlayer });
  }

  _startTutorial() {
    const steps = [
      [1.5, '🕹️ WASD moves your hero. Hold SHIFT to sprint.'],
      [5, '🏳️ This land is unclaimed! Ride to a flagged site and press SPACE to found your city.'],
      [14, '💰 Walk to a glowing foundation and HOLD SPACE or B — your coins build it. ALT toggles Space between Build and Fight.'],
      [24, '⚔️ Every gate is a ward: towers to hold it and a camp to muster at it. Press 3 and those squads push out along the lanes on their own.'],
      [30, '🧱 Crag, water and deep wood are already wall — you only pay for the gaps. Out on the approaches, a fence across a pass costs almost nothing and funnels them into your tower.'],
      [36, '🚩 Stand on a lane node with no enemies nearby to take it. Held nodes pay you and let you raise a Forward Camp.'],
      [48, '🔥 Every hive keeps mustering until you raze it. Raze them all, then break the counterattack.'],
      [62, '🔧 Nothing repairs itself — hold SPACE/B in Build mode, or hold B in Fight mode. Press T beside a tower to change what it shoots.'],
    ];
    this._tut = { steps, i: 0 };
  }

  async _initAuth() {
    try {
      const status = await this.auth.init();
      await this._applyAuth(status);
      this.auth.onAuthChange((next) => {
        this._applyAuth(next).catch((err) => {
          console.warn('auth sync failed', err);
          this.ui.setAccount({ ...this.auth.status(), error: 'Profile sync failed. Try again.' });
        });
      });
    } catch (err) {
      console.warn('auth init failed', err);
      this.authStatus = {
        ready: true,
        enabled: false,
        signedIn: false,
        reason: 'config_error',
        error: err.message || 'Cloud sign-in failed.',
      };
      this.ui.setAccount(this.authStatus);
    }
  }

  async _applyAuth(status) {
    this.authStatus = status;
    if (status.signedIn) {
      await this.auth.ensureProfile(this.profile);
      const cloud = this.auth.profileFromBundle(await this.auth.loadProfileBundle());
      if (cloud) {
        this.profile = { ...this.profile, ...cloud, name: cloud.name || this.profile.name };
        this._saveProfile();
        this.ui.setProfile(this.profile);
        this.ui.setCampaign(this.profile.campaign || 0);
        if (this.profile.lastHero) this.ui.preselectHero(this.profile.lastHero);
      }
      const cloudSave = await this.auth.loadLatestSave();
      if (cloudSave?.snap) {
        try { localStorage.setItem('zillions_save', JSON.stringify(cloudSave)); } catch { /* ignore */ }
        this.ui.setContinue(cloudSave.snap);
      }
    } else if (status.enabled) {
      this.lobby = null;
    }
    this.authStatus = this.auth.status({ error: status.error, reason: status.reason });
    this.ui.setAccount(this.authStatus);
  }

  async _signIn() {
    try {
      this.audio.init();
      await this.auth.signInWithGoogle();
    } catch (err) {
      this.ui.setAccount({ ...this.auth.status(), error: err.message || 'Google sign-in failed.' });
    }
  }

  async _claimUsername(username) {
    try {
      await this.auth.setUsername(username);
      const cloud = this.auth.profileFromBundle(await this.auth.loadProfileBundle());
      if (cloud) {
        this.profile = { ...this.profile, ...cloud, name: cloud.name || this.profile.name };
        this._saveProfile();
        this.ui.setProfile(this.profile);
        this.ui.setCampaign(this.profile.campaign || 0);
      }
      await this._applyAuth(this.auth.status());
    } catch (err) {
      this.ui.setAccount({
        ...this.auth.status(),
        signedIn: true,
        needsUsername: true,
        error: err.message || 'Could not claim that username.',
      });
    }
  }

  // ---------------- co-op networking ----------------

  issue(cmd) {
    if (!this.game) return;
    if (this.mpRole === 'spectator') return;
    if (!this.netMode) { this.game.exec(cmd); return; }
    if (this.mpRole === 'host') this.outbox.push(cmd);
    else this.net.send({ t: 'cmd', c: cmd });
  }

  _loadProfile() {
    try {
      return {
        name: '', games: 0, wins: 0, kills: 0, bestDay: 0, lastHero: null, tutorialDone: false,
        campaignHeroes: {}, relics: [], questsDone: {},
        ...JSON.parse(localStorage.getItem('zillions_profile') || '{}'),
      };
    } catch { return { name: '', games: 0, wins: 0, kills: 0, bestDay: 0, lastHero: null, campaignHeroes: {}, relics: [], questsDone: {} }; }
  }

  // The WC3-style persistent campaign hero this profile brings into a run.
  campFor(key) {
    const ch = (this.profile.campaignHeroes || {})[key] || {};
    return {
      level: ch.level || 1, xp: ch.xp || 0,
      items: ch.items ? [...ch.items] : [],
      upgrades: ch.upgrades ? { ...ch.upgrades } : {},
      relics: [...(this.profile.relics || [])],
    };
  }

  _publicName() {
    return this.lobby?.me?.name || this.profile.username || this.profile.name || 'Commander';
  }

  _heroPayload(key = this.ui.selectedHero) {
    return { t: 'hero', k: key, camp: this.campFor(key), name: this._publicName() };
  }

  _pickHero(key) {
    const msg = this._heroPayload(key);
    if (this.mpRole === 'guest' && this.net?.open) this.net.send(msg);
    if (this.mpRole === 'host') this._syncSetupRoster();
    if (this.lobby?.game) {
      this.lobby.updateRoomPlayer({ hero: key }).catch((e) => {
        console.warn('room hero update failed', e);
      });
    }
  }

  _roomRosterFromGame(game) {
    const players = [...(game?._players || [])]
      .sort((a, b) => Number(a.seat || 99) - Number(b.seat || 99));
    return players.map((p, i) => ({
      seat: Number(p.seat || i + 1),
      name: p.display_name || 'Commander',
      hero: p.hero,
      host: p.user_id === game.host_id,
      you: p.user_id === this.lobby?.me?.id,
      ready: !!p.ready,
      state: p.connection_state || 'online',
    }));
  }

  _manualRosterPlayers() {
    return [
      { seat: 1, name: this.mpRole === 'host' ? this._publicName() : 'Host', hero: this.mpRole === 'host' ? this.ui.selectedHero : null, host: true, you: this.mpRole === 'host', state: 'connected' },
      ...this.peers.map((_, i) => ({
        seat: i + 2,
        name: this.guestNames[i] || `Player ${i + 2}`,
        hero: this.guestHeroes[i],
        host: false,
        you: false,
        state: 'connected',
      })),
    ];
  }

  _guestRoster(players = [], mySeat = 2) {
    return (players || []).map((p) => ({
      ...p,
      host: Number(p.seat || 0) === 1 || !!p.host,
      you: Number(p.seat || 0) === Number(mySeat || 2),
      hero: Number(p.seat || 0) === Number(mySeat || 2) ? (p.hero || this.ui.selectedHero) : p.hero,
    }));
  }

  _syncSetupRoster() {
    if (this.lobby?.game) return this._onRoomUpdate(this.lobby.game);
    if (this.mpRole !== 'host' && this.mpRole !== 'guest') return;
    const players = this._manualRosterPlayers();
    this.ui.roomRoster(players, {
      maxPlayers: 3,
      isHost: this.mpRole === 'host',
      mode: this.ui.selectedMode || 'campaign',
    });
    if (this.mpRole === 'host' && this.peers.length) {
      this._broadcast({ t: 'lobbyRoster', n: players.length, players });
    }
    return players;
  }

  _saveProfile() {
    try { localStorage.setItem('zillions_profile', JSON.stringify(this.profile)); } catch { /* full/blocked */ }
    if (this.auth?.isSignedIn()) {
      this.auth.syncLocalProfile(this.profile).catch((err) => console.warn('profile sync failed', err));
    }
  }

  _loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem('zillions_save') || 'null');
      return s && s.snap && s.snap.v === 5 ? s : null;
    } catch { return null; }
  }

  // Guests never autosave — the host owns the co-op save.
  // The snapshot is taken synchronously (it must reflect one exact sim tick),
  // but serializing + persisting it is deferred to idle time: in co-op every
  // host frame hitch becomes a stall broadcast to all guests, and stringify +
  // localStorage on the hot path was a guaranteed periodic hitch.
  _autosave(force = false) {
    if (!this.game || this.game.over || this.mpRole === 'guest' || this.mpRole === 'spectator') return;
    if (!force && this.paused) return;
    try {
      const save = { when: Date.now(), snap: this.game.snapshot() };
      const persist = () => {
        try {
          localStorage.setItem('zillions_save', JSON.stringify(save));
          if (this.auth?.isSignedIn()) this.auth.syncLatestSave(save).catch((err) => console.warn('save sync failed', err));
        } catch { /* storage full */ }
      };
      if (!force && typeof requestIdleCallback === 'function') requestIdleCallback(persist, { timeout: 4000 });
      else persist();
    } catch { /* snapshot failed */ }
  }

  _recordGameEnd(won) {
    if (this.mpRole === 'spectator') return;
    const p = this.profile;
    p.games++;
    if (won && this.game.mode !== 'survival') {
      p.wins++;
      p.campaign = Math.max(p.campaign || 0, this.game.levelId);
    }
    if (this.game.mode === 'survival') {
      p.bestSurvival = Math.max(p.bestSurvival || 0, this.game.threatLevel);
    }
    p.kills += this.game.stats.kills;
    p.bestDay = Math.max(p.bestDay, this.game.threatLevel);
    p.lastHero = this.ui.selectedHero;

    // WC3-style persistence: the campaign hero keeps every level and item —
    // and quest/boss rewards granted here await them on the next map.
    this._endExtras = null;
    const h = this.game.heroes[this.myPlayer];
    if (h) {
      p.campaignHeroes = p.campaignHeroes || {};
      p.relics = p.relics || [];
      p.questsDone = p.questsDone || {};
      const cur = (p.campaignHeroes[h.key] = p.campaignHeroes[h.key] || { level: 1, xp: 0, items: [], upgrades: {} });
      const grants = [];
      // Whatever the hero was still carrying off the field is theirs to keep —
      // in survival too. Waves are the only progression a survival run has, so
      // the finds have to survive the run.
      const finds = [...new Set(h.pack || [])].filter((k) => ITEMS[k] && !(cur.items || []).includes(k));
      if (finds.length) {
        cur.items = [...(cur.items || []), ...finds];
        grants.push(...finds);
      }
      // Levels, career gear and quest/boss rewards are the campaign's ladder.
      if (this.game.mode === 'campaign') {
        if (h.level > cur.level || (h.level === cur.level && h.xp > (cur.xp || 0))) {
          cur.level = h.level;
          cur.xp = Math.round(h.xp);
        }
        cur.items = [...new Set([...(cur.items || []), ...(h.items || [])])];
        cur.upgrades = { ...(cur.upgrades || {}), ...(h.upgrades || {}) };
        for (const q of this.game.questResults || []) {
          if (!q.done || p.questsDone[q.id]) continue;
          p.questsDone[q.id] = true;
          const it = ITEMS[q.reward];
          if (!it) continue;
          if (it.kind === 'relic') {
            if (!p.relics.includes(q.reward)) { p.relics.push(q.reward); grants.push(q.reward); }
          } else if (!cur.items.includes(q.reward)) {
            cur.items.push(q.reward);
            grants.push(q.reward);
          }
        }
        if (won) {
          const drop = BOSS_DROPS[this.game.levelId];
          if (drop && !cur.items.includes(drop)) { cur.items.push(drop); grants.push(drop); }
        }
      }
      this._endExtras = {
        heroKey: h.key, heroName: h.def.name, level: cur.level, grants,
        quests: this.game.mode === 'campaign' ? (this.game.questResults || []) : [],
      };
      this.ui.refreshHeroBadges(p);
    }
    this._saveProfile();
    try { localStorage.removeItem('zillions_save'); } catch { /* ignore */ }
    if (this.auth?.isSignedIn()) {
      this.auth.clearLatestSave().catch((err) => console.warn('save clear failed', err));
      this.auth.recordMatch({
        mode: this.game.mode || 'campaign',
        rules: 'continuous-siege',
        hero: h?.key || this.ui.selectedHero,
        won,
        day: this.game.threatLevel,
        kills: this.game.stats.kills,
        built: this.game.stats.built || 0,
        level: this.game.levelId,
      }).catch((err) => console.warn('match history sync failed', err));
    }
    this._netPumpStop();
    if (this.lobby) this.lobby.setMatchActive(false);
    if (this.lobby && this.lobby.game && this.mpRole === 'host') this.lobby.endGame();
  }

  continueGame() {
    const save = this._loadSave();
    if (!save) return;
    if (this.mpRole === 'host' && this.peers.length) {
      if (save.snap.heroKeys.length !== this.peers.length + 1) {
        this.ui.mpStatus(`❌ That save is for ${save.snap.heroKeys.length} players — you have ${this.peers.length + 1} connected.`);
        return;
      }
      this.peers.forEach((p, i) => p.send({ t: 'start', snap: save.snap, you: i + 1 }));
      this.startGame(save.snap.diff, null, { myPlayer: 0, role: 'host' }, save.snap);
    } else if (!this.mpRole) {
      this.startGame(save.snap.diff, null, null, save.snap);
    }
  }

  async hostGame() {
    this.audio.init();
    this.mpRole = 'host';
    await this._newInvite();
  }

  // Each joining player gets their own invite/reply exchange.
  async _newInvite() {
    const peer = new NetSession();
    this.pendingPeer = peer;
    const idx = this.peers.length; // becomes player idx+1
    peer.onOpen = () => {
      this.peers.push(peer);
      this.guestHeroes.push(null);
      this.guestNames.push(null);
      this.guestCmdQueues.push([]);
      this.peerUserIds.push(null); // manual invites have no account id — no auto-reconnect
      this.pendingPeer = null;
      const players = this._manualRosterPlayers();
      peer.send({ t: 'lobby', n: this.peers.length + 1, players });
      this.ui.mpLobby(this.peers.length, this.peers.length < 2, players, { mode: this.ui.selectedMode || 'campaign' });
      this._syncSetupRoster();
    };
    peer.onMessage = (m) => this._onHostMsg(idx, m);
    peer.onClose = () => {
      if (this.netMode && this.game && !this.game.over) {
        this.game.msg(`⚠️ Player ${idx + 2} disconnected — their hero fights on alone.`, 'warn');
      }
    };
    try {
      const code = await peer.host();
      this.ui.mpShowHost(code, this.peers.length);
    } catch (e) {
      this.ui.mpStatus('❌ Could not create a session (WebRTC unavailable).');
    }
  }

  _onHostMsg(idx, m) {
    if (m.t === 'hero') {
      this.guestNames[idx] = m.name || this.guestNames[idx] || `Player ${idx + 2}`;
      if (this.netMode) return; // reconnecting player mid-game — roster is locked
      this.guestHeroes[idx] = m.camp ? { k: m.k, camp: m.camp } : m.k;
      const players = this._manualRosterPlayers();
      this.ui.mpLobby(this.peers.length, this.peers.length < 2, players, { mode: this.ui.selectedMode || 'campaign' });
      this._syncSetupRoster();
    }
    else if (m.t === 'cmd') this.guestCmdQueues[idx].push(m.c);
    else if (m.t === 'h') this._checkGuestHash(m.w, m.h, idx);
    else if (m.t === 'chat') {
      this.ui.gameChatAdd(m);
      this._broadcast(m);
    }
  }

  _broadcast(msg) {
    for (const p of this.peers) p.send(msg);
  }

  _broadcastSpectators(msg) {
    for (const p of this.spectators) p.send(msg);
  }

  _checkGuestHash(w, h, idx) {
    const mine = this.hashes.local.get(w);
    if (mine !== undefined && mine !== h && !this.desynced) {
      this.desynced = true;
      this._broadcast({ t: 'desync' });
      this.ui.showBanner('⚠️ Games desynced — everyone should refresh and reconnect.', 'bad', 10000);
    }
  }

  async joinGame(code) {
    this.audio.init();
    this.mpRole = 'guest';
    this.net = new NetSession();
    this.net.onOpen = () => this.net.send(this._heroPayload());
    this.net.onMessage = (m) => this._onGuestMsg(m);
    this.net.onClose = () => {
      if (this.netMode && this.game && !this.game.over) {
        this.pause();
        this.ui.showBanner('⚠️ Connection to the host was lost.', 'bad', 8000);
      }
    };
    try {
      const reply = await this.net.join(code);
      this.ui.mpShowReply(reply);
    } catch (e) {
      this.ui.mpStatus('❌ Bad invite code.');
    }
  }

  async _onGuestMsg(m) {
    if (m.t === 'lobby') {
      this.mpSeat = m.n;
      this.ui.mpConnected(false, m.n, this._guestRoster(m.players, m.n));
    }
    else if (m.t === 'lobbyRoster') this.ui.roomRoster(this._guestRoster(m.players, this.mpSeat || 2), { isHost: false, mode: this.ui.selectedMode || 'campaign' });
    else if (m.t === 'w') {
      // While a resync snapshot is being rebuilt, bank every window on the
      // side — the fresh sim needs the ones sent since the snapshot froze.
      const box = this._resyncing ? this._resyncBuffer : this.inbox;
      const next = this._resyncing ? 0 : this.game ? Math.ceil(this.simFrame / NET_STEP) : 0;
      if (m.w >= next) box.set(m.w, m.c);
      // Redundant copies of recent windows ride along in every packet, so a
      // late or lost packet no longer stalls the sim — a later one fills it.
      for (const [pw, pc] of m.p || []) {
        if (pw >= next && !box.has(pw)) box.set(pw, pc);
      }
    }
    else if (m.t === 'start') {
      if (m.snap) this.startGame(m.snap.diff, null, { myPlayer: m.you, role: 'guest' }, m.snap);
      else this.startGame(m.d, null, { heroes: m.heroes, myPlayer: m.you, role: 'guest', level: m.level, mode: m.mode });
    }
    else if (m.t === 'spectateStart') {
      await this.startGame(m.snap.diff, null, { myPlayer: 0, role: 'spectator' }, m.snap);
      this.simFrame = m.frame;
      this.netPrimed = false;
      this.net.send({ t: 'spectateReady' });
      this.ui.showBanner('Watching live — camera controls work, battle controls are read-only.', '', 5000);
    }
    else if (m.t === 'resync') {
      // Mid-game rejoin: the host froze one sim tick into a snapshot; rebuild
      // from it, then pick up lockstep at the host's frame counter using the
      // windows banked while the sim was rebuilding.
      this._resyncing = true;
      this._resyncBuffer = new Map();
      this.startGame(m.snap.diff, null, { myPlayer: m.you, role: 'guest' }, m.snap)
        .then(() => {
          const buf = this._resyncBuffer || new Map();
          const next = Math.ceil(m.frame / NET_STEP);
          for (const k of [...buf.keys()]) { if (k < next) buf.delete(k); }
          this.simFrame = m.frame;
          this.inbox = buf;
          this.netPrimed = false;
          this._reconnectTries = 0;
          clearTimeout(this._reconnectT);
          this.ui.setWaiting(false);
          this.ui.showBanner('🔌 Reconnected — back in the war.', '', 3500);
        })
        .catch(() => {})
        .finally(() => { this._resyncing = false; this._resyncBuffer = null; });
    }
    else if (m.t === 'desync' && !this.desynced) {
      this.desynced = true;
      this.ui.showBanner('⚠️ Games desynced — everyone should refresh and reconnect.', 'bad', 10000);
    }
    else if (m.t === 'chat') this.ui.gameChatAdd(m);
  }

  _stateHash() {
    const g = this.game;
    let h = 7;
    h = (h * 31 + Math.round(g.gold)) | 0;
    h = (h * 31 + g.coins.length) | 0;
    h = (h * 31 + g.zombies.length) | 0;
    h = (h * 31 + g.units.length) | 0;
    h = (h * 31 + g.buildings.length) | 0;
    h = (h * 31 + g.stats.kills) | 0;
    for (const hr of g.heroes) {
      h = (h * 31 + Math.round(hr.x * 8) + Math.round(hr.z * 8) * 7 + hr.level * 131) | 0;
      for (const v of Object.values(hr.upgrades || {})) h = (h * 31 + v * 17) | 0;
    }
    return h;
  }

  // ---------------- lockstep engine ----------------

  // Host-sequenced lockstep: the host merges every player's commands into
  // numbered windows and broadcasts them; guests advance only as windows
  // arrive, so all sims stay in step. Driven by BOTH the render loop and the
  // pump (a worker timer) off one shared wall clock, so the host keeps
  // emitting windows even when rendering hitches or the tab is hidden.
  _advanceNetSim() {
    if (!this.netMode || !this.game || this.paused || this.game.over) return;
    const now = performance.now();
    let dt = Math.min((now - (this._netClockLast ?? now)) / 1000, 0.25);
    this._netClockLast = now;

    // Adaptive pacing: instead of stall-and-burst, a guest drifts its sim
    // rate a few percent to hold NET_GUEST_BUFFER windows in the bank.
    // Network jitter then shows up as imperceptible speed drift, not freezes.
    if (this.mpRole === 'guest') {
      const banked = this._windowsBuffered();
      if (banked < NET_GUEST_BUFFER) dt *= NET_PACE_SLOW;
      else if (banked >= NET_GUEST_BUFFER + 2) dt *= NET_PACE_FAST;
    }

    this.acc += dt;
    let steps = 0;
    let stalled = false;
    while (this.acc >= SIM_DT && steps < 10) {
      if (this.simFrame % NET_STEP === 0) {
        const w = this.simFrame / NET_STEP;
        let bundle;
        if (this.mpRole === 'host') {
          bundle = [...this.outbox];
          this.outbox = [];
          for (const q of this.guestCmdQueues) { bundle.push(...q); q.length = 0; }
          // Each packet repeats the last few windows: on the unordered
          // channel a late/lost packet is healed by the next one instead of
          // freezing every guest.
          this._broadcastFast({ t: 'w', w, c: bundle, p: this._recentWindows.slice() });
          this._recentWindows.push([w, bundle]);
          if (this._recentWindows.length > NET_REDUNDANCY) this._recentWindows.shift();
        } else {
          bundle = this.inbox.get(w);
          if (!bundle) {
            // A real gap. Re-arm the buffer so we come back with margin
            // instead of running window-to-window and stuttering forever.
            stalled = true;
            this.netPrimed = false;
            break;
          }
          if (!this.netPrimed) {
            const hasBuffer = this.inbox.has(w + NET_GUEST_BUFFER - 1) || this.inbox.size >= NET_GUEST_BUFFER;
            if (!hasBuffer) { stalled = true; break; }
            this.netPrimed = true;
          }
          this.inbox.delete(w);
        }
        for (const c of bundle) this.game.exec(c);
        if (w > 0 && w % 30 === 0) {
          const hsh = this._stateHash();
          if (this.mpRole === 'host') this.hashes.local.set(w, hsh);
          else this.net.send({ t: 'h', w, h: hsh });
        }
      }
      this.game.update(SIM_DT);
      this.simFrame++;
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps === 10 || stalled) this.acc = Math.min(this.acc, SIM_DT * 3);
    this.netStallT = stalled ? this.netStallT + dt : 0;
    this.ui.setWaiting(stalled && this.netStallT > 0.25, this.netStallT > 1.2 ? '⏳ Network catch-up…' : '⏳ Syncing co-op…');
  }

  // Consecutive windows banked ahead of the guest's next lockstep boundary.
  _windowsBuffered() {
    const w = Math.ceil(this.simFrame / NET_STEP);
    let n = 0;
    while (n < 32 && this.inbox.has(w + n)) n++;
    return n;
  }

  _broadcastFast(msg) {
    for (const p of this.peers) p.sendFast(msg);
  }

  // The pump: a heartbeat that keeps the lockstep clock ticking when
  // requestAnimationFrame doesn't — heavy frames, GC pauses, hidden tabs.
  // Worker timers keep firing in backgrounded tabs where window timers are
  // throttled, so guests no longer freeze because the host alt-tabbed.
  _netPumpStart() {
    const periodMs = Math.round(SIM_DT * NET_STEP * 1000);
    const tick = () => this._advanceNetSim();
    try {
      const src = `setInterval(() => postMessage(0), ${periodMs});`;
      this._netWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this._netWorker.onmessage = tick;
    } catch {
      this._netPumpTimer = setInterval(tick, periodMs);
    }
  }

  _netPumpStop() {
    if (this._netWorker) { try { this._netWorker.terminate(); } catch { /* gone */ } this._netWorker = null; }
    if (this._netPumpTimer) { clearInterval(this._netPumpTimer); this._netPumpTimer = null; }
  }

  // ---------------- scene setup ----------------

  // ---------------- online lobby ----------------

  async _openLobby() {
    if (this.lobby) {
      if (this.lobby.connected) this.lobby.refreshGames();
      return this.lobby;
    }
    this.lobby = new OnlineLobby({
      onChat: (m) => this.ui.lobbyChatAdd(m),
      onRoomChat: (m) => {
        if (m.channel === 'game') this.ui.gameChatAdd(m);
        else this.ui.roomChatAdd(m);
      },
      onGames: (g) => this.ui.lobbyGames(g, (row) => this.joinOnlineGame(row), (row) => this.watchOnlineGame(row), this.lobby?.me?.id),
      onOnline: (map) => { this.ui.lobbyOnline(map); },
      onFriends: (friends) => this.ui.lobbyFriends(friends),
      onInvite: (inv) => this.ui.showInviteToast(inv, () => this.acceptInvite(inv)),
      onRoom: (game) => this._onRoomUpdate(game),
      onKnock: (sig) => this._onKnock(sig),
      onSignal: (sig) => this._onSignal(sig),
    });
    this.ui.fillLore(LORE, TIPS);
    this.ui.lobbyStatus('Connecting…');
    try {
      const me = await this.lobby.connect(this.profile.name || 'Commander');
      this.ui.lobbySetMe(me);
      this.ui.lobbyChatFill(await this.lobby.loadChat());
      this.ui.lobbyFriends(await this.lobby.loadFriends());
      this.lobby.refreshGames();
    } catch (e) {
      this.ui.lobbyStatus('❌ offline');
      this.ui.showBanner('❌ Lobby unreachable — solo and manual invite codes still work.', 'bad', 6000);
    }
    return this.lobby;
  }

  _onRoomUpdate(game) {
    if (!game) return;
    const isHost = this.mpRole === 'host';
    const isSpectator = this.mpRole === 'spectator';
    const readiness = roomConnectionReadiness(game, this.peers.length + 1);
    const { connected, expectedPlayers, pending, ready } = readiness;
    this.ui.roomRoster(this._roomRosterFromGame(game), {
      maxPlayers: game.max_players || 3,
      isHost,
      code: game.join_code,
      mode: game.mode || this.ui.selectedMode || 'campaign',
      launchText: isHost
        ? (!ready
          ? `${pending} player${pending === 1 ? ' is' : 's are'} in the room but still establishing the game connection.`
          : connected > 1 ? `The game connection is ready for ${connected} players. Use START to launch everyone.` : 'Share the room code. You can start now, or wait for more players.')
        : isSpectator ? 'You are connecting as a read-only watcher. The live battle will open automatically.'
        : 'You are in the room. Pick your hero and wait for the host to press START.',
    });
    this.ui.setStartButton(isHost ? {
      text: ready
        ? `▶  START ROOM — LAUNCH ${expectedPlayers} PLAYER${expectedPlayers === 1 ? '' : 'S'}`
        : `⏳  CONNECTING ${pending} PLAYER${pending === 1 ? '' : 'S'}`,
      disabled: !ready,
      title: ready ? 'The host launches the match for everyone connected.' : 'Start unlocks when every player in the room has a direct game connection.',
    } : isSpectator ? {
      text: '⏳  LOADING LIVE BATTLE',
      disabled: true,
      title: 'Connecting to the host as a read-only spectator.',
    } : {
      text: '⏳  WAITING FOR HOST TO START',
      disabled: true,
      title: 'Only the host can launch this room.',
    });
  }

  async _sendLobbyChat(text) {
    if (!this.lobby) return;
    try {
      await this.lobby.sendChat(text);
    } catch (e) {
      this.ui.showBanner('❌ Lobby chat failed: ' + e.message, 'bad', 4000);
    }
  }

  async _sendRoomChat(text, channel = 'room') {
    if (!this.lobby || !this.lobby.game) return;
    try {
      await this.lobby.sendRoomChat(text, channel);
    } catch (e) {
      this.ui.showBanner('❌ Room chat failed: ' + e.message, 'bad', 4000);
    }
  }

  _localChatMessage(text) {
    return {
      t: 'chat',
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: this.profile.username || this.profile.name || 'Commander',
      text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      created_at: new Date().toISOString(),
    };
  }

  async _sendGameChat(text) {
    if (!this.game || !this.netMode) return;
    if (this.lobby?.game) {
      await this._sendRoomChat(text, 'game');
      return;
    }
    const msg = this._localChatMessage(text);
    if (!msg.text) return;
    this.ui.gameChatAdd(msg);
    if (this.mpRole === 'host') this._broadcast(msg);
    else if (this.net?.open) this.net.send(msg);
  }

  async _addFriend(handle) {
    if (!this.lobby) return;
    try {
      this.ui.lobbyFriends(await this.lobby.addFriend(handle));
    } catch (e) {
      this.ui.showBanner('❌ Friend request failed: ' + e.message, 'bad', 4000);
    }
  }

  async _acceptFriend(id) {
    if (!this.lobby) return;
    try {
      this.ui.lobbyFriends(await this.lobby.acceptFriend(id));
    } catch (e) {
      this.ui.showBanner('❌ Could not accept friend: ' + e.message, 'bad', 4000);
    }
  }

  async _removeFriend(id) {
    if (!this.lobby) return;
    try {
      this.ui.lobbyFriends(await this.lobby.removeFriend(id));
    } catch (e) {
      this.ui.showBanner('❌ Could not update friend: ' + e.message, 'bad', 4000);
    }
  }

  async _inviteFriend(userId) {
    if (!this.lobby) return;
    try {
      await this.lobby.inviteFriend(userId);
      this.ui.showBanner('⚔️ Invite sent.', '', 2200);
    } catch (e) {
      this.ui.showBanner('❌ Invite failed: ' + e.message, 'bad', 4000);
    }
  }

  async createOnlineGame(visibility) {
    const lobby = await this._openLobby();
    if (!lobby || !lobby.connected || lobby.game) return;
    this.audio.init();
    this.mpRole = 'host';
    this.onlineMode = true;
    this.onlinePending = new Map();
    try {
      const game = await lobby.createGame({ visibility, level: this.ui.selectedLevel || 1, mode: this.ui.selectedMode || 'campaign' });
      await lobby.updateRoomPlayer({ hero: this.ui.selectedHero }).catch(() => {});
      const room = lobby.game || game;
      this.ui.showSetup({ online: room, mode: room.mode });
      this._onRoomUpdate(room);
      this.ui.roomChatFill(await lobby.loadRoomChat(room.id, 'room'));
    } catch (e) {
      this.ui.showBanner('❌ Could not create the game: ' + e.message, 'bad', 5000);
      this.mpRole = null;
      this.onlineMode = false;
    }
  }

  // Host side of the automatic handshake: a guest knocked — offer them a
  // WebRTC session through the signaling channel. Mid-game, a knock from a
  // player who already holds a seat is a reconnect: rebuild the link and
  // resync them from a live snapshot.
  async _onKnock(sig) {
    if (sig.role === 'spectator') return this._acceptSpectator(sig);
    if (!this.onlinePending) return;
    const rejoinIdx = this.peerUserIds.indexOf(sig.from);
    const rejoining = this.netMode && this.game && !this.game.over && rejoinIdx >= 0;
    if (this.netMode && !rejoining) return;           // mid-game seats are not open to strangers
    if (!this.netMode && this.peers.length >= 2) return;
    if (this.onlinePending.has(sig.from)) return;
    const peer = new NetSession(this.lobby?.iceServers);
    const idx = rejoining ? rejoinIdx : this.peers.length;
    peer.onOpen = () => {
      this.onlinePending.delete(sig.from);
      if (rejoining) {
        const old = this.peers[idx];
        try { if (old) old.destroy(); } catch { /* already dead */ }
        this.peers[idx] = peer;
        this.guestCmdQueues[idx] = [];
        // One live tick, frozen and shipped: the guest rebuilds from it and
        // rejoins lockstep at our frame counter.
        peer.send({ t: 'resync', snap: this.game.snapshot(), you: idx + 1, frame: this.simFrame });
        this.game.msg(`⚔️ ${this.guestNames[idx] || `Player ${idx + 2}`} reconnected — their hero fights again.`, 'good');
      } else {
        this.peers.push(peer);
        this.guestHeroes.push(null);
        this.guestNames.push(sig.name || null);
        this.guestCmdQueues.push([]);
        this.peerUserIds.push(sig.from);
        peer.send({ t: 'lobby', n: this.peers.length + 1, players: this._roomRosterFromGame(this.lobby.game) });
        this.ui.onlineStatus(`🟢 ${this.peers.length + 1} players connected. START when ready.`);
        this._syncSetupRoster();
        if (this.lobby.game) this.lobby.touchGame({ players: this.peers.length + 1 });
      }
    };
    peer.onMessage = (m) => this._onHostMsg(idx, m);
    peer.onClose = () => {
      if (this.netMode && this.game && !this.game.over && this.peers[idx] === peer) {
        this.game.msg(`⚠️ Player ${idx + 2} disconnected — their hero fights on until they return.`, 'warn');
      }
    };
    this.onlinePending.set(sig.from, peer);
    // An abandoned handshake must not squat the pending slot forever — that
    // would silently eat every later knock (and reconnect) from this player.
    setTimeout(() => {
      if (this.onlinePending?.get(sig.from) === peer && !peer.open) {
        this.onlinePending.delete(sig.from);
        peer.destroy();
      }
    }, 20000);
    try {
      peer.onIce = (cand) => { this.lobby.signal({ t: 'ice', to: sig.from, cand }).catch(() => {}); };
      const code = await peer.hostTrickle();
      await this.lobby.signal({ t: 'offer', to: sig.from, sdp: code });
    } catch (e) {
      this.onlinePending.delete(sig.from);
      if (!rejoining) this.ui.onlineStatus('❌ Could not reach the joining player. Ask them to try JOIN again.');
    }
  }

  async _acceptSpectator(sig) {
    if (!this.netMode || this.mpRole !== 'host' || !this.game || !this.onlinePending) return;
    if (this.onlinePending.has(sig.from)) return;
    const peer = new NetSession();
    const rec = { peer, name: sig.name || 'Watcher', started: false, buffer: [] };
    peer.onOpen = () => {
      this.onlinePending.delete(sig.from);
      this.pendingSpectators.push(rec);
      this.ui.showBanner(`👁️ @${rec.name} is watching.`, '', 2600);
    };
    peer.onMessage = (m) => {
      if (m.t !== 'spectateReady') return;
      for (const packet of rec.buffer) peer.send(packet);
      rec.buffer.length = 0;
      this.pendingSpectators = this.pendingSpectators.filter((entry) => entry !== rec);
      if (!this.spectators.includes(peer)) this.spectators.push(peer);
    };
    peer.onClose = () => {
      this.pendingSpectators = this.pendingSpectators.filter((entry) => entry !== rec);
      this.spectators = this.spectators.filter((entry) => entry !== peer);
    };
    this.onlinePending.set(sig.from, peer);
    try {
      const code = await peer.host();
      await this.lobby.signal({ t: 'offer', to: sig.from, sdp: code, role: 'spectator' });
    } catch (e) {
      this.onlinePending.delete(sig.from);
    }
  }

  // Guest side: the host's offer arrived — answer it. ICE candidates trickle
  // both ways through the signaling channel afterwards.
  async _onSignal(sig) {
    if (sig.t === 'offer' && (this.mpRole === 'guest' || this.mpRole === 'spectator')) {
      this.net = new NetSession(this.lobby?.iceServers);
      this.net.onOpen = () => {
        if (this.mpRole === 'guest') {
          this._reconnectTries = 0;
          if (!this.netMode) {
            this.net.send(this._heroPayload());
            this.ui.onlineStatus('🟢 Connected! Pick your hero — the host starts the war.');
          }
        } else {
          this.ui.onlineStatus('🟢 Connected to the host. Loading the live battle…');
        }
      };
      this.net.onMessage = (m) => this._onGuestMsg(m);
      this.net.onClose = () => this._onHostLinkLost();
      try {
        this.net.onIce = (cand) => { this.lobby.signal({ t: 'ice', to: sig.from, cand }).catch(() => {}); };
        const reply = await this.net.joinTrickle(sig.sdp);
        await this.lobby.signal({ t: 'answer', to: sig.from, sdp: reply });
      } catch (e) {
        if (wasInGame) this._scheduleReconnect();
        else this.ui.onlineStatus(`❌ Handshake failed: ${e.message}. Try JOIN again.`);
      }
    } else if (sig.t === 'answer' && this.mpRole === 'host' && this.onlinePending) {
      const peer = this.onlinePending.get(sig.from);
      if (peer) peer.acceptReply(sig.sdp).catch(() => {});
    } else if (sig.t === 'ice') {
      // Trickled candidate: route to whichever session speaks to that player.
      if (this.mpRole === 'host') {
        const peer = this.onlinePending?.get(sig.from)
          || (this.peerUserIds.indexOf(sig.from) >= 0 ? this.peers[this.peerUserIds.indexOf(sig.from)] : null);
        if (peer) peer.addIce(sig.cand);
      } else if (this.net) {
        this.net.addIce(sig.cand);
      }
    }
  }

  // The host link dropped mid-game. If this is a lobby (signaled) match, the
  // room is still alive in Supabase — knock again and the host will offer a
  // fresh session plus a resync snapshot. Manual invite-code games can't
  // re-signal, so they keep the old pause-and-banner behavior.
  _onHostLinkLost() {
    if (!this.netMode || !this.game || this.game.over) return;
    if (this.onlineMode && this.lobby?.game && this.lobby.connected) {
      this._reconnectTries = 0;
      this._scheduleReconnect(0);
    } else {
      this.pause();
      this.ui.showBanner('⚠️ Connection to the host was lost.', 'bad', 8000);
    }
  }

  _scheduleReconnect(delayMs = null) {
    if (!this.netMode || !this.game || this.game.over) return;
    this._reconnectTries = (this._reconnectTries || 0) + 1;
    if (this._reconnectTries > 8) {
      this.pause();
      this.ui.setWaiting(false);
      this.ui.showBanner('⚠️ Could not reach the host again. The room may have ended.', 'bad', 8000);
      return;
    }
    const wait = delayMs != null ? delayMs : Math.min(8000, 500 * 2 ** (this._reconnectTries - 1));
    this.ui.setWaiting(true, '🔌 Reconnecting…');
    clearTimeout(this._reconnectT);
    this._reconnectT = setTimeout(() => {
      if (!this.netMode || !this.game || this.game.over || this.net?.open) return;
      this.lobby.signal({ t: 'knock', name: this._publicName() })
        .catch(() => {})
        .finally(() => {
          // If the host's offer doesn't land, try again with backoff.
          clearTimeout(this._reconnectT);
          this._reconnectT = setTimeout(() => {
            if (this.netMode && this.game && !this.game.over && !this.net?.open) this._scheduleReconnect();
          }, 6000);
        });
    }, wait);
  }

  async joinOnlineGame(row) {
    const lobby = await this._openLobby();
    if (!lobby || !lobby.connected || this.netMode) return;
    this.audio.init();
    this.mpRole = 'guest';
    this.onlineMode = true;
    const rejoining = row.status === 'in_game';
    if (rejoining && !canRejoinRoom(row, lobby.me?.id)) {
      this.mpRole = null;
      this.onlineMode = false;
      this.ui.showBanner('This war is already in progress. Use Watch unless you already hold a player seat.', 'bad', 5000);
      return;
    }
    this.ui.showSetup({ online: row, mode: row.mode });
    this.ui.onlineStatus(rejoining ? '🔌 War in progress — rejoining…' : '🔗 Knocking on the host\'s gate…');
    this.ui.setStartButton({
      text: rejoining ? '🔌  REJOINING THE WAR…' : '⏳  WAITING FOR HOST TO START',
      disabled: true,
      title: rejoining ? 'Reconnecting you to the running match.' : 'Only the host can launch this room.',
    });
    try {
      await lobby.joinGame(row);
      await lobby.updateRoomPlayer({ hero: this.ui.selectedHero }).catch(() => {});
      this._onRoomUpdate(lobby.game || row);
      this.ui.onlineStatus('🔗 Host found. Establishing the game connection…');
      this.ui.roomChatFill(await lobby.loadRoomChat((lobby.game || row).id, 'room'));
    } catch (e) {
      this.mpRole = null;
      this.onlineMode = false;
      this.ui.onlineStatus(`❌ Could not join: ${e.message}. Try JOIN again.`);
    }
  }

  async watchOnlineGame(row) {
    const lobby = await this._openLobby();
    if (!lobby || !lobby.connected || this.netMode) return;
    this.audio.init();
    this.mpRole = 'spectator';
    this.onlineMode = true;
    this.ui.showSetup({ online: row, mode: row.mode });
    this.ui.onlineStatus(`👁️ Connecting to @${row.host_name}'s live war…`);
    this.ui.setStartButton({ text: '⏳  LOADING LIVE BATTLE', disabled: true, title: 'Connecting to the host as a read-only spectator.' });
    try {
      await lobby.watchGame(row);
    } catch (e) {
      this.mpRole = null;
      this.onlineMode = false;
      this.ui.onlineStatus(`❌ Could not watch: ${e.message}. The host may have left.`);
    }
  }

  async joinByCode(code) {
    if (!code || !code.trim()) return;
    const lobby = await this._openLobby();
    if (!lobby || !lobby.connected) return;
    const row = await lobby.findByCode(code);
    if (row) this.joinOnlineGame(row);
    else this.ui.showBanner('❌ No open war with that code.', 'bad', 4000);
  }

  async acceptInvite(inv) {
    const lobby = await this._openLobby();
    const row = await lobby.findByCode(inv.joinCode);
    if (row) this.joinOnlineGame(row);
    else this.ui.showBanner('❌ That war has already ended.', 'bad', 4000);
  }

  _setupLights() {
    // Cel look: one warm sun sitting LOW so every tree and tower throws a
    // long graphic shadow; shadows are filled with saturated cool ambient
    // (navy, never black) — the reference's colored-shadow trick.
    this.sun = new THREE.DirectionalLight(0xfff0cf, 2.6);
    this.sun.position.set(85, 52, 24);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 62;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 320 });
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xdfe8dd, 0x35507a, 0.85);
    this.scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0x33406e, 0.5);
    this.scene.add(this.amb);
    this.scene.fog = new THREE.FogExp2(0xa8cfc4, 0.0045);
    this.scene.background = new THREE.Color(0xa8cfc4);
  }

  // ---------------- particles ----------------

  _setupParticles() {
    const MAXP = 3000;
    this.pmax = MAXP;
    this.pcount = 0;
    this.pdata = new Float32Array(MAXP * 8); // x y z vx vy vz life maxlife
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAXP * 3);
    this.pCol = new Float32Array(MAXP * 3);
    this.pSize = new Float32Array(MAXP);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));

    const cnv = document.createElement('canvas');
    cnv.width = cnv.height = 64;
    const ctx = cnv.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cnv);

    const mat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: tex } },
      vertexShader: `
        attribute float size; varying vec3 vC;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * (180.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D tex; varying vec3 vC;
        void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(vC, 1.0) * t; }`,
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  burst(x, y, z, { count = 10, color = 0xffffff, speed = 3, life = 0.5, size = 0.5, spread = 0.4, up = 1.5 } = {}) {
    const fxScale = this.tacticalVisuals?.quality === 'low' ? 0.45 : this.netMode ? 0.75 : 1;
    count = Math.max(1, Math.ceil(count * fxScale));
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      if (this.pcount >= this.pmax) return;
      const j = this.pcount++;
      const o = j * 8;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.pdata[o] = x + Math.cos(a) * r;
      this.pdata[o + 1] = y + Math.random() * 0.2;
      this.pdata[o + 2] = z + Math.sin(a) * r;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.pdata[o + 3] = Math.cos(a) * sp;
      this.pdata[o + 4] = up * (0.5 + Math.random());
      this.pdata[o + 5] = Math.sin(a) * sp;
      const lf = life * (0.6 + Math.random() * 0.7);
      this.pdata[o + 6] = lf; this.pdata[o + 7] = lf;
      const k = j * 3;
      const v = 0.75 + Math.random() * 0.35;
      this.pCol[k] = c.r * v; this.pCol[k + 1] = c.g * v; this.pCol[k + 2] = c.b * v;
      this.pSize[j] = size * (0.7 + Math.random() * 0.6);
    }
  }

  // Thronefall build animation: real little coins pop out of the hero's purse
  // one by one and arc into the plot. Meshes are pooled and reused.
  _spawnPayCoins(fx, fz, tx, tz, n) {
    if (!this._payCoinGeo) {
      this._payCoinGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.05, 10);
      this._payCoinMat = new THREE.MeshLambertMaterial({ color: 0xf3c53d, emissive: 0xf3c53d, emissiveIntensity: 0.35 });
    }
    for (let i = 0; i < n; i++) {
      if (this.payCoins.length >= 48) return;
      const mesh = new THREE.Mesh(this._payCoinGeo, this._payCoinMat);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.payCoins.push({
        mesh,
        fx: fx + (Math.random() - 0.5) * 0.3, fz: fz + (Math.random() - 0.5) * 0.3,
        tx: tx + (Math.random() - 0.5) * 0.5, tz: tz + (Math.random() - 0.5) * 0.5,
        t: -i * 0.06, // stagger the purse
        dur: 0.34 + Math.random() * 0.08,
        spin: 4 + Math.random() * 6,
      });
    }
  }

  _updatePayCoins(dt) {
    if (!this.payCoins.length) return;
    for (let i = this.payCoins.length - 1; i >= 0; i--) {
      const c = this.payCoins[i];
      c.t += dt;
      if (c.t < 0) { c.mesh.visible = false; continue; }
      const p = Math.min(1, c.t / c.dur);
      c.mesh.visible = true;
      c.mesh.position.set(
        lerp(c.fx, c.tx, p),
        lerp(0.95, 0.2, p) + Math.sin(p * Math.PI) * 1.1,
        lerp(c.fz, c.tz, p),
      );
      c.mesh.rotation.x = c.t * c.spin;
      c.mesh.rotation.z = c.t * c.spin * 0.6;
      if (p >= 1) {
        this.burst(c.tx, 0.35, c.tz, { count: 2, color: 0xffe9a8, speed: 0.7, life: 0.2, size: 0.35, up: 0.8 });
        this.payTickT -= 1;
        if (this.payTickT <= 0) { this.audio.payTick(); this.payTickT = 2; }
        this.scene.remove(c.mesh);
        this.payCoins.splice(i, 1);
      }
    }
  }

  // A directed streak of particles from A to B (coin streams, tracers).
  stream(fx, fy, fz, tx, ty, tz, { count = 4, color = 0xffd75e, size = 0.4, life = 0.35 } = {}) {
    for (let i = 0; i < count; i++) {
      const t = Math.random();
      this.burst(lerp(fx, tx, t), lerp(fy, ty, t) + Math.sin(t * Math.PI) * 0.8, lerp(fz, tz, t),
        { count: 1, color, speed: 0.3, life, size, spread: 0.08, up: 0.4 });
    }
  }

  _projectileSpec(kind) {
    const specs = {
      hero: { color: 0x9fd6ff, trail: 0xe6f7ff, speed: 18, size: 0.24, tail: 0.14, arc: 0.25 },
      soldier: { color: 0xfff2b0, trail: 0xffd75e, speed: 20, size: 0.2, tail: 0.12, arc: 0.12 },
      ranger: { color: 0x9dff8a, trail: 0xd8ffd0, speed: 17, size: 0.2, tail: 0.14, arc: 0.35 },
      sniper: { color: 0xd9b7ff, trail: 0xffffff, speed: 25, size: 0.18, tail: 0.18, arc: 0.18 },
      tower: { color: 0xffd75e, trail: 0xfff2b0, speed: 18, size: 0.24, tail: 0.16, arc: 0.32 },
      outpost: { color: 0x8fd8ff, trail: 0xd8f3ff, speed: 17, size: 0.22, tail: 0.14, arc: 0.18 },
      outpostSiege: { color: 0xffd75e, trail: 0xfff2b0, speed: 14, size: 0.3, tail: 0.18, arc: 0.42 },
      ballista: { color: 0xffffff, trail: 0xffd75e, speed: 16, size: 0.34, tail: 0.22, arc: 0.55 },
      flame: { color: 0xff7a2e, trail: 0xffd75e, speed: 11, size: 0.3, tail: 0.16, arc: 0.12 },
      shotgun: { color: 0xfff2b0, trail: 0xffd75e, speed: 18, size: 0.18, tail: 0.1, arc: 0.08 },
      grenade: { color: 0xffb84d, trail: 0xd8b45e, speed: 10, size: 0.34, tail: 0.18, arc: 2.2 },
      spit: { color: 0xc9d84e, trail: 0xefff7a, speed: 9, size: 0.28, tail: 0.16, arc: 0.42 },
    };
    return specs[kind] || specs.soldier;
  }

  _shotVector(e) {
    const dx = (e.tx ?? e.x ?? e.fx) - e.fx;
    const dz = (e.tz ?? e.z ?? e.fz) - e.fz;
    const d = Math.hypot(dx, dz) || 1;
    return { sx: dx / d, sz: dz / d, rx: dz / d, rz: -dx / d };
  }

  _muzzlePoint(e, kind, extra = {}) {
    const fx = extra.fx ?? e.fx;
    const fz = extra.fz ?? e.fz;
    if (fx == null || fz == null) return { x: 0, y: extra.fy ?? e.fy ?? 0.7, z: 0 };
    const v = this._shotVector({ ...e, fx, fz, tx: extra.tx ?? e.tx, tz: extra.tz ?? e.tz });
    let side = 0, forward = 0.35, y = extra.fy ?? e.fy ?? 0.72;
    if (kind === 'tower' || kind === 'ballista' || kind === 'flame' || kind === 'outpost' || kind === 'outpostSiege') {
      forward = kind === 'ballista' ? 0.85 : 0.68;
      y = extra.fy ?? e.fy ?? 3.1;
    } else if (kind === 'spit') {
      forward = 0.42;
      y = extra.fy ?? e.fy ?? 0.92;
    } else if (e.fromId) {
      const rec = this.unitMeshes.get(e.fromId);
      const u = rec && rec.u;
      if (u && u.hero) {
        side = u.key === 'scott' ? 0.26 : 0.3;
        forward = u.def.melee ? 0.55 : 0.58;
        y = extra.fy ?? e.fy ?? 0.92;
      } else {
        side = 0.2;
        forward = 0.48;
        y = extra.fy ?? e.fy ?? 0.74;
      }
    }
    return {
      x: fx + v.sx * forward + v.rx * side,
      y,
      z: fz + v.sz * forward + v.rz * side,
    };
  }

  _targetPoint(e, kind, extra = {}) {
    const tx = extra.tx ?? e.tx ?? e.x;
    const tz = extra.tz ?? e.tz ?? e.z;
    let y = extra.ty;
    if (y == null) {
      if (e.targetKind === 'nest') y = 1.45;
      else if (e.targetKind === 'building') y = 1.0;
      else y = kind === 'ballista' ? 0.75 : Math.max(0.52, 0.62 * (e.targetScale || 1));
    }
    return { x: tx, y, z: tz };
  }

  _spawnProjectile(e, extra = {}) {
    if (this.projectiles.length >= 120) this._destroyProjectile(this.projectiles.shift());
    if (!this._projCoreGeo) {
      this._projCoreGeo = new THREE.SphereGeometry(1, 12, 8);
      this._projTrailGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
      this._projUp = new THREE.Vector3(0, 1, 0);
    }
    const kind = extra.kind || e.kind || 'soldier';
    const spec = { ...this._projectileSpec(kind), ...extra };
    spec.kind = kind;
    const muzzle = this._muzzlePoint(e, kind, extra);
    const hit = this._targetPoint(e, kind, extra);
    const from = new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z);
    const to = new THREE.Vector3(hit.x, hit.y, hit.z);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const dur = spec.dur || clamp(dist / spec.speed, 0.24, kind === 'grenade' || kind === 'ballista' ? 0.82 : 0.58);
    const core = new THREE.Mesh(
      this._projCoreGeo,
      new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 1, depthWrite: false }),
    );
    core.scale.setScalar(spec.size);
    const trail = new THREE.Mesh(
      this._projTrailGeo,
      new THREE.MeshBasicMaterial({ color: spec.trail, transparent: true, opacity: 0.64, depthWrite: false }),
    );
    trail.scale.set(spec.size * 0.26, 1, spec.size * 0.26);
    core.renderOrder = 30;
    trail.renderOrder = 29;
    this.scene.add(trail, core);
    this.projectiles.push({ core, trail, from, to, t: 0, dur, spec, impact: extra.impact || e.impact || null });
  }

  _destroyProjectile(p) {
    if (!p) return;
    this.scene.remove(p.core, p.trail);
    if (p.core.material) p.core.material.dispose();
    if (p.trail.material) p.trail.material.dispose();
  }

  _projectilePos(p, q, out) {
    const s = clamp(q, 0, 1);
    out.set(
      lerp(p.from.x, p.to.x, s),
      lerp(p.from.y, p.to.y, s) + Math.sin(s * Math.PI) * p.spec.arc,
      lerp(p.from.z, p.to.z, s),
    );
    return out;
  }

  _updateProjectiles(dt) {
    if (!this.projectiles.length) return;
    const head = new THREE.Vector3();
    const tail = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      const q = Math.min(1, p.t / p.dur);
      this._projectilePos(p, q, head);
      this._projectilePos(p, q - p.spec.tail, tail);
      p.core.position.copy(head);
      const pulse = 1 + Math.sin(q * Math.PI * 6) * 0.12;
      p.core.scale.setScalar(p.spec.size * pulse);
      mid.copy(head).add(tail).multiplyScalar(0.5);
      dir.copy(head).sub(tail);
      const len = Math.max(0.04, dir.length());
      p.trail.position.copy(mid);
      p.trail.scale.set(p.spec.size * 0.24, len, p.spec.size * 0.24);
      p.trail.quaternion.setFromUnitVectors(this._projUp, dir.normalize());
      const fade = q > 0.82 ? (1 - q) / 0.18 : 1;
      p.core.material.opacity = Math.max(0, fade);
      p.trail.material.opacity = Math.max(0, 0.64 * fade);
      if (q >= 1) {
        this._projectileImpact(p);
        this._destroyProjectile(p);
        this.projectiles.splice(i, 1);
      }
    }
  }

  _projectileImpact(p) {
    const kind = p.impact?.kind || p.spec.kind;
    const color = p.impact?.color ?? p.spec.color;
    const x = p.to.x, y = p.to.y, z = p.to.z;
    if (p.impact?.ring !== false) {
      this._impactRing(x, z, {
        color,
        count: p.impact?.count || (kind === 'ballista' ? 18 : 12),
        radius: p.impact?.radius || (kind === 'ballista' ? 1.35 : kind === 'flame' ? 1.25 : 0.9),
        life: p.impact?.life || 0.22,
        size: p.impact?.size || p.spec.size * 1.5,
      });
    }
    this.burst(x, y, z, {
      count: p.impact?.burst || (kind === 'flame' ? 16 : kind === 'shotgun' ? 8 : 5),
      color,
      speed: p.impact?.speed || (kind === 'flame' ? 2.4 : 1.4),
      life: p.impact?.life || 0.32,
      size: p.impact?.size || p.spec.size * 1.7,
      up: p.impact?.up || 1.1,
      spread: p.impact?.spread || 0.12,
    });
  }

  _impactRing(x, z, { color = 0xffd75e, count = 14, radius = 1.1, life = 0.22, size = 0.36 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.burst(x + Math.cos(a) * radius, 0.18, z + Math.sin(a) * radius,
        { count: 1, color, speed: 0.45, life, size, spread: 0.02, up: 0.2 });
    }
  }

  _spawnAbilityRing(x, z, { color, radius = 1, to = radius, life = 0.5, opacity = 0.8, width = 0.16, delay = 0 } = {}) {
    const geo = new THREE.RingGeometry(Math.max(0.05, radius - width), radius, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.11, z);
    this.scene.add(mesh);
    this.abilityFx.push({ mesh, t: -delay, life, from: radius, to, opacity });
  }

  _updateAbilityFx(dt) {
    for (let i = this.abilityFx.length - 1; i >= 0; i--) {
      const fx = this.abilityFx[i];
      fx.t += dt;
      if (fx.t < 0) continue;
      const p = Math.min(1, fx.t / fx.life);
      const scale = (fx.from + (fx.to - fx.from) * p) / fx.from;
      fx.mesh.scale.setScalar(scale);
      fx.mesh.material.opacity = fx.opacity * Math.sin(p * Math.PI);
      if (p >= 1) {
        this.scene.remove(fx.mesh);
        fx.mesh.geometry.dispose();
        fx.mesh.material.dispose();
        this.abilityFx.splice(i, 1);
      }
    }
  }

  _updateParticles(dt) {
    let n = this.pcount;
    for (let i = 0; i < n; i++) {
      const o = i * 8;
      this.pdata[o + 6] -= dt;
      if (this.pdata[o + 6] <= 0) {
        n--;
        this.pdata.copyWithin(o, n * 8, n * 8 + 8);
        this.pCol.copyWithin(i * 3, n * 3, n * 3 + 3);
        this.pSize[i] = this.pSize[n];
        i--;
        continue;
      }
      this.pdata[o] += this.pdata[o + 3] * dt;
      this.pdata[o + 1] += this.pdata[o + 4] * dt;
      this.pdata[o + 2] += this.pdata[o + 5] * dt;
      this.pdata[o + 4] -= 6 * dt; // gravity
      if (this.pdata[o + 1] < 0.02) { this.pdata[o + 1] = 0.02; this.pdata[o + 4] *= -0.3; }
      const k = i * 3;
      this.pPos[k] = this.pdata[o];
      this.pPos[k + 1] = this.pdata[o + 1];
      this.pPos[k + 2] = this.pdata[o + 2];
    }
    this.pcount = n;
    this.points.geometry.setDrawRange(0, n);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
  }

  // ---------------- zombies (instanced) ----------------

  _setupZombieMeshes() {
    const bodyGeo = new THREE.BoxGeometry(0.34, 0.6, 0.22);
    bodyGeo.translate(0, 0.42, 0);
    const headGeo = new THREE.SphereGeometry(0.155, 8, 6);
    headGeo.translate(0, 0.85, 0.03);
    const armGeo = new THREE.BoxGeometry(0.5, 0.1, 0.34);
    armGeo.translate(0, 0.6, 0.28);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });

    // Glowing eye-strip (unlit material — burns through the navy night).
    const eyeGeo = new THREE.BoxGeometry(0.18, 0.05, 0.04);
    eyeGeo.translate(0, 0.87, 0.16);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.zBody = new THREE.InstancedMesh(bodyGeo, mat, ZMAX);
    this.zHead = new THREE.InstancedMesh(headGeo, mat.clone(), ZMAX);
    this.zArm = new THREE.InstancedMesh(armGeo, mat.clone(), ZMAX);
    this.zEyes = new THREE.InstancedMesh(eyeGeo, eyeMat, ZMAX);
    for (const m of [this.zBody, this.zHead, this.zArm, this.zEyes]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = m !== this.zEyes;
      m.frustumCulled = false;
      m.count = 0;
      this.scene.add(m);
    }
    this._zdummy = new THREE.Object3D();
    this._zcolor = new THREE.Color();
  }

  _updateZombieMeshes(t, dt = 0) {
    const g = this.game;
    const n = Math.min(g.zombies.length, ZMAX);
    const d = this._zdummy, c = this._zcolor;
    for (let i = 0; i < n; i++) {
      const zb = g.zombies[i];
      const bob = Math.sin(t * 7 + zb.phase) * 0.05;
      const yaw = Math.atan2(zb.dirX, zb.dirZ);
      // Hit pulse: a fast, meaty squash on damage.
      const pulse = zb.hitFlash > 0 ? 1 + zb.hitFlash * 1.4 : 1;
      const s = zb.def.scale;
      let lunge = 0;
      const attack = this.zombieAttacks.get(zb.id);
      if (attack) {
        attack.t -= dt;
        if (attack.t <= 0) this.zombieAttacks.delete(zb.id);
        else lunge = Math.sin((1 - attack.t / attack.dur) * Math.PI) * 0.42;
      }
      const ax = attack ? attack.tx - zb.x : Math.sin(yaw);
      const az = attack ? attack.tz - zb.z : Math.cos(yaw);
      const ad = Math.hypot(ax, az) || 1;
      d.position.set(zb.x + (ax / ad) * lunge, bob, zb.z + (az / ad) * lunge);
      d.rotation.set((zb.state === 2 ? 0.22 : 0.05) + lunge * 0.8, yaw, Math.sin(t * 5 + zb.phase) * 0.06);
      d.scale.set(s * (pulse + lunge * 0.25), s * (2 - pulse - lunge * 0.2), s * (pulse + lunge * 0.25));
      d.updateMatrix();
      this.zBody.setMatrixAt(i, d.matrix);
      this.zHead.setMatrixAt(i, d.matrix);
      this.zArm.setMatrixAt(i, d.matrix);
      this.zEyes.setMatrixAt(i, d.matrix);
      if (lunge > 0.01) c.setRGB(1.7, 0.65, 0.55);
      else if (zb.hitFlash > 0) c.setRGB(1.6, 1.2, 1.2);
      else if (zb.auraSources && zb.auraSources.length) c.setHex(0x9fd6ff);
      else c.setHex(zb.def.color);
      this.zBody.setColorAt(i, c);
      this.zArm.setColorAt(i, c);
      c.multiplyScalar(0.8);
      this.zHead.setColorAt(i, c);
      // Eyes: hunting dead burn red, idle wanderers smoulder amber.
      c.setHex(zb.auraSources && zb.auraSources.length ? 0x7fd6ff : zb.state === 2 ? 0xff4636 : 0xd8973a);
      this.zEyes.setColorAt(i, c);
    }
    for (const m of [this.zBody, this.zHead, this.zArm, this.zEyes]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  // ---------------- coins ----------------

  _setupCoins() {
    const MAXC = 400;
    const geo = new THREE.CylinderGeometry(0.22, 0.22, 0.07, 12);
    const mat = new THREE.MeshLambertMaterial({ color: 0xf5c542, emissive: 0xc79a1e, emissiveIntensity: 0.55 });
    this.coinMesh = new THREE.InstancedMesh(geo, mat, MAXC);
    this.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coinMesh.castShadow = true;
    this.coinMesh.frustumCulled = false;
    this.coinMesh.count = 0;
    this.scene.add(this.coinMesh);
    this.coinBorn = new Map(); // coin id -> spawn time (for the pop-out bounce)
  }

  _updateCoins(t) {
    const g = this.game;
    const d = this._zdummy;
    let i = 0;
    for (const cn of g.coins) {
      if (i >= 400) break;
      if (!this.coinBorn.has(cn.id)) this.coinBorn.set(cn.id, t);
      const age = t - this.coinBorn.get(cn.id);
      // Pop out of the building with a little bounce, then hover and spin.
      const bounce = age < 0.5 ? Math.abs(Math.sin(age * Math.PI * 2)) * (0.5 - age) * 2.2 : 0;
      const big = cn.v >= 4 ? 1.5 : 1;
      d.position.set(cn.x, 0.32 + bounce + Math.sin(t * 2.5 + cn.id) * 0.07, cn.z);
      d.rotation.set(Math.PI / 2 + 0.35, 0, t * 2.2 + cn.id);
      d.scale.setScalar(big);
      d.updateMatrix();
      this.coinMesh.setMatrixAt(i, d.matrix);
      i++;
    }
    if (this.coinBorn.size > 600) {
      const live = new Set(g.coins.map((cn) => cn.id));
      for (const id of this.coinBorn.keys()) if (!live.has(id)) this.coinBorn.delete(id);
    }
    this.coinMesh.count = i;
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------- corpse physics ----------------
  // Cheap ballistic ragdolls: killed zombies get launched away from the
  // damage source, tumble through the air, bounce, and sink into the mud.

  _setupCorpses() {
    const MAXC = 300;
    const geo = new THREE.BoxGeometry(0.36, 0.62, 0.24);
    this.corpseMesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXC);
    this.corpseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.corpseMesh.castShadow = true;
    this.corpseMesh.frustumCulled = false;
    this.corpseMesh.count = 0;
    this.scene.add(this.corpseMesh);
    this.corpses = [];
  }

  spawnCorpse(e) {
    if (this.corpses.length >= 300) this.corpses.shift();
    const f = e.force || 1;
    const sp = 2.5 * f + Math.random() * 2;
    this.corpses.push({
      x: e.x, y: 0.5, z: e.z,
      vx: (e.dx || 0) * sp + (Math.random() - 0.5), vy: 2.2 + 3.2 * f * Math.random(), vz: (e.dz || 0) * sp + (Math.random() - 0.5),
      rx: Math.random() * Math.PI * 2, ry: Math.random() * Math.PI * 2, rz: 0,
      wx: (Math.random() - 0.5) * 10 * f, wy: (Math.random() - 0.5) * 6,
      life: 6 + Math.random() * 3, scale: e.big ? 1.7 : 1,
      color: e.big ? 0x4a3356 : 0x54702e,
    });
  }

  _updateCorpses(dt) {
    const d = this._zdummy, c = this._zcolor;
    let i = 0;
    for (const p of this.corpses) {
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.y > 0.16 || Math.abs(p.vy) > 0.5) {
        p.vy -= 22 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rx += p.wx * dt; p.ry += p.wy * dt;
        if (p.y < 0.16) { p.y = 0.16; p.vy *= -0.35; p.vx *= 0.55; p.vz *= 0.55; p.wx *= 0.4; }
      } else {
        p.rx = Math.PI / 2; // settled flat
        if (p.life < 1.5) p.y = 0.16 - (1.5 - p.life) * 0.2; // sink away
      }
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.rx, p.ry, p.rz);
      d.scale.setScalar(p.scale);
      d.updateMatrix();
      this.corpseMesh.setMatrixAt(i, d.matrix);
      c.setHex(p.color);
      this.corpseMesh.setColorAt(i, c);
      i++;
    }
    this.corpses = this.corpses.filter((p) => p.life > 0);
    this.corpseMesh.count = i;
    this.corpseMesh.instanceMatrix.needsUpdate = true;
    if (this.corpseMesh.instanceColor) this.corpseMesh.instanceColor.needsUpdate = true;
  }

  // ---------------- health bars ----------------

  _setupBars() {
    const MAXB = 300;
    const bgGeo = new THREE.PlaneGeometry(1, 0.12);
    const fgGeo = new THREE.PlaneGeometry(1, 0.12);
    fgGeo.translate(0.5, 0, 0); // scale from the left edge
    this.barBg = new THREE.InstancedMesh(bgGeo, new THREE.MeshBasicMaterial({ color: 0x1a1a22, depthWrite: false }), MAXB);
    this.barFg = new THREE.InstancedMesh(fgGeo, new THREE.MeshBasicMaterial({ depthWrite: false }), MAXB);
    for (const m of [this.barBg, this.barFg]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.renderOrder = 10;
      m.count = 0;
      this.scene.add(m);
    }
  }

  _updateBars() {
    const g = this.game;
    const d = this._zdummy, c = this._zcolor;
    let i = 0;
    const MAXB = 300;
    const q = this.camera.quaternion;

    const add = (x, y, z, frac, w) => {
      if (i >= MAXB) return;
      d.position.set(x, y, z);
      d.quaternion.copy(q);
      d.scale.set(w, 1, 1);
      d.updateMatrix();
      this.barBg.setMatrixAt(i, d.matrix);
      const left = new THREE.Vector3(-w / 2, 0, 0).applyQuaternion(q);
      d.position.set(x + left.x, y + left.y + 0.001, z + left.z);
      d.scale.set(Math.max(0.01, w * frac), 1, 1);
      d.updateMatrix();
      this.barFg.setMatrixAt(i, d.matrix);
      c.setHSL(lerp(0, 0.33, frac), 0.9, 0.45);
      this.barFg.setColorAt(i, c);
      i++;
    };

    for (const b of g.buildings) {
      if (b.hp < b.maxHp) add(b.cx, this._buildingHeight(b.kind) + 0.5, b.cz, b.hp / b.maxHp, Math.max(1.2, b.size * 0.8));
    }
    for (const n of g.nests) {
      if (n.alive && n.hp < n.maxHp) add(n.x, 2.6, n.z, n.hp / n.maxHp, 2.2);
    }
    for (const u of g.units) {
      if (u.hp < u.maxHp) add(u.x, 1.45, u.z, Math.max(0, u.hp / u.maxHp), 0.8);
    }
    for (const zb of g.zombies) {
      if (zb.type === 'brute' && zb.hp < zb.maxHp) { add(zb.x, 2.1, zb.z, zb.hp / zb.maxHp, 1.1); if (i >= MAXB) break; }
    }
    this.barBg.count = this.barFg.count = i;
    this.barBg.instanceMatrix.needsUpdate = true;
    this.barFg.instanceMatrix.needsUpdate = true;
    if (this.barFg.instanceColor) this.barFg.instanceColor.needsUpdate = true;
  }

  _buildingHeight(kind) {
    return { hq: 4.2, mill: 3.4, tower: 3.2, camp_militia: 2.2, camp_ranger: 2.2, camp_sniper: 2.2,
      outpost: 3.1, workshop: 2.8, hero_forge: 3.4, wall: 1.2 }[kind] || 2.0;
  }

  // ---------------- plot foundations ----------------

  _makeLabelSprite(text, sub = '') {
    const cnv = document.createElement('canvas');
    cnv.width = 256; cnv.height = 128;
    const ctx = cnv.getContext('2d');
    ctx.textAlign = 'center';
    ctx.font = '64px serif';
    ctx.fillText(text, 128, 62);
    if (sub) {
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.fillStyle = '#ffd75e';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 6;
      ctx.strokeText(sub, 128, 108);
      ctx.fillText(sub, 128, 108);
    }
    const tex = new THREE.CanvasTexture(cnv);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(2.4, 1.2, 1);
    return sp;
  }

  _plotRole(plot, nt, compact = false) {
    if (!nt || nt.branch) return compact ? 'choose' : 'Choose its final upgrade.';
    const def = nt.def;
    const kind = PLOT_KINDS[plot.kind];
    const roles = [];
    if (kind.unit) {
      const u = UNITS[kind.unit];
      const count = def.count || 0;
      roles.push(compact
        ? `${count} ${u.icon}/${def.every}s`
        : `Musters ${count} ${u.name}${count === 1 ? '' : 's'} every ${def.every}s, forever.`);
    }
    if (def.dmg) {
      const splash = def.splash ? ' splash' : '';
      roles.push(compact ? `${def.dmg} dmg` : `${def.dmg} damage${splash}, ${def.range} tile range.`);
    }
    if (def.income) roles.push(compact ? `+${Math.round(def.income)} coin` : `Adds ${Math.round(def.income)} to your income.`);
    if (def.repairRate) roles.push(compact ? `${def.repairRate}/s repair` : `Automatically repairs ${def.repairRate} HP/s within ${def.repairRadius} tiles.`);
    if (def.heroDmg) roles.push(compact ? `heroes +${Math.round(def.heroDmg * 100)}% dmg` : `All heroes gain +${Math.round(def.heroDmg * 100)}% damage, +${def.heroHp} HP, and ${Math.round(def.heroCdr * 100)}% cooldown reduction.`);
    if (roles.length) return roles.join(compact ? ' · ' : ' ');
    if (def.zap) return compact ? 'zap wall' : `Damages and slows enemies that chew it.`;
    if (plot.kind === 'wall') return compact ? `${def.hp} HP` : `${def.hp} HP barrier. Blocks and buys time.`;
    return compact ? `${def.hp} HP` : `${def.hp} HP structure.`;
  }

  _makePipSprite() {
    const cnv = document.createElement('canvas');
    cnv.width = 256; cnv.height = 96;
    const tex = new THREE.CanvasTexture(cnv);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(3.0, 1.125, 1);
    return { sprite, ctx: cnv.getContext('2d'), tex, key: -1 };
  }

  // Draw `total` coin slots, `filled` of them paid — gold discs vs open rings.
  _drawPips(pips, total, filled) {
    const key = total * 100 + filled;
    if (pips.key === key) return;
    pips.key = key;
    const ctx = pips.ctx;
    ctx.clearRect(0, 0, 256, 96);
    const perRow = Math.min(total, 6);
    const rows = Math.ceil(total / perRow);
    for (let i = 0; i < total; i++) {
      const row = (i / perRow) | 0;
      const inRow = row === rows - 1 ? total - perRow * row : perRow;
      const cx = 128 - (inRow * 36) / 2 + 18 + (i - row * perRow) * 36;
      const cy = 30 + row * 38 - (rows - 1) * 10;
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      if (i < filled) {
        ctx.fillStyle = '#f5c542';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#8a6a1e';
      } else {
        ctx.fillStyle = 'rgba(10,14,30,0.3)';
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      }
      ctx.stroke();
    }
    pips.tex.needsUpdate = true;
  }

  // The Thronefall "stump", sci-fi: one small survey beacon per plot — a
  // gunmetal pylon with a spinning amber holo-gem. Everything else (ghost,
  // pips, icon) only appears when you ride up close.
  _makeBeacon(x, z) {
    const grp = new THREE.Group();
    const pylon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.11, 0.55, 6),
      new THREE.MeshLambertMaterial({ color: 0x565c60 }),
    );
    pylon.position.set(x, 0.28, z);
    pylon.castShadow = true;
    grp.add(pylon);
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.17, 0),
      new THREE.MeshLambertMaterial({ color: 0xffb84d, emissive: 0xffb84d, emissiveIntensity: 0.8, transparent: true, opacity: 0.9 }),
    );
    gem.position.set(x, 0.95, z);
    grp.add(gem);
    grp.userData.gem = gem;
    return grp;
  }

  _makePlotGroup(plot) {
    const g = new THREE.Group();
    const kind = PLOT_KINDS[plot.kind];
    const anchor = plot.anchor || plot.gate;
    const [mx, mz] = plot.kind === 'wall' && anchor ? [anchor[0] + 0.5, anchor[1] + 0.5] : [plot.cx, plot.cz];
    const beacon = this._makeBeacon(mx, mz);
    g.add(beacon);
    g.userData.beacon = beacon;
    const label = this._makeLabelSprite(kind.icon, '');
    label.position.set(mx, 2.1, mz);
    g.add(label);
    g.userData.label = label;
    g.userData.labelPos = [mx, mz];

    // Ghost preview: a translucent night-blue silhouette of the building that
    // WILL rise here — you see what you're paying for (Thronefall's trick).
    if (plot.kind !== 'wall' && plot.kind !== 'hq') {
      const preview = {
        kind: plot.kind, branch: null, plotTier: 1, gate: false,
        size: plot.size, x: plot.x, z: plot.z, cx: plot.cx, cz: plot.cz, id: 0,
      };
      const ghost = this._makeBuildingMesh(preview);
      if (!this._ghostMat) {
        // Unlit night-blue: reads as a shadow of the future, never as stone.
        this._ghostMat = new THREE.MeshBasicMaterial({ color: 0x1c2438, transparent: true, opacity: 0.45, depthWrite: false });
      }
      ghost.traverse((o) => { if (o.isMesh) { o.material = this._ghostMat; o.castShadow = false; o.receiveShadow = false; } });
      ghost.position.set(plot.cx, 0, plot.cz);
      g.add(ghost);
      g.userData.ghost = ghost;
    }

    // Coin pips: the cost as a row of slots that FILL as your gold streams in.
    const pips = this._makePipSprite();
    const [lx0, lz0] = g.userData.labelPos;
    pips.sprite.position.set(lx0, 3.0, lz0);
    g.add(pips.sprite);
    g.userData.pips = pips;

    // Glow ring at the pay point + radial progress arc.
    const [px, pz] = this.game.payPoint(plot);
    const ringGeo = new THREE.RingGeometry(1.35, 1.55, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.35, depthWrite: false }));
    ring.position.set(px, 0.05, pz);
    g.add(ring);
    g.userData.ring = ring;

    const prog = new THREE.Mesh(
      new THREE.RingGeometry(1.05, 1.32, 40, 1, -Math.PI / 2, 0.01),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    );
    prog.rotation.x = -Math.PI / 2;
    prog.position.set(px, 0.07, pz);
    g.add(prog);
    g.userData.prog = prog;
    g.userData.progFrac = 0;
    g.userData.payPoint = [px, pz];
    return g;
  }

  _syncPlots(t) {
    const g = this.game;
    const mh = this.myHero();
    const buildMode = this.controlMode !== 'fight';
    if (this._ghostMat) this._ghostMat.opacity = 0.42 + Math.sin(t * 1.8) * 0.08;
    // Pips belong to ONE plot: the nearest fundable one within reach.
    let pipPlotId = -1;
    if (buildMode && mh && !mh.dead) {
      let bd = 4.5 * 4.5;
      for (const plot of g.plots) {
        const act = g.plotAction(plot);
        if (!act || act.mode === 'branch') continue;
        const [px, pz] = g.payPoint(plot, mh);
        const d = (mh.x - px) ** 2 + (mh.z - pz) ** 2;
        if (d < bd) { bd = d; pipPlotId = plot.id; }
      }
    }
    for (const plot of g.plots) {
      // A Forward Camp doesn't exist until the node under it is yours.
      if (g.plotLocked(plot)) {
        const hidden = this.plotMeshes.get(plot.id);
        if (hidden) hidden.group.visible = false;
        continue;
      }
      let rec = this.plotMeshes.get(plot.id);
      if (!rec) {
        const group = this._makePlotGroup(plot);
        this.scene.add(group);
        rec = { group, tier: -1 };
        this.plotMeshes.set(plot.id, rec);
      }
      rec.group.visible = true;
      const ud = rec.group.userData;
      const act = g.plotAction(plot);
      // `nt` keeps the shape the rest of this function has always read.
      const nt = !act ? null
        : act.mode === 'branch' ? act.nt
        : { def: act.def || { name: act.label }, cost: act.cost, mode: act.mode };
      const built = plot.tier > 0 && !plot.ruined;
      if (!buildMode && !built) {
        rec.group.visible = false;
        continue;
      }
      // Foundation scenery (pad, posts, rubble, ghost) hides once built.
      rec.group.children.forEach((ch) => {
        if (ch !== ud.label && ch !== ud.ring && ch !== ud.prog && (!ud.pips || ch !== ud.pips.sprite)) ch.visible = !built;
      });

      if (!nt || !buildMode) { // fully built/maxed, or Fight mode hides build affordances.
        ud.label.visible = false;
        ud.ring.visible = false;
        ud.prog.visible = false;
        if (ud.pips) ud.pips.sprite.visible = false;
        continue;
      }

      const activePayPoint = mh && !mh.dead ? g.payPoint(plot, mh) : ud.payPoint;
      const heroNear = mh && !mh.dead &&
        (mh.x - activePayPoint[0]) ** 2 + (mh.z - activePayPoint[1]) ** 2 < 100;
      // Minimal at distance: only the beacon marks a plot. Icon, ghost and
      // pips appear when this is the plot you'd actually fund.
      const active = plot.id === pipPlotId || (nt.branch && heroNear);
      if (active && activePayPoint) {
        ud.ring.position.set(activePayPoint[0], 0.05, activePayPoint[1]);
        ud.prog.position.set(activePayPoint[0], 0.07, activePayPoint[1]);
      } else if (ud.payPoint) {
        ud.ring.position.set(ud.payPoint[0], 0.05, ud.payPoint[1]);
        ud.prog.position.set(ud.payPoint[0], 0.07, ud.payPoint[1]);
      }
      if (ud.ghost) ud.ghost.visible = !built && plot.id === pipPlotId;
      if (ud.beacon.visible) {
        const gem = ud.beacon.userData.gem;
        gem.rotation.y = t * 2;
        gem.position.y = 0.95 + Math.sin(t * 2.4 + plot.id) * 0.08;
      }
      const wantSub = nt.branch ? 'choose!'
        : nt.mode === 'repair' ? 'repair'
        : nt.mode === 'rebuild' ? 'rebuild'
        : this._plotRole(plot, nt, true);
      const wantKey = (built ? '⬆' : PLOT_KINDS[plot.kind].icon) + '|' + wantSub;
      ud.label.visible = active;
      if (ud.label.visible && ud.labelKey !== wantKey) {
        ud.labelKey = wantKey;
        const [lx, lz] = ud.labelPos;
        rec.group.remove(ud.label);
        ud.label = this._makeLabelSprite(built ? '⬆️' : PLOT_KINDS[plot.kind].icon, wantSub);
        ud.label.position.set(lx, built ? 3.1 : 2.1, lz);
        rec.group.add(ud.label);
      }
      if (ud.label.visible) ud.label.position.y = (built ? 3.1 : 2.1) + Math.sin(t * 2 + plot.id) * 0.12;

      // Coin pips: cost as slots, filling as gold streams in — shown only
      // when you ride close (a city of floating rings is noise, not info).
      if (ud.pips) {
        ud.pips.sprite.visible = plot.id === pipPlotId && !nt.branch;
        if (ud.pips.sprite.visible) {
          const total = Math.max(1, Math.min(12, Math.ceil(nt.cost)));
          const filled = Math.min(total, Math.floor((plot.paid / nt.cost) * total + 1e-6));
          this._drawPips(ud.pips, total, filled);
          ud.pips.sprite.position.y = (built ? 4.1 : 3.0) + Math.sin(t * 2 + plot.id) * 0.12;
        }
      }

      // Ring: pulse when affordable, glow bright while paying.
      ud.ring.visible = true;
      const affordable = !nt.branch && g.gold + plot.paid >= 1;
      const paying = (plot.payFx || 0) > 0;
      if (paying) plot.payFx -= 1 / 60;
      ud.ring.material.color.setHex(nt.branch ? 0xb98fdc : paying ? 0xfff2c8 : 0xffd75e);
      ud.ring.material.opacity = paying ? 0.9 : affordable ? 0.35 + Math.sin(t * 3 + plot.id) * 0.15 : 0.12;

      // Progress arc.
      const frac = nt.branch ? 0 : clamp(plot.paid / nt.cost, 0, 1);
      ud.prog.visible = frac > 0.002;
      if (Math.abs(frac - ud.progFrac) > 0.02 || (frac === 1) !== (ud.progFrac === 1)) {
        ud.progFrac = frac;
        ud.prog.geometry.dispose();
        ud.prog.geometry = new THREE.RingGeometry(1.05, 1.32, 40, 1, -Math.PI / 2, Math.max(0.01, frac * Math.PI * 2));
      }

      // (Coin flight itself rides the 'paycoin' event — see _spawnPayCoins.)
    }
  }

  // ---------------- building meshes ----------------

  _makeBuildingMesh(b) {
    const g = new THREE.Group();
    const M = (color, e = 0) => new THREE.MeshLambertMaterial({ color, emissive: e ? color : 0x000000, emissiveIntensity: e });
    const box = (w, h, dep, color, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), M(color));
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m); return m;
    };
    const cyl = (r1, r2, h, color, x = 0, y = 0, z = 0, seg = 10) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), M(color));
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m); return m;
    };
    const cone = (r, h, color, x = 0, y = 0, z = 0, seg = 4) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), M(color));
      m.position.set(x, y, z);
      m.rotation.y = Math.PI / 4;
      m.castShadow = true;
      g.add(m); return m;
    };
    const windows = (n, y, r, color = 0xffca6e) => {
      // Emissive windows that glow at night (renderer toggles intensity).
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.4;
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.03), M(color, 0.0));
        w.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
        w.lookAt(Math.cos(a) * 2 * r, y, Math.sin(a) * 2 * r);
        w.userData.window = true;
        g.add(w);
      }
    };
    const tier = b.plotTier || 1;

    switch (b.kind) {
      case 'hq': {
        box(3.6, 1.2, 3.6, 0xd8d4c6, 0, 0.6);
        box(2.5, 1.1, 2.5, 0xc9c4b4, 0, 1.7);
        cyl(0.55, 0.65, 2.2, 0xcfcaba, 1.15, 1.8, 1.15, 8);
        cone(0.8, 0.9, 0xa8352e, 1.15, 3.3, 1.15);
        if (tier >= 2) { cyl(0.55, 0.65, 2.2, 0xcfcaba, -1.15, 1.8, -1.15, 8); cone(0.8, 0.9, 0xa8352e, -1.15, 3.3, -1.15); }
        if (tier >= 3) {
          box(1.6, 1.2, 1.6, 0xd4cfc0, 0, 2.9);
          cone(1.2, 1.1, 0xbf3f34, 0, 4.1);
        } else {
          cone(1.7, 1.0, 0x8f2d28, 0, 2.7, 0);
        }
        box(0.06, 1.8, 0.06, 0x333333, -1.1, 3.3, -1.1);
        const flag = box(0.7, 0.4, 0.02, 0xc85a48, -0.72, 3.9, -1.1);
        g.userData.flag = flag;
        windows(6, 1.0, 1.75);
        break;
      }
      case 'house': {
        if (tier === 1) {
          box(1.3, 0.7, 1.1, 0xd8d4c6, 0, 0.35);
          cone(1.0, 0.7, 0xa8352e, 0, 1.05);
        } else if (tier === 2) {
          box(1.5, 1.0, 1.3, 0xdcd8ca, 0, 0.5);
          cone(1.15, 0.8, 0xa8352e, 0, 1.4);
          box(0.35, 0.5, 0.06, 0x565c60, 0, 0.25, 0.68);
        } else {
          box(1.6, 1.5, 1.4, 0xe0dccd, 0, 0.75);
          box(1.0, 0.8, 1.0, 0xbfbaaa, 0.5, 1.9, 0.3);
          cone(1.25, 0.9, 0x8f2d28, 0, 2.0);
          cone(0.8, 0.7, 0x8f2d28, 0.5, 2.6, 0.3);
        }
        windows(tier + 1, tier >= 3 ? 0.8 : 0.4, 0.72);
        break;
      }
      case 'farm': {
        box(1.9, 0.1, 1.9, 0x6e5a40, 0, 0.05);
        for (let r = 0; r < 3; r++) box(1.7, 0.16, 0.34, tier >= 2 ? 0x5fd889 : 0x3fae64, 0, 0.14, -0.6 + r * 0.6);
        if (tier >= 2) { box(0.6, 0.55, 0.6, 0xd8d4c6, 0.65, 0.32, 0.65); cone(0.55, 0.45, 0xa8352e, 0.65, 0.82, 0.65); }
        break;
      }
      case 'mill': {
        cyl(0.5, 0.7, tier >= 2 ? 2.8 : 2.2, 0xd4cfc0, 0, tier >= 2 ? 1.4 : 1.1, 0, 8);
        cone(0.66, 0.7, 0xa8352e, 0, tier >= 2 ? 3.15 : 2.5, 0, 8);
        const rotor = new THREE.Group();
        rotor.position.set(0, tier >= 2 ? 2.7 : 2.1, 0.58);
        for (let i = 0; i < 4; i++) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.5, 0.04), M(0xd9d2ba));
          blade.position.y = 0.8;
          blade.castShadow = true;
          const pivot = new THREE.Group();
          pivot.rotation.z = (i * Math.PI) / 2;
          pivot.add(blade);
          rotor.add(pivot);
        }
        g.add(rotor);
        g.userData.rotor = rotor;
        break;
      }
      case 'mine': {
        box(1.9, 0.22, 1.9, 0x8a9094, 0, 0.11);
        box(0.8, 0.8, 0.8, 0x565c60, 0, 0.62);
        box(0.12, 1.8, 0.12, 0x4a4440, -0.45, 1.1, -0.45);
        box(0.12, 1.8, 0.12, 0x4a4440, 0.45, 1.1, -0.45);
        box(1.2, 0.14, 0.5, 0x4a4440, 0, 2.0, -0.45);
        const wheel = cyl(0.34, 0.34, 0.16, 0xf3c53d, 0, 2.0, -0.45, 12);
        wheel.rotation.x = Math.PI / 2;
        g.userData.rotor = wheel;
        if (tier >= 2) box(1.0, 0.5, 0.7, 0x6e7478, 0.55, 0.25, 0.6);
        break;
      }
      case 'tower': {
        const h = 2.2 + tier * 0.45;
        cyl(0.65, 0.85, h, tier >= 3 ? 0xb0b4b2 : 0xa6aaa8, 0, h / 2, 0, 8);
        box(1.6, 0.22, 1.6, 0x3d4246, 0, h + 0.11);
        for (const [dx, dz] of [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]]) {
          box(0.2, 0.32, 0.2, 0x3d4246, dx, h + 0.35, dz);
        }
        const head = new THREE.Group();
        head.position.y = h + 0.35;
        if (b.branch === 'flame') {
          const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.28, 0.35, 8), M(0x3d4246));
          head.add(bowl);
          const fire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 6), M(0xff7a2e, 0.9));
          fire.position.y = 0.4;
          head.add(fire);
          g.userData.flame = fire;
        } else {
          const bal = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, b.branch === 'ballista' ? 1.5 : 0.9), M(0x4a4440));
          bal.position.z = 0.1;
          bal.castShadow = true;
          head.add(bal);
          if (b.branch === 'ballista') {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.08), M(0x565c60));
            arm.position.set(0, 0.1, 0.55);
            head.add(arm);
          }
        }
        g.add(head);
        g.userData.head = head;
        break;
      }
      case 'wall': {
        // Connected rampart: each tile grows curtain panels toward every
        // neighboring wall tile, so the whole ring reads as ONE wall — no
        // corner gaps, no floating cubes. Gates become real gatehouses.
        const N = this.game.map.size;
        if (!this._wallTiles) {
          this._wallTiles = new Set();
          for (const p of this.game.plots) {
            if (p.kind === 'wall') for (const [x, z] of p.tiles) this._wallTiles.add(z * N + x);
          }
        }
        const nb = {
          e: this._wallTiles.has(b.z * N + b.x + 1), w: this._wallTiles.has(b.z * N + b.x - 1),
          s: this._wallTiles.has((b.z + 1) * N + b.x), n: this._wallTiles.has((b.z - 1) * N + b.x),
        };
        // Barrier ladder: razorwire fence → plasteel barricade → shock/bastion.
        const shock = b.branch === 'shock';
        const bastion = b.branch === 'bastion';
        const capCol = 0x3d4246;
        const alongX = nb.e || nb.w; // wall runs east-west → passage runs north-south
        if (tier === 1 && !b.gate) {
          // Razorwire: gunmetal post + taut wire strands to each neighbor.
          box(0.16, 0.78, 0.16, 0x565c60, 0, 0.39);
          box(0.2, 0.06, 0.2, 0xe8a83c, 0, 0.81); // hazard cap
          const wires = [
            nb.e && [0.5, 0.25, 0], nb.w && [0.5, -0.25, 0],
            nb.s && [0, 0, 0.25], nb.n && [0, 0, -0.25],
          ].filter(Boolean);
          for (const [wx, px, pz] of wires) {
            for (const wy of [0.3, 0.6]) {
              box(wx ? 0.5 : 0.045, 0.045, wx ? 0.045 : 0.5, 0x9aa0a2, px, wy, pz);
            }
          }
          break;
        }
        const H = bastion ? 1.55 : tier >= 3 ? 1.1 : tier === 1 ? 0.8 : 0.95;
        const stone = bastion ? 0xa8aeae : tier === 1 ? 0x767c7e : 0x8f9698;
        if (b.gate) {
          // Gatehouse: two towers flanking the passage, an arch overhead.
          const towH = H + 0.75;
          for (const side of [-1, 1]) {
            const px = alongX ? 0 : side * 0.38, pz = alongX ? side * 0.38 : 0;
            box(alongX ? 0.9 : 0.34, towH, alongX ? 0.34 : 0.9, stone, px, towH / 2, pz);
            box(alongX ? 1.0 : 0.44, 0.16, alongX ? 0.44 : 1.0, capCol, px, towH + 0.08, pz);
          }
          box(alongX ? 0.9 : 0.34, 0.22, alongX ? 0.34 : 0.9, 0xe8a83c, 0, H + 0.35); // hazard-striped lintel
          const ban = assetClone('banner', 0.7);
          if (ban) { ban.position.set(alongX ? 0.05 : 0.45, 0, alongX ? 0.45 : 0.05); g.add(ban); }
          break;
        }
        // Center pier, slightly proud of the curtains.
        box(0.56, H + 0.14, 0.56, stone, 0, (H + 0.14) / 2);
        box(0.66, 0.15, 0.66, capCol, 0, H + 0.21);
        // Curtain panels out to each neighboring wall tile's edge.
        const panels = [
          nb.e && [0.5, 0.36, 0.25, 0], nb.w && [0.5, 0.36, -0.25, 0],
          nb.s && [0.36, 0.5, 0, 0.25], nb.n && [0.36, 0.5, 0, -0.25],
        ].filter(Boolean);
        for (const [w, dep, px, pz] of panels) {
          box(w, H, dep, stone, px, H / 2, pz);
          box(w === 0.5 ? 0.52 : 0.44, 0.14, dep === 0.5 ? 0.52 : 0.44, capCol, px, H + 0.07, pz);
          // Shock fence: a live plasma conduit runs the parapet — glows at night.
          if (shock) {
            const strip = box(w === 0.5 ? 0.52 : 0.1, 0.07, dep === 0.5 ? 0.52 : 0.1, 0x4dd8c8, px, H + 0.19, pz);
            strip.material.emissive.setHex(0x4dd8c8);
            strip.material.emissiveIntensity = 0.9;
          }
        }
        if (shock) {
          const core = box(0.2, 0.2, 0.2, 0x4dd8c8, 0, H + 0.34);
          core.material.emissive.setHex(0x4dd8c8);
          core.material.emissiveIntensity = 1.0;
        }
        if (!panels.length) box(0.9, H, 0.9, stone, 0, H / 2); // stranded stub (shouldn't happen)
        break;
      }
      case 'outpost': {
        // A staked claim: palisade stubs, a muster tent and a tall banner you
        // can pick out from across the map.
        box(1.9, 0.28, 1.9, 0x6b6152, 0, 0.14);
        cone(0.95, 1.05, 0xcfc7b4, -0.35, 0.55, -0.25);
        box(0.9, 0.6, 0.7, 0x5c6470, 0.55, 0.3, 0.5);
        box(0.08, 3.4, 0.08, 0x2f2a24, 0.85, 1.7, -0.7);
        box(0.7, 0.45, 0.03, 0x59b06e, 0.52, 3.15, -0.7);
        if (tier >= 2) {
          box(0.75, 0.85, 0.75, 0x4d5560, -0.7, 0.42, 0.75);
          box(0.08, 3.4, 0.08, 0x2f2a24, -0.85, 1.7, -0.7);
          box(0.7, 0.45, 0.03, 0x59b06e, -0.52, 3.15, -0.7);
          const head = new THREE.Group();
          head.position.set(0.25, 1.65, -0.15);
          const gun = new THREE.Mesh(new THREE.BoxGeometry(tier >= 3 ? 0.34 : 0.24, 0.2, tier >= 3 ? 1.25 : 0.78), M(tier >= 3 ? 0x4a4440 : 0x2f3a44));
          gun.position.z = 0.25;
          gun.castShadow = true;
          head.add(gun);
          if (tier >= 3) {
            const shield = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.62, 0.12), M(0x6b6152));
            shield.position.set(0, -0.05, -0.18);
            shield.castShadow = true;
            head.add(shield);
            box(1.8, 0.45, 0.28, 0x4d5560, 0, 0.8, -0.9);
          }
          g.add(head);
          g.userData.head = head;
        }
        break;
      }
      case 'workshop': {
        box(1.9, 0.25, 1.9, 0x46515a, 0, 0.12);
        box(1.5, 1.0, 1.25, 0x65717a, 0, 0.62);
        box(1.7, 0.16, 1.45, 0x2f3940, 0, 1.15);
        const rotor = new THREE.Group();
        rotor.position.set(0, 1.55, 0);
        for (let i = 0; i < 3 + tier; i++) {
          const a = (i / (3 + tier)) * Math.PI * 2;
          const drone = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.42), M(0x55ddeb, 0.7));
          drone.position.set(Math.cos(a) * (0.65 + tier * 0.12), Math.sin(a * 2) * 0.12, Math.sin(a) * (0.65 + tier * 0.12));
          rotor.add(drone);
        }
        g.add(rotor);
        g.userData.rotor = rotor;
        break;
      }
      case 'hero_forge': {
        cyl(1.0, 1.25, 0.45, 0x303944, 0, 0.22, 0, 10);
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2;
          box(0.22, 1.8 + tier * 0.25, 0.22, 0x596775, Math.cos(a) * 0.82, 0.9 + tier * 0.12, Math.sin(a) * 0.82);
        }
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.48 + tier * 0.1, 0), M(tier >= 3 ? 0xffd75e : 0x72cfff, 1.0));
        core.position.y = 1.65 + tier * 0.2;
        core.userData.window = true;
        g.add(core);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85 + tier * 0.1, 0.08, 8, 32), M(0x72cfff, 0.8));
        ring.position.y = core.position.y;
        ring.rotation.x = Math.PI / 2;
        g.add(ring);
        g.userData.rotor = ring;
        break;
      }
      case 'camp_militia':
      case 'camp_ranger':
      case 'camp_sniper': {
        const col = b.kind === 'camp_militia' ? 0x3a566e : b.kind === 'camp_ranger' ? 0x4a6e3a : 0x5c4a72;
        cone(1.0, 1.0, 0xd8d4c6, -0.4, 0.5, -0.3);
        box(1.1, 0.7, 0.8, 0x6e7478, 0.5, 0.35, 0.5);
        box(0.06, 1.7, 0.06, 0x333333, 0.9, 1.1, -0.6);
        box(0.55, 0.35, 0.02, col, 0.62, 1.7, -0.6);
        if (tier >= 2) { box(0.8, 0.5, 0.6, 0x3d4246, -0.6, 0.25, 0.7); }
        break;
      }
    }

    // CC0 prop dressing (skipped gracefully when assets are unavailable).
    const dress = (assetKey, fit, x, z, ry = 0) => {
      const a = assetClone(assetKey, fit);
      if (a) { a.position.set(x, 0, z); a.rotation.y = ry; g.add(a); }
    };
    if (b.kind === 'hq') {
      dress('banner', 0.85, -1.7, 0.6);
      dress('banner', 0.85, 1.7, 0.6, Math.PI);
      dress('crates', 1.1, -1.4, 1.5, 0.4);
      dress('torch', 0.45, 1.5, 1.6);
    } else if (b.kind.startsWith('camp') || b.kind === 'outpost') {
      dress('boxes', 0.9, -0.75, -0.6, 0.7);
      dress('torch', 0.42, 0.2, 0.85);
    } else if (b.kind === 'house' && tier >= 2) {
      dress('barrel', 0.5, 0.75, 0.6);
    } else if (b.kind === 'mine') {
      dress('crates', 0.9, 0.8, -0.8, 0.3);
    } else if (b.kind === 'tower') {
      dress('torch', 0.4, 0.7, 0.7);
    } else if (b.kind === 'mill') {
      dress('barrel', 0.5, 0.8, 0.6);
    }
    return g;
  }

  _syncBuildings() {
    const g = this.game;
    const seen = new Set();
    for (const b of g.buildings) {
      seen.add(b.id);
      const plot = g.plots.find((p) => p.id === b.plotId);
      const tierKey = (plot ? plot.tier : 1) + ':' + (plot ? plot.branch || '' : '');
      let rec = this.buildingMeshes.get(b.id);
      if (rec && rec.tierKey !== tierKey) { // upgraded in place — rebuild the mesh
        this.scene.remove(rec.mesh);
        rec = null;
      }
      if (!rec) {
        b.plotTier = plot ? plot.tier : 1;
        b.branch = plot ? plot.branch : null;
        const mesh = this._makeBuildingMesh(b);
        mesh.position.set(b.cx, 0, b.cz);
        this.scene.add(mesh);
        rec = { mesh, b, tierKey, spawnT: this.clock.elapsedTime };
        this.buildingMeshes.set(b.id, rec);
      }
    }
    for (const [id, rec] of this.buildingMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(rec.mesh);
        this.buildingMeshes.delete(id);
      }
    }
  }

  // ---------------- units ----------------

  _makeUnitMesh(u) {
    const g = new THREE.Group();
    const M = (c, e = 0) => new THREE.MeshLambertMaterial({ color: c, emissive: e ? c : 0x000000, emissiveIntensity: e });
    const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh; };

    const body = new THREE.Group();
    g.add(body);
    g.userData.body = body;
    const addB = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; body.add(mesh); return mesh; };
    const weaponParts = [];
    const trackWeapon = (mesh) => {
      mesh.userData.restPos = mesh.position.clone();
      mesh.userData.restRot = mesh.rotation.clone();
      weaponParts.push(mesh);
      return mesh;
    };

    if (u.hero) {
      // Power-armored space marine: broad torso, pauldrons, backpack, glow visor.
      const d = u.def;
      const armor = M(d.color), trim = M(d.trim);
      addB(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.26), M(0x26282c)), 0, 0.2, 0);          // legs
      addB(new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.5, 0.36), armor), 0, 0.62, 0);                 // torso
      addB(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.05), trim), 0, 0.68, 0.19);               // chest plate
      addB(new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), armor), -0.34, 0.86, 0);               // pauldron L
      addB(new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), armor), 0.34, 0.86, 0);                // pauldron R
      addB(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.22), M(0x3a3d42)), 0, 1.0, 0);           // helm
      addB(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.03), M(0x35ff70, 0.9)), 0, 1.0, 0.12);   // visor glow
      addB(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.2), M(0x4a4440)), 0, 0.72, -0.26);       // backpack
      addB(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 6), M(0x4a4d52)), -0.12, 1.0, -0.26);
      addB(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 6), M(0x4a4d52)), 0.12, 1.0, -0.26);
      if (u.key === 'scott') {
        // Stubby double-barrel shotgun + the gravity hammer slung on his back.
        trackWeapon(addB(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.46), M(0x1e1f21)), 0.26, 0.62, 0.24));
        trackWeapon(addB(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.46), M(0x2b2d31)), 0.26, 0.72, 0.24));
        const haft = trackWeapon(addB(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), M(0x3a3228)), -0.28, 0.8, -0.34));
        haft.rotation.z = 0.5;
        haft.userData.restRot = haft.rotation.clone();
        const head = trackWeapon(addB(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.2), trim), -0.5, 1.05, -0.34));
        head.rotation.z = 0.5;
        head.userData.restRot = head.rotation.clone();
      } else if (u.key === 'alexander') {
        trackWeapon(addB(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.82), M(0x1e1f21)), 0.3, 0.64, 0.26));   // long marksman rifle
      } else {
        trackWeapon(addB(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.78), M(0x1e1f21)), 0.28, 0.66, 0.24));   // long rifle
      }
      const haloGeo = new THREE.RingGeometry(0.5, 0.62, 28);
      haloGeo.rotateX(-Math.PI / 2);
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xc9a44a, transparent: true, opacity: 0.5, depthWrite: false }));
      halo.position.y = 0.03;
      g.add(halo);
      // Passive aura: a soft breathing ring at the aura's true radius.
      // (The whole hero group is scaled 1.18×, so compensate.)
      if (d.aura) {
        const S = 1.18;
        const auraR = u.auraRadius || d.aura.radius * (1 + ((u.mods && u.mods.auraR) || 0));
        const auraFillGeo = new THREE.CircleGeometry(auraR / S, 56);
        auraFillGeo.rotateX(-Math.PI / 2);
        const auraFill = new THREE.Mesh(auraFillGeo, new THREE.MeshBasicMaterial({ color: d.aura.color, transparent: true, opacity: 0.03, depthWrite: false }));
        auraFill.position.y = 0.035;
        g.add(auraFill);
        const auraGeo = new THREE.RingGeometry(Math.max(0.2, auraR - 0.32) / S, auraR / S, 72);
        auraGeo.rotateX(-Math.PI / 2);
        const aura = new THREE.Mesh(auraGeo, new THREE.MeshBasicMaterial({ color: d.aura.color, transparent: true, opacity: 0.16, depthWrite: false }));
        aura.position.y = 0.05;
        g.add(aura);
        const pulseGeo = new THREE.RingGeometry(Math.max(0.2, auraR - 0.82) / S, Math.max(0.3, auraR - 0.62) / S, 72);
        pulseGeo.rotateX(-Math.PI / 2);
        const pulse = new THREE.Mesh(pulseGeo, new THREE.MeshBasicMaterial({ color: d.aura.color, transparent: true, opacity: 0.18, depthWrite: false }));
        pulse.position.y = 0.065;
        g.add(pulse);
        aura.userData.baseRadius = auraR;
        auraFill.userData.baseRadius = auraR;
        pulse.userData.baseRadius = auraR;
        g.userData.aura = aura;
        g.userData.auraFill = auraFill;
        g.userData.auraPulse = pulse;
      }
      if (u.key === 'danny') {
        // The Weave must remain readable for its full duration. Three broken,
        // counter-rotating rings make a moving tear in the world instead of
        // relying on Daniel becoming faint and easy to lose in the horde.
        const weave = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const geo = new THREE.RingGeometry(0.72 + i * 0.18, 0.82 + i * 0.18, 32, 1, i * 0.7, Math.PI * 1.35);
          geo.rotateX(-Math.PI / 2);
          const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            color: i === 1 ? 0x72cfff : 0x7dffb2, transparent: true,
            opacity: 0.82 - i * 0.12, depthWrite: false, blending: THREE.AdditiveBlending,
          }));
          ring.position.y = 0.12 + i * 0.05;
          weave.add(ring);
        }
        weave.visible = false;
        g.add(weave);
        g.userData.weave = weave;
      }
      g.scale.setScalar(1.18);
    } else {
      // Guardsman-style trooper.
      const d = u.def;
      addB(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.62, 8), M(d.color)), 0, 0.45, 0);
      addB(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), M(0xc4a37e)), 0, 0.92, 0);
      addB(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.12, 8), M(d.color)), 0, 1.02, 0);
      trackWeapon(addB(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.68), M(0x232426)), 0.2, 0.62, 0.18));
    }
    const affectedGeo = new THREE.RingGeometry(0.38, 0.48, 28);
    affectedGeo.rotateX(-Math.PI / 2);
    const affected = new THREE.Mesh(affectedGeo, new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.5, depthWrite: false }));
    affected.position.y = 0.085;
    affected.visible = false;
    g.add(affected);
    g.userData.affected = affected;
    if (weaponParts.length) g.userData.weaponParts = weaponParts;
    return g;
  }

  _syncUnits(t, dt = 0) {
    const g = this.game;
    const seen = new Set();
    for (const u of g.units) {
      seen.add(u.id);
      let rec = this.unitMeshes.get(u.id);
      if (!rec) {
        const mesh = this._makeUnitMesh(u);
        this.scene.add(mesh);
        rec = { mesh, u };
        this.unitMeshes.set(u.id, rec);
      }
      rec.mesh.position.set(u.x, 0, u.z);
      rec.mesh.rotation.y = u.facing;
      let attackPulse = 0;
      let attackKind = '';
      if (rec.attack) {
        rec.attack.t -= dt;
        attackKind = rec.attack.kind || '';
        const p = clamp(1 - rec.attack.t / rec.attack.dur, 0, 1);
        attackPulse = Math.sin(p * Math.PI);
        if (rec.attack.t <= 0) rec.attack = null;
      }
      const weaponParts = rec.mesh.userData.weaponParts || [];
      for (const part of weaponParts) {
        const rp = part.userData.restPos;
        const rr = part.userData.restRot;
        if (rp) part.position.copy(rp);
        if (rr) part.rotation.copy(rr);
      }
      // Walk bob + a forward lean while moving; attacks add a short lunge or
      // weapon recoil exactly when the sim fires.
      const body = rec.mesh.userData.body;
      if (body) {
        body.position.x = 0;
        if (u.moving) {
          body.position.y = Math.abs(Math.sin(t * 10 + u.id)) * 0.09;
          body.rotation.x = 0.12;
          body.rotation.z = Math.sin(t * 10 + u.id) * 0.05;
        } else {
          body.position.y = Math.sin(t * 1.8 + u.id) * 0.02;
          body.rotation.x = 0;
          body.rotation.z = 0;
        }
        body.position.y += attackPulse * (u.hero ? 0.08 : 0.03);
        body.position.z = attackPulse * (attackKind === 'melee' ? 0.34 : 0.13);
        body.rotation.x += attackPulse * (attackKind === 'melee' ? -0.75 : -0.24);
        body.rotation.z += attackPulse * (u.hero ? (u.key === 'danny' ? -0.24 : 0.18) : 0.08);
      }
      if (weaponParts.length && attackPulse > 0) {
        for (const part of weaponParts) {
          const rp = part.userData.restPos;
          const rr = part.userData.restRot;
          if (!rp || !rr) continue;
          if (attackKind === 'melee') {
            part.position.z = rp.z + 0.32 * attackPulse;
            part.rotation.x = rr.x - 1.15 * attackPulse;
            part.rotation.y = rr.y + 0.32 * attackPulse;
          } else {
            part.position.z = rp.z - 0.28 * attackPulse;
            part.position.y = rp.y + 0.06 * attackPulse;
            part.rotation.x = rr.x - 0.2 * attackPulse;
          }
        }
      }
      if (u.hero) {
        const wantOp = u.stealth ? 0.3 : 1;
        if (rec.op !== wantOp) {
          rec.op = wantOp;
          rec.mesh.traverse((o) => {
            if (o.isMesh) {
              o.material.transparent = true;
              o.material.opacity = wantOp;
            }
          });
        }
        const aura = rec.mesh.userData.aura;
        if (aura) {
          const fill = rec.mesh.userData.auraFill;
          const pulse = rec.mesh.userData.auraPulse;
          const visible = !u.stealth; // veiled heroes hum nothing
          const rank = u.auraRank || 0;
          const radius = u.auraRadius || aura.userData.baseRadius || 1;
          for (const part of [aura, fill, pulse]) {
            if (!part) continue;
            part.visible = visible;
            const base = part.userData.baseRadius || radius;
            part.scale.setScalar(radius / base);
          }
          aura.material.opacity = 0.14 + rank * 0.045 + Math.sin(t * 2.2 + u.id) * (0.045 + rank * 0.01);
          if (fill) fill.material.opacity = rank ? 0.035 + rank * 0.018 + Math.sin(t * 1.3 + u.id) * 0.01 : 0.02;
          if (pulse) {
            pulse.rotation.z = t * (0.28 + rank * 0.04);
            pulse.material.opacity = rank ? 0.16 + rank * 0.045 + Math.sin(t * 3.2 + u.id) * 0.06 : 0.08;
          }
        }
        const weave = rec.mesh.userData.weave;
        if (weave) {
          weave.visible = u.weaveT > 0 && !u.dead;
          if (weave.visible) {
            weave.children.forEach((ring, i) => {
              ring.rotation.z = t * (i % 2 ? -4.8 : 4.2) + i * 1.7;
              ring.material.opacity = 0.58 + Math.sin(t * 8 + i) * 0.22;
            });
            const last = rec.weaveTrail || { x: u.x, z: u.z, t: 0 };
            last.t -= dt;
            if (last.t <= 0 && ((u.x - last.x) ** 2 + (u.z - last.z) ** 2) > 0.04) {
              this.stream(last.x, 0.35, last.z, u.x, 0.35, u.z,
                { count: 7, color: 0x72cfff, size: 0.55, life: 0.42 });
              this.burst(u.x, 0.35, u.z,
                { count: 5, color: 0x7dffb2, speed: 0.35, life: 0.48, size: 0.58, up: 0.35, spread: 0.55 });
              last.x = u.x; last.z = u.z; last.t = 0.055;
            }
            rec.weaveTrail = last;
          } else rec.weaveTrail = null;
        }
      }
      const affected = rec.mesh.userData.affected;
      if (affected) {
        affected.visible = !!(u.auraSources && u.auraSources.length) && !u.dead;
        affected.material.opacity = 0.34 + Math.sin(t * 4.6 + u.id) * 0.12;
      }
    }
    for (const [id, rec] of this.unitMeshes) {
      if (!seen.has(id)) { this.scene.remove(rec.mesh); this.unitMeshes.delete(id); }
    }
  }

  // ---------------- wave markers ----------------

  _setWaveMarkers(spots) {
    this._clearWaveMarkers();
    for (const [x, z] of spots || []) {
      const gr = new THREE.Group();
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 1.4, 14, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff3c2e, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
      );
      pillar.position.set(x, 7, z);
      gr.add(pillar);
      const ringGeo = new THREE.RingGeometry(2.2, 2.7, 40);
      ringGeo.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff3c2e, transparent: true, opacity: 0.5, depthWrite: false }));
      ring.position.set(x, 0.06, z);
      gr.add(ring);
      gr.userData.ring = ring;
      this.scene.add(gr);
      this.waveMarkers.push(gr);
    }
  }

  _clearWaveMarkers() {
    for (const m of this.waveMarkers) this.scene.remove(m);
    this.waveMarkers = [];
  }

  _clearNodeMarkers() {
    for (const m of this.nodeMarkers || []) this.scene.remove(m);
    this.nodeMarkers = null;
  }

  // A short red pulse over a hive that just mustered — the player should always
  // be able to see where the next push is coming from.
  _pingHive(x, z) {
    // Throttled: hives muster constantly, and a minimap that never stops
    // flashing tells the player nothing.
    const now = this.game ? this.game.time : 0;
    if (this._hivePingT && this._hivePingT > now) return;
    this._hivePingT = now + 6;
    this.ui.addPing(x, z);
    this.tacticalVisuals.pulse(x, z, { color: 0xff493d, radius: 4.2, life: 1.5 });
  }

  // Outline the one object the local hero can act on. This is presentation
  // state only; it must never enter commands, snapshots, or lockstep hashes.
  _updateTacticalSelection() {
    const h = this.myHero();
    if (!this.game || !h || h.dead || this.game.phase !== 'live') {
      this.tacticalVisuals.setSelection([]);
      return;
    }
    const target = this.game.buildTargetFor(h);
    if (!target) {
      this.tacticalVisuals.setSelection([]);
      return;
    }
    const building = [...this.buildingMeshes.values()].find((rec) => rec.b.plotId === target.plot.id);
    const plot = this.plotMeshes.get(target.plot.id);
    const color = target.act.mode === 'repair' || target.act.mode === 'rebuild' ? 0x75dfff
      : target.act.mode === 'branch' ? 0xd49aff : 0xffdf72;
    this.tacticalVisuals.setSelection([building ? building.mesh : plot?.group], color);
  }

  // Lane nodes: a capture ring and a banner in your colour, the hive's, or
  // nobody's. This is the front line made visible.
  _updateNodeMarkers(t) {
    const g = this.game;
    if (!g || !g.nodes || !g.nodes.length || g.phase === 'found') return;
    if (!this.nodeMarkers) {
      this.nodeMarkers = [];
      for (const node of g.nodes) {
        if (node.offMap) continue;
        const gr = new THREE.Group();
        const ringGeo = new THREE.RingGeometry(SIEGE.captureRadius - 0.6, SIEGE.captureRadius, 44);
        ringGeo.rotateX(-Math.PI / 2);
        const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xd8c07a, transparent: true, opacity: 0.35, depthWrite: false }));
        ring.position.set(node.x, 0.06, node.z);
        gr.add(ring);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.4, 6), new THREE.MeshLambertMaterial({ color: 0x39332a }));
        pole.position.set(node.x, 2.2, node.z);
        gr.add(pole);
        const flag = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.05), new THREE.MeshLambertMaterial({ color: 0xd8c07a }));
        flag.position.set(node.x + 0.75, 3.8, node.z);
        gr.add(flag);
        const label = this._makeLabelSprite(node.def ? node.def.icon : '🚩', String(node.name || '').toUpperCase());
        label.position.set(node.x, 5.4, node.z);
        label.scale.set(4.6, 2.3, 1);
        gr.add(label);
        gr.userData = { ring, flag, label, node };
        this.scene.add(gr);
        this.nodeMarkers.push(gr);
      }
    }
    for (const gr of this.nodeMarkers) {
      const node = gr.userData.node;
      // Grey until surveyed: the banner is there, but whose banner is not known.
      const col = !node.seen ? 0x76828d
        : node.owner === 'player' ? 0x59ff9c : node.owner === 'hive' ? 0xff3c2e : 0xd8c07a;
      gr.userData.ring.material.color.setHex(col);
      gr.userData.flag.material.color.setHex(col);
      const contested = node.cap > 0.05;
      gr.userData.ring.material.opacity = contested
        ? 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * 9))
        : (node.owner === 'player' ? 0.34 : 0.2);
      gr.userData.flag.rotation.y = Math.sin(t * 2.2 + node.id) * 0.28;
    }
  }

  // ---------------- input ----------------

  _setupInput() {
    const cv = this.canvas;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (this.game && k === 'enter' && this.netMode) {
        e.preventDefault();
        this.ui.openGameChat();
        return;
      }
      if (!this.game) return;
      if (k === ' ') {
        e.preventDefault();
        // Space follows the current control mode. Build mode never fires the
        // special; hero auto-attacks still run on their own.
        if (this.game.phase === 'found') this._tryFound();
        else if (this.controlMode === 'fight') this.tryCast();
      }
      else if (k === 'q') this.tryCast();
      else if (k === 'alt') {
        e.preventDefault();
        this.toggleControlMode();
      }
      else if (k === '1') this.issue({ t: 'stance', s: 'defend', p: this.myPlayer });
      else if (k === '2') this.issue({ t: 'stance', s: 'guard', p: this.myPlayer });
      else if (k === '3') this.issue({ t: 'stance', s: 'attack', p: this.myPlayer });
      else if (k === 't') this.issue({ t: 'towerpri', p: this.myPlayer });
      else if (k === 'g') this.issue({ t: 'drop', p: this.myPlayer, i: -1 });
      else if (k === 'm') { this.audio.setMuted(!this.audio.muted); this.ui.setMuteUI(this.audio.muted); }
      else if (k === 'h') { this.togglePauseMenu(true); }
      else if (k === 'escape') this.togglePauseMenu();
      else if (k === 'p') this.setSpeed(0);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = clamp(this.camDist * (1 + Math.sign(e.deltaY) * 0.12), 14, 60);
    }, { passive: false });

    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', () => this.audio.init());
  }

  // WASD → hero direction, sent through the lockstep pipe only on change.
  // Zillions uses a fixed Thronefall-style orientation during gameplay:
  // WASD maps to the minimap cardinal directions. This keeps keyboard
  // movement, player view movement, and minimap movement aligned.
  _updateHeroInput() {
    if (!this.game || this.game.over || this.mpRole === 'spectator') return;
    let dx = 0, dz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dz -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dz += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    const s = this.keys.has('shift');
    const last = this.lastDir;
    if (Math.abs(dx - last.x) > 0.001 || Math.abs(dz - last.z) > 0.001 || s !== last.s) {
      this.lastDir = { x: dx, z: dz, s };
      this.issue({ t: 'hdir', p: this.myPlayer, x: dx, z: dz, s });
    }
    // Hold-to-build: B always pays. Space/button pay only in Build mode, so the
    // player can toggle into Fight mode when they want the special to win.
    const h = this.myHero();
    const canPay = this.game && this.game.phase === 'live' && h && !h.dead && !!this.game.buildTargetFor(h);
    const buildModePays = this.controlMode === 'build' && canPay && (this.keys.has(' ') || this.buttonPay);
    const pay = this.keys.has('b') || buildModePays;
    if (pay !== this.lastPay) {
      this.lastPay = pay;
      this.issue({ t: 'pay', p: this.myPlayer, on: pay });
    }
  }

  myHero() { return this.game ? this.game.heroes[this.myPlayer] : null; }

  // ---------------- terrain readability ----------------

  // When the player keeps pushing into impassable ground, say so — loudly the
  // first time (named banner: "Molten rock — impassable"), and with a red
  // pulse on the exact blocking tile every time. Nobody should die wondering
  // why their hero won't cross an orange river.
  _updateBlockedHint(dt) {
    const h = this.myHero();
    const ld = this.lastDir;
    if (this.paused || !h || h.dead || (!ld.x && !ld.z) || h.moving) {
      this._blockT = Math.max(0, this._blockT - dt * 3);
      return;
    }
    this._blockT += dt;
    if (this._blockT < 0.25) return;
    const len = Math.hypot(ld.x, ld.z) || 1;
    const tx = Math.floor(h.x + (ld.x / len) * 0.8);
    const tz = Math.floor(h.z + (ld.z / len) * 0.8);
    const t = this.map.tileAt(tx, tz);
    const label = this.map.terrainLabel(t);
    if (!label) { this._blockT = 0; return; } // blocked by a building, not terrain
    if (!this._blockPulseT || this.clock.elapsedTime - this._blockPulseT > 0.45) {
      this._blockPulseT = this.clock.elapsedTime;
      this._spawnBlockFx(tx, tz);
    }
    if (!this._blockWarned[t]) {
      this._blockWarned[t] = true;
      const icon = t === TILE.WATER ? (this.map.isLava() ? '🌋' : '🌊') : t === TILE.FOREST ? '🌲' : '⛰️';
      this.ui.showBanner(`${icon} ${label} — impassable. Follow the bright rim to find a way around.`, 'bad', 4500);
      this.audio.deny();
    }
  }

  _spawnBlockFx(tx, tz) {
    const geo = new THREE.PlaneGeometry(1.04, 1.04);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.55, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(tx + 0.5, Math.max(this.map.groundY(tx + 0.5, tz + 0.5), -0.08) + 0.1, tz + 0.5);
    this.scene.add(mesh);
    this.blockFx.push({ mesh, life: 0.55 });
  }

  _updateBlockFx(dt) {
    for (let i = this.blockFx.length - 1; i >= 0; i--) {
      const f = this.blockFx[i];
      f.life -= dt;
      f.mesh.material.opacity = Math.max(0, f.life) * 1.0;
      f.mesh.scale.setScalar(1 + (0.55 - f.life) * 0.6);
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mesh.material.dispose();
        this.blockFx.splice(i, 1);
      }
    }
  }

  toggleControlMode() {
    this.controlMode = this.controlMode === 'build' ? 'fight' : 'build';
    this.buttonPay = false;
    if (this.lastPay && !this.keys.has('b')) {
      this.lastPay = false;
      this.issue({ t: 'pay', p: this.myPlayer, on: false });
    }
    if (this.ui.setControlMode) this.ui.setControlMode(this.controlMode);
    this.audio.click();
  }

  tryCast() {
    if (!this.game) return;
    const h = this.myHero();
    if (!h || h.dead) return;
    if (h.abilCd > 0) { this.audio.deny(); return; }
    if (Math.random() < 0.4) this.audio.bark(h.key, 'attack');
    this.issue({ t: 'cast', p: this.myPlayer });
  }

  togglePauseMenu(help = false) {
    if (!this.game) return;
    if (this.ui.pauseOpen) { this.closePauseMenu(); return; }
    if (!this.netMode) this.pause();
    this.ui.showPause(this.netMode, help, this._questStatus());
  }

  // Live side-quest status for the pause menu (campaign only).
  _questStatus() {
    if (!this.game || this.game.mode !== 'campaign') return null;
    const lv = levelById(this.game.levelId);
    return (lv.quests || []).map((q) => ({
      name: q.name, desc: q.desc, reward: q.reward,
      claimed: !!(this.profile.questsDone || {})[q.id],
      done: !!q.check(this.game),
    }));
  }

  closePauseMenu() {
    this.ui.hidePause();
    if (!this.netMode && this.game && !this.game.over) this.setSpeed(this.speed || 1);
  }

  // setSpeed(0) toggles pause; 1/2 set speed and unpause.
  // Co-op runs locked at 1x — the lockstep would stall otherwise.
  setSpeed(s) {
    if (s === 0) this.paused = !this.paused;
    else if (this.netMode) { this.paused = false; }
    else { this.speed = s; this.paused = false; }
    this.ui.setSpeedUI(this.speed, this.paused);
  }

  pause() {
    this.paused = true;
    this.ui.setSpeedUI(this.speed, this.paused);
  }

  // ---------------- frame ----------------

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.tacticalVisuals.resize(w, h);
  }

  _updateCamera(dt) {
    if (!this.game) {
      // Menu: slow cinematic orbit over the battlefield.
      this.menuYaw += dt * 0.05;
      this.focus.set(MAP_SIZE / 2, 0, MAP_SIZE / 2);
      const dist = 55;
      const elev = 0.72;
      this.camera.position.set(
        this.focus.x + Math.sin(this.menuYaw) * Math.cos(elev) * dist,
        Math.sin(elev) * dist,
        this.focus.z + Math.cos(this.menuYaw) * Math.cos(elev) * dist,
      );
      this.camera.lookAt(this.focus);
      return;
    }

    // Camera glued to the hero with a soft lag + movement lookahead.
    const h = this.myHero();
    if (h) {
      const lead = 1.6;
      const tx = h.x + (h.mx || 0) * lead;
      const tz = h.z + (h.mz || 0) * lead;
      const k = 1 - Math.exp(-6 * dt);
      this.focus.x += (tx - this.focus.x) * k;
      this.focus.z += (tz - this.focus.z) * k;
    }
    const mapSize = this.map?.size || MAP_SIZE;
    const edgePad = 1.2;
    this.focus.x = clamp(this.focus.x, edgePad, mapSize - edgePad);
    this.focus.z = clamp(this.focus.z, edgePad, mapSize - edgePad);

    const elev = lerp(0.72, 1.0, clamp((this.camDist - 12) / 68, 0, 1));
    const hx = Math.cos(elev) * this.camDist, hy = Math.sin(elev) * this.camDist;
    let sx = 0, sz = 0;
    if (this.shake > 0) {
      this.shake -= dt;
      const s = Math.min(this.shake, 0.4);
      sx = (Math.random() - 0.5) * s; sz = (Math.random() - 0.5) * s;
    }
    this.camera.position.set(
      this.focus.x + Math.sin(this.camYaw) * hx + sx,
      hy,
      this.focus.z + Math.cos(this.camYaw) * hx + sz,
    );
    this.camera.lookAt(this.focus.x + sx, 0, this.focus.z + sz);

    this.sun.position.set(this.focus.x + 45, 80, this.focus.z + 25);
    this.sun.target.position.set(this.focus.x, 0, this.focus.z);
  }

  // No day and no night any more — but the sky still tells you something. The
  // light bleeds out of the world as Threat climbs, so a late siege LOOKS like
  // a late siege without ever gating the player on a clock.
  _updateDayNight(dt) {
    const g = this.game;
    const dread = g.phase === 'found' ? 0 : Math.min(1, (g.threat || 0) / Math.max(1, THREAT.max * 0.7));
    const want = 1 - dread * 0.8;
    this._bright = this._bright === undefined ? want : this._bright + (want - this._bright) * (1 - Math.exp(-2.2 * dt));
    const b = this._bright;
    const daySky = new THREE.Color(this.pal && this.pal.sky ? this.pal.sky : 0xa8cfc4);
    const duskSky = new THREE.Color(0xd98a6a);
    const nightSky = new THREE.Color(0x232b4e);

    this.sun.intensity = lerp(0.85, 2.6, b);
    // Warm cream by day, ember at dusk, cool moon-blue at night.
    this.sun.color.copy(new THREE.Color(0x9db8f0).lerp(new THREE.Color(0xfff0cf), b));
    this.hemi.intensity = lerp(0.35, 0.85, b);
    this.hemi.color.copy(new THREE.Color(0x5a6aa8).lerp(new THREE.Color(0xdfe8dd), b));
    this.amb.intensity = lerp(0.85, 0.5, b);
    this.amb.color.copy(new THREE.Color(0x2c3765).lerp(new THREE.Color(0x33406e), b));
    const sky = nightSky.clone().lerp(daySky.clone().lerp(duskSky, dread * 0.55), b);
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);

    // Windows glow when it's dark.
    const glow = lerp(0.85, 0, b);
    if (Math.abs(glow - (this._winGlow || 0)) > 0.05) {
      this._winGlow = glow;
      for (const rec of this.buildingMeshes.values()) {
        rec.mesh.traverse((o) => {
          if (o.isMesh && o.userData.window) o.material.emissiveIntensity = glow;
        });
      }
    }
  }

  _consumeEvents() {
    const g = this.game;
    // The sim can run many ticks per frame (catch-up after a hidden tab, the
    // co-op pump). Replaying hundreds of stale FX events in one frame is a
    // hitch and an air-raid of sounds — keep only the freshest burst.
    if (g.events.length > 90) g.events.splice(0, g.events.length - 30);
    for (const e of g.events) {
      switch (e.type) {
        case 'shot': {
          this._unitAttackCue(e);
          if (e.kind === 'melee') {
            this.audio.melee();
            this._impactRing(e.tx, e.tz, { color: 0xffd27a, count: 18, radius: 1.25, life: 0.26, size: 0.42 });
            this.burst(e.tx, 0.7, e.tz, { count: 14, color: 0xffd27a, speed: 2.9, life: 0.3, size: 0.5, up: 1.6 });
            this.burst(e.tx, 0.6, e.tz, { count: 9, color: 0x9c1f1f, speed: 1.9, life: 0.4, size: 0.48, up: 1.3 });
            this.shake = Math.max(this.shake, 0.12);
            break;
          }
          if (e.kind === 'shotgun') {
            // Point-blank thunder: pellets now travel to the actual hit volume
            // before the impact VFX fires, so the eye can track the shot.
            this.audio.shoot('shotgun');
            const muzzle = this._muzzlePoint(e, 'shotgun');
            this.burst(muzzle.x, muzzle.y, muzzle.z, { count: 14, color: 0xffe08a, speed: 2.0, life: 0.16, size: 0.78, spread: 0.3, up: 0.5 });
            const ang = Math.atan2(e.tx - e.fx, e.tz - e.fz);
            for (let p = 0; p < 9; p++) {
              const a = ang + (p - 4) * 0.13;
              const spread = 0.25 + Math.random() * 0.35;
              this._spawnProjectile(e, {
                kind: 'shotgun',
                tx: e.tx + Math.sin(a) * spread,
                tz: e.tz + Math.cos(a) * spread,
                ty: 0.6,
                dur: 0.22 + Math.random() * 0.04,
                impact: { kind: 'shotgun', color: 0xfff2b0, ring: p === 4, burst: p === 4 ? 12 : 2, radius: 1.1, speed: 2.2, life: 0.28, size: 0.38, up: 1.1 },
              });
            }
            this.shake = Math.max(this.shake, 0.14);
            break;
          }
          if (e.kind === 'flame') {
            this.audio.shoot('tower');
            const muzzle = this._muzzlePoint(e, 'flame');
            this._spawnProjectile(e, { kind: 'flame', ty: 0.45, impact: { kind: 'flame', color: 0xff8a3c, count: 18, radius: 1.3, burst: 18, speed: 2.5, life: 0.34, size: 0.56, up: 1.6, spread: 1.2 } });
            this.stream(muzzle.x, muzzle.y, muzzle.z, e.tx, 0.5, e.tz, { count: 9, color: 0xff8a3c, size: 0.62, life: 0.34 });
            this._towerRecoil(e.fx, e.fz, e.tx, e.tz);
            break;
          }
          this.audio.shoot(e.kind === 'hero' ? 'soldier' : e.kind === 'ballista' || e.kind === 'outpostSiege' ? 'sniper' : e.kind === 'outpost' ? 'tower' : e.kind);
          this._spawnProjectile(e, {
            ty: e.kind === 'ballista' ? 0.8 : undefined,
            impact: {
              kind: e.kind,
              color: e.kind === 'ballista' ? 0xfff2b0 : 0xffd75e,
              count: e.kind === 'ballista' ? 16 : 12,
              radius: e.kind === 'ballista' ? 1.35 : 0.95,
              burst: e.kind === 'ballista' ? 10 : 6,
              speed: e.kind === 'ballista' ? 1.8 : 1.35,
              life: 0.28,
              size: e.kind === 'ballista' ? 0.44 : 0.34,
              up: 1.25,
            },
          });
          const muzzle = this._muzzlePoint(e, e.kind || 'soldier');
          const hit = this._targetPoint(e, e.kind || 'soldier', { ty: e.kind === 'ballista' ? 0.8 : undefined });
          this.burst(muzzle.x, muzzle.y, muzzle.z, { count: 6, color: 0xffe08a, speed: 1.0, life: 0.16, size: 0.58, spread: 0.12, up: 0.35 });
          const steps = 8;
          for (let i = 1; i < steps; i++) {
            const t = i / steps;
            this.burst(lerp(muzzle.x, hit.x, t), lerp(muzzle.y, hit.y, t), lerp(muzzle.z, hit.z, t),
              { count: 1, color: 0xfff2b0, speed: 0.1, life: 0.14, size: 0.38, spread: 0.02, up: 0 });
          }
          if (e.kind === 'tower' || e.kind === 'ballista' || e.kind === 'outpost' || e.kind === 'outpostSiege') this._towerRecoil(e.fx, e.fz, e.tx, e.tz);
          break;
        }
        case 'zdeath':
          this.spawnCorpse(e);
          this.burst(e.x, 0.4, e.z, { count: e.big ? 26 : 12, color: 0x8c1a1a, speed: e.big ? 3 : 2, life: 0.6, size: e.big ? 0.7 : 0.5, up: 2 });
          this.deathSfxT -= 1;
          if (this.deathSfxT <= 0) { this.audio.zombieDeath(); this.deathSfxT = 2; }
          break;
        case 'bite':
          if (e.fromId) this.zombieAttacks.set(e.fromId, { t: 0.34, dur: 0.34, tx: e.tx ?? e.x, tz: e.tz ?? e.z });
          if (e.fx !== undefined) this.stream(e.fx, 0.72, e.fz, e.x, 0.65, e.z, { count: 3, color: 0xff4636, size: 0.34, life: 0.18 });
          this.burst(e.x, 0.7, e.z, { count: 4, color: 0xb32020, speed: 1.2, life: 0.3, size: 0.35, up: 1 });
          break;
        case 'udeath':
          this.burst(e.x, 0.5, e.z, { count: 20, color: 0xd23c3c, speed: 2.5, life: 0.7, size: 0.55, up: 2 });
          this.audio.zombieDeath();
          break;
        case 'build':
          if (!e.quiet) {
            this.audio.build();
            this.burst(e.x, 0.3, e.z, { count: 20, color: 0xc9b48a, speed: 2.4, life: 0.55, size: 0.65, up: 1.9, spread: 1.1 });
            this.shake = Math.max(this.shake, 0.12);
          }
          break;
        case 'branch':
          this.audio.train();
          this.burst(e.x, 0.4, e.z, { count: 14, color: 0xb98fdc, speed: 1.6, life: 0.5, size: 0.5, up: 1.8 });
          break;
        case 'paycoin':
          this._spawnPayCoins(e.fx, e.fz, e.tx, e.tz, e.n || 1);
          break;
        case 'refundcoin':
          this._spawnPayCoins(e.fx, e.fz, e.tx, e.tz, e.n || 1);
          this.audio.coin();
          this.stream(e.fx, 0.3, e.fz, e.tx, 0.9, e.tz, { count: Math.min(12, e.n || 1), color: 0xfff2b0, size: 0.48, life: 0.45 });
          break;
        case 'coinspawn':
          if (e.fx !== undefined) {
            this.stream(e.fx, 1.2, e.fz, e.x, 0.35, e.z, { count: 2, color: 0xffd75e, size: 0.35, life: 0.3 });
          }
          break;
        case 'coin':
          this.audio.coin();
          this.stream(e.x, 0.4, e.z, e.hx, 0.9, e.hz, { count: 3, color: 0xffd75e, size: 0.42, life: 0.25 });
          this.burst(e.hx, 0.9, e.hz, { count: 3, color: 0xfff2b0, speed: 0.8, life: 0.25, size: 0.4, up: 1 });
          break;
        case 'lootseen':
          this.audio.click();
          this.burst(e.x, 0.6, e.z, { count: 12, color: 0xa8e6ff, speed: 1.4, life: 0.7, size: 0.4, up: 1.6 });
          break;
        case 'lootdrop':
          this.burst(e.x, 0.6, e.z, { count: 6, color: 0xcfd8dc, speed: 1.0, life: 0.5, size: 0.35, up: 1.2 });
          break;
        case 'loot': {
          this.audio.build();
          this.burst(e.x, 1.0, e.z, { count: 18, color: 0xffe38a, speed: 2.0, life: 0.8, size: 0.5, up: 2.2 });
          const it = ITEMS[e.key];
          if (it) this.ui.showBanner(`${it.icon} ${it.name}`, it.desc, 2600);
          break;
        }
        case 'income':
          this.audio.coin();
          this.burst(e.x, 2.6, e.z, { count: 4, color: 0xffd75e, speed: 1.1, life: 0.5, size: 0.45, up: 1.8 });
          break;
        case 'muster':
          this.audio.train();
          this.burst(e.x, 0.5, e.z, { count: 8, color: 0x8fd8ff, speed: 1.6, life: 0.5, size: 0.42, up: 1.6 });
          break;
        case 'hivemuster':
          this._pingHive(e.x, e.z);
          break;
        case 'surge':
          this.audio.alarm();
          this.shake = Math.max(this.shake, 0.7);
          this.ui.showBanner(`☠️ THREAT ${e.level}`, 'Every hive musters at once', 2600);
          break;
        case 'nodeseen':
          this.audio.click();
          this.ui.addPing(e.x, e.z);
          break;
        case 'loot':
          this.audio.build();
          this.burst(e.x, 0.7, e.z, { count: 30, color: 0xd8b45e, speed: 2.6, life: 1.0, size: 0.6, up: 2.4 });
          break;
        case 'nodetaken':
          this.audio.build();
          this.burst(e.x, 0.6, e.z, { count: 34, color: 0x59ff9c, speed: 3, life: 0.9, size: 0.65, up: 2.6 });
          break;
        case 'nodelost':
          this.audio.demolish();
          this.burst(e.x, 0.6, e.z, { count: 26, color: 0xff3c2e, speed: 2.6, life: 0.8, size: 0.6, up: 2.2 });
          break;
        case 'repair':
          this.burst(e.x, 1.0, e.z, { count: 3, color: 0x8fe8ff, speed: 1.0, life: 0.35, size: 0.34, up: 1.4 });
          break;
        case 'towerpriority':
          this.audio.click();
          this.burst(e.x, 2.8, e.z, { count: 8, color: 0xffe9a8, speed: 1.2, life: 0.4, size: 0.36, up: 1.2 });
          break;
        case 'spit':
          this.bhitSfxT -= 1;
          if (this.bhitSfxT <= 0) { this.audio.hitBuilding(); this.bhitSfxT = 4; }
          if (e.fromId) this.zombieAttacks.set(e.fromId, { t: 0.36, dur: 0.36, tx: e.x, tz: e.z });
          this._spawnProjectile(e, {
            kind: 'spit',
            fy: 0.92,
            ty: e.targetKind === 'building' ? 1.0 : 0.62,
            impact: { kind: 'spit', color: 0xc9d84e, count: 10, radius: 0.75, burst: 8, speed: 1.4, life: 0.28, size: 0.34, up: 0.9, spread: 0.2 },
          });
          {
            const muzzle = this._muzzlePoint(e, 'spit', { fy: 0.92 });
            this.stream(muzzle.x, muzzle.y, muzzle.z, e.tx, e.targetKind === 'building' ? 1.0 : 0.65, e.tz, { count: 2, color: 0xc9d84e, size: 0.34, life: 0.22 });
          }
          break;
        case 'founded': {
          // The chosen ground is levelled and the city plan appears — rebuild
          // the terrain mesh (tiles changed), plant the plaza, redraw the map.
          this.scene.remove(this.terrain);
          this.terrain = this.map.buildTerrain();
          this.scene.add(this.terrain);
          if (this.plaza) this.scene.remove(this.plaza);
          this.plaza = this._buildPlaza(e.x, e.z);
          this.scene.add(this.plaza);
          this.map.drawMinimap(document.getElementById('minimap-base'));
          this._clearSiteMarkers();
          this.audio.build();
          this.shake = Math.max(this.shake, 0.3);
          this.burst(e.x, 0.5, e.z, { count: 40, color: 0xffd75e, speed: 3, life: 0.9, size: 0.7, up: 3 });
          break;
        }
        case 'nestdown':
          this.audio.demolish();
          this.shake = Math.max(this.shake, 0.4);
          this.burst(e.x, 0.8, e.z, { count: 40, color: 0xb44dff, speed: 3.4, life: 0.9, size: 0.7, up: 3 });
          this.burst(e.x, 0.5, e.z, { count: 24, color: 0x3a2a4a, speed: 2.6, life: 0.8, size: 0.7, up: 2.4 });
          break;
        case 'rally':
          this.audio.train();
          this.burst(e.x, 0.3, e.z, { count: 10, color: 0x59ff9c, speed: 1.4, life: 0.5, size: 0.45, up: 1.6 });
          break;
        case 'hold':
          this.audio.click();
          break;
        case 'bhit':
          this.bhitSfxT -= 1;
          if (this.bhitSfxT <= 0) { this.audio.hitBuilding(); this.bhitSfxT = 4; }
          if (e.fromId) this.zombieAttacks.set(e.fromId, { t: 0.36, dur: 0.36, tx: e.x, tz: e.z });
          if (e.fx !== undefined) this.stream(e.fx, 0.72, e.fz, e.x, 0.75, e.z, { count: 3, color: 0xff4636, size: 0.34, life: 0.18 });
          this.burst(e.x, 0.6, e.z, { count: 2, color: 0x565349, speed: 1.4, life: 0.3, size: 0.35, up: 1.2 });
          break;
        case 'bdestroyed':
          this.audio.demolish();
          this.burst(e.x, 0.5, e.z, { count: 30, color: 0x7c6a4a, speed: 3, life: 0.8, size: 0.7, up: 2.6 });
          this.shake = Math.max(this.shake, 0.3);
          break;
        case 'horde':
          this.audio.alarm();
          this.shake = Math.max(this.shake, e.final ? 1.2 : 0.6);
          break;

        case 'deny': this.audio.deny(); break;
        case 'cast': {
          this.audio.cast({ weave: 'smoke', grenade: 'shrapnel', hammer: 'sunstrike' }[e.key] || e.key);
          const CAST_COLORS = { hammer: 0x7a9cf0, grenade: 0xd8b45e, weave: 0x7fd85e };
          const col = CAST_COLORS[e.key] || 0xffe9a8;
          const R = e.radius;
          const n = Math.min(40, Math.round(R * 6));
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            this.burst(e.x + Math.cos(a) * R * 0.85, 0.25, e.z + Math.sin(a) * R * 0.85,
              { count: 1, color: col, speed: 0.5, life: 0.45, size: 0.55, spread: 0.15, up: 1.4 });
          }
          this.burst(e.x, 0.4, e.z, { count: 14, color: col, speed: R * 0.8, life: 0.4, size: 0.5, up: 1.2 });
          if (e.key === 'hammer') {
            this._spawnAbilityRing(e.x, e.z, { color: 0xeaf2ff, radius: 0.45, to: R, life: 0.34, opacity: 0.95, width: 0.2 });
            this._spawnAbilityRing(e.x, e.z, { color: 0x7a9cf0, radius: 0.7, to: R * 1.18, life: 0.48, opacity: 0.72, width: 0.28, delay: 0.06 });
          } else if (e.key === 'weave') {
            this._spawnAbilityRing(e.x, e.z, { color: 0x72cfff, radius: 0.5, to: 2.3, life: 0.38, opacity: 0.85, width: 0.16 });
          }
          this.shake = Math.max(this.shake, e.key === 'hammer' ? 0.5 : 0.18);
          break;
        }
        case 'zap':
          this.burst(e.x, 0.6, e.z, { count: 5, color: 0x4dd8c8, speed: 1.8, life: 0.25, size: 0.4, up: 1.4 });
          break;
        case 'weavehit':
          this.burst(e.x, 0.7, e.z, { count: 8, color: 0x7fd85e, speed: 2.0, life: 0.35, size: 0.5, up: 1.5 });
          this.burst(e.x, 0.6, e.z, { count: 4, color: 0x9c1f1f, speed: 1.4, life: 0.3, size: 0.4, up: 1.2 });
          break;
        case 'grenade': {
          // Lobbed concussion grenade: arc trail, then a dirty knockback blast.
          this._spawnAbilityRing(e.tx, e.tz, { color: 0xffc45e, radius: e.r || 4, to: 0.35, life: 0.52, opacity: 0.68, width: 0.18 });
          this._spawnProjectile(e, { kind: 'grenade', fy: 1.0, ty: 0.45, dur: 0.52,
            impact: { kind: 'grenade', color: 0xffc45e, radius: e.r || 4, count: 30, burst: 22, speed: 3.0, life: 0.42, size: 0.54, up: 2.0, spread: 0.9 } });
          this.stream(e.fx, 1.0, e.fz, e.tx, 0.3, e.tz, { count: 8, color: 0xd8b45e, size: 0.4, life: 0.3 });
          this.shake = Math.max(this.shake, 0.3);
          break;
        }
        case 'stealth':
          this.audio.stealthOn();
          this.burst(e.x, 0.5, e.z, { count: 12, color: 0x8a8f96, speed: 0.8, life: 0.8, size: 0.8, up: 0.8 });
          break;
        case 'ping':
          this.ui.addPing(e.x, e.z);
          break;
        case 'underattack':
          this.audio.underattack();
          break;
        case 'bossspawn':
          this.audio.bossHorn();
          this.shake = Math.max(this.shake, 1.2);
          this.burst(e.x, 0.5, e.z, { count: 30, color: 0xff3c2e, speed: 3, life: 1, size: 0.8, up: 3 });
          break;
        case 'bossdown':
          this.audio.victory();
          this.shake = Math.max(this.shake, 1.4);
          this.burst(e.x, 0.6, e.z, { count: 60, color: 0xffd75e, speed: 4.5, life: 1.2, size: 0.8, up: 4 });
          this.burst(e.x, 0.5, e.z, { count: 40, color: 0x8c1a1a, speed: 3.5, life: 0.9, size: 0.7, up: 3 });
          break;
        case 'enrage':
          this.audio.bossHorn();
          this.burst(e.x, 0.8, e.z, { count: 24, color: 0xff5d2e, speed: 2.5, life: 0.8, size: 0.7, up: 2.5 });
          break;
        case 'roarwave': {
          this.audio.roar();
          const n = 36;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            this.burst(e.x + Math.cos(a) * e.r * 0.7, 0.4, e.z + Math.sin(a) * e.r * 0.7,
              { count: 1, color: 0xb98fdc, speed: 1.2, life: 0.5, size: 0.6, spread: 0.2, up: 1.4 });
          }
          this.shake = Math.max(this.shake, 0.4);
          break;
        }
        case 'brood':
          this.burst(e.x, 0.4, e.z, { count: 14, color: 0x8fae3a, speed: 2, life: 0.6, size: 0.55, up: 2 });
          break;
        case 'levelup':
          this.audio.levelup();
          this.burst(e.x, 0.3, e.z, { count: 30, color: 0xffd75e, speed: 1.6, life: 0.9, size: 0.55, up: 3.2 });
          break;
        case 'auraupgrade':
          this.audio.levelup();
          this.burst(e.x, 0.18, e.z, { count: 36, color: 0x9fd6ff, speed: 1.2, life: 0.8, size: 0.5, up: 1.8, spread: 2.6 });
          this._impactRing(e.x, e.z, { color: 0x9fd6ff, count: 32, radius: 3.2, life: 0.5, size: 0.5 });
          break;
        case 'herodown':
          this.audio.herodown();
          this.shake = Math.max(this.shake, 0.5);
          break;
        case 'revive':
          this.audio.revive();
          this.burst(e.x, 0.3, e.z, { count: 24, color: 0x9fd6ff, speed: 1.4, life: 0.8, size: 0.55, up: 2.8 });
          break;
        case 'victory':
          this.audio.victory();
          this.pause();
          this._recordGameEnd(true);
          this.ui.showEnd(true, g.stats, g.threatLevel, g.levelId, g.mode, this.profile.bestSurvival || 0, this._endExtras);
          break;
        case 'defeat':
          this.audio.defeat();
          this.shake = 1.5;
          this.pause();
          this._recordGameEnd(false);
          this.ui.showEnd(false, g.stats, g.threatLevel, g.levelId, g.mode, this.profile.bestSurvival || 0, this._endExtras);
          break;
      }
    }
    g.events.length = 0;
  }

  // Kick a living unit into a visible attack pose on the exact shot event.
  _unitAttackCue(e) {
    if (!e.fromId) return;
    const rec = this.unitMeshes.get(e.fromId);
    if (!rec) return;
    const dur = e.kind === 'melee' ? 0.44 : e.kind === 'shotgun' ? 0.34 : e.heroKey ? 0.3 : 0.22;
    rec.attack = { t: dur, dur, kind: e.kind || 'shot' };
  }

  // Kick the nearest tower head toward its target with a little recoil.
  _towerRecoil(fx, fz, tx, tz) {
    for (const rec of this.buildingMeshes.values()) {
      if (rec.b.kind !== 'tower' && rec.b.kind !== 'outpost') continue;
      if (Math.abs(rec.b.cx - fx) < 0.6 && Math.abs(rec.b.cz - fz) < 0.6) {
        const head = rec.mesh.userData.head;
        if (head) {
          head.rotation.y = Math.atan2(tx - fx, tz - fz);
          rec.recoil = 0.16;
        }
        return;
      }
    }
  }

  _updateTutorial(dt) {
    if (!this._tut || !this.game) return;
    this._tutT = (this._tutT || 0) + dt;
    const step = this._tut.steps[this._tut.i];
    if (step && this._tutT >= step[0]) {
      this.ui.showBanner(step[1], '', 5200);
      this._tut.i++;
      if (this._tut.i >= this._tut.steps.length) this._tut = null;
    }
  }

  _autoTuneQuality(dt) {
    if (!this.game || this.paused || this.tacticalVisuals.quality !== 'high') {
      this.slowFrameT = 0;
      return;
    }
    const slow = dt > (this.netMode ? 1 / 28 : 1 / 24);
    this.slowFrameT = slow ? this.slowFrameT + dt : Math.max(0, this.slowFrameT - dt * 0.75);
    if (this.slowFrameT < 2.5 || this.autoQualityDropped) return;
    this.autoQualityDropped = true;
    this.slowFrameT = 0;
    this.ui.setQualityUI(this.tacticalVisuals.applyQuality('low', false));
    this.ui.showBanner('Graphics lowered for smoother play. Use ◐ to turn high graphics back on.', '', 5500);
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    this._autoTuneQuality(dt);
    this._updateCamera(dt);

    if (this.game) {
      this._updateHeroInput();
      if (!this.paused && !this.game.over) {
        if (this.netMode) {
          this._advanceNetSim();
        } else {
          this.acc += dt * this.speed;
          let steps = 0;
          while (this.acc >= SIM_DT && steps < 10) {
            this.game.update(SIM_DT);
            this.acc -= SIM_DT;
            steps++;
          }
          if (steps === 10) this.acc = 0;
        }
      }

      this._consumeEvents();
      this._syncBuildings();
      this._syncUnits(t, dt);
      this._syncNests(t);
      this._syncLoot(t);
      this._syncPlots(t);
      this._updateTacticalSelection();

      // Site flags ripple until the city is founded.
      for (const m of this.siteMarkers || []) {
        m.userData.flag.rotation.y = Math.sin(t * 2.5) * 0.3;
        const ph = (t * 0.8) % 1;
        m.userData.ring.scale.setScalar(1 + ph * 0.25);
        m.userData.ring.material.opacity = 0.55 * (1 - ph * 0.6);
      }
      this._surveySites();
      this._updateBlockedHint(dt);
      this._updateBlockFx(dt);
      this._updateCoins(t);
      this._updateZombieMeshes(t, dt);
      this._updateBars();
      this._updateNodeMarkers(t);
      this._updateDayNight(dt);
      this._updateTutorial(dt);

      // Building spawn bounce: elastic overshoot on fresh meshes; recoil decay.
      for (const rec of this.buildingMeshes.values()) {
        const age = t - (rec.spawnT || 0);
        if (age < 0.55) {
          const k = age / 0.55;
          const s = k < 0.7 ? 0.15 + k * 1.35 : 1.2 - (k - 0.7) * 0.667;
          rec.mesh.scale.setScalar(Math.max(0.15, s));
        } else if (rec.mesh.scale.x !== 1) rec.mesh.scale.setScalar(1);
        if (rec.recoil > 0) {
          rec.recoil -= dt;
          const head = rec.mesh.userData.head;
          if (head) head.position.z = -Math.max(0, rec.recoil) * 0.8;
        }
        const ud = rec.mesh.userData;
        if (ud.rotor) ud.rotor.rotation.z = t * 1.5;
        if (ud.flag) ud.flag.rotation.y = Math.sin(t * 3) * 0.25;
        if (ud.flame) ud.flame.scale.y = 1 + Math.sin(t * 9 + rec.b.id) * 0.25;
      }

      // Ambient groans when the horde is active.
      const aggro = this.game.aggroCount();
      if (aggro > 0 && Math.random() < Math.min(0.02, aggro * 0.0004)) this.audio.groan();

      // Wave marker pulse.
      for (const m of this.waveMarkers) {
        const ring = m.userData.ring;
        const ph = (t * 1.2) % 1;
        ring.scale.setScalar(1 + ph * 1.6);
        ring.material.opacity = 0.55 * (1 - ph);
      }

      // Smoke from damaged buildings.
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.4;
        for (const b of this.game.buildings) {
          if (b.hp < b.maxHp * 0.4) {
            this.burst(b.cx + (Math.random() - 0.5), 1.2, b.cz + (Math.random() - 0.5),
              { count: 2, color: 0x555555, speed: 0.3, life: 1.2, size: 0.8, up: 1.2 });
          }
        }
      }

      // Branch choice UI when standing at a branch-ready plot.
      const mh = this.myHero();
      const buildMode = this.controlMode !== 'fight';
      let branchPlot = null;
      if (buildMode && mh && !mh.dead) {
        for (const plot of this.game.plots) {
          const nt = this.game.nextTier(plot);
          if (!nt || !nt.branch) continue;
          const [px, pz] = this.game.payPoint(plot, mh);
          if ((mh.x - px) ** 2 + (mh.z - pz) ** 2 < (PAY_RADIUS + 1.5) ** 2) { branchPlot = { plot, options: nt.options }; break; }
        }
      }
      this.ui.showBranch(branchPlot);

      // Build prompt while parked on something fundable.
      let hint = null;
      if (mh && !mh.dead && this.game.phase === 'live' && !branchPlot) {
        const target = this.game.buildTargetFor(mh);
        if (target) {
          const { plot, act, nt } = target;
          const actualBuilding = plot.tier > 0 || act.mode === 'repair' || act.mode === 'rebuild';
          if (buildMode || actualBuilding) {
            const paid = act.mode === 'repair' ? 0 : plot.paid;
            const cost = Math.max(1, Math.ceil(act.cost - paid));
            const verb = act.mode === 'repair' ? 'repair' : act.mode === 'rebuild' ? 'rebuild' : plot.tier > 0 ? 'upgrade to' : 'build';
            const name = act.mode === 'repair' ? PLOT_KINDS[plot.kind].name : (act.def || nt.def).name;
            const role = act.mode === 'repair' ? 'Nothing repairs itself any more.' : this._plotRole(plot, nt);
            const buildKeys = buildMode
              ? '<kbd>SPACE</kbd> or <kbd>B</kbd>'
              : '<kbd>B</kbd>';
            hint = mh.payHold
              ? (this.game.gold < 1 ? '🪙 Purse empty — kill something, or take a node!' : `🪙 ${cost} to go…`)
              : `<div>Hold ${buildKeys} — ${verb} <b>${name}</b> (${cost}🪙)</div><div class="buildrole">${role}${buildMode ? ' · Alt toggles Fight mode.' : ' · Fight mode: Space fires your special. Alt toggles.'}</div>`;
          }
        }
      }
      this.ui.showBuildHint(hint);

      this.ui.update(this.game, this.myPlayer, { controlMode: this.controlMode });
      this.ui.updateBoss(this.game);

      this.autosaveT -= dt;
      if (this.autosaveT <= 0) {
        this.autosaveT = 20;
        this._autosave();
      }

      this.minimapT -= dt;
      if (this.minimapT <= 0) {
        this.minimapT = 0.15;
        const viewSize = this.camDist * 1.1;
        this.ui.drawMinimap(this.game, this.focus, viewSize);
      }
    }

    this._updateParticles(dt);
    this._updateCorpses(dt);
    this._updatePayCoins(dt);
    this._updateProjectiles(dt);
    this._updateAbilityFx(dt);
    this.tacticalVisuals.update(dt);
    this.tacticalVisuals.render();
  }
}

window.__app = new App(); // exposed for debugging
