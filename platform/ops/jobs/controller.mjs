// The Controller (docs/specs/money-safety.md): a daily deterministic reconciliation of the books
// against Stripe, run by peanutgallery-controller.timer on the VPS, outside the dispatcher. It reads
// Stripe with the restricted read key only (GET requests; it cannot move money) and the database with
// the service key, and it writes one controller_runs row per run. On any mismatch it alerts the board
// through ntfy (and healthchecks.io /fail when a Controller check URL is set).
//
// What it checks:
// - the ledger identity, in SQL (ledger_identity);
// - every paid Checkout Session has exactly one payment row, with the same amount and a net equal to
//   the amount less Stripe's fee, and every payment row is a paid session (a gap is a webhook the
//   studio missed: the alert says which event to resend from the Stripe Dashboard, since the Controller
//   holds no key that could replay it);
// - each charge's refunded total matches the refund rows, and each dispute that withdrew funds has
//   dispute rows; a dispute Stripe closed as won is put back with record_dispute_reinstated;
// - every fee Stripe charged or returned on a dispute is booked with record_stripe_fee, once per
//   balance transaction (a replay books nothing); the fee Stripe keeps on a refund or dispute is on
//   the refund or dispute row itself (docs/specs/money-logic.md);
// - what Stripe holds for each payment (the charge less its fee, refunds and dispute movements) equals
//   the net the books carry, so every fee Stripe kept is booked (an adjustment row fixes a gap); a
//   payment whose dispute fee this run booked is compared on the next run;
// - each paid payout's balance transactions sum to its amount;
// - the webhook events Stripe could not deliver in the last 30 days;
// - the Console credit bought covers the studio and overhead spend, and Stripe's balance covers the
//   Minimum balance figure.
// What it computes for the board:
// - the next Console credit purchase: the remaining ceilings of funded cards, plus overhead spent
//   since the last purchase, less the credit left; never more than the agent money Stripe has paid out and not
//   yet converted, plus the overhead. Agent money is agents less the incident share less any hold,
//   so the reserve, the incident fund and held money are never in it, and the board's own test
//   payment (board_test in controller_figures) is left out;
// - the Minimum balance figure: the 10% reserve, plus held money, plus the Stripe fees on the last
//   30 days' charges (what Stripe would keep if every one were refunded);
// - the newest paid payout, whose id the board's Needs you inbox fills into the credit purchase form
//   (docs/specs/board-site.md).
import { readFileSync } from 'node:fs';
import { alerter, floor2, jobEnvProblems, JobEnvError, round2, round4, stripeApiVersion, stripeReader, supabaseClient, toCents } from './lib.mjs';

// How far back Stripe lets the Events API read, and the window of fees in the Minimum balance.
export const EVENT_WINDOW_DAYS = 30;
export const FEE_WINDOW_DAYS = 30;
// Differences at or under half a cent are rounding.
export const TOLERANCE_USD = 0.005;
// Dispute statuses where Stripe has withdrawn the funds.
export const WITHDRAWN_STATUSES = ['needs_response', 'under_review', 'won', 'lost'];
const DAY_MS = 86_400_000;

// The event types the webhook handles, read from their one definition.
export function webhookEventTypes(file = new URL('../../supabase/functions/_shared/webhook_events.ts', import.meta.url)) {
  const types = [...readFileSync(file, 'utf8').matchAll(/_EVENT = "([a-z_.]+)";/g)].map((match) => match[1]);
  if (types.length === 0) throw new Error('no webhook event types found');
  return types;
}

const id = (value) => (typeof value === 'string' ? value : (value?.id ?? null));
const usdDate = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);

// Settlement currency per USD for one balance transaction: 1 when it settled in USD.
function rateOf(bt) {
  if (!bt || typeof bt !== 'object') return null;
  if (String(bt.currency).toLowerCase() === 'usd') return 1;
  return Number(bt.exchange_rate) > 0 ? Number(bt.exchange_rate) : null;
}

