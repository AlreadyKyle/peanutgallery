import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type CheckoutSession,
  createHandler,
  type HandlerDeps,
  type ReversalInput,
  reversalMessage,
  type WebhookEvent,
} from "./handler.ts";
import type { Amounts } from "./split.ts";
import type { Parsed } from "./session.ts";

const SERVICE_KEY = "service-role-key-for-tests";
const GOOD_SIGNATURE = "t=1700000000,v1=matching";

/** A paid $1 checkout.session.completed event at 80/20; the signature check only accepts GOOD_SIGNATURE. */
function completedEvent(
  session: Record<string, unknown> = {},
  type = "checkout.session.completed",
): WebhookEvent {
  return {
    id: "evt_handler_1",
    type,
    data: {
      object: {
        id: "cs_handler_1",
        amount_total: 100,
        currency: "usd",
        payment_status: "paid",
        customer: null,
        customer_details: { email: "board@peanutgallery.games" },
        client_reference_id: null,
        metadata: null,
        custom_fields: [
          { key: "split", type: "dropdown", dropdown: { value: "8020" } },
        ],
        payment_intent: null,
        ...session,
      },
    },
  };
}

/** A charge.updated event for the $1 charge; the balance transaction is attached unless overridden. */
function chargeUpdatedEvent(charge: Record<string, unknown> = {}): WebhookEvent {
  return {
    id: "evt_handler_charge",
    type: "charge.updated",
    data: {
      object: {
        id: "ch_handler_1",
        payment_intent: "pi_handler_1",
        balance_transaction: "txn_handler_1",
        ...charge,
      },
    },
  };
}

/** The paid session findSession returns for pi_handler_1. */
function paidSession(session: Record<string, unknown> = {}): CheckoutSession {
  return completedEvent(session).data.object as CheckoutSession;
}

/** A charge.refunded event for the $1 charge with $0.40 refunded so far unless overridden. */
function refundedEvent(charge: Record<string, unknown> = {}): WebhookEvent {
  return {
    id: "evt_handler_refund",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_handler_1",
        payment_intent: "pi_handler_1",
        amount: 100,
        amount_refunded: 40,
        currency: "usd",
        ...charge,
      },
    },
  };
}

/** A charge.dispute.created event for the whole $1 charge unless overridden. */
function disputeEvent(dispute: Record<string, unknown> = {}): WebhookEvent {
  return {
    id: "evt_handler_dispute",
    type: "charge.dispute.created",
    data: {
      object: {
        id: "dp_handler_1",
        charge: "ch_handler_1",
        payment_intent: "pi_handler_1",
        amount: 100,
        currency: "usd",
        ...dispute,
      },
    },
  };
}

const REVERSED = {
  found: true,
  inserted: true,
  replay: false,
  parent_id: "c1c1c1c1-0000-4000-8000-000000000000",
  reversed_usd: 0.4,
  held_cancelled_usd: 0,
  reserve_cover_usd: 0,
  pool_balance_usd: 0.3,
  goal_card_id: null,
};

interface Fake {
  deps: HandlerDeps;
  applied: { parsed: Parsed; amounts: Amounts }[];
  feeLookups: string[];
  sessionLookups: string[];
  reversals: ReversalInput[];
  notices: string[];
}

