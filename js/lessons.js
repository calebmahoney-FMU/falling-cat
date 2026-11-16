// Guided lessons: a short, visual course from Model 0 (two cylinders and a leg) to
// the four cats. Little reading, more seeing: each lesson has a one-line goal, a few
// short steps checked live, a visual on the scene that shows the idea as it happens,
// and a two-sentence takeaway with a link to the math on the physics page.
//
// Everything runs inside the game (index.html). The game passes an `api`:
//   game, start({ model, mode, inputs }), landings (one record per landing: model, mode,
//   height, worst, bend, legs, impact, v, d, demo, optimized, n), set(id, value)
//   Model 0 (lessons 1–3): useModel0(legMass), s (shape), st (FC.physics.state now),
//   net() (rotation vector of the back cylinder since the lesson started, world frame)
//   toWorld(p) (a point in the body frame → world), fx: { ghost(on), line(a, b), glow(i), ring(on) }
// Progress is kept in this browser (localStorage).
var FC = (globalThis.FC = globalThis.FC || {});

FC.lessons = (function () {
  const deg = Math.PI / 180;
  const KEY = "fallingcat.lessons";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} };
  const f = (x, d = 0) => (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d);

  // Landings since a step began (cat lessons).
  const newLandings = (api, mem) => api.landings.slice(mem.from || 0);
  const beginLandings = (api, mem) => { mem.from = api.landings.length; };
  const J1 = (api) => FC.model0.eigenSym(api.st.J).values[0]; // smallest principal moment: about the (near) long axis
  const rolled = (api) => 180 - Math.abs(FC.sim.rollError(api.game.R)) / deg; // a cat dropped upside down: how far it has turned over

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
      id: 1, title: "Inertia", tagline: "Fold the leg: the body gets easier to spin.",
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
      id: 2, title: "Zero angular momentum", tagline: "Twist one half: the other turns back.",
      goal: "Twist the front half and watch what the back half does.", math: "momentum",
      setup(api) { api.useModel0(0); api.fx.ghost(true); api.fx.arrows(true); },
      steps: [
        { text: "Twist: <var>ψ</var> to +90° or more.", status: (api) => `ψ = ${f(api.s.psi / deg)}°`,
          check(api, mem) { if (api.s.psi < 89.5 * deg || Math.abs(api.s.beta) > deg) return false; mem.psi = api.s.psi; mem.net = api.net()[0]; return true; } },
        { text: "Untwist: <var>ψ</var> back to 0.", status: (api) => `ψ = ${f(api.s.psi / deg)}°`,
          check(api, mem) { if (Math.abs(api.s.psi) > 0.5 * deg) return false; mem.back = FC.m3.v.norm(api.net()); return true; } },
      ],
      viz(api, mem) {
        const b = api.st.bodies, a = b[0].L[0] * 1e3, c = b[1].L[0] * 1e3;
        mem.scale = Math.max((mem.scale || 0.5) * 0.995, Math.abs(a), Math.abs(c));
        return viz.balance(a, c, mem.scale, ["front", "back"]) + `<div class="lv-note">Back half turned <b>${f(api.net()[0] / deg)}°</b> from the ghost</div>`;
      },
      takeaway: (api, mem) => `When the front half twisted ${f(mem.psi / deg)}°, the back half turned <b>${f(mem.net / deg)}°</b> the other way: equal and opposite,
        so the total angular momentum stayed exactly zero. Untwisting undid it, and the body ended up right back on its ghost.`,
    },
    {
      id: 3, title: "A loop makes a turn", tagline: "Same moves in a loop: the whole body turns.",
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
    // ---------------------------------------------------------------- the cats
    {
      id: 4, title: "Tuck and turn (model A)", tagline: "The light half turns more.",
      goal: "Turn model A over using only twist and legs.", math: "tuck-turn",
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
      id: 5, title: "Bend and twist (model B)", tagline: "Sweep the bend around: the body rolls.",
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
      id: 6, title: "Landing", tagline: "Same drop, two cats: soft vs hard.",
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
      id: 7, title: "The flexible spine (model D)", tagline: "Front half first: ready in time.",
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
  ];

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
      },
    };
  }

  return { LESSONS, mount, progress: load, reset: () => save({}) };
})();
