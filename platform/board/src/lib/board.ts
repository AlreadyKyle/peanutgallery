import type { SupabaseClient } from '@supabase/supabase-js';
import { formatUsd, toNumber } from './format';

// Every database call the board's panel makes (docs/specs/optional-board.md). The panel is optional:
// the studio runs without it, so it sends no heartbeat and nothing waits on it. This app is kernel: no
// card may change a file under platform/board, and nothing here imports from the public site.

export const STUDIO_STATE_POLL_MS = 15_000;
// A dispatcher heartbeat older than this counts as stale.
export const DISPATCHER_STALE_MS = 3 * 60_000;

export type BoardRole = 'board' | 'moderator';

/** When a card is meant to be built: now (open to funding and the agents), next or later (the roadmap). */
export type Horizon = 'now' | 'next' | 'later';

/** The public_roles columns the board reads to offer a card's executor. */
export type Role = { id: string; title: string; write_access: boolean; state: string };

/** The roles that build cards, and the folder each builds in. Only these are offered as a card's executor. */
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

export const ROLE_COLUMNS = 'id,title,write_access,state';

export const buckets = ['game', 'platform', 'qa', 'studio', 'budget', 'agents'] as const;
export const lanes = ['config', 'code'] as const;
export const folders = ['seed-1', 'platform'] as const;
export const horizons = [
  { value: 'now', label: 'Now: open for funding' },
  { value: 'next', label: 'Next: on the roadmap' },
  { value: 'later', label: 'Later: on the roadmap' },
] as const satisfies readonly { value: Horizon; label: string }[];

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T | null {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textOrNull(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function optionalAmount(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' || typeof value === 'string' ? toNumber(value) : null;
}

function amount(row: Record<string, unknown>, key: string, source: string): number {
  const n = optionalAmount(row, key);
  if (n === null) throw new Error(`${source} returned no ${key}`);
  return n;
}

function rows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? data.map(record).filter((row): row is Record<string, unknown> => row !== null) : [];
}

// Sign-in ---------------------------------------------------------------------

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
  return { level: assurance.currentLevel === 'aal2' ? 'aal2' : 'aal1', verifiedFactorId: verified?.id ?? null };
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

// Status ----------------------------------------------------------------------

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

export type BoardStudioState = {
  paused: boolean;
  /** Why it is paused, from public_studio; null while it runs or when the view gives none. */
  pause_reason: string | null;
  dispatcher_seen_at: string | null;
  daily_cap_usd: number;
  card_max_usd: number;
  agent_hourly_rate_usd: number | null;
  monthly_cap_usd: number | null;
  credit_studio_daily_cap_usd: number | null;
  anthropic_tier_cap_usd: number | null;
  /** Whether the platform code lane is open (studio_state.platform_lane_open). */
  platform_lane_open: boolean;
};

export function studioStateFrom(raw: unknown, pauseReason: string | null = null): BoardStudioState {
  const row = record(raw);
  if (row === null) throw new Error('board_studio_state returned no state');
  const paused = row.paused === true;
  return {
    paused,
    pause_reason: paused ? (textOrNull(row, 'pause_reason') ?? pauseReason) : null,
    dispatcher_seen_at: textOrNull(row, 'dispatcher_seen_at'),
    daily_cap_usd: amount(row, 'daily_cap_usd', 'board_studio_state'),
    card_max_usd: amount(row, 'card_max_usd', 'board_studio_state'),
    agent_hourly_rate_usd: optionalAmount(row, 'agent_hourly_rate_usd'),
    monthly_cap_usd: optionalAmount(row, 'monthly_cap_usd'),
    credit_studio_daily_cap_usd: optionalAmount(row, 'credit_studio_daily_cap_usd'),
    anthropic_tier_cap_usd: optionalAmount(row, 'anthropic_tier_cap_usd'),
    platform_lane_open: row.platform_lane_open === true,
  };
}

/**
 * board_studio_state, with the pause reason from public_studio: the RPC predates the reason, and the
 * view is the one place it is read (docs/specs/money-logic.md).
 */
export async function boardStudioState(client: SupabaseClient): Promise<BoardStudioState> {
  const [state, studio] = await Promise.all([
    client.rpc('board_studio_state'),
    client.from('public_studio').select('pause_reason').limit(1).returns<Record<string, unknown>[]>(),
  ]);
  const view = rows(unwrap(studio))[0];
  return studioStateFrom(unwrap<unknown>(state), view ? textOrNull(view, 'pause_reason') : null);
}

export type DispatcherStatus = { kind: 'never' } | { kind: 'seen'; agoMs: number } | { kind: 'stale'; seenAt: string };

/** The dispatcher is seen while its last heartbeat is within DISPATCHER_STALE_MS, stale after it. */
export function dispatcherStatus(seenAt: string | null, now: Date): DispatcherStatus {
  if (seenAt === null) return { kind: 'never' };
  const seen = new Date(seenAt);
  if (!Number.isFinite(seen.getTime())) return { kind: 'never' };
  const ago = now.getTime() - seen.getTime();
  return ago > DISPATCHER_STALE_MS ? { kind: 'stale', seenAt } : { kind: 'seen', agoMs: Math.max(0, ago) };
}

/** The card supply against the floor (card_supply, docs/specs/studio-reports.md), as its line needs it. */
export type CardSupply = {
  open: number;
  big: number;
  small: number;
  floor_open: number;
  floor_big: number;
  floor_small: number;
  big_min_usd: number;
  small_max_usd: number;
};

const SUPPLY_FIGURES = ['open', 'big', 'small', 'floor_open', 'floor_big', 'floor_small', 'big_min_usd', 'small_max_usd'] as const;

/** Reads what card_supply returns; throws on a missing or malformed figure. */
export function supplyFrom(raw: unknown): CardSupply {
  const row = record(raw);
  if (row === null) throw new Error('card_supply returned nothing');
  const supply = {} as CardSupply;
  for (const key of SUPPLY_FIGURES) supply[key] = amount(row, key, 'card_supply');
  return supply;
}

export async function fetchCardSupply(client: SupabaseClient): Promise<CardSupply> {
  return supplyFrom(unwrap(await client.rpc('card_supply')));
}

/** A whole-dollar threshold as "$5", any other as "$2.50". */
function threshold(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : formatUsd(usd);
}

/** "Open cards: 6 of a floor of 6 · $5 or more: 0 of 1 · under $2: 6 of 1". */
export function supplyLine(supply: CardSupply): string {
  return [
    `Open cards: ${supply.open} of a floor of ${supply.floor_open}`,
    `${threshold(supply.big_min_usd)} or more: ${supply.big} of ${supply.floor_big}`,
    `under ${threshold(supply.small_max_usd)}: ${supply.small} of ${supply.floor_small}`,
  ].join(' · ');
}

// Activity --------------------------------------------------------------------

export const RECENT_CARD_LIMIT = 25;
export const RECENT_RUN_LIMIT = 20;
export const CARD_EVENT_LIMIT = 50;
export const RECENT_CARD_COLUMNS = 'id,title,stage,horizon,failing_check,updated_at';
export const CARD_EVENT_COLUMNS = 'id,card_id,type,created_at,step,line_key';
export const FINDING_COLUMNS = 'fingerprint,kind,subject,detail,opened_at,last_seen_at';

export type RecentCard = { id: string; title: string; stage: string; horizon: string | null; failing_check: string | null; updated_at: string };

/** The most recently updated cards, any stage. Board members read every card (cards_board_read). */
export async function fetchRecentCards(client: SupabaseClient): Promise<RecentCard[]> {
  const data = unwrap(
    await client
      .from('cards')
      .select(RECENT_CARD_COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(RECENT_CARD_LIMIT)
      .returns<Record<string, unknown>[]>(),
  );
  return rows(data).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    stage: String(row.stage),
    horizon: textOrNull(row, 'horizon'),
    failing_check: textOrNull(row, 'failing_check'),
    updated_at: String(row.updated_at),
  }));
}

