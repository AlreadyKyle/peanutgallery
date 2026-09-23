import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { JOBS, TIMEZONE, startScheduler, stopScheduler } from '../src/scheduler.js';

function capture(): { log: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk).trim());
      cb();
    },
  });
  return { log: createLogger(stream, () => new Date('2026-09-14T15:00:00.000Z')), lines };
}

describe('scheduler', () => {
  it('lists the eight timed jobs of the architecture in America/New_York', () => {
    expect(TIMEZONE).toBe('America/New_York');
    expect(JOBS.map((job) => job.name)).toEqual([
      'hourly board-note triage',
      'nightly rebalance proposal',
      'Monday allocation and report',
      'macro-vote open',
      'macro-vote close',
      'weekly Biz Dev run',
      'weekly Community run',
      'monthly blue-sky session',
    ]);
    expect(JOBS.find((job) => job.name === 'nightly rebalance proposal')?.expression).toBe('0 3 * * *');
    expect(JOBS.find((job) => job.name === 'Monday allocation and report')?.expression).toBe('0 9 * * 1');
    expect(JOBS.find((job) => job.name === 'macro-vote open')?.expression).toBe('0 12 * * 1');
    expect(JOBS.find((job) => job.name === 'macro-vote close')?.expression).toBe('0 18 * * 0');
  });

  it('schedules nothing when the off switch is set', () => {
    const { log, lines } = capture();
    expect(startScheduler(false, log)).toEqual([]);
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ ts: '2026-09-14T15:00:00.000Z', level: 'info', scope: 'scheduler', msg: 'disabled by DISPATCHER_SCHEDULER=off' }]);
  });

  it('schedules one task per job and stops them all', async () => {
    const { log, lines } = capture();
    const tasks = startScheduler(true, log);
    expect(tasks).toHaveLength(JOBS.length);
    expect(JSON.parse(lines.at(-1) ?? '')).toEqual({ ts: '2026-09-14T15:00:00.000Z', level: 'info', scope: 'scheduler', msg: `${JOBS.length} jobs scheduled in America/New_York` });
    await stopScheduler(tasks);
  });
});
