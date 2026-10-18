import { Link } from 'react-router-dom';
import type { CardLine, LineRole } from '../lib/card-source';
import { copy } from '../lib/copy';
import { collapseLines, eventLine } from '../lib/lines';
import { formatDateTime, formatInteger } from '../lib/format';
import type { Role } from '../lib/source';
import { Avatar } from './Avatar';

/**
 * A card's event lines on its own page (docs/specs/supporter-pages.md): the newest 200 with a public
 * key, oldest first, each run of the same line by the same agent collapsed into one with a count
 * ("Builder A read 12 files"), each with its time. When the card has more, "and n earlier steps"
 * says so above them. No path, command, message or tool output is ever shown: only the fixed line.
 * An agent's row carries its 24px avatar, drawn from the team's species notes (`team`, the studio's
 * roles) when they loaded, and its name links its box on /team; the studio's own rows have neither.
 */
export function Timeline({
  lines,
  count,
  roles,
  team = [],
}: {
  lines: readonly CardLine[];
  count: number;
  roles: readonly LineRole[];
  team?: readonly Pick<Role, 'id' | 'species_note'>[];
}) {
  if (lines.length === 0) return <p className="muted">{copy.cardPage.linesEmpty}</p>;
  const titles = new Map(roles.map((role) => [role.id, role.title]));
  const notes = new Map(team.map((role) => [role.id, role.species_note]));
  const earlier = Math.max(0, count - lines.length);
  const rows = collapseLines(lines);
  return (
    <>
      {earlier === 0 ? null : (
        <p className="muted small timeline-earlier">
          {earlier === 1 ? copy.cardPage.earlierOne : copy.cardPage.earlier.replace('{n}', formatInteger(earlier))}
        </p>
      )}
      <ol className="rows rail timeline">
        {rows.map((line, index) => {
          const title = line.role_id === null ? undefined : titles.get(line.role_id);
          const note = title === undefined || line.role_id === null ? undefined : notes.get(line.role_id);
          const step = eventLine(line.line_key, line.count, line.usd);
          return (
            <li key={`${line.created_at}-${index}`} data-line={line.line_key}>
              <time className="row-time" dateTime={line.created_at}>
                {formatDateTime(line.created_at)}
              </time>
              <span className="row-body timeline-step">
                {/* The name beside it says who it is, so the picture is hidden from screen readers. */}
                {note === undefined ? null : (
                  <span className="timeline-avatar" aria-hidden="true">
                    <Avatar note={note} size={24} />
                  </span>
                )}
                {title === undefined ? (
                  <span className="row-strong">{`${copy.eventStudio} ${step}`}</span>
                ) : (
                  <span className="row-strong">
                    <Link to={`/team#agent-${line.role_id}`}>{title}</Link>
                    {` ${step}`}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
