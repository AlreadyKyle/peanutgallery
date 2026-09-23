import type { SupabaseClient } from '@supabase/supabase-js';
import { toNumber } from './format';

// Every board RPC the board's own site calls (docs/specs/board-site.md). This app is kernel: no card
// may change a file under platform/board, and nothing here imports from the public site.

/** When a card is meant to be built: now (open to funding and the agents), next or later (the roadmap). */
export type Horizon = 'now' | 'next' | 'later';

/** The public_roles columns the board reads to offer a card's executor. */
export type Role = {
  id: string;
  title: string;
  write_access: boolean;
  state: string;
};

// Mirrors the dispatcher default for BOARD_SESSION_TTL_MIN (platform/dispatcher/src/config.ts).
// The dispatcher judges the session from board_members.last_seen_at with this window; change both together.
export const BOARD_SESSION_TTL_MIN = 3;
export const HEARTBEAT_MS = 60_000;
export const STUDIO_STATE_POLL_MS = 15_000;
// A dispatcher heartbeat older than this counts as not running.
export const DISPATCHER_STALE_MS = 3 * 60_000;

export type BoardRole = 'board' | 'moderator';

export type Directive = {
  bucket: string;
  lane: string;
  folder: string;
  title: string;
  intent: string;
  acceptance_test: string;
  estimate_usd: number;
  board_reason: string;
  executor_role_id: string;
};

export type NextCardStage = 'proposed' | 'voted';

export type NextCard = {
  bucket: string;
  lane: string;
  folder: string;
  title: string;
  summary: string;
  intent: string;
  acceptance_test: string;
  funding_target_usd: number;
  stage: NextCardStage;
  executor_role_id: string;
  board_reason: string;
  horizon: Horizon;
};

export type BoardStudioState = {
  paused: boolean;
  paused_by: string | null;
  paused_at: string | null;
  agent_mode: string;
  launched_at: string | null;
  dispatcher_seen_at: string | null;
  daily_cap_usd: number;
  card_max_usd: number;
  /** The caps set_caps also sets; null when board_studio_state does not return them. */
  agent_hourly_rate_usd: number | null;
  monthly_cap_usd: number | null;
  credit_studio_daily_cap_usd: number | null;
  /** The monthly cap of the studio's Anthropic usage tier; null when unset, which adds no bound. */
  anthropic_tier_cap_usd: number | null;
  /** Whether the platform code lane is open (studio_state.platform_lane_open); false until the board site is live. */
  platform_lane_open: boolean;
  /**
   * How long an approved agent card waits on next before the tick deals it to now, in minutes (0 to
   * 10,080; docs/specs/agent-system-core.md). 0 when board_studio_state does not return it.
   */
  cooling_window_minutes: number;
};

/**
 * Every value set_caps takes, in US dollars. The database checks the bounds. The usage tier cap may
 * be null, which removes it: the throttle then adds no tier bound.
 */
export type Caps = {
  daily_cap_usd: number;
  card_max_usd: number;
  agent_hourly_rate_usd: number;
  monthly_cap_usd: number;
  credit_studio_daily_cap_usd: number;
  anthropic_tier_cap_usd: number | null;
};

/** A card as /board lists it for the horizon, rank, target, cancel and resume controls. */
export type BoardCard = {
  id: string;
  title: string;
  stage: string;
  horizon: Horizon;
  rank: number | null;
  folder: string;
  lane: string;
  funding_target_usd: number;
  funded_usd: number;
  estimate_usd: number;
  created_at: string;
  source: string;
  /** docs/specs/agent-system-core.md: the drafting role, when an agent drafted it. */
  drafter_role_id: string | null;
  /** When an approved agent card is dealt to now: its approval plus the cooling window. */
  opens_at: string | null;
  board_vetoed: boolean;
  board_veto_reason: string | null;
  /**
   * none: the board filed it, so it needs no approval. current: an agent wrote it and its approval is
   * current. missing: an agent wrote it and it has no current approval, so the public does not see it,
   * no session runs it and it takes no money.
   */
  approval: 'none' | 'current' | 'missing';
};

