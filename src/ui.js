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
  PLOT_KINDS, DIFFICULTY, LEVELS, levelById, isGalaxyLevel, ITEMS, PACK_SLOTS,
  HEROES, HERO_MAX_LEVEL, xpForLevel, abilityRank, LABYRINTH_LEVELS,
} from './config.js';
import { formatTime } from './utils.js';
import { TERRAIN_SHAPES, TerrainField } from './terrain.js';
import { CITY_PLANS } from './plots.js';
import { FOG_DARKNESS, FOG_EDGE_SOFTNESS, fogVisionSources } from './fog-of-war.js';

export class UI {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.msgSeen = 0;
    this.pauseOpen = false;
    this._buildDOM();
  }

  _buildDOM() {
    this.root.innerHTML = `
      <div id="topbar" class="hidden">
        <div class="res gold" id="r-gold" title="Gold — income is paid automatically, coins drop from fighting. Hold Space in Build mode, or B anytime, to spend at a foundation">🪙 <b>0</b></div>
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
      <div id="messages"></div>
      <button id="ow-menu" class="tbtn owmenu hidden" title="War council (Esc)">⚙</button>

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
            <span class="stance" data-st="defend" title="Hold the current city line"><b>1</b> 🛡️ Defend city</span><span class="stance" data-st="guard" title="Escort the hero"><b>2</b> 🚩 Follow hero</span><span class="stance" data-st="attack" title="Push the lanes: take nodes, then siege the hives"><b>3</b> ⚔️ Push lanes</span>
          </div>
          <button class="mode-toggle build" id="mode-toggle" title="Alt toggles Space between build and special ability"><b>ALT</b><span>Build mode</span></button>
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
            <div class="accountstatus" id="account-status">Checking account…</div>
            <button class="menubtn primary hidden" id="a-enter">ENTER WORLD</button>
            <button class="menubtn primary" id="a-google">ENTER WITH GOOGLE</button>
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
            <button id="a-custom">CUSTOM GAMES</button>
            <button id="a-cinematics">CINEMATICS</button>
            <button id="a-credits">CREDITS</button>
            <button id="a-settings">SETTINGS</button>
            <button id="a-quit">QUIT</button>
          </nav>
          <div class="planet-status"><span class="online-pip"></span> EARTH FRONT · ONLINE <small>BUILD 0.1</small></div>
        </div>

        <div id="screen-main" class="mainmenu character-select">
          <div class="character-heading"><span>EARTH FRONT</span><h1>SELECT YOUR HERO</h1><small>Choose who enters the persistent world. Press C in the world to open this character screen.</small></div>
          <div id="character-stage" class="character-stage">
            <div id="character-sigil" class="character-sigil"></div>
            <div class="character-copy"><h2 id="character-name"></h2><p id="character-tagline"></p><div id="character-gear" class="character-gear"></div></div>
          </div>
          <aside class="character-roster"><div id="character-list"></div><button class="enter-world" id="m-enter-world">ENTER WORLD</button><button class="character-custom" id="m-custom">CUSTOM GAMES</button></aside>
          <div class="character-footer"><div class="profilerow"><span id="prof-name-display">Signed in</span><span id="prof-stats"></span></div><button class="utilitybtn" id="m-logout">← TITLE SCREEN</button><button class="utilitybtn" id="m-settings">SETTINGS</button><button class="utilitybtn" id="m-help">HOW TO PLAY</button><button class="utilitybtn hidden" id="m-online">ONLINE</button><button class="utilitybtn hidden" id="m-solo">SOLO</button><button class="utilitybtn hidden" id="m-heroes">HEROES</button></div>
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

        <div id="screen-cinematics" class="setup hidden"><div class="setuphead"><button class="tbtn info-back">← Back</button><h2>Cinematics</h2></div><div class="howto stats">The opening transmission and campaign cinematics will appear here as they are recovered.</div></div>
        <div id="screen-credits" class="setup hidden"><div class="setuphead"><button class="tbtn info-back">← Back</button><h2>Credits</h2></div><div class="howto stats"><b>ZILLIONS</b><br>Created by 0xatd and the Taborlin agent crew.<br><br>Humanity has one city left. The dead have every world.</div></div>

        <div id="screen-setup" class="setup hidden">
          <div class="setuphead">
            <button class="tbtn roomexit" id="s-back">← Back</button>
            <h2 id="s-title">Choose your battle</h2>
            <div id="modeseg" class="modeseg hidden"></div>
          </div>
          <div class="steplabel field-label">1 · Battlefield <span id="warstatus" class="warstatus"></span></div>
          <div class="levelrow" id="levelrow"></div>
          <div class="steplabel hero-label">2 · Your hero <small>— auto-attacks on his own; you steer with WASD and fire the special with SPACE/Q</small></div>
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
            <div><b>🕹️ You are the hero.</b> WASD to move, SHIFT to gallop (full health only). You auto-attack anything in range, and a passive aura hums around you — just ride.</div>
            <div><b>🪙 One resource: gold.</b> Income is credited automatically; coins drop from kills, captured nodes and razed hives. Ride through them to collect.</div>
            <div><b>🏗️ The city is pre-planned.</b> ALT toggles Space between Build and Fight. In Build mode, hold <b>SPACE</b> or <b>B</b> at a glowing foundation — coins fly from your purse until it rises. Same to upgrade. Fight mode hides vacant build markers so combat stays clear.</div>
            <div><b>⚔️ Camps are faucets.</b> Every camp musters a fresh formation on a timer, forever. Press <kbd>3</kbd> and those squads push the lanes together — no unit micro.</div>
            <div><b>🚩 Take the lane nodes.</b> Stand on one with no enemies nearby and it flips to you. Held nodes pay income, and you can raise a Forward Camp on them so squads muster at the front.</div>
            <div><b>🔥 Hives are stronger factories.</b> One nest outproduces one human camp and accelerates as Threat climbs. Its dead do not form ranks; they flood. Raze it to stop it.</div>
            <div><b>🔧 Nothing repairs itself.</b> ALT toggles Build/Fight mode. In Build mode, hold SPACE or B to build, repair, or rebuild. In Fight mode, SPACE fires your special and B still builds. Press <kbd>T</kbd> beside a tower to change what it shoots first.</div>
            <div><b>⚔️ Your army uses blended control.</b> Squads fight automatically. You set the plan: <b>1</b> DEFEND city, <b>2</b> FOLLOW hero, <b>3</b> HUNT hives.</div>
            <div><b>👑 Level up</b> from nearby kills. Spend upgrade points on Aura, Passive I, Passive II, or Ult Damage.</div>
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
    q('#a-enter').onclick = () => { this._accountAccepted = true; this._showScreen('main'); };
    q('#a-offline').onclick = () => { this._offlineAccepted = true; if (this.cb.onOfflineContinue) this.cb.onOfflineContinue(); };
    q('#a-custom').onclick = () => this._showScreen('solo');
    q('#a-cinematics').onclick = () => this._showScreen('cinematics');
    q('#a-credits').onclick = () => this._showScreen('credits');
    q('#a-settings').onclick = () => { this._settingsReturn = 'account'; this._showScreen('settings'); };
    q('#a-quit').onclick = () => this.showBanner('Close this browser tab to leave the frontier.', '', 3200);
    q('#a-username-form').onsubmit = (e) => {
      e.preventDefault();
      const input = q('#a-username');
      if (this.cb.onUsername) this.cb.onUsername(input.value);
    };
    q('#m-solo').onclick = () => this._showScreen('solo');
    q('#m-online').onclick = () => { this._showScreen('lobby'); if (this.cb.onLobbyOpen) this.cb.onLobbyOpen(); };
    q('#m-help').onclick = () => this._showScreen('help');
    q('#m-enter-world').onclick = () => this.cb.onCampaignMap && this.cb.onCampaignMap();
    q('#m-custom').onclick = () => this._showScreen('solo');
    q('#m-logout').onclick = () => this._showScreen('account');
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
    for (const back of this.root.querySelectorAll('.info-back')) back.onclick = () => this._showScreen(this._accountAccepted ? 'main' : 'account');

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
      else this._showScreen('main');
    };

    // ----- settings -----
    q('#m-settings').onclick = () => { this._settingsReturn = 'main'; this._showScreen('settings'); };
    q('#m-heroes').onclick = () => this._showScreen('heroes');
    q('#hero-back').onclick = () => this._showScreen('main');
    q('#p-settings').onclick = () => { this._settingsFromPause = true; this._showScreen('settings'); };
    q('#set-back').onclick = () => {
      if (this._settingsFromPause) { this._settingsFromPause = false; this._showScreen('pause'); }
      else this._showScreen(this._settingsReturn || 'main');
    };
    for (const t of this.root.querySelectorAll('.stab')) {
      t.onclick = () => {
        for (const o of this.root.querySelectorAll('.stab')) o.classList.toggle('sel', o === t);
        this.root.querySelector('#set-pane-audio').classList.toggle('hidden', t.dataset.tab !== 'audio');
        this.root.querySelector('#set-pane-video').classList.toggle('hidden', t.dataset.tab !== 'video');
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
    this.root.querySelector('#s-start')?.click();
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
    for (const id of ['account', 'main', 'solo', 'setup', 'help', 'pause', 'lobby', 'settings', 'heroes', 'cinematics', 'credits']) {
      this.root.querySelector('#screen-' + id).classList.toggle('hidden', id !== name);
    }
  }

  _buildCharacterSelect() {
    const list = this.root.querySelector('#character-list');
    if (!list) return;
    list.innerHTML = '';
    for (const [key, hero] of Object.entries(HEROES)) {
      const button = document.createElement('button');
      button.className = 'character-row';
      button.dataset.key = key;
      button.innerHTML = `${PORTRAITS[key] ? `<img src="${PORTRAITS[key]}" alt="">` : `<span>${hero.icon}</span>`}<span><b>${hero.name}</b><small></small></span>`;
      button.onclick = () => {
        this.selectedHero = key;
        this._renderSelectedCharacter();
        for (const card of this.root.querySelectorAll('.herocard')) card.classList.toggle('sel', card.dataset.key === key);
        if (this.cb.onHeroPick) this.cb.onHeroPick(key);
      };
      list.appendChild(button);
    }
    this._renderSelectedCharacter();
  }

  _renderSelectedCharacter() {
    const key = this.selectedHero || 'alexander';
    const hero = HEROES[key];
    if (!hero) return;
    const progress = (this._profile?.campaignHeroes || {})[key] || {};
    const level = progress.level || 1;
    const gear = (progress.items || []).map((itemKey) => ITEMS[itemKey]).filter(Boolean);
    for (const row of this.root.querySelectorAll('.character-row')) {
      const selected = row.dataset.key === key;
      row.classList.toggle('sel', selected);
      const small = row.querySelector('small');
      if (small) small.textContent = `Level ${((this._profile?.campaignHeroes || {})[row.dataset.key]?.level) || 1}`;
    }
    const sigil = this.root.querySelector('#character-sigil');
    sigil.textContent = PORTRAITS[key] ? '' : hero.icon;
    sigil.style.backgroundImage = PORTRAITS[key]
      ? `linear-gradient(180deg, transparent 55%, rgba(3,7,13,.85)), url(${PORTRAITS[key]})`
      : '';
    sigil.classList.toggle('has-portrait', !!PORTRAITS[key]);
    sigil.style.setProperty('--hero-color', `#${hero.color.toString(16).padStart(6, '0')}`);
    this.root.querySelector('#character-name').textContent = `${hero.name} · LEVEL ${level}`;
    this.root.querySelector('#character-tagline').textContent = hero.tagline;
    this.root.querySelector('#character-gear').innerHTML = gear.length
      ? gear.map((item) => `<span>${item.icon} ${item.name}</span>`).join('')
      : '<span class="empty-gear">Frontier issue gear · no recovered sets</span>';
  }

  // ----- overworld: the campaign map behind the war-council overlay -----
  // The title screen remains the front door. Story Campaign enters the
  // walkable planet; Esc (or the ⚙ button) opens the council over it.
  setOverworldMode(on) {
    this._overworldMode = !!on;
    this.root.querySelector('#overlay').classList.toggle('overworld', !!on);
    this.root.querySelector('#ow-menu').classList.toggle('hidden', !on);
  }

  overlayHidden() {
    return this.root.querySelector('#overlay').classList.contains('hidden');
  }

  hideOverlay() {
    this.root.querySelector('#overlay').classList.add('hidden');
  }

  toggleOverlay() {
    // Esc always brings up the hub home — the deep screens (lobby, settings)
    // are one click from its buttons, and the walk is the point.
    if (this.overlayHidden()) this._showScreen('main');
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
  showGateConfirm({ gate, diff = 'normal', onEnter }) {
    let modal = this.root.querySelector('#gate-confirm');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'gate-confirm';
      modal.className = 'roomconfirm';
      this.root.appendChild(modal);
    }
    const cave = !!gate.cave;
    const diffSeg = cave ? '' : `
      <div class="steplabel field-label">Difficulty</div>
      <div class="diffseg gate-diff">${Object.entries(DIFFICULTY).map(([key, d]) =>
        `<button class="diffbtn${key === diff ? ' sel' : ''}" data-diff="${key}">${d.label}</button>`).join('')}</div>`;
    modal.innerHTML = `
      <div class="roomconfirmcard">
        <span class="roomeyebrow">The road onward</span>
        <h2>${cave ? '🌀 Enter the Labyrinth?' : `⚔️ Enter ${gate.name}?`}</h2>
        <p>${cave
          ? 'A dark mouth in the crag. No colony, no army — one hero against the deep.'
          : gate.blurb}</p>
        ${cave ? '' : `<p class="gateboss">${gate.boss.icon} <b>${gate.boss.name}</b> leads the counterattack.</p>`}
        ${diffSeg}
        <div class="roomconfirmactions">
          <button class="tbtn" id="gate-back">NOT YET</button>
          <button class="tbtn danger" id="gate-go">${cave ? 'OPEN THE TRIAL LEDGER' : 'ENTER'}</button>
        </div>
      </div>`;
    const close = () => modal.classList.add('hidden');
    modal.querySelector('#gate-back').onclick = close;
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
    this.root.querySelector('#screen-setup').classList.toggle('roommode', !!online);
    this._loadHeroPortraits();
    const title = online
      ? `🌐 ${online.visibility === 'private' ? 'Private' : 'Public'} game — code ${online.join_code}`
      : coop ? 'Co-op — one city, one hero each'
      : mode === 'survival' ? '💀 Survival — how high can you drive the Threat?'
      : mode === 'labyrinth' ? '🌀 The Labyrinth — no colony, no army, no way but through'
      : 'Choose your battle';
    this.root.querySelector('#s-title').textContent = title;
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
        <div class="mprow"><span class="mpstatus ok" id="online-status">🟢 Live — waiting for players. Share code <b>${online.join_code}</b> from the lobby.</span></div>
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
        maxPlayers: online.max_players || 3,
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
      `<span class="tfx">${a.icon} <b>${a.name}</b> — SPACE/Q, ${a.cd}s cooldown</span><br><span class="tdesc">${a.desc}</span>` +
      `<br><span class="tdesc">Level-ups grant upgrade points for Aura, Passive I, Passive II, or Ult Damage.</span>`;
  }

  // ---------- in-game HUD ----------

  initHUD(game, p) {
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
    const face = this.root.querySelector('#a-face');
    face.innerHTML = PORTRAITS[d.key] ? `<img src="${PORTRAITS[d.key]}" loading="lazy" decoding="async" onerror="this.parentElement.textContent='${d.icon}'" alt="">` : d.icon;
    this.root.querySelector('#a-name').textContent = d.name;
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
    const fight = mode === 'fight';
    chip.classList.toggle('fight', fight);
    chip.classList.toggle('build', !fight);
    const label = chip.querySelector('span');
    if (label) label.textContent = fight ? 'Fight mode' : 'Build mode';
    chip.title = fight
      ? 'Fight mode: Space fires the hero special. Hold B to build. Alt toggles.'
      : 'Build mode: Space/B builds. Auto-attacks still run. Alt toggles.';
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
      const army = game.units.filter((u) => !u.hero && !u.dead).length;
      const squads = new Set(game.units.filter((u) => !u.hero && !u.dead && u.squadId).map((u) => u.squadId)).size;
      const stanceText = {
        defend: 'holding the city line',
        guard: 'following your hero',
        attack: 'pushing the lanes',
      }[game.stance] || 'awaiting orders';
      q('#army-status').innerHTML = army
        ? `<b>${army}</b> troops in <b>${squads || army}</b> formations · ${stanceText} · camps keep mustering`
        : 'Build militia, ranger, or sniper camps — they muster squads forever.';
    }
    q('#r-z').innerHTML = `🧟 ${game.zombies.length}`;

    // Hero plate.
    const h = game.heroes[p];
    if (h) {
      q('#a-lvl').textContent = h.dead ? `☠️ ${Math.ceil(h.reviveT)}s` : `Lv ${h.level}`;
      q('#a-hp').style.width = `${Math.max(0, (h.hp / h.maxHp) * 100)}%`;
      const need = xpForLevel(h.level);
      q('#a-xp').style.width = h.level >= HERO_MAX_LEVEL ? '100%' : `${(h.xp / need) * 100}%`;

      // Item row: the gear this hero carries through the campaign.
      const itemsKey = (h.items || []).join(',');
      if (this._itemsKey !== itemsKey) {
        this._itemsKey = itemsKey;
        q('#a-items').innerHTML = (h.items || [])
          .map((k) => (ITEMS[k] ? `<span class="hitem" title="${ITEMS[k].name} — ${ITEMS[k].desc}">${ITEMS[k].icon}</span>` : ''))
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
          const it = key ? ITEMS[key] : null;
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
        big.innerHTML = `<span class="bicon">🏳️</span><span class="btext">${near ? 'Found the city HERE' : 'Ride to a flagged site…'}<small>SPACE</small></span>`;
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
          big.innerHTML = `<span class="bicon">🏗️</span><span class="btext">${verb} ${name}<small>Hold SPACE/B · ${cost}🪙 · ALT fight</small></span>`;
          big.disabled = h.dead;
        } else {
          this._bigMode = 'idle';
          big.className = 'bigaction build';
          big.innerHTML = `<span class="bicon">🏗️</span><span class="btext">Build mode<small>Auto-attacks on · ride to a plot · ALT fight</small></span>`;
          big.disabled = true;
        }
      } else {
        this._bigMode = 'cast';
        const cd = Math.max(0, h.abilCd);
        const rank = abilityRank(h.level, h.upgrades);
        const ultRank = (h.upgrades?.ult || 0);
        big.className = 'bigaction cast' + (cd > 0 || h.dead ? ' cooling' : ' ready');
        big.innerHTML = `<span class="bicon">${ab.icon}</span><span class="btext">${ab.name} <small>${'●'.repeat(rank)}${'○'.repeat(3 - rank)} · ULT ${ultRank}/3 · SPACE${controlMode === 'fight' ? ' · ALT build' : ''}</small></span>` +
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
      const it = ITEMS[k];
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
    const enter = this.root.querySelector('#a-enter');
    const google = this.root.querySelector('#a-google');
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
    if (enter) enter.classList.toggle('hidden', !state.signedIn);
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
        ? `${p.wins}W / ${p.games - p.wins}L · ${p.kills.toLocaleString()} kills · best: Threat ${p.bestDay}`
        : 'first deployment';
    }
    this.refreshHeroBadges(p);
    this._renderSelectedCharacter();
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
      badge.title = items.map((k) => ITEMS[k] ? `${ITEMS[k].icon} ${ITEMS[k].name}` : k).join('\n');
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
    maxPlayers = 3,
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
    this.root.querySelector('#ow-menu')?.classList.add('hidden');
    this.pauseOpen = false;
  }

  showPause(netMode, help = false, quests = null) {
    this.pauseOpen = true;
    this._showScreen(help ? 'help' : 'pause');
    const note = this.root.querySelector('#p-note');
    const questHtml = (quests || []).map((q) => {
      const it = ITEMS[q.reward];
      return `<div class="questrow ${q.claimed ? 'done' : q.done ? 'done' : ''}">${q.claimed ? '🏅' : q.done ? '✅' : '⬜'} <b>${q.name}</b> — ${q.desc}${it ? ` <span class="qreward">${it.icon} ${it.name}</span>` : ''}</div>`;
    }).join('');
    note.innerHTML = (questHtml ? `<div class="questbox"><div class="steplabel">SIDE QUESTS</div>${questHtml}</div>` : '')
      + (netMode ? '⚠️ Co-op keeps running while this menu is open.' : '');
  }

  hidePause() {
    this.pauseOpen = false;
    this.root.querySelector('#overlay').classList.add('hidden');
  }

  showEnd(won, stats, threat, levelId, mode = 'campaign', best = 0, extra = null) {
    this.pauseOpen = false;
    const ov = this.root.querySelector('#overlay');
    ov.classList.remove('hidden');
    const lv = levelById(levelId || 1);
    const survival = mode === 'survival';
    const labyrinth = mode === 'labyrinth';
    const questRows = (extra && extra.quests || []).map((q) => {
      const it = ITEMS[q.reward];
      return `<div class="questrow ${q.done ? 'done' : ''}">${q.done ? '✅' : '⬜'} <b>${q.name}</b> — ${q.desc}
        <span class="qreward">${it ? `${it.icon} ${it.name}` : ''}</span></div>`;
    }).join('');
    const grants = (extra && extra.grants || []).map((k) => ITEMS[k]).filter(Boolean);
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
        ${questRows ? `<div class="questbox"><div class="steplabel">SIDE QUESTS</div>${questRows}</div>` : ''}
        ${extra ? `<p class="tagline">⭐ <b>${extra.heroName}</b> marches on at level ${extra.level}${grants.length
          ? ` — gained ${grants.map((it) => `${it.icon} <b>${it.name}</b>`).join(', ')}` : ''}.</p>` : ''}
        ${!survival && !labyrinth && won ? `<p class="tagline">🔓 Unlocked: <b>${levelById(lv.id + 1).name}</b>${lv.id >= LEVELS.length ? ' — deeper into the galaxy' : ''}</p>` : ''}
        <button class="startbtn" id="b-restart">${won ? 'Continue' : 'Try again'}</button>
      </div>`;
    ov.querySelector('#b-restart').onclick = () => this.cb.onRestart();
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
        <span class="ginfo">${g.mode === 'survival' ? '💀 Survival' : g.mode === 'labyrinth' ? '🌀 Labyrinth' : '⚔️ Campaign'} · ${lv ? lv.name : '?'} · ${g.players}/${g.max_players || 3}</span>
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
    for (const n of game.nests || []) {
      if (!n.alive) continue;
      ctx.fillStyle = '#b44dff';
      ctx.fillRect(n.x - 2, n.z - 2, 4, 4);
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

    // Match the battlefield shroud. Draw this after world markers so enemies,
    // nests, loot, and terrain outside allied vision disappear together. The
    // camera frame remains visible below as navigation chrome.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(1, 2, 5, ${FOG_DARKNESS})`;
    ctx.fillRect(0, 0, N, N);
    ctx.globalCompositeOperation = 'destination-out';
    for (const source of fogVisionSources(game)) {
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
