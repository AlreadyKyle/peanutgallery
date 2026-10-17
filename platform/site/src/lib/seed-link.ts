// A seed code from a link (docs/specs/final-state.md, Seeds and instances): /seeds?save=<code>, which
// the game links to from Share your run. The rule is the twin of save_seed's in
// platform/supabase/migrations/20261017100000_community_core.sql: a game key of 2 to 20 lower-case
// letters, digits or hyphens, then `:v` and a version of 1 to 4 digits, then `:` and base64url, at most
// 2000 characters in all. A code that fails here is never sent.

export type SeedCode = { game: string; version: number; code: string };

const MAX = 2000;
const RULE = /^([a-z0-9-]{2,20}):v([0-9]{1,4}):[A-Za-z0-9_-]+$/;

export function parseSeedCode(raw: string | null | undefined): SeedCode | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  if (code.length === 0 || code.length > MAX) return null;
  const match = RULE.exec(code);
  if (match === null) return null;
  return { game: match[1]!, version: Number(match[2]), code };
}

// The seed waiting for sign-in: kept in this browser while the magic link is out, so /me can send the
// player back to finish the save. Storage may be refused (a private window); the save then waits for
// the player to open the link again.
const PENDING = 'mm:pending-seed';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function rememberPendingSeed(code: string): void {
  try {
    storage()?.setItem(PENDING, code);
  } catch {
    // Nothing to keep it in.
  }
}

/** The waiting seed, if a valid one is kept. */
export function pendingSeed(): string | null {
  try {
    const code = storage()?.getItem(PENDING) ?? null;
    return parseSeedCode(code)?.code ?? null;
  } catch {
    return null;
  }
}

export function clearPendingSeed(): void {
  try {
    storage()?.removeItem(PENDING);
  } catch {
    // Nothing kept.
  }
}

/** Where /me sends a player who just signed in with a seed waiting, or null. */
export function pendingSeedPath(): string | null {
  const code = pendingSeed();
  return code === null ? null : `/seeds?save=${encodeURIComponent(code)}`;
}