// Everything the Controller reads from Stripe, GET only.
export async function readStripe(stripe, now, eventTypes = webhookEventTypes()) {
  const since = Math.floor((now.getTime() - EVENT_WINDOW_DAYS * DAY_MS) / 1000);
  const [sessions, charges, disputes, payouts, undelivered, balance] = await Promise.all([
    stripe.list('checkout/sessions', { status: 'complete' }),
    stripe.list('charges', { 'expand[]': 'data.balance_transaction' }),
    stripe.list('disputes'),
    stripe.list('payouts', { status: 'paid' }),
    stripe.list('events', { delivery_success: 'false', 'types[]': eventTypes, 'created[gte]': since }),
    stripe.get('balance'),
  ]);
  const payoutTransactions = {};
  const truncated = [];
  for (const [name, list] of Object.entries({ sessions, charges, disputes, payouts, undelivered })) if (list.truncated) truncated.push(name);
  for (const payout of payouts.items) {
    const list = await stripe.list('balance_transactions', { payout: payout.id });
    payoutTransactions[payout.id] = list.items;
    if (list.truncated) truncated.push(`balance_transactions of ${payout.id}`);
  }
  return {
    sessions: sessions.items,
    charges: charges.items,
    disputes: disputes.items,
    payouts: payouts.items,
    payoutTransactions,
    undelivered: undelivered.items,
    balance,
    truncated,
  };
}

function check(name, items, okDetail) {
  return { name, ok: items.length === 0, detail: items.length === 0 ? okDetail : `${items.length} to look at`, items };
}

