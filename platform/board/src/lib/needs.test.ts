import { describe, expect, it } from 'vitest';
import { dueItems, needsYouFrom, purchasedSinceRun } from './needs';

const RUN = {
  finished_at: '2026-09-24T07:07:00Z',
  ok: true,
  mismatches: 0,
  credit_purchase_usd: '12.5000',
  minimum_balance_usd: 3.25,
  settlement_amount: null,
  settlement_currency: 'usd',
  disputes_to_answer: [
    { dispute: 'du_b', status: 'needs_response', due_by: null, amount_usd: 2 },
    { dispute: 'du_a', status: 'needs_response', due_by: '2026-10-01', amount_usd: 5 },
    { status: 'needs_response', amount_usd: 1 },
  ],
  latest_payout: { id: 'po_1', arrival_date: '2026-09-23' },
};

describe('needsYouFrom', () => {
  it('reads the RPC and drops malformed parts instead of inventing them', () => {
    const data = needsYouFrom({ controller: RUN, last_credit_purchase: null, incident_reserve_usd: '0.40', s1_cards: [{ id: 'c1', title: 'Fix', stage: 'funded' }, { title: 'no id' }] });
    expect(data.controller?.credit_purchase_usd).toBe(12.5);
    expect(data.controller?.disputes_to_answer.map((d) => d.dispute)).toEqual(['du_b', 'du_a']);
    expect(data.incident_reserve_usd).toBe(0.4);
    expect(data.s1_cards).toEqual([{ id: 'c1', title: 'Fix', stage: 'funded' }]);
    expect(needsYouFrom({ controller: null, last_credit_purchase: { created_at: 'x' }, s1_cards: 'no' })).toEqual({
      controller: null,
      last_credit_purchase: null,
      incident_reserve_usd: 0,
      s1_cards: [],
      rule_blocked: [],
      approval_void: [],
    });
    expect(() => needsYouFrom(null)).toThrow('board_needs_you returned nothing');
  });
});

describe('dueItems', () => {
  it('is empty when there is no Controller run and no S1 card', () => {
    expect(dueItems(needsYouFrom({ controller: null, last_credit_purchase: null, incident_reserve_usd: 0, s1_cards: [] }))).toEqual([]);
  });

  it('orders disputes by due date with undated ones last, then S1 cards, then the credit purchase', () => {
    const items = dueItems(needsYouFrom({ controller: RUN, last_credit_purchase: null, incident_reserve_usd: 1, s1_cards: [{ id: 'c1', title: 'Fix', stage: 'funded' }] }));
    expect(items.map((item) => (item.kind === 'dispute' ? item.dispute : item.kind))).toEqual(['du_a', 'du_b', 'incident', 'credit']);
    expect(items.at(-1)).toMatchObject({
      kind: 'credit',
      amount_usd: 12.5,
      minimum_balance_usd: 3.25,
      draft: { amount_usd: 12.5, stripe_payout_id: 'po_1', reason: 'Controller figure of 2026-09-24' },
    });
  });

  it('lists no credit purchase when the figure is zero, or once a purchase is recorded after the run', () => {
    const zero = needsYouFrom({ controller: { ...RUN, credit_purchase_usd: 0, disputes_to_answer: [] }, last_credit_purchase: null, s1_cards: [] });
    expect(dueItems(zero)).toEqual([]);
    const bought = needsYouFrom({ controller: { ...RUN, disputes_to_answer: [] }, last_credit_purchase: { created_at: '2026-09-24T08:00:00Z', amount_usd: 12.5 }, s1_cards: [] });
    expect(purchasedSinceRun(bought)).toBe(true);
    expect(dueItems(bought)).toEqual([]);
    const before = needsYouFrom({ controller: { ...RUN, disputes_to_answer: [] }, last_credit_purchase: { created_at: '2026-09-20T08:00:00Z', amount_usd: 3 }, s1_cards: [] });
    expect(purchasedSinceRun(before)).toBe(false);
    expect(dueItems(before).map((item) => item.kind)).toEqual(['credit']);
  });

  it('leaves the payout id blank for the board to type when the run recorded none', () => {
    const items = dueItems(needsYouFrom({ controller: { ...RUN, latest_payout: null, disputes_to_answer: [] }, last_credit_purchase: null, s1_cards: [] }));
    expect(items).toMatchObject([{ kind: 'credit', draft: { stripe_payout_id: '' } }]);
  });
});

// docs/specs/agent-system-core.md: the ceiling pauses the rule will not resume, and the cards holding
// money whose approval is not current.
describe('rule_blocked and approval_void', () => {
  it('reads both lists and puts them after the S1 cards and before the credit purchase', () => {
    const data = needsYouFrom({
      controller: RUN,
      last_credit_purchase: null,
      incident_reserve_usd: 0,
      s1_cards: [{ id: 's1', title: 'Outage', stage: 'building' }],
      rule_blocked: [
        { id: 'max', title: 'At the maximum', why: 'card_max', actual_usd: '25.0000', card_max_usd: '25.0000' },
        { id: 'twice', title: 'Paused twice', why: 'resumed_before', actual_usd: '3.3750', card_max_usd: '25.0000' },
        { title: 'no id' },
      ],
      approval_void: [{ id: 'void', title: 'Rewritten', stage: 'proposed', money_usd: '2.0000' }],
    });
    expect(data.rule_blocked).toEqual([
      { id: 'max', title: 'At the maximum', why: 'card_max', actual_usd: 25, card_max_usd: 25 },
      { id: 'twice', title: 'Paused twice', why: 'resumed_before', actual_usd: 3.375, card_max_usd: 25 },
    ]);
    expect(data.approval_void).toEqual([{ id: 'void', title: 'Rewritten', stage: 'proposed', money_usd: 2 }]);
    expect(dueItems(data).map((item) => (item.kind === 'dispute' ? item.dispute : item.kind === 'credit' ? 'credit' : `${item.kind}:${item.card.id}`))).toEqual([
      'du_a',
      'du_b',
      'incident:s1',
      'approval_void:void',
      'rule_blocked:max',
      'rule_blocked:twice',
      'credit',
    ]);
  });
});
