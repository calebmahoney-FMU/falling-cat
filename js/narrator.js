// Narrator: explains, in words, what the cat is doing at each moment of a
// Watch-mode drop (and "Show me" demos), and why it works physically.
//
// describe(ctx) looks at the state of the fall and returns a stage:
//   { key, title, body, live, more }
// key   - changes when the cat moves on to a new stage (for the timeline)
// title - short name of the move
// body  - one or two sentences of physics
// live  - numbers for this instant (roll left, moments of inertia, ...)
// more  - anchor on physics.html that explains this in depth
//
// The reflex records which stage it is in (mem.stage, mem.pump, mem.cycle);
// for the optimizer's timed moves, the stage is read from the body's shape.
var FC = (globalThis.FC = globalThis.FC || {});

FC.narrator = (function () {
  const { v, mv } = FC.m3;
  const deg = Math.PI / 180;
  const KGCM2 = 1e4; // kg·m² -> kg·cm²

  // Scalar moment of inertia of each leg-bearing half (front, back) about its own
  // long axis, in kg·m²: I∥ = x̂·I·x̂ = Σ m r⊥², the component of the half's inertia
  // tensor along its axis (body cylinder ½mr² plus each leg mass times its squared
  // perpendicular distance from the axis line). Tucking the legs shrinks it.
  function halfInertia(model, shape) {
    return model.geometry(shape).filter((h) => h.ext !== null).map((h) => {
      const a = mv(h.R, [1, 0, 0]);
      let I = h.I[0];
      for (const leg of h.legs)
        for (const q of leg.masses) {
          const r = v.sub(q.p, h.origin);
          const perp = v.sub(r, v.scale(a, v.dot(r, a)));
          I += q.m * v.dot(perp, perp);
        }
      return I;
    });
  }

  const fmtI = (I) => `${(I * KGCM2).toFixed(0)} kg·cm²`;
  const legWord = (x) => (x < 0.25 ? "tucked" : x > 0.75 ? "spread" : "half out");

  // ---------- stages ----------
  function holding(ctx) {
    return {
      key: "hold", title: "Sensing the fall", more: "puzzle",
      body: "The cat hasn't noticed it's falling yet: its inner ear needs about 50–100 ms to register free fall. " +
        "While its shape stays the same, nothing can turn it. Total angular momentum is zero, and gravity pulls evenly on every part.",
      live: `Reflex starts in ${Math.max(0, (ctx.delay - ctx.t) * 1000).toFixed(0)} ms`,
    };
  }

  function rollSweep(ctx) {
    const err = Math.abs(ctx.info.roll) / deg;
    const tucked = Math.min(ctx.shape.front, ctx.shape.back) < 0.25;
    const [If] = halfInertia(ctx.model, ctx.shape);
    if (err > 45 || tucked)
      return {
        key: "roll", title: "Bend and twist", more: "bend-twist",
        body: "The cat bends its spine hard and sweeps the bend around, like a hula hoop. Each half spins about its own long axis. " +
          "The halves are tilted to each other, so their angular momentum vectors point along different axes and can't cancel. The whole body " +
          "rolls the other way so the total angular momentum vector stays zero. Tucked legs shrink each half's moment of inertia about its own axis, so every lap of the sweep rolls it further.",
        live: `${err.toFixed(0)}° of roll to go · legs ${legWord(ctx.shape.front)} · front half I∥ = ${fmtI(If)}`,
      };
    return {
      key: "ease", title: "Easing in", more: "bend-twist",
      body: "Nearly upright, the cat eases off the bend. The roll per lap grows roughly with the bend squared, so a full bend would overshoot. " +
        "It also half-spreads its legs so they're quick to plant.",
      live: `${err.toFixed(0)}° of roll to go · spine bent ${(ctx.model.combine(ctx.shape).bend / deg).toFixed(0)}°`,
    };
  }

  function pump(ctx) {
    const p = ctx.mem.pump, pitch = ctx.info.pitch / deg;
    const step = p ? p.i : 0;
    const first = p && p.steps[0].front === 0 ? "front" : "back", second = first === "front" ? "back" : "front";
    const words = [
      `Tuck the ${first} legs and spread the ${second} legs: the ${first} half is now the light one (small moment of inertia).`,
      `Bend toward the belly. The halves swing toward each other; the light ${first} half swings further than the heavy ${second} half.`,
      `Swap the legs: now the ${second} half is light and the ${first} half heavy.`,
      "Straighten. The halves swing back by different amounts than they swung in, so the whole body ends up tipped. It's tuck and turn, about the side-to-side axis.",
    ];
    return {
      key: "pump", title: "Leg pump: levelling the nose", more: "pump",
      body: words[Math.min(step, 3)],
      live: `Nose ${pitch > 0 ? "up" : "down"} ${Math.abs(pitch).toFixed(0)}° · step ${Math.min(step, 3) + 1} of 4`,
    };
  }

  function landPrep(ctx) {
    const knees = ctx.model.jointed ? " Knees nearly straight, so they have the most room to fold on impact." : "";
    return {
      key: "land", title: "Getting ready to land", more: "landing",
      body: "Spine straight and legs spread: a wide, level base. The legs will work as springs, and spread out they act as a parachute, " +
        "catching more air." + knees,
      live: ctx.zg ? "Holding still: steady shape, no turning" : `${Math.max(0, ctx.info.timeLeft).toFixed(2)} s to touchdown · ${ctx.vy.toFixed(1)} m/s`,
    };
  }

  // Model A: tuck-and-turn cycles (mem.cycle) or the same read from the shape.
  function tuckTurn(ctx, step) {
    const [If, Ib] = halfInertia(ctx.model, ctx.shape);
    const lightFront = ctx.shape.front < ctx.shape.back;
    const light = lightFront ? "front" : "back", heavy = lightFront ? "back" : "front";
    const ratio = (Math.max(If, Ib) / Math.min(If, Ib)).toFixed(1);
    const words = [
      `Tuck the ${light} legs and spread the ${heavy} legs. The ${light} half now has the smaller moment of inertia about the spine.`,
      `Twist. With no outside torque, the components of the halves' angular momenta along the spine must cancel: I∥F ωF + I∥B ωB = 0 ` +
        `(moments and spin rates about the spine, so all scalars). ` +
        `The light ${light} half turns ${ratio}× as far as the heavy ${heavy} half.`,
      `Swap the legs: the ${heavy} half becomes the light one.`,
      `Untwist. Now the other half is light, so the halves turn back by different amounts from how they turned out. The difference is a net roll of the whole cat.`,
    ];
    return {
      key: `cycle${step === 1 || step === 3 ? step : 0}`, title: "Tuck and turn", more: "tuck-turn",
      body: words[Math.min(step, 3)],
      live: `${(Math.abs(ctx.info.roll) / deg).toFixed(0)}° of roll to go · I∥ front ${fmtI(If)} vs back ${fmtI(Ib)}`,
    };
  }

  // Optimizer's timed moves: classify by shape.
  function fromShape(ctx) {
    const s = ctx.model.combine(ctx.shape);
    const asym = Math.abs(ctx.shape.front - ctx.shape.back) > 0.4;
    if (ctx.model.bendable !== false && s.bend > 30 * deg) {
      const st = rollSweep({ ...ctx, info: { ...ctx.info, roll: Math.max(Math.abs(ctx.info.roll), 46 * deg) } });
      if (asym) st.body += ` Here the computer also tucks only the ${ctx.shape.front < ctx.shape.back ? "front" : "back"} legs, mixing in tuck and turn.`;
      st.live = `${(Math.abs(ctx.info.roll) / deg).toFixed(0)}° from upright · front legs ${legWord(ctx.shape.front)}, back ${legWord(ctx.shape.back)}`;
      return { ...st, title: "Computer's move: bend and twist" };
    }
    if (asym && Math.abs(s.twist) > 20 * deg) return { ...tuckTurn(ctx, 1), title: "Computer's move: tuck and turn" };
    if (Math.abs(ctx.info.roll) > 30 * deg && ctx.t - ctx.delay < 0.12)
      return {
        key: "windup", title: "Computer's move: winding up", more: "moves",
        body: "The computer's timed move starts: the spine begins to bend and the legs move into position. " +
          "Until the shape has changed enough, the cat has barely turned.",
        live: `${(Math.abs(ctx.info.roll) / deg).toFixed(0)}° from upright · front legs ${legWord(ctx.shape.front)}, back ${legWord(ctx.shape.back)}`,
      };
    return landPrep(ctx);
  }

  function describe(ctx) {
    if (ctx.phase === "absorbing" && ctx.absorb) {
      const ab = ctx.absorb;
      return {
        key: "touch", title: "Touchdown: the legs absorb it", more: "landing",
        body: "The paws stop but the body keeps moving and sinks over the legs' stroke d. Stopping from speed v over distance d " +
          "takes a deceleration of v²/2d, so the peak load is 1 + v²/(2gd) times body weight. A longer stroke means a gentler stop.",
        live: `${ab.v.toFixed(1)} m/s stopped over ${(ab.d * 100).toFixed(0)} cm → ${ab.impact.toFixed(0)}× body weight`,
      };
    }
    let st;
    // Before the reflex's first decision (mem.stage unset) the cat is still just holding its pose.
    if (ctx.t < ctx.delay || (!ctx.optimized && !ctx.mem.stage)) st = holding(ctx);
    else if (ctx.optimized) st = fromShape(ctx);
    else if (ctx.mem.cycle) st = tuckTurn(ctx, ctx.mem.cycle.i);
    else if (ctx.mem.stage === "roll") st = rollSweep(ctx);
    else if (ctx.mem.stage === "pump") st = pump(ctx);
    else st = landPrep(ctx);
    if (ctx.zg) {
      // Zero g: the reflex steers by where the cat *believes* down is.
      const off = ctx.zg.beliefErr / deg;
      st = { ...st, body: `In zero g, the cat steers toward where it thinks down is (the white ring on the gauge). ` + st.body,
        live: `${st.live} · its sense of down is ${off.toFixed(0)}° off` };
      if (st.key === "land") st = { ...st, title: "Holding its pose", body: "The cat thinks it's feet-down, so it straightens out and stays still. " +
        "With no shape change there is no turning, even if its idea of down drifts away from the real floor." };
    }
    return st;
  }

  return { describe, halfInertia };
})();
