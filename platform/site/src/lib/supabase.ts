// Nobody signs in on the public site: the board signs in on its own site (docs/specs/board-site.md),
// and the site holds no Supabase client at all; its figures come from its own /api documents
// (docs/specs/site-snapshot.md). What is left here clears a session an older build stored.

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

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}
