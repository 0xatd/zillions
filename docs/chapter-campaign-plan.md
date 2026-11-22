# Chapter campaign — accepted product decision, 2026-11-22

Alex authorized chapter identity, named playable leaders, account conquest and a chapter armory, replacing character-first presentation. This supersedes the old menu contract, not the siege simulation or the ban on shared-world MMO systems.

## Hold-scope review

Alternatives: cosmetic relabel (small but fails actual progression); account chapter over existing authoritative campaign/characters (medium, chosen); new galaxy/database simulation (XL, unnecessary migration and multiplayer risk). Reuse five Earth battlefields and server campaign-cleared ledger.

Flow: sign in → chapter identity → customizable founder → Earth city campaign + leader roster → select leader/equip → solo/co-op siege → confirmed capture/rewards → chapter unlocks → next city/expedition.

1. Architecture: pure city/leader unlock module; metadata owns cosmetic identity; player_stats remains conquest authority. Characters retain gear/XP records.
2. Errors: failed sync retains inputs and shows retry; no optimistic capture. Full legacy rosters preserved.
3. Security: escaped bounded names; metadata cannot grant online campaign progress, rewards or items. No client currency writes.
4. Interaction: repeated recruitment idempotent; locked leader selection refused; no roster mutation mid-match; return/navigation preserved.
5. Quality: reuse gear, hero kits, persistence and campaign eligibility, not duplicate economy.
6. Tests: new/legacy normalization, captures/unlocks, repeated recruitment, unavailable state, hero payload and confirmed refresh; responsive browser and co-op smoke.
7. Observability: visible load/save failures and match receipts; no new monitoring service.
8. State: additive cosmetic metadata; server-derived conquest, preserve IDs; no destructive migration.
9. API: existing metadata/economy/reward routes; no new reward grant path.
10. Performance: seven leaders/five cities, no workers or background conquest simulation.
11. UX: campaign first, leader/armory adjacent; no mandatory shopping tutorial. Existing custom characters remain accessible, not primary creation path.

Scope: one chapter, seven existing heroes, five Earth captures with leader unlocks, staff/service presentation, chapter identity and armory. Existing procedural frontier remains accessible after Earth; not a newly authored galaxy. No new hero kits, shared territory, NPC walking errands, arbitrary damage inflation or new art assets. Campaign balance needs play feedback.

Alex refined the start to Bannerlord-style founder → companions → chapter growth.
A new founder uses the completed Vanguard kit and existing customizable model;
prototype classes are not offered in onboarding. Existing founders retain their
original class/build. Companions are recruited after captures, starting with
Scott and Alexander after Greenfall. No new campaign quests beyond the authored
five-city chain; the unlock itself is the first concrete conquest consequence.
