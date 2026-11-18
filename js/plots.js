// Live plots on the game screen: orientation, angular velocity and angular
// momentum against time, for any model (Model 0 and the cats).
//
//   Orientation      roll φ and pitch θ of the body frame, degrees from upright
//                    (roll: about the long axis; for a cat dropped upside down it
//                    runs 180° → 0°), unwrapped so it never jumps by 360°.
//   Angular velocity Ω⃗ of the body frame, its components in the body frame
//                    (x along the body, y to its left, z along its back), rad/s.
//   Angular momentum each part's L⃗ᵢ·x̂ (component along the long axis, about the
//                    system's centre of mass), and the total, which stays at 0.
//
// Samples are pushed by the game each frame; the plots show the last WINDOW
// seconds of simulated time and rescale themselves.
var FC = (globalThis.FC = globalThis.FC || {});

FC.Plots = class {
  constructor(container) {
    this.el = container;
    this.WINDOW = 4; // simulated seconds shown
    this.samples = [];
    const block = (key, title, unit) => `<div class="pl-block" data-k="${key}"><div class="pl-head"><span class="pl-title">${title}</span>
      <span class="pl-unit">${unit}</span></div><div class="pl-legend"></div><canvas></canvas></div>`;
    container.innerHTML =
      block("ang", "Orientation", "deg from upright") +
      block("om", `Angular velocity <span class="vc">Ω</span>`, "rad/s, body frame") +
      block("L", `Angular momentum <span class="vc">L</span><sub><var>i</var></sub>·<span class="uv">x̂</span>`, "10⁻³ kg·m²/s");
    this.cv = {};
    container.querySelectorAll(".pl-block").forEach((b) => (this.cv[b.dataset.k] = { canvas: b.querySelector("canvas"), legend: b.querySelector(".pl-legend") }));
    this.legendKey = {};
  }

  reset() { this.samples = []; this.prevRoll = null; this.rollOffset = 0; }

  // s: { t, roll, pitch (rad), omega [x, y, z] (rad/s), parts: [{ name, color, Lx }], Ltot (kg·m²/s) }
  push(s) {
    // unwrap the roll so a turn through ±180° stays continuous
    if (this.prevRoll !== null) {
      const d = s.roll - this.prevRoll;
      if (d > Math.PI) this.rollOffset -= 2 * Math.PI; else if (d < -Math.PI) this.rollOffset += 2 * Math.PI;
    }
    this.prevRoll = s.roll;
    const last = this.samples[this.samples.length - 1];
    if (last && s.t <= last.t) return; // time didn't advance (paused)
    this.samples.push({ ...s, roll: s.roll + this.rollOffset });
    const t0 = s.t - this.WINDOW;
    while (this.samples.length > 2 && this.samples[1].t < t0) this.samples.shift();
  }

  draw() {
    if (this.el.hidden || !this.samples.length) { if (!this.samples.length) for (const k in this.cv) this.clear(k); return; }
    const S = this.samples, deg = 180 / Math.PI;
    // Shift the unwrapped roll by whole turns so the newest value reads between -180° and 180°.
    const turn = 2 * Math.PI * Math.round(S[S.length - 1].roll / (2 * Math.PI));
    const tEnd = S[S.length - 1].t, tStart = Math.max(S[0].t, tEnd - this.WINDOW);
    this.plot("ang", tStart, tEnd, [
      { name: "roll φ", color: "#ffd36b", get: (p) => (p.roll - turn) * deg },
      { name: "pitch θ", color: "#9fd4ff", get: (p) => p.pitch * deg },
    ], 30);
    this.plot("om", tStart, tEnd, [
      { name: "Ωx", color: "#ff7b72", get: (p) => p.omega[0] },
      { name: "Ωy", color: "#7ee787", get: (p) => p.omega[1] },
      { name: "Ωz", color: "#79c0ff", get: (p) => p.omega[2] },
    ], 1);
    const parts = S[S.length - 1].parts;
    this.plot("L", tStart, tEnd, [
      // back parts dashed: in a mirror-symmetric move they lie exactly on their front partners
      ...parts.map((q, i) => ({ name: q.name, color: q.color, dash: /^back/.test(q.name), get: (p) => (p.parts[i] ? p.parts[i].Lx * 1e3 : 0) })),
      { name: "total", color: "#ffffff", width: 2.5, get: (p) => p.Ltot * 1e3 },
    ], 1);
  }

  clear(k) {
    const { canvas } = this.cv[k], g = canvas.getContext("2d");
    g.clearRect(0, 0, canvas.width, canvas.height);
  }

  // One small chart: zero line, symmetric autoscale (at least ±minSpan), time axis = the window.
  plot(k, t0, t1, series, minSpan) {
    const { canvas, legend } = this.cv[k];
    const dpr = Math.min(2, devicePixelRatio || 1), W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const S = this.samples.filter((p) => p.t >= t0);
    let lo = Infinity, hi = -Infinity;
    for (const p of S) for (const s of series) { const y = s.get(p); if (y < lo) lo = y; if (y > hi) hi = y; }
    const span = Math.max(minSpan, Math.abs(lo), Math.abs(hi)) * 1.12;
    const L = 30, R = 4, T = 4, B = 4, pw = W - L - R, ph = H - T - B;
    const x = (t) => L + ((t - t0) / Math.max(1e-6, t1 - t0)) * pw, y = (v) => T + ph / 2 - (v / span) * (ph / 2);
    // axes: zero line and the scale
    g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, y(0)); g.lineTo(L + pw, y(0)); g.stroke();
    g.fillStyle = "rgba(255,255,255,0.55)"; g.font = "10px system-ui, sans-serif"; g.textAlign = "right"; g.textBaseline = "middle";
    const nice = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));
    g.fillText(nice(span / 1.12), L - 4, y(span / 1.12)); g.fillText("0", L - 4, y(0)); g.fillText(nice(-span / 1.12), L - 4, y(-span / 1.12));
    for (const s of series) {
      g.strokeStyle = s.color; g.lineWidth = s.width || 1.6; g.setLineDash(s.dash ? [5, 4] : []); g.beginPath();
      S.forEach((p, i) => (i ? g.lineTo(x(p.t), y(s.get(p))) : g.moveTo(x(p.t), y(s.get(p)))));
      g.stroke();
    }
    g.setLineDash([]);
    // legend (only rebuilt when the series change)
    const key = series.map((s) => s.name + s.color).join("|");
    if (this.legendKey[k] !== key) {
      this.legendKey[k] = key;
      legend.innerHTML = series.map((s) => `<span><i class="${s.dash ? "dash" : ""}" style="--c:${s.color}"></i>${s.name}</span>`).join("");
    }
  }
};
