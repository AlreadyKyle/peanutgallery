// The Directors' visual review (docs/specs/design-review.md). When a card's green gate run uploaded
// design-frames with changed frames, one attended role session reviews them: the Game Director for a
// seed-1 card, the Platform Director for a platform/site card. It starts only while a board member is
// signed in at /board (the board-session wait of agent-system-core), holds exactly its role spec's
// tools (Read, Glob and Grep: no Bash, Write, Edit, web or MCP tool, no fallback model), works in the
// folder of frames, is billed to the founder with the Director's role (role-session.ts), and answers
// with one object valid against visual-verdict.schema.json whose every frame is one the gate changed.
// Anything else records nothing and the review fails, which the pipeline treats as an
// infrastructure stop.
//
// decideReview is the end rule: all pass merges; a revise with fewer than two rounds used sends the
// builder the failing criteria, frame names and reason codes and nothing else; after two rounds an
// all-ages revise rejects the card and any other open criterion merges with its verdict recorded.
import type { CardFolder } from './adapters/types.js';
import type { Card, Db, Role } from './db.js';
import type { Frames } from './frames.js';
import { errorMessage } from './log.js';
import { runRoleSession, type RoleSessionDeps } from './role-session.js';
import { sleep } from './time.js';
import { schemaRepoPath, type TypedOutput } from './typed-output.js';
import { shortId, singleLineTitle } from './worktree.js';

export const REVIEW_CRITERIA = ['intent', 'fit', 'legibility', 'all_ages'] as const;
export type Criterion = (typeof REVIEW_CRITERIA)[number];

export interface CriterionVerdict {
  verdict: 'pass' | 'revise';
  frame: string;
  reason_code: string;
}

export interface VisualVerdict {
  criteria: Record<Criterion, CriterionVerdict>;
}

// Revise rounds a card may use; the third verdict is final.
export const MAX_REVIEW_ROUNDS = 2;

export type ReviewDecision = 'merge' | 'revise' | 'merge_open' | 'reject';

// The Director who reviews a card, by its folder.
export const REVIEWERS: Readonly<Record<CardFolder, string>> = { 'seed-1': 'Game Director', platform: 'Platform Director' };

export const VISUAL_RUBRIC = 'platform/agents/rubrics/visual.md';

export interface OpenCriterion {
  criterion: Criterion;
  frame: string;
  reason_code: string;
}

// The criteria sent back to revise, in the schema's order.
export function openCriteria(verdict: VisualVerdict): OpenCriterion[] {
  return REVIEW_CRITERIA.filter((criterion) => verdict.criteria[criterion].verdict === 'revise').map((criterion) => ({
    criterion,
    frame: verdict.criteria[criterion].frame,
    reason_code: verdict.criteria[criterion].reason_code,
  }));
}

// What happens after a verdict, given the revise rounds already used.
export function decideReview(verdict: VisualVerdict, roundsUsed: number): ReviewDecision {
  const open = openCriteria(verdict);
  if (open.length === 0) return 'merge';
  if (roundsUsed < MAX_REVIEW_ROUNDS) return 'revise';
  return open.some((item) => item.criterion === 'all_ages') ? 'reject' : 'merge_open';
}

// The frames a verdict names that the gate did not change, or none.
export function unknownFrames(verdict: VisualVerdict, changed: readonly string[]): string[] {
  return REVIEW_CRITERIA.map((criterion) => verdict.criteria[criterion].frame).filter((frame) => !changed.includes(frame));
}

// The builder's revision feedback: the failing criteria, frame names and reason codes, all typed, and
// nothing a Director wrote in free text.
export function revisionAddendum(verdict: VisualVerdict, round: number): string {
  return [
    `Visual review: revision ${round} of ${MAX_REVIEW_ROUNDS}. The Director reviewed the frames your change drew and sent it back. Your change is already in this working tree; revise it so each criterion below passes, keeping the acceptance test true. The criteria and reason codes are defined in ${VISUAL_RUBRIC}.`,
    ...openCriteria(verdict).map((item) => `- ${item.criterion}: ${item.reason_code} (frame ${item.frame})`),
  ].join('\n');
}

export interface ReviewPromptInput {
  card: Card;
  sha: string;
  gateUrl: string | null;
  // 1 for the first review, up to MAX_REVIEW_ROUNDS + 1.
  review: number;
  changed: readonly string[];
  rubric: string;
}

