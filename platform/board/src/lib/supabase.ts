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

function rawMessage(error: unknown): string {
  if (error === null || error === undefined) return '';
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

/**
 * An error as one plain sentence. A gateway or host error page (supabase-js hands back the body of a
 * response that is not JSON as the message, such as "<html>Bad gateway</html>"), an empty answer, a
 * lost connection and Postgres's bad-id error each become a sentence the board can act on; any other
 * message, the database's own refusals included, is shown as it is.
 */
export function errorMessage(error: unknown): string {
  const message = rawMessage(error).trim();
  if (message === '' || message === '{}') {
    return 'The server gave an empty answer. Try again in a minute.';
  }
  if (/^</.test(message) || /<\/?(html|body|head|title|h1)\b|<!doctype/i.test(message)) {
    return 'The server sent back an error page instead of an answer; it may be down or restarting. Try again in a minute.';
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return 'The server could not be reached. Check the connection and try again.';
  }
  if (/invalid input syntax for type uuid/i.test(message)) {
    return 'That id is not one the database knows. Choose it from the list instead.';
  }
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}
