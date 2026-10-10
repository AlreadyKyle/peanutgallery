// The job queue's dispatcher half (docs/specs/agent-system-core.md). pg_cron and the board queue
// runs in job_runs (enqueue_job_run, enqueue_manual_job, enqueue_supply_draft); each tick starts at
// most one, one job at a time beside the card sessions:
// - it reads the oldest queued runs and takes the first that can start, finishing each earlier one
//   that cannot as skipped with its reason: job_disabled (the job is retired, as studio_ranking is),
//   role_paused (the job's role is paused), studio_paused (the studio is paused and the job does not
//   run while it is, which is every model-calling job whatever its row says);
// - a model-calling run starts like a code run, from any origin, with no board member signed in: its
//   sessions run unattended on the card sessions' adapter, billed to the card they work on
//   (PLAN.md §10 decision 66, docs/specs/unattended-roles.md), so it never runs while the studio is
//   paused;
// - it claims the run under the dispatcher lease, runs its handler (job-handlers/index.ts) in the
//   background and finishes the run with the handler's output, or as failed with the error. A job
//   with no handler fails with no_handler.
// A running job's stopSignal fires at the next watch after its role pauses, or the studio pauses and
// the job does not run while it is paused, or the dispatcher stops; the run then fails with that
// reason. A code job that runs while the studio is paused keeps running through a studio pause; its
// role's pause still stops it.
import type { AgentAdapter, AgentMode } from './adapters/types.js';
import type { Alerter } from './alert.js';
import type { Db, Job, JobRun, Role, StudioState } from './db.js';
import { HANDLERS } from './job-handlers/index.js';
import type { UpkeepDeps } from './job-handlers/upkeep.js';
import type { WorkflowDeps } from './job-handlers/workflow.js';
import { errorMessage, type Logger } from './log.js';

export interface JobContext {
  run: JobRun;
  job: Job;
  // The job's role, or null for a job with none.
  role: Role | null;
  // The card sessions' mode and adapter. A model-calling handler runs its sessions on this adapter
  // (the managed one: the dispatcher runs unattended only), billed to the card it works on.
  mode: AgentMode;
  db: Db;
  adapter: AgentAdapter;
  log: Logger;
  alert: Alerter;
  // Fires when the job's role or the studio pauses, or the dispatcher stops; the handler stops then.
  stopSignal: AbortSignal;
  now: () => Date;
  // What the role jobs run with (docs/specs/agent-workflows.md); absent where none is configured.
  workflow?: WorkflowDeps;
  // What the Janitor's code jobs run with (docs/specs/agent-upkeep.md); absent where none is configured.
  upkeep?: UpkeepDeps;
}

// A handler returns the run's output, a JSON object, or nothing.
export type JobHandler = (context: JobContext) => Promise<Record<string, unknown> | void>;

export type SkipReason = 'job_disabled' | 'role_paused' | 'studio_paused';
export type StopReason = 'role_paused' | 'studio_paused' | 'dispatcher_stopping';

// The reason a thrown handler's run fails with when the error carries no message: finish_job_run
// refuses a failed run with an empty reason, which would leave the run marked running.
export const HANDLER_ERROR = 'handler_error';

// What this process is running: at most one job at a time.
export interface JobState {
  running: { runId: string; job: string; done: Promise<void> } | null;
}

export interface JobTickDeps {
  db: Db;
  mode: AgentMode;
  adapter: AgentAdapter;
  log: Logger;
  alert: Alerter;
  now: () => Date;
  // This process's name on the dispatcher lease; claim_job_run refuses any other.
  leaseHolder: string;
  // How often a running job's role and the studio are read.
  watchIntervalMs: number;
  state: JobState;
  // The dispatcher stopping.
  stopSignal: AbortSignal;
  handlers?: Readonly<Record<string, JobHandler>>;
  workflow?: WorkflowDeps;
  upkeep?: UpkeepDeps;
}

export type JobTickOutcome =
  | { action: 'busy'; runId: string; job: string }
  | { action: 'started'; runId: string; job: string }
  | { action: 'idle'; skipped: number };

// How many queued runs a tick reads.
export const QUEUE_WINDOW = 50;

// Whether a studio pause stops the job: one that does not run while the studio is paused, and every
// model-calling job whatever its row says, since each model call is billed to the studio on a card
// (PLAN.md §10 decision 66) and a pause stops studio spend.
export function stopsWithStudio(job: Pick<Job, 'calls_model' | 'runs_when_paused'>): boolean {
  return job.calls_model || !job.runs_when_paused;
}

