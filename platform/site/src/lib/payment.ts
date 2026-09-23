import type { Card } from './source';

// Which cards take money, in what order, what each spends it on, the one address money goes to, and
// the split rule's worked example. The address is the Payment Link from netlify.toml (lib/env.ts),
// with the card's id as client_reference_id, which the webhook credits to that card. Kernel
// (platform/gate/kernel-paths.txt, docs/specs/board-site.md); the gate's payment-host scan also fails
// a build that carries any other payment address. cards.ts re-exports what the card layout uses.

/** What a card spends money on: the current game, the studio itself, or the next game. */
export type CardCategory = 'game' | 'studio' | 'next';
export type CategoryFilter = 'all' | CardCategory;
export const CATEGORY_FILTERS: readonly CategoryFilter[] = ['all', 'game', 'studio', 'next'];

/** Platform cards change the studio; every seed-1 card changes the current game. No card funds the next game yet. */
export function categoryOf(card: Card): CardCategory {
  return card.folder === 'platform' ? 'studio' : 'game';
}

export function isFullyFunded(card: Card): boolean {
  return card.funding_target_usd > 0 && card.funded_usd >= card.funding_target_usd;
}

/** A card takes money while it is a goal card with a target its bar has not reached. */
export function canFund(card: Card): boolean {
  return card.shape === 'goal' && card.funding_target_usd > 0 && !isFullyFunded(card);
}

// The stages a horizon now card leaves Fund what's next for: building, being checked, queued, shipped.
const PAST_FUNDING = new Set(['building', 'gated', 'funded', 'live']);
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

/** A horizon now card that is not yet building, queued or shipped: open for funding, or picked and still filling. */
export function isOpenForFunding(card: Card): boolean {
  return card.horizon === 'now' && !PAST_FUNDING.has(card.stage);
}

/** The cards a contribution can go to, in funding order: the choices /contribute offers. */
export function fundableCards(cards: readonly Card[]): Card[] {
  return cards.filter((card) => isOpenForFunding(card) && canFund(card)).sort(fundOrder);
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
