# First-Hour Quality Release Contract

## Outcome

A new player can create a hero, understand the core progression systems, beat
Greenfall Marches on Casual, learn from a failed run, and have a fair path
through Rotmire.

## Required Work

- Record enough run evidence to explain campaign wins and losses.
- Make Greenfall and Rotmire form a clear Casual difficulty progression.
- Show actionable combat threats without persistent screen clutter.
- Explain defeat causes and provide a fast retry path.
- Connect character creation, equipment, vendors, the Forge, and mission entry.
- Show the stat effect of equipment and crafting choices.
- Preserve server authority for characters, inventory, currency, and crafting.
- Preserve saved campaign progress and existing accounts.

## Release Gates

- Full repository checks pass.
- Browser regression checks pass.
- The local production build passes.
- Deterministic campaign checks pass.
- A fresh authenticated account completes the first-hour flow.
- A real playthrough beats Greenfall and Rotmire on Casual without shortcuts.
- Existing-account progression and economy checks pass.
- A two-user authenticated multiplayer smoke test passes.
- The full diff receives a mergeable and deployable verdict.

## Constraints

- Do not add maps, races, classes, currencies, monetization, or trading.
- Do not rewrite the engine.
- Do not create a unique visual model for each item.
- Do not merge specialist branches without integration review.
- Telemetry failures must not stop or corrupt gameplay.
- Guidance must be skippable for returning players.

## Integration Order

1. Campaign telemetry and evidence-based balance.
2. Combat readability and defeat recovery.
3. First-session onboarding and progression clarity.
4. Hero presentation.
5. Authenticated multiplayer validation.

