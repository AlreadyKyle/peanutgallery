import { useCallback, useEffect, useState } from 'react';
import { COMMUNITY_API, type Profile } from './community-types';
import { CommunityError } from './community';

// A player's account (docs/specs/final-state.md, Identity and anonymity; docs/specs/accounts.md). An
// account is optional; contributing never needs one. A player signs up with an email and a password
// (confirmed by a link), or continues with a provider (Google, Apple, GitHub, Discord) once it is on,
// or asks for a one-time sign-in link. The page holds no Supabase client and talks only to its own
// origin (the CSP's connect-src is 'self'): the community function signs in, sends the emails,
// refreshes the session and runs the player's RPCs under their token. A link or a provider lands on
// /me with the session in the address's fragment, which this module reads once and clears.

const KEY = 'mm:player-session';

export type Session = { accessToken: string; refreshToken: string; expiresAt: number };

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readSession(): Session | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    return parsed as Session;
  } catch {
    return null;
  }
}

function writeSession(session: Session | null): void {
  try {
    if (session === null) storage()?.removeItem(KEY);
    else storage()?.setItem(KEY, JSON.stringify(session));
  } catch {
    // Private windows may refuse storage; the session then lasts for this page only.
  }
  window.dispatchEvent(new Event('mm:session'));
}

/** Reads a session from a magic link's fragment (#access_token=…&refresh_token=…&expires_in=…). */
export function sessionFromHash(hash: string, now = Date.now()): Session | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const expiresIn = Number(params.get('expires_in') ?? '3600');
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, expiresAt: now + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000 };
}

/** What a fragment's session came from: a password reset link (recovery), else any other sign-in. */
export type Arrival = 'recovery' | 'sign-in';

let arrived: Arrival | null = null;

/** Takes a session from the address bar, if a link or a provider put one there, and clears it from history. */
export function adoptSessionFromLocation(): boolean {
  if (typeof window === 'undefined' || !window.location.hash.includes('access_token')) return false;
  const session = sessionFromHash(window.location.hash);
  const type = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('type');
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (session === null) return false;
  arrived = type === 'recovery' ? 'recovery' : 'sign-in';
  writeSession(session);
  return true;
}

/** How the last adopted session arrived, read once (a reset link sends the player to choose a password). */
export function takeArrival(): Arrival | null {
  const was = arrived;
  arrived = null;
  return was;
}

/** Why a magic link did not sign the player in: it expired (or was used already), or it failed. */
export type LinkError = 'expired' | 'failed';

