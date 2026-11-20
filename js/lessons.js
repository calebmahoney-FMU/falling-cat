// Guided lessons: a short, visual course from Model 0 (two cylinders and a leg) to
// the four cats. Little reading, more seeing: each lesson has a one-line goal, a few
// short steps checked live, a visual on the scene that shows the idea as it happens,
// and a two-sentence takeaway with a link to the math on the physics page.
//
// Everything runs inside the game (index.html). The game passes an `api`:
//   game, start({ model, mode, inputs }), landings (one record per landing: model, mode,
//   height, worst, bend, legs, impact, v, d, demo, optimized, n), set(id, value)
//   Model 0 (lessons 1–4): useModel0(legMass), s (shape), st (FC.physics.state now),
//   net() (rotation vector of the back cylinder since the lesson started, world frame)
//   toWorld(p) (a point in the body frame → world), fx: { ghost(on), line(a, b), glow(i), ring(on) }
// Progress is kept in this browser (localStorage).
var FC = (globalThis.FC = globalThis.FC || {});

FC.lessons = (function () {
  const deg = Math.PI / 180;
  const KEY = "fallingcat.lessons", VKEY = "fallingcat.lessons.v";
  const save = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} };
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  // Saved progress follows the lessons when they are renumbered (each step runs once):
  //   version 2 put two lessons between 3 and 4, so old lessons 4–7 became 6–9;
  //   version 3 swapped lessons 1 and 2 (zero angular momentum first: the simplest thing to see).
  try {
    const v = +(localStorage.getItem(VKEY) || 1);
    if (v < 3) {
      let p = read(), q = {};
      if (v < 2) { for (const k in p) q[+k >= 4 ? +k + 2 : k] = p[k]; p = q; q = {}; }
      for (const k in p) q[+k === 1 ? 2 : +k === 2 ? 1 : k] = p[k];
      save(q); localStorage.setItem(VKEY, "3");
    }
  } catch {}
  const load = read;
  const f = (x, d = 0) => (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d);

  // Landings since a step began (cat lessons).
  const newLandings = (api, mem) => api.landings.slice(mem.from || 0);
  const beginLandings = (api, mem) => { mem.from = api.landings.length; };
  const J1 = (api) => FC.model0.eigenSym(api.st.J).values[0]; // smallest principal moment: about the (near) long axis
  const rolled = (api) => 180 - Math.abs(FC.sim.rollError(api.game.R)) / deg; // a cat dropped upside down: how far it has turned over
  const legsText = (s) => `front legs ${s.front < 0.2 ? "tucked" : s.front > 0.8 ? "spread" : "half"}, back ${s.back < 0.2 ? "tucked" : s.back > 0.8 ? "spread" : "half"}`;

  // Lesson 4: one Model 0 loop per step. A loop counts once the body has been folded and twisted at the same
  // time and is back at the start shape; its turn is the rotation since the step began (body frame), and it
  // must go the same way as the first loop (twisting before folding runs the loop backwards and undoes a turn).
  const turnSince = (api, R0) => FC.m3.log(FC.m3.mul(FC.m3.T(R0), api.game.R)); // body-frame rotation vector
  function loopStep(k) {
    return {
      text: `Loop ${k}: fold, twist, unfold, untwist.`,
      begin(api, mem) { mem.R0 = api.game.R.slice(); mem.corner = false; mem.warn = ""; },
      status(api, mem) {
        const s = api.s, total = `${f(FC.m3.v.norm(api.net()) / deg)}° so far`;
        if (mem.warn) return `${mem.warn} · ${total}`;
        const next = !mem.corner ? (Math.abs(s.alpha) < 60 * deg ? "fold the leg (α to ±90°)" : "twist (ψ to ±180°)")
          : Math.abs(s.alpha) > 2 * deg ? "unfold the leg (α to 0)" : "untwist (ψ to 0)";
        return `Now: ${next} · ${total}`;
      },
      check(api, mem) {
        const s = api.s;
        if (Math.abs(s.alpha) >= 60 * deg && Math.abs(s.psi) >= 60 * deg) { mem.corner = true; mem.warn = ""; }
        if (!mem.corner || Math.abs(s.psi) > 2 * deg || Math.abs(s.alpha) > 2 * deg) return false;
        mem.corner = false;
        const r = turnSince(api, mem.R0), turn = FC.m3.v.norm(r) / deg;
        if (mem.axis && FC.m3.v.dot(r, mem.axis) < 0) { mem.warn = "That loop ran backwards (twist came first) and undid a turn"; mem.R0 = api.game.R.slice(); return false; }
        if (turn < 5) { mem.warn = `That loop turned only ${f(turn)}°: fold before you twist`; mem.R0 = api.game.R.slice(); return false; }
        mem.axis = mem.axis || r;
        (mem.loops = mem.loops || []).push(turn);
        mem.total = FC.m3.v.norm(api.net()) / deg;
        return true;
      },
    };
  }

  // ---------- small on-scene visuals (HTML) ----------
  const viz = {
    meter: (label, frac, note) => `<div class="lv-label">${label}</div>
      <div class="lv-meter"><div style="width:${Math.max(2, Math.min(100, 100 * frac))}%"></div></div><div class="lv-note">${note}</div>`,
    // two signed bars from a centre line, and their sum
    balance: (a, b, scale, labels) => {
      const w = (x) => `${Math.min(50, (50 * Math.abs(x)) / scale)}%`, side = (x) => (x >= 0 ? "left:50%" : "right:50%");
      return `<div class="lv-label">Angular momentum along the body</div>
        <div class="lv-bal"><i style="${side(a)};width:${w(a)};background:#e8833a"></i><span>${labels[0]}</span></div>
        <div class="lv-bal"><i style="${side(b)};width:${w(b)};background:#2a78d6"></i><span>${labels[1]}</span></div>
        <div class="lv-note">Front + back = <b>${f(a + b, 1) === "-0.0" ? "0.0" : f(a + b, 1)}</b> (always zero)</div>`;
    },
    // a dial with a needle at `angle` degrees and a filled arc (of `of` degrees, if given)
    dial: (angle, label, of) => {
      const a = Math.max(-360, Math.min(360, angle)), r = 30, c = 36, rad = (x) => ((x - 90) * Math.PI) / 180;
      const pt = (x, rr = r) => `${c + rr * Math.cos(rad(x))},${c + rr * Math.sin(rad(x))}`;
      const arcEnd = of ? Math.max(0, Math.min(1, a / of)) * 359.9 : Math.abs(a);
      const large = arcEnd > 180 ? 1 : 0;
      return `<div class="lv-dial"><svg viewBox="0 0 72 72" width="72" height="72">
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="6"/>
        ${arcEnd > 0.5 ? `<path d="M ${pt(0)} A ${r} ${r} 0 ${large} 1 ${pt(arcEnd)}" fill="none" stroke="#ffd36b" stroke-width="6" stroke-linecap="round"/>` : ""}
        <line x1="${c}" y1="${c}" x2="${pt(of ? arcEnd : a, r - 8).split(",")[0]}" y2="${pt(of ? arcEnd : a, r - 8).split(",")[1]}" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        </svg><div><div class="lv-big">${f(angle)}°</div><div class="lv-label">${label}</div></div></div>`;
    },
    bars: (items) => {
      const max = Math.max(1, ...items.map((x) => x.value));
      return `<div class="lv-label">Hit on landing (× body weight)</div><div class="lv-bars">${items.map((x) =>
        `<div><b>${f(x.value)}×</b><i style="height:${Math.max(4, (64 * x.value) / max)}px;background:${x.color}"></i><span>${x.label}</span></div>`).join("")}</div>`;
    },
    badges: (rows) => `<div class="lv-label">Ready to land?</div><table class="lv-badges"><tr><th></th><th>feet</th><th>spine</th><th>legs</th></tr>${rows.map((r) =>
      `<tr><td>${r.label}</td>${r.ok.map((ok) => `<td class="${ok ? "y" : "n"}">${ok ? "✓" : "✗"}</td>`).join("")}</tr>`).join("")}</table>`,
  };

  const LESSONS = [
    // ---------------------------------------------------------------- Model 0
    {
      id: 2, title: "Inertia", tagline: "Fold the leg: the body gets easier to spin.",
      controls: ["alpha"], // body controls this lesson needs
      goal: "Make the body easier to spin about its long axis.", math: "inertia",
      setup(api, mem) { api.useModel0(0.3); mem.J0 = J1(api); mem.d0 = Math.hypot(api.st.conf.bodies[2].p[1], api.st.conf.bodies[2].p[2]); },
      steps: [
        { text: "Fold the leg forward: leg angle <var>α</var> to 80° or more.", status: (api) => `α = ${f(api.s.alpha / deg)}°`,
          check(api, mem) {
            if (api.s.alpha < 80 * deg || Math.abs(api.s.beta) > deg) return false;
            mem.J1 = J1(api); mem.d1 = Math.hypot(api.st.conf.bodies[2].p[1], api.st.conf.bodies[2].p[2]); return true;
          } },
      ],
      // a dashed line: the leg's distance from the long axis
      frame(api) {
        const p = api.st.conf.bodies[2].p;
        api.fx.line(api.toWorld(p), api.toWorld([p[0], 0, 0]));
      },
      viz(api, mem) {
        const j = J1(api), p = api.st.conf.bodies[2].p;
        return viz.meter("How hard to spin about the long axis", j / mem.J0,
          `${f(100 * (j / mem.J0 - 1))}% · leg ${f(100 * Math.hypot(p[1], p[2]))} cm from the axis (dashed line)`);
      },
      takeaway: (api, mem) => `Folding the leg moved its mass from ${f(100 * mem.d0)} cm to ${f(100 * mem.d1)} cm from the axis, and the body became
        <b>${f(100 * (1 - mem.J1 / mem.J0))}% easier</b> to spin about it. Mass close to an axis barely counts, so a cat can change how easily each half
        spins just by tucking its legs.`,
    },
    {
      id: 1, title: "Zero angular momentum", tagline: "Twist one half: the other turns back.",
      controls: ["psi"], // body controls this lesson needs
      goal: "Twist the front half and watch what the back half does.", math: "momentum",
      // The leg has its real mass (0.3 kg), as drawn: the front half (cylinder + leg) is harder to turn than the back.
      setup(api) { api.useModel0(0.3); api.fx.ghost(true); api.fx.arrows(true); },
      steps: [
        { text: "Twist: <var>ψ</var> to +90° or more.", status: (api) => `ψ = ${f(api.s.psi / deg)}°`,
          check(api, mem) { if (api.s.psi < 89.5 * deg || Math.abs(api.s.beta) > deg) return false; mem.psi = api.s.psi; mem.net = api.net()[0]; return true; } },
        { text: "Untwist: <var>ψ</var> back to 0.", status: (api) => `ψ = ${f(api.s.psi / deg)}°`,
          check(api, mem) { if (Math.abs(api.s.psi) > 0.5 * deg) return false; mem.back = FC.m3.v.norm(api.net()); return true; } },
      ],
      // Angular momentum along the body: the front half is the front cylinder plus the leg hinged to it (bodies 0 and 2).
      viz(api, mem) {
        const b = api.st.bodies, a = (b[0].L[0] + b[2].L[0]) * 1e3, c = b[1].L[0] * 1e3;
        mem.scale = Math.max((mem.scale || 0.5) * 0.995, Math.abs(a), Math.abs(c));
        return viz.balance(a, c, mem.scale, ["front + leg", "back"]) + `<div class="lv-note">Back half turned <b>${f(api.net()[0] / deg)}°</b> from the ghost</div>`;
      },
      // The halves turn opposite ways about the shared axis; together they make up the twist ψ.
      takeaway: (api, mem) => {
        const back = Math.abs(mem.net / deg), front = mem.psi / deg - back;
        return `You twisted the halves ${f(mem.psi / deg)}° apart. The back half turned <b>${f(back)}°</b> one way, but the front half,
          which carries the leg, only <b>${f(front)}°</b> the other way: more mass away from the axis makes it harder to turn. Their angular momenta
          were still equal and opposite, so the total stayed exactly zero. Untwisting undid it, and the body ended up right back on its ghost.`;
      },
    },
    {
      id: 3, title: "A loop makes a turn", tagline: "Same moves in a loop: the whole body turns.",
      controls: ["alpha", "psi"], // body controls this lesson needs
      goal: "Get back to the starting shape, but turned.", math: "geometry",
      setup(api) { api.useModel0(0.3); api.fx.ghost(true); },
      steps: [
        { text: "Fold the leg: <var>α</var> ≥ 80°.", status: (api) => `α = ${f(api.s.alpha / deg)}°`, check: (api) => api.s.alpha >= 80 * deg },
        { text: "Twist: <var>ψ</var> ≥ 110°.", status: (api) => `ψ = ${f(api.s.psi / deg)}°`, check: (api) => api.s.psi >= 110 * deg },
        { text: "Unfold the leg: <var>α</var> back to 0.", status: (api) => `α = ${f(api.s.alpha / deg)}°`, check: (api) => Math.abs(api.s.alpha) <= 1 * deg },
        { text: "Untwist: <var>ψ</var> back to 0.", status: (api) => `ψ = ${f(api.s.psi / deg)}°`,
          check(api, mem) {
            const s = api.s;
            if (Math.abs(s.psi) > 0.5 * deg || Math.abs(s.alpha) > 0.5 * deg || Math.abs(s.beta) > 0.5 * deg) return false;
            mem.turn = FC.m3.v.norm(api.net()) / deg; return true;
          } },
      ],
      viz: (api) => viz.dial(FC.m3.v.norm(api.net()) / deg, "turned from the ghost"),
      takeaway: (api, mem) => `Your body is back in its starting shape, yet it has turned <b>${f(mem.turn)}°</b> from the ghost. Twisting with the leg folded and
        untwisting with it down don't cancel, and that mismatch is the turn: rotating with nothing to push against.`,
    },
    {
      id: 4, title: "Turns add up", tagline: "Repeat the loop: each one adds the same turn.",
      controls: ["alpha", "psi"], // body controls this lesson needs
      goal: "Do the loop three times. Bigger loops (fold 90°, twist 180°) turn more.", math: "geometry",
      setup(api) { api.useModel0(0.3); api.fx.ghost(true); },
      steps: [1, 2, 3].map(loopStep),
      viz(api, mem) {
        const loops = mem.loops || [];
        return viz.dial(FC.m3.v.norm(api.net()) / deg, "turned from the ghost") +
          `<div class="lv-note">${loops.length ? loops.map((t, i) => `Loop ${i + 1}: <b>${f(t)}°</b>`).join(" · ") : "Each loop's turn shows here."}</div>`;
      },
      takeaway: (api, mem) => `Your loops turned ${mem.loops.map((t) => `${f(t)}°`).join(", ")}: together <b>${f(mem.total)}°</b> from the ghost` +
        (Math.abs(mem.loops.reduce((a, b) => a + b, 0) - mem.total) > 10 ? " (a loop run backwards undid part of it)." : ".") +
        ` The same loop always gives the same small turn (a full-size one about 39° for this body), so repeating it adds up. That is how a cat gets all the way over.`,
    },
    {
      id: 5, title: "Same trick on a cat", tagline: "Tucked legs do the leg's job. No gravity yet.",
      controls: ["twist", "front", "back"], // body controls this lesson needs
      goal: "Turn model A from upside down to feet-down, floating with no clock.", math: "tuck-turn",
      setup(api, mem) {
        api.start({ model: "A", mode: "float", inputs: { start: "upside", speed: 0.15, "coach-on": true } });
        mem.r0 = rolled(api);
      },
      steps: [
        { text: "Tuck the front legs <kbd>Z</kbd>, keep the back legs spread <kbd>V</kbd>.", short: "Tuck the front legs, back legs spread.",
          status: (api) => legsText(api.game.shape), check: (api) => api.game.shape.front < 0.2 && api.game.shape.back > 0.8 },
        { text: "Twist all the way <kbd>E</kbd> or <kbd>Q</kbd>.", short: "Twist all the way.",
          status: (api) => `twist ${f(api.game.shape.twist / deg)}°`,
          check: (api) => Math.abs(api.game.shape.twist) >= 150 * deg && api.game.shape.front < 0.2 },
        { text: "Swap legs: spread the front <kbd>X</kbd>, tuck the back <kbd>C</kbd>.", short: "Swap legs: front out, back tucked.",
          status: (api) => legsText(api.game.shape), check: (api) => api.game.shape.front > 0.8 && api.game.shape.back < 0.2 },
        { text: "Untwist back to 0.", short: "Untwist back to 0.", status: (api) => `twist ${f(api.game.shape.twist / deg)}°`,
          check(api, mem) { if (Math.abs(api.game.shape.twist) > 5 * deg) return false; mem.cycle = rolled(api) - mem.r0; return true; } },
        { text: "Repeat, following the coach, until your feet point down.", short: "Repeat until your feet point down.",
          status: (api) => `${f(180 - rolled(api))}° to go`,
          check: (api) => rolled(api) >= 160 && Math.abs(api.game.shape.twist) < 10 * deg },
      ],
      // the half with tucked legs (the light one) glows
      frame(api) { const s = api.game.shape; api.fx.glow(Math.abs(s.front - s.back) > 0.4 ? (s.front < s.back ? 0 : 1) : null); },
      viz: (api) => viz.dial(rolled(api), "turned over (of 180°)", 180),
      takeaway: (api, mem) => `One tuck, twist, swap, untwist cycle turned the cat <b>${f(mem.cycle)}°</b>. It's Model 0's loop: the tucked legs play the folded leg,
        making that half light so it turns further. Repeating it got you upright. Next, the same moves while falling, against the clock.`,
    },
    // ---------------------------------------------------------------- the cats, falling
    {
      id: 6, title: "Now with gravity (model A)", tagline: "Same moves, falling, against the clock.",
      controls: ["twist", "front", "back"], // body controls this lesson needs
      goal: "Turn model A over while falling, using only twist and legs.", math: "tuck-turn",
      setup(api) { api.start({ model: "A", mode: "free", inputs: { start: "upside", height: 21, speed: 0.15, "air-on": true, "coach-on": true } }); },
      steps: [
        { short: "Drop, then follow the coach. Land on your feet.",
          text: "Drop, then follow the coach: tuck, twist, swap legs, untwist. Land on your feet.", begin: beginLandings,
          check(api, mem) { const ok = newLandings(api, mem).find((x) => x.model === "A" && !x.demo && x.worst < 45); if (ok) mem.l = ok; return !!ok; } },
      ],
      // the half with tucked legs (the light one) glows
      frame(api) { const s = api.game.shape; api.fx.glow(Math.abs(s.front - s.back) > 0.4 ? (s.front < s.back ? 0 : 1) : null); },
      viz: (api) => viz.dial(api.game.phase === "ready" ? 0 : rolled(api), "turned over (of 180°)", 180),
      takeaway: () => `The glowing half had its legs tucked: it's the light half, so it turned further on each twist. Each cycle only nets about
        <b>64°</b>, so model A needs about three cycles and a long fall (about 12 m from upside down).`,
    },
    {
      id: 7, title: "Bend and twist (model B)", tagline: "Sweep the bend around: the body rolls.",
      controls: ["bend", "dir", "front", "back"], // body controls this lesson needs
      goal: "Turn model B over by bending and sweeping.", math: "bend-twist",
      setup(api) { api.start({ model: "B", mode: "free", inputs: { start: "upside", height: 3, speed: 0.15, "air-on": true, "coach-on": true } }); api.fx.ring(true); },
      steps: [
        { short: "Drop, bend, and sweep the bend around the ring. Land on your feet.",
          text: "Drop, bend the spine, and sweep the bend around (the dot on the ring shows where it bends). Land on your feet.", begin: beginLandings,
          check(api, mem) { const ok = newLandings(api, mem).find((x) => x.model === "B" && !x.demo && x.worst < 45); if (ok) mem.l = ok; return !!ok; } },
      ],
      viz: (api) => viz.dial(api.game.phase === "ready" ? 0 : rolled(api), "turned over (of 180°)", 180),
      takeaway: () => `As the dot swept around the ring, the whole body rolled the other way. About one lap turns a cat over, so cats that can bend
        land from drops <b>about 20× lower</b> than model A.`,
    },
    {
      id: 8, title: "Landing", tagline: "Same drop, two cats: soft vs hard.",
      controls: [], // body controls this lesson needs
      goal: "Compare landing on folding knees with landing on rigid legs.", math: "landing",
      setup(api) { api.start({ model: "C", mode: "watch", inputs: { gravity: "earth", roll: 180, pitch: 0, delay: 60, strategy: "reflex", height: 3, speed: 0.3, "air-on": true } }); },
      steps: [
        { short: "Tap Drop: model C (knees) from 3 m.", text: "Drop model C (folding knees) from 3 m.", begin: beginLandings,
          check(api, mem) { const l = newLandings(api, mem).find((x) => x.model === "C" && x.mode === "watch" && Math.abs(x.height - 3) < 0.01); if (l) mem.c = l; return !!l; } },
        { short: "Switch Model to B (rigid legs), drop again.", text: "Switch the Model to <b>B</b> (rigid legs) in the panel and drop again.", begin: beginLandings,
          check(api, mem) { const l = newLandings(api, mem).find((x) => x.model === "B" && x.mode === "watch" && Math.abs(x.height - 3) < 0.01); if (l) mem.b = l; return !!l; } },
      ],
      viz(api, mem) {
        const items = [];
        if (mem.c) items.push({ label: "C: knees", value: mem.c.impact, color: "#1baf7a" });
        if (mem.b) items.push({ label: "B: rigid", value: mem.b.impact, color: "#ef5d5d" });
        return items.length ? viz.bars(items) : `<div class="lv-label">Hit on landing</div><div class="lv-note">Drop to see it.</div>`;
      },
      takeaway: (api, mem) => `Both cats hit the ground at the same speed, but folding knees stopped the body over ${f(100 * mem.c.d)} cm instead of
        ${f(100 * mem.b.d)} cm, so the hit was <b>${f(mem.b.impact / mem.c.impact)}× gentler</b> (${f(mem.c.impact)}× vs ${f(mem.b.impact)}× body weight).`,
    },
    {
      id: 9, title: "The flexible spine (model D)", tagline: "Front half first: ready in time.",
      controls: [], // body controls this lesson needs
      goal: "Land perfectly from just 0.5 m.", math: "moves",
      setup(api) { api.start({ model: "D", mode: "watch", inputs: { gravity: "earth", roll: 180, pitch: 0, delay: 0, strategy: "reflex", height: 0.5, speed: 0.3, "air-on": true } }); },
      steps: [
        { short: "Tap Drop with the Reflex strategy.", text: "Drop with the <b>Reflex</b> strategy.", begin: beginLandings,
          check(api, mem) { const l = newLandings(api, mem).find((x) => x.model === "D" && !x.optimized && Math.abs(x.height - 0.5) < 0.01); if (l) mem.r = l; return !!l; } },
        { short: "Set Cat's strategy to Optimized, drop again.", text: "Set <b>Cat's strategy</b> to <b>Optimized</b> in the panel and drop again.", begin: beginLandings,
          check(api, mem) { const l = newLandings(api, mem).find((x) => x.model === "D" && x.optimized && Math.abs(x.height - 0.5) < 0.01); if (l) mem.o = l; return !!l; } },
      ],
      viz(api, mem) {
        const ok = (x) => [x.worst < 20, x.bend < 25, x.legs > 0.7], rows = [];
        if (mem.r) rows.push({ label: "Reflex", ok: ok(mem.r) });
        if (mem.o) rows.push({ label: "Optimized", ok: ok(mem.o) });
        return rows.length ? viz.badges(rows) : `<div class="lv-label">Ready to land?</div><div class="lv-note">Feet down, spine straight, legs out. Drop to see.</div>`;
      },
      takeaway: (api, mem) => {
        const r = mem.r, o = mem.o, oOk = o.worst < 20 && o.bend < 25 && o.legs > 0.7;
        // describe what this run's reflex actually did
        const reflex = r.worst < 20 ? "The reflex got its feet down, but its spine was still bent at touchdown"
          : r.bend > 25 ? "The reflex ran out of time: still turning, spine bent, at touchdown" : "The reflex landed with its feet off";
        return `${reflex}. The optimized move turns the light front half first, so ${oOk ? "everything was ready in time" : "it got closer to ready"}.
          It's a fixed routine, though: from higher up, the adaptable reflex wins.`;
      },
    },
  ].sort((a, b) => a.id - b.id); // listed and played in id order

  // ---------------------------------------------------------------- the lesson card (on the game screen)
  // mount(api, container, id, on, vizEl): runs lesson `id`, draws its card into `container` (over the scene)
  // and its live visual into `vizEl`. on: { next(id), home(), exit() } for the buttons.
  // Returns { lesson, tick() (call every frame), destroy() }.
  function mount(api, container, id, on = {}, vizEl = null) {
    const L = LESSONS.find((x) => x.id === id);
    if (!L || !container) return null;
    const mem = {};
    let step = 0, finished = false, lastHtml = "", lastViz = "", alive = true;
    container.hidden = false;
    container.classList.add("lesson-card");
    container.classList.toggle("folded", matchMedia("(max-width: 760px)").matches); // phones: one line, tap to open
    api.fx.clear();
    L.setup && L.setup(api, mem);
    if (api.allowControls) api.allowControls(L.controls ?? null); // only the body controls this lesson needs
    L.steps[0].begin && L.steps[0].begin(api, mem);
    if (vizEl) vizEl.hidden = !L.viz;
    const next = LESSONS.find((x) => x.id === L.id + 1);
    const plain = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.textContent.replace(/\s+/g, " ").trim(); };
    function render() {
      const cur = L.steps[Math.min(step, L.steps.length - 1)];
      const items = L.steps.map((s, i) => {
        const cls = i < step || finished ? "done" : i === step ? "now" : "";
        const st = i === step && !finished && s.status ? `<span class="st">${s.status(api, mem)}</span>` : "";
        return `<li class="${cls}">${s.text}${st}</li>`;
      }).join("");
      const fold = finished ? "Done ✓ Tap to see why it worked" : `${cur.short || plain(cur.text)}${cur.status ? ` · <i>${cur.status(api, mem)}</i>` : ""}`;
      const html =
        `<div class="lc-head" data-act="fold"><span class="lk">Lesson ${L.id} of ${LESSONS.length}</span><b class="lc-title">${L.title}</b>` +
        `<span class="lc-fold">${fold}</span><span class="lc-caret" aria-hidden="true"></span></div>` +
        `<div class="lc-body"><p class="lc-goal">${L.goal}</p>` +
        (finished ? `<div class="done-box"><p class="ok">✓ Done</p><p>${mem.takeaway}</p>
            <a class="lc-math" href="physics.html#${L.math}" target="_blank" rel="noopener">See the math →</a></div>` : `<ol>${items}</ol>`) +
        `<div class="nav">${finished && next ? `<button class="primary" data-act="next">Next: ${next.title} →</button>` : ""}` +
        `${finished && !next ? `<button class="primary" data-act="home">Course complete ✓</button>` : ""}` +
        `<button data-act="home">All lessons</button><button data-act="exit">Exit</button></div></div>`;
      if (html !== lastHtml) { container.innerHTML = html; lastHtml = html; }
      if (vizEl && L.viz) { const v = L.viz(api, mem); if (v !== lastViz) { vizEl.innerHTML = v; lastViz = v; } }
    }
    const onClick = (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const act = b.dataset.act;
      if (act === "fold") container.classList.toggle("folded");
      else if (act === "next" && on.next) on.next(next.id);
      else if (act === "home" && on.home) on.home();
      else if (act === "exit" && on.exit) on.exit();
    };
    container.addEventListener("click", onClick);
    render();
    let tickN = 0;
    return {
      lesson: L,
      tick() {
        if (!alive) return;
        if (L.frame) L.frame(api, mem); // scene effects follow the body every frame
        if (++tickN % 4) return; // checks and text at ~15 Hz
        if (!finished && L.steps[step].check(api, mem)) {
          // a short buzz on phones that allow it (setting: fallingcat.vibrate)
          try {
            if (navigator.vibrate && JSON.parse(localStorage.getItem("fallingcat.vibrate") ?? "true") &&
                (!navigator.userActivation || navigator.userActivation.hasBeenActive)) // only after the user has tapped
              navigator.vibrate(step + 1 >= L.steps.length ? [40, 60, 40] : 30);
          } catch {}
          step++;
          if (step >= L.steps.length) {
            finished = true;
            mem.takeaway = L.takeaway(api, mem);
            const p = load(); p[L.id] = true; save(p);
            container.classList.remove("folded"); // open the card to show the takeaway
          } else L.steps[step].begin && L.steps[step].begin(api, mem);
        }
        render();
      },
      destroy() {
        alive = false;
        container.removeEventListener("click", onClick);
        container.innerHTML = "";
        container.hidden = true;
        if (vizEl) { vizEl.innerHTML = ""; vizEl.hidden = true; }
        api.fx.clear();
        if (api.allowControls) api.allowControls(null); // every control back outside the lessons
      },
    };
  }

  return { LESSONS, mount, progress: load, reset: () => save({}) };
})();
