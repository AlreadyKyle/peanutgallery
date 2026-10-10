// The checks the dispatcher runs on a Game Designer's draft before the Game Director sees it
// (docs/specs/agent-workflows.md). Each refusal names its check; a refused draft goes back to the
// Designer as a new round. The schema is checked first, by typed-output.ts, on the session's answer;
// these run on a draft that is schema-valid:
// - ready: the definition of ready (PLAN.md §4), as card_ready_problem applies it on approval;
// - check_lines: every check: line parses (acceptance.ts);
// - paths: every file a check names is in seed-1, inside the lane's paths and outside the kernel;
// - already_holds: no check line is already true on main, read at the run's base sha;
// - deny_list: the gate's banned-phrases.sh passes every text field, trademarks included;
// - estimate: the estimate is within card_max_usd, and so is the funding target approval sets, the
//   estimate plus the card's drafting spend, with room left for the least a grading session needs,
//   rounded up to the cent;
// - executor: the executor is an active, unpaused writer that builds seed-1 cards.
import { AcceptanceGrammarError, evaluateCheck, parseChecks, type ConfigCheck } from './acceptance.js';
import type { Role } from './db.js';
import type { PublicTextResult } from './public-text.js';
import { lanePaths, outsideLane } from './worktree.js';

// The card draft as the Game Designer answers it (card-draft.schema.json).
export interface CardDraft {
  title: string;
  summary: string;
  intent: string;
  acceptance_test: string;
  lane: 'config' | 'code';
  executor: string;
  estimate_usd: number;
}

export type DraftCheckName = 'schema' | 'ready' | 'check_lines' | 'paths' | 'already_holds' | 'deny_list' | 'estimate' | 'executor';
export type DraftCheckResult = { ok: true } | { ok: false; check: DraftCheckName; detail: string };

// The writers that build seed-1 cards; the site and the board offer the same three
// (platform/site/src/lib/roster.ts, platform/board/src/lib/board.ts).
export const SEED_WRITERS: readonly string[] = ['Builder A', 'Builder B', 'QA'];

export interface DraftCheckDeps {
  // The file's text on main at the run's base sha, or null when main has none.
  readMain: (file: string) => Promise<string | null>;
  scanText: (strings: readonly string[]) => Promise<PublicTextResult>;
  cardMaxUsd: number;
  // What the card's drafting has spent so far, and the least its grading session needs: approval
  // raises the card's target by its drafting spend (20261010200000_supply_refill.sql), so the estimate
  // plus both, rounded up to the cent, must stay within cardMaxUsd. Unset is nothing.
  draftingUsd?: number;
  gradingUsd?: number;
  // The roles that are not retired.
  roles: readonly Role[];
}

// The card's estimate and funding target once a draft is approved: the Designer's estimate plus the
// card's drafting spend, rounded up to the cent, as approve_card_draft sets them.
export function draftTotalUsd(estimateUsd: number, draftingUsd: number): number {
  return Math.ceil(Math.round((estimateUsd + draftingUsd) * 10_000) / 100) / 100;
}

// The executor the draft names, when it is an active, unpaused writer for seed-1.
export function seedExecutor(name: string, roles: readonly Role[]): Role | null {
  const role = roles.find((r) => r.name === name.trim());
  if (!role || !SEED_WRITERS.includes(role.name)) return null;
  if (role.agent_class !== 'writer' || !role.write_access || role.paused) return null;
  return role;
}

const CHECK_LINE = /(^|\n)\s*check:\s/;

export async function checkDraft(draft: CardDraft, deps: DraftCheckDeps): Promise<DraftCheckResult> {
  const blank = (text: string) => text.trim() === '';
  if (blank(draft.title)) return { ok: false, check: 'ready', detail: 'A card on now needs a title' };
  if (blank(draft.summary)) return { ok: false, check: 'ready', detail: 'A card on now needs a public summary' };
  if (blank(draft.intent)) return { ok: false, check: 'ready', detail: 'A card on now needs an intent' };
  if (!CHECK_LINE.test(draft.acceptance_test)) return { ok: false, check: 'ready', detail: 'A card on now needs a check: line in its acceptance test' };
  if (!(draft.estimate_usd > 0) || draft.estimate_usd > 10000) return { ok: false, check: 'ready', detail: 'The funding target must be above zero and at most $10,000' };

  let checks: ConfigCheck[];
  try {
    checks = parseChecks(draft.acceptance_test);
  } catch (error) {
    const detail = error instanceof AcceptanceGrammarError ? error.message : String(error);
    return { ok: false, check: 'check_lines', detail };
  }
  if (checks.length === 0) return { ok: false, check: 'check_lines', detail: 'no check: line parses' };

  const allowed = lanePaths('seed-1', draft.lane);
  const outside = outsideLane(
    checks.map((check) => check.file),
    allowed,
  );
  if (allowed.length === 0 || outside.length > 0) {
    return { ok: false, check: 'paths', detail: `outside seed-1's ${draft.lane} lane or on a kernel path: ${outside.join(', ') || 'no lane'}` };
  }

  for (const check of checks) {
    const text = await deps.readMain(check.file);
    if (text === null) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      continue;
    }
    if (evaluateCheck(check, doc)) return { ok: false, check: 'already_holds', detail: `already true on main: ${check.line}` };
  }

  const scan = await deps.scanText([draft.title, draft.summary, draft.intent, draft.acceptance_test]);
  if (!scan.ok) return { ok: false, check: 'deny_list', detail: scan.detail };

  if (draft.estimate_usd > deps.cardMaxUsd) {
    return { ok: false, check: 'estimate', detail: `the estimate $${draft.estimate_usd} is above the per-card maximum $${deps.cardMaxUsd}` };
  }
  const drafting = deps.draftingUsd ?? 0;
  const grading = deps.gradingUsd ?? 0;
  if (drafting + grading > 0 && draftTotalUsd(draft.estimate_usd, drafting + grading) > deps.cardMaxUsd) {
    return {
      ok: false,
      check: 'estimate',
      detail: `the estimate $${draft.estimate_usd} plus the $${drafting} this card's drafting has spent and the $${grading} its grading needs at least comes to $${draftTotalUsd(draft.estimate_usd, drafting + grading).toFixed(2)}, above the per-card maximum $${deps.cardMaxUsd}`,
    };
  }

  if (!seedExecutor(draft.executor, deps.roles)) {
    return { ok: false, check: 'executor', detail: `${draft.executor} is not an active, unpaused writer for seed-1 (${SEED_WRITERS.join(', ')})` };
  }
  return { ok: true };
}
