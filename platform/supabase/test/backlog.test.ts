import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BacklogError, backlogCounts, type ExistingCard, parseBacklog, planBacklog } from "../lib/backlog.js";

const FIXTURE = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "backlog.md"), "utf8");

/** A one-card file with the given bullet lines under the heading. */
function card(title: string, bullets: string[]): string {
  return [`### ${title}`, ...bullets].join("\n");
}

const GOOD = [
  "- bucket: game",
  "- folder: seed-1",
  "- horizon: later",
  "- rank: 3",
  "- summary: A plain summary.",
  "- intent: What it is and why. It is not built yet.",
  "- board: no",
];

/** The problems a file raises, or [] when it parses. */
function problems(text: string): string[] {
  try {
    parseBacklog(text);
    return [];
  } catch (error) {
    if (error instanceof BacklogError) return error.problems;
    throw error;
  }
}

describe("parseBacklog on the fixture", () => {
  it("reads every card, in order, and ignores prose, level-2 headings and fenced blocks", () => {
    const entries = parseBacklog(FIXTURE);
    expect(entries.map((e) => [e.title, e.bucket, e.folder, e.horizon, e.rank, e.board_work])).toEqual([
      ["Free voting on open cards", "platform", "platform", "next", 1, true],
      ["Studio Head drafts cards from the roadmap", "agents", "platform", "next", 2, true],
      ["A second unlock track in Dust", "game", "seed-1", "later", 1, false],
    ]);
    expect(entries[0]!.summary).toBe("Let players pick the next card without paying, alongside funding.");
    expect(entries[0]!.intent.endsWith("It is not built yet.")).toBe(true);
    expect(backlogCounts(entries)).toEqual({ horizon: { next: 2, later: 1 }, folder: { "seed-1": 1, platform: 2 }, board: { yes: 2, no: 1 } });
  });
});

describe("parseBacklog refusals", () => {
  it("accepts a well-formed card", () => {
    expect(problems(card("A card", GOOD))).toEqual([]);
  });

  it("refuses a missing key, keys out of order and a key after board", () => {
    expect(problems(card("A card", GOOD.filter((l) => !l.startsWith("- rank"))))[0]).toContain('needs "- rank: <value>"');
    expect(problems(card("A card", [GOOD[1]!, GOOD[0]!, ...GOOD.slice(2)]))[0]).toContain('needs "- bucket: <value>"');
    expect(problems(card("A card", [...GOOD, "- lane: code"]))[0]).toContain("has a key after board");
    expect(problems(card("A card", GOOD.slice(0, 5)))[0]).toContain("the end of the file");
  });

  it("refuses an entry without its board: bullet, and a board value other than yes or no (docs/specs/copy-pass.md)", () => {
    expect(problems(card("A card", GOOD.slice(0, 6)))[0]).toContain('needs "- board: <value>" here, found the end of the file');
    expect(problems([card("A card", GOOD.slice(0, 6)), card("Next", GOOD.map((l) => (l.startsWith("- rank") ? "- rank: 4" : l)))].join("\n"))[0]).toContain('"A card" needs "- board: <value>" here, found "### Next"');
    expect(problems(card("A card", [...GOOD.slice(0, 6), "- board: maybe"]))[0]).toContain('board "maybe" is not yes or no');
    expect(problems(card("A card", [...GOOD.slice(0, 6), "- board: Yes"]))[0]).toContain('board "Yes" is not yes or no');
    expect(parseBacklog(card("A card", [...GOOD.slice(0, 6), "- board: yes"]))[0]!.board_work).toBe(true);
    expect(parseBacklog(card("A card", GOOD))[0]!.board_work).toBe(false);
  });

  it("refuses values outside the allowed sets", () => {
    const swap = (index: number, line: string) => card("A card", GOOD.map((l, i) => (i === index ? line : l)));
    expect(problems(swap(0, "- bucket: marketing"))[0]).toContain('bucket "marketing"');
    expect(problems(swap(1, "- folder: seed-2"))[0]).toContain('folder "seed-2"');
    expect(problems(swap(2, "- horizon: now"))[0]).toContain('horizon "now" is not next or later');
    expect(problems(swap(3, "- rank: first"))[0]).toContain('rank "first"');
    expect(problems(swap(3, "- rank: -1"))[0]).toContain('rank "-1"');
  });

  it("refuses a long, lower-case or em-dashed summary, an empty intent and a long title", () => {
    const swap = (index: number, line: string) => card("A card", GOOD.map((l, i) => (i === index ? line : l)));
    expect(problems(swap(4, `- summary: A${"a".repeat(200)}`))[0]).toContain("longer than 200");
    expect(problems(swap(4, "- summary: a lower-case start."))[0]).toContain("lower-case");
    expect(problems(swap(4, "- summary: One thing — another."))[0]).toContain("em dash");
    expect(problems(swap(5, "- intent: "))[0]).toContain("intent is empty");
    expect(problems(card("T".repeat(81), GOOD))[0]).toContain("longer than 80");
    expect(problems(card("T".repeat(80), GOOD))).toEqual([]);
  });

  it("refuses a repeated title, a repeated rank on one horizon and a file with no cards", () => {
    expect(problems([card("Same", GOOD), card("Same", GOOD.map((l) => (l.startsWith("- rank") ? "- rank: 4" : l)))].join("\n\n"))[0])
      .toContain('the title "Same" is also on line 1');
    expect(problems([card("One", GOOD), card("Two", GOOD)].join("\n\n"))[0]).toContain("rank 3 on later is also on line 1");
    // The same rank on the other horizon is fine.
    expect(problems([card("One", GOOD), card("Two", GOOD.map((l) => (l.startsWith("- horizon") ? "- horizon: next" : l)))].join("\n\n"))).toEqual([]);
    expect(problems("# Backlog\n\nNothing planned.\n")).toEqual(["no card headings found"]);
    expect(problems("```\n### Inside a fence\n")).toEqual(["a fenced code block is never closed"]);
  });

  it("lists every problem at once", () => {
    const text = [
      card("One", GOOD.map((l) => (l.startsWith("- bucket") ? "- bucket: x" : l))),
      card("Two", GOOD.map((l) => (l.startsWith("- folder") ? "- folder: y" : l))),
    ].join("\n\n");
    // A bad bucket, a bad folder, and rank 3 on later twice.
    expect(problems(text)).toHaveLength(3);
  });
});

