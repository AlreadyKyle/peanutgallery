// The job queue's dispatcher half (src/jobs.ts, docs/specs/agent-system-core.md): each skip reason, a
// model run of any origin starting with no board member signed in (docs/specs/unattended-roles.md),
// a code run in both modes, one job at a time, a throwing handler, a missing handler, and a studio or
// role pause stopping a running job.
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/types.js';
import type { Job, JobOrigin } from '../src/db.js';
import { jobTick, skipReason, type JobHandler, type JobState, type JobTickDeps } from '../src/jobs.js';
import { createLogger } from '../src/log.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW, role } from './helpers/fake-db.js';

const HOLDER = 'dispatcher-a';

function job(overrides: Partial<Job> = {}): Job {
  return { name: 'tidy_up', role_id: null, calls_model: false, runs_when_paused: false, enabled: true, ...overrides };
}

function setup(jobs: Job[]) {
  const db = new FakeDb();
  db.jobList = jobs;
  db.lease = { holder: HOLDER, expiresAt: NOW.getTime() + 300_000 };
  db.roles = [role(), role({ id: 'role-studio-head', name: 'Studio Head', agent_class: 'planner', write_access: false })];
  const state: JobState = { running: null };
  const stopper = new AbortController();
  const make = (handlers: Record<string, JobHandler>, overrides: Partial<JobTickDeps> = {}): JobTickDeps => ({
    db,
    mode: 'attended',
    adapter: { mode: 'attended' } as unknown as AgentAdapter,
    log: createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() })),
    alert: new RecordingAlerter(),
    now: () => NOW,
    leaseHolder: HOLDER,
    watchIntervalMs: 5,
    state,
    stopSignal: stopper.signal,
    handlers,
    ...overrides,
  });
  const enqueue = (name: string, origin: JobOrigin) => db.enqueueJobRun({ job: name, origin });
  const status = (id: string) => db.jobRuns.find((r) => r.id === id)!;
  const settle = async () => {
    await state.running?.done;
  };
  return { db, state, stopper, make, enqueue, status, settle };
}

describe('skipReason', () => {
  it('names job_disabled, role_paused and studio_paused, in that order, and lets a model run of any origin through', () => {
    const model = job({ calls_model: true });
    expect(skipReason(job({ calls_model: true, enabled: false }), { paused: true }, { paused: true })).toBe('job_disabled');
    expect(skipReason(model, { paused: true }, { paused: true })).toBe('role_paused');
    expect(skipReason(model, { paused: false }, { paused: true })).toBe('studio_paused');
    expect(skipReason(model, { paused: false }, { paused: false })).toBeNull();
    expect(skipReason(model, null, { paused: false })).toBeNull();
    expect(skipReason(job({ runs_when_paused: true }), null, { paused: true })).toBeNull();
  });
});

