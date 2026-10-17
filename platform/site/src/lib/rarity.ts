import type { Rarity } from './community-types';

// A card's rarity is a published, checkable function of its id (docs/specs/final-state.md, Rarity):
// u = the first four bytes of sha256(utf8(card_id)) as an unsigned integer over 2^32.
// The SQL twin is community.card_rarity(text) in the migrations; both are tested on the same vectors.
// Rarity changes XP and the card's face only, never its price, bar, build or order.

export const RARITY_ODDS: Readonly<Record<Rarity, number>> = {
  common: 0.7,
  uncommon: 0.2,
  rare: 0.08,
  legendary: 0.02,
};

export const RARITY_XP_MULTIPLIER: Readonly<Record<Rarity, number>> = {
  common: 1,
  uncommon: 1.5,
  rare: 2,
  legendary: 3,
};

export function rarityFromUnit(u: number): Rarity {
  if (u < RARITY_ODDS.legendary) return 'legendary';
  if (u < RARITY_ODDS.legendary + RARITY_ODDS.rare) return 'rare';
  if (u < RARITY_ODDS.legendary + RARITY_ODDS.rare + RARITY_ODDS.uncommon) return 'uncommon';
  return 'common';
}

export async function cardRarity(cardId: string): Promise<Rarity> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cardId)));
  const u = new DataView(digest.buffer).getUint32(0) / 2 ** 32;
  return rarityFromUnit(u);
}
