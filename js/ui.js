// Body-control panel generated from model.controls: sliders, the bend-direction
// dial, and keyboard bindings. Holds the *target* shape the player asks for;
// the game moves the actual shape toward it at each control's muscle speed.
var FC = (globalThis.FC = globalThis.FC || {});

FC.Controls = class {
  constructor(container) {
    this.container = container;
    this.held = new Set();
    this.enabled = true;
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      this.held.add(e.key.toLowerCase());
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.held.clear());
  }

  build(model) {
    this.model = model;
    this.targets = {};
    this.els = {};
    this.container.innerHTML = "";
    for (const c of model.controls) {
      this.targets[c.key] = c.def;
      const wrap = document.createElement("div");
      wrap.className = "ctrl";
      wrap.innerHTML = `<div class="ctrl-head"><span>${c.label}</span><b></b></div>`;
      if (c.type === "dial") {
        wrap.innerHTML += `<div class="dial-wrap"><canvas class="dial" width="224" height="224"></canvas>
          <div class="dial-side">Laps swept<b class="laps">0.0</b><span class="ctrl-hint">${c.hint}</span></div></div>`;
        const canvas = wrap.querySelector("canvas");
        this.bindDial(canvas, c);
        this.els[c.key] = { c, valEl: wrap.querySelector(".ctrl-head b"), canvas, laps: wrap.querySelector(".laps") };
      } else {
        const toUi = (x) => (c.unit === "deg" ? (x * 180) / Math.PI : x * 100);
        const fromUi = (x) => (c.unit === "deg" ? (x * Math.PI) / 180 : x / 100);
        wrap.innerHTML += `<input type="range" min="${toUi(c.min)}" max="${toUi(c.max)}" step="1" value="${toUi(c.def)}">
          <div class="ctrl-hint">${c.hint}</div>`;
        const input = wrap.querySelector("input");
        input.addEventListener("input", () => { if (this.enabled) this.targets[c.key] = fromUi(+input.value); });
        this.els[c.key] = { c, valEl: wrap.querySelector(".ctrl-head b"), input, toUi };
      }
      this.container.appendChild(wrap);
    }
    this.dialStart = 0;
  }

  bindDial(canvas, c) {
    let active = false;
    const angleAt = (e) => {
      const r = canvas.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      return Math.atan2(-dx, dy); // 0 = belly (bottom), +90 = cat's left (screen left)
    };
    const set = (e) => {
      if (!this.enabled) return;
      const a = angleAt(e), cur = this.targets[c.key];
      let d = (a - cur) % (2 * Math.PI);
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      this.targets[c.key] = cur + d; // unwrapped, so laps accumulate
    };
    canvas.addEventListener("pointerdown", (e) => { active = true; canvas.setPointerCapture(e.pointerId); set(e); });
    canvas.addEventListener("pointermove", (e) => active && set(e));
    canvas.addEventListener("pointerup", () => (active = false));
  }

  // Keyboard moves targets at the control's own rate (in simulated seconds).
  applyKeys(dtSim) {
    if (!this.enabled) return;
    for (const c of this.model.controls) {
      const [dec, inc] = c.keys;
      const dir = (this.held.has(inc) ? 1 : 0) - (this.held.has(dec) ? 1 : 0);
      if (!dir) continue;
      let t = this.targets[c.key] + dir * c.rate * dtSim;
      if (c.type !== "dial") t = Math.min(c.max, Math.max(c.min, t));
      this.targets[c.key] = t;
    }
  }

  reset() {
    for (const c of this.model.controls) this.targets[c.key] = c.def;
  }

  // Reflect actual shape and targets in the panel.
  show(shape) {
    for (const key in this.els) {
      const { c, valEl, input, toUi, canvas, laps } = this.els[key];
      if (c.type === "dial") {
        const deg = ((((shape[key] * 180) / Math.PI) % 360) + 360) % 360;
        valEl.textContent = `${deg.toFixed(0)}° ${this.dirName(deg)}`;
        laps.textContent = ((shape[key] - this.dialStart) / (2 * Math.PI)).toFixed(1);
        // Needle length shows how bent the spine is (both joints together for a flexible spine).
        const spine = this.model.spineAngle ? this.model.spineAngle(shape) : shape.bend;
        this.drawDial(canvas, shape[key], this.targets[key], spine / (100 * Math.PI / 180));
      } else {
        const ui = toUi(shape[key]);
        const pct = `${Math.round(ui)}%`;
        valEl.textContent =
          c.unit === "deg" ? `${ui.toFixed(0)}°`
          : c.unit === "ext" ? (ui < 15 ? "tucked" : ui > 85 ? "spread" : pct)
          : ui < 10 ? "straight" : ui > 90 ? "fully bent" : pct;
        if (document.activeElement !== input) input.value = toUi(this.targets[key]);
      }
    }
  }

  dirName(deg) {
    const names = ["toward belly", "belly-left", "toward left", "back-left", "arched back", "back-right", "toward right", "belly-right"];
    return names[Math.round(deg / 45) % 8];
  }

  // Dial = view along the spine from behind: back at top, belly at bottom, cat's left on the left.
  drawDial(canvas, actual, target, bendFrac) {
    const g = canvas.getContext("2d");
    const W = canvas.width, cx = W / 2, cy = W / 2, R = W * 0.42;
    g.clearRect(0, 0, W, W);
    g.lineWidth = 3;
    g.strokeStyle = "#313a4b";
    g.beginPath(); g.arc(cx, cy, R, 0, 2 * Math.PI); g.stroke();
    // Cat cross-section in this model's coat (outlined, so a black coat still shows on the dark panel).
    const coat = this.model.coat || { fur: "#e0883a", belly: "#f6f0e6" };
    g.fillStyle = coat.fur;
    g.beginPath(); g.arc(cx, cy, R * 0.3, Math.PI, 2 * Math.PI); g.fill();
    g.fillStyle = coat.belly;
    g.beginPath(); g.arc(cx, cy, R * 0.3, 0, Math.PI); g.fill();
    g.strokeStyle = "#9aa4b5"; g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, R * 0.3, 0, 2 * Math.PI); g.stroke();
    g.fillStyle = "#9aa4b5";
    g.font = "20px system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("back", cx, cy - R - 0);
    g.fillText("belly", cx, cy + R + 0);
    g.fillText("L", cx - R - 0, cy);
    g.fillText("R", cx + R + 0, cy);
    const pt = (a, r) => [cx - r * Math.sin(a), cy + r * Math.cos(a)];
    // Target marker.
    const [tx, ty] = pt(target, R);
    g.fillStyle = "rgba(242,154,58,0.45)";
    g.beginPath(); g.arc(tx, ty, 9, 0, 2 * Math.PI); g.fill();
    // Needle: direction of bend, length shows how much bend.
    const len = R * (0.35 + 0.65 * Math.min(1, Math.max(0, bendFrac)));
    const [nx, ny] = pt(actual, len);
    g.strokeStyle = "#f29a3a"; g.lineWidth = 6; g.lineCap = "round";
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(nx, ny); g.stroke();
    g.fillStyle = "#f29a3a";
    g.beginPath(); g.arc(nx, ny, 7, 0, 2 * Math.PI); g.fill();
  }
};
