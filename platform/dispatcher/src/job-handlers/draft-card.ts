// draft_card: the card supply refills itself (docs/specs/unattended-roles.md PR4, PLAN.md §10
// decision 66; the rounds are docs/specs/agent-workflows.md's). enqueue_supply_draft queues a run
// while the supply is short; the board may still queue one. Before any session, open_draft_card
// opens the card the run is billed to: the next seed-1 backlog card (kind backlog), or a new private
// seed-1 card (kind new). Up to three rounds then:
// - a fresh Game Designer session fills that card (given the previous draft and why it was refused or
//   sent back): a backlog card keeps the board's title and summary and gains an intent, check: lines,
//   a lane, an executor and one estimate; a new card gets all seven. record_card_draft_for keeps the
//   draft privately against the card, and the dispatcher's checks run (draft-checks.ts);
// - a draft that passes goes to a separate Game Director session with rubrics/draft-game.md.
//   Approved writes the draft onto the card through approve_card_draft, which records the draft
//   approval, so deal_due_cards deals it after the cooling window and the waterfall funds it; revise
//   starts the next round; flagged, or a third round without approval, withdraws the draft, leaves a
//   backlog card as it was and rejects a new card (failing_check draft_withdrawn), its spend kept.
// Every session is an unattended Managed Agents reader (Read, Glob and Grep, main mounted read-only)
// on the card sessions' adapter, studio-billed to that card with its role, never the founder's plan;
// an attended process refuses the run before it opens a card. Each session's budget is
// DRAFT_SESSION_MAX_USD, no more than the per-card maximum leaves on the card, and it starts only when
// the throttle's money covers it (the balance after every other card's hold, the daily, monthly and
// tier caps); while it runs, what it may still spend is held from the card path. A studio pause stops
// it; the API refusing the studio key pauses the studio as a card session's refusal does.
// The typed input is {} or {floor, open_cards}; every card the sessions see passes the typed
// reduction. A failed model call, a money stop or a Director answer that is not one valid verdict
// fails the run and writes nothing onto the card; a new card it opened is reused by the next run.
import { REPO_MOUNT } from '../adapters/managed.js';
import { DRAFT_SESSION_MIN_USD } from '../config.js';
import type { SpendRefusal } from '../credit.js';
import { checkDraft, seedExecutor, SEED_WRITERS, type CardDraft, type DraftCheckName } from '../draft-checks.js';
import type { Card, DraftFields, DraftTarget, Role } from '../db.js';
import type { JobContext, JobHandler } from '../jobs.js';
import { errorMessage } from '../log.js';
import { round4 } from '../pricing.js';
import { runRoleSession, type RoleSessionRequest, type RoleSessionResult } from '../role-session.js';
import { moneyBounds } from '../throttle.js';
import { schemaRepoPath, type TypedOutput } from '../typed-output.js';
import { shortId } from '../worktree.js';
import { requireWorkflow, sessionDeps, typedCard, type TypedCard, type WorkflowDeps } from './workflow.js';

export const MAX_ROUNDS = 3;
export const GRADER_ROLE = 'Game Director';

export interface DraftVerdict {
  result: 'approved' | 'revise' | 'flagged';
  reason_codes: string[];
  note?: string;
}

// The floor context: a count, or named numbers. enqueue_supply_draft (and the board's old Draft to
// the floor) send {short_open, short_big, short_small, big_min_usd, small_max_usd}: the shortfalls and
// the sizes they ask for, which designerPrompt spells out.
export type Floor = number | Record<string, number>;

const FLOOR_KEYS = ['short_open', 'short_big', 'short_small', 'big_min_usd', 'small_max_usd'] as const;
type SupplyFloor = Record<(typeof FLOOR_KEYS)[number], number>;

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function cards(n: number, what: string): string {
  return `${n} ${what}${n === 1 ? '' : 's'}`;
}

// What the floor asks the Designer for. The shortfalls become one line each, with the target each
// size needs: a big card's target is at least big_min_usd (a bigger change, never a padded target), a
// small card's is under small_max_usd. Any other floor is shown as given.
export function floorLines(floor: Floor, cardMaxUsd: number): string[] {
  const named = typeof floor === 'object' && FLOOR_KEYS.every((key) => typeof floor[key] === 'number');
  if (!named) return [`The floor: ${JSON.stringify(floor)}.`];
  const f = floor as SupplyFloor;
  const asks: string[] = [];
  if (f.short_big > 0) {
    asks.push(
      f.big_min_usd > cardMaxUsd
        ? `- ${cards(f.short_big, 'big card')}, with a target of at least ${usd(f.big_min_usd)}: no draft can fill this, since the per-card maximum is ${usd(cardMaxUsd)}. Fill another shortfall.`
        : `- ${cards(f.short_big, 'big card')}: a target of at least ${usd(f.big_min_usd)} and at most ${usd(cardMaxUsd)}. By the five-times rule that is a bigger change, with an expected cost of at least ${usd(f.big_min_usd / 5)}, still one mechanic, number or piece of content. Never pad a smaller change's target to reach it.`,
    );
  }
  if (f.short_small > 0) asks.push(`- ${cards(f.short_small, 'small card')}: a target under ${usd(f.small_max_usd)}.`);
  if (f.short_open > 0) asks.push(`- ${cards(f.short_open, 'more open card')}, of any size.`);
  if (asks.length === 0) return ['The open cards meet the board\'s floor.'];
  return ["The open cards are short of the board's floor. Draft one card that fills one of these shortfalls:", ...asks];
}
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

