import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { evaluateCheck, parseChecks } from "../../dispatcher/src/acceptance.ts";
import { preCheckRejection } from "../lib/pre-check.js";
import {
  applyPlan,
  countPlan,
  describePlan,
  loadLaunchCards,
  parseArgs,
  parseLaunchCards,
  planRefresh,
  readinessRefusal,
  supabaseStore,
  UsageError,
  type CardPatch,
  type CardRow,
  type CardStore,
  type LaunchCards,
  type NewCardRow,
  type ReadyEntry,
  type RoleRow,
} from "../scripts/refresh-cards.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "refresh-cards");

/**
 * The nine production cards as the public anon endpoint returned them on
 * 22 September 2026, with the two contract columns at the defaults the backlog
 * migration gives existing rows (horizon now, no rank).
 */
type FixtureCard = CardRow & { branch: string | null; commit_sha: string | null; live_at: string | null };
const PRODUCTION_CARDS: readonly FixtureCard[] = JSON.parse(readFileSync(resolve(FIXTURES, "cards.json"), "utf8"));
/** The production roles read the same way: id, name and state. */
const PRODUCTION_ROLES: readonly RoleRow[] = JSON.parse(readFileSync(resolve(FIXTURES, "roles.json"), "utf8"));

/** Copies of the seed-1 config and content at the launch commit, so shipping a card cannot break the suite. */
function fixtureDoc(file: string): unknown {
  expect(file).toMatch(/^seed-1\/(config|content)\/[a-z-]+\.json$/);
  return JSON.parse(readFileSync(resolve(FIXTURES, file), "utf8"));
}

/**
 * Measured cost of the most expensive card of each lane (docs/specs/week1-runs.md):
 * config, run 1 at $0.0585 (runs were $0.0330 to $0.0585); code, D1 at $0.2868
 * (D1 to D3 were $0.1152 to $0.2868).
 */
const MEASURED_MAX_USD = { config: 0.0585, code: 0.2868 } as const;
/** A target is five times the lane's highest measured cost, rounded up to the next 50 cents. */
function honestTarget(lane: "config" | "code"): number {
  return Math.ceil((MEASURED_MAX_USD[lane] * 5) / 0.5) * 0.5;
}

const seed = loadLaunchCards();
const nowCards: ReadyEntry[] = [...seed.open, ...seed.new];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The cards table and roles in memory, recording every write. */
class MemoryStore implements CardStore {
  readonly cards: FixtureCard[];
  readonly roles: RoleRow[];
  readonly writes: string[] = [];
  private nextId = 1;

  constructor(cards: readonly FixtureCard[] = PRODUCTION_CARDS, roles: readonly RoleRow[] = PRODUCTION_ROLES) {
    this.cards = clone([...cards]);
    this.roles = clone([...roles]);
  }

  card(id: string): FixtureCard {
    const card = this.cards.find((c) => c.id === id);
    if (card === undefined) throw new Error(`no card ${id}`);
    return card;
  }

  async cardsById(ids: readonly string[]): Promise<CardRow[]> {
    return clone(this.cards.filter((c) => ids.includes(c.id)));
  }

  async cardsByTitle(titles: readonly string[]): Promise<CardRow[]> {
    return clone(this.cards.filter((c) => titles.includes(c.title)));
  }

  async rolesByName(names: readonly string[]): Promise<RoleRow[]> {
    return clone(this.roles.filter((r) => names.includes(r.name)));
  }

  async updateCard(id: string, expectedStage: string, patch: CardPatch): Promise<boolean> {
    const card = this.cards.find((c) => c.id === id && c.stage === expectedStage);
    if (card === undefined) return false;
    Object.assign(card, patch);
    this.writes.push(`update ${id}`);
    return true;
  }