function fake(
  overrides: Partial<
    Pick<
      HandlerDeps,
      | "lookupFee"
      | "findSession"
      | "applyContribution"
      | "reverseContribution"
      | "notify"
    >
  > = {},
  event: WebhookEvent = completedEvent(),
): Fake {
  const applied: Fake["applied"] = [];
  const feeLookups: string[] = [];
  const sessionLookups: string[] = [];
  const reversals: ReversalInput[] = [];
  const notices: string[] = [];
  const deps: HandlerDeps = {
    constructEvent: (_body, signature) => {
      if (signature !== GOOD_SIGNATURE) {
        return Promise.reject(
          new Error(
            "No signatures found matching the expected signature for payload",
          ),
        );
      }
      return Promise.resolve(event);
    },
    lookupFee: (sessionId) => {
      feeLookups.push(sessionId);
      return Promise.resolve(0.29);
    },
    findSession: (paymentIntentId) => {
      sessionLookups.push(paymentIntentId);
      return Promise.resolve(paidSession());
    },
    applyContribution: (parsed, amounts) => {
      applied.push({ parsed, amounts });
      return Promise.resolve({ inserted: true, contribution_id: "c1" });
    },
    reverseContribution: (input) => {
      reversals.push(input);
      return Promise.resolve({ ...REVERSED });
    },
    notify: (message) => {
      notices.push(message);
      return Promise.resolve();
    },
    serviceKey: SERVICE_KEY,
    ...overrides,
  };
  if (overrides.reverseContribution) {
    const inner = overrides.reverseContribution;
    deps.reverseContribution = (input) => {
      reversals.push(input);
      return inner(input);
    };
  }
  if (overrides.notify) {
    const inner = overrides.notify;
    deps.notify = (message) => {
      notices.push(message);
      return inner(message);
    };
  }
  return { deps, applied, feeLookups, sessionLookups, reversals, notices };
}

function post(headers: Record<string, string> = {}, method = "POST"): Request {
  return new Request("https://functions.invalid/stripe-webhook", {
    method,
    headers: { "stripe-signature": GOOD_SIGNATURE, ...headers },
    body: method === "POST" ? "{}" : null,
  });
}

const DRY_RUN_HEADERS = {
  authorization: `Bearer ${SERVICE_KEY}`,
  "x-dry-run": "1",
};

async function call(
  deps: HandlerDeps,
  req: Request,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await createHandler(deps)(req);
  return { status: res.status, body: await res.json() };
}

Deno.test("handler answers 405 to anything but POST", async () => {
  const { deps, applied } = fake();
  const { status, body } = await call(deps, post({}, "GET"));
  assertEquals(status, 405);
  assertEquals(body, { error: "POST only" });
  assertEquals(applied.length, 0);
});

Deno.test("handler answers 400 without a stripe-signature header", async () => {
  const { deps, applied } = fake();
  const req = new Request("https://functions.invalid/stripe-webhook", {
    method: "POST",
    body: "{}",
  });
  const { status, body } = await call(deps, req);
  assertEquals(status, 400);
  assertEquals(body, { error: "Missing stripe-signature header" });
  assertEquals(applied.length, 0);
});

Deno.test("handler answers 400 when the signature does not verify", async () => {
  const { deps, applied, feeLookups } = fake();
  const { status, body } = await call(
    deps,
    post({ "stripe-signature": "t=1700000000,v1=wrong" }),
  );
  assertEquals(status, 400);
  assertEquals(body.error, "Invalid signature");
  assertEquals(feeLookups.length, 0);
  assertEquals(applied.length, 0);
});

Deno.test("handler acknowledges other event types with 200 ignored", async () => {
  const { deps, applied } = fake(
    {},
    completedEvent({}, "payment_intent.succeeded"),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body, {
    ignored: true,
    reason: "event type payment_intent.succeeded",
  });
  assertEquals(applied.length, 0);
});

Deno.test("handler acknowledges an unpaid session with 200 ignored", async () => {
  const { deps, applied } = fake(
    {},
    completedEvent({ payment_status: "unpaid" }),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body, { ignored: true, reason: "payment_status unpaid" });
  assertEquals(applied.length, 0);
});

Deno.test("handler answers 500 for a session it cannot parse", async () => {
  const { deps, applied } = fake({}, completedEvent({ currency: "cad" }));
  const { status, body } = await call(deps, post());
  assertEquals(status, 500);
  assertEquals(body.error, "Unusable checkout session");
  assertEquals(body.detail, "Checkout session currency is cad, expected usd");
  assertEquals(applied.length, 0);
});

