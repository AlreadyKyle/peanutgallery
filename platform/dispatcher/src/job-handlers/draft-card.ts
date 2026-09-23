// draft_card, the board's Draft a game card (docs/specs/agent-workflows.md). Up to three rounds:
// a fresh attended Game Designer session drafts one new seed-1 card (given the previous draft and
// why it was refused or sent back), record_card_draft keeps it privately, the dispatcher's checks
// run (draft-checks.ts), and a draft that passes goes to a separate Game Director session with
// rubrics/draft-game.md. Approved inserts the card through approve_card_draft; revise starts the
// next round; flagged, or a third round without approval, withdraws the draft with its reason
// codes and writes no card. The Designer's typed input is {} or studio-reports' {floor, open_cards};
// every card it and the Director see passes the typed reduction. A failed model call, or a
// Director answer that is not one valid verdict, fails the run and writes no card.
import { checkDraft, seedExecutor, SEED_WRITERS, type CardDraft, type DraftCheckName } from '../draft-checks.js';
import type { DraftFields, Role } from '../db.js';
import type { JobHandler } from '../jobs.js';
import { runRoleSession, type RoleSessionResult } from '../role-session.js';
import { schemaRepoPath, type TypedOutput } from '../typed-output.js';
import { requireWorkflow, sessionDeps, typedCard, type TypedCard } from './workflow.js';

export const MAX_ROUNDS = 3;
export const GRADER_ROLE = 'Game Director';

export interface DraftVerdict {
  result: 'approved' | 'revise' | 'flagged';
  reason_codes: string[];
  note?: string;
}

// The floor context studio-reports passes: a count, or named counts.
export type Floor = number | Record<string, number>;
export interface DraftInput {
  floor: Floor | null;
  // The open cards the run names, by id; null for every open card.
  openCardIds: string[] | null;
}

// The run's typed input: {} or {floor, open_cards}. Anything else fails the run.
export function parseDraftInput(input: Record<string, unknown>): DraftInput {
  const keys = Object.keys(input);
  const unknown = keys.filter((key) => key !== 'floor' && key !== 'open_cards');
  if (unknown.length > 0) throw new Error(`draft_card takes {} or {floor, open_cards}, not ${unknown.join(', ')}`);
  let floor: Floor | null = null;
  if (input.floor !== undefined) {
    const value = input.floor;
    const counts = typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((n) => typeof n === 'number' && Number.isFinite(n));
    if (!(typeof value === 'number' && Number.isFinite(value)) && !counts) throw new Error('draft_card floor must be a number or named numbers');
    floor = value as Floor;
  }
  let openCardIds: string[] | null = null;
  if (input.open_cards !== undefined) {
    if (!Array.isArray(input.open_cards)) throw new Error('draft_card open_cards must be a list');
    openCardIds = input.open_cards.map((entry) => {
      const id = typeof entry === 'string' ? entry : typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string' ? (entry as { id: string }).id : null;
      if (id === null) throw new Error('draft_card open_cards holds card ids');
      return id;
    });
  }
  return { floor, openCardIds };
}

// Why the last round came back, for the next Designer session.
type Feedback =
  | { kind: 'refused'; check: DraftCheckName; detail: string; draft: unknown }
  | { kind: 'revise'; reason_codes: string[]; note: string | null; draft: CardDraft };

export interface RoundRecord {
  round: number;
  draft_id: string | null;
  draft: Pick<CardDraft, 'title' | 'summary' | 'lane' | 'executor' | 'estimate_usd'> | null;
  check: { name: DraftCheckName; detail: string } | null;
  verdict: DraftVerdict | null;
}

export interface DesignerContext {
  runId: string;
  round: number;
  floor: Floor | null;
  openCards: readonly TypedCard[];
  executors: readonly string[];
  cardMaxUsd: number;
  feedback: Feedback | null;
}

export function designerPrompt(context: DesignerContext, typed: TypedOutput): string {
  const lines = [
    `Draft a game card (job run ${context.runId}, round ${context.round} of ${MAX_ROUNDS}).`,
    '',
    'Draft one new seed-1 game card: one small change to Dust that a player sees, with check: lines that are false on main today and true once it is built.',
    '',
    'The cards already open, as typed fields; do not draft a copy of one. A card whose source is community carries no text.',
    JSON.stringify(context.openCards, null, 2),
  ];
  if (context.floor !== null) lines.push('', `The floor: ${JSON.stringify(context.floor)}.`);
  lines.push(
    '',
    `Executors: ${context.executors.join(', ')}. Name one of them as the executor.`,
    `The estimate is also the funding target, at most $${context.cardMaxUsd}: five times the highest measured cost for the lane, rounded up to the next 50 cents, which is $0.50 for a config card and $1.50 for a code card.`,
  );
  if (context.feedback?.kind === 'refused') {
    lines.push('', `Your last draft was refused by the ${context.feedback.check} check: ${context.feedback.detail}`, 'It was:', JSON.stringify(context.feedback.draft, null, 2));
  } else if (context.feedback?.kind === 'revise') {
    lines.push(
      '',
      `The Game Director sent your last draft back to revise: ${context.feedback.reason_codes.join(', ')}.`,
      ...(context.feedback.note ? [`Note: ${context.feedback.note}`] : []),
      'It was:',
      JSON.stringify(context.feedback.draft, null, 2),
    );
  }
  lines.push('', `Answer with one JSON object valid against ${schemaRepoPath('card-draft')} and nothing else:`, typed.schemaText('card-draft'));
  return lines.join('\n');
}

