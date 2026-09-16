import type { SupabaseClient } from '@supabase/supabase-js';
import { toNumber } from './format';

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
};

export const buckets = ['game', 'platform', 'qa', 'studio', 'budget', 'agents'] as const;
export const lanes = ['config', 'code'] as const;
export const folders = ['seed-1', 'platform'] as const;
export const cardStages = [
  { value: 'proposed', label: 'Open for funding' },
  { value: 'voted', label: 'Picked by the board' },
] as const satisfies readonly { value: NextCardStage; label: string }[];
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
    }),
  );
  if (id === null) throw new Error('file_card returned no card id');
  return id;
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

function amount(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const n = typeof value === 'number' || typeof value === 'string' ? toNumber(value) : null;
  if (n === null) throw new Error(`board_studio_state returned no ${key}`);
  return n;
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