Deno.test("handler credits a paid session through apply_contribution", async () => {
  const { deps, applied, feeLookups } = fake();
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body, {
    inserted: true,
    contribution_id: "c1",
    event_id: "evt_handler_1",
  });
  assertEquals(feeLookups, ["cs_handler_1"]);
  assertEquals(applied.length, 1);
  assertEquals(applied[0]!.amounts, {
    amount_usd: 1,
    fee_usd: 0.29,
    net_usd: 0.71,
  });
  assertEquals(applied[0]!.parsed.event_id, "evt_handler_1");
  assertEquals(applied[0]!.parsed.studio_pct, 20);
});

Deno.test("handler defers a completed session whose fee is not available yet", async () => {
  const { deps, applied } = fake({ lookupFee: () => Promise.resolve(null) });
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body, {
    deferred: true,
    reason: "Balance transaction is not available yet",
    event_id: "evt_handler_1",
  });
  assertEquals(applied.length, 0);
});

Deno.test("charge.updated with a balance transaction credits the paid checkout session", async () => {
  const { deps, applied, feeLookups, sessionLookups } = fake(
    {},
    chargeUpdatedEvent(),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body, {
    inserted: true,
    contribution_id: "c1",
    event_id: "evt_handler_charge",
  });
  assertEquals(sessionLookups, ["pi_handler_1"]);
  assertEquals(feeLookups, ["cs_handler_1"]);
  assertEquals(applied.length, 1);
  assertEquals(applied[0]!.parsed.session_id, "cs_handler_1");
  assertEquals(applied[0]!.parsed.event_id, "evt_handler_charge");
  assertEquals(applied[0]!.amounts, {
    amount_usd: 1,
    fee_usd: 0.29,
    net_usd: 0.71,
  });
});

Deno.test("charge.updated reads an expanded payment intent id", async () => {
  const { deps, applied, sessionLookups } = fake(
    {},
    chargeUpdatedEvent({ payment_intent: { id: "pi_handler_1" } }),
  );
  const { status } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(sessionLookups, ["pi_handler_1"]);
  assertEquals(applied.length, 1);
});

Deno.test("charge.updated without a balance transaction is ignored", async () => {
  const { deps, applied, sessionLookups } = fake(
    {},
    chargeUpdatedEvent({ balance_transaction: null }),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body, {
    ignored: true,
    reason: "charge has no balance transaction",
  });
  assertEquals(sessionLookups.length, 0);
  assertEquals(applied.length, 0);
});

Deno.test("charge.updated without a payment intent is ignored", async () => {
  const { deps, applied } = fake(
    {},
    chargeUpdatedEvent({ payment_intent: null }),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body, { ignored: true, reason: "charge has no payment intent" });
  assertEquals(applied.length, 0);
});

Deno.test("charge.updated for a payment outside Checkout is ignored", async () => {
  const { deps, applied } = fake(
    { findSession: () => Promise.resolve(null) },
    chargeUpdatedEvent(),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body, { ignored: true, reason: "no checkout session" });
  assertEquals(applied.length, 0);
});

Deno.test("charge.updated for an unpaid session is ignored", async () => {
  const { deps, applied } = fake(
    {
      findSession: () =>
        Promise.resolve(paidSession({ payment_status: "unpaid" })),
    },
    chargeUpdatedEvent(),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body, { ignored: true, reason: "payment_status unpaid" });
  assertEquals(applied.length, 0);
});

Deno.test("charge.updated answers 500 when the session lookup throws", async () => {
  const { deps, applied } = fake(
    { findSession: () => Promise.reject(new Error("Stripe is down")) },
    chargeUpdatedEvent(),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 500);
  assertEquals(body, { error: "Session lookup failed", detail: "Stripe is down" });
  assertEquals(applied.length, 0);
});

