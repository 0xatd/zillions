// DOM HUD and menus. The outer shell is multiplayer-first: Play Online leads
// to the lobby, while Play Solo contains Story Campaign and Survival. Both
// paths reuse the same battle setup screen. In-game, the compact action bar
// owns hero state, abilities, building actions, and army stance.
const PORTRAITS = {
  alexander: 'assets/heroes/portraits/alexander_256.webp',
  scott: 'assets/heroes/portraits/scott_256.webp',
  danny: 'assets/heroes/portraits/danny_256.webp',
};
import {
  PLOT_KINDS, DIFFICULTY, LEVELS, levelById, isGalaxyLevel, ITEMS, itemInfo, itemMods, PACK_SLOTS,
  HEROES, HERO_MAX_LEVEL, xpForLevel, abilityRank, LABYRINTH_LEVELS,
} from './config.js';
import { formatTime } from './utils.js';
import { combatAlert, runReview } from './combat-readability.js';
import { TERRAIN_SHAPES, TerrainField } from './terrain.js';
import { CITY_PLANS } from './plots.js';
import { FOG_DARKNESS, FOG_EDGE_SOFTNESS, fogVisionSources } from './fog-of-war.js';
import {
  MMO_CLASSES, MMO_RACES, CLASS_ATTRS, CREATOR_PARTS, APPEARANCES, MAX_MMO_CHARACTERS, xpToMmoLevel, STASH_SLOTS,
  allocateLatticeNode, deallocateLatticeNode, rewireLattice, normalizeEquipment, characterAttributes,
  setLatticeNodeSet, canEquip, legalEquipment,
} from './mmo-characters.js';
import { loadMeta, charge, META_CURRENCY } from './meta.js';
import {
  ACTIONS, ACTIONS_BY_ID, BIND_CONTEXTS, keyLabel, loadBinds, allConflicts, conflictsFor,
} from './keybinds.js';
import {
  buildLattice, frontier, pathTo, canAllocate, canDeallocate, latticePoints,
  treeBonuses, originIdFor, SECTORS, DOCTRINES, rewireCost,
} from './skilltree.js';
import {
  EQUIP_SLOTS, slotPool, slotsForPool, itemLines, meetsRequirement, requirementText, ATTRIBUTES,
} from './items.js';
import { ShellState, SHELL_BASES } from './shell-state.js';
import { VENDORS, vendorEligibility, vendorRotation, vendorStock, vendorSellPrice, buyVendorItem, sellVendorItem } from './vendor.js';
import { runEconomyMutation } from './economy.js';
import { COMPONENTS, CRAFTING_MATERIALS, RECIPES, componentMods } from './crafting.js';
import { firstHourGuidance, firstHourStep, equipmentPreview, compactDeltas, missionRewardSummary } from './first-hour.js';
import { normalizeLivingWorld } from './living-world-ui.js';

const CRAFT_VENDOR_PRICES = { alloy_shard: 8, phase_flux: 18, prism_dust: 32, ascendant_core: 120 };
const modImpact = (mods = {}) => Object.entries(mods).filter(([, value]) => value).map(([key, value]) =>
  `+${value < 1 ? `${Math.round(value * 100)}%` : value} ${key}`).join(' · ') || 'No combat stat change';
const recipeCost = (recipe) => [
  `${recipe.cost.alloy} Alloy`,
  ...Object.entries(recipe.cost.materials || {}).map(([id, count]) => `${count} ${CRAFTING_MATERIALS[id]?.name || id}`),
].join(' · ');

