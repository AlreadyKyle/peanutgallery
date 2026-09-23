import { describe, expect, it } from "vitest";
import { checkAllocations, checkIdentity, fromUnits, ledgerTotals, toUnits } from "../lib/ledger-identity.js";

describe("toUnits and fromUnits", () => {
  it("round-trip four-decimal amounts exactly, negatives included", () => {
    for (const text of ["0.0000", "0.5019", "-22.5000", "123456789.1234"]) {
      expect(fromUnits(toUnits(text))).toBe(text);
    }
    expect(toUnits("1.5")).toBe(15000n);
    expect(toUnits(0.1 + 0.2)).toBe(3000n);
  });

  it("refuses anything that is not an amount", () => {
    expect(() => toUnits("NaN")).toThrow("not an amount");
    expect(() => toUnits("1.23456")).toThrow("not an amount");
  });
});

describe("checkIdentity", () => {
  // The live pool after the board's $1 at 80/20: pool credit 0.5019, reserve 0.0734, incident 0.0264.
  const pool = { balance_usd: "0.5019", reserve_usd: "0.0734", incident_reserve_usd: "0.0264", held_usd: "0.0000" };
  const paid = { reserve_usd: "0.0734", agents_usd: "0.5283", held_usd: "0.0000" };

  it("holds for the first live contribution with founder rows left out", () => {
    const lines = checkIdentity(pool, [paid], []);
    expect(lines.map((l) => [l.name, l.holds, l.drift])).toEqual([
      ["I1", true, "0.0000"],
      ["I2", true, "0.0000"],
      ["I3", true, "0.0000"],
    ]);
  });

  it("holds across a hold, its release and a partial refund", () => {
    const rows = [
      { reserve_usd: "12.0000", agents_usd: "108.0000", held_usd: "58.0000" },
      { reserve_usd: "0.0000", agents_usd: "0.0000", held_usd: "-58.0000" },
      { reserve_usd: "-3.0000", agents_usd: "-27.0000", held_usd: "0.0000" },
    ];
    const after = { balance_usd: "81.0000", reserve_usd: "9.0000", incident_reserve_usd: "0.0000", held_usd: "0.0000" };
    expect(checkIdentity(after, rows, []).every((l) => l.holds)).toBe(true);
  });

  it("names the drift when studio spend is missing from the pool", () => {
    const lines = checkIdentity(pool, [paid], [{ usd: "0.2500" }]);
    expect(lines[1]).toEqual({ name: "I2", left: "0.5283", right: "0.2783", drift: "0.2500", holds: false });
  });

  it("leaves overhead and founder rows out, since neither touches the pool", () => {
    const rows = [
      { usd: "0.0312", billed_to: "overhead" as const },
      { usd: "0.4000", billed_to: "founder" as const },
    ];
    expect(checkIdentity(pool, [paid], rows).every((l) => l.holds)).toBe(true);
    // A studio row is still counted, with or without billed_to.
    expect(checkIdentity(pool, [paid], [...rows, { usd: "0.2500", billed_to: "studio" as const }])[1]!.drift).toBe("0.2500");
    expect(ledgerTotals([...rows, { usd: "0.2500" }])).toEqual({ studio: "0.2500", overhead: "0.0312" });
  });
});

// docs/specs/money-logic.md: I4 and I5 check the waterfall's allocations as counts.
describe("checkAllocations", () => {
  // Production on 23 September 2026: the board's $1 test payment, 0.5019 of credit booked apart.
  const payment = { id: "p1", parent_id: null, agents_usd: "0.5283", incident_usd: "0.0264", held_usd: "0.0000" };
  const bookedApart = { payment_id: "p1", destination: "board_test" as const, card_id: null, amount_usd: "0.5019" };

  it("holds on production's shape: the test payment's credit on board_test and every bar empty", () => {
    const lines = checkAllocations([payment], [bookedApart], [{ id: "c1", funded_usd: "0.0000" }]);
    expect(lines).toEqual([
      { name: "I4", left: "0", right: "0", drift: "0", holds: true },
      { name: "I5", left: "0", right: "0", drift: "0", holds: true },
    ]);
  });

  it("holds across a card placement, a hold's release and a refund that unwinds the card", () => {
    const rows = [
      { id: "p2", parent_id: null, agents_usd: "10.0000", incident_usd: "0.0000", held_usd: "4.0000" },
      { id: "r2", parent_id: "p2", agents_usd: "0.0000", incident_usd: "0.0000", held_usd: "-4.0000" },
      { id: "f2", parent_id: "p2", agents_usd: "-5.0000", incident_usd: "0.0000", held_usd: "0.0000" },
    ];
    const placed = [
      { payment_id: "p2", destination: "card" as const, card_id: "c2", amount_usd: "6.0000" },
      { payment_id: "p2", destination: "card" as const, card_id: "c2", amount_usd: "2.0000" },
      { payment_id: "p2", destination: "unassigned" as const, card_id: null, amount_usd: "2.0000" },
      { payment_id: "p2", destination: "unassigned" as const, card_id: null, amount_usd: "-2.0000" },
      { payment_id: "p2", destination: "card" as const, card_id: "c2", amount_usd: "-3.0000" },
    ];
    expect(checkAllocations(rows, placed, [{ id: "c2", funded_usd: "5.0000" }]).every((l) => l.holds)).toBe(true);
  });

  it("names the payment and the card a forged allocation row makes drift", () => {
    const forged = { payment_id: "p1", destination: "card" as const, card_id: "c1", amount_usd: "1.0000" };
    const lines = checkAllocations([payment], [bookedApart, forged], [{ id: "c1", funded_usd: "0.0000" }]);
    expect(lines.map((l) => [l.name, l.drift, l.holds])).toEqual([["I4", "1", false], ["I5", "1", false]]);
    // A bar moved without an allocation drifts I5 alone.
    const bar = checkAllocations([payment], [bookedApart], [{ id: "c1", funded_usd: "1.0000" }]);
    expect(bar.map((l) => [l.name, l.holds])).toEqual([["I4", true], ["I5", false]]);
  });
});
