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

/**
 * The card Fund the next card in line funds first: the first place in the waterfall's order. Null when
 * no card takes money, the order did not load, or the first place's card is not in the snapshot (its
 * words arrive with /api/cards, which can lag /api/live's order), so the page never names a later card
 * the money would not reach first.
 */
export function nextInLine(snapshot: Snapshot): Card | null {
  const first = fundingOrder(snapshot)?.[0];
  if (first === undefined) return null;
  return snapshot.cards.find((card) => card.id === first.card_id) ?? null;
}

/** The waterfall's order loaded and lists no card: money given now waits in Not on a card yet. */
export function noCardTakesMoney(snapshot: Snapshot): boolean {
  return fundingOrder(snapshot)?.length === 0;
}

/**
 * Home's Fund what's next: each open card's place in the waterfall's order (0 first), the same order
 * /contribute offers, or null for a card the order leaves out (a vetoed card), which home neither counts
 * as open nor draws without its Fund this card among cards that have one. With the order unread every
 * open card has place 0, so home draws each, none with Fund this card, in the roadmap's order.
 */
export function fundingPlace(snapshot: Snapshot): (card: Card) => number | null {
  const order = fundingOrder(snapshot);
  if (order === null) return () => 0;
  const places = new Map(order.map((place, index) => [place.card_id, index]));
  return (card) => places.get(card.id) ?? null;
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

/** To four decimal places, as the database's numeric(12,4) money columns hold it. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** The worked split of a contribution after Stripe's fee, as apply_contribution computes it. */
export function exampleSplit(net: number) {
  const reserve = round4((net * RESERVE_PCT) / 100);
  const remainder = round4(net - reserve);
  const studio = round4((remainder * DEFAULT_STUDIO_PCT) / 100);
  const agents = round4(remainder - studio);
  const incident = round4((agents * INCIDENT_PCT) / 100);
  return { reserve, remainder, studio, agents, incident, credit: round4(agents - incident) };
}

// Stripe's fee in /how-it-works' worked example (docs/specs/copy-pass.md), from Stripe Canada's
// published card pricing, https://stripe.com/en-ca/pricing (read 26 September 2026): "2.9% + CA$0.30
// per successful transaction for domestic cards" and "+ 2% if currency conversion is required", since
// the studio's account is Canadian and charges US dollars. A card issued outside Canada adds "+ 0.8%
// for international cards", which the page says beside the figure. The CA$0.30 is in US dollars at
// the Bank of Canada's daily average for 25 September 2026, 1.4145 Canadian dollars to the US dollar
// (https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json): 0.30 / 1.4145 = $0.2121. The page
// labels the fee about, since a real fee moves with the card and the day's rate. No Stripe API is
// read: Stripe access is the board's alone.
export const STRIPE_EXAMPLE_FEE = { pct: 2.9, conversionPct: 2, fixedUsd: 0.2121 } as const;

/** Stripe's fee on a payment of `paid` US dollars by STRIPE_EXAMPLE_FEE, to four decimal places. */
export function exampleFee(paid: number): number {
  return round4((paid * (STRIPE_EXAMPLE_FEE.pct + STRIPE_EXAMPLE_FEE.conversionPct)) / 100 + STRIPE_EXAMPLE_FEE.fixedUsd);
}

/** A payment of `paid` US dollars worked through: Stripe's fee by the example constant, then the default split. */
export function exampleFromPaid(paid: number) {
  const fee = exampleFee(paid);
  const net = round4(paid - fee);
  return { paid, fee, net, ...exampleSplit(net) };
}