export function directorPrompt(runId: string, round: number, draft: CardDraft, openCards: readonly TypedCard[], rubric: string, typed: TypedOutput): string {
  return [
    `Grade a game card draft (job run ${runId}, round ${round} of ${MAX_ROUNDS}). The Game Designer made it in another session; it has passed the dispatcher's checks.`,
    '',
    'The draft:',
    JSON.stringify(draft, null, 2),
    '',
    'The cards already open, as typed fields. A card whose source is community carries no text.',
    JSON.stringify(openCards, null, 2),
    '',
    rubric.trim(),
    '',
    `Answer with one JSON object valid against ${schemaRepoPath('draft-verdict')} and nothing else:`,
    typed.schemaText('draft-verdict'),
  ].join('\n');
}

function summary(draft: CardDraft): RoundRecord['draft'] {
  return { title: draft.title, summary: draft.summary, lane: draft.lane, executor: draft.executor, estimate_usd: draft.estimate_usd };
}

export const draftCard: JobHandler = async (context) => {
  const workflow = requireWorkflow(context);
  const designer = context.role!;
  const input = parseDraftInput(context.run.input);
  const [studio, roles, open] = await Promise.all([context.db.getStudioState(), context.db.listActiveRoles(), context.db.openCards()]);
  const director: Role | undefined = roles.find((role) => role.name === GRADER_ROLE);
  if (!director) throw new Error('the Game Director is not an active role');
  if (director.paused) throw new Error('the Game Director is paused');
  if (director.id === designer.id) throw new Error('the grader cannot be the maker');
  const named = input.openCardIds === null ? open : open.filter((card) => input.openCardIds!.includes(card.id));
  const openCards = named.map(typedCard);
  const executors = SEED_WRITERS.filter((name) => seedExecutor(name, roles) !== null);
  const rubric = await workflow.rubric();
  const deps = sessionDeps(context, workflow);
  const rounds: RoundRecord[] = [];
  let feedback: Feedback | null = null;

  const workspace = await workflow.openWorkspace(context.run.id);
  try {
    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      const made: RoleSessionResult<CardDraft> = await runRoleSession<CardDraft>(
        {
          role: designer,
          runId: context.run.id,
          label: `designer-${round}`,
          worktree: workspace.path,
          prompt: designerPrompt({ runId: context.run.id, round, floor: input.floor, openCards, executors, cardMaxUsd: studio.card_max_usd, feedback }, workflow.typed),
          schema: 'card-draft',
          budgetUsd: studio.card_max_usd,
        },
        deps,
      );
      if (!made.ok) {
        // An answer that is not one valid draft is the schema check's refusal; any other failure is
        // the session's and fails the run.
        if (!made.invalidOutput) throw new Error(`the Game Designer's session failed: ${made.reason}`);
        rounds.push({ round, draft_id: null, draft: null, check: { name: 'schema', detail: made.reason }, verdict: null });
        feedback = { kind: 'refused', check: 'schema', detail: made.reason, draft: null };
        continue;
      }
      const draft: CardDraft = made.value;
      const executor = seedExecutor(draft.executor, roles);
      const fields: DraftFields = {
        title: draft.title,
        summary: draft.summary,
        intent: draft.intent,
        acceptance_test: draft.acceptance_test,
        lane: draft.lane,
        executor_role_id: executor?.id ?? null,
        estimate_usd: draft.estimate_usd,
      };
      const recorded = await context.db.recordCardDraft(context.run.id, designer.id, fields, made.ref);
      const checked = await checkDraft(draft, { readMain: (file) => workspace.readMain(file), scanText: workflow.scanText, cardMaxUsd: studio.card_max_usd, roles });
      if (!checked.ok) {
        await context.db.withdrawCardDraft(recorded.id, [`check_${checked.check}`]);
        rounds.push({ round, draft_id: recorded.id, draft: summary(draft), check: { name: checked.check, detail: checked.detail }, verdict: null });
        feedback = { kind: 'refused', check: checked.check, detail: checked.detail, draft };
        continue;
      }
      const graded: RoleSessionResult<DraftVerdict> = await runRoleSession<DraftVerdict>(
        {
          role: director,
          runId: context.run.id,
          label: `director-${round}`,
          worktree: workspace.path,
          prompt: directorPrompt(context.run.id, round, draft, openCards, rubric, workflow.typed),
          schema: 'draft-verdict',
          budgetUsd: studio.card_max_usd,
        },
        deps,
      );
      if (!graded.ok) {
        await context.db.withdrawCardDraft(recorded.id, ['grade_failed']);
        throw new Error(`the Game Director's session failed: ${graded.reason}`);
      }
      if (graded.ref === made.ref) throw new Error('the grader session is the maker session');
      const verdict: DraftVerdict = graded.value;
      rounds.push({ round, draft_id: recorded.id, draft: summary(draft), check: null, verdict });
      if (verdict.result === 'approved') {
        const cardId = await context.db.approveCardDraft(recorded.id, director.id, graded.ref, { result: verdict.result, reason_codes: verdict.reason_codes, round });
        return { result: 'approved', card_id: cardId, draft_id: recorded.id, base_sha: workspace.baseSha, rounds };
      }
      await context.db.withdrawCardDraft(recorded.id, verdict.reason_codes);
      if (verdict.result === 'flagged') return { result: 'withdrawn', reason: 'flagged', reason_codes: verdict.reason_codes, base_sha: workspace.baseSha, rounds };
      feedback = { kind: 'revise', reason_codes: verdict.reason_codes, note: verdict.note ?? null, draft };
    }
    if (rounds.every((record) => record.draft_id === null)) throw new Error(`no valid draft in ${MAX_ROUNDS} rounds`);
    return { result: 'withdrawn', reason: 'no_approval_in_three_rounds', base_sha: workspace.baseSha, rounds };
  } finally {
    await workspace.close();
  }
};
