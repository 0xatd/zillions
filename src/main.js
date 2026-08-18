// Rendering, input and orchestration — Thronefall-style direct hero control.
import * as THREE from 'three';
import {
  PLOT_KINDS, SIM_DT, MAP_SIZE, LEVELS, levelById, PAY_RADIUS, THREAT, SIEGE, TOWER_PRIORITY,
  ITEMS, BOSS_DROPS, UNITS, TILE, TILE_INFO, LABYRINTH_LEVELS, HEROES,
} from './config.js';
import { GameMap } from './map.js';
import { surveySite } from './plots.js';
import { Game, runScore } from './game.js';
import { UI } from './ui.js';
import { AudioSys } from './audio.js';
import { loadAssets, assetClone, assetPart } from './assets.js';
import { NetSession } from './net.js';
import { OnlineLobby, LORE, TIPS, canRejoinRoom, roomCompatibility, isCustomGame } from './online.js';
import { AuthClient } from './auth.js';
import { clamp, lerp } from './utils.js';
import { TacticalVisuals } from './tactical-visuals.js';
import { roomConnectionReadiness, roomLaunchReadiness } from './multiplayer-readiness.js';
import { inboxForMatchStart, matchStartReady } from './multiplayer-windows.js';
import { highestUnlockedLevel, roomLevelEligibility } from './multiplayer-eligibility.js';
import { adaptiveWindowTarget, consecutiveWindowCount, hasConsecutiveWindowBuffer, rememberWindow } from './multiplayer-pacing.js';
import { FrameGuard, recoverableRestore } from './runtime-guard.js';
import { buildingArtState, unitArtState, unitPose } from './art-state.js';
import { HordeArt, buildCorpseGeometry } from './horde-art.js';
import { buildUnitModel } from './unit-art.js';
import { buildBuildingMesh } from './building-art.js';
import { MenuVignette } from './menu-vignette.js';
import { knownGalaxy, descriptorForWorldId, galaxyDestinationList } from './galaxy.js';
import { loadMeta, awardRun, metaBonuses } from './meta.js';
import { stateHash } from './lockstep-hash.js';
import { loadBinds, saveBinds, resetBinds, actionFor, isHeld, keyLabel } from './keybinds.js';
import { getGalaxyState } from './backend.js';
import {
  MMO_CLASSES, makeMmoCharacter, normalizeMmoCharacters, selectedMmoCharacter,
  addMmoCharacter, characterCamp, recordMmoInstance,
} from './mmo-characters.js';
import {
  stitchOverworld, Overworld, gateState,
  earthWorldDescriptor, overworldChannel,
  OVERWORLD_SIZE, OVERWORLD_GHOSTS,
} from './overworld.js';
import {
  FOG_DARKNESS,
  FOG_EDGE_SOFTNESS,
  FOG_INNER_VEIL,
  fogVisionSources,
  MAX_VISION_SOURCES,
} from './fog-of-war.js';

const ZMAX = 1700;
const NET_STEP = 2;          // one lockstep command window every 2 sim ticks (~66ms)
const NET_GUEST_BUFFER_MIN = 3; // adaptive floor; ~200ms at the 15Hz window rate
const NET_REDUNDANCY = 4;       // recent windows piggybacked on every packet
const NET_HISTORY = 64;         // explicit repair history (~4.3 seconds)
const NET_PACE_SLOW = 0.94;  // guest sim rate when the bank is running dry
const NET_PACE_FAST = 1.06;  // guest sim rate when the bank is overfull

// The overworld's renderer half: the headless stitch from overworld.js poured
// through GameMap's cel terrain pipeline. Each region wears its own level's
// palette, so the planet reads as the campaign itself.
class OverworldMap extends GameMap {
  constructor(campaign = 0, worldId = 'earth') {
    // The planet is a descriptor: Earth today, other servers' universes
    // tomorrow — same stitch, same renderer, different data.
    const world = descriptorForWorldId(knownGalaxy(), worldId, campaign);
    super(world.seed, { palette: { water: 0x3d6e8a } }, { size: world.size, nests: 0 });
    this._owWorld = world;
    // super() stitched with a zero-campaign descriptor (the ladder is not
    // known until super returns); re-stitch with the real campaign so locked
    // fronts bake stained ground on first build. Idempotent — fresh rng.
    this.generate();
  }

   generate() { stitchOverworld(this, this._owWorld || earthWorldDescriptor()); }

   // buildTerrain asks colorOf(tile) without a position — but idx(x, z) is
   // always called for the same tile first, so the last query tells us where
   // the color is going. Region palette by position, one biome per band.
   idx(x, z) { this._q = [x, z]; return super.idx(x, z); }

   regionPalette(x, z) {
     // Colour comes from whichever region's descriptor owns this tile.
     const regions = (this.overworldWorld && this.overworldWorld.regions) || [];
     const r = this.region ? this.region[this.idx(Math.floor(x), Math.floor(z))] : 0;
     const lv = regions[r] || regions[0];
     return lv && lv.palette;
   }

   colorOf(t, x, z) {
     const q = x !== undefined ? [x, z] : this._q;
     const p = q ? this.regionPalette(q[0], q[1]) : (this.overworldWorld.regions[0].palette);
     const map = {
       [TILE.GRASS]: p.grass, [TILE.FOREST]: p.forest, [TILE.WATER]: p.water,
       [TILE.MOUNTAIN]: p.mountain, [TILE.SAND]: p.sand, [TILE.PATH]: p.path,
       [TILE.GOLDORE]: p.sand, [TILE.STONEORE]: p.mountain,
     };
     return map[t] !== undefined ? map[t] : TILE_INFO[t].color;
   }
}

