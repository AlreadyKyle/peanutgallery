// The stripe-webhook request handler with its I/O injected: signature
// verification, the session and fee lookups and the apply_contribution RPC
// arrive as functions, so every status path and the dry-run rule are testable
// without Stripe or the database. index.ts wires the real implementations in.
//
// A request carrying x-dry-run never runs live: without the service key as its
// bearer it is refused with 401 before the body is read
// (docs/specs/webhook-hardening.md).
//
// Stripe can attach a charge's balance transaction after
// checkout.session.completed fires (docs/specs/stripe-late-fee.md). A paid
// session is credited by whichever arrives with the fee: the completed event,
// or the charge.updated that attaches the balance transaction. The RPC is keyed
// by the Checkout session, so the pool moves once.
//
// charge.refunded, charge.dispute.created and charge.dispute.funds_withdrawn
// reverse the payment's credit through reverse_contribution
// (docs/specs/refunds-and-holds.md). Stripe sends the refunded or disputed total
// so far, so replays, partial refunds and the second of the two dispute events
// reverse only what is still due. A dispute inquiry withdraws no funds and
// reverses nothing. Every reversal and every new dispute is posted to the board.

import { type Amounts, computeAmounts, roundUsd } from "./split.ts";
import { type Parsed, parseSession, type SessionLike } from "./session.ts";
import {
  CHARGE_UPDATED_EVENT,
  COMPLETED_EVENT,
  DISPUTE_CREATED_EVENT,
  DISPUTE_FUNDS_WITHDRAWN_EVENT,
  REFUNDED_EVENT,
} from "./webhook_events.ts";

export {
  CHARGE_UPDATED_EVENT,
  COMPLETED_EVENT,
  DISPUTE_CREATED_EVENT,
  DISPUTE_FUNDS_WITHDRAWN_EVENT,
  REFUNDED_EVENT,
} from "./webhook_events.ts";

export interface WebhookEvent {
  id: string;
  type: string;
  data: { object: unknown };
}

/** The checkout session fields the handler reads on top of SessionLike. */
export type CheckoutSession = SessionLike & { payment_status: string };

/** The charge fields the handler reads from a charge.updated event. */
export interface ChargeObject {
  payment_intent: string | { id: string } | null;
  balance_transaction: string | { id: string } | null;
}

/** The charge fields the handler reads from a charge.refunded event. */
export interface RefundedCharge {
  id: string;
  payment_intent: string | { id: string } | null;
  amount_refunded: number;
  currency: string;
}

/** The dispute fields the handler reads from a charge.dispute.created or funds_withdrawn event. */
export interface DisputeObject {
  id: string;
  payment_intent: string | { id: string } | null;
  amount: number;
  currency: string;
  /** warning_needs_response, warning_under_review and warning_closed are inquiries. */
  status: string;
}

export type ReversalKind = "refund" | "dispute";

export interface ReversalInput {
  event_id: string;
  session_id: string;
  kind: ReversalKind;
  /** The kind's total so far in USD: a charge's amount_refunded, or a dispute's amount. */
  kind_total_usd: number;
}

export interface HandlerDeps {
  /** Verifies the Stripe signature over the raw body; throws when it does not match. */
  constructEvent(body: string, signature: string): Promise<WebhookEvent>;
  /** Fee in USD from the session's balance transaction; null while it is not available. */
  lookupFee(sessionId: string): Promise<number | null>;
  /** The Checkout session paid by this payment intent; null when the payment did not come through Checkout. */
  findSession(paymentIntentId: string): Promise<CheckoutSession | null>;
  /** The apply_contribution RPC; resolves to its jsonb result. */
  applyContribution(
    parsed: Parsed,
    amounts: Amounts,
  ): Promise<Record<string, unknown>>;
  /** The reverse_contribution RPC; resolves to its jsonb result. */
  reverseContribution(input: ReversalInput): Promise<Record<string, unknown>>;
  /** Posts one line to the board's alert topic; a failure must not change the response. */
  notify(message: string): Promise<void>;
  /** SUPABASE_SERVICE_ROLE_KEY as the function runtime supplies it; a dry run must present it as a bearer token. */
  serviceKey: string;
}

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/**
 * No x-dry-run header is a live request. With the header, the bearer must be
 * the service key (401 otherwise) and the value must be 1 (400 otherwise), so a
 * request that asks for a dry run never runs live.
 */
