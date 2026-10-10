// The Directors' visual review (docs/specs/design-review.md). When a card's green gate run uploaded
// design-frames with changed frames, role sessions review them: the Game Director for a seed-1 card,
// the Platform Director for a platform/site card. No board member need be signed in. In an unattended
// process each session runs on the managed adapter as a reader (read, glob and grep, no patch), on the
// studio's Console credit billed to the card it reviews with the Director's role, the frames uploaded
// and mounted at FRAMES_MOUNT; in an attended process it runs through claude -p in the folder of
// frames, billed to the founder (role-session.ts). Either way the session holds exactly its role spec's
// tools (Read, Glob and Grep: no Bash, Write, Edit, web or MCP tool, no fallback model) and answers
// with one object valid against visual-verdict.schema.json whose every frame is one it was shown.
// Anything else records nothing and the review fails, which the pipeline treats as an infrastructure
// stop; a refusal of the studio key for credit or at the tier cap is named, so the pipeline pauses the
// studio instead.
//
// A card that changed more than REVIEW_BATCH_FRAMES frames is reviewed in batches of at most that many,
// one session each, in changed.txt's order. The verdicts combine worst-of per criterion: a criterion
// any batch sends back is revise, naming the first batch's failing frame and reason code; one every
// batch passes is pass.
//
// decideReview is the end rule: all pass merges; a revise with fewer than two rounds used sends the
// builder the failing criteria, frame names and reason codes and nothing else; after two rounds an
// all-ages revise rejects the card and any other open criterion merges with its verdict recorded.
import { access } from 'node:fs/promises';
import path from 'node:path';
import { UPLOADS_DIR } from './adapters/managed.js';
import type { CardFolder, RoleSessionFile } from './adapters/types.js';
import type { SpendRefusal } from './credit.js';
import type { Card, Db, Role } from './db.js';
import { framePair, type Frames } from './frames.js';
import { runRoleSession, type RoleSessionDeps } from './role-session.js';
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

// The most changed frames one review session is shown (each a before and an after image).
export const REVIEW_BATCH_FRAMES = 12;

// Where a managed review session finds the frames: <FRAMES_MOUNT>/<side>/<name>.before.png and .after.png.
export const FRAMES_MOUNT = `${UPLOADS_DIR}/frames`;

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

// The changed frames in batches of at most size, in order.
export function reviewBatches(changed: readonly string[], size = REVIEW_BATCH_FRAMES): string[][] {
  const batches: string[][] = [];
  for (let start = 0; start < changed.length; start += size) batches.push(changed.slice(start, start + size));
  return batches;
}

// The batches' verdicts as one, worst-of per criterion: the first batch that sends a criterion back
// names its frame and reason code; a criterion every batch passes takes the first batch's pass.
export function combineVerdicts(verdicts: readonly VisualVerdict[]): VisualVerdict {
  const first = verdicts[0];
  if (!first) throw new Error('no verdict to combine');
  const criteria = {} as Record<Criterion, CriterionVerdict>;
  for (const criterion of REVIEW_CRITERIA) {
    const revise = verdicts.find((verdict) => verdict.criteria[criterion].verdict === 'revise');
    criteria[criterion] = { ...(revise ?? first).criteria[criterion] };
  }
  return { criteria };
}

// The builder's revision feedback: the failing criteria, frame names and reason codes, all typed, and
// nothing a Director wrote in free text.
export function revisionAddendum(verdict: VisualVerdict, round: number): string {
  return [
    `Visual review: revision ${round} of ${MAX_REVIEW_ROUNDS}. The Director reviewed the frames your change drew and sent it back. Your change is already in this working tree; revise it so each criterion below passes, keeping the acceptance test true. The criteria and reason codes are defined in ${VISUAL_RUBRIC}.`,
    ...openCriteria(verdict).map((item) => `- ${item.criterion}: ${item.reason_code} (frame ${item.frame})`),
  ].join('\n');
}

// One changed frame as the session sees it: the image files' paths where it reads them, and whether
// the base drew the frame at all.
export interface ShownFrame {
  frame: string;
  before: string | null;
  after: string;
}

export interface ReviewPromptInput {
  card: Card;
  sha: string;
  gateUrl: string | null;
  // 1 for the first review, up to MAX_REVIEW_ROUNDS + 1.
  review: number;
  frames: readonly ShownFrame[];
  // This session's batch and how many there are, when the frames were split.
  batch?: { index: number; count: number };
  rubric: string;
}

export function reviewPrompt(input: ReviewPromptInput, typed: TypedOutput): string {
  const { card } = input;
  const batch = input.batch && input.batch.count > 1 ? ` This session shows batch ${input.batch.index} of ${input.batch.count} of the changed frames; review only these.` : '';
  return [
    `Review the frames of card ${shortId(card.id)}: ${singleLineTitle(card.title)} (review ${input.review} of at most ${MAX_REVIEW_ROUNDS + 1}). Folder: ${card.folder}. Lane: ${card.lane}.`,
    `The builder made the change in another session. The gate passed on ${input.sha}${input.gateUrl ? ` (${input.gateUrl})` : ''}, with its design checks (accessibility, sideways scroll, reduced motion and layout balance) green.${batch}`,
    '',
    'Intent:',
    card.intent ?? '',
    '',
    'Acceptance test:',
    card.acceptance_test ?? '',
    '',
    'The changed frames. Read each image with the Read tool at the path given; a frame the base did not draw has no before image. Name a frame in your answer exactly as it is listed before the colon:',
    ...input.frames.map((shown) => `- ${shown.frame}: before ${shown.before ?? '(none: the base did not draw it)'}; after ${shown.after}`),
    '',
    input.rubric.trim(),
    '',
    `Answer with one JSON object valid against ${schemaRepoPath('visual-verdict')} and nothing else:`,
    typed.schemaText('visual-verdict'),
  ].join('\n');
}

