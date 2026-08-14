// DOM HUD: resource bar, build menu, minimap, selection panel, banners, menus.
const PORTRAITS = {
  alexander: 'assets/heroes/images/alexander_portrait.png',
  scott: 'assets/heroes/images/scott_barbarian.png',
  danny: 'assets/heroes/images/danny_assassin.png',
};
const CINEMATICS = {
  alexander: 'assets/heroes/videos/alexander_cinematic.mp4',
  scott: 'assets/heroes/videos/scott_cinematic.mp4',
  danny: 'assets/heroes/videos/danny_cinematic.mp4',
};
import {
  BUILDINGS, BUILD_ORDER, UNITS, DIFFICULTY, FINAL_DAY, DAY_LENGTH, LEVELS,
  HEROES, HERO_MAX_LEVEL, xpForLevel, rankReqLevel, ULT_REQ_LEVEL,
} from './config.js';
import { plotCostText, plotInfo, plotPaidTotal } from './plots.js';
import { formatTime } from './utils.js';

export class UI {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;           // {onBuild,onTrain,onSpeed,onMute,onStart,onRestart,onMinimap,onDemolish,onHelp}
    this.activeBuild = null;
    this.msgSeen = 0;
    this._buildDOM();
  }

  _buildDOM() {
    this.root.innerHTML = `
      <div id="topbar">
        <div class="res" id="r-day" title="Day / time of day">☀️ <b>Day 1</b></div>
        <div class="res" id="r-wave" title="Time until the next horde">⏳ --:--</div>
        <div class="res hidden" id="r-plot" title="Current Plot Lab foundation">🏗️ Plot Lab</div>
        <div class="sep"></div>
        <div class="res" id="r-gold" title="Gold — taxes from tents and gold mines">💰 0</div>
        <div class="res" id="r-wood" title="Wood — produced by sawmills">🪵 0</div>
        <div class="res" id="r-stone" title="Stone — produced by quarries">🪨 0</div>
        <div class="res" id="r-food" title="Food balance — farms produce, tents consume">🍞 0</div>
        <div class="res" id="r-energy" title="Energy — windmills produce, buildings consume">⚡ 0</div>
        <div class="res" id="r-pop" title="Colonists — workers used / housing capacity">👷 0/0</div>
        <div class="res" id="r-z" title="Zombies on the map">🧟 0</div>
        <div class="sep"></div>
        <button class="tbtn" id="b-pause" title="Pause (Space)">⏸</button>
        <button class="tbtn speed" data-s="1">1×</button>
        <button class="tbtn speed" data-s="2">2×</button>
        <button class="tbtn speed" data-s="4">4×</button>
        <button class="tbtn active" id="b-auto" title="Overseer auto-build — the bot runs your economy. Click to build manually.">🤖</button>
        <button class="tbtn" id="b-mute" title="Mute sound (M)">🔊</button>
        <button class="tbtn" id="b-help" title="Help (H)">?</button>
      </div>

      <div id="banner"></div>
      <div id="waitind" class="hidden">⏳ Waiting for the other player…</div>
      <div id="bossbar" class="hidden"><b id="boss-name"></b><div class="bossfillwrap"><div id="boss-fill"></div></div></div>
      <div id="messages"></div>

      <div id="heropanel" class="hidden"></div>
      <div id="selpanel" class="hidden"></div>

      <div id="bottombar">
        <div id="selectionmenu" class="hidden">
          <div id="selection-roster"></div>
          <div id="selection-actions"></div>
        </div>
        <div id="buildmenu"></div>
        <div id="unitmenu"></div>
      </div>

      <div id="minimap-wrap">
        <canvas id="minimap-base"></canvas>
        <canvas id="minimap-top"></canvas>
      </div>

      <div id="tooltip" class="hidden"></div>

      <div id="overlay" class="screen">
        <div class="panel">
          <h1>🧟 ZILLIONS</h1>
          <p class="tagline">The frontier belongs to the dead. Take it back. Build. Fortify. Survive <b>${FINAL_DAY} days</b>.</p>
          <div class="howto">
            <div><b>⭐ You are the hero.</b> Earn XP from nearby kills, learn abilities (Q/W/E/R), unleash an ultimate at level 6.</div>
            <div><b>🤖 The Overseer</b> builds your economy and defenses for you — focus on the fight. (Toggle it off to build manually.)</div>
            <div><b>🏗️ Plot Lab</b> uses Thronefall-style foundations. Ride onto a glowing plot during the day to fund and build it.</div>
            <div><b>🤫 Beware:</b> gunfire attracts the dead… and every hab-tent that falls joins the horde.</div>
            <div><b>☠️ Hordes</b> strike on days 2, 4, 6, 8 — and a massive final wave on day ${FINAL_DAY}.</div>
            <div><b>💰 Spare gold?</b> Train troops at the barracks and command them like it's 2003.</div>
          </div>
          <div class="profilerow">
            <label>🪖 Commander <input id="prof-name" maxlength="24" placeholder="your name"></label>
            <span id="prof-stats"></span>
          </div>
          <div class="moderow" id="moderow">
            <button class="modecard sel" data-mode="survival" type="button">
              <b>Survival</b>
              <small>Colony defense. Solo or co-op.</small>
            </button>
            <button class="modecard locked" data-mode="labyrinth" type="button">
              <b>Labyrinth</b>
              <small>Coming soon.</small>
            </button>
          </div>
          <div class="survivalstyle" id="survivalstyle">
            <button class="stylecard sel" data-rules="survival-plots" type="button">
              <b>Plot Lab</b>
              <small>Planned city, coin-run pacing, day builds.</small>
            </button>
            <button class="stylecard" data-rules="survival" type="button">
              <b>Classic RTS</b>
              <small>Free-place buildings and Overseer economy.</small>
            </button>
          </div>
          <div class="herorow" id="herorow"></div>
          <div class="levelrow" id="levelrow"></div>
          <div id="continuerow"></div>
          <div class="diffrow" id="diffrow"></div>
          <div id="public-lobby" class="lobbybox">
            <div class="lobbytop">
              <div><b>Online Lobby</b><small id="lobby-mode">Survival</small></div>
              <span id="lobby-count">-- active</span>
            </div>
            <div class="lobbyactions">
              <button class="tbtn" id="lobby-start" type="button">Start solo</button>
              <button class="tbtn" id="lobby-host" type="button">Host co-op</button>
              <button class="tbtn" id="lobby-join" type="button">Join lobby</button>
              <button class="tbtn" id="lobby-refresh" type="button">Refresh</button>
            </div>
            <div id="lobby-status" class="lobbystatus">Checking online lobby...</div>
            <div id="lobby-players" class="lobbyplayers"></div>
            <div id="lobby-chat" class="lobbychat"></div>
            <form id="lobby-form" class="lobbyform">
              <input id="lobby-chat-input" maxlength="220" autocomplete="off" placeholder="Lobby chat">
              <button class="tbtn" type="submit">Send</button>
            </form>
          </div>
          <div class="mprow">
            <button class="diffbtn" id="mp-host">🌐 Host co-op</button>
            <button class="diffbtn" id="mp-join">🔗 Join co-op</button>
            <span class="mphint">Up to 3 players — one colony, one hero each. No server, just trade invite codes.</span>
          </div>
          <div id="mp-panel" class="hidden"></div>
          <div class="controls">
            <span><b>F</b> select hero (×2 = center)</span><span><b>Q W E R</b> abilities</span>
            <span><b>T</b> select army</span><span><b>right-click</b> move</span><span><b>drag</b> select</span>
            <span><b>WASD / edge / minimap</b> pan</span><span><b>wheel</b> zoom</span><span><b>Z / C</b> rotate</span>
            <span><b>1-9</b> build (manual)</span><span><b>space</b> pause</span>
          </div>
        </div>
      </div>`;

    // Mode picker.
    this.selectedMode = 'survival';
    this.selectedRules = 'survival-plots';
    const moderow = this.root.querySelector('#moderow');
    for (const card of moderow.querySelectorAll('.modecard')) {
      card.onclick = () => {
        const mode = card.dataset.mode;
        if (mode !== 'survival') {
          this.setLobbyStatus('Labyrinth is not open yet.', false);
          return;
        }
        this.selectedMode = mode;
        for (const c of moderow.children) c.classList.toggle('sel', c === card);
        this.root.querySelector('#lobby-mode').textContent = 'Survival';
        if (this.cb.onModePick) this.cb.onModePick(mode);
      };
    }
    const stylerow = this.root.querySelector('#survivalstyle');
    for (const card of stylerow.querySelectorAll('.stylecard')) {
      card.onclick = () => {
        this.selectedRules = card.dataset.rules || 'survival-plots';
        for (const c of stylerow.children) c.classList.toggle('sel', c === card);
        this.setLobbyStatus(`${this.selectedRules === 'survival-plots' ? 'Plot Lab' : 'Classic RTS'} selected.`, true);
        if (this.cb.onRulesPick) this.cb.onRulesPick(this.selectedRules);
      };
    }

    // Hero picker.
    this.selectedHero = 'alexander';
    const herorow = this.root.querySelector('#herorow');
    for (const [key, h] of Object.entries(HEROES)) {
      const card = document.createElement('button');
      card.className = 'herocard' + (key === this.selectedHero ? ' sel' : '');
      card.dataset.key = key;
      card.innerHTML = `
        <video class="hcinematic" muted loop playsinline preload="metadata" poster="${PORTRAITS[key]}" src="${CINEMATICS[key]}"></video>
        <span class="hicon">${h.icon}</span>
        <b>${h.name}</b>
        <small>${h.tagline}</small>
        <span class="habils">${h.abilities.map((a) => a.icon).join(' ')}</span>`;
      card.onclick = () => {
        this.selectedHero = key;
        for (const c of herorow.children) c.classList.toggle('sel', c === card);
        this._syncHeroCinematics();
        if (this.cb.onHeroPick) this.cb.onHeroPick(key);
      };
      card.onmouseenter = (e) => this._showTip(e, this._heroTip(h));
      card.onmousemove = (e) => this._moveTip(e);
      card.onmouseleave = () => this._hideTip();
      herorow.appendChild(card);
    }
    this._syncHeroCinematics();

    // Campaign level picker.
    this.selectedLevel = 1;
    this._buildLevelRow(0);

    // Difficulty buttons.
    const diffrow = this.root.querySelector('#diffrow');
    for (const [key, d] of Object.entries(DIFFICULTY)) {
      const b = document.createElement('button');
      b.className = 'diffbtn' + (key === 'normal' ? ' primary' : '');
      b.innerHTML = `${d.label}<small>${key === 'casual' ? 'smaller hordes' : key === 'normal' ? 'the true experience' : 'good luck'}</small>`;
      b.onclick = () => this.cb.onStart(key, this.selectedHero, this.selectedRules);
      diffrow.appendChild(b);
    }

    // Build menu.
    const bm = this.root.querySelector('#buildmenu');
    this.buildBtns = {};
    for (const key of BUILD_ORDER) {
      const d = BUILDINGS[key];
      const b = document.createElement('button');
      b.className = 'bbtn';
      b.dataset.key = key;
      b.innerHTML = `<span class="icon">${d.icon}</span><span class="bname">${d.name}</span><span class="hot">${d.hotkey}</span>`;
      b.onclick = () => this.cb.onBuild(key);
      b.onmouseenter = (e) => this._showTip(e, this._buildTip(d));
      b.onmousemove = (e) => this._moveTip(e);
      b.onmouseleave = () => this._hideTip();
      bm.appendChild(b);
      this.buildBtns[key] = b;
    }

    // Unit menu.
    const um = this.root.querySelector('#unitmenu');
    this.unitBtns = {};
    for (const [key, d] of Object.entries(UNITS)) {
      const b = document.createElement('button');
      b.className = 'bbtn unit';
      b.innerHTML = `<span class="icon">${d.icon}</span><span class="bname">${d.name}</span><span class="cost">💰${d.cost}</span><span class="hot">${d.hotkey}</span>`;
      b.onclick = () => this.cb.onTrain(key);
      b.onmouseenter = (e) => this._showTip(e, this._unitTip(d));
      b.onmousemove = (e) => this._moveTip(e);
      b.onmouseleave = () => this._hideTip();
      um.appendChild(b);
      this.unitBtns[key] = b;
    }

    // Toolbar.
    this.root.querySelector('#b-pause').onclick = () => this.cb.onSpeed(0);
    for (const b of this.root.querySelectorAll('.speed')) b.onclick = () => this.cb.onSpeed(+b.dataset.s);
    this.root.querySelector('#b-mute').onclick = () => this.cb.onMute();
    this.root.querySelector('#b-help').onclick = () => this.cb.onHelp();
    this.root.querySelector('#b-auto').onclick = () => this.cb.onAuto();
    this.pings = [];

    // Minimap clicks.
    const mmWrap = this.root.querySelector('#minimap-wrap');
    const mmClick = (e) => {
      const r = mmWrap.getBoundingClientRect();
      this.cb.onMinimap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    mmWrap.addEventListener('mousedown', (e) => {
      mmClick(e);
      const mv = (ev) => mmClick(ev);
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    });

    this.root.querySelector('#prof-name').addEventListener('change', (e) => this.cb.onName(e.target.value));
    this.root.querySelector('#lobby-start').onclick = () => this.cb.onLobbyStart && this.cb.onLobbyStart(this.selectedRules, this.selectedHero);
    this.root.querySelector('#lobby-host').onclick = () => this.cb.onLobbyHost && this.cb.onLobbyHost();
    this.root.querySelector('#lobby-join').onclick = () => this.cb.onLobbyJoin && this.cb.onLobbyJoin();
    this.root.querySelector('#lobby-refresh').onclick = () => this.cb.onLobbyRefresh && this.cb.onLobbyRefresh();
    this.root.querySelector('#lobby-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.root.querySelector('#lobby-chat-input');
      const text = input.value.trim();
      if (!text) return;
      if (this.cb.onLobbyChat) this.cb.onLobbyChat(text);
      input.value = '';
    });
    this.root.querySelector('#mp-host').onclick = () => {
      this.mpStatus('Creating invite code…');
      this.cb.onHost();
    };
    this.root.querySelector('#mp-join').onclick = () => this.mpShowJoinInput();

    this.tooltip = this.root.querySelector('#tooltip');
    this.banner = this.root.querySelector('#banner');
    this.selpanel = this.root.querySelector('#selpanel');
  }

  _buildLevelRow(cleared) {
    const row = this.root.querySelector('#levelrow');
    row.innerHTML = '';
    this.selectedLevel = Math.min(cleared + 1, LEVELS.length);
    for (const lv of LEVELS) {
      const locked = lv.id > cleared + 1;
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
        };
        card.onmouseenter = (e) => this._showTip(e, `<b>${lv.boss.icon} ${lv.boss.name}</b><br><span class="tdesc">${lv.boss.desc}</span>`);
        card.onmousemove = (e) => this._moveTip(e);
        card.onmouseleave = () => this._hideTip();
      }
      row.appendChild(card);
    }
  }

  setCampaign(cleared) { this._buildLevelRow(cleared || 0); }

  updateBoss(game) {
    const bar = this.root.querySelector('#bossbar');
    const zb = game.boss;
    if (!zb || zb.dead) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    this.root.querySelector('#boss-name').textContent = `${game.level.boss.icon} ${game.level.boss.name}${zb.enraged ? ' — ENRAGED' : ''}`;
    this.root.querySelector('#boss-fill').style.width = `${Math.max(0, (zb.hp / zb.maxHp) * 100)}%`;
  }

  _costStr(cost) {
    const parts = [];
    if (cost.gold) parts.push(`💰${cost.gold}`);
    if (cost.wood) parts.push(`🪵${cost.wood}`);
    if (cost.stone) parts.push(`🪨${cost.stone}`);
    return parts.join(' ') || 'free';
  }

  _buildTip(d) {
    const rows = [];
    rows.push(`<b>${d.icon} ${d.name}</b>`);
    rows.push(`<span class="tcost">${this._costStr(d.cost)}</span>`);
    const fx = [];
    if (d.pop) fx.push(`+${d.pop} 👷`);
    if (d.workers) fx.push(`-${d.workers} 👷`);
    if (d.energy) fx.push(`${d.energy > 0 ? '+' : ''}${d.energy} ⚡`);
    if (d.gold) fx.push(`+${d.gold} 💰/s`);
    if (d.wood) fx.push(`+${d.wood} 🪵/s`);
    if (d.stone) fx.push(`+${d.stone} 🪨/s`);
    if (d.food) fx.push(`${d.food > 0 ? '+' : ''}${d.food} 🍞`);
    if (d.range) fx.push(`⚔️${d.dmg} rng ${d.range}`);
    if (fx.length) rows.push(`<span class="tfx">${fx.join('  ')}</span>`);
    rows.push(`<span class="tdesc">${d.desc}</span>`);
    return rows.join('<br>');
  }

  _heroTip(h) {
    const rows = h.abilities.map((a) =>
      `<span class="tfx">${a.icon} <b>${a.name}</b>${a.ult ? ' (ULT)' : a.passive ? ' (passive)' : ''}</span><br><span class="tdesc">${a.desc}</span>`);
    return `<b>${h.icon} ${h.name}</b><br><span class="tdesc">${h.tagline}</span><br>` + rows.join('<br>');
  }

  // Build the hero panel once game (and hero) exist.
  initHeroPanel(hero) {
    const hp = this.root.querySelector('#heropanel');
    hp.classList.remove('hidden');
    const d = hero.def;
    hp.innerHTML = `
      <div class="hprow">
        <span class="hpportrait">${PORTRAITS[d.key] ? `<img src="${PORTRAITS[d.key]}" onerror="this.parentElement.textContent='${d.icon}'" alt="">` : d.icon}</span>
        <div class="hpinfo">
          <b>${d.name}</b> <span class="hplvl" id="hp-lvl">Lv 1</span>
          <div class="hpbar herohp"><div class="hpfill" id="hp-hp"></div></div>
          <div class="hpbar heroxp"><div class="xpfill" id="hp-xp"></div></div>
        </div>
      </div>
      <div class="hpabils" id="hp-abils"></div>
      <div class="hppoints hidden" id="hp-points"></div>`;
    const row = hp.querySelector('#hp-abils');
    this.abilBtns = [];
    d.abilities.forEach((ab, i) => {
      const b = document.createElement('button');
      b.className = 'abtn';
      b.innerHTML = `
        <span class="aicon">${ab.icon}</span>
        <span class="ahot">${ab.hotkey}</span>
        <span class="apips" id="ap-${i}"></span>
        <span class="acd hidden" id="cd-${i}"></span>
        <span class="alearn hidden" id="lr-${i}">+</span>`;
      b.onclick = (e) => {
        if (!b.querySelector('.alearn').classList.contains('hidden') && (e.target.classList.contains('alearn') || hero.abil[i].rank === 0)) {
          this.cb.onLearn(i);
        } else {
          this.cb.onCast(i);
        }
      };
      b.onmouseenter = (e) => this._showTip(e, this._abilTip(hero, i));
      b.onmousemove = (e) => this._moveTip(e);
      b.onmouseleave = () => this._hideTip();
      row.appendChild(b);
      this.abilBtns.push(b);
    });
  }

  _abilTip(hero, i) {
    const ab = hero.def.abilities[i];
    const st = hero.abil[i];
    const req = ab.ult ? `hero level ${ULT_REQ_LEVEL}` : `hero level ${rankReqLevel(st.rank + 1)}`;
    const status = ab.passive
      ? (st.rank > 0 ? `PASSIVE — rank ${st.rank}/${ab.maxRank}` : 'PASSIVE — not learned')
      : st.rank > 0 ? `Rank ${st.rank}/${ab.maxRank} · ${ab.cd}s cooldown` : 'Not learned';
    const next = st.rank < ab.maxRank ? `<br><span class="tdesc">Next rank: ${req}, costs 1 skill point.</span>` : '';
    return `<b>${ab.icon} ${ab.name}</b>${ab.ult ? ' <span class="tcost">ULTIMATE</span>' : ''}<br>` +
      `<span class="tfx">${status}</span><br><span class="tdesc">${ab.desc}</span>${next}`;
  }

  updateHero(game, p = 0) {
    const h = game.heroes[p];
    if (!h || !this.abilBtns) return;
    const q = (id) => this.root.querySelector(id);
    q('#hp-lvl').textContent = h.dead ? `☠️ ${Math.ceil(h.reviveT)}s` : `Lv ${h.level}`;
    q('#hp-hp').style.width = `${Math.max(0, (h.hp / h.maxHp) * 100)}%`;
    const need = xpForLevel(h.level);
    q('#hp-xp').style.width = h.level >= HERO_MAX_LEVEL ? '100%' : `${(h.xp / need) * 100}%`;
    const pts = q('#hp-points');
    pts.classList.toggle('hidden', h.points <= 0);
    if (h.points > 0) pts.textContent = `⭐ ${h.points} skill point${h.points > 1 ? 's' : ''} — click + to learn`;

    h.def.abilities.forEach((ab, i) => {
      const st = h.abil[i];
      const pips = q(`#ap-${i}`);
      pips.textContent = '●'.repeat(st.rank) + '○'.repeat(ab.maxRank - st.rank);
      const cd = q(`#cd-${i}`);
      const onCd = !ab.passive && st.cd > 0 && st.rank > 0;
      cd.classList.toggle('hidden', !onCd);
      if (onCd) cd.textContent = Math.ceil(st.cd);
      q(`#lr-${i}`).classList.toggle('hidden', !game.canLearn(i, p));
      this.abilBtns[i].classList.toggle('unlearned', st.rank === 0);
      this.abilBtns[i].classList.toggle('ready', st.rank > 0 && !ab.passive && st.cd <= 0 && !h.dead);
    });
  }

  _unitTip(d) {
    return `<b>${d.icon} ${d.name}</b><br><span class="tcost">💰${d.cost}</span><br>` +
      `<span class="tfx">⚔️${d.dmg} dmg · rng ${d.range} · ${d.hp} hp · noise ${d.noise === 6 ? 'low' : d.noise < 20 ? 'high' : 'extreme'}</span><br>` +
      `<span class="tdesc">${d.desc}</span>`;
  }

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

  setActiveBuild(key) {
    this.activeBuild = key;
    for (const [k, b] of Object.entries(this.buildBtns)) b.classList.toggle('active', k === key);
  }

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

  setProfile(p) {
    const nameEl = this.root.querySelector('#prof-name');
    if (nameEl) nameEl.value = p.name || '';
    const st = this.root.querySelector('#prof-stats');
    if (st) {
      st.textContent = p.games
        ? `${p.wins}W / ${p.games - p.wins}L · ${p.kills.toLocaleString()} kills · best: day ${p.bestDay}`
        : 'first deployment';
    }
  }

  preselectHero(key) {
    const card = this.root.querySelector(`.herocard[data-key=${key}]`);
    if (!card) return;
    this.selectedHero = key;
    for (const c of this.root.querySelectorAll('.herocard')) c.classList.toggle('sel', c === card);
    this._syncHeroCinematics();
  }

  preselectRules(rules) {
    const card = this.root.querySelector(`.stylecard[data-rules=${rules}]`);
    if (!card) return;
    this.selectedRules = rules;
    for (const c of this.root.querySelectorAll('.stylecard')) c.classList.toggle('sel', c === card);
  }

  _syncHeroCinematics() {
    for (const card of this.root.querySelectorAll('.herocard')) {
      const video = card.querySelector('video');
      if (!video) continue;
      if (card.dataset.key === this.selectedHero) {
        video.play().catch(() => {});
      } else {
        video.pause();
        try { video.currentTime = 0; } catch { /* metadata may not be loaded yet */ }
      }
    }
  }

  setContinue(snap) {
    const row = this.root.querySelector('#continuerow');
    if (!row) return;
    if (!snap) { row.innerHTML = ''; return; }
    const day = Math.floor(snap.time / DAY_LENGTH) + 1;
    const players = snap.heroKeys.length;
    const mode = snap.mode === 'survival-plots' ? 'Plot Lab' : 'Classic RTS';
    row.innerHTML = `<button class="diffbtn primary" id="b-continue">📂 Continue — ${mode}, Day ${day}, ${snap.diff}${players > 1 ? `, ${players} players` : ''}</button>`;
    row.querySelector('#b-continue').onclick = () => this.cb.onContinue();
  }

  setWaiting(on) {
    const el = this.root.querySelector('#waitind');
    if (el) el.classList.toggle('hidden', !on);
  }

  setLocalPlayer(p = 0) { this.localPlayer = p; }

  setOrderMode(mode) {
    this.orderMode = mode || null;
    for (const btn of this.root.querySelectorAll('.cmdbtn[data-command]')) {
      btn.classList.toggle('active', btn.dataset.command === this.orderMode);
    }
  }

  // ---------- public lobby ----------

  setLobbyStatus(text, ok = false) {
    const st = this.root.querySelector('#lobby-status');
    if (!st) return;
    st.textContent = text;
    st.classList.toggle('ok', ok);
  }

  setLobby(lobby, joined = false) {
    if (!lobby) {
      this.setLobbyStatus('Open the Vercel build to use the online lobby.', false);
      return;
    }
    const players = lobby.players || [];
    const messages = lobby.messages || [];
    const activeCount = lobby.activeCount ?? players.length;
    this.root.querySelector('#lobby-count').textContent = `${activeCount} active`;
    this.root.querySelector('#lobby-join').textContent = joined ? 'In lobby' : 'Join lobby';
    this.root.querySelector('#lobby-mode').textContent = lobby.mode === 'labyrinth' ? 'Labyrinth' : 'Survival';
    this.setLobbyStatus(joined ? 'You are visible in the lobby.' : 'Join to appear here.', joined);

    const playerList = this.root.querySelector('#lobby-players');
    playerList.innerHTML = '';
    if (!players.length) {
      const empty = document.createElement('div');
      empty.className = 'lobbyempty';
      empty.textContent = 'No active players yet.';
      playerList.appendChild(empty);
    } else {
      for (const player of players.slice(0, 8)) {
        const hero = HEROES[player.hero] || HEROES.alexander;
        const row = document.createElement('div');
        row.className = 'lobbyplayer';
        const name = document.createElement('span');
        name.textContent = `${hero.icon} ${player.name || 'Commander'}`;
        const status = document.createElement('small');
        const rules = player.rules === 'survival-plots' ? 'Plot Lab' : player.rules === 'survival' ? 'Classic RTS' : '';
        status.textContent = player.status || rules || 'in-lobby';
        row.append(name, status);
        playerList.appendChild(row);
      }
    }

    const chat = this.root.querySelector('#lobby-chat');
    chat.innerHTML = '';
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'lobbyempty';
      empty.textContent = 'No lobby chat yet.';
      chat.appendChild(empty);
    } else {
      for (const message of messages.slice(-12)) {
        const hero = HEROES[message.hero] || HEROES.alexander;
        const row = document.createElement('div');
        row.className = 'lobbymsg';
        const meta = document.createElement('b');
        meta.textContent = `${hero.icon} ${message.name || 'Commander'}`;
        const text = document.createElement('span');
        text.textContent = message.text || '';
        row.append(meta, text);
        chat.appendChild(row);
      }
      requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
    }
  }

  // ---------- co-op lobby ----------

  _mpPanel() {
    const p = this.root.querySelector('#mp-panel');
    p.classList.remove('hidden');
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
      <button class="diffbtn primary" id="mp-accept">Connect player ${existingPeers + 2}</button>`;
    p.querySelector('#mp-copy').onclick = () => {
      p.querySelector('#mp-offer').select();
      document.execCommand('copy');
      navigator.clipboard && navigator.clipboard.writeText(code).catch(() => {});
    };
    p.querySelector('#mp-accept').onclick = () => this.cb.onHostAccept(p.querySelector('#mp-reply').value);
  }

  // Host lobby once at least one guest is in.
  mpLobby(peerCount, canAddMore) {
    const p = this._mpPanel();
    p.innerHTML = `
      <div class="mpstatus ok">🟢 ${peerCount + 1} player${peerCount ? 's' : ''} connected. Pick your hero, then choose a difficulty to launch for everyone.</div>
      ${canAddMore ? '<button class="diffbtn" id="mp-add">➕ Invite a third player</button>' : ''}`;
    const add = p.querySelector('#mp-add');
    if (add) add.onclick = () => this.cb.onAddPeer();
  }

  mpShowJoinInput() {
    const p = this._mpPanel();
    p.innerHTML = `
      <div class="mpstatus">Paste the invite code from the host.</div>
      <textarea class="mpcode" id="mp-invite" placeholder="Paste invite code here…"></textarea>
      <button class="diffbtn primary" id="mp-go">Join</button>`;
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

  mpConnected(isHost, playerNum = 2) {
    const p = this._mpPanel();
    p.innerHTML = `<div class="mpstatus ok">🟢 Connected — you are player ${playerNum}. Pick your hero; the host starts the game.</div>`;
    if (!isHost) this.root.querySelector('#diffrow').classList.add('disabled');
  }

  setAutoUI(on) { this.root.querySelector('#b-auto').classList.toggle('active', on); }

  addPing(x, z) { this.pings.push({ x, z, t: 4 }); }

  hideStart() { this.root.querySelector('#overlay').classList.add('hidden'); }

  showHelp() {
    const ov = this.root.querySelector('#overlay');
    ov.classList.remove('hidden');
    ov.querySelector('.diffrow').style.display = 'none';
    const panel = ov.querySelector('.panel');
    if (!panel.querySelector('.resume')) {
      const b = document.createElement('button');
      b.className = 'diffbtn primary resume';
      b.textContent = 'Resume';
      b.onclick = () => ov.classList.add('hidden');
      panel.appendChild(b);
    }
  }

  showEnd(won, stats, day) {
    const ov = this.root.querySelector('#overlay');
    ov.classList.remove('hidden');
    ov.innerHTML = `
      <div class="panel ${won ? 'win' : 'lose'}">
        <h1>${won ? '🏆 VICTORY' : '💀 THE COLONY HAS FALLEN'}</h1>
        <p class="tagline">${won
          ? 'The final horde lies rotting at your walls. The land is yours.'
          : `The dead overran your Command Center on day ${day}.`}</p>
        <div class="howto stats">
          <div>🧟 Zombies slain: <b>${stats.kills}</b></div>
          <div>🏗️ Buildings raised: <b>${stats.built}</b></div>
          ${stats.plots ? `<div>📍 Plot builds funded: <b>${stats.plots}</b></div>` : ''}
          <div>🔥 Buildings lost: <b>${stats.lost}</b></div>
          <div>☀️ Days survived: <b>${Math.min(day, FINAL_DAY)}</b></div>
        </div>
        <button class="diffbtn primary" id="b-restart">Play again</button>
      </div>`;
    ov.querySelector('#b-restart').onclick = () => this.cb.onRestart();
  }

  showSelection(sel, game) {
    if (!sel || (Array.isArray(sel) && sel.length === 0)) {
      this.selpanel.classList.add('hidden');
      this._selSig = null;
      this._showDefaultCommandBar();
      return;
    }
    // Skip the DOM rebuild when nothing changed (a rebuild every frame would
    // destroy the demolish button mid-click).
    const sig = Array.isArray(sel)
      ? 'u:' + sel.map((u) => `${u.id}:${Math.ceil(u.hp)}:${u.level || 0}:${u.points || 0}:${u.abil ? u.abil.map((a) => `${a.rank}-${Math.ceil(a.cd)}`).join('.') : ''}`).join(',')
      : 'b:' + sel.id + ':' + Math.ceil(sel.hp);
    if (sig === this._selSig) return;
    this._selSig = sig;
    this.selpanel.classList.remove('hidden');
    if (Array.isArray(sel)) {
      const live = sel.filter((u) => !u.dead);
      const byType = {};
      for (const u of live) byType[u.def.name] = (byType[u.def.name] || 0) + 1;
      const rows = Object.entries(byType).map(([n, c]) => `<span class="selunit">${c}× ${n}</span>`).join(' ');
      this.selpanel.innerHTML = `<b>Squad (${live.length})</b><div>${rows}</div><div class="tdesc">Right-click or use Move, then click the map.</div>`;
      this._showUnitCommandBar(live, game);
    } else {
      const b = sel;
      const pct = Math.max(0, b.hp / b.maxHp);
      let extra = '';
      if (b.key === 'tower') extra = `<div class="tfx">⚔️ ${b.def.dmg} dmg · range ${b.def.range}</div>`;
      const demolishable = b.key !== 'hq';
      this.selpanel.innerHTML = `
        <b>${b.def.icon} ${b.def.name}</b>
        <div class="hpbar"><div class="hpfill" style="width:${pct * 100}%"></div></div>
        <div class="tfx">${Math.ceil(b.hp)} / ${b.maxHp} hp</div>${extra}
        ${demolishable ? '<button class="tbtn demolish" id="b-demolish">🧨 Demolish (50% refund)</button>' : ''}`;
      const btn = this.selpanel.querySelector('#b-demolish');
      if (btn) btn.onclick = () => this.cb.onDemolish(b);
      this._showBuildingCommandBar(b, game);
    }
  }

  _showDefaultCommandBar() {
    this.root.querySelector('#selectionmenu').classList.add('hidden');
    this.root.querySelector('#buildmenu').classList.remove('hidden');
    this.root.querySelector('#unitmenu').classList.remove('hidden');
  }

  _showSelectionCommandBar() {
    this.root.querySelector('#selectionmenu').classList.remove('hidden');
    this.root.querySelector('#buildmenu').classList.add('hidden');
    this.root.querySelector('#unitmenu').classList.add('hidden');
  }

  _showUnitCommandBar(units, game) {
    this._showSelectionCommandBar();
    const roster = this.root.querySelector('#selection-roster');
    const actions = this.root.querySelector('#selection-actions');
    roster.innerHTML = '';
    actions.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'selection-title';
    title.innerHTML = `<b>${units.length} selected</b><small>Click a card to focus. Double-click to select that type.</small>`;
    roster.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'selection-grid';
    for (const unit of units.slice(0, 18)) {
      const card = document.createElement('button');
      card.className = 'selcard' + (unit.hero ? ' hero' : '');
      card.type = 'button';
      card.dataset.unitId = unit.id;
      card.title = 'Click to focus. Shift-click to toggle. Double-click to select this type.';
      const pct = Math.max(0, unit.hp / unit.maxHp);
      card.innerHTML = `
        <span class="selicon">${unit.def.icon || '•'}</span>
        <span class="selname">${unit.def.name}</span>
        ${unit.hero ? `<span class="selmeta">Lv ${unit.level}</span>` : `<span class="selmeta">${unit.key}</span>`}
        <span class="mini-hp"><span style="width:${pct * 100}%"></span></span>`;
      card.onclick = (e) => {
        if (e.shiftKey && this.cb.onToggleUnit) this.cb.onToggleUnit(unit.id);
        else if (this.cb.onSelectUnit) this.cb.onSelectUnit(unit.id);
      };
      card.ondblclick = () => this.cb.onSelectUnitType && this.cb.onSelectUnitType(unit.key);
      grid.appendChild(card);
    }
    roster.appendChild(grid);

    actions.appendChild(this._commandButton('move', '↗', 'Move', 'Click a destination', () => this.cb.onSelectionCommand && this.cb.onSelectionCommand('move')));
    actions.appendChild(this._commandButton('stop', '✋', 'Stop', 'Hold current ground', () => this.cb.onSelectionCommand && this.cb.onSelectionCommand('stop')));
    actions.appendChild(this._commandButton('hero', '⭐', 'Hero', 'Select your hero', () => this.cb.onSelectionCommand && this.cb.onSelectionCommand('hero')));
    actions.appendChild(this._commandButton('army', '⚔️', 'Army', 'Select all fighting units', () => this.cb.onSelectionCommand && this.cb.onSelectionCommand('army')));

    const localHero = game?.heroes?.[this.localPlayer || 0];
    if (localHero && units.includes(localHero)) {
      const heroRow = document.createElement('div');
      heroRow.className = 'ability-actions';
      localHero.def.abilities.forEach((ab, i) => {
        const st = localHero.abil[i];
        const learnable = game.canLearn(i, this.localPlayer || 0);
        const usable = st.rank > 0 && st.cd <= 0 && !ab.passive && !localHero.dead;
        const btn = this._commandButton(`ability-${i}`, ab.icon, ab.hotkey, learnable ? 'Learn' : ab.name, () => {
          if (learnable && this.cb.onLearn) this.cb.onLearn(i);
          else if (this.cb.onCast) this.cb.onCast(i);
        });
        btn.classList.add('abilitycmd');
        btn.classList.toggle('ready', usable);
        btn.classList.toggle('learnable', learnable);
        btn.classList.toggle('disabled', !learnable && (st.rank === 0 || ab.passive || st.cd > 0 || localHero.dead));
        btn.title = learnable ? `Learn ${ab.name}` : ab.desc;
        const sub = btn.querySelector('small');
        if (learnable) sub.textContent = 'Learn';
        else if (st.rank === 0) sub.textContent = 'Locked';
        else if (ab.passive) sub.textContent = `Rank ${st.rank}`;
        else if (st.cd > 0) sub.textContent = `${Math.ceil(st.cd)}s`;
        else sub.textContent = ab.name;
        heroRow.appendChild(btn);
      });
      actions.appendChild(heroRow);
    }
    this.setOrderMode(this.orderMode);
  }

  _showBuildingCommandBar(building, game) {
    this._showSelectionCommandBar();
    const roster = this.root.querySelector('#selection-roster');
    const actions = this.root.querySelector('#selection-actions');
    roster.innerHTML = '';
    actions.innerHTML = '';

    const pct = Math.max(0, building.hp / building.maxHp);
    const card = document.createElement('div');
    card.className = 'building-card';
    card.innerHTML = `
      <span class="selicon">${building.def.icon}</span>
      <div><b>${building.def.name}</b><small>${Math.ceil(building.hp)} / ${building.maxHp} hp</small></div>
      <span class="mini-hp"><span style="width:${pct * 100}%"></span></span>`;
    roster.appendChild(card);

    if (building.key === 'barracks') {
      for (const [key, unit] of Object.entries(UNITS)) {
        const poor = !game || game.res.gold < unit.cost;
        const btn = this._commandButton(key, unit.icon, unit.name, `Gold ${unit.cost}`, () => this.cb.onTrain && this.cb.onTrain(key));
        btn.classList.toggle('poor', poor);
        actions.appendChild(btn);
      }
    }
    if (building.key === 'hq') {
      actions.appendChild(this._commandButton('hero', '⭐', 'Hero', 'Select your hero', () => this.cb.onSelectionCommand && this.cb.onSelectionCommand('hero')));
      actions.appendChild(this._commandButton('army', '⚔️', 'Army', 'Select all fighting units', () => this.cb.onSelectionCommand && this.cb.onSelectionCommand('army')));
    }
    if (building.key === 'tower') {
      actions.appendChild(this._commandButton('range', '🎯', 'Range', `${building.def.range} tiles`, null, true));
    }
    if (building.key !== 'hq') {
      actions.appendChild(this._commandButton('demolish', '🧨', 'Demolish', '50% refund', () => this.cb.onDemolish && this.cb.onDemolish(building)));
    }
  }

  _commandButton(command, icon, label, sublabel, onClick, disabled = false) {
    const btn = document.createElement('button');
    btn.className = 'cmdbtn';
    btn.type = 'button';
    btn.dataset.command = command;
    btn.disabled = !!disabled;
    btn.innerHTML = `<span class="cmdicon">${icon}</span><b>${label}</b><small>${sublabel || ''}</small>`;
    if (onClick) btn.onclick = onClick;
    return btn;
  }

  update(game, zombieCount) {
    const q = (id) => this.root.querySelector(id);
    const e = game.eco;
    const phase = game.isNight ? '🌙' : game.dayFrac > 0.55 ? '🌇' : '☀️';
    q('#r-day').innerHTML = `${phase} <b>Day ${Math.min(game.day, FINAL_DAY)}</b>`;

    const nw = game.nextWave();
    if (nw) {
      const left = nw.at - game.time;
      q('#r-wave').innerHTML = `${nw.final ? '☠️' : '⏳'} ${formatTime(left)}`;
      q('#r-wave').classList.toggle('danger', left < 30);
    } else {
      q('#r-wave').innerHTML = '☠️ FINAL WAVE';
      q('#r-wave').classList.add('danger');
    }

    const rate = (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
    q('#r-gold').innerHTML = `💰 ${Math.floor(game.res.gold)} <small>${rate(game.starving ? e.gold * 0.4 : e.gold)}</small>`;
    q('#r-wood').innerHTML = `🪵 ${Math.floor(game.res.wood)} <small>${rate(e.wood)}</small>`;
    q('#r-stone').innerHTML = `🪨 ${Math.floor(game.res.stone)} <small>${rate(e.stone)}</small>`;
    q('#r-food').innerHTML = `🍞 <small>${rate(e.food)}</small>${game.starving ? ' ⚠️' : ''}`;
    q('#r-food').classList.toggle('danger', game.starving);
    const energyFree = e.energyProd - e.energyUse;
    q('#r-energy').innerHTML = `⚡ <small>${energyFree}/${e.energyProd}</small>`;
    q('#r-pop').innerHTML = `👷 ${e.workersUsed}/${e.popCap}`;
    q('#r-z').innerHTML = `🧟 ${zombieCount}`;
    const plotHud = q('#r-plot');
    if (plotHud) {
      plotHud.classList.toggle('hidden', !game.plotMode);
      if (game.plotMode) {
        const active = game.activePlot;
        if (active) {
          const info = plotInfo(active.key);
          plotHud.innerHTML = `🏗️ ${info.label} <small>${Math.round(plotPaidTotal(active) * 100)}% · ${plotCostText(active)}</small>`;
          plotHud.classList.add('active');
        } else {
          const left = game.plots.filter((p) => !p.built).length;
          plotHud.innerHTML = `🏗️ Plot Lab <small>${left} foundations</small>`;
          plotHud.classList.remove('active');
        }
      }
    }

    // Gray out unaffordable build buttons.
    for (const key of BUILD_ORDER) {
      const d = BUILDINGS[key];
      const ok = game.res.gold >= d.cost.gold && game.res.wood >= d.cost.wood && game.res.stone >= (d.cost.stone || 0);
      this.buildBtns[key].classList.toggle('poor', !ok);
    }
    const hasBarracks = game.buildings.some((b) => b.key === 'barracks' && b.alive);
    for (const [key, btn] of Object.entries(this.unitBtns)) {
      btn.classList.toggle('poor', !hasBarracks || game.res.gold < UNITS[key].cost);
    }

    // Messages feed.
    const feed = q('#messages');
    while (this.msgSeen < game.messages.length) {
      const m = game.messages[this.msgSeen++];
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

  drawMinimap(game, camFocus, viewSize) {
    const top = this.root.querySelector('#minimap-top');
    const N = game.map.size;
    if (top.width !== N) { top.width = N; top.height = N; }
    const ctx = top.getContext('2d');
    ctx.clearRect(0, 0, N, N);

    ctx.fillStyle = '#e8e2ce';
    for (const b of game.buildings) {
      ctx.fillStyle = b.key === 'hq' ? '#ffd75e' : b.key === 'wall' ? '#c9b48a' : '#efeadb';
      ctx.fillRect(b.x, b.z, b.size, b.size);
    }
    if (game.plotMode) {
      for (const plot of game.plots) {
        if (plot.built) continue;
        const info = plotInfo(plot.key);
        ctx.fillStyle = `#${info.color.toString(16).padStart(6, '0')}`;
        ctx.globalAlpha = 0.55 + plotPaidTotal(plot) * 0.35;
        ctx.fillRect(plot.x, plot.z, Math.max(1, plot.size), Math.max(1, plot.size));
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#43d17c';
    for (const u of game.units) {
      if (u.hero) { ctx.fillStyle = '#ffd75e'; ctx.fillRect(u.x - 1.5, u.z - 1.5, 3.5, 3.5); ctx.fillStyle = '#43d17c'; }
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

    // WC3-style pings: expanding red circles.
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