Deno.test("charge.updated answers 500 when the fee is still missing so Stripe retries", async () => {
  const { deps, applied } = fake(
    { lookupFee: () => Promise.resolve(null) },
    chargeUpdatedEvent(),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 500);
  assertEquals(body, { error: "Balance transaction is not available yet" });
  assertEquals(applied.length, 0);
});

Deno.test("dry run on charge.updated finds the session and never calls the RPC", async () => {
  const { deps, applied, sessionLookups } = fake({}, chargeUpdatedEvent());
  const { status, body } = await call(deps, post(DRY_RUN_HEADERS));
  assertEquals(status, 200);
  assertEquals(body.dry_run, true);
  assertEquals(body.fee_lookup, "ok");
  assertEquals((body.parsed as Parsed).event_id, "evt_handler_charge");
  assertEquals(sessionLookups, ["pi_handler_1"]);
  assertEquals(applied.length, 0);
});

Deno.test("handler answers 500 when the fee lookup throws", async () => {
  const { deps, applied } = fake({
    lookupFee: () => Promise.reject(new Error("No such checkout session")),
  });
  const { status, body } = await call(deps, post());
  assertEquals(status, 500);
  assertEquals(body, {
    error: "Fee lookup failed",
    detail: "No such checkout session",
  });
  assertEquals(applied.length, 0);
});

Deno.test("handler answers 500 when apply_contribution fails", async () => {
  const { deps } = fake({
    applyContribution: () =>
      Promise.reject(
        new Error("apply_contribution returned 500: pool row 1 is missing"),
      ),
  });
  const { status, body } = await call(deps, post());
  assertEquals(status, 500);
  assertEquals(body, {
    error: "apply_contribution failed",
    detail: "apply_contribution returned 500: pool row 1 is missing",
  });
});

Deno.test("dry run verifies, parses, looks the fee up and never calls the RPC", async () => {
  const { deps, applied, feeLookups } = fake();
  const { status, body } = await call(deps, post(DRY_RUN_HEADERS));
  assertEquals(status, 200);
  assertEquals(body.dry_run, true);
  assertEquals(body.fee_lookup, "ok");
  assertEquals(body.amounts, {
    amount_usd: 1,
    fee_usd: 0.29,
    net_usd: 0.71,
    studio_pct: 20,
  });
  assertEquals((body.parsed as Parsed).session_id, "cs_handler_1");
  assertEquals(feeLookups, ["cs_handler_1"]);
  assertEquals(applied.length, 0);
});

Deno.test("dry run reports a failed fee lookup and computes on a zero fee", async () => {
  const { deps, applied } = fake({
    lookupFee: () => Promise.reject(new Error("No such checkout session")),
  });
  const { status, body } = await call(deps, post(DRY_RUN_HEADERS));
  assertEquals(status, 200);
  assertEquals(body.fee_lookup, "failed");
  assertEquals(body.amounts, {
    amount_usd: 1,
    fee_usd: 0,
    net_usd: 1,
    studio_pct: 20,
  });
  assertEquals(applied.length, 0);

  const missing = fake({ lookupFee: () => Promise.resolve(null) });
  const res = await call(missing.deps, post(DRY_RUN_HEADERS));
  assertEquals(res.body.fee_lookup, "failed");
  assertEquals(missing.applied.length, 0);
});

Deno.test("dry run still verifies the signature", async () => {
  const { deps, applied } = fake();
  const { status } = await call(
    deps,
    post({ ...DRY_RUN_HEADERS, "stripe-signature": "t=1700000000,v1=wrong" }),
  );
  assertEquals(status, 400);
  assertEquals(applied.length, 0);
});

Deno.test("x-dry-run without the service bearer is a live request", async () => {
  const { deps, applied } = fake();
  const noBearer = await call(deps, post({ "x-dry-run": "1" }));
  assertEquals(noBearer.status, 200);
  assertEquals(noBearer.body.dry_run, undefined);
  assertEquals(applied.length, 1);

  const wrongBearer = await call(
    deps,
    post({ authorization: "Bearer another-key", "x-dry-run": "1" }),
  );
  assertEquals(wrongBearer.body.dry_run, undefined);
  assertEquals(applied.length, 2);

  const anonBearer = await call(
    deps,
    post({ authorization: `Bearer ${SERVICE_KEY}x`, "x-dry-run": "1" }),
  );
  assertEquals(anonBearer.body.dry_run, undefined);
  assertEquals(applied.length, 3);
});

