// The diorama's model, Three-free: where everything stands, how many of each unit are drawn and how
// big the dust pile is. render/scene.ts turns this into meshes; tests/world.test.ts checks it. All of
// it is a pure function of the sim state and a fixed hash, never Math.random, so two draws of the
// same state at the same clock are the same picture (e2e/frames.spec.ts).

/** Half the width of the square island, in world units. The pile stands at the origin. */
export const ISLAND_HALF = 6;
/** The cart track's radius around the pile. */
export const TRACK_RADIUS = 3.55;

/** The most of each unit the diorama draws; owning more shows in the shop's count, not in more meshes. */
export const UNIT_CAPS: Readonly<Record<string, number>> = {
  gatherer: 18,
  cart: 8,
  mill: 3,
  forge: 3,
  foundry: 2,
};

export interface Slot {
  x: number;
  z: number;
  /** Rotation about the vertical axis, radians. */
  rot: number;
}

// The camera looks from the +x +z corner, so -x -z is the back of the island (the top of the screen),
// +x -z its right, -x +z its left and +x +z its front. Tall buildings stand at the back and sides, so
// nothing tall hides the pile; the front corner keeps trees and rocks only.
export const STRUCTURE_SLOTS: Readonly<Record<string, readonly Slot[]>> = {
  mill: [
    { x: 4.45, z: -4.35, rot: 0.35 },
    { x: 4.85, z: -1.45, rot: 0.7 },
    { x: 1.75, z: -4.85, rot: 0.15 },
  ],
  forge: [
    { x: -4.45, z: 4.35, rot: 1.15 },
    { x: -1.6, z: 4.85, rot: 0.9 },
    { x: -4.85, z: 1.55, rot: 1.35 },
  ],
  foundry: [
    { x: -4.2, z: -4.2, rot: 0.785 },
    { x: -4.9, z: -1.25, rot: 1.25 },
  ],
};

/** How many of a unit the diorama draws for `owned` bought. */
export function shownCount(unit: string, owned: number): number {
  const cap = UNIT_CAPS[unit] ?? 0;
  return Math.max(0, Math.min(cap, Math.floor(owned)));
}

/**
 * The pile's scale for a lifetime total: it grows with the number's digits, so it is visibly bigger
 * after every early purchase and still fits the island when the total runs to billions.
 */
export function pileScale(totalDust: number): number {
  const total = Number.isFinite(totalDust) && totalDust > 0 ? totalDust : 0;
  return Math.min(2.3, 0.95 + 0.2 * Math.log10(1 + total));
}

/** A fixed hash of an integer to [0, 1): the diorama's only randomness. */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export interface GathererPath {
  /** The lane's direction from the pile, radians. */
  angle: number;
  /** The far end of the lane from the pile's centre, before the pile's own radius is added. */
  reach: number;
  /** Seconds for one trip out and back. */
  period: number;
  /** Where in its trip the gatherer starts, 0 to 1. */
  offset: number;
  /** Index into the creature fills. */
  colour: number;
}

// Lanes between the buildings, so gatherers walk across open ground.
const LANES = [0.15, 0.95, 1.55, 2.35, 3.0, 3.75, 4.55, 5.45];

export function gathererPath(index: number): GathererPath {
  const lane = LANES[index % LANES.length]!;
  return {
    angle: lane + (hash01(index * 7 + 1) - 0.5) * 0.35,
    reach: 4.4 + hash01(index * 7 + 2) * 0.9,
    period: 7 + hash01(index * 7 + 3) * 4,
    offset: hash01(index * 7 + 4),
    colour: index % 6,
  };
}

/** Where a gatherer is along its lane at time `t` seconds: 0 at the pile, 1 at the far end, and which way it walks. */
export function gathererPhase(path: GathererPath, t: number): { along: number; inbound: boolean } {
  const phase = (((t / path.period + path.offset) % 1) + 1) % 1;
  // Out for the first half (empty), back for the second (carrying a sack), with a short pause at each end.
  const pause = 0.06;
  if (phase < 0.5) {
    const k = Math.min(1, Math.max(0, (phase - pause) / (0.5 - pause * 2)));
    return { along: smooth(k), inbound: false };
  }
  const k = Math.min(1, Math.max(0, (phase - 0.5 - pause) / (0.5 - pause * 2)));
  return { along: 1 - smooth(k), inbound: true };
}

function smooth(k: number): number {
  return k * k * (3 - 2 * k);
}

/** The order carts fill the track in, so a few carts spread out instead of bunching. */
export const CART_ORDER = [0, 4, 2, 6, 1, 5, 3, 7];

/** Overshoot ease for a pop-in: 0 at k=0, past 1 near k=0.6, settling at 1. */
export function easeOutBack(k: number): number {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}

/** The most flowers the island blooms with, however many seasons have passed. */
export const MAX_FLOWERS = 36;

const POND = { x: 4.1, z: 2.85 };

/** Where the forks' signpost stands: at the front, just outside the cart track. */
export const SIGNPOST = { x: 0.3, z: 4.2 };

/**
 * Where a dust devil is on the island `t` seconds into its visit: it loops around the pile outside its
 * clearing, on a path set by `seed` (a fixed hash of when it came), so every draw of the same state at
 * the same clock puts it in the same place.
 */
export function devilSpot(seed: number, t: number): { x: number; z: number } {
  const a = hash01(seed) * Math.PI * 2 + t * 0.45;
  const r = 2.7 + 0.8 * Math.sin(t * 0.7 + hash01(seed + 1) * 6);
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

/**
 * Where the i-th season flower stands: on the grass, clear of the pile's clearing and the track, the
 * buildings' slots and the pond, from the fixed hash, so every draw puts it in the same place.
 */
export function flowerSpot(index: number): { x: number; z: number; rot: number; scale: number } {
  const slots = Object.values(STRUCTURE_SLOTS).flat();
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const seed = index * 131 + attempt * 17 + 2000;
    const x = (hash01(seed) - 0.5) * ISLAND_HALF * 1.8;
    const z = (hash01(seed + 1) - 0.5) * ISLAND_HALF * 1.8;
    if (Math.hypot(x, z) < 4.2) continue;
    if (Math.hypot(x - POND.x, z - POND.z) < 1.3) continue;
    if (Math.hypot(x - SIGNPOST.x, z - SIGNPOST.z) < 0.9) continue;
    if (slots.some((slot) => Math.hypot(x - slot.x, z - slot.z) < 1.2)) continue;
    return { x, z, rot: hash01(seed + 2) * Math.PI * 2, scale: 0.8 + hash01(seed + 3) * 0.5 };
  }
  // Every island has room; this is only a fallback so the function is total.
  return { x: ISLAND_HALF - 0.6, z: -ISLAND_HALF + 0.6, rot: 0, scale: 1 };
}

// The milestone tiers' colours, climbing from the creature fills to the Dust suit's magenta.
const MILESTONE_COLOURS = [0xf5dc7a, 0x9bd3a6, 0x8db9e8, 0xf3b0c6, 0xb0226a];

/** The colour of a hat or pennant at a milestone tier (1 is the first). */
export function milestoneColour(tier: number): number {
  return MILESTONE_COLOURS[Math.max(0, Math.min(MILESTONE_COLOURS.length - 1, tier - 1))]!;
}
