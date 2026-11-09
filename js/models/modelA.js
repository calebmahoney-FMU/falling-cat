// Model A: the simplest cat, tuck and turn only.
// Same two body halves and legs as model B, but the spine cannot bend: the
// halves can only twist against each other about their shared long axis.
// Turning over comes from twisting with one pair of legs tucked and the other
// spread, then swapping the legs and untwisting (the "tuck and turn" idea of
// Rademaker & ter Braak). It works, but slowly: model B's bend-and-twist is far
// faster, which is the point of comparing the two.
var FC = (globalThis.FC = globalThis.FC || {});
FC.models = FC.models || [];

FC.models.push(
  Object.assign(
    FC.makeTwoCylinderModel({
      id: "A",
      name: "A · Tuck-and-turn cat",
      bendable: false,
      twistMax: 180,
      coat: { fur: "#8f959c", belly: "#ececea", eyes: "#3f7a45", stripes: "#4a4f56" }, // grey tabby
      description:
        "The simplest cat: the same two body halves and legs as model B, but the spine can only " +
        "twist, not bend. Tuck one pair of legs, twist, swap the legs, untwist: each cycle turns the " +
        "cat a little. It needs much more height than a cat that can bend.",
      params: {
        halfMass: 1.6,
        halfLen: 0.22,
        radius: 0.06,
        legMass: 0.2,
        legLen: 0.2,
        legAttachX: 0.17,
        legAttachY: 0.035,
        legAttachZ: -0.04,
        headX: 0.29,
        headR: 0.055,
      },
    }),
    // Challenge drops ×20: upside down this cat needs ~12.8 m to land perfectly (model B: ~0.6 m),
    // so its hardest level (20 m) keeps a margin like model B's. Slow motion runs 2× faster so
    // the much longer falls don't drag.
    { challengeScale: 20, challengeSpeedScale: 2 }
  )
);
