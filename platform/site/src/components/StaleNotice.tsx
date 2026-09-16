import { copy } from '../lib/copy';
import type { StudioState } from '../lib/studio';

/** One muted line when the last refresh failed and the figures on screen may be out of date. */
export function StaleNotice({ studio }: { studio: StudioState }) {
  if (studio.state !== 'ready' || !studio.stale) return null;
  return (
    <p className="muted small" role="status">
      {copy.staleFigures}
    </p>
  );
}
