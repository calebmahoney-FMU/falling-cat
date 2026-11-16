// Generic free-floating multibody engine with zero total angular momentum.
// Used by every game model (A–D), the lab and the tests. Same mechanics as
// Model 0 (js/model0.js), written for any model that lists its bodies.
//
// A model describes the cat as a set of bodies whose poses depend only on a
// "shape" s (the player's controls: a list of SCALARS). model.bodies(s) gives, for
// each body i, in the cat frame C:
//   m_i  mass (scalar)
//   I_i  inertia TENSOR about the body's own centre of mass, in its own frame
//        (null for a point mass)
//   R_i  rotation matrix, body frame -> C (null for a point mass)
//   p_i  position of the body's centre of mass (vector)
// The orientation R of frame C in the world is NOT controlled directly: it follows
// from conservation of angular momentum about the centre of mass,
//
//   L = Σ_i [ I_i^C ω_i + m_i r_i × v_i ] = 0,   I_i^C = R_i I_i R_iᵀ
//   ω_i = Ω + w_i,   v_i = Ω × r_i + dr_i/dt
//
// (vectors: L, Ω, ω_i, w_i, r_i, v_i; r_i is measured from the system centre of
// mass; w_i is body i's angular velocity relative to C; all components in C).
// Collecting the Ω terms:
//
//   J Ω = −h,   J = Σ_i [ I_i^C + m_i (|r_i|² 1 − r_i r_iᵀ) ]   (whole-cat inertia tensor)
//               h = Σ_i [ I_i^C w_i + m_i r_i × dr_i/dt ]       (angular momentum of the shape change)
//
// h is linear in the shape rates: h = Σ_k A_k(s) ṡ_k. The per-body rates behind
// each column (w_i and dr_i/dt per unit ṡ_k) come from 4th-order (Richardson)
// central differences in the shape coordinate, accurate to ~1e-12; the tests
// compare them with Model 0's exact analytic derivatives.
//
// Orientation: dR/dt = R [Ω]×. Each step the shape moves LINEARLY from s0 to s1
// (constant ṡ), and R is advanced with the 4th-order Magnus method (Ω at the two
// Gauss points), which keeps R an exact rotation.
//
// Gravity is uniform, so it exerts no torque about the centre of mass and only
// sets how long the cat has before it reaches the ground.
var FC = (globalThis.FC = globalThis.FC || {});

