import { copy } from '../lib/copy';
import type { StudioState } from '../lib/studio';

function isStale(studio: StudioState): boolean {
  return studio.state === 'ready' && studio.stale;
}

/**
 * The line that says the figures on screen may be out of date. The status container is always in
 * place and only its text changes, because screen readers announce a change inside a live region
 * but often miss a region that arrives with its text already in it. Use one per page.
 */
export function StaleNotice({ studio }: { studio: StudioState }) {
  return (
    <p className="muted small status" role="status">
      {isStale(studio) ? copy.staleFigures : ''}
    </p>
  );
}

/**
 * The same line beside a second set of figures on a page that already has a StaleNotice: shown
 * only while stale and not a live region, so a screen reader hears it once.
 */
export function StaleLine({ studio }: { studio: StudioState }) {
  return isStale(studio) ? <p className="muted small">{copy.staleFigures}</p> : null;
}