describe('jobTick', () => {
  it('finishes a run that cannot start as skipped with its reason and starts the next one that can', async () => {
    const t = setup([
      job({ name: 'retired_job', calls_model: true, runs_when_paused: true, enabled: false }),
      job({ name: 'paused_role_job', role_id: 'role-studio-head' }),
      job({ name: 'studio_only' }),
      job({ name: 'code_job', runs_when_paused: true }),
    ]);
    t.db.roles[1]!.paused = true;
    t.db.studio.paused = true;
    const retired = await t.enqueue('retired_job', 'board');
    const roleRun = await t.enqueue('paused_role_job', 'board');
    const studioRun = await t.enqueue('studio_only', 'board');
    const code = await t.enqueue('code_job', 'schedule');
    const ran: string[] = [];
    const outcome = await jobTick(t.make({ code_job: async ({ run }) => void ran.push(run.id), retired_job: async () => ({ ran: true }) }));
    expect(outcome).toEqual({ action: 'started', runId: code.id, job: 'code_job' });
    expect([t.status(retired.id).status, t.status(retired.id).reason]).toEqual(['skipped', 'job_disabled']);
    expect([t.status(roleRun.id).status, t.status(roleRun.id).reason]).toEqual(['skipped', 'role_paused']);
    expect([t.status(studioRun.id).status, t.status(studioRun.id).reason]).toEqual(['skipped', 'studio_paused']);
    await t.settle();
    expect(ran).toEqual([code.id]);
    expect([t.status(code.id).status, t.status(code.id).output]).toEqual(['succeeded', {}]);
  });

  it('starts a model run of any origin with no board member signed in, in either studio mode, and never reads a board session', async () => {
    for (const mode of ['attended', 'unattended'] as const) {
      for (const origin of ['schedule', 'board', 'event', 'operator'] as const) {
        const t = setup([job({ name: 'draft_card', calls_model: true })]);
        t.db.studio.agent_mode = mode;
        let boardReads = 0;
        t.db.boardSessionActive = async () => {
          boardReads += 1;
          return false;
        };
        const run = await t.enqueue('draft_card', origin);
        const ran: string[] = [];
        expect(await jobTick(t.make({ draft_card: async ({ run: started, mode: seen }) => void ran.push(`${started.origin}:${seen}`) }, { mode }))).toEqual({
          action: 'started',
          runId: run.id,
          job: 'draft_card',
        });
        await t.settle();
        expect(ran).toEqual([`${origin}:${mode}`]);
        expect(t.status(run.id).status).toBe('succeeded');
        expect(boardReads).toBe(0);
      }
    }
  });

  it('keeps a running model job running with no board member signed in, and stops it when the studio pauses', async () => {
    const t = setup([job({ name: 'draft_card', calls_model: true })]);
    t.db.boardActive = false;
    const quiet = await t.enqueue('draft_card', 'schedule');
    await jobTick(
      t.make({
        draft_card: async ({ stopSignal }) => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { aborted: stopSignal.aborted };
        },
      }),
    );
    await t.settle();
    expect([t.status(quiet.id).status, t.status(quiet.id).output]).toEqual(['succeeded', { aborted: false }]);
    const paused = await t.enqueue('draft_card', 'schedule');
    await jobTick(
      t.make({
        draft_card: async ({ stopSignal }) => {
          t.db.studio.paused = true;
          await new Promise<void>((resolve) => stopSignal.addEventListener('abort', () => resolve(), { once: true }));
          return { stopped: String(stopSignal.reason) };
        },
      }),
    );
    await t.settle();
    expect([t.status(paused.id).status, t.status(paused.id).reason]).toEqual(['failed', 'studio_paused']);
  });

  it('starts a code run in both modes', async () => {
    for (const mode of ['attended', 'unattended'] as const) {
      const t = setup([job({ name: 'code_job' })]);
      t.db.studio.agent_mode = mode;
      t.db.boardActive = false;
      const run = await t.enqueue('code_job', 'schedule');
      expect(await jobTick(t.make({ code_job: async () => ({ mode }) }, { mode }))).toEqual({ action: 'started', runId: run.id, job: 'code_job' });
      await t.settle();
      expect([t.status(run.id).status, t.status(run.id).output]).toEqual(['succeeded', { mode }]);
    }
  });

  it('runs one job at a time', async () => {
    const t = setup([job({ name: 'slow' }), job({ name: 'fast' })]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const first = await t.enqueue('slow', 'operator');
    await t.enqueue('fast', 'operator');
    const handlers = { slow: async () => void (await held), fast: async () => undefined };
    expect((await jobTick(t.make(handlers))).action).toBe('started');
    expect(await jobTick(t.make(handlers))).toEqual({ action: 'busy', runId: first.id, job: 'slow' });
    expect(t.db.jobRuns.filter((r) => r.status === 'running').map((r) => r.id)).toEqual([first.id]);
    release();
    await t.settle();
    expect((await jobTick(t.make(handlers))).action).toBe('started');
    await t.settle();
    expect(t.db.jobRuns.map((r) => r.status)).toEqual(['succeeded', 'succeeded']);
  });

  it('fails a run whose handler throws, and one whose job has no handler with no_handler', async () => {
    const t = setup([job({ name: 'broken' }), job({ name: 'unknown' })]);
    const broken = await t.enqueue('broken', 'operator');
    await jobTick(t.make({ broken: async () => { throw new Error('the handler broke'); } }));
    await t.settle();
    expect([t.status(broken.id).status, t.status(broken.id).reason]).toEqual(['failed', 'the handler broke']);
    // An error with no message still finishes the run, with a fixed reason, never leaving it running.
    const blank = await t.enqueue('broken', 'operator');
    await jobTick(t.make({ broken: async () => { throw new Error(); } }));
    await t.settle();
    expect([t.status(blank.id).status, t.status(blank.id).reason]).toEqual(['failed', 'handler_error']);
    const unknown = await t.enqueue('unknown', 'operator');
    await jobTick(t.make({}));
    await t.settle();
    expect([t.status(unknown.id).status, t.status(unknown.id).reason]).toEqual(['failed', 'no_handler']);
  });

  it('claims only under the dispatcher lease', async () => {
    const t = setup([job({ name: 'code_job' })]);
    const run = await t.enqueue('code_job', 'operator');
    t.db.lease = { holder: 'someone-else', expiresAt: NOW.getTime() + 300_000 };
    expect(await jobTick(t.make({ code_job: async () => undefined }))).toEqual({ action: 'idle', skipped: 0 });
    expect(t.status(run.id).status).toBe('queued');
  });

  it('stops a running job at the next watch when the studio pauses, or when its role pauses', async () => {
    for (const cause of ['studio_paused', 'role_paused'] as const) {
      const t = setup([job({ name: 'long', role_id: 'role-studio-head' })]);
      const run = await t.enqueue('long', 'operator');
      const handler: JobHandler = async ({ stopSignal }) => {
        if (cause === 'studio_paused') t.db.studio.paused = true;
        else t.db.roles[1]!.paused = true;
        await new Promise<void>((resolve) => stopSignal.addEventListener('abort', () => resolve(), { once: true }));
        return { stopped: String(stopSignal.reason) };
      };
      await jobTick(t.make({ long: handler }));
      await t.settle();
      expect([t.status(run.id).status, t.status(run.id).reason]).toEqual(['failed', cause]);
    }
  });

  it('lets a job that runs while the studio is paused keep running when the studio pauses', async () => {
    const t = setup([job({ name: 'paused_ok', runs_when_paused: true })]);
    const run = await t.enqueue('paused_ok', 'operator');
    await jobTick(
      t.make({
        paused_ok: async ({ stopSignal }) => {
          t.db.studio.paused = true;
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { aborted: stopSignal.aborted };
        },
      }),
    );
    await t.settle();
    expect([t.status(run.id).status, t.status(run.id).output]).toEqual(['succeeded', { aborted: false }]);
  });

  it('stops a running job when the dispatcher stops', async () => {
    const t = setup([job({ name: 'long' })]);
    const run = await t.enqueue('long', 'operator');
    await jobTick(
      t.make({
        long: async ({ stopSignal }) => {
          t.stopper.abort('stopping');
          return { aborted: stopSignal.aborted };
        },
      }),
    );
    await t.settle();
    expect([t.status(run.id).status, t.status(run.id).reason]).toEqual(['failed', 'dispatcher_stopping']);
  });

  it('keeps enqueue once per key, one queued scheduled run per job, and a board parent origin (the fake mirrors the SQL)', async () => {
    const t = setup([job({ name: 'code_job' })]);
    const a = await t.db.enqueueJobRun({ job: 'code_job', origin: 'event', key: 'k' });
    expect(await t.db.enqueueJobRun({ job: 'code_job', origin: 'event', key: 'k' })).toEqual({ id: a.id, created: false });
    const s1 = await t.db.enqueueJobRun({ job: 'code_job', origin: 'schedule', key: 'm1' });
    expect(await t.db.enqueueJobRun({ job: 'code_job', origin: 'schedule', key: 'm2' })).toEqual({ id: s1.id, created: false });
    const board = await t.db.enqueueJobRun({ job: 'code_job', origin: 'board', key: 'b' });
    const child = await t.db.enqueueJobRun({ job: 'code_job', origin: 'event', parentRunId: board.id });
    expect(t.status(child.id).origin).toBe('board');
  });
});
