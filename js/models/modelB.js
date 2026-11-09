// Model B: Kane–Scher two-cylinder cat + legs that tuck and extend (the base model).
var FC = (globalThis.FC = globalThis.FC || {});
FC.models = FC.models || [];

FC.models.push(
  FC.makeTwoCylinderModel({
    id: "B",
    name: "B · Two-cylinder cat with legs",
    coat: { fur: "#e0883a", belly: "#f6f0e6", eyes: "#222222" }, // ginger
    description:
      "Two rigid body halves joined by a flexible spine (the Kane–Scher model, 1969), plus legs " +
      "that can tuck in or spread out. Bend the spine and sweep the bend direction around to " +
      "'bend and twist', or twist the halves while tucking one pair of legs to 'tuck and turn'.",
    // Physical parameters (SI units). Total mass 4 kg, roughly a house cat.
    params: {
      halfMass: 1.6, // each body half, kg
      halfLen: 0.22, // m, spine joint to end of each half
      radius: 0.06, // m, body cylinder radius
      legMass: 0.2, // kg, each of four legs
      legLen: 0.2, // m
      legAttachX: 0.17, // m from the spine joint along each half
      legAttachY: 0.035,
      legAttachZ: -0.04,
      headX: 0.29, // head centre, m from the spine joint (visual + ground contact)
      headR: 0.055,
    },
  })
);