FC.physics = (function () {
  const { v, mul, T, mv, addM, inv, log, exp, orthonormalize, pointInertia } = FC.m3;

  function lerpShape(a, b, t) {
    const out = {};
    for (const k in a) out[k] = a[k] + (b[k] - a[k]) * t;
    return out;
  }

  // Bodies of the model with positions measured from the system centre of mass.
  function configuration(model, shape) {
    const bodies = model.bodies(shape);
    let M = 0, c = [0, 0, 0];
    for (const b of bodies) {
      M += b.m;
      c = v.add(c, v.scale(b.p, b.m));
    }
    c = v.scale(c, 1 / M);
    for (const b of bodies) {
      b.r = v.sub(b.p, c);
      b.IC = b.R ? mul(mul(b.R, b.I), T(b.R)) : null; // inertia tensor in the cat frame: R I Rᵀ
    }
    return { bodies, com: c, mass: M };
  }

  // Inertia tensor of a rigid body (if any) expressed in the cat frame.
  const bodyInertia = (b) => b.IC || (b.R ? mul(mul(b.R, b.I), T(b.R)) : null);

  // Total inertia tensor of the whole cat about its centre of mass (cat frame).
  function totalInertia(conf) {
    let J = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const b of conf.bodies) {
      const Ib = bodyInertia(b);
      if (Ib) J = addM(J, Ib);
      J = addM(J, pointInertia(b.m, b.r));
    }
    return J;
  }

  // Per-body rates for unit rate of shape coordinate `key` at shape s:
  // w_i (relative angular velocity) and dr_i (velocity relative to the system
  // centre of mass), both in C. Central differences D(ε) are even in ε, so the
  // Richardson combination (4 D(ε) − D(2ε)) / 3 cancels the ε² error: O(ε⁴).
  const EPS = 1e-3;
  function rates(model, s, key, nBodies) {
    const at = (d) => configuration(model, { ...s, [key]: s[key] + d }).bodies;
    const p1 = at(EPS), m1 = at(-EPS), p2 = at(2 * EPS), m2 = at(-2 * EPS);
    const out = [];
    for (let i = 0; i < nBodies; i++) {
      let w = null;
      if (p1[i].R) {
        const w1 = v.scale(log(mul(p1[i].R, T(m1[i].R))), 1 / (2 * EPS));
        const w2 = v.scale(log(mul(p2[i].R, T(m2[i].R))), 1 / (4 * EPS));
        w = v.scale(v.sub(v.scale(w1, 4), w2), 1 / 3);
      }
      const d1 = v.scale(v.sub(p1[i].r, m1[i].r), 1 / (2 * EPS));
      const d2 = v.scale(v.sub(p2[i].r, m2[i].r), 1 / (4 * EPS));
      out.push({ w, dr: v.scale(v.sub(v.scale(d1, 4), d2), 1 / 3) });
    }
    return out;
  }

  // Everything at an instant: shape s and shape rates sdot (only the keys that
  // change). Returns J, h, Ω, and per body ω_i, v_i, spin I_i ω_i, orbital
  // m_i r_i × v_i, plus totals L (= 0), P (= 0) and the kinetic energy (scalar).
  function state(model, s, sdot) {
    const conf = configuration(model, s);
    const J = totalInertia(conf);
    const n = conf.bodies.length;
    const w = conf.bodies.map(() => [0, 0, 0]), dr = conf.bodies.map(() => [0, 0, 0]);
    for (const key in sdot) {
      const rate = sdot[key];
      if (!rate) continue;
      rates(model, s, key, n).forEach((q, i) => {
        if (q.w) w[i] = v.add(w[i], v.scale(q.w, rate));
        dr[i] = v.add(dr[i], v.scale(q.dr, rate));
      });
    }
    let h = [0, 0, 0];
    conf.bodies.forEach((b, i) => {
      if (b.IC) h = v.add(h, mv(b.IC, w[i]));
      h = v.add(h, v.scale(v.cross(b.r, dr[i]), b.m));
    });
    const Omega = v.scale(mv(inv(J), h), -1);
    let L = [0, 0, 0], P = [0, 0, 0], KE = 0;
    const bodies = conf.bodies.map((b, i) => {
      const omega = v.add(Omega, w[i]);
      const vel = v.add(v.cross(Omega, b.r), dr[i]);
      const spin = b.IC ? mv(b.IC, omega) : [0, 0, 0];
      const orbital = v.scale(v.cross(b.r, vel), b.m);
      L = v.add(L, v.add(spin, orbital));
      P = v.add(P, v.scale(vel, b.m));
      KE += 0.5 * v.dot(omega, spin) + 0.5 * b.m * v.dot(vel, vel);
      return { ...b, w: w[i], dr: dr[i], omega, vel, spin, orbital, L: v.add(spin, orbital) };
    });
    return { conf, J, h, Omega, L, P, KE, bodies };
  }

  const omegaAt = (model, s, sdot) => state(model, s, sdot).Omega;

  // Independent check: world-frame angular momentum computed from the
  // finite-differenced motion of every body over one step. Should be ~0
  // (it is a first difference, so its own error is O(dt²)).
  function measureL(c0, c1, R0, R1, dt) {
    let L = [0, 0, 0];
    c0.bodies.forEach((b0, i) => {
      const b1 = c1.bodies[i];
      const P0 = mv(R0, b0.r), P1 = mv(R1, b1.r);
      const Pm = v.scale(v.add(P0, P1), 0.5);
      L = v.add(L, v.scale(v.cross(Pm, v.scale(v.sub(P1, P0), 1 / dt)), b0.m));
      if (b0.R) {
        const W0 = mul(R0, b0.R), W1 = mul(R1, b1.R);
        const w = v.scale(log(mul(W1, T(W0))), 1 / dt);
        // body inertia tensor in the world frame, averaged over the step's two ends
        const I0 = mul(mul(W0, b0.I), T(W0)), I1 = mul(mul(W1, b1.I), T(W1));
        L = v.add(L, mv(addM(I0, I1).map((x) => x / 2), w));
      }
    });
    return L;
  }

  // Advance orientation R (cat frame -> world) while the shape moves linearly
  // s0 -> s1 in dt. 4th-order Magnus with two Gauss points:
  //   θ = (dt/2)(Ω₁ + Ω₂) − (√3/12) dt² (Ω₂ × Ω₁),  R ← R exp([θ]×)
  // Returns the new R, the step's mean Ω, and the independently measured L.
  const G1 = 0.5 - Math.sqrt(3) / 6, G2 = 0.5 + Math.sqrt(3) / 6;
  function step(model, R, s0, s1, dt) {
    const sdot = {};
    for (const k in s1) if (s1[k] !== s0[k]) sdot[k] = (s1[k] - s0[k]) / dt;
    let R1, Omega;
    if (Object.keys(sdot).length === 0) {
      R1 = R; Omega = [0, 0, 0]; // no shape change: nothing turns (L = 0 and J is invertible)
    } else {
      const O1 = omegaAt(model, lerpShape(s0, s1, G1), sdot), O2 = omegaAt(model, lerpShape(s0, s1, G2), sdot);
      const theta = v.sub(v.scale(v.add(O1, O2), dt / 2), v.scale(v.cross(O2, O1), (Math.sqrt(3) / 12) * dt * dt));
      R1 = orthonormalize(mul(R, exp(theta)));
      Omega = v.scale(v.add(O1, O2), 0.5);
    }
    const c0 = configuration(model, s0), c1 = configuration(model, s1);
    return { R: R1, Omega, L: measureL(c0, c1, R, R1, dt) };
  }

  return { lerpShape, configuration, totalInertia, rates, state, omegaAt, step, measureL, EPS };
})();
