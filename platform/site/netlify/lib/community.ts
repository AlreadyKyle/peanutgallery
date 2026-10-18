// The /api/community/* routes (docs/specs/community-core.md): what each public document reads and
// how long the CDN keeps it, the query parameters each accepts, and the player RPCs the site may
// call through this origin with the player's own session. Pure functions only, so the tests read
// them without a network; netlify/functions/community.mts does the I/O.

export const COMMUNITY_PREFIX = '/api/community';

export interface DocumentRoute {
  rpc: string;
  args: Record<string, string | null>;
  seconds: number;
  staleSeconds: number;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const CURSOR = /^[A-Za-z0-9.+|-]{1,80}$/;
const HANDLE = /^[a-z0-9-]{3,24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEED_SORTS = ['trending', 'top_week', 'top_all', 'new'];
const SUGGESTION_SORTS = ['top', 'new'];
const AREAS = ['dust', 'new_game', 'studio', 'site'];

function only(params: URLSearchParams, allowed: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!allowed.includes(key)) return `Unknown query parameter: ${key.slice(0, 40)}`;
    if (seen.has(key)) return `Repeated query parameter: ${key}`;
    seen.add(key);
  }
  return null;
}

function cursorOf(params: URLSearchParams): Parsed<string | null> {
  const cursor = params.get('cursor');
  if (cursor === null || cursor === '') return { ok: true, value: null };
  if (!CURSOR.test(cursor)) return { ok: false, status: 400, error: 'Bad cursor' };
  return { ok: true, value: cursor };
}

/** The public document a GET path asks for, with its RPC arguments, or why it is refused. */
export function documentRoute(pathname: string, params: URLSearchParams): Parsed<DocumentRoute> {
  const rest = pathname.startsWith(`${COMMUNITY_PREFIX}/`) ? pathname.slice(COMMUNITY_PREFIX.length + 1) : null;
  if (rest === null) return { ok: false, status: 404, error: 'Not found' };
  const refuse = (error: string): Parsed<DocumentRoute> => ({ ok: false, status: 400, error });
  if (rest === 'feed') {
    const bad = only(params, ['cursor']);
    if (bad) return refuse(bad);
    const cursor = cursorOf(params);
    if (!cursor.ok) return cursor;
    return { ok: true, value: { rpc: 'community_feed', args: { p_cursor: cursor.value }, seconds: 5, staleSeconds: 30 } };
  }
  if (rest === 'goals' || rest === 'studio') {
    const bad = only(params, []);
    if (bad) return refuse(bad);
    return { ok: true, value: { rpc: `community_${rest}`, args: {}, seconds: 30, staleSeconds: 60 } };
  }
  if (rest === 'seeds') {
    const bad = only(params, ['sort', 'cursor']);
    if (bad) return refuse(bad);
    const sort = params.get('sort') || 'trending';
    if (!SEED_SORTS.includes(sort)) return refuse('Bad sort');
    const cursor = cursorOf(params);
    if (!cursor.ok) return cursor;
    return { ok: true, value: { rpc: 'community_seeds', args: { p_sort: sort, p_cursor: cursor.value }, seconds: 15, staleSeconds: 30 } };
  }
  if (rest === 'suggestions') {
    const bad = only(params, ['sort', 'area', 'cursor']);
    if (bad) return refuse(bad);
    const sort = params.get('sort') || 'top';
    if (!SUGGESTION_SORTS.includes(sort)) return refuse('Bad sort');
    const area = params.get('area') || null;
    if (area !== null && !AREAS.includes(area)) return refuse('Bad area');
    const cursor = cursorOf(params);
    if (!cursor.ok) return cursor;
    return {
      ok: true,
      value: { rpc: 'community_suggestions', args: { p_sort: sort, p_area: area, p_cursor: cursor.value }, seconds: 15, staleSeconds: 30 },
    };
  }
  const profile = /^profile\/([^/]+)$/.exec(rest);
  if (profile) {
    const bad = only(params, []);
    if (bad) return refuse(bad);
    // A malformed escape (%E0%A4%A) makes decodeURIComponent throw; it names no handle.
    let handle: string;
    try {
      handle = decodeURIComponent(profile[1]!);
    } catch {
      return { ok: false, status: 404, error: 'Not found' };
    }
    if (!HANDLE.test(handle)) return { ok: false, status: 404, error: 'Not found' };
    return { ok: true, value: { rpc: 'community_profile', args: { p_handle: handle }, seconds: 30, staleSeconds: 60 } };
  }
  // A card's Suggested by credit (docs/specs/place.md): the ideas in the clusters linked to it.
  const cardIdeas = /^card\/([^/]+)\/ideas$/.exec(rest);
  if (cardIdeas) {
    const bad = only(params, []);
    if (bad) return refuse(bad);
    const card = cardIdeas[1]!.toLowerCase();
    if (!UUID.test(card)) return { ok: false, status: 404, error: 'Not found' };
    return { ok: true, value: { rpc: 'community_card_ideas', args: { p_card: card }, seconds: 30, staleSeconds: 60 } };
  }
  return { ok: false, status: 404, error: 'Not found' };
}

