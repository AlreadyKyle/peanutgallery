import { Link } from 'react-router-dom';
import { Glyph } from './Glyph';

/** A link to the rest of a section's list on its own page: the words, then an arrow. */
export function MoreLink({ to, children }: { to: string; children: string }) {
  return (
    <Link className="more-link" to={to}>
      {children}
      <Glyph name="arrow-right" />
    </Link>
  );
}
