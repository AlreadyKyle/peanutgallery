import { copy } from '../lib/copy';
import { MoreLink } from './MoreLink';

/**
 * What a list says when it has nothing to show (docs/specs/brand.md, the second review): a dashed
 * tile, like an empty lane on home, with the reason and a next step, so the page never ends on a
 * bare grey line. A list that did not load says to try again and points to the cards to fund.
 */
export function EmptyState({ line, unavailable = false }: { line: string; unavailable?: boolean }) {
  return (
    <div className="empty-state">
      <p className="empty-state-line">{line}</p>
      {unavailable ? <p className="muted">{copy.emptyState.retry}</p> : null}
      <p className="more">
        <MoreLink to="/">{copy.roadmapLink}</MoreLink>
      </p>
    </div>
  );
}