/** The stages /board lists: every card the board can still move, cancel or resume. */
export const BOARD_CARD_STAGES = ['proposed', 'designing', 'voted', 'funded', 'paused'] as const;
/** The stages set_card_horizon accepts: a card still open for funding. A funded or paused card can only be cancelled or resumed. */
export const HORIZON_STAGES: readonly string[] = ['proposed', 'designing', 'voted'];

/**
 * Whether saving this horizon moves the card to now. Only that move takes a funding target:
 * set_card_horizon refuses card fields on any other save, a card already on now included.
 */
export function movesToNow(card: { horizon: Horizon }, horizon: Horizon): boolean {
  return horizon === 'now' && card.horizon !== 'now';
}
export const BOARD_CARD_COLUMNS =
  'id,title,stage,horizon,rank,folder,lane,funding_target_usd,funded_usd,estimate_usd,created_at,source,drafter_role_id,opens_at,board_vetoed,board_veto_reason';

/** An agent wrote some of the card: it needs an approval (card_needs_approval). */
export function agentWritten(card: Pick<BoardCard, 'source' | 'drafter_role_id'>): boolean {
  return card.source === 'agent' || card.drafter_role_id !== null;
}

/** An approved agent card on the roadmap that the tick deals to now at opens_at. */
export function undealt(card: Pick<BoardCard, 'approval' | 'horizon' | 'opens_at' | 'stage'>): boolean {
  return card.approval === 'current' && card.horizon !== 'now' && card.opens_at !== null && card.stage === 'proposed';
}

/** set_card_veto takes a proposed, designing or voted card; a card holding money is cancelled instead. */
export function canVeto(card: Pick<BoardCard, 'stage' | 'board_vetoed' | 'funded_usd'>): boolean {
  return HORIZON_STAGES.includes(card.stage) && !card.board_vetoed && card.funded_usd === 0;
}

export function canUnveto(card: Pick<BoardCard, 'stage' | 'board_vetoed'>): boolean {
  return HORIZON_STAGES.includes(card.stage) && card.board_vetoed;
}

/**
 * The roles that build cards, and the folder each builds in. Only these are offered as a card's
 * executor. The Studio Head, the Game Designer and the Game Director run the board's Rank now and
 * Draft a game card (JOB_BUTTONS) and build no card; the rest of the roster has no job that runs
 * yet: note triage, the report, the stream and outside research are backlog cards.
 */
export const CARD_ROLE_FOLDERS: Readonly<Record<string, string>> = {
  'Builder A': 'seed-1',
  'Builder B': 'seed-1',
  QA: 'seed-1',
  'Platform Builder': 'platform',
};

/** An active role that builds cards, whether or not its folder is open: the board's executor list. */
export function isCardRole(role: Role): boolean {
  return role.state === 'active' && role.write_access && Object.hasOwn(CARD_ROLE_FOLDERS, role.title);
}

/** The folder a card role changes, or null for a role that builds no cards. */
export function cardRoleFolder(role: Role): string | null {
  return isCardRole(role) ? (CARD_ROLE_FOLDERS[role.title] ?? null) : null;
}

/** The public_roles columns fetchCardRoles reads. */
export const ROLE_COLUMNS = 'id,title,write_access,state';

/** The active roles that build cards, in title order: the executors the card and directive forms offer. */
export async function fetchCardRoles(client: SupabaseClient): Promise<Role[]> {
  const rows = unwrap(await client.from('public_roles').select(ROLE_COLUMNS).returns<Record<string, unknown>[]>());
  return (rows ?? [])
    .map((row) => ({ id: String(row.id), title: String(row.title), write_access: row.write_access === true, state: String(row.state) }))
    .filter(isCardRole)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export const buckets = ['game', 'platform', 'qa', 'studio', 'budget', 'agents'] as const;
export const lanes = ['config', 'code'] as const;
export const folders = ['seed-1', 'platform'] as const;
export const cardStages = [
  { value: 'proposed', label: 'Open for funding' },
  { value: 'voted', label: 'Picked by the board' },
] as const satisfies readonly { value: NextCardStage; label: string }[];
export const horizons = [
  { value: 'now', label: 'Now: open to funding and the agents' },
  { value: 'next', label: 'Next: on the roadmap' },
  { value: 'later', label: 'Later: on the roadmap' },
] as const satisfies readonly { value: Horizon; label: string }[];
export const agentModes = ['attended', 'unattended'] as const;
export type AgentMode = (typeof agentModes)[number];

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T | null {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/**
 * Sends a sign-in link back to this site. shouldCreateUser is false: the seed creates each board
 * member's user through the admin API, sign-ups are off in Supabase Auth, and the board_members
 * trigger refuses any other address, so a link reaches existing board accounts only.
 */
export async function sendMagicLink(client: SupabaseClient, email: string): Promise<void> {
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: false },
  });
  if (error) throw new Error(error.message);
}

