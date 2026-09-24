import type { Money } from './source';

/**
 * Test data only: a public_money row with every figure zero and the given cards in the funding
 * order, for unit tests that need a card to take money. Override any figure with `over`.
 */
export function books(order: readonly string[] = [], over: Partial<Money> = {}): Money {
  return {
    payments: 0,
    received_usd: 0,
    stripe_fees_usd: 0,
    refunded_usd: 0,
    disputed_usd: 0,
    corrections_usd: 0,
    studio_pct_avg: null,
    reserve_usd: 0,
    studio_usd: 0,
    incident_usd: 0,
    held_usd: 0,
    agent_credit_usd: 0,
    not_on_card_usd: 0,
    short_usd: 0,
    board_test_usd: 0,
    reconciled_at: null,
    last_run_ok: null,
    funding_order: order.map((card_id) => ({ card_id, room_usd: 1 })),
    ...over,
  };
}