// The reconciliation itself: pure, from the database's figures and what Stripe returned.
export function reconcile({ identity, figures, stripe, now }) {
  const families = (figures.families ?? []).filter((family) => family.rail === 'stripe');
  const bySession = new Map(families.filter((f) => f.session_id).map((f) => [f.session_id, f]));
  const legacy = families.filter((f) => !f.session_id);
  const paidSessions = stripe.sessions.filter((s) => s.payment_status === 'paid');
  const chargeByIntent = new Map();
  for (const charge of stripe.charges) {
    const intent = id(charge.payment_intent);
    if (!intent || charge.status !== 'succeeded') continue;
    chargeByIntent.set(intent, charge);
  }
  const familyOf = new Map();
  const matchedLegacy = new Set();

  // Payments: each paid session has one payment row with the same amount, and a net of the amount
  // less the fee. A payment made before the webhook recorded session ids is paired by amount and day.
  const missing = [];
  const amounts = [];
  const nonUsd = [];
  for (const session of paidSessions) {
    if (String(session.currency).toLowerCase() !== 'usd') {
      nonUsd.push({ session: session.id, currency: session.currency });
      continue;
    }
    let family = bySession.get(session.id);
    if (!family) {
      family = legacy.find(
        (f) => !matchedLegacy.has(f.payment_id) && toCents(f.amount_usd) === session.amount_total && Math.abs(Date.parse(f.created_at) - session.created * 1000) <= DAY_MS,
      );
      if (family) matchedLegacy.add(family.payment_id);
    }
    if (!family) {
      missing.push({
        session: session.id,
        amount_usd: session.amount_total / 100,
        paid_on: usdDate(session.created),
        fix: "the webhook missed this payment: resend its checkout.session.completed event from the Stripe Dashboard (Developers, Events) while it is under 30 days old, or the board credits it by hand",
      });
      continue;
    }
    familyOf.set(session.id, family);
    const charge = chargeByIntent.get(id(session.payment_intent));
    const bt = charge && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null;
    const rate = rateOf(bt);
    if (toCents(family.amount_usd) !== session.amount_total) {
      amounts.push({ session: session.id, books_usd: Number(family.amount_usd), stripe_usd: session.amount_total / 100 });
    } else if (bt && rate) {
      const fee = round4(bt.fee / 100 / rate);
      const expected = round4(session.amount_total / 100 - fee);
      if (Math.abs(Number(family.net_usd) - expected) > 0.0001) amounts.push({ session: session.id, books_net_usd: Number(family.net_usd), stripe_net_usd: expected });
    }
  }
  const unknown = [];
  const sessionIds = new Set(paidSessions.map((s) => s.id));
  if (!stripe.truncated.includes('sessions')) {
    for (const family of families) {
      if (family.session_id && !sessionIds.has(family.session_id)) unknown.push({ payment: family.payment_id, session: family.session_id, amount_usd: Number(family.amount_usd) });
    }
  }

  // Refunds, disputes and what Stripe holds against what the books carry, per payment.
  const refunds = [];
  const disputesMissing = [];
  const reinstate = [];
  const fees = [];
  const attention = [];
  const unbooked = [];
  const disputesByCharge = new Map();
  for (const dispute of stripe.disputes) {
    const charge = id(dispute.charge);
    if (!disputesByCharge.has(charge)) disputesByCharge.set(charge, []);
    disputesByCharge.get(charge).push(dispute);
  }
  for (const session of paidSessions) {
    const family = familyOf.get(session.id);
    const charge = chargeByIntent.get(id(session.payment_intent));
    if (!family || !charge) continue;
    const refunded = charge.amount_refunded / 100;
    if (Math.abs(refunded - Number(family.refunded_usd)) > TOLERANCE_USD) {
      refunds.push({ session: session.id, charge: charge.id, stripe_refunded_usd: refunded, books_refunded_usd: Number(family.refunded_usd), fix: 'resend the charge.refunded event from the Stripe Dashboard' });
    }
    const bt = typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null;
    const rate = rateOf(bt);
    let disputeFlow = 0;
    let disputeFees = 0;
    let complete = Boolean(bt && rate);
    for (const dispute of disputesByCharge.get(charge.id) ?? []) {
      if (String(dispute.status).startsWith('warning_')) {
        if (dispute.status === 'warning_needs_response') attention.push({ dispute: dispute.id, status: dispute.status, due_by: dispute.evidence_details?.due_by ? usdDate(dispute.evidence_details.due_by) : null, amount_usd: dispute.amount / 100 });
        continue;
      }
      if (dispute.status === 'needs_response') attention.push({ dispute: dispute.id, status: dispute.status, due_by: dispute.evidence_details?.due_by ? usdDate(dispute.evidence_details.due_by) : null, amount_usd: dispute.amount / 100 });
      if (WITHDRAWN_STATUSES.includes(dispute.status) && Number(family.disputed_usd) <= 0) {
        disputesMissing.push({ dispute: dispute.id, session: session.id, status: dispute.status, amount_usd: dispute.amount / 100, fix: 'resend the charge.dispute.funds_withdrawn event from the Stripe Dashboard' });
      }
      if (dispute.status === 'won' && Number(family.reinstated_usd) < Number(family.disputed_usd) - TOLERANCE_USD) {
        reinstate.push({ dispute_id: dispute.id, session_id: session.id, amount_usd: dispute.amount / 100 });
      }
      for (const movement of dispute.balance_transactions ?? []) {
        const movementRate = rateOf(movement) ?? rate;
        if (!movementRate) {
          complete = false;
          continue;
        }
        disputeFlow += movement.amount / 100 / movementRate;
        disputeFees += movement.fee / 100 / movementRate;
        // Stripe's dispute fee (and its return on a win) is booked once per balance transaction.
        if (movement.fee !== 0 && typeof movement.id === 'string') {
          fees.push({ ref: movement.id, session_id: session.id, fee_usd: round4(movement.fee / 100 / movementRate) });
        }
      }
    }
    // A payment whose won dispute is put back in this run is compared on the next, once its
    // reinstated row is in the books.
    if (complete && !reinstate.some((r) => r.session_id === session.id)) {
      const held = round4(session.amount_total / 100 - bt.fee / 100 / rate - refunded + disputeFlow - disputeFees);
      const books = Number(family.books_net_usd);
      const gap = round4(books - held);
      if (Math.abs(gap) > TOLERANCE_USD) {
        unbooked.push({
          session: session.id,
          payment: family.payment_id,
          books_net_usd: round4(books),
          stripe_net_usd: held,
          fix: gap > 0 ? `Stripe kept $${gap.toFixed(4)} the books do not carry: record an adjustment of net ${(-gap).toFixed(4)}, studio ${(-gap).toFixed(4)} on this payment at /board` : `Stripe holds $${(-gap).toFixed(4)} more than the books: look before booking anything`,
        });
      }
    }
  }

  // Payouts: each paid payout's transactions sum to it, and its charges are paid-out money.
  const payoutsOff = [];
  const paidOutCharges = new Set();
  for (const payout of stripe.payouts) {
    const transactions = stripe.payoutTransactions[payout.id] ?? [];
    const sum = transactions.filter((t) => t.type !== 'payout').reduce((total, t) => total + t.net, 0);
    if (sum !== payout.amount) payoutsOff.push({ payout: payout.id, amount: payout.amount, transactions_sum: sum, currency: payout.currency });
    for (const t of transactions) if (t.type === 'charge' || t.type === 'payment') paidOutCharges.add(id(t.source));
  }
  let paidOutAgentUsd = 0;
  for (const session of paidSessions) {
    const family = familyOf.get(session.id);
    const charge = chargeByIntent.get(id(session.payment_intent));
    // The board's own test payment is booked apart and never buys the agents' credit.
    if (family && charge && paidOutCharges.has(charge.id) && family.board_test !== true) paidOutAgentUsd += Number(family.agent_money_usd);
  }
  paidOutAgentUsd = round4(paidOutAgentUsd);

  // The newest paid payout, by the day it arrived, for the credit purchase the board records.
  const newest = [...stripe.payouts].sort((a, b) => (b.arrival_date ?? 0) - (a.arrival_date ?? 0) || String(b.id).localeCompare(String(a.id)))[0] ?? null;
  const latestPayout = newest === null
    ? null
    : { id: newest.id, arrival_date: typeof newest.arrival_date === 'number' ? usdDate(newest.arrival_date) : null, amount: newest.amount / 100, currency: String(newest.currency).toLowerCase() };

  const undelivered = stripe.undelivered.map((event) => ({ event: event.id, type: event.type, created_on: usdDate(event.created), fix: 'resend it from the Stripe Dashboard (Developers, Events)' }));

  // Console credit and the purchase formula.
  const credit = figures.credit;
  const bought = Number(credit.bought_usd);
  const spent = Number(credit.studio_spend_usd) + Number(credit.overhead_usd);
  const creditLeft = round4(bought - spent);
  // Not a check (PLAN.md §10 decision 65): the studio key's real Console balance is the limit, so
  // spend above the credit recorded at /board is not a mismatch.
  const creditItems = [];
  const need = round4(Number(figures.funded_cards.remaining_ceilings_usd) + Number(credit.overhead_since_last_purchase_usd) - creditLeft);
  const cap = round4(paidOutAgentUsd + Number(credit.overhead_usd) - bought);
  const purchase = floor2(Math.max(0, Math.min(need, cap)));

  // The Minimum balance figure, and Stripe's balance against it.
  const since = now.getTime() / 1000 - FEE_WINDOW_DAYS * DAY_MS / 1000;
  let recentFees = 0;
  let latest = null;
  for (const charge of stripe.charges) {
    const bt = typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null;
    const rate = rateOf(bt);
    if (!bt || !rate || charge.status !== 'succeeded') continue;
    if (charge.created >= since) recentFees += bt.fee / 100 / rate;
    if (!latest || charge.created > latest.created) latest = { created: charge.created, rate, currency: String(bt.currency).toLowerCase() };
  }
  const minimumUsd = round2(Number(figures.pool.reserve_usd) + Number(figures.pool.held_usd) + recentFees);
  const settlement = latest?.currency ?? 'usd';
  const settlementRate = latest?.rate ?? 1;
  const minimumSettlementCents = Math.ceil(minimumUsd * 100 * settlementRate);
  const balanceCents = ['available', 'pending'].reduce(
    (total, part) => total + (stripe.balance?.[part] ?? []).filter((b) => String(b.currency).toLowerCase() === settlement).reduce((sum, b) => sum + b.amount, 0),
    0,
  );
  const balanceItems = balanceCents < minimumSettlementCents ? [{ balance: balanceCents / 100, minimum: minimumSettlementCents / 100, currency: settlement, fix: "Stripe's balance is below the Minimum balance figure: raise the Minimum balance in Stripe at the next payout, and look for money that left" }] : [];

  const identityItems = identity?.holds === true ? [] : (identity?.lines ?? [{ error: identity?.error ?? 'no result' }]).filter((line) => line.holds !== true);
  const checks = [
    check('ledger_identity', identityItems, 'the pool matches the rows'),
    check('payments_credited', missing, `${paidSessions.length} paid sessions each have a payment row`),
    check('payments_known', unknown, 'every payment row is a paid session'),
    check('payment_amounts', amounts, 'amounts and nets match Stripe'),
    check('payment_currency', nonUsd, 'every paid session is in USD'),
    check('refunds_booked', refunds, "every charge's refunds are booked"),
    check('disputes_booked', disputesMissing, 'every dispute that withdrew funds is booked'),
    check('stripe_costs_booked', unbooked, 'what Stripe holds for each payment matches the books'),
    check('payouts_sum', payoutsOff, `${stripe.payouts.length} paid payouts each sum to their transactions`),
    check('webhook_delivered', undelivered, `no undelivered webhook event in the last ${EVENT_WINDOW_DAYS} days`),
    check('console_credit', creditItems, 'the credit bought covers the studio and overhead spend'),
    check('minimum_balance', balanceItems, "Stripe's balance covers the Minimum balance figure"),
    check('stripe_lists_complete', stripe.truncated.map((name) => ({ list: name })), 'every Stripe list was read to its end'),
  ];
  const mismatches = checks.reduce((total, c) => total + c.items.length, 0);
  return {
    ok: mismatches === 0,
    mismatches,
    checks,
    reinstate,
    fees,
    attention,
    figures: {
      credit_purchase_usd: purchase,
      credit_purchase: {
        remaining_ceilings_usd: Number(figures.funded_cards.remaining_ceilings_usd),
        funded_cards: Number(figures.funded_cards.count),
        overhead_since_last_purchase_usd: Number(credit.overhead_since_last_purchase_usd),
        credit_left_usd: creditLeft,
        need_usd: need,
        paid_out_agent_money_usd: paidOutAgentUsd,
        overhead_usd: Number(credit.overhead_usd),
        bought_usd: bought,
        cap_usd: cap,
      },
      minimum_balance_usd: minimumUsd,
      minimum_balance: {
        reserve_usd: Number(figures.pool.reserve_usd),
        held_usd: Number(figures.pool.held_usd),
        recent_fees_usd: round4(recentFees),
        fee_window_days: FEE_WINDOW_DAYS,
        settlement_currency: settlement,
        settlement_rate: settlementRate,
        settlement_amount: minimumSettlementCents / 100,
      },
      stripe_balance: { currency: settlement, amount: balanceCents / 100 },
      disputes_to_answer: attention,
      latest_payout: latestPayout,
      paid_sessions: paidSessions.length,
      payouts: stripe.payouts.length,
    },
  };
}

