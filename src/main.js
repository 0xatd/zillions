// Rendering, input and orchestration.
import * as THREE from 'three';
import { BUILDINGS, UNITS, SIM_DT, MAP_SIZE, FINAL_DAY, LEVELS } from './config.js';
import { GameMap } from './map.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { AudioSys } from './audio.js';
import { loadAssets, assetClone, hasAsset } from './assets.js';
import { NetSession } from './net.js';
import { deleteState, getRemoteState, getLobby, heartbeatLobby, joinLobby, leaveLobby, putState, sendLobbyChat } from './backend.js';
import { PLOT_PAY_RADIUS, plotCostText, plotInfo, plotPaidTotal } from './plots.js';
import { clamp, lerp } from './utils.js';

const ZMAX = 1700;
const EDGE_PAN_MARGIN = 42;

class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 600);
    this.focus = new THREE.Vector3(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    this.camDist = 34;
    this.camYaw = 0;
    this.shake = 0;

    this.buildMode = null;
    this.orderMode = null;
    this.selection = [];       // units
    this.selectedBuilding = null;
    this.speed = 1;
    this.paused = true;        // starts paused behind the menu
    this.acc = 0;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, gx: 0, gz: 0, down: false, rdown: false, cx: undefined, cy: undefined };
    this.dragStart = null;
    this.wallDrag = false;
    this.lastWallTile = null;

    this.audio = new AudioSys();
    this.profile = this._loadProfile();
    this.settings = this._loadSettings();
    this.lobbyMode = 'survival';
    this.selectedRules = 'survival-plots';
    this.lobbyJoined = false;
    this.lobbyTimer = null;
    this.ui = new UI(document.getElementById('ui'), {
      onBuild: (k) => this.setBuildMode(k),
      onTrain: (k) => { this.audio.init(); this.issue({ t: 'train', k }); },
      onSpeed: (s) => this.setSpeed(s),
      onMute: () => {
        this.audio.setMuted(!this.audio.muted);
        this.ui.setMuteUI(this.audio.muted);
        this.settings.muted = this.audio.muted;
        this._saveSettings();
      },
      onStart: (d, hero, rules = this.selectedRules || 'survival-plots') => {
        this.selectedRules = 'survival-plots';
        this.settings.rules = 'survival-plots';
        this._saveSettings();
        if (this.mpRole === 'guest') return; // host launches the match
        if (this.mpRole === 'host' && this.peers.length) {
          const level = this.ui.selectedLevel || 1;
          const heroes = [hero, ...this.peers.map((_, i) => this.guestHeroes[i] || 'scott')];
          this.peers.forEach((p, i) => p.send({ t: 'start', d, heroes, you: i + 1, level, mode: 'survival-plots' }));
          this.startGame(d, null, { heroes, myPlayer: 0, role: 'host', level, mode: 'survival-plots' });
        } else {
          this.startGame(d, hero, null, null, 'survival-plots');
        }
      },
      onCast: (i) => this.tryCast(i),
      onLearn: (i) => this.issue({ t: 'learn', i, p: this.myPlayer }),
      onAuto: () => {
        if (!this.game) return;
        this.game.msg('Build by riding onto glowing foundations. The city plan is the mode now.', 'info');
      },
      onHost: () => this.hostGame(),
      onJoin: (code) => this.joinGame(code),
      onHostAccept: (code) => this.pendingPeer && this.pendingPeer.acceptReply(code).catch(() => this.ui.mpStatus('❌ Bad reply code.')),
      onAddPeer: () => this._newInvite(),
      onHeroPick: (k) => {
        this.audio.init(this.game ? 'game' : 'menu', this.game?.levelId || this.ui.selectedLevel || 1);
        if (!this.game) this.audio.voiceSample(k);
        if (this.mpRole === 'guest' && this.net && this.net.open) this.net.send({ t: 'hero', k });
        this._heartbeatLobby();
      },
      onModePick: () => { this.lobbyMode = 'survival'; this.refreshPublicLobby(); },
      onRulesPick: (rules) => {
        this.selectedRules = 'survival-plots';
        this.settings.rules = this.selectedRules;
        this._saveSettings();
        this._heartbeatLobby();
      },
      onLobbyStart: (rules, hero) => {
        this.startGame('normal', hero || this.ui.selectedHero || 'alexander', null, null, 'survival-plots');
      },
      onLobbyHost: () => this.hostGame(),
      onLobbyJoin: () => this.joinPublicLobby(),
      onLobbyRefresh: () => this.refreshPublicLobby(),
      onLobbyChat: (text) => this.sendPublicLobbyChat(text),
      onRestart: () => location.reload(),
      onMinimap: (u, v) => {
        const x = u * MAP_SIZE, z = v * MAP_SIZE;
        if (this.game?.plotMode) {
          this._moveHeroToPoint(x, z);
          return;
        }
        this.focus.x = x; this.focus.z = z;
      },
      onPlotFocus: (id) => {
        const plot = this.game?.plots?.find((p) => p.id === id);
        if (plot) this._moveHeroToPlot(plot);
      },
      onDemolish: (b) => { this.issue({ t: 'demolish', id: b.id }); this.selectedBuilding = null; this.ui.showSelection(null); },
      onSelectionCommand: (cmd) => this._selectionCommand(cmd),
      onSelectUnit: (id) => this._selectUnitById(id, true),
      onToggleUnit: (id) => this._toggleUnitById(id),
      onSelectUnitType: (key) => this._selectUnitsByKey(key),
      onHelp: () => { this.pause(); this.ui.showHelp(); },
      onContinue: () => this.continueGame(),
      onName: (name) => { this.profile.name = name.slice(0, 24); this._saveProfile(); this._heartbeatLobby(); },
    });
    this.ui.preselectRules(this.selectedRules);
    this.audio.setScene('menu', this.ui.selectedLevel || 1);
    this._setupAudioUnlock();

    this._setupLights();
    this._setupPicking();
    this._setupParticles();
    this._setupZombieMeshes();
    this._setupBars();
    this._setupInput();

    this.buildingMeshes = new Map();
    this.plotMeshes = new Map();
    this.unitMeshes = new Map();
    this.ghost = null;
    this.rangeRing = this._makeRangeRing();
    this.scene.add(this.rangeRing);

    // Co-op lockstep state (up to 3 players, host-sequenced star topology).
    this.myPlayer = 0;
    this.mpRole = null;          // null | 'host' | 'guest'
    this.net = null;             // guest's connection to the host
    this.peers = [];             // host's connections to guests
    this.pendingPeer = null;     // host: invite awaiting a reply
    this.guestHeroes = [];       // host: hero picks per guest
    this.guestCmdQueues = [];    // host: commands received per guest
    this.netMode = false;
    this.outbox = [];
    this.simFrame = 0;
    this.inbox = new Map();
    this.hashes = { local: new Map() };
    this.desynced = false;

    // Profiles & saves: localStorage first, mirrored to Vercel Blob when deployed.
    if (this.settings.muted) {
      this.audio.setMuted(true);
      this.ui.setMuteUI(true);
    }
    this.remoteSaveAt = 0;
    this.autosaveT = 20;
    window.addEventListener('beforeunload', () => {
      this._leaveLobby(false);
      this._autosave(true);
    });

    this._setupCorpses();
    this.groanAcc = 0;
    this.deathSfxT = 0;
    this.bhitSfxT = 0;
    this.smokeT = 0;
    this.minimapT = 0;

    // Surface profile + resumable save on the menu.
    this.ui.setProfile(this.profile);
    this.ui.setCampaign(this.profile.campaign || 0);
    if (this.profile.lastHero) this.ui.preselectHero(this.profile.lastHero);
    const save = this._loadSave();
    if (save) this.ui.setContinue(save.snap);
    this._hydrateRemoteState();
    this.refreshPublicLobby();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------- setup ----------------

  _setupAudioUnlock() {
    const unlock = () => {
      this.audio.init(this.game ? 'game' : 'menu', this.game?.levelId || this.ui.selectedLevel || 1);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  async startGame(difficulty, heroKey, mp = null, snap = null, modeOverride = null) {
    const levelId = snap ? snap.level || 1 : mp ? mp.level || 1 : this.ui.selectedLevel || 1;
    const level = LEVELS[levelId - 1] || LEVELS[0];
    const mode = 'survival-plots';
    this.audio.init('game', levelId);
    this.audio.setScene('game', levelId);
    this._leaveLobby(false);
    if (!this.assetsLoaded) {
      this.ui.showBanner('Loading…', '', 1500);
      await loadAssets();
      this.assetsLoaded = true;
    }
    const seed = snap ? snap.seed : level.seed;
    this.map = new GameMap(seed, level.theme);
    const heroKeys = snap ? snap.heroKeys : mp ? mp.heroes : heroKey;
    this.game = new Game(this.map, difficulty, heroKeys, snap, levelId, mode);
    this.buildHoldOn = false;
    this.lastHeroDir = { x: 0, z: 0, s: false };
    if (!snap && heroKey) { this.profile.lastHero = heroKey; this._saveProfile(); }
    this.myPlayer = mp ? mp.myPlayer : 0;
    this.ui.setLocalPlayer(this.myPlayer);
    this.netMode = !!mp;
    if (this.netMode) {
      this.mpRole = mp.role;
      this.simFrame = 0;
      this.outbox = [];
      this.inbox = new Map();
      this.hashes = { local: new Map() };
      this.speed = 1;
    }
    this.terrain = this.map.buildTerrain();
    this.scene.add(this.terrain);
    this.map.drawMinimap(document.getElementById('minimap-base'));
    this.ui.hideStart();
    this.ui.setPlotMode(this.game.plotMode);
    this.ui.initHeroPanel(this.game.heroes[this.myPlayer]);
    this.setSpeed(1);
    this.ui.showPlotCommandBar(this.game, null);
    this.ui.showBanner(`Survival: ${level.name} — ${level.boss.icon} ${level.boss.name} awaits on day ${FINAL_DAY}`, '', 4000);
    this.focus.set(MAP_SIZE / 2, 0, MAP_SIZE / 2);
  }

  // ---------------- co-op networking ----------------

  issue(cmd) {
    if (!this.game) return;
    if (this.netMode) this.outbox.push(cmd);
    else this.game.exec(cmd);
  }

  // ----- profiles & saves -----

  _loadProfile() {
    try {
      return { name: '', games: 0, wins: 0, kills: 0, bestDay: 0, lastHero: null, ...JSON.parse(localStorage.getItem('zillions_profile') || '{}') };
    } catch { return { name: '', games: 0, wins: 0, kills: 0, bestDay: 0, lastHero: null }; }
  }

  _saveProfile() {
    this.profile.updatedAt = Date.now();
    try { localStorage.setItem('zillions_profile', JSON.stringify(this.profile)); } catch { /* full/blocked */ }
    this._mirrorState('profile', 'current', this.profile);
  }

  _loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('zillions_settings') || '{}');
      return { muted: false, ...saved, rules: 'survival-plots' };
    } catch { return { muted: false, rules: 'survival-plots' }; }
  }

  _saveSettings() {
    this.settings.updatedAt = Date.now();
    try { localStorage.setItem('zillions_settings', JSON.stringify(this.settings)); } catch { /* full/blocked */ }
    this._mirrorState('settings', 'current', this.settings);
  }

  _loadSave() {
    try { return JSON.parse(localStorage.getItem('zillions_save') || 'null'); } catch { return null; }
  }

  // Guests never autosave — the host owns the co-op save.
  _autosave(force = false) {
    if (!this.game || this.game.over || this.mpRole === 'guest') return;
    if (!force && this.paused) return;
    const save = { when: Date.now(), snap: this.game.snapshot() };
    try {
      localStorage.setItem('zillions_save', JSON.stringify(save));
    } catch { /* storage full */ }
    if (force || save.when - this.remoteSaveAt > 55000) {
      this.remoteSaveAt = save.when;
      this._mirrorState('save', 'latest', save);
    }
  }

  _recordGameEnd(won) {
    const p = this.profile;
    p.games++;
    if (won) {
      p.wins++;
      p.campaign = Math.max(p.campaign || 0, this.game.levelId);
    }
    p.kills += this.game.stats.kills;
    p.bestDay = Math.max(p.bestDay, Math.min(this.game.day, FINAL_DAY));
    p.lastHero = this.ui.selectedHero;
    this._saveProfile();
    this._mirrorState('game', `${Date.now()}`, {
      endedAt: Date.now(),
      won,
      mode: this.game.mode,
      difficulty: this.game.diffKey,
      level: this.game.levelId,
      heroKeys: this.game.heroKeys,
      day: Math.min(this.game.day, FINAL_DAY),
      kills: this.game.stats.kills,
      built: this.game.stats.built,
      lost: this.game.stats.lost,
      plots: this.game.stats.plots || 0,
      players: this.game.heroKeys.length,
    });
    deleteState('save', 'latest').catch(() => {});
    try { localStorage.removeItem('zillions_save'); } catch { /* ignore */ }
  }

  _mirrorState(kind, id, data) {
    putState(kind, id, data).catch(() => {});
  }

  _lobbyProfile(status = 'in-lobby') {
    const rules = 'Survival';
    const stats = this.profile.games
      ? `${this.profile.wins}W/${this.profile.games - this.profile.wins}L · best day ${this.profile.bestDay}`
      : 'first deployment';
    return {
      mode: this.lobbyMode || 'survival',
      name: this.profile.name || 'Commander',
      hero: this.ui.selectedHero || 'alexander',
      rules: 'survival-plots',
      status: status === 'in-lobby' ? `${rules} · ${stats}` : status,
    };
  }

  async refreshPublicLobby() {
    try {
      const result = await getLobby(this.lobbyMode || 'survival');
      if (!result?.ok || !result.lobby) {
        this.ui.setLobby(null, false);
        return;
      }
      this.ui.setLobby(result.lobby, this.lobbyJoined);
    } catch {
      this.ui.setLobbyStatus('Lobby is unavailable right now.', false);
    }
  }

  async joinPublicLobby() {
    try {
      const result = await joinLobby(this._lobbyProfile());
      if (!result?.ok || !result.lobby) {
        this.ui.setLobby(null, false);
        return;
      }
      this.lobbyJoined = true;
      this.ui.setLobby(result.lobby, true);
      this._startLobbyTimer();
    } catch {
      this.ui.setLobbyStatus('Could not join the lobby.', false);
    }
  }

  _startLobbyTimer() {
    clearInterval(this.lobbyTimer);
    this.lobbyTimer = setInterval(() => this._heartbeatLobby(), 15_000);
  }

  async _heartbeatLobby() {
    if (!this.lobbyJoined) return;
    try {
      const result = await heartbeatLobby(this._lobbyProfile());
      if (result?.ok && result.lobby) this.ui.setLobby(result.lobby, true);
    } catch {
      this.ui.setLobbyStatus('Lobby heartbeat failed. Refresh to rejoin.', false);
    }
  }

  async sendPublicLobbyChat(text) {
    if (!text.trim()) return;
    if (!this.lobbyJoined) await this.joinPublicLobby();
    if (!this.lobbyJoined) return;
    try {
      const result = await sendLobbyChat(text, this._lobbyProfile());
      if (result?.ok && result.lobby) this.ui.setLobby(result.lobby, true);
      else this.ui.setLobbyStatus('Could not send lobby chat.', false);
    } catch {
      this.ui.setLobbyStatus('Could not send lobby chat.', false);
    }
  }

  _leaveLobby(updateUi = true) {
    if (!this.lobbyJoined) return;
    this.lobbyJoined = false;
    clearInterval(this.lobbyTimer);
    this.lobbyTimer = null;
    leaveLobby(this.lobbyMode || 'survival')
      .then((result) => {
        if (updateUi && result?.ok && result.lobby) this.ui.setLobby(result.lobby, false);
      })
      .catch(() => {});
  }

  async _hydrateRemoteState() {
    try {
      const remote = await getRemoteState();
      if (!remote?.ok || !remote.state) return;
      const { profile, settings, save } = remote.state;
      if (profile && (!this.profile.updatedAt || profile.updatedAt > this.profile.updatedAt)) {
        this.profile = { ...this.profile, ...profile };
        localStorage.setItem('zillions_profile', JSON.stringify(this.profile));
        this.ui.setProfile(this.profile);
        this.ui.setCampaign(this.profile.campaign || 0);
        if (this.profile.lastHero) this.ui.preselectHero(this.profile.lastHero);
      }
      if (settings && (!this.settings.updatedAt || settings.updatedAt > this.settings.updatedAt)) {
        this.settings = { ...this.settings, ...settings };
        localStorage.setItem('zillions_settings', JSON.stringify(this.settings));
        this.audio.setMuted(!!this.settings.muted);
        this.ui.setMuteUI(this.audio.muted);
        this.selectedRules = 'survival-plots';
        this.ui.preselectRules(this.selectedRules);
      }
      const localSave = this._loadSave();
      if (save?.snap && (!localSave?.when || save.when > localSave.when)) {
        localStorage.setItem('zillions_save', JSON.stringify(save));
        if (!this.game) this.ui.setContinue(save.snap);
      }
    } catch {
      // Static/local play keeps using localStorage without backend noise.
    }
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

  // ----- host side -----

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
      this.guestCmdQueues.push([]);
      this.pendingPeer = null;
      peer.send({ t: 'lobby', n: this.peers.length + 1 });
      this.ui.mpLobby(this.peers.length, this.peers.length < 2);
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
    if (m.t === 'hero') { this.guestHeroes[idx] = m.k; this.ui.mpLobby(this.peers.length, this.peers.length < 2); }
    else if (m.t === 'cmd') this.guestCmdQueues[idx].push(m.c);
    else if (m.t === 'h') this._checkGuestHash(m.w, m.h, idx);
  }

  _broadcast(msg) {
    for (const p of this.peers) p.send(msg);
  }

  _checkGuestHash(w, h, idx) {
    const mine = this.hashes.local.get(w);
    if (mine !== undefined && mine !== h && !this.desynced) {
      this.desynced = true;
      this._broadcast({ t: 'desync' });
      this.ui.showBanner('⚠️ Games desynced — everyone should refresh and reconnect.', 'bad', 10000);
    }
  }

  // ----- guest side -----

  async joinGame(code) {
    this.audio.init();
    this.mpRole = 'guest';
    this.net = new NetSession();
    this.net.onOpen = () => this.net.send({ t: 'hero', k: this.ui.selectedHero });
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

  _onGuestMsg(m) {
    if (m.t === 'lobby') this.ui.mpConnected(false, m.n);
    else if (m.t === 'w') this.inbox.set(m.w, m.c);
    else if (m.t === 'start') {
      if (m.snap) this.startGame(m.snap.diff, null, { myPlayer: m.you, role: 'guest' }, m.snap);
      else this.startGame(m.d, null, { heroes: m.heroes, myPlayer: m.you, role: 'guest', level: m.level, mode: m.mode || 'survival-plots' });
    }
    else if (m.t === 'desync' && !this.desynced) {
      this.desynced = true;
      this.ui.showBanner('⚠️ Games desynced — everyone should refresh and reconnect.', 'bad', 10000);
    }
  }

  // ----- shared -----

  issue(cmd) {
    if (!this.game) return;
    if (!this.netMode) { this.game.exec(cmd); return; }
    if (this.mpRole === 'host') this.outbox.push(cmd);
    else this.net.send({ t: 'cmd', c: cmd });
  }

  _stateHash() {
    const g = this.game;
    let h = 7;
    h = (h * 31 + Math.round(g.res.gold)) | 0;
    h = (h * 31 + g.zombies.length) | 0;
    h = (h * 31 + g.units.length) | 0;
    h = (h * 31 + g.buildings.length) | 0;
    h = (h * 31 + g.stats.kills) | 0;
    h = (h * 31 + (g.plotMode ? 17 : 3)) | 0;
    if (g.plotMode) {
      for (const plot of g.plots) {
        h = (h * 31 + (plot.built ? 1 : 0) + Math.round(plotPaidTotal(plot) * 1000)) | 0;
      }
    }
    for (const hr of g.heroes) {
      h = (h * 31 + Math.round(hr.x * 8) + Math.round(hr.z * 8) * 7 + hr.level * 131) | 0;
    }
    return h;
  }

  _setupLights() {
    // Grimdark mood: low amber sun through ashen haze.
    this.sun = new THREE.DirectionalLight(0xffd9a8, 2.3);
    this.sun.position.set(60, 90, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 55;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 260 });
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x8fa3b8, 0x3a4230, 0.75);
    this.scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0x3a3e50, 0.45);
    this.scene.add(this.amb);
    this.scene.fog = new THREE.FogExp2(0x707a84, 0.0075);
    this.scene.background = new THREE.Color(0x707a84);
  }

  _setupPicking() {
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }

  _makeRangeRing() {
    const geo = new THREE.RingGeometry(0.94, 1, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x7fd6ff, transparent: true, opacity: 0.65, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    m.renderOrder = 5;
    return m;
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

    this.zBody = new THREE.InstancedMesh(bodyGeo, mat, ZMAX);
    this.zHead = new THREE.InstancedMesh(headGeo, mat.clone(), ZMAX);
    this.zArm = new THREE.InstancedMesh(armGeo, mat.clone(), ZMAX);
    for (const m of [this.zBody, this.zHead, this.zArm]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      this.scene.add(m);
    }
    this._zdummy = new THREE.Object3D();
    this._zcolor = new THREE.Color();
  }

  _updateZombieMeshes(t) {
    const g = this.game;
    const n = Math.min(g.zombies.length, ZMAX);
    const d = this._zdummy, c = this._zcolor;
    for (let i = 0; i < n; i++) {
      const zb = g.zombies[i];
      const bob = Math.sin(t * 7 + zb.phase) * 0.05;
      const yaw = Math.atan2(zb.dirX, zb.dirZ);
      const s = zb.def.scale;
      d.position.set(zb.x, bob, zb.z);
      d.rotation.set(zb.state === 2 ? 0.22 : 0.05, yaw, Math.sin(t * 5 + zb.phase) * 0.06);
      d.scale.set(s, s, s);
      d.updateMatrix();
      this.zBody.setMatrixAt(i, d.matrix);
      this.zHead.setMatrixAt(i, d.matrix);
      this.zArm.setMatrixAt(i, d.matrix);
      if (zb.hitFlash > 0) c.setRGB(1.6, 1.2, 1.2);
      else c.setHex(zb.def.color);
      this.zBody.setColorAt(i, c);
      this.zArm.setColorAt(i, c);
      c.multiplyScalar(0.8);
      this.zHead.setColorAt(i, c);
    }
    for (const m of [this.zBody, this.zHead, this.zArm]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
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
      // fg: same transform but offset left edge & scaled by frac
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
      if (b.hp < b.maxHp) add(b.cx, this._buildingHeight(b.key) + 0.5, b.cz, b.hp / b.maxHp, Math.max(1.2, b.size * 0.8));
    }
    for (const u of g.units) {
      if (u.hp < u.maxHp || u.selected) add(u.x, 1.45, u.z, Math.max(0, u.hp / u.maxHp), 0.8);
    }
    for (const zb of g.zombies) {
      if (zb.type === 'brute' && zb.hp < zb.maxHp) { add(zb.x, 2.1, zb.z, zb.hp / zb.maxHp, 1.1); if (i >= MAXB) break; }
    }
    this.barBg.count = this.barFg.count = i;
    this.barBg.instanceMatrix.needsUpdate = true;
    this.barFg.instanceMatrix.needsUpdate = true;
    if (this.barFg.instanceColor) this.barFg.instanceColor.needsUpdate = true;
  }

  _buildingHeight(key) {
    return { hq: 3.6, mill: 3.4, tower: 3.0, barracks: 2.2, wall: 1.1 }[key] || 1.8;
  }

  // ---------------- building meshes ----------------

  _makeBuildingMesh(key) {
    const d = BUILDINGS[key];
    const g = new THREE.Group();

    // Real 3D wall segments from the KayKit pack (CC0), when loaded.
    if (key === 'wall' && hasAsset('wall')) {
      const seg = assetClone(Math.random() < 0.3 ? 'wallCracked' : 'wall', 1.06);
      if (seg) { g.add(seg); g.userData.wallSeg = seg; return g; }
    }
    const M = (color) => new THREE.MeshLambertMaterial({ color });
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

    switch (key) {
      case 'hq': {
        box(3.6, 1.1, 3.6, 0x45474d, 0, 0.55);
        box(2.4, 0.9, 2.4, 0x33353a, 0, 1.95);
        cyl(0.5, 0.6, 1.6, 0x565a62, 1.1, 1.6, 1.1);
        cone(0.75, 0.8, 0x6e1f1f, 1.1, 2.75, 1.1);
        box(0.06, 1.6, 0.06, 0x333333, -1, 3.1, -1);
        const flag = box(0.7, 0.4, 0.02, 0xa8232d, -0.62, 3.6, -1);
        g.userData.flag = flag;
        cone(1.7, 1.0, 0x50242a, 0, 2.9, 0);
        break;
      }
      case 'tent': {
        cone(1.15, 1.15, 0x6e6250, 0, 0.57);
        box(0.34, 0.5, 0.06, 0x4a4237, 0, 0.25, 0.72);
        break;
      }
      case 'farm': {
        box(2.9, 0.12, 2.9, 0x463a28, 0, 0.06);
        for (let r = 0; r < 3; r++) box(2.5, 0.14, 0.5, 0x5c6e38, 0, 0.15, -0.9 + r * 0.9);
        box(0.7, 0.6, 0.7, 0x54473a, 1.0, 0.35, 1.0);
        cone(0.62, 0.5, 0x5c3028, 1.0, 0.9, 1.0);
        break;
      }
      case 'sawmill': {
        box(1.5, 0.9, 1.3, 0x5a4a38, -0.1, 0.45);
        cone(1.15, 0.7, 0x3f3428, -0.1, 1.25);
        const log1 = cyl(0.14, 0.14, 1.1, 0x6e563c, 0.65, 0.15, 0.55);
        log1.rotation.z = Math.PI / 2;
        const log2 = cyl(0.12, 0.12, 1.0, 0x60492f, 0.65, 0.4, 0.55);
        log2.rotation.z = Math.PI / 2;
        break;
      }
      case 'quarry': {
        box(2.8, 0.3, 2.8, 0x55534c, 0, 0.15);
        box(1.1, 0.8, 1.1, 0x484640, -0.7, 0.7, -0.7);
        cyl(0.07, 0.07, 2.0, 0x3a3835, 0.5, 1.15, 0.5);
        const arm = box(1.6, 0.1, 0.1, 0x44423c, 1.1, 2.0, 0.5);
        arm.rotation.z = -0.3;
        break;
      }
      case 'mine': {
        box(2.8, 0.25, 2.8, 0x5e5442, 0, 0.13);
        box(0.9, 0.9, 0.9, 0x33353a, 0, 0.7);
        box(0.12, 2.0, 0.12, 0x2e3033, -0.5, 1.2, -0.5);
        box(0.12, 2.0, 0.12, 0x2e3033, 0.5, 1.2, -0.5);
        box(1.3, 0.15, 0.5, 0x2e3033, 0, 2.2, -0.5);
        cyl(0.35, 0.35, 0.18, 0xf3c53d, 0, 2.2, -0.5, 12).rotation.x = Math.PI / 2;
        break;
      }
      case 'mill': {
        cyl(0.55, 0.75, 2.4, 0x6e6a5c, 0, 1.2, 0, 8);
        cone(0.7, 0.7, 0x5c3028, 0, 2.75, 0, 8);
        const rotor = new THREE.Group();
        rotor.position.set(0, 2.35, 0.62);
        for (let i = 0; i < 4; i++) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.5, 0.04), M(0x8a8578));
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
      case 'tower': {
        cyl(0.72, 0.9, 2.4, 0x4f5258, 0, 1.2, 0, 8);
        box(1.7, 0.25, 1.7, 0x3f4147, 0, 2.5);
        for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
          box(0.22, 0.35, 0.22, 0x3f4147, dx, 2.8, dz);
        }
        const bal = box(0.5, 0.25, 0.9, 0x2e3033, 0, 2.75, 0);
        g.userData.head = bal;
        break;
      }
      case 'wall': {
        box(0.92, 0.85, 0.92, 0x565349, 0, 0.42);
        box(0.98, 0.2, 0.98, 0x3e3c35, 0, 0.95);
        break;
      }
      case 'barracks': {
        box(2.7, 1.1, 1.9, 0x44464c, 0, 0.55);
        cone(1.85, 0.9, 0x2f3136, 0, 1.55);
        box(0.06, 1.9, 0.06, 0x333333, 1.15, 1.7, 0.75);
        box(0.55, 0.35, 0.02, 0x8f1f1f, 0.85, 2.35, 0.75);
        box(0.7, 0.7, 0.1, 0x2e3033, 0, 0.35, 0.98);
        break;
      }
    }

    // CC0 prop dressing (skipped gracefully when assets are unavailable).
    const dress = (assetKey, fit, x, z, ry = 0) => {
      const a = assetClone(assetKey, fit);
      if (a) { a.position.set(x, 0, z); a.rotation.y = ry; g.add(a); }
    };
    if (key === 'hq') {
      dress('banner', 0.85, -1.7, 0.6);
      dress('banner', 0.85, 1.7, 0.6, Math.PI);
      dress('crates', 1.1, -1.4, 1.5, 0.4);
      dress('torch', 0.45, 1.5, 1.6);
    } else if (key === 'barracks') {
      dress('banner', 0.8, -1.2, 0.9);
      dress('boxes', 1.0, 1.15, -0.95, 0.7);
      dress('torch', 0.42, -1.2, -0.9);
    } else if (key === 'sawmill') {
      dress('barrel', 0.55, -0.9, 0.75);
    } else if (key === 'tower') {
      dress('torch', 0.4, 0.75, 0.75);
    } else if (key === 'mine' || key === 'quarry') {
      dress('crates', 0.9, 1.1, -1.1, 0.3);
    } else if (key === 'mill') {
      dress('barrel', 0.5, 0.85, 0.65);
    }
    return g;
  }

  _syncBuildings() {
    const g = this.game;
    const seen = new Set();
    for (const b of g.buildings) {
      seen.add(b.id);
      if (!this.buildingMeshes.has(b.id)) {
        const mesh = this._makeBuildingMesh(b.key);
        mesh.position.set(b.cx, 0, b.cz);
        // Align wall segments with the wall line they belong to.
        if (mesh.userData.wallSeg) {
          const N = g.map.size;
          const isWall = (x, z) => {
            const id = g.occ[z * N + x];
            if (!id) return false;
            const nb = g.buildings.find((o) => o.id === id);
            return nb && nb.key === 'wall';
          };
          const ew = isWall(b.x - 1, b.z) || isWall(b.x + 1, b.z);
          const ns = isWall(b.x, b.z - 1) || isWall(b.x, b.z + 1);
          mesh.userData.wallSeg.rotation.y = ns && !ew ? Math.PI / 2 : 0;
        }
        this.scene.add(mesh);
        this.buildingMeshes.set(b.id, { mesh, b });
      }
    }
    for (const [id, rec] of this.buildingMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(rec.mesh);
        this.buildingMeshes.delete(id);
        if (this.selectedBuilding && this.selectedBuilding.id === id) {
          this.selectedBuilding = null;
          this.ui.showSelection(null);
        }
      }
    }
  }

  _makePlotLabel(icon, sub) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(12, 14, 18, 0.72)';
    ctx.strokeStyle = 'rgba(255, 215, 94, 0.72)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(12, 8, 104, 76, 14);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '34px "Segoe UI Emoji", system-ui, sans-serif';
    ctx.fillStyle = '#fff4c8';
    ctx.fillText(icon, 64, 34);
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.fillStyle = '#ffd75e';
    ctx.fillText(sub, 64, 66);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(3.7, 2.8, 1);
    sprite.renderOrder = 7;
    return sprite;
  }

  _makePlotMesh(plot) {
    const info = plotInfo(plot.key);
    const group = new THREE.Group();
    const color = info.color;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(plot.size + 0.35, 0.05, plot.size + 0.35),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    base.position.y = 0.04;
    const ringGeo = new THREE.RingGeometry(Math.max(0.55, plot.size * 0.55), Math.max(0.72, plot.size * 0.55 + 0.16), 36);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.52, depthWrite: false }),
    );
    ring.position.y = 0.08;
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    beacon.position.y = 0.78;
    const label = this._makePlotLabel(info.icon, plotCostText(plot));
    label.position.y = 1.9;
    group.add(base, ring, beacon, label);
    group.userData = { base, ring, beacon, label, labelKey: '' };
    group.renderOrder = 2;
    return group;
  }

  _syncPlots() {
    if (!this.game?.plotMode) {
      for (const rec of this.plotMeshes.values()) this.scene.remove(rec.mesh);
      this.plotMeshes.clear();
      return;
    }
    const seen = new Set();
    const activeId = this.game.activePlot?.id || null;
    const t = this.clock.elapsedTime;
    for (const plot of this.game.plots) {
      if (plot.built) continue;
      seen.add(plot.id);
      let rec = this.plotMeshes.get(plot.id);
      if (!rec) {
        rec = { mesh: this._makePlotMesh(plot), plot };
        this.scene.add(rec.mesh);
        this.plotMeshes.set(plot.id, rec);
      }
      const progress = plotPaidTotal(plot);
      rec.mesh.position.set(plot.cx, 0, plot.cz);
      rec.mesh.rotation.y = t * 0.18;
      rec.mesh.userData.base.material.opacity = 0.16 + progress * 0.22;
      rec.mesh.userData.ring.material.opacity = (plot.id === activeId ? 0.9 : 0.42) + progress * 0.18;
      rec.mesh.userData.beacon.visible = plot.id === activeId || progress > 0.02;
      rec.mesh.userData.beacon.scale.y = 0.55 + progress * 1.4 + (plot.id === activeId ? Math.sin(t * 5) * 0.12 : 0);
      const info = plotInfo(plot.key);
      const labelKey = `${info.icon}:${plotCostText(plot)}`;
      if (rec.mesh.userData.labelKey !== labelKey) {
        rec.mesh.remove(rec.mesh.userData.label);
        const label = this._makePlotLabel(info.icon, plotCostText(plot));
        label.position.y = 1.9;
        rec.mesh.add(label);
        rec.mesh.userData.label = label;
        rec.mesh.userData.labelKey = labelKey;
      }
      rec.mesh.userData.label.position.y = 1.9 + Math.sin(t * 2.3 + plot.id) * 0.08;
    }
    for (const [id, rec] of this.plotMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(rec.mesh);
        this.plotMeshes.delete(id);
      }
    }
  }

  // ---------------- units ----------------

  _makeUnitMesh(u) {
    const g = new THREE.Group();
    const M = (c, e = 0) => new THREE.MeshLambertMaterial({ color: c, emissive: e ? c : 0x000000, emissiveIntensity: e });
    const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh; };

    if (u.turret) {
      // Sentry servitor: squat tripod, rotating barrel, glowing eye.
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.3, 6), M(0x3c3f42)), 0, 0.15, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), M(0x54585c)), 0, 0.45, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.6), M(0x1e1f21)), 0.1, 0.55, 0.25);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.6), M(0x1e1f21)), -0.1, 0.55, 0.25);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), M(0xff3322, 0.9)), 0, 0.62, 0.18);
    } else if (u.key === 'treant') {
      // Little walking tree.
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.55, 6), M(0x3e3020)), 0, 0.28, 0);
      add(new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.8, 6), M(0x3a5c2e)), 0, 0.95, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 5, 4), M(0xffe08a, 0.8)), -0.08, 0.5, 0.16);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 5, 4), M(0xffe08a, 0.8)), 0.08, 0.5, 0.16);
      const armL = add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.06), M(0x4a3a28)), -0.24, 0.45, 0);
      armL.rotation.z = 0.5;
      const armR = add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.06), M(0x4a3a28)), 0.24, 0.45, 0);
      armR.rotation.z = -0.5;
    } else if (u.hero) {
      // Power-armored space marine: broad torso, pauldrons, backpack, glow visor.
      const d = u.def;
      const armor = M(d.color), trim = M(d.trim);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.26), M(0x26282c)), 0, 0.2, 0);          // legs
      add(new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.5, 0.36), armor), 0, 0.62, 0);                 // torso
      add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.05), trim), 0, 0.68, 0.19);               // chest plate
      add(new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), armor), -0.34, 0.86, 0);               // pauldron L
      add(new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), armor), 0.34, 0.86, 0);                // pauldron R
      add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.22), M(0x3a3d42)), 0, 1.0, 0);           // helm
      add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.03), M(0x35ff70, 0.9)), 0, 1.0, 0.12);   // visor glow
      add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.2), M(0x2e3033)), 0, 0.72, -0.26);       // backpack
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 6), M(0x4a4d52)), -0.12, 1.0, -0.26); // vent L
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 6), M(0x4a4d52)), 0.12, 1.0, -0.26);  // vent R
      if (d.melee) {
        const blade = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.16), trim), 0.42, 0.6, 0.22);
        blade.rotation.x = 0.5;
      } else if (u.key === 'alexander') {
        // Twin guns for the run-and-gunner.
        add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.6), M(0x1e1f21)), 0.3, 0.64, 0.24);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.6), M(0x1e1f21)), -0.3, 0.64, 0.24);
      } else {
        add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.78), M(0x1e1f21)), 0.28, 0.66, 0.24);   // long rifle
      }
      // Faint always-on hero halo.
      const haloGeo = new THREE.RingGeometry(0.5, 0.62, 28);
      haloGeo.rotateX(-Math.PI / 2);
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xc9a44a, transparent: true, opacity: 0.5, depthWrite: false }));
      halo.position.y = 0.03;
      g.add(halo);
      g.scale.setScalar(1.18);
    } else {
      // Guardsman-style trooper.
      const d = u.def;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.62, 8), M(d.color)), 0, 0.45, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), M(0xc4a37e)), 0, 0.92, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.12, 8), M(d.color)), 0, 1.02, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.68), M(0x232426)), 0.2, 0.62, 0.18);
    }

    const ringGeo = new THREE.RingGeometry(0.36, 0.46, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x59ff9c, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.position.y = 0.03;
    ring.visible = false;
    g.add(ring);
    g.userData.ring = ring;
    return g;
  }

  _syncUnits() {
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
      rec.mesh.rotation.y = u.hero && u.whirlT > 0 ? this.clock.elapsedTime * 18 : u.facing;
      rec.mesh.userData.ring.visible = u.selected;
      // Cloaked heroes fade to a ghost.
      if (u.hero) {
        const wantOp = u.stealth ? 0.3 : 1;
        if (rec.op !== wantOp) {
          rec.op = wantOp;
          rec.mesh.traverse((o) => {
            if (o.isMesh && o !== rec.mesh.userData.ring) {
              o.material.transparent = true;
              o.material.opacity = wantOp;
            }
          });
        }
      }
    }
    for (const [id, rec] of this.unitMeshes) {
      if (!seen.has(id)) { this.scene.remove(rec.mesh); this.unitMeshes.delete(id); }
    }
    // Purge dead units from the current selection.
    if (this.selection.some((u) => u.dead)) {
      this.selection = this.selection.filter((u) => !u.dead);
      this.ui.showSelection(this.selection.length ? this.selection : null, g);
    }
  }

  _syncPickups() {
    if (!this.pickupMeshes) this.pickupMeshes = new Map();
    const seen = new Set();
    for (const p of this.game.pickups) {
      seen.add(p.id);
      if (!this.pickupMeshes.has(p.id)) {
        const g = new THREE.Group();
        if (p.kind === 'gold') {
          const model = assetClone('chest', 0.55);
          if (model) {
            model.position.y = -0.15;
            g.add(model);
          } else {
            const chest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.26),
              new THREE.MeshLambertMaterial({ color: 0xc9a44a, emissive: 0xc9a44a, emissiveIntensity: 0.35 }));
            chest.castShadow = true;
            g.add(chest);
          }
        } else {
          const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.3),
            new THREE.MeshLambertMaterial({ color: 0xe8e4da }));
          const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.07),
            new THREE.MeshLambertMaterial({ color: 0xd23c3c, emissive: 0xd23c3c, emissiveIntensity: 0.5 }));
          cross1.position.y = 0.14;
          const cross2 = cross1.clone();
          cross2.rotation.y = Math.PI / 2;
          box.castShadow = true;
          g.add(box, cross1, cross2);
        }
        g.position.set(p.x, 0.3, p.z);
        this.scene.add(g);
        this.pickupMeshes.set(p.id, g);
      }
    }
    const t = this.clock.elapsedTime;
    for (const [id, mesh] of this.pickupMeshes) {
      if (!seen.has(id)) { this.scene.remove(mesh); this.pickupMeshes.delete(id); }
      else { mesh.position.y = 0.3 + Math.sin(t * 2.5 + id) * 0.08; mesh.rotation.y = t * 1.2; }
    }
  }

  // ---------------- input ----------------

  _setupInput() {
    const cv = this.canvas;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (!this.game) return;
      if (this.game.plotMode && k === ' ') {
        e.preventDefault();
        this._setBuildHold(true);
        return;
      }
      if (this.game.plotMode && ['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright', 'shift'].includes(k)) return;
      if (k === 'p') { e.preventDefault(); this.setSpeed(0); }
      else if (k === 'm') { this.audio.setMuted(!this.audio.muted); this.ui.setMuteUI(this.audio.muted); }
      else if (k === 'h') { this.pause(); this.ui.showHelp(); }
      else if (k === 'escape') { this.targeting = null; this.canvas.style.cursor = 'default'; this.setBuildMode(null); this._clearSelection(); }
      else if (k === 'f' || k === 'f1') { e.preventDefault(); this._selectHero(); }
      else if (k === 't') { this._selectArmy(); }
      else if (this._heroSelected() && ['q', 'e', 'r'].includes(k)) {
        this.tryCast(['q', 'w', 'e', 'r'].indexOf(k));
      } else {
        if (!this.game.plotMode) {
          for (const [bk, bd] of Object.entries(BUILDINGS)) {
            if (bd.hotkey === k) this.setBuildMode(bk);
          }
          for (const [uk, ud] of Object.entries(UNITS)) {
            if (ud.hotkey.toLowerCase() === k) this.issue({ t: 'train', k: uk });
          }
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === ' ') this._setBuildHold(false);
    });

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = clamp(this.camDist * (1 + Math.sign(e.deltaY) * 0.12), 12, 80);
    }, { passive: false });

    cv.addEventListener('contextmenu', (e) => e.preventDefault());

    cv.addEventListener('pointerdown', (e) => {
      this.audio.init();
      if (!this.game) return;
      this._updateMouse(e);
      if (e.button === 0 && this.targeting != null) {
        this.issue({ t: 'cast', i: this.targeting, x: this.mouse.gx, z: this.mouse.gz, p: this.myPlayer });
        this.targeting = null;
        this.canvas.style.cursor = 'default';
        return;
      }
      if (e.button === 0 && this.orderMode === 'move' && this.selection.length) {
        this._issueMoveOrder(this.mouse.gx, this.mouse.gz);
        this._resetOrderMode();
        return;
      }
      if (e.button === 0 && !this.buildMode) {
        const plot = this._plotUnderMouse();
        if (plot) {
          this._moveHeroToPlot(plot);
          return;
        }
      }
      if (e.button === 0) {
        this.mouse.down = true;
        if (this.buildMode) {
          this._tryPlace();
          if (BUILDINGS[this.buildMode] && BUILDINGS[this.buildMode].drag) {
            this.wallDrag = true;
          }
        } else {
          this.dragStart = { x: e.clientX, y: e.clientY };
        }
      } else if (e.button === 2) {
        this.mouse.rdown = true;
        if (this.orderMode) { this._resetOrderMode(); return; }
        if (this.targeting != null) { this.targeting = null; this.canvas.style.cursor = 'default'; return; }
        if (this.buildMode) { this.setBuildMode(null); return; }
        if (this.selection.length) {
          this._issueMoveOrder(this.mouse.gx, this.mouse.gz);
        }
      }
    });

    window.addEventListener('pointermove', (e) => {
      this._updateMouse(e);
      if (this.wallDrag && this.mouse.down) this._tryPlace(true);
      if (this.dragStart) this._updateDragRect(e);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this._setBuildHold(false);
      this._clearMousePosition();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.keys.clear();
        this._setBuildHold(false);
      }
    });
    document.addEventListener('mouseleave', () => this._clearMousePosition());

    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) {
        this.mouse.down = false;
        this.wallDrag = false;
        this.lastWallTile = null;
        if (this.dragStart) {
          const dx = Math.abs(e.clientX - this.dragStart.x), dy = Math.abs(e.clientY - this.dragStart.y);
          if (dx > 6 || dy > 6) this._selectInRect(this.dragStart, { x: e.clientX, y: e.clientY });
          else if (!this._clickSelect() && this.game?.plotMode) this._moveHeroToPoint(this.mouse.gx, this.mouse.gz);
          this.dragStart = null;
          document.getElementById('dragrect').style.display = 'none';
        }
      }
      if (e.button === 2) this.mouse.rdown = false;
    });
  }

  _updateMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.mouse.cx = e.clientX; this.mouse.cy = e.clientY;
    this.raycaster.setFromCamera({ x: this.mouse.x, y: this.mouse.y }, this.camera);
    const pt = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, pt)) {
      this.mouse.gx = clamp(pt.x, 0, MAP_SIZE);
      this.mouse.gz = clamp(pt.z, 0, MAP_SIZE);
    }
    if (this.game?.plotMode && !this.buildMode && !this.orderMode && this.targeting == null) {
      this.canvas.style.cursor = this._plotUnderMouse() ? 'pointer' : 'default';
    }
  }

  _clearMousePosition() {
    this.mouse.cx = undefined;
    this.mouse.cy = undefined;
  }

  _issueMoveOrder(x, z) {
    const live = this.selection.filter((u) => !u.dead);
    if (!live.length) return;
    const mh = this.myHero();
    if (mh && live.includes(mh)) this.audio.bark(mh.key, 'move');
    else if (live.some((u) => !u.hero)) this.audio.faction('army', 'move');
    this.issue({ t: 'move', ids: live.map((u) => u.id), x, z });
    this.burst(x, 0.1, z, { count: 6, color: 0x59ff9c, speed: 1.2, life: 0.4, size: 0.35, up: 0.8 });
  }

  _setBuildHold(on) {
    if (!this.game?.plotMode) return;
    const next = !!on;
    if (this.buildHoldOn === next) return;
    this.buildHoldOn = next;
    this.issue({ t: 'heroBuild', p: this.myPlayer, on: next });
  }

  _moveHeroToPoint(x, z, focusedPlot = null) {
    const hero = this.myHero();
    if (!hero || hero.dead) return;
    this.focusedPlot = focusedPlot;
    this._clearSelection();
    const now = performance.now();
    if (now - (this._lastHeroMoveBark || 0) > 650) {
      this._lastHeroMoveBark = now;
      this.audio.bark(hero.key, 'move');
    }
    this.issue({ t: 'move', ids: [hero.id], x, z });
    this.burst(x, 0.1, z, { count: 6, color: 0x59ff9c, speed: 1.2, life: 0.4, size: 0.35, up: 0.8 });
  }

  _plotUnderMouse() {
    if (!this.game?.plotMode) return null;
    let best = null;
    let bd = PLOT_PAY_RADIUS * PLOT_PAY_RADIUS;
    for (const plot of this.game.plots) {
      if (plot.built) continue;
      const rx = Math.max(Math.abs(this.mouse.gx - plot.cx) - plot.size * 0.5, 0);
      const rz = Math.max(Math.abs(this.mouse.gz - plot.cz) - plot.size * 0.5, 0);
      const d = rx * rx + rz * rz;
      if (d < bd) { bd = d; best = plot; }
    }
    return best;
  }

  _moveHeroToPlot(plot) {
    const hero = this.myHero();
    if (!hero || hero.dead) return;
    this._moveHeroToPoint(plot.cx, plot.cz, plot);
    const info = plotInfo(plot.key);
    this.ui.showPlotCommandBar(this.game, plot);
    this.game.msg(`${info.label}: ride onto the foundation, then hold Space to build for ${plotCostText(plot)}.`, 'info');
    this.burst(plot.cx, 0.1, plot.cz, { count: 10, color: info.color, speed: 1.2, life: 0.5, size: 0.35, up: 1.2 });
  }

  _selectionBark(units, category = 'selection') {
    if (!units || !units.length) return;
    if (units.some((u) => !u.hero)) this.audio.faction('army', category);
  }

  _resetOrderMode() {
    this.orderMode = null;
    if (!this.buildMode && this.targeting == null) this.canvas.style.cursor = 'default';
    this.ui.setOrderMode(null);
  }

  _updateDragRect(e) {
    const el = document.getElementById('dragrect');
    const x0 = Math.min(this.dragStart.x, e.clientX), y0 = Math.min(this.dragStart.y, e.clientY);
    const w = Math.abs(e.clientX - this.dragStart.x), h = Math.abs(e.clientY - this.dragStart.y);
    if (w > 6 || h > 6) {
      el.style.display = 'block';
      el.style.left = x0 + 'px'; el.style.top = y0 + 'px';
      el.style.width = w + 'px'; el.style.height = h + 'px';
    }
  }

  _selectInRect(a, b) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    this._clearSelection();
    const v = new THREE.Vector3();
    const r = this.canvas.getBoundingClientRect();
    for (const u of this.game.units) {
      v.set(u.x, 0.5, u.z).project(this.camera);
      const sx = ((v.x + 1) / 2) * r.width + r.left;
      const sy = ((1 - v.y) / 2) * r.height + r.top;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
        u.selected = true;
        this.selection.push(u);
      }
    }
    if (this.selection.length) {
      this.audio.click();
      this._selectionBark(this.selection, 'selection');
    }
    this.ui.showSelection(this.selection.length ? this.selection : null, this.game);
  }

  _selectUnitById(id, focus = false) {
    if (!this.game) return;
    const unit = this.game.units.find((u) => u.id === id && !u.dead);
    if (!unit) return;
    this._clearSelection();
    unit.selected = true;
    this.selection = [unit];
    this.selectedBuilding = null;
    if (focus) {
      this.focus.x = unit.x;
      this.focus.z = unit.z;
    }
    this.audio.click();
    if (!unit.hero) this.audio.faction('army', 'selection');
    this.ui.showSelection(this.selection, this.game);
  }

  _toggleUnitById(id) {
    if (!this.game) return;
    const unit = this.game.units.find((u) => u.id === id && !u.dead);
    if (!unit) return;
    this.selectedBuilding = null;
    if (this.selection.includes(unit)) {
      if (this.selection.length === 1) {
        this.focus.x = unit.x;
        this.focus.z = unit.z;
      } else {
        unit.selected = false;
        this.selection = this.selection.filter((u) => u !== unit);
      }
    } else {
      unit.selected = true;
      this.selection.push(unit);
    }
    this.audio.click();
    this._selectionBark(this.selection, 'selection');
    this.ui.showSelection(this.selection.length ? this.selection : null, this.game);
  }

  _selectUnitsByKey(key) {
    if (!this.game) return;
    this._clearSelection();
    for (const u of this.game.units) {
      if (u.dead || u.turret || u.key !== key) continue;
      u.selected = true;
      this.selection.push(u);
    }
    if (this.selection.length) {
      this.audio.click();
      this._selectionBark(this.selection, 'selection');
      this.focus.x = this.selection[0].x;
      this.focus.z = this.selection[0].z;
      this.ui.showSelection(this.selection, this.game);
    }
  }

  _clickSelect() {
    const g = this.game;
    this._clearSelection();
    // Unit near click?
    let best = null, bd = 1.0;
    for (const u of g.units) {
      const d = Math.hypot(u.x - this.mouse.gx, u.z - this.mouse.gz);
      if (d < bd) { bd = d; best = u; }
    }
    if (best) {
      best.selected = true;
      this.selection.push(best);
      if (best.hero) {
        const now = performance.now();
        if (now - (this._lastHeroSel || 0) < 4000) this._heroClicks = (this._heroClicks || 0) + 1;
        else this._heroClicks = 1;
        this._lastHeroSel = now;
        this.audio.bark(best.key, this._heroClicks >= 3 ? 'repeated' : 'selection');
      } else {
        this.audio.faction('army', 'selection');
      }
      this.audio.click();
      this.ui.showSelection(this.selection, g);
      return true;
    }
    // Building under click?
    const tx = this.mouse.gx | 0, tz = this.mouse.gz | 0;
    const id = g.occ[tz * g.map.size + tx];
    if (id > 0) {
      const b = g.buildings.find((o) => o.id === id);
      if (b) {
        this.selectedBuilding = b;
        this.audio.click();
        this.ui.showSelection(b, g);
        return true;
      }
    }
    this.ui.showSelection(null);
    return false;
  }

  _clearSelection() {
    for (const u of this.selection) u.selected = false;
    this.selection = [];
    this.selectedBuilding = null;
    this.ui.showSelection(null);
  }

  myHero() { return this.game ? this.game.heroes[this.myPlayer] : null; }

  _heroSelected() {
    const h = this.myHero();
    return !!(h && !h.dead && this.selection.includes(h));
  }

  _selectionCommand(cmd) {
    if (!this.game) return;
    if (cmd === 'move') {
      if (!this.selection.length) return;
      this.orderMode = 'move';
      this.setBuildMode(null);
      this.canvas.style.cursor = 'crosshair';
      this.ui.setOrderMode('move');
      this.game.msg('Move: click a destination.', 'info');
      return;
    }
    this._resetOrderMode();
    if (cmd === 'stop') {
      const live = this.selection.filter((u) => !u.dead);
      if (!live.length) return;
      this.issue({ t: 'stop', ids: live.map((u) => u.id) });
      this.game.msg('Holding position.', 'info');
    } else if (cmd === 'hero') {
      this._selectHero();
    } else if (cmd === 'army') {
      this._selectArmy();
    }
  }

  // Cast ability i — teleport-style abilities enter click-targeting mode first.
  tryCast(i) {
    if (!this.game) return;
    const h = this.myHero();
    if (!h || h.dead) return;
    const ab = h.def.abilities[i];
    const st = h.abil[i];
    if (ab.cast === 'teleport') {
      if (st.rank === 0 || st.cd > 0 || h.channelT > 0) { this.audio.deny(); return; }
      this.targeting = i;
      this.canvas.style.cursor = 'crosshair';
      this.game.msg('🌀 Teleport: click a destination (right-click to cancel).', 'info');
      return;
    }
    if (Math.random() < 0.4) this.audio.bark(h.key, 'attack');
    this.issue({ t: 'cast', i, p: this.myPlayer });
  }

  // T selects the whole army (hero + troops + summons).
  _selectArmy() {
    if (!this.game) return;
    this._clearSelection();
    for (const u of this.game.units) {
      if (u.dead || u.turret) continue;
      u.selected = true;
      this.selection.push(u);
    }
    if (this.selection.length) {
      this.audio.click();
      this._selectionBark(this.selection, 'selection');
      this.ui.showSelection(this.selection, this.game);
    }
  }

  // F selects the hero; pressed again quickly, centers the camera on him.
  _selectHero() {
    const h = this.myHero();
    if (!h || h.dead) return;
    const now = performance.now();
    if (this._heroSelected() && now - (this._lastHeroSel || 0) < 450) {
      this.focus.x = h.x; this.focus.z = h.z;
    }
    // WC3-style barks — spam-click your hero and he gets annoyed.
    if (now - (this._lastHeroSel || 0) < 4000) this._heroClicks = (this._heroClicks || 0) + 1;
    else this._heroClicks = 1;
    this.audio.bark(h.key, this._heroClicks >= 3 ? 'repeated' : 'selection');
    this._lastHeroSel = now;
    this._clearSelection();
    h.selected = true;
    this.selection = [h];
    this.audio.click();
    this.ui.showSelection(this.selection, this.game);
  }

  setBuildMode(key) {
    if (!this.game) return;
    if (key && this.game.plotMode) {
      this.audio.deny();
      this.game.msg('Use the glowing foundations to build Survival city sites.', 'info');
      return;
    }
    if (key) this._resetOrderMode();
    this.buildMode = key;
    this.canvas.style.cursor = key ? 'crosshair' : 'default';
    this.ui.setActiveBuild(key);
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    if (key) {
      this._clearSelection();
      this.ghost = this._makeBuildingMesh(key);
      this.ghost.traverse((o) => {
        if (o.isMesh) {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = 0.55;
          o.castShadow = false;
        }
      });
      this.scene.add(this.ghost);
    }
    this.rangeRing.visible = false;
  }

  _tryPlace(quiet = false) {
    const key = this.buildMode;
    if (!key) return;
    const d = BUILDINGS[key];
    const x = Math.round(this.mouse.gx - d.size / 2);
    const z = Math.round(this.mouse.gz - d.size / 2);
    if (quiet) {
      const tileKey = x + ',' + z;
      if (this.lastWallTile === tileKey) return;
      this.lastWallTile = tileKey;
      if (!this.game.canPlace(key, x, z).ok) return;
      this.issue({ t: 'quietPlace', k: key, x, z });
      return;
    }
    const chk = this.game.canPlace(key, x, z);
    if (!chk.ok) { this.audio.deny(); this.game.msg(chk.why, 'warn'); return; }
    this.issue({ t: 'quietPlace', k: key, x, z });
    if (!d.drag && !this.keys.has('shift')) this.setBuildMode(null);
  }

  // setSpeed(0) toggles pause; 1/2/4 set speed and unpause.
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
  }

  _updateHeroInput() {
    if (!this.game?.plotMode || this.game.over) return;
    const active = document.activeElement;
    const typing = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
    const overlayOpen = !!document.querySelector('#overlay:not(.hidden)');
    let x = 0, z = 0;
    if (!typing && !overlayOpen && !this.paused) {
      if (this.keys.has('w') || this.keys.has('arrowup')) z -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) z += 1;
      if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
      const len = Math.hypot(x, z);
      if (len > 1) { x /= len; z /= len; }
    }
    const s = this.keys.has('shift') && !typing && !overlayOpen && !this.paused;
    const last = this.lastHeroDir || { x: 0, z: 0, s: false };
    if (Math.abs(x - last.x) > 0.001 || Math.abs(z - last.z) > 0.001 || s !== last.s) {
      this.lastHeroDir = { x, z, s };
      this.issue({ t: 'heroDir', p: this.myPlayer, x, z, s });
    }
  }

  _updateCamera(dt) {
    if (this.game?.plotMode) {
      this.camYaw = 0;
      const h = this.myHero();
      if (h && !h.dead) {
        const lead = 3.8;
        const tx = clamp(h.x + (h.moveX || 0) * lead, 4, MAP_SIZE - 4);
        const tz = clamp(h.z + (h.moveZ || 0) * lead, 4, MAP_SIZE - 4);
        const a = clamp(dt * 7, 0, 1);
        this.focus.x = lerp(this.focus.x, tx, a);
        this.focus.z = lerp(this.focus.z, tz, a);
      }
      const elev = lerp(0.72, 1.0, clamp((this.camDist - 12) / 68, 0, 1));
      const hx = Math.cos(elev) * this.camDist, hy = Math.sin(elev) * this.camDist;
      let sx = 0, sz = 0;
      if (this.shake > 0) {
        this.shake -= dt;
        const s = Math.min(this.shake, 0.4);
        sx = (Math.random() - 0.5) * s; sz = (Math.random() - 0.5) * s;
      }
      this.camera.position.set(this.focus.x + sx, hy, this.focus.z + hx + sz);
      this.camera.lookAt(this.focus.x + sx, 0, this.focus.z + sz);
      this.sun.position.set(this.focus.x + 45, 80, this.focus.z + 25);
      this.sun.target.position.set(this.focus.x, 0, this.focus.z);
      return;
    }
    const panSpeed = this.camDist * 0.95 * dt;
    let px = 0, pz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) pz -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) pz += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) px -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) px += 1;
    const edge = this._edgePanVector();
    px += edge.x;
    pz += edge.z;
    const panLen = Math.hypot(px, pz);
    if (panLen > 1) {
      px /= panLen;
      pz /= panLen;
    }
    if (this.keys.has('z')) this.camYaw += dt * 1.6;
    if (this.keys.has('c')) this.camYaw -= dt * 1.6;

    this.focus.x += px * panSpeed;
    this.focus.z += pz * panSpeed;
    this.focus.x = clamp(this.focus.x, 4, MAP_SIZE - 4);
    this.focus.z = clamp(this.focus.z, 4, MAP_SIZE - 4);

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

    // Shadow camera follows focus.
    this.sun.position.set(this.focus.x + 45, 80, this.focus.z + 25);
    this.sun.target.position.set(this.focus.x, 0, this.focus.z);
  }

  _edgePanVector() {
    if (!this.game || document.querySelector('#overlay:not(.hidden)')) return { x: 0, z: 0 };
    if (document.hidden || this.mouse.cx === undefined || this.mouse.cy === undefined) return { x: 0, z: 0 };
    if (this.mouse.cx < 0 || this.mouse.cy < 0 || this.mouse.cx > window.innerWidth || this.mouse.cy > window.innerHeight) {
      return { x: 0, z: 0 };
    }
    const active = document.activeElement;
    if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return { x: 0, z: 0 };
    return {
      x: this._edgePanAxis(this.mouse.cx, window.innerWidth),
      z: this._edgePanAxis(this.mouse.cy, window.innerHeight),
    };
  }

  _edgePanAxis(pos, size) {
    const margin = Math.min(EDGE_PAN_MARGIN, Math.max(24, size * 0.08));
    if (pos < margin) return -Math.pow((margin - pos) / margin, 0.65);
    if (pos > size - margin) return Math.pow((pos - (size - margin)) / margin, 0.65);
    return 0;
  }

  _updateGhost() {
    if (!this.ghost || !this.game) return;
    const d = BUILDINGS[this.buildMode];
    const x = Math.round(this.mouse.gx - d.size / 2);
    const z = Math.round(this.mouse.gz - d.size / 2);
    this.ghost.position.set(x + d.size / 2, 0.02, z + d.size / 2);
    const ok = this.game.canPlace(this.buildMode, x, z).ok;
    this.ghost.traverse((o) => {
      if (o.isMesh) o.material.color.setHex(ok ? 0x6fdc7f : 0xe5484d);
    });
    if (d.range) {
      this.rangeRing.visible = true;
      this.rangeRing.position.set(x + d.size / 2, 0.06, z + d.size / 2);
      this.rangeRing.scale.setScalar(d.range);
    }
  }

  _updateDayNight() {
    const g = this.game;
    const f = g.dayFrac;
    // brightness: 1 during day, dips into night after 0.72
    let b;
    if (f < 0.68) b = 1;
    else if (f < 0.78) b = lerp(1, 0.25, (f - 0.68) / 0.1);
    else if (f < 0.94) b = 0.25;
    else b = lerp(0.25, 1, (f - 0.94) / 0.06);

    // Grimdark sky: rust-amber day, near-black night with a cold blue cast.
    this.sun.intensity = lerp(0.2, 2.3, b);
    this.sun.color.setHSL(0.07, lerp(0.35, 0.42, b), lerp(0.55, 0.8, b));
    this.hemi.intensity = lerp(0.18, 0.75, b);
    this.amb.intensity = lerp(0.5, 0.45, b);
    const sky = new THREE.Color().setHSL(lerp(0.62, 0.08, b * 0.35), lerp(0.5, 0.16, b), lerp(0.05, 0.5, b));
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
  }

  _consumeEvents() {
    const g = this.game;
    for (const e of g.events) {
      switch (e.type) {
        case 'shot': {
          if (e.kind === 'ricochet') {
            // Silent bounce tracer: sparks along the line, no gunshot.
            const steps = 4;
            for (let i = 0; i <= steps; i++) {
              const t2 = i / steps;
              this.burst(lerp(e.fx, e.tx, t2), lerp(e.fy || 0.6, 0.6, t2), lerp(e.fz, e.tz, t2),
                { count: 1, color: 0xffca6e, speed: 0.15, life: 0.14, size: 0.34, spread: 0.02, up: 0 });
            }
            this.burst(e.tx, 0.6, e.tz, { count: 3, color: 0x9c1f1f, speed: 1.3, life: 0.3, size: 0.35, up: 1 });
            break;
          }
          if (e.kind === 'melee') {
            // Chainblade hit: metal spark arc at the victim, no tracer.
            this.audio.melee();
            this.burst(e.tx, 0.7, e.tz, { count: 8, color: 0xffd27a, speed: 2.4, life: 0.25, size: 0.4, up: 1.4 });
            this.burst(e.tx, 0.6, e.tz, { count: 5, color: 0x9c1f1f, speed: 1.6, life: 0.35, size: 0.4, up: 1.2 });
            break;
          }
          this.audio.shoot(e.kind === 'hero' ? 'soldier' : e.kind);
          this.burst(e.fx, e.fy || 0.7, e.fz, { count: 3, color: 0xffe08a, speed: 0.8, life: 0.12, size: 0.5, spread: 0.1, up: 0.3 });
          this.burst(e.tx, 0.6, e.tz, { count: 5, color: 0x9c1f1f, speed: 1.6, life: 0.35, size: 0.4, up: 1.2 });
          // tracer: a few sparks along the line
          const steps = 5;
          for (let i = 1; i < steps; i++) {
            const t = i / steps;
            this.burst(lerp(e.fx, e.tx, t), lerp(e.fy || 0.7, 0.6, t), lerp(e.fz, e.tz, t),
              { count: 1, color: 0xfff2b0, speed: 0.1, life: 0.1, size: 0.32, spread: 0.02, up: 0 });
          }
          break;
        }
        case 'zdeath':
          this.spawnCorpse(e);
          this.burst(e.x, 0.4, e.z, { count: e.big ? 26 : 12, color: 0x8c1a1a, speed: e.big ? 3 : 2, life: 0.6, size: e.big ? 0.7 : 0.5, up: 2 });
          this.deathSfxT -= 1;
          if (this.deathSfxT <= 0) { this.audio.zombieDeath(); this.deathSfxT = 2; }
          break;
        case 'bite':
          this.burst(e.x, 0.7, e.z, { count: 4, color: 0xb32020, speed: 1.2, life: 0.3, size: 0.35, up: 1 });
          break;
        case 'udeath':
          this.burst(e.x, 0.5, e.z, { count: 20, color: 0xd23c3c, speed: 2.5, life: 0.7, size: 0.55, up: 2 });
          this.audio.zombieDeath();
          break;
        case 'build':
          this.audio.build();
          this.burst(e.x, 0.3, e.z, { count: 16, color: 0xc9b48a, speed: 2.2, life: 0.5, size: 0.6, up: 1.6, spread: 0.9 });
          break;
        case 'plotpay': {
          const info = plotInfo(e.key);
          this.burst(e.x, 0.18, e.z, { count: 8, color: info.color, speed: 1.0, life: 0.35, size: 0.36, up: 1.1, spread: 0.6 });
          break;
        }
        case 'demolish':
          this.audio.demolish();
          this.burst(e.x, 0.4, e.z, { count: 18, color: 0xa89878, speed: 2.4, life: 0.6, size: 0.6, up: 2 });
          break;
        case 'bhit':
          this.bhitSfxT -= 1;
          if (this.bhitSfxT <= 0) { this.audio.hitBuilding(); this.bhitSfxT = 4; }
          this.burst(e.x, 0.6, e.z, { count: 2, color: 0x565349, speed: 1.4, life: 0.3, size: 0.35, up: 1.2 });
          break;
        case 'bdestroyed':
          this.audio.demolish();
          this.audio.faction('townsfolk', 'alert');
          this.burst(e.x, 0.5, e.z, { count: 30, color: 0x7c6a4a, speed: 3, life: 0.8, size: 0.7, up: 2.6 });
          this.shake = Math.max(this.shake, 0.3);
          break;
        case 'infection':
          this.audio.infection();
          this.burst(e.x, 0.5, e.z, { count: 24, color: 0x5fd44a, speed: 2.2, life: 0.8, size: 0.6, up: 2.2 });
          break;
        case 'horde':
          this.audio.alarm();
          this.audio.faction('zombies', 'attack');
          this.shake = Math.max(this.shake, e.final ? 1.2 : 0.6);
          break;
        case 'train': this.audio.train(); break;
        case 'deny': this.audio.deny(); break;
        case 'move': this.audio.click(); break;
        case 'learn': this.audio.train(); break;
        case 'cast': {
          this.audio.cast(e.key);
          const CAST_COLORS = {
            roots: 0x5fae4a, deathpulse: 0x7fdc6a, holy: 0xfff2c8, sunstrike: 0xffb23c,
            whirlwind: 0xd8d2c2, warcry: 0xffd75e, swarm: 0x9c6ede, teleport: 0x7fd6ff,
          };
          const col = CAST_COLORS[e.key] || 0xffe9a8;
          // Expanding shock ring drawn with particles.
          const R = e.radius;
          const n = Math.min(40, Math.round(R * 6));
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            this.burst(e.x + Math.cos(a) * R * 0.85, 0.25, e.z + Math.sin(a) * R * 0.85,
              { count: 1, color: col, speed: 0.5, life: 0.45, size: 0.55, spread: 0.15, up: 1.4 });
          }
          this.burst(e.x, 0.4, e.z, { count: 14, color: col, speed: R * 0.8, life: 0.4, size: 0.5, up: 1.2 });
          this.shake = Math.max(this.shake, 0.18);
          break;
        }
        case 'backstab':
          this.audio.backstab();
          this.burst(e.x, 0.7, e.z, { count: 16, color: 0x9c6ede, speed: 2.4, life: 0.45, size: 0.55, up: 1.8 });
          break;
        case 'stealth':
          this.audio.stealthOn();
          this.burst(e.x, 0.5, e.z, { count: 12, color: 0x8a8f96, speed: 0.8, life: 0.8, size: 0.8, up: 0.8 });
          break;
        case 'ping':
          this.ui.addPing(e.x, e.z);
          break;
        case 'underattack':
          this.audio.underattack();
          this.audio.faction('townsfolk', 'alert');
          break;
        case 'night':
          this.audio.night();
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
        case 'herodown':
          this.audio.herodown();
          this.shake = Math.max(this.shake, 0.5);
          break;
        case 'revive':
          this.audio.revive();
          this.burst(e.x, 0.3, e.z, { count: 24, color: 0x9fd6ff, speed: 1.4, life: 0.8, size: 0.55, up: 2.8 });
          break;
        case 'pickup':
          this.audio.pickup(e.kind);
          this.burst(e.x, 0.4, e.z, { count: 10, color: e.kind === 'gold' ? 0xffd75e : 0xff8a8a, speed: 1.4, life: 0.5, size: 0.45, up: 2 });
          break;
        case 'turret':
          this.audio.build();
          this.burst(e.x, 0.3, e.z, { count: 12, color: 0x8ad6e8, speed: 1.8, life: 0.5, size: 0.5, up: 1.8 });
          break;
        case 'hook': {
          this.audio.hook();
          const steps = 10;
          for (let i = 0; i <= steps; i++) {
            const t2 = i / steps;
            this.burst(lerp(e.fx, e.tx, t2), 0.7, lerp(e.fz, e.tz, t2),
              { count: 2, color: 0xd8d2c2, speed: 0.3, life: 0.35, size: 0.4, spread: 0.05, up: 0.3 });
          }
          this.burst(e.tx, 0.6, e.tz, { count: 10, color: 0x9c1f1f, speed: 2, life: 0.4, size: 0.5, up: 1.5 });
          break;
        }
        case 'whirl':
          this.whirlSfxT = (this.whirlSfxT || 0) - 1;
          if (this.whirlSfxT <= 0) { this.audio.melee(); this.whirlSfxT = 2; }
          for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2;
            this.burst(e.x + Math.cos(a) * e.r * 0.8, 0.5, e.z + Math.sin(a) * e.r * 0.8,
              { count: 1, color: 0xd8d2c2, speed: 1.5, life: 0.3, size: 0.4, spread: 0.1, up: 1 });
          }
          break;
        case 'treants':
          this.burst(e.x, 0.3, e.z, { count: 20, color: 0x5fae4a, speed: 1.8, life: 0.7, size: 0.55, up: 2.2 });
          break;
        case 'turretend':
          this.burst(e.x, 0.3, e.z, { count: 10, color: 0x777777, speed: 1.2, life: 0.6, size: 0.55, up: 1.4 });
          break;
        case 'victory':
          this.audio.victory();
          this.pause();
          this._recordGameEnd(true);
          this.ui.showEnd(true, g.stats, g.day);
          break;
        case 'defeat':
          this.audio.defeat();
          this.shake = 1.5;
          this.pause();
          this._recordGameEnd(false);
          this.ui.showEnd(false, g.stats, g.day);
          break;
      }
    }
    g.events.length = 0;
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    this._updateCamera(dt);

    if (this.game) {
      this._updateHeroInput();
      if (!this.paused && !this.game.over) {
        if (this.netMode) {
          // Host-sequenced lockstep: the host merges every player's commands
          // into numbered windows and broadcasts them; guests advance only
          // as windows arrive, so all sims stay in step.
          const NET_STEP = 3;
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
                this._broadcast({ t: 'w', w, c: bundle });
              } else {
                bundle = this.inbox.get(w);
                if (!bundle) { stalled = true; break; }
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
          this.ui.setWaiting(stalled);
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
      this._syncPlots();
      this._syncBuildings();
      this._syncUnits();
      this._syncPickups();
      this._updateZombieMeshes(t);
      this._updateBars();
      this._updateGhost();
      this._updateDayNight();

      // Ambient groans when the horde is active.
      const aggro = this.game.aggroCount();
      if (aggro > 0 && Math.random() < Math.min(0.02, aggro * 0.0004)) this.audio.groan();

      // Teleport channels: pulse at each channeling hero's destination.
      this.tpFxT = (this.tpFxT || 0) - dt;
      if (this.tpFxT <= 0) {
        this.tpFxT = 0.12;
        for (const hh of this.game.heroes) {
          if (hh.channelT > 0 && hh.tpX != null) {
            this.burst(hh.tpX, 0.2, hh.tpZ, { count: 4, color: 0x7fd6ff, speed: 0.8, life: 0.5, size: 0.6, spread: 0.8, up: 2 });
            this.burst(hh.x, 0.3, hh.z, { count: 2, color: 0x7fd6ff, speed: 0.5, life: 0.4, size: 0.5, spread: 0.4, up: 1.6 });
          }
        }
      }

      // Ability ground zones: ambient particles while active.
      this.fieldFxT = (this.fieldFxT || 0) - dt;
      if (this.fieldFxT <= 0 && this.game.fields.length) {
        this.fieldFxT = 0.12;
        for (const f of this.game.fields) {
          const a = Math.random() * Math.PI * 2;
          const rr = Math.sqrt(Math.random()) * f.r;
          if (f.fx === 'smoke') {
            this.burst(f.x + Math.cos(a) * rr, 0.3, f.z + Math.sin(a) * rr,
              { count: 2, color: 0x8a8f96, speed: 0.25, life: 1.3, size: 1.0, spread: 0.3, up: 0.5 });
          } else {
            this.burst(f.x + Math.cos(a) * rr, 0.15, f.z + Math.sin(a) * rr,
              { count: 2, color: 0xff9a3c, speed: 0.8, life: 0.35, size: 0.45, spread: 0.2, up: 1.4 });
          }
        }
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

      // Animate windmill rotors / flags.
      for (const rec of this.buildingMeshes.values()) {
        const ud = rec.mesh.userData;
        if (ud.rotor) ud.rotor.rotation.z = t * 1.5;
        if (ud.flag) ud.flag.rotation.y = Math.sin(t * 3) * 0.25;
      }

      // Tower range ring when a tower is selected.
      if (!this.buildMode) {
        if (this.selectedBuilding && this.selectedBuilding.key === 'tower' && this.selectedBuilding.alive) {
          const b = this.selectedBuilding;
          this.rangeRing.visible = true;
          this.rangeRing.position.set(b.cx, 0.06, b.cz);
          this.rangeRing.scale.setScalar(b.def.range);
        } else {
          this.rangeRing.visible = false;
        }
      }

      this.ui.update(this.game, this.game.zombies.length);
      this.ui.updateHero(this.game, this.myPlayer);
      this.ui.updateBoss(this.game);
      this.ui.setAutoUI(this.game.autoBuild, this.game.plotMode);
      if (this.focusedPlot?.built) this.focusedPlot = null;
      if (this.game.plotMode && !this.selection.length && !this.selectedBuilding) {
        this.ui.showPlotCommandBar(this.game, this.focusedPlot || this.game.activePlot || null);
      }
      if (this.selection.length) this.ui.showSelection(this.selection, this.game);
      if (this.selectedBuilding) this.ui.showSelection(this.selectedBuilding, this.game);

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
    this.renderer.render(this.scene, this.camera);
  }
}

window.__app = new App(); // exposed for debugging
