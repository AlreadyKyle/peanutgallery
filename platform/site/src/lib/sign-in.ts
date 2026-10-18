import { useEffect, useState } from 'react';

// Whether a visitor can make a profile now (docs/specs/place.md): the community function reads
// Supabase Auth's public settings (/api/community/auth/settings). While email sign-in is off, the
// site drops its profile prompts (Sign in, Make a free profile, Keep this card, Pitch an idea)
// rather than send people to a form that then says it is closed. Paying never needs an account, so
// nothing about money waits on this. Kernel, so the perks panel on /contribute and /thanks may read
// it: it imports only React and reads only the site's own origin.

const URL = '/api/community/auth/settings';
const KEY = 'mm:sign-in-open';

let known: boolean | null = null;
let asking: Promise<boolean | null> | null = null;

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
      const body = (await response.json()) as { signIn?: unknown };
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
 * browser stored, and asks once a tab. An answer that does not come counts as open: the sign-in form
 * still says so when it is not.
 */
export function useSignInOpen(): boolean {
  const [open, setOpen] = useState<boolean>(() => known ?? stored() ?? true);
  useEffect(() => {
    let live = true;
    void ask().then((answer) => {
      if (live && answer !== null) setOpen(answer);
    });
    return () => {
      live = false;
    };
  }, []);
  return open;
}

/** For tests: forget this tab's answer. */
export function resetSignInOpen(): void {
  known = null;
  asking = null;
}
