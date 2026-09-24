import { copy } from './copy';
import { CATEGORY_FILTERS, categoryOf, type CategoryFilter } from './payment';
import type { Card, Horizon } from './source';

// Which cards take money, their order, what each spends it on and the Payment Link address live in
// payment.ts (kernel); the card layout reads them from here.
export {
  canFund,
  CATEGORY_FILTERS,
  categoryOf,
  fundableCards,
  fundingPlace,
  fundLink,
  inFundingOrder,
  isFullyFunded,
  nextInLine,
  noCardTakesMoney,
  type CardCategory,
  type CategoryFilter,
} from './payment';

const NOW_STAGES = new Set(['building', 'gated']);
const QUEUED_STAGE = 'funded';
const SHIPPED_STAGE = 'live';

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
  /** Open for funding or picked by the board and still filling, in the waterfall's order (`place`). */
  fund: Card[];
  /** Funded and waiting for the agents, oldest first. */
  queued: Card[];
  /** Live, newest first. Never fundable, so never in fund. */
  shipped: Card[];
};

/**
 * Building, funding and queued hold horizon now cards only; a live card is shipped whatever its
 * horizon. `place` is fundingPlace(snapshot): with the waterfall's order loaded, fund holds only the
 * cards in it, in its order (docs/specs/money-surfaces.md); left out, every open card in the
 * roadmap's order.
 */
export function groupCards(cards: readonly Card[], place: (card: Card) => number | null = () => 0): CardGroups {
  const runnable = cards.filter(isRunnable);
  const elsewhere = (card: Card) =>
    NOW_STAGES.has(card.stage) || card.stage === QUEUED_STAGE || card.stage === SHIPPED_STAGE;
  return {
    now: runnable.filter((card) => NOW_STAGES.has(card.stage)),
    fund: runnable
      .filter((card) => !elsewhere(card) && place(card) !== null)
      .sort((a, b) => (place(a) ?? 0) - (place(b) ?? 0) || plannedOrder(a, b)),
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

/**
 * A card's face (Card.tsx): its look, state word and state glyph. Six come from the card's stage.
 * Paused and rejected faces are drawn only on the design guide; /ledger lists stopped cards as rows
 * (Stopped.tsx), never as faces (docs/specs/money-surfaces.md).
 */
export type Face = 'open' | 'picked' | 'funded' | 'building' | 'checks' | 'live' | 'paused' | 'rejected';
export const FACES: readonly Face[] = ['open', 'picked', 'funded', 'building', 'checks', 'live', 'paused', 'rejected'];

export function faceOf(card: Card): Face {
  if (card.stage === 'building') return 'building';
  if (card.stage === 'gated') return 'checks';
  if (card.stage === QUEUED_STAGE) return 'funded';
  if (card.stage === SHIPPED_STAGE) return 'live';
  if (card.stage === 'voted') return 'picked';
  return 'open';
}

/**
 * A card on the roadmap, not open: on horizon next or later and not yet started. Its own page draws
 * the roadmap's state (Cards.tsx plannedState) instead of a face, since faceOf would call it open for
 * funding and it takes no money.
 */
export function isPlanned(card: Card): boolean {
  const face = faceOf(card);
  return !isRunnable(card) && (face === 'open' || face === 'picked');
}

export function inCategory(card: Card, filter: CategoryFilter): boolean {
  return filter === 'all' || categoryOf(card) === filter;
}

/**
 * The category chips to show for these cards: All and Dust always, The studio only while at least
 * one card is in it. The platform code lane is closed at launch, so the studio chip stays hidden
 * until the board files studio cards again.
 */
export function visibleFilters(cards: readonly Card[]): CategoryFilter[] {
  return CATEGORY_FILTERS.filter(
    (filter) => filter === 'all' || filter === 'game' || cards.some((card) => inCategory(card, filter)),
  );
}

export function sourceLabel(source: string): string {
  const labels: Record<string, string> = copy.sources;
  return labels[source] ?? source;
}
