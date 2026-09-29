// The first board directives (docs/specs/week1-runs.md): D1 the unlock list,
// D2 save and resume, D3 the game shell. Each row carries the field set
// file_directive writes, plus the public summary. The executor is named by
// roles.name here and resolved to executor_role_id when the card is inserted.
// A directive is a oneoff card at priority 0 in stage funded; it skips the vote
// and still passes the gate.

export type DirectiveExecutor = "Builder A" | "Builder B";

export interface Directive {
  key: "D1" | "D2" | "D3";
  bucket: "game";
  source: "board";
  shape: "oneoff";
  lane: "code";
  folder: "seed-1";
  priority: 0;
  confidence: "low";
  stage: "funded";
  title: string;
  /** Public line for the site, at most 200 characters. */
  summary: string;
  /** The brief for the builder agents. */
  intent: string;
  acceptance_test: string;
  estimate_usd: number;
  /** The one-line public reason every directive carries (PLAN.md §4 The Board). */
  board_reason: string;
  /** roles.name of the executor, resolved to an id at insert time. */
  executor_role_name: DirectiveExecutor;
}

const base = {
  bucket: "game",
  source: "board",
  shape: "oneoff",
  lane: "code",
  folder: "seed-1",
  priority: 0,
  confidence: "low",
  stage: "funded",
} as const;

type DirectiveInput = Omit<Directive, keyof typeof base>;

function directive(input: DirectiveInput): Directive {
  return { ...base, ...input };
}

const COMMANDS = "pnpm --filter @backseat/seed-1 typecheck, test and bot all exit 0.";