/** Where the signed-in session stands on the second factor the board RPCs require. */
export type TwoFactorState = {
  /** aal2 once a TOTP code has been verified in this session; aal1 after the magic link alone. */
  level: 'aal1' | 'aal2';
  /** The verified TOTP factor to challenge, or null when the account has none and must enrol. */
  verifiedFactorId: string | null;
};

export type TotpEnrolment = {
  factorId: string;
  /** An image URL (an SVG data URL from Supabase Auth) encoding the authenticator URI. */
  qrCode: string;
  secret: string;
};

export const TOTP_CODE = /^\d{6}$/;

function mfaResult<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error(`${what} returned nothing`);
  return result.data;
}

export async function twoFactorState(client: SupabaseClient): Promise<TwoFactorState> {
  const assurance = mfaResult(await client.auth.mfa.getAuthenticatorAssuranceLevel(), 'getAuthenticatorAssuranceLevel');
  const factors = mfaResult(await client.auth.mfa.listFactors(), 'listFactors');
  const verified = factors.totp.find((factor) => factor.status === 'verified');
  return {
    level: assurance.currentLevel === 'aal2' ? 'aal2' : 'aal1',
    verifiedFactorId: verified?.id ?? null,
  };
}

/** Starts TOTP enrolment, first removing unverified TOTP factors left by an abandoned attempt. */
export async function enrolTotp(client: SupabaseClient): Promise<TotpEnrolment> {
  const factors = mfaResult(await client.auth.mfa.listFactors(), 'listFactors');
  for (const factor of factors.all) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      mfaResult(await client.auth.mfa.unenroll({ factorId: factor.id }), 'unenroll');
    }
  }
  const enrolled = mfaResult(await client.auth.mfa.enroll({ factorType: 'totp' }), 'enroll');
  return { factorId: enrolled.id, qrCode: enrolled.totp.qr_code, secret: enrolled.totp.secret };
}

/** Challenges the factor and verifies the code; on success the session is aal2. */
export async function verifyTotp(client: SupabaseClient, factorId: string, code: string): Promise<void> {
  const challenge = mfaResult(await client.auth.mfa.challenge({ factorId }), 'challenge');
  mfaResult(await client.auth.mfa.verify({ factorId, challengeId: challenge.id, code }), 'verify');
}

export async function fetchBoardRole(client: SupabaseClient): Promise<BoardRole | null> {
  const role = unwrap<string>(await client.rpc('board_role'));
  return role === 'board' || role === 'moderator' ? role : null;
}

export async function heartbeat(client: SupabaseClient): Promise<Date> {
  const seen = unwrap<string>(await client.rpc('board_heartbeat'));
  const at = seen === null ? null : new Date(seen);
  if (at === null || !Number.isFinite(at.getTime())) {
    throw new Error('board_heartbeat returned no timestamp');
  }
  return at;
}

/**
 * Why the studio is paused (studio_state.pause_reason, docs/specs/money-logic.md), as the board
 * picks it. The public sees the reason and never who paused or when. board is the default.
 */
export const PAUSE_REASONS = [
  { value: 'board', label: 'Paused by the board' },
  { value: 'incident', label: 'A problem we are checking' },
  { value: 'awaiting_credit', label: "Waiting for a payout to buy the agents' credit" },
  { value: 'spend_limit', label: 'The monthly spend limit' },
] as const;

export type PauseReason = (typeof PAUSE_REASONS)[number]['value'];

/** set_paused: p_reason goes only with a pause that is not the default board one. */
export async function setPaused(client: SupabaseClient, paused: boolean, reason: PauseReason = 'board'): Promise<void> {
  const args: Record<string, unknown> = { p_paused: paused };
  if (paused && reason !== 'board') args.p_reason = reason;
  unwrap(await client.rpc('set_paused', args));
}