export function reviewPrompt(input: ReviewPromptInput, typed: TypedOutput): string {
  const { card } = input;
  return [
    `Review the frames of card ${shortId(card.id)}: ${singleLineTitle(card.title)} (review ${input.review} of at most ${MAX_REVIEW_ROUNDS + 1}). Folder: ${card.folder}. Lane: ${card.lane}.`,
    `The builder made the change in another session. The gate passed on ${input.sha}${input.gateUrl ? ` (${input.gateUrl})` : ''}, with its design checks (accessibility, sideways scroll, reduced motion and layout balance) green.`,
    '',
    'Intent:',
    card.intent ?? '',
    '',
    'Acceptance test:',
    card.acceptance_test ?? '',
    '',
    'The changed frames, each in this folder as <name>.before.png and <name>.after.png (a frame the base did not draw has no before file):',
    ...input.changed.map((frame) => `- ${frame}`),
    '',
    input.rubric.trim(),
    '',
    `Answer with one JSON object valid against ${schemaRepoPath('visual-verdict')} and nothing else:`,
    typed.schemaText('visual-verdict'),
  ].join('\n');
}

export interface VisualReviewDeps {
  db: Pick<Db, 'boardSessionActive' | 'listActiveRoles' | 'recordUsage' | 'roleState'>;
  // The attended role session's limits, adapter and schemas (role-session.ts); its db is the one above.
  session: Omit<RoleSessionDeps, 'db' | 'scripts'>;
  // rubrics/visual.md from this process's checkout.
  rubric: () => Promise<string>;
  // The dispatcher's own checkout, which the Director's prompt_path is read from.
  promptRoot: string;
  // The most a review session may spend at list price (billed to the founder).
  budgetUsd: number;
  // How often the board-session wait looks again.
  waitIntervalMs: number;
}

export type ReviewOutcome =
  | { kind: 'verdict'; verdict: VisualVerdict; ref: string; director: Role }
  // The review could not give a verdict: no Director to run, a failed session, or an answer that is
  // not one valid verdict naming changed frames. Nothing was recorded.
  | { kind: 'failed'; reason: string }
  // The dispatcher stopped while the review waited or ran.
  | { kind: 'stopped' };

export interface ReviewInput {
  card: Card;
  frames: Frames;
  sha: string;
  gateUrl: string | null;
  review: number;
}

// Waits for a signed-in board member, then runs the review session.
export async function runVisualReview(input: ReviewInput, deps: VisualReviewDeps): Promise<ReviewOutcome> {
  const { card } = input;
  const { log, stopSignal, now } = deps.session;
  let told = false;
  for (;;) {
    if (stopSignal.aborted) return { kind: 'stopped' };
    let present = false;
    try {
      present = await deps.db.boardSessionActive(deps.session.boardSessionTtlMin, now());
    } catch (error) {
      log.warn('visual-review', 'board session read failed; waiting on', { card: card.id, error: errorMessage(error) });
    }
    if (present) break;
    if (!told) log.info('visual-review', `card ${card.id} waits at gated for a board member to review its frames`, { changed: input.frames.changed.length });
    told = true;
    await sleep(deps.waitIntervalMs, stopSignal);
  }

  const name = REVIEWERS[card.folder];
  const director = (await deps.db.listActiveRoles()).find((candidate) => candidate.name === name);
  if (!director) return { kind: 'failed', reason: `the ${name} is not an active role` };
  if (director.paused) return { kind: 'failed', reason: `the ${name} is paused` };
  if (director.id === card.executor_role_id) return { kind: 'failed', reason: `the ${name} executes this card, so it cannot review it` };

  const rubric = await deps.rubric();
  const result = await runRoleSession<VisualVerdict>(
    {
      role: director,
      runId: `visual-${shortId(card.id)}-${input.sha.slice(0, 8)}`,
      label: `review-${input.review}`,
      worktree: input.frames.dir,
      promptRoot: deps.promptRoot,
      prompt: reviewPrompt({ card, sha: input.sha, gateUrl: input.gateUrl, review: input.review, changed: input.frames.changed, rubric }, deps.session.typed),
      schema: 'visual-verdict',
      budgetUsd: deps.budgetUsd,
    },
    { ...deps.session, db: deps.db, scripts: false },
  );
  if (!result.ok) {
    if (stopSignal.aborted) return { kind: 'stopped' };
    return { kind: 'failed', reason: `the ${name}'s review session failed: ${result.reason}` };
  }
  const unknown = unknownFrames(result.value, input.frames.changed);
  if (unknown.length > 0) return { kind: 'failed', reason: `the verdict names frames the gate did not change: ${unknown.join(', ')}` };
  return { kind: 'verdict', verdict: result.value, ref: result.ref, director };
}
