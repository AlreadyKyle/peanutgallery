// benchmark_review: the review team's check of the studio against docs/strategy/benchmarks.md
// (docs/strategy/operating-system.md §2, docs/specs/operations.md). enqueue_benchmark_review queues a
// run on events (the first review, 50 cards live since the last, a milestone or era reached, 30 days
// with none, and a watch once the day's counts move) while the board's benchmark_review flag is on;
// the board may queue one too.
//
// 1. The scoreboard is code, not a model: every row benchmarks.md can measure from the daily counts
//    (benchmarks.ts), with its value, the previous window's, its target and floor, or "not measured".
// 2. A model is called only when a row is below its floor, and on a watch only when a row is newly
//    below it (no open finding yet), so a quiet studio costs nothing. One unattended session of the
//    Studio Head, the reader of the report, studio overhead with its role (cardId null; PLAN.md §10
//    decision 66), under REVIEW_SESSION_USD and the money caps. It reads the scoreboard and counts of
//    the studio's state as JSON: no text a player wrote, no repository, no files. Its answer must be
//    valid against schemas/benchmark-review.schema.json; findings for other metrics are dropped and
//    every text runs the gate's banned-phrases scan.
// 3. Each row below its floor is written as a finding (kind benchmark, fingerprint
//    benchmark:<metric>), which the board's panel lists, with the likely cause and one proposed
//    adjustment when the session gave them; findings for rows no longer below their floor close. The
//    review is recorded in benchmark_reviews. Nothing here spends money, opens a card or changes a
//    rule: an adjustment is a proposal the board and the studio read.
import path from 'node:path';
import { findingSubject, scoreboard, type ScoreRow } from '../benchmarks.js';
import type { JobContext, JobHandler } from '../jobs.js';
import { round4 } from '../pricing.js';
import { runRoleSession } from '../role-session.js';
import { moneyBounds } from '../throttle.js';
import { AGENTS_DIR, schemaRepoPath, type TypedOutput } from '../typed-output.js';
import { requireWorkflow, sessionDeps } from './workflow.js';

// The most one review session may spend (operating-system.md, Time and cost limits).
export const REVIEW_SESSION_USD = 0.5;
export const WITHHELD = 'Withheld by the content filter.';
const TRIGGERS = ['first', 'fifty_live', 'milestone', 'era', 'backstop', 'watch', 'board'];
export const ADJUSTMENT_KINDS = ['card_proposal', 'priority_change', 'content_change', 'core_work', 'spec_proposal', 'target_change', 'escalation'] as const;

export interface ReviewAnswer {
  summary: string;
  findings: { metric: string; cause: string; adjustment: { kind: (typeof ADJUSTMENT_KINDS)[number]; proposal: string } }[];
}

export function reviewPrompt(rows: readonly ScoreRow[], below: readonly ScoreRow[], studio: Record<string, unknown>, typed: Pick<TypedOutput, 'schemaText'>): string {
  return [
    'Run the benchmark review (docs/strategy/operating-system.md §2) on the scoreboard below.',
    '',
    'The scoreboard is computed by code from the studio\'s daily counts (docs/strategy/benchmarks.md): each row has its value over the trailing 30 days, the previous 30 days\' value, its target, its floor, and a status. "not_measured" means the counter is missing or its denominator is zero: never estimate it. The studio facts are counts. Nothing here was written by a player.',
    '',
    `Answer with exactly one JSON object valid against \`${schemaRepoPath('benchmark-review')}\`:`,
    '',
    typed.schemaText('benchmark-review'),
    '',
    `Write one finding for each of these metrics, and no other: ${below.map((row) => row.metric).join(', ')}. For each, the likely cause from the data, and one adjustment. An adjustment is a proposal recorded for the board: it never spends money, opens a card or changes a money rule, a split, a reserve or a cap; a money idea is a spec_proposal, a kill or pivot line is an escalation. Plain words, all ages.`,
    '',
    '<scoreboard>',
    JSON.stringify(rows),
    '</scoreboard>',
    '<studio>',
    JSON.stringify(studio),
    '</studio>',
  ].join('\n');
}

