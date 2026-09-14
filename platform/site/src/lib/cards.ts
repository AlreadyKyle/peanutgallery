import { copy } from './copy';
import type { Card } from './source';

export type CardStatus = 'building' | 'gated' | 'decided' | 'open';

const NOW_STAGES = new Set(['building', 'gated']);
const NEXT_RANK: Record<string, number> = { funded: 0, voted: 1, designing: 2, proposed: 3 };
const UNRANKED = 4;

function isNow(card: Card): boolean {
  return NOW_STAGES.has(card.stage);
}

/** Next order: funded, voted, designing, proposed; then the most funded; then the oldest. */
export function nextOrder(a: Card, b: Card): number {
  const rank = (NEXT_RANK[a.stage] ?? UNRANKED) - (NEXT_RANK[b.stage] ?? UNRANKED);
  if (rank !== 0) return rank;
  if (a.funded_usd !== b.funded_usd) return b.funded_usd - a.funded_usd;
  if (a.created_at === b.created_at) return 0;
  return a.created_at < b.created_at ? -1 : 1;
}

/** Now keeps the server order (created_at ascending); Next is sorted by nextOrder. */
export function splitCards(cards: Card[]): { now: Card[]; next: Card[] } {
  return {
    now: cards.filter(isNow),
    next: cards.filter((card) => !isNow(card)).sort(nextOrder),
  };
}

export function statusOf(card: Card): CardStatus {
  if (card.stage === 'building') return 'building';
  if (card.stage === 'gated') return 'gated';
  if (card.stage === 'voted' || card.stage === 'funded') return 'decided';
  return 'open';
}

export function isFullyFunded(card: Card): boolean {
  return card.funding_target_usd > 0 && card.funded_usd >= card.funding_target_usd;
}

export function canFund(card: Card): boolean {
  return card.shape === 'goal' && card.funding_target_usd > 0 && !isFullyFunded(card);
}

/** The Payment Link with client_reference_id set to the card id, which the webhook credits. */
export function fundLink(base: string, id: string): string {
  const joiner = base.includes('?') ? '&' : '?';
  return `${base}${joiner}client_reference_id=${encodeURIComponent(id)}`;
}

export function sourceLabel(source: string): string {
  const labels: Record<string, string> = copy.sources;
  return labels[source] ?? source;
}