// One line for the board, naming each failing check and its first items.
export function alertMessage(result) {
  const failing = result.checks.filter((c) => !c.ok);
  const parts = [];
  if (failing.length > 0) {
    parts.push(`Controller: ${result.mismatches} mismatch(es) between the books and Stripe.`);
    for (const c of failing) parts.push(`${c.name}: ${c.items.slice(0, 3).map((item) => JSON.stringify(item)).join('; ')}${c.items.length > 3 ? ` and ${c.items.length - 3} more` : ''}`);
  }
  for (const dispute of result.attention) parts.push(`Dispute ${dispute.dispute} (${dispute.status}, $${dispute.amount_usd.toFixed(2)}) needs an answer in Stripe${dispute.due_by ? ` by ${dispute.due_by}` : ''}.`);
  parts.push(`Credit to buy now: $${result.figures.credit_purchase_usd.toFixed(2)}. Minimum balance: $${result.figures.minimum_balance_usd.toFixed(2)} USD (${result.figures.minimum_balance.settlement_amount.toFixed(2)} ${result.figures.minimum_balance.settlement_currency.toUpperCase()}).`);
  return parts.join('\n').slice(0, 3500);
}

export async function runController({ env, fetchFn = fetch, now = new Date(), dryRun = false, out = process.stdout }) {
  const problems = jobEnvProblems('controller', env);
  if (problems.length > 0) throw new JobEnvError('controller', problems);
  const db = supabaseClient({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, fetchFn });
  const stripe = stripeReader({ key: env.STRIPE_READ_KEY, fetchFn, version: stripeApiVersion() });
  const alerts = alerter({ ntfyUrl: env.NTFY_TOPIC_URL, healthcheckUrl: env.CONTROLLER_HEALTHCHECK_URL, fetchFn, title: 'Mob Machine Controller' });

  const startedAt = now.toISOString();
  const [identity, figures] = await Promise.all([db.rpc('ledger_identity'), db.rpc('controller_figures')]);
  const stripeData = await readStripe(stripe, now);
  const result = reconcile({ identity, figures, stripe: stripeData, now });

  // A dispute Stripe closed as won is put back; a refusal is a mismatch for the board.
  const reinstated = [];
  for (const action of result.reinstate) {
    if (dryRun) {
      reinstated.push({ ...action, done: false, dry_run: true });
      continue;
    }
    try {
      const done = await db.rpc('record_dispute_reinstated', { p_dispute_id: action.dispute_id, p_stripe_session_id: action.session_id, p_amount_usd: action.amount_usd });
      reinstated.push({ ...action, done: done?.inserted === true || done?.replay === true, reinstated_usd: done?.reinstated_usd ?? null });
    } catch (error) {
      reinstated.push({ ...action, done: false, error: error.message });
    }
  }
  const refused = reinstated.filter((r) => !r.done && !r.dry_run);

  // Every dispute fee Stripe reports is booked; record_stripe_fee inserts only the first time. A
  // payment whose fee this run booked was compared against books read before it, so its
  // stripe_costs_booked line waits for the next run. A refusal is a mismatch for the board.
  const feesBooked = [];
  for (const fee of result.fees) {
    if (dryRun) {
      feesBooked.push({ ...fee, inserted: false, dry_run: true });
      continue;
    }
    try {
      const done = await db.rpc('record_stripe_fee', { p_ref: fee.ref, p_stripe_session_id: fee.session_id, p_fee_usd: fee.fee_usd });
      feesBooked.push({ ...fee, inserted: done?.inserted === true, found: done?.found !== false });
    } catch (error) {
      feesBooked.push({ ...fee, inserted: false, error: error.message });
    }
  }
  const justBooked = new Set(feesBooked.filter((f) => f.inserted).map((f) => f.session_id));
  const feeRefusals = feesBooked.filter((f) => f.error !== undefined || f.found === false);
  const checks = [
    ...result.checks.map((c) => {
      if (c.name !== 'stripe_costs_booked' || justBooked.size === 0) return c;
      const items = c.items.filter((item) => !justBooked.has(item.session));
      return { ...c, ok: items.length === 0, detail: items.length === 0 ? 'what Stripe holds for each payment matches the books' : `${items.length} to look at`, items };
    }),
    { name: 'disputes_reinstated', ok: refused.length === 0, detail: `${reinstated.length} won dispute(s) to put back`, items: refused },
    { name: 'stripe_fees_booked', ok: feeRefusals.length === 0, detail: `${feesBooked.length} dispute fee(s) Stripe reported`, items: feeRefusals },
  ];
  const mismatches = checks.reduce((total, c) => total + c.items.length, 0);
  const row = {
    job: 'reconcile',
    started_at: startedAt,
    ok: mismatches === 0,
    mismatches,
    checks,
    figures: { ...result.figures, reinstated, fees_booked: feesBooked },
  };
  const final = { ...result, ok: row.ok, mismatches, checks };
  if (!dryRun) {
    await db.insert('controller_runs', row);
    if (!row.ok || result.attention.length > 0) await alerts.notify(alertMessage(final));
    await alerts.ping(row.ok);
  }
  out.write(`${row.ok ? 'PASS' : 'FAIL'}: controller ${mismatches} mismatch(es); credit to buy $${result.figures.credit_purchase_usd.toFixed(2)}; minimum balance $${result.figures.minimum_balance_usd.toFixed(2)}${dryRun ? ' (dry run: nothing written, nobody alerted)' : ''}\n`);
  out.write(`${JSON.stringify(row)}\n`);
  return row;
}
