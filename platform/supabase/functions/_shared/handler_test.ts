import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  applyContributionArgs,
  type CheckoutSession,
  createHandler,
  type HandlerDeps,
  type ReversalInput,
  reversalMessage,
  reverseContributionArgs,
  type WebhookEvent,
} from "./handler.ts";
import { WEBHOOK_EVENTS } from "./webhook_events.ts";
import { type Amounts, sha256Hex } from "./split.ts";
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
        customer_details: { email: "board@mobmachine.games" },
        client_reference_id: null,
        metadata: null,
        custom_fields: [
          { key: "split", type: "dropdown", dropdown: { value: "8020" } },
        ],
        payment_intent: null,
        created: 1789905600,
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

/** A charge.dispute.created event for the whole $1 charge in needs_response unless overridden. */
function disputeEvent(
  dispute: Record<string, unknown> = {},
  type = "charge.dispute.created",
): WebhookEvent {
  return {
    id: "evt_handler_dispute",
    type,
    data: {
      object: {
        id: "dp_handler_1",
        charge: "ch_handler_1",
        payment_intent: "pi_handler_1",
        amount: 100,
        currency: "usd",
        status: "needs_response",
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
  applied: { parsed: Parsed; amounts: Amounts; payerKey: string }[];
  feeLookups: string[];
  sessionLookups: string[];
  reversals: ReversalInput[];
  notices: string[];
}

function fake(
  overrides: Partial<
    Pick<
      HandlerDeps,
      | "lookupCharge"
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
    lookupCharge: (sessionId) => {
      feeLookups.push(sessionId);
      return Promise.resolve({ fee_usd: 0.29, card_fingerprint: null });
    },
    findSession: (paymentIntentId) => {
      sessionLookups.push(paymentIntentId);
      return Promise.resolve(paidSession());
    },
    applyContribution: (parsed, amounts, payerKey) => {
      applied.push({ parsed, amounts, payerKey });
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

Deno.test("a completed session it cannot parse answers 500 and alerts once", async () => {
  const cad = fake({}, completedEvent({ currency: "cad" }));
  const first = await call(cad.deps, post());
  assertEquals(first.status, 500);
  assertEquals(first.body.error, "Unusable checkout session");
  assertEquals(first.body.detail, "Checkout session currency is cad, expected usd");
  assertEquals(cad.applied.length, 0);
  assertEquals(cad.notices.length, 1);
  assert(cad.notices[0]!.includes("cs_handler_1"));
  assert(cad.notices[0]!.includes("evt_handler_1"));
  assert(cad.notices[0]!.includes("Checkout session currency is cad, expected usd"));
  assert(cad.notices[0]!.includes("3 days"));

  const split = fake(
    {},
    completedEvent({
      custom_fields: [{ key: "split", type: "dropdown", dropdown: { value: "9999" } }],
    }),
  );
  const second = await call(split.deps, post());
  assertEquals(second.status, 500);
  assertEquals(second.body.detail, "Unknown split value: 9999");
  assertEquals(split.applied.length, 0);
  assertEquals(split.notices.length, 1);
  assert(split.notices[0]!.includes("cs_handler_1"));
  assert(split.notices[0]!.includes("Unknown split value: 9999"));
});

Deno.test("an unusable session answers 500 without an alert on charge.updated or in a dry run", async () => {
  const updated = fake(
    { findSession: () => Promise.resolve(paidSession({ currency: "cad" })) },
    chargeUpdatedEvent(),
  );
  const first = await call(updated.deps, post());
  assertEquals(first.status, 500);
  assertEquals(first.body.error, "Unusable checkout session");
  assertEquals(updated.applied.length, 0);
  assertEquals(updated.notices, []);

  const dry = fake({}, completedEvent({ currency: "cad" }));
  const second = await call(dry.deps, post(DRY_RUN_HEADERS));
  assertEquals(second.status, 500);
  assertEquals(dry.applied.length, 0);
  assertEquals(dry.notices, []);
});

Deno.test("a new contribution whose goal card was not credited alerts, and a replay does not", async () => {
  const goal = "abcdef12-0000-4000-8000-000000000000";
  const dropped = fake(
    {
      applyContribution: () =>
        Promise.resolve({ inserted: true, contribution_id: "c1", goal_card_id: null }),
    },
    completedEvent({ client_reference_id: goal }),
  );
  const first = await call(dropped.deps, post());
  assertEquals(first.status, 200);
  assertEquals(dropped.notices, [
    `Contribution cs_handler_1 named card ${goal}, but the ledger credited no card; the money went to the pool.`,
  ]);

  const replay = fake(
    {
      applyContribution: () =>
        Promise.resolve({ inserted: false, contribution_id: "c1", goal_card_id: null }),
    },
    completedEvent({ client_reference_id: goal }),
  );
  const second = await call(replay.deps, post());
  assertEquals(second.status, 200);
  assertEquals(replay.notices, []);

  const credited = fake(
    {
      applyContribution: () =>
        Promise.resolve({ inserted: true, contribution_id: "c1", goal_card_id: goal }),
    },
    completedEvent({ client_reference_id: goal }),
  );
  await call(credited.deps, post());
  assertEquals(credited.notices, []);

  const noGoal = fake();
  await call(noGoal.deps, post());
  assertEquals(noGoal.notices, []);
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
  // The Terms stamp's time comes from the signed event's session (money-logic.md), and reaches
  // apply_contribution as p_session_created_at.
  assertEquals(applied[0]!.parsed.session_created_at, "2026-09-20T12:00:00.000Z");
  const { parsed, amounts, payerKey } = applied[0]!;
  assertEquals(applyContributionArgs(parsed, amounts, payerKey).p_session_created_at, "2026-09-20T12:00:00.000Z");
});

Deno.test("handler credits a session that carries a displayname field exactly as before, with no name", async () => {
  const withName = completedEvent({
    custom_fields: [
      { key: "split", type: "dropdown", dropdown: { value: "8020" } },
      { key: "displayname", type: "text", text: { value: "Board" } },
    ],
  });
  const named = fake({}, withName);
  const plain = fake();
  const { status, body } = await call(named.deps, post());
  await call(plain.deps, post());
  assertEquals(status, 200);
  assertEquals(body.inserted, true);
  assertEquals(named.applied.length, 1);
  assertEquals(named.applied[0]!.parsed.display_name, null);
  // Everything else the RPC receives is what a session with no name field gives.
  assertEquals(named.applied, plain.applied);
});

Deno.test("handler defers a completed session whose fee is not available yet", async () => {
  const { deps, applied } = fake({ lookupCharge: () => Promise.resolve(null) });
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
  // charge.updated stamps from the session the webhook retrieved, never from the charge.
  assertEquals(applied[0]!.parsed.session_created_at, "2026-09-20T12:00:00.000Z");
  const { parsed, amounts, payerKey } = applied[0]!;
  assertEquals(applyContributionArgs(parsed, amounts, payerKey).p_session_created_at, "2026-09-20T12:00:00.000Z");
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
    { lookupCharge: () => Promise.resolve(null) },
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
  assertEquals(body.payer, "email");
  assertEquals((body.parsed as Parsed).event_id, "evt_handler_charge");
  assertEquals(sessionLookups, ["pi_handler_1"]);
  assertEquals(applied.length, 0);
});

Deno.test("handler answers 500 when the fee lookup throws", async () => {
  const { deps, applied } = fake({
    lookupCharge: () => Promise.reject(new Error("No such checkout session")),
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
    lookupCharge: () => Promise.reject(new Error("No such checkout session")),
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

  const missing = fake({ lookupCharge: () => Promise.resolve(null) });
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

Deno.test("x-dry-run without the service bearer answers 401 and runs nothing", async () => {
  for (const event of [completedEvent(), refundedEvent()]) {
    for (const authorization of [undefined, "Bearer another-key", `Bearer ${SERVICE_KEY}x`]) {
      const f = fake({}, event);
      const headers: Record<string, string> = { "x-dry-run": "1" };
      if (authorization) headers.authorization = authorization;
      const { status, body } = await call(f.deps, post(headers));
      assertEquals(status, 401, `${event.type} ${authorization}`);
      assertEquals(body, { error: "x-dry-run needs the service key as the bearer" });
      assertEquals(f.applied, []);
      assertEquals(f.reversals, []);
      assertEquals(f.feeLookups, []);
      assertEquals(f.sessionLookups, []);
      assertEquals(f.notices, []);
    }
  }
});

Deno.test("x-dry-run answers 401 when the function has no service key", async () => {
  const f = fake();
  f.deps.serviceKey = "";
  const { status } = await call(f.deps, post({ authorization: "Bearer ", "x-dry-run": "1" }));
  assertEquals(status, 401);
  assertEquals(f.applied, []);
  assertEquals(f.feeLookups, []);
});

Deno.test("x-dry-run with a wrong bearer answers 401 before the signature is checked", async () => {
  const f = fake();
  const { status } = await call(
    f.deps,
    post({
      authorization: "Bearer another-key",
      "x-dry-run": "1",
      "stripe-signature": "t=1700000000,v1=wrong",
    }),
  );
  assertEquals(status, 401);
  assertEquals(f.applied, []);
});

Deno.test("a 401 from the dry-run gate leaves the request body unread", async () => {
  const f = fake();
  const body = new ReadableStream<Uint8Array>({
    pull() {
      throw new Error("the gate read the body");
    },
  });
  const req = new Request("https://functions.invalid/stripe-webhook", {
    method: "POST",
    headers: {
      "stripe-signature": GOOD_SIGNATURE,
      authorization: "Bearer another-key",
      "x-dry-run": "1",
    },
    body,
  });
  const res = await createHandler(f.deps)(req);
  assertEquals(res.status, 401);
  assertEquals(req.bodyUsed, false);
  assertEquals(f.applied, []);
});

Deno.test("the service bearer without x-dry-run is a live request, and any value but 1 answers 400", async () => {
  const { deps, applied } = fake();
  const noHeader = await call(
    deps,
    post({ authorization: `Bearer ${SERVICE_KEY}` }),
  );
  assertEquals(noHeader.body.dry_run, undefined);
  assertEquals(applied.length, 1);

  const otherValue = fake();
  const res = await call(
    otherValue.deps,
    post({ authorization: `Bearer ${SERVICE_KEY}`, "x-dry-run": "true" }),
  );
  assertEquals(res.status, 400);
  assertEquals(otherValue.applied, []);
  assertEquals(otherValue.feeLookups, []);
  assertEquals(otherValue.sessionLookups, []);
  assertEquals(otherValue.notices, []);
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
      lookupCharge: () => Promise.resolve(null),
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

Deno.test("a dispute inquiry reverses nothing and tells the board", async () => {
  for (const status of ["warning_needs_response", "warning_under_review", "warning_closed"]) {
    const f = fake({}, disputeEvent({ status }));
    const res = await call(f.deps, post());
    assertEquals(res.status, 200);
    assertEquals(res.body.ignored, true);
    assert(String(res.body.reason).startsWith("dispute inquiry"));
    assertEquals(f.reversals, []);
    assertEquals(f.sessionLookups, []);
    assertEquals(f.applied, []);
    assertEquals(f.notices.length, 1, status);
    assert(f.notices[0]!.includes("dp_handler_1"));
    assert(f.notices[0]!.includes("inquiry"));
    assert(f.notices[0]!.includes("nothing was reversed"));

    const dry = fake({}, disputeEvent({ status }));
    const dryRes = await call(dry.deps, post(DRY_RUN_HEADERS));
    assertEquals(dryRes.status, 200);
    assertEquals(dry.reversals, []);
    assertEquals(dry.notices, []);
  }
});

Deno.test("charge.dispute.funds_withdrawn reverses the disputed amount and alerts", async () => {
  const { deps, reversals, notices } = fake(
    {
      reverseContribution: () =>
        Promise.resolve({ ...REVERSED, reversed_usd: 1, reserve_cover_usd: 0.61 }),
    },
    disputeEvent({}, "charge.dispute.funds_withdrawn"),
  );
  const { status } = await call(deps, post());
  assertEquals(status, 200);
  assertEquals(reversals, [{
    event_id: "evt_handler_dispute",
    session_id: "cs_handler_1",
    kind: "dispute",
    kind_total_usd: 1,
  }]);
  assertEquals(notices.length, 1);
  assert(notices[0]!.startsWith("Dispute dp_handler_1: reversed $1.00"));
});

Deno.test("without the RPC's kind totals, nothing left alerts on created and stays quiet on funds_withdrawn", async () => {
  const nothingLeft = () =>
    Promise.resolve({ found: true, inserted: false, replay: false, parent_id: "c1c1c1c1-x", reversed_usd: 0 });

  const withdrawn = fake(
    { reverseContribution: nothingLeft },
    disputeEvent({ status: "lost" }, "charge.dispute.funds_withdrawn"),
  );
  const first = await call(withdrawn.deps, post());
  assertEquals(first.status, 200);
  assertEquals(withdrawn.reversals.length, 1);
  assertEquals(withdrawn.notices, []);

  const created = fake({ reverseContribution: nothingLeft }, disputeEvent());
  const second = await call(created.deps, post());
  assertEquals(second.status, 200);
  assertEquals(created.notices, [
    "Dispute dp_handler_1: nothing left to reverse on contribution c1c1c1c1",
  ]);
});

/**
 * A reverse_contribution stand-in for the one $1 payment that follows the RPC:
 * each kind reverses up to Stripe's cumulative total, the payment caps them all,
 * an event id is a replay only once it inserted a row, and every result carries
 * kind_reversed_usd and kind_total_usd.
 */
function paymentLedger(paymentUsd = 1) {
  const reversedByKind: Record<string, number> = { refund: 0, dispute: 0 };
  const insertedEvents = new Set<string>();
  const rows: ReversalInput[] = [];
  const reverseContribution = (input: ReversalInput) => {
    const parent_id = REVERSED.parent_id;
    if (insertedEvents.has(input.event_id)) {
      return Promise.resolve({ found: true, inserted: false, replay: true, parent_id });
    }
    const before = reversedByKind[input.kind]!;
    const all = reversedByKind.refund! + reversedByKind.dispute!;
    const delta = Math.min(input.kind_total_usd - before, paymentUsd - all);
    const totals = { kind_reversed_usd: before, kind_total_usd: input.kind_total_usd };
    if (delta <= 0) {
      return Promise.resolve({
        found: true,
        inserted: false,
        replay: false,
        parent_id,
        reversed_usd: 0,
        ...totals,
      });
    }
    insertedEvents.add(input.event_id);
    reversedByKind[input.kind] = before + delta;
    rows.push(input);
    return Promise.resolve({ ...REVERSED, reversed_usd: delta, ...totals });
  };
  return { reverseContribution, rows };
}

function withId(event: WebhookEvent, id: string): WebhookEvent {
  return { ...event, id };
}

/** Delivers each event to a fresh handler over one ledger and collects every alert. */
async function deliver(
  ledger: ReturnType<typeof paymentLedger>,
  events: WebhookEvent[],
): Promise<string[]> {
  const notices: string[] = [];
  for (const event of events) {
    const f = fake({ reverseContribution: ledger.reverseContribution }, event);
    const { status } = await call(f.deps, post());
    assertEquals(status, 200, event.id);
    notices.push(...f.notices);
  }
  return notices;
}

Deno.test("a dispute reverses once and alerts once whichever of its two events arrives first", async () => {
  const created = withId(disputeEvent(), "evt_dispute_created");
  const withdrawn = withId(
    disputeEvent({}, "charge.dispute.funds_withdrawn"),
    "evt_dispute_withdrawn",
  );
  for (const order of [[created, withdrawn], [withdrawn, created]]) {
    const ledger = paymentLedger();
    const notices = await deliver(ledger, order);
    const label = order.map((e) => e.type).join(" then ");
    assertEquals(ledger.rows.length, 1, label);
    assertEquals(notices.length, 1, label);
    assert(notices[0]!.startsWith("Dispute dp_handler_1: reversed $1.00"), label);
  }
});

Deno.test("an inquiry, then a full refund, then the escalation's funds_withdrawn alerts that nothing was left", async () => {
  const ledger = paymentLedger();
  const notices = await deliver(ledger, [
    withId(disputeEvent({ status: "warning_needs_response" }), "evt_inquiry"),
    withId(refundedEvent({ amount_refunded: 100 }), "evt_refund_full"),
    withId(disputeEvent({}, "charge.dispute.funds_withdrawn"), "evt_escalated"),
  ]);
  assertEquals(ledger.rows.map((row) => row.kind), ["refund"]);
  assertEquals(notices.length, 3);
  assert(notices[0]!.includes("is an inquiry"));
  assert(notices[1]!.startsWith("Refund ch_handler_1: reversed $1.00"));
  assertEquals(
    notices[2],
    "Dispute dp_handler_1: nothing left to reverse on contribution c1c1c1c1",
  );
});

Deno.test("the webhook listens to exactly the five events", () => {
  assertEquals([...WEBHOOK_EVENTS], [
    "checkout.session.completed",
    "charge.updated",
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.funds_withdrawn",
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

Deno.test("the reversal message does not call an open card past voting", () => {
  for (const goal_stage of ["proposed", "designing", "voted"]) {
    const message = reversalMessage("refund", "ch_1", {
      ...REVERSED,
      goal_card_id: "abcdef12-0000-4000-8000-000000000000",
      goal_stage,
      goal_funded_usd: 1.5,
      goal_target_usd: 3,
    });
    assert(!message.includes("past voting"), goal_stage);
  }
});

Deno.test("the reversal message warns when the 10% reserve or the emergency fund goes below zero", () => {
  const message = reversalMessage("dispute", "dp_1", {
    ...REVERSED,
    pool_reserve_usd: -0.05,
    pool_incident_reserve_usd: -0.01,
  });
  assert(message.includes("the 10% reserve is below zero"));
  assert(message.includes("the emergency fund is below zero"));

  const healthy = reversalMessage("dispute", "dp_1", {
    ...REVERSED,
    pool_reserve_usd: 0,
    pool_incident_reserve_usd: 0.02,
  });
  assert(!healthy.includes("below zero"));
  assert(!reversalMessage("refund", "ch_1", REVERSED).includes("below zero"));
});

Deno.test("a card payment keys the $50 window on its hashed fingerprint, and a Link payment on the email", async () => {
  const card = fake({
    lookupCharge: () => Promise.resolve({ fee_usd: 0.29, card_fingerprint: "Xt5EWLLDS7FJjR1c" }),
  });
  const paid = await call(card.deps, post());
  assertEquals(paid.status, 200);
  assertEquals(card.applied.length, 1);
  assertEquals(card.applied[0]!.payerKey, `card:${await sha256Hex("Xt5EWLLDS7FJjR1c")}`);
  assertEquals(card.applied[0]!.amounts.fee_usd, 0.29);

  // Link, and any method without a card, reports no fingerprint.
  const link = fake();
  await call(link.deps, post());
  assertEquals(link.applied[0]!.payerKey, `email:${link.applied[0]!.parsed.contributor_id}`);
  assertEquals(link.applied[0]!.parsed.contributor_id, await sha256Hex("board@mobmachine.games"));

  // The same holds when charge.updated credits the session.
  const updated = fake(
    { lookupCharge: () => Promise.resolve({ fee_usd: 0.29, card_fingerprint: "Xt5EWLLDS7FJjR1c" }) },
    chargeUpdatedEvent(),
  );
  await call(updated.deps, post());
  assertEquals(updated.applied[0]!.payerKey, `card:${await sha256Hex("Xt5EWLLDS7FJjR1c")}`);

  // A dry run says which key it would use, and never the key.
  const dry = fake({
    lookupCharge: () => Promise.resolve({ fee_usd: 0.29, card_fingerprint: "Xt5EWLLDS7FJjR1c" }),
  });
  const shown = await call(dry.deps, post(DRY_RUN_HEADERS));
  assertEquals(shown.body.payer, "card");
  assert(!JSON.stringify(shown.body).includes("Xt5EWLLDS7FJjR1c"));
  assertEquals(dry.applied, []);
});

Deno.test("the reversal message says when waiting cards are left short, and by how much", () => {
  const short = reversalMessage("refund", "ch_1", { ...REVERSED, earmarked_usd: 30, shortfall_usd: 13 });
  assert(short.includes("cards waiting for the agents are short by $13.00 until new money arrives"));
  for (const shortfall_usd of [0, undefined]) {
    const whole = reversalMessage("refund", "ch_1", { ...REVERSED, earmarked_usd: 30, shortfall_usd });
    assert(!whole.includes("short by"), String(shortfall_usd));
  }
});

Deno.test("the RPC arguments: apply_contribution gets every parsed field and the session's created time; reverse_contribution gets the reversal", () => {
  const parsed: Parsed = {
    event_id: "evt_args",
    session_id: "cs_args",
    amount_total: 500,
    currency: "usd",
    studio_pct: 20,
    display_name: null,
    contributor_id: "contrib_args",
    goal_card_id: "7f1c1d8e-0000-4000-8000-000000000001",
    session_created_at: "2026-09-20T12:00:00.000Z",
  };
  const amounts: Amounts = { amount_usd: 5, fee_usd: 0.45, net_usd: 4.55 };
  assertEquals(applyContributionArgs(parsed, amounts, "payer_args"), {
    p_stripe_event_id: "evt_args",
    p_contributor_id: "contrib_args",
    p_display_name: null,
    p_amount_usd: 5,
    p_net_usd: 4.55,
    p_studio_pct: 20,
    p_goal_card_id: "7f1c1d8e-0000-4000-8000-000000000001",
    p_stripe_session_id: "cs_args",
    p_payer_key: "payer_args",
    p_session_created_at: "2026-09-20T12:00:00.000Z",
  });
  // A session with no created time is sent as null, so the payment is stamped with no version.
  const untimed = applyContributionArgs({ ...parsed, session_created_at: null }, amounts, "payer_args");
  assert(Object.hasOwn(untimed, "p_session_created_at"));
  assertEquals(untimed.p_session_created_at, null);
  assertEquals(reverseContributionArgs({ event_id: "evt_rev", session_id: "cs_args", kind: "dispute", kind_total_usd: 5 }), {
    p_stripe_event_id: "evt_rev",
    p_stripe_session_id: "cs_args",
    p_kind: "dispute",
    p_kind_total_usd: 5,
  });
});

Deno.test("index.ts sends each RPC the shared arguments and builds none of its own", async () => {
  const index = await Deno.readTextFile(new URL("../stripe-webhook/index.ts", import.meta.url));
  assert(index.includes(`rpc("apply_contribution", applyContributionArgs(parsed, amounts, payerKey))`), "apply_contribution");
  assert(index.includes(`rpc("reverse_contribution", reverseContributionArgs(input))`), "reverse_contribution");
  assertEquals([...index.matchAll(/\brpc\("/g)].length, 2, "no other RPC call");
  assertEquals(index.match(/\bp_[a-z_]+\s*:/g), null, "no argument is named in index.ts");
});
