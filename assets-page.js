const AUDIO_ROOT = 'assets/audio/';

const state = {
  assets: [],
};

const el = {
  content: document.querySelector('#content'),
  status: document.querySelector('#status'),
  search: document.querySelector('#search'),
  packs: document.querySelector('#metric-packs'),
  audio: document.querySelector('#metric-audio'),
  lines: document.querySelector('#metric-lines'),
};

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  return response.json();
}

function titleCase(value) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function asset(kind, pack, group, title, file, meta = '') {
  return {
    kind,
    pack,
    group,
    title,
    file,
    meta,
    haystack: `${kind} ${pack} ${group} ${title} ${file} ${meta}`.toLowerCase(),
  };
}

function addTopLevelAudio(manifest) {
  for (const track of manifest.music ?? []) {
    state.assets.push(asset(
      'music',
      'Music',
      'Music',
      track.name,
      AUDIO_ROOT + track.file,
      track.vibe,
    ));
  }

  for (const voice of manifest.voices ?? []) {
    state.assets.push(asset(
      'hero',
      'Hero Samples',
      voice.displayName,
      voice.displayName,
      AUDIO_ROOT + voice.file,
      `${voice.locationFlavor} / ${voice.voice}`,
    ));
  }
}

function addHeroClickPack(clickPack) {
  for (const [heroKey, hero] of Object.entries(clickPack.heroes ?? {})) {
    for (const [category, lines] of Object.entries(hero.categories ?? {})) {
      for (const line of lines) {
        state.assets.push(asset(
          'hero',
          'Hero Click Barks',
          `${hero.displayName} / ${titleCase(category)}`,
          line.line,
          AUDIO_ROOT + 'click-pack/' + line.file,
          `${hero.voice} / ${hero.locationFlavor}`,
        ));
      }
    }
  }
}

function addFactionPack(factionPack) {
  for (const [factionKey, faction] of Object.entries(factionPack.factions ?? {})) {
    for (const [category, lines] of Object.entries(faction.categories ?? {})) {
      for (const line of lines) {
        state.assets.push(asset(
          'faction',
          'Faction Voices',
          `${faction.displayName} / ${titleCase(category)}`,
          line.line,
          AUDIO_ROOT + 'faction-voice-pack/' + line.file,
          `${faction.voice} / ${faction.direction}`,
        ));
      }
    }
  }
}

function addSfxPack(sfxPack) {
  for (const sound of sfxPack.sounds ?? []) {
    state.assets.push(asset(
      'sfx',
      'Sound Effects',
      titleCase(sound.group),
      titleCase(sound.id),
      AUDIO_ROOT + 'sfx-pack/' + sound.file,
      `${sound.durationSeconds}s / ${sound.source ?? sfxPack.model}`,
    ));
  }
}

function byPackAndGroup(items) {
  const packs = new Map();
  for (const item of items) {
    if (!packs.has(item.pack)) packs.set(item.pack, new Map());
    const groups = packs.get(item.pack);
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  return packs;
}

function render(items) {
  el.content.innerHTML = '';
  const packs = byPackAndGroup(items);

  for (const [packName, groups] of packs.entries()) {
    const section = document.createElement('section');
    section.className = 'pack';
    section.innerHTML = `<h2>${packName}</h2><p>${packDescription(packName)}</p>`;

    for (const [groupName, assets] of groups.entries()) {
      const group = document.createElement('div');
      group.className = 'group';
      group.innerHTML = `<h3>${groupName}</h3>`;

      const grid = document.createElement('div');
      grid.className = 'grid';

      for (const item of assets) {
        const card = document.createElement('article');
        card.className = 'asset';
        card.dataset.kind = item.kind;
        card.innerHTML = `
          <b>${escapeHtml(item.title)}</b>
          <div class="meta">${escapeHtml(item.meta)}</div>
          <div class="meta">${escapeHtml(item.file)}</div>
          <audio controls preload="none" src="${encodeURI(item.file)}"></audio>
        `;
        grid.appendChild(card);
      }

      group.appendChild(grid);
      section.appendChild(group);
    }

    el.content.appendChild(section);
  }

  el.status.textContent = items.length
    ? `Showing ${items.length} audio files.`
    : 'No assets match that filter.';
}

function packDescription(packName) {
  switch (packName) {
    case 'Music':
      return 'Hero-select and map soundtrack loops.';
    case 'Hero Samples':
      return 'First-pass distinct hero voice samples.';
    case 'Hero Click Barks':
      return 'Selection, repeated-click, move, and attack barks for the three heroes.';
    case 'Faction Voices':
      return 'Generic RTS barks for army, robots, townsfolk, aliens, and zombies.';
    case 'Sound Effects':
      return 'UI, weapon, creature, robot, and colony sound effects.';
    default:
      return '';
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function applyFilter() {
  const query = el.search.value.trim().toLowerCase();
  const items = query
    ? state.assets.filter((item) => item.haystack.includes(query))
    : state.assets;
  render(items);
}

async function main() {
  const [manifest, clickPack, factionPack, sfxPack] = await Promise.all([
    readJson(AUDIO_ROOT + 'manifest.json'),
    readJson(AUDIO_ROOT + 'click-pack/index.json'),
    readJson(AUDIO_ROOT + 'faction-voice-pack/index.json'),
    readJson(AUDIO_ROOT + 'sfx-pack/index.json'),
  ]);

  addTopLevelAudio(manifest);
  addHeroClickPack(clickPack);
  addFactionPack(factionPack);
  addSfxPack(sfxPack);

  el.packs.textContent = '5';
  el.audio.textContent = String(state.assets.length);
  el.lines.textContent = String((clickPack.lineCount ?? 0) + (factionPack.lineCount ?? 0));
  render(state.assets);
}

el.search.addEventListener('input', applyFilter);

main().catch((error) => {
  el.status.textContent = error.message;
  console.error(error);
});
