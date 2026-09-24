import type { Card, FundingPlace, Snapshot } from './source';

// Which cards take money, in what order, what each spends it on, the one address money goes to, and
// the split rule's worked example. Which live cards take money, and in what order, is the database's
// waterfall (public_money.funding_order, docs/specs/money-logic.md); the site keeps no second copy of
// that rule (docs/specs/money-surfaces.md). The address is the Payment Link from netlify.toml (lib/env.ts),
// with the card's id as client_reference_id, which the webhook credits to that card. Kernel
// (platform/gate/kernel-paths.txt, docs/specs/board-site.md); the gate's payment-host scan also fails
// a build that carries any other payment address. cards.ts re-exports what the card layout uses.

/** What a card spends money on: the current game or the studio itself. Each is a suit (Glyph.tsx). */
export type CardCategory = 'game' | 'studio';
export type CategoryFilter = 'all' | CardCategory;
export const CATEGORY_FILTERS: readonly CategoryFilter[] = ['all', 'game', 'studio'];

/** Platform cards change the studio; every seed-1 card changes the current game. */
export function categoryOf(card: Card): CardCategory {
  return card.folder === 'platform' ? 'studio' : 'game';
}

export function isFullyFunded(card: Card): boolean {
  return card.funding_target_usd > 0 && card.funded_usd >= card.funding_target_usd;
}

/**
 * A goal card with a target its bar has not reached: the design guide's sample and /how-it-works'
 * example cards only. A live card takes money when it is in the funding order (inFundingOrder).
 */
export function canFund(card: Card): boolean {
  return card.shape === 'goal' && card.funding_target_usd > 0 && !isFullyFunded(card);
}

const FUND_RANK: Record<string, number> = { voted: 0, designing: 1, proposed: 2 };
const UNRANKED = 3;

/** Home's Fund what's next order: picked by the board first, then in design, then proposed; then the most funded; then the oldest. */
export function fundOrder(a: Card, b: Card): number {
  const rank = (FUND_RANK[a.stage] ?? UNRANKED) - (FUND_RANK[b.stage] ?? UNRANKED);
  if (rank !== 0) return rank;
  if (a.funded_usd !== b.funded_usd) return b.funded_usd - a.funded_usd;
  if (a.created_at === b.created_at) return 0;
  return a.created_at < b.created_at ? -1 : 1;
}

/** The waterfall's order, or null when public_money did not load (or a sample snapshot carries none). */
function fundingOrder(snapshot: Snapshot): FundingPlace[] | null {
  if (snapshot.missing.includes('money') || snapshot.money === undefined || snapshot.money === null) return null;
  return snapshot.money.funding_order;
}

/**
 * The cards money fills next, in the waterfall's order: the choices /contribute offers. Empty when
 * public_money did not load, so only Fund the next card in line is offered, which the waterfall
 * places safely. A card in the order the snapshot does not list is skipped.
 */
export function fundableCards(snapshot: Snapshot): Card[] {
  const order = fundingOrder(snapshot);
  if (order === null) return [];
  const cards = new Map(snapshot.cards.map((card) => [card.id, card]));
  return order.flatMap((place) => {
    const card = cards.get(place.card_id);
    return card === undefined ? [] : [card];
  });
}

/** The card Fund the next card in line funds first, or null when no card takes money or the order did not load. */
export function nextInLine(snapshot: Snapshot): Card | null {
  return fundableCards(snapshot)[0] ?? null;
}

/**
 * Which open cards home counts and draws as open for funding: with the order loaded, only a card in it,
 * so a card the waterfall leaves out (a vetoed card) is neither counted as open nor drawn without its
 * Fund this card among cards that have one; with the order unread, every open card, each drawn with no
 * Fund this card.
 */
export function openForFunding(snapshot: Snapshot): (card: Card) => boolean {
  const order = fundingOrder(snapshot);
  if (order === null) return () => true;
  const ids = new Set(order.map((place) => place.card_id));
  return (card) => ids.has(card.id);
}

/** Whether a card takes money now: it is in the funding order. False when the order did not load. */
export function inFundingOrder(snapshot: Snapshot, id: string): boolean {
  const order = fundingOrder(snapshot);
  return order !== null && order.some((place) => place.card_id === id);
}

/** The Payment Link with client_reference_id set to the card id, which the webhook credits. */
export function fundLink(base: string, id: string): string {
  const joiner = base.includes('?') ? '&' : '?';
  return `${base}${joiner}client_reference_id=${encodeURIComponent(id)}`;
}

// The fixed rules behind the split (PLAN.md §4 Kernel): 10% reserve, the default 80/20 split and 5%
// of the agents' share to the emergency fund while it holds under $500.
export const RESERVE_PCT = 10;
export const DEFAULT_STUDIO_PCT = 20;
export const INCIDENT_PCT = 5;

/** The worked split of a contribution after Stripe's fee, as apply_contribution computes it. */
export function exampleSplit(net: number) {
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  const reserve = round((net * RESERVE_PCT) / 100);
  const remainder = net - reserve;
  const studio = round((remainder * DEFAULT_STUDIO_PCT) / 100);
  const agents = remainder - studio;
  const incident = round((agents * INCIDENT_PCT) / 100);
  return { reserve, studio, agents, incident, credit: agents - incident };
}