export function dryRunGate(
  req: Request,
  serviceKey: string,
): "live" | "dry" | Response {
  const dry = req.headers.get("x-dry-run");
  if (dry === null) return "live";
  const auth = req.headers.get("authorization") ?? "";
  if (serviceKey === "" || !timingSafeEqual(auth, `Bearer ${serviceKey}`)) {
    return json(401, { error: "x-dry-run needs the service key as the bearer" });
  }
  if (dry !== "1") {
    return json(400, { error: "x-dry-run must be 1" });
  }
  return "dry";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createHandler(
  deps: HandlerDeps,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return json(405, { error: "POST only" });
    }
    const gate = dryRunGate(req, deps.serviceKey);
    if (gate instanceof Response) return gate;
    const dryRun = gate === "dry";

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return json(400, { error: "Missing stripe-signature header" });
    }
    const body = await req.text();

    let event: WebhookEvent;
    try {
      event = await deps.constructEvent(body, signature);
    } catch (err) {
      return json(400, {
        error: "Invalid signature",
        detail: errorMessage(err),
      });
    }

    if (event.type === COMPLETED_EVENT) {
      const session = event.data.object as CheckoutSession;
      if (session.payment_status !== "paid") {
        return json(200, {
          ignored: true,
          reason: `payment_status ${session.payment_status}`,
        });
      }
      return credit(deps, event.id, session, dryRun, "completed");
    }

    if (event.type === CHARGE_UPDATED_EVENT) {
      const charge = event.data.object as ChargeObject;
      if (!charge.balance_transaction) {
        return json(200, {
          ignored: true,
          reason: "charge has no balance transaction",
        });
      }
      const intent = typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id ?? null;
      if (!intent) {
        return json(200, { ignored: true, reason: "charge has no payment intent" });
      }
      let session: CheckoutSession | null;
      try {
        session = await deps.findSession(intent);
      } catch (err) {
        return json(500, {
          error: "Session lookup failed",
          detail: errorMessage(err),
        });
      }
      if (!session) {
        return json(200, { ignored: true, reason: "no checkout session" });
      }
      if (session.payment_status !== "paid") {
        return json(200, {
          ignored: true,
          reason: `payment_status ${session.payment_status}`,
        });
      }
      return credit(deps, event.id, session, dryRun, "charge_updated");
    }

    if (event.type === REFUNDED_EVENT) {
      const charge = event.data.object as RefundedCharge;
      return reverse(deps, event.id, "refund", {
        intent: intentId(charge.payment_intent),
        currency: charge.currency,
        totalCents: charge.amount_refunded,
        source: charge.id,
      }, dryRun);
    }

    if (event.type === DISPUTE_CREATED_EVENT) {
      const dispute = event.data.object as DisputeObject;
      // An inquiry withdraws no funds. If it escalates, Stripe withdraws them
      // and sends charge.dispute.funds_withdrawn, which reverses.
      if (String(dispute.status ?? "").startsWith("warning_")) {
        if (!dryRun) {
          await safeNotify(deps, `Dispute ${dispute.id} is an inquiry (${dispute.status}): no funds were withdrawn and nothing was reversed`);
        }
        return json(200, {
          ignored: true,
          reason: `dispute inquiry ${dispute.status}`,
        });
      }
      return reverse(deps, event.id, "dispute", disputeSource(dispute), dryRun);
    }

    if (event.type === DISPUTE_FUNDS_WITHDRAWN_EVENT) {
      // The dispute's total is cumulative, so whichever of this and
      // charge.dispute.created arrives second reverses nothing, quietly.
      const dispute = event.data.object as DisputeObject;
      return reverse(deps, event.id, "dispute", disputeSource(dispute), dryRun, {
        quietWhenNothingLeft: true,
      });
    }

    return json(200, { ignored: true, reason: `event type ${event.type}` });
  };
}

function intentId(intent: string | { id: string } | null): string | null {
  return typeof intent === "string" ? intent : intent?.id ?? null;
}

function disputeSource(dispute: DisputeObject): ReversalSource {
  return {
    intent: intentId(dispute.payment_intent),
    currency: dispute.currency,
    totalCents: dispute.amount,
    source: dispute.id,
  };
}

async function safeNotify(deps: HandlerDeps, message: string): Promise<void> {
  try {
    await deps.notify(message);
  } catch (_err) {
    // An alert that cannot be sent never changes what Stripe is told.
  }
}