// A player-authored name is the only free text in this UI. Names are written
// with textContent wherever possible; where markup has to be built, they go
// through here.
const escapeHtml = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export class UI {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.shell = new ShellState();
    this.msgSeen = 0;
    this.pauseOpen = false;
    this._livingWorld = normalizeLivingWorld();
    this._buildDOM();
  }

  _buildDOM() {
    this.root.innerHTML = `
      <div id="topbar" class="hidden">
        <div class="res gold" id="r-gold" title="Gold — income is paid automatically, coins drop from fighting. Hold your Build key at a foundation to spend">🪙 <b>0</b></div>
        <div class="res" id="r-day" title="Threat — rises with the clock, with every hive still standing, and with every node you take">☠️ <b>Threat 1</b></div>
        <div class="res" id="r-front" title="Lane nodes you hold · hive nests still mustering">🚩 <b>0</b> · 🔥 <b>0</b></div>
        <div class="res" id="r-z" title="Enemies remaining">🧟 0</div>
        <div class="netdiag hidden" id="netdiag" title="Live multiplayer route, latency, jitter buffer, and device frame rate"></div>
        <div class="sep"></div>
        <button class="tbtn" id="b-pause" title="Pause (P)">⏸</button>
        <button class="tbtn speed" data-s="1">1×</button>
        <button class="tbtn speed" data-s="2">2×</button>
        <button class="tbtn" id="b-mute" title="Mute sound (M)">🔊</button>
        <button class="tbtn" id="b-quality" title="Toggle graphics quality">✨</button>
        <button class="tbtn" id="b-menu" title="Menu (Esc)">☰</button>
      </div>

      <div id="banner"></div>
      <div id="invitetoast" class="hidden"></div>
      <div id="waitind" class="hidden">⏳ Syncing co-op…</div>
      <div id="bossbar" class="hidden"><b id="boss-name"></b><div class="bossfillwrap"><div id="boss-fill"></div></div></div>
      <div id="combat-alert" class="combat-alert hidden" role="status" aria-live="polite"></div>
      <div id="messages"></div>
      <div id="ow-quick-actions" class="owquick hidden">
        <button id="ow-party" class="tbtn ow-party-action" title="Create a party or invite friends">＋ PARTY</button>
        <button id="ow-map" class="tbtn ow-map-action" title="Open world map and mission finder">🗺 WORLD MAP</button>
        <button id="ow-menu" class="tbtn" title="Game menu (Esc)">☰ MENU</button>
      </div>

      <aside id="ow-party-frames" class="ow-party-frames hidden" aria-label="Party"></aside>

      <section id="living-world-map" class="living-world-map hidden" role="dialog" aria-modal="true" aria-label="World map">
        <div class="lw-shell">
          <header class="lw-head"><div><span>LIVING WORLD</span><h1 id="lw-world-name">EARTH FRONTIER</h1><small id="lw-region"></small></div><div class="lw-head-actions"><button class="tbtn" id="lw-party">＋ PARTY</button><button class="tbtn" id="lw-close">CLOSE</button></div></header>
          <div class="lw-body">
            <div class="lw-map-stage" id="lw-map-stage"><div id="lw-regions" class="lw-regions"></div><div class="lw-map-grid"></div><svg id="lw-routes" viewBox="0 0 100 100" preserveAspectRatio="none"></svg><div id="lw-map-nodes"></div><div class="lw-legend"><span><i class="free"></i> Allied</span><span><i class="hive"></i> Hostile</span><span><i class="neutral"></i> Neutral</span><span>Dashed route: contested</span></div></div>
            <aside class="lw-finder"><span class="lw-kicker">MISSION FINDER</span><h2>Choose your next move</h2><p>Travel the roads for encounters and discoveries, or deploy directly to a known destination.</p><div id="lw-logistics" class="lw-selection"></div><div id="lw-missions"></div><div id="lw-selection" class="lw-selection"><small>SELECT A DESTINATION</small><b>World map</b><p>Known towns support fast travel. Discovered fronts support direct deployment.</p></div></aside>
          </div>
        </div>
      </section>

      <div id="gamechat" class="gamechat hidden">
        <div class="gamechatlog" id="gamechat-log"></div>
        <div class="gamechatrow hidden" id="gamechat-row">
          <input id="gamechat-input" maxlength="500" placeholder="Team chat…">
          <button class="tbtn" id="gamechat-send">Send</button>
        </div>
      </div>

      <div id="actionbar" class="hidden">
        <div class="commandtop">
          <div class="rallyhints" id="stancebar">
            <span class="stance" data-st="defend" data-bind="stance_defend" title="Hold the current city line"><b></b> 🛡️ Defend city</span><span class="stance" data-st="guard" data-bind="stance_follow" title="Escort the hero"><b></b> 🚩 Follow hero</span><span class="stance" data-st="attack" data-bind="stance_push" title="Push the lanes: take nodes, then siege the hives"><b></b> ⚔️ Push lanes</span>
          </div>
          <button class="mode-toggle build" id="mode-toggle" title="Switch between Build and Fight controls"><b data-bind-label="build_mode"></b><span>Build mode</span></button>
          <div class="armystatus" id="army-status">Build camps to raise squads.</div>
        </div>
        <div class="actionmain">
          <div id="heroplate">
            <span class="hpportrait" id="a-face"></span>
            <div class="hpinfo">
              <b id="a-name"></b> <span class="hplvl" id="a-lvl">Lv 1</span>
              <div class="hpbar herohp"><div class="hpfill" id="a-hp"></div></div>
              <div class="hpbar heroxp"><div class="xpfill" id="a-xp"></div></div>
              <div id="a-items"></div>
              <div id="a-pack" class="packrow" title="Field finds — walk over loot to pick it up, G to drop"></div>
            </div>
          </div>
          <div id="herostats" class="herostats"></div>
          <div id="fight-kit" class="fight-kit hidden" aria-label="Hero abilities"></div>
          <div id="upgradepanel" class="hidden"></div>
          <button id="bigaction" class="bigaction"></button>
        </div>
        <div id="branchpanel" class="hidden"></div>
        <div id="blessingpanel" class="hidden"></div>
        <div id="buildhint" class="hidden"></div>
      </div>

      <div id="minimap-wrap" class="hidden">
        <canvas id="minimap-base"></canvas>
        <canvas id="minimap-top"></canvas>
      </div>

      <div id="tooltip" class="hidden"></div>

      <div id="overlay" class="screen">
        <div id="screen-account" class="accountscreen title-screen">
          <div class="title-lockup">
            <div class="brandeyebrow">THE LAST WAR CROSSES THE STARS</div>
            <h1 class="gametitle">ZILLIONS</h1>
            <p class="gamesub">Every world is a battlefield.</p>
          </div>
          <div class="accountcard title-login">
            <div class="login-heading"><span>ACCOUNT LOGIN</span><h2>Welcome to Zillions</h2><p>Sign in to continue to your characters and worlds.</p></div>
            <div class="accountstatus" id="account-status">Checking account…</div>
            <button class="menubtn primary login-provider" id="a-google"><span class="google-mark">G</span><span>Continue with Google</span></button>
            <div class="login-divider" id="a-login-divider"><span>OR</span></div>
            <form class="email-login" id="a-email-form">
              <label for="a-email">Email address</label>
              <input id="a-email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required>
              <button class="menubtn" id="a-email-submit" type="submit">Continue with email</button>
              <small>We will email you a secure sign-in link. No password required.</small>
            </form>
            <button class="menubtn hidden" id="a-offline">ENTER OFFLINE</button>
            <form class="usernameform hidden" id="a-username-form">
              <label for="a-username">Public username</label>
              <div class="usernamerow">
                <span>@</span>
                <input id="a-username" maxlength="18" autocomplete="username" spellcheck="false" placeholder="commander_name">
              </div>
              <button class="menubtn primary" type="submit">Claim username</button>
              <small>Letters, numbers, and underscores. Other players see this.</small>
            </form>
          </div>
          <nav class="title-utilities" aria-label="Title menu">
            <button id="a-cinematics">CINEMATICS</button>
            <button id="a-credits">CREDITS</button>
            <button id="a-settings">SETTINGS</button>
            <button id="a-quit">QUIT</button>
          </nav>
          <div class="planet-status"><span class="online-pip"></span> EARTH FRONT · STARSHIP ONLINE <small>BUILD 0.1</small></div>
        </div>

        <div id="screen-main" class="mainmenu character-select">
          <div class="character-heading"><span>GALAXY ROSTER</span><h1>SELECT CHARACTER</h1><small>Your class, equipment, level and last world persist between adventures. Press C in the world to return here.</small></div>
          <div id="first-hour-guide" class="first-hour-guide hidden" role="status"></div>
          <div id="character-stage" class="character-stage">
            <div id="character-avatar" class="character-avatar" aria-label="Selected character">
              <div class="avatar-backlight"></div>
              <div class="avatar-body">
                <span class="avatar-head"></span><span class="avatar-torso"></span>
                <span class="avatar-arm left"></span><span class="avatar-arm right"></span>
                <span class="avatar-leg left"></span><span class="avatar-leg right"></span>
                <span class="avatar-weapon" id="character-weapon"></span>
                <span id="character-sigil" class="character-sigil"></span>
              </div>
              <div class="avatar-loadout" id="character-loadout"></div>
            </div>
            <div class="character-copy"><h2 id="character-name"></h2><p id="character-tagline"></p><div id="character-gear" class="character-gear"></div></div>
          </div>
          <aside class="character-roster"><div id="character-list"></div><button class="enter-world" id="m-enter-world">ENTER WORLD</button><button class="character-create" id="m-create-character">CREATE NEW CHARACTER</button><button class="character-sheet-open danger" id="m-delete-character">DELETE CHARACTER</button></aside>
          <div class="character-footer"><div class="profilerow"><span id="prof-name-display">Signed in</span><span id="prof-stats"></span></div><button class="utilitybtn" id="m-character-sheet">CHARACTER INFO</button><button class="utilitybtn" id="m-custom">CUSTOM GAMES</button><button class="utilitybtn" id="m-settings">MENU</button><button class="utilitybtn danger" id="m-logout">LOG OUT</button></div>
        </div>

        <div id="screen-world-menu" class="world-menu hidden">
          <div class="world-menu-card">
            <span class="world-menu-eyebrow">ZILLIONS</span><h1>GAME MENU</h1>
            <button class="menubtn primary" id="ow-resume">RETURN TO WORLD</button>
            <button class="menubtn" id="ow-world-map">WORLD MAP & MISSIONS</button>
            <button class="menubtn" id="ow-party-menu">CREATE / VIEW PARTY</button>
            <button class="menubtn" id="ow-characters">CHARACTER SELECT</button>
            <button class="menubtn" id="ow-settings">SYSTEM</button>
            <button class="menubtn danger" id="ow-logout">LOG OUT</button>
          </div>
        </div>

        <div id="screen-character-sheet" class="sheet-screen hidden">
          <div class="sheet-head">
            <div class="sheet-ident"><span id="sheet-sigil" class="sheet-sigil"></span>
              <div><h1 id="sheet-name">CHARACTER</h1><p id="sheet-sub"></p></div></div>
            <div class="sheet-tabs">
              <button class="sheet-tab sel" id="sheet-tab-character" data-tab="character">CHARACTER</button>
              <button class="sheet-tab" id="sheet-tab-gear" data-tab="gear">EQUIPMENT</button>
              <button class="sheet-tab" id="sheet-tab-shop" data-tab="shop">MARKET</button>
              <button class="sheet-tab" id="sheet-tab-crafting" data-tab="crafting">FORGE</button>
              <button class="sheet-tab" id="sheet-tab-abilities" data-tab="abilities">ABILITIES</button>
              <button class="sheet-tab" id="sheet-tab-lattice" data-tab="lattice">THE LATTICE</button>
            </div>
            <button class="utilitybtn" id="sheet-close">← BACK</button>
          </div>

          <div id="sheet-panel-character" class="sheet-panel character-overview"></div>

          <div id="sheet-panel-gear" class="sheet-panel hidden">
            <div class="gear-paperdoll"><h3>EQUIPPED</h3><div id="sheet-guide-gear" class="sheet-guide"></div><div class="gear-slots" id="gear-slots"></div></div>
            <div class="gear-stash"><h3>FIELD STASH <small id="gear-stash-count"></small></h3><div id="gear-stash-list"></div></div>
            <div class="gear-inspector"><h3>ITEM DETAILS</h3><div id="gear-item-detail" class="gear-item-detail"><p>Select an item to inspect it. Double-click a stash item to equip it.</p></div><div class="gear-stats"><h3>CURRENT ATTRIBUTES</h3><div id="gear-stat-list"></div></div></div>
          </div>

          <div id="sheet-panel-shop" class="sheet-panel market-panel hidden">
            <section class="market-head"><div><span class="modeeyebrow">ORBITAL EXCHANGE</span><h2 id="market-vendor-name">FRONTIER QUARTERMASTER</h2><p id="market-vendor-description">Rotating field gear. Buy with Salvage Alloy or sell recovered equipment.</p><div id="sheet-guide-market" class="sheet-guide"></div></div><strong id="market-balance"></strong></section>
            <nav id="market-vendors" class="market-vendors" aria-label="Specialist vendors"></nav>
            <section><h3>FOR SALE</h3><div class="market-grid" id="market-stock"></div></section>
            <section><h3>YOUR STASH</h3><div class="market-grid" id="market-sell"></div></section>
          </div>

          <div id="sheet-panel-crafting" class="sheet-panel crafting-panel hidden">
            <section><span class="modeeyebrow">ORBITAL FORGE</span><h2>CRAFTING & SOCKETS</h2><p>All actions use the online ledger. Failed or repeated requests never consume resources.</p><div id="sheet-guide-forge" class="sheet-guide"></div><div id="craft-resources"></div><div id="craft-vendor"></div></section>
            <section><h3>SELECT ITEM</h3><div id="craft-items" class="market-grid"></div></section>
            <section><h3>WORKBENCH</h3><div id="craft-workbench"><p>Select an item.</p></div><div id="craft-status" role="status"></div></section>
          </div>

          <div id="sheet-panel-abilities" class="sheet-panel abilities-overview hidden"></div>

          <div id="sheet-panel-lattice" class="sheet-panel hidden">
            <div class="lattice-stage">
              <canvas id="lattice-canvas"></canvas>
              <div class="lattice-hud">
                <span id="lattice-points"></span>
                <input id="lattice-search" placeholder="Search the Lattice" autocomplete="off">
                <button class="utilitybtn" id="lattice-rewire">REWIRE</button>
              </div>
            </div>
            <aside class="lattice-detail" id="lattice-detail"></aside>
          </div>
        </div>

        <div id="screen-character-create" class="character-create-screen hidden">
          <div class="creator-head"><span>NEW GALAXY CHARACTER</span><h1>BUILD YOUR HERO</h1><p>Choose who you are, then choose how you fight. Every launch option is free.</p></div>
          <form id="character-create-form" class="creator-form creator-xl">
            <section class="creator-preview" id="creator-preview" aria-label="Live 3D character preview"><canvas id="creator-preview-canvas"></canvas><strong id="creator-preview-race">HUMAN</strong><span>The same procedural model appears in the world and in combat.</span></section>
            <div class="creator-controls">
              <label>NAME<input id="creator-name" maxlength="18" autocomplete="off" placeholder="Character name" required></label>
              <fieldset><legend>ORIGIN</legend><div id="creator-races" class="creator-races"></div></fieldset>
              <div class="creator-parts" id="creator-parts"></div>
              <fieldset><legend>ARMOR COLOR</legend><div id="creator-appearance" class="creator-appearance"></div></fieldset>
              <fieldset><legend>CLASS</legend><div id="creator-classes" class="creator-classes"></div></fieldset>
            </div>
            <div id="creator-summary" class="creator-summary"></div>
            <div class="creator-actions"><button type="button" class="utilitybtn" id="creator-cancel">CANCEL</button><button type="submit" class="enter-world">CREATE CHARACTER</button></div>
          </form>
        </div>

        <div id="screen-solo" class="mainmenu solomenu hidden">
          <button class="tbtn menuback" id="solo-back">← Character select</button>
          <h1 class="gametitle small">CUSTOM GAMES</h1>
          <p class="gamesub">Challenges and private wars outside the persistent world.</p>
          <div class="solomodes">
            <section class="modecard">
              <div class="modeeyebrow">MULTIPLAYER</div><h2>🌐 Public & Private Wars</h2><p>Create, join, or watch custom battles with other commanders.</p><button class="menubtn modeprimary" id="custom-online">Open lobby <span class="menuarrow">›</span></button>
            </section>
            <section class="modecard">
              <div class="modeeyebrow">REPLAYABLE</div>
              <h2>💀 Survival</h2>
              <p>Build one city against an endless siege. Your highest Threat is the score.</p>
              <div id="solo-survival-resume" class="moderesume"></div>
              <button class="menubtn modeprimary" id="solo-survival">Start a run <span class="menuarrow">›</span></button>
            </section>
            <section class="modecard">
              <div class="modeeyebrow">GAUNTLET</div>
              <h2>🌀 The Labyrinth</h2>
              <p>No colony, no army — one hero against the deep. Raze each brood chamber, take its blessing, kill the champion, walk out.</p>
              <div id="solo-labyrinth-resume" class="moderesume"></div>
              <button class="menubtn modeprimary" id="solo-labyrinth">Enter the trial <span class="menuarrow">›</span></button>
            </section>
          </div>
        </div>

        <div id="screen-custom" class="custom-browser hidden">
          <header class="custom-head"><button class="tbtn" id="cu-back">← BACK</button><div><span>CUSTOM GAMES</span><h1>GAME BROWSER</h1></div><div class="custom-identity"><b id="cu-character">COMMANDER</b><small id="cu-party">PARTY 1/4</small></div></header>
          <aside class="custom-nav">
            <button class="custom-primary-tab sel" data-view="live">LIVE GAMES</button>
            <button class="custom-primary-tab" data-view="arcade">ARCADE</button>
            <div class="custom-filter-group" id="cu-mode-filters">
              <span>MODE</span>
              <button class="custom-filter sel" data-filter="all">ALL</button>
              <button class="custom-filter" data-filter="campaign">CAMPAIGN</button>
              <button class="custom-filter" data-filter="survival">SURVIVAL</button>
              <button class="custom-filter" data-filter="labyrinth">LABYRINTH</button>
            </div>
            <label id="cu-status-label">STATUS<select id="cu-status"><option value="open">JOINABLE</option><option value="all">ALL</option><option value="playing">IN PROGRESS</option></select></label>
            <label>SEARCH<input id="cu-search" placeholder="Game, host, or map" autocomplete="off"></label>
            <div class="custom-arcade-shortcuts hidden" id="cu-arcade-shortcuts"><button data-arcade="all" class="sel">ALL MAPS</button><button data-arcade="recent">RECENT</button><button data-arcade="favorites">FAVORITES</button></div>
          </aside>
          <main class="custom-list-panel"><div class="custom-list-head"><span>GAME</span><span>MAP / MODE</span><span>PLAYERS</span><span>STATUS</span></div><div id="cu-list" class="custom-game-list"></div><div class="mphint" id="cu-note"></div></main>
          <aside class="custom-detail" id="cu-detail"><span class="modeeyebrow">SELECT A GAME</span><h2>NO GAME SELECTED</h2><p>Choose a game to inspect its map, rules, host, and party.</p></aside>
          <footer class="custom-actions"><button class="diffbtn" id="cu-refresh">↻ REFRESH</button><button class="menubtn" id="cu-join" disabled>JOIN GAME</button><button class="menubtn primary" id="cu-create">CREATE GAME</button></footer>
          <div id="cu-create-panel" class="charcreate custom-create-panel hidden">
            <div class="cchead"><b>CREATE GAME</b><button class="tbtn" id="cu-cancel">✕</button></div>
            <label class="field-label" for="cu-name">Game name</label><input id="cu-name" maxlength="32" placeholder="Friday night siege" autocomplete="off">
            <label class="field-label">Map</label><select id="cu-map" class="cumap"></select>
            <label class="field-label">Difficulty</label><div class="diffseg" id="cu-diff"></div>
            <label class="field-label">Max players</label><div class="diffseg" id="cu-max"></div>
            <button class="menubtn primary" id="cu-confirm">CREATE GAME</button>
          </div>
        </div>

        <div id="screen-cinematics" class="setup hidden"><div class="setuphead"><button class="tbtn info-back">← Back</button><h2>Cinematics</h2></div><div class="howto stats">The opening transmission and campaign cinematics will appear here as they are recovered.</div></div>
        <div id="screen-credits" class="setup hidden"><div class="setuphead"><button class="tbtn info-back">← Back</button><h2>Credits</h2></div><div class="howto stats"><b>ZILLIONS</b><br>Created by 0xatd and the Taborlin agent crew.<br><br>Humanity has one city left. The dead have every world.</div></div>

        <div id="screen-galaxy" class="galaxy-screen hidden">
          <div class="galaxy-head"><span>STARSHIP NAVIGATION</span><h1>THE KNOWN GALAXY</h1><p>Select a destination. Planetary zones and battle instances load inside the same persistent journey.</p></div>
          <div id="galaxy-map" class="galaxy-map"></div>
          <aside id="galaxy-detail" class="galaxy-detail"></aside>
          <button class="tbtn galaxy-back" id="galaxy-back">← RETURN</button>
        </div>

        <div id="screen-setup" class="setup hidden">
          <div class="setuphead">
            <button class="tbtn roomexit" id="s-back">← Back</button>
            <h2 id="s-title">Choose your battle</h2>
            <div id="modeseg" class="modeseg hidden"></div>
          </div>
          <div class="steplabel field-label">1 · Battlefield <span id="warstatus" class="warstatus"></span></div>
          <div class="levelrow" id="levelrow"></div>
          <div class="steplabel hero-label">2 · Your hero <small>— move with WASD; in Fight mode dodge with <span data-bind-label="dodge"></span> and use the special with <span data-bind-label="ability1"></span></small></div>
          <div class="herorow" id="herorow"></div>
          <div class="steplabel diff-label">3 · Difficulty</div>
          <div class="diffseg" id="diffseg"></div>
          <div id="mp-panel" class="hidden"></div>
          <button class="startbtn" id="s-start">▶ &nbsp;START — TAKE THE PLANET</button>
        </div>

        <div id="screen-lobby" class="setup lobby hidden">
          <div class="setuphead">
            <button class="tbtn" id="l-back">← Back</button>
            <h2>🌐 The Lobby</h2>
            <span class="lobbyme" id="l-me"></span>
            <span class="lobbycode" id="l-mycode"></span>
            <span class="lobbyonline" id="l-online">…</span>
          </div>
          <div class="lobbygrid">
            <div class="lobbychat">
              <div class="lobbychatlog" id="l-chatlog"></div>
              <div class="lobbychatrow">
                <input id="l-chatinput" maxlength="400" placeholder="Say something to every commander alive…">
                <button class="tbtn" id="l-chatsend">Send</button>
              </div>
            </div>
            <div class="lobbymain">
              <div class="lobbytabs">
                <button class="ltab sel" data-tab="games">⚔️ Games</button>
                <button class="ltab" data-tab="lore">📜 Lore</button>
                <button class="ltab" data-tab="tips">💡 Tips</button>
              </div>
              <div id="l-tab-games" class="ltabpane">
                <div class="lobbycreate">
                  <button class="createcard" id="l-create-pub">
                    <span class="cc-icon">🌐</span>
                    <b>Create public game</b>
                    <small>Anyone can see it and join</small>
                  </button>
                  <button class="createcard" id="l-create-priv">
                    <span class="cc-icon">🔒</span>
                    <b>Create private game</b>
                    <small>Invite by 6-letter code</small>
                  </button>
                  <button class="createcard" id="l-create-join">
                    <span class="cc-icon">🎫</span>
                    <b>Join by code</b>
                    <small>Enter a friend's invite code</small>
                  </button>
                </div>
                <div id="l-games" class="lobbygames"></div>
                <div class="mphint">Public games appear here for everyone. Private games are joined by code. <a href="#" id="l-manual">Manual invite codes</a> work without the internet lobby.</div>
              </div>
              <div id="l-tab-lore" class="ltabpane hidden"></div>
              <div id="l-tab-tips" class="ltabpane hidden"></div>
            </div>
            <div class="lobbyfriends">
              <div class="friendshead"><b>Online now</b><span id="l-player-count"></span></div>
              <div id="l-players" class="onlineplayers"></div>
              <div class="friendshead"><b>Friends</b><span id="l-friend-count"></span></div>
              <div class="friendadd">
                <input id="l-friendcode" maxlength="32" placeholder="@username">
                <button class="tbtn" id="l-friendadd">Add</button>
              </div>
              <div id="l-friends" class="friendlist"></div>
            </div>
          </div>
        </div>

        <div id="screen-help" class="setup hidden">
          <div class="setuphead">
            <button class="tbtn" id="h-back">← Back</button>
            <h2>How to play</h2>
          </div>
          <div class="howto">
            <div><b>🕹️ You are the hero.</b> WASD always moves. In Fight mode, <kbd data-bind-label="dodge"></kbd> dodge-rolls and <kbd data-bind-label="ability1"></kbd> uses your special.</div>
            <div><b>🪙 One resource: gold.</b> Income is credited automatically; coins drop from kills, captured nodes and razed hives. Ride through them to collect.</div>
            <div><b>🏗️ The city is pre-planned.</b> Use <kbd data-bind-label="build_mode"></kbd> for Build mode, then hold <kbd data-bind-label="dodge"></kbd> or <kbd data-bind-label="build"></kbd> at a glowing foundation.</div>
            <div><b>⚔️ Camps are faucets.</b> Every camp musters a fresh formation on a timer, forever. Press <kbd data-bind-label="stance_push"></kbd> and those squads push the lanes together — no unit micro.</div>
            <div><b>🚩 Take the lane nodes.</b> Stand on one with no enemies nearby and it flips to you. Held nodes pay income, and you can raise a Forward Camp on them so squads muster at the front.</div>
            <div><b>🔥 Hives are stronger factories.</b> One nest outproduces one human camp and accelerates as Threat climbs. Its dead do not form ranks; they flood. Raze it to stop it.</div>
            <div><b>🔧 Nothing repairs itself.</b> Build mode makes <kbd data-bind-label="dodge"></kbd> build, repair, or rebuild. Fight mode makes it dodge and enables <kbd data-bind-label="ability1"></kbd>. Press <kbd data-bind-label="tower_priority"></kbd> beside a tower to change what it shoots first.</div>
            <div><b>⚔️ Your army uses blended control.</b> Squads fight automatically. You set the plan: <b>F1</b> DEFEND city, <b>F2</b> FOLLOW hero, <b>F3</b> HUNT hives.</div>
            <div><b>👑 Level up</b> from nearby kills. Spend upgrade points on Aura, Passive I, Passive II, or Ult Damage.</div>
            <div><b>🔁 Two weapon sets.</b> Press <kbd>X</kbd> to draw the other one. Every key here can be rebound in Settings → Controls. A scattergun for the press and a rifle for the pass is a real decision — the swap has a cooldown, and Lattice nodes can be pinned to one set.</div>
            <div><b>☠️ Threat is the clock.</b> It rises on its own, faster while hives stand, and every whole level makes every hive muster at once. If the Keep falls, all is lost.</div>
          </div>
        </div>

        <div id="screen-pause" class="mainmenu hidden">
          <h1 class="gametitle small">⚔️ PAUSED</h1>
          <div class="menustack">
            <button class="menubtn primary" id="p-resume">▶ &nbsp;Resume</button>
            <button class="menubtn" id="p-help">📜 &nbsp;How to play</button>
            <button class="menubtn" id="p-settings">⚙️ &nbsp;Settings</button>
            <button class="menubtn" id="p-restart">🔄 &nbsp;Restart level</button>
            <button class="menubtn" id="p-quit">🚪 &nbsp;Quit to menu</button>
          </div>
          <div id="p-note" class="gamesub"></div>
        </div>
        <div id="screen-heroes" class="setup hidden">
          <div class="setuphead">
            <button class="tbtn" id="hero-back">← Back</button>
            <h2>Heroes of the Frontier</h2>
            <span class="gamesub">Tab anywhere in the menu to open this</span>
          </div>
          <div class="herogrid" id="herogrid"></div>
        </div>
        <div id="screen-settings" class="setup hidden">
          <div class="setuphead">
            <button class="tbtn" id="set-back">← Back</button>
            <h2>⚙️ Settings</h2>
          </div>
          <div class="settingsgrid">
            <div class="settingstabs">
              <button class="stab sel" data-tab="audio">🔊 Audio</button>
              <button class="stab" data-tab="video">🖥️ Video</button>
              <button class="stab" data-tab="controls">⌨️ Controls</button>
            </div>
            <div class="settingspane">
              <div id="set-pane-audio" class="setpane">
                <label class="setrow">
                  <span>Master volume</span>
                  <input type="range" id="set-vol" min="0" max="100" value="100">
                  <b id="set-vol-val">100%</b>
                </label>
                <label class="setrow">
                  <span>Music volume</span>
                  <input type="range" id="set-music" min="0" max="100" value="100">
                  <b id="set-music-val">100%</b>
                </label>
                <label class="setrow">
                  <span>Sound effects</span>
                  <input type="checkbox" id="set-sfx">
                  <b id="set-sfx-val"></b>
                </label>
                <div class="sethint">Effects are procedural WebAudio; hero barks are pre-recorded. Mute anytime with <kbd>M</kbd>.</div>
              </div>
              <div id="set-pane-video" class="setpane hidden">
                <div class="setrow">
                  <span>Graphics quality</span>
                  <div class="modeseg" id="set-quality">
                    <button class="diffbtn" data-q="low">Performance</button>
                    <button class="diffbtn" data-q="high">Quality</button>
                  </div>
                </div>
                <div class="sethint">Quality mode enables shadows and full-resolution rendering. Performance mode halves pixel ratio and disables shadows — for weaker machines and long co-op sessions.</div>
              </div>
              <div id="set-pane-controls" class="setpane hidden">
                <div class="bindhead">
                  <p>Click any key to rebind it. Two actions that can be used at the same time may not share a key — rebinding onto one hands it the key you replaced.</p>
                  <button class="tbtn" id="set-binds-reset">Restore defaults</button>
                </div>
                <div id="set-binds"></div>
              </div>
            </div>
          </div>
        </div>
        <div id="room-confirm" class="roomconfirm hidden" role="dialog" aria-modal="true" aria-labelledby="room-confirm-title">
          <div class="roomconfirmcard">
            <span class="roomeyebrow">Multiplayer room</span>
            <h2 id="room-confirm-title">Leave lobby?</h2>
            <p id="room-confirm-copy"></p>
            <div class="roomconfirmactions">
              <button class="tbtn" id="room-confirm-cancel">STAY IN LOBBY</button>
              <button class="tbtn danger" id="room-confirm-leave">LEAVE LOBBY</button>
            </div>
          </div>
        </div>
      </div>`;

    // ----- main menu -----
    const q = (s) => this.root.querySelector(s);
    q('#a-google').onclick = () => this.cb.onSignIn && this.cb.onSignIn();
    q('#a-email-form').onsubmit = (event) => {
      event.preventDefault();
      if (this.cb.onEmailSignIn) this.cb.onEmailSignIn(q('#a-email').value);
    };
    q('#a-offline').onclick = () => { this._offlineAccepted = true; if (this.cb.onOfflineContinue) this.cb.onOfflineContinue(); };
    q('#a-cinematics').onclick = () => this._showScreen('cinematics');
    q('#a-credits').onclick = () => this._showScreen('credits');
    q('#a-settings').onclick = () => { this._settingsReturn = 'account'; this._showScreen('settings'); };
    q('#a-quit').onclick = () => this.showBanner('Close this browser tab to leave the frontier.', '', 3200);
    q('#a-username-form').onsubmit = (e) => {
      e.preventDefault();
      const input = q('#a-username');
      if (this.cb.onUsername) this.cb.onUsername(input.value);
    };
    q('#m-enter-world').onclick = () => this.cb.onCampaignMap && this.cb.onCampaignMap();
    q('#m-create-character').onclick = () => this._showCharacterCreator();
    q('#m-character-sheet').onclick = () => this.showCharacterSheet('character');
    q('#sheet-close').onclick = () => this._closeCharacterSheet();
    for (const tab of this.root.querySelectorAll('.sheet-tab')) {
      tab.onclick = () => { this._sheetTab = tab.dataset.tab; this._renderCharacterSheet(); };
    }
    q('#m-custom').onclick = () => { this._customFrom = 'main'; this.cb.onCustomOpen && this.cb.onCustomOpen(); };
    q('#m-delete-character').onclick = () => {
      const character = this._sheetCharacter();
      if (!character) return;
      if (window.confirm(`Delete ${character.name}? This cannot be undone.`)) this.cb.onCharacterDelete?.(character.id);
    };
    q('#ow-resume').onclick = () => this.hideOverlay();
    q('#ow-world-map').onclick = () => { this.hideOverlay(); this.openLivingWorldMap(); };
    q('#ow-party-menu').onclick = () => { this.hideOverlay(); this._partyAction(); };
    q('#ow-characters').onclick = () => this._showScreen('main');
    q('#ow-settings').onclick = () => { this._settingsReturn = 'world-menu'; this._showScreen('settings'); };
    q('#ow-logout').onclick = () => this.cb.onSignOut && this.cb.onSignOut();
    q('#creator-cancel').onclick = () => {
      if (!(this._profile?.mmoCharacters || []).length) return;
      this._backOverlay('main');
    };
    q('#character-create-form').onsubmit = (event) => {
      event.preventDefault();
      if (this.cb.onCharacterCreate) this.cb.onCharacterCreate({
        name: q('#creator-name').value,
        classKey: this._creatorClass || 'vanguard',
        appearance: this._creatorAppearance || 'iron',
        raceKey: this._creatorRace || 'human',
        customization: { ...(this._creatorParts || {}) },
      });
    };
    // Back out of the browser to where you walked in from — the title
    // utilities row, or (if a portal ever reopens it in-world) straight back
    // to the walk. Landing on the hub from everywhere was its own loop.
    q('#cu-back').onclick = () => {
      if (this._overworldMode) { this.hideOverlay(); return; }
      this._showScreen(this._customFrom || 'main');
    };
    q('#cu-refresh').onclick = () => this.cb.onCustomRefresh && this.cb.onCustomRefresh();
    q('#cu-search').oninput = () => this._renderCustomRows();
    q('#cu-status').onchange = () => this._renderCustomRows();
    for (const tab of this.root.querySelectorAll('.custom-primary-tab')) tab.onclick = () => {
      this._customView = tab.dataset.view;
      for (const other of this.root.querySelectorAll('.custom-primary-tab')) other.classList.toggle('sel', other === tab);
      this._selectedCustomGame = null;
      this._selectedArcadeMap = null;
      this._renderCustomRows();
    };
    for (const filter of this.root.querySelectorAll('.custom-filter')) filter.onclick = () => {
      this._customFilter = filter.dataset.filter;
      for (const other of this.root.querySelectorAll('.custom-filter')) other.classList.toggle('sel', other === filter);
      this._renderCustomRows();
    };
    for (const shortcut of this.root.querySelectorAll('#cu-arcade-shortcuts button')) shortcut.onclick = () => {
      this._arcadeFilter = shortcut.dataset.arcade;
      for (const other of this.root.querySelectorAll('#cu-arcade-shortcuts button')) other.classList.toggle('sel', other === shortcut);
      this._renderCustomRows();
    };
    q('#cu-join').onclick = () => {
      if (this._customView === 'arcade') {
        if (this._selectedArcadeMap) this.cb.onCustomPlay?.(this._selectedArcadeMap);
      } else if (this._selectedCustomGame) this.cb.onCustomJoin?.(this._selectedCustomGame);
    };
    q('#cu-create').onclick = () => {
      this.customCreatePanel(true, this._customView === 'arcade' ? this._selectedArcadeMap : null);
    };
    q('#cu-cancel').onclick = () => this.customCreatePanel(false);
    q('#cu-confirm').onclick = () => {
      const map = this._customMaps?.find((entry) => entry.value === q('#cu-map').value) || this._customMaps?.[0];
      if (!map) return;
      const name = q('#cu-name').value.trim() || `${this._customHost || 'Host'}'s game`;
      this.customCreatePanel(false);
      this.cb.onCustomCreate?.({ name, mapId: map.level, mode: map.mode, mapName: map.name, difficulty: this._cuDiff || 'normal', maxPlayers: this._cuMax || 4 });
    };
    q('#m-logout').onclick = () => this.cb.onSignOut && this.cb.onSignOut();
    q('#solo-back').onclick = () => this._showScreen('main');
    q('#custom-online').onclick = () => { this._showScreen('lobby'); if (this.cb.onLobbyOpen) this.cb.onLobbyOpen(); };
    q('#solo-survival').onclick = () => this.showSetup({ mode: 'survival' });
    q('#solo-labyrinth').onclick = () => this.showSetup({ mode: 'labyrinth' });
    q('#s-back').onclick = () => {
      if (this._fromLobby) this._confirmRoomExit();
      else this._showScreen('main');
    };
    q('#room-confirm-cancel').onclick = () => q('#room-confirm').classList.add('hidden');
    q('#room-confirm-leave').onclick = () => {
      q('#room-confirm').classList.add('hidden');
      if (this._confirmContext === 'match') {
        if (this.cb.onMatchLeave) this.cb.onMatchLeave();
      } else if (this.cb.onRoomLeave) this.cb.onRoomLeave();
    };
    q('#l-back').onclick = () => this._showScreen('main');
    q('#galaxy-back').onclick = () => this._overworldMode ? this.hideOverlay() : this._showScreen('main');
    for (const back of this.root.querySelectorAll('.info-back')) back.onclick = () => this._backOverlay();

    // ----- lobby -----
    for (const t of this.root.querySelectorAll('.ltab')) {
      t.onclick = () => {
        for (const o of this.root.querySelectorAll('.ltab')) o.classList.toggle('sel', o === t);
        for (const pane of ['games', 'lore', 'tips']) {
          this.root.querySelector('#l-tab-' + pane).classList.toggle('hidden', pane !== t.dataset.tab);
        }
      };
    }
    const chatSend = () => {
      const inp = q('#l-chatinput');
      if (inp.value.trim() && this.cb.onChatSend) this.cb.onChatSend(inp.value);
      inp.value = '';
    };
    q('#l-chatsend').onclick = chatSend;
    q('#l-chatinput').addEventListener('keydown', (e) => { if (e.key === 'Enter') chatSend(); });
    const addFriend = () => {
      const inp = q('#l-friendcode');
      if (inp.value.trim() && this.cb.onAddFriend) this.cb.onAddFriend(inp.value);
      inp.value = '';
    };
    q('#l-friendadd').onclick = addFriend;
    q('#l-friendcode').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFriend(); });
    q('#l-create-pub').onclick = () => this.cb.onCreateGame && this.cb.onCreateGame('public');
    q('#l-create-priv').onclick = () => this.cb.onCreateGame && this.cb.onCreateGame('private');
    q('#l-create-join').onclick = () => this._showJoinCode();
    q('#l-manual').onclick = (e) => { e.preventDefault(); this.showSetup({ coop: true }); };
    q('#h-back').onclick = () => {
      if (this.pauseOpen) this._showScreen('pause');
      else this._backOverlay();
    };

    // ----- settings -----
    q('#m-settings').onclick = () => { this._settingsReturn = 'main'; this._showScreen('settings'); };
    q('#hero-back').onclick = () => this._showScreen('main');
    q('#p-settings').onclick = () => { this._settingsFromPause = true; this._showScreen('settings'); };
    q('#set-back').onclick = () => this._backOverlay();
    for (const t of this.root.querySelectorAll('.stab')) {
      t.onclick = () => {
        for (const o of this.root.querySelectorAll('.stab')) o.classList.toggle('sel', o === t);
        this.root.querySelector('#set-pane-audio').classList.toggle('hidden', t.dataset.tab !== 'audio');
        this.root.querySelector('#set-pane-video').classList.toggle('hidden', t.dataset.tab !== 'video');
        this.root.querySelector('#set-pane-controls').classList.toggle('hidden', t.dataset.tab !== 'controls');
        if (t.dataset.tab === 'controls') this._renderKeybinds();
      };
    }
    const vol = q('#set-vol'), mus = q('#set-music'), sfx = q('#set-sfx');
    vol.oninput = () => {
      q('#set-vol-val').textContent = vol.value + '%';
      if (this.cb.onSettings) this.cb.onSettings({ volume: vol.value / 100 });
    };
    mus.oninput = () => {
      q('#set-music-val').textContent = mus.value + '%';
      if (this.cb.onSettings) this.cb.onSettings({ music: mus.value / 100 });
    };
    sfx.onchange = () => {
      q('#set-sfx-val').textContent = sfx.checked ? 'ON' : 'OFF';
      if (this.cb.onSettings) this.cb.onSettings({ sfx: sfx.checked });
    };
    for (const b of this.root.querySelectorAll('#set-quality .diffbtn')) {
      b.onclick = () => {
        if (this.cb.onSettings) this.cb.onSettings({ quality: b.dataset.q });
        this._reflectQuality(b.dataset.q);
      };
    }

    // ----- pause menu -----
    q('#p-resume').onclick = () => this.cb.onResume();
    q('#p-help').onclick = () => this._showScreen('help');
    q('#p-restart').onclick = () => this.cb.onRestart();
    q('#p-quit').onclick = () => this._confirmMatchExit();

    // ----- setup: hero cards -----
    this.selectedHero = 'alexander';
    const herorow = q('#herorow');
    for (const [key, h] of Object.entries(HEROES)) {
      const card = document.createElement('button');
      card.className = 'herocard' + (key === this.selectedHero ? ' sel' : '');
      card.dataset.key = key;
      card.innerHTML = `
        ${PORTRAITS[key] ? `<img class="hface" data-src="${PORTRAITS[key]}" loading="lazy" decoding="async" onerror="this.remove()" alt="">` : ''}
        <span class="hicon">${h.icon}</span>
        <b>${h.name}</b>
        <small>${h.tagline}</small>
        <span class="habils">${h.aura ? `${h.aura.icon} ${h.aura.name} · ` : ''}${(h.passives || []).map((p) => `${p.icon} ${p.name}`).join(' · ')} · ${h.ability.icon} ${h.ability.name}</span>`;
      card.onclick = () => {
        this.selectedHero = key;
        for (const c of herorow.children) c.classList.toggle('sel', c === card);
        if (this.cb.onHeroPick) this.cb.onHeroPick(key);
      };
      card.onmouseenter = (e) => this._showTip(e, this._heroTip(h));
      card.onmousemove = (e) => this._moveTip(e);
      card.onmouseleave = () => this._hideTip();
      herorow.appendChild(card);
    }
    this._buildCharacterCreator();
    this._buildCharacterSelect();

    // ----- setup: levels & difficulty -----
    this.selectedLevel = 1;
    this._buildLevelRow(0);
    this.selectedDiff = 'normal';
    const seg = q('#diffseg');
    for (const [key, d] of Object.entries(DIFFICULTY)) {
      const b = document.createElement('button');
      b.className = 'diffbtn' + (key === this.selectedDiff ? ' sel' : '');
      b.innerHTML = `${d.label}<small>${key === 'casual' ? 'smaller hordes' : key === 'normal' ? 'the true experience' : 'good luck'}</small>`;
      b.onclick = () => {
        this.selectedDiff = key;
        for (const c of seg.children) c.classList.toggle('sel', c === b);
        if (this.cb.onDifficultyPick) this.cb.onDifficultyPick(key);
      };
      seg.appendChild(b);
    }
    q('#s-start').onclick = () => this.cb.onStart(this.selectedDiff, this.selectedHero);

    // ----- toolbar -----
    q('#b-pause').onclick = () => this.cb.onSpeed(0);
    for (const b of this.root.querySelectorAll('.speed')) b.onclick = () => this.cb.onSpeed(+b.dataset.s);
    q('#b-mute').onclick = () => this.cb.onMute();
    q('#b-quality').onclick = () => this.cb.onQuality && this.cb.onQuality();
    q('#b-menu').onclick = () => this.cb.onPause();
    q('#ow-menu').onclick = () => this.toggleOverlay();
    q('#ow-party').onclick = () => this._partyAction();
    q('#ow-map').onclick = () => this.openLivingWorldMap();
    q('#lw-party').onclick = () => this._partyAction();
    q('#lw-close').onclick = () => this.closeLivingWorldMap();
    this.pings = [];

    this.tooltip = q('#tooltip');
    this.banner = q('#banner');
    const gameChatSend = () => {
      const inp = q('#gamechat-input');
      if (inp.value.trim() && this.cb.onGameChatSend) this.cb.onGameChatSend(inp.value);
      inp.value = '';
      this.closeGameChat();
    };
    q('#gamechat-send').onclick = gameChatSend;
    q('#gamechat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); gameChatSend(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closeGameChat(); }
    });
  }

  _lobbyWasOpen() {
    const l = this.root.querySelector('#screen-lobby');
    return l && !l.classList.contains('hidden');
  }

  _wireRoomChat() {
    const input = this.root.querySelector('#roomchat-input');
    const button = this.root.querySelector('#roomchat-send');
    if (!input || !button || input.dataset.wired) return;
    const send = () => {
      if (input.value.trim() && this.cb.onRoomChatSend) this.cb.onRoomChatSend(input.value);
      input.value = '';
    };
    button.onclick = send;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    });
    input.dataset.wired = '1';
  }

  _wireRoomReady() {
    const button = this.root.querySelector('#room-ready');
    if (!button || button.dataset.wired) return;
    button.onclick = () => this.cb.onRoomReady && this.cb.onRoomReady(button.dataset.ready !== '1');
    button.dataset.wired = '1';
  }

  setRoomReady({ visible = false, ready = false } = {}) {
    const button = this.root.querySelector('#room-ready');
    if (!button) return;
    button.classList.toggle('hidden', !visible);
    button.classList.toggle('sel', ready);
    button.dataset.ready = ready ? '1' : '0';
    button.textContent = ready ? '✓ READY — WAITING FOR HOST' : 'READY FOR BATTLE';
  }

  setRoomReconnect({ visible = false, label = 'RECONNECT' } = {}) {
    const button = this.root.querySelector('#room-reconnect');
    if (!button) return;
    button.classList.toggle('hidden', !visible);
    button.textContent = label;
  }

  setRoomExit({ isHost = false } = {}) {
    this._roomExitHost = !!isHost;
    const button = this.root.querySelector('#s-back');
    if (!button || !this._fromLobby) return;
    button.textContent = isHost ? '✕ CLOSE LOBBY' : '← LEAVE LOBBY';
    button.classList.toggle('danger', isHost);
  }

  _confirmRoomExit() {
    const host = !!this._roomExitHost;
    this._confirmContext = 'room';
    const dialog = this.root.querySelector('#room-confirm');
    dialog.querySelector('#room-confirm-title').textContent = host ? 'Close lobby for everyone?' : 'Leave this lobby?';
    dialog.querySelector('#room-confirm-copy').textContent = host
      ? 'This removes every player and permanently closes the room.'
      : 'Your seat will be released so another player can join.';
    dialog.querySelector('#room-confirm-leave').textContent = host ? 'CLOSE LOBBY' : 'LEAVE LOBBY';
    dialog.classList.remove('hidden');
  }

  setMatchExit(role = null) {
    this._matchExitRole = role;
    const button = this.root.querySelector('#p-quit');
    if (!button) return;
    button.textContent = role === 'host' ? '⛔  END MATCH FOR EVERYONE' : role === 'guest' ? '🚪  LEAVE MATCH' : '🚪  QUIT TO MENU';
  }

  _confirmMatchExit() {
    if (!this._matchExitRole) {
      if (this.cb.onQuit) this.cb.onQuit();
      return;
    }
    const host = this._matchExitRole === 'host';
    this._confirmContext = 'match';
    const dialog = this.root.querySelector('#room-confirm');
    dialog.querySelector('#room-confirm-title').textContent = host ? 'End match for everyone?' : 'Leave this match?';
    dialog.querySelector('#room-confirm-copy').textContent = host
      ? 'The shared battle ends immediately for every player.'
      : 'Your hero will remain under simulation control. You can rejoin while the room is active.';
    dialog.querySelector('#room-confirm-leave').textContent = host ? 'END MATCH' : 'LEAVE MATCH';
    dialog.classList.remove('hidden');
  }

  showRoomCountdown(value) {
    const button = this.root.querySelector('#s-start');
    if (!button) return;
    button.textContent = Number(value) > 0 ? `⚔️  BATTLE STARTS IN ${value}` : '⚔️  LAUNCHING…';
    button.disabled = true;
    button.classList.add('disabled');
  }

  activateStart() {
    // Countdown presentation deliberately disables the button. HTMLElement
    // click() is a no-op on a disabled button, so launch through the same
    // callback directly and guard duplicate countdown completions.
    if (this._startActivated) return;
    this._startActivated = true;
    this.cb.onStart(this.selectedDiff, this.selectedHero);
  }

  showLobby() {
    this._showScreen('lobby');
  }

  onlineStatus(text) {
    const el = this.root.querySelector('#online-status');
    if (el) el.innerHTML = text;
  }

  setStartButton({ text, disabled = false, title = '' } = {}) {
    const btn = this.root.querySelector('#s-start');
    if (!btn) return;
    if (text) btn.textContent = text;
    btn.disabled = !!disabled;
    btn.classList.toggle('disabled', !!disabled);
    btn.title = title || '';
  }

  // The mode chips shown in multiplayer setups. Solo entry cards already ARE
  // the mode choice, so the chips only appear for co-op and online rooms.
  _renderModeSeg(mode, show) {
    const seg = this.root.querySelector('#modeseg');
    seg.classList.toggle('hidden', !show);
    if (!show) return;
    if (!seg.dataset.init) {
      seg.dataset.init = '1';
      seg.innerHTML = [
        ['campaign', '⚔️ Campaign'], ['survival', '💀 Survival'], ['labyrinth', '🌀 Labyrinth'],
      ].map(([key, label]) => `<button class="tbtn modechip" data-mode="${key}">${label}</button>`).join('');
      for (const chip of seg.querySelectorAll('.modechip')) {
        chip.onclick = () => this.cb.onModePick && this.cb.onModePick(chip.dataset.mode);
      }
    }
    for (const chip of seg.querySelectorAll('.modechip')) {
      chip.classList.toggle('sel', chip.dataset.mode === mode);
    }
  }

  _startCopyFor(mode) {
    return mode === 'survival'
      ? '▶  START — SURVIVE AS LONG AS YOU CAN'
      : mode === 'labyrinth'
      ? '▶  DESCEND — CLEAR THE TRIAL'
      : '▶  START — TAKE THE PLANET';
  }

  // Switch the open setup screen to another war mode: reselect the chip,
  // rebuild the battlefield roster for that mode, refresh the start copy.
  // Called only by whoever owns the setup (the host, or a solo/manual player).
  applySetupMode(mode) {
    if ((this.selectedMode || 'campaign') === mode) return;
    this.selectedMode = mode;
    this._renderModeSeg(mode, !this.root.querySelector('#modeseg').classList.contains('hidden'));
    this._buildLevelRow(this._campaignCleared || 0, mode !== 'campaign', mode);
    this.setStartButton({ text: this._startCopyFor(mode), disabled: false, title: '' });
  }

  setRoomSettings({ level = 1, difficulty = 'normal', isHost = false, mode = null } = {}) {
    // The host may retarget the room to another mode; every peer's setup
    // screen follows, rebuilding the battlefield roster before reselecting.
    if (mode && (this.selectedMode || 'campaign') !== mode) this.applySetupMode(mode);
    this.selectedLevel = Number(level) || 1;
    this.selectedDiff = difficulty;
    const setup = this.root.querySelector('#screen-setup');
    setup?.classList.toggle('room-host', !!isHost);
    setup?.classList.toggle('room-guest', !isHost);
    for (const chip of this.root.querySelectorAll('#modeseg .modechip')) {
      chip.disabled = !isHost;
      if (!isHost) chip.title = 'The host controls the war mode.';
    }
    for (const card of this.root.querySelectorAll('#levelrow .levelcard')) {
      card.classList.toggle('sel', Number(card.dataset.level) === this.selectedLevel);
      card.disabled = isHost ? card.classList.contains('locked') : true;
      if (!isHost) card.title = 'The host controls the battlefield.';
    }
    for (const button of this.root.querySelectorAll('#diffseg .diffbtn')) {
      const key = [...this.root.querySelectorAll('#diffseg .diffbtn')].indexOf(button);
      const diffKey = Object.keys(DIFFICULTY)[key];
      button.classList.toggle('sel', diffKey === difficulty);
      button.disabled = !isHost;
      if (!isHost) button.title = 'The host controls difficulty.';
    }
  }

  _showScreen(name) {
    const ov = this.root.querySelector('#overlay');
    ov.classList.remove('hidden');
    this._lastScreen = name;
    if (name === 'account') this.shell.enterBase(SHELL_BASES.AUTH);
    else if (name === 'main' && !this._overworldMode) this.shell.enterBase(SHELL_BASES.CHARACTER_SELECT);
    else this.shell.openOverlay(name);
    this._paintScreen(name);
  }

  _paintScreen(name) {
    for (const id of ['account', 'main', 'world-menu', 'character-create', 'character-sheet', 'solo', 'custom', 'setup', 'help', 'pause', 'lobby', 'settings', 'heroes', 'cinematics', 'credits', 'galaxy']) {
      this.root.querySelector('#screen-' + id).classList.toggle('hidden', id !== name);
    }
  }

  _backOverlay(fallback = 'main') {
    const target = this.shell.returnOverlay;
    this.shell.closeOverlay();
    if (target) {
      this._lastScreen = target;
      this._paintScreen(target);
      return;
    }
    if (this.shell.base === SHELL_BASES.OVERWORLD) {
      this.hideOverlay();
      return;
    }
    this._showScreen(this.shell.base === SHELL_BASES.AUTH ? 'account' : fallback);
  }

  showCustomBrowser({ games = [], offline = false, hostName = '' } = {}) {
    this._customHost = hostName;
    this._customGames = games;
    this._customOffline = offline;
    this._customView = this._customView || 'live';
    this._customFilter = this._customFilter || 'all';
    this._arcadeFilter = this._arcadeFilter || 'all';
    const character = this._sheetCharacter();
    this.root.querySelector('#cu-character').textContent = character
      ? `${character.name} · ${MMO_CLASSES[character.classKey]?.name || 'Commander'}`
      : hostName ? `@${hostName}` : 'COMMANDER';
    this.root.querySelector('#cu-party').textContent = 'PARTY 1/4';
    this._renderCustomRows();
  }

  _arcadeMaps() {
    return [
      ...LEVELS.map((level) => ({
        id: `campaign-${level.id}`, level: level.id, mode: 'campaign', name: level.name,
        icon: '⚔️', author: 'Zillions', players: '1–4', difficulty: 'Normal',
        description: level.blurb || level.desc || 'Take the planet in a continuous siege.',
      })),
      ...LABYRINTH_LEVELS.map((level) => ({
        id: `labyrinth-${level.id}`, level: level.id, mode: 'labyrinth', name: level.name,
        icon: '🌀', author: 'Zillions', players: '1–4', difficulty: 'Normal',
        description: level.blurb || level.desc || 'Descend into a compact hero trial.',
      })),
      {
        id: 'survival-1', level: 1, mode: 'survival', name: 'Endless Siege', icon: '💀',
        author: 'Zillions', players: '1–4', difficulty: 'Scaling',
        description: 'Hold the frontier while Threat rises without limit.',
      },
    ];
  }

  _renderCustomRows() {
    const box = this.root.querySelector('#cu-list');
    const note = this.root.querySelector('#cu-note');
    const detail = this.root.querySelector('#cu-detail');
    const join = this.root.querySelector('#cu-join');
    const create = this.root.querySelector('#cu-create');
    const live = this._customView !== 'arcade';
    this.root.querySelector('#cu-status-label').classList.toggle('hidden', !live);
    this.root.querySelector('#cu-arcade-shortcuts').classList.toggle('hidden', live);
    this.root.querySelector('#cu-refresh').classList.toggle('hidden', !live);
    for (const tab of this.root.querySelectorAll('.custom-primary-tab')) tab.classList.toggle('sel', tab.dataset.view === this._customView);
    box.innerHTML = '';
    const query = this.root.querySelector('#cu-search').value.trim().toLowerCase();
    if (!live) {
      const maps = this._arcadeMaps().filter((map) => {
        if (this._customFilter !== 'all' && map.mode !== this._customFilter) return false;
        if (query && !`${map.name} ${map.mode} ${map.author}`.toLowerCase().includes(query)) return false;
        if (this._arcadeFilter === 'favorites') return (this._arcadeFavorites || []).includes(map.id);
        if (this._arcadeFilter === 'recent') return (this._arcadeRecent || []).includes(map.id);
        return true;
      });
      note.textContent = maps.length ? `${maps.length} prebuilt maps · select one to play or host` : 'No maps match these filters.';
      note.classList.remove('offline');
      for (const map of maps) {
        const row = document.createElement('button');
        row.className = `custom-map-row${this._selectedArcadeMap?.id === map.id ? ' selected' : ''}`;
        row.innerHTML = `<span class="custom-map-icon">${map.icon}</span><span><b>${escapeHtml(map.name)}</b><small>${map.mode.toUpperCase()} · BY ${map.author.toUpperCase()}</small></span><span>${map.players}</span><span>PREBUILT</span>`;
        row.onclick = () => { this._selectedArcadeMap = map; this._selectedCustomGame = null; this._renderCustomRows(); };
        box.appendChild(row);
      }
      const map = this._selectedArcadeMap;
      detail.innerHTML = map
        ? `<span class="modeeyebrow">ARCADE MAP</span><div class="custom-map-preview">${map.icon}</div><h2>${escapeHtml(map.name)}</h2><p>${escapeHtml(map.description)}</p><dl><div><dt>MODE</dt><dd>${map.mode.toUpperCase()}</dd></div><div><dt>PLAYERS</dt><dd>${map.players}</dd></div><div><dt>DIFFICULTY</dt><dd>${map.difficulty}</dd></div><div><dt>AUTHOR</dt><dd>${map.author}</dd></div></dl>`
        : '<span class="modeeyebrow">ARCADE</span><h2>CHOOSE A MAP</h2><p>Browse Zillions maps, then play immediately or host a lobby.</p>';
      join.textContent = 'PLAY NOW';
      join.disabled = !map;
      create.textContent = 'HOST GAME';
      create.disabled = !map;
      return;
    }

    const games = (this._customGames || []).filter((game) => {
      const status = this.root.querySelector('#cu-status').value;
      if (this._customFilter !== 'all' && game.mode !== this._customFilter) return false;
      if (status === 'open' && game.status !== 'open') return false;
      if (status === 'playing' && game.status === 'open') return false;
      return !query || `${game.name} ${game.host_name} ${game.mapName || ''} ${game.mode || ''}`.toLowerCase().includes(query);
    });
    note.textContent = this._customOffline
      ? '📡 Offline — Live Games needs the lobby server.'
      : games.length ? `${games.length} live games found` : 'No joinable games. Host one or browse Arcade.';
    note.classList.toggle('offline', this._customOffline);
    for (const game of games) {
      const incompatible = game.protocol_compatible === false;
      const row = document.createElement('button');
      row.className = `custom-live-row${this._selectedCustomGame?.id === game.id ? ' selected' : ''}`;
      row.disabled = incompatible;
      row.innerHTML = `<span><b>${escapeHtml(game.name || `${game.host_name}'s game`)}</b><small>HOST @${escapeHtml(game.host_name || 'unknown')}</small></span><span>${escapeHtml(game.mapName || levelById(game.level || 1)?.name || 'Unknown map')}<small>${String(game.mode || 'campaign').toUpperCase()}</small></span><span>${game.players || 1}/${game.max_players || 4}</span><span class="custom-status ${game.status === 'open' ? 'open' : 'playing'}">${incompatible ? 'UPDATE' : game.status === 'open' ? 'JOINABLE' : 'IN PROGRESS'}</span>`;
      row.onclick = () => { this._selectedCustomGame = game; this._selectedArcadeMap = null; this._renderCustomRows(); };
      box.appendChild(row);
    }
    const game = this._selectedCustomGame;
    detail.innerHTML = game
      ? `<span class="modeeyebrow">LIVE GAME</span><div class="custom-map-preview">${game.mode === 'labyrinth' ? '🌀' : game.mode === 'survival' ? '💀' : '⚔️'}</div><h2>${escapeHtml(game.name)}</h2><p>${escapeHtml(game.mapName || levelById(game.level || 1)?.name || 'Unknown map')}</p><dl><div><dt>HOST</dt><dd>@${escapeHtml(game.host_name)}</dd></div><div><dt>PLAYERS</dt><dd>${game.players || 1}/${game.max_players || 4}</dd></div><div><dt>DIFFICULTY</dt><dd>${String(game.difficulty || 'normal').toUpperCase()}</dd></div><div><dt>STATUS</dt><dd>${game.status === 'open' ? 'JOINABLE' : 'IN PROGRESS'}</dd></div></dl>`
      : '<span class="modeeyebrow">LIVE GAMES</span><h2>CHOOSE A GAME</h2><p>Select a joinable lobby to inspect its host, map, rules, and party.</p>';
    join.textContent = game?.status === 'open' ? 'JOIN GAME' : 'WATCH GAME';
    join.disabled = !game || game.protocol_compatible === false;
    create.textContent = 'CREATE GAME';
    create.disabled = false;
  }

  customCreatePanel(open, selectedMap = null) {
    this.root.querySelector('#cu-create-panel').classList.toggle('hidden', !open);
    if (!open) return;
    this._customMaps = [...LABYRINTH_LEVELS.map((level) => ({ value: `lab-${level.id}`, level: level.id, mode: 'labyrinth', name: `🌀 ${level.name}` })), ...LEVELS.map((level) => ({ value: `lv-${level.id}`, level: level.id, mode: 'campaign', name: `⚔️ ${level.name}` }))];
    this._customMaps.push({ value: 'survival-1', level: 1, mode: 'survival', name: '💀 Endless Siege' });
    this.root.querySelector('#cu-map').innerHTML = this._customMaps.map((map) => `<option value="${map.value}">${map.name}</option>`).join('');
    if (selectedMap) this.root.querySelector('#cu-map').value = `${selectedMap.mode === 'labyrinth' ? 'lab' : selectedMap.mode === 'campaign' ? 'lv' : 'survival'}-${selectedMap.level}`;
    const diff = this.root.querySelector('#cu-diff'); diff.innerHTML = '';
    for (const [key, value] of Object.entries(DIFFICULTY)) { const button = document.createElement('button'); button.className = `diffbtn${key === 'normal' ? ' sel' : ''}`; button.textContent = value.label; button.onclick = () => { this._cuDiff = key; for (const other of diff.children) other.classList.toggle('sel', other === button); }; diff.appendChild(button); }
    this._cuDiff = 'normal';
    const max = this.root.querySelector('#cu-max'); max.innerHTML = '';
    for (const count of [1, 2, 3, 4]) { const button = document.createElement('button'); button.className = `diffbtn${count === 4 ? ' sel' : ''}`; button.textContent = String(count); button.onclick = () => { this._cuMax = count; for (const other of max.children) other.classList.toggle('sel', other === button); }; max.appendChild(button); }
    this._cuMax = 4; this.root.querySelector('#cu-name').value = ''; this.root.querySelector('#cu-name').focus();
  }

  _buildCharacterCreator() {
    const classes = this.root.querySelector('#creator-classes');
    const appearances = this.root.querySelector('#creator-appearance');
    const races = this.root.querySelector('#creator-races');
    if (!classes || !appearances || !races) return;
    this._creatorClass = 'vanguard';
    this._creatorAppearance = 'iron';
    this._creatorRace = 'human';
    this._creatorParts = {};
    for (const [key, race] of Object.entries(MMO_RACES)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `creator-race${key === this._creatorRace ? ' sel' : ''}`;
      button.innerHTML = `<i>${race.icon}</i><span><b>${race.name}</b><small>${race.passive} · ${race.desc}</small></span>`;
      button.onclick = () => {
        this._creatorRace = key;
        this._creatorParts = {};
        for (const entry of races.children) entry.classList.toggle('sel', entry === button);
        this._buildCreatorParts();
        this._renderCreatorSummary();
      };
      races.appendChild(button);
    }
    for (const [key, klass] of Object.entries(MMO_CLASSES)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `creator-class${key === this._creatorClass ? ' sel' : ''}`;
      button.dataset.key = key;
      button.innerHTML = `<i>${klass.icon}</i><span><b>${klass.name}</b><small>${klass.role}</small></span>${klass.ready ? '<em>COMPLETE</em>' : '<em>PROTOTYPE</em>'}`;
      button.onclick = () => {
        this._creatorClass = key;
        for (const entry of classes.children) entry.classList.toggle('sel', entry === button);
        this._renderCreatorSummary();
      };
      classes.appendChild(button);
    }
    for (const [key, appearance] of Object.entries(APPEARANCES)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `creator-swatch${key === this._creatorAppearance ? ' sel' : ''}`;
      button.dataset.key = key;
      button.style.setProperty('--swatch', appearance.color);
      button.innerHTML = `<i></i><span>${appearance.name}</span>`;
      button.onclick = () => {
        this._creatorAppearance = key;
        for (const entry of appearances.children) entry.classList.toggle('sel', entry === button);
        this._renderCreatorSummary();
      };
      appearances.appendChild(button);
    }
    this._buildCreatorParts();
    this._renderCreatorSummary();
  }

  _buildCreatorParts() {
    const root = this.root.querySelector('#creator-parts');
    if (!root) return;
    root.innerHTML = '';
    const defs = CREATOR_PARTS[this._creatorRace || 'human'];
    for (const [part, values] of Object.entries(defs)) {
      const field = document.createElement('fieldset');
      field.innerHTML = `<legend>${part.toUpperCase()}</legend><div class="creator-part-options"></div>`;
      const row = field.querySelector('div');
      this._creatorParts[part] = values.includes(this._creatorParts[part]) ? this._creatorParts[part] : values[0];
      for (const value of values) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `creator-part${value === this._creatorParts[part] ? ' sel' : ''}`;
        button.textContent = value.replace(/-/g, ' ');
        button.onclick = () => {
          this._creatorParts[part] = value;
          for (const entry of row.children) entry.classList.toggle('sel', entry === button);
          this._renderCreatorSummary();
        };
        row.appendChild(button);
      }
      root.appendChild(field);
    }
  }

  _renderCreatorSummary() {
    const klass = MMO_CLASSES[this._creatorClass || 'vanguard'];
    const appearance = APPEARANCES[this._creatorAppearance || 'iron'];
    const race = MMO_RACES[this._creatorRace || 'human'];
    const summary = this.root.querySelector('#creator-summary');
    const raceMods = Object.entries(race.mods || {}).map(([key, value]) => `${value > 0 ? '+' : ''}${value} ${key}`).join(' · ');
    if (summary) summary.innerHTML = `<b>${race.icon} ${race.name} ${klass.name}</b><span>${klass.role}</span><small>${race.desc} ${race.passive}: ${raceMods}. ${klass.resource} is your combat resource. Appearance choices do not change power.</small>`;
    const preview = this.root.querySelector('#creator-preview');
    if (preview) {
      preview.dataset.race = this._creatorRace || 'human';
      preview.dataset.body = this._creatorParts?.body || '';
      preview.dataset.head = this._creatorParts?.head || '';
      preview.dataset.legs = this._creatorParts?.legs || '';
      preview.style.setProperty('--creator-color', appearance.color);
    }
    this.cb.onCharacterPreview?.({
      raceKey: this._creatorRace || 'human',
      appearance: this._creatorAppearance || 'iron',
      customization: { ...(this._creatorParts || {}) },
      equipment: {}, canvasId: 'creator-preview-canvas',
      proxyHero: klass.proxy, classKey: this._creatorClass || 'vanguard',
    });
    const raceLabel = this.root.querySelector('#creator-preview-race');
    if (raceLabel) raceLabel.textContent = race.name.toUpperCase();
  }

  _showCharacterCreator() {
    if ((this._profile?.mmoCharacters || []).length >= MAX_MMO_CHARACTERS) return;
    const name = this.root.querySelector('#creator-name');
    const cancel = this.root.querySelector('#creator-cancel');
    if (cancel) cancel.classList.toggle('hidden', !(this._profile?.mmoCharacters || []).length);
    if (name) name.value = '';
    this._showScreen('character-create');
    setTimeout(() => name?.focus(), 0);
  }

  showCharacterCreator() {
    this._showCharacterCreator();
  }

  _buildCharacterSelect() {
    const list = this.root.querySelector('#character-list');
    if (!list) return;
    list.innerHTML = '';
    const characters = this._profile?.mmoCharacters || [];
    for (const character of characters) {
      const klass = MMO_CLASSES[character.classKey] || MMO_CLASSES.vanguard;
      const appearance = APPEARANCES[character.appearance] || APPEARANCES.iron;
      const button = document.createElement('button');
      button.className = 'character-row';
      button.dataset.id = character.id;
      button.innerHTML = `<span style="--character-color:${appearance.color}">${klass.icon}</span><span><b>${escapeHtml(character.name)}</b><small>${klass.name} · Level ${character.level || 1}</small></span>`;
      button.onclick = () => {
        if (this.cb.onCharacterSelect) this.cb.onCharacterSelect(character.id);
        this.selectedHero = character.proxyHero || klass.proxy;
        this._renderSelectedCharacter();
      };
      list.appendChild(button);
    }
    list.classList.toggle('empty', !characters.length);
    if (!characters.length) list.innerHTML = '<div class="character-empty"><b>NO CHARACTERS</b><span>Create your first survivor to enter the galaxy.</span></div>';
    const enter = this.root.querySelector('#m-enter-world');
    if (enter) enter.disabled = !characters.length;
    const create = this.root.querySelector('#m-create-character');
    if (create) create.disabled = characters.length >= MAX_MMO_CHARACTERS;
    this._renderSelectedCharacter();
    this._renderFirstHourGuide();
  }

  _renderFirstHourGuide() {
    const root = this.root.querySelector('#first-hour-guide');
    if (!root) return;
    const character = this._sheetCharacter();
    const guide = firstHourGuidance(character, { online: !!this.cb.useAuthoritativeEconomy?.() });
    if (guide.step === 'complete') { root.classList.add('hidden'); root.innerHTML = ''; return; }
    root.classList.remove('hidden');
    root.innerHTML = `<span>FIRST DEPLOYMENT · ${guide.step.toUpperCase()}</span><b>${guide.title}</b><p>${guide.body}</p><div><button class="menubtn primary" data-guide-action>${guide.action}</button>${character ? '<button class="utilitybtn" data-guide-skip>SKIP GUIDE</button>' : ''}</div>`;
    root.querySelector('[data-guide-action]').onclick = () => {
      if (guide.step === 'create') this._showCharacterCreator();
      else if (guide.step === 'market') this.showCharacterSheet('shop');
      else if (guide.step === 'equip') this.showCharacterSheet('gear');
      else if (guide.step === 'forge') this.showCharacterSheet('crafting');
      else this.cb.onCampaignMap?.();
    };
    root.querySelector('[data-guide-skip]')?.addEventListener('click', () => {
      character.firstHourGuideDismissed = true;
      this.cb.onProfileDirty?.();
      this._renderFirstHourGuide();
    });
  }

  _renderSelectedCharacter() {
    const characters = this._profile?.mmoCharacters || [];
    const character = characters.find((entry) => entry.id === this._profile?.mmoCharacterId) || characters[0];
    if (!character) {
      this.root.querySelector('#character-name').textContent = 'CREATE YOUR FIRST CHARACTER';
      this.root.querySelector('#character-tagline').textContent = 'Choose a class and begin on Earth.';
      this.root.querySelector('#character-gear').innerHTML = '<span class="empty-gear">No persistent equipment yet</span>';
      this.root.querySelector('#character-sigil').textContent = '✦';
      this.root.querySelector('#character-loadout').innerHTML = '';
      this.root.querySelector('#character-weapon').textContent = '';
      return;
    }
    const klass = MMO_CLASSES[character.classKey] || MMO_CLASSES.vanguard;
    const appearance = APPEARANCES[character.appearance] || APPEARANCES.iron;
    const equipped = legalEquipment(character);
    const gear = EQUIP_SLOTS.map((slot) => equipped[slot] ? itemInfo(equipped[slot]) : null).filter(Boolean);
    for (const row of this.root.querySelectorAll('.character-row')) {
      row.classList.toggle('sel', row.dataset.id === character.id);
    }
    const sigil = this.root.querySelector('#character-sigil');
    sigil.textContent = klass.icon;
    sigil.style.backgroundImage = '';
    sigil.classList.remove('has-portrait');
    sigil.style.setProperty('--hero-color', appearance.color);
    const avatar = this.root.querySelector('#character-avatar');
    avatar.style.setProperty('--hero-color', appearance.color);
    avatar.dataset.class = character.classKey || 'vanguard';
    const weapon = equipped[character.activeSet === 1 ? 'weapon2' : 'weapon'];
    const weaponItem = weapon ? itemInfo(weapon) : null;
    this.root.querySelector('#character-weapon').textContent = weaponItem?.icon || '⚔';
    this.root.querySelector('#character-loadout').innerHTML = [
      ['HEAD', klass.icon],
      ['ARMOUR', equipped.armor ? itemInfo(equipped.armor)?.icon : '◇'],
      ['WEAPON', weaponItem?.icon || '◇'],
      ['IMPLANT', equipped.implant1 ? itemInfo(equipped.implant1)?.icon : '◇'],
    ].map(([label, icon]) => `<span><i>${icon}</i><small>${label}</small></span>`).join('');
    this.root.querySelector('#character-name').textContent = `${character.name} · LEVEL ${character.level || 1}`;
    this.root.querySelector('#character-tagline').textContent = `${klass.name} — ${klass.role} · ${character.xp || 0}/${xpToMmoLevel(character.level || 1)} XP · ${character.talentPoints || 0} talent points`;
    this.root.querySelector('#character-gear').innerHTML = gear.length
      ? gear.map((item) => `<span>${item.icon} ${item.name}</span>`).join('')
      : '<span class="empty-gear">Frontier issue gear · no recovered sets</span>';
  }

  // ----- controls -----
  //
  // Reads the same table the input handler dispatches through, so what this
  // screen shows is what the game actually does. Nothing here knows a letter.

  setKeybinds(binds) {
    this._binds = binds;
    this._refreshBindLabels();
    if (!this.root.querySelector('#set-pane-controls').classList.contains('hidden')) this._renderKeybinds();
  }

  _keyLabel(id) {
    const binds = this._binds || loadBinds();
    return keyLabel(binds[id]);
  }

  // Any HUD element carrying data-bind shows the key currently bound to it, so
  // a rebind is visible on the stance bar without a reload.
  _refreshBindLabels() {
    const binds = this._binds || loadBinds();
    for (const el of this.root.querySelectorAll('[data-bind]')) {
      const slot = el.querySelector('b');
      if (slot) slot.textContent = keyLabel(binds[el.dataset.bind]);
    }
    for (const el of this.root.querySelectorAll('[data-bind-label]')) {
      el.textContent = keyLabel(binds[el.dataset.bindLabel]);
    }
  }

  _renderKeybinds() {
    const box = this.root.querySelector('#set-binds');
    if (!box) return;
    const binds = this._binds || loadBinds();
    this._binds = binds;
    const clashes = new Map();
    for (const clash of allConflicts(binds)) clashes.set(clash.id, clash.with);

    const groups = Object.values(BIND_CONTEXTS).map((context) => {
      const rows = ACTIONS.filter((a) => a.context === context.key).map((action) => {
        const key = binds[action.id];
        const clash = clashes.get(action.id);
        const listening = this._bindingId === action.id;
        return `<div class="bindrow${clash ? ' clash' : ''}${action.reserved ? ' reserved' : ''}${key ? '' : ' unbound'}">
          <span class="bindname">${escapeHtml(action.name)}${action.reserved ? '<em>not yet used</em>' : ''}
            ${action.desc ? `<small>${escapeHtml(action.desc)}</small>` : ''}</span>
          <button class="bindkey${listening ? ' listening' : ''}" data-action="${action.id}"
            ${action.fixed ? 'disabled title="This key is fixed."' : ''}>
            ${listening ? 'press a key…' : (key ? escapeHtml(keyLabel(key)) : 'unbound')}</button>
          ${action.alt ? `<span class="bindalt">or ${escapeHtml(keyLabel(action.alt))}</span>` : '<span class="bindalt"></span>'}
        </div>`;
      }).join('');
      return `<section class="bindgroup"><h3>${context.name}</h3>
        <p class="bindgroupdesc">${escapeHtml(context.desc)}</p>${rows}</section>`;
    }).join('');

    const unbound = ACTIONS.filter((a) => !binds[a.id]);
    const conflictNote = clashes.size
      ? '<p class="bindconflict">Two actions that are live at the same time share a key. Rebind one — the second will never fire.</p>'
      : unbound.length
        ? `<p class="bindconflict">${unbound.length} action${unbound.length === 1 ? ' has' : 's have'} no key. Click to bind.</p>`
        : '';
    box.innerHTML = conflictNote + groups;

    for (const button of box.querySelectorAll('.bindkey')) {
      button.onclick = () => this._listenForBind(button.dataset.action);
    }
    const reset = this.root.querySelector('#set-binds-reset');
    if (reset) reset.onclick = () => { this.cb.onKeybindReset && this.cb.onKeybindReset(); };
  }

  // Capture the next key press for one action. Escape cancels rather than
  // binding, or a player could strand themselves out of the menu.
  _listenForBind(actionId) {
    const action = ACTIONS_BY_ID.get(actionId);
    if (!action || action.fixed) return;
    if (this._bindListener) window.removeEventListener('keydown', this._bindListener, true);
    this._bindingId = actionId;
    this._renderKeybinds();

    this._bindListener = (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.removeEventListener('keydown', this._bindListener, true);
      this._bindListener = null;
      const key = String(event.key).toLowerCase();
      this._bindingId = null;
      if (key === 'escape') { this._renderKeybinds(); return; }
      const next = { ...(this._binds || loadBinds()), [actionId]: key };
      // Taking a key from another action in the same group would leave that one
      // dead, so the one that lost it is handed the key being replaced.
      const displaced = conflictsFor(next, actionId, key);
      const freed = (this._binds || loadBinds())[actionId];
      for (const other of displaced) next[other.id] = freed;
      this.cb.onKeybindChange && this.cb.onKeybindChange(next);
      if (displaced.length) {
        this.showBanner(`⌨️ ${displaced[0].name} took ${keyLabel(freed)}.`, '', 2600);
      }
    };
    window.addEventListener('keydown', this._bindListener, true);
  }

  // ----- the character sheet: equipment and the Lattice -----
  //
  // Both halves read and write the SAME character object the profile owns, and
  // every mutation goes through the model's own legality rules in
  // `mmo-characters.js` — the screen never decides what a legal build is.

  _sheetCharacter() {
    const characters = this._profile?.mmoCharacters || [];
    return characters.find((entry) => entry.id === this._profile?.mmoCharacterId) || characters[0] || null;
  }

  _sheetChanged() {
    this.cb.onProfileDirty && this.cb.onProfileDirty();
    this._renderCharacterSheet();
    this._renderSelectedCharacter();
  }

  showCharacterSheet(tab = null) {
    if (!this._sheetCharacter()) return;
    this._sheetReturn = this._overworldMode ? 'overworld' : (this._lastScreen === 'world-menu' ? 'world-menu' : 'main');
    if (tab) this._sheetTab = tab;
    this._sheetTab = this._sheetTab || 'character';
    this._sheetSelection = null;
    this._showScreen('character-sheet');
    this._renderCharacterSheet();
  }

  _closeCharacterSheet() {
    if (this._sheetReturn === 'overworld') this.hideOverlay();
    else this._showScreen(this._sheetReturn || 'main');
  }

  _renderCharacterSheet() {
    const character = this._sheetCharacter();
    if (!character) return;
    const klass = MMO_CLASSES[character.classKey] || MMO_CLASSES.vanguard;
    const budget = latticePoints(character.level, character.questPoints);
    const spent = (character.lattice || []).length;

    this.root.querySelector('#sheet-sigil').textContent = klass.icon;
    this.root.querySelector('#sheet-name').textContent = `${character.name} · LEVEL ${character.level || 1}`;
    this.root.querySelector('#sheet-sub').textContent =
      `${klass.name} — ${klass.role} · ${budget - spent} of ${budget} Lattice points unspent`;

    for (const button of this.root.querySelectorAll('.sheet-tab')) {
      button.classList.toggle('sel', button.dataset.tab === this._sheetTab);
    }
    for (const tab of ['character', 'gear', 'shop', 'crafting', 'abilities', 'lattice']) {
      this.root.querySelector(`#sheet-panel-${tab}`).classList.toggle('hidden', this._sheetTab !== tab);
    }

    if (this._sheetTab === 'character') this._renderCharacterOverview(character);
    else if (this._sheetTab === 'gear') this._renderGearPanel(character);
    else if (this._sheetTab === 'shop') this._renderMarketPanel(character);
    else if (this._sheetTab === 'crafting') this._renderCraftingPanel(character);
    else if (this._sheetTab === 'abilities') this._renderAbilitiesOverview(character);
    else this._renderLatticePanel(character);
  }

  _renderCharacterOverview(character) {
    const klass = MMO_CLASSES[character.classKey] || MMO_CLASSES.vanguard;
    const appearance = APPEARANCES[character.appearance] || APPEARANCES.iron;
    const attrs = characterAttributes(character);
    const stats = character.stats || {};
    this.root.querySelector('#sheet-panel-character').innerHTML = `
      <section class="character-paperdoll" style="--character-color:${appearance.color}"><canvas id="paperdoll-preview-canvas"></canvas><div class="paperdoll-aura"></div><b>${escapeHtml(character.name)}</b><span>${klass.name} · Level ${character.level || 1}</span></section>
      <section class="character-summary"><span class="modeeyebrow">CLASS ROLE</span><h2>${klass.role}</h2><p>${klass.resource} is this class's combat resource. Equipment and Lattice choices persist between worlds.</p><div class="character-attributes">${Object.values(ATTRIBUTES).map((attr) => `<div><span>${attr.icon} ${attr.name}</span><b>${Math.round(attrs[attr.key] || 0)}</b></div>`).join('')}</div></section>
      <section class="character-career"><span class="modeeyebrow">CAREER</span><div><span>Victories</span><b>${stats.victories || 0}</b></div><div><span>Instances</span><b>${stats.instances || 0}</b></div><div><span>Kills</span><b>${stats.kills || 0}</b></div><div><span>Current world</span><b>${escapeHtml(character.lastWorldId || 'Earth')}</b></div></section>`;
    this.cb.onCharacterPreview?.({ raceKey: character.raceKey, appearance: character.appearance,
      customization: character.customization, equipment: character.equipment,
      proxyHero: character.proxyHero, classKey: character.classKey, canvasId: 'paperdoll-preview-canvas' });
  }

  _renderAbilitiesOverview(character) {
    const klass = MMO_CLASSES[character.classKey] || MMO_CLASSES.vanguard;
    const hero = HEROES[character.proxyHero || klass.proxy] || HEROES.scott;
    const cards = [
      ['AURA', hero.aura], ['PASSIVE I', hero.passives?.[0]], ['PASSIVE II', hero.passives?.[1]], ['ACTIVE ABILITY', hero.ability],
    ];
    this.root.querySelector('#sheet-panel-abilities').innerHTML = cards.map(([kind, ability]) => `<article><span>${kind}</span><i>${ability?.icon || '✦'}</i><h3>${ability?.name || 'Unassigned'}</h3><p>${ability?.desc || 'This class kit is still being authored.'}</p></article>`).join('');
  }

  _renderMarketPanel(character) {
    const balance = this.root.querySelector('#market-balance');
    const marketGuide = this.root.querySelector('#sheet-guide-market');
    if (marketGuide) {
      const step = firstHourStep(character);
      marketGuide.innerHTML = step === 'market'
        ? 'Next: choose one affordable upgrade. Stat impact below is calculated from the loadout the mission will use.'
        : `${step === 'equip' ? 'Purchase complete. Your item is safe in the stash.' : 'Compare before buying. Purchases move to your stash; nothing equips automatically.'}${step === 'equip' ? ' <button data-next-gear>OPEN EQUIPMENT →</button>' : ''}`;
      marketGuide.querySelector('[data-next-gear]')?.addEventListener('click', () => { this._sheetTab = 'gear'; this._renderCharacterSheet(); });
    }
    const authoritative = !!this.cb.useAuthoritativeEconomy?.();
    if (authoritative && !Number.isFinite(character.authoritativeBalance)) {
      if (balance) balance.textContent = `${META_CURRENCY.icon} Syncing online ledger…`;
      this.root.querySelector('#market-stock').innerHTML = '<span class="empty-gear">Online inventory is loading.</span>';
      this.root.querySelector('#market-sell').innerHTML = '';
      if (!this._marketSyncing) {
        this._marketSyncing = true;
        Promise.resolve(this.cb.onAuthoritySync?.(character))
          .then((result) => {
            if (!result) throw new Error('authority_unavailable');
            this._marketSyncing = false;
            this._renderCharacterSheet();
          })
          .catch(() => {
            this._marketSyncing = false;
            if (balance) balance.textContent = `${META_CURRENCY.icon} Online ledger unavailable`;
            this.showBanner('Online inventory is unavailable. No changes were made.', 'bad', 2800);
          });
      }
      return;
    }
    const meta = loadMeta();
    const marketCurrency = Number.isFinite(character.authoritativeBalance) ? character.authoritativeBalance : meta.currency;
    if (balance) balance.textContent = `${META_CURRENCY.icon} ${marketCurrency.toLocaleString()} ${META_CURRENCY.name}`;
    this._marketVendor = VENDORS[this._marketVendor] ? this._marketVendor : 'quartermaster';
    const vendorNav = this.root.querySelector('#market-vendors');
    vendorNav.innerHTML = Object.values(VENDORS).map((vendor) => {
      const eligibility = vendorEligibility(vendor.id, character);
      return `<button data-vendor="${vendor.id}" class="${vendor.id === this._marketVendor ? 'sel' : ''}" ${eligibility.ok ? '' : 'disabled'}>${vendor.icon} ${vendor.name}${eligibility.ok ? '' : ` · LV ${eligibility.requiredLevel}`}</button>`;
    }).join('');
    for (const button of vendorNav.querySelectorAll('[data-vendor]')) button.onclick = () => {
      this._marketVendor = button.dataset.vendor;
      this._renderMarketPanel(character);
    };
    const vendor = VENDORS[this._marketVendor];
    this.root.querySelector('#market-vendor-name').textContent = vendor.name.toUpperCase();
    this.root.querySelector('#market-vendor-description').textContent = vendor.description;
    const rotation = vendorRotation(vendor.id);
    const stock = vendorStock(vendor.id, rotation, character.level || 1);
    const stockRoot = this.root.querySelector('#market-stock');
    stockRoot.innerHTML = stock.map((offer, index) => {
      const preview = equipmentPreview(character, offer.key);
      const roleMatch = preview.deltas.some((entry) => entry.key === CLASS_ATTRS[character.classKey] && entry.value > 0);
      return `<article class="market-item" style="--rarity:${offer.item.rarityColor}"><span>${offer.item.icon}</span><div><b>${offer.item.name}${roleMatch ? ' · ROLE MATCH' : ''}</b><small>${offer.item.rarityName} · Item ${offer.item.ilvl} · ${compactDeltas(preview.deltas)}${preview.target ? ` · ${preview.target}` : ''}</small></div><button data-buy="${index}" ${offer.price > marketCurrency ? 'disabled' : ''}>${META_CURRENCY.icon} ${offer.price}</button></article>`;
    }).join('');
    for (const button of stockRoot.querySelectorAll('[data-buy]')) {
      button.onclick = async () => {
        button.disabled = true;
        let result;
        try {
          result = await runEconomyMutation({
            authoritative: !!this.cb.useAuthoritativeEconomy?.(),
            remote: () => this.cb.onMarketBuy?.(character, vendor.id, Number(button.dataset.buy)),
            offline: () => buyVendorItem(character, stock[Number(button.dataset.buy)]),
          });
        }
        catch (error) { result = { ok: false, reason: error?.result?.error || error?.message || 'failed' }; }
        button.disabled = false;
        if (!result.ok) {
          const message = result.reason === 'authority_unavailable' ? 'Online inventory is unavailable. No changes were made.'
            : ['full', 'inventory_full'].includes(result.reason) ? 'Your stash is full.'
              : result.reason === 'insufficient_funds' ? `You do not have enough ${META_CURRENCY.name}.`
                : 'The purchase could not be completed.';
          this.showBanner(message, 'bad', 2400);
          return;
        }
        this._sheetChanged();
        this.showBanner('Item purchased and moved to your stash.', '', 1800);
      };
    }
    const sellRoot = this.root.querySelector('#market-sell');
    sellRoot.innerHTML = (character.items || []).map((key, index) => {
      const item = itemInfo(key);
      return item ? `<article class="market-item compact" style="--rarity:${item.rarityColor}"><span>${item.icon}</span><div><b>${item.name}</b><small>${item.rarityName}</small></div><button data-sell="${index}">SELL · ${META_CURRENCY.icon} ${vendorSellPrice(key)}</button></article>` : '';
    }).join('') || '<span class="empty-gear">Your stash has nothing the quartermaster can buy.</span>';
    for (const button of sellRoot.querySelectorAll('[data-sell]')) {
      button.onclick = async () => {
        button.disabled = true;
        const expectedValue = vendorSellPrice((character.items || [])[Number(button.dataset.sell)]);
        let result;
        try {
          result = await runEconomyMutation({
            authoritative: !!this.cb.useAuthoritativeEconomy?.(),
            remote: () => this.cb.onMarketSell?.(character, Number(button.dataset.sell)),
            offline: () => sellVendorItem(character, Number(button.dataset.sell)),
          });
        }
        catch (error) { result = { ok: false, reason: error?.result?.error || error?.message || 'failed' }; }
        button.disabled = false;
        if (!result.ok) {
          this.showBanner(result.reason === 'authority_unavailable'
            ? 'Online inventory is unavailable. No changes were made.' : 'The sale could not be completed.', 'bad', 2400);
          return;
        }
        this._sheetChanged();
        this.showBanner(`Sold for ${result.mutation?.value || result.value || expectedValue} ${META_CURRENCY.name}.`, '', 1800);
      };
    }
  }

  _renderCraftingPanel(character) {
    const resources = this.root.querySelector('#craft-resources');
    const vendor = this.root.querySelector('#craft-vendor');
    const itemRoot = this.root.querySelector('#craft-items');
    const bench = this.root.querySelector('#craft-workbench');
    const status = this.root.querySelector('#craft-status');
    const materials = character.craftingMaterials || {};
    const forgeGuide = this.root.querySelector('#sheet-guide-forge');
    if (forgeGuide) {
      const step = firstHourStep(character);
      forgeGuide.innerHTML = step === 'forge'
        ? 'Next: select an owned item, then add a socket or install a matching component. Costs are shown before confirmation.'
        : `Forge changes persist. A stale or failed request consumes nothing.${step === 'mission' ? ' <button data-next-mission>ENTER WORLD →</button>' : ''}`;
      forgeGuide.querySelector('[data-next-mission]')?.addEventListener('click', () => { this._closeCharacterSheet(); this.cb.onCampaignMap?.(); });
    }
    resources.innerHTML = `<b>${META_CURRENCY.icon} ${character.authoritativeBalance ?? '—'} ${META_CURRENCY.name}</b>${Object.values(CRAFTING_MATERIALS).map((m) => `<span>${m.icon} ${m.name}: <b>${materials[m.id] || 0}</b></span>`).join('')}`;
    vendor.innerHTML = `<h3>FORGE SUPPLIES</h3>${Object.values(CRAFTING_MATERIALS).map((m) => `<button data-material="${m.id}">${m.icon} BUY ${m.name} · ${CRAFT_VENDOR_PRICES[m.id]}</button>`).join('')}<h3>RANK I COMPONENTS</h3>${Object.values(COMPONENTS).map((c) => `<button data-component="${c.id}">◇ ${c.name} · 45<small>${modImpact(componentMods(c.id, 1))}</small></button>`).join('')}`;
    const transact = async (button, task) => {
      button.disabled = true; status.textContent = 'Processing securely…'; status.className = 'loading';
      try {
        const result = await task();
        if (!result?.ok) throw Object.assign(new Error(result?.error?.message || result?.error || 'Crafting failed.'), { result });
        status.textContent = result.mutation?.action ? 'Crafting complete.' : 'Supply purchased.'; status.className = 'ok';
        this._renderCraftingPanel(character);
      } catch (error) {
        const detail = error?.result?.error; status.textContent = detail?.message || (typeof detail === 'string' ? detail.replaceAll('_', ' ') : error.message); status.className = 'bad';
      } finally { button.disabled = false; }
    };
    for (const button of vendor.querySelectorAll('[data-material]')) button.onclick = () => transact(button, () => this.cb.onCraftBuyMaterial?.(character, button.dataset.material));
    for (const button of vendor.querySelectorAll('[data-component]')) button.onclick = () => transact(button, () => this.cb.onCraftBuyComponent?.(character, button.dataset.component));
    const instances = [
      ...(character.itemInstances || []).map((item) => ({ ...item, location: 'stash' })),
      ...Object.entries(character.equipmentItemInstances || {}).map(([slot, item]) => ({ ...item, id: item.id, key: item.legacyKey, location: slot })),
    ];
    if (!instances.some((item) => item.id === this._craftItemId)) this._craftItemId = instances[0]?.id || null;
    itemRoot.innerHTML = instances.map((instance) => {
      const item = itemInfo(instance.key || instance.legacyKey); const sockets = instance.sockets || [];
      return `<button data-craft-item="${instance.id}" class="market-item ${instance.id === this._craftItemId ? 'sel' : ''}"><span>${item?.icon || '◈'}</span><div><b>${item?.name || 'Unknown item'}</b><small>${instance.location} · revision ${instance.revision} · ${sockets.length} socket${sockets.length === 1 ? '' : 's'}</small></div></button>`;
    }).join('') || '<span class="empty-gear">Buy an item before using the forge.</span>';
    for (const button of itemRoot.querySelectorAll('[data-craft-item]')) button.onclick = () => { this._craftItemId = button.dataset.craftItem; this._craftSocket = 0; this._renderCraftingPanel(character); };
    const selected = instances.find((item) => item.id === this._craftItemId);
    if (!selected) { bench.innerHTML = '<p>Select an item. Buy one in the Market if your stash is empty.</p>'; return; }
    const sockets = selected.sockets || []; const components = (character.craftingComponents || []).filter((c) => c.location === 'inventory');
    bench.innerHTML = `<div class="craft-sockets">${sockets.map((socket, index) => `<button data-socket="${index}" class="${index === (this._craftSocket || 0) ? 'sel' : ''}">${socket.color} ${socket.type}<small>${socket.component ? `${COMPONENTS[socket.component.id]?.name || socket.component.id} · rank ${socket.component.rank} · ${modImpact(componentMods(socket.component, socket.component.rank))}` : 'empty · install a matching component for power'}</small></button>`).join('') || '<p>No sockets. Add one below.</p>'}</div>
      <div class="craft-recipes">${Object.values(RECIPES).map((recipe) => `<button data-recipe="${recipe.id}">${recipe.name}<small>${recipeCost(recipe)}${recipe.id === 'upgrade_component' && sockets[this._craftSocket || 0]?.component ? ` · next rank adds ${modImpact(componentMods(sockets[this._craftSocket || 0].component, 1))}` : ''}</small></button>`).join('')}</div>
      <div class="craft-components">${components.map((component) => `<button data-insert="${component.id}">INSTALL ${COMPONENTS[component.componentId]?.name || component.componentId}<small>${modImpact(componentMods(component.componentId, 1))}</small></button>`).join('') || '<p>No loose components. Buy one from Forge Supplies.</p>'}${sockets[this._craftSocket || 0]?.component ? '<button data-remove>REMOVE COMPONENT<small>Removes the listed effect and returns the component.</small></button>' : ''}</div>`;
    for (const button of bench.querySelectorAll('[data-socket]')) button.onclick = () => { this._craftSocket = Number(button.dataset.socket); this._renderCraftingPanel(character); };
    const run = (button, action, details) => transact(button, () => this.cb.onCraftAction?.(character, action, selected.id, selected.revision, { socketIndex: this._craftSocket || 0, ...details }));
    for (const button of bench.querySelectorAll('[data-recipe]')) button.onclick = () => run(button, 'craft_recipe', { recipeId: button.dataset.recipe });
    for (const button of bench.querySelectorAll('[data-insert]')) button.onclick = () => run(button, 'socket_insert', { componentId: button.dataset.insert });
    bench.querySelector('[data-remove]')?.addEventListener('click', (event) => run(event.currentTarget, 'socket_remove', {}));
  }

  // What a character is wearing, what is in the stash, and what the two add up
  // to. The totals are the same call the simulation makes, so the screen can
  // never disagree with the battlefield.
  _renderGearPanel(character) {
    const slots = this.root.querySelector('#gear-slots');
    const attrs = this._sheetAttributes(character);
    const gearGuide = this.root.querySelector('#sheet-guide-gear');
    if (gearGuide) {
      const step = firstHourStep(character);
      gearGuide.innerHTML = step === 'equip'
        ? 'Next: select a stash item to preview its exact attribute changes, then equip it. Nothing is equipped automatically.'
        : `Your mission loadout uses only legally equipped items.${step === 'forge' ? ' <button data-next-forge>OPEN FORGE →</button>' : ''}`;
      gearGuide.querySelector('[data-next-forge]')?.addEventListener('click', () => { this._sheetTab = 'crafting'; this._renderCharacterSheet(); });
    }
    // What the run will actually use. A slot holding something the character
    // cannot legally wield is shown as illegal rather than quietly counted.
    const worn = legalEquipment(character);
    const label = {
      weapon: 'SET I · WEAPON', offhand: 'SET I · OFF-HAND',
      weapon2: 'SET II · WEAPON', offhand2: 'SET II · OFF-HAND',
      head: 'HEAD', armor: 'CHEST', hands: 'HANDS', legs: 'LEGS', boots: 'BOOTS',
      implant1: 'IMPLANT I', implant2: 'IMPLANT II',
    };
    slots.innerHTML = EQUIP_SLOTS.map((slot) => {
      const key = (character.equipment || {})[slot];
      const item = key ? itemInfo(key) : null;
      if (!item) {
        return `<button class="gear-slot empty" data-slot="${slot}"><span class="gear-slot-label">${label[slot]}</span>
          <span class="gear-slot-name">— empty —</span></button>`;
      }
      const legal = worn[slot] === key;
      return `<button class="gear-slot${legal ? '' : ' illegal'}" data-slot="${slot}" style="--rarity:${item.rarityColor}">
        <span class="gear-slot-label">${label[slot]}</span>
        <span class="gear-slot-name">${item.icon} ${item.name}</span>
        <span class="gear-slot-lines">${itemLines(item).slice(0, 4).map((l) => `<i>${l}</i>`).join('')}</span>
        ${legal ? '' : `<span class="gear-slot-req">REQUIRES ${requirementText(item)}</span>`}
      </button>`;
    }).join('');
    for (const button of slots.querySelectorAll('.gear-slot')) {
      const slot = button.dataset.slot;
      const key = (character.equipment || {})[slot] || null;
      button.draggable = !!key;
      button.classList.toggle('selected', this._sheetSelection?.kind === 'slot' && this._sheetSelection.slot === button.dataset.slot);
      button.onclick = () => {
        this._sheetSelection = { kind: 'slot', slot: button.dataset.slot, key: (character.equipment || {})[button.dataset.slot] || null };
        this._renderGearPanel(character);
      };
      button.ondblclick = () => this._unequip(character, button.dataset.slot);
      button.ondragstart = (event) => this._beginItemDrag(event, { kind: 'slot', slot, key });
      button.ondragover = (event) => {
        if (this._draggedItem?.kind !== 'stash') return;
        event.preventDefault();
        button.classList.toggle('drop-target', canEquip(character, this._draggedItem.key, slot));
      };
      button.ondragleave = () => button.classList.remove('drop-target');
      button.ondrop = (event) => {
        event.preventDefault(); button.classList.remove('drop-target');
        if (this._draggedItem?.kind === 'stash') this._equipFromStash(character, this._draggedItem.index, slot);
        this._endItemDrag();
      };
    }

    const stash = (character.items || []);
    this.root.querySelector('#gear-stash-count').textContent = `${stash.length}/${STASH_SLOTS}`;
    const list = this.root.querySelector('#gear-stash-list');
    list.innerHTML = stash.length
      ? stash.map((key, index) => {
        const item = itemInfo(key);
        if (!item) return '';
        const legal = meetsRequirement(item, attrs);
        const wearable = !!item.slot;
        return `<button class="stash-item${legal ? '' : ' illegal'}${wearable ? '' : ' fixed'}" data-index="${index}"
          style="--rarity:${item.rarityColor}" title="${itemLines(item).join(' · ') || item.desc || ''}">
          <span>${item.icon} ${item.name}</span>
          <small>${item.ilvl ? `i${item.ilvl} ` : ''}${item.rarityName}${legal || !item.req ? '' : ` · needs ${requirementText(item)}`}</small>
        </button>`;
      }).join('')
      : '<span class="empty-gear">Nothing recovered yet. The frontier is hiding it.</span>';
    for (const button of list.querySelectorAll('.stash-item')) {
      const index = Number(button.dataset.index);
      const key = (character.items || [])[index] || null;
      button.draggable = true;
      button.classList.toggle('selected', this._sheetSelection?.kind === 'stash' && this._sheetSelection.index === Number(button.dataset.index));
      button.onclick = () => {
        this._sheetSelection = { kind: 'stash', index: Number(button.dataset.index), key: (character.items || [])[Number(button.dataset.index)] || null };
        this._renderGearPanel(character);
      };
      button.ondblclick = () => this._equipFromStash(character, Number(button.dataset.index));
      button.ondragstart = (event) => this._beginItemDrag(event, { kind: 'stash', index, key });
      button.ondragover = (event) => { event.preventDefault(); button.classList.add('drop-target'); };
      button.ondragleave = () => button.classList.remove('drop-target');
      button.ondrop = (event) => {
        event.preventDefault(); button.classList.remove('drop-target');
        if (this._draggedItem?.kind === 'slot') this._unequip(character, this._draggedItem.slot);
        else if (this._draggedItem?.kind === 'stash') this._moveStashItem(character, this._draggedItem.index, index);
        this._endItemDrag();
      };
    }

    list.ondragover = (event) => { if (this._draggedItem?.kind === 'slot') event.preventDefault(); };
    list.ondrop = (event) => {
      if (event.target.closest('.stash-item')) return;
      event.preventDefault();
      if (this._draggedItem?.kind === 'slot') this._unequip(character, this._draggedItem.slot);
      this._endItemDrag();
    };

    this._renderItemDetail(character);
    this._renderGearStats(character, attrs);
  }

  _renderItemDetail(character) {
    const detail = this.root.querySelector('#gear-item-detail');
    const selection = this._sheetSelection;
    const key = selection?.key;
    const item = key ? itemInfo(key) : null;
    if (!item) {
      detail.innerHTML = '<p>Select an item to inspect it. Double-click a stash item to equip it; double-click equipped gear to unequip it.</p>';
      return;
    }
    const targetSlots = item.slot ? slotsForPool(item.slot) : [];
    const target = selection.kind === 'slot' ? selection.slot : (targetSlots.find((slot) => !(character.equipment || {})[slot]) || targetSlots[0]);
    const equippedKey = target ? (character.equipment || {})[target] : null;
    const equipped = equippedKey && equippedKey !== key ? itemInfo(equippedKey) : null;
    let comparison = '';
    let legal = true;
    if (selection.kind === 'stash' && target) {
      legal = canEquip(character, key, target);
      const preview = { ...character, equipment: { ...(character.equipment || {}), [target]: key } };
      const before = characterAttributes(character);
      const after = characterAttributes(preview);
      comparison = Object.values(ATTRIBUTES).map((attr) => {
        const delta = Math.round((after[attr.key] || 0) - (before[attr.key] || 0));
        return `<span>${attr.icon} ${attr.name} <b class="${delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}">${delta > 0 ? '+' : ''}${delta}</b></span>`;
      }).join('');
    }
    detail.innerHTML = `<div class="item-card" style="--rarity:${item.rarityColor}"><span class="item-rarity">${item.rarityName || 'ITEM'} ${item.ilvl ? `· ITEM LEVEL ${item.ilvl}` : ''}</span><h2>${item.icon} ${item.name}</h2>${item.desc ? `<p>${item.desc}</p>` : ''}<ul>${itemLines(item).map((line) => `<li>${line}</li>`).join('') || '<li>No modifiers</li>'}</ul>${item.req ? `<small class="${legal ? '' : 'invalid'}">Requires ${requirementText(item)}</small>` : ''}</div>${equipped ? `<div class="compare-card"><span>CURRENTLY EQUIPPED</span><b>${equipped.icon} ${equipped.name}</b>${itemLines(equipped).map((line) => `<small>${line}</small>`).join('')}</div>` : ''}${comparison ? `<div class="item-deltas">${comparison}</div>` : ''}<div class="item-actions">${selection.kind === 'stash' && item.slot ? `<button class="menubtn primary" id="gear-action-equip" ${legal ? '' : 'disabled'}>EQUIP${target ? ` TO ${target.toUpperCase()}` : ''}</button>` : selection.kind === 'slot' ? '<button class="menubtn" id="gear-action-unequip">UNEQUIP</button>' : ''}</div>`;
    detail.querySelector('#gear-action-equip')?.addEventListener('click', () => this._equipFromStash(character, selection.index, target));
    detail.querySelector('#gear-action-unequip')?.addEventListener('click', () => this._unequip(character, selection.slot));
  }

  _beginItemDrag(event, item) {
    if (!item?.key) { event.preventDefault(); return; }
    this._draggedItem = item;
    event.currentTarget.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.key);
    event.currentTarget.addEventListener('dragend', () => this._endItemDrag(), { once: true });
  }

  _endItemDrag() {
    this._draggedItem = null;
    for (const element of this.root.querySelectorAll('.dragging, .drop-target')) {
      element.classList.remove('dragging', 'drop-target');
    }
  }

  _moveStashItem(character, from, to) {
    if (from === to || from < 0 || to < 0) return;
    const items = [...(character.items || [])];
    if (from >= items.length || to >= items.length) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    character.items = items;
    this._sheetSelection = { kind: 'stash', index: to, key: item };
    this._sheetChanged();
  }

  // Attributes come from gear and the Lattice together, and they are what gate
  // a weapon base — so the panel has to sum both before it can say "illegal".
  _sheetAttributes(character) {
    return characterAttributes(character);
  }

  _renderGearStats(character, attrs) {
    const equipped = EQUIP_SLOTS.map((slot) => (character.equipment || {})[slot]).filter(Boolean);
    const gear = itemMods(equipped);
    const tree = treeBonuses(character.lattice, character.classKey);
    const total = {};
    for (const [key, value] of Object.entries(gear)) total[key] = (total[key] || 0) + value;
    for (const [key, value] of Object.entries(tree.mods)) total[key] = (total[key] || 0) + value;

    const weaponKey = (character.equipment || {})[character.activeSet === 1 ? 'weapon2' : 'weapon'];
    const weapon = weaponKey ? itemInfo(weaponKey)?.weapon : null;
    const rows = [];
    rows.push(`<div class="gear-attr">${Object.values(ATTRIBUTES).map((a) =>
      `<span>${a.icon} ${a.name} <b>${Math.round(attrs[a.key] || 0)}</b></span>`).join('')}</div>`);
    if (weapon) {
      const split = Object.entries(weapon.types || {}).filter(([, v]) => v > 0)
        .map(([t, v]) => `${Math.round(v * 100)}% ${t}`).join(', ');
      rows.push(`<div class="gear-weapon"><b>${Math.round(weapon.dmg)}</b> damage · <b>${weapon.rof.toFixed(2)}</b>/s · <b>${weapon.range.toFixed(1)}</b> range<small>${split}</small></div>`);
    } else {
      rows.push('<div class="gear-weapon"><b>Signature weapon</b><small>Your class fights with what it was written with.</small></div>');
    }
    const shown = itemLines({ mods: total, affixes: [] });
    rows.push(shown.length ? `<ul>${shown.map((l) => `<li>${l}</li>`).join('')}</ul>`
      : '<p class="empty-gear">No bonuses yet.</p>');
    if (tree.doctrines.length) {
      rows.push(`<div class="gear-doctrines"><h4>DOCTRINES</h4>${tree.doctrines.map((id) => {
        const d = DOCTRINES[id];
        return `<p><b>${d.icon} ${d.name}</b> — ${d.desc} <i>${d.cost}</i></p>`;
      }).join('')}</div>`);
    }
    this.root.querySelector('#gear-stat-list').innerHTML = rows.join('');
  }

  async _equipFromStash(character, index, preferredSlot = null) {
    const key = (character.items || [])[index];
    const item = key ? itemInfo(key) : null;
    if (!item || !item.slot) return;
    // Implants have two sockets. Fill the empty one first, then replace the
    // first — never silently drop the one already in.
    // Every slot the item could go in, nearest-empty-first. Without this the
    // second weapon set was unreachable: a weapon always landed in slot one,
    // so hasSecondSet() was never true and X always denied.
    const candidates = slotsForPool(item.slot);
    const equipment = character.equipment || {};
    const slot = preferredSlot && candidates.includes(preferredSlot)
      ? preferredSlot
      : candidates.find((s) => !equipment[s]) || candidates[0];
    // Ask the model. It refuses an item that could only meet its requirement by
    // counting itself, or by borrowing from the sheathed weapon set.
    if (!canEquip(character, key, slot)) {
      this.showBanner(`✋ ${item.name} needs ${requirementText(item)}.`, '', 2600);
      return;
    }
    try {
      const result = await runEconomyMutation({
        authoritative: !!this.cb.useAuthoritativeEconomy?.(),
        remote: () => this.cb.onAuthorityEquip?.(character, index, slot),
        offline: () => null,
      });
      if (result) {
        this._sheetSelection = { kind: 'slot', slot, key };
        this._sheetChanged();
        return;
      }
    } catch (error) {
      this.showBanner(`✋ ${error?.result?.error || error?.message || 'Equipment update failed.'}`, 'bad', 2600);
      return;
    }
    const previous = (character.equipment || {})[slot];
    character.equipment = { ...(character.equipment || {}), [slot]: key };
    character.items = (character.items || []).filter((_, i) => i !== index);
    if (previous) character.items.push(previous);
    character.equipment = normalizeEquipment(character.equipment);
    this._sheetSelection = { kind: 'slot', slot, key };
    this._sheetChanged();
  }

  async _unequip(character, slot) {
    const key = (character.equipment || {})[slot];
    if (!key) return;
    if ((character.items || []).length >= STASH_SLOTS) {
      this.showBanner('✋ The stash is full.', '', 2400);
      return;
    }
    try {
      const result = await runEconomyMutation({
        authoritative: !!this.cb.useAuthoritativeEconomy?.(),
        remote: () => this.cb.onAuthorityUnequip?.(character, slot),
        offline: () => null,
      });
      if (result) {
        this._sheetSelection = { kind: 'stash', index: character.items.length - 1, key };
        this._sheetChanged();
        return;
      }
    } catch (error) {
      this.showBanner(`✋ ${error?.result?.error || error?.message || 'Equipment update failed.'}`, 'bad', 2600);
      return;
    }
    const next = { ...(character.equipment || {}) };
    delete next[slot];
    character.equipment = next;
    character.items = [...(character.items || []), key];
    this._sheetSelection = { kind: 'stash', index: character.items.length - 1, key };
    this._sheetChanged();
  }

  // The Lattice screen. A pan-and-zoom canvas over the generated graph — 646
  // nodes is far past what DOM elements would carry, and the tree is pure
  // geometry, so a canvas is the honest tool.
  _renderLatticePanel(character) {
    const canvas = this.root.querySelector('#lattice-canvas');
    const tree = buildLattice();
    if (!this._latticeView) {
      this._latticeView = { x: 0, y: 0, scale: 0.42, hover: null, selected: null, query: '' };
      this._bindLatticeInput(canvas);
    }
    // Centre on the character's origin the first time they open it.
    if (this._latticeOrigin !== character.id) {
      this._latticeOrigin = character.id;
      const origin = tree.byId.get(originIdFor(character.classKey));
      if (origin) {
        this._latticeView.x = -origin.x;
        this._latticeView.y = -origin.y;
      }
      this._latticeView.selected = null;
    }
    const budget = latticePoints(character.level, character.questPoints);
    const spent = (character.lattice || []).length;
    this.root.querySelector('#lattice-points').innerHTML =
      `<b>${budget - spent}</b> unspent · ${spent}/${budget} allocated`;
    const rewire = this.root.querySelector('#lattice-rewire');
    rewire.disabled = !spent;
    rewire.textContent = spent ? `REWIRE · ${rewireCost(spent)} ${META_CURRENCY.short}` : 'REWIRE';
    this._drawLattice(character);
    this._renderLatticeDetail(character);
  }

  _bindLatticeInput(canvas) {
    const view = this._latticeView;
    const toWorld = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left - rect.width / 2) / view.scale - view.x,
        y: (event.clientY - rect.top - rect.height / 2) / view.scale - view.y,
      };
    };
    // Nearest node within a generous radius — the nodes are small on screen
    // and a build should never be lost to a two-pixel miss.
    const pick = (event) => {
      const world = toWorld(event);
      const tree = buildLattice();
      let best = null, bd = (34 / view.scale) ** 2;
      for (const node of tree.nodes) {
        const d = (node.x - world.x) ** 2 + (node.y - world.y) ** 2;
        if (d < bd) { bd = d; best = node; }
      }
      return best;
    };

    let dragging = false, moved = false, lastX = 0, lastY = 0;
    canvas.onpointerdown = (event) => {
      dragging = true; moved = false;
      lastX = event.clientX; lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    canvas.onpointermove = (event) => {
      if (dragging) {
        const dx = event.clientX - lastX, dy = event.clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        view.x += dx / view.scale;
        view.y += dy / view.scale;
        lastX = event.clientX; lastY = event.clientY;
        this._drawLattice(this._sheetCharacter());
        return;
      }
      const node = pick(event);
      if (node?.id !== view.hover?.id) {
        view.hover = node;
        this._drawLattice(this._sheetCharacter());
      }
    };
    canvas.onpointerup = (event) => {
      dragging = false;
      canvas.releasePointerCapture(event.pointerId);
      if (moved) return;
      const node = pick(event);
      if (!node) return;
      view.selected = node;
      this._latticeClick(this._sheetCharacter(), node, event.shiftKey);
    };
    canvas.onwheel = (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14;
      view.scale = Math.max(0.16, Math.min(2.4, view.scale * factor));
      this._drawLattice(this._sheetCharacter());
    };

    const search = this.root.querySelector('#lattice-search');
    search.oninput = () => {
      view.query = search.value.trim().toLowerCase();
      this._drawLattice(this._sheetCharacter());
    };
    this.root.querySelector('#lattice-rewire').onclick = () => {
      const character = this._sheetCharacter();
      if (!character || !(character.lattice || []).length) return;
      if (this.cb.useAuthoritativeEconomy?.()) {
        this.showBanner('✋ Lattice rewiring is unavailable until its server transaction is enabled.', 'bad', 3200);
        return;
      }
      const cost = rewireCost((character.lattice || []).length);
      const held = loadMeta().currency;
      if (held < cost) {
        this.showBanner(`✋ Rewiring costs ${cost} ${META_CURRENCY.name}. You hold ${held}.`, '', 3200);
        return;
      }
      if (!window.confirm(`Rewire the whole Lattice for ${cost} ${META_CURRENCY.name}? Every point comes back.`)) return;
      // Charge first. A refused charge must not hand the points back.
      const paid = charge(cost);
      if (!paid.ok) {
        this.showBanner(`✋ Rewiring costs ${cost} ${META_CURRENCY.name}. You hold ${paid.meta.currency}.`, '', 3200);
        return;
      }
      const returned = rewireLattice(character);
      this.showBanner(`⚡ Rewired — ${returned} points returned for ${cost} ${META_CURRENCY.short}.`, '', 2800);
      this._sheetChanged();
    };
  }

  // A click buys the node, or the whole path to it. Shift removes. Both go
  // through the model, so an illegal move is refused there, not here.
  _latticeClick(character, node, remove) {
    if (!character || node.kind === 'origin') return;
    const owned = character.lattice || [];
    if (remove || owned.includes(node.id)) {
      if (!owned.includes(node.id)) return;
      if (!deallocateLatticeNode(character, node.id)) {
        this.showBanner('✋ Removing that would strand the rest of the build.', '', 2600);
        return;
      }
      this._sheetChanged();
      return;
    }
    const budget = latticePoints(character.level, character.questPoints);
    const path = pathTo(owned, node.id, character.classKey) || [];
    if (!path.length) return;
    if (owned.length + path.length > budget) {
      this.showBanner(`✋ That route costs ${path.length} points and you have ${budget - owned.length}.`, '', 2800);
      return;
    }
    for (const id of path) allocateLatticeNode(character, id);
    this._sheetChanged();
  }

  _drawLattice(character) {
    const canvas = this.root.querySelector('#lattice-canvas');
    if (!canvas || !character) return;
    const view = this._latticeView;
    const tree = buildLattice();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || 900, height = canvas.clientHeight || 620;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(view.scale, view.scale);
    ctx.translate(view.x, view.y);

    const owned = new Set(character.lattice || []);
    const originId = originIdFor(character.classKey);
    const reachable = frontier(character.lattice, character.classKey);
    const preview = view.hover && !owned.has(view.hover.id) && view.hover.kind !== 'origin'
      ? new Set(pathTo(character.lattice, view.hover.id, character.classKey) || [])
      : new Set();
    const query = view.query;

    // Edges first, so nodes sit on top of them.
    ctx.lineWidth = 2 / view.scale;
    for (const node of tree.nodes) {
      for (const id of node.edges) {
        if (id < node.id) continue;             // draw each edge once
        const other = tree.byId.get(id);
        if (!other) continue;
        const bothOwned = (owned.has(node.id) || node.id === originId)
          && (owned.has(id) || id === originId);
        const onPath = preview.has(node.id) || preview.has(id);
        ctx.strokeStyle = bothOwned ? 'rgba(240, 214, 140, 0.85)'
          : onPath ? 'rgba(120, 200, 255, 0.7)'
          : 'rgba(150, 160, 180, 0.16)';
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(other.x, other.y);
        ctx.stroke();
      }
    }

    const RADIUS = { trace: 7, attribute: 9, relay: 14, doctrine: 20, origin: 22 };
    for (const node of tree.nodes) {
      const isOwned = owned.has(node.id) || node.id === originId;
      const isOrigin = node.kind === 'origin';
      const mine = isOrigin && node.id === originId;
      if (isOrigin && !mine) continue;          // other classes' doors are not yours
      const hit = query && node.name.toLowerCase().includes(query);
      const r = RADIUS[node.kind] || 7;
      const sector = SECTORS[node.sector];

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      // Owned nodes are gold, the buyable frontier is bright, and everything
      // else is tinted by its sector so the nine territories read at a glance.
      ctx.fillStyle = isOwned ? '#f0d68c'
        : preview.has(node.id) ? '#79c8ff'
        : reachable.has(node.id) ? 'rgba(220, 230, 246, 0.7)'
        : sector ? this._sectorTint(sector.color, node.kind)
        : 'rgba(120, 130, 150, 0.28)';
      ctx.fill();
      if (hit) {
        ctx.strokeStyle = '#8ef0a0';
        ctx.lineWidth = 4 / view.scale;
        ctx.stroke();
      } else if (node.kind === 'doctrine' || node.kind === 'relay') {
        ctx.strokeStyle = isOwned ? 'rgba(255,255,255,0.75)' : 'rgba(200,210,230,0.35)';
        ctx.lineWidth = 2 / view.scale;
        ctx.stroke();
      }
      // Only the big nodes carry a glyph — traces would be unreadable soup.
      if (node.kind === 'doctrine' || node.kind === 'origin' || node.kind === 'relay') {
        ctx.fillStyle = isOwned ? '#1a1712' : 'rgba(230, 236, 246, 0.8)';
        ctx.font = `${Math.round(r * 1.1)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.icon || '·', node.x, node.y);
      }
    }
    ctx.restore();
  }

  // A sector's colour, dimmed by how minor the node is. Traces are almost
  // background; relays and doctrines carry the sector's actual hue.
  _sectorTint(hex, kind) {
    const alpha = kind === 'doctrine' ? 0.95 : kind === 'relay' ? 0.75 : kind === 'attribute' ? 0.45 : 0.3;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  _renderLatticeDetail(character) {
    const box = this.root.querySelector('#lattice-detail');
    const node = this._latticeView?.selected || this._latticeView?.hover;
    if (!node) {
      const tree = treeBonuses(character.lattice, character.classKey);
      const lines = itemLines({ mods: tree.mods, affixes: [] });
      box.innerHTML = `<h3>THE LATTICE</h3>
        <p class="lattice-blurb">One tree, thirteen doors into it. Your class decides where you start, not what you can become.</p>
        <p class="lattice-blurb"><b>Click</b> a node to buy the whole route to it. <b>Shift-click</b> to sell one back. Drag to pan, scroll to zoom.</p>
        <h4>THIS BUILD</h4>
        ${lines.length ? `<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>` : '<p class="empty-gear">Nothing allocated yet.</p>'}`;
      return;
    }
    const owned = (character.lattice || []).includes(node.id);
    const sector = SECTORS[node.sector];
    const path = owned ? [] : (pathTo(character.lattice, node.id, character.classKey) || []);
    const doctrine = node.doctrine ? DOCTRINES[node.doctrine] : null;
    const pinned = (character.latticeSets || {})[node.id];
    const lines = itemLines({ mods: node.mods || {}, affixes: [] });
    box.innerHTML = `
      <h3>${node.icon && node.icon !== '·' ? `${node.icon} ` : ''}${node.name}</h3>
      <p class="lattice-kind">${node.kind.toUpperCase()}${sector ? ` · ${sector.name}` : ''}</p>
      ${lines.length ? `<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>` : ''}
      ${doctrine ? `<p class="lattice-doctrine">${doctrine.desc}</p><p class="lattice-cost">${doctrine.cost}</p>` : ''}
      ${sector ? `<p class="lattice-blurb">${sector.desc}</p>` : ''}
      <p class="lattice-route">${owned ? 'ALLOCATED — shift-click to sell back'
        : path.length ? `${path.length} point${path.length === 1 ? '' : 's'} to reach`
        : 'No route from your build'}</p>
      ${owned ? `<div class="lattice-pin"><h4>ACTIVE WITH</h4>
        <button data-set="both" class="${pinned === undefined ? 'sel' : ''}">BOTH SETS</button>
        <button data-set="0" class="${pinned === 0 ? 'sel' : ''}">SET I</button>
        <button data-set="1" class="${pinned === 1 ? 'sel' : ''}">SET II</button></div>` : ''}`;
    for (const button of box.querySelectorAll('.lattice-pin button')) {
      button.onclick = () => {
        const value = button.dataset.set === 'both' ? null : Number(button.dataset.set);
        setLatticeNodeSet(character, node.id, value);
        this._sheetChanged();
      };
    }
  }

  // ----- overworld: the campaign map behind the war-council overlay -----
  // The title screen remains the front door. Story Campaign enters the
  // walkable planet; Esc (or the ⚙ button) opens the council over it.
  setOverworldMode(on) {
    this._overworldMode = !!on;
    if (on) this.shell.enterBase(SHELL_BASES.OVERWORLD);
    this.root.querySelector('#overlay').classList.toggle('overworld', !!on);
    this.root.querySelector('#ow-quick-actions').classList.toggle('hidden', !on);
    this.root.querySelector('#ow-party-frames').classList.toggle('hidden', !on);
    if (!on) this.closeLivingWorldMap();
    else this._renderPartyFrames();
  }

  setLivingWorldState(state) {
    this._livingWorld = normalizeLivingWorld(state);
    this._renderPartyFrames();
    if (!this.root.querySelector('#living-world-map')?.classList.contains('hidden')) this._renderLivingWorldMap();
  }

  _partyAction() {
    const party = this._livingWorld.party;
    if (party.id) this.cb.onPartyOpen?.(party);
    else this.cb.onPartyCreate?.();
  }

  _renderPartyFrames() {
    const box = this.root.querySelector('#ow-party-frames');
    if (!box) return;
    const party = this._livingWorld.party;
    const members = party.members || [];
    const self = members.find((member) => member.self);
    const pending = party.pendingInvites || [];
    box.innerHTML = `<div class="opf-head"><span>PARTY</span><button id="opf-invite">${this._livingWorld.party.id ? '+ INVITE' : '+ CREATE'}</button></div>${members.length ? members.map((member) => {
      const health = Math.max(0, Math.min(100, Number(member.health) || 0));
      return `<button class="opf-member" data-member="${escapeHtml(member.id)}"><span class="opf-portrait">${escapeHtml((member.className || '?').slice(0, 1))}</span><span class="opf-copy"><b>${escapeHtml(member.name)}</b><small>${escapeHtml(member.role || member.className)} · ${escapeHtml(member.status || 'Ready')}</small><i><em style="width:${health}%"></em></i><small class="opf-location">⌖ ${escapeHtml(member.location || 'Unknown')} · ⚔ ${Number(member.companyStrength) || 0}</small></span><strong>${health}%</strong></button>`;
    }).join('') : '<p class="opf-empty">Create a party to invite friends and travel together.</p>'}${pending.map((invite) => `<button class="opf-invite-card" data-invite="${escapeHtml(invite.id)}">JOIN ${escapeHtml(invite.partyName || 'PARTY')}</button>`).join('')}${party.socialPartyId ? `<div class="opf-actions"><button data-mode="grouped" class="${self?.travelMode === 'grouped' ? 'active' : ''}">TRAVEL TOGETHER</button><button data-mode="split" class="${self?.travelMode === 'split' ? 'active' : ''}">SPLIT</button><button id="opf-leave">LEAVE</button></div>` : ''}`;
    box.querySelector('#opf-invite').onclick = () => this._partyAction();
    for (const button of box.querySelectorAll('[data-member]')) button.onclick = () => this.cb.onPartyMemberLocate?.(button.dataset.member);
    for (const button of box.querySelectorAll('[data-mode]')) button.onclick = () => this.cb.onPartyTravelMode?.(button.dataset.mode);
    for (const button of box.querySelectorAll('[data-invite]')) button.onclick = () => this.cb.onPartyInviteAccept?.(pending.find((invite) => invite.id === button.dataset.invite));
    const leave = box.querySelector('#opf-leave'); if (leave) leave.onclick = () => this.cb.onPartyLeave?.();
  }

  openLivingWorldMap() {
    this._renderLivingWorldMap();
    this.root.querySelector('#living-world-map').classList.remove('hidden');
    this.cb.onLivingWorldOpen?.(this._livingWorld.world.id);
  }

  closeLivingWorldMap() {
    this.root.querySelector('#living-world-map')?.classList.add('hidden');
  }

  _renderLivingWorldMap() {
    const state = this._livingWorld;
    this.root.querySelector('#lw-world-name').textContent = state.world.name;
    this.root.querySelector('#lw-region').textContent = `${state.world.region} · WORLD TIME ${state.world.time}`;
    const regions = this.root.querySelector('#lw-regions');
    regions.innerHTML = state.regions.map((region) => `<button class="lw-region ${region.owner}${region.current ? ' current' : ''}" data-region="${escapeHtml(region.id)}"><span>${escapeHtml(region.current ? 'YOU ARE HERE' : region.controlState.toUpperCase())}</span><b>${escapeHtml(region.name)}</b><small>${escapeHtml(region.ownerName)} · ${Math.round(region.controlStrength * 100)}% control</small></button>`).join('');
    const routes = this.root.querySelector('#lw-routes');
    routes.innerHTML = state.routes.map((route) => `<line x1="${route.from[0]}" y1="${route.from[1]}" x2="${route.to[0]}" y2="${route.to[1]}" class="${route.state}"/>`).join('');
    const nodes = this.root.querySelector('#lw-map-nodes');
    nodes.innerHTML = [
      ...state.settlements.map((item) => `<button class="lw-node settlement ${item.owner}${item.known ? '' : ' unknown'}" style="left:${item.x}%;top:${item.y}%" data-kind="settlement" data-id="${escapeHtml(item.id)}"><i>◆</i><b>${escapeHtml(item.known ? item.name : 'Unknown settlement')}</b><small>${escapeHtml(item.kind)} · ${escapeHtml(item.ownerName)}${item.controlState !== 'controlled' ? ` · ${escapeHtml(item.controlState)}` : ''}</small></button>`),
      ...state.parties.map((item) => `<button class="lw-node army ${item.owner}" style="left:${item.x}%;top:${item.y}%" data-kind="army" data-id="${escapeHtml(item.id)}"><i>⚑</i><b>${escapeHtml(item.name)}</b><small>${Number(item.strength) || 0} · ${escapeHtml(item.intent)}</small></button>`),
      ...state.missions.filter((item) => item.known).map((item) => `<button class="lw-node mission${item.unlocked ? '' : ' locked'}" style="left:${item.x}%;top:${item.y}%" data-kind="mission" data-id="${escapeHtml(item.id)}"><i>✦</i><b>${escapeHtml(item.name)}</b><small>${item.unlocked ? 'READY' : 'LOCKED'}</small></button>`),
    ].join('');
    const missions = this.root.querySelector('#lw-missions');
    const logistics = this.root.querySelector('#lw-logistics');
    const supplies = state.logistics?.supplies || [], cargo = state.logistics?.cargo || [], raids = state.logistics?.raids || [];
    logistics.innerHTML = `<small>COMPANY LOGISTICS</small><b>${supplies.length ? supplies.map((item) => `${escapeHtml(item.supply_key)} ${Math.floor(Number(item.quantity) || 0)}`).join(' · ') : 'No supply report'}</b><p>${cargo.length ? `${cargo.length} cargo type${cargo.length === 1 ? '' : 's'} aboard` : 'No cargo'}${raids.some((raid) => raid.state === 'pending') ? ' · RAID IN PROGRESS' : ''}</p>`;
    missions.innerHTML = state.missions.length ? state.missions.map((mission) => `<button class="lw-mission" data-kind="mission" data-id="${escapeHtml(mission.id)}" ${!mission.known ? 'disabled' : ''}><span>${mission.unlocked ? 'AVAILABLE' : mission.known ? 'DISCOVERED' : 'UNKNOWN'}</span><b>${escapeHtml(mission.known ? mission.name : 'Undiscovered front')}</b><small>${escapeHtml(mission.difficulty)}</small></button>`).join('') : '<p class="lw-empty">No mission intelligence is available yet.</p>';
    for (const button of this.root.querySelectorAll('#living-world-map [data-kind]')) button.onclick = () => this._selectLivingWorldTarget(button.dataset.kind, button.dataset.id);
  }

  _selectLivingWorldTarget(kind, id) {
    const state = this._livingWorld;
    const item = kind === 'settlement' ? state.settlements.find((entry) => entry.id === id)
      : kind === 'army' ? state.parties.find((entry) => entry.id === id)
      : state.missions.find((entry) => entry.id === id);
    if (!item) return;
    const selection = this.root.querySelector('#lw-selection');
    const canFastTravel = kind === 'settlement' && item.known && item.fastTravel;
    const canTravel = kind === 'settlement' && item.known && item.reachable;
    const canDeploy = kind === 'mission' && item.known && item.unlocked;
    const travelLabel = canFastTravel ? 'FAST TRAVEL' : item.crossRegion ? 'TRAVEL TO REGION' : 'TRAVEL ROUTE';
    selection.innerHTML = `<small>${kind === 'army' ? 'WORLD PARTY' : kind === 'mission' ? 'MISSION' : 'DESTINATION'}</small><b>${escapeHtml(item.name)}</b><p>${escapeHtml(item.blurb || item.intent || `${item.kind} · ${item.ownerName || item.owner}${item.crossRegion ? ' · Cross-region handoff' : ''}`)}</p>${canTravel ? `<button class="menubtn primary" id="lw-act">${travelLabel}</button>` : canDeploy ? '<button class="menubtn primary" id="lw-act">ASSEMBLE PARTY & DEPLOY</button>' : kind === 'army' ? '<button class="menubtn" id="lw-act">TRACK PARTY</button>' : '<button class="menubtn" disabled>NO VALID ROUTE</button>'}`;
    const action = selection.querySelector('#lw-act');
    if (action) action.onclick = () => {
      if (canTravel) this.cb.onLivingWorldFastTravel?.(item.id);
      else if (canDeploy) this.cb.onLivingWorldMission?.(item.levelId, { mission: item, party: state.party });
      else this.cb.onLivingWorldTrackParty?.(item.id);
    };
  }

  showGalaxy(destinations, currentWorld = 'earth', macro = null) {
    const map = this.root.querySelector('#galaxy-map');
    const detail = this.root.querySelector('#galaxy-detail');
    const ownership = macro?.worlds || {};
    const recent = (macro?.events || []).slice(0, 3);
    map.innerHTML = '';
    const select = (destination) => {
      for (const node of map.querySelectorAll('.galaxy-node')) node.classList.toggle('sel', node.dataset.world === destination.id);
      const owner = ownership[destination.id]?.owner;
      const state = destination.id === currentWorld ? 'CURRENT LOCATION'
        : owner === 'free' ? 'FREE WORLD'
        : owner === 'hive' ? 'HIVE OCCUPIED'
        : destination.cleared ? 'LIBERATED'
        : destination.unlocked ? 'ROUTE AVAILABLE' : 'ROUTE LOCKED';
      detail.innerHTML = `<span>${state}</span><h2>${destination.name}</h2><p>${destination.subtitle}</p>
        ${destination.threat ? `<small>FRONTIER DEPTH ${destination.threat}</small>` : '<small>ORIGIN WORLD</small>'}
        ${recent.length ? `<div class="galaxy-events"><b>RECENT WAR CHANGES</b>${recent.map((event) => `<span>${event.outcome === 'liberated' ? '✓' : '·'} ${escapeHtml(event.worldId)} · ${escapeHtml(event.outcome)}</span>`).join('')}</div>` : ''}
        <button id="galaxy-travel" class="menubtn primary" ${!destination.unlocked || destination.id === currentWorld ? 'disabled' : ''}>
          ${destination.id === currentWorld ? 'YOU ARE HERE' : destination.unlocked ? 'TRAVEL' : 'LOCKED'}
        </button>`;
      const travel = detail.querySelector('#galaxy-travel');
      travel.onclick = () => this.cb.onGalaxyTravel && this.cb.onGalaxyTravel(destination.id);
    };
    destinations.forEach((destination, index) => {
      const node = document.createElement('button');
      const owner = ownership[destination.id]?.owner;
      node.className = `galaxy-node${destination.unlocked ? '' : ' locked'}${owner ? ` owner-${owner}` : destination.cleared ? ' cleared' : ''}`;
      node.dataset.world = destination.id;
      node.style.setProperty('--gx', `${12 + ((index * 31) % 74)}%`);
      node.style.setProperty('--gy', `${18 + ((index * 47) % 62)}%`);
      node.innerHTML = `<i></i><b>${destination.name}</b><small>${destination.id === currentWorld ? 'YOU ARE HERE' : owner === 'free' ? 'FREE' : owner === 'hive' ? 'HIVE' : destination.cleared ? 'LIBERATED' : destination.unlocked ? 'AVAILABLE' : 'LOCKED'}</small>`;
      node.onclick = () => select(destination);
      map.appendChild(node);
    });
    this._showScreen('galaxy');
    select(destinations.find((destination) => destination.id === currentWorld) || destinations[0]);
  }

  overlayHidden() {
    return this.root.querySelector('#overlay').classList.contains('hidden');
  }

  hideOverlay() {
    this.root.querySelector('#overlay').classList.add('hidden');
    this.shell.overlay = null;
    this.shell.returnOverlay = null;
  }

  toggleOverlay() {
    if (this.overlayHidden()) this._showScreen('world-menu');
    else this.hideOverlay();
  }

  toggleCharacterScreen() {
    const screen = this.root.querySelector('#screen-main');
    const characterOpen = !this.overlayHidden() && screen && !screen.classList.contains('hidden');
    if (characterOpen) this.hideOverlay();
    else this._showScreen('main');
  }

  // ----- hero library (Dota Tab-screen grammar) -----
  fillHeroGrid(heroes) {
    const grid = this.root.querySelector('#herogrid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const h of Object.values(heroes)) {
      const card = document.createElement('div');
      card.className = 'herolib-card';
      const rgb = (c) => `#${(c || 0x888888).toString(16).padStart(6, '0')}`;
      card.innerHTML = `
        <div class="hc-head" style="border-color:${rgb(h.color)}">
          <span class="hc-icon">${h.icon}</span>
          <div><b>${h.name}</b><small>${h.tagline}</small></div>
        </div>
        <div class="hc-stats">HP ${h.hp} · DMG ${h.dmg} · RANGE ${h.range} · SPEED ${h.speed}</div>
        <div class="hc-row"><span class="hc-k">Aura</span><b>${h.aura.icon} ${h.aura.name}</b><p>${h.aura.desc}</p></div>
        <div class="hc-row"><span class="hc-k">Special</span><b>${h.ability.icon} ${h.ability.name}</b><p>${h.ability.desc}</p><small class="hc-cd">Cooldown ${h.ability.cd}s · damage ${h.ability.dmg ? h.ability.dmg.join(' / ') : '—'}</small></div>
        ${h.passives.map((p) => `<div class="hc-row"><span class="hc-k">Passive</span><b>${p.icon} ${p.name}</b><p>${p.desc}</p></div>`).join('')}
    `;
      grid.appendChild(card);
    }
  }

  // ----- living hub strip on the main menu -----
  hubOnline(n) {
    const el = this.root.querySelector('#hub-online');
    if (el) el.textContent = `${n} online now`;
  }
  hubGames(rows) {
    const el = this.root.querySelector('#hub-games');
    if (!el) return;
    const open = (rows || []).filter((g) => g.status === 'open').length;
    const live = (rows || []).filter((g) => g.status === 'in_game' || g.status === 'starting').length;
    el.textContent = `${open} open rooms · ${live} live to watch`;
  }
  hubChat(msgs) {
    const el = this.root.querySelector('#hub-chat');
    if (!el) return;
    const recent = (msgs || []).slice(-3);
    if (!recent.length) return;
    el.innerHTML = '';
    for (const m of recent) {
      const line = document.createElement('div');
      line.className = 'hubchatline';
      const who = document.createElement('b'); who.textContent = m.name || 'Commander';
      const txt = document.createElement('span'); txt.textContent = m.text || '';
      line.append(who, txt);
      el.appendChild(line);
    }
  }

  // Join-by-code flow: a small modal asking for the 6-letter invite code.
  _showJoinCode() {
    let modal = this.root.querySelector('#joincode-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'joincode-modal';
      modal.className = 'roomconfirm';
      modal.innerHTML = `
        <div class="roomconfirmcard">
          <span class="roomeyebrow">Join a war</span>
          <h2>Enter invite code</h2>
          <div class="joincode big">
            <input id="jc-input" maxlength="6" placeholder="ABC123" autocomplete="off" spellcheck="false">
            <button class="tbtn" id="jc-go">JOIN</button>
          </div>
          <div class="mphint" id="jc-hint"></div>
          <div class="roomconfirmactions">
            <button class="tbtn" id="jc-cancel">CANCEL</button>
          </div>
        </div>`;
      this.root.appendChild(modal);
      const close = () => modal.classList.add('hidden');
      modal.querySelector('#jc-cancel').onclick = close;
      const go = () => {
        const code = modal.querySelector('#jc-input').value.trim().toUpperCase();
        if (!code) { modal.querySelector('#jc-hint').textContent = 'Enter the 6-letter code your friend sent.'; return; }
        if (this.cb.onJoinCode) this.cb.onJoinCode(code);
        close();
      };
      modal.querySelector('#jc-go').onclick = go;
      modal.querySelector('#jc-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    }
    modal.classList.remove('hidden');
    const inp = modal.querySelector('#jc-input');
    inp.value = '';
    setTimeout(() => inp.focus(), 50);
  }

  // ----- overworld: walk-in confirm -----
  // Walking into a gate asks before it commits you to a front: the panel
  // carries the level's blurb and the difficulty choice, and Enter takes the
  // same onStart path the setup screen's START button uses.
  showGateConfirm({ gate, diff = 'normal', onEnter, onLeave }) {
    let modal = this.root.querySelector('#gate-confirm');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'gate-confirm';
      modal.className = 'gateprompt hidden';
      this.root.appendChild(modal);
    }
    const cave = !!gate.cave;
    const character = this._sheetCharacter();
    const level = cave ? null : levelById(gate.levelId || 1);
    const guide = character ? firstHourGuidance(character, { online: !!this.cb.useAuthoritativeEconomy?.() }) : null;
    const loadout = character && Object.keys(legalEquipment(character)).length
      ? 'Loadout ready. Your equipped attributes and socket effects will be applied when the mission starts.'
      : 'No persistent gear equipped. You can still deploy, or return to Character Info for a field upgrade.';
    const diffSeg = cave ? '' : `
      <div class="steplabel field-label">Difficulty</div>
      <div class="diffseg gate-diff">${Object.entries(DIFFICULTY).map(([key, d]) =>
        `<button class="diffbtn${key === diff ? ' sel' : ''}" data-diff="${key}">${d.label}</button>`).join('')}</div>`;
    modal.innerHTML = `
      <div class="gatepromptcard">
        <span class="roomeyebrow">Mission · Solo deployment</span>
        <h2>${cave ? '🌀 Enter the Labyrinth?' : `⚔️ Enter ${gate.name}?`}</h2>
        <p>${cave
          ? 'A dark mouth in the crag. No colony, no army — one hero against the deep.'
          : gate.blurb}</p>
        ${cave ? '' : `<p class="gateboss">${gate.boss.icon} <b>${gate.boss.name}</b> leads the counterattack.</p>`}
        ${cave ? '' : `<div class="gate-loadout"><b>${loadout}</b><small>Optional mission rewards · ${missionRewardSummary(level)}</small>${guide?.step === 'mission' ? '<em>FIRST DEPLOYMENT READY</em>' : ''}</div>`}
        ${diffSeg}
        <div class="roomconfirmactions">
          <button class="tbtn" id="gate-back">CLOSE</button>
          <button class="tbtn danger" id="gate-go">${cave ? 'OPEN TRIALS' : 'ENTER MISSION'}</button>
        </div>
      </div>`;
    const close = () => modal.classList.add('hidden');
    modal.querySelector('#gate-back').onclick = () => { close(); onLeave && onLeave(); };
    let chosen = diff;
    for (const b of modal.querySelectorAll('.gate-diff .diffbtn')) {
      b.onclick = () => {
        chosen = b.dataset.diff;
        for (const o of modal.querySelectorAll('.gate-diff .diffbtn')) o.classList.toggle('sel', o === b);
      };
    }
    modal.querySelector('#gate-go').onclick = () => { close(); onEnter && onEnter(chosen); };
    modal.classList.remove('hidden');
  }

  setGateRally({ players = 1, maxPlayers = 4, role = 'solo', ready = false, canLaunch = false } = {}) {
    const modal = this.root.querySelector('#gate-confirm');
    const eyebrow = modal?.querySelector('.roomeyebrow');
    const go = modal?.querySelector('#gate-go');
    if (eyebrow) eyebrow.textContent = `Mission rally · ${players}/${maxPlayers} players`;
    if (!go) return;
    if (role === 'host') {
      go.textContent = canLaunch ? `LAUNCH PARTY (${players})` : `WAITING FOR PARTY (${players})`;
      go.disabled = !canLaunch;
    } else if (role === 'guest') {
      go.textContent = ready ? 'READY — WAITING FOR HOST' : 'MARK READY';
      go.disabled = ready;
    }
  }

  hideGatePrompt() {
    this.root.querySelector('#gate-confirm')?.classList.add('hidden');
  }

  _reflectQuality(q) {
    for (const b of this.root.querySelectorAll('#set-quality .diffbtn')) {
      b.classList.toggle('sel', b.dataset.q === q);
    }
    this.setQualityUI(q);
  }

  _loadHeroPortraits() {
    for (const img of this.root.querySelectorAll('#herorow img[data-src]')) {
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    }
  }

  showSetup({ coop = false, mode = 'campaign', online = null } = {}) {
    this._fromLobby = !!online || this._lobbyWasOpen();
    this.selectedMode = mode;
    this._showScreen('setup');
    const setupScreen = this.root.querySelector('#screen-setup');
    setupScreen.classList.toggle('roommode', !!online);
    setupScreen.classList.remove('room-host', 'room-guest');
    this._loadHeroPortraits();
    const title = online
      ? `🌐 ${online.visibility === 'private' ? 'Private' : 'Public'} game — code ${online.join_code}`
      : coop ? 'Co-op — one city, one hero each'
      : mode === 'survival' ? '💀 Survival — how high can you drive the Threat?'
      : mode === 'labyrinth' ? '🌀 The Labyrinth — no colony, no army, no way but through'
      : 'Choose your battle';
    this.root.querySelector('#s-title').textContent = title;
    const fieldLabel = setupScreen.querySelector('.field-label');
    const heroLabel = setupScreen.querySelector('.hero-label');
    const diffLabel = setupScreen.querySelector('.diff-label');
    if (fieldLabel) fieldLabel.innerHTML = online ? 'MAP &amp; MISSION <span id="warstatus" class="warstatus"></span>' : '1 · Battlefield <span id="warstatus" class="warstatus"></span>';
    if (heroLabel) heroLabel.innerHTML = online ? 'YOUR HERO <small>Choose the character kit you bring into this room.</small>' : '2 · Your hero <small>— move with WASD; in Fight mode dodge with <span data-bind-label="dodge"></span> and use the special with <span data-bind-label="ability1"></span></small>';
    if (diffLabel) diffLabel.textContent = online ? 'ROOM DIFFICULTY' : '3 · Difficulty';
    // Multiplayer setups choose the war mode here; solo modes chose it on the
    // Play Solo card, so the chips would be a second, contradictory entrance.
    this._renderModeSeg(mode, coop || !!online);
    this._buildLevelRow(this._campaignCleared || 0, mode !== 'campaign', mode);
    this.setStartButton({ text: this._startCopyFor(mode), disabled: false, title: '' });
    const mp = this.root.querySelector('#mp-panel');
    mp.classList.toggle('hidden', !coop && !online);
    if (online) {
      mp.dataset.init = '1';
      mp.innerHTML = `
        <div class="room-commandbar"><span><b>STAGING LOBBY</b><small>Seats, readiness, map rules, and chat are authoritative here.</small></span><strong>${online.visibility === 'private' ? '🔒 PRIVATE' : '🌐 PUBLIC'} · ${online.join_code}</strong></div>
        <div class="mprow"><span class="mpstatus ok" id="online-status">🟢 Live — waiting for players. Share code <b>${online.join_code}</b>.</span></div>
        <div id="room-roster" class="roomroster"></div>
        <button class="diffbtn roomready hidden" id="room-ready">READY FOR BATTLE</button>
        <button class="diffbtn hidden" id="room-reconnect">RECONNECT TO HOST</button>
        <div id="mp-sub"></div>
        <div class="roomchat">
          <div class="roomchatlog" id="roomchat-log"></div>
          <div class="roomchatrow">
            <input id="roomchat-input" maxlength="500" placeholder="Room chat…">
            <button class="tbtn" id="roomchat-send">Send</button>
          </div>
        </div>`;
      this.roomRoster(this._playersFromOnlineGame(online), {
        maxPlayers: online.max_players || 4,
        isHost: false,
        code: online.join_code,
        mode: online.mode || mode,
      });
      this._wireRoomChat();
      this._wireRoomReady();
      const reconnect = this.root.querySelector('#room-reconnect');
      if (reconnect) reconnect.onclick = () => this.cb.onRoomReconnect && this.cb.onRoomReconnect();
      return;
    }
    if (coop && !mp.dataset.init) {
      mp.dataset.init = '1';
      mp.innerHTML = `
        <div id="room-roster" class="roomroster hidden"></div>
        <div class="mprow">
          <button class="diffbtn" id="mp-host">🌐 Host — create invite</button>
          <button class="diffbtn" id="mp-join">🔗 Join — paste invite</button>
          <span class="mphint">No servers: trade invite codes over any chat. The host picks the level and presses START.</span>
        </div>
        <div id="mp-sub"></div>`;
      mp.querySelector('#mp-host').onclick = () => { this.mpStatus('Creating invite code…'); this.cb.onHost(); };
      mp.querySelector('#mp-join').onclick = () => this.mpShowJoinInput();
    }
  }

  _buildLevelRow(cleared, allUnlocked = false, mode = 'campaign') {
    this._campaignCleared = cleared;
    const row = this.root.querySelector('#levelrow');
    row.innerHTML = '';
    const labyrinth = mode === 'labyrinth';
    // The war, in one line: Earth first, then the stars — and every world you
    // have taken back stays taken. The labyrinth is its own descent.
    const status = this.root.querySelector('#warstatus');
    if (status) {
      const worlds = Math.max(0, cleared - LEVELS.length);
      status.textContent = labyrinth
        ? `🌀 ${LABYRINTH_LEVELS.length} trials, each deeper than the last`
        : cleared >= LEVELS.length
        ? `🌍 Earth retaken · ${worlds ? `${worlds} frontier world${worlds === 1 ? '' : 's'} liberated` : 'the galaxy awaits'}`
        : `🌍 The war for Earth: ${cleared}/${LEVELS.length} fronts won`;
    }
    // The authored war first; once it is won, the galaxy opens — every planet
    // you have cleared plus the next frontier world, without end. Labyrinth
    // trials are their own roster, all open from the start.
    let ids;
    if (labyrinth) {
      ids = LABYRINTH_LEVELS.map((l) => l.id);
      this.selectedLevel = ids[0];
    } else {
      this.selectedLevel = allUnlocked ? 1 : cleared + 1;
      ids = LEVELS.map((l) => l.id);
      if (allUnlocked || cleared >= LEVELS.length) {
        for (let id = LEVELS.length + 1; id <= Math.max(cleared + 1, LEVELS.length + 1); id++) ids.push(id);
      }
    }
    for (const id of ids) {
      const lv = levelById(id);
      const locked = allUnlocked ? false : lv.id > cleared + 1;
      const done = labyrinth ? !!(this._labyrinthClears || {})[lv.id] : lv.id <= cleared;
      // Landform and city plan are part of what a level IS — say so before
      // the player commits twenty minutes to it.
      const land = (TERRAIN_SHAPES[lv.theme.terrain] || {}).label || 'frontier';
      const plan = CITY_PLANS[lv.theme.city];
      const city = lv.labyrinth ? 'hero gauntlet — no colony' : plan ? plan.label : 'frontier city';
      const card = document.createElement('button');
      card.className = 'levelcard' + (lv.id === this.selectedLevel ? ' sel' : '')
        + (locked ? ' locked' : '') + (lv.galaxy ? ' galaxy' : '');
      card.dataset.level = lv.id;
      card.disabled = locked;
      card.innerHTML = `
        <canvas class="lvmap" width="80" height="80"></canvas>
        <span class="lvnum">${done ? '✅' : locked ? '🔒' : lv.galaxy ? '🌌' : lv.id}</span>
        <b>${lv.name}</b>
        <small>${lv.blurb}</small>
        <span class="lvland">🗺️ ${land} · 🏰 ${city}</span>
        <span class="lvboss">${lv.boss.icon} ${lv.boss.name}</span>`;
      if (!locked) {
        card.onclick = () => {
          this.selectedLevel = lv.id;
          for (const c of row.children) c.classList.toggle('sel', c === card);
          if (this.cb.onLevelPick) this.cb.onLevelPick(lv.id);
        };
        card.onmouseenter = (e) => this._showTip(e, `<b>${lv.boss.icon} ${lv.boss.name}</b><br><span class="tdesc">${lv.boss.desc}</span>`
          + (plan ? `<br><br><b>🏰 ${plan.label}</b><br><span class="tdesc">${plan.blurb}</span>` : ''));
        card.onmousemove = (e) => this._moveTip(e);
        card.onmouseleave = () => this._hideTip();
      }
      row.appendChild(card);
      this._queueLevelThumb(lv, card.querySelector('.lvmap'), locked);
    }
  }

  // The planet, drawn from its real terrain — the level select is a map of the
  // war, not a row of coloured buttons. Generation costs ~50ms per planet, so
  // thumbs render one per idle tick and cache by level id.
  _queueLevelThumb(lv, canvas, locked) {
    this._thumbCache = this._thumbCache || new Map();
    const cached = this._thumbCache.get(lv.id);
    if (cached) { canvas.getContext('2d').drawImage(cached, 0, 0); if (locked) this._dimThumb(canvas); return; }
    this._thumbQueue = this._thumbQueue || [];
    this._thumbQueue.push({ lv, canvas, locked });
    if (this._thumbTimer) return;
    const step = () => {
      const job = (this._thumbQueue || []).shift();
      if (!job) { this._thumbTimer = null; return; }
      if (job.canvas.isConnected) {
        try { this._drawLevelThumb(job.lv, job.canvas, job.locked); } catch { /* a thumb is decoration */ }
      }
      this._thumbTimer = setTimeout(step, 30);
    };
    this._thumbTimer = setTimeout(step, 10);
  }

  _drawLevelThumb(lv, canvas, locked) {
    const map = new TerrainField(lv.seed, lv.theme, { size: lv.size, nests: lv.nests });
    const N = map.size;
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const ctx = off.getContext('2d');
    const img = ctx.createImageData(off.width, off.height);
    const pal = lv.theme.palette;
    const colors = {
      0: pal.grass, 1: pal.forest, 2: pal.water, 3: pal.mountain,
      4: pal.sand, 5: pal.path, 6: 0xf3c53d, 7: 0xb8ccd8,
    };
    const sx = N / off.width, sz = N / off.height;
    for (let y = 0; y < off.height; y++) {
      for (let x = 0; x < off.width; x++) {
        const t = map.tiles[((y * sz) | 0) * N + ((x * sx) | 0)];
        const c = colors[t] ?? pal.grass;
        const o = (y * off.width + x) * 4;
        img.data[o] = (c >> 16) & 255; img.data[o + 1] = (c >> 8) & 255;
        img.data[o + 2] = c & 255; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // The stakes, marked: gold flags for city sites, red for hives.
    for (const s of map.sites) {
      ctx.fillStyle = '#ffd75e';
      ctx.fillRect(s.x / sx - 1.5, s.z / sz - 1.5, 3, 3);
    }
    ctx.fillStyle = '#ff4a3c';
    for (const [x, z] of map.nestSpots) ctx.fillRect(x / sx - 1.5, z / sz - 1.5, 3, 3);
    this._thumbCache.set(lv.id, off);
    canvas.getContext('2d').drawImage(off, 0, 0);
    if (locked) this._dimThumb(canvas);
  }

  _dimThumb(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(8,10,14,0.62)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  setCampaign(cleared) { this._buildLevelRow(cleared || 0); }

  _heroTip(h) {
    const a = h.ability;
    const au = h.aura;
    const passives = (h.passives || [])
      .map((p) => `<span class="tfx">${p.icon} <b>${p.name}</b> — passive upgrade</span><br><span class="tdesc">${p.desc}</span>`)
      .join('<br>');
    return `<b>${h.icon} ${h.name}</b><br><span class="tdesc">${h.tagline}</span><br>` +
      (au ? `<span class="tfx">${au.icon} <b>${au.name}</b> — passive aura</span><br><span class="tdesc">${au.desc}</span><br>` : '') +
      (passives ? `${passives}<br>` : '') +
      `<span class="tfx">${a.icon} <b>${a.name}</b> — ${this._keyLabel('ability1')}, ${a.cd}s cooldown</span><br><span class="tdesc">${a.desc}</span>` +
      `<br><span class="tdesc">Level-ups grant upgrade points for Aura, Passive I, Passive II, or Ult Damage.</span>`;
  }

  // ---------- in-game HUD ----------

  initHUD(game, p, character = null) {
    this.msgSeen = 0;
    this.root.querySelector('#topbar').classList.remove('hidden');
    this.root.querySelector('#actionbar').classList.remove('hidden');
    this.root.querySelector('#minimap-wrap').classList.remove('hidden');
    for (const chip of this.root.querySelectorAll('#stancebar .stance')) {
      chip.onclick = () => this.cb.onStance && this.cb.onStance(chip.dataset.st);
    }
    const mode = this.root.querySelector('#mode-toggle');
    if (mode) mode.onclick = () => this.cb.onControlMode && this.cb.onControlMode();
    const h = game.heroes[p];
    const d = h.def;
    const kit = this.root.querySelector('#fight-kit');
    if (kit) {
      const entries = [
        d.aura ? { kind: 'AURA', icon: d.aura.icon, name: d.aura.name, desc: d.aura.desc } : null,
        ...(d.passives || []).map((passive, index) => ({
          kind: `PASSIVE ${index + 1}`, icon: passive.icon, name: passive.name, desc: passive.desc,
        })),
        { kind: this._keyLabel('ability1'), icon: d.ability.icon, name: d.ability.name, desc: d.ability.desc, active: true },
      ].filter(Boolean);
      kit.innerHTML = entries.map((entry) => `<div class="fight-ability${entry.active ? ' active' : ''}" title="${escapeHtml(entry.desc || '')}">
        <span>${entry.icon}</span><b>${escapeHtml(entry.name)}</b><small>${entry.kind}</small>
      </div>`).join('');
    }
    const face = this.root.querySelector('#a-face');
    const klass = character ? MMO_CLASSES[character.classKey] : null;
    face.innerHTML = character ? klass.icon : PORTRAITS[d.key] ? `<img src="${PORTRAITS[d.key]}" loading="lazy" decoding="async" onerror="this.parentElement.textContent='${d.icon}'" alt="">` : d.icon;
    this.root.querySelector('#a-name').textContent = character ? `${character.name} · ${klass.name}` : d.name;
    const big = this.root.querySelector('#bigaction');
    big.onclick = () => {
      if (this._bigMode === 'found') this.cb.onFound && this.cb.onFound();
      else if (this._bigMode === 'cast') this.cb.onCast();
    };
    big.onpointerdown = (e) => {
      if (this._bigMode !== 'build') return;
      e.preventDefault();
      this.cb.onBuildHold && this.cb.onBuildHold(true);
      try { big.setPointerCapture(e.pointerId); } catch {}
    };
    big.onpointerup = () => this.cb.onBuildHold && this.cb.onBuildHold(false);
    big.onpointercancel = () => this.cb.onBuildHold && this.cb.onBuildHold(false);
    big.onpointerleave = () => this.cb.onBuildHold && this.cb.onBuildHold(false);
    big.onmouseenter = (e) => {
      const hh = this._game ? this._game.heroes[this._p] : null;
      if (hh) this._showTip(e, this._heroTip(hh.def));
    };
    big.onmousemove = (e) => this._moveTip(e);
    big.onmouseleave = () => this._hideTip();
    this._game = game;
    this._p = p;
  }

  setControlMode(mode = 'build') {
    const chip = this.root.querySelector('#mode-toggle');
    if (!chip) return;
    const fighting = mode === 'fight';
    chip.classList.toggle('fight', fighting);
    chip.classList.toggle('build', !fighting);
    const label = chip.querySelector('span');
    if (label) label.textContent = fighting ? 'Fight mode' : 'Build mode';
    this.root.querySelector('#fight-kit')?.classList.toggle('hidden', !fighting);
    this.root.querySelector('#herostats')?.classList.toggle('hidden', fighting);
    chip.title = fighting
      ? `${this._keyLabel('build_mode')} switches to Build mode. ${this._keyLabel('dodge')} dodges; ${this._keyLabel('ability1')} uses the special.`
      : `${this._keyLabel('build_mode')} switches to Fight mode. Hold ${this._keyLabel('dodge')} or ${this._keyLabel('build')} to build.`;
  }

  update(game, p = 0, controls = {}) {
    const q = (id) => this.root.querySelector(id);
    const controlMode = controls.controlMode || 'build';
    this.setControlMode(controlMode);
    q('#r-gold').innerHTML = `🪙 <b>${Math.floor(game.gold)}</b>`;

    // Threat: the clock that replaced nightfall. The bar inside the chip fills
    // toward the next surge, so "something is coming" is always legible.
    const labyrinth = game.mode === 'labyrinth';
    const held = game.heldNodes ? game.heldNodes() : 0;
    const nests = game.liveNests ? game.liveNests() : 0;
    const frac = Math.max(0, Math.min(1, (game.threat || 0) % 1));
    q('#r-day').innerHTML = game.phase === 'found'
      ? '🏳️ <b>Claim your ground</b>'
      : game.finalStand
        ? labyrinth ? '👑 <b>The champion walks</b>' : '☠️ <b>Final counterattack</b>'
        : labyrinth
          ? `${['🕯️ <b>Quiet</b>', '👣 <b>Something follows</b>', '☠️ <b>The pursuit</b>', '🚨 <b>The flood</b>'][game.pursuitStage || 0]}<i class="threatbar" style="--f:${Math.min(100, ((game.pursuitTime || 0) / 360) * 100).toFixed(0)}%"></i>`
          : `☠️ <b>Threat ${game.threatLevel}</b><i class="threatbar" style="--f:${(frac * 100).toFixed(0)}%"></i>`;
    q('#r-day').classList.toggle('danger', !!game.finalStand || frac > 0.85);
    // In the labyrinth the front is chambers and lives, not nodes and camps.
    if (labyrinth) {
      const chambers = game.nests.filter((n) => !n.offMap).length;
      q('#r-front').innerHTML = `🌀 <b>${chambers - nests}</b>/${chambers} · ❤️ <b>${game.lives}</b>`;
      q('#r-front').title = 'Brood chambers razed · shared lives left';
      q('#r-front').classList.toggle('danger', game.lives === 0);
    } else {
      const total = game.activeNodes ? game.activeNodes().length : game.nodes.length;
      q('#r-front').innerHTML = `🚩 <b>${held}</b>/${total} · 🔥 <b>${nests}</b>`;
      q('#r-front').classList.toggle('danger', held === 0 && game.phase !== 'found');
    }

    // Active army stance chip — hidden in the labyrinth: there is no army,
    // and nothing to build means the ALT mode toggle is noise too.
    q('#stancebar').classList.toggle('hidden', labyrinth);
    q('#mode-toggle').classList.toggle('hidden', labyrinth);
    this.showBlessings(game, p);
    if (this._stance !== game.stance) {
      this._stance = game.stance;
      for (const chip of this.root.querySelectorAll('#stancebar .stance')) {
        chip.classList.toggle('sel', chip.dataset.st === game.stance);
      }
    }
    if (labyrinth) {
      const active = game.labyrinthEncounters?.find((e) => e.status === 'active');
      const def = active && game.map.labyrinthLayout?.encounters?.find((e) => e.key === active.key);
      const room = def && game.map.labyrinthLayout?.rooms?.[def.room];
      q('#army-status').innerHTML = active && room
        ? `⚔️ <b>${room.label}</b> · wave ${Math.max(1, active.wave)}/${def.waves} · doors sealed during combat`
        : game.lives > 0
          ? `❤️ <b>${game.lives}</b> ${game.lives === 1 ? 'life' : 'lives'} · choose a marked route and reach the Sunless Throne`
          : '❤️ <b>No lives left</b> — the next fall is final.';
    } else {
      const firstSiege = game.firstSiegeStatus?.();
      const army = game.units.filter((u) => !u.hero && !u.dead).length;
      const squads = new Set(game.units.filter((u) => !u.hero && !u.dead && u.squadId).map((u) => u.squadId)).size;
      const stanceText = {
        defend: 'holding the city line',
        guard: 'following your hero',
        attack: 'pushing the lanes',
      }[game.stance] || 'awaiting orders';
      q('#army-status').innerHTML = firstSiege
        ? `<b>${firstSiege.title}</b> · ${firstSiege.detail}`
        : army
        ? `<b>${army}</b> troops in <b>${squads || army}</b> formations · ${stanceText} · camps keep mustering`
        : 'Build militia, ranger, or sniper camps — they muster squads forever.';
    }
    q('#r-z').innerHTML = `🧟 ${game.zombies.length}`;
    const alert = combatAlert(game, p);
    const alertBox = q('#combat-alert');
    const alertKey = alert?.key || '';
    if (alertKey !== this._combatAlertKey) {
      this._combatAlertKey = alertKey;
      if (alert) {
        alertBox.className = `combat-alert ${alert.tone}`;
        alertBox.innerHTML = `<span>${alert.icon}</span><div><b>${alert.title}</b><small>${alert.detail}</small></div>`;
      } else {
        alertBox.className = 'combat-alert hidden';
        alertBox.textContent = '';
      }
    }

    // Hero plate.
    const h = game.heroes[p];
    if (h) {
      q('#a-lvl').textContent = h.dead ? `☠️ ${Math.ceil(h.reviveT)}s` : `Lv ${h.level}`;
      q('#a-hp').style.width = `${Math.max(0, (h.hp / h.maxHp) * 100)}%`;
      q('#a-hp').parentElement.classList.toggle('critical', !h.dead && h.hp / h.maxHp <= 0.25);
      const need = xpForLevel(h.level);
      q('#a-xp').style.width = h.level >= HERO_MAX_LEVEL ? '100%' : `${(h.xp / need) * 100}%`;

      // Item row: the gear this hero carries through the campaign.
      const itemsKey = (h.items || []).join(',');
      if (this._itemsKey !== itemsKey) {
        this._itemsKey = itemsKey;
        q('#a-items').innerHTML = (h.items || [])
          .map((k) => { const it = itemInfo(k); return it ? `<span class="hitem" title="${it.name} — ${it.desc || itemLines(it).join(', ')}">${it.icon}</span>` : ''; })
          .join('');
      }

      // Pack: what this hero has picked up off the field, and how much room is
      // left. Walking over loot fills it; G empties the newest slot.
      const packKey = (h.pack || []).join(',');
      if (this._packKey !== packKey) {
        this._packKey = packKey;
        const slots = [];
        for (let i = 0; i < PACK_SLOTS; i++) {
          const key = (h.pack || [])[i];
          const it = key ? itemInfo(key) : null;
          slots.push(it
            ? `<span class="pslot has" title="${it.name} — ${it.desc}">${it.icon}</span>`
            : '<span class="pslot"></span>');
        }
        const full = (h.pack || []).length >= PACK_SLOTS;
        q('#a-pack').innerHTML = slots.join('')
          + `<span class="pkey${full ? ' urgent' : ''}">${full ? 'FULL · G drops' : 'G drops'}</span>`;
      }

      const stats = game.heroStats ? game.heroStats(h) : null;
      if (stats) {
        q('#herostats').innerHTML = `
          <span><b>${Math.round(stats.damage)}</b><small>DMG</small></span>
          <span><b>${stats.rate.toFixed(1)}</b><small>APS</small></span>
          <span><b>${stats.range.toFixed(1)}</b><small>RNG</small></span>
          <span><b>${stats.speed.toFixed(1)}</b><small>SPD</small></span>
          <span><b>${stats.regen.toFixed(1)}</b><small>REG</small></span>
          <span class="aurastat"><b>${stats.auraRadius.toFixed(1)}</b><small>AURA</small></span>
          <em>${h.def.aura.icon} ${stats.auraAllies} ally · ${stats.auraEnemies} enemy affected</em>`;
      }

      this._updateUpgradePanel(game, h);

      // The one big contextual button: found the city, build in Build mode, or cast.
      const big = q('#bigaction');
      const ab = h.def.ability;
      if (game.phase === 'found') {
        this._bigMode = 'found';
        const near = game.map.sites.some((s) => (h.x - s.x) ** 2 + (h.z - s.z) ** 2 < 64);
        big.className = 'bigaction bell';
        big.innerHTML = `<span class="bicon">🏳️</span><span class="btext">${near ? 'Found the city HERE' : 'Ride to a flagged site…'}<small>${this._keyLabel('build')}</small></span>`;
        big.disabled = !near || h.dead;
      } else if (controlMode === 'build' && game.buildTargetFor) {
        const target = game.buildTargetFor(h);
        if (target) {
          const { plot, act, nt } = target;
          const paid = act.mode === 'repair' ? 0 : plot.paid;
          const cost = Math.max(1, Math.ceil(act.cost - paid));
          const verb = act.mode === 'repair' ? 'Repair' : act.mode === 'rebuild' ? 'Rebuild' : plot.tier > 0 ? 'Upgrade' : 'Build';
          const name = act.mode === 'repair' ? PLOT_KINDS[plot.kind].name : (act.def || nt.def).name;
          this._bigMode = 'build';
          big.className = 'bigaction build ready';
          big.innerHTML = `<span class="bicon">🏗️</span><span class="btext">${verb} ${name}<small>Hold ${this._keyLabel('dodge')} or ${this._keyLabel('build')} · ${cost}🪙 · ${this._keyLabel('build_mode')} Fight</small></span>`;
          big.disabled = h.dead;
        } else {
          this._bigMode = 'idle';
          big.className = 'bigaction build';
          big.innerHTML = `<span class="bicon">🏗️</span><span class="btext">Build mode<small>Ride to a plot · hold ${this._keyLabel('dodge')} · ${this._keyLabel('build_mode')} Fight</small></span>`;
          big.disabled = true;
        }
      } else {
        this._bigMode = 'cast';
        const cd = Math.max(0, h.abilCd);
        const rank = abilityRank(h.level, h.upgrades);
        const ultRank = (h.upgrades?.ult || 0);
        big.className = 'bigaction cast' + (cd > 0 || h.dead ? ' cooling' : ' ready');
        big.innerHTML = `<span class="bicon">${ab.icon}</span><span class="btext">${ab.name} <small>${'●'.repeat(rank)}${'○'.repeat(3 - rank)} · ULT ${ultRank}/3 · ${this._keyLabel('ability1')}${controlMode === 'fight' ? ` · ${this._keyLabel('build_mode')} show construction` : ''}</small></span>` +
          (cd > 0 ? `<span class="bcd">${Math.ceil(cd)}</span>` : '');
        big.disabled = h.dead;
      }
    }

    // Messages feed.
    const feed = q('#messages');
    for (const m of game.messages) {
      const seq = m.seq ?? 0;
      if (seq < this.msgSeen) continue;
      this.msgSeen = seq + 1;
      const div = document.createElement('div');
      div.className = 'msg ' + m.kind;
      div.textContent = m.text;
      feed.appendChild(div);
      while (feed.children.length > 5) feed.removeChild(feed.firstChild);
      setTimeout(() => { div.classList.add('fade'); }, 6000);
      setTimeout(() => { div.remove(); }, 7000);
      if (m.kind === 'bad') this.showBanner(m.text, 'bad');
    }
  }

  _updateUpgradePanel(game, h) {
    const panel = this.root.querySelector('#upgradepanel');
    if (!panel || !game.heroUpgradeChoices) return;
    const choices = game.heroUpgradeChoices(h);
    const points = h.skillPoints || 0;
    const key = `${h.id}:${points}:${choices.map((c) => `${c.key}${c.rank}`).join('|')}`;
    panel.classList.toggle('hidden', points <= 0);
    if (points <= 0) {
      this._upgradePanelKey = key;
      return;
    }
    if (this._upgradePanelKey === key) return;
    this._upgradePanelKey = key;
    panel.innerHTML = `<div class="uphead"><b>${points}</b> upgrade point${points === 1 ? '' : 's'} available</div><div class="uprow"></div>`;
    const row = panel.querySelector('.uprow');
    for (const choice of choices) {
      const button = document.createElement('button');
      const capped = choice.rank >= choice.max;
      button.className = 'upbtn' + (capped ? ' capped' : '');
      button.disabled = capped;
      button.innerHTML = `
        <span class="upicon">${choice.icon}</span>
        <b>${choice.name}</b>
        <small>${choice.desc}</small>
        <span class="uppips">${'●'.repeat(choice.rank)}${'○'.repeat(choice.max - choice.rank)}</span>`;
      button.onclick = () => this.cb.onHeroUpgrade && this.cb.onHeroUpgrade(choice.key);
      row.appendChild(button);
    }
  }

  // Contextual "hold B" prompt while standing on a fundable foundation.
  showBuildHint(html) {
    const el = this.root.querySelector('#buildhint');
    if (!html) {
      if (!el.classList.contains('hidden')) el.classList.add('hidden');
      this._buildHint = null;
      return;
    }
    if (this._buildHint !== html) {
      this._buildHint = html;
      el.innerHTML = html;
    }
    el.classList.remove('hidden');
  }

  // Branch doctrine picker, shown while standing at a branch-ready plot.
  showBranch(info) {
    const panel = this.root.querySelector('#branchpanel');
    if (!info) {
      if (!panel.classList.contains('hidden')) panel.classList.add('hidden');
      this._branchId = null;
      return;
    }
    if (this._branchId === info.plot.id) return;
    this._branchId = info.plot.id;
    panel.classList.remove('hidden');
    panel.innerHTML = `<div class="branchtitle">${info.plot.kind === 'wall' ? "Choose this barrier's final form:" : 'Choose a doctrine for this tower:'}</div>`;
    const row = document.createElement('div');
    row.className = 'branchrow';
    for (const [key, opt] of Object.entries(info.options)) {
      const b = document.createElement('button');
      b.className = 'branchbtn';
      b.innerHTML = `<span class="bicon">${opt.icon}</span><b>${opt.name}</b><small>${opt.blurb}</small><span class="tcost">🪙${opt.cost}</span>`;
      b.onclick = () => this.cb.onBranch(info.plot.id, key);
      row.appendChild(b);
    }
    panel.appendChild(row);
  }

  // Labyrinth blessing picker: pick 1 of 3 while the run keeps moving — the
  // labyrinth does not pause for you. Rebuilt only when the offer changes.
  showBlessings(game, p = 0) {
    const panel = this.root.querySelector('#blessingpanel');
    const offer = game.mode === 'labyrinth' ? game.blessingOffers?.[p] : null;
    if (!offer) {
      if (!panel.classList.contains('hidden')) panel.classList.add('hidden');
      this._blessKey = null;
      return;
    }
    const key = offer.join(',');
    if (this._blessKey === key) return;
    this._blessKey = key;
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="blesstitle">✨ The chamber offers a blessing — choose one:</div>';
    const row = document.createElement('div');
    row.className = 'branchrow';
    offer.forEach((k, i) => {
      const it = itemInfo(k);
      if (!it) return;
      const b = document.createElement('button');
      b.className = 'branchbtn blessbtn';
      b.innerHTML = `<span class="bicon">${it.icon}</span><b>${it.name}</b><small>${it.desc}</small>`;
      b.onclick = () => this.cb.onBlessing && this.cb.onBlessing(i);
      row.appendChild(b);
    });
    panel.appendChild(row);
  }

  updateBoss(game) {
    const bar = this.root.querySelector('#bossbar');
    const zb = game.boss;
    if (!zb || zb.dead) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const B = zb.cfg || game.level.boss;
    this.root.querySelector('#boss-name').textContent = `${B.icon} ${B.name}${zb.enraged ? ' — ENRAGED' : ''}`;
    this.root.querySelector('#boss-fill').style.width = `${Math.max(0, (zb.hp / zb.maxHp) * 100)}%`;
  }

  // ---------- tooltips / banners / small UI ----------

  _showTip(e, html) {
    this.tooltip.innerHTML = html;
    this.tooltip.classList.remove('hidden');
    this._moveTip(e);
  }
  _moveTip(e) {
    const t = this.tooltip;
    const w = t.offsetWidth, winW = window.innerWidth;
    let x = e.clientX - w / 2;
    x = Math.max(8, Math.min(winW - w - 8, x));
    t.style.left = x + 'px';
    t.style.bottom = (window.innerHeight - e.clientY + 18) + 'px';
    t.style.top = 'auto';
  }
  _hideTip() { this.tooltip.classList.add('hidden'); }

  showBanner(text, cls = '', dur = 3500) {
    this.banner.textContent = text;
    this.banner.className = 'show ' + cls;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { this.banner.className = ''; }, dur);
  }

  showLocationBanner(title, detail, dur = 5600) {
    this.banner.textContent = '';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'banner-eyebrow';
    eyebrow.textContent = 'FRONTIER SITE';
    const heading = document.createElement('strong');
    heading.className = 'banner-title';
    heading.textContent = title;
    const description = document.createElement('span');
    description.className = 'banner-detail';
    description.textContent = detail;
    this.banner.append(eyebrow, heading, description);
    this.banner.className = 'show location';
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { this.banner.className = ''; }, dur);
  }

  setSpeedUI(speed, paused) {
    this.root.querySelector('#b-pause').textContent = paused ? '▶' : '⏸';
    this.root.querySelector('#b-pause').classList.toggle('active', paused);
    for (const b of this.root.querySelectorAll('.speed')) {
      b.classList.toggle('active', !paused && +b.dataset.s === speed);
    }
  }

  setMuteUI(m) { this.root.querySelector('#b-mute').textContent = m ? '🔇' : '🔊'; }

  // Sync the settings controls to persisted values (startup restore).
  setSettingsUI(s = {}) {
    if (s.volume !== undefined) {
      const v = Math.round(s.volume * 100);
      this.root.querySelector('#set-vol').value = v;
      this.root.querySelector('#set-vol-val').textContent = v + '%';
    }
    if (s.music !== undefined) {
      const v = Math.round(s.music * 100);
      this.root.querySelector('#set-music').value = v;
      this.root.querySelector('#set-music-val').textContent = v + '%';
    }
    if (s.sfx !== undefined) {
      this.root.querySelector('#set-sfx').checked = !!s.sfx;
      this.root.querySelector('#set-sfx-val').textContent = s.sfx ? 'ON' : 'OFF';
    }
    if (s.quality !== undefined) this._reflectQuality(s.quality);
  }

  setQualityUI(quality) {
    const button = this.root.querySelector('#b-quality');
    if (!button) return;
    const high = quality === 'high';
    button.textContent = high ? '✨' : '◐';
    button.title = high ? 'Graphics: high (outlines, high-threshold bloom, SMAA)' : 'Graphics: low (direct rendering, best for co-op or older laptops)';
    button.classList.toggle('active', high);
  }

  setAccount(state = {}) {
    const status = this.root.querySelector('#account-status');
    const google = this.root.querySelector('#a-google');
    const emailForm = this.root.querySelector('#a-email-form');
    const loginDivider = this.root.querySelector('#a-login-divider');
    const offline = this.root.querySelector('#a-offline');
    const usernameForm = this.root.querySelector('#a-username-form');
    const usernameInput = this.root.querySelector('#a-username');
    const needsUsername = !!state.signedIn && !!state.needsUsername;
    const offlineAllowed = !state.enabled && state.reason === 'static';
    if (status) {
      if (!state.ready) status.textContent = 'Checking account…';
      else if (needsUsername) status.textContent = state.error || 'Choose a username for this Zillions account.';
      else if (state.signedIn) status.textContent = `Signed in as @${state.username || state.name || 'Commander'}.`;
      else if (offlineAllowed) status.textContent = 'Static dev build. Continue offline to test locally.';
      else if (!state.enabled) status.textContent = state.error || 'Cloud sign-in is unavailable. Check the deployment auth config.';
      else status.textContent = state.error || 'Use your Zillions account to play.';
    }
    if (google) google.classList.toggle('hidden', !state.enabled || !!state.signedIn);
    if (emailForm) emailForm.classList.toggle('hidden', !state.enabled || !!state.signedIn || needsUsername);
    if (loginDivider) loginDivider.classList.toggle('hidden', !state.enabled || !!state.signedIn || needsUsername);
    if (offline) offline.classList.toggle('hidden', !offlineAllowed || !!state.signedIn);
    if (usernameForm) usernameForm.classList.toggle('hidden', !needsUsername);
    if (needsUsername) {
      this._accountAccepted = false;
      this._showScreen('account');
      setTimeout(() => usernameInput && usernameInput.focus(), 0);
      return;
    }
    if (state.ready && (state.signedIn || (offlineAllowed && this._offlineAccepted))) {
      if (this._offlineAccepted && !this._accountAccepted) {
        this._accountAccepted = true;
        this._showScreen('main');
      } else if (!this._accountAccepted) this._showScreen('account');
      return;
    }
    this._accountAccepted = false;
    this._showScreen('account');
  }

  setProfile(p) {
    this._profile = p;
    this._labyrinthClears = p.labyrinthClears || {};
    const nameEl = this.root.querySelector('#prof-name-display');
    const publicName = p.username || p.name || 'Commander';
    if (nameEl) nameEl.textContent = `🪖 @${publicName}`;
    const st = this.root.querySelector('#prof-stats');
    if (st) {
      st.textContent = p.games
        ? `${p.wins}W / ${p.games - p.wins}L · ${p.kills.toLocaleString()} kills · ⬡ ${(p.metaCurrency || 0).toLocaleString()} Alloy · best: Threat ${p.bestDay}`
        : 'first deployment';
    }
    this.refreshHeroBadges(p);
    this._buildCharacterSelect();
  }

  // WC3-style campaign persistence, shown right on the hero cards.
  refreshHeroBadges(p) {
    for (const card of this.root.querySelectorAll('.herocard')) {
      const ch = (p.campaignHeroes || {})[card.dataset.key];
      let badge = card.querySelector('.hpersist');
      if (!ch || (ch.level <= 1 && !(ch.items || []).length)) { if (badge) badge.remove(); continue; }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'hpersist';
        card.appendChild(badge);
      }
      const items = ch.items || [];
      badge.textContent = `⭐ Lv ${ch.level}${items.length ? ` · ${items.length} item${items.length > 1 ? 's' : ''}` : ''}`;
      badge.title = items.map((k) => { const it = itemInfo(k); return it ? `${it.icon} ${it.name}` : k; }).join('\n');
    }
  }

  preselectHero(key) {
    const card = this.root.querySelector(`.herocard[data-key=${key}]`);
    if (!card) return;
    this.selectedHero = key;
    for (const c of this.root.querySelectorAll('.herocard')) c.classList.toggle('sel', c === card);
    this._renderSelectedCharacter();
  }

  setContinue(snap) {
    for (const row of this.root.querySelectorAll('.moderesume')) row.innerHTML = '';
    if (!snap) return;
    const mode = snap.mode === 'survival' ? 'survival' : snap.mode === 'labyrinth' ? 'labyrinth' : 'campaign';
    const row = this.root.querySelector(`#solo-${mode}-resume`);
    if (!row) return;
    const players = Array.isArray(snap.heroKeys) ? snap.heroKeys.length : 1;
    // Snapshots store the level id under `level`.
    const levelId = snap.level ?? snap.levelId ?? 1;
    const label = mode === 'survival' ? 'Resume survival run'
      : mode === 'labyrinth' ? `Resume ${levelById(levelId).name}`
      : `Resume Level ${levelId}`;
    const detail = `Threat ${snap.threatLevel || 1} · ${snap.diff || 'normal'}${players > 1 ? ` · ${players} players` : ''}`;
    row.innerHTML = `<button class="resumebtn" id="b-continue"><span>▶</span><span><b>${label}</b><small>${detail}</small></span></button>`;
    row.querySelector('#b-continue').onclick = () => this.cb.onContinue();
  }

  setWaiting(on, text = '⏳ Syncing co-op…') {
    const el = this.root.querySelector('#waitind');
    if (!el) return;
    if (text && el.textContent !== text) el.textContent = text;
    el.classList.toggle('hidden', !on);
  }

  setNetworkDiagnostics(diag = null) {
    const el = this.root.querySelector('#netdiag');
    if (!el) return;
    if (!diag) { el.classList.add('hidden'); return; }
    const fps = diag.frameMs > 0 ? Math.round(1000 / diag.frameMs) : 0;
    const networkBad = diag.stalled || diag.jitterMs > 80 || diag.rttMs > 350;
    const deviceBad = diag.frameMs > 55;
    el.className = `netdiag ${networkBad || deviceBad ? 'bad' : diag.jitterMs > 35 || diag.rttMs > 180 ? 'warn' : 'good'}`;
    el.textContent = deviceBad
      ? `⚠ Device ${fps} FPS`
      : `${networkBad ? '⚠' : '●'} ${diag.route || 'peer'} ${diag.rttMs || 0}ms · J${diag.jitterMs || 0} · B${diag.buffered || 0}/${diag.target || 0}`;
  }

  // ---------- co-op lobby ----------

  _mpPanel() {
    const p = this.root.querySelector('#mp-sub');
    return p;
  }

  mpStatus(text) {
    const p = this._mpPanel();
    let st = p.querySelector('.mpstatus');
    if (!st) { st = document.createElement('div'); st.className = 'mpstatus'; p.prepend(st); }
    st.textContent = text;
  }

  mpShowHost(code, existingPeers = 0) {
    const p = this._mpPanel();
    p.innerHTML = `
      <div class="mpstatus">${existingPeers ? `🟢 ${existingPeers + 1} players in the lobby. ` : ''}Send this invite code to player ${existingPeers + 2}, then paste their reply below.</div>
      <textarea class="mpcode" readonly id="mp-offer">${code}</textarea>
      <button class="tbtn" id="mp-copy">📋 Copy invite</button>
      <textarea class="mpcode" id="mp-reply" placeholder="Paste their reply code here…"></textarea>
      <button class="diffbtn sel" id="mp-accept">Connect player ${existingPeers + 2}</button>`;
    p.querySelector('#mp-copy').onclick = () => {
      p.querySelector('#mp-offer').select();
      document.execCommand('copy');
      navigator.clipboard && navigator.clipboard.writeText(code).catch(() => {});
    };
    p.querySelector('#mp-accept').onclick = () => this.cb.onHostAccept(p.querySelector('#mp-reply').value);
  }

  mpLobby(peerCount, canAddMore, players = null, options = {}) {
    const p = this._mpPanel();
    p.innerHTML = `
      <div class="mpstatus ok">🟢 ${peerCount + 1} players connected. Pick hero & level, then press START to launch for everyone.</div>
      ${canAddMore ? '<button class="diffbtn" id="mp-add">➕ Invite a third player</button>' : ''}`;
    this.roomRoster(players || [
      { seat: 1, name: 'Host', host: true, hero: this.selectedHero, state: 'connected' },
      ...Array.from({ length: peerCount }, (_, i) => ({ seat: i + 2, name: `Player ${i + 2}`, hero: null, state: 'connected' })),
    ], { isHost: true, ...options });
    this.setStartButton({
      text: `▶  START ROOM — LAUNCH ${peerCount + 1} PLAYER${peerCount ? 'S' : ''}`,
      disabled: false,
      title: 'The host launches the match for everyone in the room.',
    });
    const add = p.querySelector('#mp-add');
    if (add) add.onclick = () => this.cb.onAddPeer();
  }

  mpShowJoinInput() {
    const p = this._mpPanel();
    p.innerHTML = `
      <div class="mpstatus">Paste the invite code from the host.</div>
      <textarea class="mpcode" id="mp-invite" placeholder="Paste invite code here…"></textarea>
      <button class="diffbtn sel" id="mp-go">Join</button>`;
    p.querySelector('#mp-go').onclick = () => this.cb.onJoin(p.querySelector('#mp-invite').value);
  }

  mpShowReply(code) {
    const p = this._mpPanel();
    p.innerHTML = `
      <div class="mpstatus">Send this reply code back to the host. The game starts when the host launches — pick your hero while you wait!</div>
      <textarea class="mpcode" readonly id="mp-reply-out">${code}</textarea>
      <button class="tbtn" id="mp-copy2">📋 Copy reply</button>`;
    p.querySelector('#mp-copy2').onclick = () => {
      p.querySelector('#mp-reply-out').select();
      document.execCommand('copy');
      navigator.clipboard && navigator.clipboard.writeText(code).catch(() => {});
    };
  }

  mpConnected(isHost, playerNum = 2, players = null) {
    const p = this._mpPanel();
    p.innerHTML = `<div class="mpstatus ok">🟢 Connected — you are player ${playerNum}. Pick your hero; the host starts the game.</div>`;
    this.roomRoster(players || [
      { seat: 1, name: 'Host', host: true, state: 'connected' },
      { seat: playerNum, name: 'You', you: true, hero: this.selectedHero, state: 'connected' },
    ], { isHost });
    if (!isHost) {
      this.setStartButton({
        text: '⏳  WAITING FOR HOST TO START',
        disabled: true,
        title: 'Only the host can launch this room.',
      });
    }
  }

  _heroName(hero) {
    const key = typeof hero === 'string' ? hero : hero?.k;
    return HEROES[key]?.name || 'Choosing hero';
  }

  _playersFromOnlineGame(game) {
    const rows = [...(game?._players || [])].sort((a, b) => Number(a.seat || 99) - Number(b.seat || 99));
    return rows.map((p, i) => ({
      seat: Number(p.seat || i + 1),
      name: p.display_name || 'Commander',
      hero: p.hero,
      host: p.user_id === game.host_id,
      state: p.connection_state || 'online',
      ready: !!p.ready,
    }));
  }

  roomRoster(players = [], {
    maxPlayers = 4,
    isHost = false,
    code = '',
    mode = 'campaign',
    level = 1,
    difficulty = 'normal',
    launchText = '',
  } = {}) {
    const box = this.root.querySelector('#room-roster');
    if (!box) return;
    box.classList.remove('hidden');
    const bySeat = new Map();
    for (const p of players) {
      const seat = Math.max(1, Math.min(maxPlayers, Number(p.seat || bySeat.size + 1)));
      if (!bySeat.has(seat)) bySeat.set(seat, p);
    }
    const filled = [...bySeat.values()].filter((p) => p && !p.open).length;
    const launchCopy = launchText || (isHost
      ? 'Use the gold START button below to launch this room for everyone.'
      : 'Pick your hero here. The host starts the match when the room is ready.');
    const modeCopy = mode === 'survival' ? 'Survival' : mode === 'labyrinth' ? 'Labyrinth' : 'Campaign';
    const levelDef = levelById(level || 1);
    const difficultyDef = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    const host = players.find((p) => p.host);
    const self = players.find((p) => p.you);
    const hostHero = HEROES[typeof host?.hero === 'object' ? host.hero.k : host?.hero];
    const safeCode = String(code || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
    const slots = [];
    for (let seat = 1; seat <= maxPlayers; seat++) {
      const p = bySeat.get(seat);
      if (p) {
        const label = p.host ? 'HOST' : `P${seat}`;
        const hero = this._heroName(p.hero);
        const state = p.state === 'connected' ? (p.ready ? 'ready · connected' : 'connected')
          : p.state === 'reconnecting' ? 'reconnecting'
          : p.state === 'offline' ? 'offline'
          : p.state === 'disconnected' ? 'disconnected'
          : 'connecting';
        const unlock = mode === 'campaign' && Number(p.unlockedLevel || 1) < Number(level || 1)
          ? ` · 🔒 unlocked through Level ${Math.max(1, Number(p.unlockedLevel) || 1)}`
          : '';
        slots.push(`
          <div class="roomslot ${p.host ? 'host' : ''} ${p.you ? 'you' : ''} state-${p.state || 'connecting'}">
            <span class="roomseat">${label}</span>
            <b></b>
            <small>${hero} · ${state}${unlock}</small>
            ${isHost && !p.host && p.state !== 'connected' ? `<span class="roomslotactions"><button class="tbtn room-retry" data-user="${p.userId || ''}">Reconnect</button><button class="tbtn room-remove" data-user="${p.userId || ''}">Remove</button></span>` : ''}
          </div>`);
      } else {
        slots.push(`
          <div class="roomslot open">
            <span class="roomseat">OPEN</span>
            <b>Empty seat</b>
            <small>${isHost ? 'Invite or share the room code' : 'Waiting for another commander'}</small>
          </div>`);
      }
    }
    box.innerHTML = `
      ${self ? '<div class="roomself"><span>✓ YOU ARE IN THIS ROOM</span><b></b><small>Your seat is locked in. The host starts the game.</small></div>' : ''}
      <div class="roomlaunch ${isHost ? 'host' : 'guest'}">
        <div>
          <span class="roomeyebrow">Host's game setup${safeCode ? ` · ${safeCode}` : ''}</span>
          <b>${modeCopy} · ${levelDef.name}</b>
          <span class="roomsettings">${difficultyDef.label} · ${hostHero ? hostHero.name : 'Hero pending'} · ${filled}/${maxPlayers} players</span>
          <small>${launchCopy}</small>
        </div>
      </div>
      <div class="roomslots">${slots.join('')}</div>`;
    const selfName = box.querySelector('.roomself b');
    if (selfName) selfName.textContent = `PLAYER ${Math.max(1, Number(self.seat || 1))} · @${self.name || 'you'}`;
    const names = box.querySelectorAll('.roomslot:not(.open) b');
    let i = 0;
    for (let seat = 1; seat <= maxPlayers; seat++) {
      const p = bySeat.get(seat);
      if (p && names[i]) {
        names[i].textContent = p.you ? `${p.name || 'You'} (you)` : (p.name || `Player ${seat}`);
        i++;
      }
    }
    for (const button of box.querySelectorAll('.room-retry')) button.onclick = () => this.cb.onRoomReconnect && this.cb.onRoomReconnect(button.dataset.user);
    for (const button of box.querySelectorAll('.room-remove')) button.onclick = () => this.cb.onRoomRemovePlayer && this.cb.onRoomRemovePlayer(button.dataset.user);
  }

  addPing(x, z) { this.pings.push({ x, z, t: 4 }); }

  hideStart() {
    this.root.querySelector('#overlay').classList.add('hidden');
    this.root.querySelector('#ow-quick-actions')?.classList.add('hidden');
    this.pauseOpen = false;
  }

  showPause(netMode, help = false, quests = null) {
    this.pauseOpen = true;
    this._showScreen(help ? 'help' : 'pause');
    const note = this.root.querySelector('#p-note');
    const questHtml = (quests || []).map((q) => {
      const it = itemInfo(q.reward);
      return `<div class="questrow ${q.claimed ? 'done' : q.done ? 'done' : ''}">${q.claimed ? '🏅' : q.done ? '✅' : '⬜'} <b>${q.name}</b> — ${q.desc}${it ? ` <span class="qreward">${it.icon} ${it.name}</span>` : ''}</div>`;
    }).join('');
    note.innerHTML = (questHtml ? `<div class="questbox"><div class="steplabel">SIDE QUESTS</div>${questHtml}</div>` : '')
      + (netMode ? '⚠️ Co-op keeps running while this menu is open.' : '');
  }

  hidePause() {
    this.pauseOpen = false;
    this.root.querySelector('#overlay').classList.add('hidden');
  }

  showEnd(won, stats, threat, levelId, mode = 'campaign', best = 0, extra = null, game = null) {
    this.pauseOpen = false;
    const ov = this.root.querySelector('#overlay');
    ov.classList.remove('hidden');
    const lv = levelById(levelId || 1);
    const survival = mode === 'survival';
    const labyrinth = mode === 'labyrinth';
    const questRows = (extra && extra.quests || []).map((q) => {
      const it = itemInfo(q.reward);
      return `<div class="questrow ${q.done ? 'done' : ''}">${q.done ? '✅' : '⬜'} <b>${q.name}</b> — ${q.desc}
        <span class="qreward">${it ? `${it.icon} ${it.name}` : ''}</span></div>`;
    }).join('');
    const grants = (extra && extra.grants || []).map((k) => itemInfo(k)).filter(Boolean);
    const review = runReview({ won, stats, threat, mode, game });
    ov.innerHTML = `
      <div class="panel endpanel ${won ? 'win' : 'lose'}">
        <h1>${labyrinth ? (won ? '🌀 THE TRIAL IS CLEARED' : '🌀 THE LABYRINTH KEEPS YOU')
          : survival ? `💀 THREAT ${threat}` : won ? '🏆 PLANET TAKEN' : '💀 THE CITY HAS FALLEN'}</h1>
        <p class="tagline">${labyrinth
          ? (won
            ? `${lv.name} is behind you. Every chamber is silent and the champion is dead — you walked out.`
            : `${lv.name} claimed the whole company. The chambers keep what falls in them.`)
          : survival
          ? `The dead are endless — but you drove ${lv.name} to Threat ${threat}.${threat >= best ? ' 🏅 A new personal best!' : ` Best: ${best}.`}`
          : won
          ? `${lv.name} is yours. Every hive is ash and their champion lies at your walls.`
          : `The dead took the Keep at Threat ${threat}.`}</p>
        <div class="howto stats">
          <div>🧟 Slain: <b>${stats.kills}</b></div>
          <div>🪙 Coins collected: <b>${stats.coins}</b></div>
          <div>${labyrinth ? `🌀 Chambers razed: <b>${stats.nests || 0}</b>` : `🔥 Hive nests razed: <b>${stats.nests || 0}</b>`}</div>
          ${labyrinth ? `<div>☠️ Heroes fallen: <b>${stats.heroDeaths || 0}</b></div>` : `<div>🏗️ Structures raised: <b>${stats.built}</b></div>`}
          ${labyrinth ? '' : `<div>🚩 Lane nodes taken: <b>${stats.nodes || 0}</b> (held at once: ${stats.bestHeld || 0})</div>`}
          <div>☠️ Threat reached: <b>${threat}</b></div>
        </div>
        <div class="runreview ${won ? 'success' : 'failure'}">
          <div class="steplabel">${won ? 'WHAT WORKED' : 'WHY THE RUN ENDED'}</div>
          <div class="reviewcause"><span>${review.cause.icon}</span><div><b>${review.cause.title}</b><small>${review.cause.detail}</small></div></div>
          <div class="reviewaction"><b>NEXT MOVE</b><span>${review.action}</span></div>
        </div>
        ${questRows ? `<div class="questbox"><div class="steplabel">SIDE QUESTS</div>${questRows}</div>` : ''}
        ${extra ? `<p class="tagline">⭐ <b>${extra.heroName}</b> marches on at level ${extra.level}${extra.xp ? ` · +${extra.xp} XP` : ''}${(extra.levels || []).length ? ` · LEVEL UP ${extra.levels.join(', ')}` : ''}${grants.length
          ? ` — gained ${grants.map((it) => `${it.icon} <b>${it.name}</b>`).join(', ')}` : ''}.</p>` : ''}
        ${!survival && !labyrinth && won ? `<p class="tagline">🔓 Unlocked: <b>${levelById(lv.id + 1).name}</b>${lv.id >= LEVELS.length ? ' — deeper into the galaxy' : ''}</p>` : ''}
        <div class="endactions">
          ${!won && mode === 'campaign' && this.cb.canRetry?.(game) ? '<button class="startbtn primary" id="b-retry">Retry mission</button>' : ''}
          <button class="startbtn" id="b-restart">${mode === 'campaign' ? 'Return to world' : won ? 'Continue' : 'Try again'}</button>
        </div>
      </div>`;
    ov.querySelector('#b-restart').onclick = () => this.cb.onRestart();
    const retry = ov.querySelector('#b-retry');
    if (retry) retry.onclick = () => {
      if (retry.disabled) return;
      retry.disabled = true;
      retry.textContent = 'Restarting…';
      this.cb.onRetry && this.cb.onRetry();
    };
  }

  // ---------- online lobby rendering ----------

  lobbySetMe(me) {
    this.root.querySelector('#l-me').textContent = `🪖 @${me.name}`;
    const code = this.root.querySelector('#l-mycode');
    if (code) code.textContent = me.code ? `@${me.code.toLowerCase()}` : '';
  }

  lobbyStatus(text) {
    this.root.querySelector('#l-online').textContent = text;
  }

  lobbyOnline(players) {
    const entries = players instanceof Map ? [...players.entries()] : [];
    const n = entries.length || Number(players) || 0;
    this.root.querySelector('#l-online').textContent = `🟢 ${n} online`;
    const box = this.root.querySelector('#l-players');
    const count = this.root.querySelector('#l-player-count');
    if (!box) return;
    if (count) count.textContent = String(n);
    box.innerHTML = '';
    if (!entries.length) {
      box.innerHTML = '<div class="mphint">No other commanders are visible.</div>';
      return;
    }
    for (const [, name] of entries.sort((a, b) => a[1].localeCompare(b[1]))) {
      const row = document.createElement('div');
      row.className = 'onlineplayer';
      row.innerHTML = '<span class="onlinedot"></span><b></b>';
      row.querySelector('b').textContent = `@${name}`;
      box.appendChild(row);
    }
  }

  lobbyChatFill(msgs) {
    const log = this.root.querySelector('#l-chatlog');
    log.innerHTML = '';
    for (const m of msgs) this.lobbyChatAdd(m);
  }

  lobbyChatAdd(m) {
    const log = this.root.querySelector('#l-chatlog');
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'chatmsg';
    const when = new Date(m.created_at);
    div.innerHTML = `<span class="chatwho"></span> <span class="chattext"></span><span class="chatwhen">${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')}</span>`;
    div.querySelector('.chatwho').textContent = m.name;
    div.querySelector('.chattext').textContent = m.text;
    log.appendChild(div);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  lobbyFriends(friends = []) {
    const box = this.root.querySelector('#l-friends');
    const count = this.root.querySelector('#l-friend-count');
    if (!box) return;
    if (count) count.textContent = friends.length ? `${friends.length}` : '';
    if (!friends.length) {
      box.innerHTML = '<div class="mphint">Add players by username, then invite them to your room.</div>';
      return;
    }
    box.innerHTML = '';
    for (const f of friends) {
      const row = document.createElement('div');
      row.className = `friendrow ${f.status}`;
      const status = f.status === 'accepted'
        ? (f.online ? 'online' : 'offline')
        : f.direction === 'incoming' ? 'request' : 'pending';
      row.innerHTML = `
        <div class="friendmeta"><b></b><small>${status}</small></div>
        <div class="friendactions"></div>`;
      row.querySelector('b').textContent = `@${f.name}`;
      const actions = row.querySelector('.friendactions');
      const makeButton = (label, title, handler) => {
        const b = document.createElement('button');
        b.className = 'tbtn';
        b.textContent = label;
        b.title = title;
        b.onclick = handler;
        actions.appendChild(b);
      };
      if (f.status === 'pending' && f.direction === 'incoming') {
        makeButton('✓', 'Accept friend request', () => this.cb.onAcceptFriend && this.cb.onAcceptFriend(f.id));
        makeButton('✕', 'Ignore friend request', () => this.cb.onRemoveFriend && this.cb.onRemoveFriend(f.id));
      } else if (f.status === 'accepted') {
        makeButton('⚔️', 'Invite to current room', () => this.cb.onInviteFriend && this.cb.onInviteFriend(f.userId));
        makeButton('✕', 'Remove friend', () => this.cb.onRemoveFriend && this.cb.onRemoveFriend(f.id));
      } else {
        makeButton('✕', 'Cancel friend request', () => this.cb.onRemoveFriend && this.cb.onRemoveFriend(f.id));
      }
      box.appendChild(row);
    }
  }

  roomChatFill(msgs) {
    const log = this.root.querySelector('#roomchat-log');
    if (!log) return;
    log.innerHTML = '';
    for (const m of msgs || []) this.roomChatAdd(m);
  }

  roomChatAdd(m) {
    const log = this.root.querySelector('#roomchat-log');
    if (!log) return;
    this._appendChatLine(log, m, 60);
  }

  setGameChatEnabled(on) {
    this._gameChatEnabled = !!on;
    const box = this.root.querySelector('#gamechat');
    if (box) box.classList.toggle('hidden', !on);
    if (!on) this.closeGameChat();
  }

  openGameChat() {
    if (!this._gameChatEnabled) return;
    const row = this.root.querySelector('#gamechat-row');
    const input = this.root.querySelector('#gamechat-input');
    row && row.classList.remove('hidden');
    setTimeout(() => input && input.focus(), 0);
  }

  closeGameChat() {
    const row = this.root.querySelector('#gamechat-row');
    if (row) row.classList.add('hidden');
  }

  gameChatFill(msgs) {
    const log = this.root.querySelector('#gamechat-log');
    if (!log) return;
    log.innerHTML = '';
    this._seenGameChat = new Set();
    for (const m of msgs || []) this.gameChatAdd(m);
  }

  gameChatAdd(m) {
    const log = this.root.querySelector('#gamechat-log');
    if (!log) return;
    const seen = this._seenGameChat || new Set();
    const id = m.id || `${m.name}-${m.created_at}-${m.text}`;
    if (seen.has(id)) return;
    seen.add(id);
    this._seenGameChat = seen;
    this._appendChatLine(log, m, 40);
  }

  _appendChatLine(log, m, max = 60) {
    const div = document.createElement('div');
    div.className = 'chatmsg';
    const when = new Date(m.created_at || Date.now());
    div.innerHTML = `<span class="chatwho"></span> <span class="chattext"></span><span class="chatwhen">${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')}</span>`;
    div.querySelector('.chatwho').textContent = m.name || 'Commander';
    div.querySelector('.chattext').textContent = m.text || '';
    log.appendChild(div);
    while (log.children.length > max) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  lobbyGames(games, onJoin, onWatch, myId = null) {
    const box = this.root.querySelector('#l-games');
    if (!box) return;
    if (!games.length) {
      box.innerHTML = '<div class="mphint">No public wars right now — start one and the world will see it here.</div>';
      return;
    }
    box.innerHTML = '';
    const open = games.filter((g) => g.status === 'open');
    const active = games.filter((g) => g.status === 'in_game' || g.status === 'starting');
    const renderGroup = (title, rows, activeGame = false) => {
      const heading = document.createElement('div');
      heading.className = 'gamegrouphead';
      heading.textContent = `${title} · ${rows.length}`;
      box.appendChild(heading);
      if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'mphint gameempty';
        empty.textContent = activeGame ? 'No wars are in progress.' : 'No rooms are waiting for players.';
        box.appendChild(empty);
      }
      for (const g of rows) {
      const row = document.createElement('div');
      row.className = `gamerow ${activeGame ? 'active' : 'open'}`;
      const lv = levelById(g.level || 1);
      const names = (g._players || []).map((p) => `@${p.display_name || 'Commander'}`).join(', ');
      const canRejoin = activeGame && myId && g.host_id !== myId
        && (g._players || []).some((p) => p.user_id === myId);
      const incompatible = g.protocol_compatible === false;
      row.innerHTML = `
        <span class="gamestate">${incompatible ? 'UPDATE' : activeGame ? 'LIVE' : 'OPEN'}</span>
        <span class="gmain"><b class="gname"></b><small class="gplayers"></small></span>
        <span class="ginfo">${g.mode === 'survival' ? '💀 Survival' : g.mode === 'labyrinth' ? '🌀 Labyrinth' : '⚔️ Campaign'} · ${lv ? lv.name : '?'} · ${g.players}/${g.max_players || 4}</span>
        <button class="tbtn gjoin" ${incompatible ? 'disabled' : ''}>${incompatible ? 'Refresh required' : canRejoin ? 'Rejoin' : activeGame ? 'Watch' : 'Join'}</button>`;
      row.querySelector('.gname').textContent = `${g.host_name}'s war`;
      row.querySelector('.gplayers').textContent = incompatible
        ? 'Created by an incompatible game build'
        : (names || `@${g.host_name}`);
      if (!incompatible) row.querySelector('.gjoin').onclick = () => canRejoin || !activeGame ? onJoin(g) : onWatch(g);
      box.appendChild(row);
      }
    };
    renderGroup('Open games', open, false);
    renderGroup('In progress', active, true);
  }

  fillLore(lore, tips) {
    const lorePane = this.root.querySelector('#l-tab-lore');
    lorePane.innerHTML = lore.map(([t, body]) => `<div class="loreentry"><b>${t}</b><p>${body}</p></div>`).join('');
    const tipsPane = this.root.querySelector('#l-tab-tips');
    tipsPane.innerHTML = '<div class="howto">' + tips.map((t) => `<div>${t}</div>`).join('') + '</div>';
  }

  showInviteToast(inv, onAccept) {
    const el = this.root.querySelector('#invitetoast');
    el.classList.remove('hidden');
    el.innerHTML = `<b></b> invites you to their ${inv.mode === 'survival' ? 'Survival' : inv.mode === 'labyrinth' ? 'Labyrinth' : 'Campaign'} war! <button class="tbtn" id="inv-yes">⚔️ Join</button> <button class="tbtn" id="inv-no">✕</button>`;
    el.querySelector('b').textContent = inv.fromName;
    el.querySelector('#inv-yes').onclick = () => { el.classList.add('hidden'); onAccept(); };
    el.querySelector('#inv-no').onclick = () => el.classList.add('hidden');
    clearTimeout(this._invT);
    this._invT = setTimeout(() => el.classList.add('hidden'), 30000);
  }

  drawMinimap(game, camFocus, viewSize) {
    const top = this.root.querySelector('#minimap-top');
    const N = game.map.size;
    if (top.width !== N) { top.width = N; top.height = N; }
    const ctx = top.getContext('2d');
    ctx.clearRect(0, 0, N, N);

    // Plots: ghost outlines; built plots solid.
    for (const p of game.plots) {
      if (p.kind === 'wall') continue;
      if (!game.firstSiegePlotVisible(p)) continue;
      ctx.fillStyle = p.tier > 0 ? '#efeadb' : 'rgba(255,235,170,0.35)';
      ctx.fillRect(p.x, p.z, p.size, p.size);
    }
    for (const b of game.buildings) {
      ctx.fillStyle = b.kind === 'hq' ? '#ffd75e' : b.kind === 'wall' ? '#c9b48a' : '#efeadb';
      ctx.fillRect(b.x, b.z, b.size, b.size);
    }
    ctx.fillStyle = '#ffd75e';
    for (const cn of game.coins) ctx.fillRect(cn.x - 0.6, cn.z - 0.6, 1.2, 1.2);
    // Loot you have already spotted stays on the minimap — finding a cache and
    // then losing it because a wave arrived is not interesting.
    for (const l of game.loot || []) {
      if (l.hidden) continue;
      ctx.fillStyle = '#a8e6ff';
      ctx.fillRect(l.x - 1.2, l.z - 1.2, 2.4, 2.4);
      ctx.fillStyle = '#0b0e13';
      ctx.fillRect(l.x - 0.4, l.z - 0.4, 0.8, 0.8);
    }
    ctx.fillStyle = '#43d17c';
    for (const u of game.units) {
      if (u.hero) { ctx.fillStyle = '#7fd6ff'; ctx.fillRect(u.x - 1.5, u.z - 1.5, 3.5, 3.5); ctx.fillStyle = '#43d17c'; }
      else ctx.fillRect(u.x - 1, u.z - 1, 2, 2);
    }
    ctx.fillStyle = '#e6493a';
    for (const zb of game.zombies) ctx.fillRect(zb.x - 0.5, zb.z - 0.5, 1.2, 1.2);
    if (game.boss && !game.boss.dead) {
      ctx.fillStyle = '#ff2d1f';
      ctx.fillRect(game.boss.x - 2.5, game.boss.z - 2.5, 5, 5);
      ctx.strokeStyle = '#ffd75e';
      ctx.strokeRect(game.boss.x - 3, game.boss.z - 3, 6, 6);
    }

    // Hive nests: living hives glow violet; tonight's spawners pulse red.
    const firstSiegeNest = game.firstSiegeStatus?.()?.nest;
    for (const n of game.nests || []) {
      if (!n.alive) continue;
      const warned = firstSiegeNest?.id === n.id;
      ctx.fillStyle = warned ? '#ff3c2e' : '#b44dff';
      ctx.fillRect(n.x - (warned ? 3 : 2), n.z - (warned ? 3 : 2), warned ? 6 : 4, warned ? 6 : 4);
      if (warned) {
        ctx.strokeStyle = '#ffd75e';
        ctx.strokeRect(n.x - 4, n.z - 4, 8, 8);
      }
    }
    // Lane nodes: yours green, the hive's red, unclaimed amber. Contested
    // nodes pulse — this is the front line, read at a glance.
    const nodePulse = (performance.now() / 500) % 1;
    for (const n of game.nodes || []) {
      if (n.offMap) continue;
      // Unsurveyed ground shows that it EXISTS but not who holds it — you can
      // read a map, you cannot read it from across the planet.
      const col = !n.seen ? '#6f7b86'
        : n.owner === 'player' ? '#59ff9c' : n.owner === 'hive' ? '#ff5a4a' : '#d8c07a';
      ctx.fillStyle = col;
      ctx.fillRect(n.x - 1.6, n.z - 1.6, 3.2, 3.2);
      if (n.cap > 0.05) {
        ctx.strokeStyle = `rgba(255,255,255,${0.9 - nodePulse * 0.7})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(n.x, n.z, 2.5 + nodePulse * 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Un-founded: candidate sites blink gold.
    if (game.phase === 'found') {
      const ph = (performance.now() / 600) % 1;
      (game.map.sites || []).forEach((s) => {
        ctx.strokeStyle = `rgba(255,215,94,${0.9 - ph * 0.6})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.z, 4 + ph * 6, 0, Math.PI * 2);
        ctx.stroke();
      });
    }

    // Explored memory: the minimap remembers where allied vision has been.
    // Unexplored ground is near-black; explored-but-not-currently-seen reads
    // dim (terrain shape, no contacts); current vision is clear. Without this
    // the map goes blind the moment the hero rides on — a map you cannot read
    // from memory is not a map.
    if (this._mmExploredGame !== game || !this._mmExplored || this._mmExplored.length !== N * N) {
      this._mmExploredGame = game;
      this._mmExplored = new Uint8Array(N * N);
      this._mmExploredCanvas = document.createElement('canvas');
      this._mmExploredCanvas.width = N;
      this._mmExploredCanvas.height = N;
      this._mmExploredCtx = this._mmExploredCanvas.getContext('2d');
      this._mmExploredCtx.fillStyle = '#fff';
    }
    const explored = this._mmExplored;
    const exploredCtx = this._mmExploredCtx;
    const visionSources = fogVisionSources(game);
    for (const source of visionSources) {
      const r = Math.ceil(source.radius);
      const x0 = Math.max(0, (source.x - r) | 0), x1 = Math.min(N - 1, (source.x + r) | 0);
      const z0 = Math.max(0, (source.z - r) | 0), z1 = Math.min(N - 1, (source.z + r) | 0);
      for (let z = z0; z <= z1; z++) {
        const dz = z - source.z;
        for (let x = x0; x <= x1; x++) {
          const dx = x - source.x;
          const i = z * N + x;
          if (!explored[i] && dx * dx + dz * dz <= source.radius * source.radius) {
            explored[i] = 1;
            exploredCtx.fillRect(x, z, 1, 1);
          }
        }
      }
    }
    // Pre-render the explored veil once per redraw: dim the base canvas's
    // colors onto the overlay where explored, so memory reads as terrain.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    // Unexplored: the full shroud.
    ctx.fillStyle = `rgba(1, 2, 5, ${FOG_DARKNESS})`;
    ctx.fillRect(0, 0, N, N);
    // Explored: lift the shroud to a veil — half light, so remembered ground
    // is legible but obviously not live.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(this._mmExploredCanvas, 0, 0);
    ctx.globalAlpha = 1;
    // Current vision: fully clear.
    for (const source of visionSources) {
      const edge = Math.max(1, source.radius + FOG_EDGE_SOFTNESS);
      const gradient = ctx.createRadialGradient(
        source.x,
        source.z,
        Math.max(0, source.radius - FOG_EDGE_SOFTNESS),
        source.x,
        source.z,
        edge,
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0.97)');
      gradient.addColorStop(0.52, 'rgba(0,0,0,0.9)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(source.x, source.z, edge, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Above the shroud — the things a commander can never lose track of.
    // Co-op allies share vision, so their heroes are always on the map, each
    // in their own strong colour so "where is my partner" is one glance.
    // The boss, once it walks, is a map-wide event: big pulsing ring, always
    // visible, because it is the one blip hiding in fog would actually hurt.
    ctx.fillStyle = '#7fd6ff';
    for (const u of game.units) {
      if (!u.hero || u.dead) continue;
      const mine = game.heroes && game.heroes[this._p] === u;
      if (mine) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(u.x - 2, u.z - 2, 4.5, 4.5);
        ctx.strokeStyle = '#7fd6ff';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(u.x - 2.4, u.z - 2.4, 5.3, 5.3);
      } else {
        ctx.fillStyle = '#ffb347';
        ctx.fillRect(u.x - 1.8, u.z - 1.8, 4, 4);
        ctx.fillStyle = '#1b1408';
        ctx.fillRect(u.x - 0.7, u.z - 0.7, 1.6, 1.6);
      }
    }
    if (game.boss && !game.boss.dead) {
      const bossPulse = (performance.now() / 700) % 1;
      ctx.fillStyle = '#ff2d1f';
      ctx.fillRect(game.boss.x - 3, game.boss.z - 3, 6, 6);
      ctx.strokeStyle = `rgba(255,215,94,${0.95 - bossPulse * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(game.boss.x, game.boss.z, 4 + bossPulse * 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#ffd75e';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(game.boss.x - 3.6, game.boss.z - 3.6, 7.2, 7.2);
    }

    // Pings: expanding red circles.
    for (const p of this.pings) {
      p.t -= 0.15;
      const phase = 1 - ((p.t * 2) % 1);
      ctx.strokeStyle = `rgba(255,60,50,${Math.max(0, 1 - phase)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.z, 3 + phase * 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.pings = this.pings.filter((p) => p.t > 0);

    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(camFocus.x - viewSize / 2, camFocus.z - viewSize / 2, viewSize, viewSize);
  }
}
