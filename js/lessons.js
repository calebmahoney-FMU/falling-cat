// Guided lessons: a short course from Model 0 (two cylinders and a leg) to the
// four cats. Each lesson has steps with a live check; when every step is done it
// explains what happened, using the numbers the player just produced.
//
// Lessons 1–3 run on model0.html, 4–7 in the game (index.html). A host page
// mounts the lesson named in its URL (?lesson=N) with an `api` object:
//   model0 api: s, model, RF (orientation), st (latest state), setTargets(t),
//               setLegMass(m), snapNeutral(), resetOrientation(), net() (rotation
//               vector of the back cylinder since the lesson started)
//   game api:   game (FC.game), start({ model, mode, inputs }), landings (one
//               record per landing: model, mode, height, worst, impact, v, d, demo,
//               optimized, n), set(id, value)
// Progress is kept in this browser (localStorage).
var FC = (globalThis.FC = globalThis.FC || {});

FC.lessons = (function () {
  const deg = Math.PI / 180;
  const KEY = "fallingcat.lessons";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} };
  const vc = (x, sub = "") => `<span class="vc">${x}</span>${sub ? `<sub><var>${sub}</var></sub>` : ""}`;
  const tn = (x, sub = "") => `<b class="tn">${x}</b>${sub ? `<sub>${sub}</sub>` : ""}`;
  const f = (x, d = 1) => x.toFixed(d);

  // Landings since a step began (game lessons).
  const newLandings = (api, mem) => api.landings.slice(mem.from || 0);
  const beginLandings = (api, mem) => { mem.from = api.landings.length; };

  // Roll per full sweep of the bend direction at full bend for a game model (legs spread or tucked),
  // computed with the game's own engine; unwrapped as it goes because a lap can pass 180°.
  function sweepRoll(m, legX) {
    const P = FC.physics, full = m.controls.filter((c) => /^bend/.test(c.key)).reduce((a, c) => a + c.max, 0);
    const base = { ...FC.sim.neutral(m), front: legX, back: legX };
    const at = (dir) => m.split({ ...m.combine(base), bend: full, twist: 0, dir });
    const n = 360; let R = FC.m3.I(), roll = 0, prev = 0;
    for (let i = 0; i < n; i++) {
      R = P.step(m, R, at((2 * Math.PI * i) / n), at((2 * Math.PI * (i + 1)) / n), 0.5e-3).R;
      const y = FC.m3.mv(R, [0, 1, 0]), a = Math.atan2(y[2], y[1]);
      let d = a - prev; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); roll += d; prev = a;
    }
    return Math.abs(roll) / deg;
  }

  const LESSONS = [
    // ---------------------------------------------------------------- Model 0
    {
      id: 1, host: "model0", title: "Inertia is a tensor",
      tagline: "Fold the leg and watch the inertia tensor change.",
      intro: `How hard a body is to spin depends on the axis. That's why the inertia ${tn("J")} is a 3×3 tensor, not one number.
        Its eigenvalues, the principal moments <var>J</var><sub>1</sub> ≤ <var>J</var><sub>2</sub> ≤ <var>J</var><sub>3</sub>, are the moments
        about its three principal axes. Watch the "Inertia tensor" card.`,
      setup(api) { api.setLegMass(0.3); api.snapNeutral(); api.resetOrientation(); },
      steps: [
        { text: `Keep the body straight (<var>β</var> = 0) with the leg straight down (<var>α</var> = 0). Note the smallest principal moment <var>J</var><sub>1</sub>: the moment about (nearly) the long axis.`,
          check(api, mem) {
            const s = api.s;
            if (Math.abs(s.beta) > deg || Math.abs(s.alpha) > deg || Math.abs(s.psi) > deg) return false;
            mem.a = { ...FC.model0.eigenSym(api.st.J), c3: api.st.conf.bodies[2].c };
            return true;
          } },
        { text: `Now fold the leg forward along the body: set the leg angle <var>α</var> to 80° or more (keep <var>β</var> = 0).`,
          status: (api) => `α = ${f(api.s.alpha / deg, 0)}°`,
          check(api, mem) {
            if (api.s.alpha < 80 * deg || Math.abs(api.s.beta) > deg) return false;
            mem.b = { ...FC.model0.eigenSym(api.st.J), c3: api.st.conf.bodies[2].c };
            return true;
          } },
      ],
      explain(api, mem) {
        const d = (c) => Math.hypot(c[1], c[2]), ma = api.model.params.leg.m;
        const [a1, b1] = [mem.a.values[0] * 1e4, mem.b.values[0] * 1e4];
        const tilt = (ax) => Math.acos(Math.min(1, Math.abs(ax[0]))) / deg;
        return `<p><var>J</var><sub>1</sub> dropped from <b>${f(a1)}</b> to <b>${f(b1)}</b> kg·cm² (${f(100 * (1 - b1 / a1), 0)}% less).
          The leg's centre of mass moved from ${f(100 * d(mem.a.c3))} cm to ${f(100 * d(mem.b.c3))} cm from the cylinders' axis. A point mass
          contributes <var>m r</var><sub>⊥</sub><sup>2</sup>, so its share about that line fell from ${f(ma * d(mem.a.c3) ** 2 * 1e4)} to
          ${f(ma * d(mem.b.c3) ** 2 * 1e4)} kg·cm². The distance is squared, so mass close to an axis barely counts.</p>
          <p>That isn't the whole story. <var>J</var><sub>1</sub> is the moment about an axis through the whole body's centre of mass, which moved too
          (the parallel-axis term <var>m</var>(|${vc("r")}|<sup>2</sup>${tn("1")} − ${vc("r")}${vc("r")}<sup>T</sup>)). And the principal axis turned:
          it was tilted ${f(tilt(mem.a.axes[0]))}° from the cylinders' axis, and now ${f(tilt(mem.b.axes[0]))}°. A single number can't describe that;
          the tensor's eigenvectors do. The other two moments changed as well: <var>J</var><sub>2</sub>, <var>J</var><sub>3</sub> =
          ${f(mem.a.values[1] * 1e4)}, ${f(mem.a.values[2] * 1e4)} → ${f(mem.b.values[1] * 1e4)}, ${f(mem.b.values[2] * 1e4)} kg·cm².</p>
          <p><b>Why it matters:</b> a cat changes its inertia tensor with its legs. A light (tucked) half spins easily; a heavy one resists.</p>`;
      },
    },
    {
      id: 2, host: "model0", title: "Zero angular momentum",
      tagline: "Twist the body and see the two halves cancel exactly.",
      intro: `The body floats freely, so its total angular momentum ${vc("L")} stays <b>zero</b>. To keep it simple the leg is massless here (mass 0),
        so the two cylinders are identical and share one axis. Watch the "Body by body" card: each cylinder's ${vc("L", "i")}.`,
      setup(api) { api.setLegMass(0); api.snapNeutral(); api.resetOrientation(); },
      steps: [
        { text: `With the body straight (<var>β</var> = 0), twist the front cylinder: set the twist <var>ψ</var> to <b>+90°</b> or more.
            While it turns, compare ${vc("L", "1")} and ${vc("L", "2")}.`,
          status: (api) => `ψ = ${f(api.s.psi / deg, 0)}°`,
          check(api, mem) {
            if (api.s.psi < 89.5 * deg || Math.abs(api.s.beta) > deg) return false;
            mem.psi = api.s.psi; mem.net = api.net(); return true;
          } },
        { text: `Untwist: bring <var>ψ</var> back to 0.`,
          status: (api) => `ψ = ${f(api.s.psi / deg, 0)}°`,
          check(api, mem) { if (Math.abs(api.s.psi) > 0.5 * deg) return false; mem.back = api.net(); return true; } },
      ],
      explain(api, mem) {
        const back = FC.m3.v.norm(mem.back) / deg;
        return `<p>You twisted the front cylinder by ψ = ${f(mem.psi / deg)}° relative to the back one, and the back cylinder turned by
          <b>${f(mem.net[0] / deg, 3)}°</b> about the long axis: exactly −ψ/2.</p>
          <p>Why: along the shared axis ${vc("L")} has one component, and it must stay zero:
          <var>A ω</var><sub>1</sub> + <var>A ω</var><sub>2</sub> = 0, with <var>A</var> = ½<var>mr</var><sup>2</sup> each.
          The front spins relative to the back at <var>ψ̇</var>, so <var>ω</var><sub>1</sub> = <var>ω</var><sub>2</sub> + <var>ψ̇</var>, which gives
          <var>ω</var><sub>2</sub> = −<var>ψ̇</var>/2. Equal moments, so each half takes half of the twist, in opposite directions.
          That's why ${vc("L", "1")} = −${vc("L", "2")} throughout.</p>
          <p>Then you untwisted, and the net rotation went back to <b>${back < 1e-6 ? "0" : f(back, 6)}°</b>. Undoing a shape change along the same path undoes
          the rotation. With zero angular momentum, a body can't just spin. To turn for good it needs a <i>loop</i>: next lesson.</p>`;
      },
    },
    {
      id: 3, host: "model0", title: "A loop gives a turn",
      tagline: "Same moves, different order: a net rotation from nothing.",
      intro: `Now the leg has mass (0.3 kg). The leg is on the front cylinder, so the front body is always the heavier one about the long
        axis. Folding the leg makes it much less heavy (lesson 1). Twisting with the leg folded, then untwisting with it down, should leave something behind.`,
      setup(api) { api.setLegMass(0.3); api.snapNeutral(); api.resetOrientation(); },
      steps: [
        { text: `Fold the leg: <var>α</var> ≥ 80°.`, status: (api) => `α = ${f(api.s.alpha / deg, 0)}°`, check: (api) => api.s.alpha >= 80 * deg },
        { text: `Twist: <var>ψ</var> ≥ +110°.`, status: (api) => `ψ = ${f(api.s.psi / deg, 0)}°`,
          check(api, mem) { if (api.s.psi < 110 * deg) return false; mem.theta = api.s.psi; return true; } },
        { text: `Unfold the leg straight down: <var>α</var> back to 0.`, status: (api) => `α = ${f(api.s.alpha / deg, 0)}°`,
          check(api, mem) { mem.theta = Math.max(mem.theta, api.s.psi); return Math.abs(api.s.alpha) <= 1 * deg; } }, // θ = the largest twist reached
        { text: `Untwist: <var>ψ</var> back to 0. The shape is now exactly where it started.`, status: (api) => `ψ = ${f(api.s.psi / deg, 0)}°`,
          check(api, mem) {
            const s = api.s;
            if (Math.abs(s.psi) > 0.5 * deg || Math.abs(s.alpha) > 0.5 * deg || Math.abs(s.beta) > 0.5 * deg) return false;
            mem.net = api.net(); return true;
          } },
      ],
      explain(api, mem) {
        const { v } = FC.m3, ang = v.norm(mem.net) / deg, ax = v.unit(mem.net);
        // One-axis estimate: moments about the cylinders' axis (x̂ through the joint) of the front body with the leg folded / down, and of the back.
        const about = (alpha) => {
          const c = api.model.configuration({ beta: 0, phi: 0, psi: 0, alpha }), [b1, , b3] = c.bodies;
          return b1.I[0] + b3.I[0] + b3.m * (b3.c[1] ** 2 + b3.c[2] ** 2); // x̂·I x̂ of each body + m r⊥² of the leg (the cylinder is on the axis)
        };
        const If = about(90 * deg), Iu = about(0), I2 = api.model.configuration(api.model.neutral()).bodies[1].I[0], th = mem.theta / deg;
        const est = th * (I2 / (If + I2) - I2 / (Iu + I2));
        return `<p>Every shape angle is back where it started, ${vc("L")} was zero the whole time, and yet the body has turned by
          <b>${f(ang, 2)}°</b> (axis (${ax.map((x) => x.toFixed(2)).join(", ")}) in the world frame, mostly the long axis).</p>
          <p>About the long axis the front body's moment was <var>I</var><sub>1</sub> = ${f(If * 1e4)} kg·cm² with the leg folded and ${f(Iu * 1e4)} kg·cm²
          with it down; the back's is <var>I</var><sub>2</sub> = ${f(I2 * 1e4)} kg·cm². Along a shared axis <var>I</var><sub>1</sub><var>ω</var><sub>1</sub> + <var>I</var><sub>2</sub><var>ω</var><sub>2</sub> = 0,
          so a twist <var>θ</var> turns the back by <var>θ I</var><sub>1</sub>/(<var>I</var><sub>1</sub> + <var>I</var><sub>2</sub>) and the front by <var>θ I</var><sub>2</sub>/(<var>I</var><sub>1</sub> + <var>I</var><sub>2</sub>).
          Twisting with the leg folded, the moments were close, so the twist split nearly evenly. Untwisting with the leg down, the front was much heavier,
          so the back did most of the moving. The halves didn't retrace their turns. Each step obeyed ${vc("L")} = ${vc("0")}; the mismatch is the net turn.
          The one-axis estimate, <var>θ</var>[<var>I</var><sub>2</sub>/(<var>I</var><sub>1,folded</sub> + <var>I</var><sub>2</sub>) − <var>I</var><sub>2</sub>/(<var>I</var><sub>1,down</sub> + <var>I</var><sub>2</sub>)] with
          <var>θ</var> = ${f(th, 0)}°, gives <b>${f(est, 1)}°</b>. The full simulation gives ${f(ang, 1)}°, because the leg sits off the axis, so the tensors are not
          diagonal about it and the body also turns a little about the other axes.</p>
          <p>The rotation depends only on the <i>path</i> through shape space, not on speed (a geometric phase). Do the same four moves in reverse order and
          you get the opposite rotation. This is <b>tuck and turn</b>, the move model A uses to turn over.</p>`;
      },
    },
    // ---------------------------------------------------------------- the cats
    {
      id: 4, host: "game", title: "Tuck and turn (model A)",
      tagline: "Turn a cat over using only twist and legs.",
      intro: `Model A's spine can twist but not bend: the move from lesson 3 is all it has. Each cycle turns it only part of the way, so it
        needs a long fall. You get 21 m in slow motion. Follow the coach at the top: tuck the front legs, twist, swap the legs, untwist, repeat.`,
      setup(api) { api.start({ model: "A", mode: "free", inputs: { start: "upside", height: 21, speed: 0.15, "air-on": true, "coach-on": true } }); },
      steps: [
        { short: "Drop, then tuck and turn as the coach says. Land on your feet.", text: `Drop (Space, or the Drop button) and turn over with tuck and turn. Land on your feet (feet within 45° of straight down).
            Stuck? "Show me" plays it for you, but only your own landing counts.`,
          begin: beginLandings,
          status: (api, mem) => { const l = newLandings(api, mem).filter((x) => x.model === "A"); return l.length ? `last landing: feet ${f(l[l.length - 1].worst, 0)}° from down` : "not landed yet"; },
          check(api, mem) { const ok = newLandings(api, mem).find((x) => x.model === "A" && !x.demo && x.worst < 45); if (ok) mem.l = ok; return !!ok; } },
      ],
      explain(api, mem) {
        const A = FC.models.find((m) => m.id === "A"), tw = A.controls.find((c) => c.key === "twist").max;
        const cyc = Math.abs(A.getCycleGain() * tw) / deg;
        return `<p>You landed with your feet ${f(mem.l.worst, 0)}° from straight down, from ${f(mem.l.height, 0)} m.</p>
          <p>One full tuck-and-turn cycle (twist ${f(tw / deg, 0)}°) turns this body by about <b>${f(cyc, 0)}°</b>, so turning over takes about
          ${f(180 / cyc, 1)} cycles. That's why model A needs about 12 m to land from upside down, where cats that can bend need under 1 m.</p>
          <p>Unlike lesson 3, here the legs <i>swap</i>: the half with tucked legs is the light one (<var>I</var><sub>L</sub>), the other the heavy one
          (<var>I</var><sub>H</sub>), and the swap reverses them for the untwist. The one-axis estimate per cycle is then
          <var>θ</var>(<var>I</var><sub>H</sub> − <var>I</var><sub>L</sub>)/(<var>I</var><sub>H</sub> + <var>I</var><sub>L</sub>). It slightly overestimates: the legs hang below the spine,
          so each half's inertia tensor has off-diagonal terms and some of the twist goes into wobble about the other axes.</p>`;
      },
    },
    {
      id: 5, host: "game", title: "Bend and twist (model B)",
      tagline: "The real cat's move: bend the spine and sweep it around.",
      intro: `Model B can bend. Bend the spine hard, then sweep the bend direction around in a circle like a hula hoop. Each half spins about
        its own axis, and because the halves are tilted their angular momenta can't cancel, so the whole body rolls the other way. You have 3 m.`,
      setup(api) { api.start({ model: "B", mode: "free", inputs: { start: "upside", height: 3, speed: 0.15, "air-on": true, "coach-on": true } }); },
      steps: [
        { short: "Drop, drag the bend pad out and circle your thumb. Land on your feet.", text: `Drop and right yourself by bending (W, or drag the bend pad out) and sweeping the bend around (A/D, or circle your thumb). Land on your feet.`,
          begin: beginLandings,
          status: (api, mem) => { const l = newLandings(api, mem).filter((x) => x.model === "B"); return l.length ? `last landing: feet ${f(l[l.length - 1].worst, 0)}° from down` : "not landed yet"; },
          check(api, mem) { const ok = newLandings(api, mem).find((x) => x.model === "B" && !x.demo && x.worst < 45); if (ok) mem.l = ok; return !!ok; } },
      ],
      explain(api, mem) {
        const B = FC.models.find((m) => m.id === "B"), spread = sweepRoll(B, 1), tucked = sweepRoll(B, 0);
        return `<p>You landed with your feet ${f(mem.l.worst, 0)}° from down, from ${f(mem.l.height, 1)} m.</p>
          <p>At full bend, one lap of the sweep rolls this body by <b>${f(spread, 0)}°</b> with the legs spread and <b>${f(tucked, 0)}°</b> with
          them tucked (computed just now by the game's engine). Tucking shrinks each half's moment about its own axis, <var>A</var>, and for two
          cylinders Kane and Scher showed that one lap rolls the body by 2π(<var>A</var> cos <var>b</var> / (<var>A</var> cos<sup>2</sup><var>b</var> +
          <var>B</var> sin<sup>2</sup><var>b</var>) − 1), with <var>b</var> half the bend. Smaller <var>A</var> means a bigger roll. About one lap turns a
          cat over, compared with about three tuck-and-turn cycles. That's why, in the lab, model B lands from upside-down drops about twenty times
          lower than model A.</p>`;
      },
    },
    {
      id: 6, host: "game", title: "Landing: why knees matter",
      tagline: "Same drop, two cats: see the impact force change.",
      intro: `Turning over is half the job. On touchdown the body must stop, and the force depends on how far it travels while stopping.
        Here the cat rights itself (Watch mode); you compare landings.`,
      setup(api) { api.start({ model: "C", mode: "watch", inputs: { gravity: "earth", roll: 180, pitch: 0, delay: 60, strategy: "reflex", height: 3, "air-on": true } }); },
      steps: [
        { short: "Tap Drop: model C from 3 m. Note the impact.", text: `Drop model C (jointed legs) from 3 m: press Drop. Note the impact in the landing report.`,
          begin: beginLandings,
          check(api, mem) { const l = newLandings(api, mem).find((x) => x.model === "C" && x.mode === "watch" && Math.abs(x.height - 3) < 0.01); if (l) mem.c = l; return !!l; } },
        { short: "Switch Model to B (panel below), then drop again.", text: `Now switch to <b>model B</b> (rigid legs) with the Model selector in the panel, and drop again from the same 3 m.`,
          begin: beginLandings,
          check(api, mem) { const l = newLandings(api, mem).find((x) => x.model === "B" && x.mode === "watch" && Math.abs(x.height - 3) < 0.01); if (l) mem.b = l; return !!l; } },
      ],
      explain(api, mem) {
        const g = 9.81, row = (x) => `${f(x.v, 2)} m/s stopped over ${f(100 * x.d, 1)} cm: 1 + ${f(x.v, 2)}²/(2·${g}·${f(x.d, 3)}) = <b>${f(1 + x.v * x.v / (2 * g * x.d), 0)}×</b> body weight`;
        return `<p>Model C: ${row(mem.c)}.<br>Model B: ${row(mem.b)}.</p>
          <p>Both hit the ground at about the same speed. The difference is the stopping distance <var>d</var>. Stopping from speed <var>v</var>
          at a steady rate takes a deceleration <var>v</var><sup>2</sup>/2<var>d</var>, so the ground must push with
          <var>N</var> = <var>m</var>(<var>g</var> + <var>v</var><sup>2</sup>/2<var>d</var>), which is 1 + <var>v</var><sup>2</sup>/(2<var>gd</var>) body weights. Without air drag
          <var>v</var><sup>2</sup> = 2<var>gh</var>, so it's simply 1 + <var>h</var>/<var>d</var>. Rigid legs stop the body in about 2 cm; folding knees in about 16 cm.
          ${f(mem.b.impact / mem.c.impact, 0)} times gentler, from the same drop.</p>`;
      },
    },
    {
      id: 7, host: "game", title: "The flexible spine's trick (model D)",
      tagline: "The computer found a better move. See it beat the reflex.",
      intro: `Model D's spine has two joints: a very flexible front one and a stiffer back one. An optimizer (CMA-ES) searched for the best timed
        moves. A <b>perfect</b> landing means all three: feet within 20° of down, spine straight (bent under 25°), and legs spread to cushion the
        impact. Compare the optimizer's move with the cat's reflex from a drop of only 0.5 m.`,
      setup(api) { api.start({ model: "D", mode: "watch", inputs: { gravity: "earth", roll: 180, pitch: 0, delay: 0, strategy: "reflex", height: 0.5, "air-on": true } }); },
      steps: [
        { short: "Tap Drop with the Reflex strategy. Look at feet, spine, legs.", text: `Drop model D upside down from 0.5 m with the <b>Reflex</b> strategy (press Drop). Look at the landing: feet, spine, legs.`,
          begin: beginLandings,
          check(api, mem) { const l = newLandings(api, mem).find((x) => x.model === "D" && !x.optimized && Math.abs(x.height - 0.5) < 0.01); if (l) mem.r = l; return !!l; } },
        { short: "Set Cat's strategy to Optimized (panel below), drop again.", text: `Set <b>Cat's strategy</b> to <b>Optimized</b> in the panel and drop again from 0.5 m.`,
          begin: beginLandings,
          check(api, mem) { const l = newLandings(api, mem).find((x) => x.model === "D" && x.optimized && Math.abs(x.height - 0.5) < 0.01); if (l) mem.o = l; return !!l; } },
      ],
      explain(api, mem) {
        const D = FC.models.find((m) => m.id === "D"), opt = FC.pilots.optimizedFor(D, 180);
        const perfect = (x) => x.worst < 20 && x.bend < 25 && x.legs > 0.7;
        const row = (name, x) => `${name}: feet ${f(x.worst, 0)}° from down, spine bent ${f(x.bend, 0)}°, legs ${f(100 * x.legs, 0)}% spread: <b>${perfect(x) ? "perfect" : "not ready to land"}</b>`;
        return `<p>${row("Reflex", mem.r)}.<br>${row("Optimized", mem.o)}.</p>
          <p>The reflex turns over in order: roll upright, then straighten and spread the legs. From 0.5 m it runs out of time halfway: the feet may be
          nearly down, but the spine is still bent and the legs tucked, the worst way to hit the ground. It needs ${opt ? f(opt.reflexMinHeight, 2) : "about 0.74"} m
          to land perfectly. The optimized move needs only ${opt ? f(opt.minHeight, 2) : "about 0.48"} m. Its trick is <b>front first</b>: tuck the front legs and spread
          the back ones, so the front half has the smaller moments of inertia, and turn the flexible front half over first. It lands its turn about 36 ms ahead
          of the back, and everything is ready at touchdown. Same physics as every lesson: ${vc("L")} = ${vc("0")}, with the lighter part doing most of the turning.</p>
          <p><b>The catch:</b> the optimized move is a fixed, timed sequence tuned for low drops. From higher up (try 0.75 m) it can't adapt, and its feet end just
          past 20°, while the reflex, which steers by feedback, lands perfectly. Real cats need both: speed and adaptability.</p>
          <p>That completes the course. Open <b>Physics, live</b> in the panel to watch ${tn("J")}, ${vc("Ω")} and each part's angular momentum while you play.</p>`;
      },
    },
  ];

  const url = (L) => `${L.host === "model0" ? "model0.html" : "index.html"}?lesson=${L.id}`;
  const STYLE = `
    .lesson-card { border: 1.5px solid var(--accent, var(--b2, #2a78d6)); border-radius: 12px; padding: 12px 14px; margin: 0 0 12px;
      background: color-mix(in srgb, var(--accent, var(--b2, #2a78d6)) 7%, transparent); }
    .lesson-card h3 { margin: 0 0 4px; font-size: 16px; }
    .lesson-card .lk { font-size: 12px; text-transform: uppercase; letter-spacing: .8px; color: var(--muted, #888); }
    .lesson-card p { margin: 6px 0; font-size: 14px; line-height: 1.5; }
    .lesson-card ol { margin: 8px 0; padding-left: 22px; font-size: 14px; }
    .lesson-card li { margin: 5px 0; }
    .lesson-card li.done { color: var(--muted, #888); }
    .lesson-card li.done::marker { content: "✓  "; color: #1baf7a; }
    .lesson-card li.now { font-weight: 600; }
    .lesson-card .st { display: block; font-weight: 400; font-size: 12px; color: var(--muted, #888); font-variant-numeric: tabular-nums; }
    .lesson-card .done-box { border-top: 1px solid var(--line, var(--grid, #ccc)); margin-top: 8px; padding-top: 6px; }
    .lesson-card .ok { color: #1baf7a; font-weight: 700; }
    .lesson-card .nav { display: flex; gap: 12px; flex-wrap: wrap; font-size: 14px; margin-top: 6px; }
    .lesson-card a { color: var(--accent, var(--b2, #2a78d6)); }`;

  // Mount the lesson named in the URL on this host. Returns { tick } (call every frame) or null.
  function mount(host, api, container) {
    const id = +new URLSearchParams(location.search).get("lesson");
    const L = LESSONS.find((x) => x.id === id && x.host === host);
    if (!L || !container) return null;
    if (!document.getElementById("lesson-style")) {
      const st = document.createElement("style"); st.id = "lesson-style"; st.textContent = STYLE; document.head.appendChild(st);
    }
    const mem = {};
    let step = 0, finished = false, lastHtml = "";
    container.hidden = false;
    container.classList.add("lesson-card");
    L.setup && L.setup(api, mem);
    L.steps[0].begin && L.steps[0].begin(api, mem);
    const next = LESSONS.find((x) => x.id === L.id + 1);
    function render() {
      const items = L.steps.map((s, i) => {
        const cls = i < step || finished ? "done" : i === step ? "now" : "";
        const st = i === step && !finished && s.status ? `<span class="st">${s.status(api, mem)}</span>` : "";
        return `<li class="${cls}">${s.text}${st}</li>`;
      }).join("");
      const html = `<div class="lk">Lesson ${L.id} of ${LESSONS.length}</div><h3>${L.title}</h3><p>${L.intro}</p><ol>${items}</ol>` +
        (finished ? `<div class="done-box"><p class="ok">✓ Lesson complete</p>${mem.explained}</div>` : "") +
        `<div class="nav">${finished && next ? `<a href="${url(next)}"><b>Next: ${next.title} →</b></a>` : ""}<a href="lessons.html">All lessons</a></div>`;
      if (html !== lastHtml) { container.innerHTML = html; lastHtml = html; }
    }
    render();
    let tickN = 0;
    const plain = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.textContent.replace(/\s+/g, " ").trim(); };
    return {
      lesson: L,
      // Compact view of where the lesson is, for a one-line strip on small screens.
      chip() {
        const s = L.steps[Math.min(step, L.steps.length - 1)];
        return { id: L.id, title: L.title, step: Math.min(step + 1, L.steps.length), steps: L.steps.length, finished,
          text: finished ? "Lesson complete: tap to read why it worked" : s.short || plain(s.text), status: !finished && s.status ? s.status(api, mem) : "" };
      },
      tick() {
        if (finished || ++tickN % 4) return; // checks at ~15 Hz
        if (L.steps[step].check(api, mem)) {
          // a short buzz on phones that allow it (setting: fallingcat.vibrate)
          try { if (navigator.vibrate && JSON.parse(localStorage.getItem("fallingcat.vibrate") ?? "true")) navigator.vibrate(step + 1 >= L.steps.length ? [40, 60, 40] : 30); } catch {}
          step++;
          if (step >= L.steps.length) {
            finished = true;
            mem.explained = L.explain(api, mem);
            const p = load(); p[L.id] = true; save(p);
          } else L.steps[step].begin && L.steps[step].begin(api, mem);
        }
        render();
      },
    };
  }

  return { LESSONS, mount, url, progress: load, reset: () => save({}) };
})();
