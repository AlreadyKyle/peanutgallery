// The handler of each job the queue runs, by job name (docs/specs/agent-system-core.md). Each job's
// row and its handler land together: draft_card with docs/specs/agent-workflows.md (unattended and
// self-scheduled since docs/specs/unattended-roles.md), janitor and upkeep_merge with
// docs/specs/agent-upkeep.md. studio_ranking is retired (PLAN.md §10 decision 66): its row is
// disabled and it has no handler, so a run of it is skipped as job_disabled, or fails with no_handler
// on a database that still has it enabled.
// A run of a job with no handler fails with no_handler.
import type { JobHandler } from '../jobs.js';
import { draftCard } from './draft-card.js';
import { janitor } from './janitor.js';
import { upkeepMerge } from './upkeep-merge.js';

export const HANDLERS: Readonly<Record<string, JobHandler>> = {
  draft_card: draftCard,
  janitor,
  upkeep_merge: upkeepMerge,
};