/**
 * The player RPCs the site may call with the player's session, and the named arguments each takes
 * (community-types.ts). Anything else answers 404 before Supabase is called.
 */
export const PLAYER_RPCS: Readonly<Record<string, readonly string[]>> = {
  my_profile: [],
  update_profile: ['display_name', 'avatar', 'frame', 'flair', 'public_by_default'],
  claim_contributions: [],
  set_contribution_public: ['contribution_id', 'make_public'],
  submit_suggestion: ['area', 'title', 'body'],
  vote_suggestion: ['id', 'value'],
  save_seed: ['game', 'code', 'title', 'publish'],
  vote_seed: ['id', 'value'],
  // docs/specs/card-follows.md: "Tell me when this ships".
  follow_card: ['card_id'],
  unfollow_card: ['card_id'],
  my_follows: [],
};

/** The largest JSON body a POST may carry. */
export const MAX_BODY_BYTES = 8 * 1024;

/** A bearer token as Supabase issues it: a JWT, three base64url parts. */
const JWT = /^[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{10,4000}\.[A-Za-z0-9_-]{10,1000}$/;

export function bearer(header: string | null): string | null {
  const match = /^Bearer (\S+)$/.exec(header ?? '');
  return match && JWT.test(match[1]!) ? match[1]! : null;
}

/** The RPC's named arguments from a parsed body, or why they are refused. */
export function rpcArgs(name: string, body: unknown): Parsed<Record<string, unknown>> {
  const allowed = PLAYER_RPCS[name];
  if (allowed === undefined) return { ok: false, status: 404, error: 'Not found' };
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, status: 400, error: 'The body must be a JSON object' };
  const args = body as Record<string, unknown>;
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) return { ok: false, status: 400, error: `Unknown argument: ${unknown[0]!.slice(0, 40)}` };
  return { ok: true, value: args };
}

const EMAIL = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,185}\.[A-Za-z]{2,24}$/;

/** The magic-link request: an email and a redirect on this site's own origin. */
export function otpRequest(body: unknown, origin: string): Parsed<{ email: string; redirectTo: string }> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, status: 400, error: 'The body must be a JSON object' };
  const { email, redirectTo, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return { ok: false, status: 400, error: 'Send only email and redirectTo' };
  if (typeof email !== 'string' || email.length > 254 || !EMAIL.test(email.trim())) return { ok: false, status: 400, error: 'Enter a valid email address' };
  if (typeof redirectTo !== 'string' || redirectTo.length > 500) return { ok: false, status: 400, error: 'redirectTo must be a page on this site' };
  let target: URL;
  try {
    target = new URL(redirectTo);
  } catch {
    return { ok: false, status: 400, error: 'redirectTo must be a page on this site' };
  }
  if (target.origin !== origin || target.username !== '' || target.password !== '') {
    return { ok: false, status: 400, error: 'redirectTo must be a page on this site' };
  }
  return { ok: true, value: { email: email.trim().toLowerCase(), redirectTo: target.href } };
}

export function refreshRequest(body: unknown): Parsed<string> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, status: 400, error: 'The body must be a JSON object' };
  const { refresh_token: token, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return { ok: false, status: 400, error: 'Send only refresh_token' };
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{8,512}$/.test(token)) return { ok: false, status: 400, error: 'Bad refresh_token' };
  return { ok: true, value: token };
}

/**
 * A best-effort limit per address within one function instance: at most `limit` hits a window.
 * The database's per-account limits (3 suggestions a day, 200 votes a day, 30 seeds a day) and
 * Supabase Auth's own email limits are the real wall; this keeps one address from hammering them.
 */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}

/** The message a Supabase error body carries, cut to a safe length, or a plain fallback. */
export function errorText(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    for (const key of ['message', 'msg', 'error_description', 'error']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim() !== '') return value.trim().slice(0, 200);
    }
  }
  return fallback;
}
