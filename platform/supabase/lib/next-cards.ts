// The first Next cards (docs/specs/next-cards.md). The board files these at
// launch and a supporter votes for one by funding it. Each row carries the
// field set file_card writes; the executor is named by roles.name here and
// resolved to executor_role_id when the card is inserted.

export type NextCardLane = "config" | "code";
export type NextCardStage = "proposed" | "voted";
export type NextCardExecutor = "Builder A" | "Builder B";

export interface NextCard {
  bucket: "game";
  source: "board";
  shape: "goal";
  folder: "seed-1";
  confidence: "low";
  priority: 100;
  lane: NextCardLane;
  stage: NextCardStage;
  title: string;
  /** Public line for supporters, at most 200 characters; file_card requires it. */
  summary: string;
  /** The brief for the builder agents. */
  intent: string;
  acceptance_test: string;
  funding_target_usd: number;
  /** Equals funding_target_usd: the dispatcher checks the pool against the estimate before it starts a card. */
  estimate_usd: number;
  /** roles.name of the executor, resolved to an id at insert time. */
  executor_role_name: NextCardExecutor;
}

const base = {
  bucket: "game",
  source: "board",
  shape: "goal",
  folder: "seed-1",
  confidence: "low",
  priority: 100,
} as const;

type NextCardInput = Omit<NextCard, keyof typeof base | "estimate_usd">;

function nextCard(card: NextCardInput): NextCard {
  return { ...base, ...card, estimate_usd: card.funding_target_usd };
}

export const NEXT_CARDS: readonly NextCard[] = [
  nextCard({
    stage: "voted",
    lane: "config",
    executor_role_name: "Builder A",
    funding_target_usd: 3,
    title: "A fourteenth unlock: Quiet rooms at 300M dust",
    summary: "Add one more unlock after the last one, so players always have a next goal on screen.",
    intent:
      "After Polished rails at 185,000,000 lifetime dust the screen says 'Every unlock is open.' Add one multiplier unlock, Quiet rooms, at 300,000,000 lifetime dust with a 5% production bonus, so a next goal stays on screen. The greedy bot ends ten simulated hours near 217,000,000 dust, so the ten-hour invariants do not move. Run the bot; stop and report if any hour loses its unlock.",
    acceptance_test: [
      "unlocks.json gains one row after polished-rails: id quiet-rooms, name Quiet rooms, atTotalDust 300000000, effect multiplier 1.05. No other row changes.",
      "check: config seed-1/config/unlocks.json unlocks[id=quiet-rooms].atTotalDust == 300000000",
      'check: config seed-1/config/unlocks.json unlocks[id=quiet-rooms].effect == {"type":"multiplier","value":1.05}',
    ].join("\n"),
  }),
  nextCard({
    stage: "proposed",
    lane: "config",
    executor_role_name: "Builder B",
    funding_target_usd: 2,
    title: "Rename the Gatherer to Sweeper",
    summary: "Rename the first unit from Gatherer to Sweeper, with a new one-line description.",
    intent:
      "The first unit is the Gatherer, described as 'Picks up dust by hand.' Rename it Sweeper with the line 'Sweeps dust into a pile.' Display only: the id stays gatherer, so costs, rates and unlocks are untouched. Run the bot; stop and report if any hour loses its unlock.",
    acceptance_test: [
      "spawn-table row gatherer: name changes from Gatherer to Sweeper. strings.json unitDescriptions.gatherer carries the new line.",
      'check: config seed-1/config/spawn-table.json rows[id=gatherer].name == "Sweeper"',
      'check: config seed-1/content/strings.json unitDescriptions.gatherer == "Sweeps dust into a pile."',
    ].join("\n"),
  }),
  nextCard({
    stage: "proposed",
    lane: "config",
    executor_role_name: "Builder A",
    funding_target_usd: 3,
    title: "Cheaper Cart: baseCost 120",
    summary: "Lower the Cart's cost so new players can buy one soon after it appears.",
    intent:
      "The Cart opens at 100 lifetime dust, but its cost sits above that, so its row stays unaffordable after it appears. Set baseCost to 120 so a new player can buy one soon after it opens. Early game only. Run the bot; stop and report if any hour loses its unlock.",
    acceptance_test: [
      "spawn-table row cart: baseCost changes to 120.",
      "check: config seed-1/config/spawn-table.json rows[id=cart].baseCost == 120",
    ].join("\n"),
  }),
  nextCard({
    stage: "proposed",
    lane: "code",
    executor_role_name: "Builder B",
    funding_target_usd: 12,
    title: "Save the game and resume on reload",
    summary: "Save progress in the browser, so a reload picks up where you left off.",
    intent:
      "Nothing persists; a reload starts at zero. Add a pure sim/save.ts with serializeState(state) and parseSavedState(raw) that returns a SimState only when the shape is right and every number is finite. The render layer saves to the localStorage key dust.save.v1 every 5 seconds and on page hide, and restores on create. Restoring across a config change is safe by construction: unknown unit ids are ignored by ratePerSecond, missing ids read as 0, unknown unlock ids are skipped by findUnlock. The sim stays clock-free; the render layer owns storage. Offline progress is a later card once this exists. Run typecheck, test and the bot; stop and report if any is red.",
    acceptance_test:
      "tests/save.test.ts: parseSavedState(JSON.parse(serializeState(s))) equals s for a state after 1000 greedy ticks; parseSavedState returns null for non-finite dust, a missing field and a non-object. pnpm --filter @backseat/seed-1 typecheck, test and bot all exit 0.",
  }),
];