class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

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
    // Alt only changes which construction affordances are visible. Inputs are
    // never contextual: Space dodges, Q casts, and B builds.
    this.controlMode = 'build';
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
        if (this.mpRole === 'host' && this.onlineMode && this.lobby?.game && !this._launchCountdownComplete) {
          this._beginLaunchCountdown();
          return;
        }
        this._launchCountdownComplete = false;
        const mode = this.ui.selectedMode || 'campaign';
        if (this.mpRole === 'host' && (this.peers.length || this.onlineMode)) {
          if (this.onlineMode && this.lobby?.game) {
            const eligibility = roomLevelEligibility(this.lobby.game);
            if (!eligibility.eligible) {
              const names = eligibility.blockers.map((p) => `@${p.name}`).join(', ');
              this.ui.onlineStatus(`🔒 Level ${eligibility.level} cannot start. ${names} ${eligibility.blockers.length === 1 ? 'has' : 'have'} not unlocked it yet.`);
              this._onRoomUpdate(this.lobby.game);
              return;
            }
            const readiness = roomLaunchReadiness(this.lobby.game, this.peers.length + 1);
            if (!readiness.ready) {
              this.ui.onlineStatus(readiness.pending
                ? `⏳ ${readiness.pending} player${readiness.pending === 1 ? '' : 's'} still connecting. START unlocks when everyone is linked.`
                : `⏳ ${readiness.waiting.length} player${readiness.waiting.length === 1 ? ' has' : 's have'} not marked Ready.`);
              this._onRoomUpdate(this.lobby.game);
              return;
            }
          }
          const level = this.ui.selectedLevel || 1;
          const heroes = [{ k: hero, camp: this.campFor(hero) }, ...this.peers.map((_, i) => this.guestHeroes[i] || 'scott')];
          this.startExpectedGuests = this.peers.length;
          this.startReadyGuests.clear();
          this.startBarrier = !matchStartReady(this.startExpectedGuests, 0);
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
      onSettings: (s) => this.applySettings(s),
      onQuality: () => this.ui.setQualityUI(this.tacticalVisuals.toggleQuality()),
      onHost: () => this.hostGame(),
      onJoin: (code) => this.joinGame(code),
      onHostAccept: (code) => this.pendingPeer && this.pendingPeer.acceptReply(code).catch(() => this.ui.mpStatus('❌ Bad reply code.')),
      onAddPeer: () => this._newInvite(),
      onHeroPick: (k) => this._pickHero(k),
      onCharacterSelect: (id) => this._selectMmoCharacter(id),
      // The sheet edits the character object the profile owns, so persisting is
      // all that is left to do once it has changed something.
      onProfileDirty: () => this._saveProfile(),
      onKeybindChange: (binds) => this.setBinds(binds),
      onKeybindReset: () => this.resetKeybinds(),
      onCharacterCreate: (draft) => this._createMmoCharacter(draft),
      onFound: () => this._tryFound(),
      onHeroUpgrade: (key) => this.issue({ t: 'heroUpgrade', key, p: this.myPlayer }),
      onBlessing: (i) => this.issue({ t: 'blessing', i, p: this.myPlayer }),
      onStance: (s) => this.issue({ t: 'stance', s, p: this.myPlayer }),
      onRestart: () => this._restartOrReturn(),
      onQuit: () => location.reload(),
      onPause: () => this.togglePauseMenu(),
      onResume: () => this.closePauseMenu(),
      onContinue: () => this.continueGame(),
      onCampaignMap: () => this._enterOverworld(),
      onGalaxyOpen: () => this._openGalaxyMap(),
      onGalaxyTravel: (worldId) => this._travelToWorld(worldId),
      onSignIn: () => this._signIn(),
      onOfflineContinue: () => this.ui.setAccount({ ready: true, enabled: false, signedIn: false, reason: 'static', name: this.profile.name }),
      onUsername: (username) => this._claimUsername(username),
      onLobbyOpen: () => this._openLobby(),
      onCustomOpen: () => this._openCustomGames(),
      onCustomRefresh: () => this._openCustomGames(true),
      onCustomCreate: (options) => this.createCustomGame(options),
      onCustomJoin: (room) => this.joinOnlineGame(room),
      onChatSend: (text) => this._sendLobbyChat(text),
      onRoomChatSend: (text) => this._sendRoomChat(text, 'room'),
      onGameChatSend: (text) => this._sendGameChat(text),
      onAddFriend: (handle) => this._addFriend(handle),
      onAcceptFriend: (id) => this._acceptFriend(id),
      onRemoveFriend: (id) => this._removeFriend(id),
      onInviteFriend: (userId) => this._inviteFriend(userId),
      onCreateGame: (visibility) => this.createOnlineGame(visibility),
      onJoinCode: (code) => this.joinByCode(code),
      onLevelPick: (id) => { this._updateRoomSettings({ level: id }); },
      onDifficultyPick: (difficulty) => this._updateRoomSettings({ difficulty }),
      onModePick: (m) => this._pickSetupMode(m),
      onRoomReady: (ready) => this._setRoomReady(ready),
      onRoomLeave: () => this._leaveOnlineRoom(),
      onMatchLeave: () => this._leaveOnlineMatch(),
      onRoomReconnect: (userId) => this._retryRoomConnection(userId),
      onRoomRemovePlayer: (userId) => this._removeRoomPlayer(userId),
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
    this._windowHistory = new Map();
    this.startExpectedGuests = 0;
    this.startReadyGuests = new Set();
    this.startBarrier = false;

    // Terrain readability: pulses + one-time warnings when a hero shoves
    // against impassable ground (lava, deep water, woods, crags).
    this.blockFx = [];
    this._blockT = 0;
    this._blockWarned = {};
    this.desynced = false;
    this.netPrimed = false;
    this.netStallT = 0;
    this.netBufferTarget = NET_GUEST_BUFFER_MIN;
    this.netDiagnostics = { route: 'peer', rttMs: 0, jitterMs: 0, bufferedBytes: 0 };
    this._missingWindow = -1;
    this._missingRequestAt = 0;
    this._frameMs = 16.7;
    this._diagUiAt = 0;
    this.slowFrameT = 0;
    this.autoQualityDropped = false;

    // Profiles & saves. Production identity comes from Supabase; localStorage is only
    // a development/offline mirror.
    this.auth = new AuthClient();
    this.authStatus = { ready: false, enabled: false, signedIn: false };
    this._authenticatedEntryHandled = false;
    this.profile = this._loadProfile();
    this.meta = loadMeta();
    this.profile.metaCurrency = this.meta.currency;
    normalizeMmoCharacters(this.profile);
    const initialCharacter = selectedMmoCharacter(this.profile);
    if (initialCharacter) {
      this.ui.selectedHero = initialCharacter.proxyHero;
      this.profile.lastHero = initialCharacter.proxyHero;
      this.profile.lastWorld = initialCharacter.lastWorld || this.profile.lastWorld || 'earth';
    }
    this.autosaveT = 20;
    window.addEventListener('beforeunload', () => this._autosave(true));

    this.groanAcc = 0;
    this.deathSfxT = 0;
    this.bhitSfxT = 0;
    this.smokeT = 0;
    this.minimapT = 0;
    this.fogOfWar = null;

    this.ui.setProfile(this.profile);
    this.ui.setKeybinds(this.binds());
    this.ui.setQualityUI(this.tacticalVisuals.quality);
    // Settings restore: volumes apply inside AudioSys before any sound;
    // UI controls sync to whatever was persisted.
    this.ui.setSettingsUI(this._restoreSettings());
    this.ui.fillHeroGrid(HEROES);
    // Living hub: connect the lobby quietly in the background so the main
    // menu shows live presence/games/chat before the player clicks PLAY.
    // Failures stay silent — solo play must never feel blocked by the lobby.
    this._hubChatLog = [];
    this._hubChatDirty = false;
    setTimeout(() => this._openLobby().then((l) => {
      if (!l || !l.connected) return;
      l.loadChat().then((rows) => {
        this._hubChatLog = rows || [];
        this.ui.hubChat(this._hubChatLog);
        this.root?.querySelector?.('#hub-panel')?.classList.remove('hidden');
      }).catch(() => {});
    }).catch(() => {}), 1500);
    this.ui.setAccount(this.authStatus);
    this.ui.setCampaign(this.profile.campaign || 0);
    if (this.profile.lastHero) this.ui.preselectHero(this.profile.lastHero);
    const save = this._loadSave();
    if (save) this.ui.setContinue(save.snap);
    this._initAuth();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.clock = new THREE.Clock();

    // The authored title screen remains the front door. Story Campaign opens
    // the walkable overworld after the player deliberately chooses it.
    this.showMenuBackdrop(this.ui.selectedLevel || 1);
    this.frameGuard = new FrameGuard((error) => this._handleFrameError(error));
    this.renderer.setAnimationLoop(() => this.frameGuard.run(() => this.frame()));
  }

  // ---------------- title diorama ----------------
  // A real last stand still runs on the surface. The extra geometry makes it
  // read as one small battlefield on a much larger planet under siege.
  showMenuBackdrop(levelId = 1) {
    if (this.game || this.ow || this.menuTerrain) return;
    const level = levelById(levelId);
    const map = new GameMap(level.seed, level.theme);
    this.menuMap = map;
    this.menuTerrain = map.buildTerrain();
    this.scene.add(this.menuTerrain);
    if (!this._menuProjV) this._menuProjV = new THREE.Vector3();
    this.menuShow = new MenuVignette({
      scene: this.scene, map, horde: this.horde,
      makeUnitMesh: (u) => this._makeUnitMesh(u),
      burst: (x, y, z, o) => this.burst(x, y, z, o),
      stream: (fx, fy, fz, tx, ty, tz, o) => this.stream(fx, fy, fz, tx, ty, tz, o),
      addCorpse: (c) => { if (this.corpses.length >= 300) this.corpses.shift(); this.corpses.push(c); },
      dispose3D: (obj) => this._disposeObject3D(obj),
      light: new THREE.PointLight(0xffd39a, 0, 34, 1.8),
      dummy: new THREE.Object3D(), color: new THREE.Color(),
      project: (x, y, z) => this._menuProjV.set(x, y, z).project(this.camera),
      initialCount: Number.parseInt(localStorage.getItem('zillions-title-stands') || '0', 10) || 0,
    });
    this._buildTitleSpace();
  }

  _buildTitleSpace() {
    const group = new THREE.Group();
    group.name = 'planet-edge-title';
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(185, 48, 24),
      new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0x101923, emissive: 0x07101d, emissiveIntensity: 0.45 }),
    );
    planet.position.set(MAP_SIZE / 2, -185, MAP_SIZE / 2 + 18);
    group.add(planet);
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(187.2, 48, 24),
      new THREE.MeshBasicMaterial({ color: 0x4ca8e8, transparent: true, opacity: 0.12, side: THREE.BackSide, depthWrite: false }),
    );
    atmosphere.position.copy(planet.position);
    group.add(atmosphere);

    const starGeo = new THREE.BufferGeometry();
    const stars = new Float32Array(1100 * 3);
    for (let i = 0; i < 1100; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 170 + Math.random() * 220;
      stars[i * 3] = MAP_SIZE / 2 + Math.sin(a) * r;
      stars[i * 3 + 1] = 45 + Math.random() * 180;
      stars[i * 3 + 2] = MAP_SIZE / 2 - 80 + Math.cos(a) * r;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    const starField = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdbeaff, size: 0.95, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
    group.add(starField);

    // Sparse starship navigation overlays replace the old ringed moon. Keep
    // them faint: the besieged world must remain the only large celestial body.
    const constellationGeo = new THREE.BufferGeometry();
    constellationGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -92,45,-150, -78,59,-151, -78,59,-151, -61,50,-152, -61,50,-152, -45,67,-153,
       55,61,-156,  70,47,-155,  70,47,-155,  87,58,-157,  87,58,-157, 101,43,-158,
       -8,82,-162,   7,72,-161,   7,72,-161,  21,88,-163,  21,88,-163,  36,79,-162,
    ], 3));
    const constellations = new THREE.LineSegments(
      constellationGeo,
      new THREE.LineBasicMaterial({ color: 0x7799b8, transparent: true, opacity: 0.18, depthWrite: false, fog: false }),
    );
    group.add(constellations);

    // A deterministic low-resolution surface makes the orbit shot read as a
    // world at a glance. Ground combat lighting is controlled elsewhere and
    // stays deliberately dark around the troops.
    const texW = 256, texH = 128;
    const globePixels = new Uint8Array(texW * texH * 4);
    for (let y = 0; y < texH; y++) {
      const lat = (y / (texH - 1) - 0.5) * Math.PI;
      for (let x = 0; x < texW; x++) {
        const lon = (x / texW) * Math.PI * 2;
        const landNoise = Math.sin(lon * 2.15 + Math.sin(lat * 3.1) * 1.7)
          + Math.sin(lon * 4.7 - lat * 2.3) * 0.48
          + Math.cos(lon * 7.3 + lat * 5.1) * 0.2;
        const polar = Math.abs(lat) > 1.18;
        const land = landNoise > 0.48 && !polar;
        const daylight = 0.72 + 0.22 * Math.cos(lon + 0.65) * Math.cos(lat);
        const base = polar ? [170, 199, 213] : land ? [48, 93, 73] : [21, 69, 111];
        const i = (y * texW + x) * 4;
        globePixels[i] = Math.round(base[0] * daylight);
        globePixels[i + 1] = Math.round(base[1] * daylight);
        globePixels[i + 2] = Math.round(base[2] * daylight);
        globePixels[i + 3] = 255;
      }
    }
    const globeTexture = new THREE.DataTexture(globePixels, texW, texH, THREE.RGBAFormat);
    globeTexture.colorSpace = THREE.SRGBColorSpace;
    globeTexture.needsUpdate = true;
    const orbitalGlobe = new THREE.Mesh(
      new THREE.SphereGeometry(105, 48, 28),
      new THREE.MeshBasicMaterial({ map: globeTexture, color: 0xa9cfe0, fog: false }),
    );
    group.add(orbitalGlobe);
    const signalGeo = new THREE.BufferGeometry();
    const signalPoints = new Float32Array(90 * 3);
    for (let i = 0; i < 90; i++) {
      const y = 1 - (i / 89) * 2;
      const radius = Math.sqrt(1 - y * y);
      const a = i * 2.399963;
      signalPoints[i * 3] = Math.cos(a) * radius * 105.8;
      signalPoints[i * 3 + 1] = y * 105.8;
      signalPoints[i * 3 + 2] = Math.sin(a) * radius * 105.8;
    }
    signalGeo.setAttribute('position', new THREE.BufferAttribute(signalPoints, 3));
    const signals = new THREE.Points(signalGeo, new THREE.PointsMaterial({ color: 0xff9d55, size: 1.7, transparent: true, opacity: 0.72, depthWrite: false, fog: false }));
    orbitalGlobe.add(signals);
    const orbitalGlow = new THREE.Mesh(
      new THREE.SphereGeometry(108, 48, 28),
      new THREE.MeshBasicMaterial({ color: 0x58bdf2, transparent: true, opacity: 0.34, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    group.add(orbitalGlow);

    const ships = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const ship = new THREE.Mesh(new THREE.BoxGeometry(5 + i * 0.7, 0.8, 1.8), new THREE.MeshBasicMaterial({ color: 0x24384d }));
      ship.position.set(MAP_SIZE / 2 + 38 + i * 13, 54 + (i % 2) * 9, MAP_SIZE / 2 - 105 - i * 7);
      ship.rotation.y = -0.35;
      ships.add(ship);
    }
    group.add(ships);

    const streakMat = new THREE.MeshBasicMaterial({ color: 0xffb45b, transparent: true, opacity: 0.7, depthWrite: false });
    const streaks = [];
    for (let i = 0; i < 4; i++) {
      const streak = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.2, 18, 6), streakMat.clone());
      streak.rotation.z = 0.48;
      streak.userData.seed = i * 1.73;
      group.add(streak); streaks.push(streak);
    }

    // Diablo-style account presence belongs only to a created MMO character.
    // Legacy named heroes remain in Custom Games and must never impersonate an
    // empty persistent roster.
    const titleCharacter = selectedMmoCharacter(this.profile);
    const heroKey = titleCharacter?.proxyHero || Object.keys(HEROES)[0];
    const heroDef = HEROES[heroKey] || HEROES[Object.keys(HEROES)[0]];
    const titleHero = this._makeUnitMesh({ hero: true, key: heroKey, def: heroDef, auraRadius: 1.3 });
    titleHero.scale.setScalar(2.65);
    titleHero.visible = !!titleCharacter;
    group.add(titleHero);
    const heroPedestal = new THREE.Mesh(
      new THREE.CircleGeometry(3.1, 40),
      new THREE.MeshBasicMaterial({ color: heroDef.color || 0x65a9ff, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    );
    heroPedestal.visible = !!titleCharacter;
    group.add(heroPedestal);
    const heroLight = new THREE.PointLight(heroDef.color || 0x65a9ff, 2.2, 16, 1.8);
    heroLight.visible = !!titleCharacter;
    group.add(heroLight);
    group.userData = { atmosphere, constellations, orbitalGlobe, orbitalGlow, signals, ships, streaks, titleHero, heroPedestal, heroLight };
    this.titleSpace = group;
    this.scene.add(group);
    this.scene.background = new THREE.Color(0x020711);
    this.scene.fog.color.setHex(0x07101b);
    this.scene.fog.density = 0.0024;
  }

  _updateTitleSpace(t) {
    if (!this.titleSpace) return;
    const { atmosphere, constellations, orbitalGlobe, orbitalGlow, signals, ships, streaks, titleHero, heroPedestal, heroLight } = this.titleSpace.userData;
    const showTitleCharacter = !!selectedMmoCharacter(this.profile);
    titleHero.visible = showTitleCharacter;
    heroPedestal.visible = showTitleCharacter;
    heroLight.visible = showTitleCharacter;
    atmosphere.material.opacity = 0.1 + Math.sin(t * 0.35) * 0.025;
    const cameraLocal = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(this.camera.quaternion).add(this.camera.position);
    constellations.position.copy(cameraLocal(0, 0, 0));
    constellations.quaternion.copy(this.camera.quaternion);
    orbitalGlobe.position.copy(cameraLocal(0, -118, -175));
    orbitalGlow.position.copy(orbitalGlobe.position);
    orbitalGlobe.rotation.y = t * 0.025;
    signals.material.opacity = 0.55 + Math.sin(t * 2.1) * 0.18;
    const heroPos = cameraLocal(7.8, -4.5, -18);
    titleHero.position.copy(heroPos);
    titleHero.quaternion.copy(this.camera.quaternion);
    titleHero.rotateY(-0.28);
    const body = titleHero.userData.body;
    if (body) {
      body.position.y = Math.sin(t * 1.5) * 0.025;
      body.rotation.z = Math.sin(t * 0.65) * 0.015;
    }
    heroPedestal.position.copy(cameraLocal(7.8, -5.05, -18));
    heroPedestal.quaternion.copy(this.camera.quaternion);
    heroLight.position.copy(cameraLocal(5.6, -1.3, -15));
    ships.position.x = Math.sin(t * 0.08) * 3;
    for (let i = 0; i < streaks.length; i++) {
      const s = streaks[i];
      const p = (t * (0.07 + i * 0.008) + s.userData.seed) % 1;
      s.position.set(MAP_SIZE / 2 - 55 + i * 34 + p * 22, 78 - p * 72, MAP_SIZE / 2 - 82 + i * 5);
      s.material.opacity = Math.sin(p * Math.PI) * 0.75;
    }
  }

  _clearMenuBackdrop() {
    if (this.menuShow) { this.menuShow.dispose(); this.menuShow = null; }
    if (this.menuTerrain) { this.scene.remove(this.menuTerrain); this._disposeObject3D(this.menuTerrain); this.menuTerrain = null; }
    if (this.titleSpace) { this.scene.remove(this.titleSpace); this._disposeObject3D(this.titleSpace); this.titleSpace = null; }
    this.menuMap = null;
  }

  // ---------------- overworld ----------------
  // The menu is a place: the five fronts stitched onto one small planet,
  // walked by the player's selected hero. Entering a front's gate starts the
  // run through the same onStart path the setup screen uses.

  _enterOverworld(worldId = null) {
    if (this.game) return;
    // Already on the planet — the hub's ENTER WORLD means "resume the walk",
    // not a no-op. It used to early-return with the overlay still up, which
    // read as a dead button inside the custom-games loop (QA 2026-08-18).
    if (this.ow) {
      this._makeOverworldHero();
      this.ui.hideOverlay();
      return;
    }
    const character = selectedMmoCharacter(this.profile);
    if (!character) {
      this.ui.setProfile(this.profile);
      this.ui.showCharacterCreator();
      return;
    }
    this.ui.selectedHero = character.proxyHero;
    worldId = worldId || character.lastWorld || this.profile.lastWorld || 'earth';
    this._clearMenuBackdrop();
    this.ui.setOverworldMode(true);
    const map = new OverworldMap(this.profile.campaign || 0, worldId);
    const sky = map.overworldWorld.regions[0]?.palette?.sky || 0x7eaeb5;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog.color.setHex(sky);
    this.scene.fog.density = 0.0045;
    this.owMap = map;
    this.ow = new Overworld(map, { world: map.overworldWorld });
    this.owTerrain = map.buildTerrain();
    this.scene.add(this.owTerrain);
    this.owGates = [];
    for (const gate of [...map.overworldLayout.gates, map.overworldLayout.cave].filter(Boolean)) {
      this.owGates.push(this._makeOverworldGate(gate));
    }
    this._makeOverworldHero();
    this.profile.lastWorld = map.overworldWorld.id;
    character.lastWorld = map.overworldWorld.id;
    this._saveProfile();
    this.ui.hideOverlay();
    this.ui.showBanner(`🪐 ${map.overworldWorld.name} · WASD to walk · enter the Orbital Lift to navigate`, '', 6000);
  }

  async _openGalaxyMap() {
    const currentWorld = this.ow?.world?.id || this.profile.lastWorld || 'earth';
    const depth = 12 + metaBonuses().unlock.galaxyDepth;
    const destinations = galaxyDestinationList(knownGalaxy(), this.profile.campaign || 0, depth);
    let macro = null;
    try { macro = await getGalaxyState(); } catch { /* local galaxy still works */ }
    this.ui.showGalaxy(destinations, currentWorld, macro);
  }

  _travelToWorld(worldId) {
    const depth = 12 + metaBonuses().unlock.galaxyDepth;
    const destination = galaxyDestinationList(knownGalaxy(), this.profile.campaign || 0, depth)
      .find((world) => world.id === worldId);
    if (!destination || !destination.unlocked) {
      this.audio.deny();
      this.ui.showBanner('🔒 That route is beyond the current frontier.', 'bad', 2600);
      return;
    }
    if (this.ow?.world?.id === worldId) {
      this.ui.hideOverlay();
      return;
    }
    this._clearOverworld();
    this.ui.setOverworldMode(false);
    this._enterOverworld(worldId);
  }

  _clearOverworld() {
    if (this.owTerrain) { this.scene.remove(this.owTerrain); this._disposeObject3D(this.owTerrain); }
    for (const g of this.owGates || []) { this.scene.remove(g); this._disposeObject3D(g); }
    if (this.owHero) { this.scene.remove(this.owHero); this._disposeObject3D(this.owHero); }
    for (const m of (this.owGhostMeshes || new Map()).values()) { this.scene.remove(m); this._disposeObject3D(m); }
    this.owTerrain = null;
    this.owGates = [];
    this.owHero = null;
    this.owGhostMeshes = new Map();
    this.owMap = null;
    this.ow = null;
    if (this._owGhostChan) { try { this.lobby?.sb?.removeChannel?.(this._owGhostChan); } catch { /* already gone */ } this._owGhostChan = null; }
  }

  // A front's gate: two posts, a lintel, a banner whose colour is the state
  // of the war there, and the boss's name overhead. Locked gates stand on
  // blighted ground with a slow corrupted pulse.
  _makeOverworldGate(gate) {
    const st = gateState(gate);
    const gr = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0x3a3228 });
    for (const dx of [-1.5, 1.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.42, 3.4, 0.42), wood);
      post.position.set(dx, 1.7, 0);
      post.castShadow = true;
      gr.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.4, 0.5), wood);
    lintel.position.y = 3.4;
    lintel.castShadow = true;
    gr.add(lintel);
    const bannerColor = st.cleared ? 0xc9a44a : st.locked ? 0x2c2438 : 0xe8843c;
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.1),
      new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: bannerColor, side: THREE.DoubleSide }),
    );
    banner.position.y = 2.6;
    gr.add(banner);
    gr.userData.banner = banner;
    const ringGeo = new THREE.RingGeometry(2.4, 3.0, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: st.locked ? 0x8a4aff : st.cleared ? 0xc9a44a : 0xfff2d8,
      transparent: true, opacity: 0.4, depthWrite: false,
    }));
    ring.position.y = 0.06;
    gr.add(ring);
    gr.userData.ring = ring;
    const icon = gate.cave ? '🌀' : gate.portal ? '🚀' : gate.boss.icon;
    const name = gate.cave ? 'THE LABYRINTH' : gate.name.toUpperCase();
    const sub = gate.cave ? 'the trials below'
      : gate.portal ? 'starship navigation'
      : st.locked ? '🔒 sealed' : st.cleared ? '✅ taken' : `${gate.boss.name}`;
    const label = this._makeLabelSprite(icon, name);
    label.position.y = 5.6;
    label.scale.set(5.2, 2.6, 1);
    gr.add(label);
    gr.userData.sub = sub;
    gr.position.set(gate.x, this.owMap.groundY(gate.x, gate.z), gate.z);
    gr.userData.gate = gate;
    this.scene.add(gr);
    return gr;
  }

  // The player's chosen hero walks the overworld in miniature — the real unit
  // mesh, real walk cycle, smaller aura. Rebuilt when the pick changes.
  _makeOverworldHero() {
    if (this.owHero) { this.scene.remove(this.owHero); this._disposeObject3D(this.owHero); }
    const key = this.ui.selectedHero || 'alexander';
    const def = HEROES[key] || HEROES.alexander;
    const mesh = this._makeUnitMesh({ hero: true, key, def, auraRadius: 1.3 });
    const character = selectedMmoCharacter(this.profile);
    const tint = character ? Number.parseInt((character.appearance === 'crimson' ? 'b94b51'
      : character.appearance === 'cobalt' ? '4679b8'
      : character.appearance === 'bone' ? 'b7aa8c'
      : character.appearance === 'void' ? '6d568f'
      : character.appearance === 'forest' ? '4f785d' : '8493a6'), 16) : null;
    if (tint != null) mesh.userData.characterTint = tint;
    mesh.scale.setScalar(1.0);
    this.owHero = mesh;
    this.scene.add(mesh);
  }

  _updateOverworld(dt, t) {
    const ow = this.ow;
    if (!ow) return;
    // Steering only while the hub overlay is closed; typing in lobby inputs
    // already swallows keys, and a menu open over the world means "at ease".
    if (!this.ui.overlayHidden()) ow.setDir(0, 0);
    else {
      // The hub walks on the same bindings the battlefield does.
      const binds = this.binds();
      let dx = 0, dz = 0;
      if (isHeld(binds, this.keys, 'move_up')) dz -= 1;
      if (isHeld(binds, this.keys, 'move_down')) dz += 1;
      if (isHeld(binds, this.keys, 'move_left')) dx -= 1;
      if (isHeld(binds, this.keys, 'move_right')) dx += 1;
      ow.setDir(dx, dz);
    }
    for (const ev of ow.update(dt)) this._onOverworldEvent(ev);

    const h = ow.hero;
    if (this.owHero) {
      this.owHero.position.set(h.x, this.owMap.groundY(h.x, h.z), h.z);
      this.owHero.rotation.y = h.facing;
      // The real walk cycle from _syncUnits, mirrored here so the overworld
      // hero moves like he does in a fight.
      const pose = unitPose(h.moving ? 'run' : 'idle', t * (h.moving ? 10 : 1.8));
      const body = this.owHero.userData.body;
      if (body) {
        body.position.y = pose.y;
        body.rotation.z = pose.roll;
      }
      const limbs = this.owHero.userData.limbs;
      if (limbs) {
        if (limbs.legL) limbs.legL.rotation.x = pose.stride;
        if (limbs.legR) limbs.legR.rotation.x = -pose.stride;
        if (limbs.armL) limbs.armL.rotation.x = -pose.stride * 0.55;
        if (limbs.armR) limbs.armR.rotation.x = pose.stride * 0.55;
      }
    }

    // Gates breathe: locked ones pulse a corrupted violet, open ones ripple
    // gently, and every banner sways on its pole.
    for (const gr of this.owGates) {
      const st = gateState(gr.userData.gate);
      const ph = (t * 0.7) % 1;
      gr.userData.ring.material.opacity = st.locked
        ? 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.2))
        : 0.3 * (1 - ph * 0.6);
      gr.userData.ring.scale.setScalar(1 + ph * 0.12);
      gr.userData.banner.rotation.y = Math.sin(t * 1.8 + gr.position.x) * 0.22;
    }
    this._updateOverworldGhosts(dt, t);
  }

  _onOverworldEvent(ev) {
    if (ev.t !== 'gate') return;
    if (ev.state.locked) {
      this.shake = 0.35;
      this.audio.deny();
      this.ui.showBanner('🔒 The road ends here — take the front before it first.', 'bad', 2600);
      return;
    }
    this.owEnterNote = ev.gate.cave ? 'The Labyrinth' : ev.gate.name;
    if (ev.gate.portal) {
      if (ev.gate.action === 'custom') {
        this._openCustomGames();
        return;
      }
      this._openGalaxyMap();
      return;
    }
    this.ui.showGateConfirm({
      gate: ev.gate,
      diff: this.ui.selectedDiff,
      onEnter: (diff) => {
        if (ev.gate.cave) {
          // The trial ledger IS the labyrinth flow: the setup screen lists
          // the trials, exactly as Play Solo → The Labyrinth does.
          this.ui.selectedMode = 'labyrinth';
          this.ui.showSetup({ mode: 'labyrinth' });
          return;
        }
        // Same path the setup screen's START button takes; only the level
        // selection is made by geography instead of a card click.
        this.ui.selectedMode = 'campaign';
        this.ui.selectedLevel = ev.gate.levelId;
        this.ui.selectedDiff = diff;
        this.ui.cb.onStart(diff, this.ui.selectedHero);
      },
    });
  }

  // ----- multiplayer ghosts: presence garnish, never game netcode -----

  _owGhostSend(payload) {
    if (!OVERWORLD_GHOSTS || !this.lobby?.connected || !this.lobby.sb || !this.lobby.me) return;
    try {
      if (!this._owGhostChan) {
        // Presence is scoped per planet: ghosts you see walk YOUR world.
        this._owGhostChan = this.lobby.sb.channel(overworldChannel(this.ow.world.id))
          .on('broadcast', { event: 'pos' }, ({ payload: p }) => {
            if (!this.ow || !p || p.id === this.lobby.me.id) return;
            if (p.worldId && p.worldId !== this.ow.world.id) return; // another planet's ghost
            this.ow.ghostUpsert(p.id, p, this.ow.time);
            if (p.enter) this._owGhostNote(p);
          })
          .subscribe();
      }
      const res = this._owGhostChan.send({ type: 'broadcast', event: 'pos', payload });
      if (res && res.catch) res.catch(() => {});
    } catch { /* the overworld is walkable alone */ }
  }

  _updateOverworldGhosts(dt, t) {
    if (!OVERWORLD_GHOSTS) return;
    this._owGhostAcc = (this._owGhostAcc || 0) + dt;
    if (this._owGhostAcc >= 0.25) {
      this._owGhostAcc = 0;
      const h = this.ow.hero;
      this._owGhostSend({
        id: this.lobby?.me?.id || 'local',
        name: this._publicName(),
        hero: this.ui.selectedHero,
        worldId: this.ow.world.id,
        x: Math.round(h.x * 10) / 10, z: Math.round(h.z * 10) / 10,
        enter: this.owEnterNote || undefined,
      });
      this.owEnterNote = null;
      this.ow.ghostSweep(6, this.ow.time);
    }
    this.owGhostMeshes = this.owGhostMeshes || new Map();
    for (const [id, g] of this.ow.ghosts) {
      let mesh = this.owGhostMeshes.get(id);
      if (!mesh) {
        const def = HEROES[g.hero] || HEROES.alexander;
        mesh = this._makeUnitMesh({ hero: true, key: g.hero, def, auraRadius: 1.3 });
        mesh.scale.setScalar(0.92);
        mesh.userData.label = this._makeLabelSprite('👤', g.name);
        mesh.userData.label.position.y = 2.6;
        mesh.userData.label.scale.set(3.4, 1.7, 1);
        mesh.add(mesh.userData.label);
        this.scene.add(mesh);
        this.owGhostMeshes.set(id, mesh);
      }
      mesh.position.set(g.x, this.owMap.groundY(g.x, g.z), g.z);
      mesh.userData.label.material.opacity = 0.85;
    }
    for (const [id, mesh] of this.owGhostMeshes) {
      if (!this.ow.ghosts.has(id)) {
        this.scene.remove(mesh);
        this._disposeObject3D(mesh);
        this.owGhostMeshes.delete(id);
      }
    }
    void t;
  }

  // "X entered Greenfall Marches" — the hub chat strip doubles as the war
  // report for whoever is walking the same planet.
  _owGhostNote(p) {
    this._hubChatLog = [...(this._hubChatLog || []), { name: p.name || 'A commander', text: `entered ${p.enter}` }];
    this.ui.hubChat(this._hubChatLog);
  }

  // ---------------- game start ----------------

  async startGame(difficulty, heroKey, mp = null, snap = null) {
    // The host can finish startup first and send window zero while this guest
    // is still loading assets. Keep the existing Map alive across every await
    // so early windows are not discarded when the sim is initialized.
    const matchInbox = inboxForMatchStart(mp?.role, this.inbox);
    this.audio.init();
    this._clearMenuBackdrop();
    if (!this.assetsLoaded) {
      this.ui.showBanner('Loading…', '', 1500);
      await loadAssets();
      this.assetsLoaded = true;
    }
    // Remember launches that came off the walkable planet: victory's
    // "Return to world" keys off this, because the profile's character may
    // not be hydrated by the time the button is clicked — and losing the
    // relay dumped returning commanders on the title screen (QA 2026-08-18).
    this._runFromOverworld = !!this.ow;
    this._clearOverworld();
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
      this.inbox = matchInbox;
      this.hashes = { local: new Map() };
      this.netPrimed = false;
      this.netStallT = 0;
      this.speed = 1;
      this.desynced = false;
      this._recentWindows = [];
      this._windowHistory = new Map();
      this.netBufferTarget = adaptiveWindowTarget(this.netDiagnostics.rttMs, this.netDiagnostics.jitterMs);
      this._missingWindow = -1;
      this._missingRequestAt = 0;
      this._netClockLast = performance.now();
      // Co-op keeps the graphics the player chose. The sim pump below keeps
      // windows flowing even when the render loop hitches, so guests no
      // longer pay for the host's frame drops.
      this._netPumpStart();
      if (this.onlineMode && this.lobby) this.lobby.setMatchActive(true);
    }
    for (const f of this.blockFx) { this.scene.remove(f.mesh); this._disposeObject3D(f.mesh); }
    this.blockFx = [];
    this._blockT = 0;
    this._blockWarned = {};
    this.terrain = this.map.buildTerrain();
    this.scene.add(this.terrain);
    this._setupFogOfWar();
    // The plaza and city appear where (and when) the city is founded.
    if (this.plaza) { this.scene.remove(this.plaza); this.plaza = null; }
    this._clearSiteMarkers();
    this._clearNestMeshes();
    this._clearLootMeshes();
    if (this.game.site >= 0) {
      const s = this.map.sites[this.game.site];
      this.plaza = this._buildPlaza(s.x, s.z);
      this.scene.add(this.plaza);
    } else if (this.game.mode !== 'labyrinth') {
      // Labyrinth runs never found a city, so "claim this ground" flags would
      // be a lie there — sanctuaries are just rooms.
      this._makeSiteMarkers();
      this._clearNodeMarkers();
    } else {
      this._clearNodeMarkers();
    }
    this.map.drawMinimap(document.getElementById('minimap-base'));
    this.ui.hideStart();
    this.ui.initHUD(this.game, this.myPlayer,
      this.game.mode === 'campaign' ? selectedMmoCharacter(this.profile) : null);
    this.ui.setGameChatEnabled(this.netMode);
    if (this.netMode) this.ui.gameChatFill([]);
    this.setSpeed(1);
    // Gameplay uses a fixed world/minimap orientation: left in the viewport is
    // left on the minimap. The menu can orbit, but a run must not inherit it.
    this.camYaw = 0;
    this.lastDir = { x: 0, z: 0, s: false };
    // The labyrinth has nothing to build, so construction markers stay hidden.
    if (mode === 'labyrinth') {
      this.controlMode = 'fight';
      if (this.ui.setControlMode) this.ui.setControlMode('fight');
    }
    this.ui.showBanner(mode === 'survival'
      ? `${level.name} — SURVIVAL. The siege never stops. A boss walks every fifth surge. How long can you last?`
      : mode === 'labyrinth'
      ? `${level.name} — raze every brood chamber, take its blessing, and kill ${level.boss.icon} ${level.boss.name} at the bottom. ${this.game.lives} lives.`
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
    // The colony's landing terrace: light poured-pad concrete with an amber
    // guide ring, and paved walkways out to the gates a shade lighter than
    // the ground — markings on a pad, not dark bars stamped across the city.
    const g = new THREE.Group();
    const hq = (this.game && this.game.plots || []).find((p) => p.kind === 'hq');
    const plan = hq && hq.plan;
    const squarePlaza = plan && plan.key === 'fort';
    const disc = new THREE.Mesh(
      squarePlaza ? new THREE.PlaneGeometry(12.6, 12.6) : new THREE.CircleGeometry(7.2, 40),
      new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0xa6a091 }),
    );
    disc.rotation.x = -Math.PI / 2;
    if (squarePlaza) disc.rotation.z = -plan.facing;
    const plazaY = this.map.groundY(cx, cz);
    disc.position.set(cx, plazaY + 0.015, cz);
    disc.receiveShadow = true;
    g.add(disc);
    const ringGeo = new THREE.RingGeometry(5.6, 5.85, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xe8843c, transparent: true, opacity: 0.4, depthWrite: false,
    }));
    ring.position.set(cx, plazaY + 0.03, cz);
    g.add(ring);
    const laneMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0xb3ad9e });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xfff2d8, transparent: true, opacity: 0.35, depthWrite: false });
    const lanes = plan && plan.gates.length ? plan.gates : [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    const len = plan ? Math.max(9, plan.reach - 4) : 10.5;
    for (const a of lanes) {
      const lane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, len), laneMat);
      lane.rotation.x = -Math.PI / 2;
      lane.rotation.z = -a;
      lane.position.set(cx + Math.cos(a) * (len / 2 + 4), plazaY + 0.012, cz + Math.sin(a) * (len / 2 + 4));
      lane.receiveShadow = true;
      g.add(lane);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.14, len), stripeMat);
      stripe.rotation.copy(lane.rotation);
      stripe.position.copy(lane.position);
      stripe.position.y = plazaY + 0.022;
      g.add(stripe);
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
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 6), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0x3a3228 }));
      pole.position.set(s.x, 2.5, s.z);
      gr.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.05), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0xc9a44a }));
      flag.position.set(s.x + 0.85, 4.4, s.z);
      gr.add(flag);
      gr.userData.flag = flag;
      const label = this._makeLabelSprite('🏳️', (s.name || `SITE ${i + 1}`).toUpperCase());
      label.position.set(s.x, 6.3, s.z);
      label.scale.set(4.2, 2.1, 1);
      gr.add(label);
      gr.position.y = this.map.groundY(s.x, s.z);
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
        `A ${survey.plan.label} would stand here · ${keyLabel(this.binds().build)} to found the city`, 5600);
    });
  }

  _makeNestMesh(n) {
    // The hive: a breathing chitin boil, not a rock. Layered mounds under a
    // ribcage of grown spines, egg sacs glued to the flanks, glowing brood
    // fissures, and a ring of churned dead earth so it stains the map around
    // itself. Deterministic per nest id so peers agree on the dressing.
    const g = new THREE.Group();
    const vid = (n.id || 0) * 7919;
    const rot = (k) => ((vid >> k) % 628) / 100;
    const mat = (c, e = 0) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: c, emissive: e ? c : 0x000000, emissiveIntensity: e });
    const HIDE = 0x3a2a4a, HIDE2 = 0x2c2038, VEIN = 0xb44dff, SAC = 0x8a5cc0, EARTH = 0x2e2433;

    // Churned dead-earth ring.
    const ringGeo = new THREE.CircleGeometry(3.1, 20);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: EARTH, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.position.y = 0.03;
    ring.receiveShadow = true;
    g.add(ring);

    const mound = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), mat(HIDE));
    mound.scale.y = 0.55;
    mound.position.y = 0.4;
    mound.castShadow = true;
    g.add(mound);
    g.userData.mound = mound;
    // Secondary boils shoulder out of the main mound.
    for (let i = 0; i < 3; i++) {
      const a = rot(i) + i * 2.1;
      const boil = new THREE.Mesh(new THREE.SphereGeometry(0.7 + (i % 2) * 0.25, 9, 6), mat(i % 2 ? HIDE2 : HIDE));
      boil.scale.y = 0.6;
      boil.position.set(Math.cos(a) * 1.6, 0.35, Math.sin(a) * 1.6);
      boil.castShadow = true;
      g.add(boil);
    }
    // The grown ribcage: paired spines curving over the crown.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rot(3);
      const h = 1.2 + (i % 3) * 0.5;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.22 + (i % 2) * 0.08, h, 5), mat(HIDE2));
      spike.position.set(Math.cos(a) * 1.5, 0.75 + h * 0.25, Math.sin(a) * 1.5);
      spike.rotation.z = Math.cos(a) * 0.55;
      spike.rotation.x = -Math.sin(a) * 0.55;
      spike.castShadow = true;
      g.add(spike);
    }
    // Egg sacs glued low on the flanks — matte, faintly lit from within.
    for (let i = 0; i < 5; i++) {
      const a = rot(i + 1) + i * 1.35;
      const r = 1.9 + (i % 2) * 0.45;
      const sac = new THREE.Mesh(new THREE.SphereGeometry(0.24 + (i % 3) * 0.08, 7, 5), mat(SAC, 0.25));
      sac.scale.y = 1.25;
      sac.position.set(Math.cos(a) * r, 0.22, Math.sin(a) * r);
      sac.castShadow = true;
      g.add(sac);
    }
    // Brood fissures: the glow that tells you where to shoot.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 1.1;
      const blob = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), mat(VEIN, 1.8));
      blob.scale.set(1, 0.55, 1.6);
      blob.position.set(Math.cos(a) * 1.1, 1.02, Math.sin(a) * 1.1);
      blob.rotation.y = -a;
      g.add(blob);
    }
    const maw = new THREE.Mesh(new THREE.SphereGeometry(0.5, 9, 6), mat(VEIN, 1.4));
    maw.scale.y = 0.4;
    maw.position.y = 1.42;
    g.add(maw);
    g.position.set(n.x, this.map.groundY(n.x, n.z), n.z);
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
        this._disposeObject3D(mesh);
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
          new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0xffd75e, emissive: 0xa8791a, emissiveIntensity: 0.6 }),
        );
        gem.castShadow = true;
        mesh.add(gem);
        mesh.userData.gem = gem;
        const label = this._makeLabelSprite(it ? it.icon : '📦', '');
        label.position.y = 1.5;
        label.scale.set(2.2, 1.1, 1);
        mesh.add(label);
        mesh.userData.gy = this.map.groundY(l.x, l.z);
        mesh.position.set(l.x, mesh.userData.gy, l.z);
        this.scene.add(mesh);
        this.lootMeshes.set(l.id, mesh);
      }
      mesh.position.set(l.x, mesh.userData.gy + 0.55 + Math.sin(t * 2.4 + l.id) * 0.12, l.z);
      mesh.userData.gem.rotation.y = t * 1.4 + l.id;
    }
    for (const [id, mesh] of this.lootMeshes) {
      if (live.has(id)) continue;
      this.scene.remove(mesh);
      this._disposeObject3D(mesh);
      this.lootMeshes.delete(id);
    }
  }

  _clearLootMeshes() {
    for (const m of (this.lootMeshes || new Map()).values()) { this.scene.remove(m); this._disposeObject3D(m); }
    this.lootMeshes = new Map();
  }

  _clearNestMeshes() {
    for (const m of (this.nestMeshes || new Map()).values()) { this.scene.remove(m); this._disposeObject3D(m); }
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
    const binds = this.binds();
    const build = keyLabel(binds.build);
    const push = keyLabel(binds.stance_push);
    const tower = keyLabel(binds.tower_priority);
    const steps = [
      [1.5, '🕹️ WASD moves your hero. Hold SHIFT to sprint.'],
      [5, `🏳️ This land is unclaimed! Ride to a flagged site and press ${build} to found your city.`],
      [14, `💰 Walk to a glowing foundation and HOLD ${build} — your coins build it.`],
      [24, `⚔️ Every gate is a ward: towers to hold it and a camp to muster at it. Press ${push} and those squads push out along the lanes on their own.`],
      [30, '🧱 Crag, water and deep wood are already wall — you only pay for the gaps. Out on the approaches, a fence across a pass costs almost nothing and funnels them into your tower.'],
      [36, '🚩 Stand on a lane node with no enemies nearby to take it. Held nodes pay you and let you raise a Forward Camp.'],
      [48, '🔥 Every hive keeps mustering until you raze it. Raze them all, then break the counterattack.'],
      [62, `🔧 Nothing repairs itself — hold ${build} to repair. Press ${tower} beside a tower to change what it shoots.`],
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
        normalizeMmoCharacters(this.profile);
        const character = selectedMmoCharacter(this.profile);
        if (character) {
          this.ui.selectedHero = character.proxyHero;
          this.profile.lastHero = character.proxyHero;
        }
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
      this._authenticatedEntryHandled = false;
    }
    this.authStatus = this.auth.status({ error: status.error, reason: status.reason });
    this.ui.setAccount(this.authStatus);
    if (status.signedIn && sessionStorage.getItem('zillions-return-to-world') === '1') {
      sessionStorage.removeItem('zillions-return-to-world');
      // Returning from a finished run: back onto the planet you launched
      // from. No character yet (created mid-session edge)? Land on the
      // roster, one click from making one — never a dead title screen.
      const returning = selectedMmoCharacter(this.profile);
      this._authenticatedEntryHandled = true;
      if (returning) setTimeout(() => this._enterOverworld(
        returning.lastWorld || this.profile.lastWorld || 'earth'), 0);
      else setTimeout(() => this.ui.showCharacterCreator(), 0);
      return;
    }
    // ENTER WORLD is the only front door. Once authentication and profile
    // hydration finish, do not make the player pass through a second roster
    // confirmation. Existing characters resume their last world; a new
    // account goes directly to creation and enters Earth after submit.
    if (status.signedIn && !status.needsUsername && !this._authenticatedEntryHandled) {
      this._authenticatedEntryHandled = true;
      const character = selectedMmoCharacter(this.profile);
      if (character) setTimeout(() => this._enterOverworld(
        character.lastWorld || this.profile.lastWorld || 'earth'), 0);
      else setTimeout(() => this.ui.showCharacterCreator(), 0);
    }
  }

  _restartOrReturn() {
    // Any campaign run that came off the planet — or belongs to a character —
    // returns to the world, not the title screen.
    if (this.game?.over && this.game.mode === 'campaign'
      && (this._runFromOverworld || selectedMmoCharacter(this.profile))) {
      try { sessionStorage.setItem('zillions-return-to-world', '1'); } catch { /* blocked storage */ }
    }
    location.reload();
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
        normalizeMmoCharacters(this.profile);
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
        campaignHeroes: {}, relics: [], questsDone: {}, mmoCharacters: [], mmoCharacterId: null,
        ...JSON.parse(localStorage.getItem('zillions_profile') || '{}'),
      };
    } catch { return { name: '', games: 0, wins: 0, kills: 0, bestDay: 0, lastHero: null, campaignHeroes: {}, relics: [], questsDone: {}, mmoCharacters: [], mmoCharacterId: null }; }
  }

  _selectMmoCharacter(id) {
    normalizeMmoCharacters(this.profile);
    const character = this.profile.mmoCharacters.find((entry) => entry.id === id);
    if (!character) return;
    this.profile.mmoCharacterId = character.id;
    this.profile.lastHero = character.proxyHero;
    this.profile.lastWorld = character.lastWorld || this.profile.lastWorld || 'earth';
    this.ui.selectedHero = character.proxyHero;
    this._saveProfile();
    this.ui.setProfile(this.profile);
    if (!this.game && this.ow) this._makeOverworldHero();
  }

  _createMmoCharacter({ name, classKey, appearance } = {}) {
    const clean = String(name || '').trim();
    if (!clean) {
      this.ui.showBanner('Choose a character name.', 'bad', 2200);
      return;
    }
    const character = makeMmoCharacter(clean, classKey, appearance);
    if (!addMmoCharacter(this.profile, character)) {
      this.ui.showBanner('The character roster is full.', 'bad', 2200);
      return;
    }
    this.profile.lastHero = character.proxyHero;
    this.profile.lastWorld = character.lastWorld;
    this.ui.selectedHero = character.proxyHero;
    this._saveProfile();
    this.ui.setProfile(this.profile);
    const klass = MMO_CLASSES[character.classKey];
    this.ui.showBanner(`${klass.icon} ${character.name}, ${klass.name}, enters the galaxy.`, '', 3000);
    const worldId = character.lastWorld || 'earth';
    if (this.ow && this.ow.world?.id !== worldId) this._travelToWorld(worldId);
    else this._enterOverworld(worldId);
  }

  // The WC3-style persistent campaign hero this profile brings into a run.
  campFor(key) {
    const character = selectedMmoCharacter(this.profile);
    if ((this.ui.selectedMode || 'campaign') === 'campaign' && character && key === character.proxyHero) {
      return characterCamp(character, this.profile.relics || []);
    }
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
    // On the overworld the pick is visible immediately: the walking hero is
    // rebuilt from the new unit def.
    if (!this.game && this.ow) this._makeOverworldHero();
    if (this.mpRole === 'guest' && this.net?.open) this.net.send(msg);
    if (this.mpRole === 'host') this._syncSetupRoster();
    if (this.lobby?.game) {
      this.lobby.updateRoomPlayer({ hero: key, ...(this.mpRole === 'guest' ? { ready: false } : {}) }).catch((e) => {
        console.warn('room hero update failed', e);
      });
    }
  }

  _roomRosterFromGame(game) {
    const players = [...(game?._players || [])]
      .sort((a, b) => Number(a.seat || 99) - Number(b.seat || 99));
    return players.map((p, i) => {
      const peerIndex = this.peerUserIds?.indexOf(p.user_id) ?? -1;
      const local = p.user_id === game.host_id || p.user_id === this.lobby?.me?.id;
      const connected = local || (peerIndex >= 0 && !!this.peers[peerIndex]?.open);
      const reconnecting = !!this.onlinePending?.has(p.user_id);
      return {
        seat: Number(p.seat || i + 1),
        userId: p.user_id,
        name: p.display_name || 'Commander',
        hero: p.hero,
        host: p.user_id === game.host_id,
        you: p.user_id === this.lobby?.me?.id,
        ready: !!p.ready,
        state: connected ? 'connected' : reconnecting ? 'reconnecting' : 'disconnected',
        unlockedLevel: Math.max(1, Number(p.unlocked_level) || 1),
      };
    });
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
      this._broadcast({ t: 'lobbyRoster', n: players.length, players, mode: this.ui.selectedMode || 'campaign' });
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
    if (won && this.game.mode !== 'survival') p.wins++;
    // Only campaign wins advance the war for Earth — a labyrinth trial id
    // (9001+) written here would unlock the whole galaxy.
    if (won && this.game.mode === 'campaign') {
      p.campaign = Math.max(p.campaign || 0, this.game.levelId);
    }
    if (this.game.mode === 'survival') {
      p.bestSurvival = Math.max(p.bestSurvival || 0, this.game.threatLevel);
    }
    if (won && this.game.mode === 'labyrinth') {
      p.labyrinthClears = { ...(p.labyrinthClears || {}), [this.game.levelId]: true };
    }
    p.kills += this.game.stats.kills;
    p.bestDay = Math.max(p.bestDay, this.game.threatLevel);
    p.lastHero = this.ui.selectedHero;
    const metaAward = awardRun({ ...runScore(this.game), won: !!won });
    this.meta = metaAward.meta;
    p.metaCurrency = metaAward.currency;

    // WC3-style persistence: the campaign hero keeps every level and item —
    // and quest/boss rewards granted here await them on the next map.
    this._endExtras = null;
    const h = this.game.heroes[this.myPlayer];
    // Named heroes belong to Custom Games. Their legacy career records remain
    // available there, but persistent campaign instances write to the selected
    // player-created character instead.
    if (h && this.game.mode !== 'campaign') {
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
    if (h && this.game.mode === 'campaign') {
      const character = selectedMmoCharacter(p);
      if (character) {
        p.relics = p.relics || [];
        p.questsDone = p.questsDone || {};
        const rewards = [...new Set(h.pack || [])].filter((key) => ITEMS[key]);
        for (const q of this.game.questResults || []) {
          if (!q.done || p.questsDone[q.id]) continue;
          p.questsDone[q.id] = true;
          if (ITEMS[q.reward]?.kind === 'relic') {
            if (!p.relics.includes(q.reward)) p.relics.push(q.reward);
          } else if (ITEMS[q.reward]) rewards.push(q.reward);
        }
        const drop = won ? BOSS_DROPS[this.game.levelId] : null;
        if (drop) rewards.push(drop);
        const xp = Math.max(25, Math.floor(this.game.stats.kills * 0.35))
          + (this.game.stats.nests || 0) * 30
          + (won ? 180 + this.game.levelId * 25 : 0);
        const result = recordMmoInstance(character, {
          won,
          kills: this.game.stats.kills,
          xp,
          world: this.profile.lastWorld || 'earth',
          items: [...new Set([...(h.items || []), ...rewards])],
        });
        character.upgrades = { ...(character.upgrades || {}), ...(h.upgrades || {}) };
        this._endExtras = {
          heroKey: character.proxyHero,
          heroName: character.name,
          level: character.level,
          grants: result.items,
          quests: this.game.questResults || [],
          xp,
          levels: result.levels,
        };
        this.ui.setProfile(p);
      }
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

  async continueGame() {
    const save = this._loadSave();
    if (!save) return;
    await recoverableRestore(async () => {
      if (this.mpRole === 'host' && this.peers.length) {
        if (save.snap.heroKeys.length !== this.peers.length + 1) {
          this.ui.mpStatus(`❌ That save is for ${save.snap.heroKeys.length} players — you have ${this.peers.length + 1} connected.`);
          return;
        }
        this.peers.forEach((p, i) => p.send({ t: 'start', snap: save.snap, you: i + 1 }));
        await this.startGame(save.snap.diff, null, { myPlayer: 0, role: 'host' }, save.snap);
      } else if (!this.mpRole) {
        await this.startGame(save.snap.diff, null, null, save.snap);
      }
    }, (error) => this._discardBrokenSave(error));
  }

  _discardBrokenSave(error) {
    console.error('saved game restore failed', error);
    try { localStorage.removeItem('zillions_save'); } catch { /* blocked storage */ }
    this.ui.setContinue(null);
    this.ui.showBanner('That save could not be restored and was removed. Start a new war.', 'bad', 8000);
    if (this.auth?.isSignedIn()) {
      this.auth.clearLatestSave().catch((cloudError) => console.warn('cloud save clear failed', cloudError));
    }
  }

  _handleFrameError(error) {
    this.paused = true;
    this._netPumpStop();
    console.error('game frame failed', error);
    this.ui.showBanner('The battlefield stopped after an error. Reload to continue.', 'bad', 15000);
  }

  async hostGame() {
    this.audio.init();
    this.mpRole = 'host';
    await this._newInvite();
  }

  // Each joining player gets their own invite/reply exchange.
  async _newInvite() {
    const peer = new NetSession();
    this._attachNetDiagnostics(peer);
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
    else if (m.t === 'startReady') {
      this.startReadyGuests.add(idx);
      if (matchStartReady(this.startExpectedGuests, this.startReadyGuests.size)) {
        this.startBarrier = false;
        this._netClockLast = performance.now();
        this.acc = 0;
        this.ui.setWaiting(false);
        this.ui.showBanner('⚔️ All players loaded — the war begins.', '', 2600);
      } else {
        const pending = this.startExpectedGuests - this.startReadyGuests.size;
        this.ui.setWaiting(true, `⏳ Waiting for ${pending} player${pending === 1 ? '' : 's'} to load…`);
      }
    }
    else if (m.t === 'cmd') this.guestCmdQueues[idx].push(m.c);
    else if (m.t === 'needWindow') {
      const bundle = this._windowHistory.get(Number(m.w));
      const peer = this.peers[idx];
      if (bundle && peer) peer.sendFast({ t: 'w', w: Number(m.w), c: bundle, p: [] });
    }
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
    this._attachNetDiagnostics(this.net);
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
    if (m.t === 'countdown') {
      this.audio.init();
      this.audio.countdown(m.count);
      this.ui.showRoomCountdown(m.count);
    }
    else if (m.t === 'countdownCanceled') {
      this.ui.showBanner('Launch canceled: a player disconnected.', 'bad', 4000);
      if (this.lobby?.game) this._onRoomUpdate(this.lobby.game);
    }
    else if (m.t === 'lobby') {
      this.mpSeat = m.n;
      this.ui.mpConnected(false, m.n, this._guestRoster(m.players, m.n));
    }
    else if (m.t === 'lobbyRoster') this.ui.roomRoster(this._guestRoster(m.players, this.mpSeat || 2), { isHost: false, mode: m.mode || this.ui.selectedMode || 'campaign' });
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
      this.ui.setWaiting(true, '⏳ Loading the shared battlefield…');
      if (m.snap) await this.startGame(m.snap.diff, null, { myPlayer: m.you, role: 'guest' }, m.snap);
      else await this.startGame(m.d, null, { heroes: m.heroes, myPlayer: m.you, role: 'guest', level: m.level, mode: m.mode });
      this.net.send({ t: 'startReady' });
      this.ui.setWaiting(true, '⏳ Loaded — waiting for host to begin…');
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
    return stateHash(this.game);
  }

  // ---------------- lockstep engine ----------------

  _attachNetDiagnostics(session) {
    session.onDiagnostics = (diag) => {
      this.netDiagnostics = diag;
      this.netBufferTarget = adaptiveWindowTarget(diag.rttMs, diag.jitterMs);
      this._refreshDiagnosticsUI();
    };
  }

  _refreshDiagnosticsUI(stalled = false) {
    if (!this.netMode) { this.ui.setNetworkDiagnostics(null); return; }
    const now = performance.now();
    if (!stalled && now - this._diagUiAt < 350) return;
    this._diagUiAt = now;
    this.ui.setNetworkDiagnostics({
      ...this.netDiagnostics,
      stalled,
      buffered: this.mpRole === 'guest' ? this._windowsBuffered() : 0,
      target: this.mpRole === 'guest' ? this.netBufferTarget : 0,
      frameMs: this._frameMs,
    });
  }

  _requestMissingWindow(w) {
    if (!this.net || this.mpRole !== 'guest') return;
    const now = performance.now();
    if (this._missingWindow === w && now - this._missingRequestAt < 180) return;
    this._missingWindow = w;
    this._missingRequestAt = now;
    this.net.send({ t: 'needWindow', w });
  }

  // Host-sequenced lockstep: the host merges every player's commands into
  // numbered windows and broadcasts them; guests advance only as windows
  // arrive, so all sims stay in step. Driven by BOTH the render loop and the
  // pump (a worker timer) off one shared wall clock, so the host keeps
  // emitting windows even when rendering hitches or the tab is hidden.
  _advanceNetSim() {
    if (!this.netMode || !this.game || this.paused || this.game.over) return;
    if (this.mpRole === 'host' && this.startBarrier) {
      this._netClockLast = performance.now();
      this.ui.setWaiting(true, '⏳ Waiting for every player to load…');
      return;
    }
    const now = performance.now();
    let dt = Math.min((now - (this._netClockLast ?? now)) / 1000, 0.25);
    this._netClockLast = now;

    // Adaptive pacing: instead of stall-and-burst, a guest drifts its sim
    // rate a few percent to hold its measured jitter target in the bank.
    // Network jitter then shows up as imperceptible speed drift, not freezes.
    if (this.mpRole === 'guest') {
      const banked = this._windowsBuffered();
      if (banked < this.netBufferTarget) dt *= NET_PACE_SLOW;
      else if (banked >= this.netBufferTarget + 2) dt *= NET_PACE_FAST;
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
          rememberWindow(this._windowHistory, w, bundle, NET_HISTORY);
        } else {
          bundle = this.inbox.get(w);
          if (!bundle) {
            // A real gap. Re-arm the buffer so we come back with margin
            // instead of running window-to-window and stuttering forever.
            stalled = true;
            this.netPrimed = false;
            this._requestMissingWindow(w);
            break;
          }
          if (!this.netPrimed) {
            // The window channel is intentionally unordered. A large inbox is
            // not necessarily a usable buffer: [w, w+2] still has a hole at
            // w+1 and would restart for one tick, freeze, then repeat. Resume
            // only behind a consecutive run of windows.
            const hasBuffer = hasConsecutiveWindowBuffer(this.inbox, w, this.netBufferTarget);
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
    const visibleStall = stalled && this.netStallT > 0.25;
    this.ui.setWaiting(visibleStall, this.netStallT > 1.2
      ? `⏳ Network catch-up — waiting for window ${Math.ceil(this.simFrame / NET_STEP)}…`
      : '⏳ Syncing co-op…');
    this._refreshDiagnosticsUI(visibleStall);
  }

  // Consecutive windows banked ahead of the guest's next lockstep boundary.
  _windowsBuffered() {
    const w = Math.ceil(this.simFrame / NET_STEP);
    return consecutiveWindowCount(this.inbox, w);
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
      onChat: (m) => { this.ui.lobbyChatAdd(m); this._hubChatDirty = true; },
      onRoomChat: (m) => {
        if (m.channel === 'game') this.ui.gameChatAdd(m);
        else this.ui.roomChatAdd(m);
      },
      onGames: (g) => {
        this.ui.lobbyGames(g, (row) => this.joinOnlineGame(row), (row) => this.watchOnlineGame(row), this.lobby?.me?.id);
        this.ui.hubGames(g);
        this._customGames = g;
        if (this.ui._lastScreen === 'custom') this._renderCustomBrowser();
      },
      onOnline: (map) => { this.ui.lobbyOnline(map); this.ui.hubOnline(map ? map.size || Object.keys(map).length : 0); },
      onFriends: (friends) => this.ui.lobbyFriends(friends),
      onInvite: (inv) => this.ui.showInviteToast(inv, () => this.acceptInvite(inv)),
      onRoom: (game) => this._onRoomUpdate(game),
      onKnock: (sig) => this._onKnock(sig),
      onSignal: (sig) => this._onSignal(sig),
      onRoomClosed: (reason) => this._handleRoomClosed(reason),
    });
    this.ui.fillLore(LORE, TIPS);
    this.ui.lobbyStatus('Connecting…');
    try {
      const me = await this.lobby.connect(this.profile.name || 'Commander', this.auth?.client || null);
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
    const readiness = roomLaunchReadiness(game, this.peers.length + 1);
    const eligibility = roomLevelEligibility(game);
    const compatible = eligibility.eligible;
    const { connected, expectedPlayers, pending, waiting, ready } = readiness;
    const waitingToReady = waiting?.length || 0;
    const connectionBlockers = this._roomRosterFromGame(game).filter((player) => !player.host && player.state !== 'connected');
    const connectionNames = connectionBlockers.map((player) => `@${player.name}`).join(', ');
    this.ui.setRoomSettings({ level: game.level || 1, difficulty: game.difficulty || 'normal', isHost, mode: game.mode || 'campaign' });
    this.ui.setRoomExit({ isHost });
    this.ui.roomRoster(this._roomRosterFromGame(game), {
      maxPlayers: game.max_players || 3,
      isHost,
      code: game.join_code,
      mode: game.mode || this.ui.selectedMode || 'campaign',
      level: game.level || 1,
      difficulty: game.difficulty || 'normal',
      launchText: isHost
        ? (!compatible
          ? `Cannot start Level ${eligibility.level}: ${eligibility.blockers.map((p) => `@${p.name} has only unlocked through Level ${p.unlockedLevel}`).join('; ')}.`
          : pending
          ? `Waiting for ${connectionNames || `${pending} player${pending === 1 ? '' : 's'}`} to connect. Use Reconnect or Remove if this lasts more than 10 seconds.`
          : waitingToReady
          ? `${waitingToReady} player${waitingToReady === 1 ? ' has' : 's have'} not marked Ready.`
          : connected > 1 ? `The game connection is ready for ${connected} players. Use START to launch everyone.` : 'Share the room code. You can start now, or wait for more players.')
        : isSpectator ? 'You are connecting as a read-only watcher. The live battle will open automatically.'
        : 'You are in the room. Pick your hero and wait for the host to press START.',
    });
    this.ui.setStartButton(isHost ? {
      text: !compatible
        ? `🔒  LEVEL ${eligibility.level} LOCKED FOR ${eligibility.blockers.length} PLAYER${eligibility.blockers.length === 1 ? '' : 'S'}`
        : ready
        ? `▶  START ROOM — LAUNCH ${expectedPlayers} PLAYER${expectedPlayers === 1 ? '' : 'S'}`
        : pending
        ? `⏳  WAITING FOR ${connectionNames || `${pending} PLAYER${pending === 1 ? '' : 'S'}`}`
        : `⏳  WAITING FOR ${waitingToReady} READY`,
      disabled: !ready || !compatible,
      title: !compatible
        ? 'Choose a level every player has unlocked before starting.'
        : ready ? 'The host launches the match for everyone connected.' : pending
        ? 'Start unlocks when every player in the room has a direct game connection.'
        : 'Start unlocks when every guest marks Ready.',
    } : isSpectator ? {
      text: '⏳  LOADING LIVE BATTLE',
      disabled: true,
      title: 'Connecting to the host as a read-only spectator.',
    } : {
      text: '⏳  WAITING FOR HOST TO START',
      disabled: true,
      title: 'Only the host can launch this room.',
    });
    const self = (game._players || []).find((player) => player.user_id === this.lobby?.me?.id);
    this.ui.setRoomReady({
      visible: !isHost && !isSpectator && game.status === 'open',
      ready: !!self?.ready,
    });
  }

  async _setRoomReady(ready) {
    if (!this.lobby?.game || this.mpRole !== 'guest') return;
    try {
      await this.lobby.updateRoomPlayer({ ready: !!ready });
    } catch (e) {
      this.ui.showBanner(`Could not update Ready: ${e.message || 'Server update failed.'} Retry when the connection recovers.`, 'bad', 6000);
    }
  }

  async _beginLaunchCountdown() {
    if (this._launchCountdownActive || this.mpRole !== 'host' || !this.lobby?.game) return;
    const eligibility = roomLevelEligibility(this.lobby.game);
    const readiness = roomLaunchReadiness(this.lobby.game, this.peers.length + 1);
    if (!eligibility.eligible || !readiness.ready) {
      this._onRoomUpdate(this.lobby.game);
      return;
    }
    this._launchCountdownActive = true;
    this.audio.init();
    try {
      for (let count = 5; count >= 1; count--) {
        const current = roomLaunchReadiness(this.lobby.game, this.peers.length + 1);
        if (!current.ready || !roomLevelEligibility(this.lobby.game).eligible) {
          this.ui.showBanner('Launch canceled because a player disconnected or became ineligible.', 'bad', 5000);
          this._broadcast({ t: 'countdownCanceled' });
          this._onRoomUpdate(this.lobby.game);
          return;
        }
        this.ui.showRoomCountdown(count);
        this.audio.countdown(count);
        this._broadcast({ t: 'countdown', count });
        await this.lobby.sendRoomChat(`Battle starts in ${count}…`, 'room').catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      this.ui.showRoomCountdown(0);
      this._broadcast({ t: 'countdown', count: 0 });
      this._launchCountdownComplete = true;
      this.ui.activateStart();
    } finally {
      this._launchCountdownActive = false;
    }
  }

  async _retryRoomConnection(userId = null) {
    if (!this.lobby?.game) return;
    if (this.mpRole === 'host' && userId) {
      const player = this._roomRosterFromGame(this.lobby.game).find((p) => p.userId === userId);
      this.ui.onlineStatus(`🔌 Asking @${player?.name || 'player'} to reconnect…`);
      await this.lobby.signal({ t: 'reconnectRequest', to: userId }).catch((e) => {
        this.ui.showBanner(`Could not request reconnect: ${e.message}`, 'bad', 5000);
      });
      return;
    }
    if (this.mpRole !== 'guest') return;
    try { if (this.net) this.net.destroy(); } catch { /* already closed */ }
    this.net = null;
    this.ui.onlineStatus('🔌 Reconnecting to host…');
    await this.lobby.signal({ t: 'knock', name: this._publicName() });
    this._armLobbyConnectionWatchdog();
  }

  async _removeRoomPlayer(userId) {
    if (this.mpRole !== 'host' || !userId) return;
    try {
      await this.lobby.removeRoomPlayer(userId);
      const idx = this.peerUserIds.indexOf(userId);
      if (idx >= 0) {
        try { this.peers[idx]?.destroy(); } catch { /* already closed */ }
        this.peers.splice(idx, 1);
        this.guestHeroes.splice(idx, 1);
        this.guestNames.splice(idx, 1);
        this.guestCmdQueues.splice(idx, 1);
        this.peerUserIds.splice(idx, 1);
      }
      this._syncSetupRoster();
    } catch (e) {
      this.ui.showBanner(`Could not remove player: ${e.message}`, 'bad', 5000);
    }
  }

  _armLobbyConnectionWatchdog() {
    clearTimeout(this._lobbyConnectionWatchdog);
    this._lobbyConnectionWatchdog = setTimeout(() => {
      if (this.mpRole === 'guest' && !this.netMode && !this.net?.open && this.lobby?.game) {
        this.ui.onlineStatus('⚠️ Host connection stalled. Use RECONNECT TO HOST.');
        this.ui.setRoomReconnect({ visible: true, label: 'RECONNECT TO HOST' });
      }
    }, 10000);
  }

  _handleRoomClosed(reason = 'host_closed') {
    if (!this.lobby?.game || this.mpRole === 'host') return;
    clearTimeout(this._lobbyConnectionWatchdog);
    for (const peer of this.peers) { try { peer.destroy(); } catch { /* closed */ } }
    try { this.net?.destroy(); } catch { /* closed */ }
    this.peers = [];
    this.net = null;
    this.mpRole = null;
    this.onlineMode = false;
    this.lobby._clearRoomState();
    this.ui.showLobby();
    const message = reason === 'removed' ? 'You were removed from the lobby.'
      : reason === 'match_ended' ? 'The host ended the match.'
      : 'The host closed the lobby.';
    this.ui.showBanner(message, 'bad', 6000);
  }

  async _leaveOnlineRoom() {
    if (!this.lobby?.game || this.netMode) {
      this.ui.showLobby();
      return;
    }
    this.ui.onlineStatus('Leaving room…');
    try {
      await this.lobby.leaveRoom();
      for (const peer of this.peers) { try { peer.destroy(); } catch { /* closed */ } }
      if (this.net) { try { this.net.destroy(); } catch { /* closed */ } }
      this.peers = [];
      this.net = null;
      this.mpRole = null;
      this.onlineMode = false;
      this.ui.showLobby();
    } catch (e) {
      this.ui.showBanner(`Could not leave the room: ${e.message || 'Server update failed.'} Try again.`, 'bad', 6000);
    }
  }

  async _leaveOnlineMatch() {
    if (!this.lobby?.game || !this.netMode) return location.reload();
    try {
      if (this.mpRole === 'host') {
        try { await this.lobby.signal({ t: 'roomClosed', to: 'all', reason: 'match_ended' }); } catch { /* status update remains authoritative */ }
      }
      await this.lobby.endGame();
    } finally {
      location.reload();
    }
  }

  async _sendLobbyChat(text) {
    if (!this.lobby) return;
    try {
      await this.lobby.sendChat(text);
    } catch (e) {
      this.ui.showBanner('❌ Lobby chat failed: ' + e.message, 'bad', 4000);
    }
  }

  _updateRoomSettings(fields) {
    if (this.mpRole !== 'host' || !this.lobby?.game) return;
    this.lobby.updateGameSettings(fields).catch((e) => {
      console.warn('room settings update failed', e);
      this.ui.showBanner('Could not update the host game setup.', 'bad', 3000);
    });
  }

  // Multiplayer setups pick the war mode with header chips. Only whoever owns
  // the setup applies one: the online room host, or the local player in a
  // solo/manual-invite screen — a guest's click must not fork their view of
  // the room.
  _pickSetupMode(m) {
    // Any kind of guest — online room or manual invite — must not retarget
    // their local view; the host's setup is the room's truth.
    if (this.mpRole && this.mpRole !== 'host') return;
    if ((this.ui.selectedMode || 'campaign') === m) return;
    this.ui.applySetupMode(m);
    this._updateRoomSettings({ mode: m, level: this.ui.selectedLevel || 1 });
    this._syncSetupRoster();
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

  _renderCustomBrowser() {
    const games = (this._customGames || []).filter(isCustomGame);
    this.ui.showCustomBrowser({ games, offline: !this.lobby?.connected, hostName: this._publicName() });
  }

  _openCustomGames() {
    this.ui._showScreen('custom');
    this._renderCustomBrowser();
    this._openLobby().then((lobby) => {
      if (lobby?.connected) lobby.refreshGames().catch(() => this._renderCustomBrowser());
      else this._renderCustomBrowser();
    }).catch(() => this._renderCustomBrowser());
  }

  async createCustomGame({ name, mapId, mode, mapName, difficulty, maxPlayers } = {}) {
    const lobby = await this._openLobby();
    if (!lobby?.connected) {
      this.ui.showBanner('📡 The lobby is unreachable — Custom Games needs the server.', 'bad', 4500);
      return;
    }
    if (lobby.game) {
      this.ui.showBanner('Leave your current room before hosting another.', 'bad', 4000);
      return;
    }
    this.audio.init(); this.mpRole = 'host'; this.onlineMode = true; this.onlinePending = new Map();
    try {
      const game = await lobby.createGame({ visibility: 'public', level: mapId || 1, mode: mode || 'campaign', difficulty: difficulty || 'normal', unlockedLevel: highestUnlockedLevel(this.profile.campaign), name, maxPlayers, kind: 'custom', mapName });
      await lobby.updateRoomPlayer({ hero: this.ui.selectedHero }).catch(() => {});
      const room = lobby.game || game;
      this.ui.showSetup({ online: room, mode: room.mode });
      this._onRoomUpdate(room);
      this.ui.roomChatFill(await lobby.loadRoomChat(room.id, 'room'));
    } catch (error) {
      this.ui.showBanner(`❌ Could not create the game: ${error.message}`, 'bad', 5000);
      this.mpRole = null; this.onlineMode = false;
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
      const game = await lobby.createGame({
        visibility,
        level: this.ui.selectedLevel || 1,
        mode: this.ui.selectedMode || 'campaign',
        difficulty: this.ui.selectedDiff || 'normal',
        unlockedLevel: highestUnlockedLevel(this.profile.campaign),
      });
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
    this._attachNetDiagnostics(peer);
    const idx = rejoining ? rejoinIdx : this.peers.length;
    peer.onOpen = async () => {
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
        // The guest's roster is whatever we send here — re-read the room first
        // so their freshly written seat is in it, not our pre-join snapshot.
        await this.lobby.refreshCurrentGameBounded();
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
      } else if (!this.netMode) {
        const liveIdx = this.peers.indexOf(peer);
        if (liveIdx >= 0) {
          this.peers.splice(liveIdx, 1);
          this.guestHeroes.splice(liveIdx, 1);
          this.guestNames.splice(liveIdx, 1);
          this.guestCmdQueues.splice(liveIdx, 1);
          this.peerUserIds.splice(liveIdx, 1);
          this.lobby?.refreshCurrentGame().catch(() => {});
          this._syncSetupRoster();
        }
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
    if (sig.t === 'roomClosed') return this._handleRoomClosed(sig.reason);
    if (sig.t === 'reconnectRequest' && this.mpRole === 'guest') return this._retryRoomConnection();
    if (sig.t === 'offer' && (this.mpRole === 'guest' || this.mpRole === 'spectator')) {
      this.net = new NetSession(this.lobby?.iceServers);
      this._attachNetDiagnostics(this.net);
      this.net.onOpen = () => {
        clearTimeout(this._lobbyConnectionWatchdog);
        this.ui.setRoomReconnect({ visible: false });
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
    const compatibility = roomCompatibility(row);
    if (!compatibility.compatible) {
      this.ui.showBanner(compatibility.reason, 'bad', 7000);
      return;
    }
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
      await lobby.joinGame(row, highestUnlockedLevel(this.profile.campaign));
      await lobby.updateRoomPlayer({ hero: this.ui.selectedHero }).catch(() => {});
      const joinedRoom = lobby.game || row;
      this._onRoomUpdate(joinedRoom);
      const mySeat = (joinedRoom._players || []).find((player) => player.user_id === lobby.me?.id)?.seat || 2;
      this.ui.onlineStatus(`✅ YOU ARE IN — PLAYER ${mySeat}. Direct connection to host is establishing…`);
      this.ui.roomChatFill(await lobby.loadRoomChat(joinedRoom.id, 'room'));
      this._armLobbyConnectionWatchdog();
    } catch (e) {
      this.mpRole = null;
      this.onlineMode = false;
      this.ui.onlineStatus(`❌ Could not join: ${e.message}. Try JOIN again.`);
    }
  }

  async watchOnlineGame(row) {
    const lobby = await this._openLobby();
    if (!lobby || !lobby.connected || this.netMode) return;
    const compatibility = roomCompatibility(row);
    if (!compatibility.compatible) {
      this.ui.showBanner(compatibility.reason, 'bad', 7000);
      return;
    }
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
    this.sun = new THREE.DirectionalLight(0xfff0cf, 2.2);
    this.sun.position.set(85, 52, 24);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 62;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 320 });
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);
    // Warm earth bounce from below, cool sky from above — the two-tone fill
    // that makes flat-shaded low-poly read as sunlit instead of fluorescent.
    this.hemi = new THREE.HemisphereLight(0xdfe8dd, 0x9a7a58, 0.58);
    this.scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0x33406e, 0.2);
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
      this._payCoinMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0xf3c53d, emissive: 0xf3c53d, emissiveIntensity: 0.35 });
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
      y: y + this.map.groundY(fx, fz),
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
    return { x: tx, y: y + this.map.groundY(tx, tz), z: tz };
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
      this.burst(x + Math.cos(a) * radius, this.map.groundY(x, z) + 0.18, z + Math.sin(a) * radius,
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
    mesh.position.set(x, this.map.groundY(x, z) + 0.11, z);
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
    // Per-type authored silhouettes, instanced — see horde-art.js. The menu
    // vignette writes into the same pools, so the menu horde IS the game's.
    this.horde = new HordeArt(this.scene, ZMAX);
    this._zdummy = new THREE.Object3D();
    this._zcolor = new THREE.Color();
  }

  _updateZombieMeshes(t, dt = 0) {
    const g = this.game;
    const n = Math.min(g.zombies.length, ZMAX);
    const c = this._zcolor;
    this.horde.begin();
    for (let i = 0; i < n; i++) {
      const zb = g.zombies[i];
      const bob = this.map.groundY(zb.x, zb.z) + Math.sin(t * 7 + zb.phase) * 0.05;
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
      // Tint over the baked palette: white at rest, flushed in the lunge,
      // washed on the hit, doused blue under a hero's aura.
      if (lunge > 0.01) c.setRGB(1.7, 0.65, 0.55);
      else if (zb.hitFlash > 0) c.setRGB(1.6, 1.2, 1.2);
      else if (zb.auraSources && zb.auraSources.length) c.setHex(0x9fd6ff);
      else if (zb.boss) c.setHex(zb.def.color).multiplyScalar(1.5); // champion wears its own color
      else c.setRGB(1, 1, 1);
      // Eyes: hunting dead burn red, idle wanderers smoulder amber.
      const eyeHex = zb.auraSources && zb.auraSources.length ? 0x7fd6ff : zb.state === 2 ? 0xff4636 : 0xd8973a;
      this.horde.write(
        zb.boss ? 'brute' : zb.type, // bosses ride the hulk silhouette
        zb.x + (ax / ad) * lunge, bob, zb.z + (az / ad) * lunge,
        (zb.state === 2 ? 0.22 : 0.05) + lunge * 0.8, yaw, Math.sin(t * 5 + zb.phase) * 0.06,
        s * (pulse + lunge * 0.25), s * (2 - pulse - lunge * 0.2), s * (pulse + lunge * 0.25),
        t, zb.phase, lunge, c, eyeHex,
      );
    }
    this.horde.commit();
  }

  // ---------------- coins ----------------

  _setupCoins() {
    const MAXC = 400;
    const geo = new THREE.CylinderGeometry(0.22, 0.22, 0.07, 12);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0xf5c542, emissive: 0xc79a1e, emissiveIntensity: 0.55 });
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
      d.position.set(cn.x, this.map.groundY(cn.x, cn.z) + 0.32 + bounce + Math.sin(t * 2.5 + cn.id) * 0.07, cn.z);
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
    // A real felled body (limbs splayed, baked gore) instead of a tumbling
    // crate — instance color still tints it per type.
    const geo = buildCorpseGeometry();
    this.corpseMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0xffffff, vertexColors: true }), MAXC);
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
      x: e.x, y: this.map.groundY(e.x, e.z) + 0.5, z: e.z,
      gy: this.map.groundY(e.x, e.z),
      vx: (e.dx || 0) * sp + (Math.random() - 0.5), vy: 2.2 + 3.2 * f * Math.random(), vz: (e.dz || 0) * sp + (Math.random() - 0.5),
      rx: Math.random() * Math.PI * 2, ry: Math.random() * Math.PI * 2, rz: 0,
      wx: (Math.random() - 0.5) * 10 * f, wy: (Math.random() - 0.5) * 6,
      life: 6 + Math.random() * 3, scale: e.big ? 1.7 : 1,
      // Multiplies the corpse geometry's baked pale palette, so keep it bright.
      color: e.big ? 0xa886c8 : 0xa4bc72,
    });
  }

  _updateCorpses(dt) {
    const d = this._zdummy, c = this._zcolor;
    let i = 0;
    for (const p of this.corpses) {
      p.life -= dt;
      if (p.life <= 0) continue;
      const floor = (p.gy || 0) + 0.16;
      if (p.y > floor || Math.abs(p.vy) > 0.5) {
        p.vy -= 22 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rx += p.wx * dt; p.ry += p.wy * dt;
        if (p.y < floor) { p.y = floor; p.vy *= -0.35; p.vx *= 0.55; p.vz *= 0.55; p.wx *= 0.4; }
      } else {
        p.rx = Math.PI / 2; // settled flat
        if (p.life < 1.5) p.y = floor - (1.5 - p.life) * 0.2; // sink away
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

    const gy = (x, z) => this.map.groundY(x, z);
    for (const b of g.buildings) {
      if (b.hp < b.maxHp) add(b.cx, gy(b.cx, b.cz) + this._buildingHeight(b.kind) + 0.5, b.cz, b.hp / b.maxHp, Math.max(1.2, b.size * 0.8));
    }
    for (const n of g.nests) {
      if (n.alive && n.hp < n.maxHp) add(n.x, gy(n.x, n.z) + 2.6, n.z, n.hp / n.maxHp, 2.2);
    }
    for (const u of g.units) {
      if (u.hp < u.maxHp) add(u.x, gy(u.x, u.z) + 1.45, u.z, Math.max(0, u.hp / u.maxHp), 0.8);
    }
    for (const zb of g.zombies) {
      if (zb.type === 'brute' && zb.hp < zb.maxHp) { add(zb.x, gy(zb.x, zb.z) + 2.1, zb.z, zb.hp / zb.maxHp, 1.1); if (i >= MAXB) break; }
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
      new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0x565c60 }),
    );
    pylon.position.set(x, 0.28, z);
    pylon.castShadow = true;
    grp.add(pylon);
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.17, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0xffb84d, emissive: 0xffb84d, emissiveIntensity: 0.8, transparent: true, opacity: 0.9 }),
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
    // The whole plot group rides the ground once: every child (beacon, ghost,
    // rings, labels) keeps its old relative height.
    g.position.y = this.map.groundY(mx, mz);
    return g;
  }

  _syncPlots(t) {
    const g = this.game;
    const mh = this.myHero();
    const buildMode = this.controlMode !== 'fight';
    if (this._ghostMat) this._ghostMat.opacity = 0.42 + Math.sin(t * 1.8) * 0.08;
    // Pips belong to the exact plot that Build would fund. A second nearest-
    // ring search can disagree with game.buildTargetFor() and highlight one
    // building while paying another.
    let pipPlotId = -1;
    if (buildMode && g.buildTargetFor && mh && !mh.dead) {
      const target = g.buildTargetFor(mh);
      if (target) pipPlotId = target.plot.id;
    }
    for (const plot of g.plots) {
      if (!g.firstSiegePlotVisible(plot)) {
        const hidden = this.plotMeshes.get(plot.id);
        if (hidden) hidden.group.visible = false;
        continue;
      }
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
      const act = g.firstSiegePlotActionable(plot) ? g.plotAction(plot) : null;
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
    // Colony-kit construction lives in building-art.js; the renderer only
    // supplies the wall-plot occupancy the smoothed rampart polyline needs.
    if (!this._wallTiles) {
      const N = this.game.map.size;
      this._wallTiles = new Set();
      for (const p of this.game.plots) {
        if (p.kind === 'wall') for (const [x, z] of p.tiles) this._wallTiles.add(z * N + x);
      }
    }
    return buildBuildingMesh(b, { mapSize: this.game.map.size, wallTiles: this._wallTiles });
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
        this._disposeObject3D(rec.mesh);
        this.buildingMeshes.delete(b.id);
        rec = null;
      }
      if (!rec) {
        b.plotTier = plot ? plot.tier : 1;
        b.branch = plot ? plot.branch : null;
        const mesh = this._makeBuildingMesh(b);
        mesh.position.set(b.cx, this.map.groundY(b.cx, b.cz), b.cz);
        this.scene.add(mesh);
        const materials = [];
        mesh.traverse((o) => {
          if (!o.isMesh) return;
          for (const material of (Array.isArray(o.material) ? o.material : [o.material])) {
            if (!material || materials.includes(material)) continue;
            material.userData.artBaseColor = material.color?.clone() || null;
            material.userData.artBaseEmissive = material.emissive?.clone() || null;
            material.userData.artBaseEmissiveIntensity = material.emissiveIntensity || 0;
            materials.push(material);
          }
        });
        rec = { mesh, b, tierKey, spawnT: this.clock.elapsedTime, materials };
        this.buildingMeshes.set(b.id, rec);
      }
    }
    for (const [id, rec] of this.buildingMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(rec.mesh);
        this._disposeObject3D(rec.mesh);
        this.buildingMeshes.delete(id);
      }
    }
  }

  // ---------------- units ----------------

  // scene.remove() only detaches an object from the render graph — it does
  // NOT free the GPU geometry/material/texture buffers three.js allocated
  // for it. Every despawn path that drops a dynamically-built mesh (unit,
  // loot, nest) must dispose it explicitly or those buffers leak for the
  // rest of the session.
  _disposeObject3D(obj) {
    if (!obj) return;
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const mat of mats) {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
    });
  }

  _makeUnitMesh(u) {
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    g.userData.body = body;
    const weaponParts = [];
    const trackWeapon = (mesh) => {
      mesh.userData.restPos = mesh.position.clone();
      mesh.userData.restRot = mesh.rotation.clone();
      weaponParts.push(mesh);
      return mesh;
    };

    if (u.hero) {
      const d = u.def;
      const authored = u.key === 'scott' ? assetClone('heroScott') : null;
      if (authored) {
        // Authored source uses real art-pipeline units. Normalize it to the
        // existing collision/readability scale; visual meshes never change
        // the deterministic unit radius.
        authored.scale.setScalar(0.6);
        body.add(authored);
        const weapon = assetPart(authored, 'weapon');
        if (weapon) trackWeapon(weapon);
        g.userData.limbs = {
          legL: assetPart(authored, 'leg_l'), legR: assetPart(authored, 'leg_r'),
          armL: assetPart(authored, 'arm_l'), armR: assetPart(authored, 'arm_r'),
        };
      } else {
        // Bespoke procedural rig per hero — see unit-art.js.
        const model = buildUnitModel(u);
        body.add(model.node);
        g.userData.limbs = model.limbs;
        for (const part of model.weaponParts) weaponParts.push(part);
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
      // Colony troops: one corps, three trades. The authored art-slice
      // rifleman stays on for the line trooper it was modeled as; rangers,
      // snipers and hero summons get their own procedural rigs (unit-art.js)
      // so the army reads apart at a glance.
      const d = u.def;
      const authored = u.key === 'soldier' ? assetClone('humanRifleman') : null;
      if (authored) {
        authored.scale.setScalar(0.48);
        authored.traverse((o) => {
          if (!o.isMesh) return;
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          for (const material of materials) {
            if (material?.name === 'mat_hull') material.color.setHex(d.color);
          }
        });
        body.add(authored);
        const weapon = assetPart(authored, 'weapon');
        if (weapon) trackWeapon(weapon);
        g.userData.limbs = {
          legL: assetPart(authored, 'leg_l'), legR: assetPart(authored, 'leg_r'),
          armL: assetPart(authored, 'arm_l'), armR: assetPart(authored, 'arm_r'),
        };
      } else {
        const model = buildUnitModel(u);
        body.add(model.node);
        g.userData.limbs = model.limbs;
        for (const part of model.weaponParts) weaponParts.push(part);
      }
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
        rec = { mesh, u, lastHp: u.hp };
        this.unitMeshes.set(u.id, rec);
      }
      if (u.hp < rec.lastHp && !u.dead) rec.hit = { t: 0.22, dur: 0.22 };
      rec.lastHp = u.hp;
      rec.mesh.position.set(u.x, this.map.groundY(u.x, u.z), u.z);
      rec.mesh.rotation.y = u.facing;
      // Render-only local lead makes a guest's own hero answer immediately
      // while lockstep catches up. Never apply this to the host or another
      // guest: their meshes must stay on confirmed simulation positions.
      if (u === g.heroes[this.myPlayer] && this.mpRole === 'guest' && !u.dead && this.lastDir) {
        if (this._leadX === undefined) { this._leadX = 0; this._leadZ = 0; }
        const spd = (u.def.speed || 3.5) * (u.sprintMul || 1);
        const look = 0.16;
        const targetX = (this.lastDir.x || 0) * spd * look;
        const targetZ = (this.lastDir.z || 0) * spd * look;
        const response = 1 - Math.exp(-12 * (dt || 0.016));
        this._leadX += (targetX - this._leadX) * response;
        this._leadZ += (targetZ - this._leadZ) * response;
        if (Math.abs(this._leadX) > 3 || Math.abs(this._leadZ) > 3) {
          this._leadX = 0;
          this._leadZ = 0;
        }
        rec.mesh.position.set(
          u.x + this._leadX,
          this.map.groundY(u.x + this._leadX, u.z + this._leadZ),
          u.z + this._leadZ,
        );
      }
      let attackPulse = 0;
      let attackKind = '';
      if (rec.attack) {
        rec.attack.t -= dt;
        attackKind = rec.attack.kind || '';
        const p = clamp(1 - rec.attack.t / rec.attack.dur, 0, 1);
        attackPulse = Math.sin(p * Math.PI);
        if (rec.attack.t <= 0) rec.attack = null;
      }
      for (const cue of ['hit', 'cast']) {
        if (!rec[cue]) continue;
        rec[cue].t -= dt;
        if (rec[cue].t <= 0) rec[cue] = null;
      }
      const cue = rec.hit || rec.cast || rec.attack;
      const cuePulse = cue ? Math.sin(clamp(1 - cue.t / cue.dur, 0, 1) * Math.PI) : 0;
      const artState = unitArtState(u, {
        hitT: rec.hit?.t, castT: rec.cast?.t, attackT: rec.attack?.t,
      });
      const pose = unitPose(artState, t * (artState === 'run' ? 10 : 1.8) + u.id, {
        pulse: cuePulse, melee: attackKind === 'melee',
      });
      const weaponParts = rec.mesh.userData.weaponParts || [];
      for (const part of weaponParts) {
        const rp = part.userData.restPos;
        const rr = part.userData.restRot;
        if (rp) part.position.copy(rp);
        if (rr) part.rotation.copy(rr);
      }
      // The renderer owns this pose state machine. Simulation state remains
      // untouched, so animation can never affect multiplayer determinism.
      const body = rec.mesh.userData.body;
      if (body) {
        body.position.x = 0;
        body.position.y = pose.y;
        body.position.z = pose.z;
        body.rotation.x = pose.pitch;
        body.rotation.z = pose.roll;
      }
      const limbs = rec.mesh.userData.limbs;
      if (limbs) {
        const stride = pose.stride;
        if (limbs.legL) limbs.legL.rotation.x = stride;
        if (limbs.legR) limbs.legR.rotation.x = -stride;
        if (limbs.armL) limbs.armL.rotation.x = -stride * 0.55 - attackPulse * 0.45 - (artState === 'cast' ? cuePulse * 1.05 : 0);
        if (limbs.armR) limbs.armR.rotation.x = stride * 0.55 - attackPulse * 0.65 - (artState === 'cast' ? cuePulse * 1.05 : 0);
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
      if (!seen.has(id)) {
        this.scene.remove(rec.mesh);
        this._disposeObject3D(rec.mesh);
        this.unitMeshes.delete(id);
      }
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
      gr.position.y = this.map.groundY(x, z);
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
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.4, 6), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0x39332a }));
        pole.position.set(node.x, 2.2, node.z);
        gr.add(pole);
        const flag = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.05), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0xd8c07a }));
        flag.position.set(node.x + 0.75, 3.8, node.z);
        gr.add(flag);
        const label = this._makeLabelSprite(node.def ? node.def.icon : '🚩', String(node.name || '').toUpperCase());
        label.position.set(node.x, 5.4, node.z);
        label.scale.set(4.6, 2.3, 1);
        gr.add(label);
        gr.userData = { ring, flag, label, node };
        gr.position.y = this.map.groundY(node.x, node.z);
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
      // The persistent world uses MMO grammar: C opens the selected hero's
      // character/equipment screen and returns to the world when pressed again.
      if (!this.game && actionFor(this.binds(), k, 'hub') === 'character_sheet' && this.ow) {
        e.preventDefault();
        this.ui.toggleCharacterScreen();
        return;
      }
      // Dota grammar: Tab opens the hero library from anywhere in the menu.
      if (!this.game && e.key === 'Tab') {
        e.preventDefault();
        const screen = document.querySelector('#screen-heroes');
        if (screen && !screen.classList.contains('hidden')) this.ui._showScreen('main');
        else this.ui._showScreen('heroes');
        return;
      }
      if (!this.game) {
        // The overworld owns Escape: the hub slides in as a translucent
        // overlay and slides back out — the walk never stops underneath.
        if (k === 'escape') {
          e.preventDefault();
          this.ui.toggleOverlay();
          return;
        }
        return;
      }
      // Every in-battle key goes through the binding table. Nothing here
      // knows a letter, so the scheme, the Settings screen and the help page
      // cannot drift apart.
      const binds = this.binds();
      // Scoped: the battle loop can only ever pick an action that listens in a
      // battle. Conflict detection guarantees no two of those share a key.
      const act = actionFor(binds, k, 'battle');
      switch (act) {
        case 'dodge': {
          e.preventDefault();
          // Space has one meaning. Before the city is founded there is no live
          // dodge yet, but it must not silently become the build key.
          if (this.game.phase === 'found') break;
          const dir = this.lastDir || { x: 0, z: 0 };
          this.issue({ t: 'dodge', p: this.myPlayer, x: dir.x, z: dir.z });
          break;
        }
        case 'ability1':
          if (this.controlMode === 'fight' || this.game.phase !== 'found') this.tryCast();
          break;
        case 'build_mode':
          e.preventDefault();
          this.toggleControlMode();
          break;
        case 'build':
          if (this.game.phase === 'found') this._tryFound();
          break;
        case 'stance_defend': e.preventDefault(); this.issue({ t: 'stance', s: 'defend', p: this.myPlayer }); break;
        case 'stance_follow': e.preventDefault(); this.issue({ t: 'stance', s: 'guard', p: this.myPlayer }); break;
        case 'stance_push': e.preventDefault(); this.issue({ t: 'stance', s: 'attack', p: this.myPlayer }); break;
        case 'tower_priority': this.issue({ t: 'towerpri', p: this.myPlayer }); break;
        case 'drop_item': this.issue({ t: 'drop', p: this.myPlayer, i: -1 }); break;
        case 'swap_set': this.issue({ t: 'swapset', p: this.myPlayer }); break;
        case 'character_sheet': e.preventDefault(); this.ui.showCharacterSheet('gear'); break;
        case 'lattice_panel': e.preventDefault(); this.ui.showCharacterSheet('lattice'); break;
        case 'mute': this.audio.setMuted(!this.audio.muted); this.ui.setMuteUI(this.audio.muted); break;
        case 'pause': this.setSpeed(0); break;
        case 'menu': this.togglePauseMenu(); break;
        default:
          if (k === 'h') this.togglePauseMenu(true);
          break;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = clamp(this.camDist * (1 + Math.sign(e.deltaY) * 0.12), 14, 60);
    }, { passive: false });

    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      this.audio.init();
      // Overworld click-to-move: a course set on the ground itself.
      if (!this.game && this.ow && e.button === 0 && this.ui.overlayHidden()) {
        this._owMouse = this._owMouse || new THREE.Vector2();
        this._owRay = this._owRay || new THREE.Raycaster();
        this._owPlane = this._owPlane || new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this._owHit = this._owHit || new THREE.Vector3();
        this._owMouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
        this._owRay.setFromCamera(this._owMouse, this.camera);
        if (this._owRay.ray.intersectPlane(this._owPlane, this._owHit)) {
          this._owHit.x = clamp(this._owHit.x, 1, this.owMap.size - 1);
          this._owHit.z = clamp(this._owHit.z, 1, this.owMap.size - 1);
          this.ow.setTarget(this._owHit.x, this._owHit.z);
        }
      }
    });
  }

  // The current scheme. Cached because the movement path asks every frame.
  binds() {
    if (!this._binds) this._binds = loadBinds();
    return this._binds;
  }

  setBinds(next) {
    this._binds = saveBinds(next);
    this.ui.setKeybinds(this._binds);
    return this._binds;
  }

  resetKeybinds() {
    this._binds = resetBinds();
    this.ui.setKeybinds(this._binds);
    return this._binds;
  }

  // WASD → hero direction, sent through the lockstep pipe only on change.
  // Zillions uses a fixed Thronefall-style orientation during gameplay:
  // WASD maps to the minimap cardinal directions. This keeps keyboard
  // movement, player view movement, and minimap movement aligned.
  _updateHeroInput() {
    if (!this.game || this.game.over || this.mpRole === 'spectator') return;
    let dx = 0, dz = 0;
    const binds = this.binds();
    if (isHeld(binds, this.keys, 'move_up')) dz -= 1;
    if (isHeld(binds, this.keys, 'move_down')) dz += 1;
    if (isHeld(binds, this.keys, 'move_left')) dx -= 1;
    if (isHeld(binds, this.keys, 'move_right')) dx += 1;
    const s = isHeld(binds, this.keys, 'sprint');
    const last = this.lastDir;
    if (Math.abs(dx - last.x) > 0.001 || Math.abs(dz - last.z) > 0.001 || s !== last.s) {
      this.lastDir = { x: dx, z: dz, s };
      this.issue({ t: 'hdir', p: this.myPlayer, x: dx, z: dz, s });
    }
    // Hold-to-build has one keyboard owner: the configured build action. The
    // on-screen construction button may also hold payment, but dodge never can.
    const h = this.myHero();
    const canPay = this.game && this.game.phase === 'live' && h && !h.dead && !!this.game.buildTargetFor(h);
    const bindsNow = this.binds();
    const buttonPays = canPay && this.buttonPay;
    const pay = isHeld(bindsNow, this.keys, 'build') || buttonPays;
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
    if (this.lastPay && !isHeld(this.binds(), this.keys, 'build')) {
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
    this.ui.setMatchExit(this.netMode ? this.mpRole : null);
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

  // Settings: apply immediately and persist to localStorage. Volume and mute
  // compose inside AudioSys (gain = base * volume, or 0 when muted); quality
  // routes through TacticalVisuals so lockstep sim state stays untouched.
  applySettings(s = {}) {
    try {
      const cur = JSON.parse(localStorage.getItem('zillions_settings') || '{}');
      localStorage.setItem('zillions_settings', JSON.stringify({ ...cur, ...s }));
    } catch { /* storage can be blocked */ }
    if (s.volume !== undefined) this.audio.setVolume(s.volume);
    if (s.music !== undefined) this.audio.setMusicVolume(s.music);
    if (s.sfx !== undefined) this.audio.setMuted(!s.sfx);
    if (s.quality !== undefined) this.tacticalVisuals.applyQuality(s.quality);
  }

  _restoreSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('zillions_settings') || '{}'); } catch { /* ignore */ }
    if (s.volume !== undefined) this.audio.setVolume(s.volume);
    if (s.music !== undefined) this.audio.setMusicVolume(s.music);
    if (s.sfx === false) this.audio.setMuted(true);
    return s;
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
    if (!this.game && this.ow) {
      // Overworld: the game camera glued to the walking hero — same iso
      // angle, same soft lag, so the menu feels like the game's first step.
      const h = this.ow.hero;
      const k = 1 - Math.exp(-6 * dt);
      this.focus.x += (h.x - this.focus.x) * k;
      this.focus.z += (h.z - this.focus.z) * k;
      this.focus.x = clamp(this.focus.x, 2, this.owMap.size - 2);
      this.focus.z = clamp(this.focus.z, 2, this.owMap.size - 2);
      this.focus.y += (Math.max(0, this.owMap.groundY(this.focus.x, this.focus.z)) - this.focus.y) * (1 - Math.exp(-4 * dt));
      const dist = 30;
      const elev = 0.78;
      this.camera.position.set(
        this.focus.x + Math.sin(this.camYaw) * Math.cos(elev) * dist,
        this.focus.y + Math.sin(elev) * dist,
        this.focus.z + Math.cos(this.camYaw) * Math.cos(elev) * dist,
      );
      this.camera.lookAt(this.focus);
      this.sun.position.set(this.focus.x + 45, 80, this.focus.z + 25);
      this.sun.target.position.set(this.focus.x, 0, this.focus.z);
      return;
    }
    if (!this.game) {
      // Starship director: orbit until a distress light is acquired, dive to
      // the active stand, then pull back when the signal dies.
      this.menuYaw += dt * 0.018;
      const shot = this.menuShow?.cameraState();
      const dive = shot?.phase === 'run' ? shot.progress : 0;
      const surfaceVisible = dive > 0.18;
      if (this.menuTerrain) this.menuTerrain.visible = surfaceVisible;
      this.menuShow?.setSurfaceVisible(surfaceVisible);
      const tx = shot?.x ?? MAP_SIZE / 2;
      const tz = shot?.z ?? MAP_SIZE / 2;
      const k = 1 - Math.exp(-1.35 * dt);
      this.focus.x += (lerp(MAP_SIZE / 2, tx, dive) - this.focus.x) * k;
      this.focus.z += (lerp(MAP_SIZE / 2 - 8, tz, dive) - this.focus.z) * k;
      this.focus.y += (lerp(2.5, this.menuMap?.groundY(tx, tz) || 0, dive) - this.focus.y) * k;
      const dist = lerp(105, 28, dive);
      const elev = lerp(0.58, 0.72, dive);
      this.camera.position.set(
        this.focus.x + Math.sin(this.menuYaw) * Math.cos(elev) * dist,
        Math.sin(elev) * dist,
        this.focus.z + Math.cos(this.menuYaw) * Math.cos(elev) * dist,
      );
      this.camera.lookAt(this.focus);
      const title = document.querySelector('.title-screen');
      if (title && shot) {
        const ndc = this._menuProjV.set(tx, this.menuMap?.groundY(tx, tz) || 0, tz).project(this.camera);
        title.style.setProperty('--signal-x', `${clamp((ndc.x * .5 + .5) * 100, 8, 72)}%`);
        title.style.setProperty('--signal-y', `${clamp((-ndc.y * .5 + .5) * 100, 12, 88)}%`);
        title.style.setProperty('--fog-alpha', surfaceVisible ? '.88' : '0');
      }
      const telemetry = document.querySelector('#title-telemetry');
      if (telemetry && shot) telemetry.innerHTML = `<b>${shot.scenario}</b><span>SIGNAL ${String(shot.observed).padStart(4, '0')} · ${shot.phase === 'run' ? `${shot.survivors} SURVIVORS` : 'SEARCHING'}</span>`;
      if (shot?.observed) localStorage.setItem('zillions-title-stands', String(shot.observed));
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
    // Ride the relief: the focus point tracks the ground under it (softly, so
    // cresting a hill tilts the view instead of jolting it).
    if (this.map) {
      const gy = Math.max(0, this.map.groundY(this.focus.x, this.focus.z));
      this.focus.y += (gy - this.focus.y) * (1 - Math.exp(-4 * dt));
    }

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
      this.focus.y + hy,
      this.focus.z + Math.cos(this.camYaw) * hx + sz,
    );
    this.camera.lookAt(this.focus.x + sx, this.focus.y, this.focus.z + sz);

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

    this.sun.intensity = lerp(0.85, 2.75, b);
    // Warm gold by day, ember at dusk, cool moon-blue at night.
    this.sun.color.copy(new THREE.Color(0x9db8f0).lerp(new THREE.Color(0xffeabf), b));
    this.hemi.intensity = lerp(0.35, 0.8, b);
    this.hemi.color.copy(new THREE.Color(0x5a6aa8).lerp(new THREE.Color(0xdfe8dd), b));
    this.hemi.groundColor.copy(new THREE.Color(0x2c3550).lerp(new THREE.Color(0x9a7a58), b));
    this.amb.intensity = lerp(0.85, 0.45, b);
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

  _setupFogOfWar() {
    if (this.fogOfWar) {
      this.scene.remove(this.fogOfWar.mesh);
      this.fogOfWar.mesh.geometry.dispose();
      this.fogOfWar.material.dispose();
      this.fogOfWar = null;
    }
    if (!this.game || !this.map) return;
    const points = Array.from({ length: MAX_VISION_SOURCES }, () => new THREE.Vector3(-9999, -9999, 0));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uVisionCount: { value: 0 },
        uVision: { value: points },
        uDarkness: { value: FOG_DARKNESS },
        uInnerVeil: { value: FOG_INNER_VEIL },
        uSoftness: { value: FOG_EDGE_SOFTNESS },
      },
      vertexShader: `
        varying vec2 vWorldXZ;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldXZ = world.xz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        #define MAX_VISION ${MAX_VISION_SOURCES}
        uniform int uVisionCount;
        uniform vec3 uVision[MAX_VISION];
        uniform float uDarkness;
        uniform float uInnerVeil;
        uniform float uSoftness;
        varying vec2 vWorldXZ;
        void main() {
          float visible = 0.0;
          for (int i = 0; i < MAX_VISION; i++) {
            if (i >= uVisionCount) break;
            float distanceToScout = distance(vWorldXZ, uVision[i].xy);
            float sourceVisibility = 1.0 - smoothstep(
              uVision[i].z - uSoftness,
              uVision[i].z + uSoftness,
              distanceToScout
            );
            visible = max(visible, sourceVisibility);
          }
          float alpha = mix(uDarkness, uInnerVeil, visible);
          gl_FragColor = vec4(0.006, 0.009, 0.018, alpha);
        }
      `,
    });
    const size = this.map.size || MAP_SIZE;
    const geometry = new THREE.PlaneGeometry(size, size);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(size / 2, 0.04, size / 2);
    mesh.renderOrder = 10000;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.fogOfWar = { mesh, material, points };
    this._updateFogOfWar();
  }

  _updateFogOfWar() {
    if (!this.fogOfWar) return;
    const sources = fogVisionSources(this.game);
    for (let i = 0; i < this.fogOfWar.points.length; i++) {
      const source = sources[i];
      this.fogOfWar.points[i].set(
        source ? source.x : -9999,
        source ? source.z : -9999,
        source ? source.radius : 0,
      );
    }
    this.fogOfWar.material.uniforms.uVisionCount.value = sources.length;
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
          this._buildingHitCue(e.x, e.z);
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
          const caster = this.unitMeshes.get(e.heroId);
          if (caster) caster.cast = { t: 0.52, dur: 0.52, kind: e.key };
          this.audio.cast({ weave: 'smoke', grenade: 'shrapnel', hammer: 'sunstrike', fortify: 'shieldup', brew: 'splash', clone: 'shimmer', summon: 'shimmer' }[e.key] || e.key);
          const CAST_COLORS = { hammer: 0x7a9cf0, grenade: 0xd8b45e, weave: 0x7fd85e, fortify: 0x8fd0ff, brew: 0xffb347, clone: 0xffa64d, summon: 0x8fd6ff };
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
          } else if (e.key === 'fortify') {
            this._spawnAbilityRing(e.x, e.z, { color: 0x8fd0ff, radius: 0.4, to: R, life: 0.4, opacity: 0.9, width: 0.24 });
          } else if (e.key === 'brew') {
            this._spawnAbilityRing(e.x, e.z, { color: 0xffb347, radius: 0.4, to: R, life: 0.5, opacity: 0.6, width: 0.3 });
          }
          this.shake = Math.max(this.shake, e.key === 'hammer' ? 0.5 : e.key === 'fortify' ? 0.35 : 0.18);
          break;
        }
        case 'evade':
          this.burst(e.x, 1.0, e.z, { count: 6, color: 0xdfe8ff, speed: 1.0, life: 0.3, size: 0.34, up: 1.4 });
          break;
        case 'expire':
          this.burst(e.x, 0.5, e.z, { count: 10, color: 0xc9d8ff, speed: 1.1, life: 0.5, size: 0.5, up: 1.4 });
          break;
        case 'fortify':
          this.audio.click();
          this._impactRing(e.x, e.z, { color: 0x8fd0ff, count: 24, radius: e.r || 7, life: 0.5, size: 0.5 });
          break;
        case 'clone':
          this.burst(e.x, 0.5, e.z, { count: 18, color: 0xffa64d, speed: 1.8, life: 0.5, size: 0.5, up: 1.6 });
          break;
        case 'summon':
          this.burst(e.x, 0.6, e.z, { count: 20, color: 0x8fd6ff, speed: 1.6, life: 0.6, size: 0.5, up: 1.8 });
          break;
        case 'shieldproc':
          this.burst(e.x, 1.0, e.z, { count: 10, color: 0x9fd6ff, speed: 1.0, life: 0.4, size: 0.42, up: 1.4 });
          break;
        case 'brewzone':
          this.burst(e.x, 0.2, e.z, { count: 6, color: 0xffb347, speed: 0.4, life: 0.5, size: 0.6, spread: 1.6, up: 0.4 });
          break;
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

  _buildingHitCue(x, z) {
    let best = null;
    let bestD = 4;
    for (const rec of this.buildingMeshes.values()) {
      const d = (rec.b.cx - x) ** 2 + (rec.b.cz - z) ** 2;
      if (d < bestD) { best = rec; bestD = d; }
    }
    if (best) best.impact = { t: 0.2, dur: 0.2 };
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
    // Watch the game while it runs, and the menu while the attract show does —
    // the vignettes put real load on the backdrop, so the menu gets the same
    // safety net a live siege has.
    const active = this.game ? !this.paused : !!this.ow;
    if (!active || this.tacticalVisuals.quality !== 'high') {
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
    this._frameMs = this._frameMs * 0.88 + dt * 1000 * 0.12;
    const t = this.clock.elapsedTime;
    this._autoTuneQuality(dt);
    this._refreshDiagnosticsUI(false);
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
      this.map.syncLabyrinthDoors?.(this.game);
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
      this._updateFogOfWar();
      this._updateTutorial(dt);

      // Authored building state is presentation-only: construction reveal,
      // impact response, and readable damaged/critical material treatment.
      for (const rec of this.buildingMeshes.values()) {
        const age = t - (rec.spawnT || 0);
        const art = buildingArtState(rec.b, age);
        if (art.phase === 'constructing') {
          const k = clamp(age / 0.7, 0, 1);
          const eased = 1 - (1 - k) ** 3;
          rec.mesh.scale.set(0.86 + eased * 0.14, 0.08 + eased * 0.92, 0.86 + eased * 0.14);
        } else rec.mesh.scale.setScalar(1);
        if (rec.impact) {
          rec.impact.t -= dt;
          const p = Math.sin(clamp(1 - rec.impact.t / rec.impact.dur, 0, 1) * Math.PI);
          rec.mesh.rotation.z = p * 0.045;
          rec.mesh.scale.x *= 1 + p * 0.04;
          rec.mesh.scale.y *= 1 - p * 0.06;
          if (rec.impact.t <= 0) rec.impact = null;
        } else rec.mesh.rotation.z = 0;
        for (const material of rec.materials || []) {
          const base = material.userData.artBaseColor;
          if (base && material.color) {
            const soot = art.damage * (art.phase === 'critical' ? 0.58 : 0.38);
            material.color.setRGB(
              base.r * (1 - soot) + 0.18 * soot,
              base.g * (1 - soot) + 0.07 * soot,
              base.b * (1 - soot) + 0.035 * soot,
            );
          }
          const baseEmissive = material.userData.artBaseEmissive;
          if (baseEmissive && material.emissive) material.emissive.copy(baseEmissive);
          const baseIntensity = material.userData.artBaseEmissiveIntensity || 0;
          const flicker = art.phase === 'critical' ? (0.28 + Math.max(0, Math.sin(t * 17 + rec.b.id)) * 0.72) : 1;
          if (art.phase === 'critical' && material.emissive) material.emissive.lerp(new THREE.Color(0xff321f), 0.72);
          material.emissiveIntensity = art.phase === 'critical' ? Math.max(0.5, baseIntensity) * flicker : baseIntensity;
          material.transparent = art.phase === 'constructing';
          material.opacity = art.phase === 'constructing' ? 0.48 + clamp(age / 0.7, 0, 1) * 0.52 : 1;
        }
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
      const firstSiege = this.game.firstSiegeStatus?.();
      const markerNest = firstSiege?.nest;
      const markerKey = markerNest ? `${markerNest.id}:${this.game.firstSiege.stage}` : '';
      if (markerKey !== this._firstSiegeMarkerKey) {
        this._firstSiegeMarkerKey = markerKey;
        this._setWaveMarkers(markerNest ? [[markerNest.x, markerNest.z]] : []);
      }
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
            const buildKey = keyLabel(this.binds().build);
            const overlayKey = keyLabel(this.binds().build_mode);
            hint = mh.payHold
              ? (this.game.gold < 1 ? '🪙 Purse empty — kill something, or take a node!' : `🪙 ${cost} to go…`)
              : `<div>Hold <kbd>${buildKey}</kbd> — ${verb} <b>${name}</b> (${cost}🪙)</div><div class="buildrole">${role} · ${overlayKey} ${buildMode ? 'hides' : 'shows'} construction markers.</div>`;
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

    if (!this.game && this.ow) this._updateOverworld(dt, t);
    if (!this.game && !this.ow) {
      this.menuShow?.update(dt, t);
      this._updateTitleSpace(t);
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
