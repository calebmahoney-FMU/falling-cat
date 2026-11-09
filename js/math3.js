// Small 3-vector / 3x3-matrix library. Matrices are row-major arrays of 9 numbers.
var FC = (globalThis.FC = globalThis.FC || {});

FC.m3 = (function () {
  const v = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ],
    norm: (a) => Math.hypot(a[0], a[1], a[2]),
    unit: (a) => {
      const n = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / n, a[1] / n, a[2] / n];
    },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  };

  const I = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const diag = (a, b, c) => [a, 0, 0, 0, b, 0, 0, 0, c];

  function mul(A, B) {
    const C = new Array(9);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
    return C;
  }
  const T = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
  const mv = (A, x) => [
    A[0] * x[0] + A[1] * x[1] + A[2] * x[2],
    A[3] * x[0] + A[4] * x[1] + A[5] * x[2],
    A[6] * x[0] + A[7] * x[1] + A[8] * x[2],
  ];
  const addM = (A, B) => A.map((x, i) => x + B[i]);
  const scaleM = (A, s) => A.map((x) => x * s);

  // Rotation by angle about unit axis (Rodrigues).
  function rot(axis, angle) {
    const [x, y, z] = v.unit(axis);
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    return [
      t * x * x + c, t * x * y - s * z, t * x * z + s * y,
      t * x * y + s * z, t * y * y + c, t * y * z - s * x,
      t * x * z - s * y, t * y * z + s * x, t * z * z + c,
    ];
  }

  // Exponential map: rotation vector -> matrix.
  function exp(w) {
    const th = v.norm(w);
    return th < 1e-14 ? I() : rot(w, th);
  }

  // Log map: rotation matrix -> rotation vector (axis * angle).
  function log(R) {
    const c = Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2));
    const th = Math.acos(c);
    const w = [R[7] - R[5], R[2] - R[6], R[3] - R[1]];
    if (th < 1e-7) return v.scale(w, 0.5);
    if (Math.PI - th < 1e-5) {
      // Near 180 degrees R ≈ 2aaᵀ − I (a = unit axis), so the antisymmetric part
      // vanishes. Take the largest |a_k| from the diagonal (a_k² = (R_kk + 1)/2),
      // then the others from the symmetric off-diagonals: R_kj + R_jk = 4 a_k a_j.
      // (The overall sign of a doesn't matter at exactly 180°.)
      const d = [R[0], R[4], R[8]];
      const k = d.indexOf(Math.max(...d));
      const ak = Math.sqrt(Math.max(1e-30, (d[k] + 1) / 2));
      const ax = [0, 1, 2].map((j) => (j === k ? ak : (R[3 * k + j] + R[3 * j + k]) / (4 * ak)));
      return v.scale(v.unit(ax), th);
    }
    return v.scale(w, th / (2 * Math.sin(th)));
  }

  function inv(A) {
    const [a, b, c, d, e, f, g, h, i] = A;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    const k = 1 / det;
    return [
      (e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k,
      (f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k,
      (d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k,
    ];
  }

  // Re-orthonormalise a rotation matrix (Gram-Schmidt on columns).
  function orthonormalize(R) {
    let x = v.unit([R[0], R[3], R[6]]);
    let y = [R[1], R[4], R[7]];
    y = v.unit(v.sub(y, v.scale(x, v.dot(x, y))));
    const z = v.cross(x, y);
    return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  }

  // Inertia contribution of a point mass m at r about the origin: m(|r|^2 I - r r^T).
  function pointInertia(m, r) {
    const r2 = v.dot(r, r);
    return [
      m * (r2 - r[0] * r[0]), -m * r[0] * r[1], -m * r[0] * r[2],
      -m * r[1] * r[0], m * (r2 - r[1] * r[1]), -m * r[1] * r[2],
      -m * r[2] * r[0], -m * r[2] * r[1], m * (r2 - r[2] * r[2]),
    ];
  }

  const col = (R, j) => [R[j], R[3 + j], R[6 + j]];

  return { v, I, diag, mul, T, mv, addM, scaleM, rot, exp, log, inv, orthonormalize, pointInertia, col };
})();