Deno.test("the service bearer without x-dry-run: 1 is a live request", async () => {
  const { deps, applied } = fake();
  const noHeader = await call(
    deps,
    post({ authorization: `Bearer ${SERVICE_KEY}` }),
  );
  assertEquals(noHeader.body.dry_run, undefined);
  assertEquals(applied.length, 1);

  const otherValue = await call(
    deps,
    post({ authorization: `Bearer ${SERVICE_KEY}`, "x-dry-run": "true" }),
  );
  assertEquals(otherValue.body.dry_run, undefined);
  assertEquals(applied.length, 2);
});

Deno.test("charge.refunded reverses the session's credit by Stripe's refunded total and alerts", async () => {
  const { deps, applied, reversals, notices, sessionLookups } = fake(
    {},
    refundedEvent(),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body, { ...REVERSED, event_id: "evt_handler_refund" });
  assertEquals(sessionLookups, ["pi_handler_1"]);
  assertEquals(reversals, [{
    event_id: "evt_handler_refund",
    session_id: "cs_handler_1",
    kind: "refund",
    kind_total_usd: 0.4,
  }]);
  assertEquals(applied.length, 0);
  assertEquals(notices.length, 1);
  assertEquals(
    notices[0],
    "Refund ch_handler_1: reversed $0.40 of contribution c1c1c1c1; held cancelled $0.00; reserve cover $0.00; pool balance $0.30",
  );
});

Deno.test("a replayed refund answers 200 and sends no alert", async () => {
  const { deps, notices } = fake(
    {
      reverseContribution: () =>
        Promise.resolve({ found: true, inserted: false, replay: true, parent_id: "c1" }),
    },
    refundedEvent(),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body.replay, true);
  assertEquals(notices, []);
});

Deno.test("a refund of a payment never credited credits it first, then reverses it", async () => {
  let calls = 0;
  const { deps, applied, reversals, feeLookups } = fake(
    {
      reverseContribution: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1 ? { found: false, inserted: false } : { ...REVERSED },
        );
      },
    },
    refundedEvent(),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body.inserted, true);
  assertEquals(reversals.length, 2);
  assertEquals(feeLookups, ["cs_handler_1"]);
  assertEquals(applied.length, 1);
  assertEquals(applied[0]!.parsed.event_id, "evt_handler_refund.credit");
  assertEquals(applied[0]!.parsed.session_id, "cs_handler_1");
});

Deno.test("a refund of a payment whose fee is still missing answers 500 so Stripe retries", async () => {
  const { deps, applied } = fake(
    {
      lookupFee: () => Promise.resolve(null),
      reverseContribution: () => Promise.resolve({ found: false, inserted: false }),
    },
    refundedEvent(),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 500);
  assertEquals(body, { error: "Balance transaction is not available yet" });
  assertEquals(applied.length, 0);
});

Deno.test("a refund answers 500 when the reversal is still not found after crediting", async () => {
  const { deps } = fake(
    { reverseContribution: () => Promise.resolve({ found: false, inserted: false }) },
    refundedEvent(),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 500);
  assertEquals(body.error, "The credited payment was not found for reversal");
});

Deno.test("a refund answers 500 when reverse_contribution fails", async () => {
  const { deps } = fake(
    { reverseContribution: () => Promise.reject(new Error("rpc 503")) },
    refundedEvent(),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 500);
  assertEquals(body, { error: "reverse_contribution failed", detail: "rpc 503" });
});

