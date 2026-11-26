import { HitFeedback } from './hit-feedback.js';
import {FriendParty,partyCode} from './friend-party.js';
import {showFriendParty} from './friend-party-ui.js';
import {visibleInFog} from './fog-of-war.js';
import {eventHearingGain, hearingGain} from './audio-distance.js';
import { spellTarget, spellManaCost } from './hero-spells.js';
import { heroAbility, abilityCooldown } from './hero-abilities.js';
import { chapterIdentity, chapterFounder, CHAPTER_LEADERS, leaderAvailable, leaderRecord, recruitmentAllowed } from './chapter.js';
import { COACH_STEPS, QUICK_DEFAULTS, coachAdvance, coachApply, coachComplete, coachStep, freshCoach, leaderHeroKey, normalizeQuickSetup, pauseIntent, randomizeQuickSetup, fittedLabel } from './first-run.js';
import { guestCommand } from './multiplayer-command.js';
import { gateSupports } from './rampart-art-plan.js';
import { terrainOccludesHero, structuresOccludeHero, installHeroOcclusionShell } from './hero-visibility.js';
// Rendering, input and orchestration — Thronefall-style direct hero control.
import * as THREE from 'three';
import { toyMat, SkyGradient, paletteShadow, paletteSkyTop } from './toy-style.js';
import { environmentMaterial } from './environment-art.js';
import { buildColonyStreets, buildFortressBoundary } from './colony-art.js';
import {
  PLOT_KINDS, SIM_DT, MAP_SIZE, LEVELS, levelById, PAY_RADIUS, THREAT, SIEGE, TOWER_PRIORITY,
  ITEMS, BOSS_DROPS, UNITS, TILE, TILE_INFO, LABYRINTH_LEVELS, HEROES, cultureKey,
} from './config.js';
import { setActiveCulture, activeCulture } from './cultures.js';
import { GameMap, setMapKit } from './map.js';
import { surveySite } from './plots.js';
import { Game, runScore, isCompatibleSnapshot } from './game.js';
import { UI } from './ui.js';
import { AudioSys } from './audio.js';
import { loadAssets, loadKitCulture, assetClone, assetPart, hasKit, kitClone, kitMaterials, kitGeometry } from './assets.js';
import { loadMarineKit, marineForUnit, setMarineLod, MARINE_FLAGS } from './marine-assembler.js';
import { NetSession } from './net.js';
import { getSupabaseClient } from './supabase.js';
import {
  admitGuest, clearGuestReady, closeLobby, createLobby, hostStillHere, markStarted, parseShareLocation, publicShareLobby,
  randomShareCode, reapStaleSeats, releaseGuest, seatDisplayName, seatGuest, setSeatReady, shareFailureCopy, shareGuestName, shareHero, shareId, shareLaunchReady, shareMessageId, shareSeatState,
  shareName, shareRoster, shareStartLabel, shareUrl, SHARE_DISCOVER_MS, SHARE_HEARTBEAT_MS, SHARE_LINK_FALLBACK_MS, touchLobby, touchSeatActivity, withSeatHero,
} from './share-link.js';
import { createTabSession } from './tab-session.js';
import { desyncRecovery, roomStartLabel, shareRejoinStep, withinRejoinGrace } from './lobby-reliability.js';
import { createBrowserHub, createRelayHub, createShareRelayPeer, createSupabaseHub, loadShareIceServers, packShareLink, unpackShareLink } from './share-bus.js';
import { OnlineLobby, LORE, TIPS, canRejoinRoom, roomCompatibility, isCustomGame, CLIENT_VERSION, LOBBY_PROTOCOL_VERSION } from './online.js';
import { AuthClient } from './auth.js';
import {
  applyEconomySnapshotToProfile, archiveLegacyOfflineEconomy, buyAuthoritativeItem, equipAuthoritativeItem,
  loadAuthoritativeEconomy, quarantineForAuthoritativeLoad, registerAuthoritativeCharacter,
  sellAuthoritativeItem, unequipAuthoritativeItem, buyCraftMaterial, buyCraftComponent, craftAuthoritative,
} from './economy.js';
import { clamp, lerp } from './utils.js';
import { clearRetry, consumeRetry, storeRetry } from './combat-readability.js';
import { TacticalVisuals } from './tactical-visuals.js';
import { normalizeQualityChoice, probeGpuSignals, resolveGraphics, stepDownTier } from './graphics-quality.js';
import { mergeStaticMeshes } from './static-batch.js';
import { UnitImpostors, cameraFrustum, sphereVisible, combatSilhouette } from './unit-impostors.js';
import { cullInstances, rememberInstances } from './instance-cull.js';
import { mountPerfHud, perfHudWanted } from './perf-hud.js';
import { roomConnectionReadiness, roomLaunchReadiness } from './multiplayer-readiness.js';
import { inboxForMatchStart, matchStartReady } from './multiplayer-windows.js';
import { highestUnlockedLevel, roomLevelEligibility } from './multiplayer-eligibility.js';
import { adaptiveWindowTarget, consecutiveWindowCount, hasConsecutiveWindowBuffer, rememberWindow, stallRecovery } from './multiplayer-pacing.js';
import { FrameGuard, recoverableRestore } from './runtime-guard.js';
import { buildingArtState, unitArtState, unitPose } from './art-state.js';
import { HordeArt, buildShardGeometry } from './horde-art.js';
import { buildUnitModel } from './unit-art.js';
import { buildBuildingMesh } from './building-art.js';
import { MenuVignette } from './menu-vignette.js';
import { loadMeta, awardRun } from './meta.js';
import { buildMatchReport } from './match-report.js';
import { matchReplayPayload, parseSharedMatch, sharedMatchFields } from './match-session.js';
import { accountUpgradeRequest, dailyBoardRequest, dailyScoreRequest, matchResultRequest, matchStartRequest, replayPublishRequest, replayReadRequest } from './backend.js';
import { dropPendingMatch, queuePendingMatch, readPendingMatches, retryableMatchError } from './match-outbox.js';
import { stateHash } from './lockstep-hash.js';
import {
  PENDING_DAILY_KEY, acceptDailyBoardPaint, acceptableDay, buildDailyReplay, dailyChallenge, dailyKey, dailyScore,
  formatDailyStanding,
} from './daily.js';
import {
  buildShareReplay, leaderKey, openReplay, playReplayTo, replayIdFromLocation,
  replayProblem, shareReplayPath,
} from './share-replay.js';
import { persistRunTelemetry } from './run-telemetry.js';
import { loadBinds, loadFeel, saveBinds, saveFeel, resetBinds, actionFor, isHeld, keyLabel, bindKey } from './keybinds.js';
import { pointerOrder, quantizeOrder, castSlot, cameraAxisHeld, impactCue, scaledShake, armHitStop, tickHitStop } from './combat-input.js';
import {
  MMO_CLASSES, makeMmoCharacter, normalizeMmoCharacters, selectedMmoCharacter,
  addMmoCharacter, characterCamp, ensureDeployedLeader, recordMmoInstance, rewireLattice,
} from './mmo-characters.js';
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
const NET_REDUNDANCY = 16;      // ~1s of windows on every packet. Four was shorter than one slow frame.
const NET_SPECTATOR_BUFFER = 1024; // bounded loading backlog (~68 seconds)
const NET_HISTORY = 180;        // ~12s. A 10 FPS guest can still ask for the window it missed.
const NET_PACE_SLOW = 0.94;  // guest sim rate when the bank is running dry
const NET_PACE_FAST = 1.06;  // guest sim rate when the bank is overfull
// Scratch colours for the per-frame sky/light update (no per-frame allocs).
const _tmpColA = new THREE.Color();
const _tmpColB = new THREE.Color();
const _tmpColC = new THREE.Color();
const _tmpColD = new THREE.Color();


