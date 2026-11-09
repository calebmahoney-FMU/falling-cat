// Open-loop pilots: a timed schedule of body-shape targets (found by the
// optimizer in lab/optimizer.html), as an alternative to the rule-based reflex.
//
// schedule = { T, values: { bend: [...], dir: [...], ... } }: each list holds
// targets at evenly spaced times 0..T, linearly interpolated. After T the cat
// straightens, spreads its legs and (jointed legs) straightens its knees.
var FC = (globalThis.FC = globalThis.FC || {});

FC.pilots = {
  // Reflex variants for lab/reflex-experiment.html, testing what the optimizer
  // does differently: tuck the legs during the roll sweep, and twist the spine.
  // twistSign: +1 / -1 twists the spine by ±100° × sign(roll still needed).
  // tuckAbove: only tuck while more than this much roll (deg) is still needed.
  reflexVariant(model, { tuck = false, twistSign = 0, tuckAbove = 8 } = {}) {
    const mem = {};
    return (s, info) => {
      const target = model.autopilot(s, info, mem);
      const rolling = Math.abs(info.roll) > 8 * Math.PI / 180 && !mem.pump;
      if (rolling && tuck && Math.abs(info.roll) > tuckAbove * Math.PI / 180) target.front = target.back = 0;
      if (rolling && twistSign) target.twist = twistSign * Math.sign(info.roll) * 100 * Math.PI / 180;
      return target;
    };
  },
  reflexTuck: (m) => FC.pilots.reflexVariant(m, { tuck: true }),
  reflexTuckTwistPlus: (m) => FC.pilots.reflexVariant(m, { tuck: true, twistSign: 1 }),
  reflexTuckTwistMinus: (m) => FC.pilots.reflexVariant(m, { tuck: true, twistSign: -1 }),
  reflexTuck45: (m) => FC.pilots.reflexVariant(m, { tuck: true, tuckAbove: 45 }),
  reflexTuck60: (m) => FC.pilots.reflexVariant(m, { tuck: true, tuckAbove: 60 }),
  reflexTuck90: (m) => FC.pilots.reflexVariant(m, { tuck: true, tuckAbove: 90 }),

  // Reflex variant for the high-rise study: rights itself as usual but keeps
  // the legs tucked (less drag) until the last 0.15 s before touchdown.
  tuckedReflex(model) {
    const mem = {};
    return (s, info) => {
      const target = model.autopilot(s, info, mem);
      if (info.timeLeft > 0.15 && !mem.pump) target.front = target.back = 0.05;
      return target;
    };
  },

  // mirror: run the left-right mirror image (for a start roll of 360° − r):
  // bend direction and twist change sign, everything else is unchanged.
  fromSchedule(model, sched, mirror = false) {
    return (s, info, t) => {
      if (t >= sched.T) {
        const land = { bend: 0, dir: s.dir, twist: 0, front: 1, back: 1 };
        if (model.jointed) land.knees = 0.1;
        return land;
      }
      const target = {};
      for (const key in sched.values) {
        const vals = sched.values[key], n = vals.length - 1;
        const x = (t / sched.T) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
        target[key] = vals[i] + f * (vals[i + 1] - vals[i]);
        if (mirror && (key === "dir" || key === "twist")) target[key] = -target[key];
      }
      return target;
    };
  },

  // Optimized schedule (from the lab results) for a model and start roll, or null.
  optimizedFor(model, rollDeg) {
    const res = globalThis.LAB && LAB.optimizer && LAB.optimizer.results;
    if (!res) return null;
    const r = ((rollDeg % 360) + 360) % 360;
    const mirror = r > 180, base = mirror ? 360 - r : r;
    const hit = res.find((x) => x.model === model.id && x.roll === base && x.schedule);
    if (!hit) return null;
    // The game's reflex is the improved one (lab/reflex-experiment.html, "tuck45").
    const exp = LAB.reflex_experiment && LAB.reflex_experiment.rows.find((x) => x.model === model.id && x.roll === base && x.variant === "tuck45");
    return { pilot: FC.pilots.fromSchedule(model, hit.schedule, mirror), minHeight: hit.optMinH,
      reflexMinHeight: exp ? exp.minPerfectHeight : hit.reflexMinH };
  },
};
