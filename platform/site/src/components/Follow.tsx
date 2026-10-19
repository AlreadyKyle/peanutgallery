import { useEffect, useId, useRef, useState } from 'react';
import { useSignedIn } from '../lib/account';
import { claimInBackground } from '../lib/arrive';
import { CommunityError } from '../lib/community';
import { copy } from '../lib/copy';
import { clearPendingFollow, followable, followCard, pendingFollow, rememberPendingFollow, unfollowCard, useFollows } from '../lib/follows';
import { useSignInOpen } from '../lib/sign-in';
import { AuthForm } from './AuthForm';
import { Glyph } from './Glyph';

// "Tell me when this ships" on a card's page (docs/specs/card-follows.md). Signed in, it is a toggle
// (aria-pressed, the check glyph when pressed) that follows or unfollows the card. Signed out, it
// opens the sign-in form under it (docs/specs/accounts.md); the card is kept in this browser, and a
// password sign-in here, or /me after a link or a provider, makes the follow once. When sign-in is
// not available the form says so, and the rest of the page is unchanged. A card that shipped or was turned down shows nothing.

const words = copy.follow;

type Status = 'idle' | 'busy' | 'following' | 'unfollowed' | 'failed';

function SignIn({ cardId }: { cardId: string }) {
  return (
    <div className="follow-sign-in">
      <p className="small">{words.signInBody}</p>
      <div className="auth-panel">
        {/* The card is kept in this browser as sign-in starts; signed in here or back from /me, it is followed once. */}
        <AuthForm title="h3" onLeave={() => rememberPendingFollow(cardId)} onFailed={clearPendingFollow} onSignedIn={claimInBackground} />
      </div>
    </div>
  );
}

export function FollowCard({ cardId, stage }: { cardId: string; stage: string }) {
  const signedIn = useSignedIn();
  const signInOpen = useSignInOpen();
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
  // Following needs a profile; while sign-in is closed a visitor is not offered one.
  if (!signedIn && !signInOpen) return null;

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
