// On-screen thumb controls for phones and tablets (no keyboard).
//
// Writes the same target shape as the panel sliders and keys (FC.Controls.targets):
//   bend pad  - drag from the centre: distance = how much the spine bends,
//               direction = which way (down = toward the belly, left = cat's left,
//               as seen from behind, like the panel's dial). Circling your thumb
//               sweeps the bend direction (bend and twist). Let go to straighten.
//   twist     - slider; stays where you leave it, double-tap to centre.
//   legs      - Front / Back buttons toggle tucked <-> spread; Knees toggles bent <-> straight.
//   Straighten- everything back to neutral.
// A flexible spine (model D) gets a combined bend and twist, shared between its
// two joints the same way as the reflex (model.split). Model A has no bend pad.
var FC = (globalThis.FC = globalThis.FC || {});

FC.TouchPad = class {
  constructor(container, controls) {
    this.el = container;
    this.controls = controls;
  }

  build(model) {
    this.model = model;
    const has = (k) => model.controls.some((c) => c.key === k);
    const range = (re) => model.controls.filter((c) => re.test(c.key)).reduce((a, c) => a + c.max, 0);
    this.bendMax = range(/^bend/); // combined bend (both joints for a flexible spine)
    this.twistMax = range(/^twist/);
    this.hasBend = model.bendable !== false && this.bendMax > 0;
    this.hasKnees = has("knees");
    this.el.classList.toggle("no-bend", !this.hasBend);
    this.el.innerHTML = `
      ${this.hasBend ? `<div class="tp-pad"><canvas width="320" height="320" aria-label="Bend pad: drag to bend the spine, circle to sweep"></canvas>
        <div class="tp-cap">Bend · circle to sweep</div></div>` : ""}
      <div class="tp-right">
        <div class="tp-twist"><div class="tp-cap"><span>Twist</span><b class="tp-twist-val">0°</b></div>
          <div class="tp-track"><div class="tp-mid"></div><div class="tp-fill"></div><div class="tp-knob"></div></div></div>
        <div class="tp-btns">
          <button class="tp-btn" data-leg="front"><small>Front legs</small><b>spread</b></button>
          <button class="tp-btn" data-leg="back"><small>Back legs</small><b>spread</b></button>
          ${this.hasKnees ? `<button class="tp-btn" data-knees><small>Knees</small><b>bent</b></button>` : ""}
          <button class="tp-btn tp-neutral"><small>Straighten</small><b>all</b></button>
        </div>
      </div>`;
    if (this.hasBend) this.bindPad(this.el.querySelector(".tp-pad canvas"));
    this.bindTwist(this.el.querySelector(".tp-track"));
    this.el.querySelectorAll("[data-leg]").forEach((b) => b.addEventListener("click", () => {
      if (!this.controls.enabled) return;
      const k = b.dataset.leg, t = this.controls.targets;
      t[k] = t[k] > 0.5 ? 0 : 1; // tuck <-> spread
    }));
    const kn = this.el.querySelector("[data-knees]");
    if (kn) kn.addEventListener("click", () => {
      if (!this.controls.enabled) return;
      const t = this.controls.targets;
      t.knees = t.knees > 0.5 ? 0.05 : 0.95; // bent <-> straight
    });
    this.el.querySelector(".tp-neutral").addEventListener("click", () => { if (this.controls.enabled) this.controls.reset(); });
  }

  // Set a combined spine value (bend or twist), split between the joints for a flexible spine.
  setSpine(key, value) {
    const t = this.controls.targets;
    if (!this.model.flexible) { t[key] = value; return; }
    Object.assign(t, this.model.split({ [key]: value }));
  }
  getSpine(key, s = this.controls.targets) { return this.model.combine(s)[key]; }

  bindPad(canvas) {
    this.pad = canvas;
    let active = null;
    const at = (e) => {
      const r = canvas.getBoundingClientRect();
      const R = r.width * 0.42;
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      return { frac: Math.min(1, Math.hypot(dx, dy) / R), angle: Math.atan2(-dx, dy) }; // 0 = belly (down), +90° = cat's left
    };
    const set = (e) => {
      if (!this.controls.enabled) return;
      const { frac, angle } = at(e), t = this.controls.targets;
      // Small dead zone in the middle: no bend, and the direction isn't jerked around.
      if (frac > 0.18) {
        let d = (angle - t.dir) % (2 * Math.PI);
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        t.dir += d; // unwrapped, so laps accumulate like the panel dial
      }
      this.setSpine("bend", Math.max(0, (frac - 0.18) / 0.82) * this.bendMax);
    };
    canvas.addEventListener("pointerdown", (e) => { active = e.pointerId; try { canvas.setPointerCapture(e.pointerId); } catch {} set(e); e.preventDefault(); });
    canvas.addEventListener("pointermove", (e) => { if (e.pointerId === active) set(e); });
    const release = (e) => {
      if (e.pointerId !== active) return;
      active = null;
      if (this.controls.enabled) this.setSpine("bend", 0); // let go = straighten
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
  }

  bindTwist(track) {
    this.track = track;
    let active = null, lastTap = 0;
    const set = (e) => {
      if (!this.controls.enabled) return;
      const r = track.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      this.setSpine("twist", (Math.abs(x) < 0.08 ? 0 : x) * this.twistMax); // snap to straight near the middle
    };
    track.addEventListener("pointerdown", (e) => {
      active = e.pointerId; try { track.setPointerCapture(e.pointerId); } catch {} e.preventDefault();
      const now = performance.now();
      if (now - lastTap < 300 && this.controls.enabled) { this.setSpine("twist", 0); active = null; } // double-tap: centre
      else set(e);
      lastTap = now;
    });
    track.addEventListener("pointermove", (e) => { if (e.pointerId === active) set(e); });
    track.addEventListener("pointerup", () => (active = null));
    track.addEventListener("pointercancel", () => (active = null));
  }

  // Each frame: show targets and the actual shape.
  show(shape) {
    if (!this.model || this.el.offsetParent === null) return; // hidden
    const t = this.controls.targets, deg = Math.PI / 180;
    this.el.classList.toggle("disabled", !this.controls.enabled);
    // Twist slider: knob at the target, coloured fill to the actual twist.
    const tw = this.getSpine("twist"), twA = this.getSpine("twist", shape);
    const pos = (x) => `${50 + 50 * Math.max(-1, Math.min(1, x / this.twistMax))}%`;
    this.el.querySelector(".tp-knob").style.left = pos(tw);
    const fill = this.el.querySelector(".tp-fill"), a = 50 + 50 * Math.max(-1, Math.min(1, twA / this.twistMax));
    fill.style.left = `${Math.min(50, a)}%`; fill.style.width = `${Math.abs(a - 50)}%`;
    this.el.querySelector(".tp-twist-val").textContent = `${Math.round(twA / deg)}°`;
    // Toggle buttons.
    for (const k of ["front", "back"]) {
      const b = this.el.querySelector(`[data-leg="${k}"]`);
      const tucked = t[k] < 0.5;
      b.classList.toggle("on", tucked);
      b.querySelector("b").textContent = shape[k] < 0.15 ? "tucked" : shape[k] > 0.85 ? "spread" : "half out";
    }
    const kn = this.el.querySelector("[data-knees]");
    if (kn) {
      kn.classList.toggle("on", t.knees > 0.5);
      kn.querySelector("b").textContent = shape.knees > 0.5 ? "bent" : "straight";
    }
    if (this.pad) this.drawPad(shape);
  }

  // Pad: seen along the spine from behind (back at top, belly at bottom, cat's left on the left).
  drawPad(shape) {
    const g = this.pad.getContext("2d"), W = this.pad.width, c = W / 2, R = W * 0.42;
    const t = this.controls.targets;
    g.clearRect(0, 0, W, W);
    g.fillStyle = "rgba(255,255,255,0.04)";
    g.beginPath(); g.arc(c, c, R, 0, 2 * Math.PI); g.fill();
    g.strokeStyle = "#313a4b"; g.lineWidth = 3;
    g.beginPath(); g.arc(c, c, R, 0, 2 * Math.PI); g.stroke();
    g.setLineDash([4, 6]);
    g.beginPath(); g.arc(c, c, R * 0.18, 0, 2 * Math.PI); g.stroke();
    g.setLineDash([]);
    const coat = this.model.coat;
    g.fillStyle = coat.fur; g.beginPath(); g.arc(c, c, R * 0.16, Math.PI, 2 * Math.PI); g.fill();
    g.fillStyle = coat.belly; g.beginPath(); g.arc(c, c, R * 0.16, 0, Math.PI); g.fill();
    g.fillStyle = "#9aa4b5"; g.font = "22px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("back", c, c - R - 16); g.fillText("belly", c, c + R + 16);
    g.fillText("L", c - R - 16, c); g.fillText("R", c + R + 16, c);
    const pt = (a, r) => [c - r * Math.sin(a), c + r * Math.cos(a)];
    // Actual bend: needle (direction) whose length shows how bent the spine is.
    const bendA = this.getSpine("bend", shape) / this.bendMax;
    const [nx, ny] = pt(shape.dir, R * (0.18 + 0.82 * bendA));
    g.strokeStyle = "#f29a3a"; g.lineWidth = 8; g.lineCap = "round";
    g.beginPath(); g.moveTo(c, c); g.lineTo(nx, ny); g.stroke();
    // Target: where the thumb is asking for.
    const bendT = this.getSpine("bend") / this.bendMax;
    const [tx, ty] = pt(t.dir, R * (0.18 + 0.82 * bendT));
    g.fillStyle = "rgba(242,154,58,0.5)"; g.strokeStyle = "#f29a3a"; g.lineWidth = 3;
    g.beginPath(); g.arc(tx, ty, 22, 0, 2 * Math.PI); g.fill(); g.stroke();
  }
};