// Inverted-hull ink outline for a toy-kit figure: each mesh gets a back-face
// twin pushed out along smoothed normals (so flat-shaded facets don't split).
// Returns the outline meshes so callers can hide them (stealth).
const OUTLINE_GEO = new WeakMap();
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x0e0b10, side: THREE.BackSide });
OUTLINE_MAT.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 inkNormal;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(inkNormal) * 0.045;');
};
function outlineGeometry(geo) {
  let out = OUTLINE_GEO.get(geo);
  if (out) return out;
  out = geo.clone();
  out.userData.kitShared = true;
  const pos = out.attributes.position, nor = out.attributes.normal;
  const acc = new Map();
  const key = (i) => `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const a = acc.get(k) || [0, 0, 0];
    if (nor) { a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i); }
    acc.set(k, a);
  }
  const ink = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const a = acc.get(key(i));
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    ink[i * 3] = a[0] / l; ink[i * 3 + 1] = a[1] / l || 1; ink[i * 3 + 2] = a[2] / l;
  }
  out.setAttribute('inkNormal', new THREE.BufferAttribute(ink, 3));
  OUTLINE_GEO.set(geo, out);
  return out;
}
const OUTLINE_MATS = new Map();
function outlineMaterial(color) {
  const key = color >>> 0;
  let mat = OUTLINE_MATS.get(key);
  if (mat) return mat;
  mat = new THREE.MeshBasicMaterial({ color: key, side: THREE.BackSide });
  mat.onBeforeCompile = OUTLINE_MAT.onBeforeCompile;
  OUTLINE_MATS.set(key, mat);
  return mat;
}
function addInkOutline(root, color = 0x0e0b10) {
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.ink) meshes.push(o); });
  const outs = [];
  const mat = outlineMaterial(color);
  for (const m of meshes) {
    const o = new THREE.Mesh(outlineGeometry(m.geometry), mat);
    o.userData.ink = true;
    o.userData.keepOpacity = true;
    m.add(o);
    outs.push(o);
  }
  return outs;
}

class App {
  constructor() {
    this._bootStart = performance.now();
    this.canvas = document.getElementById('game');
    let savedChoice = null;
    try { savedChoice = localStorage.getItem('zillions_graphics_quality'); } catch { /* storage can be blocked */ }
    const queryChoice = normalizeQualityChoice(new URLSearchParams(location.search).get('quality'));
    const bootChoice = queryChoice || normalizeQualityChoice(savedChoice) || 'auto';
    const bootProbe = bootChoice === 'auto' ? probeGpuSignals() : null;
    const boot = { ...resolveGraphics(bootChoice, bootProbe), probe: bootProbe };
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: boot.preset.antialias,
      powerPreference: boot.tier === 'high' ? 'high-performance' : 'default',
    });
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = boot.preset.shadows;
    // Toy art pass: crisp-edged shadows and NO tone mapping, so a picked hex
    // colour lands on screen as that colour.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 600);
    this.tacticalVisuals = new TacticalVisuals(this.renderer, this.scene, this.camera, boot);
    this.tacticalVisuals.onChange = () => this._applyShadowBudget();
    this.tacticalVisuals.onResize = () => this.resize();
    if (perfHudWanted()) this.perfHud = mountPerfHud();
    this._frustum = new THREE.Frustum();
    this._simTickMs = 0;
    this.focus = new THREE.Vector3(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    this.camDist = 46;           // high, narrow diorama camera (FOV 30)
    this.sky = new SkyGradient();
    this.camYaw = 0;
    this.menuYaw = Math.PI * 0.25;
    this.shake = 0;
    this._hitStop = 0;
    this._hitFeel = { hold: 0, gap: 0 };
    this._presentHold = false;
    this._cameraPinned = true;
    this._attackMoveArmed = false;
    this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

    this.speed = 1;
    this.paused = true;        // starts paused behind the menu
    this.acc = 0;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, gx: 0, gz: 0 };
    this.lastDir = { x: 0, z: 0, s: false };
    // Build and fight are distinct action contexts. Right-click orders the hero.
    // The dodge key funds construction in Build mode and dodges in Fight mode.
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
        if (this.mpRole === 'host' && this._shareLobby && !this._shareLobby.started && this._shareSoloBlocked()) {
          if (!this._shareSoloConfirm) {
            this._shareSoloConfirm = true;
            this.ui.showBanner('Your friend left this lobby. Press Start again to play alone.', '', 6000);
            this._shareSig = '';
            this._renderShareHost();
            return;
          }
        }
        if (this.mpRole === 'host' && (this.peers.length || this.onlineMode || (this._shareLobby && !this._shareLobby.started))) {
          if (this._shareLobby && !this._shareLobby.started && !this._shareCanLaunch()) return;
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
          this._launchPrepared(d, hero, mode, this.peers.length > 0 || !!this.onlineMode);
        } else {
          this._launchPrepared(d, hero, mode, false);
        }
      },
      onCast: (slot = 0) => this.tryCast(slot),
      onControlMode: () => this.toggleControlMode(),
      onBuildHold: (on) => { this.buttonPay = !!on; },
      onRally: (g) => { this.audio.init(); this.issue({ t: 'rally', g, p: this.myPlayer }); },
      onBranch: (id, b) => this.issue({ t: 'choose', id, b, p: this.myPlayer }),
      onSpeed: (s) => this.setSpeed(s),
      onMute: () => { this.audio.setMuted(!this.audio.muted); this.ui.setMuteUI(this.audio.muted); },
      onSettings: (s) => this.applySettings(s),
      onQuality: () => {
        const choice = this.tacticalVisuals.toggleQuality();
        try {
          const cur = JSON.parse(localStorage.getItem('zillions_settings') || '{}');
          localStorage.setItem('zillions_settings', JSON.stringify({ ...cur, quality: choice }));
        } catch { /* storage can be blocked */ }
        this.ui.setQualityUI(choice, this.tacticalVisuals.quality);
      },
      onHost: () => this.hostGame(),
      onJoin: (code) => this.joinGame(code),
      onHostAccept: (code) => this.pendingPeer && this.pendingPeer.acceptReply(code).catch(() => this.ui.mpStatus('❌ Bad reply code.')),
      onAddPeer: () => this._newInvite(),
      onHeroPick: (k) => this._pickHero(k),
      onPartyOpen: () => this._openFriendParty(),
      onChapterSave: (draft) => this._saveChapter(draft),
      onChapterRecruit: (key) => this._recruitChapterLeader(key).catch(() => {}),
      onChapterMission: (level) => this._openCampaignSelect(level),
      onCharacterSelect: (id) => this._selectMmoCharacter(id),
      onCharacterDelete: (id) => this._deleteMmoCharacter(id),
      // The sheet edits the character object the profile owns, so persisting is
      // all that is left to do once it has changed something.
      onProfileDirty: () => this._saveProfile(),
      onMarketBuy: (character, vendorId, offerIndex) => this._marketBuy(character, vendorId, offerIndex),
      onMarketSell: (character, itemIndex) => this._marketSell(character, itemIndex),
      onAuthorityEquip: (character, itemIndex, slot) => this._authorityEquip(character, itemIndex, slot),
      onAuthorityUnequip: (character, slot) => this._authorityUnequip(character, slot),
      onAuthoritySync: (character) => this._ensureAuthoritativeEconomy(character),
      onCraftBuyMaterial: (character, materialId) => this._craftMutation(character, (current) => buyCraftMaterial(current, materialId)),
      onCraftBuyComponent: (character, componentId) => this._craftMutation(character, (current) => buyCraftComponent(current, componentId)),
      onCraftAction: (character, action, itemId, revision, details) => this._craftMutation(character, (current) => craftAuthoritative(current, action, itemId, revision, details)),
      useAuthoritativeEconomy: () => !!this.auth?.isSignedIn(),
      onLatticeRewire: (character) => this._rewireLatticeOnServer(character),
      onKeybindChange: (binds) => this.setBinds(binds),
      onFeelChange: (feel) => this.setFeel(feel),
      onKeybindReset: () => this.resetKeybinds(),
      onCharacterCreate: (draft) => this._createMmoCharacter(draft),
      onCharacterPreview: (style) => this._setCharacterPreview(style),
      onFound: () => this._tryFound(),
      onLocateKeep: () => this._lookAtKeep(),
      onHeroUpgrade: (key) => this.issue({ t: 'heroUpgrade', key, p: this.myPlayer }),
      onBlessing: (i) => this.issue({ t: 'blessing', i, p: this.myPlayer }),
      onBuilder: (c) => this.issue({...c,p:this.myPlayer}),
      onFocusEnemy: (id) => this.issue({t:'focus',p:this.myPlayer,id}),
      onStance: (s) => this.issue({ t: 'stance', s, p: this.myPlayer }),
      onRestart: () => this._restartOrReturn(),
      onRetry: () => this._retryMission(),
      canRetry: (game) => {
        const unlocked = Math.min(LEVELS.length, Number(this.profile?.campaign || 0) + 1);
        return !!this.auth?.isSignedIn() && !this.netMode && game?.mode === 'campaign'
          && Number.isInteger(game?.levelId) && game.levelId >= 1 && game.levelId <= unlocked;
      },
      onQuit: () => location.reload(),
      onPause: () => this.togglePauseMenu(),
      onResume: () => this.closePauseMenu(),
      onContinue: () => this.continueGame(),
      onCampaignMap: () => this._openCampaignSelect(),
      onGuestPlay: () => this._playAsGuest(),
      onDailyOpen: () => this._openDaily(),
      onDailyPlay: () => this._startDaily(),
      onDailySignIn: () => { this._stashDaily(); this._signIn(); },
      onDailyEmail: (email) => { this._stashDaily(); this._signInWithEmail(email); },
      onShareReplay: () => this._shareReplay(),
      onReplayToggle: () => this.setSpeed(0),
      onReplaySpeed: (speed) => this.setSpeed(speed),
      onReplaySeek: (step) => this._seekReplay(step),
      onReplayFollow: () => this._toggleReplayFollow(),
      onReplaySeed: () => this._playReplaySeed(),
      onReplayExit: () => { location.href = '/'; },
      onQuickStart: (draft) => this._quickStart(draft),
      onQuickInvite: (draft) => this._quickStart(draft, { invite: true }),
      onShareInvite: () => this._requestShareInvite(),
      onShareCreate: () => this._openShareLobby(),
      onShareLeave: () => this._leaveShareLink(),
      onShareReady: (ready) => this._setShareReady(ready),
      onQuickRandom: () => this.ui.fillQuickSetup(randomizeQuickSetup()),
      onCoachSkip: () => this._skipCoach(),
      onSignIn: () => this._signIn(),
      onEmailSignIn: (email) => this._signInWithEmail(email),
      onSignOut: () => this._signOut(),
      onOfflineContinue: () => this.ui.setAccount({ ready: true, enabled: false, signedIn: false, reason: 'static', name: this.profile.name }),
      onUsername: (username) => this._claimUsername(username),
      onLobbyOpen: () => this._openLobby(),
      onCustomOpen: () => this._openCustomGames(),
      onCustomRefresh: () => this._openCustomGames(true),
      onCustomCreate: (options) => this.createCustomGame(options),
      onCustomJoin: (room) => this.joinOnlineGame(room),
      onCustomPlay: (map) => this.playArcadeMap(map),
      onChatSend: (text) => this._sendLobbyChat(text),
      onRoomChatSend: (text) => this._sendRoomChat(text, 'room'),
      onGameChatSend: (text) => this._sendGameChat(text),
      onAddFriend: (handle) => this._addFriend(handle),
      onAcceptFriend: (id) => this._acceptFriend(id),
      onRemoveFriend: (id) => this._removeFriend(id),
      onInviteFriend: (userId) => this._inviteFriend(userId),
      onCreateGame: (visibility) => this.createOnlineGame(visibility),
      onJoinCode: (code) => this.joinByCode(code),
      onLevelPick: (id) => { this._updateRoomSettings({ level: id }); this._noteShareSetup(); },
      onDifficultyPick: (difficulty) => { this._updateRoomSettings({ difficulty }); this._noteShareSetup(); },
      onModePick: (m) => this._pickSetupMode(m),
      onRoomReady: (ready) => this._setRoomReady(ready),
      onRoomLeave: () => this._leaveOnlineRoom(),
      onMatchLeave: () => this._leaveOnlineMatch(),
      onRoomReconnect: (userId) => this._retryRoomConnection(userId),
      onRoomRemovePlayer: (userId) => this._removeRoomPlayer(userId),
    });

    this._setupLights();
    this._setupParticles();
    // Horde meshes and GLB kits are the heavy title-time work. Paint the
    // shell first, then build them on the next frame. startGame also calls
    // this, so a fast Play still has meshes before the first zombie draw.
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
    this._cameraPinned = true;
    this._attackMoveArmed = false;
    this.slowFrameT = 0;
    this.autoQualityDropped = false;

    // Profiles & saves. Production identity comes from Supabase; localStorage is only
    // a development/offline mirror.
    this.auth = new AuthClient();
    this.authStatus = { ready: false, enabled: false, signedIn: false };
    const invite=partyCode(location.search);
    if(invite) sessionStorage.setItem('zillions-party-invite',invite);
    this._authenticatedEntryHandled = false;
    this.profile = this._loadProfile();
    this.meta = loadMeta();
    this.profile.metaCurrency = this.meta.currency;
    normalizeMmoCharacters(this.profile);
    const initialCharacter = selectedMmoCharacter(this.profile);
    if (initialCharacter) {
      this.ui.selectedHero = initialCharacter.proxyHero;
      this.profile.lastHero = initialCharacter.proxyHero;
    }
    this.autosaveT = 20;
    window.addEventListener('beforeunload', () => {
      this._autosave(true);
      // A refresh is also an unload. Publishing close/leave here races the
      // next page: the dying page's message can arrive after the resumed
      // lobby and tell the friend the host left. A real close stops the
      // heartbeat, and that silence is what ends the room.
      this._tab?.release();
    });

    this.groanAcc = 0;
    this.deathSfxT = 0;
    this.bhitSfxT = 0;
    this.smokeT = 0;
    this.minimapT = 0;
    this.fogOfWar = null;

    this.ui.setProfile(this.profile);
    this.ui.setKeybinds(this.binds());
    this.ui.setFeel(this.feel());
    this.ui.setQualityUI(this.tacticalVisuals.choice, this.tacticalVisuals.quality);
    // Settings restore: volumes apply inside AudioSys before any sound.
    // The graphics choice lives in its own key. An older settings blob only
    // fills that key when the player has never picked a preset.
    const restored = this._restoreSettings();
    let savedQuality = null;
    try { savedQuality = localStorage.getItem('zillions_graphics_quality'); } catch { /* storage can be blocked */ }
    if (!savedQuality && restored.quality) this.tacticalVisuals.applyQuality(restored.quality);
    if (savedQuality) delete restored.quality;
    this.ui.setQualityUI(this.tacticalVisuals.choice, this.tacticalVisuals.quality);
    this.ui.setSettingsUI(restored);
    this.ui.fillHeroGrid(HEROES);
    // Living hub: connect the lobby quietly in the background so the main
    // menu shows live presence/games/chat before the player clicks PLAY.
    // Failures stay silent — solo play must never feel blocked by the lobby.
    this._hubChatLog = [];
    this._hubChatDirty = false;
    setTimeout(() => {
      if (!this.auth?.isSignedIn()) return;
      this._openLobby().then((l) => {
        if (!l || !l.connected) return;
        l.loadChat().then((rows) => {
          this._hubChatLog = rows || [];
          this.ui.hubChat(this._hubChatLog);
          this.root?.querySelector?.('#hub-panel')?.classList.remove('hidden');
        }).catch(() => {});
      }).catch(() => {});
    }, 1500);
    void getSupabaseClient().then((client) => {
      try { client.realtime?.connect?.(); } catch { /* the invite subscribe connects too */ }
    }).catch(() => {});
    this._consumeShareLink();
    this._bootReplay();
    this.ui.setAccount(this.authStatus);
    this.ui.setCampaign(this.profile.campaign || 0);
    if (this.profile.lastHero) this.ui.preselectHero(this.profile.lastHero);
    const save = this._loadSave();
    if (save) this.ui.setContinue(save.snap);
    this.showLoginBackdrop();
    this._initAuth();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.clock = new THREE.Clock();

    // Traditional menus own startup. The renderer stays parked behind an
    // opaque login/character-select shell until the player enters a world.
    this.scene.background = new THREE.Color(0x030711);
    this.scene.fog.color.setHex(0x030711);
    this.frameGuard = new FrameGuard((error) => this._handleFrameError(error));
    this.renderer.setAnimationLoop(() => this.frameGuard.run(() => this.frame()));
    this._boot = { shellMs: Math.round(performance.now() - this._bootStart) };
    window.__zillionsBoot = this._boot;
    // The coop end-to-end test reads this. It is only installed when that
    // test has pointed the page at its in-process relay.
    if (globalThis.__zillionsShareRelay || globalThis.__zillionsProbeEnabled) {
      globalThis.__zillionsProbe = () => ({
        frame: this.simFrame,
        gold: this.game ? Math.floor(this.game.gold) : null,
        role: this.mpRole,
        net: !!this.netMode,
        barrier: !!this.startBarrier,
        peers: this.peers?.length || 0,
        open: !!(this.net?.open || [...(this._shareHands?.values() || [])].some((peer) => peer.open)),
        code: this._shareCode || '',
        hash: (() => { try { return this.game && !this.startBarrier ? this._stateHash() : null; } catch { return null; } })(),
        hashLog: this._hashLog || [],
        stallMs: this.mpRole === 'guest' && this._stallSince && !this._resyncing ? Math.round(performance.now() - this._stallSince) : 0,
        resyncMs: this._resyncing ? Math.round(performance.now() - (this._resyncStarted || performance.now())) : 0,
        self: this._shareSelf || '',
        roster: this._shareLobby ? shareRoster(this._shareLobby, this._shareSelf) : [],
      });
    }
    requestAnimationFrame(() => this._ensurePresentation());
  }

  // Presentation-only. Safe to call more than once. Never touches the sim.
  _ensurePresentation() {
    if (this._presentationReady) return;
    this._presentationReady = true;
    const started = performance.now();
    this._setupZombieMeshes();
    this._loadArt().catch(() => {});
    this._boot = { ...(this._boot || {}), hordeMs: Math.round(performance.now() - started) };
    window.__zillionsBoot = this._boot;
  }

  // ---------------- title diorama ----------------
  // A real last stand still runs on the surface. The extra geometry makes it
  // read as one small battlefield on a much larger planet under siege.
  showMenuBackdrop(levelId = 1) {
    if (this.game || this.menuTerrain) return;
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

  showLoginBackdrop() {
    if (this.game || this.titleSpace) return;
    this.focus.set(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    this.camera.position.set(MAP_SIZE / 2 + 22, 27, MAP_SIZE / 2 + 35);
    this.camera.lookAt(this.focus);
    this._buildTitleSpace();
  }

  _buildTitleSpace() {
    const group = new THREE.Group();
    group.name = 'planet-edge-title';
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(185, 48, 24),
      toyMat({ color: 0x101923, emissive: 0x07101d, emissiveIntensity: 0.45 }),
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
        const daylight = 0.92 + 0.12 * Math.cos(lon + 0.65) * Math.cos(lat);
        const base = polar ? [214, 230, 238] : land ? [78, 148, 96] : [46, 118, 176];
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
      new THREE.MeshBasicMaterial({ color: 0x8fd4ff, transparent: true, opacity: 0.55, side: THREE.BackSide, depthWrite: false, fog: false }),
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
    orbitalGlobe.position.copy(cameraLocal(18, -36, -210));
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

  // ---------------- mission select ----------------
  // "Enter World" opens the campaign mission select for the selected
  // character. The game is a siege game: every run starts from here.
  _openCampaignSelect(level = null) {
    if (this.game) return;
    if (this.auth?.isSignedIn() && !selectedMmoCharacter(this.profile)) {
      this.ui.showCharacterCreator();
      return;
    }
    this.ui.showSetup({ mode: 'campaign', level });
  }

  _setCharacterPreview(style) {
    const canvas = document.getElementById(style.canvasId || 'creator-preview-canvas');
    if (!canvas) return;
    this.characterPreviews ||= new Map();
    let p = this.characterPreviews.get(canvas.id);
    if (!p || p.canvas !== canvas) {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, .1, 20);
      camera.position.set(2.5, 1.45, 3.4);
      camera.lookAt(0, .65, 0);
      scene.add(new THREE.HemisphereLight(0xcceaff, 0x10141c, 2.2));
      const key = new THREE.DirectionalLight(0xffe2b5, 2.4); key.position.set(3, 4, 4); scene.add(key);
      p = { renderer, scene, camera, canvas, model: null };
      this.characterPreviews.set(canvas.id, p);
    }
    if (p.model) { p.scene.remove(p.model); this._disposeObject3D(p.model); }
    const key = style.proxyHero || 'scott';
    p.model = buildUnitModel({ hero: true, key, def: HEROES[key] || HEROES.scott, characterStyle: style.chapterLeader ? null : style }).node;
    p.model.scale.setScalar(1.45);
    p.model.position.y = -.02;
    p.scene.add(p.model);
  }

  _renderCharacterPreview(t) {
    for (const [id, p] of this.characterPreviews || []) {
      if (!p.canvas.isConnected) { p.renderer.dispose(); this.characterPreviews.delete(id); continue; }
      if (!p.model || p.canvas.offsetParent === null) continue;
      const w = Math.max(1, p.canvas.clientWidth), h = Math.max(1, p.canvas.clientHeight);
      if (p.canvas.width !== Math.round(w * p.renderer.getPixelRatio()) || p.canvas.height !== Math.round(h * p.renderer.getPixelRatio())) {
        p.renderer.setSize(w, h, false); p.camera.aspect = w / h; p.camera.updateProjectionMatrix();
      }
      p.model.rotation.y = Math.sin(t * .55) * .35;
      p.renderer.render(p.scene, p.camera);
    }
  }

  // ---------------- match tickets ----------------
  // A signed-in match starts with a server ticket (api/match-start.js). It
  // carries the match seed every peer runs, the room the match is credited
  // to, and makes the end-of-match report single use. Signed-out play needs
  // no ticket and keeps the fixed seed it always had.
  async _requestMatchTicket({ levelId, mode, difficulty, roomId = null, joinToken = null, manualCoop = false, hero = null }) {
    if (!this.auth?.isSignedIn() || this.mpRole === 'spectator') return null;
    const character = selectedMmoCharacter(this.profile);
    if (!character) return null;
    try {
      return await matchStartRequest({
        characterId: character.id, levelId, mode, difficulty, roomId, joinToken,
        ...(manualCoop ? { manualCoop: { displayName: this._publicName(), hero } } : {}),
      });
    } catch (error) {
      console.warn('match ticket failed', error);
      return { ok: false, error: error?.message || 'match_start_failed' };
    }
  }

  // Co-op host: get the ticket (and, for invite-code games, a private room)
  // BEFORE telling guests to start, so every peer runs the ticket's seed and
  // knows the room id from the first frame — not looked up at match end.
  async _launchHostMatch(d, hero, mode) {
    if (this._shareBeginNeed && !this._shareBeginFinished) {
      this._shareFanBegin();
      this._shareSig = '';
      this._renderShareHost();
      return;
    }
    if (this._hostLaunching) return;
    this._hostLaunching = true;
    try {
      if (this._shareLobby && !this._shareLobby.started && !this._shareCanLaunch()) return;
      const level = this.ui.selectedLevel || 1;
      const lobbyRoom = this.onlineMode && this.lobby?.game ? this.lobby.game.id : null;
      // The server only issues room tickets for a room that is in game.
      if (lobbyRoom) await this.lobby.touchGame({ status: 'playing' }).catch((err) => console.warn('room status failed', err));
      const ticket = await this._requestMatchTicket({ levelId: level, mode, difficulty: d, roomId: lobbyRoom, manualCoop: !lobbyRoom, hero });
      const match = {
        ticket: ticket?.ok ? ticket.ticket : null,
        seed: ticket?.ok ? ticket.seed : null,
        roomId: ticket?.ok ? ticket.roomId : lobbyRoom,
        joinToken: ticket?.ok ? ticket.joinToken || null : null,
        error: ticket && !ticket.ok ? ticket.error : null,
      };
      const shared = { seed: match.seed, roomId: match.roomId, joinToken: match.joinToken };
      const culture = cultureKey(this.ui.selectedCulture);
      const seated = (this._shareLobby?.seats || []).filter((seat) => !seat.host);
      if (seated.length) {
        const missing = seated.filter((seat) => !this.peers.some((peer) => peer.shareId === seat.id && peer.open));
        if (missing.length) {
          const names = missing.map((seat) => seat.name || 'A guest').join(', ');
          this.ui.showBanner(`${names} ${missing.length === 1 ? 'is' : 'are'} not connected. The match will not start without them.`, 'bad', 5200);
          this._shareSig = '';
          this._renderShareHost();
          return;
        }
        const heroes = [{ k: hero, camp: this.campFor(hero) }, ...this.peers.map((_, i) => this.guestHeroes[i] || 'scott')];
        this._shareBeginNeed = new Set(seated.map((seat) => seat.id));
        this._shareBegan = new Set();
        this._shareBeginFinished = false;
        this._shareBeginAt = Date.now();
        this._shareBeginReminded = false;
        this._shareBeginPayload = { d, heroes, level, mode, culture, match: shared };
        this.startExpectedGuests = seated.length;
        this.startReadyGuests.clear();
        this.startBarrier = true;
        this._shareSig = '';
        this._renderShareHost();
        this._shareFanBegin();
        return;
      }
      this._sealShareLobby();
      const heroes = [{ k: hero, camp: this.campFor(hero) }, ...this.peers.map((_, i) => this.guestHeroes[i] || 'scott')];
      this.startExpectedGuests = this.peers.length;
      this.startReadyGuests.clear();
      this.startBarrier = !matchStartReady(this.startExpectedGuests, 0);
      this.peers.forEach((p, i) => p.send({ t: 'start', d, heroes, you: i + 1, level, mode, culture, match: shared }));
      await this.startGame(d, null, { heroes, myPlayer: 0, role: 'host', level, mode, culture, match });
    } finally {
      this._hostLaunching = false;
    }
  }

  // The match fields a host shares with its guests (never its own ticket).
  _sharedMatchFields() { return sharedMatchFields(this._match); }

  _sharedMatch(raw) { return parseSharedMatch(raw); }

  // What this peer needs at match end: ticket, room, the exact hero setups the
  // sim started from, and (for resumed runs) the input log so far.
  _beginMatchRecord({ snap, mp, heroKeys, levelId, mode, difficulty, soloTicket }) {
    const resumed = snap ? this._resumeMatch || null : null;
    this._resumeMatch = null;
    const given = mp?.match || null;
    const match = {
      ticket: resumed?.ticket || given?.ticket || (soloTicket?.ok ? soloTicket.ticket : null),
      seed: resumed?.seed ?? given?.seed ?? (soloTicket?.ok ? soloTicket.seed : null),
      roomId: resumed?.roomId || given?.roomId || null,
      joinToken: resumed?.joinToken || given?.joinToken || null,
      heroes: JSON.parse(JSON.stringify(resumed?.heroes || heroKeys || null)),
      log: resumed?.log || null,
      error: given?.error || (soloTicket && !soloTicket.ok ? soloTicket.error : null),
      ticketPromise: null,
    };
    // Guests (and resumed co-op peers) fetch their own ticket for the room in
    // the background; it is only needed when the match ends.
    if (!match.ticket && match.roomId && mp && mp.role !== 'spectator' && this.auth?.isSignedIn()) {
      match.ticketPromise = this._requestMatchTicket({
        levelId, mode, difficulty, roomId: match.roomId, joinToken: match.joinToken,
      }).then((ticket) => {
        if (ticket?.ok) {
          if (match.seed != null && ticket.seed !== match.seed) console.warn('room seed differs from the host seed');
          match.ticket = ticket.ticket;
        } else match.error = ticket?.error || 'match_start_failed';
        return ticket;
      });
    }
    return match;
  }

  // ---------------- game start ----------------

  async startGame(difficulty, heroKey, mp = null, snap = null) {
    this._seedRun = !!this._startingSeedRun;
    this._startingSeedRun = false;
    this.pendingAbility = null;
    this._keepPeek = null;
    if (snap && !isCompatibleSnapshot(snap)) {
      this.ui.showBanner('This saved siege uses an older colony layout. Start a new siege; account progression is unchanged.', 'bad', 8000);
      return;
    }
    this._finishMissionIntro();
    const deploymentLevel = levelById(snap?.level || mp?.level || this.ui.selectedLevel || 1);
    this.ui.setDeploymentLoading(true, deploymentLevel);
    this._ensurePresentation();
    try {
    // The host can finish startup first and send window zero while this guest
    // is still loading assets. Keep the existing Map alive across every await
    // so early windows are not discarded when the sim is initialized.
    const matchInbox = inboxForMatchStart(mp?.role, this.inbox);
    this.audio.init();
    this._clearMenuBackdrop();
    if (!this.assetsLoaded) {
      this.ui.setDeploymentLoading(true, null, 'Loading expedition assets');
      await this._loadArt();
    }
    const mode = snap ? snap.mode || 'campaign' : mp ? mp.mode || 'campaign' : this.ui.selectedMode || 'campaign';
    const daily = mode === 'daily' ? (this._dailyChallenge || dailyChallenge(dailyKey())) : null;
    const levelId = snap ? snap.level || 1 : daily ? daily.levelId : mp ? mp.level || 1 : this.ui.selectedLevel || 1;
    const level = levelById(levelId);
    const seed = snap ? snap.seed : daily ? daily.mapSeed : level.seed;
    const heroKeys = snap ? snap.heroKeys : daily ? daily.hero : mp ? mp.heroes : { k: heroKey, camp: this.campFor(heroKey) };
    // The base culture: a resumed run keeps its own, a guest takes the host's,
    // a fresh solo/host run uses the setup pick. It sets which army the camps
    // muster (sim) and which kit the base is built from (art).
    const cultureId = cultureKey(daily ? daily.culture : snap ? snap.culture : mp ? mp.culture : this.ui.selectedCulture);
    setActiveCulture(cultureId);
    this.ui.setDeploymentLoading(true, null, 'Loading colony kit');
    await loadKitCulture(cultureId);
    // A seed run uses the shared match seed and does not take a reward ticket.
    const forcedSeed = Number.isInteger(this._forcedSeed) ? this._forcedSeed >>> 0 : null;
    this._forcedSeed = null;
    // Solo signed-in runs fetch their ticket (and match seed) first.
    const soloTicket = !snap && !mp && mode !== 'daily' && forcedSeed == null
      ? await this._requestMatchTicket({ levelId, mode, difficulty })
      : null;
    this._match = this._beginMatchRecord({ snap, mp, heroKeys, levelId, mode, difficulty, soloTicket });
    this.ui.setDeploymentLoading(true, null, 'Preparing terrain and routes');
    this.map = new GameMap(seed, level.theme, { size: level.size, nests: level.nests });
    this.pal = level.theme.palette; // drives sky/fog grading
    const matchSeed = daily ? daily.seed : (forcedSeed != null ? forcedSeed : this._match.seed);
    this.game = new Game(this.map, daily ? 'normal' : difficulty, heroKeys, snap, levelId, mode,
      Number.isInteger(matchSeed) ? { rngSeed: matchSeed, culture: cultureId, ...(daily ? { daily } : {}) } : { culture: cultureId });
    // Every played run keeps an input log so it can be shared. A resumed run
    // continues the log it saved. A resume without one, and a spectator, cannot
    // be replayed from the first step.
    if (mp?.role !== 'spectator') {
      this.game.inputLog = snap ? (this._match.log ? [...this._match.log] : null) : [];
    }
    if (mode !== 'daily' && this.auth?.isSignedIn() && mp?.role !== 'spectator' && !this._match.ticket && !this._match.ticketPromise) {
      this.ui.showBanner(`Rewards are unavailable for this match (${this._match.error || 'no match ticket'}).`, 'bad', 6000);
    }
    this._mountMatchView({ mode, level, snap, mp, heroKey, matchInbox });
    } catch (error) {
      this._finishMissionIntro();
      throw error;
    } finally {
      this.ui.setDeploymentLoading(false);
    }
  }

  // Shared battlefield presentation for a live match and a replay.
  _mountMatchView({ mode, level, snap = null, mp = null, heroKey = null, matchInbox = null, replay = false }) {
    this.slowFrameT = 0;
    this.autoQualityDropped = false;
    this._wallTiles = null; // wall adjacency cache is per-map
    this._gateSupports = null;
    for (const c of this.payCoins) this.scene.remove(c.mesh);
    this.payCoins = [];
    for (const p of this.projectiles) this._destroyProjectile(p);
    this.projectiles = [];
    if (this._projCore) { this._projCore.count = 0; this._projTrail.count = 0; }
    this.zombieAttacks.clear();
    this.lastPay = false;
    this._endExtras = null;
    if (!replay && !snap && heroKey && mode !== 'daily') { this.profile.lastHero = heroKey; this._saveProfile(); }
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
    this._clearWorldMeshes();
    for (const f of this.blockFx) { this.scene.remove(f.mesh); this._disposeObject3D(f.mesh); }
    this.blockFx = [];
    this._blockT = 0;
    this._blockWarned = {};
    // Rejoin/restore can enter startGame without a page reload. A prior
    // landform must not remain above the new map and hide its units.
    if (this.terrain) { this.scene.remove(this.terrain); this._disposeObject3D(this.terrain); }
    this.terrain = this.map.buildTerrain();
    this.scene.add(this.terrain);
    this._rememberCulledProps(this.terrain);
    this._setupFogOfWar();
    // The plaza and city appear where (and when) the city is founded.
    if (this.plaza) { this.scene.remove(this.plaza); this.plaza = null; }
    this._clearSiteMarkers();
    this._clearNestMeshes();
    this._clearLootMeshes();
    this.hitFeedback?.clear();
    if(this._builderMesh){this.scene.remove(this._builderMesh);this._disposeObject3D(this._builderMesh);this._builderMesh=null;}
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
      this.game.mode === 'campaign' && this.mpRole !== 'spectator' ? selectedMmoCharacter(this.profile) : null);
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
    this.ui.showBanner(replay
      ? `${level.name} — replay. Pause, change speed, or scrub. Follow the leader, or fly the camera.`
      : mode === 'daily'
      ? `${level.name} — DAILY SIEGE. Same map, same waves, same modifiers for every commander today.`
      : mode === 'survival'
      ? `${level.name} — SURVIVAL. The siege never stops. A boss walks every fifth surge. How long can you last?`
      : mode === 'labyrinth'
      ? `${level.name} — raze every brood chamber, take its blessing, and kill ${level.boss.icon} ${level.boss.name} at the bottom. ${this.game.lives} lives.`
      : `${level.name} — raze every hive, then break the counterattack. ${level.boss.icon} ${level.boss.name} leads it.`, '', 4500);
    const h = this.myHero();
    if (h) this.focus.set(h.x, 0, h.z);
    const skipIntro = replay || this._skipMissionIntro || (this.profile.games > 0);
    this._skipMissionIntro = false;
    if (!replay && !snap && !mp && mode === 'campaign' && !skipIntro && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.missionIntro = { elapsed: 0, distance: this.camDist };
      this.ui.showMissionIntro(level, () => this._finishMissionIntro());
    }
    if (!replay && !this.profile.games && !this.profile.tutorialDone && this.mpRole !== 'spectator' && mode === 'campaign' && this.game.firstSiege) this._startCoach();
    else if (!replay && !this.profile.games && this.mpRole !== 'spectator' && mode !== 'daily') this._startTutorial();
  }

  _clearWorldMeshes() {
    for (const rec of this.buildingMeshes?.values() || []) {
      this.scene.remove(rec.mesh);
      this._disposeObject3D(rec.mesh);
    }
    this.buildingMeshes?.clear();
    for (const rec of this.unitMeshes?.values() || []) {
      this.scene.remove(rec.mesh);
      this._disposeObject3D(rec.mesh);
    }
    this.unitMeshes?.clear();
    for (const rec of this.plotMeshes?.values() || []) {
      this.scene.remove(rec.group);
      this._disposeObject3D(rec.group);
    }
    this.plotMeshes?.clear();
    this._ghostMat = null;
    this._clearNestMeshes();
    this._clearLootMeshes();
    this._clearSiteMarkers();
    if (this.plaza) { this.scene.remove(this.plaza); this._disposeObject3D(this.plaza); this.plaza = null; }
    for (const p of this.projectiles || []) this._destroyProjectile?.(p);
    this.projectiles = [];
    for (const c of this.payCoins || []) this.scene.remove(c.mesh);
    this.payCoins = [];
    this.coinBorn?.clear();
  }

  _replayClock(steps) {
    const seconds = Math.max(0, Math.round(steps * SIM_DT));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  _replayBarState() {
    const session = this.replay;
    if (!session?.replay) return null;
    const frames = session.replay.frames;
    let note = '';
    if (session.seeking) note = 'Simulating…';
    else if (session.checked) note = session.hashOk
      ? 'Replay matches the recorded result.'
      : 'This replay does not match the recorded result.';
    return {
      paused: !!session.paused,
      seeking: !!session.seeking,
      speed: session.speed,
      frames,
      step: session.step,
      follow: session.follow !== false,
      label: `${this._replayClock(session.step)} / ${this._replayClock(frames)}`,
      note,
    };
  }

  async _bootReplay() {
    const id = replayIdFromLocation(location.pathname, location.search, window.__ZILLIONS_REPLAY__ || '');
    if (!id) return;
    this._replayBoot = id;
    this.ui.showReplayGate('Loading replay…');
    try {
      const result = await replayReadRequest(id);
      if (!result) {
        this.ui.showReplayGate('Replay links need the game server.');
        return;
      }
      if (!result.ok || !result.replay?.log) {
        this.ui.showReplayGate(replayProblem(result));
        return;
      }
      await this.startReplay(result.replay);
    } catch (error) {
      this.ui.showReplayGate(error?.message === 'not_found'
        ? replayProblem({ error: 'not_found' })
        : 'This replay could not be loaded.');
    }
  }

  async startReplay(raw) {
    const opened = openReplay(raw, {
      mapFactory: (mapSeed, theme, opts) => new GameMap(mapSeed, theme, opts),
    });
    if (opened.status !== 'ready') {
      this.ui.showReplayGate(replayProblem(opened));
      return;
    }
    const level = levelById(opened.replay.levelId);
    this.ui.setDeploymentLoading(true, level, 'Loading replay');
    this._finishMissionIntro();
    try {
      this.audio.init();
      this._clearMenuBackdrop();
      if (!this.assetsLoaded) {
        this.ui.setDeploymentLoading(true, null, 'Loading expedition assets');
        await this._loadArt();
      }
      setActiveCulture(cultureKey(opened.replay.culture));
      await loadKitCulture(cultureKey(opened.replay.culture));
      this._match = null;
      this.netMode = false;
      this.mpRole = null;
      this.myPlayer = 0;
      this.paused = false;
      this.map = opened.map;
      this.pal = level.theme.palette;
      this.game = opened.game;
      this.replay = {
        ...opened,
        speed: 1,
        paused: false,
        follow: true,
        acc: 0,
        seeking: false,
        seekTo: 0,
        checked: false,
        hashOk: false,
      };
      this._mountMatchView({ mode: opened.replay.mode, level, replay: true });
      this.ui.hideStart();
      this.ui.showReplayBar(this._replayBarState());
    } catch (error) {
      this.replay = null;
      this.ui.showReplayGate('This replay could not be played.');
      console.warn('replay failed', error);
    } finally {
      this.ui.setDeploymentLoading(false);
    }
  }

  _seekReplay(step) {
    if (!this.replay) return;
    const frames = this.replay.replay.frames;
    this.replay.seekTo = Math.max(0, Math.min(frames, step | 0));
    this.replay.seeking = this.replay.seekTo !== this.replay.step;
    this.replay.checked = false;
    this.ui.setReplayBar(this._replayBarState());
  }

  _toggleReplayFollow() {
    if (!this.replay) return;
    this.replay.follow = !this.replay.follow;
    this.ui.setReplayBar(this._replayBarState());
  }

  _noteReplayEnd() {
    if (!this.replay || this.replay.checked || (this.replay.step < this.replay.replay.frames && !this.game.over)) return;
    this.replay.checked = true;
    this.replay.paused = true;
    this.replay.hashOk = this.replay.step === this.replay.replay.frames && (stateHash(this.game) | 0) === (this.replay.replay.hash | 0);
    this.ui.setReplayBar(this._replayBarState());
  }

  _advanceReplay(dt) {
    const session = this.replay;
    if (!session) return;
    if (session.seeking) {
      const before = session.game;
      const result = playReplayTo(session, session.seekTo, { maxSteps: 240 });
      if (session.game !== before) {
        this.game = session.game;
        this._flushReplayPresentation();
      } else this.game = session.game;
      if (result.done) {
        session.seeking = false;
        session.acc = 0;
        if (session.step >= session.replay.frames || session.game.over) this._noteReplayEnd();
      }
      this.ui.setReplayBar(this._replayBarState());
      return;
    }
    if (session.paused || session.step >= session.replay.frames) {
      if (session.step >= session.replay.frames) this._noteReplayEnd();
      return;
    }
    session.acc += dt * session.speed;
    let guard = 0;
    while (session.acc >= SIM_DT && guard < 64 && session.step < session.replay.frames && !session.game.over) {
      playReplayTo(session, session.step + 1, { maxSteps: 1 });
      this.game = session.game;
      session.acc -= SIM_DT;
      guard++;
    }
    if (session.acc > SIM_DT * 4) session.acc = 0;
    if (session.step >= session.replay.frames || session.game.over) this._noteReplayEnd();
    this.ui.setReplayBar(this._replayBarState());
  }

  _flushReplayPresentation() {
    this._clearWorldMeshes();
    for (const marker of this.nodeMarkers || []) this._disposeObject3D(marker);
    this._clearNodeMarkers();
    this._wallTiles = null;
    this._gateSupports = null;
    if (!this.game || !this.map) return;
    if (this.game.site >= 0) {
      const site = this.map.sites[this.game.site];
      if (site) {
        this.plaza = this._buildPlaza(site.x, site.z);
        this.scene.add(this.plaza);
      }
    } else if (this.game.mode !== 'labyrinth') this._makeSiteMarkers();
  }

  async _shareReplay() {
    const button = this.ui.root.querySelector('#b-share-replay');
    const replay = buildShareReplay(this.game, {
      leaders: this._match?.heroes || this.game?.heroSetups,
      difficulty: this.game?.diffKey,
    });
    if (!replay) {
      this.ui.setReplayShareNote(Array.isArray(this.game?.inputLog)
        ? 'This replay is too large to share.'
        : 'This run has no complete input log to share.');
      return;
    }
    if (button) { button.disabled = true; button.textContent = 'Sharing…'; }
    try {
      const result = await replayPublishRequest(replay);
      if (!result?.id) {
        if (button) { button.disabled = false; button.textContent = 'Share replay'; }
        this.ui.setReplayShareNote('Replay links need the game server.');
        return;
      }
      const url = `${location.origin}${shareReplayPath(result.id)}`;
      let copied = false;
      try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); copied = true; } } catch { copied = false; }
      if (button) button.textContent = copied ? 'Link copied' : 'Share replay';
      this.ui.setReplayShareNote(copied ? url : `Copy this link: ${url}`);
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = 'Share replay'; }
      const code = error?.message || '';
      const text = code === 'rate_limited' ? 'Too many shared replays this hour. Try again later.'
        : code === 'replay_too_large' ? 'This replay is too large to share.'
        : code === 'sim_version_mismatch' ? 'This build cannot share a replay the server would accept.'
        : code === 'replay_not_configured' ? 'Replay storage is not set up on the server yet.'
        : 'The replay could not be shared.';
      this.ui.setReplayShareNote(text);
    }
  }

  async _playReplaySeed() {
    const spec = this.replay?.replay;
    if (!spec) return;
    const hero = leaderKey(spec.leaders[0]);
    this.replay = null;
    this.paused = true;
    this.ui.hideReplayBar();
    this._clearWorldMeshes();
    this._startingSeedRun = true;
    this._forcedSeed = spec.mode === 'daily' ? null : (spec.seed >>> 0);
    this.ui.selectedCulture = spec.culture;
    setActiveCulture(cultureKey(spec.culture));
    this._skipMissionIntro = true;
    try {
      if (spec.mode === 'daily') {
        this.game = null;
        this._dailyChallenge = dailyChallenge(spec.day);
        await this._startDaily(this._dailyChallenge);
        return;
      }
      this.game = null;
      this.ui.selectedMode = spec.mode;
      this.ui.selectedLevel = spec.levelId;
      this.ui.selectedDiff = spec.difficulty;
      this.ui.selectedHero = hero;
      await this.startGame(spec.difficulty, hero);
    } catch (error) {
      this._seedRun = false;
      this.ui.showBanner('That seed could not be started.', 'bad', 4000);
      console.warn('seed run failed', error);
    }
  }

  // Presentation-only arrival. Never runs for network, Watch or restored games.
  _finishMissionIntro() {
    if (this.missionIntro && !this.missionIntro.held) {
      this.camDist = this.missionIntro.distance;
      this.lastDir = { x: 0, z: 0, s: false };
    }
    this.missionIntro = null;
    this.ui?.hideMissionIntro();
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
    const squarePlaza = plan && ['fort', 'keyhole'].includes(plan.key);
    // On a terraced site the pad and walkways are draped over the ground so
    // they follow the steps instead of floating flat over the lower terraces.
    const terraced = !!this.map._tileCH;
    const drape = (mesh, lift) => {
      if (!terraced) return mesh;
      mesh.updateMatrix();
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrix);
      const pa = geo.attributes.position;
      for (let k = 0; k < pa.count; k++) pa.setY(k, this.map.groundY(pa.getX(k), pa.getZ(k)) + lift);
      geo.computeVertexNormals();
      mesh.geometry = geo;
      mesh.position.set(0, 0, 0); mesh.rotation.set(0, 0, 0); mesh.scale.set(1, 1, 1);
      return mesh;
    };
    const disc = new THREE.Mesh(
      squarePlaza ? new THREE.PlaneGeometry(plan?.kit ? 8 : 9.2, plan?.kit ? 8 : 9.2, 24, 24) : new THREE.RingGeometry(0.01, 4.6, 48, 16),
      environmentMaterial(this.game.culture === 'european' ? 'armor' : 'stone', { color: 0xa6a091 }),
    );
    disc.rotation.x = -Math.PI / 2;
    if (squarePlaza && plan.key === 'fort') disc.rotation.z = -plan.facing;
    const plazaY = this.map.groundY(cx, cz);
    disc.position.set(cx, plazaY + 0.015, cz);
    drape(disc, 0.03);
    disc.receiveShadow = true;
    g.add(disc);
    const ringGeo = new THREE.RingGeometry(4.38, 4.58, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0x736d5c, transparent: true, opacity: 0.7, depthWrite: false,
    }));
    ring.position.set(cx, plazaY + 0.03, cz);
    drape(ring, 0.05);
    if (!squarePlaza) g.add(ring);
    else { ring.geometry.dispose(); ring.material.dispose(); }
    const laneMat = environmentMaterial(this.game.culture === 'european' ? 'armor' : 'stone', { color: 0x9e998b });
    // Render the reserved streets, including bent approaches through an inner
    // ward, rather than guessing radial strips from a generic city radius.
    const streets = plan?.streets || (plan?.gates || [0, Math.PI / 2, Math.PI, -Math.PI / 2]).map(a =>
      [[cx, cz], [cx + Math.cos(a) * (plan?.reach || 14), cz + Math.sin(a) * (plan?.reach || 14)]]);
    if (plan?.roads) g.add(buildColonyStreets(this.map, plan.roads, this.game?.culture));
    if (plan?.kit) g.add(buildFortressBoundary(this.map, plan, cx, cz));
    for (const [[ax, az], [bx, bz]] of (plan?.roads ? [] : streets)) {
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const a = Math.atan2(bz - az, bx - ax);
      const lane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, len, 2, terraced ? Math.ceil(len * 3) : 1), laneMat);
      lane.rotation.x = -Math.PI / 2;
      lane.rotation.z = Math.PI / 2 - a;
      lane.position.set((ax + bx) / 2, plazaY + 0.012, (az + bz) / 2);
      lane.receiveShadow = true;
      drape(lane, 0.025);
      g.add(lane);
    }
    // Switchback roads down the cliff face below each gate: a paved ribbon
    // draped over the cut so the zig-zag reads from the game camera.
    const site = (this.map.sites || []).reduce((b, s) => (!b || Math.hypot(s.x - cx, s.z - cz) < Math.hypot(b.x - cx, b.z - cz) ? s : b), null);
    if (terraced && site && site.switchbacks) {
      const ribbon = (pts, w, y, mat) => {
        const P = [];
        for (let q = 1; q < pts.length; q++) {
          const [ax, az, ah] = pts[q - 1], [bx, bz, bh] = pts[q];
          const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L * 3));
          const nx = -(bz - az) / L * w / 2, nz = (bx - ax) / L * w / 2;
          // Overrun each leg by half a width so the turns are filled.
          const ex = (bx - ax) / L * w / 2, ez = (bz - az) / L * w / 2;
          for (let k = 0; k < n; k++) {
            const f0 = k / n, f1 = (k + 1) / n;
            const x0 = ax + (bx - ax) * f0 - (k === 0 ? ex : 0), z0 = az + (bz - az) * f0 - (k === 0 ? ez : 0);
            const x1 = ax + (bx - ax) * f1 + (k === n - 1 ? ex : 0), z1 = az + (bz - az) * f1 + (k === n - 1 ? ez : 0);
            // The road's own grade, lifted onto the ground where the ground
            // swells a little; never climbing onto the rock beside it.
            const h0 = ah + (bh - ah) * f0, h1 = ah + (bh - ah) * f1;
            const v = [[x0 + nx, z0 + nz, h0], [x0 - nx, z0 - nz, h0], [x1 - nx, z1 - nz, h1], [x1 + nx, z1 + nz, h1]];
            for (const idx of [0, 1, 2, 0, 2, 3]) {
              const [vx, vz, vh] = v[idx];
              const gy = this.map.groundY(vx, vz);
              P.push(vx, (gy > vh && gy - vh < 0.25 ? gy : vh) + y, vz);
            }
          }
        }
        // Round landing at every turn (and both ends): a fan of the same
        // half-width, so a hairpin never leaves a wedge of the layer below
        // showing on its outer side.
        const lift = (vx, vz, vh) => { const gy = this.map.groundY(vx, vz); return (gy > vh && gy - vh < 0.25 ? gy : vh) + y; };
        for (let q = 0; q < pts.length; q++) {
          const [cx0, cz0, ch] = pts[q];
          const seg = 14, r = w / 2;
          for (let k = 0; k < seg; k++) {
            const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
            const p0x = cx0 + Math.cos(a0) * r, p0z = cz0 + Math.sin(a0) * r;
            const p1x = cx0 + Math.cos(a1) * r, p1z = cz0 + Math.sin(a1) * r;
            P.push(cx0, lift(cx0, cz0, ch), cz0, p1x, lift(p1x, p1z, ch), p1z, p0x, lift(p0x, p0z, ch), p0z);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, mat);
        // The road never takes the cliff's cast shadow: the cut sits in the
        // lee of the rim on some maps and the zig-zag must still read.
        m.receiveShadow = false;
        return m;
      };
      // Pale packed roadbed between dark kerbs, so the zig-zag reads as a
      // road against snow and violet moor alike; a lamp post at every turn
      // and along the long legs marks the way up from the default camera.
      // Stacked ribbons a few cm apart z-fight from the game camera; a
      // polygon offset keeps the kerb strictly under the bed and the bed
      // under the centre line.
      const layer = (color, o) => toyMat({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: o, polygonOffsetUnits: o * 4 });
      // Graphite edges separate the pale roadbed from both snow and moor;
      // amber tread bands identify the graded route at normal play zoom.
      const edgeMat = layer(0x514c55, -1);
      const roadMat = environmentMaterial(this.game.culture === 'european' ? 'armor' : 'stone', { color: 0xb0a99b, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -12 });
      const centreMat = layer(plan?.kit ? 0xb5b0a2 : 0xc5b078, -5);
      const posts = [];
      for (const pts of site.switchbacks) {
        const entrance = pts.reduce((low, p) => p[2] < low[2] ? p : low, pts[0]);
        const marker = this._makeLabelSprite('↗', 'RAMP');
        marker.position.set(entrance[0], entrance[2] + 1.3, entrance[1]);
        g.add(marker);
        g.add(ribbon(pts, 1.85, 0.04, edgeMat));
        g.add(ribbon(pts, 1.55, 0.06, roadMat));
        // Broad transverse tread bands make the grade and each turn readable
        // at play zoom. These are paint, not extra collision obstacles.
        for (let q = 1; q < pts.length; q++) {
          const [ax, az, ah] = pts[q - 1], [bx, bz, bh] = pts[q];
          const L = Math.hypot(bx - ax, bz - az);
          if (L < 0.1) continue;
          const nx = -(bz - az) / L, nz = (bx - ax) / L;
          for (let d = 0.65; d < L - 0.3; d += 1.65) {
            const f = d / L, x = ax + (bx - ax) * f, z = az + (bz - az) * f, h = ah + (bh - ah) * f;
            g.add(ribbon([[x - nx * 0.55, z - nz * 0.55, h], [x + nx * 0.55, z + nz * 0.55, h]], 0.16, 0.08, centreMat));
          }
        }
        for (let q = 1; q < pts.length; q++) {
          const [ax, az, ah] = pts[q - 1], [bx, bz, bh] = pts[q];
          const L = Math.hypot(bx - ax, bz - az);
          const nx = -(bz - az) / L, nz = (bx - ax) / L;
          const n = Math.max(1, Math.round(L / 2.2));
          for (let k = q === 1 ? 0 : 1; k <= n; k++) {
            const f = k / n;
            const px = ax + (bx - ax) * f, pz = az + (bz - az) * f, ph = ah + (bh - ah) * f;
            for (const side of [-1, 1]) posts.push([px + nx * 1.15 * side, pz + nz * 1.15 * side, ph, k === n || k === 0]);
          }
        }
      }
      if (posts.length) {
        const postGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.7, 5).translate(0, 0.35, 0);
        const capGeo = new THREE.OctahedronGeometry(0.11, 0).translate(0, 0.78, 0);
        const postMesh = new THREE.InstancedMesh(postGeo, toyMat({ color: 0x2f2a33 }), posts.length);
        const capMesh = new THREE.InstancedMesh(capGeo, new THREE.MeshBasicMaterial({ color: 0xffc35a }), posts.length);
        const M = new THREE.Matrix4();
        posts.forEach(([px, pz, ph, turn], k) => {
          const gy = this.map.groundY(px, pz);
          const y = Math.abs(gy - ph) < 0.6 ? Math.max(gy, ph) : ph;
          const sc = turn ? 1.3 : 1;
          M.makeScale(sc, sc, sc).setPosition(px, y, pz);
          postMesh.setMatrixAt(k, M);
          capMesh.setMatrixAt(k, M);
        });
        postMesh.castShadow = true;
        g.add(postMesh);
        g.add(capMesh);
      }
    }
    mergeStaticMeshes(g);
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
      const ox = 2.6;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6.4, 6), toyMat({ color: 0x3a3228 }));
      pole.position.set(s.x + ox, 3.2, s.z);
      gr.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.05), toyMat({ color: 0xc9a44a }));
      flag.position.set(s.x + ox + 0.85, 5.8, s.z);
      gr.add(flag);
      gr.userData.flag = flag;
      const label = this._makeLabelSprite('🏳️', (s.name || `SITE ${i + 1}`).toUpperCase());
      label.position.set(s.x + ox, 7.6, s.z);
      label.scale.set(4.2, 2.1, 1);
      gr.add(label);
      gr.position.y = this.map.groundY(s.x, s.z);
      for (const path of s.switchbacks || []) {
        const entrance = path.reduce((low, p) => p[2] < low[2] ? p : low, path[0]);
        const marker = this._makeLabelSprite('↗', 'RAMP');
        marker.position.set(entrance[0], entrance[2] + 1.3 - gr.position.y, entrance[1]);
        gr.add(marker);
      }
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
      const hint = s.switchbacks?.length ? 'Raised site — enter by the marked switchback ramps. ' : (s.kind === 'crossroads' && pct >= 30) ? '' : `${s.hint || ''} `;
      const siteName = s.name || `Site ${i + 1}`;
      this.ui.showLocationBanner(
        `🏳️ ${siteName}`,
        `${hint}${wall} A ${survey.plan.label} would stand here · ${keyLabel(this.binds().build)} to found the city`,
        5600,
      );
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
    const mat = (c, e = 0) => toyMat({ color: c, emissive: e ? c : 0x000000, emissiveIntensity: e });
    const HIDE = 0x3a2a4a, HIDE2 = 0x2c2038, VEIN = 0xb44dff, SAC = 0x8a5cc0, EARTH = 0x2e2433;

    // Churned dead-earth ring.
    const ringGeo = new THREE.CircleGeometry(3.1, 20);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, toyMat({ color: EARTH, transparent: true, opacity: 0.85, depthWrite: false }));
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
          toyMat({ color: 0xffd75e, emissive: 0xa8791a, emissiveIntensity: 0.6 }),
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
    this._payPressUsed = true; // Founding consumes this press; release before buying an upgrade.
    this.issue({ t: 'found', s: best, p: this.myPlayer });
  }

  _startCoach() {
    this._coach = freshCoach();
    this._coachPaintKey = null;
    this._coachOrigin = null;
    this._coachSawAttack = false;
    this._paintCoach();
  }

  _noteCoach(event) {
    if (!this._coach) return;
    this._coach = coachAdvance(this._coach, event);
    this._paintCoach();
  }

  _paintCoach() {
    if (!this._coach || coachComplete(this._coach)) {
      if (this._coach && coachComplete(this._coach)) {
        this.profile.tutorialDone = true;
        this._saveProfile();
      }
      this._coach = null;
      this.ui.hideCoach();
      return;
    }
    const binds = this.binds();
    const labels = Object.fromEntries(Object.entries({ build: 'build', defend: 'stance_defend',
      push: 'stance_push', north: 'move_up', west: 'move_left', south: 'move_down', east: 'move_right',
      mode: 'build_mode', ability: 'ability1', ability2: 'ability2', ability3: 'ability3', ability4: 'ability4',
      center: 'camera_center' }).map(([label, action]) => [label, keyLabel(binds[action])]));
    const step = coachStep(this._coach, labels);
    const siege = this.game?.firstSiege;
    if (['stances', 'attack', 'victory'].includes(step.id)) {
      if (siege?.stage === 'warning') step.title += ` · ${Math.max(0, Math.ceil(this.game.nests[siege.nestId]?.musterT || 0))}s`;
      if (siege?.stage === 'defend') step.title += ` · ${siege.waveIds.length} left`;
    }
    this.ui.setCoach(step, this._coach.index, COACH_STEPS.length);
  }

  _skipCoach() {
    this._coach = null;
    this.profile.tutorialDone = true;
    this._saveProfile();
    this.ui.hideCoach();
  }

  _startTutorial() {
    const binds = this.binds();
    const build = keyLabel(binds.build);
    const push = keyLabel(binds.stance_push);
    const tower = keyLabel(binds.tower_priority);
    const steps = [
      [1.5, '🕹️ Right-click the ground to move. Right-click an enemy to attack. Hold SHIFT to sprint.'],
      [5, `🏳️ This land is unclaimed! Ride to a flagged site and press ${build} to found your city.`],
      [14, `💰 Walk to a glowing foundation and HOLD ${build} — your coins build it.`],
      [24, `⚔️ Every gate is a ward: towers to hold it and a camp to muster at it. Press ${push} and those squads push out along the lanes on their own.`],
      [30, '🧱 Crag, water and deep wood are already wall — you only pay for the gaps. Out on the approaches, a fence across a pass costs almost nothing and funnels them into your tower.'],
      [36, '🚩 Stand on a lane node with no enemies nearby to take it. Held nodes pay you and let you raise a Forward Camp.'],
      [48, '🔥 Every hive keeps mustering until you raze it. Raze them all, then break the counterattack.'],
      [62, `🔧 Damage repairs before upgrades — hold ${build} to restore health. Press ${tower} beside a tower to change what it shoots.`],
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
      // Auth emits USER_UPDATED while chapter/roster writes are in flight.
      // An older hydration must not replace the founder/companion being saved.
      if (this._chapterSaving || this._founderCreating || this._chapterRecruiting) return;
      await this.auth.ensureProfile(this.profile);
      const cloud = this.auth.profileFromBundle(await this.auth.loadProfileBundle());
      if (this._chapterSaving || this._founderCreating || this._chapterRecruiting) return;
      if (cloud) {
        this.profile = { ...this.profile, ...cloud, name: cloud.name || this.profile.name };
      }
      normalizeMmoCharacters(this.profile);
      for (const entry of this.profile.mmoCharacters || []) quarantineForAuthoritativeLoad(entry);
      const character = selectedMmoCharacter(this.profile);
      if (character) {
        this.ui.selectedHero = character.proxyHero;
        this.profile.lastHero = character.proxyHero;
        try { await this._ensureAuthoritativeEconomy(character, { persistProfile: false }); }
        catch { this.ui.showBanner('Online inventory is unavailable. Legacy gear remains archived and no changes were made.', 'bad', 3200); }
      }
      // Claim any match the server never confirmed (closed tab, offline).
      this._flushPendingMatches().catch((err) => console.warn('pending match flush failed', err));
      this._flushPendingDaily().catch((err) => console.warn('pending daily flush failed', err));
      this._syncAccountUpgrades().catch((err) => console.warn('account upgrade sync failed', err));
      // Auth events are read/hydration boundaries. Persisting account metadata
      // here calls auth.updateUser(), which emits another auth event and used
      // to recurse until Supabase rate-limited /auth/v1/user.
      this._storeProfileLocally();
      this.ui.setProfile(this.profile);
      this.ui.setCampaign(this.profile.campaign || 0);
      if (this.profile.lastHero) this.ui.preselectHero(this.profile.lastHero);
      const cloudSave = await this.auth.loadLatestSave();
      if (cloudSave?.snap) {
        try { localStorage.setItem('zillions_save', JSON.stringify(cloudSave)); } catch { /* ignore */ }
        const compatible = this._loadSave();
        this.ui.setContinue(compatible?.snap || null);
      }
    } else if (status.enabled) {
      document.querySelector('#friend-party-dialog')?.close();
      this.lobby = null;
      this._authenticatedEntryHandled = false;
    }
    this.authStatus = this.auth.status({ error: status.error, reason: status.reason });
    this.ui.setAccount(this.authStatus);
    // A shared replay owns the screen. Account hydration above still ran.
    if (this._replayBoot) return;
    if (status.signedIn && !status.needsUsername) {
      const character = selectedMmoCharacter(this.profile);
      const retry = consumeRetry(sessionStorage, {
        allowedHeroes: character?.proxyHero ? [character.proxyHero] : [],
        maxLevel: Math.min(LEVELS.length, Number(this.profile?.campaign || 0) + 1),
      });
      if (retry) {
        this._authenticatedEntryHandled = true;
        this.ui._accountAccepted = true;
        this.ui.selectedLevel = retry.level;
        this.ui.selectedMode = 'campaign';
        setTimeout(() => this.startGame(retry.difficulty || 'normal', retry.hero), 0);
        return;
      }
    } else clearRetry(sessionStorage);
    if (status.signedIn && sessionStorage.getItem('zillions-return-to-world') === '1') {
      sessionStorage.removeItem('zillions-return-to-world');
      // Returning from a finished run: straight back to mission select.
      // No character yet (created mid-session edge)? Land on the roster,
      // one click from making one — never a dead title screen.
      const returning = selectedMmoCharacter(this.profile);
      this._authenticatedEntryHandled = true;
      this.ui._accountAccepted = true;
      if (returning) setTimeout(() => this.ui._showScreen('main'), 0);
      else setTimeout(() => this.ui.showCharacterCreator(), 0);
      return;
    }
    // WoW grammar: authentication ends at Character Select. The player chooses
    // who enters; the generic signed-out title never doubles as account home.
    if (status.signedIn && !status.needsUsername && !this._authenticatedEntryHandled
      && this._guestSession && !this._quickCommitted && !selectedMmoCharacter(this.profile)
      && this.ui._lastScreen === 'quick') {
      this._authenticatedEntryHandled = true;
      return;
    }
    if (status.signedIn && !status.needsUsername && !this._authenticatedEntryHandled) {
      this._authenticatedEntryHandled = true;
      this.ui._accountAccepted = true;
      if (selectedMmoCharacter(this.profile)) setTimeout(() => {this.ui._showScreen('main');if(sessionStorage.getItem('zillions-party-invite'))this._openFriendParty();}, 0);
      else setTimeout(() => this.ui.showCharacterCreator(), 0);
    }
  }

  _restartOrReturn() {
    // Any campaign run that belongs to a character returns to mission
    // select, not the title screen.
    if (this.game?.over && this.game.mode === 'campaign' && selectedMmoCharacter(this.profile)) {
      try { sessionStorage.setItem('zillions-return-to-world', '1'); } catch { /* blocked storage */ }
      this.ui.shell.finishMission();
    }
    location.reload();
  }

  _retryMission() {
    if (!this.auth?.isSignedIn() || !this.game?.over || this.game.mode !== 'campaign' || this.netMode) {
      clearRetry(sessionStorage);
      return this._restartOrReturn();
    }
    const character = selectedMmoCharacter(this.profile);
    const unlocked = Math.min(LEVELS.length, Number(this.profile?.campaign || 0) + 1);
    if (!character?.proxyHero || this.ui.selectedHero !== character.proxyHero
      || !Number.isInteger(this.game.levelId) || this.game.levelId < 1 || this.game.levelId > unlocked) {
      clearRetry(sessionStorage);
      return this._restartOrReturn();
    }
    // Preserve the exact mission setup across the clean reload. Startup already
    // owns authentication/profile hydration; the retry marker is consumed once
    // that entry path is ready instead of trying to reuse stale scene state.
    const stored = storeRetry(sessionStorage, {
      difficulty: this.game.diffKey, hero: this.ui.selectedHero,
      level: this.game.levelId, mode: this.game.mode,
    });
    if (stored) location.reload();
    else this._restartOrReturn();
  }

  async _signIn() {
    try {
      this.audio.init();
      await this.auth.signInWithGoogle();
    } catch (err) {
      this.ui.setAccount({ ...this.auth.status(), error: err.message || 'Google sign-in failed.' });
    }
  }

  async _signInWithEmail(email) {
    try {
      this.audio.init();
      const address = await this.auth.signInWithEmail(email);
      this.ui.showBanner(`Check ${address} for your secure sign-in link.`, '', 8000);
      const status = this.ui.root.querySelector('#account-status');
      if (status) status.textContent = 'Sign-in link sent. Check your email to continue.';
    } catch (error) {
      this.ui.showBanner(`Sign-in failed: ${error.message}`, 'bad', 6000);
    } finally {
      this.ui._clearBusy();
    }
  }

  async _signOut() {
    try {
      this._authenticatedEntryHandled = false;
      await this.auth.signOut();
      await this._applyAuth(this.auth.status());
    } catch (err) {
      this.ui.showBanner(err.message || 'Could not log out. Try again.', 'bad', 3600);
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
    if (this.replay) return;
    if (!this.game || this.missionIntro) return;
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

  async _saveChapter(draft) {
    if (this.game || this._chapterSaving) return;
    const chapter = chapterIdentity({ ...draft, founderId: chapterFounder(this.profile)?.id });
    if (!chapter.name) { this.ui.showBanner('Give your chapter a name.', 'bad', 2500); return; }
    this._chapterSaving = true;
    try {
      this.profile.chapter = chapter;
      const founder = chapterFounder(this.profile);
      if (founder && this.auth?.isSignedIn()) await this._ensureAuthoritativeEconomy(founder, { persistProfile: false });
      this._storeProfileLocally();
      if (this.auth?.isSignedIn()) await this.auth.syncLocalProfile(this.profile);
      this.ui.setProfile(this.profile);
      this.ui._showScreen('main');
      if (!chapterFounder(this.profile)) this.ui.showCharacterCreator();
      else this.ui.showBanner(`${chapter.name} is ready. Choose your next conquest.`, '', 3000);
    } catch (err) {
      this.ui.showBanner('Chapter could not sync. Your changes are kept here; save again to retry.', 'bad', 5000);
    } finally {
      this._chapterSaving = false;
      this.ui._clearBusy();
    }
  }

  async _recruitChapterLeader(key, { persist = true } = {}) {
    if (this.game || this._chapterRecruiting) return;
    if (!(leaderRecord(this.profile,key) ? leaderAvailable(this.profile,key) : recruitmentAllowed(this.profile,key))) { this.ui.showBanner('This recruit needs a compatible chapter culture and the required conquest.', 'bad', 3000); return; }
    this._chapterRecruiting = true;
    try {
      let character = leaderRecord(this.profile, key);
      if (!character) {
        const leader = CHAPTER_LEADERS.find(l => l.key === key);
        character = makeMmoCharacter(HEROES[key].name, leader.classKey, chapterIdentity(this.profile.chapter).color);
        character.id = `chapter_${key}_v1`;
        character.chapterLeader = key;
        character.proxyHero = key;
        character.firstHourGuideDismissed = true;
        if (!addMmoCharacter(this.profile, character)) throw new Error('roster_full');
      }
      this.profile.mmoCharacterId = character.id;
      this.profile.lastHero = character.proxyHero;
      this.ui.selectedHero = character.proxyHero;
      if (this.auth?.isSignedIn()) await this._ensureAuthoritativeEconomy(character, { persistProfile: false });
      if (persist) {
        this._storeProfileLocally();
        if (this.auth?.isSignedIn()) await this.auth.syncLocalProfile(this.profile);
        this.ui.setProfile(this.profile);
      }
      return character;
    } catch (err) {
      this.ui.showBanner(err?.message === 'roster_full' ? 'The roster is full. Your existing leaders and equipment have been preserved.' : 'Recruitment could not sync. Select this leader again to retry.', 'bad', 5000);
      throw err;
    } finally { this._chapterRecruiting = false; }
  }

  async _selectMmoCharacter(id) {
    normalizeMmoCharacters(this.profile);
    const character = this.profile.mmoCharacters.find((entry) => entry.id === id);
    if (!character) return;
    if (character.chapterLeader && !leaderAvailable(this.profile, character.chapterLeader)) return;
    this.profile.mmoCharacterId = character.id;
    this.profile.lastHero = character.proxyHero;
    this.ui.selectedHero = character.proxyHero;
    if (this.auth?.isSignedIn() && !Number.isFinite(character.authoritativeBalance)) {
      try { await this._ensureAuthoritativeEconomy(character); }
      catch {
        this.ui.showBanner('Online inventory is unavailable. This character is using no persistent gear.', 'bad', 3000);
      }
    }
    this._saveProfile();
    this.ui.setProfile(this.profile);
  }

  _playAsGuest() {
    this.audio.init();
    const signedIn = !!this.auth?.isSignedIn() && !this.auth.status().needsUsername;
    if (!signedIn) {
      this._guestSession = true;
      this.ui.noteGuestSession();
    }
    const returning = !!(chapterFounder(this.profile) || this.profile.quickSetupDone);
    this.ui._accountAccepted = true;
    if (returning) {
      this.ui._showScreen('main');
      return;
    }
    this.ui.showQuickSetup(normalizeQuickSetup({
      chapterName: this.profile.chapter?.name || QUICK_DEFAULTS.chapterName,
      founderName: QUICK_DEFAULTS.founderName,
      army: this.ui.selectedCulture,
      color: this.profile.chapter?.color,
      emblem: this.profile.chapter?.emblem,
    }));
  }

  async _quickStart(raw, { invite = false } = {}) {
    if (this.game || this._quickCommitted) return;
    const draft = normalizeQuickSetup(raw);
    this._quickCommitted = true;
    this.ui.selectedCulture = draft.army;
    this.ui.selectedDiff = draft.difficulty;
    this.ui._diffPicked = true;
    this.ui.selectedMode = 'campaign';
    this.ui.selectedLevel = Math.min(LEVELS.length, Math.max(1, Number(this.profile.campaign || 0) + 1));
    try { localStorage.setItem('zillions.culture', draft.army); } catch { /* private mode */ }
    try {
      if (!chapterIdentity(this.profile.chapter).name) {
        this.profile.chapter = chapterIdentity({ ...this.profile.chapter, name: draft.chapterName, color: draft.color, emblem: draft.emblem });
      }
      if (!chapterFounder(this.profile)) {
        await this._createMmoCharacter({ name: draft.founderName, appearance: draft.color, raceKey: 'human', customization: {}, quiet: true });
      }
      if (!chapterFounder(this.profile)) throw new Error('founder_missing');
      const character = await this._bindDeployedLeader(draft.leader);
      if (!character?.proxyHero) throw new Error('leader_missing');
      this.profile.quickSetupDone = true;
      this._storeProfileLocally();
      if (this.auth?.isSignedIn()) await this.auth.syncLocalProfile(this.profile);
      this.ui.setProfile(this.profile);
      this._skipMissionIntro = true;
      this.ui.selectedLeader = draft.leader;
      this.ui.selectedHero = character.proxyHero;
      if (invite) {
        await this._openShareLobby();
        return;
      }
      await this.startGame(draft.difficulty, character.proxyHero);
    } catch (err) {
      this._quickCommitted = false;
      this.ui._clearBusy();
      this.ui.showBanner('The siege could not start. Your names are still here.', 'bad', 3600);
      console.warn('quick start failed', err);
    }
  }

  async _createMmoCharacter({ name, appearance, raceKey, customization, quiet = false } = {}) {
    if (this.game || this._founderCreating) return;
    const clean = String(name || '').trim().slice(0,18);
    if (!clean) { this.ui.showBanner('Choose a founder name.', 'bad', 2200); return; }
    if (chapterFounder(this.profile)) { this.ui._showScreen('main'); return; }
    this._founderCreating = true;
    const character = makeMmoCharacter(clean, 'vanguard', appearance, raceKey, customization);
    try {
      if (!addMmoCharacter(this.profile, character)) throw new Error('roster_full');
      this.profile.chapter = chapterIdentity({ ...this.profile.chapter, founderId: character.id });
      this.profile.lastHero = character.proxyHero;
      this.ui.selectedHero = character.proxyHero;
      this._storeProfileLocally();
      if (this.auth?.isSignedIn()) {
        await this._ensureAuthoritativeEconomy(character, { persistProfile: false });
        await this.auth.syncLocalProfile(this.profile);
      }
      this.ui.setProfile(this.profile);
      if (!quiet) {
        this.ui._showScreen('main');
        this.ui.showBanner(`${clean} leads your chapter. Choose the first landing.`, '', 3000);
      }
    } catch (err) {
      this.ui.setProfile(this.profile);
      this.ui._showScreen('main');
      this.ui._showCharacterCreator();
      this.ui.showBanner('Founder could not sync. Your character is preserved here; save the chapter to retry.', 'bad', 5000);
    } finally { this._founderCreating = false; }
  }

  async _ensureAuthoritativeEconomy(character, { persistProfile = true } = {}) {
    if (!this.auth?.isSignedIn()) return null;
    character = this.profile.mmoCharacters?.find((entry) => entry.id === character?.id) || character;
    let result;
    try {
      result = await loadAuthoritativeEconomy(character);
    } catch (error) {
      if (!String(error?.message || '').includes('character_not_found')) throw error;
      archiveLegacyOfflineEconomy(character);
      result = await registerAuthoritativeCharacter(character);
    }
    if (result?.ok) {
      applyEconomySnapshotToProfile(this.profile, character, result);
      const current = this.profile.mmoCharacters?.find((entry) => entry.id === character.id);
      this.profile.metaCurrency = current?.authoritativeBalance ?? this.profile.metaCurrency;
      if (persistProfile) this._saveProfile();
    }
    return result;
  }

  // The signed-in upgrade tree lives on the server. The first time an account
  // signs in with a local (guest) tree, it is offered once; the server grants
  // what fits its cap and never imports local Alloy.
  async _syncAccountUpgrades() {
    if (!this.auth?.isSignedIn()) return null;
    let state = await accountUpgradeRequest('state');
    if (!state?.ok) return null;
    const localNodes = Object.keys(loadMeta().nodes || {});
    if (!state.imported && localNodes.length) {
      const imported = await accountUpgradeRequest('import_local', { requestId: 'import-local-v1', nodes: localNodes })
        .catch((error) => (error?.message === 'already_imported' ? null : Promise.reject(error)));
      if (imported?.ok) {
        state = { ...state, imported: true, owned: imported.owned };
        if (imported.granted?.length) {
          this.ui.showBanner(`⬡ ${imported.granted.length} upgrade${imported.granted.length === 1 ? '' : 's'} from this browser now belong to your account.`, '', 3200);
        }
      }
    }
    this.profile.accountUpgrades = [...(state.owned || [])];
    return state;
  }

  async _buyAccountUpgrade(nodeId) {
    if (!this.auth?.isSignedIn()) return null;
    const result = await accountUpgradeRequest('buy', { requestId: crypto.randomUUID(), nodeId });
    if (result?.ok) {
      this.profile.accountUpgrades = [...(result.owned || [])];
      this.profile.metaCurrency = result.wallet?.balance ?? this.profile.metaCurrency;
      for (const entry of this.profile.mmoCharacters || []) {
        if (Number.isFinite(entry.authoritativeBalance)) entry.authoritativeBalance = result.wallet.balance;
      }
      this._storeProfileLocally();
    }
    return result;
  }

  // Signed-in rewire: the server charges the Alloy and clears the Lattice it
  // holds for this character in one transaction; only then does the local
  // copy reset. The profile is synced first so the server counts the same
  // points the sheet shows.
  async _rewireLatticeOnServer(character) {
    if (!this.auth?.isSignedIn() || !character) return null;
    await this._ensureAuthoritativeEconomy(character);
    character = this.profile.mmoCharacters?.find((entry) => entry.id === character.id) || character;
    await this.auth.syncLocalProfile(this.profile);
    const result = await accountUpgradeRequest('rewire_lattice', { requestId: crypto.randomUUID(), characterId: character.id });
    if (!result?.ok) return result;
    rewireLattice(character);
    for (const entry of this.profile.mmoCharacters || []) {
      if (Number.isFinite(entry.authoritativeBalance)) entry.authoritativeBalance = result.wallet.balance;
    }
    this.profile.metaCurrency = result.wallet?.balance ?? this.profile.metaCurrency;
    this._saveProfile();
    return result;
  }

  async _marketBuy(character, vendorId, offerIndex) {
    if (!this.auth?.isSignedIn()) return null;
    await this._ensureAuthoritativeEconomy(character);
    character = this.profile.mmoCharacters?.find((entry) => entry.id === character?.id) || character;
    const result = await buyAuthoritativeItem(character, vendorId, offerIndex);
    if (result?.ok) { applyEconomySnapshotToProfile(this.profile, character, result); this._saveProfile(); }
    return result;
  }

  async _marketSell(character, itemIndex) {
    if (!this.auth?.isSignedIn()) return null;
    await this._ensureAuthoritativeEconomy(character);
    character = this.profile.mmoCharacters?.find((entry) => entry.id === character?.id) || character;
    const itemId = character.itemInstances?.[Number(itemIndex)]?.id;
    if (!itemId) throw new Error('item_not_found');
    const result = await sellAuthoritativeItem(character, itemId);
    if (result?.ok) { applyEconomySnapshotToProfile(this.profile, character, result); this._saveProfile(); }
    return result;
  }

  async _authorityEquip(character, itemIndex, slot) {
    if (!this.auth?.isSignedIn()) return null;
    await this._ensureAuthoritativeEconomy(character);
    character = this.profile.mmoCharacters?.find((entry) => entry.id === character?.id) || character;
    const instance = character.itemInstances?.[Number(itemIndex)];
    if (!instance) throw new Error('item_not_found');
    const result = await equipAuthoritativeItem(character, instance.id, slot, instance.revision);
    if (result?.ok) { applyEconomySnapshotToProfile(this.profile, character, result); this._saveProfile(); }
    return result;
  }

  async _authorityUnequip(character, slot) {
    if (!this.auth?.isSignedIn()) return null;
    await this._ensureAuthoritativeEconomy(character);
    character = this.profile.mmoCharacters?.find((entry) => entry.id === character?.id) || character;
    const revision = character.equipmentInstanceRevisions?.[slot] ?? null;
    const result = await unequipAuthoritativeItem(character, slot, revision);
    if (result?.ok) { applyEconomySnapshotToProfile(this.profile, character, result); this._saveProfile(); }
    return result;
  }

  async _craftMutation(character, mutation) {
    if (!this.auth?.isSignedIn()) throw new Error('sign_in_required');
    await this._ensureAuthoritativeEconomy(character);
    character = this.profile.mmoCharacters?.find((entry) => entry.id === character?.id) || character;
    const result = await mutation(character);
    if (result?.ok) { applyEconomySnapshotToProfile(this.profile, character, result); this._saveProfile(); }
    return result;
  }

  _deleteMmoCharacter(id) {
    normalizeMmoCharacters(this.profile);
    const index = this.profile.mmoCharacters.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const [removed] = this.profile.mmoCharacters.splice(index, 1);
    const next = this.profile.mmoCharacters[Math.min(index, this.profile.mmoCharacters.length - 1)] || null;
    this.profile.mmoCharacterId = next?.id || null;
    this.profile.lastHero = next?.proxyHero || null;
    this.ui.selectedHero = next?.proxyHero || 'alexander';
    this._saveProfile();
    this.ui.setProfile(this.profile);
    this.ui.showBanner(`${removed.name} was deleted.`, '', 2400);
  }

  // Campaign deployment and the character who keeps its level, gear and rewards
  // are one identity. Vanguard is the founder. The other playable leaders are
  // their own companions, created the first time they deploy.
  async _bindDeployedLeader(leaderKey) {
    const character = ensureDeployedLeader(this.profile, leaderKey);
    if (!character) return null;
    this.profile.mmoCharacterId = character.id;
    this.profile.lastHero = character.proxyHero;
    this.ui.selectedLeader = leaderKey;
    this.ui.selectedHero = character.proxyHero;
    if (this.auth?.isSignedIn()) await this._ensureAuthoritativeEconomy(character, { persistProfile: false });
    return selectedMmoCharacter(this.profile) || character;
  }

  async _launchPrepared(difficulty, hero, mode, hostMatch) {
    if (this._startLock) return;
    this._startLock = true;
    try {
      if (mode === 'campaign' && this.ui.selectedLeader) {
        const character = await this._bindDeployedLeader(this.ui.selectedLeader);
        if (!character?.proxyHero) {
          this.ui._clearBusy();
          this.ui.showBanner('That leader could not be readied.', 'bad', 3000);
          return;
        }
        hero = character.proxyHero;
      }
      if (hostMatch) await this._launchHostMatch(difficulty, hero, mode);
      else {
        this._sealShareLobby();
        await this.startGame(difficulty, hero);
      }
    } catch (err) {
      this.ui._clearBusy();
      this.ui.showBanner('That leader could not be readied.', 'bad', 3000);
      console.warn('leader deploy failed', err);
    } finally {
      this._startLock = false;
    }
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

  _tabSession() {
    if (!this._tab) this._tab = createTabSession();
    return this._tab;
  }

  _publicName() {
    const founder = chapterFounder(this.profile);
    return seatDisplayName({
      accountName: this.lobby?.me?.name || '',
      username: this.profile.username || '',
      founderName: founder?.name || '',
      profileName: this.profile.name || '',
    });
  }

  // Share seats never borrow the online-lobby account name or the host's
  // label. The id is this tab's commander id.
  _shareHostLabel() {
    const seat = this._shareLobby?.seats?.find((entry) => entry.host);
    return seat?.name || this._shareLobby?.hostName || (this.mpRole === 'host' ? this._publicName() : '');
  }

  _shareDisplayName() {
    const founder = chapterFounder(this.profile);
    const own = founder?.name || this.profile.username || this.profile.name || '';
    return shareGuestName({
      name: own,
      id: this._shareSelf || this._shareSelfId(),
      hostName: this.mpRole === 'host' ? '' : this._shareHostLabel(),
    });
  }

  _heroPayload(key = this.ui.selectedHero) {
    return { t: 'hero', k: key, camp: this.campFor(key), name: this._publicName() };
  }

  async _pickHero(key) {
    if ((this.ui.selectedMode || 'campaign') === 'campaign' && this.ui.selectedLeader && leaderHeroKey(this.ui.selectedLeader) === key) {
      try {
        const character = await this._bindDeployedLeader(this.ui.selectedLeader);
        if (character?.proxyHero) key = character.proxyHero;
      } catch (err) {
        this.ui.showBanner('That leader could not be readied.', 'bad', 3000);
        console.warn('leader deploy failed', err);
        return;
      }
    }
    const msg = this._heroPayload(key);
    if (this.mpRole === 'guest' && this.net?.open) this.net.send(msg);
    if (this.mpRole === 'host') this._syncSetupRoster();
    if (this._shareLobby && this.mpRole === 'host') {
      this._shareLobby = withSeatHero(this._shareLobby, this._shareSelf, key, this._publicName(), Date.now());
      this._sharePublishLobby();
      this._renderShareHost();
    }
    if (this._shareLobby && this.mpRole === 'guest') {
      this._sharePublish({
        t: 'join', name: this._shareDisplayName(), hero: key, claim: true,
        protocolVersion: LOBBY_PROTOCOL_VERSION, clientVersion: CLIENT_VERSION,
        unlockedLevel: highestUnlockedLevel(this.profile?.campaign),
      });
    }
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
    if (this._shareLobby && !this._shareLobby.closed && (this.mpRole === 'host' || this.mpRole === 'guest')) return;
    if (this.lobby?.game) return this._onRoomUpdate(this.lobby.game);
    if (this.mpRole !== 'host' && this.mpRole !== 'guest') return;
    const players = this._manualRosterPlayers();
    this.ui.roomRoster(players, {
      maxPlayers: 4,
      isHost: this.mpRole === 'host',
      mode: this.ui.selectedMode || 'campaign',
    });
    if (this.mpRole === 'host' && this.peers.length) {
      this._broadcast({ t: 'lobbyRoster', n: players.length, players, mode: this.ui.selectedMode || 'campaign' });
    }
    return players;
  }

  _storeProfileLocally() {
    try { localStorage.setItem('zillions_profile', JSON.stringify(this.profile)); return true; } catch { return false; }
  }

  _saveProfile() {
    const stored = this._storeProfileLocally();
    if (this.auth?.isSignedIn()) {
      this.auth.syncLocalProfile(this.profile).catch((err) => console.warn('profile sync failed', err));
    }
    return stored;
  }

  _loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem('zillions_save') || 'null');
      if (s?.snap && !isCompatibleSnapshot(s.snap)) {
        // Keep the original before a new siege can replace the active slot.
        localStorage.setItem(`zillions_save_legacy_v${s.snap.v}`, JSON.stringify(s));
        this.ui.showBanner('An older siege was archived because the colony layout changed. Start a new siege; account progression is unchanged.', '', 8000);
        return null;
      }
      return s?.snap ? s : null;
    } catch { return null; }
  }

  // Guests never autosave — the host owns the co-op save.
  // The snapshot is taken synchronously (it must reflect one exact sim tick),
  // but serializing + persisting it is deferred to idle time: in co-op every
  // host frame hitch becomes a stall broadcast to all guests, and stringify +
  // localStorage on the hot path was a guaranteed periodic hitch.
  _autosave(force = false) {
    if (!this.game || this.replay || this._seedRun || this.game.over || this.game.mode === 'daily' || this.mpRole === 'guest' || this.mpRole === 'spectator') return;
    if (!force && this.paused) return;
    try {
      const save = { when: Date.now(), snap: this.game.snapshot() };
      // The local save also keeps the match ticket and the input log so far,
      // so a resumed signed-in run can still be verified later. The
      // cloud copy stays snapshot-only.
      const m = this._match;
      const match = m ? {
        ticket: m.ticket || null, seed: m.seed ?? null, roomId: m.roomId || null, joinToken: m.joinToken || null,
        heroes: m.heroes, log: this.game.inputLog ? this.game.inputLog.slice() : null,
      } : null;
      const persist = () => {
        try {
          try { localStorage.setItem('zillions_save', JSON.stringify(match ? { ...save, match } : save)); }
          catch { localStorage.setItem('zillions_save', JSON.stringify(save)); }
          if (this.auth?.isSignedIn()) this.auth.syncLatestSave(save).catch((err) => console.warn('save sync failed', err));
        } catch { /* storage full */ }
      };
      if (!force && typeof requestIdleCallback === 'function') requestIdleCallback(persist, { timeout: 4000 });
      else persist();
    } catch { /* snapshot failed */ }
  }

  _dailyBoardCurrent() {
    const overlay = this.ui.root?.querySelector?.('#overlay');
    return {
      ticket: this._dailyTicket,
      current: this._dailyTicket,
      screen: this.ui._lastScreen,
      overlayHidden: !overlay || overlay.classList.contains('hidden'),
      inGame: !!this.game,
    };
  }

  async _openDaily() {
    const ticket = (this._dailyTicket = (this._dailyTicket || 0) + 1);
    const challenge = dailyChallenge(dailyKey());
    this._dailyChallenge = challenge;
    const level = levelById(challenge.levelId);
    const view = {
      ...challenge,
      levelName: level?.name || 'Frontier',
      localSeed: challenge.seed,
    };
    this.ui.showDaily(view, { loading: true });
    const paint = (board) => {
      const here = this._dailyBoardCurrent();
      if (!acceptDailyBoardPaint({ ...here, ticket, current: this._dailyTicket })) return;
      this.ui.showDaily(view, board, { navigate: false });
    };
    try {
      const board = await dailyBoardRequest(challenge.day);
      if (!board) paint({ unavailable: true });
      else if (board.challenge && (board.challenge.seed >>> 0) !== (challenge.seed >>> 0)) paint({ ...board, staleClient: true });
      else paint(board);
    } catch (error) {
      paint({ error: error?.message || 'board_unavailable' });
    }
  }

  async _startDaily(requested = null) {
    // Drop a board response that is still in flight. Play has left the brief.
    this._dailyTicket = (this._dailyTicket || 0) + 1;
    if (this.game) return;
    const challenge = requested?.day
      ? requested
      : (this._dailyChallenge?.day === dailyKey() ? this._dailyChallenge : dailyChallenge(dailyKey()));
    this._dailyChallenge = challenge;
    this.ui.selectedMode = 'daily';
    this.ui.selectedLevel = challenge.levelId;
    this.ui.selectedDiff = 'normal';
    this._skipMissionIntro = true;
    try {
      await this.startGame('normal', challenge.hero);
    } catch (error) {
      this.ui.selectedMode = 'campaign';
      this.ui._clearBusy();
      this.ui.showBanner('Today\'s siege could not start.', 'bad', 3600);
      console.warn('daily start failed', error);
    }
  }

  _stashDaily() {
    const replay = this._dailyReplay;
    if (!replay) return;
    try {
      localStorage.setItem(PENDING_DAILY_KEY, JSON.stringify({ v: 1, replay, savedAt: Date.now() }));
    } catch { /* private mode or a full disk; the end screen still explains it */ }
  }

  _readStashedDaily() {
    try {
      const raw = JSON.parse(localStorage.getItem(PENDING_DAILY_KEY) || 'null');
      if (!raw?.replay || !acceptableDay(raw.replay.day, new Date())) return null;
      return raw;
    } catch { return null; }
  }

  _dropStashedDaily(expected) {
    try {
      const current = this._readStashedDaily();
      if (expected && JSON.stringify(current) !== JSON.stringify(expected)) return;
      localStorage.removeItem(PENDING_DAILY_KEY);
    } catch { /* ignore */ }
  }

  async _finishDailyRun(won) {
    const challenge = this._dailyChallenge || dailyChallenge(dailyKey());
    const standing = this.game?.dailyResult || { waves: 0, cityHp: 0, cityMaxHp: 1, seconds: 0, won: !!won };
    const score = dailyScore(standing);
    this._dailyReplay = buildDailyReplay(this.game, challenge);
    const guest = !(this.auth?.isSignedIn() && !this.auth.status().needsUsername);
    this._stashDaily();
    // The victory/defeat handler paints the end screen with this extra as soon
    // as we return. Submitting waits until that screen exists.
    this._endExtras = { dailyGuest: guest, dailyScore: score, dailyLine: formatDailyStanding(standing) };
    if (!guest) queueMicrotask(() => { this._submitStashedDaily().catch((err) => console.warn('daily submit failed', err)); });
  }

  async _flushPendingDaily() {
    if (!this.auth?.isSignedIn() || this.auth.status().needsUsername) return;
    if (!this._readStashedDaily()) return;
    await this._submitStashedDaily({ quiet: true });
  }

  async _submitStashedDaily({ quiet = false } = {}) {
    const stashed = this._readStashedDaily();
    if (!stashed) return null;
    try {
      const result = await dailyScoreRequest({ replay: stashed.replay });
      if (!result) {
        if (!quiet) this.ui.setDailyStatus('The score server is not available from here. It stays on this browser until you can submit it.');
        return null;
      }
      this._dropStashedDaily(stashed);
      const watch = shareReplayPath(result.replayId || '');
      const link = watch ? ` Replay ${location.origin}${watch}` : '';
      const line = (result.improved
        ? `Saved. Rank ${result.rank} with ${result.score}.`
        : `Today's board already has your better score. Rank ${result.rank}.`) + link;
      if (!quiet) this.ui.setDailyStatus(line);
      else this.ui.showBanner(line, '', 5000);
      return result;
    } catch (error) {
      const code = error?.message || 'daily_unverified';
      if (code === 'daily_unverified' || code === 'daily_closed' || code === 'invalid_replay') {
        this._dropStashedDaily(stashed);
      }
      const text = code === 'daily_unverified'
        ? 'The server replay did not match this run, so the score was not saved.'
        : code === 'daily_timeout'
          ? 'The server could not finish checking this run in time. It is still saved on this browser.'
          : code === 'sign_in_required'
            ? 'Sign in to save your score.'
            : 'The score could not be saved.';
      if (!quiet) this.ui.setDailyStatus(text);
      else if (code !== 'daily_closed') this.ui.showBanner(text, 'bad', 5000);
      return null;
    }
  }

  _recordGameEnd(won) {
    if (this.mpRole === 'spectator') return;
    if (this._seedRun) {
      this._seedRun = false;
      this._endExtras = { seedRun: true, local: true };
      return;
    }
    if (this.game?.mode === 'daily') {
      this._finishDailyRun(won);
      return;
    }
    persistRunTelemetry(this.game);
    this._endExtras = null;
    const h = this.game.heroes[this.myPlayer];
    try { localStorage.removeItem('zillions_save'); } catch { /* ignore */ }
    if (this.auth?.isSignedIn()) {
      // Signed in: the server is the only source of XP, loot, Alloy and
      // stats. Nothing is granted locally; the end screen shows what the
      // server confirms.
      this.auth.clearLatestSave().catch((err) => console.warn('save clear failed', err));
      const character = selectedMmoCharacter(this.profile);
      this._endExtras = character ? {
        heroKey: character.proxyHero, heroName: character.name, level: character.level,
        grants: [], quests: [], pending: true,
      } : { pending: true, grants: [], quests: [] };
      this._submitMatchResult(won, h, character);
    } else {
      this._recordGuestGameEnd(won, h);
      const saved = this._saveProfile();
      this._endExtras = { ...this._endExtras, saved, local: true, campaignCleared: this.profile.campaign,
        ...(!saved ? { error: 'Browser storage is unavailable. Progress remains in this tab but is not saved.' } : {}) };
    }
    this._netPumpStop();
    if (this.lobby) this.lobby.setMatchActive(false);
    if (this.lobby && this.lobby.game && this.mpRole === 'host') this.lobby.endGame();
  }

  // What the client claims happened. The server bounds-checks every field,
  // re-derives loot and quests itself (src/match-rewards.js), and keeps the
  // input log of a best run so a future leaderboard can replay it.
  _matchReport(won) {
    return buildMatchReport(this.game, { won: !!won, heroIndex: this.myPlayer, heroKey: this.ui.selectedHero || null });
  }

  // The recorded inputs, kept for leaderboard verification (src/match-replay.js).
  _matchReplay() { return matchReplayPayload(this.game, this._match, this.myPlayer); }

  async _submitMatchResult(won, h, character) {
    const quests = this.game?.questResults || [];
    const match = this._match || {};
    // Captured now, synchronously: the report and log describe this game.
    const report = this._matchReport(won);
    const replay = this._matchReplay();
    if (!character?.id) {
      this._endExtras = { pending: false, error: 'Create a character to earn rewards.', grants: [], quests };
      this.ui.setEndRewards?.(this._endExtras);
      return;
    }
    if (!match.ticket && match.ticketPromise) await match.ticketPromise.catch(() => null);
    if (!match.ticket) {
      this._endExtras = {
        pending: false, grants: [], quests,
        error: `This match started without a reward ticket (${match.error || (match.roomId ? 'room' : 'offline')}). No rewards were granted.`,
      };
      this.ui.setEndRewards?.(this._endExtras);
      return;
    }
    const userId = this.auth?.user?.id || null;
    if (!userId) {
      this._endExtras = { pending: false, grants: [], quests, error: 'Sign in to earn rewards. No rewards were granted.' };
      this.ui.setEndRewards?.(this._endExtras);
      return;
    }
    const pending = {
      // The account that played this match. The outbox only ever resends or
      // drops a report for the account that is signed in.
      userId,
      requestId: globalThis.crypto?.randomUUID?.() || `match-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      characterId: character.id,
      // The room comes from match start, not from lobby state at match end
      // (which can already be cleared). The server takes it from the ticket.
      roomId: match.roomId || null,
      ticket: match.ticket,
      report,
      ...(replay ? { replay } : {}),
    };
    const queued = queuePendingMatch(pending);
    const endGame = this.game;
    let sending = false;
    const submit = async () => {
      if (sending) return;
      sending = true;
      const active = () => this.game === endGame && this.auth?.user?.id === pending.userId;
      if (active()) { this._endExtras = { pending: true, grants: [], quests }; this.ui.setEndRewards?.(this._endExtras); }
      try {
        const result = await this._sendMatchResult(pending);
        if (this.auth?.user?.id === pending.userId) this._applyMatchResult(character, result, quests, { quiet: !active() });
      } catch (error) {
        console.warn('match result failed', { requestId: pending.requestId, status: error?.status, code: error?.message });
        const retryable = retryableMatchError(error);
        if (!retryable) dropPendingMatch(pending.requestId, pending.userId);
        if (active()) {
          this._endExtras = {
            pending: false, saved: false, grants: [], quests,
            retry: retryable ? submit : null,
            error: retryable
              ? `Rewards are not confirmed yet. Retry now.${queued ? ' This report is saved for retry when you sign in again.' : ' Keep this tab open until confirmation.'}`
              : 'Rewards could not be saved because this match report was rejected. Your previous progress is unchanged.',
          };
          this.ui.setEndRewards?.(this._endExtras);
        }
      } finally { sending = false; }
    };
    await submit();
  }

  async _sendMatchResult(pending) {
    // Never send one account's report with another account's session. Not a
    // rejection either: the report stays queued for its own account.
    if (!pending.userId || pending.userId !== this.auth?.user?.id) {
      throw Object.assign(new Error('account_changed'), { status: 0 });
    }
    if (pending.characterId) {
      const character = this.profile.mmoCharacters?.find((entry) => entry.id === pending.characterId);
      // A character the server has never seen is registered first; the
      // economy snapshot also refreshes stash and wallet afterwards.
      if (character && !Number.isFinite(character.authoritativeBalance)) await this._ensureAuthoritativeEconomy(character);
    }
    const result = await matchResultRequest(pending);
    if (!result?.ok) throw Object.assign(new Error(result?.error || 'match_result_failed'), { status: 503 });
    dropPendingMatch(pending.requestId, pending.userId);
    return result;
  }

  // Replays reports that never reached the server (closed tab, offline).
  // Same requestId, so the server grants each match at most once.
  async _flushPendingMatches() {
    if (!this.auth?.isSignedIn()) return;
    const userId = this.auth.user?.id;
    // Only this account's own reports; another account's stay untouched.
    for (const pending of readPendingMatches(userId)) {
      try {
        const result = await this._sendMatchResult(pending);
        const character = this.profile.mmoCharacters?.find((entry) => entry.id === pending.characterId);
        if (character) this._applyMatchResult(character, result, [], { quiet: true });
      } catch (error) {
        if (!retryableMatchError(error)) { dropPendingMatch(pending.requestId, userId); continue; }
        // Rate limited or the server is busy: stop and try again next time
        // rather than burn through the queue.
        if (error?.status === 429 || error?.status >= 500) break;
      }
    }
  }

  // Render exactly what the server granted.
  _applyMatchResult(character, result, quests = [], { quiet = false } = {}) {
    const p = this.profile;
    const current = p.mmoCharacters?.find((entry) => entry.id === character?.id) || character;
    if (current && result.character) {
      current.level = result.character.level;
      current.xp = result.character.xp;
      current.stats = { instances: 0, victories: 0, kills: 0, ...(result.character.stats || {}) };
      current.progressRevision = result.character.progressRevision;
    }
    const st = result.stats || {};
    p.games = st.gamesPlayed ?? p.games;
    p.wins = st.wins ?? p.wins;
    p.kills = st.kills ?? p.kills;
    p.bestDay = st.bestDay ?? p.bestDay;
    p.campaign = st.campaignCleared ?? p.campaign;
    p.bestSurvival = st.bestSurvival ?? p.bestSurvival;
    if (st.relics) p.relics = [...st.relics];
    if (st.questsDone) p.questsDone = { ...st.questsDone };
    if (st.labyrinthClears) p.labyrinthClears = { ...st.labyrinthClears };
    if (result.wallet) p.metaCurrency = result.wallet.balance;
    normalizeMmoCharacters(p);
    if (!quiet) {
      const serverQuests = new Set(result.questsCompleted || []);
      this._endExtras = {
        heroKey: current?.proxyHero, heroName: current?.name, level: current?.level,
        grants: [...(result.grantedItems || []), ...(result.relicsGranted || [])],
        quests: (result.quests || quests).map((q) => {
          const authored = quests.find((entry) => entry.id === q.id) || {};
          return { ...authored, ...q, desc: authored.desc || q.desc || '', done: !!q.done, claimed: serverQuests.has(q.id) };
        }),
        xp: result.xpGained, levels: result.levelsGained || [], alloy: result.alloyGained || 0,
        skipped: result.skippedItems || [], pending: false, saved: true, campaignCleared: st.campaignCleared,
      };
      this.ui.setEndRewards?.(this._endExtras);
    }
    this.ui.setProfile(p);
    this.ui.setCampaign(p.campaign || 0);
    // Pull the stash/wallet snapshot the server just changed.
    if (current) this._ensureAuthoritativeEconomy(current).catch((err) => console.warn('economy refresh failed', err));
    else this._storeProfileLocally();
  }

  // Guest / offline play: progress lives only in this browser (localStorage
  // profile + meta ledger) and is never sent to, or trusted by, the server.
  _recordGuestGameEnd(won, h) {
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
        const shared = save.match ? { seed: save.match.seed ?? null, roomId: save.match.roomId || null, joinToken: save.match.joinToken || null } : null;
        this.peers.forEach((p, i) => p.send({ t: 'start', snap: save.snap, you: i + 1, match: shared }));
        this._resumeMatch = save.match || null;
        await this.startGame(save.snap.diff, null, { myPlayer: 0, role: 'host' }, save.snap);
      } else if (!this.mpRole) {
        this._resumeMatch = save.match || null;
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
    this._finishMissionIntro();
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
      this.ui.mpLobby(this.peers.length, this.peers.length < 3, players, { mode: this.ui.selectedMode || 'campaign' });
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
      const shareIdForPeer = this.peers[idx]?.shareId;
      if (shareIdForPeer && this._shareLobby) {
        this._shareLobby = withSeatHero(this._shareLobby, shareIdForPeer, m.k, this._shareGuestLabel(m.name, shareIdForPeer), Date.now());
        this._sharePublishLobby();
        this._renderShareHost();
      }
      if (!(this._shareLobby && !this._shareLobby.closed)) {
        const players = this._manualRosterPlayers();
        this.ui.mpLobby(this.peers.length, this.peers.length < 3, players, { mode: this.ui.selectedMode || 'campaign' });
        this._syncSetupRoster();
      }
    }
    else if (m.t === 'startReady') {
      const shareGuest = this.peers[idx]?.shareId;
      if (this._shareBeginNeed) {
        if (shareGuest && this._shareBeginNeed.has(shareGuest)) this._shareNoteBegan(shareGuest);
        return;
      }
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
    else if (m.t === 'cmd') {
      const command = guestCommand(m.c, idx + 1, this.game?.heroes.length || 0);
      if (command && this.guestCmdQueues[idx]) this.guestCmdQueues[idx].push(command);
    }
    else if (m.t === 'needWindow') {
      const peer = this.peers[idx];
      if (!peer) return;
      const start = Number(m.w);
      const recent = [];
      for (let n = start; n < start + 32; n++) {
        const commands = this._windowHistory.get(n);
        if (commands) recent.push([n, commands]);
      }
      if (recent.length) {
        peer.sendFast({ t: 'w', w: recent[0][0], c: recent[0][1], p: recent.slice(1) });
        return;
      }
      this._sendGuestResync(idx);
    }
    else if (m.t === 'snap') this._sendGuestResync(idx);
    else if (m.t === 'h') this._checkGuestHash(m.w, m.h, idx);
    else if (m.t === 'chat') {
      this.ui.gameChatAdd(m);
      this._broadcast(m);
    }
  }

  _broadcast(msg) {
    for (const p of this.peers) p.send(msg);
  }

  _startPendingSpectators() {
    // Called only before commands at a whole lockstep boundary. The snapshot
    // does not contain that window yet, so the first buffered packet is exact.
    for (const rec of this.pendingSpectators) {
      if (rec.started || !rec.peer.open) continue;
      rec.started = true;
      rec.frame = this.simFrame;
      rec.buffer = [];
      rec.overflow = false;
      rec.peer.send({ t: 'spectateStart', snap: this.game.snapshot(), frame: rec.frame });
    }
  }

  _broadcastSpectators(msg) {
    for (const rec of this.pendingSpectators) {
      if (!rec.started || rec.overflow) continue;
      if (rec.buffer.length >= NET_SPECTATOR_BUFFER) {
        // Do not grow memory indefinitely on a slow-loading watcher. Once its
        // current restore finishes, Ready requests a fresh boundary snapshot.
        rec.buffer.length = 0;
        rec.overflow = true;
      } else rec.buffer.push(msg);
    }
    for (const p of this.spectators) p.send(msg);
  }

  _checkGuestHash(w, h, idx) {
    const mine = this.hashes.local.get(w);
    if (mine === undefined || mine === h || this.desynced) return;
    const decision = desyncRecovery({ attempts: this._desyncAttempts || [], now: Date.now() });
    this._desyncAttempts = decision.attempts;
    if (decision.action === 'terminal') {
      this.desynced = true;
      this._broadcast({ t: 'desync' });
      this.ui.showBanner('⚠️ Games desynced — everyone should refresh and reconnect.', 'bad', 10000);
      return;
    }
    const peer = this.peers[idx];
    if (!peer?.open || !this.game) return;
    this.ui.showBanner('Restoring the shared battlefield…', '', 2500);
    peer.send({
      t: 'resync', snap: this.game.snapshot(), you: idx + 1, frame: this.simFrame,
      match: this._sharedMatchFields(), reason: 'desync',
    });
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

  // Share-link co-op. The link only exchanges WebRTC signaling. Command
  // windows, the load barrier, and the hash stay on the existing lockstep path.
  // Friends join before Start. After that the link refuses a new hero.
  _shareSelfId() {
    if (shareId(this._shareSelf)) return this._shareSelf;
    const id = this._tabSession().id;
    this._shareSelf = shareId(id) ? id : crypto.randomUUID();
    return this._shareSelf;
  }

  _shareLiveness() {
    return { receivedAt: this._shareReceivedAt || null, hostPresent: !!this._shareHostPresent };
  }

  _noteSharePresence(members) {
    const list = Array.isArray(members) ? members : [];
    const ids = list.map((member) => member?.id).filter(Boolean);
    this._sharePresentIds = ids.length ? new Set(ids) : null;
    const hostId = this._shareLobby?.hostId;
    this._shareHostPresent = !!(hostId && list.some((member) => member?.role === 'host' && member.id === hostId));
    if (this._shareHostPresent) this._shareReceivedAt = Date.now();
  }

  _shareTrackPresence() {
    if (!this._shareCode || !this._shareSelf) return;
    const payload = {
      id: this._shareSelf,
      role: this.mpRole === 'host' ? 'host' : 'guest',
      name: this._shareDisplayName(),
    };
    for (const hub of this._shareHubList || []) hub.track?.(this._shareCode, payload);
  }

  _consumeShareLink() {
    let parsed = null;
    try { parsed = parseShareLocation(location.search); } catch { parsed = null; }
    if (!parsed) return;
    this._guestSession = true;
    this.ui.noteGuestSession();
    this.ui._accountAccepted = true;
    this.ui._shareLive = true;
    if (!parsed.ok) {
      this.ui.showShareNotice({ title: 'Invite link', copy: shareFailureCopy('invalid'), tone: 'bad' });
      return;
    }
    void this._enterShare(parsed.code);
  }

  async _enterShare(code) {
    let hostCode = '';
    try { hostCode = sessionStorage.getItem('zillions.share.host') || ''; } catch { /* private mode */ }
    await this._ensureDefaultCommander();
    if (hostCode === code) {
      this._resumeShareHost(code);
      return;
    }
    this._joinShareLink(code);
  }

  _rememberShareHost() {
    if (!this._shareCode || !this._shareUrl) return;
    try { sessionStorage.setItem('zillions.share.host', this._shareCode); } catch { /* private mode */ }
    try { history.replaceState(null, '', this._shareUrl); } catch { /* ignore */ }
  }

  _resumeShareHost(code) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(`zillions.share.${code}`) || 'null'); } catch { saved = null; }
    const lobby = saved?.lobby;
    if (lobby?.code === code && lobby.hostId === this._shareSelfId() && !lobby.closed) {
      this._shareCode = code;
      this._shareUrl = shareUrl(location.origin, code);
      this._shareLobby = lobby;
      this._shareSeen = new Set();
      this._shareHands = new Map();
      this._shareFailed = false;
      this.mpRole = 'host';
      this.ui._shareLive = true;
      this.ui.showSetup({ mode: lobby.mode || 'campaign', share: true });
      this.ui.setRoomSettings({
        level: lobby.level || 1,
        difficulty: lobby.difficulty || 'casual',
        isHost: true,
        mode: lobby.mode || 'campaign',
      });
      this._bindShareTransport('host');
      this._startShareHeartbeat();
      this._shareSig = '';
      this._renderShareHost();
      this._rememberShareHost();
      return;
    }
    this._openShareLobby(code);
  }

  async _requestShareInvite() {
    this.ui._clearBusy();
    if (this.game && !this.game.over) {
      this.ui.showBanner(shareFailureCopy('started'), 'bad', 5200);
      return;
    }
    if (this.onlineMode && this.lobby?.game) {
      this.ui.showBanner('Leave this room before creating an invite link.', 'bad', 4000);
      return;
    }
    if (this.mpRole === 'guest' && this._shareCode) {
      this.ui.showBanner('You are already in this siege. The host shares the invite.', '', 3200);
      return;
    }
    if (!this.auth?.isSignedIn()) {
      this._guestSession = true;
      this.ui.noteGuestSession();
      this.ui._accountAccepted = true;
    }
    await this._ensureDefaultCommander();
    if (!this.ui._diffPicked) this.ui.selectedDiff = QUICK_DEFAULTS.difficulty;
    if (!this.ui.selectedLevel) this.ui.selectedLevel = 1;
    this._openShareLobby();
    if (this._shareUrl) this.ui.copyShareUrl(this._shareUrl);
  }

  async _ensureDefaultCommander() {
    if (!this.ui.selectedMode) this.ui.selectedMode = 'campaign';
    if (!this.ui._diffPicked) this.ui.selectedDiff = QUICK_DEFAULTS.difficulty;
    if (chapterFounder(this.profile)) {
      const founder = chapterFounder(this.profile);
      if (founder?.proxyHero) this.ui.selectedHero = founder.proxyHero;
      return;
    }
    await this._createMmoCharacter({
      name: QUICK_DEFAULTS.founderName,
      appearance: QUICK_DEFAULTS.color,
      raceKey: 'human',
      customization: {},
      quiet: true,
    });
    const character = await this._bindDeployedLeader(QUICK_DEFAULTS.leader);
    this.profile.quickSetupDone = true;
    this._storeProfileLocally();
    if (character?.proxyHero) this.ui.selectedHero = character.proxyHero;
    this.ui.setProfile(this.profile);
  }

  _showShareDraft() {
    if (!this.ui._diffPicked) this.ui.selectedDiff = QUICK_DEFAULTS.difficulty;
    this.ui.showSetup({ mode: this.ui.selectedMode || 'campaign', share: true });
    this.ui.setRoomSettings({
      level: this.ui.selectedLevel || 1,
      difficulty: this.ui.selectedDiff || QUICK_DEFAULTS.difficulty,
      isHost: true,
      mode: this.ui.selectedMode || 'campaign',
    });
    this.ui.showShareDraft();
  }

  _openShareLobby(existingCode) {
    this.ui._clearBusy();
    if (this._shareLobby && !this._shareLobby.closed && !this._shareLobby.started) {
      this.ui._shareLive = true;
      this.ui.showSetup({ mode: this._shareLobby.mode });
      this.ui.setRoomSettings({
        level: this._shareLobby.level,
        difficulty: this._shareLobby.difficulty,
        isHost: true,
        mode: this._shareLobby.mode,
      });
      this._shareSig = '';
      this._renderShareHost();
      return;
    }
    const claim = this._tabSession().claimLease({ kind: 'share' });
    if (!claim.ok) {
      this.ui.showBanner('This browser already has a lobby open in another tab. Use that tab, or close it before hosting here.', 'bad', 5500);
      return;
    }
    const id = this._shareSelfId();
    const code = existingCode || randomShareCode();
    this._shareCode = code;
    this._shareUrl = shareUrl(location.origin, code);
    this._shareSeen = new Set();
    this._shareHands = new Map();
    this._shareFailed = false;
    this.mpRole = 'host';
    this._shareLobby = createLobby({
      code,
      hostId: id,
      hostName: this._publicName(),
      hero: this.ui.selectedHero || 'scott',
      unlockedLevel: highestUnlockedLevel(this.profile?.campaign),
      now: Date.now(),
      mode: this.ui.selectedMode || 'campaign',
      level: this.ui.selectedLevel || 1,
      difficulty: this.ui.selectedDiff || QUICK_DEFAULTS.difficulty,
    });
    this._rememberShareHost();
    this.ui._shareLive = true;
    this.ui.showSetup({ mode: this._shareLobby.mode });
    this.ui.setRoomSettings({
      level: this._shareLobby.level,
      difficulty: this._shareLobby.difficulty,
      isHost: true,
      mode: this._shareLobby.mode,
    });
    this._shareIcePromise = this.lobby?.iceServers?.length ? Promise.resolve(this.lobby.iceServers) : loadShareIceServers();
    this._bindShareTransport('host');
    this._sharePublishLobby();
    this._startShareHeartbeat();
    this._shareSig = '';
    this._renderShareHost();
  }

  _startShareHeartbeat() {
    this._stopShareHeartbeat();
    const tick = () => {
      this._tabSession().touch();
      if (this.mpRole === 'host' && this._shareLobby) {
        this._tabSession().refreshLease();
        this._reapShareSeats();
        this._sharePublishLobby();
        this._shareTrackPresence();
        for (const seat of this._shareLobby.seats || []) {
          if (seat.host || seat.linked) continue;
          this._shareSendPing(seat.id);
          this._shareConsiderLink(seat.id);
        }
        this._sharePollBegin();
        return;
      }
      if (this.mpRole !== 'guest' || !this._shareLobby) return;
      const mine = this._shareLobby.seats?.find((seat) => seat.id === this._shareSelf);
      if (mine && !mine.linked) this._shareSendPing(this._shareLobby.hostId);
      this._shareSendCatchup();
      if (this._shareRejoinArmed || (this.netMode && this.game && !this.game.over && !this.net?.open)) {
        this._shareRejoinTick();
        return;
      }
      if (this.netMode) return;
      const decision = admitGuest(this._shareLobby, { id: this._shareSelf }, Date.now(), this._shareLiveness());
      if (!decision.ok && decision.reason !== 'host_left') this._failShare(decision.reason);
      else {
        this._sharePublish({ t: 'here', name: this._shareDisplayName() });
        this._shareTrackPresence();
        const mine = this._shareLobby.seats?.find((seat) => seat.id === this._shareSelf);
        if (mine && !mine.linked) this._shareSendPing(this._shareLobby.hostId);
      }
    };
    try {
      const src = `setInterval(() => postMessage(0), ${SHARE_HEARTBEAT_MS});`;
      this._shareWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this._shareWorker.onmessage = tick;
    } catch {
      this._shareBeat = setInterval(tick, SHARE_HEARTBEAT_MS);
    }
  }

  _stopShareHeartbeat() {
    if (this._shareWorker) {
      try { this._shareWorker.terminate(); } catch { /* already gone */ }
      this._shareWorker = null;
    }
    clearInterval(this._shareBeat);
    this._shareBeat = null;
  }

  _joinShareLink(code) {
    this._shareFailed = false;
    this._sharePageAt = Date.now();
    this._shareCode = code;
    this._shareSelf = this._shareSelfId();
    this._shareSeen = new Set();
    this._shareHands = new Map();
    this._shareAnnounced = false;
    this._shareGuestShown = false;
    this._shareLobby = null;
    this.mpRole = 'guest';
    this._shareIcePromise = this.lobby?.iceServers?.length ? Promise.resolve(this.lobby.iceServers) : loadShareIceServers();
    this.ui._shareLive = true;
    this.ui.showShareNotice({ title: 'Joining siege', copy: 'Looking for the host…' });
    this._bindShareTransport('guest');
    clearTimeout(this._shareDiscover);
    // Count live event-loop turns, not wall time. A cold CI page can block
    // the thread longer than the old 8s timer, and that timer then fired
    // before the in-flight lobby poll resolved and called the link invalid.
    let turns = 0;
    this._shareDiscover = setInterval(() => {
      if (this._shareLobby || this._shareFailed) { clearTimeout(this._shareDiscover); return; }
      turns += 1;
      if (turns * 2000 >= SHARE_DISCOVER_MS * 4) this._failShare('invalid');
    }, 2000);
    this._startShareHeartbeat();
  }

  _bindShareTransport(role) {
    this._shareHubList = [createBrowserHub()];
    this._shareUnsubs = [];
    const code = this._shareCode;
    const generation = this._shareGeneration = (this._shareGeneration || 0) + 1;
    const onMessage = (message) => { if (generation === this._shareGeneration) this._onShareMessage(message); };
    const relayUrl = globalThis.__zillionsShareRelay;
    if (relayUrl) {
      // The browser hub still writes the lobby snapshot this tab reloads.
      // The relay is what the other browser actually hears.
      const local = createBrowserHub();
      const hub = createRelayHub(relayUrl);
      this._shareHubList = [local, hub];
      this._shareUnsubs = [
        local.subscribe(this._shareCode, onMessage, { replay: role === 'guest' ? 'lobby' : 'none' }),
        hub.subscribe(this._shareCode, onMessage),
      ];
      this._shareRelay = true;
      this._shareReach = 'subscribed';
      if (this.mpRole === 'host') this._sharePublishLobby();
      return;
    }
    this._shareUnsubs.push(this._shareHubList[0].subscribe(this._shareCode, onMessage, { replay: role === 'guest' ? 'lobby' : 'none' }));
    this._shareRelay = undefined;
    this._shareReach = 'connecting';
    getSupabaseClient().then((client) => {
      if (generation !== this._shareGeneration || code !== this._shareCode) return;
      try { client.realtime?.connect?.(); } catch { /* subscribe connects as well */ }
      const hub = createSupabaseHub(client, {
        presenceKey: this._shareSelf,
        onStatus: (status) => {
          if (generation !== this._shareGeneration) return;
          this._shareReach = status;
          this._shareSig = '';
          if (status === 'subscribed' && this.mpRole === 'host') this._sharePublishLobby();
          this._renderShareHost();
        },
      });
      this._shareHubList.push(hub);
      this._shareRelay = true;
      this._shareUnsubs.push(hub.subscribe(this._shareCode, onMessage));
      if (hub.onPresence) {
        this._shareUnsubs.push(hub.onPresence(this._shareCode, (members) => {
          if (generation !== this._shareGeneration) return;
          this._noteSharePresence(members);
        }));
      }
      this._shareTrackPresence();
      if (this.mpRole === 'host') this._sharePublishLobby();
      this._shareSig = '';
      this._renderShareHost();
    }).catch(() => {
      if (generation !== this._shareGeneration) return;
      this._shareRelay = false;
      this._renderShareHost();
    });
  }

  _sharePublish(partial) {
    if (!this._shareCode || !this._shareSelf) return;
    const message = { v: 1, id: shareMessageId(), at: Date.now(), from: this._shareSelf, ...partial };
    for (const hub of this._shareHubList || []) {
      try { hub.publish(this._shareCode, message); } catch { /* one transport can fail */ }
    }
  }

  _sharePublishLobby() {
    if (!this._shareLobby) return;
    this._shareLobby = touchLobby(this._shareLobby, Date.now());
    this._sharePublish({ t: 'lobby', lobby: publicShareLobby(this._shareLobby) });
  }

  _noteShareSetup() {
    if (!this._shareLobby || this.mpRole !== 'host' || this._shareLobby.started || this.netMode) return;
    const nextMode = this.ui.selectedMode || 'campaign';
    const cap = nextMode === 'labyrinth' ? 3 : 4;
    if (this._shareLobby.seats.length > cap) {
      this.ui.showBanner('The Labyrinth holds three commanders. Free a seat before switching.', 'bad', 4200);
      this.ui.applySetupMode(this._shareLobby.mode);
      this._shareSig = '';
      this._renderShareHost();
      return;
    }
    this._shareLobby = clearGuestReady({
      ...this._shareLobby,
      mode: this.ui.selectedMode || 'campaign',
      level: this.ui.selectedLevel || 1,
      difficulty: this.ui.selectedDiff || 'normal',
      maxPlayers: (this.ui.selectedMode || 'campaign') === 'labyrinth' ? 3 : 4,
    }, Date.now());
    this._shareSig = '';
    this._sharePublishLobby();
    this._renderShareHost();
  }

  _sealShareLobby() {
    if (!this._shareLobby || this.mpRole !== 'host' || this._shareLobby.started) return;
    for (const [id, peer] of [...(this._shareHands || [])]) {
      if (peer.open) continue;
      peer.shareDropped = true;
      this._shareHands.delete(id);
      try { peer.destroy(); } catch { /* handshake already dead */ }
      this._shareLobby = releaseGuest(this._shareLobby, id, Date.now());
      this._sharePublish({ t: 'reject', to: id, reason: 'started' });
    }
    this._shareLobby = markStarted(this._shareLobby, Date.now());
    this._sharePublishLobby();
  }

  _shareRoster() {
    return (this._shareLobby?.seats || []).map((seat, index) => {
      const view = shareSeatState(seat);
      return {
        seat: index + 1,
        name: seat.name,
        hero: seat.hero,
        host: !!seat.host,
        you: seat.id === this._shareSelf,
        ready: view.ready,
        unlockedLevel: seat.unlockedLevel || 1,
        state: view.state,
      };
    });
  }

  _shareSoloBlocked() {
    if (!this._shareHadGuest || !this._shareLobby || this._shareLobby.started) return false;
    return !(this._shareLobby.seats || []).some((seat) => !seat.host);
  }

  _shareRememberGuests() {
    if ((this._shareLobby?.seats || []).some((seat) => !seat.host)) {
      this._shareHadGuest = true;
      this._shareSoloConfirm = false;
    }
  }

  _shareGuestLabel(name, id) {
    const aliases = [this._shareHostLabel(), this._shareLobby?.hostName, this._publicName()].filter(Boolean);
    let label = name;
    for (const hostName of aliases) label = shareGuestName({ name: label, id, hostName });
    return label;
  }

  // A data channel that never opens does not close, so the seat stays and
  // Start waits forever. A later heartbeat replaces that handshake without
  // removing the seat. The gap keeps a slow ICE attempt from being restarted
  // on every 2s check-in.
  _shareKickLink(message) {
    if (!message?.from || this._shareLobby?.started) return;
    if (this._shareWebrtcFailed?.has(message.from)) return;
    if (this._shareLobby?.seats?.find((seat) => seat.id === message.from)?.transport === 'relay') return;
    const peer = this._shareHands?.get(message.from);
    if (peer?.open || peer?.relay || this._sharePendingJoins?.has(message.from)) return;
    const last = this._shareOfferAt?.get(message.from) || 0;
    if (last && Date.now() - last < 12000) return;
    void this._acceptShareGuest({
      ...message,
      t: 'join',
      claim: true,
      ready: true,
      rejoin: !!peer,
      protocolVersion: LOBBY_PROTOCOL_VERSION,
      clientVersion: CLIENT_VERSION,
    });
  }

  _shareSendPing(to) {
    if (!to || to === this._shareSelf) return;
    this._sharePublish({ t: 'ping', n: Date.now() % 1000000, to });
  }

  _shareFanBegin() {
    const payload = this._shareBeginPayload;
    if (!payload || !this._shareBeginNeed) return;
    this.peers.forEach((peer, index) => {
      const id = peer.shareId;
      if (!id || !this._shareBeginNeed.has(id) || this._shareBegan?.has(id)) return;
      const start = { ...payload, you: index + 1 };
      this._sharePublish({ t: 'begin', to: id, start });
      if (peer.open) peer.send({ t: 'start', ...start });
    });
  }

  _shareNoteBegan(id) {
    if (!this._shareBeginNeed?.has(id) || this._shareBegan?.has(id)) return;
    this._shareBegan.add(id);
    if ([...this._shareBeginNeed].every((guestId) => this._shareBegan.has(guestId))) void this._shareFinishBegin();
  }

  async _shareFinishBegin() {
    if (this._shareBeginFinished || !this._shareBeginPayload) return;
    this._shareBeginFinished = true;
    const { d, heroes, level, mode, culture, match } = this._shareBeginPayload;
    this._sealShareLobby();
    await this.startGame(d, null, { heroes, myPlayer: 0, role: 'host', level, mode, culture, match });
    this.startBarrier = false;
    this._netClockLast = performance.now();
    this.acc = 0;
    this.ui.setWaiting(false);
    this.ui.showBanner('⚔️ All players loaded — the war begins.', '', 2600);
  }

  _sharePollBegin() {
    if (!this._shareBeginNeed || this._shareBeginFinished) return;
    for (const id of [...this._shareBeginNeed]) {
      if (!this._shareLobby?.seats?.some((seat) => seat.id === id && !seat.host)) this._shareBeginNeed.delete(id);
    }
    if (!this._shareBeginNeed.size) {
      this._shareBeginNeed = null;
      this._shareBeginPayload = null;
      this.startBarrier = false;
      this._shareSig = '';
      this._renderShareHost();
      this.ui.showBanner('The guest left before entering. Press Start again to play alone.', '', 6000);
      return;
    }
    const missing = [...this._shareBeginNeed].filter((id) => !this._shareBegan?.has(id));
    if (!missing.length) {
      void this._shareFinishBegin();
      return;
    }
    if (!this._shareBeginReminded && Date.now() - this._shareBeginAt > 20000) {
      this._shareBeginReminded = true;
      const names = missing.map((id) => this._shareLobby?.seats?.find((seat) => seat.id === id)?.name || 'A guest');
      this.ui.showBanner(`${names.join(', ')} did not enter the match. Still waiting for their acknowledgement.`, 'bad', 8000);
      this._shareSig = '';
      this._renderShareHost();
    }
    this._shareFanBegin();
  }

  async _acceptShareBegin(start) {
    if (!start || this.mpRole === 'host') return;
    if (this._shareLobby?.started && !this.game && !start.snap) {
      this._sharePublish({ t: 'catchup' });
      return;
    }
    if (this._shareBeginAcked && this.game && this.netMode) {
      this._sharePublish({ t: 'began' });
      return;
    }
    if (this._shareBeginAcked) return;
    this._shareBeginAcked = true;
    try {
      this.ui.setWaiting(true, '⏳ Loading the shared battlefield…');
      const match = this._sharedMatch(start.match);
      if (start.snap) await this.startGame(start.snap.diff, null, { myPlayer: start.you, role: 'guest', match }, start.snap);
      else await this.startGame(start.d, null, { heroes: start.heroes, myPlayer: start.you, role: 'guest', level: start.level, mode: start.mode, culture: start.culture, match });
      this._sharePublish({ t: 'began' });
      if (this.net?.open) this.net.send({ t: 'startReady' });
      this.ui.setWaiting(true, '⏳ Loaded — waiting for host to begin…');
    } catch (error) {
      this._shareBeginAcked = false;
      this.ui.showBanner('Could not enter the match. Still trying.', 'bad', 4000);
      console.warn('share begin failed', error);
    }
  }

  _shareSendCatchup() {
    if (this.mpRole !== 'guest' || !this._shareLobby?.started || this.game || this._shareBeginAcked) return;
    const mine = this._shareLobby.seats?.find((seat) => seat.id === this._shareSelf && !seat.host);
    if (!mine) return;
    const now = Date.now();
    if (this._shareCatchupAt && now - this._shareCatchupAt < 2000) return;
    this._shareCatchupAt = now;
    this._sharePublish({ t: 'catchup' });
  }

  _shareRelayProven(id) {
    return !!(this._shareSawPing?.has(id) && this._shareSawPong?.has(id));
  }

  // One decision for the seat label and START. WebRTC wins when its own
  // ping comes back within a few seconds. Otherwise the realtime channel,
  // which already proved both directions, carries lockstep.
  _shareConsiderLink(id) {
    const seat = this._shareLobby?.seats?.find((entry) => entry.id === id && !entry.host);
    if (!seat || seat.linked || seat.transport) return;
    const peer = this._shareHands?.get(id);
    const since = this._shareSeatedAt?.get(id) || Number(seat.joinedAt) || Date.now();
    const webrtcUp = !!(peer && peer.open && !peer.relay && this._shareWebrtcPong?.has(id));
    if (webrtcUp) {
      this._shareMarkLinked(id, 'webrtc');
      return;
    }
    const waiting = !this._shareWebrtcFailed?.has(id) && Date.now() - since < SHARE_LINK_FALLBACK_MS;
    if (waiting) return;
    if (this._shareRelayProven(id)) this._shareUseRelay(id);
  }

  _shareMarkLinked(id, transport) {
    if (!this._shareLobby?.seats?.some((seat) => seat.id === id)) return;
    this._shareLobby = {
      ...this._shareLobby,
      seats: this._shareLobby.seats.map((seat) => (seat.id === id ? { ...seat, linked: true, transport } : seat)),
    };
    this._shareSig = '';
    this._sharePublishLobby();
    this._renderShareHost();
  }

  _shareUseRelay(id) {
    const seat = this._shareLobby?.seats?.find((entry) => entry.id === id);
    if (!seat || seat.transport === 'relay') {
      if (seat && !seat.linked) this._shareMarkLinked(id, 'relay');
      return;
    }
    const old = this._shareHands?.get(id);
    if (old && !old.relay) {
      old.onClose = null;
      try { old.destroy(); } catch { /* the data channel is not the match */ }
      this._shareHands.delete(id);
      const idx = this.peers.indexOf(old);
      if (idx >= 0 && !this.netMode) {
        this.peers.splice(idx, 1);
        this.guestHeroes.splice(idx, 1);
        this.guestNames.splice(idx, 1);
        this.guestCmdQueues.splice(idx, 1);
        this.peerUserIds.splice(idx, 1);
      }
    }
    const peer = createShareRelayPeer(id);
    peer._emit = (obj) => this._shareSendTo(id, obj);
    peer.onMessage = (incoming) => {
      if (incoming?.t === 'probe' || incoming?.t === 'probeAck') return;
      const idx = this.peers.indexOf(peer);
      if (idx >= 0) this._onHostMsg(idx, incoming);
    };
    peer.onOpen = () => this._bindSharePeer(peer, id);
    this._shareHands.set(id, peer);
    peer.markOpen();
    this._shareMarkLinked(id, 'relay');
  }

  _shareSendTo(to, body) {
    const chunkId = `${Date.now().toString(36)}-${(this._shareChunkSeq = (this._shareChunkSeq || 0) + 1)}`;
    for (const part of packShareLink(body, chunkId)) this._sharePublish({ t: 'link', to, ...part });
  }

  _shareAcceptLink(from, body) {
    if (!body) return;
    if (this.mpRole === 'host') {
      const peer = this._shareHands?.get(from);
      peer?.deliver?.(body);
      return;
    }
    if (this.net?.relay) {
      this.net.deliver(body);
      return;
    }
    this._shareInbox ??= [];
    this._shareInbox.push(body);
    this._ensureGuestRelay();
  }

  _ensureGuestRelay() {
    const mine = this._shareLobby?.seats?.find((seat) => seat.id === this._shareSelf);
    if (this.mpRole !== 'guest' || !mine?.linked || mine.transport !== 'relay') return;
    if (this.net?.relay) return;
    if (this.net) {
      this.net.onClose = null;
      try { this.net.destroy(); } catch { /* replaced by the relay */ }
      this.net = null;
    }
    const hostId = this._shareLobby.hostId;
    const net = createShareRelayPeer(hostId);
    net._emit = (obj) => this._shareSendTo(hostId, obj);
    net.onMessage = (incoming) => {
      if (incoming?.t === 'probe' || incoming?.t === 'probeAck') return;
      this._onGuestMsg(incoming);
    };
    net.onOpen = () => {
      this._shareRejoinArmed = false;
      this._shareLostAt = 0;
      try { net.send(this._heroPayload()); } catch { /* the next window still carries it */ }
    };
    this.net = net;
    this._attachNetDiagnostics(net);
    const queued = this._shareInbox || [];
    this._shareInbox = [];
    net.markOpen();
    for (const body of queued) net.deliver(body);
  }

  _shareOpenIds() {
    const openIds = new Set();
    for (const seat of this._shareLobby?.seats || []) if (!seat.host && seat.linked) openIds.add(seat.id);
    return openIds;
  }

  _shareCanLaunch() {
    if (!this._shareLobby || this._shareLobby.started) return true;
    const gate = shareLaunchReady(this._shareLobby, this._shareOpenIds());
    if (gate.ready) return true;
    if (gate.blockers.length) {
      const names = gate.blockers.map((seat) => seat.name).join(', ');
      this.ui.showBanner(`Level ${this._shareLobby.level} is still locked for ${names}.`, 'bad', 5200);
    } else if (gate.connecting) {
      this.ui.showBanner('Start unlocks when every friend is connected.', '', 4200);
    } else {
      this.ui.showBanner('Start unlocks when every friend marks Ready.', '', 4200);
    }
    this._shareSig = '';
    this._renderShareHost();
    return false;
  }

  _setShareReady(ready) {
    if (this.mpRole !== 'guest' || !this._shareCode) return;
    this._sharePublish({ t: 'ready', ready: !!ready });
  }

  _renderShareHost() {
    if (this.mpRole !== 'host' || !this._shareLobby || this.netMode) return;
    const name = this._publicName();
    const hostSeat = this._shareLobby.seats?.find((seat) => seat.host);
    if (hostSeat && hostSeat.name !== name) {
      this._shareLobby = withSeatHero(this._shareLobby, hostSeat.id, hostSeat.hero, name, Date.now());
      this._shareLobby = { ...this._shareLobby, hostName: name };
      this._sharePublishLobby();
    }
    for (const seat of this._shareLobby.seats || []) {
      if (seat.host) continue;
      const label = shareGuestName({ name: seat.name, id: seat.id, hostName: name });
      if (label === seat.name) continue;
      this._shareLobby = withSeatHero(this._shareLobby, seat.id, seat.hero, label, Date.now());
      this._sharePublishLobby();
    }
    const players = this._shareRoster();
    const gate = shareLaunchReady(this._shareLobby, this._shareOpenIds());
    const entering = !!(this._shareBeginNeed && !this._shareBeginFinished);
    const waitingOn = entering
      ? [...this._shareBeginNeed].filter((id) => !this._shareBegan?.has(id)).map((id) => this._shareLobby.seats?.find((seat) => seat.id === id)?.name || 'a guest')
      : [];
    const sig = `${JSON.stringify(players)}:${this._shareLobby.mode}:${this._shareLobby.level}:${this._shareLobby.difficulty}:${this._shareLobby.maxPlayers}:${gate.ready}:${String(this._shareRelay)}:${this._shareReach || ''}:${this._shareSoloConfirm ? 1 : 0}:${waitingOn.join(',')}`;
    if (sig === this._shareSig && this.ui.root.querySelector('#share-url')) return;
    this._shareSig = sig;
    this._shareRememberGuests();
    const blocked = players.length > 1 && !gate.ready;
    const soloLeft = this._shareSoloBlocked();
    const offline = this._shareReach === 'connecting' || this._shareReach === 'reconnecting';
    const status = entering
      ? `Waiting for ${waitingOn.join(', ')} to acknowledge the start. The match has not begun.`
      : offline
      ? "Can't reach room, reconnecting…"
      : gate.blockers.length
      ? `Level ${this._shareLobby.level} is locked for ${gate.blockers.map((seat) => seat.name).join(', ')}.`
      : gate.connectingSeats?.length
        ? `Waiting for ${gate.connectingSeats.map((seat) => seat.name).join(', ')} to connect.`
        : gate.notReady?.length
          ? `Waiting for ${gate.notReady.map((seat) => seat.name).join(', ')} to mark Ready.`
          : players.length > 1
            ? `${players.length} commanders in this siege. Start when you are ready.`
            : 'Invite link ready. Set the map and difficulty, then send it.';
    const startLabel = entering
      ? `WAITING FOR ${waitingOn.join(', ').toUpperCase()} TO ENTER`
      : soloLeft
      ? (this._shareSoloConfirm ? 'PRESS AGAIN — START ALONE' : 'GUEST LEFT — START ALONE')
      : shareStartLabel(players, gate, this.ui._startCopyFor(this._shareLobby.mode));
    this.ui.showShareHost({
      url: this._shareUrl,
      status: soloLeft && !entering ? 'Your friend left this lobby. Press Start again to play alone.' : status,
      launchReady: entering ? false : (soloLeft ? true : !blocked),
      startLabel,
      players,
      relay: this._shareRelay,
      level: this._shareLobby.level,
      mode: this._shareLobby.mode,
      difficulty: this._shareLobby.difficulty,
      maxPlayers: this._shareLobby.maxPlayers || 4,
    });
  }

  _reapShareSeats() {
    if (!this._shareLobby || this.mpRole !== 'host' || this._shareLobby.started || this.netMode) return;
    const result = reapStaleSeats(this._shareLobby, Date.now(), {
      openIds: this._shareOpenIds(),
      presentIds: this._sharePresentIds || null,
    });
    if (!result.dropped.length) return;
    for (const seat of result.dropped) this._dropShareHand(seat.id);
    this._shareLobby = result.lobby;
    this._shareSig = '';
    this._renderShareHost();
  }

  _dropShareHand(id) {
    const peer = this._shareHands?.get(id);
    if (!peer) return;
    peer.shareDropped = true;
    this._shareHands.delete(id);
    const idx = this.peers.indexOf(peer);
    if (idx >= 0 && !this.netMode) {
      this.peers.splice(idx, 1);
      this.guestHeroes.splice(idx, 1);
      this.guestNames.splice(idx, 1);
      this.guestCmdQueues.splice(idx, 1);
      this.peerUserIds.splice(idx, 1);
    }
    try { peer.destroy(); } catch { /* already closed */ }
  }

  _onShareMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.t !== 'lobby' && message.id) {
      if (this._shareSeen?.has(message.id)) return;
      this._shareSeen = this._shareSeen || new Set();
      this._shareSeen.add(message.id);
    }
    if (message.from && message.from === this._shareSelf && message.t !== 'lobby') return;
    // A reloaded tab can be handed the mailbox backlog, including the original
    // begin. That would start a second sim at frame 0. Only messages from this
    // page's own lifetime are live; the host snapshot covers the rest.
    if (this.mpRole !== 'host' && message.t !== 'lobby' && this._sharePageAt && Number(message.at || 0) < this._sharePageAt) return;
    if (message.t === 'lobby' && message.lobby && this.mpRole !== 'host') this._onShareLobby(message.lobby);
    else if (message.t === 'join' && this.mpRole === 'host') this._acceptShareGuest(message);
    else if (message.t === 'offer' && this.mpRole === 'guest') this._acceptShareOffer(message);
    else if (message.t === 'answer' && this.mpRole === 'host') {
      this._shareLobby = touchSeatActivity(this._shareLobby, message.from, Date.now());
      this._acceptShareAnswer(message);
    }
    else if (message.t === 'ice') {
      if (this.mpRole === 'host') this._shareLobby = touchSeatActivity(this._shareLobby, message.from, Date.now());
      this._acceptShareIce(message);
    }
    else if (message.t === 'reject' && message.to === this._shareSelf) this._failShare(message.reason || 'invalid');
    else if (message.t === 'begin' && this.mpRole !== 'host' && (!message.to || message.to === this._shareSelf)) {
      void this._acceptShareBegin(message.start);
    }
    else if (message.t === 'began' && this.mpRole === 'host' && message.from) {
      this._shareNoteBegan(message.from);
    }
    else if ((message.t === 'catchup' || message.t === 'snap') && this.mpRole === 'host' && message.from && this.game && !this.game.over && this.netMode) {
      const idx = this.peers.findIndex((peer) => peer.shareId === message.from);
      if (idx >= 0) this._sendGuestResync(idx);
    }
    else if (message.t === 'ping') {
      if (message.to && message.to !== this._shareSelf) return;
      this._sharePublish({ t: 'pong', n: message.n, to: message.from });
      if (this.mpRole === 'host' && message.from) {
        this._shareSawPing ??= new Set();
        this._shareSawPing.add(message.from);
        this._shareConsiderLink(message.from);
      }
    }
    else if (message.t === 'pong') {
      if (message.to !== this._shareSelf || !message.from) return;
      this._shareSawPong ??= new Set();
      this._shareSawPong.add(message.from);
      if (this.mpRole === 'host') this._shareConsiderLink(message.from);
    }
    else if (message.t === 'link' && message.to === this._shareSelf) {
      this._shareChunks ??= new Map();
      const body = unpackShareLink(this._shareChunks, message);
      if (!body) return;
      this._shareAcceptLink(message.from, body);
    }
    else if (message.t === 'here' && this.mpRole === 'host' && message.from) {
      this._shareLobby = touchSeatActivity(this._shareLobby, message.from, Date.now());
      const label = this._shareGuestLabel(message.name, message.from);
      const seat = this._shareLobby?.seats?.find((entry) => entry.id === message.from);
      if (seat && label && seat.name !== label) {
        this._shareLobby = withSeatHero(this._shareLobby, message.from, seat.hero, label, Date.now());
        this._shareSig = '';
        this._sharePublishLobby();
        this._renderShareHost();
      }
      this._shareKickLink(message);
    }
    else if (message.t === 'ready' && this.mpRole === 'host') {
      this._shareLobby = touchSeatActivity(setSeatReady(this._shareLobby, message.from, message.ready, Date.now()), message.from, Date.now());
      this._shareSig = '';
      this._sharePublishLobby();
      this._renderShareHost();
    }
    else if (message.t === 'leave' && this.mpRole === 'host') this._dropShareGuest(message.from);
  }

  _onShareLobby(lobby) {
    if (!lobby || lobby.code !== this._shareCode) return;
    this._shareReceivedAt = Date.now();
    this._shareLobby = lobby;
    const decision = admitGuest(lobby, { id: this._shareSelf }, this._shareReceivedAt, {
      receivedAt: this._shareReceivedAt,
      hostPresent: !!this._shareHostPresent,
    });
    if (!decision.ok) {
      if (this.net?.open || this.netMode) return;
      this._failShare(decision.reason);
      return;
    }
    clearTimeout(this._shareDiscover);
    if (!(lobby.seats || []).some((seat) => seat.id === this._shareSelf)) this._shareAnnounced = false;
    if (!this._shareAnnounced) {
      this._shareAnnounced = true;
      this._shareJoinedAt = Date.now();
      this.audio?.init();
      this._sharePublish({
        t: 'join', name: this._shareDisplayName(), hero: this.ui.selectedHero || 'scott', claim: true,
        protocolVersion: LOBBY_PROTOCOL_VERSION, clientVersion: CLIENT_VERSION,
        unlockedLevel: highestUnlockedLevel(this.profile?.campaign),
        ready: true,
        // A fresh page that opens a siege already in progress has no armed
        // rejoin flag. The host still has to replace the dead data channel.
        rejoin: !!(lobby.started || this._shareRejoinArmed || (this.netMode && !this.net?.open)),
      });
      this._shareSendPing(lobby.hostId);
    }
    if (!this._shareGuestShown) {
      this._shareGuestShown = true;
      this.ui.showSetup({ mode: lobby.mode || 'campaign', share: true });
    }
    if (!this.netMode) {
      this.ui.selectedLevel = lobby.level || 1;
      this.ui.selectedDiff = lobby.difficulty || 'normal';
      this.ui.setRoomSettings({
        level: lobby.level || 1,
        difficulty: lobby.difficulty || 'normal',
        isHost: false,
        mode: lobby.mode || 'campaign',
      });
    }
    const players = shareRoster(lobby, this._shareSelf);
    const sig = `${JSON.stringify(players)}:${lobby.mode}:${lobby.level}:${lobby.difficulty}:${lobby.maxPlayers}:${this.net?.open ? 'open' : 'wait'}`;
    this._ensureGuestRelay?.();
    if (this.netMode && this.game) return;
    if (this._shareGuestShown && sig === this._shareSig) return;
    this._shareSig = sig;
    const mine = lobby.seats.find((seat) => seat.id === this._shareSelf);
    const locked = (lobby.mode || 'campaign') === 'campaign' && (mine?.unlockedLevel || 1) < (lobby.level || 1);
    if (!this._shareSeatAskedAt) this._shareSeatAskedAt = Date.now();
    if (mine) this._shareSeatAskedAt = 0;
    const waitingForSeat = !mine && Date.now() - (this._shareSeatAskedAt || Date.now()) > 8000;
    const rejoining = !!lobby.started && !this.game;
    this.ui.showShareGuest({
      status: locked
        ? 'This mission is still locked for you. The host can pick an earlier one.'
        : rejoining ? 'Rejoining the match…'
        : mine ? `You're in as ${mine.name}. The host starts the match.`
        : this._shareReach === 'reconnecting' ? "Can't reach room, reconnecting…"
        : waitingForSeat ? 'No response to the seat request yet. Retrying.'
        : 'Sending your seat request…',
      players, level: lobby.level, mode: lobby.mode, difficulty: lobby.difficulty,
      maxPlayers: lobby.maxPlayers || 4,
      ready: !!mine?.ready,
      rejoining,
    });
    this._ensureGuestRelay?.();
  }

  async _acceptShareGuest(message) {
    if (this.mpRole !== 'host' || !this._shareLobby || !shareId(message.from)) return;
    const guestName = this._shareGuestLabel(message.name, message.from);
    if (message.rejoin) {
      this._shareSeatedAt ??= new Map();
      this._shareSeatedAt.set(message.from, Date.now());
      this._shareSawPing?.delete(message.from);
      this._shareSawPong?.delete(message.from);
      this._shareWebrtcPong?.delete(message.from);
      this._shareWebrtcFailed?.delete(message.from);
      if (this._shareLobby?.seats) {
        this._shareLobby = {
          ...this._shareLobby,
          seats: this._shareLobby.seats.map((seat) => (seat.id === message.from ? { ...seat, linked: false, transport: '' } : seat)),
        };
      }
    }
    if (this._shareHands?.has(message.from)) {
      const peer = this._shareHands.get(message.from);
      this._shareLobby = touchSeatActivity(withSeatHero(this._shareLobby, message.from, message.hero, guestName, Date.now()), message.from, Date.now());
      // A live hero change keeps the open channel. A rejoin replaces it even
      // when the old channel has not reported closed yet.
      if (peer?.open && !message.rejoin) {
        const idx = this.peers.indexOf(peer);
        if (idx >= 0) {
          this.guestHeroes[idx] = shareHero(message.hero);
          this.guestNames[idx] = guestName;
        }
        this._shareSig = '';
        this._sharePublishLobby();
        this._renderShareHost();
        return;
      }
      this._dropShareHand(message.from);
    }
    const decision = admitGuest(this._shareLobby, {
      id: message.from, claim: true,
      protocolVersion: message.protocolVersion, clientVersion: message.clientVersion,
    }, Date.now());
    if (!decision.ok) {
      this._sharePublish({ t: 'reject', to: message.from, reason: decision.reason });
      return;
    }
    if (!decision.rejoining) {
      this._shareLobby = seatGuest(this._shareLobby, {
        id: message.from, name: guestName, hero: message.hero, ready: !!message.ready, claim: true,
        protocolVersion: message.protocolVersion, clientVersion: message.clientVersion,
        unlockedLevel: message.unlockedLevel,
      }, Date.now()).lobby;
    } else {
      this._shareLobby = withSeatHero(this._shareLobby, message.from, message.hero, guestName, Date.now());
    }
    if (message.ready) this._shareLobby = setSeatReady(this._shareLobby, message.from, true, Date.now());
    this._shareSeatedAt ??= new Map();
    if (!this._shareSeatedAt.has(message.from)) this._shareSeatedAt.set(message.from, Date.now());
    this._shareSendPing(message.from);
    this._sharePendingJoins ||= new Set();
    if (this._sharePendingJoins.has(message.from)) return;
    this._sharePendingJoins.add(message.from);
    const generation = this._shareGeneration;
    const ice = this.lobby?.iceServers?.length ? this.lobby.iceServers : await (this._shareIcePromise || loadShareIceServers());
    this._sharePendingJoins.delete(message.from);
    const liveMatch = !!(this._shareLobby?.started && this.netMode && this.game && !this.game.over);
    if (generation !== this._shareGeneration || !this._shareLobby || !this._shareLobby.seats.some(s => s.id === message.from)) return;
    if (this._shareLobby.started && !liveMatch) return;
    if (this._shareLobby.seats.find((seat) => seat.id === message.from)?.transport === 'relay') return;
    const peer = new NetSession(ice);
    peer.shareId = message.from;
    this._shareHands.set(message.from, peer);
    this._attachNetDiagnostics(peer);
    peer.onOpen = () => {
      this._bindSharePeer(peer, message.from);
      try { peer.send({ t: 'probe', n: 1 }); } catch { /* channel closed */ }
    };
    peer.onMessage = (incoming) => {
      if (incoming?.t === 'probe') { try { peer.send({ t: 'probeAck', n: incoming.n }); } catch { /* ignore */ } return; }
      if (incoming?.t === 'probeAck') {
        this._shareWebrtcPong ??= new Set();
        this._shareWebrtcPong.add(message.from);
        this._shareConsiderLink(message.from);
        return;
      }
      const idx = this.peers.indexOf(peer);
      if (idx >= 0) this._onHostMsg(idx, incoming);
    };
    peer.onClose = () => {
      if (this._shareHands?.get(message.from) !== peer || peer.relay) return;
      this._shareWebrtcFailed ??= new Set();
      this._shareWebrtcFailed.add(message.from);
      this._shareHands.delete(message.from);
      this._shareConsiderLink(message.from);
    };
    peer.onIce = (cand) => this._sharePublish({ t: 'ice', to: message.from, cand });
    try {
      const sdp = await peer.hostTrickle();
      if (!this._shareHands?.has(message.from)) return;
      if (this._shareLobby?.started && !(this.netMode && this.game && !this.game.over)) return;
      this._sharePublish({ t: 'offer', to: message.from, sdp });
      this._shareOfferAt ??= new Map();
      this._shareOfferAt.set(message.from, Date.now());
      this._shareSig = '';
      this._sharePublishLobby();
      this._renderShareHost();
    } catch {
      this._shareWebrtcFailed ??= new Set();
      this._shareWebrtcFailed.add(message.from);
      if (this._shareHands?.get(message.from) === peer) this._shareHands.delete(message.from);
      peer.onClose = null;
      try { peer.destroy(); } catch { /* ignore */ }
      this._shareConsiderLink(message.from);
    }
  }

  _bindSharePeer(peer, id) {
    if (this.peers.includes(peer)) return;
    if (this._shareLobby?.started || this.netMode) {
      if (!this.game || this.game.over) {
        this._shareHands?.delete(id);
        try { peer.destroy(); } catch { /* ignore */ }
        return;
      }
      let idx = this.peers.findIndex((entry) => entry.shareId === id);
      if (idx >= 0) {
        const old = this.peers[idx];
        if (old && old !== peer) { try { old.destroy(); } catch { /* already dead */ } }
        this.peers[idx] = peer;
        this.guestCmdQueues[idx] = [];
      } else {
        const seat = this._shareLobby.seats.find((entry) => entry.id === id);
        this.peers.push(peer);
        this.guestHeroes.push(shareHero(seat?.hero));
        this.guestNames.push(seat?.name || 'Commander');
        this.guestCmdQueues.push([]);
        this.peerUserIds.push(null);
        idx = this.peers.length - 1;
      }
      peer.send({
        t: 'resync', snap: this.game.snapshot(), you: idx + 1, frame: this.simFrame, match: this._sharedMatchFields(),
      });
      this.ui.showBanner(`${this.guestNames[idx] || 'A friend'} reconnected.`, '', 2500);
      return;
    }
    const previous = this.peers.findIndex((entry) => entry.shareId === id && entry !== peer);
    if (previous >= 0) {
      this.peers.splice(previous, 1);
      this.guestHeroes.splice(previous, 1);
      this.guestNames.splice(previous, 1);
      this.guestCmdQueues.splice(previous, 1);
      this.peerUserIds.splice(previous, 1);
    }
    const seat = this._shareLobby.seats.find((entry) => entry.id === id);
    this.peers.push(peer);
    this.guestHeroes.push(shareHero(seat?.hero));
    this.guestNames.push(seat?.name || 'Commander');
    this.guestCmdQueues.push([]);
    this.peerUserIds.push(null);
    peer.send({ t: 'lobby', n: this.peers.length + 1, players: this._shareRoster() });
    this._shareSig = '';
    this._sharePublishLobby();
    this._renderShareHost();
  }

  async _acceptShareOffer(message) {
    if (message.to !== this._shareSelf || this._shareOffered === message.id) return;
    // A reloaded page replays the mailbox, including the offer from the
    // previous handshake. Ignore anything older than this join.
    if (this._shareJoinedAt && Number(message.at || 0) < this._shareJoinedAt) return;
    if (!this._shareLobby || message.from !== this._shareLobby.hostId) return;
    const rejoining = !!(this._shareLobby.started || this.netMode);
    if (rejoining && !this._shareLobby.seats?.some((seat) => seat.id === this._shareSelf)) return;
    if (this.net?.open) return;
    const generation = this._shareGeneration;
    this._shareOffered = message.id;
    if (this.net) {
      try { this.net.destroy(); } catch { /* replace a dead handshake */ }
    }
    const ice = this.lobby?.iceServers?.length ? this.lobby.iceServers : await (this._shareIcePromise || loadShareIceServers());
    if (generation !== this._shareGeneration || this._shareOffered !== message.id) return;
    const net = new NetSession(ice);
    this.net = net;
    this._attachNetDiagnostics(net);
    net.onOpen = () => {
      this._shareRejoinArmed = false;
      this._shareLostAt = 0;
      this._shareHandshakeUntil = 0;
      net.send(this._heroPayload());
      try { net.send({ t: 'probe', n: 1 }); } catch { /* channel closed */ }
    };
    net.onMessage = (incoming) => {
      if (incoming?.t === 'probe') { try { net.send({ t: 'probeAck', n: incoming.n }); } catch { /* ignore */ } return; }
      if (incoming?.t === 'probeAck') return;
      this._onGuestMsg(incoming);
    };
    net.onClose = () => {
      if (this.net !== net) return;
      if (this._shareLobby?.seats?.find((seat) => seat.id === this._shareSelf)?.transport === 'relay') return;
      this._onShareLinkLost();
    };
    net.onIce = (cand) => this._sharePublish({ t: 'ice', to: message.from, cand });
    try {
      const sdp = await net.joinTrickle(message.sdp);
      if (this.net !== net) return;
      this._sharePublish({ t: 'answer', to: message.from, sdp });
    } catch {
      this._shareHandshakeUntil = 0;
      if (this.net === net) {
        this.net = null;
        net.onClose = null;
        try { net.destroy(); } catch { /* webrtc is unavailable; the realtime relay still carries the match */ }
      }
    }
  }

  _acceptShareAnswer(message) {
    if (message.to !== this._shareSelf) return;
    const peer = this._shareHands?.get(message.from);
    if (peer) peer.acceptReply(message.sdp).catch(() => {});
  }

  _acceptShareIce(message) {
    if (message.to !== this._shareSelf) return;
    const peer = this.mpRole === 'host' ? this._shareHands?.get(message.from) : this.net;
    if (peer) peer.addIce(message.cand);
  }

  _dropShareGuest(id) {
    if (!this._shareLobby) return;
    if (this._shareLobby.started || this.netMode) {
      const peer = this._shareHands?.get(id);
      const idx = peer ? this.peers.indexOf(peer) : -1;
      if (idx >= 0 && this.game && !this.game.over && peer && !peer.shareNotified) {
        peer.shareNotified = true;
        this.game.msg(`⚠️ ${this.guestNames[idx] || `Player ${idx + 2}`} disconnected — their hero fights on.`, 'warn');
      }
      return;
    }
    const peer = this._shareHands?.get(id);
    if (peer?.shareDropped) return;
    if (peer) {
      peer.shareDropped = true;
      this._shareHands.delete(id);
      const idx = this.peers.indexOf(peer);
      if (idx >= 0) {
        this.peers.splice(idx, 1);
        this.guestHeroes.splice(idx, 1);
        this.guestNames.splice(idx, 1);
        this.guestCmdQueues.splice(idx, 1);
        this.peerUserIds.splice(idx, 1);
      }
      try { peer.destroy(); } catch { /* already closed */ }
    }
    this._shareLobby = releaseGuest(this._shareLobby, id, Date.now());
    this._shareSig = '';
    this._sharePublishLobby();
    this._renderShareHost();
  }

  _failShare(reason) {
    if (this._shareFailed) return;
    this._shareFailed = true;
    this._teardownShare();
    this.mpRole = null;
    this.ui.showShareNotice({ title: 'Could not join', copy: shareFailureCopy(reason), tone: 'bad' });
  }

  _leaveShareLink() {
    if (this.netMode && this.game && !this.game.over) return;
    if (this.mpRole === 'host' && this._shareLobby && !this._shareLobby.started) {
      this._shareLobby = closeLobby(this._shareLobby, Date.now());
      this._sharePublishLobby();
    } else if (this.mpRole === 'guest' && this._shareCode) {
      this._sharePublish({ t: 'leave' });
    }
    const hosted = this.mpRole === 'host';
    try { sessionStorage.removeItem('zillions.share.host'); } catch { /* private mode */ }
    try { if (hosted) history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
    this._teardownShare();
    if (hosted && this._tab?.ownsLease()) {
      this._tab.release();
      this._tab.touch();
    }
    this.ui._shareLive = false;
    this.ui.root?.querySelector?.('#screen-setup')?.classList.remove('sharemode');
    if (!this.netMode) this.mpRole = null;
    if (this.auth?.isSignedIn() || chapterFounder(this.profile) || this.profile.quickSetupDone) this.ui._showScreen('main');
    else this.ui._showScreen('account');
  }

  _onShareLinkLost() {
    this._shareRejoinArmed = true;
    if (this.netMode && this.game && !this.game.over && !this._shareLostAt) this._shareLostAt = Date.now();
    this._shareHandshakeUntil = 0;
    this._shareRejoinTick();
  }

  // Heartbeat calls this until the data channel is open again or grace ends.
  // One join is not enough: the host may still see the old channel as open,
  // and a dropped signaling message must not end the grace period.
  _shareRejoinTick() {
    const inMatch = !!(this.netMode && this.game && !this.game.over);
    if (inMatch && !this._shareLostAt) this._shareLostAt = Date.now();
    const step = shareRejoinStep({
      open: !!this.net?.open,
      inMatch,
      lostAt: this._shareLostAt || 0,
      now: Date.now(),
      hostAlive: !!(this._shareLobby && hostStillHere(this._shareLobby, Date.now(), this._shareLiveness())),
      armed: !!this._shareRejoinArmed || inMatch,
    });
    if (step === 'stop') {
      this._shareRejoinArmed = false;
      this._shareLostAt = 0;
      return;
    }
    if (step === 'giveUp') {
      this._shareRejoinArmed = false;
      this.pause();
      this.ui.setWaiting(false);
      this.ui.showBanner('Could not rejoin the host. Open the same invite from this tab while the seat is held.', 'bad', 8000);
      return;
    }
    if (step === 'hostLeft') {
      this._shareRejoinArmed = false;
      if (!this._shareFailed && !this.netMode) this._failShare('host_left');
      return;
    }
    if (step !== 'retry') return;
    if (inMatch) this.ui.setWaiting(true, 'Reconnecting to the host…');
    this._shareRetryJoin();
  }

  _shareRetryJoin() {
    const now = Date.now();
    if (this._shareHandshakeUntil && now < this._shareHandshakeUntil) return;
    this._shareHandshakeUntil = now + 8000;
    this._shareAnnounced = false;
    this._shareOffered = null;
    if (this._shareLobby) this._onShareLobby(this._shareLobby);
  }

  _teardownShare() {
    this._shareGeneration = (this._shareGeneration || 0) + 1;
    this._sharePendingJoins?.clear();
    this._stopShareHeartbeat();
    clearTimeout(this._shareDiscover);
    this._shareDiscover = null;
    for (const unsub of this._shareUnsubs || []) {
      try { unsub(); } catch { /* ignore */ }
    }
    this._shareUnsubs = [];
    this._shareHubList = [];
    if (!this.netMode) {
      for (const peer of this._shareHands?.values() || []) {
        peer.shareDropped = true;
        try { peer.destroy(); } catch { /* ignore */ }
      }
      this._shareHands = new Map();
      if (this.net && !this.game) {
        try { this.net.destroy(); } catch { /* ignore */ }
        this.net = null;
      }
      if (!this.game) {
        this.peers = [];
        this.guestHeroes = [];
        this.guestNames = [];
        this.guestCmdQueues = [];
        this.peerUserIds = [];
      }
    }
    this._shareLobby = null;
    this._shareCode = null;
    this._shareAnnounced = false;
    this._shareGuestShown = false;
    this._shareSig = '';
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
      await this._acceptShareBegin(m);
    }
    else if (m.t === 'spectateStart') {
      await this.startGame(m.snap.diff, null, { myPlayer: 0, role: 'spectator' }, m.snap);
      this.simFrame = m.frame;
      this.netPrimed = false;
      this.net.send({ t: 'spectateReady', frame: m.frame });
      this.ui.showBanner('Watching live — camera controls work, battle controls are read-only.', '', 5000);
    }
    else if (m.t === 'resync') {
      // Mid-game rejoin: the host froze one sim tick into a snapshot; rebuild
      // from it, then pick up lockstep at the host's frame counter using the
      // windows banked while the sim was rebuilding. A second snapshot while
      // that rebuild is in flight would restart it and drop the banked windows.
      // A rebuild that never finishes used to leave this flag set, which then
      // refused every later snapshot and froze the guest on the same window.
      if (this._resyncing && performance.now() - (this._resyncStarted || 0) < 8000) return;
      this._resyncing = true;
      this._resyncStarted = performance.now();
      this._resyncBuffer = new Map();
      for (const [pw, pc] of m.recent || []) if (pw != null && pc) this._resyncBuffer.set(pw, pc);
      this.startGame(m.snap.diff, null, { myPlayer: m.you, role: 'guest', match: this._sharedMatch(m.match) }, m.snap)
        .then(() => {
          const buf = this._resyncBuffer || new Map();
          const next = Math.ceil(m.frame / NET_STEP);
          for (const k of [...buf.keys()]) { if (k < next) buf.delete(k); }
          this.simFrame = m.frame;
          this.inbox = buf;
          this.netPrimed = false;
          this.desynced = false;
          this._desyncAttempts = [];
          this._reconnectTries = 0;
          this._reconnectSince = 0;
          this._shareLostAt = 0;
          clearTimeout(this._reconnectT);
          this.ui.setWaiting(false);
          this.ui.showBanner(m.reason === 'desync' ? 'Battlefield restored from the host.' : '🔌 Reconnected — back in the war.', '', 3500);
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
    if (this._resyncing || !this.net || !['guest', 'spectator'].includes(this.mpRole)) return;
    const now = performance.now();
    if (this._missingWindow === w && now - this._missingRequestAt < 180) return;
    this._missingWindow = w;
    this._missingRequestAt = now;
    this.net.send({ t: 'needWindow', w });
  }

  // Host snapshot, same message a reload receives when its relay peer opens.
  _sendGuestResync(idx) {
    const peer = this.peers[idx];
    if (!peer || !this.game || this.game.over || !this.netMode) return;
    const now = Date.now();
    if (peer._resyncAt && now - peer._resyncAt < 1000) return;
    peer._resyncAt = now;
    const recent = [...this._windowHistory.entries()].slice(-32);
    peer.send({
      t: 'resync', snap: this.game.snapshot(), you: idx + 1, frame: this.simFrame,
      match: this._sharedMatchFields(), recent,
    });
  }

  _askForSnapshot(force) {
    if (this.mpRole !== 'guest' || !this._shareCode) return;
    if (this._resyncing) {
      if (performance.now() - (this._resyncStarted || 0) < 8000) return;
      this._resyncing = false;
      this._resyncBuffer = null;
    }
    const now = Date.now();
    if (this._snapAskAt && now - this._snapAskAt < (force ? 800 : 1000)) return;
    this._snapAskAt = now;
    this._sharePublish({ t: 'snap' });
    try { this.net?.send?.({ t: 'snap' }); } catch { /* the share publish is enough */ }
  }

  _trackStall(stalled, windowId) {
    if (this.mpRole !== 'guest') return;
    if (!stalled || windowId < 0) {
      this._stallSince = 0;
      this._stallWindow = -1;
      this._stallRetried = false;
      return;
    }
    const now = performance.now();
    if (this._stallWindow !== windowId || !this._stallSince) {
      this._stallWindow = windowId;
      this._stallSince = now;
      this._stallRetried = false;
      this._missingRequestAt = 0;
      this._requestMissingWindow(windowId);
      return;
    }
    const action = stallRecovery(now - this._stallSince, this._stallRetried);
    if (action === 'retry-snapshot') {
      this._stallRetried = true;
      this._missingRequestAt = 0;
      this._requestMissingWindow(windowId);
      this._askForSnapshot(false);
      return;
    }
    if (action === 'snapshot') this._askForSnapshot(false);
    else if (action === 'resync') this._askForSnapshot(true);
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
    if (this.mpRole === 'guest' || this.mpRole === 'spectator') {
      const banked = this._windowsBuffered();
      if (banked < this.netBufferTarget) dt *= NET_PACE_SLOW;
      else if (banked >= this.netBufferTarget + 2) dt *= NET_PACE_FAST;
    }

    this.acc += dt;
    let steps = 0;
    let stalled = false;
    let missingWindow = -1;
    while (this.acc >= SIM_DT && steps < 10) {
      if (this.simFrame % NET_STEP === 0) {
        const w = this.simFrame / NET_STEP;
        let bundle;
        if (this.mpRole === 'host') {
          this._startPendingSpectators();
          bundle = [...this.outbox];
          this.outbox = [];
          for (const q of this.guestCmdQueues) { bundle.push(...q); q.length = 0; }
          // Each packet repeats the last few windows: on the unordered
          // channel a late/lost packet is healed by the next one instead of
          // freezing every guest.
          this._broadcastFast({ t: 'w', w, c: bundle, p: this._recentWindows.slice() });
          this._broadcastSpectators({ t: 'w', w, c: bundle, p: [] });
          this._recentWindows.push([w, bundle]);
          if (this._recentWindows.length > NET_REDUNDANCY) this._recentWindows.shift();
          rememberWindow(this._windowHistory, w, bundle, NET_HISTORY);
        } else {
          bundle = this.inbox.get(w);
          if (!bundle) {
            // A real gap. Re-arm the buffer so we come back with margin
            // instead of running window-to-window and stuttering forever.
            stalled = true;
            missingWindow = w;
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
          this._hashLog ??= [];
          this._hashLog.push([this.simFrame, hsh]);
          if (this._hashLog.length > 40) this._hashLog.shift();
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
    this._trackStall?.(stalled, missingWindow);
    const stallAge = this._stallSince ? performance.now() - this._stallSince : 0;
    const visibleStall = stalled && (this.netStallT > 0.25 || stallAge > 250);
    const stallText = stallAge >= 10000
      ? '⏳ Resyncing…'
      : this.netStallT > 1.2
        ? `⏳ Network catch-up — waiting for window ${Math.ceil(this.simFrame / NET_STEP)}…`
        : '⏳ Syncing co-op…';
    this.ui.setWaiting(visibleStall, stallText);
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

  async _openFriendParty() {
    try {
      if (!this.authStatus?.signedIn) throw new Error('Sign in to play with friends.');
      if (!this.profile.mmoCharacters?.length) throw new Error('Create your chapter founder first.');
      const lobby=await this._openLobby();
      if (!lobby?.connected) throw new Error('The lobby is unavailable. Retry when your connection recovers.');
      const client=new FriendParty(lobby.sb);
      showFriendParty({client,userId:lobby.me.id,code:partyCode(location.search)||sessionStorage.getItem('zillions-party-invite')||'',
        onJoined:()=>{sessionStorage.removeItem('zillions-party-invite');const url=new URL(location.href);url.searchParams.delete('party');history.replaceState(null,'',url);},
        hostRoom:async party=>{
          if(this.netMode)throw new Error('Finish or leave your current match first.');
          if(lobby.game)throw new Error('Leave your current room before opening the next match.');
          await this.createOnlineGame('private');
          if(!lobby.game || this.mpRole!=='host')throw new Error('Could not open the room. Retry.');
          try {await party.act('room',{room:lobby.game.id});}
          catch(error){await this._leaveOnlineRoom();throw error;}
        },
        joinRoom:async room=>{
          if(this.netMode)throw new Error('You are already in a match. Close this panel to return.');
          if(lobby.game?.id===room.id){this.ui.showSetup({online:lobby.game,mode:lobby.game.mode});this._onRoomUpdate(lobby.game);return;}
          if(lobby.game)throw new Error('Leave your current room before joining the party room.');
          const row=await lobby.findByCode(room.code);
          if(!row)throw new Error('That room has ended. Ask the leader to host the next match.');
          if(row.host_id===lobby.me.id)throw new Error('Your hosted room belongs to another tab. Return there or close it before hosting again.');
          await this.joinOnlineGame(row);
          if(!lobby.game || lobby.game.id!==room.id)throw new Error('Could not join. The match may have started or your game needs a refresh.');
        }});
    } catch(error){this.ui.showBanner(error.message||'Could not open your party.','bad',6000);}
  }

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
    this.lobby.ownsRoom = () => {
      const lease = this._tabSession().lease();
      return !!(lease && lease.kind === 'room' && this._tabSession().ownsLease());
    };
    this.lobby.onHeartbeat = () => this._tabSession().refreshLease();
    this.lobby.connectedSeatIds = () => (this.peerUserIds || []).filter((id, index) => id && this.peers[index]?.open);
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
      maxPlayers: game.max_players || 4,
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
      text: roomStartLabel({
        compatible, ready, pending, waiting, connectionNames, expectedPlayers, blockers: eligibility.blockers,
      }),
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
    this.ui._startActivated = false;
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
    // Match state (lockstep, scene, ticket, input) must not survive room closure.
    // Use the same clean menu boot as the host's explicit end-match action.
    // The account and persistent friend party are restored on startup.
    if (this.netMode) return location.reload();
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
      this._releaseRoomLease();
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
    this._noteShareSetup();
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

  playArcadeMap(map) {
    if (!map) return;
    this.ui.selectedMode = map.mode || 'campaign';
    this.ui.selectedLevel = Number(map.level) || 1;
    this.ui.showSetup({ mode: this.ui.selectedMode });
    this.ui.setRoomSettings({
      level: this.ui.selectedLevel,
      difficulty: 'normal',
      isHost: true,
      mode: this.ui.selectedMode,
    });
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
    if (!this._claimRoomLease()) return;
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
      this._releaseRoomLease();
      this.mpRole = null; this.onlineMode = false;
    }
  }

  _claimRoomLease() {
    const claim = this._tabSession().claimLease({ kind: 'room' });
    if (claim.ok) return true;
    this.ui.showBanner('This browser already has a lobby open in another tab. Use that tab, or close it before hosting here.', 'bad', 5500);
    return false;
  }

  _releaseRoomLease() {
    const lease = this._tab?.lease();
    if (lease?.kind !== 'room' || !this._tab.ownsLease()) return;
    this._tab.release();
    this._tab.touch();
  }

  async createOnlineGame(visibility) {
    const lobby = await this._openLobby();
    if (!lobby || !lobby.connected || lobby.game) return;
    if (!this._claimRoomLease()) return;
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
      this._releaseRoomLease();
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
    if (!this.netMode && this.peers.length >= 3) return;
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
        peer.send({ t: 'resync', snap: this.game.snapshot(), you: idx + 1, frame: this.simFrame, match: this._sharedMatchFields() });
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
    if (!this.netMode || this.mpRole !== 'host' || !this.game || this.game.over || !this.onlinePending) return;
    if (this.onlinePending.has(sig.from)) return;
    const peer = new NetSession(this.lobby?.iceServers);
    const rec = { peer, name: sig.name || 'Watcher', started: false, buffer: [] };
    this._attachNetDiagnostics(peer);
    peer.onOpen = () => {
      this.onlinePending.delete(sig.from);
      this.pendingSpectators.push(rec);
      this.ui.showBanner(`👁️ @${rec.name} is watching.`, '', 2600);
    };
    peer.onMessage = (m) => {
      if (m.t === 'needWindow' && this.spectators.includes(peer)) {
        const commands = this._windowHistory.get(Number(m.w));
        if (commands) peer.send({ t: 'w', w: Number(m.w), c: commands, p: [] });
        return;
      }
      // A Watch connection can acknowledge loading or request a lost window;
      // never send it through the player command/seat handler.
      if (m.t !== 'spectateReady' || !rec.started || m.frame !== rec.frame) return;
      if (rec.overflow) { rec.started = false; return; }
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
    setTimeout(() => {
      if (this.onlinePending?.get(sig.from) === peer && !peer.open) {
        this.onlinePending.delete(sig.from);
        peer.destroy();
      }
    }, 20000);
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
          this._reconnectSince = 0;
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
    if (!this._reconnectSince) this._reconnectSince = Date.now();
    this._reconnectTries = (this._reconnectTries || 0) + 1;
    if (!withinRejoinGrace(this._reconnectSince, Date.now())) {
      this.pause();
      this.ui.setWaiting(false);
      this.ui.showBanner('⚠️ Could not reach the host again. Rejoin from the lobby while your seat is held.', 'bad', 8000);
      return;
    }
    const wait = delayMs != null ? delayMs : Math.min(8000, 500 * 2 ** (this._reconnectTries - 1));
    this.ui.setWaiting(true, '🔌 Reconnecting…');
    clearTimeout(this._reconnectT);
    this._reconnectT = setTimeout(() => {
      if (!this.netMode || !this.game || this.game.over || this.net?.open) return;
      this.lobby.signal({ t: 'knock', name: this._publicName(), ...(this.mpRole === 'spectator' ? { role: 'spectator' } : {}) })
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

  async joinOnlineGame(row, { compact = false } = {}) {
    const lobby = await this._openLobby();
    if (!lobby || !lobby.connected || this.netMode) return;
    const compatibility = roomCompatibility(row);
    if (!compatibility.compatible) {
      this.ui.showBanner(compatibility.reason, 'bad', 7000);
      return;
    }
    if (!this._claimRoomLease()) return;
    this.audio.init();
    this.mpRole = 'guest';
    this.onlineMode = true;
    const rejoining = row.status === 'in_game';
    if (rejoining && !canRejoinRoom(row, lobby.me?.id)) {
      this._releaseRoomLease();
      this.mpRole = null;
      this.onlineMode = false;
      this.ui.showBanner('This war is already in progress. Use Watch unless you already hold a player seat.', 'bad', 5000);
      return;
    }
    this.ui.selectedMode = row.mode || 'campaign';
    this.ui.selectedLevel = row.level || 1;
    this.ui.selectedDiff = row.difficulty || 'normal';
    if (!compact) this.ui.showSetup({ online: row, mode: row.mode });
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
      this._releaseRoomLease();
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
    // Toy lighting: one sun for crisp shape shadows, and a fill whose ground
    // colour is the map's shadow colour — so every shadowed face on a map
    // shares one tint, like a painted diorama. Totals are tuned so a lit top
    // face shows its picked colour with tone mapping off.
    this.sun = new THREE.DirectionalLight(0xffffff, 2.3);
    this.sun.position.set(85, 52, 24);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 62;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 320 });
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x1d3557, 0.75);
    this.scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0x6a7fb0, 0.35);
    this.scene.add(this.amb);
    this.scene.fog = new THREE.Fog(0xa8cfc4, 90, 240);
    this.scene.background = new THREE.Color(0xa8cfc4);
    this.tacticalVisuals.attachSun(this.sun);
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
    const preset = this.tacticalVisuals?.preset;
    const fxScale = (preset?.fxScale ?? 1) * (this.netMode ? 0.75 : 1);
    const cap = preset?.particles ?? this.pmax;
    count = Math.max(1, Math.ceil(count * fxScale));
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      if (this.pcount >= cap || this.pcount >= this.pmax) return;
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
      this._payCoinMat = toyMat({ color: 0xf3c53d, emissive: 0xf3c53d, emissiveIntensity: 0.35 });
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

  _ensureProjectiles() {
    if (this._projCore) return;
    const max = 120;
    this._projMax = max;
    this._projCoreGeo = new THREE.SphereGeometry(1, 8, 6);
    this._projTrailGeo = new THREE.CylinderGeometry(1, 1, 1, 5);
    this._projCoreMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, depthWrite: false });
    this._projTrailMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, depthWrite: false });
    this._projCore = new THREE.InstancedMesh(this._projCoreGeo, this._projCoreMat, max);
    this._projTrail = new THREE.InstancedMesh(this._projTrailGeo, this._projTrailMat, max);
    this._projUp = new THREE.Vector3(0, 1, 0);
    this._projHead = new THREE.Vector3();
    this._projTail = new THREE.Vector3();
    this._projMid = new THREE.Vector3();
    this._projDir = new THREE.Vector3();
    this._projColor = new THREE.Color();
    this._projDummy = new THREE.Object3D();
    for (const mesh of [this._projCore, this._projTrail]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 30;
      this.scene.add(mesh);
    }
    this._projTrail.renderOrder = 29;
  }

  _spawnProjectile(e, extra = {}) {
    this._ensureProjectiles();
    const cap = this.tacticalVisuals?.preset?.projectiles ?? this._projMax;
    if (this.projectiles.length >= cap) this.projectiles.shift();
    const kind = extra.kind || e.kind || 'soldier';
    const spec = { ...this._projectileSpec(kind), ...extra };
    spec.kind = kind;
    const muzzle = this._muzzlePoint(e, kind, extra);
    const hit = this._targetPoint(e, kind, extra);
    const from = new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z);
    const to = new THREE.Vector3(hit.x, hit.y, hit.z);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const dur = spec.dur || clamp(dist / spec.speed, 0.24, kind === 'grenade' || kind === 'ballista' ? 0.82 : 0.58);
    this.projectiles.push({ from, to, targetId:e.type==='herorelease'?e.targetId:null, targetKind:e.targetKind, sourceHero:e.type==='herorelease'?e.fromId:null, serial:e.serial, t: 0, dur, spec, impact: extra.impact || e.impact || null });
  }

  _destroyProjectile(p) {
    if (!p?.core) return;
    this.scene.remove(p.core, p.trail);
    if (p.core.material && p.core.material !== this._projCoreMat) p.core.material.dispose();
    if (p.trail?.material && p.trail.material !== this._projTrailMat) p.trail.material.dispose();
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
    if (!this.projectiles.length) {
      if (this._projCore && this._projCore.count) {
        this._projCore.count = 0;
        this._projTrail.count = 0;
      }
      return;
    }
    this._ensureProjectiles();
    const cap = this.tacticalVisuals?.preset?.projectiles ?? this._projMax;
    const cull = !!this.tacticalVisuals?.preset?.frustumCull && this._frustum;
    const head = this._projHead;
    const tail = this._projTail;
    const mid = this._projMid;
    const dir = this._projDir;
    const dummy = this._projDummy;
    let write = 0;
    let n = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      if(p.targetId!=null){
        const target=p.targetKind==='nest'?this.game?.nests.find(n=>n.id===p.targetId):this.game?.zombies.find(z=>z.id===p.targetId);
        if(target)p.to.set(target.x,this.map.groundY(target.x,target.z)+.7,target.z);
      }
      if(p.sourceHero!=null){
        const hero=this.game?.heroes.find(h=>h.id===p.sourceHero);
        const shot=hero?.attackShots?.find(s=>s.serial===p.serial);
        p.t=shot ? p.dur-shot.t : p.dur;
      }else p.t += dt;
      const q = Math.min(1, p.t / p.dur);
      if (q >= 1) {
        this._projectileImpact(p);
        continue;
      }
      this.projectiles[write++] = p;
      if (n >= this._projMax) continue;
      this._projectilePos(p, q, head);
      if (cull && !sphereVisible(this._frustum, head.x, head.y, head.z, 0.8)) continue;
      this._projectilePos(p, q - p.spec.tail, tail);
      const fade = q > 0.82 ? (1 - q) / 0.18 : 1;
      const pulse = (1 + Math.sin(q * Math.PI * 6) * 0.12) * Math.max(0.04, fade);
      dummy.position.copy(head);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(p.spec.size * pulse);
      dummy.updateMatrix();
      this._projCore.setMatrixAt(n, dummy.matrix);
      this._projColor.setHex(p.spec.color);
      this._projCore.setColorAt(n, this._projColor);
      mid.copy(head).add(tail).multiplyScalar(0.5);
      dir.copy(head).sub(tail);
      const len = Math.max(0.04, dir.length());
      dummy.position.copy(mid);
      dummy.quaternion.setFromUnitVectors(this._projUp, dir.normalize());
      dummy.scale.set(p.spec.size * 0.24, len, p.spec.size * 0.24);
      dummy.updateMatrix();
      this._projTrail.setMatrixAt(n, dummy.matrix);
      this._projColor.setHex(p.spec.trail);
      this._projTrail.setColorAt(n, this._projColor);
      n++;
    }
    this.projectiles.length = Math.min(write, cap);
    this._projCore.count = n;
    this._projTrail.count = n;
    this._projCore.instanceMatrix.needsUpdate = true;
    this._projTrail.instanceMatrix.needsUpdate = true;
    if (this._projCore.instanceColor) this._projCore.instanceColor.needsUpdate = true;
    if (this._projTrail.instanceColor) this._projTrail.instanceColor.needsUpdate = true;
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
    const cap = this.tacticalVisuals?.preset?.decals ?? 32;
    if (this.abilityFx.length >= cap) return;
    const geo = new THREE.RingGeometry(Math.max(0.05, radius - width), radius, this.tacticalVisuals?.quality === 'low' ? 28 : 64);
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

  // Load GLB art once; when the toy kit lands, hand it to the map props and
  // rebuild the horde pools on kit geometry. Presentation only.
  _loadArt() {
    // Seeded kit marines for colony troops (default on; ?marines=0 opts out).
    // The kit loads alongside the art so the first troops already use it.
    const marineKit = MARINE_FLAGS.units ? loadMarineKit().catch(() => false) : null;
    if (!this._artLoading) {
      this._artLoading = loadAssets().then(() => marineKit).then(() => {
        this.assetsLoaded = true;
        setMapKit(kitGeometry);
        if (hasKit('enemy_walker') && this.horde) {
          this.horde.dispose();
          this.horde = new HordeArt(this.scene, ZMAX, kitGeometry);
          this._applyShadowBudget();
        }
      });
    }
    return this._artLoading;
  }

  _setupZombieMeshes() {
    // Per-type authored silhouettes, instanced — see horde-art.js. The menu
    // vignette writes into the same pools, so the menu horde IS the game's.
    this.horde = new HordeArt(this.scene, ZMAX, kitGeometry);
    if (!this.impostors) this.impostors = new UnitImpostors(this.scene, ZMAX);
    this._zdummy = new THREE.Object3D();
    this._zcolor = new THREE.Color();
    this._applyShadowBudget();
  }

  _applyShadowBudget() {
    const preset = this.tacticalVisuals?.preset;
    if (!preset) return;
    if (this.horde) {
      for (const set of Object.values(this.horde.sets)) {
        set.body.castShadow = !!preset.hordeShadows;
        set.arms.castShadow = !!preset.hordeShadows;
        set.eyes.castShadow = false;
      }
    }
    if (this.coinMesh) this.coinMesh.castShadow = !!preset.coinShadows;
    if (this.corpseMesh) this.corpseMesh.castShadow = !!preset.corpseShadows;
  }

  _rememberCulledProps(root) {
    this._culledProps = [];
    root?.traverse((node) => {
      if (node.isInstancedMesh && node.count > 24) {
        rememberInstances(node);
        this._culledProps.push(node);
      }
    });
  }

  _cullProps() {
    const props = this._culledProps;
    if (!props?.length || !this._frustum) return;
    const preset = this.tacticalVisuals?.preset;
    const maxDistance = preset?.foliageDistance || 0;
    const pad = preset?.shadows ? 8 : 0;
    for (const mesh of props) {
      if (mesh.userData.keptShadow == null) mesh.userData.keptShadow = mesh.castShadow;
      mesh.castShadow = !!preset?.shadows && !!mesh.userData.keptShadow && (preset.hordeShadows || !maxDistance);
      cullInstances(mesh, this._frustum, {
        maxDistance, focusX: this.focus.x, focusZ: this.focus.z, pad,
      });
    }
  }

  _beginCull() {
    if (this.camera && this._frustum) cameraFrustum(this.camera, this._frustum);
    this._cullProps();
  }

  _updateZombieMeshes(t, dt = 0) {
    if (this._presentHold) return;
    const g = this.game;
    const n = Math.min(g.zombies.length, ZMAX);
    const c = this._zcolor;
    this.horde.begin();
    const vision=fogVisionSources(g);
    const preset = this.tacticalVisuals?.preset;
    const lod = preset?.impostorDistance || 0;
    const cull = !!preset?.frustumCull && this._frustum;
    for (let i = 0; i < n; i++) {
      const zb = g.zombies[i];
      if(!visibleInFog(vision,zb.x,zb.z))continue;
      const ground = this.map.groundY(zb.x, zb.z);
      const s0 = zb.def.scale || 1;
      if (cull && !sphereVisible(this._frustum, zb.x, ground + 0.8, zb.z, 1.5 * s0)) continue;
      const dx = zb.x - this.focus.x;
      const dz = zb.z - this.focus.z;
      if (this._impostorOpen && lod > 0 && !combatSilhouette(zb, this.myHero()) && (dx * dx + dz * dz) > lod * lod) {
        const yaw = Math.atan2(zb.dirX, zb.dirZ);
        this.impostors.write(zb.x, ground, zb.z, yaw, s0, s0, s0, zb.def.color || 0x9aa87a);
        continue;
      }
      const bob = ground + Math.sin(t * 7 + zb.phase) * 0.05;
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
      else c.setRGB(1.12, 0.78, 0.72);
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
    const mat = toyMat({ color: 0xf5c542, emissive: 0xc79a1e, emissiveIntensity: 0.55 });
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
    const occupied = new Set();
    for (const cn of g.coins) {
      const cell = `${Math.floor(cn.x * 2)},${Math.floor(cn.z * 2)}`;
      if (occupied.has(cell)) continue;
      occupied.add(cell);
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
    const MAXC = 600;
    // Toy-style kill pop: every dead drone shatters into a handful of crystal
    // shards that bounce and shrink away. No bodies, no gore.
    const geo = buildShardGeometry();
    this.corpseMesh = new THREE.InstancedMesh(geo, toyMat({ color: 0xffffff, vertexColors: true }), MAXC);
    this.corpseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.corpseMesh.castShadow = true;
    this.corpseMesh.frustumCulled = false;
    this.corpseMesh.count = 0;
    this.scene.add(this.corpseMesh);
    this.corpses = [];
  }

  spawnCorpse(e) {
    const f = e.force || 1;
    const n = e.big ? 7 : 4;
    const gy = this.map.groundY(e.x, e.z);
    for (let k = 0; k < n; k++) {
      const cap = this.tacticalVisuals?.preset?.corpses ?? 600;
      if (this.corpses.length >= cap) this.corpses.shift();
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.8;
      const sp = (1.6 + Math.random() * 1.8) * (0.7 + 0.3 * f);
      this.corpses.push({
        x: e.x, y: gy + 0.5 + Math.random() * 0.3, z: e.z, gy,
        vx: Math.cos(a) * sp + (e.dx || 0) * 1.5 * f, vy: 3 + Math.random() * 2.5,
        vz: Math.sin(a) * sp + (e.dz || 0) * 1.5 * f,
        rx: Math.random() * Math.PI * 2, ry: Math.random() * Math.PI * 2, rz: 0,
        wx: (Math.random() - 0.5) * 16, wy: (Math.random() - 0.5) * 12,
        life: 0.8 + Math.random() * 0.5, max: 1.3,
        scale: (e.big ? 1.6 : 1) * (0.7 + Math.random() * 0.6),
        color: e.big ? 0xc8a6ff : k % 2 ? 0xb9a2f0 : 0x9fe8ff,
      });
    }
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
      }
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.rx, p.ry, p.rz);
      d.scale.setScalar(p.scale * Math.min(1, p.life / 0.4)); // shrink away
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

    const add = (x, y, z, frac, w, thickness = 1, structure = false) => {
      if (i >= MAXB) return;
      d.position.set(x, y, z);
      d.quaternion.copy(q);
      d.scale.set(w + (structure ? w * .06 : 0), thickness * (structure ? 1.5 : 1), 1);
      d.updateMatrix();
      this.barBg.setMatrixAt(i, d.matrix);
      const left = (this._barLeft || (this._barLeft = new THREE.Vector3())).set(-w / 2, 0, 0).applyQuaternion(q);
      d.position.set(x + left.x, y + left.y + 0.001, z + left.z);
      d.scale.set(Math.max(0.01, w * frac), thickness, 1);
      d.updateMatrix();
      this.barFg.setMatrixAt(i, d.matrix);
      if (structure) c.setHex(frac <= .3 ? 0xff4545 : frac <= .6 ? 0xffbf47 : 0x65e3aa);
      else c.setHSL(lerp(0, 0.33, frac), 0.9, 0.45);
      this.barFg.setColorAt(i, c);
      i++;
    };

    const gy = (x, z) => this.map.groundY(x, z);
    // World-space bars retain a readable pixel size at normal play zoom.
    // Wall arcs show their weakest damaged section, not dozens of overlapping
    // bars or an average that hides the section about to fall.
    const damaged = g.buildings.filter(b=>b.alive && b.hp < b.maxHp - .5);
    const wallWorst = new Map();
    for(const b of damaged)if(b.kind==='wall') {
      const prior=wallWorst.get(b.plotId);
      if(!prior || b.hp/b.maxHp < prior.hp/prior.maxHp)wallWorst.set(b.plotId,b);
    }
    for (const b of damaged) {
      if(b.kind==='wall' && wallWorst.get(b.plotId)!==b)continue;
      const height=this.buildingMeshes.get(b.id)?.healthHeight ?? this._buildingHeight(b.kind);
      const y=gy(b.cx,b.cz)+height+.6;
      const distance=this.camera.position.distanceTo((this._barPoint||(this._barPoint=new THREE.Vector3())).set(b.cx,y,b.cz));
      const pixel=2*Math.tan(this.camera.fov*Math.PI/360)*distance/Math.max(1,this.renderer.domElement.clientHeight);
      add(b.cx,y,b.cz,b.hp/b.maxHp,Math.max(1.6,48*pixel),Math.max(1.5,(b.hp/b.maxHp<=.3?7:5)*pixel/.12),true);
    }
    for (const n of g.nests) {
      if (n.alive && n.hp < n.maxHp) add(n.x, gy(n.x, n.z) + 2.6, n.z, n.hp / n.maxHp, 2.2);
    }
    for (const u of g.units) {
      if (u.hp < u.maxHp) add(u.x, gy(u.x, u.z) + 1.45, u.z, Math.max(0, u.hp / u.maxHp), 0.8);
    }
    for (const zb of g.zombies) {
      if (zb.type === 'brute' && zb.hp < zb.maxHp && visibleInFog(fogVisionSources(g),zb.x,zb.z)) { add(zb.x, gy(zb.x, zb.z) + 2.1, zb.z, zb.hp / zb.maxHp, 1.1); if (i >= MAXB) break; }
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
    const wide = String(sub || '').length > 10;
    const fitted = fittedLabel(sub || '', wide ? 496 : 240);
    const cnv = document.createElement('canvas');
    cnv.width = wide ? 512 : 256;
    cnv.height = 128;
    const ctx = cnv.getContext('2d');
    ctx.textAlign = 'center';
    ctx.font = '64px serif';
    ctx.fillText(text, cnv.width / 2, 62);
    if (sub) {
      ctx.font = `bold ${fitted.size}px system-ui, sans-serif`;
      ctx.fillStyle = '#ffd75e';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 6;
      ctx.strokeText(sub, cnv.width / 2, 108);
      ctx.fillText(sub, cnv.width / 2, 108);
    }
    const tex = new THREE.CanvasTexture(cnv);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(wide ? 4.6 : 2.4, 1.2, 1);
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
    if (def.income) {
      const perMinute = def.income / SIEGE.incomePeriod * 60 * (this.game?.economy.income || 1) * (1 + (this.game?.relicMods.income || 0));
      const current = this.game?.buildings.find(b => b.plotId === plot.id && b.alive);
      const currentRate = (current?.def.income || 0) / SIEGE.incomePeriod * 60 * (this.game?.economy.income || 1) * (1 + (this.game?.relicMods.income || 0));
      roles.push(compact ? `+${perMinute.toFixed(1)} gold/min` : currentRate > 0
        ? `Income ${currentRate.toFixed(1)} → ${perMinute.toFixed(1)} gold/min.`
        : `Produces ${perMinute.toFixed(1)} gold/min automatically.`);
    }
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

  // The build pad: a glowing hex plate on the exact spot a piece will rise
  // (fixed posts, Thronefall-style). An unlit cyan rim + faint fill reads at
  // any zoom, and a small holo-gem floats above it. Cost + icon ride a tag
  // sprite (see _syncPlots), so every free spot says what goes there and
  // what it costs without opening a menu.
  _makeBeacon(x, z, r = 1.15, role = 'defense') {
    const grp = new THREE.Group();
    if (!this._padMats) {
      this._padMats = {
        rim: new THREE.MeshBasicMaterial({ color: 0x8ff3ff, transparent: true, opacity: 0.9, depthWrite: false }),
        fill: new THREE.MeshBasicMaterial({ color: 0x8ff3ff, transparent: true, opacity: 0.16, depthWrite: false }),
        plate: toyMat({ color: 0x5d6b80 }),
        gem: new THREE.MeshBasicMaterial({ color: 0xbff8ff }),
      };
    }
    this._rolePadMats ||= {};
    const colors = { economy: 0xe0be68, army: 0x83c6eb, defense: 0xe3997b, support: 0xb8a4e5 };
    const m = this._rolePadMats[role] ||= Object.fromEntries(Object.entries(this._padMats).map(([key,mat])=>{
      const copy=mat.clone(); if(key!=='plate')copy.color.setHex(colors[role]); return [key,copy];
    }));
    const segments = { economy: 4, army: 3, defense: 6, support: 8 }[role];
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 1.04, 0.08, segments), m.plate);
    plate.position.set(x, 0.04, z);
    plate.rotation.y = Math.PI / 6;
    plate.receiveShadow = true;
    grp.add(plate);
    const fillGeo = new THREE.CircleGeometry(r * 0.86, segments);
    fillGeo.rotateX(-Math.PI / 2);
    const fill = new THREE.Mesh(fillGeo, m.fill);
    fill.position.set(x, 0.09, z);
    fill.rotation.y = Math.PI / 6;
    fill.userData.noOutline = true;
    grp.add(fill);
    const rimGeo = new THREE.RingGeometry(r * 0.86, r * 0.98, segments);
    rimGeo.rotateX(-Math.PI / 2);
    const rim = new THREE.Mesh(rimGeo, m.rim);
    rim.position.set(x, 0.095, z);
    rim.rotation.y = Math.PI / 6;
    rim.userData.noOutline = true;
    grp.add(rim);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(Math.min(0.2, r * 0.22), 0), m.gem);
    gem.position.set(x, 0.75, z);
    grp.add(gem);
    grp.userData.gem = gem;
    grp.userData.rim = rim;
    return grp;
  }

  _makePlotGroup(plot) {
    const g = new THREE.Group();
    const kind = PLOT_KINDS[plot.kind];
    const anchor = plot.anchor || plot.gate;
    const [mx, mz] = plot.kind === 'wall' && anchor ? [anchor[0] + 0.5, anchor[1] + 0.5] : [plot.cx, plot.cz];
    const padR = plot.kind === 'wall' ? 0.5 : plot.kind === 'hq' ? 2.3 : 1.2;
    const role = kind.unit ? 'army' : ['house','farm','mill','mine'].includes(plot.kind) ? 'economy' : ['workshop','hero_forge'].includes(plot.kind) ? 'support' : 'defense';
    const beacon = this._makeBeacon(mx, mz, padR, role);
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
    const ringGeo = new THREE.RingGeometry(1.46, 1.55, 40);
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
        if (ud.tag) ud.tag.visible = false;
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
        gem.position.y = 0.75 + Math.sin(t * 2.4 + plot.id) * 0.08;
      }
      // Pad tag: what goes here + what it costs, on every free spot.
      if (!built && !nt.branch) {
        const tagKey = PLOT_KINDS[plot.kind].icon + '|' + Math.ceil(nt.cost);
        if (ud.tagKey !== tagKey) {
          ud.tagKey = tagKey;
          if (ud.tag) { rec.group.remove(ud.tag); ud.tag.material.map.dispose(); ud.tag.material.dispose(); }
          ud.tag = this._makeLabelSprite(PLOT_KINDS[plot.kind].icon, `${Math.ceil(nt.cost)}`);
          ud.tag.scale.set(2.0, 1.0, 1);
          const [tx, tz] = ud.labelPos;
          ud.tag.position.set(tx, 1.7, tz);
          rec.group.add(ud.tag);
        }
      }
      if (ud.tag) ud.tag.visible = !built && !nt.branch && plot.id !== pipPlotId;
      const wantSub = nt.branch ? 'choose!'
        : nt.mode === 'repair' ? 'repair'
        : nt.mode === 'rebuild' ? 'rebuild'
        : this._plotRole(plot, nt, true);
      const actionIcon = nt.mode === 'repair' ? '🔧' : nt.mode === 'rebuild' ? '🏗️' : built ? '⬆️' : PLOT_KINDS[plot.kind].icon;
      const wantKey = actionIcon + '|' + wantSub;
      ud.label.visible = active;
      if (ud.label.visible && ud.labelKey !== wantKey) {
        ud.labelKey = wantKey;
        const [lx, lz] = ud.labelPos;
        rec.group.remove(ud.label);
        ud.label = this._makeLabelSprite(actionIcon, wantSub);
        ud.label.position.set(lx, built ? 3.1 : 2.1, lz);
        rec.group.add(ud.label);
      }
      if (ud.label.visible) ud.label.position.y = (built ? 3.1 : 2.1) + Math.sin(t * 2 + plot.id) * 0.12;

      // Coin pips: cost as slots, filling as gold streams in — shown only
      // when you ride close (a city of floating rings is noise, not info).
      if (ud.pips) {
        ud.pips.sprite.visible = plot.id === pipPlotId && !nt.branch && nt.mode !== 'repair';
        if (ud.pips.sprite.visible) {
          const total = Math.max(1, Math.min(12, Math.ceil(nt.cost)));
          const hp = nt.mode === 'repair' ? g.plotHpState(plot) : null;
          const progress = hp ? hp.hp / hp.maxHp : plot.paid / nt.cost;
          const filled = Math.min(total, Math.floor(progress * total + 1e-6));
          this._drawPips(ud.pips, total, filled);
          ud.pips.sprite.position.y = (built ? 4.1 : 3.0) + Math.sin(t * 2 + plot.id) * 0.12;
        }
      }

      // Ring: pulse when affordable, glow bright while paying.
      ud.ring.visible = true;
      const affordable = !nt.branch && g.gold + plot.paid >= 1;
      const paying = (plot.payFx || 0) > 0;
      if (paying) plot.payFx -= 1 / 60;
      ud.ring.material.color.setHex(nt.branch ? 0xb98fdc : nt.mode === 'repair' ? 0x75dfff : paying ? 0xfff2c8 : 0xffd75e);
      ud.ring.material.opacity = paying ? 0.9 : affordable ? 0.35 + Math.sin(t * 3 + plot.id) * 0.15 : 0.12;

      // Progress arc.
      const health = nt.mode === 'repair' ? g.plotHpState(plot) : null;
      const frac = nt.branch ? 0 : clamp(health ? health.hp / health.maxHp : plot.paid / nt.cost, 0, 1);
      ud.prog.material.color.setHex(nt.mode === 'repair' ? 0x75dfff : 0xffd75e);
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
    // supplies the wall-plot occupancy (the rampart line), the arch tiles,
    // each gate's principal tile and the keep (walls face away from it).
    const plots = this.game.plots;
    if (!this._wallTiles || this._wallTilesFor !== plots.length) {
      const N = this.game.map.size;
      this._wallTilesFor = plots.length;
      this._wallTiles = new Set();
      this._archTiles = new Set();
      this._gateMain = new Set();
      this._gateSupports = new Map();
      for (const p of plots) {
        if (p.kind !== 'wall') continue;
        for (const [x, z] of p.tiles) this._wallTiles.add(z * N + x);
        for (const [x, z] of p.arch || (p.gate ? [p.gate] : [])) this._archTiles.add(z * N + x);
        if (p.gate) {
          const key=p.gate[1]*N+p.gate[0];
          this._gateMain.add(key);
          this._gateSupports.set(key,gateSupports(p,this.game.map));
        }
      }
    }
    const hq = this.game.buildings.find((o) => o.kind === 'hq');
    const center = hq ? [hq.cx, hq.cz] : null;
    const plan = plots.find(p=>p.kind==='hq')?.plan;
    const frontageTile = plan?.roads?.connections?.find(c=>c.plotId===b.plotId)?.tile;
    const frontage = frontageTile == null ? null :
      [frontageTile % this.map.size + .5, Math.floor(frontageTile / this.map.size) + .5];
    const mesh = buildBuildingMesh(b, { mapSize: this.game.map.size, wallTiles: this._wallTiles,
      archTiles: this._archTiles, gateMain: this._gateMain, gateSupports: this._gateSupports, liveWallTiles: b.gate ? new Set(this.game.buildings.filter(o=>o.kind==='wall'&&o.alive).map(o=>o.z*this.map.size+o.x)) : null, center, frontage, fortressKit: !!plan?.kit, armoredWalls: this.game.culture === 'european' });
    const painted = new Map();
    mesh.traverse(part => {
      if (part.isMesh && part.material?.isMeshLambertMaterial && part.geometry.getAttribute('color')) {
        const original = part.material;
        if (!painted.has(original)) {
          const material = environmentMaterial(this.game.culture === 'european' ? 'armor' : 'building', { vertexColors: true, flatShading: true,
            color: original.color, opacity: original.opacity, transparent: original.transparent, side: original.side });
          painted.set(original, material);
        }
        part.material = painted.get(original);
      }
    });
    for (const original of painted.keys()) original.dispose();
    return mesh;
  }

  _syncBuildings() {
    const g = this.game;
    const seen = new Set();
    for (const b of g.buildings) {
      seen.add(b.id);
      const plot = g.plots.find((p) => p.id === b.plotId);
      const artTier = (plot ? plot.tier : 1) + ':' + (plot ? plot.branch || '' : '');
      const supportKey = b.gate ? (this._gateSupports?.get(b.z*this.map.size+b.x)||[]).map(([x,z])=>!this._wallTiles.has(z*this.map.size+x)||!!g.occ[z*this.map.size+x]).join(',') : '';
      const tierKey = artTier + ':' + supportKey;
      let rec = this.buildingMeshes.get(b.id);
      const priorSpawnT = rec?.artTier === artTier ? rec.spawnT : undefined;
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
          if (!o.isMesh || o.userData.skirt) return;
          for (const material of (Array.isArray(o.material) ? o.material : [o.material])) {
            if (!material || materials.includes(material)) continue;
            material.userData.artBaseColor = material.color?.clone() || null;
            material.userData.artBaseEmissive = material.emissive?.clone() || null;
            material.userData.artBaseEmissiveIntensity = material.emissiveIntensity || 0;
            materials.push(material);
          }
        });
        const occlusionBounds = new THREE.Box3().setFromObject(mesh);
        const healthHeight = occlusionBounds.max.y - mesh.position.y;
        rec = { mesh, b, tierKey, artTier, healthHeight, occlusionBounds, spawnT: priorSpawnT ?? this.clock.elapsedTime, materials };
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
      // Toy-kit geometry is shared with its template — never free it here.
      if (o.geometry && !o.geometry.userData.kitShared && !o.userData.sharedGeometry) o.geometry.dispose();
      if (o.userData.ink) return; // shared ink-outline material
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const mat of mats) {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
    });
  }

  // A toy-kit figurine (shared geometry, per-unit material copies so stealth
  // fades and hit flashes stay per unit). Null when the kit piece is absent.
  _kitFigure(name) {
    if (!hasKit(name)) return null;
    const node = kitClone(name);
    const shared = kitMaterials();
    const body = shared.body.clone(), glow = shared.glow.clone();
    node.traverse((o) => { if (o.isMesh) o.material = o.material === shared.glow ? glow : body; });
    return {
      node,
      limbs: {
        legL: assetPart(node, 'leg_l'), legR: assetPart(node, 'leg_r'),
        armL: assetPart(node, 'arm_l'), armR: assetPart(node, 'arm_r'),
      },
    };
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
      // Marine heroes (default on, ?marineHeroes=0 opts out): art-marines GLBs.
      const marineHero = MARINE_FLAGS.heroes && !u.characterStyle ? assetClone(`marineHero_${u.key}`) : null;
      const kit = !marineHero && !u.characterStyle ? this._kitFigure(`hero_${u.key}`) : null;
      const authored = !marineHero && !kit && u.key === 'scott' && !u.characterStyle ? assetClone('heroScott') : null;
      if (marineHero) {
        marineHero.scale.setScalar(0.6);
        body.add(marineHero);
        const weapon = assetPart(marineHero, 'weapon');
        if (weapon) trackWeapon(weapon);
        g.userData.limbs = {
          legL: assetPart(marineHero, 'leg_l'), legR: assetPart(marineHero, 'leg_r'),
          armL: assetPart(marineHero, 'arm_l'), armR: assetPart(marineHero, 'arm_r'),
        };
      } else if (kit) {
        // Toy-kit hero figurine on its hoverbike (Scott / Alexander / Daniel).
        // Mounted heroes remain larger than infantry, not house-sized.
        // The selection ring and outline carry readability at distance;
        // the body no longer needs the old 1.25× enlargement.
        kit.node.scale.multiplyScalar(0.78);
        g.userData.outlines = addInkOutline(kit.node, d.color || 0x0e0b10);
        body.add(kit.node);
        g.userData.limbs = kit.limbs;
        g.userData.bob = { node: kit.node, y: kit.node.position.y };
      } else if (authored) {
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
      // Hero marker: a bright gold ring on a dark backing disc, so the hero
      // reads against sand, grass and snow alike.
      const backGeo = new THREE.RingGeometry(0.46, 0.8, 32);
      backGeo.rotateX(-Math.PI / 2);
      const back = new THREE.Mesh(backGeo, new THREE.MeshBasicMaterial({ color: 0x14100c, transparent: true, opacity: 0.42, depthWrite: false }));
      back.position.y = 0.025;
      back.userData.keepOpacity = true;
      g.add(back);
      const haloGeo = new THREE.RingGeometry(0.55, 0.7, 32);
      haloGeo.rotateX(-Math.PI / 2);
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xffcf4d, transparent: true, opacity: 0.9, depthWrite: false }));
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
        const auraGeo = new THREE.RingGeometry(Math.max(0.2, auraR - 0.12) / S, auraR / S, 72);
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
      // Marines (default on, ?marines=0 opts out): a unique seeded marine per unit (same on every peer).
      const marine = MARINE_FLAGS.units ? marineForUnit(u, { matchSeed: this.game?.rngSeed ?? 0, culture: activeCulture() }) : null;
      const kit = marine ? null : this._kitFigure(`unit_${u.key}`);
      const authored = !marine && !kit && u.key === 'soldier' ? assetClone('humanRifleman') : null;
      if (marine) {
        marine.node.scale.multiplyScalar(0.42);
        body.add(marine.node);
        g.userData.limbs = marine.limbs;
        g.userData.marineNode = marine.node;
        if (marine.weapon) trackWeapon(marine.weapon);
      } else if (kit) {
        // Toy-kit block figurine: YOUR men — shield knights, rangers, marksmen.
        g.userData.outlines = addInkOutline(kit.node, d.color || 0x4a7ab8);
        body.add(kit.node);
        g.userData.limbs = kit.limbs;
      } else if (authored) {
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
    const team = u.hero ? (u.def?.color || 0x59c8ff) : (u.def?.color || 0x4a7ab8);
    const teamGeo = new THREE.RingGeometry(u.hero ? 0.78 : 0.32, u.hero ? 0.92 : 0.46, 28);
    teamGeo.rotateX(-Math.PI / 2);
    const teamRing = new THREE.Mesh(teamGeo, new THREE.MeshBasicMaterial({ color: team, transparent: true, opacity: 0.92, depthWrite: false }));
    teamRing.position.y = 0.04;
    teamRing.userData.keepOpacity = true;
    teamRing.userData.teamColor = team;
    g.add(teamRing);
    g.userData.teamRing = teamRing;
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
    if (this._presentHold) return;
    // Marine LOD: full kit near the camera, ~1.5k-tri kit beyond a cut-off
    // that pulls in as the army grows or the camera zooms out.
    const marineCount = this._marineCount || 0;
    const lodFactor = marineCount > 120 ? 1.0 : marineCount > 45 ? 1.12 : 1.35;
    const marineLodFar = this.camDist > 78 ? 0 : this.camDist * lodFactor;
    let marinesSeen = 0;
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
      const teamRing = rec.mesh.userData.teamRing;
      if (teamRing) teamRing.material.color.setHex(rec.hit ? 0xfff6ee : teamRing.userData.teamColor);
      rec.lastHp = u.hp;
      const ground = this.map.groundY(u.x, u.z);
      const preset = this.tacticalVisuals?.preset;
      const lod = preset?.impostorDistance || 0;
      const dx = u.x - this.focus.x;
      const dz = u.z - this.focus.z;
      const far = this._impostorOpen && lod > 0 && !u.hero && (dx * dx + dz * dz) > lod * lod;
      const hidden = this._impostorOpen && preset?.frustumCull && !sphereVisible(this._frustum, u.x, ground + 0.8, u.z, u.hero ? 2.4 : 1.3);
      if (far || hidden) {
        rec.mesh.visible = false;
        if (far && !hidden) {
          this.impostors.write(u.x, ground, u.z, u.facing, u.def.scale || 1, u.def.scale || 1, u.def.scale || 1, u.def.color || 0xd8c7a2);
        }
        continue;
      }
      rec.mesh.visible = true;
      rec.mesh.position.set(u.x, ground, u.z);
      rec.mesh.rotation.y = u.facing;
      // Hoverbike idle: the hero floats on its wash, bobbing and rocking.
      const bob = rec.mesh.userData.bob;
      if (bob) {
        const ph = t * 2.6 + (u.id % 7);
        bob.node.position.y = bob.y + 0.05 + Math.sin(ph) * 0.045;
        bob.node.rotation.z = Math.sin(ph * 0.63) * 0.035;
        bob.node.rotation.x = Math.sin(ph * 0.81 + 1) * 0.02;
      }
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
      if(u.hero){
        const a=u.attack;
        rec.attack=a ? {t:a.t,dur:a.duration,kind:u.weapon?.melee?'melee':'hero'}
          : u.attackRecovery>0 ? {t:u.attackRecovery,dur:.24,kind:u.weapon?.melee?'melee':'hero'} : null;
      }
      let attackPulse = 0;
      let attackKind = '';
      if (rec.attack) {
        if(!u.hero)rec.attack.t -= dt;
        attackKind = rec.attack.kind || '';
        const p = clamp(1 - rec.attack.t / rec.attack.dur, 0, 1);
        attackPulse = Math.sin(p * Math.PI);
        if (rec.attack.t <= 0) rec.attack = null;
      }
      if(u.hero)attackPulse=u.attack ? -.45*(1-u.attack.t/u.attack.duration) : Math.min(1,(u.attackRecovery||0)/.24);
      for (const cue of ['hit', 'cast']) {
        if (!rec[cue]) continue;
        rec[cue].t -= dt;
        if (rec[cue].t <= 0) rec[cue] = null;
      }
      const cue = rec.hit || rec.cast || rec.attack;
      const cuePulse = u.hero && !rec.hit && !rec.cast ? Math.max(0,attackPulse) : cue ? Math.sin(clamp(1 - cue.t / cue.dur, 0, 1) * Math.PI) : 0;
      const artState = unitArtState(u, {
        hitT: rec.hit?.t, castT: rec.cast?.t, attackT: rec.attack?.t,
      });
      const pose = unitPose(artState, t * (artState === 'run' ? 10 : 1.8) + u.id, {
        pulse: cuePulse, melee: attackKind === 'melee',
      });
      if(u.hero && u.attack && !rec.hit && !rec.cast){
        const prep=1-u.attack.t/u.attack.duration;
        Object.assign(pose,{y:0,z:-.1*prep,pitch:.18*prep,roll:-.08*prep});
      }
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
      const marineNode = rec.mesh.userData.marineNode;
      if (marineNode) {
        marinesSeen++;
        let low = MARINE_FLAGS.lod === 'lo';
        if (MARINE_FLAGS.lod === 'auto') {
          const d = this.camera.position.distanceTo(rec.mesh.position);
          const wasLow = marineNode.userData.marineLod?.low;
          low = d > marineLodFar + (wasLow ? -2 : 2); // hysteresis: no flicker at the edge
        }
        setMarineLod(marineNode, low);
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
        if (u === this.myHero()) {
          const shells = rec.mesh.userData.occlusionShells ||= installHeroOcclusionShell(rec.mesh.userData.body);
          // Bound checks are presentation-only and cached at 10 Hz, not a scene raycast.
          if (t >= (rec.occlusionCheckAt || 0)) {
            rec.occlusionCheckAt = t + .1;
            rec.occluded = terrainOccludesHero(this.map, this.camera.position, rec.mesh.position)
              || structuresOccludeHero(this.buildingMeshes.values(), this.camera.position, rec.mesh.position);
          }
          for (const shell of shells) shell.visible = !u.dead && !!rec.occluded;
        }
        const wantOp = u.stealth ? 0.3 : 1;
        if (rec.op !== wantOp) {
          rec.op = wantOp;
          rec.mesh.traverse((o) => {
            if (o.isMesh && !o.userData.keepOpacity) {
              o.material.transparent = true;
              o.material.opacity = wantOp;
            }
          });
          for (const o of rec.mesh.userData.outlines || []) o.visible = wantOp === 1;
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
          aura.material.opacity = 0.10 + rank * 0.018 + Math.sin(t * 2.2 + u.id) * 0.015;
          if (fill) fill.material.opacity = rank ? 0.035 + rank * 0.018 + Math.sin(t * 1.3 + u.id) * 0.01 : 0.02;
          if (pulse) {
            pulse.rotation.z = t * (0.28 + rank * 0.04);
            pulse.material.opacity = rank ? 0.055 + rank * 0.012 : 0.025;
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
    this._marineCount = marinesSeen;
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

  // Small amber construction rig, distinct from armed troops.
  _syncBuilder(t) {
    const b=this.game?.builders;
    if(!b||b.recover>0){if(this._builderMesh)this._builderMesh.visible=false;return;}
    if(!this._builderMesh){
      const crew=new THREE.Group();crew.name='colony-builder';
      const armor=new THREE.MeshStandardMaterial({color:0xe7b44c,roughness:.75});
      const dark=new THREE.MeshStandardMaterial({color:0x293c4b,roughness:.8});
      const light=new THREE.MeshBasicMaterial({color:0x8eeaff});
      const box=(w,h,d,x,y,z,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;crew.add(m);return m;};
      box(.7,.75,.5,0,.85,0,armor);box(.46,.4,.43,0,1.43,0,armor);box(.4,.12,.04,0,1.46,.23,light);
      box(.23,.55,.27,-.22,.27,0,dark);box(.23,.55,.27,.22,.27,0,dark);
      box(.23,.6,.23,-.49,.88,0,armor);box(.23,.6,.23,.49,.88,0,armor);
      box(.5,.48,.27,0,.94,-.4,dark);crew.userData.tool=box(.2,.18,.7,.5,.62,.3,dark);
      const ring=new THREE.Mesh(new THREE.RingGeometry(.65,.76,24),new THREE.MeshBasicMaterial({color:0xe7b44c,side:THREE.DoubleSide,transparent:true,opacity:.65,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.y=.05;crew.add(ring);
      this._builderMesh=crew;
    }
    const m=this._builderMesh;if(!m.parent)this.scene.add(m);m.visible=true;
    m.position.set(b.x,this.map.groundY(b.x,b.z)+(b.status==='Travelling'?Math.abs(Math.sin(t*9))*.06:0),b.z);
    m.userData.tool.rotation.x=['Building','Repairing','Rebuilding','Upgrading'].includes(b.status)?Math.sin(t*14)*.2:0;
    if(b.route[0])m.rotation.y=Math.atan2(b.route[0][0]-b.x,b.route[0][1]-b.z);
  }

  // Outline the one object the local hero can act on; presentation only.
  _updateCombatCues() {
    const g=this.game;
    if(this._combatCueGame!==g) {
      for(const mesh of this._combatCues||[]) {
        mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();
      }
      this._combatCues=[];this._combatCueGame=g;
    }
    for(const mesh of this._combatCues)mesh.visible=false;
    if(!g)return;
    const vision=fogVisionSources(g),visible=(x,z)=>vision.some(v=>Math.hypot(v.x-x,v.z-z)<v.radius);
    let index=0;
    const cue=(x,z,r,color,opacity=.8)=>{
      if(index>=48)return;
      let mesh=this._combatCues[index];
      if(!mesh) {
        const geo=new THREE.RingGeometry(.86,1,48);geo.rotateX(-Math.PI/2);
        mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,transparent:true,depthWrite:false,side:THREE.DoubleSide}));
        this._combatCues.push(mesh);
      }
      if(!mesh.parent)this.scene.add(mesh);
      mesh.visible=true;mesh.position.set(x,this.map.groundY(x,z)+.13,z);
      mesh.scale.setScalar(r);mesh.material.color.setHex(color);mesh.material.opacity=opacity;
      index++;
    };
    // Actual pending impacts, not event timers: pause/restore/Watch agree.
    for(const enemy of g.zombies) {
      const hit=enemy.windup;
      if(enemy.dead||!hit||!visible(enemy.x,enemy.z)||!visible(hit.x,hit.z))continue;
      const p=1-hit.t/hit.duration;
      cue(hit.x,hit.z,hit.r,hit.kind==='acid'?0xdfff55:0xff7844,.95);
      cue(hit.x,hit.z,Math.max(.15,hit.r*p),0xffffff,.65);
    }
    const hero=this.myHero(),target=hero?.orderId!=null ? g.zombies.find(z=>z.id===hero.orderId) : hero?.target;
    if(hero&&!hero.dead&&(this._attackMoveArmed||hero.attack||hero.orderKind==='attack'||hero.orderKind==='hold'))
      cue(hero.x,hero.z,g.heroRange(hero),0x7edac1,.25);
    if(hero?.attack)cue(hero.x,hero.z,.65,0xffd27a,.35+.6*(1-hero.attack.t/hero.attack.duration));
    if(hero&&!hero.dead&&this.pendingAbility!=null){
      const ab=heroAbility(hero.def,this.pendingAbility);if(ab?.range)cue(hero.x,hero.z,ab.range,0x7edac1,.4);
    }
    for(const caster of g.heroes)for(const e of caster.spells?.effects||[]){
      if((e.kind==='blast'||e.kind==='zone')&&visible(e.x,e.z))cue(e.x,e.z,e.radius,e.delay>0?0xffce68:0x7edac1,.65);
    }
    if(hero&&!hero.dead&&target&&!target.dead&&visible(target.x,target.z)) {
      cue(target.x,target.z,.45,(hero.orderId===target.id||hero.focusId===target.id)?0xffc44c:0xff7777,.9);
    }
  }

  // Outline the one object the local hero can act on. This is presentation
  // state only; it must never enter commands, snapshots, or lockstep hashes.
  _updateTacticalSelection() {
    if(this._inspectRing)this._inspectRing.visible=false;
    const selected=this.ui._battlePanel;
    if(selected?.mode==='unit' && selected.game===this.game) {
      const unit=(selected.enemy?this.game.zombies:this.game.units).find(u=>u.id===selected.id);
      const visible=unit && !unit.dead && unit.hp>0 && (!selected.enemy || fogVisionSources(this.game).some(v=>Math.hypot(v.x-unit.x,v.z-unit.z)<v.radius));
      if(visible) {
        if(!this._inspectRing){
          const geometry=new THREE.RingGeometry(.62,.73,32);geometry.rotateX(-Math.PI/2);
          this._inspectRing=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x83e8ff,transparent:true,opacity:.9,depthWrite:false}));
        }
        if(!this._inspectRing.parent)this.scene.add(this._inspectRing);
        this._inspectRing.visible=true;this._inspectRing.position.set(unit.x,this.map.groundY(unit.x,unit.z)+.1,unit.z);
        this._inspectRing.material.color.setHex(selected.enemy?0xff7777:0x83e8ff);
        this.tacticalVisuals.setSelection(selected.enemy?[]:[this.unitMeshes.get(unit.id)?.mesh],0x83e8ff);
        return;
      }
    }
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
        // The home node sits on the keep: its capture circle would ring the
        // castle like a target — the walls already say whose ground it is.
        const hq = (g.plots || []).find((p) => p.kind === 'hq');
        ring.visible = !(hq && Math.hypot(hq.cx - node.x, hq.cz - node.z) < SIEGE.captureRadius);
        gr.add(ring);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.4, 6), toyMat({ color: 0x39332a }));
        pole.position.set(node.x, 2.2, node.z);
        gr.add(pole);
        const flag = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.05), toyMat({ color: 0xd8c07a }));
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
      const k = bindKey(e);
      if (e.repeat) {
        const typing = e.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable);
        if (this.game && !typing) {
          const repeatAct = actionFor(this.binds(), k, 'battle');
          if (repeatAct === 'camera_center' || (repeatAct && (repeatAct.startsWith('camera_') || repeatAct.startsWith('move_')))) e.preventDefault();
        }
        return;
      }
      if (e.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable)) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      // Let native buttons handle activation without also building/dodging or opening chat.
      if (e.target?.tagName === 'BUTTON' && (k === ' ' || k === 'enter')) return;
      this.keys.add(k);
      if (this.game && k === 'enter' && this.netMode) {
        e.preventDefault();
        this.ui.openGameChat();
        return;
      }
      // Character info shortcuts work from the menus between missions.
      if (!this.game && actionFor(this.binds(), k, 'hub') === 'character_sheet' && this.ui._sheetCharacter?.()) {
        e.preventDefault();
        this.ui.showCharacterSheet('gear');
        return;
      }
      if (!this.game && actionFor(this.binds(), k, 'hub') === 'lattice_panel' && this.ui._sheetCharacter?.()) {
        e.preventDefault();
        this.ui.showCharacterSheet('lattice');
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
      if (!this.game) return;
      // Every in-battle key goes through the binding table. Nothing here
      // knows a letter, so the scheme, the Settings screen and the help page
      // cannot drift apart.
      const binds = this.binds();
      // Scoped: the battle loop can only ever pick an action that listens in a
      // battle. Conflict detection guarantees no two of those share a key.
      const act = actionFor(binds, k, 'battle');
      const intent = pauseIntent({ paused: this.paused, menuOpen: this.ui.pauseOpen, action: act });
      if (intent === 'resume-menu') { e.preventDefault(); this.closePauseMenu(); return; }
      if (intent === 'resume') { e.preventDefault(); this.setSpeed(0); return; }
      if (intent === 'open-menu') { this.togglePauseMenu(); return; }
      if (this.paused) return;
      switch (act) {
        case 'dodge': {
          e.preventDefault();
          // The mode owns Space. Held-input turns it into payment in Build
          // mode; only Fight mode may dispatch a dodge command.
          if (this.controlMode !== 'fight') {
            if (this.game.phase === 'found') this._tryFound();
            break;
          }
          if (this.game.phase === 'found') break;
          const dir = this.lastDir || { x: 0, z: 0 };
          this.issue({ t: 'dodge', p: this.myPlayer, x: dir.x, z: dir.z });
          break;
        }
        case 'ability1': case 'ability2': case 'ability3': case 'ability4': {
          e.preventDefault();
          const slot = castSlot(act, isHeld(binds, this.keys, 'second_bar'));
          if (this.controlMode === 'fight' && slot != null) this.tryCast(slot);
          else if (slot != null) this.ui.showBanner(`Press ${keyLabel(binds.build_mode)} for Fight mode, then use your ability.`, 'info', 1800);
          break;
        }
        case 'hero_stop': case 'hero_hold':
          e.preventDefault();
          this._attackMoveArmed=false; this.pendingAbility=null;
          this.issue({t:'hhalt',p:this.myPlayer,k:act==='hero_stop'?'stop':'hold'});
          this.ui.showBanner(act==='hero_stop'?'Stopped':'Holding position', 'info', 900);
          break;
        case 'attack_move':
          e.preventDefault();
          this._attackMoveArmed = !this._attackMoveArmed;
          this.ui.showBanner(this._attackMoveArmed ? 'Attack-move armed. Click the ground or an enemy.' : 'Attack-move cancelled.', 'info', 1600);
          break;
        case 'camera_center':
          e.preventDefault();
          this._cameraPinned = true;
          this._recenter = true;
          break;
        case 'camera_keep':
          e.preventDefault();
          this._lookAtKeep();
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
        case 'pause': e.preventDefault(); this.setSpeed(0); break;
        case 'menu': if (this.pendingAbility != null || this._attackMoveArmed) {this.pendingAbility=null;this._attackMoveArmed=false;break;} if(this.ui._battlePanel){this.ui._battlePanel=null;this.ui.root.querySelector('#battle-details').classList.add('hidden');}else this.togglePauseMenu(); break;
        default:
          break;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(bindKey(e)));

    cv.addEventListener('wheel', (e) => {
      if (!this.game) return;
      e.preventDefault();
      const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const step = clamp(pixels, -100, 100) / 100 * 0.045;
      const base = this._camDistTarget ?? this.camDist;
      this._camDistTarget = clamp(base * (1 + step), 22, 95);
      if (this.missionIntro) this.missionIntro.held = true;
    }, { passive: false });

    cv.addEventListener('pointermove', (e) => {
      if (!this._replayDrag || e.pointerId !== this._replayDrag.id) return;
      this._replayDrag.dx += e.clientX - this._replayDrag.x;
      this._replayDrag.dy += e.clientY - this._replayDrag.y;
      this._replayDrag.x = e.clientX;
      this._replayDrag.y = e.clientY;
    });
    cv.addEventListener('pointerup', (e) => {
      if (this._replayDrag && e.pointerId === this._replayDrag.id) this._replayDrag = null;
    });
    cv.addEventListener('pointercancel', (e) => {
      if (this._replayDrag && e.pointerId === this._replayDrag.id) this._replayDrag = null;
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointermove', (e) => { this._pointer = { x: e.clientX, y: e.clientY, in: true }; });
    cv.addEventListener('pointerleave', () => { if (this._pointer) this._pointer.in = false; });
    cv.addEventListener('pointerdown', (e) => {
      if (this.replay && this.replay.follow === false && (e.button === 2 || e.button === 1)) {
        this._replayDrag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, id: e.pointerId };
        return;
      }
      this.audio.init();
      if (!this.game || this.game.over || !this.ui.root.querySelector('#overlay').classList.contains('hidden')) return;
      if (e.button === 2 && this.pendingAbility != null) { this.pendingAbility = null; return; }
      if (e.button === 2 || (e.button === 0 && this._attackMoveArmed)) {
        this._issuePointerOrder(e);
        return;
      }
      if (e.button !== 0) return;
      const rect=cv.getBoundingClientRect(),vision=fogVisionSources(this.game);
      let best=null,closest=26;
      for(const [actors,enemy] of [[this.game.units,false],[this.game.zombies,true]])for(const unit of actors){
        if(unit.dead||unit.hp<=0)continue;
        if(enemy&&!vision.some(v=>Math.hypot(v.x-unit.x,v.z-unit.z)<v.radius))continue;
        const world=new THREE.Vector3(unit.x,this.map.groundY(unit.x,unit.z)+(unit.hero?1.3:.9),unit.z);
        const screen=world.clone().project(this.camera);
        if(screen.z< -1||screen.z>1)continue;
        const distance=Math.hypot(rect.left+(screen.x+1)*rect.width/2-e.clientX,rect.top+(1-screen.y)*rect.height/2-e.clientY);
        if(distance<closest){closest=distance;best={unit,enemy,world};}
      }
      if (this.pendingAbility != null) {
        const slot=this.pendingAbility,h=this.myHero(),ab=heroAbility(h?.def,slot);
        if (!h || h.dead || this.controlMode !== 'fight' || !ab) {this.pendingAbility=null;return;}
        if (ab.target==='enemy') {
          if (!best?.enemy) {this.ui.showBanner('Select a visible enemy.', 'info');return;}
          const target={id:best.unit.id};
          if (!spellTarget(this.game,h,ab,target)) {this.ui.showBanner('Target is out of range or hidden.', 'info');return;}
          this.issue({t:'cast',p:this.myPlayer,slot,...target});
        } else {
          const pointer=new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2);
          const ray=new THREE.Raycaster();ray.setFromCamera(pointer,this.camera);
          const hit=ray.intersectObject(this.terrain,true)[0];
          if (!hit) return;
          const target={x:hit.point.x,z:hit.point.z};
          if (!spellTarget(this.game,h,ab,target)) {this.ui.showBanner('Choose a point closer to your hero.', 'info');return;}
          this.issue({t:'cast',p:this.myPlayer,slot,...target});
        }
        this.pendingAbility=null;return;
      }
      if(best){
        // Do not select an enemy through an occluding terrain ridge.
        const direction=best.world.clone().sub(this.camera.position),distance=direction.length();
        const ray=new THREE.Raycaster(this.camera.position,direction.normalize(),0,distance-.2);
        if(!best.enemy||!ray.intersectObject(this.terrain,true).length)this.ui.inspectUnit(this.game,best.unit,best.enemy);
      } else {this.ui._battlePanel=null;}
    });
  }

  // The current scheme. Cached because the movement path asks every frame.
  binds() {
    if (!this._binds) this._binds = loadBinds();
    return this._binds;
  }

  feel() {
    if (!this._feel) this._feel = loadFeel();
    return this._feel;
  }

  setBinds(next) {
    this._binds = saveBinds(next);
    this.ui.setKeybinds(this._binds);
    if (this._coach) this._paintCoach();
    return this._binds;
  }

  setFeel(next) {
    this._feel = saveFeel(next);
    this.ui.setFeel(this._feel);
    if (this._coach) this._paintCoach();
    return this._feel;
  }

  resetKeybinds() {
    this._binds = resetBinds();
    this._feel = loadFeel({ force: true });
    this.ui.setKeybinds(this._binds);
    this.ui.setFeel(this._feel);
    if (this._coach) this._paintCoach();
    return this._binds;
  }

  _issuePointerOrder(e) {
    const picked = this._pickPointer(e);
    const order = pointerOrder({ button: e.button, armed: this._attackMoveArmed, enemy: !!picked.enemy });
    this._attackMoveArmed = false;
    if (!order) return;
    const point = picked.enemy ? picked.unit : picked.ground;
    if (!point) return;
    const q = quantizeOrder(point.x, point.z);
    const cmd = { t: 'horder', p: this.myPlayer, x: q.x, z: q.z, k: order.k };
    if (order.k === 'attack') {
      // An explicit attack order is an unambiguous combat intent. Do not leave
      // the player paying for a plot with their abilities silently disabled.
      if (this.controlMode !== 'fight') this.toggleControlMode();
      if (picked.enemy) cmd.id = picked.unit.id;
    }
    this.issue(cmd);
    this._showOrderMarker(q.x, q.z, order.k);
  }

  _pickPointer(e) {
    const cv = this.canvas;
    const rect = cv.getBoundingClientRect();
    const vision = fogVisionSources(this.game);
    let best = null, closest = 26;
    for (const unit of this.game.zombies) {
      if (unit.dead || unit.hp <= 0) continue;
      if (!vision.some((v) => Math.hypot(v.x - unit.x, v.z - unit.z) < v.radius)) continue;
      const world = new THREE.Vector3(unit.x, this.map.groundY(unit.x, unit.z) + 0.9, unit.z);
      const screen = world.clone().project(this.camera);
      if (screen.z < -1 || screen.z > 1) continue;
      const distance = Math.hypot(rect.left + (screen.x + 1) * rect.width / 2 - e.clientX, rect.top + (1 - screen.y) * rect.height / 2 - e.clientY);
      if (distance < closest) { closest = distance; best = unit; }
    }
    const pointer = new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const hit = this.terrain ? ray.intersectObject(this.terrain, true)[0] : null;
    return { enemy: !!best, unit: best, ground: hit ? { x: hit.point.x, z: hit.point.z } : null };
  }

  _showOrderMarker(x, z, kind) {
    if (this._orderMarker) {
      this.scene.remove(this._orderMarker);
      this._orderMarker.geometry.dispose();
      this._orderMarker.material.dispose();
      this._orderMarker = null;
    }
    const geo = new THREE.RingGeometry(0.28, 0.5, 28);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: kind === 'attack' ? 0xff4d3a : 0xf3c53d,
      transparent: true, opacity: 0.92, depthWrite: false,
    }));
    mesh.position.set(x, (this.map?.groundY(x, z) || 0) + 0.12, z);
    this.scene.add(mesh);
    this._orderMarker = mesh;
    this._orderMarkerLife = 0.7;
  }

  _presentCue(event) {
    const cue = impactCue(event);
    if (!cue) return;
    if (cue.shake) this.shake = Math.max(this.shake, cue.shake);
    if (cue.hitStop) {
      this._hitFeel = armHitStop(this._hitFeel, cue.hitStop);
      this._hitStop = this._hitFeel.hold;
    }
    if (cue.sample) this.audio.impactSample(cue.sample);
  }

  // Optional direct-move keys → a cardinal direction, sent through the lockstep
  // pipe only on change. Right-click orders are the main move. Directions stay
  // aligned with the minimap: north is always north.
  _updateHeroInput() {
    if (!this.game || this.game.over || this.mpRole === 'spectator') return;
    let dx = 0, dz = 0;
    const binds = this.binds();
    const active = document.activeElement;
    const editing = !!active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
    if (editing) this.keys.clear();
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
    // Build mode owns construction input. Space is the mode-primary action;
    // the configured Build key remains an accessible secondary binding.
    const h = this.myHero();
    const canPay = this.game && this.game.phase === 'live' && h && !h.dead && !!this.game.buildTargetFor(h);
    const bindsNow = this.binds();
    const buildHeld = isHeld(bindsNow, this.keys, 'build') || isHeld(bindsNow, this.keys, 'dodge');
    const physicalPayHeld = buildHeld || !!this.buttonPay;
    // Eligibility can disappear after repair (a specialisation is due), then
    // return while the same key/button remains down. Only a physical release
    // rearms that press; lastPay alone tracks eligibility, not release.
    // A finished plot clears the sim hold. If another foundation is already
    // in reach, that same press may fund it. Leaving range and coming back
    // is not a new press.
    const payTarget = canPay ? this.game.buildTargetFor(h)?.plot?.id ?? null : null;
    if (physicalPayHeld && this._payPressUsed && payTarget != null && this._payTargetId != null && payTarget !== this._payTargetId) {
      this._payPressUsed = false;
      this.lastPay = false;
    }
    this._payTargetId = payTarget;
    if (!physicalPayHeld) this._payPressUsed = false;
    const pay = this.controlMode === 'build' && canPay && physicalPayHeld
      && (!this._payPressUsed || this.lastPay);
    if (pay !== this.lastPay) {
      this.lastPay = pay;
      if (pay) this._payPressUsed = true;
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
    this.pendingAbility = null;
    this.controlMode = this.controlMode === 'build' ? 'fight' : 'build';
    this._noteCoach({ type: 'mode' });
    this.buttonPay = false;
    if (this.lastPay && this.controlMode === 'fight') {
      this.lastPay = false;
      this.issue({ t: 'pay', p: this.myPlayer, on: false });
    }
    if (this.ui.setControlMode) this.ui.setControlMode(this.controlMode);
    this.audio.click();
  }

  tryCast(slot = 0) {
    if (!this.game) return;
    const h = this.myHero();
    if (!h || h.dead) return;
    if (!heroAbility(h.def, slot) || heroAbility(h.def, slot).passive || abilityCooldown(h, slot) > 0) { this.audio.deny(); return; }
    const ab=heroAbility(h.def,slot);
    if ((h.spells?.mana ?? h.def.mana ?? 0) < spellManaCost(h,slot) || h.spells?.charges?.[slot]?.count === 0) {this.audio.deny();return;}
    if (ab.target==='point' || ab.target==='enemy') {
      this.pendingAbility=slot;
      this.ui.showBanner(`${ab.name}: select ${ab.target==='enemy'?'an enemy':'a point'} · ${keyLabel(this.binds().menu)} cancels`, 'info');
      return;
    }
    if (Math.random() < 0.4) this.audio.bark(h.key, 'attack');
    this.issue({ t: 'cast', p: this.myPlayer, slot });
  }

  togglePauseMenu(help = false) {
    if (!this.game) return;
    this._finishMissionIntro();
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
    if (this.replay) {
      if (s === 0) this.replay.paused = !this.replay.paused;
      else if (s === 1 || s === 2 || s === 4 || s === 8) {
        this.replay.speed = s;
        this.replay.paused = false;
      }
      this.speed = this.replay.speed;
      this.paused = !!this.replay.paused;
      this.ui.setSpeedUI(this.replay.speed, this.replay.paused);
      this.ui.setReplayBar(this._replayBarState());
      return;
    }
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
    if (s.quality !== undefined) {
      this.tacticalVisuals.applyQuality(s.quality);
      this.ui.setQualityUI(this.tacticalVisuals.choice, this.tacticalVisuals.quality);
    }
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

  _panReplayCamera(dt) {
    let dx = 0;
    let dz = 0;
    const binds = this.binds();
    const active = document.activeElement;
    const editing = !!active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
    if (!editing) {
      if (isHeld(binds, this.keys, 'move_up')) dz -= 1;
      if (isHeld(binds, this.keys, 'move_down')) dz += 1;
      if (isHeld(binds, this.keys, 'move_left')) dx -= 1;
      if (isHeld(binds, this.keys, 'move_right')) dx += 1;
    }
    const speed = 22 * (this.camDist / 46);
    this.focus.x += dx * speed * dt;
    this.focus.z += dz * speed * dt;
    if (this._replayDrag) {
      const scale = this.camDist * 0.012;
      this.focus.x += this._replayDrag.dx * scale;
      this.focus.z += this._replayDrag.dy * scale;
      this._replayDrag.dx = 0;
      this._replayDrag.dy = 0;
    }
  }

  _lookAtKeep() {
    const keep = this.game?.buildings.find((b) => b.kind === 'hq' && b.alive);
    if (!keep) return;
    this._cameraPinned = false;
    this._keepPeek = { x: keep.cx ?? keep.x, z: keep.cz ?? keep.z, until: performance.now() + 2500 };
  }

  _updateCamera(dt) {
    if (!this.game) return;
    if (this._camDistTarget != null) {
      this.camDist += (this._camDistTarget - this.camDist) * (1 - Math.exp(-8 * dt));
      if (Math.abs(this._camDistTarget - this.camDist) < 0.02) this.camDist = this._camDistTarget;
    }

    const feel = this.feel();
    const binds = this.binds();
    const active = document.activeElement;
    const editing = !!active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
    let panX = 0, panZ = 0;
    if (!this.replay && !editing && !this.paused && !this._presentHold) {
      const held = (axis, action) => cameraAxisHeld(binds, this.keys, axis, {
        wasdCamera: !!feel.wasdCamera, actionFor, isHeld, cameraAction: action,
      });
      if (held('up', 'camera_up')) panZ -= 1;
      if (held('down', 'camera_down')) panZ += 1;
      if (held('left', 'camera_left')) panX -= 1;
      if (held('right', 'camera_right')) panX += 1;
      if (feel.edgePan !== false && this._pointer?.in) {
        const edge = 36;
        const w = window.innerWidth, h = window.innerHeight;
        const x = this._pointer.x, y = this._pointer.y;
        if (x < edge) panX -= (edge - x) / edge;
        else if (x > w - edge) panX += (x - (w - edge)) / edge;
        if (y < edge) panZ -= (edge - y) / edge;
        else if (y > h - edge) panZ += (y - (h - edge)) / edge;
      }
    }
    if (panX || panZ) this._cameraPinned = false;
    const h = this.myHero();
    if (this.replay?.follow === false) {
      this._panReplayCamera(dt);
    } else if (this._recenter && h) {
      this.focus.x = h.x;
      this.focus.z = h.z;
      this._recenter = false;
      this._cameraPinned = true;
    } else if ((this.replay?.follow || this._cameraPinned) && h && !this._presentHold) {
      // Glued to the hero until the player pans. Space pins it again.
      const lead = 1.6;
      const peek = this._keepPeek?.until > performance.now() && !h.mx && !h.mz && h.orderX == null ? this._keepPeek : null;
      const tx = peek ? peek.x : h.x + (h.mx || 0) * lead;
      const tz = peek ? peek.z : h.z + (h.mz || 0) * lead;
      const k = 1 - Math.exp(-6 * dt);
      this.focus.x += (tx - this.focus.x) * k;
      this.focus.z += (tz - this.focus.z) * k;
    } else if ((panX || panZ) && !this._presentHold) {
      const len = Math.hypot(panX, panZ) || 1;
      this.focus.x += (panX / len) * 24 * dt;
      this.focus.z += (panZ / len) * 24 * dt;
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

    // Diorama angle: steep enough to read the whole base like a board game,
    // steeper still as you pull back.
    const elev = lerp(0.95, 1.12, clamp((this.camDist - 22) / 73, 0, 1));
    const hx = Math.cos(elev) * this.camDist, hy = Math.sin(elev) * this.camDist;
    let sx = 0, sz = 0;
    if (this.shake > 0) {
      this.shake -= dt;
      const scale = scaledShake(1, {
        reduceShake: !!this.feel().reduceShake,
        reduceMotion: !!this.motionPreference.matches,
      });
      const s = Math.max(0, Math.min(this.shake, 0.25)) * scale;
      sx = (Math.random() - 0.5) * s; sz = (Math.random() - 0.5) * s;
    }
    this.camera.position.set(
      this.focus.x + Math.sin(this.camYaw) * hx + sx,
      this.focus.y + hy,
      this.focus.z + Math.cos(this.camYaw) * hx + sz,
    );
    this.camera.lookAt(this.focus.x + sx, this.focus.y, this.focus.z + sz);

    // Sun high and over the camera's left shoulder: the faces you look at
    // are lit, and shadows fall up-screen to the right like a lit tabletop.
    this.sun.position.set(this.focus.x - 34, this.focus.y + 78, this.focus.z + 26);
    this.sun.target.position.set(this.focus.x, this.focus.y, this.focus.z);
    const shadowSpan = clamp(this.camDist * 0.85, 26, 74);
    if (Math.abs(shadowSpan - (this._shadowSpan || 0)) > 1) {
      this._shadowSpan = shadowSpan;
      Object.assign(this.sun.shadow.camera, { left: -shadowSpan, right: shadowSpan, top: shadowSpan, bottom: -shadowSpan });
      this.sun.shadow.camera.updateProjectionMatrix();
    }
  }

  // No day and no night any more — but the sky still tells you something. The
  // light bleeds out of the world as Threat climbs, so a late siege LOOKS like
  // a late siege without ever gating the player on a clock.
  _updateDayNight(dt) {
    const g = this.game;
    const dread = g.phase === 'found' ? 0 : Math.min(1, (g.threat || 0) / Math.max(1, THREAT.max * 0.7));
    const want = 1 - dread * 0.55;
    this._bright = this._bright === undefined ? want : this._bright + (want - this._bright) * (1 - Math.exp(-2.2 * dt));
    const b = this._bright;
    const pal = this.pal || {};
    const shadowHex = paletteShadow(pal);
    if (shadowHex !== this._shadowHex) {
      this._shadowHex = shadowHex;
      this.tacticalVisuals.setShadowColor(shadowHex);
    }
    const shadow = _tmpColA.setHex(shadowHex);
    const horizon = _tmpColB.setHex(pal.sky !== undefined ? pal.sky : 0xa8cfc4);
    const top = _tmpColC.setHex(paletteSkyTop(pal));
    // Threat drains the warmth out of the light toward the shadow colour —
    // a late siege LOOKS late without any day/night clock.
    this.sun.intensity = lerp(1.25, 2.3, b);
    this.sun.color.setRGB(1, 0.94, 0.83).lerp(shadow, (1 - b) * 0.35);
    this.hemi.intensity = lerp(0.55, 0.75, b);
    this.hemi.color.setRGB(0.83, 0.91, 1).lerp(shadow, (1 - b) * 0.4);
    this.hemi.groundColor.copy(shadow);
    this.amb.intensity = 0.35;
    this.amb.color.copy(shadow).lerp(_tmpColD.setRGB(1, 1, 1), 0.45);
    horizon.lerp(shadow, (1 - b) * 0.6);
    top.lerp(shadow, (1 - b) * 0.7);
    this.scene.background = this.sky.set(top, horizon) || horizon.clone();
    this.scene.fog.color.copy(horizon);
    const b2 = b;
    // Windows glow when it's dark.
    const glow = lerp(0.85, 0, b2);
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
    if (g.events.length > 90) {
      // Keep world changes, the earned opening payoff and the latest local
      // order acknowledgement, in their original order. Never replay old combat FX.
      const older = g.events.slice(0, g.events.length - 30);
      const lastOrder = older.findLastIndex(e => e.player === this.myPlayer && ['hold', 'rally', 'orderconfirmed'].includes(e.type));
      const keep = older.filter((e, i) => e.type === 'founded' || e.type === 'firstsiege' || i === lastOrder);
      g.events.splice(0, g.events.length - 30, ...keep);
    }
    const vision=fogVisionSources(g);
    const hiddenEffects=new Set(['shot','spit','zdeath','death','groundstrike','cast','stealth']);
    for (const e of g.events) {
      if(hiddenEffects.has(e.type)) {
        const x=e.fx??e.x,z=e.fz??e.z;
        if(Number.isFinite(x) && !visibleInFog(vision,x,z) && !(Number.isFinite(e.tx)&&visibleInFog(vision,e.tx,e.tz)))continue;
      }
      this.audio.eventGain=eventHearingGain(this.myHero() || (this.isSpectator ? {x:this.focus.x,z:this.focus.z} : null),e);
      switch (e.type) {
        case 'groundstrike': {
          if(fogVisionSources(g).some(v=>Math.hypot(v.x-e.x,v.z-e.z)<v.radius)) {
            this._impactRing(e.x,e.z,{color:e.color||(e.kind==='acid'?0xdfff55:0xff7844),radius:e.radius,life:.28});
            this.burst(e.x, 0.35, e.z, { count: 16, color: e.color || 0xff7844, speed: 2.2, life: 0.4, size: 0.5, up: 1.6 });
          }
          break;
        }
        case 'herorelease': {
          if(e.fromId===this.myHero()?.id)this._coachSawAttack=true;
          if(!visibleInFog(vision,e.fx,e.fz)&&!visibleInFog(vision,e.tx,e.tz))break;
          if(e.kind==='melee')break; // melee sound and flash belong at contact
          this.audio.shoot(e.kind==='shotgun'?'shotgun':'soldier');
          this._spawnProjectile(e,{dur:e.duration,impact:null});
          const muzzle=this._muzzlePoint(e,e.kind);
          this.burst(muzzle.x,muzzle.y,muzzle.z,{count:e.kind==='shotgun'?10:5,color:0xffdf8a,speed:1,life:.12,size:.5});
          break;
        }
        case 'heroimpact': {
          if(!visibleInFog(vision,e.tx,e.tz))break;
          this.hitFeedback ||= new HitFeedback(this.scene,(x,z)=>this.map.groundY(x,z));
          this.hitFeedback.show(e);
          if(e.fromId===this.myHero()?.id&&e.damage>0)this.audio.hitConfirm(e.crit);
          if(e.kind==='melee')this.audio.melee();
          this._impactRing(e.tx,e.tz,{color:e.kind==='melee'?0xffd27a:0xffefb0,radius:e.kind==='melee'?1:.55,life:.18,count:8});
          this.burst(e.tx,this.map.groundY(e.tx,e.tz)+.7,e.tz,{count:8,color:0xffd27a,speed:1.8,life:.22,size:.32,up:1});
          break;
        }
        case 'shot': {
          this._presentCue(e);
          if (e.fromId === this.myHero()?.id) this._coachSawAttack = true;
          if (visibleInFog(vision,e.tx,e.tz)) {
            this.hitFeedback ||= new HitFeedback(this.scene, (x, z) => this.map.groundY(x, z));
            this.hitFeedback.show(e);
            if (e.fromId === this.myHero()?.id && e.damage > 0) {
              this.audio.hitConfirm(e.crit);
              if (e.crit && performance.now() >= (this._criticalImpactAt || 0)) {
                this._criticalImpactAt = performance.now() + 90;
                this._impactRing(e.tx, e.tz, { color: 0xffe39a, radius: 1.0, count: 8, life: 0.16 });
              }
            }
          }
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
          this._presentCue(e);
          this.spawnCorpse(e);
          if (e.big && this.audio.eventGain > 0 && performance.now() >= (this._eliteImpactAt || 0)) {
            this._eliteImpactAt = performance.now() + 300;
            this.audio.eliteBreak();
            this._impactRing(e.x, e.z, { color: 0xb9dfff, radius: 2.2, count: 16, life: 0.35 });
          }
          this.burst(e.x, 0.5, e.z, { count: e.big ? 22 : 10, color: 0xd9c8ff, speed: e.big ? 3.2 : 2.4, life: 0.4, size: e.big ? 0.7 : 0.5, up: 2 });
          this.burst(e.x, 0.55, e.z, { count: e.big ? 6 : 3, color: 0xffffff, speed: 0.6, life: 0.16, size: e.big ? 1.3 : 0.9, up: 0.4 });
          this.deathSfxT -= 1;
          if (this.deathSfxT <= 0) { this.audio.zombieDeath(); this.deathSfxT = 2; }
          break;
        case 'bite':
          if (e.fromId) this.zombieAttacks.set(e.fromId, { t: 0.34, dur: 0.34, tx: e.tx ?? e.x, tz: e.tz ?? e.z });
          if (e.fx !== undefined) this.stream(e.fx, 0.72, e.fz, e.x, 0.65, e.z, { count: 3, color: 0xff4636, size: 0.34, life: 0.18 });
          this.burst(e.x, 0.7, e.z, { count: 4, color: 0xffb070, speed: 1.2, life: 0.3, size: 0.35, up: 1 });
          break;
        case 'udeath':
          this.burst(e.x, 0.5, e.z, { count: 20, color: 0xbfe0ff, speed: 2.5, life: 0.6, size: 0.55, up: 2 });
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
          this._disposeObject3D(this.terrain);
          this.terrain = this.map.buildTerrain();
          this.scene.add(this.terrain);
          this._rememberCulledProps(this.terrain);
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
        case 'orderconfirmed':
          if (e.player === this.myPlayer) {
            this._noteCoach({ type: 'stance', stance: e.stance });
            this.audio.eventGain = 1;
            this.audio.click();
          }
          break;
        case 'firstsiege':
          this.audio.eventGain = 1;
          this.audio.levelup();
          this.ui.showBanner(`FIRST SIEGE BROKEN · +${e.reward} gold. Repair, reinforce, then push the lanes.`, 'good', 3200);
          this._noteCoach({ type: 'firstsiege' });
          break;
        case 'rally':
          if (e.player === this.myPlayer) this._noteCoach({ type: 'stance', stance: e.stance });
          this.audio.train();
          this.burst(e.x, 0.3, e.z, { count: 10, color: 0x59ff9c, speed: 1.4, life: 0.5, size: 0.45, up: 1.6 });
          break;
        case 'hold':
          if (e.player === this.myPlayer) this._noteCoach({ type: 'stance', stance: e.stance });
          this._impactRing(e.x, e.z, { color: 0x8acbff, radius: 5.5, count: 20, life: 0.55 });
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
          this._presentCue(e);
          const caster = this.unitMeshes.get(e.heroId);
          if (caster) caster.cast = { t: 0.52, dur: 0.52, kind: e.key };
          this.audio.cast({ weave: 'smoke', grenade: 'shrapnel', hammer: 'sunstrike', fortify: 'shieldup', brew: 'splash', clone: 'shimmer', summon: 'shimmer' }[e.key] || e.key);
          const CAST_COLORS = {
            hammer: 0x7a9cf0, grenade: 0xd8b45e, weave: 0x7fd85e, fortify: 0x8fd0ff, brew: 0xffb347, clone: 0xffa64d, summon: 0x8fd6ff, choir: 0xf0d060,
            trueflight: 0xf3c53d, glass_sight: 0x9dffc2, meridian: 0xfff1c2,
            rift_lance: 0xd8721f, stillpoint: 0xffd27a, dread_well: 0x6a4fae, unmake: 0xfff1c9,
            mending_pulse: 0xb7f0c8, still_ward: 0x8fd6ff,
          };
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
          this.burst(e.x, 0.2, e.z, { count: 6, color: e.color || 0xffb347, speed: 0.4, life: 0.5, size: 0.6, spread: 1.6, up: 0.4 });
          break;
        case 'mend':
          this._spawnAbilityRing(e.x, e.z, { color: e.color || 0xb7f0c8, radius: 0.4, to: e.radius || 4, life: 0.45, opacity: 0.8, width: 0.18 });
          this.burst(e.x, 0.8, e.z, { count: 14, color: e.color || 0xb7f0c8, speed: 1.2, life: 0.5, size: 0.45, up: 1.8 });
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
          this.burst(e.x, 0.5, e.z, { count: 40, color: 0xc8a6ff, speed: 3.5, life: 0.9, size: 0.7, up: 3 });
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
          if (this.replay) { this._noteReplayEnd(); break; }
          this.audio.victory();
          this.pause();
          this._recordGameEnd(true);
          this.ui.showEnd(true, g.stats, g.threatLevel, g.levelId, g.mode, this.profile.bestSurvival || 0, this._endExtras, g);
          break;
        case 'defeat':
          if (this.replay) { this._noteReplayEnd(); break; }
          this.audio.defeat();
          this.shake = 1.5;
          this.pause();
          this._recordGameEnd(false);
          this.ui.showEnd(false, g.stats, g.threatLevel, g.levelId, g.mode, this.profile.bestSurvival || 0, this._endExtras, g);
          break;
      }
    }
    this.audio.eventGain=1;
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
    if (this._coach && this.game) {
      const hero = this.myHero();
      if (hero) {
        if (!this._coachOrigin) this._coachOrigin = { x: hero.x, z: hero.z };
        const events = [];
        if (Math.hypot(hero.x - this._coachOrigin.x, hero.z - this._coachOrigin.z) > 1.4) events.push({ type: 'move' });
        if (this.game.phase !== 'found') events.push({ type: 'founded' });
        if (this.game.plots.some(plot => plot.kind !== 'hq' && plot.tier > 0)) events.push({ type: 'built' });
        if (this.game.firstSiege?.stage === 'complete') events.push({ type: 'firstsiege' });
        if (this._coachSawAttack) { events.push({ type: 'attack' }); this._coachSawAttack = false; }
        if (events.length) {
          this._coach = coachApply(this._coach, events);
          const siege = this.game.firstSiege;
          const paintKey = `${this._coach.index}|${siege?.stage}|${siege?.waveIds.length}|${Math.ceil(this.game.nests[siege?.nestId]?.musterT || 0)}`;
          if (paintKey !== this._coachPaintKey) { this._coachPaintKey = paintKey; this._paintCoach(); }
        }
      }
      return;
    }
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
    // Only Auto moves. An explicit Low, Medium, or High choice stays where
    // the player put it. A sustained stretch under ~40 FPS steps one tier.
    this.tacticalVisuals.noteFrame(dt);
    const active = this.game ? !this.paused : false;
    if (!active || this.tacticalVisuals.choice !== 'auto') {
      this.slowFrameT = 0;
      return;
    }
    const slow = dt > 1 / 40;
    this.slowFrameT = slow ? this.slowFrameT + dt : Math.max(0, this.slowFrameT - dt * 0.5);
    if (this.slowFrameT < 2 || this.tacticalVisuals.quality === 'low') return;
    this.slowFrameT = 0;
    const next = stepDownTier(this.tacticalVisuals.quality);
    this.tacticalVisuals.applyTier(next);
    this.ui.setQualityUI(this.tacticalVisuals.choice, this.tacticalVisuals.quality);
    this.ui.showBanner(`Graphics stepped to ${next} to hold 40 FPS. Auto is still selected.`, '', 5500);
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const hit = tickHitStop(this._hitFeel, dt);
    this._hitFeel = { hold: hit.hold, gap: hit.gap };
    this._hitStop = hit.hold;
    this._presentHold = hit.present;
    this._frameMs = this._frameMs * 0.88 + dt * 1000 * 0.12;
    const t = this.clock.elapsedTime;
    this._autoTuneQuality(dt);
    this._refreshDiagnosticsUI(false);
    if (this.missionIntro) {
      this.missionIntro.elapsed += dt;
      const progress = Math.min(1, this.missionIntro.elapsed / 4);
      const eased = progress * progress * (3 - 2 * progress);
      if (!this.missionIntro.held) this.camDist = this.missionIntro.distance + 16 * (1 - eased);
      if (progress >= 1) this._finishMissionIntro();
    }
    this._updateCamera(dt);
    this._beginCull();
    const hitVision=this.game ? fogVisionSources(this.game) : [];
    this.hitFeedback?.update(this._hitStop > 0 ? 0 : dt,(x,z)=>visibleInFog(hitVision,x,z));

    this._audioSceneAt = (this._audioSceneAt || 0) - dt;
    if (this._audioSceneAt <= 0) {
      this._audioSceneAt = 0.25;
      const g=this.game, listener=this.myHero();
      const nearby=g?.zombies?.filter(z=>!z.dead && hearingGain(listener,z)>0).length || 0;
      if (nearby >= 2) this._audioCombatUntil=t+5;
      this.audio.updateScene({inMatch:!!g,over:g?.over,won:g?.won,phase:g?.phase,
        biome:g?.level?.theme?.terrain,combat:!!g && t<(this._audioCombatUntil || 0),
        select:!!document.querySelector('#screen-setup:not(.hidden)')});
    }

    if (!this.game && this.titleSpace) {
      this._updateTitleSpace(t);
    }

    if(!this.game&&this._builderMesh)this._builderMesh.visible=false;
    if (this.game) {
      if (!this.missionIntro && !this.replay) this._updateHeroInput();
      if (this.replay) this._advanceReplay(dt);
      else if (!this.paused && !this.game.over && !this.missionIntro) {
        const simStarted = performance.now();
        let simTicks = 0;
        if (this.netMode) {
          const before = this.simFrame;
          this._advanceNetSim();
          simTicks = Math.max(0, this.simFrame - before);
        } else {
          this.acc += dt * this.speed;
          let steps = 0;
          while (this.acc >= SIM_DT && steps < 10) {
            this.game.update(SIM_DT);
            this.acc -= SIM_DT;
            steps++;
          }
          if (steps === 10) this.acc = 0;
          simTicks = steps;
        }
        if (simTicks > 0) this._simTickMs = (performance.now() - simStarted) / simTicks;
      }

      if (this.replay && (this.replay.speed > 2 || this.replay.seeking) && this.game.events) {
        const keep = this.game.events.filter((event) => event.type === 'victory' || event.type === 'defeat');
        this.game.events.length = 0;
        for (const event of keep) this.game.events.push(event);
      }
      this._consumeEvents();
      this._presentHold = this._presentHold || this._hitStop > 0;
      if (this._orderMarker) {
        this._orderMarkerLife -= dt;
        const life = this._orderMarkerLife;
        this._orderMarker.material.opacity = Math.max(0, life / 0.7);
        this._orderMarker.scale.setScalar(1 + (0.7 - Math.max(life, 0)) * 0.85);
        if (life <= 0) {
          this.scene.remove(this._orderMarker);
          this._orderMarker.geometry.dispose();
          this._orderMarker.material.dispose();
          this._orderMarker = null;
        }
      }
      this.map.syncLabyrinthDoors?.(this.game);
      this._syncBuildings();
      // One presentation pass for every animation frame, however many
      // simulation ticks that frame had to catch up. The camera frustum was
      // built once above; props and units reuse it.
      if (this.impostors && !this._presentHold) {
        this.impostors.begin();
        this._impostorOpen = true;
      }
      this._syncUnits(t, dt);
      this._syncBuilder(t);
      this._syncNests(t);
      this._syncLoot(t);
      this._syncPlots(t);
      this._updateTacticalSelection();
      this._updateCombatCues();

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
      if (this._impostorOpen) {
        this.impostors.commit();
        this._impostorOpen = false;
      }
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
          if (art.phase === 'critical' && material.emissive) material.emissive.lerp(_tmpColA.setHex(0xff321f), 0.72);
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
      const listener=this.myHero();
      const aggro = this.game.zombies.filter(z=>!z.dead && hearingGain(listener,z)>0).length;
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
      if (!this.replay && buildMode && mh && !mh.dead) {
        for (const plot of this.game.plots) {
          const nt = this.game.nextTier(plot);
          if (!nt || !nt.branch || this.game.plotAction(plot)?.mode !== 'branch') continue;
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
            const health = this.game.plotHpState(plot);
            const hpLabel = `${Math.ceil(health.hp)} / ${Math.ceil(health.maxHp)} HP`;
            const role = act.mode === 'repair' ? 'Restores health; keeps the current tier.' : this._plotRole(plot, nt);
            const buildKey = keyLabel(this.binds().dodge);
            const buildAltKey = keyLabel(this.binds().build);
            const overlayKey = keyLabel(this.binds().build_mode);
            hint = mh.payHold
              ? `<div><b>${act.mode === 'repair' ? '🔧 Repairing' : act.mode === 'rebuild' ? '🏗️ Rebuilding' : plot.tier > 0 ? '⬆️ Upgrading' : '🏗️ Building'} ${name}</b> · ${act.mode === 'repair' ? hpLabel + ' · ' : ''}${cost}🪙 remaining</div><div class="buildrole">${this.game.gold < 1 ? 'No gold — work paused.' : 'Release to stop.'}</div>`
              : buildMode
                ? `<div>Hold <kbd>${buildKey}</kbd> or <kbd>${buildAltKey}</kbd> — ${verb} <b>${name}</b> (${cost}🪙)${act.mode === 'repair' ? ' · ' + hpLabel : ''}</div><div class="buildrole">${role} · ${overlayKey} switches to Fight mode.</div>`
                : `<div><kbd>${overlayKey}</kbd> Build mode — ${verb} <b>${name}</b> (${cost}🪙)${act.mode === 'repair' ? ' · ' + hpLabel : ''}</div><div class="buildrole">${role}</div>`;
          }
        }
      }
      this.ui.showBuildHint(this.replay ? null : hint);

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
        const viewSize = this.camDist * 0.62;
        this.ui.drawMinimap(this.game, this.focus, viewSize);
      }
    }

    this._updateParticles(dt);
    this._updateCorpses(dt);
    this._updatePayCoins(dt);
    this._updateProjectiles(dt);
    this._updateAbilityFx(dt);
    this.tacticalVisuals.update(dt);
    this.renderer.info.reset();
    this.tacticalVisuals.render();
    if (this.perfHud) {
      const info = this.renderer.info.render;
      this.perfHud.update({
        fps: 1000 / Math.max(1, this._frameMs),
        drawCalls: info.calls,
        triangles: info.triangles,
        simMs: this._simTickMs || 0,
        label: `${this.tacticalVisuals.choice}${this.tacticalVisuals.choice === 'auto' ? ':' + this.tacticalVisuals.quality : ''}`,
      });
    }
    this._renderCharacterPreview(t);
  }
}

window.__app = new App(); // exposed for debugging
