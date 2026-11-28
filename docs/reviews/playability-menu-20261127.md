# Menu journey review — 2026-11-27

Local branch review. Nothing deployed by this review.

## Reproduced and repaired

- Quartermaster opened both shop and Forge panels, while rendering only the
  shop contents. Exact tab selection now opens one service panel and selects
  one tab. Forge no longer appears as an empty workbench below the shop.
- Phone creation devoted 250px to its decorative preview. Origin choices were
  clipped behind sticky navigation. A 140px preview and stacked origin cards
  put both choices above the navigation; the captured 390px-wide viewport has
  choices from y428 to y607.
- Battle preparation exposed the old strategic globe and idle scene behind a
  second hero preview. Preparation now owns a hangar backdrop. Campaign
  encounters retain the selected leader rather than presenting a redundant
  recruitment grid; custom rooms retain their player controls.
- Friends overlapped inventory/custom-page headers. These screens reserve the
  same top chrome space as the rest of the shell.
- Vendor navigation used default browser styling; it now uses the shared dark
  panels and warm selected treatment. Shop has separate stock/stash columns on
  desktop and one column on phones. Missing-font market icons use existing SVGs.
- Removed implementation prose from the ordinary Settings/title surfaces.
  Audio credits remain on Credits. Initial pause markup is plain text; runtime
  pause state is handled by the tactical-controls review.

## Verification

`node scripts/menu-journey-review.mjs` exercises actual creation clicks, all six
creation steps, character selection, Quartermaster, Forge, custom browser,
campaign preparation, loading, and pending/error/confirmed result states.
It captures laptop 1366×768 and phone 390×844 views, checks page errors, verifies
that only the active service is shown, requires visible vendor controls, and
checks that campaign setup does not expose the redundant leader picker.

Targeted source checks: character-sheet, custom-games-shell and shell-state.
Full build, broad regression suite and shared-world/co-op acceptance belong to
the parent integration review.

## Remaining quality limits

The existing character models are still below the requested art standard; this
review does not author or certify replacement hero art. The hangar and aligned
panels make a more coherent journey, not proof of Bannerlord visual parity.
Static review-server custom-browser failure is an explicitly unavailable
online service, not a successful real-account multiplayer check.

Final run completed with zero page errors and all assertions passing. Evidence:
`outputs/zillions-playability-20261127/menu-journey/` in the shared workspace
(32 screenshots, `review.json`, and `menu-journey-verified.log`).

## Strategic-map presentation follow-up

`src/strategic-map-art.js` is a presentation-only canvas helper. It draws
sci-fi fleet silhouettes, shaded colony spheres and orbital infrastructure.
A stable screen-space label layout keeps a co-located colony and four fleets
readable without moving any game entity. Offscreen labels are omitted rather
than falsely pinned to an edge. Two targeted label tests pass. Standalone
canvas samples are under `outputs/zillions-playability-20261127/world-art/`;
full-world integration/chrome verification belongs to the parent review.
