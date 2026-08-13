// DOM HUD: resource bar, build menu, minimap, selection panel, banners, menus.
import { BUILDINGS, BUILD_ORDER, UNITS, DIFFICULTY, FINAL_DAY, DAY_LENGTH } from './config.js';
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
        <button class="tbtn" id="b-mute" title="Mute sound (M)">🔊</button>
        <button class="tbtn" id="b-help" title="Help (H)">?</button>
      </div>

      <div id="banner"></div>
      <div id="messages"></div>

      <div id="selpanel" class="hidden"></div>

      <div id="bottombar">
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
          <p class="tagline">The dead cover the earth. Build. Fortify. Survive <b>${FINAL_DAY} days</b>.</p>
          <div class="howto">
            <div><b>🏗️ Build</b> tents for gold &amp; colonists, farms for food, windmills for energy.</div>
            <div><b>⚔️ Defend</b> with walls, ballista towers and trained soldiers.</div>
            <div><b>🤫 Beware:</b> gunfire attracts the dead… and every tent that falls joins the horde.</div>
            <div><b>☠️ Hordes</b> strike on days 2, 4, 6, 8 — and a massive final wave on day ${FINAL_DAY}.</div>
          </div>
          <div class="diffrow" id="diffrow"></div>
          <div class="controls">
            <span><b>WASD / edge</b> pan</span><span><b>wheel</b> zoom</span>
            <span><b>1-9</b> build</span><span><b>drag</b> select</span>
            <span><b>right-click</b> move / cancel</span><span><b>space</b> pause</span>
          </div>
        </div>
      </div>`;

    // Difficulty buttons.
    const diffrow = this.root.querySelector('#diffrow');
    for (const [key, d] of Object.entries(DIFFICULTY)) {
      const b = document.createElement('button');
      b.className = 'diffbtn' + (key === 'normal' ? ' primary' : '');
      b.innerHTML = `${d.label}<small>${key === 'casual' ? 'smaller hordes' : key === 'normal' ? 'the true experience' : 'good luck'}</small>`;
      b.onclick = () => this.cb.onStart(key);
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

    this.tooltip = this.root.querySelector('#tooltip');
    this.banner = this.root.querySelector('#banner');
    this.selpanel = this.root.querySelector('#selpanel');
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
      return;
    }
    // Skip the DOM rebuild when nothing changed (a rebuild every frame would
    // destroy the demolish button mid-click).
    const sig = Array.isArray(sel)
      ? 'u:' + sel.map((u) => u.id).join(',')
      : 'b:' + sel.id + ':' + Math.ceil(sel.hp);
    if (sig === this._selSig) return;
    this._selSig = sig;
    this.selpanel.classList.remove('hidden');
    if (Array.isArray(sel)) {
      const byType = {};
      for (const u of sel) byType[u.def.name] = (byType[u.def.name] || 0) + 1;
      const rows = Object.entries(byType).map(([n, c]) => `<span class="selunit">${c}× ${n}</span>`).join(' ');
      this.selpanel.innerHTML = `<b>Squad (${sel.length})</b><div>${rows}</div><div class="tdesc">Right-click to move. Units fight while standing still.</div>`;
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
    }
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
    q('#r-gold').innerHTML = `💰 ${Math.floor(game.res.gold)} <small>${rate(game.starving ? 0 : e.gold)}</small>`;
    q('#r-wood').innerHTML = `🪵 ${Math.floor(game.res.wood)} <small>${rate(e.wood)}</small>`;
    q('#r-stone').innerHTML = `🪨 ${Math.floor(game.res.stone)} <small>${rate(e.stone)}</small>`;
    q('#r-food').innerHTML = `🍞 <small>${rate(e.food)}</small>${game.starving ? ' ⚠️' : ''}`;
    q('#r-food').classList.toggle('danger', game.starving);
    const energyFree = e.energyProd - e.energyUse;
    q('#r-energy').innerHTML = `⚡ <small>${energyFree}/${e.energyProd}</small>`;
    q('#r-pop').innerHTML = `👷 ${e.workersUsed}/${e.popCap}`;
    q('#r-z').innerHTML = `🧟 ${zombieCount}`;

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
    ctx.fillStyle = '#43d17c';
    for (const u of game.units) ctx.fillRect(u.x - 1, u.z - 1, 2, 2);
    ctx.fillStyle = '#e6493a';
    for (const zb of game.zombies) ctx.fillRect(zb.x - 0.5, zb.z - 0.5, 1.2, 1.2);

    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(camFocus.x - viewSize / 2, camFocus.z - viewSize / 2, viewSize, viewSize);
  }
}
