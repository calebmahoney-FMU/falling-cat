// Model 0: the simplest free-floating multibody that can turn itself.
// Two identical uniform solid cylinders joined at a joint, plus one leg (a
// uniform solid rod) hinged to the front cylinder. No cat, no game: just the
// mechanics of inertia and angular momentum, done carefully.
//
// ---------------------------------------------------------------------------
// Notation (comments use plain text): vectors are 3-arrays, second-rank tensors
// are 3x3 matrices stored row-major (FC.m3), scalars are numbers. SI units.
//
// Bodies (i = 1, 2, 3):
//   1 front cylinder, 2 back cylinder, 3 leg.
//   m_i            mass (scalar)
//   Ib_i           inertia TENSOR of body i about its own centre of mass, in
//                  its own body frame (diagonal: principal moments)
//   R_i            rotation matrix: body-i frame -> reference frame F
//   c_i            position of body i's centre of mass in F (from the joint)
//
// Reference frame F = the back cylinder's body frame (so R_2 = identity).
// Origin of F: the joint. x_F: back cylinder's symmetry axis, pointing from the
// back cylinder toward the joint.
//
// Shape s = (beta, phi, psi, alpha), all SCALARS (angles, rad):
//   beta  bend: angle between the two cylinder axes (0 = straight)
//   phi   bend direction: the front cylinder's axis tilts toward
//         d = cos(phi) y_F + sin(phi) z_F
//   psi   twist of the front cylinder about its own axis, relative to the back
//   alpha leg angle about the front cylinder's y axis: 0 = leg straight down
//         (-z_1), +90 deg = folded forward along the cylinder
//   R_1 = Rot(k, beta) Rot(x, psi),  k = x × d = (0, -sin phi, cos phi)
//   R_3 = R_1 Rot(y, -alpha)        (leg's symmetry axis is its own z axis)
//
// Free flight: no external force or torque (gravity is uniform, so it gives no
// torque about the centre of mass and only moves the centre of mass, which
// separates out). So the total linear momentum P and the total angular momentum
// L about the centre of mass are constant; start from rest and both stay zero.
//
// Everything below is expressed in F unless it says "world".
//   r_i = c_i - c_cm             position of body i's centre of mass relative to
//                                the system centre of mass (vector)
//   I_i = R_i Ib_i R_iᵀ          body i's inertia tensor in F (tensor)
//   J = Σ [ I_i + m_i (|r_i|² 1 − r_i r_iᵀ) ]
//                                whole system's inertia tensor about its centre
//                                of mass, for the current shape (tensor)
//   Ω                            angular velocity of frame F relative to inertial
//                                space, components in F (vector)
//   w_i = vee(dR_i/dt R_iᵀ)      angular velocity of body i RELATIVE to F (vector)
//   ω_i = Ω + w_i                body i's absolute angular velocity (vector)
//   v_i = Ω × r_i + dr_i/dt      velocity of body i's centre of mass relative to
//                                the system centre of mass (vector)
//   L = Σ [ I_i ω_i + m_i r_i × v_i ] = J Ω + h,
//   h = Σ [ I_i w_i + m_i r_i × dr_i/dt ]   (angular momentum of the shape change alone)
//   L = 0  =>  Ω = −J⁻¹ h.
//
// h is linear in the shape rates: h = A(s) ṡ, where column k of the 3x4 matrix
// A(s) is the h produced by unit rate of shape coordinate k. A is computed from
// exact analytic derivatives of every body's orientation and position (see
// connection()); the tests check them against central differences.
//
// Orientation of F in the world, R_F: dR_F/dt = R_F [Ω]×. Integrated with the
// 4th-order Magnus method (two Gauss points), exact for rotations, so R_F stays
// a rotation; tests check the 4th-order convergence.
var FC = (globalThis.FC = globalThis.FC || {});

