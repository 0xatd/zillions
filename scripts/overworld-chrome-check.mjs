// Regression: #ow-party-frames is positioned outside #overlay, so hideStart()
// hiding only the overlay left the party panel floating over the battlefield
// for the whole mission.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

const listed = ui.match(/export const OVERWORLD_CHROME = \[([^\]]*)\]/);
assert.ok(listed, 'ui.js must declare the overworld chrome list');
const chrome = [...listed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
assert.ok(chrome.includes('#ow-party-frames'), 'party frames are overworld-only chrome');
assert.ok(chrome.includes('#ow-quick-actions'), 'quick actions are overworld-only chrome');

// Every id in the list must be a real element in the shell template.
for (const sel of chrome) {
  assert.ok(ui.includes(`id="${sel.slice(1)}"`), `${sel} must exist in the UI template`);
}

// Both the raise path and the mission-start teardown must drive off the list.
// Anchor on the method definition (newline + class indent), never a mention
// of the name in a comment or a call site.
const bodyOf = (signature) => {
  const at = ui.indexOf(`\n  ${signature} {`);
  assert.ok(at > 0, `${signature} must exist as a method`);
  const rest = ui.slice(at + 1);
  return rest.slice(0, rest.indexOf('\n  }'));
};
const show = bodyOf('setOverworldMode(on)');
const hide = bodyOf('hideStart()');
assert.ok(show.includes('OVERWORLD_CHROME'), 'setOverworldMode must raise the whole chrome list');
assert.ok(hide.includes('OVERWORLD_CHROME'), 'hideStart must tear down the whole chrome list');

// The original bug shape: hideStart naming panels one at a time drifts out of
// step with setOverworldMode the moment a panel is added.
for (const sel of chrome) {
  assert.ok(
    !hide.includes(`'${sel}'`),
    `hideStart must not hide ${sel} by name — add it to OVERWORLD_CHROME instead`,
  );
}
console.log('overworld chrome check passed');