export async function fileDirective(client: SupabaseClient, d: Directive): Promise<string> {
  const id = unwrap<string>(
    await client.rpc('file_directive', {
      p_bucket: d.bucket,
      p_lane: d.lane,
      p_folder: d.folder,
      p_title: d.title,
      p_intent: d.intent,
      p_acceptance_test: d.acceptance_test,
      p_estimate_usd: d.estimate_usd,
      p_board_reason: d.board_reason,
      p_executor_role_id: d.executor_role_id,
    }),
  );
  if (id === null) throw new Error('file_directive returned no card id');
  return id;
}

export async function fileCard(client: SupabaseClient, card: NextCard): Promise<string> {
  const id = unwrap<string>(
    await client.rpc('file_card', {
      p_bucket: card.bucket,
      p_lane: card.lane,
      p_folder: card.folder,
      p_title: card.title,
      p_summary: card.summary,
      p_intent: card.intent,
      p_acceptance_test: card.acceptance_test,
      p_funding_target_usd: card.funding_target_usd,
      p_stage: card.stage,
      p_executor_role_id: card.executor_role_id,
      p_board_reason: card.board_reason,
      p_horizon: card.horizon,
    }),
  );
  if (id === null) throw new Error('file_card returned no card id');
  return id;
}

/**
 * Moves a card between horizons and sets its rank. Moving to now needs a funding target, and only
 * that move sends one (see movesToNow). The database refuses a card that does not meet the
 * definition of ready, a card that is no longer open for funding, or a card with money that would
 * leave now.
 */
export async function setCardHorizon(
  client: SupabaseClient,
  card: { id: string; horizon: Horizon; rank: number | null; target_usd: number | null; reason: string },
): Promise<void> {
  const args: Record<string, unknown> = {
    p_card: card.id,
    p_horizon: card.horizon,
    p_rank: card.rank,
    p_reason: card.reason,
  };
  if (card.target_usd !== null) args.p_target_usd = card.target_usd;
  unwrap(await client.rpc('set_card_horizon', args));
}

/**
 * Rejects a card with the board's reason. Only an open, funded or paused card can be cancelled. Its
 * unspent money moves at once to the next cards in line (docs/specs/money-logic.md); the result is
 * how much moved.
 */
export async function cancelCard(client: SupabaseClient, id: string, reason: string): Promise<number> {
  const result = unwrap<{ moved_usd?: unknown }>(await client.rpc('cancel_card', { p_card: id, p_reason: reason }));
  const moved = Number(result?.moved_usd ?? 0);
  return Number.isFinite(moved) ? moved : 0;
}

/** Moves a paused card back to funded with a new estimate of at least what it has already cost. */
export async function resumeCard(client: SupabaseClient, id: string, estimateUsd: number, reason: string): Promise<void> {
  unwrap(await client.rpc('resume_card', { p_card: id, p_estimate_usd: estimateUsd, p_reason: reason }));
}

/** set_caps: every cap at once. The usage tier cap is always sent, so a blank one removes it. */
export async function setCaps(client: SupabaseClient, caps: Caps, reason: string): Promise<void> {
  unwrap(
    await client.rpc('set_caps', {
      p_daily_cap_usd: caps.daily_cap_usd,
      p_card_max_usd: caps.card_max_usd,
      p_agent_hourly_rate_usd: caps.agent_hourly_rate_usd,
      p_monthly_cap_usd: caps.monthly_cap_usd,
      p_credit_studio_daily_cap_usd: caps.credit_studio_daily_cap_usd,
      p_anthropic_tier_cap_usd: caps.anthropic_tier_cap_usd,
      p_set_anthropic_tier_cap: true,
      p_reason: reason,
    }),
  );
}

/** The cooling window: 0 to 10,080 minutes, with a reason (set_cooling_window). */
export const COOLING_WINDOW_MAX = 10_080;

export async function setCoolingWindow(client: SupabaseClient, minutes: number, reason: string): Promise<void> {
  unwrap(await client.rpc('set_cooling_window', { p_minutes: minutes, p_reason: reason }));
}