// Why a queued run cannot start, or null when it may. Its origin does not matter: a model-calling run
// the schedule queued starts as one the board queued does.
export function skipReason(job: Job, role: Pick<Role, 'paused'> | null, studio: Pick<StudioState, 'paused'>): SkipReason | null {
  if (!job.enabled) return 'job_disabled';
  if (role?.paused) return 'role_paused';
  if (studio.paused && stopsWithStudio(job)) return 'studio_paused';
  return null;
}

export async function jobTick(deps: JobTickDeps): Promise<JobTickOutcome> {
  const current = deps.state.running;
  if (current) return { action: 'busy', runId: current.runId, job: current.job };
  const runs = await deps.db.queuedRuns(QUEUE_WINDOW);
  if (runs.length === 0) return { action: 'idle', skipped: 0 };
  const [studio, jobs] = await Promise.all([deps.db.getStudioState(), deps.db.jobs()]);
  const byName = new Map(jobs.map((job) => [job.name, job]));
  const roles = new Map<string, Role>();
  let skipped = 0;
  for (const run of runs) {
    const job = byName.get(run.job_name);
    if (!job) continue;
    let role: Role | null = null;
    if (job.role_id) {
      role = roles.get(job.role_id) ?? (await deps.db.getRole(job.role_id));
      roles.set(job.role_id, role);
    }
    const skip = skipReason(job, role, studio);
    if (skip) {
      await deps.db.finishJobRun(run.id, 'skipped', skip, null);
      deps.log.info('jobs', `job run ${run.id} skipped`, { job: job.name, origin: run.origin, reason: skip });
      skipped += 1;
      continue;
    }
    if (!(await deps.db.claimJobRun(run.id, deps.leaseHolder))) continue;
    start(deps, run, job, role);
    deps.log.info('jobs', `job run ${run.id} started`, { job: job.name, origin: run.origin });
    return { action: 'started', runId: run.id, job: job.name };
  }
  return { action: 'idle', skipped };
}

function start(deps: JobTickDeps, run: JobRun, job: Job, role: Role | null): void {
  const stop = new AbortController();
  const halt = (reason: StopReason) => {
    if (stop.signal.aborted) return;
    deps.log.warn('jobs', `stopping job run ${run.id}`, { job: job.name, reason });
    stop.abort(reason);
  };
  const onStopping = () => halt('dispatcher_stopping');
  if (deps.stopSignal.aborted) onStopping();
  deps.stopSignal.addEventListener('abort', onStopping, { once: true });
  const watch = setInterval(() => {
    void (async () => {
      try {
        const [studio, roleState] = await Promise.all([deps.db.getStudioState(), job.role_id ? deps.db.roleState(job.role_id) : Promise.resolve(null)]);
        if (roleState?.paused) halt('role_paused');
        else if (studio.paused && stopsWithStudio(job)) halt('studio_paused');
      } catch (error) {
        deps.log.warn('jobs', 'job watch failed', { run: run.id, error: errorMessage(error) });
      }
    })();
  }, deps.watchIntervalMs);

  const handler = (deps.handlers ?? HANDLERS)[job.name];
  const finish = async (status: 'succeeded' | 'failed', reason: string | null, output: Record<string, unknown> | null) => {
    try {
      await deps.db.finishJobRun(run.id, status, reason, output);
      deps.log.info('jobs', `job run ${run.id} ${status}`, { job: job.name, reason });
    } catch (error) {
      deps.log.error('jobs', `job run ${run.id} could not be finished`, { job: job.name, status, reason, error: errorMessage(error) });
    }
  };
  const stopReason = () => (stop.signal.aborted ? String(stop.signal.reason) : null);
  const done = (async () => {
    try {
      if (!handler) {
        await finish('failed', 'no_handler', null);
        return;
      }
      const output = await handler({
        run,
        job,
        role,
        mode: deps.mode,
        db: deps.db,
        adapter: deps.adapter,
        log: deps.log,
        alert: deps.alert,
        stopSignal: stop.signal,
        now: deps.now,
        ...(deps.workflow ? { workflow: deps.workflow } : {}),
        ...(deps.upkeep ? { upkeep: deps.upkeep } : {}),
      });
      const stopped = stopReason();
      if (stopped) await finish('failed', stopped, output ?? null);
      else await finish('succeeded', null, output ?? {});
    } catch (error) {
      await finish('failed', stopReason() ?? (errorMessage(error).slice(0, 500).trim() || HANDLER_ERROR), null);
    } finally {
      clearInterval(watch);
      deps.stopSignal.removeEventListener('abort', onStopping);
      deps.state.running = null;
    }
  })();
  deps.state.running = { runId: run.id, job: job.name, done };
}
