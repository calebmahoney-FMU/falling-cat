// Headless drop simulation shared by the game and the lab: orientation
// helpers, landing detection, air drag, and a complete drop run without
// any graphics (used for batch studies in web workers).
var FC = (globalThis.FC = globalThis.FC || {});

FC.sim = (function () {
  const { v, mul, mv, rot, T } = FC.m3;
  const deg = Math.PI / 180;
  const G = 9.81;
  const RHO = 1.2; // air density, kg/m³

  // Cat frame -> world. Upright: head along +X, cat's left along -Z, back up (+Y).
  const UPRIGHT = [1, 0, 0, 0, 0, 1, 0, -1, 0];
  const startR = (rollDeg, pitchDeg) => mul(mul(rot([1, 0, 0], rollDeg * deg), rot([0, 0, 1], pitchDeg * deg)), UPRIGHT);

  // Roll (about the cat's long axis) still needed to bring its back up. `up` is
  // the direction the cat takes as up: true up, or in zero g whatever it believes.
  function rollError(R, up = [0, 1, 0]) {
    const upC = mv(T(R), up);
    return Math.atan2(-upC[1], upC[2]);
  }

  // Pitch of the spine: the angle of the head (cat +x) above the horizontal
  // (positive = nose up, so a nose-down rotation is needed to level it).
  // Only meaningful once the cat is roughly upright.
  function pitchError(R, up = [0, 1, 0]) {
    const xUp = R[0] * up[0] + R[3] * up[1] + R[6] * up[2], zUp = R[2] * up[0] + R[5] * up[1] + R[8] * up[2];
    return Math.atan2(xUp, Math.max(zUp, 1e-3));
  }

  const feetAngles = (model, R, s) =>
    model.ventral(s).map((u) => Math.acos(Math.max(-1, Math.min(1, -mv(R, u)[1]))));

  // Lowest point of the cat (world y), counting body radius, head and paws.
  function lowestPoint(model, R, s, posY) {
    const P = model.params;
    const com = FC.physics.configuration(model, s).com;
    const pts = [];
    for (const seg of model.geometry(s)) {
      // Both ends of each body segment (spine joints and rump), and the head.
      const at = (p) => v.add(seg.origin, mv(seg.R, p));
      pts.push([seg.origin, P.radius], [at([seg.fwd * seg.len, 0, 0]), P.radius]);
      if (seg.head) pts.push([at([P.headX, 0, 0.03]), P.headR]);
      for (const l of seg.legs) {
        pts.push([l.foot, 0.02]);
        if (l.knee) pts.push([l.knee, 0.02]);
      }
    }
    let low = Infinity;
    for (const [p, r] of pts) low = Math.min(low, mv(R, v.sub(p, com))[1] - r);
    return posY + low;
  }

  function moveToward(model, s, target, dt) {
    const out = { ...s }; // keeps fixed shape values (e.g. model A's bend = 0)
    for (const c of model.controls) {
      const d = (target[c.key] ?? s[c.key]) - s[c.key], max = c.rate * dt;
      out[c.key] = s[c.key] + Math.max(-max, Math.min(max, d));
    }
    return out;
  }

  // Air drag: F = ½ ρ (Cd·A) v², with Cd·A from the model's pose.
  const dragK = (model, s) => 0.5 * RHO * (model.dragArea ? model.dragArea(s) : 0);
  const totalMass = (model) => model.bodies(Object.fromEntries(model.controls.map((c) => [c.key, c.def]))).reduce((a, b) => a + b.m, 0);

  // Time for the paws to reach the ground, for the clock and the autopilot.
  // With drag it is integrated with the legs spread (the usual falling pose).
  function fallTime(model, height, drag) {
    const drop = Math.max(0.05, height - (model.contactHeight ?? 0.12));
    if (!drag || !model.dragArea) return Math.sqrt((2 * drop) / G);
    const s = neutral(model);
    s.front = s.back = 1;
    const k = dragK(model, s) / totalMass(model);
    let y = 0, vy = 0, t = 0;
    const h = 1e-3;
    while (y < drop) { vy += (G - k * vy * vy) * h; y += vy * h; t += h; }
    return t;
  }

  const neutral = (model) => ({ ...(model.fixedShape || {}), ...Object.fromEntries(model.controls.map((c) => [c.key, c.def])) });

  // One complete drop. opts: roll, pitch (deg), height (m), delay (s),
  // drag (bool), pose (starting shape), pilot ("reflex" or a function
  // (shape, info, t) -> target), h (sub-step, s). Returns the landing record.
  function drop(model, opts) {
    const h = opts.h ?? 1e-3;
    let R = startR(opts.roll ?? 180, opts.pitch ?? 0);
    let s = { ...neutral(model), ...(opts.pose || {}) };
    const tTotal = fallTime(model, opts.height, opts.drag);
    const mass = totalMass(model);
    const mem = {};
    let t = 0, y = opts.height, vy = 0, rightedAt = null;
    let target = { ...s };
    for (let iter = 0; iter < 200000; iter++) {
      const info = { roll: rollError(R), pitch: pitchError(R), timeLeft: tTotal - t };
      if (t >= (opts.delay ?? 0)) {
        target = typeof opts.pilot === "function" ? opts.pilot(s, info, t - (opts.delay ?? 0)) : model.autopilot(s, info, mem);
      }
      const s1 = moveToward(model, s, target, h);
      R = FC.physics.step(model, R, s, s1, h).R;
      s = s1;
      const k = opts.drag ? dragK(model, s) / mass : 0;
      vy += (G - k * vy * vy) * h;
      y -= vy * h;
      t += h;
      const feet = feetAngles(model, R, s);
      if (rightedAt === null && Math.max(...feet) < 15 * deg) rightedAt = t;
      if (lowestPoint(model, R, s, y) <= 0) {
        const worst = Math.max(...feet);
        const stroke = model.landingStroke(s, worst);
        return {
          t, v: vy, rightedAt,
          front: feet[0] / deg, back: feet[1] / deg, worst: worst / deg,
          bend: (model.spineAngle ? model.spineAngle(s) : s.bend) / deg, legs: (s.front + s.back) / 2,
          stroke, impact: 1 + (vy * vy) / (2 * G * stroke),
        };
      }
    }
    return null;
  }

  // ---------- zero gravity ----------
  // In free fall a cat's balance organs feel no gravity, so its sense of "down"
  // has to come from somewhere else. Cues (what the cat steers by):
  //   floor  - it sees the cabin floor: its "up" is the true cabin up.
  //   memory - it remembers where down was before weightlessness; the memory
  //            drifts randomly (a random walk of `drift` deg/√s).
  //   none   - no usable cue: it keeps settling on a new random "down" every
  //            0.4–1.2 s, so it keeps turning toward the wrong place (as weightless
  //            cats in 1940s–50s parabolic-flight films did).
  const ZERO_G_SECONDS = 20; // about one parabola's worth of weightlessness

  // Small, reproducible random numbers (so lab trials can be re-run exactly).
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const randomUnit = (r) => v.unit([gauss(r), gauss(r), gauss(r)]);

  // The cat's belief about "up" (world vector), updated each step.
  function makeBelief(cue, { seed = 1, drift = 8 } = {}) {
    const r = rng(seed);
    const b = { cue, up: [0, 1, 0], nextSwitch: 0 };
    b.step = (dt, t) => {
      if (cue === "memory") {
        const g = [gauss(r), gauss(r), gauss(r)];
        const perp = v.sub(g, v.scale(b.up, v.dot(g, b.up)));
        b.up = v.unit(v.add(b.up, v.scale(perp, drift * deg * Math.sqrt(dt))));
      } else if (cue === "none" && t >= b.nextSwitch) {
        b.up = randomUnit(r);
        b.nextSwitch = t + 0.4 + 0.8 * r();
      }
    };
    return b;
  }
  const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, v.dot(a, b))));

  // Spine movement between two shapes (rad): every bend, twist and bend-direction change.
  const spineKeys = (model) => model.controls.filter((c) => c.unit === "deg" || c.type === "dial").map((c) => c.key);
  const spineMotion = (keys, a, b) => keys.reduce((sum, k) => sum + Math.abs(b[k] - a[k]), 0);

  // One zero-g run: the cat floats for `duration` s, its reflex steering toward
  // the believed up. Returns how much of the time its feet faced the cabin floor
  // (within 45°), when that first happened, how much it moved its spine (in full
  // turns' worth of joint motion) and how wrong its sense of down was on average.
  function float(model, opts) {
    const h = opts.h ?? 1e-3, dur = opts.duration ?? ZERO_G_SECONDS;
    let R = startR(opts.roll ?? 180, opts.pitch ?? 0);
    let s = { ...neutral(model), ...(opts.pose || {}) };
    const belief = makeBelief(opts.cue || "floor", { seed: opts.seed ?? 1, drift: opts.drift ?? 8 });
    const mem = {}, keys = spineKeys(model);
    let upright = 0, firstUpright = null, swept = 0, beliefErr = 0, n = 0;
    const trace = [];
    for (let t = 0; t < dur; t += h) {
      belief.step(h, t);
      const info = { roll: rollError(R, belief.up), pitch: pitchError(R, belief.up), timeLeft: Infinity };
      const target = t >= (opts.delay ?? 0) ? model.autopilot(s, info, mem) : s;
      const s1 = moveToward(model, s, target, h);
      R = FC.physics.step(model, R, s, s1, h).R;
      swept += spineMotion(keys, s, s1);
      s = s1;
      const worst = Math.max(...feetAngles(model, R, s));
      if (worst < 45 * deg) { upright += h; if (firstUpright === null) firstUpright = t; }
      beliefErr += angleBetween(belief.up, [0, 1, 0]);
      n++;
      if (opts.trace && n % 50 === 0) trace.push([+t.toFixed(3), +(worst / deg).toFixed(1), +(angleBetween(belief.up, [0, 1, 0]) / deg).toFixed(1)]);
    }
    return { fracUpright: upright / dur, firstUpright, effortLaps: swept / (2 * Math.PI), meanBeliefErr: beliefErr / n / deg, trace };
  }

  return { G, UPRIGHT, startR, rollError, pitchError, feetAngles, lowestPoint, moveToward, dragK, totalMass, fallTime, neutral, drop,
    ZERO_G_SECONDS, makeBelief, float, angleBetween, spineKeys, spineMotion };
})();