function usd(value: unknown): string {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function shortId(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 8) : "none";
}

/** One line for the board: what was reversed and where it came from. No email or name. */
export function reversalMessage(
  kind: ReversalKind,
  source: string,
  result: Record<string, unknown>,
): string {
  const parts = [
    `${kind === "refund" ? "Refund" : "Dispute"} ${source}: reversed ${usd(result.reversed_usd)} of contribution ${shortId(result.parent_id)}`,
    `held cancelled ${usd(result.held_cancelled_usd)}`,
    `reserve cover ${usd(result.reserve_cover_usd)}`,
    `pool balance ${usd(result.pool_balance_usd)}`,
  ];
  if (result.goal_card_id) {
    parts.push(
      `card ${shortId(result.goal_card_id)} ${String(result.goal_stage)} at ${usd(result.goal_funded_usd)} of ${usd(result.goal_target_usd)}`,
    );
    const stage = String(result.goal_stage);
    if (
      !["proposed", "voted"].includes(stage) &&
      Number(result.goal_funded_usd) < Number(result.goal_target_usd)
    ) {
      parts.push("the card is past voting and now below its target");
    }
  }
  if (Number(result.pool_balance_usd) < 0) parts.push("the pool balance is below zero");
  // Absent fields read as NaN, which is never below zero.
  if (Number(result.pool_reserve_usd) < 0) parts.push("the 10% reserve is below zero");
  if (Number(result.pool_incident_reserve_usd) < 0) parts.push("the emergency fund is below zero");
  return parts.join("; ");
}

interface ReversalSource {
  intent: string | null;
  currency: string;
  totalCents: number;
  source: string;
}

interface ReverseOptions {
  /** No "nothing left to reverse" alert: the other event for the same dispute already sent one. */
  quietWhenNothingLeft?: boolean;
}

/**
 * Finds the Checkout session behind the charge and reverses its credit. A
 * payment that was never credited (its fee never arrived) is credited first
 * under "<event id>.credit" and then reversed, so the ledger records both.
 */
async function reverse(
  deps: HandlerDeps,
  eventId: string,
  kind: ReversalKind,
  source: ReversalSource,
  dryRun: boolean,
  options: ReverseOptions = {},
): Promise<Response> {
  if (!source.intent) {
    return json(200, { ignored: true, reason: `${kind} has no payment intent` });
  }
  if ((source.currency ?? "").toLowerCase() !== "usd") {
    if (!dryRun) {
      await safeNotify(deps, `${kind === "refund" ? "Refund" : "Dispute"} ${source.source} in ${source.currency} was not reversed; only usd is handled`);
    }
    return json(200, { ignored: true, reason: `currency ${source.currency}` });
  }
  if (!Number.isInteger(source.totalCents) || source.totalCents < 0) {
    return json(500, { error: `Invalid ${kind} amount: ${source.totalCents}` });
  }

  let session: CheckoutSession | null;
  try {
    session = await deps.findSession(source.intent);
  } catch (err) {
    return json(500, { error: "Session lookup failed", detail: errorMessage(err) });
  }
  if (!session) {
    return json(200, { ignored: true, reason: "no checkout session" });
  }

  const input: ReversalInput = {
    event_id: eventId,
    session_id: session.id,
    kind,
    kind_total_usd: roundUsd(source.totalCents / 100),
  };
  if (dryRun) {
    return json(200, { dry_run: true, reversal: input });
  }

  let result: Record<string, unknown>;
  try {
    result = await deps.reverseContribution(input);
    if (result.found === false) {
      const credited = await creditSession(deps, `${eventId}.credit`, session);
      if (credited.status !== "credited") {
        return credited.response;
      }
      result = await deps.reverseContribution(input);
      if (result.found === false) {
        return json(500, { error: "The credited payment was not found for reversal" });
      }
    }
  } catch (err) {
    return json(500, { error: "reverse_contribution failed", detail: errorMessage(err) });
  }

  if (result.inserted === true) {
    await safeNotify(deps, reversalMessage(kind, source.source, result));
  } else if (
    kind === "dispute" && result.replay !== true && !options.quietWhenNothingLeft
  ) {
    await safeNotify(deps, `Dispute ${source.source}: nothing left to reverse on contribution ${shortId(result.parent_id)}`);
  }
  return json(200, { ...result, event_id: eventId });
}