/** Reads a failed link's or provider's answer (#error=access_denied&error_code=otp_expired&error_description=…). */
export function linkErrorFromHash(hash: string): LinkError | null {
  const params = new URLSearchParams(hash.replace(/^[#?]/, ''));
  const code = params.get('error_code');
  if (params.get('error') === null && code === null) return null;
  return code === 'otp_expired' ? 'expired' : 'failed';
}

/**
 * Takes a failed link's error from the address bar, if there is one, and clears it from history. A
 * provider may put it in the query rather than the fragment.
 */
export function adoptLinkErrorFromLocation(): LinkError | null {
  if (typeof window === 'undefined') return null;
  const inHash = linkErrorFromHash(window.location.hash);
  const inQuery = inHash === null ? linkErrorFromHash(window.location.search) : null;
  if (inHash !== null) history.replaceState(null, '', window.location.pathname + window.location.search);
  else if (inQuery !== null) history.replaceState(null, '', window.location.pathname);
  return inHash ?? inQuery;
}

const RETURN = 'mm:return-to';

/** Remembers the page a player left to sign in from, so the magic link's landing on /me sends them back. */
export function rememberReturn(path: string): void {
  if (!/^\/[A-Za-z0-9/_#?=&-]*$/.test(path) || path.startsWith('//')) return;
  try {
    storage()?.setItem(RETURN, path);
  } catch {
    // Without storage the player lands on their desk, which is fine.
  }
}

/** The page to go back to after signing in, read once. */
export function takeReturn(): string | null {
  try {
    const path = storage()?.getItem(RETURN) ?? null;
    storage()?.removeItem(RETURN);
    return path !== null && /^\/[A-Za-z0-9/_#?=&-]*$/.test(path) && !path.startsWith('//') ? path : null;
  } catch {
    return null;
  }
}

const CLAIM = 'mm:pending-claim';

/** /thanks's Keep this card: after the magic link, /me claims the player's guest contributions at once. */
export function rememberClaim(): void {
  try {
    storage()?.setItem(CLAIM, '1');
  } catch {
    // Without storage the player presses Claim on their desk instead.
  }
}

export function takeClaim(): boolean {
  try {
    const pending = storage()?.getItem(CLAIM) === '1';
    storage()?.removeItem(CLAIM);
    return pending;
  } catch {
    return false;
  }
}

/** Signs out here at once, and ends the session on the server too (best effort). */
export function signOut(): void {
  const session = readSession();
  held = null;
  writeSession(null);
  if (session !== null) void post('/auth/signout', {}, session.accessToken).catch(() => undefined);
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${COMMUNITY_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CommunityError('offline', null);
  }
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.includes('application/json')) {
    let code: string | null = null;
    if (type.includes('application/json')) {
      const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
      code = typeof body?.code === 'string' ? body.code : null;
    }
    throw new CommunityError(`status ${response.status}`, response.status, code);
  }
  return (await response.json()) as T;
}

/** Where every emailed link and provider sign-in lands: /me, which reads the session and sends the player on. */
export function landingUrl(): string {
  return `${window.location.origin}/me`;
}

export async function sendMagicLink(email: string, redirectTo: string = landingUrl()): Promise<void> {
  await post('/auth/otp', { email, redirectTo });
}

type TokenAnswer = { access_token: string; refresh_token: string; expires_in: number };

function keep(answer: TokenAnswer): void {
  writeSession({ accessToken: answer.access_token, refreshToken: answer.refresh_token, expiresAt: Date.now() + answer.expires_in * 1000 });
}

/** Signs in with an email and password; the session is kept at once. */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  keep(await post<TokenAnswer>('/auth/password', { email, password }));
}

/**
 * Makes an account. 'confirm' while the studio asks for the email to be confirmed (the link in the
 * email signs the player in on /me), else the player is signed in at once.
 */
export async function signUp(email: string, password: string): Promise<'confirm' | 'signed-in'> {
  const answer = await post<Partial<TokenAnswer> & { confirm?: boolean }>('/auth/signup', { email, password, redirectTo: landingUrl() });
  if (typeof answer.access_token === 'string' && typeof answer.refresh_token === 'string') {
    keep({ access_token: answer.access_token, refresh_token: answer.refresh_token, expires_in: Number(answer.expires_in) || 3600 });
    return 'signed-in';
  }
  return 'confirm';
}

/** Emails a link that signs the player in to choose a new password. */
export async function sendPasswordReset(email: string): Promise<void> {
  await post('/auth/recover', { email, redirectTo: landingUrl() });
}

/** Emails the account's confirmation link again. */
export async function resendConfirmation(email: string): Promise<void> {
  await post('/auth/resend', { email, redirectTo: landingUrl() });
}

/** Sets the signed-in player's password (after a reset link, or from their desk). */
export async function setNewPassword(password: string): Promise<void> {
  const token = await freshToken();
  if (token === null) throw new CommunityError('signed out', 401, 'signed-out');
  await post('/auth/new-password', { password }, token);
}

/** The sign-in providers the site has a button for. */
export const PROVIDERS = ['google', 'apple', 'github', 'discord'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Continue with a provider: the community function sends the player on to it, and it comes back to /me. */
export function providerUrl(provider: Provider): string {
  return `${COMMUNITY_API}/auth/authorize?provider=${provider}&redirectTo=${encodeURIComponent(landingUrl())}`;
}

/** The shortest password sign-up takes (the function and Supabase hold the same floor). */
export const PASSWORD_MIN = 8;

/** The refresh in flight, so readers that ask at once spend the refresh token once, not in a race. */
let refreshing: Promise<string | null> | null = null;

async function freshToken(): Promise<string | null> {
  const session = readSession();
  if (session === null) return null;
  if (session.expiresAt - Date.now() > 60_000) return session.accessToken;
  refreshing ??= post<{ access_token: string; refresh_token: string; expires_in: number }>('/auth/refresh', { refresh_token: session.refreshToken })
    .then((next) => {
      const renewed = { accessToken: next.access_token, refreshToken: next.refresh_token, expiresAt: Date.now() + next.expires_in * 1000 };
      writeSession(renewed);
      return renewed.accessToken;
    })
    .catch(() => {
      writeSession(null);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** One of the player's RPCs (community-types.ts), under their session. */
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const token = await freshToken();
  if (token === null) throw new CommunityError('signed out', 401);
  return post<T>(`/rpc/${name}`, args, token);
}

/** Whether a player is signed in, kept in step across the tab. */
export function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(() => readSession() !== null);
  useEffect(() => {
    const update = () => setSignedIn(readSession() !== null);
    window.addEventListener('mm:session', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('mm:session', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return signedIn;
}

export type MyProfile = { state: 'signed-out' } | { state: 'loading' } | { state: 'ready'; profile: Profile } | { state: 'unavailable' };

/**
 * The last profile read in this tab, shared by every reader (the top bar's you slot, home's panel and
 * /me), so moving between pages draws the player at once and asks the server again in the background
 * instead of on every reader's first paint. A new session, or signing out, drops it.
 */
let held: { token: string; profile: Profile } | null = null;

/** Said on the window when a new profile is held, so every reader (the you slot too) draws it. */
const PROFILE_EVENT = 'mm:profile';

/** The my_profile read in flight, shared by readers that mount together; a reload asks afresh. */
let asking: Promise<Profile> | null = null;

function heldProfile(): Profile | null {
  const session = readSession();
  return session !== null && held !== null && held.token === session.refreshToken ? held.profile : null;
}

function askProfile(fresh: boolean): Promise<Profile> {
  if (asking !== null && !fresh) return asking;
  const promise = rpc<Profile>('my_profile').then((profile) => {
    const session = readSession();
    if (session !== null) {
      held = { token: session.refreshToken, profile };
      window.dispatchEvent(new Event(PROFILE_EVENT));
    }
    return profile;
  });
  asking = promise;
  const clear = () => {
    if (asking === promise) asking = null;
  };
  promise.then(clear, clear);
  return promise;
}

export function useMyProfile(): MyProfile & { reload: () => void } {
  const signedIn = useSignedIn();
  const [state, setState] = useState<MyProfile>(() => {
    if (!signedIn) return { state: 'signed-out' };
    const profile = heldProfile();
    return profile === null ? { state: 'loading' } : { state: 'ready', profile };
  });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    if (!signedIn) {
      held = null;
      setState({ state: 'signed-out' });
      return;
    }
    let live = true;
    const ready = heldProfile();
    setState((was) => (was.state === 'ready' ? was : ready === null ? { state: 'loading' } : { state: 'ready', profile: ready }));
    // Another reader's fresh read (a save or a claim on /me) redraws this one too.
    const update = () => {
      const profile = heldProfile();
      if (live && profile !== null) setState({ state: 'ready', profile });
    };
    window.addEventListener(PROFILE_EVENT, update);
    askProfile(nonce > 0)
      .then((profile) => {
        if (live) setState({ state: 'ready', profile });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setState(error instanceof CommunityError && error.status === 401 ? { state: 'signed-out' } : { state: 'unavailable' });
      });
    return () => {
      live = false;
      window.removeEventListener(PROFILE_EVENT, update);
    };
  }, [signedIn, nonce]);
  return { ...state, reload };
}
