import { describe, expect, it } from "vitest";
import { signPayload, syntheticEvent } from "../lib/synthetic-event.js";

describe("signPayload", () => {
  it("produces the Stripe-Signature header with the HMAC-SHA256 of timestamp.payload", () => {
    // Vector computed independently with `openssl dgst -sha256 -hmac 'unit-test-signing-secret'`
    // over the string `1700000000.{"id":"evt_1","type":"checkout.session.completed"}`.
    const payload = '{"id":"evt_1","type":"checkout.session.completed"}';
    expect(signPayload(payload, "unit-test-signing-secret", 1700000000)).toBe(
      "t=1700000000,v1=1333878f2b318962b7f421bceacd66b6b6c5e1114e5a1875bd3d680d66663b31",
    );
  });

  it("changes with the secret, the timestamp and the payload", () => {
    const base = signPayload("{}", "unit-test-signing-secret", 1700000000);
    expect(signPayload("{}", "another-secret", 1700000000)).not.toBe(base);
    expect(signPayload("{}", "unit-test-signing-secret", 1700000001)).not.toBe(base);
    expect(signPayload("[]", "unit-test-signing-secret", 1700000000)).not.toBe(base);
  });
});

describe("syntheticEvent", () => {
  it("builds a paid usd checkout.session.completed event with the split and display name fields", () => {
    const event = syntheticEvent("abc", 250, "5050", 1700000000);
    expect(event).toMatchObject({
      id: "evt_synthetic_abc",
      type: "checkout.session.completed",
      created: 1700000000,
      livemode: false,
    });
    const session = (event.data as { object: Record<string, unknown> }).object;
    expect(session).toMatchObject({
      id: "cs_synthetic_abc",
      amount_total: 250,
      currency: "usd",
      payment_status: "paid",
      payment_intent: null,
      client_reference_id: null,
    });
    expect(session.custom_fields).toEqual([
      { key: "split", type: "dropdown", optional: false, dropdown: { value: "5050" } },
      { key: "displayname", type: "text", optional: true, text: { value: "Board dry run" } },
    ]);
  });
});
