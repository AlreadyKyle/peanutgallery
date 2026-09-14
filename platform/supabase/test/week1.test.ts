import { describe, expect, it } from "vitest";
import { parseRunNumber, week1Card, WEEK1_RUNS } from "../lib/week1.js";

describe("week1Card", () => {
  it("builds the run-1 card with the gatherer check line from the plan", () => {
    const card = week1Card(parseRunNumber("1"));
    expect(card).toMatchObject({
      bucket: "game",
      source: "board",
      shape: "oneoff",
      lane: "config",
      folder: "seed-1",
      stage: "funded",
      estimate_usd: 2,
    });
    expect(card.acceptance_test.split("\n")).toEqual([
      "spawn table row gatherer: baseCost changes from 10 to 11",
      "check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11",
    ]);
  });

  it("uses forge and mill for runs 2 and 3", () => {
    expect(week1Card(parseRunNumber("2")).acceptance_test).toContain("rows[id=forge].baseCost == 41000");
    expect(week1Card(parseRunNumber("3")).acceptance_test).toContain("rows[id=mill].baseCost == 2600");
    expect(WEEK1_RUNS.map((r) => r.unit)).toEqual(["gatherer", "forge", "mill"]);
  });

  it("gives each run a distinct title", () => {
    const titles = WEEK1_RUNS.map((r) => week1Card(r).title);
    expect(new Set(titles).size).toBe(3);
  });
});

describe("parseRunNumber", () => {
  it("defaults to run 1 and rejects other values", () => {
    expect(parseRunNumber(undefined).run).toBe(1);
    expect(() => parseRunNumber("4")).toThrow("--run must be 1, 2 or 3");
    expect(() => parseRunNumber("one")).toThrow("--run must be 1, 2 or 3");
  });
});