export const benchmarkReview: JobHandler = async (context: JobContext) => {
  const { db } = context;
  if (!db.benchmarkReviewInputs || !db.recordBenchmarkReview) throw new Error('this database has no benchmark review path');
  const requested = typeof context.run.input?.trigger === 'string' ? context.run.input.trigger : 'board';
  const trigger = TRIGGERS.includes(requested) ? requested : 'board';
  const inputs = await db.benchmarkReviewInputs();
  const rows = scoreboard(inputs.days);
  const below = rows.filter((row) => row.status === 'below_floor');

  const open = new Map((await db.openFindings()).filter((f) => f.kind === 'benchmark').map((f) => [f.fingerprint, f]));
  const fingerprint = (row: ScoreRow) => `benchmark:${row.metric}`;
  const fresh = below.filter((row) => !open.has(fingerprint(row)));
  const callModel = below.length > 0 && (trigger !== 'watch' || fresh.length > 0);

  let answer: ReviewAnswer | null = null;
  let usd = 0;
  let ref: string | null = null;
  let notReviewed: string | null = null;
  if (callModel) {
    const workflow = requireWorkflow(context);
    const role = context.role!;
    const studio = await db.getStudioState();
    if (studio.paused) throw new Error('studio_paused: the studio is paused, so no review session starts');
    const budgetUsd = round4(Math.min(REVIEW_SESSION_USD, workflow.draftSessionMaxUsd));
    let short: string | null = null;
    if (workflow.money) {
      const bounds = moneyBounds(await workflow.money(), { id: `review-${context.run.id}`, stage: 'proposed', estimate_usd: 0, actual_usd: 0, funded_usd: 0, severity: null });
      const hit = ([['daily_cap', bounds.dailyUsd], ['monthly_cap', bounds.monthlyUsd], ['tier_cap', bounds.tierUsd], ['insufficient_balance', bounds.availableUsd]] as const).find(([, left]) => left < budgetUsd);
      if (hit) short = hit[0];
    }
    if (short) {
      // Out of money for a session: the scoreboard and the findings are still written, marked not reviewed.
      notReviewed = short;
    } else {
      const root = path.resolve(AGENTS_DIR, '..', '..');
      const result = await runRoleSession<ReviewAnswer>(
        {
          role,
          runId: context.run.id,
          label: 'review-1',
          worktree: root,
          promptRoot: root,
          prompt: reviewPrompt(rows, below, inputs.studio, workflow.typed),
          schema: 'benchmark-review',
          budgetUsd,
          cardId: null,
          files: [],
          repoSha: null,
        },
        sessionDeps(context, workflow),
      );
      usd = result.usd;
      ref = result.ref;
      if (result.ok) {
        answer = result.value;
        // Every text the board will read runs the gate's banned-phrases scan.
        const texts = [answer.summary, ...answer.findings.flatMap((f) => [f.cause, f.adjustment.proposal])];
        const scan = await workflow.scanText(texts);
        if (!scan.ok) {
          answer = {
            summary: WITHHELD,
            findings: answer.findings.map((f) => ({ ...f, cause: WITHHELD, adjustment: { ...f.adjustment, proposal: WITHHELD } })),
          };
        }
      } else {
        notReviewed = `session_failed: ${result.reason}`;
      }
    }
  }

  const byMetric = new Map((answer?.findings ?? []).filter((f) => below.some((row) => row.metric === f.metric)).map((f) => [f.metric, f]));
  const findings = below.map((row) => {
    const said = byMetric.get(row.metric);
    return {
      metric: row.metric,
      area: row.area,
      value: row.value,
      previous: row.previous,
      floor: row.floor,
      target: row.target,
      cause: said?.cause ?? null,
      adjustment: said?.adjustment ?? null,
    };
  });
  const opened: string[] = [];
  for (const [i, row] of below.entries()) {
    if (await db.recordFinding({ fingerprint: fingerprint(row), kind: 'benchmark', subject: findingSubject(row), detail: { ...findings[i]!, trigger } })) {
      opened.push(fingerprint(row));
    }
  }
  const closed: string[] = [];
  for (const key of open.keys()) {
    if (below.some((row) => fingerprint(row) === key)) continue;
    if (await db.closeFinding(key)) closed.push(key);
  }
  const reviewId = await db.recordBenchmarkReview({
    runId: context.run.id,
    trigger,
    scoreboard: rows,
    findings,
    summary: answer?.summary ?? (notReviewed ? `Not reviewed: ${notReviewed}.` : null),
    reviewed: answer !== null,
    usd,
  });
  context.log.info('review', 'benchmark review done', { trigger, below: below.length, opened: opened.length, closed: closed.length, reviewed: answer !== null });
  return {
    review: reviewId,
    trigger,
    measured: rows.filter((row) => row.status !== 'not_measured').length,
    below_floor: below.map((row) => row.metric),
    opened,
    closed,
    reviewed: answer !== null,
    not_reviewed: notReviewed,
    usd,
    ref,
  };
};
