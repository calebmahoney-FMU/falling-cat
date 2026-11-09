// Game loop: modes, levels, falling, landing and scoring.
(function () {
  const { v, mv } = FC.m3;
  const deg = Math.PI / 180;
  const G = 9.81;
  const SUBSTEP = 5e-4; // simulated seconds per physics sub-step
  const FLOAT_HEIGHT = 1.2;
  const CABIN_Y = 1.25; // centre of the zero-g cabin (its floor is just above the ground)
  // Challenge levels: drop height (m), slow-motion factor, random roll spread
  // around upside down (deg), random pitch (deg). A flawless righting from
  // exactly upside down needs ~0.37 s, so the last level (0.42 s fall) is near
  // the cat's physical limit.
  const LEVELS = [
    { height: 3.0, speed: 0.15, spread: 20, pitch: 0 },
    { height: 2.5, speed: 0.15, spread: 35, pitch: 0 },
    { height: 2.0, speed: 0.2, spread: 50, pitch: 0 },
    { height: 1.7, speed: 0.2, spread: 60, pitch: 0 },
    { height: 1.5, speed: 0.25, spread: 70, pitch: 5 },
    { height: 1.3, speed: 0.3, spread: 80, pitch: 8 },
    { height: 1.15, speed: 0.35, spread: 90, pitch: 8 },
    { height: 1.0, speed: 0.4, spread: 90, pitch: 10 },
  ];

  const $ = (id) => document.getElementById(id);
  const renderer = new FC.Renderer($("view"));
  const controls = new FC.Controls($("controls"));

  const game = {
    model: null,
    mode: "challenge",
    level: 0,
    phase: "ready", // ready | falling | absorbing | landed | float
    pilotMem: {}, // autopilot memory (current pitch pump), cleared every drop
    absorb: null, // landing absorption: speed, stroke, impact
    demo: false,
    R: null,
    shape: null,
    height: 2,
    t: 0,
    tTotal: 1,
    pos: [0, 2, 0],
    L: 0,
    watchPose: null, // Watch mode: the starting pose the player set, restored on retry
    log: [], // flight log samples {t, front, back, bend} in degrees
    rightedAt: null, // Watch mode: when the cat first came within 15° of upright
  };

  const MODE_INFO = {
    challenge: "You are the cat. Beat 8 levels, each with less time to turn over.",
    free: "You are the cat. Pick the drop height, slow motion and start yourself.",
    float: "You are the cat, floating with no gravity and no clock. Learn the moves.",
    watch: "You set how the cat starts: its tilt, its pose and the drop. The cat decides how to land.",
  };

  const store = {
    get(k, d) { try { const x = localStorage.getItem("fallingcat." + k); return x === null ? d : JSON.parse(x); } catch { return d; } },
    set(k, x) { try { localStorage.setItem("fallingcat." + k, JSON.stringify(x)); } catch {} },
  };

  // One-time move of saved choices and best scores from the old model letters
  // (A, C, D) to the current ones (A, B, C): C -> B first, then D -> C.
  if (store.get("letters", 1) < 2) {
    const rename = { C: "B", D: "C" };
    const oldModel = store.get("menuModel", null);
    if (rename[oldModel]) store.set("menuModel", rename[oldModel]);
    for (let lvl = 0; lvl < 8; lvl++) {
      const old = { C: store.get(`best.C.L${lvl}`, null), D: store.get(`best.D.L${lvl}`, null) }; // read all before writing
      for (const k of ["C", "D"]) try { localStorage.removeItem(`fallingcat.best.${k}.L${lvl}`); } catch {}
      for (const k of ["C", "D"]) if (old[k] !== null) store.set(`best.${rename[k]}.L${lvl}`, old[k]);
    }
    store.set("letters", 2);
  }

  // ---------- setup ----------
  function initModels() {
    const sel = $("model-select");
    for (const m of FC.models) {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.available ? m.name : `${m.name} (coming soon)`;
      o.disabled = !m.available;
      sel.appendChild(o);
    }
    sel.value = "B";
    sel.addEventListener("change", () => setModel(sel.value));
    setModel("B");
  }

  function setModel(id) {
    game.model = FC.models.find((m) => m.id === id);
    $("model-desc").textContent = game.model.description;
    // A Watch-mode starting pose belongs to the old model (other controls): never restore it on the new one.
    game.watchPose = null;
    controls.build(game.model);
    renderer.setModel(game.model);
    reset();
  }

  const neutralShape = () => FC.sim.neutral(game.model);
  // How far the spine is from straight, in degrees (bend, or twist for a twist-only spine).
  const spineDeg = (s = game.shape) => (game.model.spineAngle ? game.model.spineAngle(s) : s.bend) / deg;

  function startOrientation() {
    if (game.mode === "watch") return FC.sim.startR(+$("roll").value, +$("pitch").value);
    let roll = 180, pitch = 0;
    const challenge = game.mode === "challenge";
    if (challenge || $("start").value === "random") {
      const { spread, pitch: maxPitch } = challenge ? LEVELS[game.level] : { spread: 70, pitch: 10 };
      roll = 180 + (Math.random() * 2 - 1) * spread;
      pitch = (Math.random() * 2 - 1) * maxPitch;
    }
    return FC.sim.startR(roll, pitch);
  }

  // Drop heights on the slider: fine steps for short drops, then whole floors
  // (3 m each) up to a high-rise.
  const FLOOR_H = 3;
  const HEIGHTS = [
    ...Array.from({ length: 18 }, (_, i) => +(0.3 + 0.1 * i).toFixed(1)), // 0.3 .. 2.0
    ...Array.from({ length: 12 }, (_, i) => 2.25 + 0.25 * i), // 2.25 .. 5.0
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30].map((f) => f * FLOOR_H),
  ];
  const heightM = () => HEIGHTS[+$("height").value];
  const nearestHeightIndex = (h) => HEIGHTS.reduce((best, x, i) => (Math.abs(x - h) < Math.abs(HEIGHTS[best] - h) ? i : best), 0);
  $("height").max = HEIGHTS.length - 1;
  $("height").value = nearestHeightIndex(2);

  // Challenge drop height for the current level, scaled per model (model A needs far more time to turn over).
  const levelHeight = () => +(LEVELS[game.level].height * (game.model.challengeScale ?? 1)).toFixed(2);

  // Slow-motion factor: set by the level in Challenge, by the slider otherwise.
  const simSpeed = () => (game.mode === "challenge"
    ? Math.min(1, LEVELS[game.level].speed * (game.model.challengeSpeedScale ?? 1)) : +$("speed").value);

  // ---------- speed bar over the scene ----------
  // Log-scale slider (1/50× .. 1×) so the slow end gets fine control; it drives the
  // panel's slow-motion slider. Pause stops time (not in Challenge, where speed is the level's).
  const SPEED_MIN = 0.02;
  const speedToBar = (sp) => Math.log(sp / SPEED_MIN) / Math.log(1 / SPEED_MIN);
  const barToSpeed = (b) => SPEED_MIN * (1 / SPEED_MIN) ** b;
  const speedLabel = (sp) => (sp >= 0.995 ? "1×" : sp >= 0.1 ? `${sp.toFixed(2)}×` : `1/${Math.round(1 / sp)}×`);

  function setSpeed(sp) {
    $("speed").value = Math.max(SPEED_MIN, Math.min(1, sp));
    updateSetupUi();
  }

  function syncSpeedBar() {
    const sp = simSpeed(), locked = game.mode === "challenge";
    $("speed-bar").value = speedToBar(sp);
    $("speed-bar-out").textContent = speedLabel(sp);
    $("speedbar").classList.toggle("locked", locked);
    $("speedbar").title = locked ? "Challenge levels set their own slow motion" : "";
    document.querySelectorAll("#speedbar [data-speed]").forEach((b) => b.classList.toggle("on", Math.abs(+b.dataset.speed - sp) < 0.005));
    if (locked) game.paused = false;
    $("pause").disabled = locked;
    $("pause").classList.toggle("paused", !!game.paused);
    $("pause").innerHTML = game.paused ? "&#9654;" : "&#10074;&#10074;";
    $("pause").title = game.paused ? "Resume (P)" : "Pause (P)";
  }

  function togglePause() {
    if (game.mode === "challenge") return;
    game.paused = !game.paused;
    syncSpeedBar();
  }

  $("speed-bar").addEventListener("input", () => setSpeed(barToSpeed(+$("speed-bar").value)));
  document.querySelectorAll("#speedbar [data-speed]").forEach((b) => b.addEventListener("click", () => setSpeed(+b.dataset.speed)));
  $("pause").addEventListener("click", togglePause);

  function reset() {
    hideBanner();
    game.demo = false;
    controls.enabled = true;
    if (game.mode === "watch") {
      // Keep the pose the player set; after a drop, restore the pose that drop started from.
      if (game.watchPose && game.phase !== "ready") controls.targets = { ...game.watchPose };
      game.shape = { ...controls.targets };
    } else {
      controls.reset();
      game.shape = neutralShape();
    }
    controls.dialStart = game.shape.dir;
    game.R = startOrientation();
    game.t = 0;
    game.L = 0;
    game.log = [];
    game.rightedAt = null;
    game.pilotMem = {};
    game.schedPilot = null; // Watch mode: optimized open-loop pilot, set on drop
    game.absorb = null;
    game.height = game.mode === "challenge" ? levelHeight() : heightM();
    game.zg = null; // zero-g run state, set on drop
    game.nar = { timeline: [] }; // narrator: moves so far, {t, title}
    if (game.mode === "float") {
      game.phase = "float";
      game.pos = [0, FLOAT_HEIGHT, 0];
    } else if (zeroG()) {
      game.phase = "ready"; // held in the middle of the cabin until released
      game.pos = [0, CABIN_Y, 0];
    } else {
      game.phase = "ready";
      game.pos = [0, game.height, 0];
    }
    renderer.setCabin(zeroG(), CABIN_Y);
    // Time until the paws reach the ground (approx.), used for the clock and by the autopilot.
    game.tTotal = FC.sim.fallTime(game.model, game.height, airOn());
    game.vy = 0;
    game.mass = FC.sim.totalMass(game.model);
    // In the menu the camera stays on the standing cat (switching models resets the game behind it).
    renderer.setTargetY(menu.open ? MENU_TARGET_Y : game.pos[1], false);
    updateSetupUi();
  }

  function drop(demo = false) {
    if (game.mode === "float") {
      if (demo) { game.demo = true; controls.enabled = false; game.pilotMem = {}; }
      return;
    }
    if (game.phase !== "ready") reset();
    game.schedPilot = null;
    if (game.mode === "watch") {
      game.watchPose = { ...controls.targets };
      game.shape = { ...controls.targets };
      demo = true; // the cat flies itself
      const opt = optimizedStart();
      if (opt) {
        // The optimized moves were found from the neutral pose.
        game.shape = neutralShape();
        controls.targets = { ...game.shape };
        game.schedPilot = opt.pilot;
      }
    } else if (demo) {
      controls.reset();
      game.shape = neutralShape();
      controls.dialStart = game.shape.dir;
    }
    game.demo = demo;
    controls.enabled = !demo;
    game.pilotMem = {};
    game.phase = "falling";
    game.t = 0;
    game.vy = 0;
    if (game.mode === "watch" && zeroG()) {
      // Released in zero g: the cat floats, steering by where it believes down is.
      game.phase = "float";
      game.zg = { t: 0, dur: FC.sim.ZERO_G_SECONDS, upright: 0, first: null, effort: 0, errSum: 0, n: 0,
        keys: FC.sim.spineKeys(game.model),
        belief: FC.sim.makeBelief($("cue").value, { seed: (Math.random() * 1e9) | 0, drift: +$("drift").value }) };
    }
    game.paused = false; // a new drop always starts running
    game.nar = { timeline: [] };
    syncSpeedBar();
  }

  // ---------- simulation (shared helpers in js/sim.js) ----------
  const moveToward = (s, target, dt) => FC.sim.moveToward(game.model, s, target, dt);
  const rollError = () => FC.sim.rollError(game.R);
  const pitchError = () => FC.sim.pitchError(game.R);
  const feetAngles = () => FC.sim.feetAngles(game.model, game.R, game.shape);
  const lowestPoint = () => FC.sim.lowestPoint(game.model, game.R, game.shape, game.pos[1]);
  const airOn = () => $("air-on").checked;
  const zeroG = () => game.mode === "watch" && $("gravity").value === "zerog";

  // What the reflex steers by: true up, or in zero g the cat's belief about up.
  function pilotInfo() {
    const timeLeft = game.phase === "float" ? Infinity : game.tTotal - game.t;
    if (game.zg) return { roll: FC.sim.rollError(game.R, game.zg.belief.up), pitch: FC.sim.pitchError(game.R, game.zg.belief.up), timeLeft };
    return { roll: rollError(), pitch: pitchError(), timeLeft };
  }

  // End of the weightless spell: report how well the cat kept its feet toward the floor.
  function endZeroG() {
    const z = game.zg;
    game.phase = "landed";
    const frac = z.upright / z.dur, err = z.errSum / Math.max(1, z.n) / deg;
    const [title, cls] = frac >= 0.8 ? ["Kept its feet to the floor", "good"] : frac >= 0.3 ? ["Partly oriented", "bad"] : ["Lost in space", "bad"];
    const cueName = { floor: "it could see the cabin floor", memory: `its memory of down faded by ${$("drift").value}°/√s`, none: "it had no sense of down" }[$("cue").value];
    const text = `Feet toward the floor ${(100 * frac).toFixed(0)}% of the ${z.dur} s of weightlessness (${cueName}).\n` +
      `${z.first === null ? "Never got its feet toward the floor" : `First got its feet toward the floor after ${z.first.toFixed(2)} s`} · ` +
      `its sense of down was off by ${err.toFixed(0)}° on average.\n` +
      `It moved its spine ${(z.effort / (2 * Math.PI)).toFixed(1)} full turns' worth trying to get there.`;
    drawChart();
    showBanner(title, text, cls, false);
  }

  // After the paws touch: the body keeps sinking over the legs' stroke d with
  // constant deceleration a = v²/2d, so the peak load is 1 + v²/(2 g d) body weights.
  function startAbsorbing() {
    const worst = Math.max(...feetAngles());
    const vImpact = game.vy;
    const d = game.model.landingStroke(game.shape, worst);
    const a = (vImpact * vImpact) / (2 * d);
    game.absorb = { t: 0, v: vImpact, d, a, dur: vImpact / a, y0: game.pos[1], shape0: { ...game.shape },
      impact: 1 + a / G };
    game.phase = "absorbing";
  }

  function absorbStep(simDt) {
    const ab = game.absorb;
    ab.t = Math.min(ab.dur, ab.t + simDt);
    const sunk = ab.v * ab.t - 0.5 * ab.a * ab.t * ab.t;
    game.pos[1] = ab.y0 - sunk;
    game.shape = game.model.compress(ab.shape0, sunk);
    if (ab.t >= ab.dur) land();
  }

  function simulate(simDt) {
    const physicsOn = game.phase === "falling" || game.phase === "float";
    if (game.phase === "landed") return;
    if (game.phase === "absorbing") return absorbStep(simDt);

    // In Watch mode the cat holds its starting pose until its reflex kicks in.
    const delayS = +$("delay").value / 1000;
    const reacting = game.zg ? game.zg.t >= delayS
      : game.mode !== "watch" || game.phase !== "falling" || game.t >= delayS;
    if (game.demo && game.schedPilot) {
      if (reacting) controls.targets = game.schedPilot(game.shape, pilotInfo(), game.t - +$("delay").value / 1000);
    } else if (game.demo && game.model.autopilot) {
      if (reacting) controls.targets = game.model.autopilot(game.shape, pilotInfo(), game.pilotMem);
    } else controls.applyKeys(simDt);

    const n = Math.max(1, Math.ceil(simDt / SUBSTEP));
    const h = simDt / n;
    const kOverM = airOn() ? 1 / game.mass : 0;
    let maxL = 0;
    for (let i = 0; i < n; i++) {
      const s1 = moveToward(game.shape, controls.targets, h);
      if (physicsOn) {
        const st = FC.physics.step(game.model, game.R, game.shape, s1, h);
        game.R = st.R;
        maxL = Math.max(maxL, v.norm(st.L));
      }
      if (game.zg) {
        // Zero g: the belief drifts or jumps, and we score the run as it goes.
        const z = game.zg;
        z.belief.step(h, z.t);
        z.effort += FC.sim.spineMotion(z.keys, game.shape, s1);
        if (Math.max(...FC.sim.feetAngles(game.model, game.R, s1)) < 45 * deg) { z.upright += h; if (z.first === null) z.first = z.t; }
        z.errSum += FC.sim.angleBetween(z.belief.up, [0, 1, 0]);
        z.n++;
        z.t += h;
      }
      game.shape = s1;
      if (game.phase === "falling") {
        // Gravity minus air drag ½ρ(Cd·A)v², with Cd·A from the current pose.
        game.vy += (G - kOverM * FC.sim.dragK(game.model, game.shape) * game.vy * game.vy) * h;
        game.pos[1] -= game.vy * h;
      }
    }
    if (physicsOn) game.L = maxL;

    if (game.zg && game.phase === "float") {
      // Flight log: feet relative to the cabin floor, and how wrong the cat's sense of down is.
      const [f, b] = feetAngles().map((a) => a / deg);
      game.log.push({ t: game.zg.t, front: f, back: b, bend: FC.sim.angleBetween(game.zg.belief.up, [0, 1, 0]) / deg });
      if (game.zg.t >= game.zg.dur) endZeroG();
    }

    if (game.phase === "falling") {
      game.t += simDt;
      const [f, b] = feetAngles().map((a) => a / deg);
      game.log.push({ t: game.t, front: f, back: b, bend: spineDeg() });
      if (game.rightedAt === null && Math.max(f, b) < 15) game.rightedAt = game.t;
      const low = lowestPoint();
      if (low <= 0) {
        game.pos[1] -= low; // paws on the ground
        startAbsorbing();
      }
    }
  }

  // ---------- landing & scoring ----------
  function land() {
    game.phase = "landed";
    const [aF, aB] = feetAngles().map((a) => a / deg);
    const worst = Math.max(aF, aB), avg = (aF + aB) / 2;
    const bendDeg = spineDeg();
    const legs = ((game.shape.front ?? 1) + (game.shape.back ?? 1)) / 2;
    let score = Math.max(0, 80 * (1 - avg / 90));
    const notes = [];
    if (worst < 45) {
      if (bendDeg < 25) { score += 10; notes.push("spine straight +10"); }
      else notes.push("spine still bent");
      if (legs > 0.7) { score += 10; notes.push("legs ready +10"); }
      else notes.push("legs tucked");
    }
    score = Math.round(score);

    let title, cls;
    if (worst < 20) [title, cls] = ["Perfect landing!", "good"];
    else if (worst < 45) [title, cls] = ["Landed on its feet", "good"];
    else if (worst < 100) [title, cls] = ["Clumsy landing", "bad"];
    else [title, cls] = ["Splat! Landed on its back", "bad"];
    const success = worst < 45;

    const realT = game.t / simSpeed();
    let text = `Front feet ${aF.toFixed(0)}° from down · back feet ${aB.toFixed(0)}°\n`;
    if (game.mode === "watch") {
      const delay = +$("delay").value;
      text += `Fall time ${game.t.toFixed(2)} s · reaction delay ${delay} ms · ` +
        (game.rightedAt === null ? "never got within 15° of upright" : `within 15° of upright after ${game.rightedAt.toFixed(2)} s`) + "\n";
    } else {
      text += `Fall time ${game.t.toFixed(2)} s (you had ${realT.toFixed(1)} s in slow motion)\n`;
    }
    if (notes.length) text += notes.join(" · ") + "\n";
    const ab = game.absorb;
    text += `Impact ${ab.impact.toFixed(0)}× body weight (hit at ${ab.v.toFixed(1)} m/s, stopped over ${(ab.d * 100).toFixed(0)} cm)\n`;
    text += `Score ${score}`;

    if (game.mode === "challenge" && !game.demo) {
      const key = `best.${game.model.id}.L${game.level}`;
      const best = store.get(key, 0);
      if (score > best) { store.set(key, score); text += " — new best!"; }
      else text += ` (best ${best})`;
    }
    if (game.demo && game.mode !== "watch") text += "\n(computer demo: try it yourself!)";
    drawChart();
    showBanner(title, text, cls, success && game.mode === "challenge" && !game.demo && game.level < LEVELS.length - 1);
  }

  function showBanner(title, text, cls, canAdvance) {
    $("banner").className = cls;
    $("banner-title").textContent = title;
    $("banner-text").textContent = text;
    $("banner-next").style.display = canAdvance ? "" : "none";
  }
  function hideBanner() { $("banner").className = "hidden"; }

  // Flight log: feet angle from straight down (front, back) and spine bend vs time.
  function drawChart() {
    const cv = $("chart"), g = cv.getContext("2d");
    const W = cv.width, H = cv.height, L = 44, Rm = 10, Tp = 12, B = 30;
    const pw = W - L - Rm, ph = H - Tp - B;
    const log = game.log, tMax = Math.max(0.05, game.zg ? game.zg.t : game.t);
    const x = (t) => L + (t / tMax) * pw, y = (d) => Tp + (1 - d / 180) * ph;
    g.clearRect(0, 0, W, H);
    g.font = "12px system-ui, sans-serif";
    // Landing zone and grid.
    g.fillStyle = "rgba(79,196,127,0.14)";
    g.fillRect(L, y(45), pw, y(0) - y(45));
    g.strokeStyle = "#313a4b"; g.lineWidth = 1; g.fillStyle = "#9aa4b5"; g.textAlign = "right"; g.textBaseline = "middle";
    for (const d of [0, 45, 90, 135, 180]) {
      g.beginPath(); g.moveTo(L, y(d)); g.lineTo(L + pw, y(d)); g.stroke();
      g.fillText(`${d}°`, L - 6, y(d));
    }
    g.textAlign = "center"; g.textBaseline = "top";
    const step = tMax > 6 ? 2 : tMax > 0.6 ? 0.2 : 0.1;
    for (let t = 0; t <= tMax + 1e-9; t += step) g.fillText(`${t.toFixed(step >= 1 ? 0 : 1)} s`, x(t), H - B + 8);
    if (game.mode === "watch") {
      const td = +$("delay").value / 1000;
      if (td > 0 && td < tMax) {
        g.setLineDash([3, 4]); g.strokeStyle = "#9aa4b5";
        g.beginPath(); g.moveTo(x(td), Tp); g.lineTo(x(td), Tp + ph); g.stroke();
        g.setLineDash([]); g.textAlign = "left"; g.fillText("reflex starts", x(td) + 4, Tp + 2);
      }
    }
    const line = (key, color, dash) => {
      if (!log.length) return;
      g.strokeStyle = color; g.lineWidth = 2.5; g.setLineDash(dash || []);
      g.beginPath();
      log.forEach((p, i) => (i ? g.lineTo(x(p.t), y(p[key])) : g.moveTo(x(p.t), y(p[key]))));
      g.stroke();
      g.setLineDash([]);
    };
    line("bend", "#9aa4b5", [5, 4]);
    line("back", "#5fb3f0");
    line("front", "#f29a3a");
    // Legend.
    g.textAlign = "left"; g.textBaseline = "middle";
    const third = game.zg ? "Down-sense error" : game.model.bendable === false ? "Spine twist" : "Spine bend";
    [["Front feet", "#f29a3a"], ["Back feet", "#5fb3f0"], [third, "#9aa4b5"]].forEach(([name, c], i) => {
      const lx = L + pw - 300 + i * 100;
      g.fillStyle = c; g.fillRect(lx, Tp + 6, 14, 3);
      g.fillStyle = "#c9d0dc"; g.fillText(name, lx + 18, Tp + 8);
    });
  }

  // ---------- HUD ----------
  const gauge = $("gauge").getContext("2d");

  function drawGauge() {
    const W = 160, c = W / 2, R = 62;
    const g = gauge;
    g.clearRect(0, 0, W, W);
    g.strokeStyle = "#313a4b"; g.lineWidth = 2;
    g.beginPath(); g.arc(c, c, R, 0, 2 * Math.PI); g.stroke();
    // Landing zone (within 45° of straight down).
    g.strokeStyle = "rgba(79,196,127,0.55)"; g.lineWidth = 8;
    g.beginPath(); g.arc(c, c, R, Math.PI / 2 - Math.PI / 4, Math.PI / 2 + Math.PI / 4); g.stroke();
    g.fillStyle = "#9aa4b5"; g.font = "11px system-ui, sans-serif"; g.textAlign = "center";
    g.fillText(zeroG() ? "floor" : "ground", c, W - 3);
    g.fillText(zeroG() ? "ceiling" : "sky", c, 10);

    // Project onto the plane perpendicular to the cat's long axis (view along the spine).
    // Seen from behind the cat (same view as the bend-direction dial), so screen-right = down × axis.
    const axis = mv(game.R, [1, 0, 0]);
    let down = v.sub([0, -1, 0], v.scale(axis, -axis[1]));
    if (v.norm(down) < 0.2) down = v.sub([0, 0, -1], v.scale(axis, -axis[2]));
    down = v.unit(down);
    const side = v.cross(down, axis);
    if (game.zg) {
      // Where the cat believes down is: a hollow white ring on the dial.
      const bd = v.scale(game.zg.belief.up, -1);
      const a = Math.atan2(v.dot(bd, side), v.dot(bd, down));
      g.strokeStyle = "#ffffff"; g.lineWidth = 2;
      g.beginPath(); g.arc(c + R * Math.sin(a), c + R * Math.cos(a), 7, 0, 2 * Math.PI); g.stroke();
    }
    const ventral = game.model.ventral(game.shape);
    const colors = ["#f29a3a", "#5fb3f0"];
    ventral.forEach((u, i) => {
      const w = mv(game.R, u);
      const a = Math.atan2(v.dot(w, side), v.dot(w, down));
      const x = c + R * 0.8 * Math.sin(a), y = c + R * 0.8 * Math.cos(a);
      g.strokeStyle = colors[i]; g.lineWidth = 4; g.lineCap = "round";
      g.beginPath(); g.moveTo(c, c); g.lineTo(x, y); g.stroke();
      g.fillStyle = colors[i];
      g.beginPath(); g.arc(x, y, 5, 0, 2 * Math.PI); g.fill();
    });
  }

  function updateHud() {
    const [aF, aB] = feetAngles().map((a) => a / deg);
    $("ang-front").textContent = `${aF.toFixed(0)}°`;
    $("ang-back").textContent = `${aB.toFixed(0)}°`;
    $("hud-L").textContent = game.L < 1e-12 ? "0" : game.L.toExponential(1);

    const modeText = { challenge: `Challenge · Level ${game.level + 1}`, free: "Free drop", float: "Zero-g practice", watch: "Watch the cat" }[game.mode];
    $("hud-mode").textContent = modeText + (zeroG() ? " · zero g" : "") + (game.demo && game.mode !== "watch" ? " · demo" : "");

    const bar = $("time-bar");
    $("hud-time-label").textContent = zeroG() ? "Weightless time" : "Time to impact";
    if (zeroG()) {
      // Time left in the weightless spell.
      const dur = FC.sim.ZERO_G_SECONDS, left = game.zg ? Math.max(0, dur - game.zg.t) : dur;
      bar.style.width = `${(100 * left) / dur}%`;
      bar.style.background = "#5fb3f0";
      $("hud-time").textContent = game.phase === "ready" ? `${dur} s of weightlessness` : `${left.toFixed(1)} s of zero g left`;
      $("hud-height").textContent = "";
    } else if (game.mode === "float") {
      bar.style.width = "100%";
      bar.style.background = "#5fb3f0";
      $("hud-time").textContent = "no gravity";
      $("hud-height").textContent = "";
    } else {
      const left = Math.max(0, game.tTotal - game.t);
      const frac = game.phase === "landed" ? 0 : left / game.tTotal;
      bar.style.width = `${frac * 100}%`;
      bar.style.background = frac < 0.25 ? "#ef5d5d" : "#f29a3a";
      $("hud-time").textContent = game.phase === "ready" ? `${game.tTotal.toFixed(2)} s fall` : `${left.toFixed(2)} s left`;
      $("hud-height").textContent = `${Math.max(0, game.pos[1]).toFixed(game.pos[1] >= 10 ? 0 : 2)} m`;
    }
    const speed = game.phase === "falling" ? game.vy : game.phase === "absorbing" ? game.absorb.v : 0;
    $("hud-speed").textContent = `${speed.toFixed(1)} m/s (${(speed * 3.6).toFixed(0)} km/h)`;
    drawGauge();
    const narrating = updateNarrator();

    const coach = $("coach");
    const watch = game.mode === "watch";
    const show = (watch ? game.phase === "ready" : $("coach-on").checked && !!game.model.coach)
      && game.phase !== "landed" && game.phase !== "absorbing" && !narrating;
    coach.classList.toggle("hidden", !show);
    // Touch screens have no Space bar: point at the on-screen Drop button instead.
    const go = TOUCH ? "tap Drop" : "press Space";
    if (show)
      coach.textContent = watch ? (zeroG() ? `Set the start, then ${go} to let the cat go` : `Set the start, then ${go} to drop the cat`)
        : game.phase === "ready" ? (TOUCH ? "Tap Drop to start" : "Press Space to drop") : game.model.coach(game.shape, pilotInfo());

    // On-screen Drop button (touch screens): only while waiting to drop.
    const sd = $("stage-drop");
    sd.hidden = menu.open || game.phase !== "ready" || game.mode === "float";
    const label = game.mode === "watch" && zeroG() ? "Let go" : "Drop";
    if (sd.textContent !== label) sd.textContent = label;
  }
  const TOUCH = matchMedia("(hover: none), (pointer: coarse)").matches;

  // ---------- narrator: what the cat is doing and why (Watch mode and demos) ----------
  function updateNarrator() {
    const el = $("narrator");
    const active = game.phase === "falling" || game.phase === "float" || game.phase === "absorbing";
    const show = !menu.open && game.demo && $("explain-on").checked && game.nar && (active || (game.phase === "landed" && game.nar.timeline.length > 0));
    el.classList.toggle("hidden", !show);
    if (!show) return false;
    const nar = game.nar;
    if (active) {
      const z = game.zg;
      const t = z ? z.t : game.phase === "float" ? Infinity : game.t;
      const st = FC.narrator.describe({
        model: game.model, shape: game.shape, info: pilotInfo(), mem: game.pilotMem, phase: game.phase,
        t, delay: game.mode === "watch" ? +$("delay").value / 1000 : 0, optimized: !!game.schedPilot,
        vy: game.vy, absorb: game.absorb,
        zg: z && { beliefErr: FC.sim.angleBetween(z.belief.up, [0, 1, 0]) },
      });
      // Timeline of moves. Near upright the reflex makes tiny corrections that flick between two
      // stages (A, B, A, ...): a stage that lasted under 0.08 s and returns to the one before is dropped.
      const tl = nar.timeline, last = tl[tl.length - 1], prev = tl[tl.length - 2];
      if (!last || last.title !== st.title) {
        if (prev && prev.title === st.title && last.t !== null && t - last.t < 0.08) tl.pop();
        else tl.push({ t: Number.isFinite(t) ? t : null, title: st.title });
      }
      nar.current = st;
    }
    const st = nar.current;
    if (!st) return false;
    el.classList.toggle("done", !active);
    $("nar-title").textContent = active ? st.title : "What the cat did";
    $("nar-body").textContent = active ? st.body
      : `Each step below turned the cat using only changes of shape: its total angular momentum stayed zero the whole ${game.zg ? "time" : "way down"}.`;
    $("nar-live").textContent = st.live;
    $("nar-more").href = `physics.html#${active ? st.more : "moves"}`;
    const items = nar.timeline.slice(-8).map((e, i, arr) =>
      `<li${active && i === arr.length - 1 ? ' class="now"' : ""}>${e.t === null ? "" : `<b>${e.t.toFixed(2)} s</b> `}${e.title}</li>`).join("");
    if ($("nar-timeline").innerHTML !== items) $("nar-timeline").innerHTML = items;
    return true;
  }

  function updateSetupUi() {
    const ch = game.mode === "challenge", fl = game.mode === "float";
    $("height").disabled = ch || fl;
    $("speed").disabled = ch;
    $("start").disabled = ch;
    if (ch) { $("height").value = nearestHeightIndex(levelHeight()); $("speed").value = LEVELS[game.level].speed; }
    const hm = heightM();
    $("height-out").textContent = ch ? `${levelHeight().toFixed(2)} m (level ${game.level + 1}/${LEVELS.length})`
      : hm >= FLOOR_H ? `${hm} m (${Math.round(hm / FLOOR_H)} floor${hm >= 2 * FLOOR_H ? "s" : ""})` : `${hm.toFixed(2)} m`;
    $("speed-out").textContent = speedLabel(simSpeed());
    syncSpeedBar();
    $("drop").disabled = fl;
    $("demo").textContent = fl ? "Right me" : "Show me";

    const watch = game.mode === "watch";
    $("mode-desc").textContent = MODE_INFO[game.mode];
    $("watch-setup").classList.toggle("mode-hidden", !watch);
    $("start-field").classList.toggle("mode-hidden", watch);
    $("coach-on").parentElement.classList.toggle("mode-hidden", watch);
    $("demo").classList.toggle("mode-hidden", watch);
    $("drop").firstChild.textContent = watch ? "Drop the cat " : "Drop ";
    $("body-title").textContent = watch ? "Starting pose" : "Your body";
    $("body-note").textContent = watch ? "How the cat is held before it's dropped. Once falling, the cat takes over." : "";
    $("roll-out").textContent = `${$("roll").value}° ${rollName(+$("roll").value)}`;
    // Whether a pitch tips the nose up or down depends on whether the cat starts upside down.
    const p = +$("pitch").value, r = ((+$("roll").value % 360) + 360) % 360;
    const noseUp = (p > 0) !== (r > 90 && r < 270);
    $("pitch-out").textContent = `${p}° ${p === 0 ? "" : noseUp ? "nose up" : "nose down"}`;
    $("delay-out").textContent = `${$("delay").value} ms`;
    $("strategy-note").textContent = strategyNote();

    // Zero g: no drop height, air or optimized fall moves; show the sense-of-down choices instead.
    const zg = zeroG();
    $("zerog-setup").classList.toggle("mode-hidden", !zg);
    $("drift-field").classList.toggle("mode-hidden", !zg || $("cue").value !== "memory");
    $("drift-out").textContent = `${$("drift").value}°/√s`;
    $("height-field").classList.toggle("mode-hidden", zg);
    $("air-on").parentElement.classList.toggle("mode-hidden", zg);
    $("strategy").parentElement.classList.toggle("mode-hidden", zg);
    $("strategy-note").classList.toggle("mode-hidden", zg);
    if (watch) {
      $("drop").firstChild.textContent = zg ? "Let go " : "Drop the cat ";
      $("body-note").textContent = zg ? "How the cat is held before it's let go. Once floating, the cat takes over."
        : "How the cat is held before it's dropped. Once falling, the cat takes over.";
    }
  }

  // Watch mode: the computer-found move for this start, if one exists and is selected.
  function optimizedStart() {
    if (game.mode !== "watch" || zeroG() || $("strategy").value !== "optimized" || +$("pitch").value !== 0) return null;
    return FC.pilots.optimizedFor(game.model, +$("roll").value);
  }

  function strategyNote() {
    if ($("strategy").value !== "optimized") return "";
    if (!(globalThis.LAB && LAB.optimizer)) return "No optimizer results found (lab/results/data.js). The reflex will be used.";
    const opt = FC.pilots.optimizedFor(game.model, +$("roll").value);
    if (!opt || +$("pitch").value !== 0)
      return "Optimized moves exist for starting rolls in steps of 30° (not upright) with 0° pitch. For this start the reflex will be used.";
    return `Computer-found move: lands perfectly from ${opt.minHeight.toFixed(2)} m (the reflex needs ${opt.reflexMinHeight.toFixed(2)} m, with no reaction delay). ` +
      "It's a fixed, timed sequence starting from the neutral pose, so it ignores the starting pose above.";
  }

  function rollName(d) {
    d = ((d % 360) + 360) % 360;
    if (d <= 30 || d >= 330) return "(upright)";
    if (d >= 135 && d <= 225) return "(upside down)";
    return d < 180 ? "(on its side)" : "(on its other side)";
  }

  // ---------- events ----------
  $("drop").addEventListener("click", () => drop());
  $("stage-drop").addEventListener("click", () => drop());
  $("reset").addEventListener("click", reset);
  $("demo").addEventListener("click", () => { if (game.mode !== "float") reset(); drop(true); });
  $("neutral").addEventListener("click", () => controls.reset());
  $("banner-retry").addEventListener("click", reset);
  $("banner-next").addEventListener("click", () => { game.level = Math.min(LEVELS.length - 1, game.level + 1); store.set("level", game.level); reset(); });
  $("height").addEventListener("input", () => { updateSetupUi(); if (game.phase === "ready") reset(); });
  $("speed").addEventListener("input", updateSetupUi);
  $("air-on").addEventListener("change", () => { if (game.phase !== "falling") reset(); });
  $("strategy").addEventListener("change", updateSetupUi);
  $("explain-on").checked = store.get("explain", true);
  $("explain-on").addEventListener("change", () => store.set("explain", $("explain-on").checked));
  $("gravity").addEventListener("change", () => { if (game.phase !== "falling" && game.phase !== "float") reset(); else updateSetupUi(); });
  $("cue").addEventListener("change", updateSetupUi);
  $("drift").addEventListener("input", updateSetupUi);
  for (const id of ["roll", "pitch"])
    $(id).addEventListener("input", () => { updateSetupUi(); if (game.phase === "ready") game.R = startOrientation(); });
  $("delay").addEventListener("input", updateSetupUi);
  $("randomize").addEventListener("click", () => {
    $("roll").value = Math.round((Math.random() * 360) / 5) * 5;
    $("pitch").value = Math.round(((Math.random() * 2 - 1) * 30) / 5) * 5;
    for (const c of game.model.controls) {
      controls.targets[c.key] = c.type === "dial" ? Math.random() * 2 * Math.PI : c.min + Math.random() * (c.max - c.min);
    }
    if (game.phase !== "ready") game.phase = "ready"; // so reset keeps these new targets
    reset();
  });
  $("start").addEventListener("change", () => { if (game.phase !== "falling") reset(); });
  document.querySelectorAll("#mode-seg button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#mode-seg button").forEach((x) => x.classList.toggle("on", x === b));
      game.mode = b.dataset.mode;
      reset();
    })
  );
  document.querySelectorAll("#views button").forEach((b) => b.addEventListener("click", () => renderer.setView(b.dataset.view)));
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (menu.open) {
      if (e.key === "Enter") { e.preventDefault(); closeMenu(); }
      return;
    }
    if (e.key === "Escape") openMenu();
    else if (e.code === "Space") { e.preventDefault(); if (game.phase === "landed") reset(); else if (game.phase === "ready") drop(); }
    else if (e.key === "r" || e.key === "R") reset();
    else if (e.key === "n" || e.key === "N") controls.reset();
    else if (e.key === "p" || e.key === "P") togglePause();
  });

  // ---------- main menu ----------
  const MODE_CARDS = [
    ["challenge", "Challenge", "You are the cat. 8 levels, less time each one."],
    ["free", "Free drop", "You are the cat. Any height, up to 30 floors."],
    ["float", "Zero-g practice", "You are the cat. No gravity, no clock."],
    ["watch", "Watch the cat", "You set the start; the cat lands itself."],
  ];
  // Camera aim in the menu: below the standing cat, so it sits in the open space above the menu buttons.
  const MENU_TARGET_Y = -0.05;
  const MODEL_SHORT = { A: "Tuck-and-turn", B: "Two-cylinder", C: "Jointed legs", D: "Flexible spine" };
  const MODEL_TAGS = { A: "Simplest", B: "Base model", C: "More detailed", D: "Most detailed" };
  const menu = { open: false, model: store.get("menuModel", "B"), mode: store.get("menuMode", "challenge"), angle: 0.6 };

  // Buttons for the models and modes; the chosen model's description goes in one line below.
  function buildMenu() {
    const models = FC.models.filter((m) => m.available).sort((a, b) => a.id.localeCompare(b.id));
    $("menu-models").innerHTML = models.map((m) =>
      `<button class="menu-pill${m.id === menu.model ? " on" : ""}" data-model="${m.id}" title="${MODEL_TAGS[m.id] || ""}">
        <b>${m.id}</b>${MODEL_SHORT[m.id] || m.name}</button>`).join("");
    $("menu-modes").innerHTML = MODE_CARDS.map(([id, name, text]) =>
      `<button class="menu-pill${id === menu.mode ? " on" : ""}" data-mode="${id}" title="${text}">${name}</button>`).join("");
    const m = game.model;
    const firstSentence = (m.description.match(/^[^.]*\./) || [m.description])[0];
    const modeText = (MODE_CARDS.find(([id]) => id === menu.mode) || [])[2] || "";
    $("menu-model-info").innerHTML = `<div><b>${m.name}</b> · ${MODEL_TAGS[m.id] || ""}. ${firstSentence}</div>
      <div style="margin-top:6px">${modeText}</div>`;
    $("menu-caption").textContent = "Drag to look around the cat";
  }

  $("menu-models").addEventListener("click", (e) => {
    const card = e.target.closest(".menu-pill");
    if (!card) return;
    menu.model = card.dataset.model;
    $("model-select").value = menu.model;
    setModel(menu.model); // the preview behind the menu switches to this cat
    buildMenu();
  });
  $("menu-modes").addEventListener("click", (e) => {
    const card = e.target.closest(".menu-pill");
    if (!card) return;
    menu.mode = card.dataset.mode;
    buildMenu();
  });

  // sync: preselect what is being played now (false on first load: keep the saved choice).
  function openMenu(sync = true) {
    menu.open = true;
    hideBanner();
    menu.model = game.model.id;
    if (sync) menu.mode = game.mode;
    document.body.classList.add("menu-open");
    $("menu").classList.remove("closed");
    renderer.resize(); // the side panel is hidden, so the scene fills the window
    renderer.resetView(2.4); // a step back, so the whole cat fits between the title and the buttons
    renderer.setTargetY(MENU_TARGET_Y, false); // jump straight to the cat instead of gliding down from the last drop
    buildMenu();
    $("menu-start").focus({ preventScroll: true });
  }

  function closeMenu() {
    menu.open = false;
    store.set("menuModel", menu.model);
    store.set("menuMode", menu.mode);
    document.body.classList.remove("menu-open");
    $("menu").classList.add("closed");
    renderer.resize();
    renderer.resetView();
    if (game.model.id !== menu.model) { $("model-select").value = menu.model; setModel(menu.model); }
    document.querySelector(`#mode-seg button[data-mode="${menu.mode}"]`).click(); // sets the mode and resets
  }

  $("menu-start").addEventListener("click", closeMenu);
  $("open-menu").addEventListener("click", () => openMenu());
  $("model-select").addEventListener("change", () => (menu.model = $("model-select").value));

  // Behind the menu: the chosen cat stands on the ground, legs out, slowly turning.
  function menuPreview(realDt) {
    menu.angle += realDt * 0.35;
    const s = neutralShape();
    s.front = s.back = 0.85;
    if ("knees" in s) s.knees = 0.15;
    game.shape = s;
    game.R = FC.m3.mul(FC.m3.rot([0, 1, 0], menu.angle), FC.sim.UPRIGHT);
    game.pos = [0, 0, 0];
    game.pos[1] = -FC.sim.lowestPoint(game.model, game.R, s, 0);
  }

  // ---------- main loop ----------
  let last = performance.now();
  function frame(now) {
    const realDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (menu.open) menuPreview(realDt);
    else if (!game.paused) simulate(realDt * simSpeed());
    if (game.demo && game.phase === "float" && !game.zg && !game.pilotMem.pump && Math.abs(rollError()) < 8 * deg &&
        (!game.model.bendable || Math.abs(pitchError()) < 8 * deg) && spineDeg() < 2 && !game.pilotMem.cycle) {
      game.demo = false;
      controls.enabled = true;
      controls.targets = { ...game.shape };
    }
    renderer.updateCat(game.shape, game.R, game.pos);
    renderer.setTargetY(menu.open ? MENU_TARGET_Y : Math.max(0.35, game.pos[1]), true);
    renderer.render();
    controls.show(game.shape);
    updateHud();
    requestAnimationFrame(frame);
  }

  game.level = Math.min(LEVELS.length - 1, store.get("level", 0));
  initModels();
  if (FC.models.some((m) => m.id === menu.model && m.available) && menu.model !== game.model.id) {
    $("model-select").value = menu.model;
    setModel(menu.model);
  }
  openMenu(false);
  FC.game = game; // handy for debugging from the console
  requestAnimationFrame(frame);
})();
