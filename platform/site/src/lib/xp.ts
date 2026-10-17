import { RARITY_XP_MULTIPLIER } from './rarity';
import type { Rarity } from './community-types';

// XP is a record of participation, never money (docs/specs/final-state.md, XP). The SQL twins live
// in the community migrations and are tested on the same values.

export const XP_PER_DOLLAR = 10;
export const PARTICIPATION_DAILY_CAP = 100;

export const TIERS = ['Spectator', 'Regular', 'Backer', 'Patron', 'Producer', 'Executive', 'Legend'] as const;

/** XP for a contribution of `cents` to a card of `rarity` (the Machine card counts as common). */
export function contributionXp(cents: number, rarity: Rarity): number {
  return Math.floor((cents / 100) * XP_PER_DOLLAR * RARITY_XP_MULTIPLIER[rarity]);
}

/** Total XP needed to reach level n (level 1 needs 0). */
export function xpForLevel(n: number): number {
  return n <= 1 ? 0 : Math.round(100 * (n - 1) ** 1.5);
}

export function levelFor(xp: number): number {
  let n = 1;
  while (xpForLevel(n + 1) <= xp) n += 1;
  return n;
}

/** The tier name for a level: a new tier every 10 levels, Legend from 60. */
export function tierFor(level: number): (typeof TIERS)[number] {
  return TIERS[Math.min(TIERS.length - 1, Math.max(0, Math.floor((level - 1) / 10)))] ?? 'Spectator';
}