// The card a run fills, as the prompts show it: a backlog card with the board's own title, summary
// and intent, or a new card with none yet.
export type TargetContext =
  | { kind: 'backlog'; id: string; horizon: string; rank: number | null; title: string; summary: string; intent: string | null }
  | { kind: 'new'; id: string };

// Where a managed session reads the repository: main, mounted read-only at REPO_MOUNT.
export interface RepoContext {
  mount: string;
  sha: string;
}

export interface DesignerContext {
  runId: string;
  round: number;
  target: TargetContext;
  repo: RepoContext | null;
  budgetUsd: number;
  floor: Floor | null;
  openCards: readonly TypedCard[];
  executors: readonly string[];
  cardMaxUsd: number;
  feedback: Feedback | null;
}

function repoLine(repo: RepoContext | null): string[] {
  return repo ? ['', `The repository is checked out read-only at ${repo.mount}, at main's commit ${repo.sha}. Read seed-1's config and code there.`] : [];
}

function targetLines(target: TargetContext): string[] {
  if (target.kind === 'new') {
    return [
      'Draft one new seed-1 game card: one small change to Dust that a player sees, with check: lines that are false on main today and true once it is built.',
      `It fills card ${target.id}, which the dispatcher opened for this draft; it stays private until it is approved.`,
    ];
  }
  return [
    `Fill card ${target.id}, a seed-1 card on the board's backlog (horizon ${target.horizon}, rank ${target.rank ?? 'none'}): one small change to Dust that a player sees, with check: lines that are false on main today and true once it is built.`,
    "Its title and summary are the board's: answer with both exactly as they are. Write its intent, its check: lines, its lane, its executor and one estimate for the change the board describes:",
    JSON.stringify({ title: target.title, summary: target.summary, intent: target.intent }, null, 2),
  ];
}

