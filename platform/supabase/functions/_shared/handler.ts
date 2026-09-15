// The stripe-webhook request handler with its I/O injected: signature
// verification, the session and fee lookups and the apply_contribution RPC
// arrive as functions, so every status path and the dry-run rule are testable
// without Stripe or the database. index.ts wires the real implementations in.
//
// Stripe can attach a charge's balance transaction after
// checkout.session.completed fires (docs/specs/stripe-late-fee.md). A paid
// session is credited by whichever arrives with the fee: the completed event,
// or the charge.updated that attaches the balance transaction. The RPC is keyed
// by the Checkout session, so the pool moves once.

import { type Amounts, computeAmounts } from "./split.ts";
import { type Parsed, parseSession, type SessionLike } from "./session.ts";
import { CHARGE_UPDATED_EVENT, COMPLETED_EVENT } from "./webhook_events.ts";

export { CHARGE_UPDATED_EVENT, COMPLETED_EVENT } from "./webhook_events.ts";

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
  /** SUPABASE_SERVICE_ROLE_KEY; a dry run must present it as a bearer token. */
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

/** A dry run needs both the service-role bearer and x-dry-run: 1. */
export function isDryRun(req: Request, serviceKey: string): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const dry = req.headers.get("x-dry-run") ?? "";
  return dry === "1" && timingSafeEqual(auth, `Bearer ${serviceKey}`);
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

    const dryRun = isDryRun(req, deps.serviceKey);

    if (event.type === COMPLETED_EVENT) {
      const session = event.data.object as CheckoutSession;
      if (session.payment_status !== "paid") {
        return json(200, {
          ignored: true,
          reason: `payment_status ${session.payment_status}`,
        });
      }
      return credit(deps, event.id, session, dryRun, "defer");
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
      return credit(deps, event.id, session, dryRun, "retry");
    }

    return json(200, { ignored: true, reason: `event type ${event.type}` });
  };
}

/**
 * Parses a paid session, looks its fee up and calls the RPC. When the fee is
 * not there yet, "defer" acknowledges (a charge.updated will credit) and
 * "retry" answers 500 so Stripe sends the event again.
 */
async function credit(
  deps: HandlerDeps,
  eventId: string,
  session: CheckoutSession,
  dryRun: boolean,
  missingFee: "defer" | "retry",
): Promise<Response> {
  let parsed: Parsed;
  try {
    parsed = await parseSession(eventId, session);
  } catch (err) {
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
    if (missingFee === "defer") {
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
    const result = await deps.applyContribution(parsed, amounts);
    return json(200, { ...result, event_id: parsed.event_id });
  } catch (err) {
    return json(500, {
      error: "apply_contribution failed",
      detail: errorMessage(err),
    });
  }
}