/** Vetoes or unvetoes a card, with a reason (set_card_veto). The Director's stance is a separate field. */
export async function setCardVeto(client: SupabaseClient, id: string, vetoed: boolean, reason: string): Promise<void> {
  unwrap(await client.rpc('set_card_veto', { p_card: id, p_vetoed: vetoed, p_reason: reason }));
}

/** Pauses or resumes a role, with a reason (set_role_pause): the moderator may pause, only the board resumes. */
export async function setRolePause(client: SupabaseClient, roleId: string, paused: boolean, reason: string): Promise<void> {
  unwrap(await client.rpc('set_role_pause', { p_role: roleId, p_paused: paused, p_reason: reason }));
}

/** The largest typed input Run now sends, as enqueue_manual_job accepts it. */
export const JOB_INPUT_MAX_BYTES = 4096;

/** A job's typed input from the Run now box: blank is {}, otherwise a JSON object of at most 4 KB. */
export function parseJobInput(text: string): Record<string, unknown> {
  if (text.trim() === '') return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The input must be JSON.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('The input must be a JSON object.');
  if (new TextEncoder().encode(JSON.stringify(value)).length > JOB_INPUT_MAX_BYTES) throw new Error('The input must be at most 4 KB.');
  return value as Record<string, unknown>;
}

/** Run now: a board-origin run of the job (enqueue_manual_job); the run's id. */
export async function enqueueManualJob(
  client: SupabaseClient,
  job: { name: string; card_id: string | null; reason: string; input: Record<string, unknown> },
): Promise<string> {
  const id = unwrap<string>(await client.rpc('enqueue_manual_job', { p_job: job.name, p_card: job.card_id, p_reason: job.reason, p_input: job.input }));
  if (id === null) throw new Error('enqueue_manual_job returned no run id');
  return id;
}

export type JobRunRow = {
  id: string;
  origin: string;
  status: string;
  reason: string | null;
  created_at: string;
  finished_at: string | null;
  /** The run's typed output, as the dispatcher finished it; null while it runs or when it failed. */
  output: Record<string, unknown> | null;
};

/**
 * The role jobs' own buttons (docs/specs/agent-workflows.md): each queues a board-origin run with
 * input {}. Every other job keeps Run now with its typed input box.
 */
export const JOB_BUTTONS: Readonly<Record<string, string>> = {
  studio_ranking: 'Rank now',
  draft_card: 'Draft a game card',
};

export type RankingMoveRow = { card_id: string; from: number | null; to: number };
export type DraftRoundRow = {
  round: number;
  title: string | null;
  summary: string | null;
  lane: string | null;
  executor: string | null;
  estimate_usd: number | null;
  check: { name: string; detail: string } | null;
  verdict: { result: string; reason_codes: string[]; note: string | null } | null;
};

/** A run's typed output, read for its job: the ranking's moves, or the draft's rounds and result. */
export type RunOutput =
  | { kind: 'ranking'; moves: RankingMoveRow[]; unapplied: number }
  | { kind: 'draft'; result: string; card_id: string | null; reason: string | null; rounds: DraftRoundRow[] };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function runOutputFrom(job: string, output: Record<string, unknown> | null): RunOutput | null {
  if (output === null) return null;
  if (job === 'studio_ranking') {
    const moves = (Array.isArray(output.moves) ? output.moves : []).map(record).filter((move): move is Record<string, unknown> => move !== null);
    return {
      kind: 'ranking',
      moves: moves.map((move) => ({ card_id: String(move.card_id), from: numberOrNull(move.from), to: numberOrNull(move.to) ?? 0 })),
      unapplied: numberOrNull(output.unapplied) ?? 0,
    };
  }
  if (job === 'draft_card') {
    const rounds = (Array.isArray(output.rounds) ? output.rounds : []).map(record).filter((round): round is Record<string, unknown> => round !== null);
    return {
      kind: 'draft',
      result: typeof output.result === 'string' ? output.result : 'unknown',
      card_id: typeof output.card_id === 'string' ? output.card_id : null,
      reason: typeof output.reason === 'string' ? output.reason : null,
      rounds: rounds.map((round) => {
        const draft = record(round.draft);
        const check = record(round.check);
        const verdict = record(round.verdict);
        return {
          round: numberOrNull(round.round) ?? 0,
          title: draft ? textOrNull(draft, 'title') : null,
          summary: draft ? textOrNull(draft, 'summary') : null,
          lane: draft ? textOrNull(draft, 'lane') : null,
          executor: draft ? textOrNull(draft, 'executor') : null,
          estimate_usd: draft ? numberOrNull(draft.estimate_usd) : null,
          check: check ? { name: String(check.name), detail: String(check.detail) } : null,
          verdict: verdict ? { result: String(verdict.result), reason_codes: strings(verdict.reason_codes), note: textOrNull(verdict, 'note') } : null,
        };
      }),
    };
  }
  return null;
}

