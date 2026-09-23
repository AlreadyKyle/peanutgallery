import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  cardFingerprintFromSession,
  chargeFromSession,
  type ChargeLike,
  customFieldValue,
  feeFromSession,
  parseSession,
  type SessionLike,
} from "./session.ts";
import { sha256Hex } from "./split.ts";

const GOAL_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const GOAL_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

/** A paid $5 session at the 80/20 split with every optional field empty. */
function session(overrides: Partial<SessionLike> = {}): SessionLike {
  return {
    id: "cs_fixture_1",
    amount_total: 500,
    currency: "usd",
    customer: null,
    customer_details: null,
    client_reference_id: null,
    metadata: null,
    custom_fields: [
      { key: "split", type: "dropdown", dropdown: { value: "8020" } },
      { key: "displayname", type: "text", text: { value: null } },
    ],
    payment_intent: null,
    ...overrides,
  };
}

Deno.test("customFieldValue reads dropdown, text and numeric fields by key", () => {
  const s = session({
    custom_fields: [
      { key: "split", type: "dropdown", dropdown: { value: "5050" } },
      { key: "displayname", type: "text", text: { value: "Board" } },
      { key: "seats", type: "numeric", numeric: { value: "3" } },
      { key: "later", type: "checkbox" },
    ],
  });
  assertEquals(customFieldValue(s, "split"), "5050");
  assertEquals(customFieldValue(s, "displayname"), "Board");
  assertEquals(customFieldValue(s, "seats"), "3");
  assertEquals(customFieldValue(s, "later"), null);
  assertEquals(customFieldValue(s, "absent"), null);
  assertEquals(customFieldValue(session({ custom_fields: [] }), "split"), null);
});

Deno.test("parseSession maps the split dropdown and stores no name, even when a displayname field is sent", async () => {
  const parsed = await parseSession(
    "evt_1",
    session({
      custom_fields: [
        { key: "split", type: "dropdown", dropdown: { value: "7030" } },
        { key: "displayname", type: "text", text: { value: "Board" } },
      ],
    }),
  );
  assertEquals(parsed.event_id, "evt_1");
  assertEquals(parsed.session_id, "cs_fixture_1");
  assertEquals(parsed.amount_total, 500);
  assertEquals(parsed.currency, "usd");
  assertEquals(parsed.studio_pct, 30);
  assertEquals(parsed.display_name, null);
});

Deno.test("parseSession defaults a missing split to 20 and an empty name to null", async () => {
  const parsed = await parseSession("evt_2", session({ custom_fields: [] }));
  assertEquals(parsed.studio_pct, 20);
  assertEquals(parsed.display_name, null);
});

Deno.test("parseSession rejects an unknown split value", async () => {
  await assertRejects(
    () =>
      parseSession(
        "evt_3",
        session({
          custom_fields: [
            { key: "split", type: "dropdown", dropdown: { value: "8000" } },
          ],
        }),
      ),
    Error,
    "Unknown split value",
  );
});

Deno.test("parseSession hashes the email, then the customer id, then the session id", async () => {
  const byEmail = await parseSession(
    "evt_4",
    session({
      customer: "cus_1",
      customer_details: { email: "Board@PeanutGallery.games" },
    }),
  );
  assertEquals(
    byEmail.contributor_id,
    await sha256Hex("board@peanutgallery.games"),
  );

  const byCustomerId = await parseSession(
    "evt_5",
    session({ customer: "cus_1", customer_details: { email: null } }),
  );
  assertEquals(byCustomerId.contributor_id, await sha256Hex("cus_1"));

  const byCustomerObject = await parseSession(
    "evt_6",
    session({ customer: { id: "cus_2" } }),
  );
  assertEquals(byCustomerObject.contributor_id, await sha256Hex("cus_2"));

  const bySession = await parseSession("evt_7", session());
  assertEquals(bySession.contributor_id, await sha256Hex("cs_fixture_1"));
});

Deno.test("parseSession takes the goal card from client_reference_id, then metadata", async () => {
  const fromReference = await parseSession(
    "evt_8",
    session({
      client_reference_id: GOAL_A,
      metadata: { goal_card_id: GOAL_B },
    }),
  );
  assertEquals(fromReference.goal_card_id, GOAL_A);

  const fromMetadata = await parseSession(
    "evt_9",
    session({
      client_reference_id: "week-1",
      metadata: { goal_card_id: GOAL_B },
    }),
  );
  assertEquals(fromMetadata.goal_card_id, GOAL_B);

  const none = await parseSession("evt_10", session());
  assertEquals(none.goal_card_id, null);
});