export type JobRun = { id: string; job: string; origin: string; status: string; reason: string | null; created_at: string };
export type BoardJobs = { names: string[]; runs: JobRun[] };

/** board_jobs, flattened: every job's name, and the newest runs across all of them. */
export function jobsFrom(raw: unknown, limit = RECENT_RUN_LIMIT): BoardJobs {
  const jobs = rows(raw);
  const runs = jobs.flatMap((job) =>
    rows(job.runs).map((run) => ({
      id: String(run.id),
      job: String(job.name),
      origin: String(run.origin),
      status: String(run.status),
      reason: textOrNull(run, 'reason'),
      created_at: String(run.created_at),
    })),
  );
  runs.sort((a, b) => (a.created_at === b.created_at ? 0 : a.created_at < b.created_at ? 1 : -1));
  return { names: jobs.map((job) => String(job.name)), runs: runs.slice(0, limit) };
}

export async function fetchBoardJobs(client: SupabaseClient): Promise<BoardJobs> {
  return jobsFrom(unwrap<unknown>(await client.rpc('board_jobs')));
}

/** What a Janitor check found (docs/specs/agent-upkeep.md). */
export type FindingKind = 'schema' | 'model' | 'cli' | 'scan' | 'producer';
const FINDING_KINDS: readonly FindingKind[] = ['schema', 'model', 'cli', 'scan', 'producer'];

export type Finding = {
  fingerprint: string;
  kind: FindingKind;
  subject: string;
  /** The check's figures, flat: each value a string, number, boolean or null. */
  detail: Array<[string, string]>;
  opened_at: string;
  last_seen_at: string;
};

