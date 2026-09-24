import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Kernel (docs/specs/supporter-pages.md): where Stripe's redirect lands, /thanks?session=cs_…. The
// page takes the session only when it is well formed, keeps it in sessionStorage, takes it out of
// the address at once and asks /api/thanks (netlify/functions/card.mts, thanks_for_session) what the
// payment did. No answer holds an amount, an email or a name, and a session the studio has not
// recorded reads the same as one that does not exist.

export const THANKS_URL = '/api/thanks';
export const THANKS_PATH = '/thanks';
export const SESSION_PATTERN = /^cs_(live|test)_[A-Za-z0-9]{10,250}$/;
export const SESSION_KEY = 'peanutgallery.thanks.session';
/** Ask again this often while the payment is not yet recorded. */
export const POLL_MS = 5_000;
/**
 * Stop asking after this long and say Stripe has the payment. The one measured payment took about 79
 * seconds from checkout to the studio's books (docs/specs/supporter-pages.md).
 */
export const GIVE_UP_MS = 180_000;
export const REQUEST_TIMEOUT_MS = 10_000;

export type ThanksAnswer =
  | { status: 'pending' }
  | { status: 'not_counted' }
  | {
      status: 'recorded';
      supporter: { number: number; founding: boolean } | null;
      namedCardId: string | null;
      /** At most five card ids the money reached, the named card first. */
      reached: string[];
      /** Some of the money waits in Not on a card yet. */
      waiting: boolean;
      credit: 'credited' | 'held' | 'reversed';
      /** The New York day a hold ends, YYYY-MM-DD; null when not held. */
      heldUntil: string | null;
      termsVersion: number | null;
    };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function valid(session: string | null | undefined): session is string {
  return typeof session === 'string' && SESSION_PATTERN.test(session);
}

/**
 * The session to ask about: from the address when it carries a well-formed one (stored for a
 * reload), else the one stored earlier in this tab, else null. When the address names any session
 * the page replaces it with /thanks, so the id never stays in the address bar or in history.
 */
export function readThanksSession(search: string, storage: StorageLike | null, replace: (path: string) => void): string | null {
  const params = new URLSearchParams(search);
  if (params.has('session')) {
    const fromAddress = params.get('session');
    if (valid(fromAddress)) {
      try {
        storage?.setItem(SESSION_KEY, fromAddress);
      } catch {
        // Storage can be blocked; the page still asks about the session it was given.
      }
    }
    replace(THANKS_PATH);
    if (valid(fromAddress)) return fromAddress;
  }
  try {
    const stored = storage?.getItem(SESSION_KEY) ?? null;
    return valid(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** The answer's fixed keys, parsed; throws on anything else. */
export function thanksAnswerFrom(value: unknown): ThanksAnswer {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Malformed /api/thanks answer');
  const row = value as Record<string, unknown>;
  if (row.status === 'pending' || row.status === 'not_counted') return { status: row.status };
  if (row.status !== 'recorded') throw new Error(`Unexpected /api/thanks status: ${String(row.status)}`);
  const supporter = row.supporter as Record<string, unknown> | null | undefined;
  const credit = row.credit === 'held' || row.credit === 'reversed' ? row.credit : 'credited';
  const reached = Array.isArray(row.reached) ? row.reached.filter((id): id is string => typeof id === 'string').slice(0, 5) : [];
  return {
    status: 'recorded',
    supporter:
      supporter && typeof supporter.number === 'number' ? { number: supporter.number, founding: supporter.founding === true } : null,
    namedCardId: typeof row.named_card_id === 'string' ? row.named_card_id : null,
    reached,
    waiting: row.waiting === true,
    credit,
    heldUntil: typeof row.held_until === 'string' ? row.held_until : null,
    termsVersion: typeof row.terms_version === 'number' ? row.terms_version : null,
  };
}

/** Asks /api/thanks about one session; rejects on a status other than 200 or a malformed answer. */
export async function postThanks(session: string, fetchFn: typeof fetch = fetch, timeoutMs = REQUEST_TIMEOUT_MS): Promise<ThanksAnswer> {
  const response = await fetchFn(THANKS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ session }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${THANKS_URL} answered ${response.status}`);
  return thanksAnswerFrom((await response.json()) as unknown);
}

export type ThanksState =
  /** No session: a plain thank-you. */
  | { kind: 'none' }
  /** Asking every 5 seconds. */
  | { kind: 'pending' }
  /** Not recorded after 3 minutes: Stripe has the payment and the books will catch up. */
  | { kind: 'fallback' }
  | { kind: 'not_counted' }
  | { kind: 'recorded'; answer: Extract<ThanksAnswer, { status: 'recorded' }> };

function sessionStore(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * /thanks's state: reads the session once, then asks every 5 seconds until the payment is recorded
 * or 3 minutes have passed. A failed request counts as not yet recorded.
 */
export function useThanks(fetchFn: typeof fetch = fetch): ThanksState {
  const navigate = useNavigate();
  // Read once, on the first render; the address is replaced straight after it, in an effect.
  const [read] = useState(() => {
    let replaceWith: string | null = null;
    const session = readThanksSession(window.location.search, sessionStore(), (path) => {
      replaceWith = path;
    });
    return { session, replaceWith: replaceWith as string | null };
  });
  const session = read.session;
  const [state, setState] = useState<ThanksState>(session === null ? { kind: 'none' } : { kind: 'pending' });

  useEffect(() => {
    if (read.replaceWith !== null) navigate(read.replaceWith, { replace: true });
  }, [read, navigate]);

  useEffect(() => {
    if (session === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const ask = () => {
      postThanks(session, fetchFn)
        .catch((): ThanksAnswer => ({ status: 'pending' }))
        .then((answer) => {
          if (!live) return;
          if (answer.status === 'recorded') setState({ kind: 'recorded', answer });
          else if (answer.status === 'not_counted') setState({ kind: 'not_counted' });
          else if (Date.now() - started + POLL_MS > GIVE_UP_MS) setState({ kind: 'fallback' });
          else timer = setTimeout(ask, POLL_MS);
        });
    };
    ask();
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [session, fetchFn]);

  return state;
}
