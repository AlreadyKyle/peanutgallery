import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateCheck, parseChecks } from "../../dispatcher/src/acceptance.ts";
import { NEXT_CARDS } from "../lib/next-cards.js";
import { preCheckRejection } from "../lib/pre-check.js";

/** Copies of seed-1 files frozen at 14 September 2026 so shipping a card cannot break the suite. */
const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
/** docs/specs/next-cards.md, decision of 2026-09-14: targets at or below $25 stay under the design-stage threshold. */
const TARGET_CEILING_USD = 25;
/** The line rule file_card applies to a config-lane acceptance test. */
const FILE_CARD_CHECK_LINE = /(^|\n)\s*check:\s/;

/** A check's seed-1/... path read from the fixture directory. */
function readFixture(relativePath: string): unknown {
  expect(relativePath).toMatch(/^seed-1\//);
  return JSON.parse(readFileSync(resolve(FIXTURE_ROOT, relativePath), "utf8"));
}

function checkLines(acceptanceTest: string): string[] {
  return acceptanceTest.split("\n").filter((line) => line.trim().startsWith("check:"));
}

describe("NEXT_CARDS", () => {
  it("lists the four cards from the spec, in order, with the fixed fields", () => {
    expect(NEXT_CARDS.map((c) => [c.title, c.stage, c.lane, c.executor_role_name, c.funding_target_usd])).toEqual([
      ["A fourteenth unlock: Quiet rooms at 300M dust", "voted", "config", "Builder A", 3],
      ["Rename the Gatherer to Sweeper", "proposed", "config", "Builder B", 2],
      ["Cheaper Cart: baseCost 120", "proposed", "config", "Builder A", 3],
      ["Save the game and resume on reload", "proposed", "code", "Builder B", 12],
    ]);
    for (const card of NEXT_CARDS) {
      expect(card).toMatchObject({
        bucket: "game",
        source: "board",
        shape: "goal",
        folder: "seed-1",
        confidence: "low",
        priority: 100,
      });
      expect(["proposed", "voted"]).toContain(card.stage);
      expect(card.estimate_usd).toBe(card.funding_target_usd);
      expect(card.funding_target_usd).toBeGreaterThan(0);
      expect(card.funding_target_usd).toBeLessThanOrEqual(TARGET_CEILING_USD);
      expect(card.title.trim()).toBe(card.title);
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.intent.length).toBeGreaterThan(0);
    }
    expect(new Set(NEXT_CARDS.map((c) => c.title)).size).toBe(NEXT_CARDS.length);
  });

  it("gives every card the spec's plain public summary, at most 200 characters, with no file names", () => {
    expect(NEXT_CARDS.map((c) => [c.title, c.summary])).toEqual([
      ["A fourteenth unlock: Quiet rooms at 300M dust", "Add one more unlock after the last one, so players always have a next goal on screen."],
      ["Rename the Gatherer to Sweeper", "Rename the first unit from Gatherer to Sweeper, with a new one-line description."],
      ["Cheaper Cart: baseCost 120", "Lower the Cart's cost so new players can buy one soon after it appears."],
      ["Save the game and resume on reload", "Save progress in the browser, so a reload picks up where you left off."],
    ]);
    for (const card of NEXT_CARDS) {
      expect(card.summary.trim().length, card.title).toBeGreaterThan(0);
      expect(card.summary.length, card.title).toBeLessThanOrEqual(200);
      expect(card.summary, card.title).not.toContain("/");
      expect(card.summary, card.title).not.toContain(".ts");
      expect(card.summary.toLowerCase(), card.title).not.toContain("bot");
    }
  });

  it("gives every config-lane card a check: line that file_card accepts, and the code-lane card none", () => {
    for (const card of NEXT_CARDS) {
      const lines = checkLines(card.acceptance_test);
      if (card.lane === "config") {
        expect(lines.length, card.title).toBeGreaterThan(0);
        expect(card.acceptance_test, card.title).toMatch(FILE_CARD_CHECK_LINE);
      } else {
        expect(lines, card.title).toEqual([]);
        expect(parseChecks(card.acceptance_test)).toEqual([]);
      }
    }
  });

  it("parses every check: line with the dispatcher grammar", () => {
    for (const card of NEXT_CARDS) {
      const checks = parseChecks(card.acceptance_test);
      expect(checks.length, card.title).toBe(checkLines(card.acceptance_test).length);
      for (const check of checks) {
        expect(check.kind).toBe("config");
        expect(check.file, check.line).toMatch(/^seed-1\/(config|content)\/[a-z-]+\.json$/);
        expect(check.path.length, check.line).toBeGreaterThan(0);
      }
    }
    const [quietRooms, sweeper, cart] = NEXT_CARDS.map((c) => parseChecks(c.acceptance_test));
    expect(quietRooms!.map((c) => [c.file, c.pathText, c.expected])).toEqual([
      ["seed-1/config/unlocks.json", "unlocks[id=quiet-rooms].atTotalDust", 300000000],
      ["seed-1/config/unlocks.json", "unlocks[id=quiet-rooms].effect", { type: "multiplier", value: 1.05 }],
    ]);
    expect(sweeper!.map((c) => [c.file, c.pathText, c.expected])).toEqual([
      ["seed-1/config/spawn-table.json", "rows[id=gatherer].name", "Sweeper"],
      ["seed-1/content/strings.json", "unitDescriptions.gatherer", "Sweeps dust into a pile."],
    ]);
    expect(cart!.map((c) => [c.file, c.pathText, c.expected])).toEqual([
      ["seed-1/config/spawn-table.json", "rows[id=cart].baseCost", 120],
    ]);
  });

  it("has every check false against the frozen seed-1 fixture, so the dispatcher's pre-check passes", async () => {
    let evaluated = 0;
    for (const card of NEXT_CARDS) {
      for (const check of parseChecks(card.acceptance_test)) {
        expect(evaluateCheck(check, readFixture(check.file)), `${card.title}: ${check.line}`).toBe(false);
        evaluated += 1;
      }
      expect(await preCheckRejection(card.acceptance_test, FIXTURE_ROOT), card.title).toBeNull();
    }
    expect(evaluated).toBe(5);
  });
});

describe("preCheckRejection", () => {
  const cartIs150 = "check: config seed-1/config/spawn-table.json rows[id=cart].baseCost == 150";
  const gathererIsSweeper = 'check: config seed-1/config/spawn-table.json rows[id=gatherer].name == "Sweeper"';

  it("rejects a card whose checks all hold, as the dispatcher does with acceptance_already_true", async () => {
    expect(await preCheckRejection(`Prose.\n${cartIs150}`, FIXTURE_ROOT)).toEqual({
      failingCheck: "acceptance_already_true",
      detail: "every check: line already holds",
    });
  });

  it("passes a card when any check is false or its file cannot be read", async () => {
    expect(await preCheckRejection(`${cartIs150}\n${gathererIsSweeper}`, FIXTURE_ROOT)).toBeNull();
    expect(await preCheckRejection("check: config seed-1/config/missing.json rows[id=cart].baseCost == 150", FIXTURE_ROOT)).toBeNull();
  });

  it("passes a card with no check: lines", async () => {
    expect(await preCheckRejection("tests pass.", FIXTURE_ROOT)).toBeNull();
    expect(await preCheckRejection(null, FIXTURE_ROOT)).toBeNull();
  });

  it("rejects a malformed check: line with acceptance_grammar", async () => {
    expect(await preCheckRejection("check: config seed-1/config/spawn-table.json rows[id=cart].baseCost 120", FIXTURE_ROOT)).toMatchObject({
      failingCheck: "acceptance_grammar",
    });
  });
});
