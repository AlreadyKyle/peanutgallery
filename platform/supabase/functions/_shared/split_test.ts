import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  computeAmounts,
  contributorId,
  contributorSource,
  feeToUsd,
  goalCardId,
  mapSplit,
  payerKey,
  sha256Hex,
  SPLIT_MAP,
} from "./split.ts";

// Known SHA-256 vectors (FIPS 180-4 examples).
const SHA256_EMPTY =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SHA256_ABC =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

Deno.test("mapSplit maps all eleven dropdown values", () => {
  assertEquals(mapSplit("1000"), 0);
  assertEquals(mapSplit("9010"), 10);
  assertEquals(mapSplit("8020"), 20);
  assertEquals(mapSplit("7030"), 30);
  assertEquals(mapSplit("6040"), 40);
  assertEquals(mapSplit("5050"), 50);
  assertEquals(mapSplit("4060"), 60);
  assertEquals(mapSplit("3070"), 70);
  assertEquals(mapSplit("2080"), 80);
  assertEquals(mapSplit("1090"), 90);
  assertEquals(mapSplit("0100"), 100);
  assertEquals(Object.keys(SPLIT_MAP).length, 11);
});

Deno.test("mapSplit defaults a missing value to 20 and rejects unknown values", () => {
  assertEquals(mapSplit(null), 20);
  assertEquals(mapSplit(undefined), 20);
  assertEquals(mapSplit(""), 20);
  assertThrows(() => mapSplit("8000"), Error, "Unknown split value");
  assertThrows(() => mapSplit("80/20"), Error, "Unknown split value");
});

Deno.test("feeToUsd keeps a usd fee and divides a settlement-currency fee by the exchange rate", () => {
  assertEquals(feeToUsd(33, "usd", null), 0.33);
  assertEquals(feeToUsd(33, "USD", 1.35), 0.33);
  // 45 cents CAD at 1.35 CAD per USD is 0.3333 USD.
  assertEquals(feeToUsd(45, "cad", 1.35), 0.3333);
  assertEquals(feeToUsd(0, "cad", 1.35), 0);
});

Deno.test("feeToUsd rejects a non-usd fee without an exchange rate", () => {
  assertThrows(() => feeToUsd(45, "cad", null), Error, "no exchange rate");
  assertThrows(() => feeToUsd(45, "cad", 0), Error, "no exchange rate");
  assertThrows(
    () => feeToUsd(-1, "usd", null),
    Error,
    "Invalid balance transaction fee",
  );
});

Deno.test("computeAmounts derives amount and net from cents and the fee", () => {
  assertEquals(computeAmounts(100, 0.29), {
    amount_usd: 1,
    fee_usd: 0.29,
    net_usd: 0.71,
  });
  assertEquals(computeAmounts(500, 0.4453), {
    amount_usd: 5,
    fee_usd: 0.4453,
    net_usd: 4.5547,
  });
  assertEquals(computeAmounts(100, 0), {
    amount_usd: 1,
    fee_usd: 0,
    net_usd: 1,
  });
});

Deno.test("computeAmounts rejects bad inputs", () => {
  assertThrows(() => computeAmounts(0, 0), Error, "Invalid amount_total");
  assertThrows(() => computeAmounts(100.5, 0), Error, "Invalid amount_total");
  assertThrows(() => computeAmounts(100, -0.01), Error, "Invalid fee");
  assertThrows(() => computeAmounts(100, 1.01), Error, "exceeds amount");
});

Deno.test("contributorSource prefers the lowercased email, then the customer, then the session", () => {
  assertEquals(
    contributorSource({
      email: " Board@PeanutGallery.games ",
      customerId: "cus_1",
      sessionId: "cs_1",
    }),
    "board@peanutgallery.games",
  );
  assertEquals(
    contributorSource({ email: null, customerId: "cus_1", sessionId: "cs_1" }),
    "cus_1",
  );
  assertEquals(
    contributorSource({ email: "", customerId: "", sessionId: "cs_1" }),
    "cs_1",
  );
  assertEquals(contributorSource({ sessionId: "cs_1" }), "cs_1");
});

Deno.test("contributorId is the sha256 hex of the source", async () => {
  assertEquals(await sha256Hex(""), SHA256_EMPTY);
  assertEquals(await sha256Hex("abc"), SHA256_ABC);
  assertEquals(
    await contributorId({ email: "ABC", sessionId: "cs_1" }),
    SHA256_ABC,
  );
  assertEquals(await contributorId({ sessionId: "abc" }), SHA256_ABC);
  const id = await contributorId({
    email: "board@peanutgallery.games",
    sessionId: "cs_1",
  });
  assertEquals(id.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(id), true);
});

Deno.test("goalCardId accepts only a well-formed uuid, client_reference_id first", () => {
  const a = "6f1d2c3b-4a5e-4f60-8b71-9c2d3e4f5a6b";
  const b = "0a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d";
  assertEquals(goalCardId(a, b), a);
  assertEquals(goalCardId("week-1", b), b);
  assertEquals(goalCardId(a.toUpperCase(), null), a);
  assertEquals(goalCardId("week-1", "week-1"), null);
  assertEquals(goalCardId(null, undefined), null);
});

Deno.test("payerKey is card: and the hashed fingerprint, or email: and the contributor id", async () => {
  assertEquals(await payerKey("Xt5EWLLDS7FJjR1c", "c0ffee"), `card:${await sha256Hex("Xt5EWLLDS7FJjR1c")}`);
  assertEquals(await payerKey(" Xt5EWLLDS7FJjR1c ", "c0ffee"), `card:${await sha256Hex("Xt5EWLLDS7FJjR1c")}`);
  // The fingerprint itself never appears in the key.
  assertEquals((await payerKey("Xt5EWLLDS7FJjR1c", "c0ffee")).includes("Xt5EWLLDS7FJjR1c"), false);
  assertEquals(await payerKey(null, "c0ffee"), "email:c0ffee");
  assertEquals(await payerKey(undefined, "c0ffee"), "email:c0ffee");
  assertEquals(await payerKey("   ", "c0ffee"), "email:c0ffee");
});
