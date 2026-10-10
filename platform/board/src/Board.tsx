import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState, type FormEvent } from 'react';
import { fetchBoardRole, sendMagicLink, type BoardRole } from './lib/board';
import { errorMessage, getClient } from './lib/supabase';
import { Panel } from './Panel';
import { PauseControls } from './Status';
import { TwoFactor } from './TwoFactor';

export { CANCEL_CONFIRM } from './Actions';
export { SECOND_FACTOR_LINE } from './TwoFactor';

const noDatabase = 'The site has no database configuration, so board sign-in is unavailable.';
/** Under the heading on every screen: what this site is, in one line (docs/specs/optional-board.md). */
export const BOARD_LEDE =
  "The board's site is an optional admin panel; the studio runs without it. Here the board checks the studio's status and recent activity, and can pause the agents or act on a card.";
export const NOT_ON_BOARD = 'This email is not on the board, so there is nothing to show. Sign out and sign in with your board email.';

export function Board() {
  const client = getClient();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (client === null) return;
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [client]);

  return (
    <main>
      <div className="hero">
        <h1>Mob Machine board</h1>
        <p className="lede">{BOARD_LEDE}</p>
      </div>
      {client === null || session === null ? <SignIn client={client} /> : <SignedIn client={client} email={session.user.email ?? ''} />}
    </main>
  );
}

function SignIn({ client }: { client: SupabaseClient | null }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (client === null) {
      setMessage(noDatabase);
      return;
    }
    setBusy(true);
    try {
      await sendMagicLink(client, email.trim());
      setMessage(`Check ${email.trim()} for your sign-in link, and open it in this browser.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Board sign-in">
      <h2>Board sign-in</h2>
      <p>
        For board members only. Enter your board email and we send you a one-time sign-in link. After it, a 6-digit code
        from your authenticator app unlocks the controls.
      </p>
      <form className="stack" onSubmit={submit} aria-label="Sign in">
        <label>
          Board email
          <input type="email" name="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <button type="submit" aria-disabled={busy}>
          Email me a sign-in link
        </button>
        {message === '' ? null : <p role="status">{message}</p>}
      </form>
    </section>
  );
}

/**
 * Routes a signed-in session: no membership shows a line and calls nothing more; the moderator gets
 * Pause at the first factor; a board member sees only the code step until aal2, then the panel.
 */
function SignedIn({ client, email }: { client: SupabaseClient; email: string }) {
  const [role, setRole] = useState<BoardRole | null | 'pending'>('pending');
  const [roleError, setRoleError] = useState('');
  const [secondFactor, setSecondFactor] = useState(false);

  useEffect(() => {
    let live = true;
    fetchBoardRole(client)
      .then((value) => {
        if (live) setRole(value);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setRole(null);
        setRoleError(errorMessage(error));
      });
    return () => {
      live = false;
    };
  }, [client]);

  return (
    <>
      <p>
        Signed in as {email}.{' '}
        <button type="button" className="link" onClick={() => void client.auth.signOut()}>
          Sign out
        </button>
      </p>
      {role === 'pending' ? <p>Checking board membership.</p> : null}
      {role === null ? <p role="status">{roleError === '' ? NOT_ON_BOARD : roleError}</p> : null}
      {role === 'moderator' ? <PauseControls client={client} /> : null}
      {role === 'board' ? secondFactor ? <Panel client={client} /> : <TwoFactor client={client} onVerified={setSecondFactor} /> : null}
    </>
  );
}
