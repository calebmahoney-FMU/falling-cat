// Generic free-floating multibody engine with zero total angular momentum.
//
// A model describes the cat as a set of bodies whose poses depend only on a
// "shape" (the player's controls). The overall orientation R of the cat frame
// is NOT controlled directly: it follows from conservation of angular momentum
//
//   L = sum_i [ I_i (Omega + w_i) + m_i r_i x (Omega x r_i + dr_i/dt) ] = 0
//
// (vectors: L, Omega, w_i, r_i; I_i is body i's 3×3 inertia TENSOR about its own
// centre of mass, expressed in the cat frame; r_i is measured from the system
// centre of mass; everything in the cat frame). Collecting the Omega terms gives
//
//   J Omega = -h,   J = sum_i [ I_i + m_i (|r_i|² 1 − r_i r_iᵀ) ]  (whole-cat inertia tensor)
//                   h = sum_i [ I_i w_i + m_i r_i x dr_i/dt ]      (shape-change angular momentum)
//
// which is solved for the cat-frame angular velocity Omega each sub-step.
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
    for (const b of bodies) b.r = v.sub(b.p, c);
    return { bodies, com: c, mass: M };
  }

  // Inertia tensor of a rigid body (if any) expressed in the cat frame.
  const bodyInertia = (b) => (b.R ? mul(mul(b.R, b.I), T(b.R)) : null);

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

  // Cat-frame angular velocity that keeps L = 0 while the shape goes s0 -> s1 in dt.
  function solveOmega(model, s0, s1, dt) {
    const c0 = configuration(model, s0);
    const c1 = configuration(model, s1);
    const cm = configuration(model, lerpShape(s0, s1, 0.5));
    const J = totalInertia(cm);
    let h = [0, 0, 0]; // angular momentum due to shape change alone
    cm.bodies.forEach((b, i) => {
      const b0 = c0.bodies[i], b1 = c1.bodies[i];
      if (b.R) {
        const wRel = v.scale(log(mul(b1.R, T(b0.R))), 1 / dt);
        h = v.add(h, mv(bodyInertia(b), wRel));
      }
      const rDot = v.scale(v.sub(b1.r, b0.r), 1 / dt);
      h = v.add(h, v.scale(v.cross(b.r, rDot), b.m));
    });
    return { Omega: v.scale(mv(inv(J), h), -1), c0, c1 };
  }

  // Independent check: world-frame angular momentum computed from the
  // finite-differenced motion of every body over one step. Should be ~0.
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
        const Iw = mul(mul(W0, b0.I), T(W0));
        L = v.add(L, mv(Iw, w));
      }
    });
    return L;
  }

  // Advance orientation R (cat frame -> world) while the shape changes s0 -> s1.
  function step(model, R, s0, s1, dt) {
    const { Omega, c0, c1 } = solveOmega(model, s0, s1, dt);
    const R1 = orthonormalize(mul(R, exp(v.scale(Omega, dt))));
    return { R: R1, Omega, L: measureL(c0, c1, R, R1, dt) };
  }

  return { lerpShape, configuration, totalInertia, solveOmega, step, measureL };
})();