/**
 * Calls apply_contribution and, when it inserts a payment that named a goal
 * card the RPC did not credit, tells the board the money went to the pool.
 */
async function apply(
  deps: HandlerDeps,
  parsed: Parsed,
  amounts: Amounts,
): Promise<Record<string, unknown>> {
  const result = await deps.applyContribution(parsed, amounts);
  if (
    result.inserted === true && parsed.goal_card_id &&
    result.goal_card_id == null
  ) {
    await safeNotify(deps, `Contribution ${parsed.session_id} named card ${parsed.goal_card_id}, which is not open for funding; it went to the pool`);
  }
  return result;
}

type CreditOutcome =
  | { status: "credited"; result: Record<string, unknown> }
  | { status: "stopped"; response: Response };

/** Credits a session outside the normal events: a missing fee answers 500 so Stripe retries. */
async function creditSession(
  deps: HandlerDeps,
  eventId: string,
  session: CheckoutSession,
): Promise<CreditOutcome> {
  if (session.payment_status !== "paid") {
    return {
      status: "stopped",
      response: json(200, { ignored: true, reason: `payment_status ${session.payment_status}` }),
    };
  }
  let parsed: Parsed;
  try {
    parsed = await parseSession(eventId, session);
  } catch (err) {
    await safeNotify(deps, `A reversal found an unusable checkout session ${session.id}: ${errorMessage(err)}`);
    return {
      status: "stopped",
      response: json(200, { ignored: true, reason: "unusable checkout session", detail: errorMessage(err) }),
    };
  }
  const feeUsd = await deps.lookupFee(parsed.session_id);
  if (feeUsd === null) {
    return {
      status: "stopped",
      response: json(500, { error: "Balance transaction is not available yet" }),
    };
  }
  const result = await apply(deps, parsed, computeAmounts(parsed.amount_total, feeUsd));
  return { status: "credited", result };
}

/**
 * Parses a paid session, looks its fee up and calls the RPC. When the fee is
 * not there yet, the completed event acknowledges (a charge.updated will
 * credit) and charge.updated answers 500 so Stripe sends it again. A session
 * that cannot be parsed answers 500 so a fixed handler can still credit it on a
 * retry; the completed event alerts the board, and charge.updated stays silent
 * so each Stripe retry alerts once.
 */
async function credit(
  deps: HandlerDeps,
  eventId: string,
  session: CheckoutSession,
  dryRun: boolean,
  trigger: "completed" | "charge_updated",
): Promise<Response> {
  let parsed: Parsed;
  try {
    parsed = await parseSession(eventId, session);
  } catch (err) {
    if (!dryRun && trigger === "completed") {
      await safeNotify(deps, `Checkout session ${session.id} (event ${eventId}) was not credited: ${errorMessage(err)}. Stripe retries for up to 3 days; fix the handler to credit it, or refund it.`);
    }
    return json(500, {
      error: "Unusable checkout session",
      detail: errorMessage(err),
    });
  }

  if (dryRun) {
    let feeUsd: number | null = null;
    try {
      feeUsd = await deps.lookupFee(parsed.session_id);
    } catch (_err) {
      feeUsd = null;
    }
    const amounts = computeAmounts(parsed.amount_total, feeUsd ?? 0);
    return json(200, {
      dry_run: true,
      parsed,
      fee_lookup: feeUsd === null ? "failed" : "ok",
      amounts: { ...amounts, studio_pct: parsed.studio_pct },
    });
  }

  let feeUsd: number | null;
  try {
    feeUsd = await deps.lookupFee(parsed.session_id);
  } catch (err) {
    return json(500, {
      error: "Fee lookup failed",
      detail: errorMessage(err),
    });
  }
  if (feeUsd === null) {
    if (trigger === "completed") {
      return json(200, {
        deferred: true,
        reason: "Balance transaction is not available yet",
        event_id: parsed.event_id,
      });
    }
    return json(500, { error: "Balance transaction is not available yet" });
  }

  try {
    const amounts = computeAmounts(parsed.amount_total, feeUsd);
    const result = await apply(deps, parsed, amounts);
    return json(200, { ...result, event_id: parsed.event_id });
  } catch (err) {
    return json(500, {
      error: "apply_contribution failed",
      detail: errorMessage(err),
    });
  }
}
