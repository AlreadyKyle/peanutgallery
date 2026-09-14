import { assertEquals } from "jsr:@std/assert@1";
import {
  createHandler,
  type HandlerDeps,
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

interface Fake {
  deps: HandlerDeps;
  applied: { parsed: Parsed; amounts: Amounts }[];
  feeLookups: string[];
}

function fake(
  overrides: Partial<Pick<HandlerDeps, "lookupFee" | "applyContribution">> = {},
  event: WebhookEvent = completedEvent(),
): Fake {
  const applied: Fake["applied"] = [];
  const feeLookups: string[] = [];
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
    applyContribution: (parsed, amounts) => {
      applied.push({ parsed, amounts });
      return Promise.resolve({ inserted: true, contribution_id: "c1" });
    },
    serviceKey: SERVICE_KEY,
    ...overrides,
  };
  return { deps, applied, feeLookups };
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

Deno.test("handler answers 500 while the balance transaction is missing so Stripe retries", async () => {
  const { deps, applied } = fake({ lookupFee: () => Promise.resolve(null) });
  const { status, body } = await call(deps, post());
  assertEquals(status, 500);
  assertEquals(body, { error: "Balance transaction is not available yet" });
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
