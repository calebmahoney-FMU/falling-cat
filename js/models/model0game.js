// Model 0 inside the game, for the guided lessons: two identical solid cylinders
// and one leg (js/model0.js), floating in zero gravity (the game's "Zero-g
// practice" mode). Not a cat and not in the model picker.
//
// The bodies are exactly Model 0's (same masses, inertia tensors and poses); the
// game's generic engine (js/physics.js) integrates them, and tests/engine-tests.html
// checks that the generic engine reproduces Model 0's exact analytic result.
// Reference frame = the back cylinder's frame F, as on the Model 0 page.
var FC = (globalThis.FC = globalThis.FC || {});
FC.models = FC.models || [];

FC.makeModel0Game = function (legMass = 0.3) {
  const deg = Math.PI / 180;
  const m0 = FC.model0.create({ leg: { m: legMass } });
  const { mv } = FC.m3;
  const parts = ["front cylinder", "back cylinder", "leg"];
  const controls = [
    { key: "beta", label: "Bend β", type: "slider", min: 0, max: 120 * deg, def: 0, rate: 120 * deg, unit: "deg", keys: ["s", "w"], hint: "W / S" },
    { key: "phi", label: "Bend direction φ", type: "dial", def: 0, rate: 300 * deg, unit: "deg", keys: ["a", "d"], hint: "A / D (hold to sweep)" },
    { key: "psi", label: "Twist ψ", type: "slider", min: -180 * deg, max: 180 * deg, def: 0, rate: 180 * deg, unit: "deg", keys: ["q", "e"], hint: "Q / E" },
    { key: "alpha", label: "Leg angle α", type: "slider", min: -90 * deg, max: 90 * deg, def: 0, rate: 180 * deg, unit: "deg", keys: ["z", "x"], hint: "Z fold forward / X back" },
  ];
  return {
    id: "0", kind: "model0", name: "0 · Two cylinders and a leg", available: true, inMenu: false,
    description: "Not a cat: two identical solid cylinders joined at a joint, plus one leg (a solid rod) hinged to the front cylinder. " +
      "Four controls: bend β, bend direction φ, twist ψ and leg angle α.",
    m0, controls, params: m0.params, fixedShape: {}, bendable: true, jointed: false, flexible: false,
    coat: { fur: "#e8833a", belly: "#2a78d6", eyes: "#1baf7a" },
    // Bodies for the generic engine: Model 0's own masses, body-frame inertia tensors and poses.
    bodies: (s) => m0.poses(s).map((p, i) => ({ m: m0.masses[i], I: m0.Ib[i], R: p.R, p: p.c, part: parts[i] })),
    // For the HUD gauge: the side each cylinder's "underside" faces (its −z axis, where the leg hangs).
    ventral: (s) => m0.poses(s).slice(0, 2).map((p) => mv(p.R, [0, 0, -1])),
    spineAngle: (s) => s.beta,
    combine: (s) => s, split: (s) => s,
    contactHeight: 0.25, bodyLength: m0.params.cyl.len * 2,
    landingStroke: () => 0.02, compress: (s) => s,
  };
};
FC.models.push(FC.makeModel0Game());
