// The character sheet is the only way a player ever spends a Lattice point or
// puts on a weapon. These are the wiring faults that make it silently dead —
// each one has already happened once during development.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

// Every element the sheet renders into must exist in the markup.
for (const id of [
  'screen-character-sheet', 'sheet-sigil', 'sheet-name', 'sheet-sub', 'sheet-close',
  'sheet-tab-gear', 'sheet-tab-lattice', 'sheet-panel-gear', 'sheet-panel-lattice',
  'gear-slots', 'gear-stash-list', 'gear-stash-count', 'gear-stat-list',
  'lattice-canvas', 'lattice-detail', 'lattice-points', 'lattice-search', 'lattice-rewire',
  'm-character-sheet',
]) {
  assert.match(ui, new RegExp(`id="${id}"`), `character sheet markup is missing #${id}`);
}

// The screen must be registered, or _showScreen leaves every screen visible.
assert.match(ui, /'character-create', 'character-sheet'/, 'character-sheet is not in the screen list');

// The tab and close buttons must be bound OUTSIDE the Lattice initialiser.
// Binding them inside it made the Lattice tab unreachable: the handler that
// opens the tab could only be attached once that tab had already been opened.
const bindBlock = ui.slice(ui.indexOf("q('#m-character-sheet')"), ui.indexOf("q('#m-character-sheet')") + 600);
assert.match(bindBlock, /#sheet-close/, 'the close button must be bound with the rest of the screen wiring');
assert.match(bindBlock, /\.sheet-tab/, 'the tabs must be bound with the rest of the screen wiring');

// Persistence: the sheet mutates the profile's own character objects, so a
// change that is never saved is a change the player loses on reload.
assert.match(ui, /_sheetChanged\(\)/, 'the sheet must funnel changes through one place');
assert.match(ui, /onProfileDirty/, 'the sheet must tell the app to persist');
assert.match(main, /onProfileDirty: \(\) => this\._saveProfile\(\)/, 'onProfileDirty must actually save');

// Allocation must go through the model, never straight into the array — the
// screen is not allowed to decide what a legal build is.
assert.match(ui, /allocateLatticeNode\(character, id\)/, 'the sheet must allocate through the model');
assert.match(ui, /deallocateLatticeNode\(character, node\.id\)/, 'the sheet must deallocate through the model');
assert.doesNotMatch(ui, /character\.lattice\.push/, 'the sheet must not write the allocation directly');

// Requirements must be checked before equipping, or a character wears what it
// cannot lift and the run silently drops it.
assert.match(ui, /meetsRequirement\(item, this\._sheetAttributes\(character\)\)/, 'equipping must check requirements');

// Rolled items must render through itemInfo everywhere in the UI. A direct
// ITEMS[key] lookup shows a blank for anything the world rolled.
for (const match of ui.matchAll(/ITEMS\[([^\]]+)\]/g)) {
  assert.fail(`ui.js reads the authored table directly (ITEMS[${match[1]}]) — use itemInfo() so rolled items render`);
}

// The sheet sits over the animated menu vignette and must be opaque enough to
// read against a moving battlefield.
assert.match(css, /\.sheet-screen \{[^}]*background:/s, 'the sheet needs its own backdrop');
assert.match(css, /#lattice-canvas \{[^}]*touch-action: none/s, 'the canvas must not scroll the page while panning');

// A player-authored character name is the only free text in this UI. It must
// never be built into markup unescaped.
assert.match(ui, /const escapeHtml =/, 'ui.js needs an HTML escape for player-authored names');
assert.doesNotMatch(ui, /innerHTML = `[^`]*\$\{character\.name\}/s,
  'a character name is being built into markup unescaped — use escapeHtml() or textContent');
assert.match(ui, /#sheet-name'\)\.textContent/, 'the sheet must write the character name with textContent');

// On a narrow screen the sheet becomes a scrolling column, and a `1fr` canvas
// row collapses to zero there — the Lattice vanished entirely at 390px wide.
// The canvas must be given a real height at that size.
const narrow = css.slice(css.indexOf('@media (max-width: 1100px)'));
assert.match(narrow, /\.lattice-stage \{[^}]*height:/s, 'the Lattice canvas needs an explicit height on narrow screens');
assert.match(narrow, /#sheet-panel-lattice \{[^}]*grid-template-columns: 1fr/s, 'the sheet must go single-column on narrow screens');
assert.match(narrow, /\.sheet-head \{[^}]*flex-wrap: wrap/s, 'the sheet header must wrap rather than overflow');

console.log('character sheet check passed');
