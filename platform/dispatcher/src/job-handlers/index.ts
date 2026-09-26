// The handler of each job the queue runs, by job name (docs/specs/agent-system-core.md). Each job's
// row and its handler land together: studio_ranking and draft_card with docs/specs/agent-workflows.md,
// janitor and upkeep_merge with docs/specs/agent-upkeep.md.
// A run of a job with no handler fails with no_handler.
import type { JobHandler } from '../jobs.js';
import { draftCard } from './draft-card.js';
import { janitor } from './janitor.js';
import { studioRanking } from './studio-ranking.js';
import { upkeepMerge } from './upkeep-merge.js';

export const HANDLERS: Readonly<Record<string, JobHandler>> = {
  studio_ranking: studioRanking,
  draft_card: draftCard,
  janitor,
  upkeep_merge: upkeepMerge,
};
