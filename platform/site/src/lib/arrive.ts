import { rpc, takeClaim, takeReturn } from './account';
import { pendingFollowPath } from './follows';
import { pendingSeedPath } from './seed-link';

// Where a player goes the moment they sign in (docs/specs/accounts.md), however they signed in: a
// password on /sign-in, a link or a provider landing on /me. A seed waiting to be saved, a card
// waiting to be followed or the page they left to sign in comes first; otherwise their desk.

export type Arrival = { to: 'desk'; claim: boolean } | { to: 'page'; path: string };

/** Where to go now, read once: the waiting seed, card or page, else the desk. */
export function arrival(): Arrival {
  // Keep this card (/thanks) stays on the desk to show the card arrive; an older return path is dropped.
  if (takeClaim()) {
    takeReturn();
    return { to: 'desk', claim: true };
  }
  const back = pendingSeedPath() ?? pendingFollowPath() ?? takeReturn();
  return back === null ? { to: 'desk', claim: true } : { to: 'page', path: back };
}

/**
 * Every new sign-in claims the player's guest contributions, so a card paid for on another device
 * joins the collection. Leaving the desk at once, the claim runs now rather than when it draws.
 */
export function claimInBackground(): void {
  rpc<{ claimed: number }>('claim_contributions').catch(() => undefined);
}
