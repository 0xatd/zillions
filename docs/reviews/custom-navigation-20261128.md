# Custom Games navigation — 2026-11-28

## Scope

Custom Games remains the only active play path. World code and saved progression are preserved, not expanded. This review checks entering, selecting, preparing, returning and re-entering existing custom maps. It does not claim a full WC3 interface remake or reference-map reconstruction.

## Fixes

- Filtering out the selected map clears Play/Host targets. The original real-browser test failed because an invisible map stayed playable.
- Room refresh reconciles selection against current rows and compatibility; removed rooms cannot remain joinable.
- Disabled actions look disabled. Browser/results consistently say Custom Games.
- Short landscape layouts retain usable map rows instead of collapsing their grid track to zero and letting the details pane intercept clicks.
- Hosting cancellation remains clickable without the global Friends control covering Close.
- Signed-in entry reaches Custom Games without requiring a world character. Profile hydration and saved rosters remain intact; replays, repeated hydration and active battles retain screen ownership.
- Existing world-character selection must not lock standalone hero choices.

## Evidence

Evidence directory: `outputs/zillions-custom-navigation-20261128/` in the agent workspace.

- `scripts/custom-navigation-journey.mjs`: real clicks on laptop 1366×768, portrait 390×844 and landscape 844×390. Search/empty state, map selection, setup Back, host cancellation, title return and re-entry. Live-room metadata and persistent profiles are disclosed fixtures, not authenticated service tests.
- `scripts/castle-core-journey.mjs` with `QA_IRON_RAIN_STATES=1`: actual Start into battle, then presentation fixture results → browser → next setup. No forced character creation or world encounter. Results are fixtures, not claimed gameplay wins.
- `tests/custom-auth-entry.test.mjs`: executes the real auth-entry method with service boundaries stubbed. Before the fix a fresh signed-in account routed to character creation. Also covers preserved roster, replay/username/repeated hydration and live-battle ownership.
- Full regression and final build receipts are recorded below after all fixes settle.

## Reference recording

See [recording retrieval report](custom-castle-reference-20261128.md). Mail access succeeded, but the requested WC3 recording was not located. The known Bannerlord video is not a substitute. Base/resource counts, minimap locations and entrance/defensibility assessments remain unverified pending the recording.

## Release limits

No merge, deployment, production migration or authenticated staging claim. Earlier slow software-rendered multiplayer reload and Rotmire pacing caveats remain. New production art commits on main are not yet integrated into this review branch. The draft PR retains its earlier preserved world implementation, but entry is disabled and current development is custom-only.

## Screenshots

![Laptop map browser](custom-navigation-20261128/maps-laptop.png)
![Phone map browser](custom-navigation-20261128/maps-phone.png)
![Landscape map browser](custom-navigation-20261128/maps-landscape.png)

Final landscape measurement: three complete rows between y128–274, selected objective y287–328, actions y333–386 on 844×390. The details pane no longer covers map clicks. `profile-negative-control.log` retains the saved-character hero-lock failure before its fix.
