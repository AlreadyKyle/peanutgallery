// What the role job draft_card runs with (docs/specs/agent-workflows.md, docs/specs/unattended-roles.md):
// the card sessions' adapter and the limits its sessions run under, the money they are checked
// against, the scratch checkout of main, the public-text filter, and the typed reduction every card
// passes through before a prompt sees it.
import type { AgentAdapter } from '../adapters/types.js';
import type { SessionBudgets } from '../budgets.js';
import type { OpenCardRow, Role } from '../db.js';
import type { JobContext } from '../jobs.js';
import type { PriceTable } from '../pricing.js';
import type { PublicTextResult } from '../public-text.js';
import type { RoleSessionDeps } from '../role-session.js';
import type { MoneyState } from '../throttle.js';
import type { TypedOutput } from '../typed-output.js';
import { createScratchWorktree, readFileAtSha, removeWorktree } from '../worktree.js';

// A scratch checkout of origin/main for one run, thrown away after it.
export interface Workspace {
  path: string;
  baseSha: string;
  // A file's text at baseSha, or null when main has no such file.
  readMain(file: string): Promise<string | null>;
  close(): Promise<void>;
}

export interface WorkflowDeps {
  // The card sessions' adapter: in unattended mode the managed one, each session a reader on the
  // studio's Console credit billed to the card it drafts. A role job never runs on the attended
  // adapter (PLAN.md §10 decision 66): in an attended process its sessions are refused.
  adapter: AgentAdapter;
  // True only for the hand-run replay eval (evals/replay.ts), the attended adapter's one remaining use:
  // the founder's login, an in-memory store and no database row.
  allowAttended?: boolean;
  // The most one session may spend (DRAFT_SESSION_MAX_USD).
  draftSessionMaxUsd: number;
  // The money state as the tick reads it (tick.ts currentMoneyState), which each session's budget must
  // fit; unset checks only the per-card maximum.
  money?: () => Promise<MoneyState>;
  // Where a running session's budget is held from the card path (tick.ts jobBudgets).
  jobBudgets?: SessionBudgets;
  typed: TypedOutput;
  priceTable: PriceTable;
  // The model each role runs on (role-model.ts resolveRoleModel), as card sessions resolve it.
  resolveModel?: (role: Role) => string;
  sessionMaxTurns: number;
  sessionMaxMs: number;
  watchIntervalMs: number;
  // The gate's banned-phrases.sh over agent-written text a stranger can read (public-text.ts).
  scanText: (strings: readonly string[]) => Promise<PublicTextResult>;
  openWorkspace: (runId: string) => Promise<Workspace>;
  // rubrics/draft-game.md from this process's checkout.
  rubric: () => Promise<string>;
  ledgerRetryMs?: number;
}

// A card as a role job's prompt shows it. A card a supporter or the community proposed carries its
// id, stage, horizon, bucket and funded amount only: both roles that read these are planners with
// write access, and no agent with write access reads public free text.
export type TypedCard =
  | { id: string; source: 'community'; stage: string; horizon: string; bucket: string; funded_usd: number }
  | {
      id: string;
      source: string;
      stage: string;
      horizon: string;
      bucket: string;
      funded_usd: number;
      lane: string;
      folder: string;
      rank: number | null;
      title: string;
      summary: string | null;
      funding_target_usd: number;
    };

export function typedCard(row: OpenCardRow): TypedCard {
  if (row.source !== 'board' && row.source !== 'agent' && row.source !== 'decision') {
    return { id: row.id, source: 'community', stage: row.stage, horizon: row.horizon, bucket: row.bucket, funded_usd: row.funded_usd };
  }
  return {
    id: row.id,
    source: row.source,
    stage: row.stage,
    horizon: row.horizon,
    bucket: row.bucket,
    funded_usd: row.funded_usd,
    lane: row.lane,
    folder: row.folder,
    rank: row.rank,
    title: row.title,
    summary: row.summary,
    funding_target_usd: row.funding_target_usd,
  };
}

export function requireWorkflow(context: JobContext): WorkflowDeps {
  if (!context.workflow) throw new Error('role jobs are not configured in this process');
  if (!context.role) throw new Error(`job ${context.job.name} has no role`);
  return context.workflow;
}

export function sessionDeps(context: JobContext, workflow: WorkflowDeps): RoleSessionDeps {
  return {
    db: context.db,
    adapter: workflow.adapter,
    // Unattended only, billed to the card (PLAN.md §10 decision 66): never the founder's plan, but for
    // the hand-run replay eval.
    allowAttended: workflow.allowAttended === true,
    // A session spends studio money on its card, so a studio pause stops it as it stops a card session.
    stopWhenStudioPaused: true,
    // No Bash on the managed adapter: a reader runs no agent-written code (PLAN §6, decision 25). The
    // replay at the Mac keeps seed-1's package scripts, as the Designer's role spec holds them.
    scripts: workflow.allowAttended === true && context.mode === 'attended',
    typed: workflow.typed,
    priceTable: workflow.priceTable,
    ...(workflow.resolveModel === undefined ? {} : { resolveModel: workflow.resolveModel }),
    maxTurns: workflow.sessionMaxTurns,
    maxMs: workflow.sessionMaxMs,
    watchIntervalMs: workflow.watchIntervalMs,
    log: context.log,
    stopSignal: context.stopSignal,
    ...(workflow.ledgerRetryMs === undefined ? {} : { ledgerRetryMs: workflow.ledgerRetryMs }),
  };
}

// The scratch checkout a run's sessions work in, at origin/main, removed when the run ends.
export async function gitWorkspace(repoRoot: string, root: string, runId: string, authEnv: NodeJS.ProcessEnv): Promise<Workspace> {
  const created = await createScratchWorktree(repoRoot, root, runId, authEnv);
  return {
    path: created.path,
    baseSha: created.baseSha,
    readMain: (file) => readFileAtSha(repoRoot, created.baseSha, file),
    close: () => removeWorktree(repoRoot, created.path, null),
  };
}
