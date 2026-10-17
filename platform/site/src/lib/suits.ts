import type { Rarity, Suit } from './community-types';
import { rarityFromUnit } from './rarity';
import { sha256 } from './sha256';
import type { Card } from './source';

// A card's suit and rarity (docs/specs/final-state.md, Card suits and Rarity). The cards document
// carries both once the community data layer lands; until then a card's suit comes from its folder
// and its rarity from the published rule, rarity = f(sha256(card_id)), computed here in the same
// render. Rarity changes the card's face and XP only, never its price, bar, build or order.

export const SUIT_ORDER: readonly Suit[] = ['game', 'new_game', 'studio', 'platform', 'machine'];
export const RARITY_ORDER: readonly Rarity[] = ['common', 'uncommon', 'rare', 'legendary'];

/** The suit a folder gives: the game's folders fund the game, the platform folder the studio. */
export function suitOfFolder(folder: string): Suit {
  return folder === 'platform' ? 'studio' : 'game';
}

export function suitOf(card: Pick<Card, 'folder' | 'suit'>): Suit {
  return card.suit ?? suitOfFolder(card.folder);
}

/** The published rule, synchronously: the first four bytes of sha256(id) as a unit fraction. */
export function rarityOfId(id: string): Rarity {
  const digest = sha256(new TextEncoder().encode(id));
  const u = (((digest[0]! << 24) >>> 0) + (digest[1]! << 16) + (digest[2]! << 8) + digest[3]!) / 2 ** 32;
  return rarityFromUnit(u);
}

export function rarityOf(card: Pick<Card, 'id' | 'rarity'>): Rarity {
  return card.rarity ?? rarityOfId(card.id);
}

/** Suits a card's colour tile groups: the two game suits on the game tile, the rest on the studio tile. */
export function suitTile(suit: Suit): 'game' | 'studio' {
  return suit === 'game' || suit === 'new_game' ? 'game' : 'studio';
}
