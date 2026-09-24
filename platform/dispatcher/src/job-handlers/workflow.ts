// What the two role jobs share (docs/specs/agent-workflows.md): the attended adapter and the limits
// their sessions run under, the scratch checkout of main, the public-text filter, and the typed
// reduction every card passes through before a prompt sees it.
import type { AgentAdapter } from '../adapters/types.js';
import type { OpenCardRow } from '../db.js';
import type { JobContext } from '../jobs.js';
import type { PriceTable } from '../pricing.js';
import type { PublicTextResult } from '../public-text.js';
import type { RoleSessionDeps } from '../role-session.js';
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
  // claude -p on the founder's plan, whatever mode the card sessions run in.
  roleAdapter: AgentAdapter;
  typed: TypedOutput;
  priceTable: PriceTable;
  sessionMaxTurns: number;
  sessionMaxMs: number;
  boardSessionTtlMin: number;
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
    adapter: workflow.roleAdapter,
    // Bash (the folder's package scripts) only in an attended process: the unattended host runs no
    // agent-written code (PLAN §6, decision 25).
    scripts: context.mode === 'attended',
    typed: workflow.typed,
    priceTable: workflow.priceTable,
    maxTurns: workflow.sessionMaxTurns,
    maxMs: workflow.sessionMaxMs,
    boardSessionTtlMin: workflow.boardSessionTtlMin,
    watchIntervalMs: workflow.watchIntervalMs,
    log: context.log,
    stopSignal: context.stopSignal,
    now: context.now,
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
