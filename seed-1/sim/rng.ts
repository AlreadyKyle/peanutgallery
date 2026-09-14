// mulberry32: a 32-bit generator whose whole state is one unsigned integer,
// so it can live inside SimState and stay serialisable.

export interface RngDraw {
  state: number;
  value: number;
}

export function seedRng(seed: number): number {
  return seed >>> 0;
}

export function nextRandom(state: number): RngDraw {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(next ^ (next >>> 15), next | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: next, value };
}
