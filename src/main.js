// Rendering, input and orchestration — Thronefall-style direct hero control.
import * as THREE from 'three';
import {
  PLOT_KINDS, SIM_DT, MAP_SIZE, FINAL_NIGHT, LEVELS, PAY_RADIUS, DAY_TIME,
} from './config.js';
import { GameMap } from './map.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { AudioSys } from './audio.js';
import { loadAssets, assetClone } from './assets.js';
import { NetSession } from './net.js';
import { OnlineLobby, LORE, TIPS } from './online.js';
import { clamp, lerp } from './utils.js';

const ZMAX = 1700;

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
    this.camDist = 30;
    this.camYaw = Math.PI * 0.25;
    this.shake = 0;

    this.speed = 1;
    this.paused = true;        // starts paused behind the menu
    this.acc = 0;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, gx: 0, gz: 0 };
    this.lastDir = { x: 0, z: 0, s: false };
    this.lastPay = false;       // build key (B) held state, mirrored into the sim
    this.payCoins = [];         // arcing purse-coins in flight (Thronefall build FX)
    this.payTickT = 0;

    this.audio = new AudioSys();
    this.ui = new UI(document.getElementById('ui'), {
      onStart: (d, hero) => {
        if (this.mpRole === 'guest') return; // host launches the match
        const mode = this.ui.selectedMode || 'campaign';
        if (this.mpRole === 'host' && (this.peers.length || this.onlineMode)) {
          const level = this.ui.selectedLevel || 1;
          const heroes = [hero, ...this.peers.map((_, i) => this.guestHeroes[i] || 'scott')];
          this.peers.forEach((p, i) => p.send({ t: 'start', d, heroes, you: i + 1, level, mode }));
          this.startGame(d, null, { heroes, myPlayer: 0, role: 'host', level, mode });
          if (this.lobby && this.lobby.game) this.lobby.touchGame({ status: 'playing' });
        } else {
          this.startGame(d, hero);
        }
      },
      onCast: () => this.tryCast(),
      onBell: () => { this.audio.init(); this.issue({ t: 'bell', p: this.myPlayer }); },
      onRally: (g) => { this.audio.init(); this.issue({ t: 'rally', g, p: this.myPlayer }); },
      onBranch: (id, b) => this.issue({ t: 'choose', id, b, p: this.myPlayer }),
      onSpeed: (s) => this.setSpeed(s),
      onMute: () => { this.audio.setMuted(!this.audio.muted); this.ui.setMuteUI(this.audio.muted); },
      onHost: () => this.hostGame(),
      onJoin: (code) => this.joinGame(code),
      onHostAccept: (code) => this.pendingPeer && this.pendingPeer.acceptReply(code).catch(() => this.ui.mpStatus('❌ Bad reply code.')),
      onAddPeer: () => this._newInvite(),
      onHeroPick: (k) => { if (this.mpRole === 'guest' && this.net && this.net.open) this.net.send({ t: 'hero', k }); },
      onRestart: () => location.reload(),
      onQuit: () => location.reload(),
      onPause: () => this.togglePauseMenu(),
      onResume: () => this.closePauseMenu(),
      onMinimap: () => {}, // camera is locked to the hero
      onContinue: () => this.continueGame(),
      onName: (name) => {
        this.profile.name = name.slice(0, 24);
        this._saveProfile();
        if (this.lobby && this.lobby.connected) this.lobby.setName(this.profile.name);
      },
      onLobbyOpen: () => this._openLobby(),
      onChatSend: (text) => this.lobby && this.lobby.sendChat(text),
      onCreateGame: (visibility) => this.createOnlineGame(visibility),
      onJoinCode: (code) => this.joinByCode(code),
      onAddFriend: async (code) => {
        if (!this.lobby) return;
        const r = await this.lobby.addFriend(code);
        this.ui.showBanner(r.ok ? `🤝 ${r.name} added!` : `❌ ${r.why}`, r.ok ? '' : 'bad', 3000);
        this._renderFriends();
      },
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
    this.pendingPeer = null;
    this.guestHeroes = [];
    this.guestCmdQueues = [];
    this.netMode = false;
    this.outbox = [];
    this.simFrame = 0;
    this.inbox = new Map();
    this.hashes = { local: new Map() };
    this.desynced = false;

    // Profiles & saves (localStorage).
    this.profile = this._loadProfile();
    this.autosaveT = 20;
    window.addEventListener('beforeunload', () => this._autosave(true));

    this.groanAcc = 0;
    this.deathSfxT = 0;
    this.bhitSfxT = 0;
    this.smokeT = 0;
    this.minimapT = 0;

    this.ui.setProfile(this.profile);
    this.ui.setCampaign(this.profile.campaign || 0);
    if (this.profile.lastHero) this.ui.preselectHero(this.profile.lastHero);
    const save = this._loadSave();
    if (save) this.ui.setContinue(save.snap);

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
    const level = LEVELS[(levelId || 1) - 1] || LEVELS[0];
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
    const level = LEVELS[levelId - 1] || LEVELS[0];
    const seed = snap ? snap.seed : level.seed;
    this.map = new GameMap(seed, level.theme);
    const heroKeys = snap ? snap.heroKeys : mp ? mp.heroes : heroKey;
    this.game = new Game(this.map, difficulty, heroKeys, snap, levelId, mode);
    this._wallTiles = null; // wall adjacency cache is per-map
    for (const c of this.payCoins) this.scene.remove(c.mesh);
    this.payCoins = [];
    this.lastPay = false;
    if (!snap && heroKey) { this.profile.lastHero = heroKey; this._saveProfile(); }
    this.myPlayer = mp ? mp.myPlayer : 0;
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
    this.scene.add(this._buildPlaza());
    this.map.drawMinimap(document.getElementById('minimap-base'));
    this.ui.hideStart();
    this.ui.initHUD(this.game, this.myPlayer);
    this.setSpeed(1);
    this.ui.showBanner(mode === 'survival'
      ? `${level.name} — SURVIVAL. The nights never stop. A boss walks every fifth. How long can you last?`
      : `${level.name} — survive ${FINAL_NIGHT} nights. ${level.boss.icon} ${level.boss.name} comes on the last.`, '', 4500);
    const h = this.myHero();
    if (h) this.focus.set(h.x, 0, h.z);
    if (!this.profile.games) this._startTutorial();
  }

  // A cobbled plaza + lanes radiating to the districts — the city looks
  // designed even before anything is built.
  _buildPlaza() {
    const g = new THREE.Group();
    const c = MAP_SIZE / 2;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(7.2, 40),
      new THREE.MeshLambertMaterial({ color: 0x565149 }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(c, 0.015, c);
    disc.receiveShadow = true;
    g.add(disc);
    const laneMat = new THREE.MeshLambertMaterial({ color: 0x51504a });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const lane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 10.5), laneMat);
      lane.rotation.x = -Math.PI / 2;
      lane.rotation.z = -a;
      lane.position.set(c + Math.cos(a) * 10.5, 0.012, c + Math.sin(a) * 10.5);
      g.add(lane);
    }
    return g;
  }

  _startTutorial() {
    const steps = [
      [1.5, '🕹️ WASD moves your hero. Hold SHIFT to sprint.'],
      [7, '💰 Walk to a glowing foundation and HOLD B — your coins build it. Coins appear at dawn — ride through them!'],
      [16, '🌙 The horde comes every night from the red beacons. Build towers and walls on that side!'],
      [30, '🔔 Ready early? Press SPACE to ring the bell and start the night.'],
      [45, '🚩 Press 1 to rally your troops to you. Press 1 again and they hold position.'],
    ];
    this._tut = { steps, i: 0 };
  }

  // ---------------- co-op networking ----------------

  issue(cmd) {
    if (!this.game) return;
    if (!this.netMode) { this.game.exec(cmd); return; }
    if (this.mpRole === 'host') this.outbox.push(cmd);
    else this.net.send({ t: 'cmd', c: cmd });
  }

  _loadProfile() {
    try {
      return { name: '', games: 0, wins: 0, kills: 0, bestDay: 0, lastHero: null, tutorialDone: false, ...JSON.parse(localStorage.getItem('zillions_profile') || '{}') };
    } catch { return { name: '', games: 0, wins: 0, kills: 0, bestDay: 0, lastHero: null }; }
  }

  _saveProfile() {
    try { localStorage.setItem('zillions_profile', JSON.stringify(this.profile)); } catch { /* full/blocked */ }
  }

  _loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem('zillions_save') || 'null');
      return s && s.snap && s.snap.v === 2 ? s : null;
    } catch { return null; }
  }

  // Guests never autosave — the host owns the co-op save.
  _autosave(force = false) {
    if (!this.game || this.game.over || this.mpRole === 'guest') return;
    if (!force && this.paused) return;
    try {
      localStorage.setItem('zillions_save', JSON.stringify({ when: Date.now(), snap: this.game.snapshot() }));
    } catch { /* storage full */ }
  }

  _recordGameEnd(won) {
    const p = this.profile;
    p.games++;
    if (won && this.game.mode !== 'survival') {
      p.wins++;
      p.campaign = Math.max(p.campaign || 0, this.game.levelId);
    }
    if (this.game.mode === 'survival') {
      p.bestSurvival = Math.max(p.bestSurvival || 0, this.game.night - 1);
    }
    p.kills += this.game.stats.kills;
    p.bestDay = Math.max(p.bestDay, Math.min(this.game.night, FINAL_NIGHT));
    p.lastHero = this.ui.selectedHero;
    this._saveProfile();
    try { localStorage.removeItem('zillions_save'); } catch { /* ignore */ }
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
      else this.startGame(m.d, null, { heroes: m.heroes, myPlayer: m.you, role: 'guest', level: m.level, mode: m.mode });
    }
    else if (m.t === 'desync' && !this.desynced) {
      this.desynced = true;
      this.ui.showBanner('⚠️ Games desynced — everyone should refresh and reconnect.', 'bad', 10000);
    }
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
    }
    return h;
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
      onGames: (g) => this.ui.lobbyGames(g, (row) => this.joinOnlineGame(row)),
      onOnline: (map) => { this.ui.lobbyOnline(map.size); this._renderFriends(); },
      onInvite: (inv) => this.ui.showInviteToast(inv, () => this.acceptInvite(inv)),
      onKnock: (sig) => this._onKnock(sig),
      onSignal: (sig) => this._onSignal(sig),
    });
    this.ui.fillLore(LORE, TIPS);
    this.ui.lobbyStatus('Connecting…');
    try {
      const me = await this.lobby.connect(this.profile.name || 'Commander');
      this.ui.lobbySetMe(me);
      this.ui.lobbyChatFill(await this.lobby.loadChat());
      this.lobby.refreshGames();
      await this.lobby.loadFriends();
      this._renderFriends();
    } catch (e) {
      this.ui.lobbyStatus('❌ offline');
      this.ui.showBanner('❌ Lobby unreachable — solo and manual invite codes still work.', 'bad', 6000);
    }
    return this.lobby;
  }

  _renderFriends() {
    if (!this.lobby || !this.lobby.me) return;
    const canInvite = !!(this.lobby.game && this.mpRole === 'host');
    this.ui.lobbyFriends(this.lobby.friends, this.lobby.online, canInvite, (f) => {
      this.lobby.inviteFriend(f.id);
      this.ui.showBanner(`📨 Invite sent to ${f.name}.`, '', 2500);
    });
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
      this.ui.showSetup({ online: game, mode: game.mode });
      this._renderFriends();
    } catch (e) {
      this.ui.showBanner('❌ Could not create the game: ' + e.message, 'bad', 5000);
      this.mpRole = null;
      this.onlineMode = false;
    }
  }

  // Host side of the automatic handshake: a guest knocked — offer them a
  // WebRTC session through the signaling channel.
  async _onKnock(sig) {
    if (this.peers.length >= 2 || this.netMode || !this.onlinePending) return;
    if (this.onlinePending.has(sig.from)) return;
    const peer = new NetSession();
    const idx = this.peers.length;
    peer.onOpen = () => {
      this.peers.push(peer);
      this.guestHeroes.push(null);
      this.guestCmdQueues.push([]);
      this.onlinePending.delete(sig.from);
      peer.send({ t: 'lobby', n: this.peers.length + 1 });
      this.ui.onlineStatus(`🟢 ${this.peers.length + 1} players connected. START when ready.`);
      if (this.lobby.game) this.lobby.touchGame({ players: this.peers.length + 1 });
      this._renderFriends();
    };
    peer.onMessage = (m) => this._onHostMsg(idx, m);
    peer.onClose = () => {
      if (this.netMode && this.game && !this.game.over) {
        this.game.msg(`⚠️ Player ${idx + 2} disconnected — their hero fights on alone.`, 'warn');
      }
    };
    this.onlinePending.set(sig.from, peer);
    try {
      const code = await peer.host();
      this.lobby.signal({ t: 'offer', to: sig.from, sdp: code });
    } catch (e) {
      this.onlinePending.delete(sig.from);
    }
  }

  // Guest side: the host's offer arrived — answer it.
  async _onSignal(sig) {
    if (sig.t === 'offer' && this.mpRole === 'guest') {
      this.net = new NetSession();
      this.net.onOpen = () => {
        this.net.send({ t: 'hero', k: this.ui.selectedHero });
        this.ui.onlineStatus('🟢 Connected! Pick your hero — the host starts the war.');
      };
      this.net.onMessage = (m) => this._onGuestMsg(m);
      this.net.onClose = () => {
        if (this.netMode && this.game && !this.game.over) {
          this.pause();
          this.ui.showBanner('⚠️ Connection to the host was lost.', 'bad', 8000);
        }
      };
      try {
        const reply = await this.net.join(sig.sdp);
        this.lobby.signal({ t: 'answer', to: sig.from, sdp: reply });
      } catch (e) {
        this.ui.onlineStatus('❌ Handshake failed — refresh and try again.');
      }
    } else if (sig.t === 'answer' && this.mpRole === 'host' && this.onlinePending) {
      const peer = this.onlinePending.get(sig.from);
      if (peer) peer.acceptReply(sig.sdp).catch(() => {});
    }
  }

  async joinOnlineGame(row) {
    const lobby = await this._openLobby();
    if (!lobby || !lobby.connected || this.netMode) return;
    this.audio.init();
    this.mpRole = 'guest';
    this.onlineMode = true;
    this.ui.showSetup({ online: row, mode: row.mode });
    this.ui.onlineStatus('🔗 Knocking on the host\'s gate…');
    this.ui.root.querySelector('#s-start').classList.add('disabled');
    await lobby.joinGame(row);
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
      // Hit pulse: a fast, meaty squash on damage.
      const pulse = zb.hitFlash > 0 ? 1 + zb.hitFlash * 1.4 : 1;
      const s = zb.def.scale;
      d.position.set(zb.x, bob, zb.z);
      d.rotation.set(zb.state === 2 ? 0.22 : 0.05, yaw, Math.sin(t * 5 + zb.phase) * 0.06);
      d.scale.set(s * pulse, s * (2 - pulse), s * pulse);
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
    return { hq: 4.2, mill: 3.4, tower: 3.2, camp_militia: 2.2, camp_ranger: 2.2, camp_sniper: 2.2, wall: 1.2 }[kind] || 2.0;
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

  _makePlotGroup(plot) {
    const g = new THREE.Group();
    const kind = PLOT_KINDS[plot.kind];
    if (plot.kind === 'wall') {
      // Rubble stubs along the future rampart; a marker at the gate.
      const stubGeo = new THREE.BoxGeometry(0.55, 0.18, 0.55);
      const stubMat = new THREE.MeshLambertMaterial({ color: 0x4c4a44 });
      for (const [x, z] of plot.tiles) {
        const m = new THREE.Mesh(stubGeo, stubMat);
        m.position.set(x + 0.5, 0.09, z + 0.5);
        m.rotation.y = (x * 7 + z * 13) % 1;
        g.add(m);
      }
      const [gx, gz] = plot.gate;
      const label = this._makeLabelSprite(kind.icon, '');
      label.position.set(gx + 0.5, 2.0, gz + 0.5);
      g.add(label);
      g.userData.label = label;
      g.userData.labelPos = [gx + 0.5, gz + 0.5];
    } else {
      // Stone foundation pad + corner posts + hovering icon.
      const s = plot.size;
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(s + 0.3, 0.14, s + 0.3),
        new THREE.MeshLambertMaterial({ color: 0x55524a }),
      );
      pad.position.set(plot.cx, 0.07, plot.cz);
      pad.receiveShadow = true;
      g.add(pad);
      const postGeo = new THREE.BoxGeometry(0.14, 0.5, 0.14);
      const postMat = new THREE.MeshLambertMaterial({ color: 0x6a6152 });
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const p = new THREE.Mesh(postGeo, postMat);
        p.position.set(plot.cx + dx * s * 0.45, 0.32, plot.cz + dz * s * 0.45);
        g.add(p);
      }
      const label = this._makeLabelSprite(kind.icon, '');
      label.position.set(plot.cx, 2.1, plot.cz);
      g.add(label);
      g.userData.label = label;
      g.userData.labelPos = [plot.cx, plot.cz];
    }

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
    for (const plot of g.plots) {
      let rec = this.plotMeshes.get(plot.id);
      if (!rec) {
        const group = this._makePlotGroup(plot);
        this.scene.add(group);
        rec = { group, tier: -1 };
        this.plotMeshes.set(plot.id, rec);
      }
      const ud = rec.group.userData;
      const nt = g.nextTier(plot);
      const built = plot.tier > 0;
      // Foundation scenery (pad, posts, rubble) hides once something stands here.
      rec.group.children.forEach((ch) => {
        if (ch !== ud.label && ch !== ud.ring && ch !== ud.prog) ch.visible = !built;
      });

      if (!nt) { // fully built & maxed
        ud.label.visible = false;
        ud.ring.visible = false;
        ud.prog.visible = false;
        continue;
      }

      const heroNear = mh && !mh.dead &&
        (mh.x - ud.payPoint[0]) ** 2 + (mh.z - ud.payPoint[1]) ** 2 < 100;
      // Label: icon + cost, only interesting while there's something to buy.
      const wantSub = nt.branch ? 'choose!' : `${Math.max(1, Math.ceil(nt.cost - plot.paid))}`;
      const wantKey = (built ? '⬆' : PLOT_KINDS[plot.kind].icon) + '|' + wantSub;
      // Built plots advertise their upgrade only when you ride close.
      ud.label.visible = !built || heroNear;
      if (ud.label.visible && ud.labelKey !== wantKey) {
        ud.labelKey = wantKey;
        const [lx, lz] = ud.labelPos;
        rec.group.remove(ud.label);
        ud.label = this._makeLabelSprite(built ? '⬆️' : PLOT_KINDS[plot.kind].icon, wantSub);
        ud.label.position.set(lx, built ? 3.1 : 2.1, lz);
        rec.group.add(ud.label);
      }
      if (ud.label.visible) ud.label.position.y = (built ? 3.1 : 2.1) + Math.sin(t * 2 + plot.id) * 0.12;

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
        box(3.6, 1.2, 3.6, 0x45474d, 0, 0.6);
        box(2.5, 1.1, 2.5, 0x393b41, 0, 1.7);
        cyl(0.55, 0.65, 2.2, 0x565a62, 1.15, 1.8, 1.15, 8);
        cone(0.8, 0.9, 0x6e1f1f, 1.15, 3.3, 1.15);
        if (tier >= 2) { cyl(0.55, 0.65, 2.2, 0x565a62, -1.15, 1.8, -1.15, 8); cone(0.8, 0.9, 0x6e1f1f, -1.15, 3.3, -1.15); }
        if (tier >= 3) {
          box(1.6, 1.2, 1.6, 0x4e5058, 0, 2.9);
          cone(1.2, 1.1, 0x8f1f1f, 0, 4.1);
        } else {
          cone(1.7, 1.0, 0x50242a, 0, 2.7, 0);
        }
        box(0.06, 1.8, 0.06, 0x333333, -1.1, 3.3, -1.1);
        const flag = box(0.7, 0.4, 0.02, 0xa8232d, -0.72, 3.9, -1.1);
        g.userData.flag = flag;
        windows(6, 1.0, 1.75);
        break;
      }
      case 'house': {
        if (tier === 1) {
          box(1.3, 0.7, 1.1, 0x6a5c48, 0, 0.35);
          cone(1.0, 0.7, 0x5c3028, 0, 1.05);
        } else if (tier === 2) {
          box(1.5, 1.0, 1.3, 0x6e6050, 0, 0.5);
          cone(1.15, 0.8, 0x5c3028, 0, 1.4);
          box(0.35, 0.5, 0.06, 0x4a4237, 0, 0.25, 0.68);
        } else {
          box(1.6, 1.5, 1.4, 0x746656, 0, 0.75);
          box(1.0, 0.8, 1.0, 0x66584a, 0.5, 1.9, 0.3);
          cone(1.25, 0.9, 0x50242a, 0, 2.0);
          cone(0.8, 0.7, 0x50242a, 0.5, 2.6, 0.3);
        }
        windows(tier + 1, tier >= 3 ? 0.8 : 0.4, 0.72);
        break;
      }
      case 'farm': {
        box(1.9, 0.1, 1.9, 0x463a28, 0, 0.05);
        for (let r = 0; r < 3; r++) box(1.7, 0.16, 0.34, tier >= 2 ? 0x6e8138 : 0x5c6e38, 0, 0.14, -0.6 + r * 0.6);
        if (tier >= 2) { box(0.6, 0.55, 0.6, 0x54473a, 0.65, 0.32, 0.65); cone(0.55, 0.45, 0x5c3028, 0.65, 0.82, 0.65); }
        break;
      }
      case 'mill': {
        cyl(0.5, 0.7, tier >= 2 ? 2.8 : 2.2, 0x6e6a5c, 0, tier >= 2 ? 1.4 : 1.1, 0, 8);
        cone(0.66, 0.7, 0x5c3028, 0, tier >= 2 ? 3.15 : 2.5, 0, 8);
        const rotor = new THREE.Group();
        rotor.position.set(0, tier >= 2 ? 2.7 : 2.1, 0.58);
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
      case 'mine': {
        box(1.9, 0.22, 1.9, 0x5e5442, 0, 0.11);
        box(0.8, 0.8, 0.8, 0x33353a, 0, 0.62);
        box(0.12, 1.8, 0.12, 0x2e3033, -0.45, 1.1, -0.45);
        box(0.12, 1.8, 0.12, 0x2e3033, 0.45, 1.1, -0.45);
        box(1.2, 0.14, 0.5, 0x2e3033, 0, 2.0, -0.45);
        const wheel = cyl(0.34, 0.34, 0.16, 0xf3c53d, 0, 2.0, -0.45, 12);
        wheel.rotation.x = Math.PI / 2;
        g.userData.rotor = wheel;
        if (tier >= 2) box(1.0, 0.5, 0.7, 0x4a4438, 0.55, 0.25, 0.6);
        break;
      }
      case 'tower': {
        const h = 2.2 + tier * 0.45;
        cyl(0.65, 0.85, h, tier >= 3 ? 0x5a5450 : 0x4f5258, 0, h / 2, 0, 8);
        box(1.6, 0.22, 1.6, 0x3f4147, 0, h + 0.11);
        for (const [dx, dz] of [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]]) {
          box(0.2, 0.32, 0.2, 0x3f4147, dx, h + 0.35, dz);
        }
        const head = new THREE.Group();
        head.position.y = h + 0.35;
        if (b.branch === 'flame') {
          const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.28, 0.35, 8), M(0x3a3025));
          head.add(bowl);
          const fire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 6), M(0xff7a2e, 0.9));
          fire.position.y = 0.4;
          head.add(fire);
          g.userData.flame = fire;
        } else {
          const bal = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, b.branch === 'ballista' ? 1.5 : 0.9), M(0x2e3033));
          bal.position.z = 0.1;
          bal.castShadow = true;
          head.add(bal);
          if (b.branch === 'ballista') {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.08), M(0x4a3f30));
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
        const H = tier >= 2 ? 1.3 : 0.95;
        const stone = tier >= 2 ? 0x63615a : 0x585448;
        const capCol = 0x3e3c35;
        if (b.gate) {
          // Gatehouse: two towers flanking the passage, an arch overhead.
          const alongX = nb.e || nb.w; // wall runs east-west → passage runs north-south
          const towH = H + 0.75;
          for (const side of [-1, 1]) {
            const px = alongX ? 0 : side * 0.38, pz = alongX ? side * 0.38 : 0;
            box(alongX ? 0.9 : 0.34, towH, alongX ? 0.34 : 0.9, stone, px, towH / 2, pz);
            box(alongX ? 1.0 : 0.44, 0.16, alongX ? 0.44 : 1.0, capCol, px, towH + 0.08, pz);
          }
          box(alongX ? 0.9 : 0.34, 0.22, alongX ? 0.34 : 0.9, 0x6a5a40, 0, H + 0.35); // lintel
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
        }
        if (!panels.length) box(0.9, H, 0.9, stone, 0, H / 2); // stranded stub (shouldn't happen)
        break;
      }
      case 'camp_militia':
      case 'camp_ranger':
      case 'camp_sniper': {
        const col = b.kind === 'camp_militia' ? 0x3a566e : b.kind === 'camp_ranger' ? 0x4a6e3a : 0x5c4a72;
        cone(1.0, 1.0, 0x6e6250, -0.4, 0.5, -0.3);
        box(1.1, 0.7, 0.8, 0x44464c, 0.5, 0.35, 0.5);
        box(0.06, 1.7, 0.06, 0x333333, 0.9, 1.1, -0.6);
        box(0.55, 0.35, 0.02, col, 0.62, 1.7, -0.6);
        if (tier >= 2) { box(0.8, 0.5, 0.6, 0x3f4147, -0.6, 0.25, 0.7); }
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
    } else if (b.kind.startsWith('camp')) {
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
      addB(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.2), M(0x2e3033)), 0, 0.72, -0.26);       // backpack
      addB(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 6), M(0x4a4d52)), -0.12, 1.0, -0.26);
      addB(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 6), M(0x4a4d52)), 0.12, 1.0, -0.26);
      if (u.key === 'scott') {
        // Stubby double-barrel shotgun + the gravity hammer slung on his back.
        addB(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.46), M(0x1e1f21)), 0.26, 0.62, 0.24);
        addB(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.46), M(0x2b2d31)), 0.26, 0.72, 0.24);
        const haft = addB(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), M(0x3a3228)), -0.28, 0.8, -0.34);
        haft.rotation.z = 0.5;
        const head = addB(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.2), trim), -0.5, 1.05, -0.34);
        head.rotation.z = 0.5;
      } else if (u.key === 'alexander') {
        addB(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.82), M(0x1e1f21)), 0.3, 0.64, 0.26);   // long marksman rifle
      } else {
        addB(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.78), M(0x1e1f21)), 0.28, 0.66, 0.24);   // long rifle
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
        const auraGeo = new THREE.RingGeometry((d.aura.radius - 0.3) / S, d.aura.radius / S, 56);
        auraGeo.rotateX(-Math.PI / 2);
        const aura = new THREE.Mesh(auraGeo, new THREE.MeshBasicMaterial({ color: d.aura.color, transparent: true, opacity: 0.16, depthWrite: false }));
        aura.position.y = 0.05;
        g.add(aura);
        g.userData.aura = aura;
      }
      g.scale.setScalar(1.18);
    } else {
      // Guardsman-style trooper.
      const d = u.def;
      addB(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.62, 8), M(d.color)), 0, 0.45, 0);
      addB(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), M(0xc4a37e)), 0, 0.92, 0);
      addB(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.12, 8), M(d.color)), 0, 1.02, 0);
      addB(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.68), M(0x232426)), 0.2, 0.62, 0.18);
    }
    return g;
  }

  _syncUnits(t) {
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
      // Walk bob + a forward lean while moving — cheap but lively.
      const body = rec.mesh.userData.body;
      if (body) {
        if (u.moving) {
          body.position.y = Math.abs(Math.sin(t * 10 + u.id)) * 0.09;
          body.rotation.x = 0.12;
          body.rotation.z = Math.sin(t * 10 + u.id) * 0.05;
        } else {
          body.position.y = Math.sin(t * 1.8 + u.id) * 0.02;
          body.rotation.x = 0;
          body.rotation.z = 0;
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
          aura.visible = !u.stealth; // veiled heroes hum nothing
          aura.material.opacity = 0.13 + Math.sin(t * 2.2 + u.id) * 0.05;
        }
      }
    }
    for (const [id, rec] of this.unitMeshes) {
      if (!seen.has(id)) { this.scene.remove(rec.mesh); this.unitMeshes.delete(id); }
    }
  }

  // ---------------- wave markers ----------------

  _setWaveMarkers(edges) {
    this._clearWaveMarkers();
    const N = MAP_SIZE;
    const mid = [[N / 2, 4], [N - 4, N / 2], [N / 2, N - 4], [4, N / 2]];
    for (const e of edges) {
      const [x, z] = mid[e];
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

  // ---------------- input ----------------

  _setupInput() {
    const cv = this.canvas;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (!this.game) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (k === ' ') {
        e.preventDefault();
        // Thronefall Space: start the night by day, unleash your special by night.
        if (this.game.phase === 'day' && !this.game.belling) this.issue({ t: 'bell', p: this.myPlayer });
        else this.tryCast();
      }
      else if (k === 'q') this.tryCast();
      else if (k === '1') this.issue({ t: 'rally', g: 'all', p: this.myPlayer });
      else if (k === '2') this.issue({ t: 'rally', g: 'melee', p: this.myPlayer });
      else if (k === '3') this.issue({ t: 'rally', g: 'ranged', p: this.myPlayer });
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
  _updateHeroInput() {
    if (!this.game || this.game.over) return;
    let dx = 0, dz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dz -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dz += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    // Camera-relative: W always runs "up the screen".
    const cos = Math.cos(this.camYaw), sin = Math.sin(this.camYaw);
    const wx = dx * cos - dz * sin;
    const wz = dx * sin + dz * cos;
    const s = this.keys.has('shift');
    const last = this.lastDir;
    if (Math.abs(wx - last.x) > 0.001 || Math.abs(wz - last.z) > 0.001 || s !== last.s) {
      this.lastDir = { x: wx, z: wz, s };
      this.issue({ t: 'hdir', p: this.myPlayer, x: +wx.toFixed(3), z: +wz.toFixed(3), s });
    }
    // Hold B to build (Thronefall press-and-hold, Space is taken by the bell).
    const pay = this.keys.has('b');
    if (pay !== this.lastPay) {
      this.lastPay = pay;
      this.issue({ t: 'pay', p: this.myPlayer, on: pay });
    }
  }

  myHero() { return this.game ? this.game.heroes[this.myPlayer] : null; }

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
    this.ui.showPause(this.netMode, help);
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
  }

  _updateCamera(dt) {
    if (!this.game) {
      // Menu: slow cinematic orbit over the battlefield.
      this.camYaw += dt * 0.05;
      this.focus.set(MAP_SIZE / 2, 0, MAP_SIZE / 2);
      const dist = 55;
      const elev = 0.72;
      this.camera.position.set(
        this.focus.x + Math.sin(this.camYaw) * Math.cos(elev) * dist,
        Math.sin(elev) * dist,
        this.focus.z + Math.cos(this.camYaw) * Math.cos(elev) * dist,
      );
      this.camera.lookAt(this.focus);
      return;
    }
    if (this.keys.has('z')) this.camYaw += dt * 1.6;
    if (this.keys.has('c')) this.camYaw -= dt * 1.6;

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

    this.sun.position.set(this.focus.x + 45, 80, this.focus.z + 25);
    this.sun.target.position.set(this.focus.x, 0, this.focus.z);
  }

  _updateDayNight(dt) {
    const g = this.game;
    // Phase-driven lighting with smooth transitions: bright day, blood dusk
    // in the last seconds, near-black night.
    let want;
    if (g.phase === 'day') want = g.belling ? 0.45 : 1;
    else want = 0.22;
    this._bright = this._bright === undefined ? want : this._bright + (want - this._bright) * (1 - Math.exp(-2.2 * dt));
    const b = this._bright;

    this.sun.intensity = lerp(0.2, 2.3, b);
    this.sun.color.setHSL(0.07, lerp(0.35, 0.42, b), lerp(0.55, 0.8, b));
    this.hemi.intensity = lerp(0.18, 0.75, b);
    this.amb.intensity = lerp(0.5, 0.45, b);
    const sky = new THREE.Color().setHSL(lerp(0.62, 0.08, b * 0.35), lerp(0.5, 0.16, b), lerp(0.05, 0.5, b));
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
    for (const e of g.events) {
      switch (e.type) {
        case 'shot': {
          if (e.kind === 'melee') {
            this.audio.melee();
            this.burst(e.tx, 0.7, e.tz, { count: 8, color: 0xffd27a, speed: 2.4, life: 0.25, size: 0.4, up: 1.4 });
            this.burst(e.tx, 0.6, e.tz, { count: 5, color: 0x9c1f1f, speed: 1.6, life: 0.35, size: 0.4, up: 1.2 });
            break;
          }
          if (e.kind === 'shotgun') {
            // Point-blank thunder: wide muzzle blast + a fan of pellet streaks.
            this.audio.shoot('shotgun');
            this.burst(e.fx, e.fy || 0.9, e.fz, { count: 8, color: 0xffe08a, speed: 1.6, life: 0.12, size: 0.6, spread: 0.25, up: 0.4 });
            const ang = Math.atan2(e.tx - e.fx, e.tz - e.fz);
            for (let p = 0; p < 6; p++) {
              const a = ang + (p - 2.5) * 0.13;
              const d = 0.8 + Math.random() * 0.5;
              this.burst(lerp(e.fx, e.fx + Math.sin(a) * 5, d * 0.2 + 0.3), 0.7, lerp(e.fz, e.fz + Math.cos(a) * 5, d * 0.2 + 0.3),
                { count: 1, color: 0xfff2b0, speed: 0.2, life: 0.1, size: 0.35, spread: 0.05, up: 0 });
            }
            this.burst(e.tx, 0.6, e.tz, { count: 8, color: 0x9c1f1f, speed: 2.2, life: 0.4, size: 0.5, up: 1.5 });
            this.shake = Math.max(this.shake, 0.08);
            break;
          }
          if (e.kind === 'flame') {
            this.audio.shoot('tower');
            this.stream(e.fx, e.fy || 2.6, e.fz, e.tx, 0.5, e.tz, { count: 6, color: 0xff8a3c, size: 0.55, life: 0.3 });
            this.burst(e.tx, 0.5, e.tz, { count: 10, color: 0xff7a2e, speed: 2.2, life: 0.4, size: 0.6, up: 1.6, spread: 1.8 });
            this._towerRecoil(e.fx, e.fz, e.tx, e.tz);
            break;
          }
          this.audio.shoot(e.kind === 'hero' ? 'soldier' : e.kind === 'ballista' ? 'sniper' : e.kind);
          this.burst(e.fx, e.fy || 0.7, e.fz, { count: 3, color: 0xffe08a, speed: 0.8, life: 0.12, size: 0.5, spread: 0.1, up: 0.3 });
          this.burst(e.tx, 0.6, e.tz, { count: 5, color: 0x9c1f1f, speed: 1.6, life: 0.35, size: 0.4, up: 1.2 });
          const steps = 5;
          for (let i = 1; i < steps; i++) {
            const t = i / steps;
            this.burst(lerp(e.fx, e.tx, t), lerp(e.fy || 0.7, 0.6, t), lerp(e.fz, e.tz, t),
              { count: 1, color: 0xfff2b0, speed: 0.1, life: 0.1, size: 0.32, spread: 0.02, up: 0 });
          }
          if (e.kind === 'tower' || e.kind === 'ballista') this._towerRecoil(e.fx, e.fz, e.tx, e.tz);
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
        case 'bell':
          this.audio.bell();
          break;
        case 'dawn':
          this.audio.dawn();
          break;
        case 'nightplan':
          this._setWaveMarkers(e.edges);
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
        case 'night':
          this.audio.night();
          this._clearWaveMarkers();
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
          this.shake = Math.max(this.shake, e.key === 'hammer' ? 0.5 : 0.18);
          break;
        }
        case 'weavehit':
          this.burst(e.x, 0.7, e.z, { count: 8, color: 0x7fd85e, speed: 2.0, life: 0.35, size: 0.5, up: 1.5 });
          this.burst(e.x, 0.6, e.z, { count: 4, color: 0x9c1f1f, speed: 1.4, life: 0.3, size: 0.4, up: 1.2 });
          break;
        case 'grenade': {
          // Lobbed concussion grenade: arc trail, then a dirty knockback blast.
          this.stream(e.fx, 1.0, e.fz, e.tx, 0.3, e.tz, { count: 8, color: 0xd8b45e, size: 0.4, life: 0.3 });
          this.burst(e.tx, 0.4, e.tz, { count: 26, color: 0xffb84d, speed: 3.2, life: 0.5, size: 0.65, up: 2.2, spread: 0.8 });
          this.burst(e.tx, 0.4, e.tz, { count: 16, color: 0x6a6153, speed: 2.4, life: 0.7, size: 0.7, up: 2.6, spread: 1.2 });
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
          this.ui.showEnd(true, g.stats, g.night, g.levelId, g.mode, this.profile.bestSurvival || 0);
          this._recordGameEnd(true);
          break;
        case 'defeat':
          this.audio.defeat();
          this.shake = 1.5;
          this.pause();
          this.ui.showEnd(false, g.stats, g.night, g.levelId, g.mode, this.profile.bestSurvival || 0);
          this._recordGameEnd(false);
          break;
      }
    }
    g.events.length = 0;
  }

  // Kick the nearest tower head toward its target with a little recoil.
  _towerRecoil(fx, fz, tx, tz) {
    for (const rec of this.buildingMeshes.values()) {
      if (rec.b.kind !== 'tower') continue;
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
      this._syncBuildings();
      this._syncUnits(t);
      this._syncPlots(t);
      this._updateCoins(t);
      this._updateZombieMeshes(t);
      this._updateBars();
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
      let branchPlot = null;
      if (mh && !mh.dead) {
        for (const plot of this.game.plots) {
          const nt = this.game.nextTier(plot);
          if (!nt || !nt.branch) continue;
          const [px, pz] = this.game.payPoint(plot);
          if ((mh.x - px) ** 2 + (mh.z - pz) ** 2 < (PAY_RADIUS + 1.5) ** 2) { branchPlot = { plot, options: nt.options }; break; }
        }
      }
      this.ui.showBranch(branchPlot);

      // "Hold B" prompt while parked on something fundable by day.
      let hint = null;
      if (mh && !mh.dead && this.game.phase === 'day' && !branchPlot) {
        const target = this.game.buildTargetFor(mh);
        if (target) {
          const { plot, nt } = target;
          const cost = Math.max(1, Math.ceil(nt.cost - plot.paid));
          hint = mh.payHold
            ? (this.game.gold < 1 ? '🪙 Purse empty — collect coins at dawn!' : `🪙 ${cost} to go…`)
            : `Hold <kbd>B</kbd> — ${plot.tier > 0 ? 'upgrade to' : 'build'} <b>${nt.def.name}</b> (${cost}🪙)`;
        }
      }
      this.ui.showBuildHint(hint);

      this.ui.update(this.game, this.myPlayer);
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
    this.renderer.render(this.scene, this.camera);
  }
}

window.__app = new App(); // exposed for debugging
