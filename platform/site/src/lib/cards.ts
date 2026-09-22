import { copy } from './copy';
import type { Card, Horizon } from './source';

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

/** When a card shipped: live_at, or updated_at for a row read before live_at existed. */
export function shippedAt(card: Card): string {
  return card.live_at ?? card.updated_at;
}

/** Shipped order: the newest ship first, then the newest card. */
export function shippedOrder(a: Card, b: Card): number {
  const shipped = time(shippedAt(b)) - time(shippedAt(a));
  if (shipped !== 0) return shipped;
  return time(b.created_at) - time(a.created_at);
}

/**
 * A card on horizon now: the only kind that takes money, shows a funding bar or runs. Next and
 * later cards are the roadmap, planned and not built, and never appear as open for funding.
 */
export function isRunnable(card: Card): boolean {
  return card.horizon === 'now';
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

/** Building, funding and queued hold horizon now cards only; a live card is shipped whatever its horizon. */
export function groupCards(cards: readonly Card[]): CardGroups {
  const runnable = cards.filter(isRunnable);
  const elsewhere = (card: Card) =>
    NOW_STAGES.has(card.stage) || card.stage === QUEUED_STAGE || card.stage === SHIPPED_STAGE;
  return {
    now: runnable.filter((card) => NOW_STAGES.has(card.stage)),
    fund: runnable.filter((card) => !elsewhere(card)).sort(fundOrder),
    queued: runnable.filter((card) => card.stage === QUEUED_STAGE),
    shipped: cards.filter((card) => card.stage === SHIPPED_STAGE).sort(shippedOrder),
  };
}

/** Roadmap order: ranked cards first, lowest rank first, then the oldest. */
export function plannedOrder(a: Card, b: Card): number {
  if (a.rank !== b.rank) {
    if (a.rank === null) return 1;
    if (b.rank === null) return -1;
    return a.rank - b.rank;
  }
  if (a.created_at === b.created_at) return 0;
  return a.created_at < b.created_at ? -1 : 1;
}

export type PlannedHorizon = Exclude<Horizon, 'now'>;
export const PLANNED_HORIZONS: readonly PlannedHorizon[] = ['next', 'later'];

/** The roadmap: cards on horizon next or later that have not shipped, each horizon in plannedOrder. */
export function plannedCards(cards: readonly Card[]): Record<PlannedHorizon, Card[]> {
  const open = cards.filter((card) => card.stage !== SHIPPED_STAGE);
  return {
    next: open.filter((card) => card.horizon === 'next').sort(plannedOrder),
    later: open.filter((card) => card.horizon === 'later').sort(plannedOrder),
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

/**
 * The category chips to show for these cards: All and Dust always, The studio and Next game only
 * while at least one card is in them. The platform code lane is closed at launch, so the studio
 * chip stays hidden until the board files studio cards again.
 */
export function visibleFilters(cards: readonly Card[]): CategoryFilter[] {
  return CATEGORY_FILTERS.filter(
    (filter) => filter === 'all' || filter === 'game' || cards.some((card) => inCategory(card, filter)),
  );
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
