import type { SupabaseClient } from '@supabase/supabase-js';

// Mirrors the dispatcher default for BOARD_SESSION_TTL_MIN (platform/dispatcher/src/config.ts).
// The dispatcher judges the session from board_members.last_seen_at with this window; change both together.
export const BOARD_SESSION_TTL_MIN = 3;
export const HEARTBEAT_MS = 60_000;

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

export const buckets = ['game', 'platform', 'qa', 'studio', 'budget', 'agents'] as const;
export const lanes = ['config', 'code'] as const;
export const folders = ['seed-1', 'platform'] as const;

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

export async function fileNote(client: SupabaseClient, text: string): Promise<string> {
  const id = unwrap<string>(await client.rpc('file_note', { p_text: text }));
  if (id === null) throw new Error('file_note returned no note id');
  return id;
}

export function sessionExpiry(lastSeen: Date): Date {
  return new Date(lastSeen.getTime() + BOARD_SESSION_TTL_MIN * 60_000);
}
