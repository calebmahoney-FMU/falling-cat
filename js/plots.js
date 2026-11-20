// Live plots on the game screen, kept simple: three small charts against time, for any
// model (Model 0 and the cats), over the last WINDOW seconds of simulated time.
//
//   Tilt θ            how far the body is from upright, degrees: the angle between the
//                     body's "up" (along its back) and straight up. 180° = upside down,
//                     0° = feet down. A scalar, so one line.
//   Turning speed |Ω⃗| how fast the body is rotating, degrees per second (the magnitude
//                     of its angular velocity vector).
//   Angular momentum  two parts' angular momentum along the body's long axis, L⃗·x̂, and
//                     their total, which stays at zero: the two parts always mirror each
//                     other. The pair is front half vs back half, or body vs legs,
//                     whichever is doing the work (in a mirror-symmetric bend and twist each
//                     half's legs cancel its own spin, so front and back are both ~0).
//
// Samples are pushed by the game each frame:
//   { t, tilt (deg), speed (deg/s), fb: [front, back], bl: [body, legs], total } (kg·m²/s).
var FC = (globalThis.FC = globalThis.FC || {});

FC.Plots = class {
  constructor(container) {
    this.el = container;
    this.WINDOW = 4; // simulated seconds shown
    this.samples = [];
    // One line per chart: a plain title, a small unit, and (for momentum) a legend; the full meaning is the tooltip.
    const block = (key, title, unit, full, legend = "") => `<div class="pl-block" data-k="${key}" title="${full}"><div class="pl-head">
      <span class="pl-title">${title} <span class="pl-unit">${unit}</span></span><div class="pl-legend">${legend}</div></div><canvas></canvas></div>`;
    const tip = " · Point at or tap to show it on the body";
    container.innerHTML =
      block("tilt", `<i class="pl-sw" style="--c:#ffd36b"></i>Tilt`, "°", "How far the body is from upright: 180° = upside down, 0° = feet down" + tip) +
      block("speed", `<i class="pl-sw" style="--c:#79e3ff"></i>Turning speed`, "°/s", "How fast the body is rotating (size of its angular velocity)" + tip) +
      block("L", "Angular momentum", "", "Two parts of the body, along its length: they always cancel, so the total stays 0" + tip);
    this.cv = {};
    container.querySelectorAll(".pl-block").forEach((b) => (this.cv[b.dataset.k] = b.querySelector("canvas")));
    this.legendEl = container.querySelector('[data-k="L"] .pl-legend');
    // Which plot's marker is drawn on the body: the one under the mouse, or the one tapped/clicked
    // (stays until tapped again). None chosen: no markers, the body stays clean.
    this.hover = null; this.pinned = null;
    container.querySelectorAll(".pl-block").forEach((b) => {
      const k = b.dataset.k;
      b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { this.hover = k; this.mark(); } });
      b.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { this.hover = null; this.mark(); } });
      b.addEventListener("click", () => { this.pinned = this.pinned === k ? null : k; this.mark(); });
    });
  }

  // The plot whose marker is shown on the body ("tilt", "speed", "L") or null.
  get active() { return this.hover || this.pinned; }
  mark() { this.el.querySelectorAll(".pl-block").forEach((b) => b.classList.toggle("on", b.dataset.k === this.active)); }

  // Colours shared with the markers drawn on the body (js/render.js setMarkers).
  get C() { return { line: "#ffd36b", speed: "#79e3ff", front: "#f29a3a", back: "#5fb3f0", legs: "#7ee787", total: "#ffffff" }; }

  // The momentum chart's legend: the two parts shown, then the total (rebuilt only when it changes).
  legend(names, cols) {
    const key = [...names, ...cols].join("|");
    if (key === this.legendKey) return;
    this.legendKey = key;
    const item = (c, n) => `<span><i style="--c:${c}"></i>${n}</span>`;
    this.legendEl.innerHTML = item(cols[0], names[0]) + item(cols[1], names[1]) + item(this.C.total, "total");
  }

  reset() { this.samples = []; }

  push(s) {
    const last = this.samples[this.samples.length - 1];
    if (last && s.t <= last.t) return; // time didn't advance (paused)
    this.samples.push(s);
    const t0 = s.t - this.WINDOW;
    while (this.samples.length > 2 && this.samples[1].t < t0) this.samples.shift();
  }

  draw() {
    if (this.el.hidden || !this.samples.length) return;
    const S = this.samples, C = this.C;
    const t1 = S[S.length - 1].t, t0 = Math.max(S[0].t, t1 - this.WINDOW);
    // Tilt: fixed 0–180° so the line's height reads directly (top = upside down, bottom = feet down).
    this.plot("tilt", t0, t1, { lo: 0, hi: 180, ticks: [[180, "180"], [90, "90"], [0, "0"]] },
      [{ color: C.line, get: (p) => p.tilt, width: 2.2 }]);
    // Turning speed: from 0 up to the largest so far.
    const top = Math.max(90, ...S.map((p) => p.speed)) * 1.1;
    this.plot("speed", t0, t1, { lo: 0, hi: top, ticks: [[top / 1.1, (top / 1.1).toFixed(0)], [0, "0"]] },
      [{ color: C.speed, get: (p) => p.speed, width: 2.2 }]);
    // Momentum: the pair that is doing the work (front vs back, or body vs legs), filled so their
    // mirror image is easy to see, and the total. Symmetric about 0.
    const size = (k) => S.reduce((a, p) => a + Math.abs(p[k][0]) + Math.abs(p[k][1]), 0);
    const k = (this.pair = size("bl") > 1.5 * size("fb") ? "bl" : "fb"); // remembered for the markers on the body
    const names = k === "fb" ? ["front", "back"] : ["body", "legs"], cols = k === "fb" ? [C.front, C.back] : [C.front, C.legs];
    this.legend(names, cols);
    const m = Math.max(1e-4, ...S.map((p) => Math.max(Math.abs(p[k][0]), Math.abs(p[k][1])))) * 1.15;
    this.plot("L", t0, t1, { lo: -m, hi: m, ticks: [[0, "0"]] }, [
      { color: cols[0], get: (p) => p[k][0], fill: true },
      { color: cols[1], get: (p) => p[k][1], fill: true },
      { color: C.total, get: (p) => p.total, width: 2 },
    ]);
  }

  // One small chart. range: { lo, hi, ticks: [[value, label], …] }; series: { color, get, width, fill }.
  plot(k, t0, t1, range, series) {
    const canvas = this.cv[k];
    const dpr = Math.min(2, devicePixelRatio || 1), W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const S = this.samples.filter((p) => p.t >= t0);
    const L = 26, R = 4, T = 5, B = 4, pw = W - L - R, ph = H - T - B;
    const x = (t) => L + ((t - t0) / Math.max(1e-6, t1 - t0)) * pw;
    const y = (v) => T + ph * (1 - (Math.max(range.lo, Math.min(range.hi, v)) - range.lo) / (range.hi - range.lo));
    g.font = "9.5px system-ui, sans-serif"; g.textAlign = "right"; g.textBaseline = "middle";
    for (const [v, label] of range.ticks) {
      g.strokeStyle = v === 0 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.1)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(L, y(v)); g.lineTo(L + pw, y(v)); g.stroke();
      g.fillStyle = "rgba(255,255,255,0.55)"; g.fillText(label, L - 4, y(v));
    }
    if (S.length < 2) return;
    const y0 = y(Math.max(range.lo, Math.min(range.hi, 0)));
    for (const s of series) {
      if (s.fill) { // shaded area between the line and zero
        g.fillStyle = s.color + "55"; g.beginPath(); g.moveTo(x(S[0].t), y0);
        for (const p of S) g.lineTo(x(p.t), y(s.get(p)));
        g.lineTo(x(S[S.length - 1].t), y0); g.closePath(); g.fill();
      }
      g.strokeStyle = s.color; g.lineWidth = s.width || 1.5; g.beginPath();
      S.forEach((p, i) => (i ? g.lineTo(x(p.t), y(s.get(p))) : g.moveTo(x(p.t), y(s.get(p)))));
      g.stroke();
    }
  }
};