Deno.test("a refund without a payment intent or outside Checkout is ignored", async () => {
  const noIntent = fake({}, refundedEvent({ payment_intent: null }));
  const first = await call(noIntent.deps, post());
  assertEquals(first.body, { ignored: true, reason: "refund has no payment intent" });
  assertEquals(noIntent.reversals.length, 0);

  const outside = fake({ findSession: () => Promise.resolve(null) }, refundedEvent());
  const second = await call(outside.deps, post());
  assertEquals(second.status, 200);
  assertEquals(second.body, { ignored: true, reason: "no checkout session" });
  assertEquals(outside.reversals.length, 0);
});

Deno.test("a refund in another currency is ignored and the board is told", async () => {
  const { deps, reversals, notices } = fake({}, refundedEvent({ currency: "cad" }));
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body, { ignored: true, reason: "currency cad" });
  assertEquals(reversals.length, 0);
  assertEquals(notices, [
    "Refund ch_handler_1 in cad was not reversed; only usd is handled",
  ]);
});

Deno.test("a refund answers 500 when the session lookup throws", async () => {
  const { deps } = fake(
    { findSession: () => Promise.reject(new Error("stripe down")) },
    refundedEvent(),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 500);
  assertEquals(body, { error: "Session lookup failed", detail: "stripe down" });
});

Deno.test("charge.dispute.created reverses the disputed amount and alerts, even when nothing is left", async () => {
  const done = fake(
    {
      reverseContribution: () =>
        Promise.resolve({ ...REVERSED, reversed_usd: 1, reserve_cover_usd: 0.61 }),
    },
    disputeEvent(),
  );
  const first = await call(done.deps, post());
  assertEquals(first.status, 200);
  assertEquals(done.reversals, [{
    event_id: "evt_handler_dispute",
    session_id: "cs_handler_1",
    kind: "dispute",
    kind_total_usd: 1,
  }]);
  assertEquals(done.notices.length, 1);
  assert(done.notices[0]!.startsWith("Dispute dp_handler_1: reversed $1.00"));
  assert(done.notices[0]!.includes("reserve cover $0.61"));

  const empty = fake(
    {
      reverseContribution: () =>
        Promise.resolve({ found: true, inserted: false, replay: false, parent_id: "c1c1c1c1-x", reversed_usd: 0 }),
    },
    disputeEvent(),
  );
  const second = await call(empty.deps, post());
  assertEquals(second.status, 200);
  assertEquals(empty.notices, [
    "Dispute dp_handler_1: nothing left to reverse on contribution c1c1c1c1",
  ]);
});

Deno.test("dry run on a refund finds the session and never reverses", async () => {
  const { deps, reversals, notices } = fake({}, refundedEvent());
  const { status, body } = await call(deps, post(DRY_RUN_HEADERS));
  assertEquals(status, 200);
  assertEquals(body, {
    dry_run: true,
    reversal: {
      event_id: "evt_handler_refund",
      session_id: "cs_handler_1",
      kind: "refund",
      kind_total_usd: 0.4,
    },
  });
  assertEquals(reversals.length, 0);
  assertEquals(notices.length, 0);
});

Deno.test("an alert that fails to send does not change the response", async () => {
  const { deps } = fake(
    { notify: () => Promise.reject(new Error("ntfy down")) },
    refundedEvent(),
  );
  const { status, body } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(body.inserted, true);
});

Deno.test("the reversal message warns when a card past voting falls below its target or the pool goes below zero", () => {
  const message = reversalMessage("refund", "ch_1", {
    ...REVERSED,
    goal_card_id: "abcdef12-0000-4000-8000-000000000000",
    goal_stage: "funded",
    goal_funded_usd: 1.5,
    goal_target_usd: 3,
    pool_balance_usd: -0.25,
  });
  assert(message.includes("card abcdef12 funded at $1.50 of $3.00"));
  assert(message.includes("the card is past voting and now below its target"));
  assert(message.endsWith("the pool balance is below zero"));
  assert(!message.includes("@"));
});
