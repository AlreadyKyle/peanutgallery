import { useEffect, useState } from 'react';

// Whether a visitor can make a profile now (docs/specs/place.md): the community function reads
// Supabase Auth's public settings (/api/community/auth/settings). While email sign-in is off, the
// site drops its profile prompts (Sign in, Make a free profile, Keep this card, Pitch an idea)
// rather than send people to a form that then says it is closed. Paying never needs an account, so
// nothing about money waits on this. The same answer names the sign-in providers that are switched on
// (docs/specs/accounts.md), so a Continue with button shows only once its provider works. Kernel, so
// the perks panel on /contribute and /thanks may read it: it imports only React and reads only the
// site's own origin.

const URL = '/api/community/auth/settings';
const KEY = 'mm:sign-in-open';
const PROVIDERS_KEY = 'mm:sign-in-providers';

/** The providers a button may be drawn for; any other name in the answer is ignored. */
const KNOWN_PROVIDERS = ['google', 'apple', 'github', 'discord'];

let known: boolean | null = null;
let knownProviders: string[] | null = null;
let asking: Promise<boolean | null> | null = null;

function providersFrom(value: unknown): string[] | null {
  return Array.isArray(value) ? KNOWN_PROVIDERS.filter((name) => value.includes(name)) : null;
}

function storedProviders(): string[] | null {
  try {
    const value = window.localStorage.getItem(PROVIDERS_KEY);
    return value === null ? null : providersFrom(JSON.parse(value));
  } catch {
    return null;
  }
}

function stored(): boolean | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
}

function ask(): Promise<boolean | null> {
  asking ??= fetch(URL, { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !type.includes('application/json')) return null;
      const body = (await response.json()) as { signIn?: unknown; providers?: unknown };
      const providers = providersFrom(body.providers);
      if (providers !== null) {
        knownProviders = providers;
        try {
          window.localStorage.setItem(PROVIDERS_KEY, JSON.stringify(providers));
        } catch {
          // Without storage the next page asks again.
        }
      }
      return typeof body.signIn === 'boolean' ? body.signIn : null;
    })
    .catch(() => null)
    .then((answer) => {
      if (answer !== null) {
        known = answer;
        try {
          window.localStorage.setItem(KEY, answer ? '1' : '0');
        } catch {
          // Without storage the next page asks again.
        }
      }
      return answer;
    });
  return asking;
}

/**
 * True unless the studio said sign-in is closed. Starts from this tab's answer, then the last one this
 * browser stored, and asks once a tab. A first visit draws no prompt until the answer comes, so while
 * sign-in is closed nothing appears and then vanishes, and the top bar holds still. An answer that
 * does not come counts as open: the sign-in form still says so when it is not.
 */
export function useSignInOpen(): boolean {
  return useSignInAnswer() ?? false;
}

/**
 * The same answer with its third state: true or false once known (this tab's, else the last one this
 * browser stored), null while a first visit waits for it. A page whose body is the sign-in form (/me
 * signed out, /sign-up) draws the form while it waits, as no answer counts as open, so the page is
 * laid out once rather than drawn closed and then redrawn open.
 */
export function useSignInAnswer(): boolean | null {
  const [answer, setAnswer] = useState<boolean | null>(() => known ?? stored());
  useEffect(() => {
    let live = true;
    void ask().then((value) => {
      if (live) setAnswer(value ?? true);
    });
    return () => {
      live = false;
    };
  }, []);
  return answer;
}

/**
 * The sign-in providers switched on in Supabase Auth, in the order the buttons are drawn. Starts from
 * this tab's answer or the last one stored, and is empty until an answer says otherwise, so a button
 * never shows for a provider that is off.
 */
export function useSignInProviders(): readonly string[] {
  const [providers, setProviders] = useState<readonly string[]>(() => knownProviders ?? storedProviders() ?? []);
  useEffect(() => {
    let live = true;
    void ask().then(() => {
      if (live && knownProviders !== null) setProviders(knownProviders);
    });
    return () => {
      live = false;
    };
  }, []);
  return providers;
}

/** For tests: forget this tab's answer. */
export function resetSignInOpen(): void {
  known = null;
  knownProviders = null;
  asking = null;
}
