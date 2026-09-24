import type { ReactNode } from 'react';
import { copy } from '../lib/copy';
import type { Snapshot } from '../lib/source';
import { unavailableLine, type StudioState } from '../lib/studio';

/**
 * The loaded snapshot for a list of cards, or the line that says why there is none. Kernel
 * (docs/specs/board-site.md): /contribute's choices come through it.
 */
export function Guarded({
  studio,
  children,
}: {
  studio: StudioState;
  children: (snapshot: Snapshot) => ReactNode;
}) {
  if (studio.state === 'loading') {
    return (
      <p className="muted" aria-busy="true">
        {copy.loadingCards}
      </p>
    );
  }
  if (studio.state !== 'ready') {
    return <p className="muted">{unavailableLine(studio)}</p>;
  }
  return <>{children(studio.snapshot)}</>;
}
