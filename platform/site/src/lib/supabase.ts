import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { siteEnv } from './env';

/**
 * Nobody signs in on the public site: the board signs in on its own site (docs/specs/board-site.md).
 * So this client keeps no session. It stores none, refreshes none, and never reads tokens from the
 * address, so a sign-in link that lands here by mistake leaves no session on this origin.
 */
export const PUBLIC_AUTH_OPTIONS = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

/** The key supabase-js stored a session under before the board moved: sb-<project>-auth-token. */
export const STORED_SESSION_KEY = /^sb-[a-z0-9]+-auth-token(-code-verifier)?$/;

/**
 * Removes any session a board member's browser still holds for this origin from when the board
 * signed in here. The switch also signs every board user out, so such a session is already dead;
 * this keeps its refresh token from lingering where card-built script will one day run.
 */
export function clearStoredSessions(storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | null): number {
  if (storage === null) return 0;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && STORED_SESSION_KEY.test(key)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}

let cached: SupabaseClient | null = null;
let resolved = false;

export function getClient(): SupabaseClient | null {
  if (resolved) return cached;
  resolved = true;
  const env = siteEnv();
  if (env.supabaseUrl === '' || env.supabaseAnonKey === '') return null;
  cached = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { ...PUBLIC_AUTH_OPTIONS } });
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
