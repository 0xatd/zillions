// DOM HUD & menus. Menu flow: WC3-style main menu (buttons over the live 3D
// battlefield) → SC2-style setup screen (level / hero / difficulty / START).
// In-game: Thronefall HUD — gold, current siege state, and one big contextual
// action button.
const PORTRAITS = {
  alexander: 'assets/heroes/portraits/alexander_256.webp',
  scott: 'assets/heroes/portraits/scott_256.webp',
  danny: 'assets/heroes/portraits/danny_256.webp',
};
import {
  PLOT_KINDS, DIFFICULTY, LEVELS, ITEMS,
  HEROES, HERO_MAX_LEVEL, xpForLevel, abilityRank,
} from './config.js';
import { formatTime } from './utils.js';

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
            </div>
          </div>
          <div id="herostats" class="herostats"></div>
          <div id="upgradepanel" class="hidden"></div>
          <button id="bigaction" class="bigaction"></button>
        </div>
        <div id="branchpanel" class="hidden"></div>
        <div id="buildhint" class="hidden"></div>
      </div>

      <div id="minimap-wrap" class="hidden">
        <canvas id="minimap-base"></canvas>
        <canvas id="minimap-top"></canvas>
      </div>

      <div id="tooltip" class="hidden"></div>

      <div id="overlay" class="screen">
        <div id="screen-account" class="accountscreen">
          <h1 class="gametitle">🧟 ZILLIONS</h1>
          <p class="gamesub">Sign in to enter the frontier.</p>
          <div class="accountcard">
            <div class="accountstatus" id="account-status">Checking account…</div>
            <button class="menubtn primary" id="a-google">Continue with Google</button>
            <button class="menubtn hidden" id="a-offline">Continue in offline dev mode</button>
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
        </div>

        <div id="screen-main" class="mainmenu">
          <h1 class="gametitle">🧟 ZILLIONS</h1>
          <p class="gamesub">Raise a city. Push the lanes. Take the planet.</p>
          <div class="menustack">
            <button class="menubtn primary" id="m-play">⚔️ &nbsp;Campaign</button>
            <div id="m-continuerow"></div>
            <button class="menubtn" id="m-survival">💀 &nbsp;Survival <small>endless siege</small></button>
            <button class="menubtn" id="m-online">🌐 &nbsp;Online Lobby <small>games · chat · friends</small></button>
            <button class="menubtn" id="m-help">📜 &nbsp;How to play</button>
          </div>
          <div class="profilerow">
            <span id="prof-name-display">Signed in</span>
            <span id="prof-stats"></span>
          </div>
        </div>

        <div id="screen-setup" class="setup hidden">
          <div class="setuphead">
            <button class="tbtn" id="s-back">← Back</button>
            <h2 id="s-title">Choose your battle</h2>
          </div>
          <div class="steplabel">1 · Battlefield</div>
          <div class="levelrow" id="levelrow"></div>
          <div class="steplabel">2 · Your hero <small>— auto-attacks on his own; you steer with WASD and fire the special with SPACE/Q</small></div>
          <div class="herorow" id="herorow"></div>
          <div class="steplabel">3 · Difficulty</div>
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
                  <button class="diffbtn sel" id="l-create-pub">🌐 Create public game</button>
                  <button class="diffbtn" id="l-create-priv">🔒 Create private game</button>
                  <span class="joincode"><input id="l-joincode" maxlength="6" placeholder="CODE"><button class="tbtn" id="l-joinbtn">Join</button></span>
                </div>
                <div id="l-games" class="lobbygames"></div>
                <div class="mphint">Public games appear here for everyone. Private games are joined by code. <a href="#" id="l-manual">Manual invite codes</a> work without the internet lobby.</div>
              </div>
              <div id="l-tab-lore" class="ltabpane hidden"></div>
              <div id="l-tab-tips" class="ltabpane hidden"></div>
            </div>
            <div class="lobbyfriends">
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
            <div><b>⚔️ Camps are faucets.</b> Every camp musters a fresh squad on a timer, forever. Press <kbd>3</kbd> and the army pushes out along the lanes on its own — no unit micro.</div>
            <div><b>🚩 Take the lane nodes.</b> Stand on one with no enemies nearby and it flips to you. Held nodes pay income, and you can raise a Forward Camp on them so squads muster at the front.</div>
            <div><b>🔥 Hives never stop.</b> Each living nest musters its own squads, faster as Threat climbs. Raze them all — then break the counterattack their champion leads.</div>
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
            <button class="menubtn" id="p-restart">🔄 &nbsp;Restart level</button>
            <button class="menubtn" id="p-quit">🚪 &nbsp;Quit to menu</button>
          </div>
          <div id="p-note" class="gamesub"></div>
        </div>
      </div>`;

    // ----- main menu -----
    const q = (s) => this.root.querySelector(s);
    q('#a-google').onclick = () => this.cb.onSignIn && this.cb.onSignIn();
    q('#a-offline').onclick = () => this.cb.onOfflineContinue && this.cb.onOfflineContinue();
    q('#a-username-form').onsubmit = (e) => {
      e.preventDefault();
      const input = q('#a-username');
      if (this.cb.onUsername) this.cb.onUsername(input.value);
    };
    q('#m-play').onclick = () => this.showSetup({ mode: 'campaign' });
    q('#m-survival').onclick = () => this.showSetup({ mode: 'survival' });
    q('#m-online').onclick = () => { this._showScreen('lobby'); if (this.cb.onLobbyOpen) this.cb.onLobbyOpen(); };
    q('#m-help').onclick = () => this._showScreen('help');
    q('#s-back').onclick = () => this._showScreen(this._fromLobby ? 'lobby' : 'main');
    q('#l-back').onclick = () => this._showScreen('main');

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
    q('#l-joinbtn').onclick = () => this.cb.onJoinCode && this.cb.onJoinCode(q('#l-joincode').value);
    q('#l-manual').onclick = (e) => { e.preventDefault(); this.showSetup({ coop: true }); };
    q('#h-back').onclick = () => {
      if (this.pauseOpen) this._showScreen('pause');
      else this._showScreen('main');
    };

    // ----- pause menu -----
    q('#p-resume').onclick = () => this.cb.onResume();
    q('#p-help').onclick = () => this._showScreen('help');
    q('#p-restart').onclick = () => this.cb.onRestart();
    q('#p-quit').onclick = () => this.cb.onQuit();

    // ----- setup: hero cards -----
    this.selectedHero = 'alexander';
    const herorow = q('#herorow');
    for (const [key, h] of Object.entries(HEROES)) {
      const card = document.createElement('button');
      card.className = 'herocard' + (key === this.selectedHero ? ' sel' : '');
      card.dataset.key = key;
      card.innerHTML = `
        <img class="hface" data-src="${PORTRAITS[key]}" loading="lazy" decoding="async" onerror="this.remove()" alt="">
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

  _showScreen(name) {
    const ov = this.root.querySelector('#overlay');
    ov.classList.remove('hidden');
    for (const id of ['account', 'main', 'setup', 'help', 'pause', 'lobby']) {
      this.root.querySelector('#screen-' + id).classList.toggle('hidden', id !== name);
    }
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
    this._loadHeroPortraits();
    const title = online
      ? `🌐 ${online.visibility === 'private' ? 'Private' : 'Public'} game — code ${online.join_code}`
      : coop ? 'Co-op — one city, one hero each'
      : mode === 'survival' ? '💀 Survival — how high can you drive the Threat?'
      : 'Choose your battle';
    this.root.querySelector('#s-title').textContent = title;
    this._buildLevelRow(this._campaignCleared || 0, mode === 'survival');
    this.setStartButton({
      text: mode === 'survival'
        ? '▶  START — SURVIVE AS LONG AS YOU CAN'
        : '▶  START — TAKE THE PLANET',
      disabled: false,
      title: '',
    });
    const mp = this.root.querySelector('#mp-panel');
    mp.classList.toggle('hidden', !coop && !online);
    if (online) {
      mp.dataset.init = '1';
      mp.innerHTML = `
        <div class="mprow"><span class="mpstatus ok" id="online-status">🟢 Live — waiting for players. Share code <b>${online.join_code}</b> from the lobby.</span></div>
        <div id="room-roster" class="roomroster"></div>
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

  _buildLevelRow(cleared, allUnlocked = false) {
    this._campaignCleared = cleared;
    const row = this.root.querySelector('#levelrow');
    row.innerHTML = '';
    this.selectedLevel = allUnlocked ? 1 : Math.min(cleared + 1, LEVELS.length);
    for (const lv of LEVELS) {
      const locked = allUnlocked ? false : lv.id > cleared + 1;
      const done = lv.id <= cleared;
      const card = document.createElement('button');
      card.className = 'levelcard' + (lv.id === this.selectedLevel ? ' sel' : '') + (locked ? ' locked' : '');
      card.dataset.level = lv.id;
      card.disabled = locked;
      card.innerHTML = `
        <span class="lvnum">${done ? '✅' : locked ? '🔒' : lv.id}</span>
        <b>${lv.name}</b>
        <small>${lv.blurb}</small>
        <span class="lvboss">${lv.boss.icon} ${lv.boss.name}</span>`;
      if (!locked) {
        card.onclick = () => {
          this.selectedLevel = lv.id;
          for (const c of row.children) c.classList.toggle('sel', c === card);
          if (this.cb.onLevelPick) this.cb.onLevelPick(lv.id);
        };
        card.onmouseenter = (e) => this._showTip(e, `<b>${lv.boss.icon} ${lv.boss.name}</b><br><span class="tdesc">${lv.boss.desc}</span>`);
        card.onmousemove = (e) => this._moveTip(e);
        card.onmouseleave = () => this._hideTip();
      }
      row.appendChild(card);
    }
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
    const held = game.heldNodes ? game.heldNodes() : 0;
    const nests = game.liveNests ? game.liveNests() : 0;
    const frac = Math.max(0, Math.min(1, (game.threat || 0) % 1));
    q('#r-day').innerHTML = game.phase === 'found'
      ? '🏳️ <b>Claim your ground</b>'
      : game.finalStand
        ? '☠️ <b>Final counterattack</b>'
        : `☠️ <b>Threat ${game.threatLevel}</b><i class="threatbar" style="--f:${(frac * 100).toFixed(0)}%"></i>`;
    q('#r-day').classList.toggle('danger', !!game.finalStand || frac > 0.85);
    const total = game.activeNodes ? game.activeNodes().length : game.nodes.length;
    q('#r-front').innerHTML = `🚩 <b>${held}</b>/${total} · 🔥 <b>${nests}</b>`;
    q('#r-front').classList.toggle('danger', held === 0 && game.phase !== 'found');

    // Active army stance chip.
    if (this._stance !== game.stance) {
      this._stance = game.stance;
      for (const chip of this.root.querySelectorAll('#stancebar .stance')) {
        chip.classList.toggle('sel', chip.dataset.st === game.stance);
      }
    }
    const army = game.units.filter((u) => !u.hero && !u.dead).length;
    const stanceText = {
      defend: 'holding the city line',
      guard: 'following your hero',
      attack: 'pushing the lanes',
    }[game.stance] || 'awaiting orders';
    // Show the supply ceiling, not just the count: when it is full, the way to
    // field more is to go and take more ground.
    const cap = game.unitCap ? game.unitCap() : army;
    const full = army >= cap;
    q('#army-status').innerHTML = army
      ? `<b>${army}</b>/${cap} supply · ${stanceText}${full ? ' · <b>take ground for more</b>' : ''}`
      : 'Build militia, ranger, or sniper camps — they muster squads forever.';
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
    if (offline) offline.classList.toggle('hidden', !offlineAllowed || !!state.signedIn);
    if (usernameForm) usernameForm.classList.toggle('hidden', !needsUsername);
    if (needsUsername) {
      this._accountAccepted = false;
      this._showScreen('account');
      setTimeout(() => usernameInput && usernameInput.focus(), 0);
      return;
    }
    if (state.ready && (state.signedIn || offlineAllowed)) {
      if (!this._accountAccepted) {
        this._accountAccepted = true;
        this._showScreen('main');
      }
      return;
    }
    this._accountAccepted = false;
    this._showScreen('account');
  }

  setProfile(p) {
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
  }

  setContinue(snap) {
    const row = this.root.querySelector('#m-continuerow');
    if (!row) return;
    if (!snap) { row.innerHTML = ''; return; }
    const players = snap.heroKeys.length;
    row.innerHTML = `<button class="menubtn" id="b-continue">📂 &nbsp;Continue <small>Threat ${snap.threatLevel || 1}, ${snap.diff}${players > 1 ? `, ${players} players` : ''}</small></button>`;
    row.querySelector('#b-continue').onclick = () => this.cb.onContinue();
  }

  setWaiting(on, text = '⏳ Syncing co-op…') {
    const el = this.root.querySelector('#waitind');
    if (!el) return;
    if (text && el.textContent !== text) el.textContent = text;
    el.classList.toggle('hidden', !on);
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
    const modeCopy = mode === 'survival' ? 'Survival' : 'Campaign';
    const safeCode = String(code || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
    const slots = [];
    for (let seat = 1; seat <= maxPlayers; seat++) {
      const p = bySeat.get(seat);
      if (p) {
        const label = p.host ? 'HOST' : `P${seat}`;
        const hero = this._heroName(p.hero);
        const state = p.ready ? 'ready'
          : p.state === 'connected' || p.state === 'online' ? 'in room'
          : p.state === 'offline' ? 'offline'
          : 'joining';
        slots.push(`
          <div class="roomslot ${p.host ? 'host' : ''} ${p.you ? 'you' : ''}">
            <span class="roomseat">${label}</span>
            <b></b>
            <small>${hero} · ${state}</small>
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
      <div class="roomlaunch ${isHost ? 'host' : 'guest'}">
        <div>
          <span class="roomeyebrow">${modeCopy} room${safeCode ? ` · ${safeCode}` : ''}</span>
          <b>${filled}/${maxPlayers} players in lobby</b>
          <small>${launchCopy}</small>
        </div>
      </div>
      <div class="roomslots">${slots.join('')}</div>`;
    const names = box.querySelectorAll('.roomslot:not(.open) b');
    let i = 0;
    for (let seat = 1; seat <= maxPlayers; seat++) {
      const p = bySeat.get(seat);
      if (p && names[i]) {
        names[i].textContent = p.you ? `${p.name || 'You'} (you)` : (p.name || `Player ${seat}`);
        i++;
      }
    }
  }

  addPing(x, z) { this.pings.push({ x, z, t: 4 }); }

  hideStart() {
    this.root.querySelector('#overlay').classList.add('hidden');
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
    const lv = LEVELS[(levelId || 1) - 1];
    const survival = mode === 'survival';
    const questRows = (extra && extra.quests || []).map((q) => {
      const it = ITEMS[q.reward];
      return `<div class="questrow ${q.done ? 'done' : ''}">${q.done ? '✅' : '⬜'} <b>${q.name}</b> — ${q.desc}
        <span class="qreward">${it ? `${it.icon} ${it.name}` : ''}</span></div>`;
    }).join('');
    const grants = (extra && extra.grants || []).map((k) => ITEMS[k]).filter(Boolean);
    ov.innerHTML = `
      <div class="panel endpanel ${won ? 'win' : 'lose'}">
        <h1>${survival ? `💀 THREAT ${threat}` : won ? '🏆 PLANET TAKEN' : '💀 THE CITY HAS FALLEN'}</h1>
        <p class="tagline">${survival
          ? `The dead are endless — but you drove ${lv.name} to Threat ${threat}.${threat >= best ? ' 🏅 A new personal best!' : ` Best: ${best}.`}`
          : won
          ? `${lv.name} is yours. Every hive is ash and their champion lies at your walls.`
          : `The dead took the Keep at Threat ${threat}.`}</p>
        <div class="howto stats">
          <div>🧟 Slain: <b>${stats.kills}</b></div>
          <div>🪙 Coins collected: <b>${stats.coins}</b></div>
          <div>🔥 Hive nests razed: <b>${stats.nests || 0}</b></div>
          <div>🏗️ Structures raised: <b>${stats.built}</b></div>
          <div>🚩 Lane nodes taken: <b>${stats.nodes || 0}</b> (held at once: ${stats.bestHeld || 0})</div>
          <div>☠️ Threat reached: <b>${threat}</b></div>
        </div>
        ${questRows ? `<div class="questbox"><div class="steplabel">SIDE QUESTS</div>${questRows}</div>` : ''}
        ${extra ? `<p class="tagline">⭐ <b>${extra.heroName}</b> marches on at level ${extra.level}${grants.length
          ? ` — gained ${grants.map((it) => `${it.icon} <b>${it.name}</b>`).join(', ')}` : ''}.</p>` : ''}
        ${!survival && won && lv.id < LEVELS.length ? `<p class="tagline">🔓 Unlocked: <b>${LEVELS[lv.id].name}</b></p>` : ''}
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

  lobbyOnline(n) {
    this.root.querySelector('#l-online').textContent = `🟢 ${n} online`;
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

  lobbyGames(games, onJoin) {
    const box = this.root.querySelector('#l-games');
    if (!box) return;
    if (!games.length) {
      box.innerHTML = '<div class="mphint">No public wars right now — start one and the world will see it here.</div>';
      return;
    }
    box.innerHTML = '';
    for (const g of games) {
      const row = document.createElement('div');
      row.className = 'gamerow';
      const lv = LEVELS[(g.level || 1) - 1];
      row.innerHTML = `
        <span class="gname"></span>
        <span class="ginfo">${g.mode === 'survival' ? '💀 Survival' : '⚔️ Campaign'} · ${lv ? lv.name : '?'} · ${g.players}/3</span>
        <button class="tbtn gjoin">Join</button>`;
      row.querySelector('.gname').textContent = `${g.host_name}'s war`;
      row.querySelector('.gjoin').onclick = () => onJoin(g);
      box.appendChild(row);
    }
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
    el.innerHTML = `<b></b> invites you to their ${inv.mode === 'survival' ? 'Survival' : 'Campaign'} war! <button class="tbtn" id="inv-yes">⚔️ Join</button> <button class="tbtn" id="inv-no">✕</button>`;
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