function detailFrom(value: unknown): Array<[string, string]> {
  const row = record(value);
  if (row === null) return [];
  return Object.entries(row)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([key, v]): [string, string] => [key, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
}

/** Reads the findings rows, keeping only well-formed ones, oldest first. */
export function findingsFrom(data: unknown): Finding[] {
  const out: Finding[] = [];
  for (const row of rows(data)) {
    const fingerprint = textOrNull(row, 'fingerprint');
    const subject = textOrNull(row, 'subject');
    const opened = textOrNull(row, 'opened_at');
    const kind = FINDING_KINDS.find((k) => k === row.kind);
    if (fingerprint === null || subject === null || opened === null || kind === undefined) continue;
    out.push({ fingerprint, kind, subject, detail: detailFrom(row.detail), opened_at: opened, last_seen_at: textOrNull(row, 'last_seen_at') ?? opened });
  }
  return out.sort((a, b) => a.opened_at.localeCompare(b.opened_at));
}

/** The open findings. RLS lets only a board member read them; nothing but the dispatcher writes them. */
export async function fetchFindings(client: SupabaseClient): Promise<Finding[]> {
  const data = unwrap(
    await client.from('findings').select(FINDING_COLUMNS).is('closed_at', null).order('opened_at', { ascending: true }).returns<Record<string, unknown>[]>(),
  );
  return findingsFrom(data);
}

export type AgentEvent = { id: string; type: string; created_at: string; step: string | null; line_key: string | null };

/** One card's public agent events, newest first. */
export async function fetchCardEvents(client: SupabaseClient, cardId: string): Promise<AgentEvent[]> {
  const data = unwrap(
    await client
      .from('public_agent_events')
      .select(CARD_EVENT_COLUMNS)
      .eq('card_id', cardId)
      .order('created_at', { ascending: false })
      .limit(CARD_EVENT_LIMIT)
      .returns<Record<string, unknown>[]>(),
  );
  return rows(data).map((row) => ({
    id: String(row.id),
    type: String(row.type),
    created_at: String(row.created_at),
    step: textOrNull(row, 'step'),
    line_key: textOrNull(row, 'line_key'),
  }));
}

// Actions ---------------------------------------------------------------------

/** The public_roles rows that build cards, in title order: the executors File a card offers. */
export async function fetchCardRoles(client: SupabaseClient): Promise<Role[]> {
  const data = unwrap(await client.from('public_roles').select(ROLE_COLUMNS).returns<Record<string, unknown>[]>());
  return rows(data)
    .map((row) => ({ id: String(row.id), title: String(row.title), write_access: row.write_access === true, state: String(row.state) }))
    .filter(isCardRole)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export type NewCard = {
  bucket: string;
  lane: string;
  folder: string;
  title: string;
  summary: string;
  intent: string;
  acceptance_test: string;
  funding_target_usd: number;
  executor_role_id: string;
  board_reason: string;
  horizon: Horizon;
};

/** file_card: always filed as proposed, open for funding on its horizon. The new card's id. */
export async function fileCard(client: SupabaseClient, card: NewCard): Promise<string> {
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
      p_stage: 'proposed',
      p_executor_role_id: card.executor_role_id,
      p_board_reason: card.board_reason,
      p_horizon: card.horizon,
    }),
  );
  if (id === null) throw new Error('file_card returned no card id');
  return id;
}

/** The stages a card can still be rejected at; a paused one can be resumed too. */
export const ACTIONABLE_STAGES = ['proposed', 'designing', 'voted', 'funded', 'paused'] as const;
export const ACTIONABLE_CARD_COLUMNS = 'id,title,stage,estimate_usd';

export type ActionableCard = { id: string; title: string; stage: string; estimate_usd: number };

export async function fetchActionableCards(client: SupabaseClient): Promise<ActionableCard[]> {
  const data = unwrap(
    await client
      .from('cards')
      .select(ACTIONABLE_CARD_COLUMNS)
      .in('stage', [...ACTIONABLE_STAGES])
      .order('created_at', { ascending: true })
      .returns<Record<string, unknown>[]>(),
  );
  return rows(data).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    stage: String(row.stage),
    estimate_usd: optionalAmount(row, 'estimate_usd') ?? 0,
  }));
}

/**
 * Rejects a card with the board's reason. Its unspent money moves at once to the next cards in line
 * (docs/specs/money-logic.md); the result is how much moved.
 */
export async function cancelCard(client: SupabaseClient, id: string, reason: string): Promise<number> {
  const result = record(unwrap<unknown>(await client.rpc('cancel_card', { p_card: id, p_reason: reason })));
  const moved = Number(result?.moved_usd ?? 0);
  return Number.isFinite(moved) ? moved : 0;
}

/** Moves a paused card back to funded with a new estimate of at least what it has already cost. */
export async function resumeCard(client: SupabaseClient, id: string, estimateUsd: number, reason: string): Promise<void> {
  unwrap(await client.rpc('resume_card', { p_card: id, p_estimate_usd: estimateUsd, p_reason: reason }));
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

/** Run a job now: a board-origin run of the job with input {} and no card (enqueue_manual_job); the run's id. */
export async function runJobNow(client: SupabaseClient, job: string, reason: string): Promise<string> {
  const id = unwrap<string>(await client.rpc('enqueue_manual_job', { p_job: job, p_card: null, p_reason: reason, p_input: {} }));
  if (id === null) throw new Error('enqueue_manual_job returned no run id');
  return id;
}
