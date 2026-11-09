// Model D: the most detailed cat, with a flexible spine.
// Three body segments (chest with the head, waist, hips) joined by two spine
// joints, plus model C's jointed legs. The front (chest) joint bends and twists
// further and faster than the stiffer back (lower-back) joint, following a 2026
// study of real cats: the flexible front spine lets the head and front legs turn
// first while the stiffer lower back anchors the turn.
var FC = (globalThis.FC = globalThis.FC || {});
FC.models = FC.models || [];

FC.models.push(
  FC.makeTwoCylinderModel({
    id: "D",
    name: "D · Flexible-spine cat",
    flexibleSpine: true,
    jointedLegs: true,
    coat: { fur: "#eadfca", belly: "#f7f1e6", eyes: "#3b82d6", points: "#4a3426" }, // Siamese
    description:
      "The most detailed cat: chest, waist and hips joined by two spine joints, plus jointed legs. " +
      "The front of the spine bends and twists more, and faster, than the stiffer lower back, " +
      "so the front half can turn first, like a real cat.",
    params: {
      chestLen: 0.13, waistLen: 0.12, hipLen: 0.13, // m (body 38 cm + head)
      chestMass: 1.3, waistMass: 0.7, hipMass: 1.2, // kg (body 3.2 kg, legs 0.8 kg)
      bendFrontMax: 65, bendBackMax: 35, // deg: the front joint is the flexible one
      twistFrontMax: 90, twistBackMax: 30,
      radius: 0.066,
      legMass: 0.2,
      legLen: 0.22,
      legAttachX: 0.09, // from each leg-bearing segment's spine joint
      legAttachY: 0.04,
      legAttachZ: -0.045,
      headX: 0.198, // head centre from the front spine joint
      headR: 0.062,
    },
  })
);