describe("planBacklog", () => {
  const entries = parseBacklog(FIXTURE);
  const existing = (over: Partial<ExistingCard> & Pick<ExistingCard, "title">): ExistingCard => ({
    id: `id-${over.title}`,
    stage: "proposed",
    horizon: "next",
    rank: 1,
    bucket: "platform",
    folder: "platform",
    summary: "Let players pick the next card without paying, alongside funding.",
    intent: "A free vote for each signed-in player, counted beside the money on each card, so the audience steers without paying. It is not built yet.",
    source: "board",
    funded_usd: "0.0000",
    funding_target_usd: "0.0000",
    executor_role_id: null,
    drafter_role_id: null,
    opens_at: null,
    board_vetoed: false,
    board_work: true,
    ...over,
  });

  it("inserts every entry into an empty table as a planned card with no target", () => {
    const plan = planBacklog(entries, []);
    expect(plan.update).toEqual([]);
    expect(plan.insert).toHaveLength(3);
    expect(plan.insert[2]).toEqual({
      bucket: "game",
      source: "board",
      shape: "goal",
      lane: "code",
      folder: "seed-1",
      title: "A second unlock track in Dust",
      summary: "A second set of unlocks that opens after the first track is complete.",
      intent: "Players who finish every unlock get a new track with its own goals, so the game keeps a next goal on screen. It is not built yet.",
      stage: "proposed",
      horizon: "later",
      rank: 1,
      funding_target_usd: 0,
      estimate_usd: 0,
      priority: 100,
      confidence: "low",
      board_work: false,
    });
    expect(plan.insert.map((r) => r.board_work)).toEqual([true, true, false]);
  });

  it("sets each filed card's board_work from its entry, as an in-place update (docs/specs/copy-pass.md)", () => {
    const plan = planBacklog(entries, [
      existing({ title: "Free voting on open cards", board_work: false }),
      existing({ title: "Studio Head drafts cards from the roadmap", rank: 2, summary: "The Studio Head turns roadmap items into draft cards for the board to review.", intent: "A scheduled Studio Head session reads the roadmap and files draft cards the board can edit and move to now. It is not built yet.", bucket: "agents" }),
      existing({ title: "A second unlock track in Dust", horizon: "later", folder: "seed-1", bucket: "game", summary: "A second set of unlocks that opens after the first track is complete.", intent: "Players who finish every unlock get a new track with its own goals, so the game keeps a next goal on screen. It is not built yet." }),
    ]);
    expect(plan.update).toEqual([
      { id: "id-Free voting on open cards", title: "Free voting on open cards", patch: { board_work: true } },
      { id: "id-A second unlock track in Dust", title: "A second unlock track in Dust", patch: { board_work: false } },
    ]);
    expect(plan.unchanged).toEqual(["Studio Head drafts cards from the roadmap"]);
    expect([plan.insert, plan.remove, plan.skipped]).toEqual([[], [], []]);
  });

  it("leaves a filed card alone when the file has not changed, and updates only what did", () => {
    const same = existing({ title: "Free voting on open cards" });
    const moved = existing({
      title: "Studio Head drafts cards from the roadmap",
      bucket: "agents",
      rank: 5,
      horizon: "later",
      summary: "The Studio Head turns roadmap items into draft cards for the board to review.",
      intent: "An older intent.",
    });
    const plan = planBacklog(entries, [same, moved]);
    expect(plan.unchanged).toEqual(["Free voting on open cards"]);
    expect(plan.update).toEqual([
      {
        id: moved.id,
        title: moved.title,
        patch: {
          horizon: "next",
          rank: 2,
          intent: "A scheduled Studio Head session reads the roadmap and files draft cards the board can edit and move to now. It is not built yet.",
        },
      },
    ]);
    expect(plan.insert.map((r) => r.title)).toEqual(["A second unlock track in Dust"]);
  });

  it("never pulls back a card the board moved to now, funded or cancelled", () => {
    const plan = planBacklog(entries, [
      existing({ title: "Free voting on open cards", horizon: "now" }),
      existing({ title: "Studio Head drafts cards from the roadmap", stage: "rejected", horizon: "next" }),
    ]);
    expect(plan.skipped.map((s) => s.title)).toEqual(["Free voting on open cards", "Studio Head drafts cards from the roadmap"]);
    expect(plan.skipped[0]!.reason).toBe("card id-Free voting on open cards is at stage proposed on now");
    expect(plan.update).toEqual([]);
    expect(plan.insert.map((r) => r.title)).toEqual(["A second unlock track in Dust"]);
  });

  it("leaves a card with a drafter, an opens_at or a board veto untouched (docs/specs/agent-system-core.md)", () => {
    const plan = planBacklog(entries, [
      existing({ title: "Free voting on open cards", rank: 7, drafter_role_id: "role-designer" }),
      existing({ title: "Studio Head drafts cards from the roadmap", rank: 7, opens_at: "2026-09-24T00:00:00Z" }),
      existing({ title: "A second unlock track in Dust", folder: "seed-1", rank: 7, board_vetoed: true }),
      existing({ id: "gone-drafted", title: "An entry that left the file", drafter_role_id: "role-designer" }),
      existing({ id: "gone-dealing", title: "Another entry that left the file", opens_at: "2026-09-24T00:00:00Z" }),
      existing({ id: "gone-vetoed", title: "A third entry that left the file", board_vetoed: true }),
    ]);
    expect(plan.skipped).toEqual([
      { title: "Free voting on open cards", reason: "card id-Free voting on open cards is drafted" },
      { title: "Studio Head drafts cards from the roadmap", reason: "card id-Studio Head drafts cards from the roadmap is waiting to be dealt" },
      { title: "A second unlock track in Dust", reason: "card id-A second unlock track in Dust is vetoed" },
    ]);
    expect([plan.update, plan.insert, plan.remove]).toEqual([[], [], []]);
  });

  it("lists for removal every planned card whose entry left the file, and only a board-filed one at proposed on next or later that never held money and was never drafted", () => {
    const gone = (id: string, over: Partial<ExistingCard> = {}) => existing({ id, title: `Left the file ${id}`, ...over });
    const plan = planBacklog(entries, [
      existing({ title: "Free voting on open cards" }),
      gone("split-aggregate"),
      gone("dispute-won", { horizon: "later" }),
      gone("on-now", { horizon: "now" }),
      gone("voted", { stage: "voted" }),
      gone("agent", { source: "agent" }),
      gone("funded", { funded_usd: "1.0000" }),
      gone("targeted", { funding_target_usd: "5.0000" }),
      gone("with-executor", { executor_role_id: "role-builder-a" }),
      gone("drafted", { drafter_role_id: "role-designer" }),
      gone("dealing", { opens_at: "2026-09-24T00:00:00Z" }),
      gone("vetoed", { board_vetoed: true }),
      // Read twice (by title and as a planned card): listed once.
      gone("split-aggregate"),
    ]);
    expect(plan.remove).toEqual([
      { id: "split-aggregate", title: "Left the file split-aggregate" },
      { id: "dispute-won", title: "Left the file dispute-won" },
    ]);
  });

  it("updates the backlog copy when a title is also held by a card on now", () => {
    const plan = planBacklog(entries.slice(0, 1), [
      existing({ id: "on-now", title: "Free voting on open cards", horizon: "now", stage: "funded" }),
      existing({ id: "planned", title: "Free voting on open cards", rank: 9 }),
    ]);
    expect(plan.update).toEqual([{ id: "planned", title: "Free voting on open cards", patch: { rank: 1 } }]);
  });
});

describe("file-backlog --apply", () => {
  const script = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "file-backlog.ts"), "utf8");

  it("deletes the removals in one request, repeating every condition of a removable card as a filter", () => {
    expect(script.match(/\.delete\(\)/g)).toHaveLength(1);
    const call = script.slice(script.indexOf(".delete()"), script.indexOf('.select("id");', script.indexOf(".delete()")));
    for (const filter of [
      '.in("id", plan.remove.map((card) => card.id))',
      '.eq("source", "board")',
      '.eq("stage", "proposed")',
      '.in("horizon", ["next", "later"])',
      '.eq("funded_usd", 0)',
      '.eq("funding_target_usd", 0)',
      '.is("executor_role_id", null)',
      '.is("drafter_role_id", null)',
      '.is("opens_at", null)',
      '.eq("board_vetoed", false)',
    ]) {
      expect(call, filter).toContain(filter);
    }
  });

  it("prints a refused delete with the database's message, which names the constraint, and deletes nothing", () => {
    expect(script).toContain("throw new Error(`cards delete refused, nothing deleted: ${deleted.error.message}");
  });
});
