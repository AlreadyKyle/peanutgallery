import { Link } from 'react-router-dom';
import { copy } from '../lib/copy';

/** Where an empty list sends the reader next: a page of the site, or the game's own address. */
export type EmptyNext = { readonly to: string; readonly label: string };

/**
 * What a list says when it has nothing to show (docs/specs/brand.md, the second review): a dashed
 * tile, like an empty lane on home, with the reason and the page's own next step, so the page never
 * ends on a bare grey line. A list that did not load also says to try again.
 */
export function EmptyState({ line, next, unavailable = false }: { line: string; next: EmptyNext; unavailable?: boolean }) {
  return (
    <div className="empty-state">
      <p className="empty-state-line">{line}</p>
      {unavailable ? <p className="muted">{copy.emptyState.retry}</p> : null}
      <p>
        {next.to.startsWith('/') ? (
          <Link className="button button-secondary" to={next.to}>
            {next.label}
          </Link>
        ) : (
          <a className="button button-secondary" href={next.to}>
            {next.label}
          </a>
        )}
      </p>
    </div>
  );
}
