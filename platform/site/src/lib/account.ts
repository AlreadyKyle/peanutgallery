import { useCallback, useEffect, useState } from 'react';
import { COMMUNITY_API, type Profile } from './community-types';
import { CommunityError } from './community';

// A player's account (docs/specs/final-state.md, Identity and anonymity). An account is optional;
// contributing never needs one. Sign-in is a magic link. The page holds no Supabase client and
// talks only to its own origin (the CSP's connect-src is 'self'): the community function sends the
// link, refreshes the session and runs the player's RPCs under their token. The link lands on /me
// with the session in the address's fragment, which this module reads once and clears.

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

/** Takes a session from the address bar, if the magic link put one there, and clears it from history. */
export function adoptSessionFromLocation(): boolean {
  if (typeof window === 'undefined' || !window.location.hash.includes('access_token')) return false;
  const session = sessionFromHash(window.location.hash);
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (session === null) return false;
  writeSession(session);
  return true;
}

/** Why a magic link did not sign the player in: it expired (or was used already), or it failed. */
export type LinkError = 'expired' | 'failed';

/** Reads a failed magic link's fragment (#error=access_denied&error_code=otp_expired&error_description=…). */
export function linkErrorFromHash(hash: string): LinkError | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get('error_code');
  if (params.get('error') === null && code === null) return null;
  return code === 'otp_expired' ? 'expired' : 'failed';
}

/** Takes a failed magic link's error from the address bar, if there is one, and clears it from history. */
export function adoptLinkErrorFromLocation(): LinkError | null {
  if (typeof window === 'undefined') return null;
  const error = linkErrorFromHash(window.location.hash);
  if (error !== null) history.replaceState(null, '', window.location.pathname + window.location.search);
  return error;
}

export function signOut(): void {
  writeSession(null);
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
  if (!response.ok || !type.includes('application/json')) throw new CommunityError(`status ${response.status}`, response.status);
  return (await response.json()) as T;
}

export async function sendMagicLink(email: string, redirectTo: string): Promise<void> {
  await post('/auth/otp', { email, redirectTo });
}

async function freshToken(): Promise<string | null> {
  const session = readSession();
  if (session === null) return null;
  if (session.expiresAt - Date.now() > 60_000) return session.accessToken;
  try {
    const next = await post<{ access_token: string; refresh_token: string; expires_in: number }>('/auth/refresh', { refresh_token: session.refreshToken });
    const renewed = { accessToken: next.access_token, refreshToken: next.refresh_token, expiresAt: Date.now() + next.expires_in * 1000 };
    writeSession(renewed);
    return renewed.accessToken;
  } catch {
    writeSession(null);
    return null;
  }
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

export function useMyProfile(): MyProfile & { reload: () => void } {
  const signedIn = useSignedIn();
  const [state, setState] = useState<MyProfile>(signedIn ? { state: 'loading' } : { state: 'signed-out' });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    if (!signedIn) {
      setState({ state: 'signed-out' });
      return;
    }
    let live = true;
    setState((was) => (was.state === 'ready' ? was : { state: 'loading' }));
    rpc<Profile>('my_profile')
      .then((profile) => live && setState({ state: 'ready', profile }))
      .catch((error: unknown) => {
        if (!live) return;
        setState(error instanceof CommunityError && error.status === 401 ? { state: 'signed-out' } : { state: 'unavailable' });
      });
    return () => {
      live = false;
    };
  }, [signedIn, nonce]);
  return { ...state, reload };
}
