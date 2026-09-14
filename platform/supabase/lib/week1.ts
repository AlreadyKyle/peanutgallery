// The week-1 acceptance test card (PLAN.md Appendix A) and the three goal cards (PLAN.md §6).

export interface Week1Run {
  run: 1 | 2 | 3;
  unit: string;
  from: number;
  to: number;
}

export const WEEK1_RUNS: readonly Week1Run[] = [
  { run: 1, unit: "gatherer", from: 10, to: 11 },
  { run: 2, unit: "cart", from: 150, to: 160 },
  { run: 3, unit: "mill", from: 2500, to: 2600 },
];

export const WEEK1_ESTIMATE_USD = 2;
export const WEEK1_POOL_BALANCE_USD = 50;
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

export interface GoalCard {
  bucket: "platform";
  source: "board";
  shape: "goal";
  lane: "code";
  folder: "platform";
  stage: "voted";
  confidence: "low";
  priority: number;
  title: string;
  intent: string;
  acceptance_test: string;
  funding_target_usd: number;
}

const goalBase = {
  bucket: "platform",
  source: "board",
  shape: "goal",
  lane: "code",
  folder: "platform",
  stage: "voted",
  confidence: "low",
  priority: 100,
} as const;

/** The three sprint goal cards, text from PLAN.md §6 "Build 1". */
export const GOAL_CARDS: readonly GoalCard[] = [
  {
    ...goalBase,
    title: "Week 1: the loop",
    intent:
      "Platform and seed repo skeletons, Supabase schema, dispatcher with throttle and scheduler stub, gate package with the deny-list, seed with Phaser skeleton and sim core, Netlify deploy with last_green rollback, minimal /board (sign-in, pause/resume, file a directive, file a note).",
    acceptance_test:
      "A card inserted in stage funded with a $2 estimate, against a pool seeded with $50, becomes a deployed change within 15 minutes, with ledger rows and an updated last_green, three runs in a row.",
    funding_target_usd: 100,
  },
  {
    ...goalBase,
    title: "Week 2: the show",
    intent:
      "OBS on the VPS, Dev Cam and Director's Room scenes, Replay fallback, host reads chat and speaks through the filter, chat micro-vote creates a config-lane card, second-provider adapter, the channel streaming the build.",
    acceptance_test:
      "!vote changes on-stream text within 10 seconds; the stream survives the 48-hour reconnect unattended; one chat vote becomes a merged change visible on stream within 30 minutes.",
    funding_target_usd: 150,
  },
  {
    ...goalBase,
    title: "Week 3: money and public",
    intent:
      "Meter to throttle; vote board, buckets, tier quorums and source tags; goal and standing bars with the four-column site and the design stage; personal-decision backlog and assignment on contribution; incident reserve and S1 classification; in-game bug filing; auto-clip; image adapter and the alien team style sheet; Meet the Team, Board Decisions and Lore pages; full board dashboard with TOTP; rollback drill; kill switch from a phone.",
    acceptance_test:
      "A real $5 contribution unpauses a paused dispatcher within 60 seconds and assigns the contributor a medium decision that executes within 10 minutes of their choice; a deliberately broken build is restored on production within 5 minutes; a string containing a deny-listed term fails the gate; an S1 bug card starts building without a vote; the kill switch cuts to Replay within 15 seconds; nine avatars render on Meet the Team in one style.",
    funding_target_usd: 250,
  },
];
