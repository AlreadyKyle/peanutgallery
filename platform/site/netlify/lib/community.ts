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

/** The sign-in providers the site offers a button for, once each is switched on in Supabase Auth. */
export const OAUTH_PROVIDERS = ['google', 'apple', 'github', 'discord'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** A new password's length: at least 8 characters, and at most 72 bytes (bcrypt reads no further). */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;

function objectBody(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

const NOT_OBJECT = { ok: false, status: 400, error: 'The body must be a JSON object' } as const;

function emailOf(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 254 && EMAIL.test(value.trim()) ? value.trim().toLowerCase() : null;
}

/** A redirect on this site's own origin, with no user or password in it, or null. */
export function sameOrigin(value: unknown, origin: string): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return null;
  }
  if (target.origin !== origin || target.username !== '' || target.password !== '') return null;
  return target.href;
}

/** A new password's problem, or null when it will do. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'Enter a password';
  if ([...password].length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return 'Use a shorter password';
  return null;
}

/**
 * The magic-link, password reset and confirmation-resend requests: an email and a redirect on this
 * site's own origin.
 */
export function otpRequest(body: unknown, origin: string): Parsed<{ email: string; redirectTo: string }> {
  if (!objectBody(body)) return NOT_OBJECT;
  const { email, redirectTo, ...rest } = body;
  if (Object.keys(rest).length > 0) return { ok: false, status: 400, error: 'Send only email and redirectTo' };
  const address = emailOf(email);
  if (address === null) return { ok: false, status: 400, error: 'Enter a valid email address' };
  const target = sameOrigin(redirectTo, origin);
  if (target === null) return { ok: false, status: 400, error: 'redirectTo must be a page on this site' };
  return { ok: true, value: { email: address, redirectTo: target } };
}

/** Sign-up: an email, a new password and the page the confirmation link lands on. */
export function signupRequest(body: unknown, origin: string): Parsed<{ email: string; password: string; redirectTo: string }> {
  if (!objectBody(body)) return NOT_OBJECT;
  const { password, ...rest } = body;
  const base = otpRequest(rest, origin);
  if (!base.ok) return base;
  const problem = passwordProblem(password);
  if (problem !== null) return { ok: false, status: 400, error: problem };
  return { ok: true, value: { ...base.value, password: password as string } };
}

/** Password sign-in: an email and the password. Its length is Supabase's to judge, not this one's. */
export function passwordRequest(body: unknown): Parsed<{ email: string; password: string }> {
  if (!objectBody(body)) return NOT_OBJECT;
  const { email, password, ...rest } = body;
  if (Object.keys(rest).length > 0) return { ok: false, status: 400, error: 'Send only email and password' };
  const address = emailOf(email);
  if (address === null) return { ok: false, status: 400, error: 'Enter a valid email address' };
  if (typeof password !== 'string' || password === '' || password.length > 256) return { ok: false, status: 400, error: 'Enter your password' };
  return { ok: true, value: { email: address, password } };
}

/** A signed-in player's new password (after a reset link, or from their desk). */
export function newPasswordRequest(body: unknown): Parsed<string> {
  if (!objectBody(body)) return NOT_OBJECT;
  const { password, ...rest } = body;
  if (Object.keys(rest).length > 0) return { ok: false, status: 400, error: 'Send only password' };
  const problem = passwordProblem(password);
  if (problem !== null) return { ok: false, status: 400, error: problem };
  return { ok: true, value: password as string };
}

/** Continue with a provider: one of OAUTH_PROVIDERS and a page on this site to come back to. */
export function authorizeRequest(params: URLSearchParams, origin: string): Parsed<{ provider: OAuthProvider; redirectTo: string }> {
  const bad = only(params, ['provider', 'redirectTo']);
  if (bad) return { ok: false, status: 400, error: bad };
  const provider = params.get('provider') ?? '';
  if (!(OAUTH_PROVIDERS as readonly string[]).includes(provider)) return { ok: false, status: 400, error: 'Unknown provider' };
  const target = sameOrigin(params.get('redirectTo'), origin);
  if (target === null) return { ok: false, status: 400, error: 'redirectTo must be a page on this site' };
  return { ok: true, value: { provider: provider as OAuthProvider, redirectTo: target } };
}

/**
 * What the site may know of Supabase Auth's public settings: whether email sign-in takes new players
 * (signIn), and which of OAUTH_PROVIDERS are switched on. Nothing else of the settings leaves.
 */
export function publicAuthSettings(settings: unknown): { signIn: boolean; providers: OAuthProvider[] } {
  const record = objectBody(settings) ? settings : {};
  const external = objectBody(record.external) ? record.external : {};
  const open = record.disable_signup !== true;
  return {
    signIn: external.email === true && open,
    providers: open ? OAUTH_PROVIDERS.filter((provider) => external[provider] === true) : [],
  };
}

/** The token answer a sign-in returns to the page: the three fields the session keeps, or null. */
export function sessionFields(body: unknown): { access_token: string; refresh_token: string; expires_in: number } | null {
  if (!objectBody(body) || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') return null;
  return { access_token: body.access_token, refresh_token: body.refresh_token, expires_in: Number(body.expires_in) || 3600 };
}

/** Supabase Auth's error code (weak_password, email_not_confirmed, ...), or null. */
export function errorCode(body: unknown): string | null {
  if (!objectBody(body)) return null;
  const code = body.error_code ?? body.code ?? body.error;
  return typeof code === 'string' && /^[a-z_]{1,60}$/.test(code) ? code : null;
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
  /** Each key's hits in its window, in the order keys were last seen: the oldest first. */
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /** The most keys kept, so a flood of addresses cannot grow the map without end. */
    private readonly maxKeys = 10_000,
  ) {}

  /** How many keys the limiter holds now. */
  get size(): number {
    return this.hits.size;
  }

  allow(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    const allowed = recent.length < this.limit;
    if (allowed) recent.push(now);
    // Delete then set, so the key moves to the end of the map's order: the map stays oldest first.
    this.hits.delete(key);
    this.hits.set(key, recent);
    this.evict(now);
    return allowed;
  }

  /**
   * Over the cap, drop from the oldest end: every key whose window has ended, then the oldest keys
   * still in theirs until the map is back at the cap. It stops at the first key it keeps, so it never
   * empties the map and never resets an address that was seen recently. Hits come in time order
   * (Date.now()), so the keys whose windows ended are the ones at the oldest end.
   */
  private evict(now: number): void {
    if (this.hits.size <= this.maxKeys) return;
    for (const [key, times] of this.hits) {
      const expired = times.length === 0 || now - times[times.length - 1]! >= this.windowMs;
      if (!expired && this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
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