  async insertCard(row: NewCardRow): Promise<string> {
    const id = `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
    this.cards.push({ ...row, id, branch: null, commit_sha: null, live_at: null });
    this.writes.push(`insert ${id}`);
    return id;
  }
}

const liveFixture = PRODUCTION_CARDS.filter((c) => c.stage === "live");
const openFixture = PRODUCTION_CARDS.filter((c) => ["proposed", "designing", "voted"].includes(c.stage));

describe("launch-cards.json against the production cards", () => {
  it("rewrites all six live cards and all three open cards by the ids and titles production holds", () => {
    expect(liveFixture).toHaveLength(6);
    expect(openFixture).toHaveLength(3);
    expect(seed.live.map((e) => [e.id, e.was])).toEqual(liveFixture.map((c) => [c.id, c.title]));
    const opened = [...seed.open.map((e) => [e.id, e.was]), ...seed.retire.map((e) => [e.id, e.was])];
    expect(opened.sort()).toEqual(openFixture.map((c) => [c.id, c.title]).sort());
    expect(seed.retire).toEqual([]);
  });

  it("gives the three test runs plain titles and a summary where they had none", () => {
    const byId = new Map(seed.live.map((e) => [e.id, e]));
    expect(
      PRODUCTION_CARDS.filter((c) => c.stage === "live" && c.summary === null).map((c) => [c.title, byId.get(c.id)?.title]),
    ).toEqual([
      ["Spawn table: gatherer baseCost 10 to 11", "The Gatherer's starting price goes from 10 to 11 dust"],
      ["Spawn table: forge baseCost 40000 to 41000", "The Forge's starting price goes from 40,000 to 41,000 dust"],
      ["Spawn table: mill baseCost 2500 to 2600", "The Mill's starting price goes from 2,500 to 2,600 dust"],
    ]);
  });

  it("files a launch slate of three to six new game cards in seed-1, one of them the unlock count fix", () => {
    expect(seed.new.length).toBeGreaterThanOrEqual(3);
    expect(seed.new.length).toBeLessThanOrEqual(6);
    for (const card of seed.new) {
      expect(card, card.title).toMatchObject({ bucket: "game", folder: "seed-1", stage: "proposed" });
      expect(["config", "code"]).toContain(card.lane);
    }
    const fix = seed.new.find((c) => c.title === "Stop the unlock count from showing more unlocks than exist");
    expect(fix?.lane).toBe("code");
    expect(fix?.summary).toContain("13 of 12");
    expect(parseChecks(fix?.acceptance_test).map((c) => [c.file, c.pathText])).toEqual([
      ["seed-1/content/strings.json", "labels.unlockedCount"],
    ]);
  });

  it("keeps every title and summary inside the copy rules", () => {
    const INSIDE_TERMS = /\b(lane|kernel|dispatcher|directive|the pool|the gate|baseCost|spawn table)\b/i;
    const DATES = /\b(week|weeks|day|days|monday|tuesday|wednesday|thursday|friday|saturday|sunday|20\d\d)\b/i;
    const entries = [...seed.live, ...seed.open, ...seed.new];
    for (const { title, summary } of entries) {
      for (const line of [title, summary]) {
        expect(line.charAt(0), line).toBe(line.charAt(0).toUpperCase());
        expect(line, line).not.toContain("\u2014");
        expect(line, line).not.toMatch(/\bvot(e|es|ed|ing)\b/i);
        expect(line, line).not.toMatch(INSIDE_TERMS);
        expect(line, line).not.toMatch(DATES);
        expect(line, line).not.toMatch(/\.(ts|json)\b|\//);
      }
      expect(title.length, title).toBeLessThanOrEqual(80);
      expect(summary.length, title).toBeLessThanOrEqual(200);
    }
    for (const card of nowCards) {
      expect(`${card.intent}\n${card.acceptance_test}\n${card.reason}`, card.title).not.toMatch(DATES);
    }
  });

  it("puts every open and new card on horizon now ready to fund, with ranks 1 to n", () => {
    const active = new Map(PRODUCTION_ROLES.map((r) => [r.name, r]));
    for (const card of nowCards) {
      expect(["Builder A", "Builder B"], card.title).toContain(card.executor);
      expect(readinessRefusal(card, active.get(card.executor)), card.title).toBeNull();
    }
    expect(nowCards.map((c) => c.rank).sort((a, b) => a - b)).toEqual(nowCards.map((_, i) => i + 1));
    const first = nowCards.find((c) => c.rank === 1);
    expect(first?.title).toBe("Stop the unlock count from showing more unlocks than exist");
  });

  it("sets each target from its lane's measured cost: $0.50 for config and $1.50 for code", () => {
    expect(honestTarget("config")).toBe(0.5);
    expect(honestTarget("code")).toBe(1.5);
    for (const card of nowCards) {
      expect(card.funding_target_usd, card.title).toBe(honestTarget(card.lane));
    }
  });

  // What each card's change does to the seed-1 files, so the test proves the
  // check: lines are satisfiable by the change the brief describes.
  const EDITS: Record<string, (docs: Record<string, any>) => void> = {
    "Add Quiet rooms, a fourteenth unlock after Polished rails": (docs) => {
      docs["seed-1/config/unlocks.json"].unlocks.push({
        id: "quiet-rooms",
        name: "Quiet rooms",
        atTotalDust: 300000000,
        effect: { type: "multiplier", value: 1.05 },
      });
    },
    "Lower the Cart's starting price from 150 to 120 dust": (docs) => {
      docs["seed-1/config/spawn-table.json"].rows.find((r: { id: string }) => r.id === "cart").baseCost = 120;
    },
    "Rename the Gatherer to Sweeper": (docs) => {
      docs["seed-1/config/spawn-table.json"].rows.find((r: { id: string }) => r.id === "gatherer").name = "Sweeper";
      docs["seed-1/content/strings.json"].unitDescriptions.gatherer = "Sweeps dust into a pile.";
    },
    "Stop the unlock count from showing more unlocks than exist": (docs) => {
      docs["seed-1/content/strings.json"].labels.unlockedCount = "{earned} of {total} unlocked";
    },
    "Show how long until the next unlock": (docs) => {
      docs["seed-1/content/strings.json"].labels.nextUnlockTime = "{time} to go";
    },
    "Show how much dust each strike adds": (docs) => {
      docs["seed-1/content/strings.json"].labels.strikeGain = "+{amount}";
    },
  };

  it("has every check: line false on the frozen seed-1 files and true after the change the card describes", async () => {
    expect(Object.keys(EDITS).sort()).toEqual(nowCards.map((c) => c.title).sort());
    const files = ["seed-1/config/spawn-table.json", "seed-1/config/unlocks.json", "seed-1/content/strings.json"];
    let evaluated = 0;
    for (const card of nowCards) {
      const checks = parseChecks(card.acceptance_test);
      expect(checks.length, card.title).toBeGreaterThan(0);
      for (const check of checks) {
        expect(evaluateCheck(check, fixtureDoc(check.file)), `${card.title}: ${check.line}`).toBe(false);
      }
      expect(await preCheckRejection(card.acceptance_test, FIXTURES), card.title).toBeNull();

      const docs: Record<string, any> = Object.fromEntries(files.map((f) => [f, fixtureDoc(f)]));
      EDITS[card.title]!(docs);
      for (const check of checks) {
        expect(evaluateCheck(check, docs[check.file]), `${card.title} after its change: ${check.line}`).toBe(true);
        evaluated += 1;
      }
    }
    expect(evaluated).toBe(9);
  });

  it("describes the unlock count bug as the seed-1 files at the launch commit have it", () => {
    const strings = fixtureDoc("seed-1/content/strings.json") as { labels: Record<string, string> };
    const unlocks = fixtureDoc("seed-1/config/unlocks.json") as { unlocks: unknown[] };
    expect(strings.labels["unlockedCount"]).toBe("{unlocked} of {total} unlocked");
    expect(strings.labels["unlocksEarned"]).toBe("{count} unlocks earned");
    expect(unlocks.unlocks).toHaveLength(13);
    const fix = seed.new.find((c) => c.title.startsWith("Stop the unlock count"))!;
    expect(fix.intent).toContain("'{unlocked} of {total} unlocked'");
    expect(fix.intent).toContain("state.unlocked.length");
    expect(fix.intent).toContain("all 13 live ids");
  });
});

/** A valid one-card seed file to break one field at a time. */
function minimalSeed(): Record<string, any> {
  return {
    live: [],
    open: [],
    retire: [],
    new: [
      {
        title: "A small card",
        summary: "One plain sentence.",
        intent: ["Do the thing."],
        acceptance_test: ["Prose.", 'check: config seed-1/content/strings.json labels.newLabel == "x"'],
        bucket: "game",
        lane: "code",
        folder: "seed-1",
        executor: "Builder A",
        funding_target_usd: 1.5,
        rank: 1,
        stage: "proposed",
        reason: "Because.",
      },
    ],
  };
}

describe("parseLaunchCards", () => {
  it("joins the intent's paragraphs with a blank line and the acceptance test's lines with a newline", () => {
    const parsed = parseLaunchCards({ ...minimalSeed(), new: [{ ...minimalSeed().new[0], intent: ["One.", "Two."] }] });
    expect(parsed.new[0]?.intent).toBe("One.\n\nTwo.");
    expect(parsed.new[0]?.acceptance_test).toBe('Prose.\ncheck: config seed-1/content/strings.json labels.newLabel == "x"');
  });

  const broken: [string, (s: Record<string, any>) => void, RegExp][] = [
    ["an em dash", (s) => (s.new[0].summary = "One \u2014 two."), /em dash/],
    ["a title over 80 characters", (s) => (s.new[0].title = "x".repeat(81)), /81 characters/],
    ["a summary over 200 characters", (s) => (s.new[0].summary = "x".repeat(201)), /201 characters/],
    ["a double quote in a title", (s) => (s.new[0].title = 'A "quoted" card'), /double quote/],
    ["a target of zero", (s) => (s.new[0].funding_target_usd = 0), /above zero/],
    ["an unknown lane", (s) => (s.new[0].lane = "art"), /lane must be one of/],
    ["an empty intent", (s) => (s.new[0].intent = []), /intent must be a non-empty list/],
    ["a rank of zero", (s) => (s.new[0].rank = 0), /rank must be a whole number/],
    ["a duplicate title", (s) => s.new.push({ ...s.new[0], rank: 2 }), /used twice/],
    ["a duplicate rank", (s) => s.new.push({ ...s.new[0], title: "Another card" }), /rank 1 is used twice/],
  ];
  for (const [what, breakIt, message] of broken) {
    it(`refuses ${what}`, () => {
      const s = minimalSeed();
      breakIt(s);
      expect(() => parseLaunchCards(s)).toThrow(message);
    });
  }
});

describe("planRefresh and applyPlan on the production fixture", () => {
  it("plans five live rewrites, three open cards moved to now and three inserts, with no refusals", async () => {
    const store = new MemoryStore();
    const plan = await planRefresh(seed, store, FIXTURES);
    expect(plan.refusals).toEqual([]);
    expect(countPlan(plan)).toEqual({ updates: 8, inserts: 3, unchanged: 1 });
    expect(plan.steps.filter((s) => s.action === "none").map((s) => s.title)).toEqual(["The unlock list fits any number of unlocks"]);
    for (const step of plan.steps) {
      if (step.action === "update" && step.section === "live") {
        expect(Object.keys(step.patch).every((f) => f === "title" || f === "summary"), step.title).toBe(true);
      }
    }
    const quietRooms = plan.steps.find((s) => s.action === "update" && s.id === "47aba1dc-78c0-41d9-a40d-c5a68aa23d81");
    expect(quietRooms?.action === "update" && quietRooms.changes.map((c) => [c.field, c.before, c.after])).toEqual([
      ["title", "A fourteenth unlock: Quiet rooms at 300M dust", "Add Quiet rooms, a fourteenth unlock after Polished rails"],
      ["summary", "Add one more unlock after the last one, so players always have a next goal on screen.", seed.open[0]?.summary],
      ["intent", PRODUCTION_CARDS[0]?.intent, seed.open[0]?.intent],
      ["acceptance_test", PRODUCTION_CARDS[0]?.acceptance_test, seed.open[0]?.acceptance_test],
      ["funding_target_usd", 3, 0.5],
      ["estimate_usd", 3, 0.5],
      ["rank", null, 2],
      ["board_reason", null, seed.open[0]?.reason],
    ]);
    expect(store.writes).toEqual([]);
  });

  it("prints every change with its before and after values and the board's reason", async () => {
    const lines = describePlan(await planRefresh(seed, new MemoryStore(), FIXTURES));
    expect(lines).toContain('update live cd6fb0a7-8475-4729-b311-f85ad4c7c222 "The Gatherer\'s starting price goes from 10 to 11 dust" (stage live)');
    expect(lines).toContain('  title: "Spawn table: gatherer baseCost 10 to 11" -> "The Gatherer\'s starting price goes from 10 to 11 dust"');
    expect(lines).toContain(`  summary: null -> ${JSON.stringify(seed.live[0]?.summary)}`);
    expect(lines).toContain("  funding_target_usd: 2 -> 0.5");
    expect(lines).toContain(
      'insert new "Stop the unlock count from showing more unlocks than exist" (seed-1 code, Builder A, stage proposed, target 1.5000, horizon now, rank 1)',
    );
    expect(lines.filter((l) => l.startsWith("  reason: "))).toHaveLength(11);
    expect(lines).toContain(`  intent: ${JSON.stringify(seed.new[0]?.intent)}`);
    expect(lines).toContain(
      '  reason: "Plain title and summary for a shipped test run. What shipped is unchanged." (printed only; the card keeps its board reason)',
    );
    expect(lines).toContain(`  reason: ${JSON.stringify(seed.open[0]?.reason)}`);
    expect(lines).toContain('unchanged live 20aeaa63-34f2-4ac8-a9cc-d48c5d4d11ec "The unlock list fits any number of unlocks": already as written');
  });

  it("writes the plan, leaves the history of live cards alone, and changes nothing on a second run", async () => {
    const store = new MemoryStore();
    const result = await applyPlan(await planRefresh(seed, store, FIXTURES), store);
    expect(result.updated).toBe(8);
    expect(result.inserted).toHaveLength(3);

    for (const before of liveFixture) {
      const after = store.card(before.id);
      const entry = seed.live.find((e) => e.id === before.id)!;
      expect({ ...after, title: before.title, summary: before.summary }).toEqual(before);
      expect([after.title, after.summary]).toEqual([entry.title, entry.summary]);
    }
    for (const entry of seed.open) {
      expect(store.card(entry.id)).toMatchObject({
        title: entry.title,
        stage: PRODUCTION_CARDS.find((c) => c.id === entry.id)?.stage,
        horizon: "now",
        rank: entry.rank,
        funding_target_usd: entry.funding_target_usd,
        estimate_usd: entry.funding_target_usd,
        funded_usd: 0,
        board_reason: entry.reason,
      });
    }
    for (const entry of seed.new) {
      const inserted = store.cards.filter((c) => c.title === entry.title);
      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({
        source: "board",
        shape: "goal",
        stage: "proposed",
        horizon: "now",
        rank: entry.rank,
        lane: entry.lane,
        folder: "seed-1",
        funding_target_usd: entry.funding_target_usd,
        estimate_usd: entry.funding_target_usd,
        funded_usd: 0,
        board_reason: entry.reason,
        executor_role_id: PRODUCTION_ROLES.find((r) => r.name === entry.executor)?.id,
      });
    }

    const writes = store.writes.length;
    const again = await planRefresh(seed, store, FIXTURES);
    expect(again.refusals).toEqual([]);
    expect(countPlan(again)).toEqual({ updates: 0, inserts: 0, unchanged: 12 });
    await applyPlan(again, store);
    expect(store.writes).toHaveLength(writes);
  });

  it("stops when a card moved stage between the plan and the write", async () => {
    const store = new MemoryStore();
    const plan = await planRefresh(seed, store, FIXTURES);
    store.card("2c57cf54-c1a4-4693-b8a8-e7a3f8797827").stage = "funded";
    await expect(applyPlan(plan, store)).rejects.toThrow("no longer at stage proposed");
    expect(store.cards.filter((c) => c.title === seed.new[0]?.title)).toEqual([]);
  });
});

/** The production fixture with one card changed. */
function storeWith(id: string, change: Partial<FixtureCard>): MemoryStore {
  const store = new MemoryStore();
  Object.assign(store.card(id), change);
  return store;
}

function seedWith(change: (s: LaunchCards) => void): LaunchCards {
  const s = clone(seed);
  change(s);
  return s;
}

const QUIET_ROOMS = "47aba1dc-78c0-41d9-a40d-c5a68aa23d81";
const CART = "2c57cf54-c1a4-4693-b8a8-e7a3f8797827";
const SAVE = "7074706e-002c-48da-a152-5c177da5bbf7";

describe("refusals", () => {
  async function refusalsFor(s: LaunchCards, store: MemoryStore = new MemoryStore()): Promise<string[]> {
    const plan = await planRefresh(s, store, FIXTURES);
    if (plan.refusals.length > 0) {
      await expect(applyPlan(plan, store)).rejects.toThrow("nothing written");
      expect(store.writes).toEqual([]);
    }
    return plan.refusals.map((r) => `${r.section}: ${r.why}`);
  }

  it("refuses a live card that is no longer live", async () => {
    expect(await refusalsFor(seed, storeWith(SAVE, { stage: "paused" }))).toEqual([
      `live: card ${SAVE} is at stage paused; this list takes live`,
    ]);
  });

  it("refuses a card whose title changed since the file was written", async () => {
    const [why] = await refusalsFor(seed, storeWith(CART, { title: "Something else" }));
    expect(why).toContain('is titled "Something else" now');
  });

  it("refuses a card that is not in the table", async () => {
    const s = seedWith((x) => (x.live[0]!.id = "00000000-0000-4000-8000-000000000999"));
    expect(await refusalsFor(s)).toEqual(["live: card 00000000-0000-4000-8000-000000000999 does not exist"]);
  });

  it("refuses to move a card to now without a check: line", async () => {
    const s = seedWith((x) => (x.open[0]!.acceptance_test = "Prose only."));
    expect(await refusalsFor(s)).toEqual(["open: The acceptance test needs a check: line"]);
  });

  it("refuses a platform code card, because that lane is closed at launch", async () => {
    const s = seedWith((x) => (x.new[1]!.folder = "platform"));
    expect(await refusalsFor(s)).toEqual(["new: The platform code lane is closed at launch"]);
  });

  it("refuses a config card outside seed-1", async () => {
    const s = seedWith((x) => (x.open[1]!.folder = "platform"));
    expect(await refusalsFor(s)).toEqual(["open: The config lane exists only for seed-1"]);
  });

  it("refuses an executor that is retired or missing", async () => {
    const retired = new MemoryStore();
    retired.roles.find((r) => r.name === "Builder B")!.state = "retired";
    const whys = await refusalsFor(seed, retired);
    expect(whys).toHaveLength(3);
    expect(new Set(whys.map((w) => w.replace(/^\w+: /, "")))).toEqual(new Set(['The executor "Builder B" must be an active role']));
    const s = seedWith((x) => (x.new[0]!.executor = "Builder C"));
    expect(await refusalsFor(s)).toEqual(['new: The executor "Builder C" is not a role']);
  });

  it("refuses a card whose checks already hold on main, as the dispatcher's pre-check would", async () => {
    const s = seedWith((x) => (x.new[0]!.acceptance_test = "check: config seed-1/config/spawn-table.json rows[id=cart].baseCost == 150"));
    const [why] = await refusalsFor(s);
    expect(why).toContain("acceptance_already_true");
  });

  it("refuses a check: line that does not parse", async () => {
    const s = seedWith((x) => (x.new[0]!.acceptance_test = "check: config seed-1/config/spawn-table.json rows[id=cart].baseCost 120"));
    const [why] = await refusalsFor(s);
    expect(why).toContain("does not parse");
  });

  it("refuses to change the target of a card that holds money", async () => {
    expect(await refusalsFor(seed, storeWith(QUIET_ROOMS, { funded_usd: 1.2 }))).toEqual([
      `open: card ${QUIET_ROOMS} holds 1.2000 on its bar; change its target from /board`,
    ]);
  });

  it("refuses a new title that two cards already carry", async () => {
    const store = new MemoryStore();
    for (const id of [CART, QUIET_ROOMS]) store.card(id).title = seed.new[2]!.title;
    const s = seedWith((x) => {
      x.open = x.open.filter((e) => e.id !== CART && e.id !== QUIET_ROOMS);
    });
    const [why] = await refusalsFor(s, store);
    expect(why).toContain("2 cards already carry this title");
  });

  it("leaves a new card alone once it has moved on from open", async () => {
    const store = new MemoryStore();
    await applyPlan(await planRefresh(seed, store, FIXTURES), store);
    const filed = store.cards.find((c) => c.title === seed.new[0]!.title)!;
    filed.stage = "building";
    const plan = await planRefresh(seedWith((x) => (x.new[0]!.summary = "A later edit.")), store, FIXTURES);
    expect(plan.refusals).toEqual([]);
    expect(plan.steps.find((s) => s.title === seed.new[0]!.title)).toMatchObject({
      action: "none",
      note: "filed before and now at stage building; left alone",
    });
  });
});

describe("retiring a card", () => {
  const retireCart = (x: LaunchCards) => {
    x.open = x.open.filter((e) => e.id !== CART);
    x.retire = [{ id: CART, was: "Cheaper Cart: baseCost 120", reason: "The board retires it." }];
  };

  it("moves an open card with no money to rejected with the board's reason, once", async () => {
    const store = new MemoryStore();
    const s = seedWith(retireCart);
    await applyPlan(await planRefresh(s, store, FIXTURES), store);
    expect(store.card(CART)).toMatchObject({ stage: "rejected", board_reason: "The board retires it.", title: "Cheaper Cart: baseCost 120" });
    const again = await planRefresh(s, store, FIXTURES);
    expect(again.steps.find((step) => step.section === "retire")).toMatchObject({ action: "none", note: "already retired" });
  });

  it("refuses a card that holds money or has started building", async () => {
    const s = seedWith(retireCart);
    const withMoney = await planRefresh(s, storeWith(CART, { funded_usd: 0.4 }), FIXTURES);
    expect(withMoney.refusals.map((r) => r.why)).toEqual([
      `card ${CART} holds 0.4000 on its bar; cancel it from /board so the money rules apply`,
    ]);
    const building = await planRefresh(s, storeWith(CART, { stage: "building" }), FIXTURES);
    expect(building.refusals.map((r) => r.why)).toEqual([
      `card ${CART} is at stage building; this list takes proposed, designing, voted, funded, paused`,
    ]);
  });
});

describe("parseArgs", () => {
  it("takes exactly one of --dry-run and --apply", () => {
    expect(parseArgs(["--dry-run"])).toEqual({ apply: false });
    expect(parseArgs(["--", "--apply"])).toEqual({ apply: true });
    expect(() => parseArgs([])).toThrow(UsageError);
    expect(() => parseArgs(["--dry-run", "--apply"])).toThrow("not both");
    expect(() => parseArgs(["--force"])).toThrow("Unknown argument --force");
  });
});

describe("supabaseStore", () => {
  /** A stand-in client whose query chain records each call and resolves to result. */
  function fakeClient(result: { data: unknown; error: { message: string } | null }) {
    const calls: unknown[][] = [];
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") return (resolve: (value: unknown) => void) => resolve(result);
          return (...args: unknown[]) => {
            calls.push([prop, ...args]);
            return chain;
          };
        },
      },
    );
    const client = {
      from(table: string) {
        calls.push(["from", table]);
        return chain;
      },
    };
    return { store: supabaseStore(client as unknown as SupabaseClient), calls };
  }

  it("updates by id only while the card is still at the stage the plan read", async () => {
    const hit = fakeClient({ data: [{ id: CART }], error: null });
    expect(await hit.store.updateCard(CART, "proposed", { title: "New" })).toBe(true);
    expect(hit.calls.slice(0, 5)).toEqual([
      ["from", "cards"],
      ["update", { title: "New" }],
      ["eq", "id", CART],
      ["eq", "stage", "proposed"],
      ["select", "id"],
    ]);
    const miss = fakeClient({ data: [], error: null });
    expect(await miss.store.updateCard(CART, "proposed", { title: "New" })).toBe(false);
  });

  it("finds cards by title and reads horizon and rank", async () => {
    const read = fakeClient({ data: [{ ...PRODUCTION_CARDS[0], funding_target_usd: "3.0000" }], error: null });
    const [card] = await read.store.cardsByTitle(["A title, with a comma"]);
    expect(card?.funding_target_usd).toBe(3);
    expect(read.calls[1]?.[0]).toBe("select");
    expect(String(read.calls[1]?.[1]).split(",")).toEqual(expect.arrayContaining(["horizon", "rank", "stage", "funded_usd"]));
    expect(read.calls[2]).toEqual(["in", "title", ["A title, with a comma"]]);
  });

  it("names the migration when cards.horizon is missing", async () => {
    const old = fakeClient({ data: null, error: { message: "column cards.horizon does not exist" } });
    await expect(old.store.cardsById([CART])).rejects.toThrow("migration 20260922000300_backlog");
  });

  it("inserts a new card and returns its id", async () => {
    const insert = fakeClient({ data: { id: "abc" }, error: null });
    const plan = await planRefresh(seed, new MemoryStore(), FIXTURES);
    const step = plan.steps.find((s) => s.action === "insert");
    if (step?.action !== "insert") throw new Error("no insert planned");
    expect(await insert.store.insertCard(step.row)).toBe("abc");
    expect(insert.calls.map((c) => c[0])).toEqual(["from", "insert", "select", "single"]);
  });
});
