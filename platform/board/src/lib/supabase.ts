import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { boardEnv } from './env';

/**
 * The board signs in here and only here (docs/specs/board-site.md), so this client keeps its
 * session: it persists it in this origin's storage, refreshes it, and reads the magic link's tokens
 * from the address the link lands on. The public site's client does none of these.
 */
export const BOARD_AUTH_OPTIONS = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
} as const;

let cached: SupabaseClient | null = null;
let resolved = false;

export function getClient(): SupabaseClient | null {
  if (resolved) return cached;
  resolved = true;
  const env = boardEnv();
  if (env.supabaseUrl === '' || env.supabaseAnonKey === '') return null;
  cached = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { ...BOARD_AUTH_OPTIONS } });
  return cached;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}
