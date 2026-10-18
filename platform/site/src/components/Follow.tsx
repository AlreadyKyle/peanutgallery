import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { sendMagicLink, useSignedIn } from '../lib/account';
import { CommunityError } from '../lib/community';
import { copy } from '../lib/copy';
import { clearPendingFollow, followable, followCard, pendingFollow, rememberPendingFollow, unfollowCard, useFollows } from '../lib/follows';
import { Glyph } from './Glyph';

// "Tell me when this ships" on a card's page (docs/specs/card-follows.md). Signed in, it is a toggle
// (aria-pressed, the check glyph when pressed) that follows or unfollows the card. Signed out, it
// opens the magic-link sign-in under it; the card is kept in this browser, and /me sends the player
// back here, where the follow is made once. When sign-in is not available the form says so, as /me's
// does, and the rest of the page is unchanged. A card that shipped or was turned down shows nothing.

const words = copy.follow;

type Status = 'idle' | 'busy' | 'following' | 'unfollowed' | 'failed';

function SignIn({ cardId }: { cardId: string }) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setState('sending');
    rememberPendingFollow(cardId);
    // The link lands on /me, the address sign-in is set up for; /me sends the player back here.
    sendMagicLink(email.trim(), `${window.location.origin}/me`)
      .then(() => setState('sent'))
      .catch(() => {
        clearPendingFollow();
        setState('error');
      });
  };
  return (
    <form className="form" onSubmit={submit} id={`${id}-form`}>
      <p className="small">{words.signInBody}</p>
      <label htmlFor={`${id}-email`}>{copy.me.emailLabel}</label>
      <input id={`${id}-email`} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
      <p>
        <button type="submit" className="button" disabled={state === 'sending'}>
          {state === 'sending' ? copy.me.sending : copy.me.send}
        </button>
      </p>
      <p role="status" className="small">
        {state === 'sent' ? words.sentBody : state === 'error' ? copy.me.closed : ''}
      </p>
    </form>
  );
}

export function FollowCard({ cardId, stage }: { cardId: string; stage: string }) {
  const signedIn = useSignedIn();
  const follows = useFollows();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [mine, setMine] = useState<boolean | null>(null);
  const pendingDone = useRef(false);
  const formId = useId();
  const listed = follows.state === 'ready' ? follows.follows.some((f) => f.cardId === cardId) : false;
  const following = mine ?? listed;

  const act = (follow: boolean) => {
    setStatus('busy');
    (follow ? followCard(cardId) : unfollowCard(cardId))
      .then(() => {
        setMine(follow);
        setStatus(follow ? 'following' : 'unfollowed');
      })
      .catch((error: unknown) => {
        // A session that ran out reads as signed out; the button then offers sign-in again.
        if (error instanceof CommunityError && error.status === 401) {
          setStatus('idle');
          return;
        }
        setStatus('failed');
      });
  };

  // Back from the magic link with this card waiting: follow it once.
  useEffect(() => {
    if (!signedIn || pendingDone.current || follows.state === 'loading' || follows.state === 'signed-out') return;
    if (pendingFollow() !== cardId) return;
    pendingDone.current = true;
    clearPendingFollow();
    if (listed) {
      setStatus('following');
      return;
    }
    // The ref keeps it to one call.
    act(true);
  }, [signedIn, follows.state, listed, cardId]);

  if (!followable(stage)) return null;

  if (!signedIn) {
    return (
      <div className="follow" data-follow={cardId}>
        <p>
          <button type="button" className="button button-secondary" aria-expanded={open} aria-controls={open ? formId : undefined} onClick={() => setOpen((was) => !was)}>
            {words.button}
          </button>
        </p>
        {open ? (
          <div id={formId}>
            <SignIn cardId={cardId} />
          </div>
        ) : (
          <p className="small muted">{words.hint}</p>
        )}
      </div>
    );
  }

  const busy = status === 'busy' || follows.state === 'loading';
  return (
    <div className="follow" data-follow={cardId}>
      <p>
        <button type="button" className="button button-secondary" aria-pressed={following} disabled={busy} onClick={() => act(!following)}>
          {following ? <Glyph name="check" /> : null}
          {words.button}
        </button>
      </p>
      <p role="status" className="small">
        {status === 'following' ? words.following : status === 'unfollowed' ? words.unfollowed : status === 'failed' ? words.failed : following ? words.following : words.hint}
      </p>
    </div>
  );
}