export function designerPrompt(context: DesignerContext, typed: TypedOutput): string {
  const lines = [
    `Draft a game card (job run ${context.runId}, round ${context.round} of ${MAX_ROUNDS}).`,
    '',
    ...targetLines(context.target),
    `Every turn of this session is billed to that card at list price, within a budget of ${usd(context.budgetUsd)}: a short, direct session is the way to stay inside it.`,
    ...repoLine(context.repo),
    '',
    'The cards already open, as typed fields; do not draft a copy of one. A card whose source is community carries no text.',
    JSON.stringify(context.openCards, null, 2),
  ];
  if (context.floor !== null) lines.push('', ...floorLines(context.floor, context.cardMaxUsd));
  lines.push(
    '',
    `Executors: ${context.executors.join(', ')}. Name one of them as the executor.`,
    `The estimate is also the funding target, at most $${context.cardMaxUsd}: five times the change's expected cost, rounded up to the next 50 cents. At the measured costs a change the size of the launch cards is $0.50 for a config card and $1.50 for a code card; a bigger change costs more, so its estimate is higher, and no estimate is padded to reach a figure.`,
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

export function directorPrompt(
  runId: string,
  round: number,
  draft: CardDraft,
  openCards: readonly TypedCard[],
  rubric: string,
  typed: TypedOutput,
  target: TargetContext | null = null,
  repo: RepoContext | null = null,
): string {
  const fills =
    target === null
      ? []
      : [
          target.kind === 'backlog'
            ? `It fills card ${target.id}, a seed-1 card on the board's backlog, whose title and summary are the board's.`
            : `It fills card ${target.id}, a new seed-1 card opened for this draft and private until it is approved.`,
        ];
  return [
    `Grade a game card draft (job run ${runId}, round ${round} of ${MAX_ROUNDS}). The Game Designer made it in another session; it has passed the dispatcher's checks.`,
    ...fills,
    ...repoLine(repo),
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

// A session that may not start, and why: the studio paused, the per-card maximum spent, or the
// throttle's money short of its budget. The run fails with the reason; nothing is spent.
export class DraftStop extends Error {
  readonly reason: string;
  constructor(reason: string, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = 'DraftStop';
    this.reason = reason;
  }
}

// What the next session on the card may spend: DRAFT_SESSION_MAX_USD, no more than the per-card
// maximum leaves after the card's studio spend so far (earlier rounds included), and only when the
// throttle's money covers all of it.
export async function draftSessionBudget(context: JobContext, workflow: WorkflowDeps, card: Pick<Card, 'id' | 'funded_usd' | 'severity'>): Promise<number> {
  const [studio, spentMap] = await Promise.all([context.db.getStudioState(), context.db.cardSpend([card.id])]);
  if (studio.paused) throw new DraftStop('studio_paused', 'the studio is paused, so no draft session starts');
  const spent = spentMap.get(card.id) ?? 0;
  const room = round4(studio.card_max_usd - spent);
  const budget = round4(Math.min(workflow.draftSessionMaxUsd, room));
  if (budget < DRAFT_SESSION_MIN_USD) {
    throw new DraftStop('card_max', `card ${shortId(card.id)} has spent ${spent} USD of the per-card maximum ${studio.card_max_usd} USD, too little left for a draft session`);
  }
  if (workflow.money) {
    const state = await workflow.money();
    const bounds = moneyBounds(state, { id: card.id, stage: 'proposed', estimate_usd: 0, actual_usd: spent, funded_usd: card.funded_usd, severity: card.severity });
    const short: Array<[string, number]> = [
      ['daily_cap', bounds.dailyUsd],
      ['monthly_cap', bounds.monthlyUsd],
      ['tier_cap', bounds.tierUsd],
      ['insufficient_balance', bounds.availableUsd],
    ];
    const stopped = short.find(([, left]) => left < budget);
    if (stopped) throw new DraftStop(stopped[0], `a draft session's budget of ${budget} USD is more than the ${stopped[1]} USD left`);
  }
  return budget;
}

// The API refused the studio key: every session after this one would fail the same way, so the studio
// pauses as a card session's refusal pauses it (pipeline.ts), and the board hears.
async function pauseForRefusal(context: JobContext, refusal: SpendRefusal, cardId: string): Promise<void> {
  const reason = refusal === 'credit' ? 'awaiting_credit' : 'spend_limit';
  const what = refusal === 'credit' ? 'Console credit needed' : 'usage tier cap reached';
  let unpaused: string | null = null;
  try {
    await context.db.pauseStudio(`dispatcher: ${what} (draft of card ${shortId(cardId)})`, context.now(), reason);
  } catch (error) {
    unpaused = errorMessage(error);
  }
  await context.alert.notify(
    `${refusal === 'credit' ? 'Console credit needed' : 'Usage tier cap reached'}: the draft of card ${shortId(cardId)} stopped because the API refused the studio key. ${
      unpaused ? `The studio could not be paused (${unpaused}); pause it from /board.` : 'The studio is paused.'
    }`,
  );
}

export const draftCard: JobHandler = async (context) => {
  const workflow = requireWorkflow(context);
  const designer = context.role!;
  const input = parseDraftInput(context.run.input);
  const managed = workflow.adapter.mode === 'unattended';
  if (!managed && !workflow.allowAttended) {
    throw new Error('draft_card runs only unattended, on the managed adapter and billed to the card it drafts; this process is attended');
  }
  const [studio, roles, open] = await Promise.all([context.db.getStudioState(), context.db.listActiveRoles(), context.db.openCards()]);
  const director: Role | undefined = roles.find((role) => role.name === GRADER_ROLE);
  if (!director) throw new Error('the Game Director is not an active role');
  if (director.paused) throw new Error('the Game Director is paused');
  if (director.id === designer.id) throw new Error('the grader cannot be the maker');

  // The card every row of the draft names, opened before any session starts.
  const opened: DraftTarget = await context.db.openDraftCard(context.run.id);
  const card = { id: opened.cardId, funded_usd: opened.card.funded_usd, severity: opened.card.severity };
  const target: TargetContext =
    opened.kind === 'backlog'
      ? { kind: 'backlog', id: card.id, horizon: opened.card.horizon, rank: opened.card.rank, title: opened.card.title, summary: opened.card.summary ?? '', intent: opened.card.intent }
      : { kind: 'new', id: card.id };

  const named = input.openCardIds === null ? open : open.filter((row) => input.openCardIds!.includes(row.id));
  const openCards = named.filter((row) => row.id !== card.id).map(typedCard);
  const executors = SEED_WRITERS.filter((name) => seedExecutor(name, roles) !== null);
  const rubric = await workflow.rubric();
  const deps = sessionDeps(context, workflow);
  const rounds: RoundRecord[] = [];
  const about = { card_id: card.id, kind: opened.kind, opened: opened.opened };
  let feedback: Feedback | null = null;

  // One session billed to the card, its budget held from the card path while it runs.
  const session = async <T>(request: Omit<RoleSessionRequest, 'budgetUsd' | 'cardId' | 'onSpend'>, budgetUsd: number): Promise<RoleSessionResult<T>> => {
    workflow.jobBudgets?.start(card.id, budgetUsd);
    try {
      const result = await runRoleSession<T>({ ...request, budgetUsd, cardId: card.id, onSpend: (usd) => workflow.jobBudgets?.record(card.id, usd) }, deps);
      if (!result.ok && result.refusal) await pauseForRefusal(context, result.refusal, card.id);
      return result;
    } finally {
      workflow.jobBudgets?.finish(card.id);
    }
  };

  const workspace = await workflow.openWorkspace(context.run.id);
  // A managed session reads main mounted at REPO_MOUNT; the replay's attended session reads it in
  // the scratch checkout it runs in.
  const repo: RepoContext | null = managed ? { mount: REPO_MOUNT, sha: workspace.baseSha } : null;
  const repoSha = managed ? workspace.baseSha : null;
  try {
    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      const designerBudget = await draftSessionBudget(context, workflow, card);
      const made: RoleSessionResult<CardDraft> = await session<CardDraft>(
        {
          role: designer,
          runId: context.run.id,
          label: `designer-${round}`,
          worktree: workspace.path,
          prompt: designerPrompt({ runId: context.run.id, round, target, repo, budgetUsd: designerBudget, floor: input.floor, openCards, executors, cardMaxUsd: studio.card_max_usd, feedback }, workflow.typed),
          schema: 'card-draft',
          repoSha,
        },
        designerBudget,
      );
      if (!made.ok) {
        // An answer that is not one valid draft is the schema check's refusal; any other failure is
        // the session's and fails the run.
        if (!made.invalidOutput) throw new Error(`the Game Designer's session failed: ${made.reason}`);
        rounds.push({ round, draft_id: null, draft: null, check: { name: 'schema', detail: made.reason }, verdict: null });
        feedback = { kind: 'refused', check: 'schema', detail: made.reason, draft: null };
        continue;
      }
      // A backlog card keeps the board's title and summary, whatever the Designer answered.
      const draft: CardDraft = target.kind === 'backlog' ? { ...made.value, title: target.title, summary: target.summary } : made.value;
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
      const recorded = await context.db.recordCardDraft(card.id, context.run.id, designer.id, fields, made.ref);
      const checked = await checkDraft(draft, { readMain: (file) => workspace.readMain(file), scanText: workflow.scanText, cardMaxUsd: studio.card_max_usd, roles });
      if (!checked.ok) {
        await context.db.withdrawCardDraft(recorded.id, [`check_${checked.check}`]);
        rounds.push({ round, draft_id: recorded.id, draft: summary(draft), check: { name: checked.check, detail: checked.detail }, verdict: null });
        feedback = { kind: 'refused', check: checked.check, detail: checked.detail, draft };
        continue;
      }
      let directorBudget: number;
      try {
        directorBudget = await draftSessionBudget(context, workflow, card);
      } catch (error) {
        if (error instanceof DraftStop) await context.db.withdrawCardDraft(recorded.id, [`stopped_${error.reason}`]);
        throw error;
      }
      const graded: RoleSessionResult<DraftVerdict> = await session<DraftVerdict>(
        {
          role: director,
          runId: context.run.id,
          label: `director-${round}`,
          worktree: workspace.path,
          prompt: directorPrompt(context.run.id, round, draft, openCards, rubric, workflow.typed, target, repo),
          schema: 'draft-verdict',
          repoSha,
        },
        directorBudget,
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
        return { result: 'approved', ...about, card_id: cardId, draft_id: recorded.id, base_sha: workspace.baseSha, rounds };
      }
      await context.db.withdrawCardDraft(recorded.id, verdict.reason_codes);
      if (verdict.result === 'flagged') {
        return { result: 'withdrawn', reason: 'flagged', reason_codes: verdict.reason_codes, ...about, card_rejected: await withdrawn(context, opened), base_sha: workspace.baseSha, rounds };
      }
      feedback = { kind: 'revise', reason_codes: verdict.reason_codes, note: verdict.note ?? null, draft };
    }
    const reason = rounds.every((record) => record.draft_id === null) ? 'no_valid_draft_in_three_rounds' : 'no_approval_in_three_rounds';
    return { result: 'withdrawn', reason, ...about, card_rejected: await withdrawn(context, opened), base_sha: workspace.baseSha, rounds };
  } finally {
    await workspace.close();
  }
};

// A withdrawn draft rejects the new card its run opened (failing_check draft_withdrawn, its spend kept
// on the ledger) and leaves a backlog card as it was. Whether a card was rejected.
async function withdrawn(context: JobContext, opened: DraftTarget): Promise<boolean> {
  if (opened.kind !== 'new') return false;
  await context.db.rejectDraftCard(opened.cardId, context.run.id);
  return true;
}
