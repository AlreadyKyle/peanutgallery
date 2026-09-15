// The week-1 acceptance test card (PLAN.md Appendix A).

export interface Week1Run {
  run: 1 | 2 | 3;
  unit: string;
  from: number;
  to: number;
}

export const WEEK1_RUNS: readonly Week1Run[] = [
  { run: 1, unit: "gatherer", from: 10, to: 11 },
  // Run 2 uses the Forge, not the Cart: a Next card changes the Cart cost, and a test run must
  // never overwrite a change supporters funded.
  { run: 2, unit: "forge", from: 40000, to: 41000 },
  { run: 3, unit: "mill", from: 2500, to: 2600 },
];

export const WEEK1_ESTIMATE_USD = 2;
/** roles.name of the executor and proposer of the week-1 card (PLAN.md Appendix A). */
export const WEEK1_EXECUTOR_ROLE = "Builder A";
export const SPAWN_TABLE_PATH = "seed-1/config/spawn-table.json";

export interface Week1Card {
  bucket: "game";
  source: "board";
  shape: "oneoff";
  lane: "config";
  folder: "seed-1";
  stage: "funded";
  confidence: "low";
  priority: number;
  title: string;
  intent: string;
  acceptance_test: string;
  estimate_usd: number;
}

export function parseRunNumber(value: string | undefined): Week1Run {
  const n = Number(value ?? "1");
  const run = WEEK1_RUNS.find((r) => r.run === n);
  if (!run) {
    throw new Error(`--run must be 1, 2 or 3, got "${value}"`);
  }
  return run;
}

export function week1Card(run: Week1Run): Week1Card {
  return {
    bucket: "game",
    source: "board",
    shape: "oneoff",
    lane: "config",
    folder: "seed-1",
    stage: "funded",
    confidence: "low",
    priority: 100,
    title: `Spawn table: ${run.unit} baseCost ${run.from} to ${run.to}`,
    intent:
      `Change the baseCost of the ${run.unit} row in ${SPAWN_TABLE_PATH} from ${run.from} to ${run.to}. ` +
      "This is the week-1 acceptance test card: a config-lane change that must reach the live seed site within 15 minutes.",
    acceptance_test:
      `spawn table row ${run.unit}: baseCost changes from ${run.from} to ${run.to}\n` +
      `check: config ${SPAWN_TABLE_PATH} rows[id=${run.unit}].baseCost == ${run.to}`,
    estimate_usd: WEEK1_ESTIMATE_USD,
  };
}
