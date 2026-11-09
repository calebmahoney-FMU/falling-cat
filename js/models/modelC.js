// Model C: model B with cat-like proportions and a joint in every leg.
// Shorter, slightly thicker body halves; each leg has an upper and lower
// segment (two point masses) with a knee/elbow that can bend. Bent knees
// change the leg's inertia in the air, and on landing the knees fold to
// spread the stop over more distance, cutting the impact force.
var FC = (globalThis.FC = globalThis.FC || {});
FC.models = FC.models || [];

FC.models.push(
  FC.makeTwoCylinderModel({
    id: "C",
    name: "C · Cat with jointed legs",
    jointedLegs: true,
    coat: { fur: "#26272b", belly: "#f2f2f0", eyes: "#c9d23a" }, // black-and-white tuxedo
    description:
      "Model B with cat-like proportions: a shorter, stockier body and a joint in every leg. " +
      "The knees change how the legs' weight is spread in the air, and on landing they fold " +
      "to cushion the impact. Land with straight knees to leave the most room to absorb.",
    params: {
      halfMass: 1.6,
      halfLen: 0.17,
      radius: 0.068,
      legMass: 0.2,
      legLen: 0.22,
      legAttachX: 0.13,
      legAttachY: 0.04,
      legAttachZ: -0.045,
      headX: 0.235,
      headR: 0.062,
    },
  })
);
