# Falling Cat

An interactive simulation where **you are the cat**: it starts upside down in free fall and you have to
land on your feet by changing your body shape. Total angular momentum is zero the whole way down.

## Run it

Double-click `index.html`. It runs in any modern browser with nothing to install. three.js (3D graphics)
loads from a CDN, so the first load needs an internet connection.

## Models

- **A · Tuck-and-turn cat** (simplest): model B's body, but the spine only twists, it can't bend.
  It turns over by tucking one pair of legs, twisting, swapping legs and untwisting: about 64° per
  0.66 s cycle, so upside down it needs ~12.8 m (model B: ~0.6 m). Its Challenge drops are ×20.
  Each cycle also tips the nose ~10° (the legs hang below the spine's axis); its reflex alternates
  front-first and back-first cycles so those tips cancel.
- **B · Two-cylinder cat with legs** (base): Kane–Scher two cylinders + one point mass per leg.
- **C · Cat with jointed legs**: shorter, stockier body; each leg has a knee/elbow (two point masses).
  The knees fold on landing, spreading the stop over ~16 cm instead of ~2 cm: from 3 m that is
  about 18× body weight instead of ~140×.
- **D · Flexible-spine cat** (most detailed): chest, waist and hips joined by two spine joints, plus
  jointed legs. The front joint bends (65°) and twists (90°) further and faster than the stiffer back
  joint (35°, 30°), following a 2026 study of real cats. Its reflex treats the spine as one joint and
  lands upside-down drops from 0.74 m; the optimizer's front-first move (front legs tucked, back legs
  spread, front half lands its turn ~36 ms ahead) lands from 0.48 m.

Coats: A grey tabby, B ginger, C tuxedo, D Siamese.

The game opens on a main menu to pick the model and mode (Esc or the Menu button returns to it).

## Controls

| Control | Keys | Slider/dial |
|---|---|---|
| Spine bend | W / S | slider |
| Bend direction | A / D (hold to sweep) | dial: drag around it |
| Spine twist | Q / E | slider |
| Front legs | Z tuck / X spread | slider |
| Back legs | C tuck / V spread | slider |
| Knee bend (models C, D) | J bend / K straighten | slider |
| Back spine bend / twist (model D; W/S and Q/E work the front joint) | T / G, Y / H | sliders |
| Drop / Reset / Straighten / Pause | Space / R / N / P | buttons |

A speed bar over the scene sets playback speed (1/50× to 1×, with presets) and pauses (locked in Challenge).

Modes: **Challenge** (levels with shrinking drop height), **Free drop** (pick height and start, from
0.3 m up to 30 floors), **Zero-g practice** (no gravity, no clock), and **Watch the cat**: you set the
starting roll, pitch, pose and reaction delay, and the cat rights itself, with either its reflex or the
optimizer's computer-found moves. Every landing shows a flight log of feet angle and spine bend over time,
and the impact force. Air resistance is on by default (spread legs cap the speed near 27 m/s).

**While watching**, a narrator panel (bottom left) names each move as it happens, explains the physics behind it,
shows live numbers (roll still to go, each half's moment of inertia, impact) and keeps a timeline of the moves.
Turn it off with "Explain what the cat is doing" in the Watch setup. Its "Why?" link opens `physics.html` at that topic.

**`physics.html`** (menu → The physics) explains moment of inertia, angular momentum and its conservation, tuck and
turn, bend and twist (Kane–Scher), the leg pump, timing, landing impact, air drag and zero g, with three small
calculators and a table of each model's numbers computed live from the game's own code.

## How the cat rights itself (reflex / autopilot)

1. **Roll** upright by bend-and-twist: hold a big spine bend and sweep its direction around, with the
   legs tucked while more than 45° of roll remains (learned from the optimizer).
2. **Pitch** (nose up/down) by a leg pump: tuck one pair of legs, bend toward the belly, swap legs,
   straighten. One full pump is ~24° (B) / ~35° (C) and takes 0.42 s; the cat fixes as much as time allows.
3. Straighten, spread the legs and (C) straighten the knees for the most cushioning.

## Results and the lab

`results.html` shows everything the lab computed (open it directly, or from the link in the game):

- **Validation**: the engine matches the exact Kane–Scher formula to 0.0003° (21 cases).
- **Survival map**: 424,908 drops (all four models) over starting roll, pitch, height (0.3–25 m) and
  reaction delay (0–200 ms). With a 60 ms reflex, models B, C and D land on their feet from any starting
  roll above about 0.5–0.6 m; model A, which can't bend, needs about 12.5 m.
- **Optimizer** (CMA-ES, ~1.1 million drops): computer-found moves land perfectly from drops 20–55% lower
  than the original reflex, by combining bend-and-twist with tuck-and-turn; teaching the reflex to tuck
  its legs closed most of that gap.
- **High-rise falls**: landing speed and impact up to 30 floors; speed alone does not explain the
  "fewer injuries above 7 floors" finding of the 1987 high-rise study.
- **Zero gravity** (`lab/zerog.html`, 960 twenty-second weightless spells): the reflex steers toward where
  the cat *believes* down is. Seeing the cabin floor, cats stay feet-down ~99% of the time; with no sense of
  down only 9–12%, while working their spines many times harder; a fading memory of down sits in between.

**Zero g in the game:** Watch the cat → Gravity: Zero g. The cat floats in a parabolic-flight cabin for 20 s;
pick its sense of down (sees the floor / remembers down, fading / none). The gauge's white ring shows where
the cat thinks down is.

To re-run any study, start the lab server (right-click `lab/serve.ps1` → Run with PowerShell) and open
`http://localhost:8123/lab/validation.html`, `survival.html`, `optimizer.html`, `reflex-experiment.html` or
`highrise.html` or `zerog.html` (`optimizer.html?models=D&rolls=180&seed=150` re-runs one case warm-started from another). Results save to `lab/results/` and are bundled into `data.js` / `data-survival.js`.

## Files

- `js/math3.js` — 3-vector / 3x3 matrix helpers
- `js/physics.js` — model-independent engine: solves the vector equation **L** = 0 (as **J Ω** = −**h**, with **J** the whole-cat inertia tensor) for the body rotation each 0.5 ms sub-step
- `js/models/twoCylinder.js` — shared builder for all four models: body segments, legs, landing stroke, autopilot, coach
- `js/models/modelA.js` … `modelD.js` — each model's parameters (A: `bendable: false`, D: `flexibleSpine: true`)
- `js/render.js` — three.js scene and cat visual
- `js/ui.js` — control panel built from the model's `controls` list
- `js/game.js` — modes, levels, falling, landing absorption, scoring, flight log
- `js/sim.js` — headless drop simulation shared by the game and the lab (landing, air drag)
- `js/pilots.js` — optimized (timed) pilots and reflex variants used by the lab
- `js/narrator.js` — describes the current move and its physics (reads the reflex's `mem.stage`, or the shape for timed moves)
- `physics.html` — the physics explained, with calculators and live model numbers
- `results.html` — charts of all lab results
- `lab/` — batch studies (run in parallel web workers), CMA-ES optimizer, local server, saved results
- `tests/physics-tests.html` — physics checks (needs the lab server: `lab/serve.ps1`)

## Adding a model

Push an object onto `FC.models` with `controls`, `bodies(shape)`, `geometry(shape)`, `ventral(shape)`,
`params`, `landingStroke`, `compress` and optionally `autopilot(shape, info, mem)` and `coach(shape, info)`.
The engine and control panel adapt automatically.