export interface VisualReviewDeps {
  db: Pick<Db, 'listActiveRoles' | 'recordUsage' | 'roleState'>;
  // The role session's limits, adapter and schemas (role-session.ts); its db is the one above.
  session: Omit<RoleSessionDeps, 'db' | 'scripts'>;
  // rubrics/visual.md from this process's checkout.
  rubric: () => Promise<string>;
  // The dispatcher's own checkout, which the Director's prompt_path is read from.
  promptRoot: string;
}

export type ReviewOutcome =
  // ref is every session's ref, joined with + when there were several; refs lists them.
  | { kind: 'verdict'; verdict: VisualVerdict; ref: string; refs: string[]; director: Role }
  // The review could not give a verdict: no Director to run, a failed session, or an answer that is
  // not one valid verdict naming frames it was shown. Nothing was recorded. refusal: the API refused
  // the studio key for credit or at its tier cap.
  | { kind: 'failed'; reason: string; refusal?: SpendRefusal }
  // The dispatcher stopped while the review ran.
  | { kind: 'stopped' };

export interface ReviewInput {
  card: Card;
  frames: Frames;
  sha: string;
  gateUrl: string | null;
  review: number;
  // What the review's sessions may spend together at list price.
  budgetUsd: number;
  // The running sessions' spend estimate, for the card's claim budget (budgets.ts).
  onSpend?: (usd: number) => void;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

// One batch's frames: where the session reads them, and the files a managed session mounts.
async function batchFrames(dir: string, batch: readonly string[], managed: boolean): Promise<{ shown: ShownFrame[]; files: RoleSessionFile[] }> {
  const shown: ShownFrame[] = [];
  const files: RoleSessionFile[] = [];
  const root = managed ? FRAMES_MOUNT : dir;
  for (const frame of batch) {
    const pair = framePair(frame);
    const hasBefore = await exists(path.join(dir, pair.before));
    const where = (file: string) => (managed ? `${FRAMES_MOUNT}/${file}` : path.join(root, file));
    shown.push({ frame, before: hasBefore ? where(pair.before) : null, after: where(pair.after) });
    if (managed) {
      if (hasBefore) files.push({ path: path.join(dir, pair.before), mountPath: where(pair.before) });
      files.push({ path: path.join(dir, pair.after), mountPath: where(pair.after) });
    }
  }
  return { shown, files };
}

// Runs the review sessions, one per batch, and combines their verdicts.
export async function runVisualReview(input: ReviewInput, deps: VisualReviewDeps): Promise<ReviewOutcome> {
  const { card } = input;
  const { stopSignal } = deps.session;
  if (stopSignal.aborted) return { kind: 'stopped' };

  const name = REVIEWERS[card.folder];
  const director = (await deps.db.listActiveRoles()).find((candidate) => candidate.name === name);
  if (!director) return { kind: 'failed', reason: `the ${name} is not an active role` };
  if (director.paused) return { kind: 'failed', reason: `the ${name} is paused` };
  if (director.id === card.executor_role_id) return { kind: 'failed', reason: `the ${name} executes this card, so it cannot review it` };

  const rubric = await deps.rubric();
  const managed = deps.session.adapter.mode === 'unattended';
  const batches = reviewBatches(input.frames.changed);
  const verdicts: VisualVerdict[] = [];
  const refs: string[] = [];
  let spentBefore = 0;
  for (const [index, batch] of batches.entries()) {
    const left = Math.round((input.budgetUsd - spentBefore) * 10_000) / 10_000;
    if (!(left > 0)) return { kind: 'failed', reason: `the review's budget of ${input.budgetUsd} USD was spent before batch ${index + 1} of ${batches.length}` };
    const { shown, files } = await batchFrames(input.frames.dir, batch, managed);
    const base = spentBefore;
    const result = await runRoleSession<VisualVerdict>(
      {
        role: director,
        runId: `visual-${shortId(card.id)}-${input.sha.slice(0, 8)}`,
        label: batches.length > 1 ? `review-${input.review}-batch-${index + 1}` : `review-${input.review}`,
        worktree: input.frames.dir,
        promptRoot: deps.promptRoot,
        prompt: reviewPrompt({ card, sha: input.sha, gateUrl: input.gateUrl, review: input.review, frames: shown, batch: { index: index + 1, count: batches.length }, rubric }, deps.session.typed),
        schema: 'visual-verdict',
        budgetUsd: left,
        cardId: card.id,
        files,
        repoSha: null,
        onSpend: (usd) => input.onSpend?.(base + usd),
      },
      { ...deps.session, db: deps.db, scripts: false },
    );
    spentBefore = Math.round((spentBefore + result.usd) * 10_000) / 10_000;
    if (!result.ok) {
      if (stopSignal.aborted) return { kind: 'stopped' };
      return { kind: 'failed', reason: `the ${name}'s review session failed: ${result.reason}`, ...(result.refusal ? { refusal: result.refusal } : {}) };
    }
    const unknown = unknownFrames(result.value, batch);
    if (unknown.length > 0) return { kind: 'failed', reason: `the verdict names frames it was not shown: ${unknown.join(', ')}` };
    verdicts.push(result.value);
    refs.push(result.ref);
  }
  return { kind: 'verdict', verdict: combineVerdicts(verdicts), ref: refs.join('+'), refs, director };
}