FC.model0 = (function () {
  const { v, mul, T, mv, addM, scaleM, rot, exp, log, inv, orthonormalize, pointInertia } = FC.m3;
  const eye = FC.m3.I;
  const deg = Math.PI / 180;
  const X = [1, 0, 0], Y = [0, 1, 0];
  const KEYS = ["beta", "phi", "psi", "alpha"];

  const DEFAULTS = {
    cyl: { m: 1.6, r: 0.06, len: 0.22 },                 // each cylinder: kg, m, m
    leg: { m: 0.3, r: 0.012, len: 0.20, hinge: [0.15, 0, -0.072] }, // hinge in the front cylinder's frame, m
  };

  // Inertia tensor (kg·m²) of a uniform solid cylinder about its centre of mass,
  // in its own frame, symmetry axis along x (axis = 0) or z (axis = 2).
  //   about the symmetry axis: ½ m r²;  about any perpendicular axis: m(3r² + ℓ²)/12
  function cylinderTensor(m, r, len, axis) {
    const a = 0.5 * m * r * r, b = (m * (3 * r * r + len * len)) / 12;
    return axis === 0 ? [a, 0, 0, 0, b, 0, 0, 0, b] : [b, 0, 0, 0, b, 0, 0, 0, a];
  }

  // Similarity transform of a tensor into another frame: R I Rᵀ.
  const rotateTensor = (R, Ib) => mul(mul(R, Ib), T(R));

  // Eigen-decomposition of a symmetric 3x3 tensor (cyclic Jacobi rotations).
  // Returns principal moments (ascending) and unit principal axes.
  function eigenSym(A0) {
    const a = [[A0[0], A0[1], A0[2]], [A0[3], A0[4], A0[5]], [A0[6], A0[7], A0[8]]];
    const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 50; sweep++) {
      const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
      if (off < 1e-30 * (a[0][0] ** 2 + a[1][1] ** 2 + a[2][2] ** 2 + 1e-300)) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) { // A <- Jᵀ A J
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
        }
      }
    }
    const pairs = [0, 1, 2].map((i) => ({ value: a[i][i], axis: [V[0][i], V[1][i], V[2][i]] }));
    pairs.sort((p1, p2) => p1.value - p2.value);
    return { values: pairs.map((p) => p.value), axes: pairs.map((p) => p.axis) };
  }

  function create(overrides = {}) {
    const cyl = { ...DEFAULTS.cyl, ...(overrides.cyl || {}) };
    const leg = { ...DEFAULTS.leg, ...(overrides.leg || {}) };
    const Ib = [cylinderTensor(cyl.m, cyl.r, cyl.len, 0), cylinderTensor(cyl.m, cyl.r, cyl.len, 0), cylinderTensor(leg.m, leg.r, leg.len, 2)];
    const masses = [cyl.m, cyl.m, leg.m];
    const M = masses[0] + masses[1] + masses[2];
    const names = ["front cylinder", "back cylinder", "leg"];

    // Body orientations R_i (body -> F) and centre-of-mass positions c_i (in F).
    function poses(s) {
      const k = [0, -Math.sin(s.phi), Math.cos(s.phi)];
      const R1 = mul(rot(k, s.beta), rot(X, s.psi));
      const R3 = mul(R1, rot(Y, -s.alpha));
      return [
        { R: R1, c: mv(R1, [cyl.len / 2, 0, 0]) },
        { R: eye(), c: [-cyl.len / 2, 0, 0] },
        { R: R3, c: v.add(mv(R1, leg.hinge), mv(R3, [0, 0, -leg.len / 2])) },
      ];
    }

    // Configuration at shape s: system centre of mass, r_i, I_i and J (all in F).
    function configuration(s) {
      const ps = poses(s);
      let cm = [0, 0, 0];
      ps.forEach((p, i) => (cm = v.add(cm, v.scale(p.c, masses[i] / M))));
      let J = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      const bodies = ps.map((p, i) => {
        const r = v.sub(p.c, cm);
        const I = rotateTensor(p.R, Ib[i]);
        J = addM(J, addM(I, pointInertia(masses[i], r)));
        return { name: names[i], m: masses[i], Ib: Ib[i], R: p.R, c: p.c, r, I };
      });
      return { s, cm, bodies, J };
    }

    // Local connection: for each shape coordinate k, each body's relative angular
    // velocity w_ik and centre-of-mass velocity dr_ik per unit ṡ_k (both vectors in F),
    // and the column h_k = Σ [ I_i w_ik + m_i r_i × dr_ik ] of A(s). Exact (analytic):
    //   R_1 = Rot(k, β) Rot(x, ψ), k = (0, −sin φ, cos φ), k' = dk/dφ = (0, −cos φ, −sin φ)
    //   ∂R_1/∂β R_1ᵀ = [k]×                       → w_1β = k
    //   ∂R_1/∂φ R_1ᵀ = [sin β k' + (1 − cos β) k × k']×   (rotation about a turning axis)
    //   ∂R_1/∂ψ R_1ᵀ = [Rot(k, β) x]×             → w_1ψ = the front cylinder's own axis
    //   R_3 = R_1 Rot(y, −α): w_3 = w_1 for β, φ, ψ, and w_3α = −R_1 y
    //   positions: dc_1 = w_1 × c_1;  dc_3 = w_1 × (R_1 hinge) + w_3 × (R_3 q);  dc_2 = 0
    //   r_i = c_i − c_cm, so dr_i = dc_i − Σ_j (m_j/M) dc_j.
    // connectionFD (central differences) is kept as an independent check for the tests.
    function connection(s, conf = configuration(s)) {
      const kv = [0, -Math.sin(s.phi), Math.cos(s.phi)], kp = [0, -Math.cos(s.phi), -Math.sin(s.phi)];
      const R1 = conf.bodies[0].R, R3 = conf.bodies[2].R;
      const a1 = mv(R1, [cyl.len / 2, 0, 0]), hingeF = mv(R1, leg.hinge), q3 = mv(R3, [0, 0, -leg.len / 2]);
      const w1 = {
        beta: kv,
        phi: v.add(v.scale(kp, Math.sin(s.beta)), v.scale(v.cross(kv, kp), 1 - Math.cos(s.beta))),
        psi: mv(rot(kv, s.beta), X),
        alpha: [0, 0, 0],
      };
      const cols = KEYS.map((key) => {
        const w3 = key === "alpha" ? v.scale(mv(R1, Y), -1) : w1[key];
        const w = [w1[key], [0, 0, 0], w3];
        const dc = [v.cross(w1[key], a1), [0, 0, 0], v.add(v.cross(w1[key], hingeF), v.cross(w3, q3))];
        let dcm = [0, 0, 0];
        dc.forEach((d, i) => (dcm = v.add(dcm, v.scale(d, masses[i] / M))));
        const dr = dc.map((d) => v.sub(d, dcm));
        let h = [0, 0, 0];
        conf.bodies.forEach((b, i) => {
          h = v.add(h, mv(b.I, w[i]));
          h = v.add(h, v.scale(v.cross(b.r, dr[i]), b.m));
        });
        return { key, w, dr, h };
      });
      return { conf, cols };
    }

    function connectionFD(s, conf = configuration(s)) {
      const eps = 5e-6;
      const cols = KEYS.map((key) => {
        const cp = configuration({ ...s, [key]: s[key] + eps });
        const cm = configuration({ ...s, [key]: s[key] - eps });
        const w = conf.bodies.map((b, i) => v.scale(log(mul(cp.bodies[i].R, T(cm.bodies[i].R))), 1 / (2 * eps)));
        const dr = conf.bodies.map((b, i) => v.scale(v.sub(cp.bodies[i].r, cm.bodies[i].r), 1 / (2 * eps)));
        let h = [0, 0, 0];
        conf.bodies.forEach((b, i) => {
          h = v.add(h, mv(b.I, w[i]));
          h = v.add(h, v.scale(v.cross(b.r, dr[i]), b.m));
        });
        return { key, w, dr, h };
      });
      return { conf, cols };
    }

    // Everything at an instant: shape s, shape rates sdot (scalars per second).
    function state(s, sdot) {
      const { conf, cols } = connection(s);
      let h = [0, 0, 0];
      cols.forEach((col) => (h = v.add(h, v.scale(col.h, sdot[col.key] || 0))));
      const Jinv = inv(conf.J);
      const Omega = v.scale(mv(Jinv, h), -1);
      let L = [0, 0, 0], P = [0, 0, 0], KE = 0;
      const bodies = conf.bodies.map((b, i) => {
        let w = [0, 0, 0], dr = [0, 0, 0];
        cols.forEach((col) => {
          const rate = sdot[col.key] || 0;
          w = v.add(w, v.scale(col.w[i], rate));
          dr = v.add(dr, v.scale(col.dr[i], rate));
        });
        const omega = v.add(Omega, w);                      // absolute angular velocity
        const vel = v.add(v.cross(Omega, b.r), dr);         // velocity relative to the system centre of mass
        const spin = mv(b.I, omega);                        // I_i ω_i
        const orbital = v.scale(v.cross(b.r, vel), b.m);    // m_i r_i × v_i
        const Li = v.add(spin, orbital);
        L = v.add(L, Li);
        P = v.add(P, v.scale(vel, b.m));
        KE += 0.5 * v.dot(omega, spin) + 0.5 * b.m * v.dot(vel, vel);
        return { ...b, w, dr, omega, vel, spin, orbital, L: Li };
      });
      return { s, sdot, conf, J: conf.J, h, Omega, L, P, KE, bodies, A: cols.map((c) => c.h) };
    }

    // dR_F/dt = R_F [Ω]× over one step of length dt with ṡ constant (the shape
    // moves linearly from s to s + ṡ dt). 4th-order Magnus with two Gauss points:
    //   θ = (dt/2)(Ω₁ + Ω₂) − (√3/12) dt² (Ω₂ × Ω₁),  R_F ← R_F exp([θ]×)
    const G1 = 0.5 - Math.sqrt(3) / 6, G2 = 0.5 + Math.sqrt(3) / 6;
    const at = (s, sdot, t) => Object.fromEntries(KEYS.map((k) => [k, s[k] + (sdot[k] || 0) * t]));
    function omegaAt(s, sdot) {
      const { conf, cols } = connection(s);
      let h = [0, 0, 0];
      cols.forEach((col) => (h = v.add(h, v.scale(col.h, sdot[col.key] || 0))));
      return v.scale(mv(inv(conf.J), h), -1);
    }
    function step(RF, s, sdot, dt) {
      const O1 = omegaAt(at(s, sdot, G1 * dt), sdot), O2 = omegaAt(at(s, sdot, G2 * dt), sdot);
      const theta = v.sub(v.scale(v.add(O1, O2), dt / 2), v.scale(v.cross(O2, O1), (Math.sqrt(3) / 12) * dt * dt));
      return { RF: orthonormalize(mul(RF, exp(theta))), s: at(s, sdot, dt) };
    }

    // Independent check of L (world frame) from the motion actually produced over
    // one step: positions and orientations of every body at both ends, differenced.
    // Shares nothing with the solver except the body geometry. Error O(dt²).
    function measuredL(RF0, s0, RF1, s1, dt) {
      const c0 = configuration(s0), c1 = configuration(s1);
      let L = [0, 0, 0], scale = 0;
      c0.bodies.forEach((b0, i) => {
        const b1 = c1.bodies[i];
        const x0 = mv(RF0, b0.r), x1 = mv(RF1, b1.r);
        const xm = v.scale(v.add(x0, x1), 0.5), vel = v.scale(v.sub(x1, x0), 1 / dt);
        const W0 = mul(RF0, b0.R), W1 = mul(RF1, b1.R);
        const omega = v.scale(log(mul(W1, T(W0))), 1 / dt);
        const Iw = scaleM(addM(rotateTensor(W0, b0.Ib), rotateTensor(W1, b1.Ib)), 0.5);
        const spin = mv(Iw, omega), orbital = v.scale(v.cross(xm, vel), b0.m);
        L = v.add(L, v.add(spin, orbital));
        scale += v.norm(spin) + v.norm(orbital);
      });
      return { L, scale };
    }

    const neutral = () => ({ beta: 0, phi: 0, psi: 0, alpha: 0 });
    return { params: { cyl, leg }, masses, M, names, Ib, KEYS, poses, configuration, connection, connectionFD, state, step, omegaAt, measuredL, neutral };
  }

  // Exact Kane–Scher result (two identical axisymmetric bodies, no leg): one full
  // sweep of the bend direction at fixed bend β (= angle between the axes) turns
  // the body about its axis by 2π (A cos b / (A cos² b + B sin² b) − 1), b = β/2,
  // A, B = principal moments of one cylinder about / across its axis (its centre of mass).
  function kaneScherRoll(cyl, beta) {
    const b = beta / 2, A = 0.5 * cyl.m * cyl.r ** 2, B = (cyl.m * (3 * cyl.r ** 2 + cyl.len ** 2)) / 12;
    return 2 * Math.PI * ((A * Math.cos(b)) / (A * Math.cos(b) ** 2 + B * Math.sin(b) ** 2) - 1);
  }

  return { create, cylinderTensor, rotateTensor, eigenSym, kaneScherRoll, KEYS, DEFAULTS, deg };
})();
