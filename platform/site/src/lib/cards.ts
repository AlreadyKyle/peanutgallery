import { copy } from './copy';
import type { Card } from './source';

export type CardStatus = 'building' | 'gated' | 'queued' | 'picked' | 'open' | 'shipped';

/** What a card spends money on: the current game, the studio itself, or the next game. */
export type CardCategory = 'game' | 'studio' | 'next';
export type CategoryFilter = 'all' | CardCategory;
export const CATEGORY_FILTERS: readonly CategoryFilter[] = ['all', 'game', 'studio', 'next'];

const NOW_STAGES = new Set(['building', 'gated']);
const QUEUED_STAGE = 'funded';
const SHIPPED_STAGE = 'live';
const FUND_RANK: Record<string, number> = { voted: 0, designing: 1, proposed: 2 };
const UNRANKED = 3;

/** Funding order: picked by the board first, then in design, then proposed; then the most funded; then the oldest. */
export function fundOrder(a: Card, b: Card): number {
  const rank = (FUND_RANK[a.stage] ?? UNRANKED) - (FUND_RANK[b.stage] ?? UNRANKED);
  if (rank !== 0) return rank;
  if (a.funded_usd !== b.funded_usd) return b.funded_usd - a.funded_usd;
  if (a.created_at === b.created_at) return 0;
  return a.created_at < b.created_at ? -1 : 1;
}

function time(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/** Shipped order: the newest ship first (the latest updated_at), then the newest card. */
export function shippedOrder(a: Card, b: Card): number {
  const shipped = time(b.updated_at) - time(a.updated_at);
  if (shipped !== 0) return shipped;
  return time(b.created_at) - time(a.created_at);
}

export type CardGroups = {
  /** Building or in the gate, in server order. */
  now: Card[];
  /** Open for funding or picked by the board and still filling, in fundOrder. */
  fund: Card[];
  /** Funded and waiting for the agents, oldest first. */
  queued: Card[];
  /** Live, newest first. Never fundable, so never in fund. */
  shipped: Card[];
};

export function groupCards(cards: readonly Card[]): CardGroups {
  const elsewhere = (card: Card) =>
    NOW_STAGES.has(card.stage) || card.stage === QUEUED_STAGE || card.stage === SHIPPED_STAGE;
  return {
    now: cards.filter((card) => NOW_STAGES.has(card.stage)),
    fund: cards.filter((card) => !elsewhere(card)).sort(fundOrder),
    queued: cards.filter((card) => card.stage === QUEUED_STAGE),
    shipped: cards.filter((card) => card.stage === SHIPPED_STAGE).sort(shippedOrder),
  };
}

export function statusOf(card: Card): CardStatus {
  if (card.stage === 'building') return 'building';
  if (card.stage === 'gated') return 'gated';
  if (card.stage === QUEUED_STAGE) return 'queued';
  if (card.stage === SHIPPED_STAGE) return 'shipped';
  if (card.stage === 'voted') return 'picked';
  return 'open';
}

/** Platform cards change the studio; every seed-1 card changes the current game. No card funds the next game yet. */
export function categoryOf(card: Card): CardCategory {
  return card.folder === 'platform' ? 'studio' : 'game';
}

export function inCategory(card: Card, filter: CategoryFilter): boolean {
  return filter === 'all' || categoryOf(card) === filter;
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