export type BoardJob = {
  name: string;
  role_name: string | null;
  calls_model: boolean;
  runs_when_paused: boolean;
  description: string | null;
  runs: JobRunRow[];
};

function jobFrom(row: Record<string, unknown>): BoardJob {
  const runs = Array.isArray(row.runs) ? (row.runs as Record<string, unknown>[]) : [];
  return {
    name: String(row.name),
    role_name: textOrNull(row, 'role_name'),
    calls_model: row.calls_model === true,
    runs_when_paused: row.runs_when_paused === true,
    description: textOrNull(row, 'description'),
    runs: runs.map((run) => ({
      id: String(run.id),
      origin: String(run.origin),
      status: String(run.status),
      reason: textOrNull(run, 'reason'),
      created_at: String(run.created_at),
      finished_at: textOrNull(run, 'finished_at'),
      output: record(run.output),
    })),
  };
}

/** Each job with its last ten runs (board_jobs). */
export async function fetchBoardJobs(client: SupabaseClient): Promise<BoardJob[]> {
  const rows = unwrap<unknown>(await client.rpc('board_jobs'));
  return (Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []).map(jobFrom);
}

export type BoardRoleRow = {
  id: string;
  name: string;
  agent_class: string | null;
  state: string;
  paused: boolean;
  paused_reason: string | null;
};

/** Each role with its class and pause (board_roles). */
export async function fetchBoardRoles(client: SupabaseClient): Promise<BoardRoleRow[]> {
  const rows = unwrap<unknown>(await client.rpc('board_roles'));
  return (Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    agent_class: textOrNull(row, 'agent_class'),
    state: String(row.state),
    paused: row.paused === true,
    paused_reason: textOrNull(row, 'paused_reason'),
  }));
}

/** Records Console credit bought for the agents, with the Stripe payout that paid for it. */
export async function recordCreditPurchase(
  client: SupabaseClient,
  purchase: { amount_usd: number; stripe_payout_id: string; reason: string },
): Promise<void> {
  unwrap(
    await client.rpc('record_credit_purchase', {
      p_amount_usd: purchase.amount_usd,
      p_stripe_payout_id: purchase.stripe_payout_id,
      p_reason: purchase.reason,
    }),
  );
}

const HORIZON_ORDER: Record<Horizon, number> = { now: 0, next: 1, later: 2 };

function boardCardFrom(row: Record<string, unknown>): BoardCard {
  const horizon: Horizon = row.horizon === 'next' || row.horizon === 'later' ? row.horizon : 'now';
  return {
    id: String(row.id),
    title: String(row.title),
    stage: String(row.stage),
    horizon,
    rank: optionalAmount(row, 'rank'),
    folder: String(row.folder),
    lane: String(row.lane),
    funding_target_usd: amount(row, 'funding_target_usd', 'cards'),
    funded_usd: amount(row, 'funded_usd', 'cards'),
    estimate_usd: amount(row, 'estimate_usd', 'cards'),
    created_at: String(row.created_at),
    source: typeof row.source === 'string' ? row.source : 'board',
    drafter_role_id: textOrNull(row, 'drafter_role_id'),
    opens_at: textOrNull(row, 'opens_at'),
    board_vetoed: row.board_vetoed === true,
    board_veto_reason: textOrNull(row, 'board_veto_reason'),
    approval: 'none',
  };
}

/** Board order: horizon now, next, later; then rank, unranked last; then the oldest. */
export function boardCardOrder(a: BoardCard, b: BoardCard): number {
  const horizon = HORIZON_ORDER[a.horizon] - HORIZON_ORDER[b.horizon];
  if (horizon !== 0) return horizon;
  if (a.rank !== b.rank) {
    if (a.rank === null) return 1;
    if (b.rank === null) return -1;
    return a.rank - b.rank;
  }
  if (a.created_at === b.created_at) return 0;
  return a.created_at < b.created_at ? -1 : 1;
}

