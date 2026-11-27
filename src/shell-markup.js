import { BUILDER_ORDERS } from './builders.js';
import { icon } from './ui-kit.js';
import { modesForTab } from './modes.js';

const soon = (label, note) => `<button type="button" class="soon" disabled><span>${label}</span><small>Coming soon</small>${note ? `<em>${note}</em>` : ''}</button>`;

const modeButton = (mode) => {
  const id = mode.buttonId ? ` id="${mode.buttonId}"` : '';
  const resume = mode.resumeId ? `<div id="${mode.resumeId}" class="moderesume"></div>` : '';
  if (mode.status !== 'built') {
    return `<article class="mode-card soon" data-mode="${mode.id}">${icon(mode.tab)}<b>${mode.name}</b><p>${mode.blurb}</p><small>${mode.players}${mode.ranked ? ' · Ranked' : ''}</small><em>Coming soon</em></article>`;
  }
  return `<article class="mode-card" data-mode="${mode.id}">${icon(mode.art === 'earth' ? 'campaign' : mode.tab)}<b>${mode.name}</b><p>${mode.blurb}</p><small>${mode.players}</small>${resume}<button type="button" class="menu-word"${id}>${mode.id === 'campaign' ? 'Enter' : 'Play'}</button></article>`;
};

export function shellMarkup() {
  const coop = modesForTab('coop').map(modeButton).join('');
  const versus = modesForTab('versus').map(modeButton).join('');
  const campaign = modesForTab('campaign').map(modeButton).join('');
  return `
    <div id="toasts" aria-live="polite"></div><button type="button" id="social-toggle" aria-haspopup="dialog" aria-controls="social-panel" aria-expanded="false">Friends <span id="social-count">—</span></button><dialog id="social-panel" aria-labelledby="social-title"><header><div><small>YOUR NETWORK</small><h2 id="social-title">Friends &amp; Party</h2></div><button type="button" id="social-close" aria-label="Close friends">Close</button></header><p id="social-status" role="status">Sign in to see your friends.</p><button type="button" id="social-refresh">Refresh</button><div id="social-content"></div></dialog>
    <div id="topbar" class="hidden">
      <div class="res gold" id="r-gold" title="Gold — income is paid automatically, coins drop from fighting. Hold your Build key at a foundation to spend"><b>0</b></div>
      <div class="res" id="r-day" title="Threat — rises with the clock, with every hive still standing, and with every node you take"><b>Threat 1</b></div>
      <div class="res" id="r-front" title="Lane nodes you hold · hive nests still mustering"><b>0</b> · <b>0</b></div>
      <div class="res" id="r-army" title="Living troops in your shared army">Troops 0</div><div class="res" id="r-z" title="Enemies currently in allied sight">Visible 0</div>
      <div class="netdiag hidden" id="netdiag" title="Live multiplayer route, latency, jitter buffer, and device frame rate"></div>
      <div class="sep"></div>
      <button class="tbtn" id="b-pause" title="Pause (P)">Pause</button>
      <span class="speed-readout" id="speed-readout">1×</span>
      <button class="tbtn speed" data-s="1">1×</button>
      <button class="tbtn speed" data-s="2">2×</button>
      <button class="tbtn" id="b-mute" title="Mute sound (M)">Snd</button>
      <button class="tbtn" id="b-quality" title="Toggle graphics quality">Gfx</button>
      <button type="button" class="tbtn hidden" id="locate-keep" title="Jump to the Keep (K)">Keep</button><button class="tbtn" id="b-menu" title="Menu (Esc)">Menu</button>
    </div>

    <div id="pause-veil" class="pause-veil hidden" role="status" aria-live="polite">
      <div><b>PAUSED</b><span id="pause-veil-speed">Speed 1×</span><small id="pause-veil-hint"></small></div>
    </div>
    <aside id="coach" class="coach hidden" role="status">
      <span id="coach-kicker">FIRST SIEGE</span>
      <b id="coach-title"></b>
      <p id="coach-body"></p>
      <button type="button" id="coach-skip">Skip lesson</button>
    </aside>
    <div id="banner"></div>
    <div id="invitetoast" class="hidden"></div>
    <div id="waitind" class="hidden">Syncing battle…</div>
    <div id="bossbar" class="hidden"><b id="boss-name"></b><div class="bossfillwrap"><div id="boss-fill"></div></div></div>
    <div id="combat-alert" class="combat-alert hidden" role="status" aria-live="polite"></div>
    <div id="wave-approach" class="wave-approach hidden" aria-hidden="true"><b>➤</b><small></small></div>
    <div id="messages"></div><nav id="combat-locations" class="hidden" aria-label="Active battles"></nav>
    <aside id="battle-details" class="battle-details hidden" aria-label="Battlefield details">
      <button id="battle-details-close" aria-label="Close details">×</button>
      <div id="battle-details-content"></div>
    </aside>
    <div id="gamechat" class="gamechat hidden">
      <div class="gamechatlog" id="gamechat-log"></div>
      <div class="gamechatrow hidden" id="gamechat-row">
        <input id="gamechat-input" maxlength="500" placeholder="Team chat…">
        <button class="tbtn" id="gamechat-send">Send</button>
      </div>
    </div>

    <div id="command-deck" aria-label="Battle commands">
    <div id="minimap-wrap" class="hidden">
      <canvas id="minimap-base"></canvas>
      <canvas id="minimap-top"></canvas>
    </div>
    <div id="actionbar" class="hidden">
      <div class="commandtop">
        <button class="mode-toggle build" id="mode-toggle" title="Switch between Build and Fight controls"><b data-bind-label="build_mode"></b><span>Build mode</span></button>

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
        <div id="ability-slots" class="ability-slots" aria-label="Additional abilities"></div>
      </div>
      <div id="branchpanel" class="hidden"></div>
      <div id="blessingpanel" class="hidden"></div>
      <div id="buildhint" class="hidden"></div>
    </div>

    <aside id="command-orders" aria-label="Army and workers">
        <div class="armystatus" id="army-status">Build camps to raise squads.</div>
        <div class="rallyhints" id="stancebar">
          <button type="button" class="stance" data-st="defend" data-bind="stance_defend" aria-pressed="false" title="Recall all squads to defend the Keep"><b></b> Defend</button><button type="button" class="stance" data-st="guard" data-bind="stance_follow" aria-pressed="false" title="All squads escort the heroes; they leave the Keep"><b></b> Follow</button><button type="button" class="stance" data-st="attack" data-bind="stance_push" aria-pressed="false" title="All squads push the lanes: take nodes, then siege the hives"><b></b> Push</button><button type="button" class="stance" data-st="rally" data-bind="stance_rally" aria-pressed="false" title="Choose a point for the army to hold"><b></b> Rally</button>
        </div>
    <section id="builder-controls" class="builder-controls hidden" aria-label="Builder orders">
      <button id="builder-toggle" aria-expanded="false">Builders</button><span id="builder-status"></span>
      <div class="worker-orders">
        <button type="button" data-worker="develop" data-bind="workers_develop"><b></b> Develop</button>
        <button type="button" data-worker="maintain" data-bind="workers_maintain"><b></b> Maintain</button>
        <button type="button" data-worker="fortify" data-bind="workers_fortify"><b></b> Fortify</button>
        <button type="button" data-worker="expand" data-bind="workers_expand"><b></b> Expand</button>
      </div><div id="builder-options" class="hidden">
        <label>Order <select id="builder-order">${Object.entries(BUILDER_ORDERS).map(([key, name]) => `<option value="${key}">${name}</option>`).join('')}</select></label>
        <button id="builder-pause">Resume</button>
        <label>Keep gold <input id="builder-reserve" type="number" min="0" max="1000" step="5" value="10"></label>
        <label>Towers <select id="builder-tower"><option value="ask">Ask me</option><option value="ballista">Long range</option><option value="flame">Anti-horde</option></select></label>
        <label>Walls <select id="builder-wall"><option value="ask">Ask me</option><option value="bastion">Armor</option><option value="shock">Shock</option></select></label><p id="builder-help"></p>
      </div>
    </section>
    </aside>
    </div>
    <div id="tooltip" class="hidden"></div>

    <div id="deployment-screen" class="deployment-screen hidden" role="status" aria-live="polite" aria-label="Preparing mission">
      <div class="deployment-card glass"><span class="deployment-kicker">EXPEDITION</span><h2 id="deployment-title"></h2><p id="deployment-detail"></p><div class="deployment-track" aria-hidden="true"><span id="deployment-bar"></span></div><small id="deployment-phase">Preparing the battlefield</small></div>
    </div>
    <section id="mission-intro" class="mission-intro hidden" aria-label="Mission introduction">
      <div class="mission-intro-copy"><span>EXPEDITION / ARRIVAL</span><h2 id="mission-intro-title"></h2><p>Establish your colony. Secure the lanes. Destroy the hives.</p></div>
      <button id="mission-intro-skip" class="tbtn">Enter battlefield</button>
    </section>

    <div id="overlay" class="screen">
      <div id="shell-chrome">
        <button type="button" id="active-character" class="active-character hidden" aria-label="Active character">
          <span id="active-character-portrait"></span>
          <span><small>Character</small><b id="active-character-name">Commander</b></span>
        </button>
        <div id="party-strip" class="party-strip" aria-label="Party">
          <span class="party-slot you" id="party-you"><b id="party-you-name">You</b></span>
          <span class="party-slot soon" aria-disabled="true">Party slot<small>Coming soon</small></span>
          <span class="party-slot soon" aria-disabled="true">Party slot<small>Coming soon</small></span>
          <span class="party-slot soon" aria-disabled="true">Party slot<small>Coming soon</small></span>
          <button type="button" class="party-slot invite" id="a-invite">Invite</button>
        </div>
        <nav id="shell-tabs" class="shell-tabs hidden" aria-label="Play">
          <button type="button" data-tab="campaign" id="tab-campaign">Campaign</button>
          <button type="button" data-tab="coop" id="tab-coop" class="hidden" hidden>Other battles</button>
          <button type="button" data-tab="versus" id="tab-versus">Versus</button>
          <button type="button" data-tab="custom" id="m-custom">Custom</button>
        </nav>
      </div>

      <div id="screen-account" class="shell-screen title-screen">
        <header class="title-identity"><span>THE FRONTIER AWAITS</span><h1>ZILLIONS</h1></header>
        <nav class="menu-list" aria-label="Title menu">
          <button type="button" class="menu-word is-focus" id="a-play"><b>Play</b></button>
          <button type="button" class="menu-word" id="nav-squad">Multiplayer</button>
          <button type="button" class="menu-word" id="nav-armory">Armory</button>
          <button type="button" class="menu-word" id="a-settings">Settings</button>
          <button type="button" class="menu-word" id="nav-account">Account</button>
        </nav>
        <div id="account-status-wrap" class="title-status">
          <div class="auth-progress" id="auth-progress"><span></span></div>
          <div id="account-status">Checking account…</div>
        </div>
        <button type="button" id="a-credits" class="credits-link">Credits</button>
        <section id="account-card" class="glass account-card hidden"><button type="button" class="utilitybtn" id="account-close">Close</button>
          <div class="login-heading"><span>ACCOUNT</span><h2>Sign in</h2><p>A Zillions account keeps characters, gear, and match rewards.</p></div>
          <button class="menubtn primary login-provider" id="a-google" type="button"><span>Continue with Google</span></button>
          <div class="login-divider" id="a-login-divider"><span>OR</span></div>
          <form class="email-login" id="a-email-form">
            <label for="a-email">Email address</label>
            <input id="a-email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required>
            <button class="menubtn" id="a-email-submit" type="submit">Continue with email</button>
            <small>We will email you a secure sign-in link. No password required.</small>
          </form>
          <button class="menubtn hidden" id="a-offline" type="button">Enter offline</button>
          <form class="usernameform hidden" id="a-username-form">
            <label for="a-username">Public username</label>
            <div class="usernamerow"><span>@</span><input id="a-username" maxlength="18" autocomplete="username" spellcheck="false" placeholder="commander_name"></div>
            <button class="menubtn primary" type="submit">Claim username</button>
            <small>Letters, numbers, and underscores. Other players see this.</small>
          </form>
          <button class="utilitybtn danger" type="button" id="m-logout">LOG OUT</button>
          <p id="prof-name-display" class="account-name">Signed in</p>
          <p id="prof-stats"></p>
        </section>
      </div>

      <div id="screen-main" class="mainmenu character-select shell-screen hidden">
        <div class="character-heading"><h1 id="chapter-title">Your leaders</h1><span id="chapter-territory"></span></div>
        <form id="chapter-identity" class="chapter-identity glass hidden" aria-label="Campaign affiliation"><div class="affiliation-heading"><h2>Campaign identity</h2><button type="button" id="chapter-identity-close" aria-label="Close affiliation">Close</button></div><p class="affiliation-note">Campaign banner and recruitment preferences. Party membership, faction ranks, houses and empire relationships are coming soon; this banner does not make you a ruler.</p><label>Campaign banner<input id="chapter-name-input" maxlength="32" required placeholder="Name your chapter"></label><label>Recruitment culture<select id="chapter-culture"></select></label><label>Colors<select id="chapter-color"></select></label><label>Insignia<select id="chapter-emblem"></select></label><button type="submit" class="menubtn primary">Save banner</button></form>
        <div id="character-stage" class="character-stage">
          <div id="character-avatar" class="character-avatar" aria-label="Selected character">
            <canvas id="roster-preview-canvas" width="320" height="360" aria-label="Commander preview"></canvas>
          </div>
          <div class="character-copy"><h2 id="character-name"></h2><p id="character-tagline"></p><div id="character-gear" class="character-gear"></div></div>
        </div>
        <aside class="character-roster">
          <span class="roster-label">YOUR CHARACTERS</span>
          <div id="character-list" class="character-cards"></div>
          <button type="button" class="character-card new-card" id="m-create-character">+ Create Character</button>
          <button type="button" class="menu-word" id="nav-home">Play a Map</button>
          <button type="button" class="menubtn custom-entry" id="leader-custom">Custom Battles</button><button type="button" class="character-sheet-open danger" id="m-delete-character">RETIRE LEGACY CHARACTER</button>
          <div id="first-hour-guide" class="first-hour-guide hidden" role="status"></div>
        </aside>
        <div class="leader-links"><button type="button" id="leader-back">Back</button><button type="button" id="leader-faction" aria-controls="chapter-identity" aria-expanded="false">Affiliation</button></div>
        <button type="button" class="utilitybtn hidden" id="m-character-sheet">ARMORY</button>
      </div>

      <div id="screen-home" class="shell-screen hidden">
        <div class="play-panels">
          <div data-panel="campaign" class="play-panel">
            <article class="mode-card" data-mode="campaign">${icon('campaign')}<b>Enter the Overworld</b><p>Your first world. Choose a campaign site to deploy.</p><small>1</small><button type="button" class="menu-word" id="m-enter-world">Enter</button></article>
          </div>
          <div data-panel="coop" class="play-panel hidden mode-grid">
            <article class="mode-card" data-mode="survival">${icon('coop')}<b>Survival</b><p>One city. Threat never stops.</p><small>1–4</small><div id="solo-survival-resume" class="moderesume"></div><button type="button" class="menu-word" id="solo-survival">Play</button></article>
            <article class="mode-card" data-mode="labyrinth">${icon('coop')}<b>The Labyrinth</b><p>No colony and no army. One hero against the deep.</p><small>1–4</small><div id="solo-labyrinth-resume" class="moderesume"></div><button type="button" class="menu-word" id="solo-labyrinth">Play</button></article>
            <article class="mode-card" data-mode="daily">${icon('coop')}<b>Daily Siege</b><p>The same map for every commander today.</p><small>1</small><button type="button" class="menu-word" id="m-daily">Play</button></article>
            <article class="mode-card" data-mode="arcade">${icon('custom')}<b>Arcade Maps</b><p>Prebuilt maps. Play now, or host them as a room.</p><small>1–4</small><button type="button" class="menu-word" id="coop-arcade">Play</button></article>
          </div>
          <div data-panel="versus" class="play-panel hidden mode-grid">${versus}</div>
        </div>
      </div>

      <div id="screen-overworld" class="shell-screen system-screen hidden">
        <header class="sys-bar glass"><button type="button" id="world-back">← Characters</button>
          <span><small>Alloy</small><b id="sys-alloy">0</b></span>
          <span class="soon-inline"><small>Time</small><b>Coming soon</b></span>
          <span><small>Party</small><b id="sys-party">1</b></span>
          <span id="chapter-earth-status"></span>
        </header>
        <div id="system-labels" aria-label="Planets">
          <button type="button" class="system-label is-on" data-planet="earth">Earth</button>
          <button type="button" disabled class="system-label dim" data-planet="cinder">Cinder<small>Coming soon</small></button>
          <button type="button" disabled class="system-label dim" data-planet="verge">Verge<small>Coming soon</small></button>
          <button type="button" disabled class="system-label dim" data-planet="reach">The Reach<small>Coming soon</small></button>
        </div>
        <div id="chapter-map" aria-label="Earth conquest map"></div>
        <aside id="site-panel" class="site-panel glass" aria-label="Site">
          <p id="planet-blurb" class="hidden"></p>
          <div id="chapter-objective"></div>
          <div class="site-actions">
            <button type="button" id="site-assault" disabled>Assault</button>
            ${soon('Defend')}
            ${soon('Trade')}
            ${soon('Build')}
            ${soon('Travel')}
          </div>
          <div id="chapter-services"></div><details class="recruitment-panel"><summary>Recruit companions</summary><div id="chapter-recruits"></div></details>
        </aside>
      </div>

      <div id="screen-squad" class="shell-screen hidden">

        <div class="squad-grid">
          <section class="glass social-party"><h2>Your party</h2><div id="social-party-roster">No party loaded.</div><button type="button" class="menubtn" id="m-party">Manage party</button></section>
          <section class="glass"><h2>Friends</h2>
            <div class="friendadd"><input aria-label="Friend username" id="l-friendcode" maxlength="32" placeholder="@username"><button class="tbtn" id="l-friendadd" type="button">Add</button></div>
            <div id="l-friends" class="friendlist"></div>
            <div class="friendshead hidden"><b>Online</b><span id="l-player-count"></span><span id="l-online"></span></div>
            <div id="l-players" class="onlineplayers hidden"></div>
          </section>
          <section class="glass hidden"><h2>Lobby</h2>
            <div class="lobbychatlog" id="l-chatlog"></div>
            <div class="lobbychatrow"><input id="l-chatinput" maxlength="400" placeholder="Say something…"><button class="tbtn" id="l-chatsend" type="button">Send</button></div>
            <div id="l-tab-lore" class="hidden"></div>
            <div id="l-tab-tips" class="hidden"></div>
            <div id="l-tab-games" class="hidden"></div>
            <div id="l-games" class="hidden"></div>
            <span id="l-me" class="hidden"></span>
            <span id="l-mycode" class="hidden"></span>
            <span id="l-friend-count" class="hidden"></span>
          </section>
        </div>
      </div>

      <div id="screen-character-sheet" class="sheet-screen shell-screen hidden">
        <div class="sheet-head">
          <div class="sheet-ident"><span id="sheet-sigil" class="sheet-sigil"></span>
            <div><h1 id="sheet-name">CHARACTER</h1><p id="sheet-sub"></p></div></div>
          <div class="sheet-tabs">
            <button class="sheet-tab sel" id="sheet-tab-character" data-tab="character" type="button">HEROES</button>
            <button class="sheet-tab" id="sheet-tab-gear" data-tab="gear" type="button">EQUIPMENT</button>
            <button class="sheet-tab" id="sheet-tab-abilities" data-tab="abilities" type="button">ABILITIES</button>
            <button class="sheet-tab" id="sheet-tab-lattice" data-tab="lattice" type="button">LATTICE</button>
            <button class="sheet-tab" id="sheet-tab-shop" data-tab="shop" type="button">QUARTERMASTER</button>
            <button class="sheet-tab" id="sheet-tab-crafting" data-tab="crafting" type="button">FORGE</button>
          </div>
          <button class="utilitybtn" id="sheet-close" type="button">Back</button>
        </div>
        <div id="sheet-panel-character" class="sheet-panel character-overview"></div>
        <div id="sheet-panel-gear" class="sheet-panel hidden">
          <div class="gear-paperdoll"><h3>EQUIPPED</h3><div class="gear-slots" id="gear-slots"></div><div id="sheet-guide-gear" class="sheet-guide"></div></div>
          <div class="gear-stash"><h3>FIELD STASH <small id="gear-stash-count"></small></h3><div id="gear-stash-list"></div></div>
          <div class="gear-inspector"><h3>ITEM DETAILS</h3><div id="gear-item-detail" class="gear-item-detail"><p>Select an item to inspect it. Double-click a stash item to equip it.</p></div><div class="gear-stats"><h3>CURRENT ATTRIBUTES</h3><div id="gear-stat-list"></div></div></div>
        </div>
        <div id="sheet-panel-shop" class="sheet-panel market-panel hidden">
          <section class="market-head"><div><span class="modeeyebrow">QUARTERMASTER</span><h2 id="market-vendor-name">FRONTIER QUARTERMASTER</h2><p id="market-vendor-description">Rotating field gear. Buy with Salvage Alloy or sell recovered equipment.</p></div><strong id="market-balance"></strong></section>
          <nav id="market-vendors" class="market-vendors" aria-label="Specialist vendors"></nav>
          <section><h3>FOR SALE</h3><div class="market-grid" id="market-stock"></div></section>
          <section><h3>YOUR STASH</h3><div class="market-grid" id="market-sell"></div></section><div id="sheet-guide-market" class="sheet-guide"></div>
        </div>
        <div id="sheet-panel-crafting" class="sheet-panel crafting-panel hidden">
          <section><span class="modeeyebrow">ORBITAL FORGE</span><h2>CRAFTING & SOCKETS</h2><p>Modify your leader’s equipment with sockets and components.</p><div id="sheet-guide-forge" class="sheet-guide"></div><div id="craft-resources"></div><div id="craft-vendor"></div></section>
          <section><h3>SELECT ITEM</h3><div id="craft-items" class="market-grid"></div></section>
          <section><h3>WORKBENCH</h3><div id="craft-workbench"><p>Select an item.</p></div><div id="craft-status" role="status"></div></section>
        </div>
        <div id="sheet-panel-abilities" class="sheet-panel abilities-overview hidden"></div>
        <div id="sheet-panel-lattice" class="sheet-panel hidden">
          <div class="lattice-stage">
            <canvas id="lattice-canvas"></canvas>
            <div class="lattice-hud"><span id="lattice-points"></span><input id="lattice-search" placeholder="Search the Lattice" autocomplete="off"><button class="utilitybtn" id="lattice-rewire" type="button">REWIRE</button></div>
          </div>
          <aside class="lattice-detail" id="lattice-detail"></aside>
        </div>
      </div>

      <div id="screen-character-create" class="character-create-screen shell-screen hidden">
        <div class="creator-head"><span>NEW CHARACTER</span><h1>CREATE YOUR CHARACTER</h1></div>
        <form id="character-create-form" class="creator-form creator-xl">
          <section class="creator-preview" id="creator-preview" aria-label="Live 3D character preview"><canvas id="creator-preview-canvas"></canvas><strong id="creator-preview-race">HUMAN</strong></section>
          <div class="creator-controls">
            <nav id="creator-steps" aria-label="Character creation"></nav>
            <h2 id="creator-step-title">Origin</h2>
            <div data-creator-step="0"><h3>Origin</h3><div id="creator-origin-slot"></div></div>
            <fieldset data-creator-step="2"><legend>AVAILABLE NOW</legend><div id="creator-classes" class="creator-classes"></div></fieldset>
            <div id="leader-archetypes" class="hidden" aria-hidden="true"></div>
            <div data-creator-step="3"><article class="origin-story"><span>FRONTIER COMMANDER</span><p>Your expedition has reached the frontier. Establish a foothold, gather a company and break the hive siege.</p><p>You begin with frontier equipment and command of the landing force. Your victories, gear and companions persist between missions.</p></article></div>
            <div data-creator-step="4"><h3>Affiliation</h3><div class="affiliation-choice"><b>Independent commander</b><p>You do not need to rule a faction to enter the world.</p></div><div class="affiliation-future hidden"><button type="button" disabled>Join a house or faction · Coming soon</button><button type="button" disabled>Found a house or faction · Coming soon</button><button type="button" disabled>Kingdoms & empires · Coming soon</button></div><p id="creator-faction-note"></p><label>Campaign banner · optional<input id="creator-faction-name" maxlength="32" placeholder="Your expedition name"></label><label>Culture<select id="creator-faction-culture"></select></label><label>Banner color<select id="creator-faction-color"></select></label><label>Emblem<select id="creator-faction-emblem"></select></label><div id="creator-banner-preview" aria-label="Campaign banner preview"></div></div>
            <div data-creator-step="5"><h3>Ready to begin</h3><p id="creator-review"></p></div>
            <label data-creator-step="5">NAME<input id="creator-name" maxlength="18" autocomplete="off" placeholder="Character name" required></label>
            <fieldset data-creator-step="0"><legend>ORIGIN</legend><div id="creator-races" class="creator-races"></div></fieldset>
            <div data-creator-step="1" class="creator-parts" id="creator-parts"></div>
            <fieldset data-creator-step="1"><legend>ARMOR COLOR</legend><div id="creator-appearance" class="creator-appearance"></div></fieldset>
          </div>
          <div id="creator-summary" class="creator-summary"></div>
          <div class="creator-actions"><button type="button" class="utilitybtn" id="creator-cancel">CANCEL</button><button type="button" class="utilitybtn" id="creator-back">Back</button><button type="button" class="enter-world" id="creator-next">Next</button><button type="submit" id="creator-submit" class="enter-world hidden">Create character</button></div>
        </form>
      </div>

      <div id="screen-custom" class="custom-browser shell-screen hidden">
        <header class="custom-head"><button class="tbtn" id="cu-back" type="button">Back</button><div><span>CUSTOM</span><h1>CUSTOM BATTLES</h1></div><div class="custom-identity"><b id="cu-character">COMMANDER</b><small id="cu-party">MULTIPLAYER</small></div></header>
        <aside class="custom-nav">
          <button class="custom-primary-tab sel" data-view="live" type="button">BROWSE GAMES</button>
          <button class="custom-primary-tab" data-view="arcade" type="button">MAPS</button>
          <div class="custom-filter-group" id="cu-mode-filters">
            <span>MODE</span>
            <button class="custom-filter sel" data-filter="all" type="button">ALL</button>
            <button class="custom-filter" data-filter="campaign" type="button">SIEGE</button>
            <button class="custom-filter" data-filter="survival" type="button">SURVIVAL</button>
            <button class="custom-filter" data-filter="labyrinth" type="button">LABYRINTH</button>
          </div>
          <label id="cu-status-label">STATUS<select id="cu-status"><option value="open">JOINABLE</option><option value="all">ALL</option><option value="playing">IN PROGRESS</option></select></label>
          <label>SEARCH<input id="cu-search" placeholder="Game, host, or map" autocomplete="off"></label>
          <div class="custom-arcade-shortcuts hidden" id="cu-arcade-shortcuts"><button data-arcade="all" class="sel" type="button">ALL MAPS</button><button data-arcade="recent" type="button">RECENT</button><button data-arcade="favorites" type="button">FAVORITES</button></div>
        </aside>
        <main class="custom-list-panel"><div class="custom-list-head"><span>GAME</span><span>MAP / MODE</span><span>PLAYERS</span><span>STATUS</span></div><div id="cu-list" class="custom-game-list"></div><div class="mphint" id="cu-note"></div></main>
        <aside class="custom-detail" id="cu-detail"><span class="modeeyebrow">SELECT A GAME</span><h2>NO GAME SELECTED</h2><p>Choose a game to inspect its map, rules, host, and party.</p></aside>
        <footer class="custom-actions">
          <button class="diffbtn" id="cu-refresh" type="button">Refresh</button>
          <button class="menubtn" id="cu-join" type="button" disabled>JOIN GAME</button>
          <button class="menubtn primary" id="cu-create" type="button">CREATE GAME</button>
          <button class="menubtn" hidden id="l-create-pub" type="button">Public room</button>
          <button class="menubtn" hidden id="l-create-priv" type="button">Private room</button>
          <button class="menubtn" id="l-create-join" type="button">Join by code</button>
          <a href="#" hidden id="l-manual">Manual invite codes</a>
        </footer>
        <div id="cu-create-panel" class="charcreate custom-create-panel hidden">
          <div class="cchead"><b>CREATE GAME</b><button class="tbtn" id="cu-cancel" type="button">Close</button></div>
          <label class="field-label" for="cu-name">Game name</label><input id="cu-name" maxlength="32" placeholder="Friday night siege" autocomplete="off">
          <label class="field-label">Map</label><select id="cu-map" class="cumap"></select>
          <label class="field-label">Difficulty</label><div class="diffseg" id="cu-diff"></div>
          <label class="field-label" for="cu-visibility">Visibility</label><select id="cu-visibility"><option value="public">Public — listed in browser</option><option value="private">Private — invite only</option></select><label class="field-label">Max players</label><div class="diffseg" id="cu-max"></div>
          <button class="menubtn primary" id="cu-confirm" type="button">HOST GAME</button>
        </div>
        <div id="screen-lobby" class="hidden"></div>
      </div>

      <div id="screen-credits" class="shell-screen hidden"><div class="setuphead"><button class="tbtn info-back" type="button">Back</button><h2>Credits</h2></div><div class="howto stats glass"><b>ZILLIONS</b><br>Created by 0xatd and the Taborlin agent crew.<br><br>Impact sounds by Kenney (kenney.nl), dedicated to the public domain under CC0.<br><br>Menu type is Rajdhani by the Indian Type Foundry, under the SIL Open Font License.<br><br>Humanity has one city left. The dead have every world.</div></div>

      <div id="screen-share" class="shell-screen hidden">
        <div class="setuphead"><button class="tbtn" id="share-back" type="button">Back</button><h2 id="share-title">Join a siege</h2></div>
        <div class="share-card glass" id="share-card"><span class="modeeyebrow">BATTLE INVITE</span><h3 id="share-card-title">Joining</h3><p class="mphint" id="share-card-copy"></p></div>
      </div>

      <div id="screen-quick" class="shell-screen hidden">
        <div class="setuphead"><button class="tbtn" id="q-back" type="button">Back</button><h2>One siege, then you are in</h2></div>
        <form id="quick-form" class="quick-form glass">
          <p class="affiliation-note">Campaign banner and recruitment preferences. Party membership, faction ranks, houses and empire relationships are coming soon; this banner does not make you a ruler.</p><label>Campaign banner<input id="q-chapter" maxlength="32" autocomplete="off" required></label>
          <label>Founder name<input id="q-founder" maxlength="18" autocomplete="off" required></label>
          <div class="steplabel">Culture <small>— the look of the base and the army the camps train</small></div>
          <div class="diffseg cultureseg" id="q-culture"></div>
          <div id="q-culture-detail" class="culture-detail"></div>
          <div class="quick-row">
            <label>Colors<select id="q-color"></select></label>
            <label>Insignia<select id="q-emblem"></select></label>
            <label>Difficulty<select id="q-diff"></select></label>
          </div>
          <div class="steplabel">Leaders <small>— Your founder leads first. Recruit companions through your chapter.</small></div>
          <div id="q-leaders" class="leader-grid"></div>
          <div id="q-abilities" class="qwer-bar" aria-label="Ability bar"></div>
          <div class="quick-actions">
            <button type="button" class="utilitybtn" id="q-random">Randomize</button>
            <button type="button" class="utilitybtn" id="q-invite">Invite a friend</button>
            <button type="submit" class="startbtn" id="q-start">START THE SIEGE</button>
          </div>
          <button type="button" class="textlink" id="q-save">Save progress later with Google or email</button>
        </form>
      </div>

      <div id="screen-daily" class="shell-screen hidden">
        <div class="setuphead"><button class="tbtn info-back" type="button">Back</button><h2>Daily Siege</h2></div>
        <div id="daily-brief" class="glass"></div>
        <div class="daily-actions"><button class="startbtn primary" id="daily-play" type="button">Play today's siege</button></div>
        <div id="daily-board"></div>
      </div>

      <div id="screen-setup" class="shell-screen hidden">
        <div class="setup-stage">
          <canvas id="setup-preview-canvas" aria-label="Loadout preview"></canvas>
          <div class="setuphead">
            <button class="tbtn roomexit" id="s-back" type="button">Back</button>
            <h2 id="s-title">Mission</h2>
            <button class="tbtn" id="s-invite" type="button">Invite</button>
          </div>
        </div>
        <div class="setup-options glass">
          <div id="modeseg" class="modeseg hidden"></div>
          <div class="steplabel field-label">Battlefield <span id="warstatus" class="warstatus"></span></div>
          <div class="levelrow" id="levelrow"></div>
          <div class="steplabel hero-label">Your hero <small>— right-click to move or attack-move. Abilities are <span data-bind-label="ability1"></span> <span data-bind-label="ability2"></span> <span data-bind-label="ability3"></span> <span data-bind-label="ability4"></span>. <span data-bind-label="camera_center"></span> centers the camera.</small></div>
          <div class="herorow" id="herorow"></div>
          <div class="steplabel culture-label">Colony culture <small>— the look of your base and the army your camps train</small></div>
          <div class="diffseg cultureseg" id="cultureseg"></div>
          <div id="culture-detail" class="culture-detail"></div>
          <div class="steplabel setup-leader-label">Leaders <small>— Recruit more leaders through your chapter.</small></div>
          <div id="setup-leaders" class="leader-grid"></div>
          <div id="setup-abilities" class="qwer-bar" aria-label="Ability bar"></div>
          <div class="steplabel diff-label">Difficulty</div>
          <div class="diffseg" id="diffseg"></div>
          <div id="mp-panel" class="staging hidden"></div>
          <button class="startbtn" id="s-start" type="button">Start the siege</button>
        </div>
      </div>

      <div id="screen-help" class="shell-screen hidden">
        <div class="setuphead"><button class="tbtn" id="h-back" type="button">Back</button><h2>How to play</h2></div>
        <div class="howto glass">
          <div><b>You are the hero.</b> Right-click ground to move or an enemy to pursue and attack. <kbd data-bind-label="attack_move"></kbd> + click attack-moves. <kbd data-bind-label="hero_stop"></kbd> stops; <kbd data-bind-label="hero_hold"></kbd> holds position. Move after your shot releases to kite; moving before release cancels the attack. In Fight mode, <kbd data-bind-label="ability1"></kbd> <kbd data-bind-label="ability2"></kbd> <kbd data-bind-label="ability3"></kbd> <kbd data-bind-label="ability4"></kbd> cast, and <kbd data-bind-label="dodge"></kbd> dodge-rolls. <kbd data-bind-label="camera_center"></kbd> centers the camera.</div>
          <div><b>One resource: gold.</b> Income is credited automatically; coins drop from kills, captured nodes and razed hives. Ride through them to collect.</div>
          <div><b>The city is pre-planned.</b> Use <kbd data-bind-label="build_mode"></kbd> for Build mode, then hold <kbd data-bind-label="dodge"></kbd> or <kbd data-bind-label="build"></kbd> at a glowing foundation.</div>
          <div><b>Camps are faucets.</b> Every camp musters a fresh formation on a timer, forever. Press <kbd data-bind-label="stance_push"></kbd> and those squads push the lanes together — no unit micro.</div>
          <div><b>Take the lane nodes.</b> Stand on one with no enemies nearby and it flips to you. Held nodes pay income, and you can raise a Forward Camp on them so squads muster at the front.</div>
          <div><b>Hives are stronger factories.</b> One nest outproduces one human camp and accelerates as Threat climbs. Raze it to stop it.</div>
          <div><b>Nothing repairs itself.</b> Build mode makes <kbd data-bind-label="dodge"></kbd> and <kbd data-bind-label="build"></kbd> build, repair, or rebuild. Fight mode makes dodge evade and enables abilities. Press <kbd data-bind-label="tower_priority"></kbd> beside a tower to change what it shoots first.</div>
          <div><b>Your army uses blended control.</b> Squads fight automatically. You set the plan: <b>F1</b> DEFEND city, <b>F2</b> FOLLOW hero, <b>F3</b> HUNT hives.</div>
          <div><b>Level up</b> from nearby kills. Spend upgrade points on Aura, Passive I, Passive II, or Ult Damage.</div>
          <div><b>Two weapon sets.</b> Press <kbd>X</kbd> to draw the other one. Every key here can be rebound in Settings. The swap has a cooldown, and Lattice nodes can be pinned to one set.</div>
          <div><b>Threat is the clock.</b> It rises on its own, faster while hives stand, and every whole level makes every hive muster at once. If the Keep falls, all is lost.</div>
        </div>
      </div>

      <div id="screen-pause" class="shell-screen hidden">
        <nav class="menu-list" aria-label="Pause">
          <button type="button" class="menu-word" id="p-resume">Resume</button>
          <button type="button" class="menu-word" id="p-help">How to play</button>
          <button type="button" class="menu-word" id="p-settings">Settings</button>
          <button type="button" class="menu-word" id="p-restart">Restart level</button>
          <button type="button" class="menu-word" id="p-invite">Invite</button>
          <button type="button" class="menu-word" id="p-quit">Quit to menu</button>
        </nav>
        <div id="p-note" class="gamesub glass"></div>
      </div>

      <div id="screen-settings" class="shell-screen hidden">
        <div class="setuphead"><button class="tbtn" id="set-back" type="button">Back</button><h2>Settings</h2></div>
        <div class="settingsgrid glass">
          <div class="settingstabs">
            <button class="stab sel" data-tab="audio" type="button">${icon('audio')} Audio</button>
            <button class="stab" data-tab="video" type="button">${icon('video')} Video</button>
            <button class="stab" data-tab="controls" type="button">${icon('controls')} Controls</button>
          </div>
          <div class="settingspane">
            <div id="set-pane-audio" class="setpane">
              <label class="setrow"><span>Master volume</span><input type="range" id="set-vol" min="0" max="100" value="100"><b id="set-vol-val">100%</b></label>
              <label class="setrow"><span>Music volume</span><input type="range" id="set-music" min="0" max="100" value="100"><b id="set-music-val">100%</b></label>
              <label class="setrow"><span>Sound effects</span><input type="checkbox" id="set-sfx"><b id="set-sfx-val"></b></label>
              <div class="sethint">Mute or restore sound anytime with <kbd>M</kbd>.</div>
            </div>
            <div id="set-pane-video" class="setpane hidden">
              <div class="setrow"><span>Graphics quality</span><div class="modeseg" id="set-quality"><button class="diffbtn" data-q="low" type="button">Low</button><button class="diffbtn" data-q="medium" type="button">Medium</button><button class="diffbtn" data-q="high" type="button">High</button><button class="diffbtn" data-q="auto" type="button">Auto</button></div></div>
              <div class="sethint">High gives the most detail. Medium and Low simplify distant units and effects for smoother play. Auto adjusts to your device.</div>
            </div>
            <div id="set-pane-controls" class="setpane hidden">
              <div class="bindhead"><p>Click any key to rebind it. Two actions that can be used at the same time may not share a key — rebinding onto one hands it the key you replaced.</p><button class="tbtn" id="set-binds-reset" type="button">Restore defaults</button></div>
              <div id="set-binds"></div>
            </div>
          </div>
        </div>
      </div>

      <div id="screen-results" class="shell-screen hidden"></div>

      <div id="room-confirm" class="confirm-sheet hidden" role="dialog" aria-modal="true" aria-labelledby="room-confirm-title">
        <div class="confirm-card glass">
          <h2 id="room-confirm-title" data-confirm-title>Leave lobby?</h2>
          <p id="room-confirm-copy" data-confirm-copy></p>
          <div class="roomconfirmactions">
            <button class="tbtn" id="room-confirm-cancel" data-confirm-no type="button">STAY</button>
            <button class="tbtn danger" id="room-confirm-leave" data-confirm-yes type="button">LEAVE LOBBY</button>
          </div>
        </div>
      </div>
    </div>`;
}
