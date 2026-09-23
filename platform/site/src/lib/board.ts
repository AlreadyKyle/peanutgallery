import type { SupabaseClient } from '@supabase/supabase-js';
import { toNumber } from './format';
import type { Horizon, Role } from './source';

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
};

/** Every value set_caps takes, in US dollars. The database checks the bounds. */
export type Caps = {
  daily_cap_usd: number;
  card_max_usd: number;
  agent_hourly_rate_usd: number;
  monthly_cap_usd: number;
  credit_studio_daily_cap_usd: number;
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
  'id,title,stage,horizon,rank,folder,lane,funding_target_usd,funded_usd,estimate_usd,created_at';

/**
 * The roles that build cards, and the folder each builds in. Only these are offered as a card's
 * executor. Every other role (the directors, the Game Designer, the Host, Biz Dev, the Community
 * agent and the rest of the roster) has no job that runs yet: note triage, card drafting, grading,
 * the report, the stream and outside research are backlog cards.
 */
export const CARD_ROLE_FOLDERS: Readonly<Record<string, string>> = {
  'Builder A': 'seed-1',
  'Builder B': 'seed-1',
  QA: 'seed-1',
  'Platform Builder': 'platform',
};

/**
 * The folders whose cards run at launch. The platform code lane (all of platform/site) stays closed
 * until the board has its own site, because the board signs in on this origin: the dispatcher
 * refuses those cards, and set_card_horizon and file_card refuse horizon now for them.
 */
export const OPEN_FOLDERS: readonly string[] = ['seed-1'];

/** An active role that builds cards, whether or not its folder is open: the /board executor list. */
export function isCardRole(role: Role): boolean {
  return role.state === 'active' && role.write_access && Object.hasOwn(CARD_ROLE_FOLDERS, role.title);
}

/** The folder a card role changes, or null for a role that builds no cards. */
export function cardRoleFolder(role: Role): string | null {
  return isCardRole(role) ? (CARD_ROLE_FOLDERS[role.title] ?? null) : null;
}

/** A card role whose folder is open: the only roles /team shows as running. */
export function runsCards(role: Role): boolean {
  const folder = cardRoleFolder(role);
  return folder !== null && OPEN_FOLDERS.includes(folder);
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

export async function sendMagicLink(client: SupabaseClient, email: string): Promise<void> {
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${window.location.origin}/board` },
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

export async function setPaused(client: SupabaseClient, paused: boolean): Promise<void> {
  unwrap(await client.rpc('set_paused', { p_paused: paused }));
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

/** Rejects a card with the board's reason. Only an open, funded or paused card can be cancelled. */
export async function cancelCard(client: SupabaseClient, id: string, reason: string): Promise<void> {
  unwrap(await client.rpc('cancel_card', { p_card: id, p_reason: reason }));
}

/** Moves a paused card back to funded with a new estimate of at least what it has already cost. */
export async function resumeCard(client: SupabaseClient, id: string, estimateUsd: number, reason: string): Promise<void> {
  unwrap(await client.rpc('resume_card', { p_card: id, p_estimate_usd: estimateUsd, p_reason: reason }));
}

export async function setCaps(client: SupabaseClient, caps: Caps, reason: string): Promise<void> {
  unwrap(
    await client.rpc('set_caps', {
      p_daily_cap_usd: caps.daily_cap_usd,
      p_card_max_usd: caps.card_max_usd,
      p_agent_hourly_rate_usd: caps.agent_hourly_rate_usd,
      p_monthly_cap_usd: caps.monthly_cap_usd,
      p_credit_studio_daily_cap_usd: caps.credit_studio_daily_cap_usd,
      p_reason: reason,
    }),
  );
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

/** Every card the board can still move, cancel or resume, in board order. */
export async function fetchBoardCards(client: SupabaseClient): Promise<BoardCard[]> {
  const rows = unwrap(
    await client
      .from('cards')
      .select(BOARD_CARD_COLUMNS)
      .in('stage', [...BOARD_CARD_STAGES])
      .order('created_at', { ascending: true })
      .returns<Record<string, unknown>[]>(),
  );
  return (rows ?? []).map(boardCardFrom).sort(boardCardOrder);
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