/**
 * Every card the board can still move, cancel or resume, in board order. Board members read every
 * card (cards_board_read), undealt and hidden agent cards included; each agent-written card is asked
 * whether its approval is current (card_is_public), which the public's policy applies.
 */
export async function fetchBoardCards(client: SupabaseClient): Promise<BoardCard[]> {
  const rows = unwrap(
    await client
      .from('cards')
      .select(BOARD_CARD_COLUMNS)
      .in('stage', [...BOARD_CARD_STAGES])
      .order('created_at', { ascending: true })
      .returns<Record<string, unknown>[]>(),
  );
  const cards = (rows ?? []).map(boardCardFrom);
  await Promise.all(
    cards.filter(agentWritten).map(async (card) => {
      const current = unwrap<boolean>(await client.rpc('card_is_public', { p_card: card.id }));
      card.approval = current === true ? 'current' : 'missing';
    }),
  );
  return cards.sort(boardCardOrder);
}

export async function fileNote(client: SupabaseClient, text: string): Promise<string> {
  const id = unwrap<string>(await client.rpc('file_note', { p_text: text }));
  if (id === null) throw new Error('file_note returned no note id');
  return id;
}

function textOrNull(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function amount(row: Record<string, unknown>, key: string, source = 'board_studio_state'): number {
  const value = row[key];
  const n = typeof value === 'number' || typeof value === 'string' ? toNumber(value) : null;
  if (n === null) throw new Error(`${source} returned no ${key}`);
  return n;
}

function optionalAmount(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' || typeof value === 'string' ? toNumber(value) : null;
}

export function studioStateFrom(raw: unknown): BoardStudioState {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('board_studio_state returned no state');
  }
  const row = raw as Record<string, unknown>;
  return {
    paused: row.paused === true,
    paused_by: textOrNull(row, 'paused_by'),
    paused_at: textOrNull(row, 'paused_at'),
    agent_mode: textOrNull(row, 'agent_mode') ?? '',
    launched_at: textOrNull(row, 'launched_at'),
    dispatcher_seen_at: textOrNull(row, 'dispatcher_seen_at'),
    daily_cap_usd: amount(row, 'daily_cap_usd'),
    card_max_usd: amount(row, 'card_max_usd'),
    agent_hourly_rate_usd: optionalAmount(row, 'agent_hourly_rate_usd'),
    monthly_cap_usd: optionalAmount(row, 'monthly_cap_usd'),
    credit_studio_daily_cap_usd: optionalAmount(row, 'credit_studio_daily_cap_usd'),
    anthropic_tier_cap_usd: optionalAmount(row, 'anthropic_tier_cap_usd'),
    platform_lane_open: row.platform_lane_open === true,
    cooling_window_minutes: optionalAmount(row, 'cooling_window_minutes') ?? 0,
  };
}

export async function boardStudioState(client: SupabaseClient): Promise<BoardStudioState> {
  return studioStateFrom(unwrap<unknown>(await client.rpc('board_studio_state')));
}

export async function setLaunched(client: SupabaseClient): Promise<Date> {
  const at = unwrap<string>(await client.rpc('set_launched'));
  const date = at === null ? null : new Date(at);
  if (date === null || !Number.isFinite(date.getTime())) {
    throw new Error('set_launched returned no timestamp');
  }
  return date;
}

export async function setAgentMode(client: SupabaseClient, mode: AgentMode): Promise<void> {
  unwrap(await client.rpc('set_agent_mode', { p_mode: mode }));
}

/** The dispatcher counts as running while its last heartbeat is within DISPATCHER_STALE_MS. */
export function dispatcherSeenAgoMs(seenAt: string | null, now: Date): number | null {
  if (seenAt === null) return null;
  const seen = new Date(seenAt);
  if (!Number.isFinite(seen.getTime())) return null;
  const ago = now.getTime() - seen.getTime();
  return ago > DISPATCHER_STALE_MS ? null : Math.max(0, ago);
}

export function sessionExpiry(lastSeen: Date): Date {
  return new Date(lastSeen.getTime() + BOARD_SESSION_TTL_MIN * 60_000);
}