Deno.test("parseSession rejects a missing amount and a non-usd currency", async () => {
  await assertRejects(
    () => parseSession("evt_11", session({ amount_total: null })),
    Error,
    "no amount_total",
  );
  await assertRejects(
    () => parseSession("evt_12", session({ currency: "cad" })),
    Error,
    "currency is cad, expected usd",
  );
  await assertRejects(
    () => parseSession("evt_13", session({ currency: null })),
    Error,
    "currency is missing",
  );
});

Deno.test("feeFromSession reads an expanded usd balance transaction", () => {
  const fee = feeFromSession(session({
    payment_intent: {
      latest_charge: {
        balance_transaction: { fee: 45, currency: "usd", exchange_rate: null },
      },
    },
  }));
  assertEquals(fee, 0.45);
});

Deno.test("feeFromSession converts a cad settlement fee by the exchange rate", () => {
  const fee = feeFromSession(session({
    payment_intent: {
      latest_charge: {
        balance_transaction: { fee: 45, currency: "cad", exchange_rate: 1.35 },
      },
    },
  }));
  assertEquals(fee, 0.3333);
});

Deno.test("feeFromSession is null while any link is a bare id or missing", () => {
  assertEquals(feeFromSession(session()), null);
  assertEquals(feeFromSession(session({ payment_intent: "pi_1" })), null);
  assertEquals(
    feeFromSession(session({ payment_intent: { latest_charge: null } })),
    null,
  );
  assertEquals(
    feeFromSession(session({ payment_intent: { latest_charge: "ch_1" } })),
    null,
  );
  assertEquals(
    feeFromSession(session({
      payment_intent: { latest_charge: { balance_transaction: "txn_1" } },
    })),
    null,
  );
  assertEquals(
    feeFromSession(session({
      payment_intent: { latest_charge: { balance_transaction: null } },
    })),
    null,
  );
});

/** A session whose expanded latest charge carries a $0.45 usd fee and the given payment method details. */
function paidWith(details: ChargeLike["payment_method_details"]): SessionLike {
  return session({
    payment_intent: {
      latest_charge: {
        balance_transaction: { fee: 45, currency: "usd", exchange_rate: null },
        payment_method_details: details,
      },
    },
  });
}

Deno.test("a card payment's fingerprint comes from the same expanded charge as the fee", () => {
  const card = paidWith({ type: "card", card: { fingerprint: "Xt5EWLLDS7FJjR1c", wallet: null } });
  assertEquals(cardFingerprintFromSession(card), "Xt5EWLLDS7FJjR1c");
  assertEquals(chargeFromSession(card), { fee_usd: 0.45, card_fingerprint: "Xt5EWLLDS7FJjR1c" });
});

Deno.test("an Apple Pay or Google Pay payment is a card payment, read the same way", () => {
  for (const wallet of ["apple_pay", "google_pay"]) {
    const paid = paidWith({ type: "card", card: { fingerprint: `wallet-${wallet}`, wallet: { type: wallet } } });
    assertEquals(chargeFromSession(paid), { fee_usd: 0.45, card_fingerprint: `wallet-${wallet}` });
  }
});

Deno.test("a Link payment, or any method without a card, has no fingerprint and still has its fee", () => {
  const link = paidWith({ type: "link", link: { country: "CA" } });
  assertEquals(cardFingerprintFromSession(link), null);
  assertEquals(chargeFromSession(link), { fee_usd: 0.45, card_fingerprint: null });
  assertEquals(chargeFromSession(paidWith(null)), { fee_usd: 0.45, card_fingerprint: null });
  assertEquals(chargeFromSession(paidWith({ type: "card", card: { fingerprint: "  " } })), { fee_usd: 0.45, card_fingerprint: null });
});

Deno.test("chargeFromSession is null while the fee is not available, whatever the card", () => {
  assertEquals(chargeFromSession(session()), null);
  assertEquals(
    chargeFromSession(session({
      payment_intent: {
        latest_charge: { balance_transaction: "txn_1", payment_method_details: { type: "card", card: { fingerprint: "fp" } } },
      },
    })),
    null,
  );
  assertEquals(cardFingerprintFromSession(session({ payment_intent: { latest_charge: "ch_1" } })), null);
});
