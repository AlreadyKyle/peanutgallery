import { useCallback, useEffect, useState } from 'react';
import { rpc, useSignedIn } from './account';
import { CommunityError } from './community';
import type { Follow, FollowsDoc } from './community-types';

// "Tell me when this ships" (docs/specs/card-follows.md): a signed-in player follows a card, and the
// studio emails them once when it goes live. The follows are the player's own RPCs through the
// community function (follow_card, unfollow_card, my_follows); the email address is the one they
// signed in with, which the studio does not copy anywhere.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The card waiting for sign-in: kept in this browser while the magic link is out, so /me can send the
// player back to the card, where the follow is made. Storage may be refused (a private window); the
// player then presses the button again once signed in.
const PENDING = 'mm:pending-follow';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function rememberPendingFollow(cardId: string): void {
  if (!UUID.test(cardId)) return;
  try {
    storage()?.setItem(PENDING, cardId);
  } catch {
    // Nothing to keep it in.
  }
}

/** The card waiting to be followed, if a valid id is kept. */
export function pendingFollow(): string | null {
  try {
    const id = storage()?.getItem(PENDING) ?? null;
    return id !== null && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function clearPendingFollow(): void {
  try {
    storage()?.removeItem(PENDING);
  } catch {
    // Nothing kept.
  }
}

/** Where /me sends a player who just signed in with a follow waiting, or null. */
export function pendingFollowPath(): string | null {
  const id = pendingFollow();
  return id === null ? null : `/card/${id}`;
}

/** Whether a card can still be followed: it has not shipped and was not turned down. */
export function followable(stage: string): boolean {
  return stage !== 'live' && stage !== 'rejected';
}

export type FollowsState = { state: 'signed-out' } | { state: 'loading' } | { state: 'ready'; follows: readonly Follow[] } | { state: 'unavailable' };

/** The signed-in player's follows, read once and again on reload(). */
export function useFollows(): FollowsState & { reload: () => void } {
  const signedIn = useSignedIn();
  const [state, setState] = useState<FollowsState>(signedIn ? { state: 'loading' } : { state: 'signed-out' });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    if (!signedIn) {
      setState({ state: 'signed-out' });
      return;
    }
    let live = true;
    setState((was) => (was.state === 'ready' ? was : { state: 'loading' }));
    rpc<FollowsDoc>('my_follows')
      .then((doc) => live && setState({ state: 'ready', follows: Array.isArray(doc.follows) ? doc.follows : [] }))
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

export function followCard(cardId: string): Promise<Follow> {
  return rpc<Follow>('follow_card', { card_id: cardId });
}

export function unfollowCard(cardId: string): Promise<unknown> {
  return rpc('unfollow_card', { card_id: cardId });
}
