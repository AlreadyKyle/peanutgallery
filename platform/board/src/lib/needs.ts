import type { SupabaseClient } from '@supabase/supabase-js';
import { toNumber } from './format';

// The "Needs you" inbox (docs/specs/board-site.md): the board's standing duties from the launch
// plan, each listed only when it is due, from what board_needs_you returns. Most days the list is
// empty. The duties with nothing to read (refund email, kernel pull requests) are standing lines
// under the list, never a count.

/**
 * The repository's open pull requests from any branch but a card branch: the ones only the board
 * merges. The dispatcher merges only the card/* branches it opens, on a green gate; every other pull
 * request (board work, HR's text changes, the Claude Code pin, a dependency update) changes a kernel
 * path or is the board's to judge. GitHub's head: qualifier matches the start of the branch name, so
 * -head:card/ leaves out exactly the card branches, and no one has to remember to label anything.
 */
export const BOARD_PULLS_URL = 'https://github.com/AlreadyKyle/peanutgallery/pulls?q=is%3Apr+is%3Aopen+-head%3Acard%2F';
export const CONTACT_EMAIL = 'hello@peanutgallery.games';
export const STRIPE_DISPUTES_URL = 'https://dashboard.stripe.com/disputes';
export const CONSOLE_BILLING_URL = 'https://console.anthropic.com/settings/billing';
export const STRIPE_PAYOUT_SETTINGS_URL = 'https://dashboard.stripe.com/settings/payouts';

export type DisputeToAnswer = {
  dispute: string;
  status: string;
  /** The day Stripe needs the answer by, YYYY-MM-DD, or null when Stripe gave none. */
  due_by: string | null;
  amount_usd: number;
};

/** The Controller's latest reconcile run, as far as the inbox needs it. */
export type ControllerRun = {
  finished_at: string;
  ok: boolean;
  mismatches: number;
  /** What to buy now; 0 when no purchase is due. */
  credit_purchase_usd: number;
  /** The Minimum balance figure in USD, and in the currency Stripe settles in. */
  minimum_balance_usd: number;
  settlement_amount: number | null;
  settlement_currency: string | null;
  disputes_to_answer: DisputeToAnswer[];
  /** The newest paid payout Stripe listed, or null when the run recorded none. */
  latest_payout: { id: string; arrival_date: string | null } | null;
};

export type S1Card = { id: string; title: string; stage: string };

export type NeedsYouData = {
  controller: ControllerRun | null;
  last_credit_purchase: { created_at: string; amount_usd: number } | null;
  incident_reserve_usd: number;
  s1_cards: S1Card[];
};

/** What the credit item fills into the Record a credit purchase form. */
export type CreditDraft = { amount_usd: number; stripe_payout_id: string; reason: string };

export type NeedsItem =
  | {
      kind: 'credit';
      amount_usd: number;
      minimum_balance_usd: number;
      settlement_amount: number | null;
      settlement_currency: string | null;
      draft: CreditDraft;
    }
  | { kind: 'dispute'; dispute: string; status: string; due_by: string | null; amount_usd: number }
  | { kind: 'incident'; card: S1Card; incident_reserve_usd: number };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' || typeof value === 'string' ? toNumber(value) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function disputesFrom(value: unknown): DisputeToAnswer[] {
  if (!Array.isArray(value)) return [];
  const out: DisputeToAnswer[] = [];
  for (const item of value) {
    const row = record(item);
    const dispute = text(row?.dispute);
    const amount = num(row?.amount_usd);
    if (row === null || dispute === null || amount === null) continue;
    out.push({ dispute, status: text(row.status) ?? '', due_by: text(row.due_by), amount_usd: amount });
  }
  return out;
}

function controllerFrom(value: unknown): ControllerRun | null {
  const row = record(value);
  const finished = text(row?.finished_at);
  if (row === null || finished === null) return null;
  const payout = record(row.latest_payout);
  const payoutId = text(payout?.id);
  return {
    finished_at: finished,
    ok: row.ok === true,
    mismatches: num(row.mismatches) ?? 0,
    credit_purchase_usd: num(row.credit_purchase_usd) ?? 0,
    minimum_balance_usd: num(row.minimum_balance_usd) ?? 0,
    settlement_amount: num(row.settlement_amount),
    settlement_currency: text(row.settlement_currency),
    disputes_to_answer: disputesFrom(row.disputes_to_answer),
    latest_payout: payoutId === null ? null : { id: payoutId, arrival_date: text(payout?.arrival_date) },
  };
}

/** Reads what board_needs_you returns, keeping only well-formed parts. */
export function needsYouFrom(raw: unknown): NeedsYouData {
  const row = record(raw);
  if (row === null) throw new Error('board_needs_you returned nothing');
  const purchase = record(row.last_credit_purchase);
  const purchaseAt = text(purchase?.created_at);
  const purchaseUsd = num(purchase?.amount_usd);
  const cards = Array.isArray(row.s1_cards) ? row.s1_cards : [];
  return {
    controller: controllerFrom(row.controller),
    last_credit_purchase: purchaseAt === null || purchaseUsd === null ? null : { created_at: purchaseAt, amount_usd: purchaseUsd },
    incident_reserve_usd: num(row.incident_reserve_usd) ?? 0,
    s1_cards: cards
      .map(record)
      .filter((card): card is Record<string, unknown> => card !== null && text(card.id) !== null)
      .map((card) => ({ id: String(card.id), title: text(card.title) ?? String(card.id), stage: text(card.stage) ?? '' })),
  };
}

export async function fetchNeedsYou(client: SupabaseClient): Promise<NeedsYouData> {
  const { data, error } = await client.rpc('board_needs_you');
  if (error) throw new Error(error.message);
  return needsYouFrom(data);
}

/** True when a credit purchase was recorded after the Controller's latest run, so its figure is spent. */
export function purchasedSinceRun(data: NeedsYouData): boolean {
  if (data.controller === null || data.last_credit_purchase === null) return false;
  return Date.parse(data.last_credit_purchase.created_at) > Date.parse(data.controller.finished_at);
}

/**
 * The duties that are due now, most urgent first: disputes by their due date, then an S1 card that
 * may need the emergency fund converted, then the credit purchase after a payout.
 */
export function dueItems(data: NeedsYouData): NeedsItem[] {
  const items: NeedsItem[] = [];
  const run = data.controller;
  const disputes = [...(run?.disputes_to_answer ?? [])].sort((a, b) => (a.due_by ?? '9999').localeCompare(b.due_by ?? '9999'));
  for (const dispute of disputes) items.push({ kind: 'dispute', ...dispute });
  for (const card of data.s1_cards) items.push({ kind: 'incident', card, incident_reserve_usd: data.incident_reserve_usd });
  if (run !== null && run.credit_purchase_usd > 0 && !purchasedSinceRun(data)) {
    items.push({
      kind: 'credit',
      amount_usd: run.credit_purchase_usd,
      minimum_balance_usd: run.minimum_balance_usd,
      settlement_amount: run.settlement_amount,
      settlement_currency: run.settlement_currency,
      draft: {
        amount_usd: run.credit_purchase_usd,
        stripe_payout_id: run.latest_payout?.id ?? '',
        reason: `Controller figure of ${run.finished_at.slice(0, 10)}`,
      },
    });
  }
  return items;
}
