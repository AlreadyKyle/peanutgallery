// The handler of each job the queue runs, by job name (docs/specs/agent-system-core.md). None is
// registered here: later pull requests add their jobs' rows and handlers together
// (docs/specs/agent-workflows.md and after). A run of a job with no handler fails with no_handler.
import type { JobHandler } from '../jobs.js';

export const HANDLERS: Readonly<Record<string, JobHandler>> = {};
