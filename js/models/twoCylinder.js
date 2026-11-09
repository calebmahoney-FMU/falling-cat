// Shared builder for all the cat models (A, B, C, D).
//
// Cat frame: x = forward (head), y = cat's left, z = dorsal (spine side up).
// Two rigid cylinders (front and back half) meet at the spine joint. Controls:
//   bend  - total angle between the two halves
//   dir   - which way the spine bends (0 = toward belly, 90 = left, 180 = back)
//   twist - relative twist of the halves about their own long axes
//   front, back - leg extension of each half (0 tucked, 1 spread out)
//   knees - (jointed legs only) how bent each leg's middle joint is
// Legs are point masses (one per leg, or two per jointed leg), so moving them
// changes each half's inertia.
//
// flexibleSpine: true (model D) uses three segments instead: chest, waist and
// hips, joined by a front and a back spine joint, each with its own bend and
// twist (bendF/bendB, twistF/twistB) and a shared bend direction. The cat frame
// is the waist's frame. The reflex and coach work on a "combined" spine (total
// bend = bendF + bendB, total twist = twistF + twistB) and split it between the
// joints in proportion to their range, the front joint taking the larger share.
var FC = (globalThis.FC = globalThis.FC || {});
FC.models = FC.models || [];

FC.makeTwoCylinderModel = function (opts) {
  const { v, mul, mv, rot, diag } = FC.m3;
  const deg = Math.PI / 180;
  const P = opts.params;
  const jointed = !!opts.jointedLegs;
  // bendable: false gives a spine that only twists (model A); bend and dir stay 0.
  const bendable = opts.bendable !== false;
  const TWIST_MAX = (opts.twistMax ?? 120) * deg;
  const KNEE_MAX = 110 * deg; // knee bend reachable with the control
  const KNEE_CROUCH = 140 * deg; // deepest bend when absorbing a landing
  const segLen = P.legLen / 2; // jointed legs: two equal segments
  const flexible = !!opts.flexibleSpine;
  // Flexible spine: joint ranges (the front joint is the more flexible one) and
  // each joint's share of the combined bend/twist the reflex asks for.
  const BEND_F_MAX = (P.bendFrontMax ?? 65) * deg, BEND_B_MAX = (P.bendBackMax ?? 35) * deg;
  const TWIST_F_MAX = (P.twistFrontMax ?? 90) * deg, TWIST_B_MAX = (P.twistBackMax ?? 30) * deg;
  const BEND_F_SHARE = BEND_F_MAX / (BEND_F_MAX + BEND_B_MAX);
  const TWIST_F_SHARE = TWIST_F_MAX / (TWIST_F_MAX + TWIST_B_MAX);

  const cylinderI = (m, len) => diag((m * P.radius ** 2) / 2, (m * (3 * P.radius ** 2 + len ** 2)) / 12, (m * (3 * P.radius ** 2 + len ** 2)) / 12);
  const cylI = cylinderI(P.halfMass, P.halfLen);

  // Body segments in the cat frame: rotation R, origin (the segment's spine
  // joint, where its own frame starts), fwd (+1 extends toward the head, -1 toward
  // the tail), len, mass, inertia, and which legs / head / tail it carries.
  const X = [1, 0, 0];
  const kOf = (dir) => [0, Math.cos(dir), Math.sin(dir)]; // x × d, d = bend direction
  function segments(s) {
    const dir = s.dir ?? 0, k = kOf(dir);
    if (!flexible) {
      const beta = (s.bend ?? 0) / 2;
      return [
        { R: mul(rot(k, beta), rot(X, s.twist / 2)), origin: [0, 0, 0], fwd: 1, len: P.halfLen, m: P.halfMass, I: cylI, ext: s.front, head: true },
        { R: mul(rot(k, -beta), rot(X, -s.twist / 2)), origin: [0, 0, 0], fwd: -1, len: P.halfLen, m: P.halfMass, I: cylI, ext: s.back, tail: true },
      ];
    }
    const w = P.waistLen / 2;
    return [
      { R: mul(rot(k, s.bendF), rot(X, s.twistF)), origin: [w, 0, 0], fwd: 1, len: P.chestLen, m: P.chestMass,
        I: cylinderI(P.chestMass, P.chestLen), ext: s.front, head: true },
      { R: FC.m3.I(), origin: [-w, 0, 0], fwd: 1, len: P.waistLen, m: P.waistMass, I: cylinderI(P.waistMass, P.waistLen), ext: null },
      { R: mul(rot(k, -s.bendB), rot(X, -s.twistB)), origin: [-w, 0, 0], fwd: -1, len: P.hipLen, m: P.hipMass,
        I: cylinderI(P.hipMass, P.hipLen), ext: s.back, tail: true },
    ];
  }

  // Combined spine (what the reflex and coach steer) and back to the joints.
  const combine = (s) => (flexible ? { ...s, bend: s.bendF + s.bendB, twist: s.twistF + s.twistB } : s);
  function split(t) {
    if (!flexible) return t;
    const out = { ...t };
    delete out.bend; delete out.twist;
    if (t.bend !== undefined) { out.bendF = t.bend * BEND_F_SHARE; out.bendB = t.bend * (1 - BEND_F_SHARE); }
    if (t.twist !== undefined) { out.twistF = t.twist * TWIST_F_SHARE; out.twistB = t.twist * (1 - TWIST_F_SHARE); }
    return out;
  }

  // Leg direction (shoulder/hip to paw) in a half's own frame; side = ±1, fwd = +1 front, -1 back.
  function legDir(ext, side, fwd) {
    const tucked = [-fwd * 0.97, side * 0.05, -0.22];
    const spread = [fwd * 0.2, side * 0.5, -0.84];
    return v.unit(v.lerp(tucked, spread, ext));
  }

  // One leg in its half's frame. Jointed legs bend with the joint pointing back
  // (like a cat's elbows and hocks); both segments tilt ±kappa/2 off the hip-paw line.
  function legLocal(attach, u, kappa) {
    if (!jointed) {
      const foot = v.add(attach, v.scale(u, P.legLen));
      return { attach, foot, masses: [{ m: P.legMass, p: v.lerp(attach, foot, 0.5) }] };
    }
    const j0 = [-1, 0, 0.3];
    const j = v.unit(v.sub(j0, v.scale(u, v.dot(j0, u))));
    const c = Math.cos(kappa / 2), sn = Math.sin(kappa / 2);
    const upper = v.add(v.scale(u, c), v.scale(j, sn));
    const lower = v.sub(v.scale(u, c), v.scale(j, sn));
    const knee = v.add(attach, v.scale(upper, segLen));
    const foot = v.add(knee, v.scale(lower, segLen));
    return {
      attach, knee, foot,
      masses: [
        { m: P.legMass * 0.65, p: v.lerp(attach, knee, 0.5) },
        { m: P.legMass * 0.35, p: v.lerp(knee, foot, 0.5) },
      ],
    };
  }

  // Segment geometry (centre, legs) in the cat frame.
  function geometry(s) {
    const kappa = jointed ? s.knees * KNEE_MAX : 0;
    const segs = segments(s);
    for (const h of segs) {
      const toCat = (p) => v.add(h.origin, mv(h.R, p));
      h.center = toCat([(h.fwd * h.len) / 2, 0, 0]);
      h.legs = h.ext === null ? [] : [1, -1].map((side) => {
        const attach = [h.fwd * P.legAttachX, side * P.legAttachY, P.legAttachZ];
        const L = legLocal(attach, legDir(h.ext, side, h.fwd), kappa);
        return {
          attach: toCat(L.attach),
          knee: L.knee && toCat(L.knee),
          foot: toCat(L.foot),
          masses: L.masses.map((q) => ({ m: q.m, p: toCat(q.p) })),
        };
      });
    }
    return segs;
  }

  function bodies(s) {
    const out = [];
    for (const h of geometry(s)) {
      out.push({ m: h.m, I: h.I, R: h.R, p: h.center });
      for (const leg of h.legs) for (const q of leg.masses) out.push({ m: q.m, I: null, R: null, p: q.p });
    }
    return out;
  }

  // Unit vectors (cat frame) pointing out of the belly of each leg-bearing
  // segment (front, back): where each pair of feet faces.
  const ventral = (s) => segments(s).filter((h) => h.ext !== null).map((h) => mv(h.R, [0, 0, -1]));

  // ---------- landing ----------
  // How far the body can keep moving down after the paws touch (m). Rigid legs
  // only give a couple of centimetres (pads and shoulders); jointed legs can fold.
  // feetAngle = worst angle of the feet from straight down.
  function landingStroke(s, feetAngle) {
    const aligned = Math.max(0, Math.cos(feetAngle));
    if (feetAngle > 70 * deg) return 0.01; // landed on side or back: just fur and ribs
    if (!jointed) return 0.02;
    const kappa = s.knees * KNEE_MAX;
    const fold = P.legLen * (Math.cos(kappa / 2) - Math.cos(KNEE_CROUCH / 2));
    return 0.02 + Math.max(0, fold) * aligned;
  }

  // Drag area Cd·A (m²) for air resistance. Spread legs act like a parachute:
  // 0.09 m² gives a terminal speed of ~27 m/s (60 mph) for a 4 kg cat, the
  // figure usually quoted for cats; tucked (0.05 m²) gives ~36 m/s.
  const dragArea = (s) => 0.05 + 0.04 * (s.front + s.back) / 2;

  // Shape after the body has sunk `d` metres into the landing (knees fold).
  function compress(s, d) {
    if (!jointed) return s;
    const L0 = P.legLen * Math.cos((s.knees * KNEE_MAX) / 2);
    const c = Math.max(Math.cos(KNEE_CROUCH / 2), Math.min(1, (L0 - Math.max(0, d - 0.02)) / P.legLen));
    return { ...s, knees: (2 * Math.acos(c)) / KNEE_MAX };
  }

  // ---------- autopilot ("Show me" / Watch the cat) ----------
  // 1. Roll upright by bend-and-twist: hold a big bend and sweep its direction,
  //    legs tucked while far from upright. Sweeping dir upward rolls the cat
  //    negatively about its long axis (tests/physics-tests.html), so sweep
  //    against the roll still needed.
  // 2. Fix nose-up/down pitch with a leg pump: with the spine bent toward the
  //    belly, swap which legs are tucked, then straighten. Front tucked/back out
  //    on the way in pitches nose-down (about +22° per pump for model B).
  // 3. Straighten, spread the legs and (jointed legs) straighten the knees to
  //    leave the most travel for absorbing the landing.
  const LAND_PREP = 0.1; // s kept back after a pump to spread the legs for landing
  const landPose = jointed ? { knees: 0.1 } : {};
  const airPose = jointed ? { knees: 0.3 } : {};

  function pumpSteps(sign, dir, bend = 100 * deg) {
    const tuckFront = { front: 0, back: 1 }, tuckBack = { front: 1, back: 0 };
    const [first, second] = sign > 0 ? [tuckFront, tuckBack] : [tuckBack, tuckFront];
    return [
      { bend: 0, dir, ...first },
      { bend, dir, ...first },
      { bend, dir, ...second },
      { bend: 0, dir, ...second },
    ];
  }

  const reached = (s, t) => Object.keys(t).every((k) => Math.abs(s[k] - t[k]) < 1e-3);

  // Drive the shape through waypoints at full muscle speed; returns the net
  // rotation vector (cat frame, radians) and the time taken. Start and waypoints
  // may use the combined spine (bend, twist), which is split between the joints.
  function runSteps(start, steps, h = 5e-4) {
    let R = FC.m3.I(), s = split({ ...neutral(), ...start }), t = 0;
    for (const w of steps) {
      const target = split({ ...combine(s), ...w });
      while (!reached(s, target) && t < 5) {
        const s1 = { ...s };
        for (const c of controls) {
          const d = target[c.key] - s[c.key], m = c.rate * h;
          s1[c.key] = s[c.key] + Math.max(-m, Math.min(m, d));
        }
        R = FC.physics.step(model, R, s, s1, h).R;
        s = s1;
        t += h;
      }
    }
    return { rot: FC.m3.log(R), t, shape: s };
  }

  // Pitch (rad) and duration (s) of a pump vs its bend, measured once with this
  // model's own physics. Pitch is not proportional to bend (the effect grows
  // with bend), so the autopilot interpolates in this table.
  let pumpTable = null;
  function getPumpTable() {
    if (!pumpTable) {
      const start = { bend: 0, dir: 0, twist: 0, front: 1, back: 1, ...airPose };
      pumpTable = [0, 20, 40, 60, 80, 100].map((b) => {
        const r = runSteps(start, pumpSteps(1, 0, b * deg));
        return { bend: b * deg, pitch: Math.abs(r.rot[1]), t: r.t };
      });
    }
    return pumpTable;
  }
  const getPumpGain = () => getPumpTable()[5].pitch;

  // Linear interpolation of `out` against monotonic `key` in the pump table.
  function interp(key, x, out) {
    const tb = getPumpTable();
    if (x <= tb[0][key]) return tb[0][out];
    for (let i = 1; i < tb.length; i++)
      if (x <= tb[i][key]) {
        const f = (x - tb[i - 1][key]) / (tb[i][key] - tb[i - 1][key]);
        return tb[i - 1][out] + f * (tb[i][out] - tb[i - 1][out]);
      }
    return tb[tb.length - 1][out];
  }

  // Bend for a pump that removes `pitch`, shrunk to fit the time left (if any).
  function pumpBend(pitch, timeLeft) {
    const forPitch = interp("pitch", Math.abs(pitch), "bend");
    const forTime = interp("t", timeLeft - LAND_PREP, "bend");
    return Math.min(forPitch, forTime);
  }

  // The reflex steers the combined spine; split() hands it to the joints.
  const autopilot = (s, info, mem) => split(combinedAutopilot(combine(s), info, mem));

  // mem.stage records the move in progress ("roll", "pump" or "land") for the narrator.
  function combinedAutopilot(s, info, mem) {
    const { roll, pitch, timeLeft } = info;
    if (Math.abs(roll) > (mem.pump ? 20 : 8) * deg) {
      mem.pump = null;
      mem.stage = "roll";
      // Full bend for big errors. Roll per lap grows roughly with bend², so ease
      // off for the last 45°; a full bend there overshoots and hunts back and forth.
      const bend = Math.max(35 * deg, Math.min(100 * deg, 100 * deg * Math.sqrt(Math.abs(roll) / (45 * deg))));
      // Legs fully tucked while far from upright (a trick taken from the optimizer,
      // lab/reflex-experiment.html: lowers the safe height by up to 45%), then half
      // out for the last 45° so they are quick to spread for landing.
      const legs = Math.abs(roll) > 45 * deg ? 0 : 0.4;
      return { bend, dir: s.dir - Math.sign(roll) * 0.8, twist: 0, front: legs, back: legs, ...airPose };
    }
    if (!mem.pump && Math.abs(pitch) > 6 * deg) {
      // Sized to the error (no overshoot) and to the time left before landing.
      // Even a straight-spine pump (just swapping the legs) pitches a little, so
      // start any pump that can finish before touchdown.
      const bend = pumpBend(pitch, timeLeft);
      if (timeLeft - LAND_PREP >= getPumpTable()[0].t) {
        const pikeDir = Math.round(s.dir / (2 * Math.PI)) * 2 * Math.PI; // nearest "toward belly"
        mem.pump = { steps: pumpSteps(Math.sign(pitch), pikeDir, bend), i: 0 };
      }
    }
    if (mem.pump) {
      mem.stage = "pump";
      const target = { twist: 0, ...airPose, ...mem.pump.steps[mem.pump.i] };
      if (reached(s, target) && ++mem.pump.i >= mem.pump.steps.length) mem.pump = null;
      return target;
    }
    mem.stage = "land";
    return { bend: 0, dir: s.dir, twist: 0, front: 1, back: 1, ...landPose };
  }

  // ---------- twist-only spine (model A): tuck and turn ----------
  // One cycle: tuck the front legs and spread the back ones, twist the halves,
  // swap which legs are tucked, untwist. The tucked (light) half turns further
  // than the spread (heavy) half both ways, so each cycle leaves a net roll in
  // the direction of the first twist (lab measurement: 64° per 180° cycle for
  // model B's body), at the cost of ~0.66 s.
  // The legs hang below the spine's axis, so a cycle also tips the nose ~10°.
  // The mirror cycle (back legs tucked first, opposite twist) rolls the same way
  // but tips the nose the other way, so the autopilot alternates the two.
  const LEG_SWAP = 0.1; // s to move a pair of legs fully (rate 10/s)
  function cycleSteps(twist, backFirst = false) {
    const [a, b] = backFirst ? [{ front: 1, back: 0 }, { front: 0, back: 1 }] : [{ front: 0, back: 1 }, { front: 1, back: 0 }];
    return [{ ...a, twist: 0 }, { ...a, twist }, { ...b, twist }, { ...b, twist: 0 }];
  }
  // Net roll per degree of twist in one cycle, measured once with this model's physics.
  let cycleGain = null;
  const getCycleGain = () => {
    if (cycleGain === null) {
      const r = runSteps(neutral(), [{ front: 1, back: 1 }, ...cycleSteps(TWIST_MAX)]);
      cycleGain = r.rot[0] / TWIST_MAX;
    }
    return cycleGain;
  };

  function twistAutopilot(s, info, mem) {
    const { roll, timeLeft } = info;
    if (!mem.cycle && Math.abs(roll) > 8 * deg) {
      // Twist just enough for the roll still needed, and only as far as time allows.
      const twistRate = controls.find((c) => c.key === "twist").rate;
      const fitTime = (timeLeft - LAND_PREP - 3 * LEG_SWAP) * twistRate / 2;
      const amp = Math.min(TWIST_MAX, Math.abs(roll / getCycleGain()), fitTime);
      if (amp > 10 * deg) {
        const backFirst = !!mem.lastFrontFirst; // alternate, so the nose tips cancel
        mem.lastFrontFirst = !backFirst;
        const twist = (backFirst ? -1 : 1) * Math.sign(roll / getCycleGain()) * amp;
        mem.cycle = { steps: cycleSteps(twist, backFirst), i: 0 };
      }
    }
    if (mem.cycle) {
      mem.stage = "cycle";
      const target = { ...mem.cycle.steps[mem.cycle.i] };
      if (reached(s, target) && ++mem.cycle.i >= mem.cycle.steps.length) mem.cycle = null;
      return target;
    }
    mem.stage = "land";
    return { twist: 0, front: 1, back: 1 };
  }

  function twistCoach(s, info) {
    const err = Math.abs(info.roll), tw = s.twist / deg;
    // Which way to twist: positive twist (E) gives positive roll for this body.
    const sign = Math.sign(info.roll / getCycleGain());
    const [twistKey, untwistKey] = sign > 0 ? ["E", "Q"] : ["Q", "E"];
    const frontTucked = s.front < 0.2 && s.back > 0.8, swapped = s.front > 0.8 && s.back < 0.2;
    if (err > 15 * deg || Math.abs(tw) > 10) {
      if (swapped && Math.abs(tw) > 10) return `Untwist: hold ${tw > 0 ? "Q" : "E"} (${Math.round(err / deg)}° to go)`;
      if (Math.abs(tw) > 150 || (Math.abs(tw) > 10 && !frontTucked)) return "Swap legs: spread front (X), tuck back (C)";
      if (frontTucked) return `Twist: hold ${twistKey} (${Math.round(err / deg)}° to go)`;
      if (err > 15 * deg) return "Tuck front legs (Z), spread back legs (V)";
    }
    if (s.front < 0.8 || s.back < 0.8) return "Spread your legs for landing: X and V";
    return "Ready to land";
  }

  // ---------- on-screen coach (the same strategy, told to a human) ----------
  // Hysteresis: once nearly upright and straightening, a small residual tilt
  // (straightening shifts the roll a little) doesn't send the player back to bending.
  // Keys for bending/straightening: one joint, or both joints of a flexible spine.
  const [BEND_KEYS, UNBEND_KEYS] = flexible ? ["W and T", "S and G"] : ["W", "S"];
  function coach(shape, info) {
    const s = combine(shape);
    const err = Math.abs(info.roll);
    if (err > 30 * deg || (err > 15 * deg && s.bend >= 60 * deg)) {
      if (s.bend < 60 * deg) return `Bend your spine: hold ${BEND_KEYS}`;
      const key = info.roll > 0 ? "A" : "D";
      return `Sweep the bend around: hold ${key} (${Math.round(err / deg)}° to go)`;
    }
    if (s.bend > 20 * deg) return `Upright! Straighten your spine: hold ${UNBEND_KEYS}`;
    const p = info.pitch / deg;
    if (Math.abs(p) > 12) {
      const tuck = p > 0 ? "front (Z)" : "back (C)";
      return `Nose ${p > 0 ? "up" : "down"} ${Math.round(Math.abs(p))}°: tuck ${tuck} legs, bend toward belly (${BEND_KEYS}), swap legs, straighten (${UNBEND_KEYS})`;
    }
    if (s.front < 0.8 || s.back < 0.8) return "Spread your legs for landing: X and V";
    if (jointed && s.knees > 0.3) return "Straighten your knees to cushion the landing: K";
    return "Ready to land";
  }

  // Muscle speeds (per simulated second) are set so a flawless 180° righting
  // takes ~0.37 s, in line with real cats (about 0.3–0.4 s).
  const controls = [
    { key: "bend", label: "Spine bend", type: "slider", min: 0, max: 100 * deg, def: 0,
      rate: 900 * deg, unit: "deg", keys: ["s", "w"], hint: "W / S" },
    { key: "dir", label: "Bend direction", type: "dial", def: 0,
      rate: 2000 * deg, unit: "deg", keys: ["a", "d"], hint: "A / D (hold to sweep)" },
    { key: "twist", label: "Spine twist", type: "slider", min: -TWIST_MAX, max: TWIST_MAX, def: 0,
      rate: 1000 * deg, unit: "deg", keys: ["q", "e"], hint: "Q / E" },
    { key: "front", label: "Front legs", type: "slider", min: 0, max: 1, def: 0.6,
      rate: 10, unit: "ext", keys: ["z", "x"], hint: "Z tuck / X spread" },
    { key: "back", label: "Back legs", type: "slider", min: 0, max: 1, def: 0.6,
      rate: 10, unit: "ext", keys: ["c", "v"], hint: "C tuck / V spread" },
  ];
  if (jointed)
    controls.push({ key: "knees", label: "Knee bend", type: "slider", min: 0, max: 1, def: 0.3,
      rate: 6, unit: "knee", keys: ["k", "j"], hint: "J bend / K straighten" });
  if (!bendable) controls.splice(0, 2); // no bend or bend direction
  if (flexible) {
    // Two spine joints instead of one: the front (chest) joint bends and twists
    // further and faster than the stiffer back (lower-back) joint.
    controls.splice(0, 1,
      { key: "bendF", label: "Front spine bend", type: "slider", min: 0, max: BEND_F_MAX, def: 0,
        rate: 1100 * deg, unit: "deg", keys: ["s", "w"], hint: "W / S" },
      { key: "bendB", label: "Back spine bend", type: "slider", min: 0, max: BEND_B_MAX, def: 0,
        rate: 600 * deg, unit: "deg", keys: ["g", "t"], hint: "T / G" });
    controls.splice(controls.findIndex((c) => c.key === "twist"), 1,
      { key: "twistF", label: "Front spine twist", type: "slider", min: -TWIST_F_MAX, max: TWIST_F_MAX, def: 0,
        rate: 1200 * deg, unit: "deg", keys: ["q", "e"], hint: "Q / E" },
      { key: "twistB", label: "Back spine twist", type: "slider", min: -TWIST_B_MAX, max: TWIST_B_MAX, def: 0,
        rate: 500 * deg, unit: "deg", keys: ["h", "y"], hint: "Y / H" });
  }

  function neutral() {
    const s = bendable ? {} : { bend: 0, dir: 0 };
    for (const c of controls) s[c.key] = c.def;
    return s;
  }

  const model = {
    id: opts.id, name: opts.name, description: opts.description, available: true,
    params: P, jointed, bendable, flexible, controls,
    // Looks only: fur, belly/paws/muzzle, eyes, and optional tabby stripes (CSS hex colors).
    coat: { fur: "#e0883a", belly: "#f6f0e6", eyes: "#222222", stripes: null, ...(opts.coat || {}) },
    // Shape values that never change for this model (kept so shared code can read them).
    fixedShape: bendable ? {} : { bend: 0, dir: 0 },
    // How far the spine is from straight (rad): the bend, or for a twist-only spine the twist.
    spineAngle: (s) => (bendable ? combine(s).bend : Math.abs(s.twist)),
    contactHeight: P.legLen + P.radius, // centre-of-mass height when the paws first touch (approx.)
    bodyLength: flexible ? P.chestLen + P.waistLen + P.hipLen : 2 * P.halfLen, // m, without head and tail
    bodies, ventral, geometry, landingStroke, compress, dragArea,
    autopilot: bendable ? autopilot : twistAutopilot,
    coach: bendable ? coach : twistCoach,
    pumpSteps, runSteps, getPumpGain, getPumpTable, pumpBend, getCycleGain, cycleSteps, combine, split, // exposed for tests
  };
  return model;
};
