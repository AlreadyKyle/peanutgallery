import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateCheck, parseChecks } from "../../dispatcher/src/acceptance.ts";
import { lanePaths } from "../../dispatcher/src/worktree.ts";
import { DIRECTIVES, REPLACED_NEXT_CARD_TITLE } from "../lib/directives.js";
import { NEXT_CARDS } from "../lib/next-cards.js";
import { preCheckRejection } from "../lib/pre-check.js";

const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const KERNEL_PATHS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../gate/kernel-paths.txt"),
  "utf8",
).split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));

describe("DIRECTIVES", () => {
  it("lists D1, D2 and D3 from the spec as funded code-lane board directives at priority 0", () => {
    expect(DIRECTIVES.map((d) => [d.key, d.executor_role_name, d.estimate_usd])).toEqual([
      ["D1", "Builder A", 8],
      ["D2", "Builder B", 12],
      ["D3", "Builder A", 6],
    ]);
    for (const d of DIRECTIVES) {
      expect(d).toMatchObject({
        bucket: "game",
        source: "board",
        shape: "oneoff",
        lane: "code",
        folder: "seed-1",
        priority: 0,
        confidence: "low",
        stage: "funded",
      });
      expect(d.estimate_usd).toBeLessThanOrEqual(12);
      expect(lanePaths(d.folder, d.lane)).toEqual(["seed-1"]);
      expect(d.summary.length, d.key).toBeLessThanOrEqual(200);
      expect(d.summary, d.key).not.toContain("/");
      expect(d.board_reason, d.key).toMatch(/^(live problem|brand call): /);
    }
    expect(DIRECTIVES[1]!.board_reason).toBe("live problem: progress lost on reload");
  });

  it("names the commands the gate runs in every acceptance test", () => {
    for (const d of DIRECTIVES) {
      expect(d.acceptance_test, d.key).toContain("pnpm --filter @backseat/seed-1 typecheck, test and bot all exit 0.");
    }
  });

  it("parses every check: line and has each one false on the frozen seed-1 fixture, so the pre-check passes", async () => {
    const lines = DIRECTIVES.map((d) => parseChecks(d.acceptance_test).map((c) => [c.file, c.pathText, c.expected]));
    expect(lines).toEqual([
      [["seed-1/content/strings.json", "labels.unlocksEarned", "{count} unlocks earned"]],
      [],
      [["seed-1/content/strings.json", "tabTitle", "Dust · Mob Machine"]],
    ]);
    for (const d of DIRECTIVES) {
      for (const c of parseChecks(d.acceptance_test)) {
        const doc = JSON.parse(readFileSync(resolve(FIXTURE_ROOT, c.file), "utf8"));
        expect(evaluateCheck(c, doc), c.line).toBe(false);
      }
      expect(await preCheckRejection(d.acceptance_test, FIXTURE_ROOT), d.key).toBeNull();
    }
  });

  it("points the builders away from kernel files and names the files that are", () => {
    const protectedInSeed = KERNEL_PATHS.filter((p) => p.startsWith("seed-1/"));
    expect(protectedInSeed).toContain("seed-1/vite.config.ts");
    expect(protectedInSeed).toContain("seed-1/sim/invariants.ts");
    expect(DIRECTIVES[1]!.intent).toContain("sim/invariants.ts is protected and must not change");
    expect(DIRECTIVES[2]!.intent).toContain("publicDir is off in the protected vite.config.ts");
    expect(DIRECTIVES[0]!.intent).toContain("cannot import Phaser");
    expect(DIRECTIVES[1]!.intent).toContain("tests/timeline.test.ts pins the hash of SimState");
    expect(DIRECTIVES[2]!.intent).toContain("strings.title stays 'Dust'");
  });

  it("replaces the Next card of the same purpose", () => {
    expect(NEXT_CARDS.map((c) => c.title)).toContain(REPLACED_NEXT_CARD_TITLE);
    expect(DIRECTIVES.map((d) => d.title)).not.toContain(REPLACED_NEXT_CARD_TITLE);
  });
});
