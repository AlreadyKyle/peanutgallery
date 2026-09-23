// Timed jobs from the architecture section, as node-cron entries in America/New_York.
// In build 1 each job logs that it is due; the agent sessions behind them are later work.
import cron, { type ScheduledTask } from 'node-cron';
import type { Logger } from './log.js';

export const TIMEZONE = 'America/New_York';

export interface ScheduledJob {
  name: string;
  expression: string;
}

export const JOBS: readonly ScheduledJob[] = [
  { name: 'hourly board-note triage', expression: '0 * * * *' },
  { name: 'nightly rebalance proposal', expression: '0 3 * * *' },
  { name: 'Monday allocation and report', expression: '0 9 * * 1' },
  { name: 'macro-vote open', expression: '0 12 * * 1' },
  { name: 'macro-vote close', expression: '0 18 * * 0' },
  { name: 'weekly Biz Dev run', expression: '0 10 * * 2' },
  { name: 'weekly Community run', expression: '0 10 * * 4' },
  { name: 'monthly blue-sky session', expression: '0 10 1 * *' },
];

export function startScheduler(enabled: boolean, log: Logger): ScheduledTask[] {
  if (!enabled) {
    log.info('scheduler', 'disabled by DISPATCHER_SCHEDULER=off');
    return [];
  }
  const tasks = JOBS.map((job) =>
    cron.schedule(job.expression, () => log.info('scheduler', `${job.name} is due; no handler runs in build 1`), {
      timezone: TIMEZONE,
      name: job.name,
    }),
  );
  log.info('scheduler', `${tasks.length} jobs scheduled in ${TIMEZONE}`);
  return tasks;
}

export async function stopScheduler(tasks: ScheduledTask[]): Promise<void> {
  await Promise.all(tasks.map((task) => task.destroy()));
}
