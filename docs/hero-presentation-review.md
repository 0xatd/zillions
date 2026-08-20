# Hero Presentation Review

Use the live renderer for review. Do not judge the models from source geometry.

Install dependencies, then run the deterministic browser capture:

```bash
npm ci
mkdir -p /tmp/zillions-hero-review
ZILLIONS_VISUAL_QA_DIR=/tmp/zillions-hero-review npm run check:browser
```

The capture writes every Human and Robot face from the front, plus three-quarter
views of light and heavy Human bodies, the Robot reverse-joint silhouette, and
a fully equipped Robot to the review directory.

Review each image at its original 1440 × 1000 size and at 50 percent scale.
Check these points:

1. Human faces have visible eyes, nose, and face markings.
2. Robots read as mechanical from joints, shoulders, sensor, and torso core.
3. Light, standard, and heavy bodies have different width and depth.
4. Frontline, skirmisher, and signal roles have distinct large props.
5. Flak, powered, weave, and shroud chest families change the silhouette.
6. Marked equipment uses one cyan accent. Prime equipment uses paired amber
   accents. Rarity does not recolor the full character.
7. Head, chest, hands, legs, and boots remain visible together.

The browser check also rejects a procedural hero above 8,000 triangles or 70
mesh parts. These limits protect the live fallback path. The simulation does
not read presentation state.