export const DIRECTIVES: readonly Directive[] = [
  directive({
    key: "D1",
    executor_role_name: "Builder A",
    estimate_usd: 8,
    title: "The unlock list fits any number of unlocks",
    summary: "Earned unlocks fold into one line with the next three below, so the list stays on screen as unlocks are added.",
    board_reason:
      "live problem: the unlock list draws one row per unlock, so a fifteenth unlock draws below the screen and the Quiet rooms card adds the fourteenth",
    intent: [
      "The unlock list in render/scene.ts draws one 22px row per unlock starting at y 578 on the 880px canvas, so the fourteenth row reaches the bottom edge and a fifteenth draws off screen. The open card Quiet rooms adds a fourteenth unlock.",
      "Make the list fit any count. Earned unlocks collapse into one line built from a new label unlocksEarned, '{count} unlocks earned', added to content/strings.json and to LABEL_KEYS and the Strings type in render/strings.ts. Below it the next three unearned unlocks show as rows with their cost, as today. Nothing else on screen moves.",
      "Tests run in Node and cannot import Phaser, so move the layout arithmetic into a new Phaser-free module render/layout.ts: move SCREEN_WIDTH and SCREEN_HEIGHT there (scene.ts re-exports them for render/main.ts) and add a pure function that takes the list's top y, the unlock rows and the earned ids and returns the lines to draw, each with its kind, its unlock row or earned count, and its y. scene.ts draws what the function returns and redraws when the earned count changes.",
      "Add tests/layout.test.ts: with 30 unlock rows, for every earned count from 0 to 30, no line's y plus the row height is greater than SCREEN_HEIGHT, there is at most one earned line and at most three unearned lines; the live config's 13 unlocks lay out the same way.",
      "Run typecheck, test and the bot; stop and report if any is red.",
    ].join("\n\n"),
    acceptance_test: [
      "tests/layout.test.ts lays out 30 unlocks at every earned count from 0 to 30 with no line below the 880px canvas, at most one earned line and at most three unearned lines. render/scene.ts draws the unlock list from render/layout.ts. " +
      COMMANDS,
      'check: config seed-1/content/strings.json labels.unlocksEarned == "{count} unlocks earned"',
    ].join("\n"),
  }),
  directive({
    key: "D2",
    executor_role_name: "Builder B",
    estimate_usd: 12,
    title: "Save progress and resume on reload",
    summary: "The game saves to the browser every few seconds and when the page is hidden, so a reload keeps your dust.",
    board_reason: "live problem: progress lost on reload",
    intent: [
      "Nothing persists; a reload starts at zero.",
      "Add a pure sim/save.ts and export it from sim/index.ts. serializeState(state) returns the JSON text of { version: 1, state }. parseSavedState(raw) returns the SimState only when raw is JSON, version is 1, every SimState field is present with the right type, and stateIsFinite from sim/invariants.ts holds; otherwise it returns null. Import stateIsFinite; sim/invariants.ts is protected and must not change. The version lives in the wrapper, not in SimState, because tests/timeline.test.ts pins the hash of SimState.",
      "The render layer owns storage. render/main.ts reads the localStorage key dust.save and passes a parsed state to DustScene, which starts from it instead of createSim; with no usable save it starts fresh. The scene writes serializeState(state) to that key every 5 seconds, when the page becomes hidden (visibilitychange) and on pagehide. Storage errors are caught and ignored, so a browser that refuses storage still plays.",
      "A save made under an older config is safe: ratePerSecond ignores unknown unit ids, missing ids read as 0 and unknown unlock ids are skipped. The sim stays clock-free and never touches storage. No offline progress.",
      "Run typecheck, test and the bot; stop and report if any is red.",
    ].join("\n\n"),
    acceptance_test:
      "tests/save.test.ts: parseSavedState(serializeState(s)) deep-equals s for a state after 1000 greedy ticks; parseSavedState returns null for text that is not JSON, a version other than 1, a value that is not an object, a missing field and non-finite dust. render/main.ts restores from the localStorage key dust.save and the scene saves every 5 seconds and when the page is hidden. " +
      COMMANDS,
  }),
  directive({
    key: "D3",
    executor_role_name: "Builder A",
    estimate_usd: 6,
    title: "Game shell: tab title, icon, studio link and all-ages label",
    summary: "The game tab reads Dust · Mob Machine with its own icon, and the page links back to the studio with an all-ages label.",
    board_reason: "brand call: the game names its studio and its rating",
    intent: [
      "The tab says Dust with no icon, and nothing on the page says who made the game or its rating.",
      "Tab title: add tabTitle 'Dust · Mob Machine' to content/strings.json, to the Strings type and to the parser in render/strings.ts, and set document.title from it in render/main.ts. Set the title element in index.html to the same text. strings.title stays 'Dust': the canvas heading uses it and tests/render.test.ts pins it.",
      "Icon: draw a small SVG by hand, vector shapes only (a pile of dust in the accent colour #d9a441 on #12161c), at render/favicon.svg, and link it from index.html with the relative href ./render/favicon.svg so Vite bundles it. seed-1/public is not served because publicDir is off in the protected vite.config.ts, and nothing is imported or copied from platform/.",
      "Studio link: below the game in index.html, one centered line in 12px muted #9aa3ad: 'Made by AI agents at Mob Machine · All ages', where 'Made by AI agents at Mob Machine' links to https://mobmachine.games. The #game element fills the space above that line so the canvas still scales to fit and nothing overlaps the controls, with no horizontal scroll at 375px wide. Keep the build-sha meta and the loading line as they are.",
      "Head: a meta description 'Dust is a free idle game built by AI agents at Mob Machine. All ages.', og:type website, og:site_name Mob Machine, og:title 'Dust · Mob Machine', og:description with the same sentence and og:url https://play.mobmachine.games/.",
      "Run typecheck, test and the bot; stop and report if any is red.",
    ].join("\n\n"),
    acceptance_test: [
      "index.html carries the title Dust · Mob Machine, a relative icon link to render/favicon.svg, the meta description and og tags, and a line linking https://mobmachine.games with the text All ages. render/main.ts sets document.title from strings.tabTitle and strings.title stays Dust. " +
      COMMANDS,
      'check: config seed-1/content/strings.json tabTitle == "Dust · Mob Machine"',
    ].join("\n"),
  }),
];

/** The Next card D2 replaces (next-cards.md); it is deleted when D2 is filed. */
export const REPLACED_NEXT_CARD_TITLE = "Save the game and resume on reload";
