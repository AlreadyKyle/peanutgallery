import { describe, expect, it } from "vitest";
import { checkIdentity, fromUnits, toUnits } from "../lib/ledger-identity.js";

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
});
