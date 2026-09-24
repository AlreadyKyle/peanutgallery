import type { CardLine, LineRole } from '../lib/card-source';
import { copy } from '../lib/copy';
import { collapseLines, eventLine } from '../lib/lines';
import { formatDateTime, formatInteger } from '../lib/format';

/**
 * A card's event lines on its own page (docs/specs/supporter-pages.md): the newest 200 with a public
 * key, oldest first, each run of the same line by the same agent collapsed into one with a count
 * ("Builder A read 12 files"), each with its time. When the card has more, "and n earlier steps"
 * says so above them. No path, command, message or tool output is ever shown: only the fixed line.
 */
export function Timeline({ lines, count, roles }: { lines: readonly CardLine[]; count: number; roles: readonly LineRole[] }) {
  if (lines.length === 0) return <p className="muted">{copy.cardPage.linesEmpty}</p>;
  const titles = new Map(roles.map((role) => [role.id, role.title]));
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
          const who = line.role_id === null ? copy.eventStudio : (titles.get(line.role_id) ?? copy.eventStudio);
          return (
            <li key={`${line.created_at}-${index}`} data-line={line.line_key}>
              <time className="row-time" dateTime={line.created_at}>
                {formatDateTime(line.created_at)}
              </time>
              <span className="row-body">
                <span className="row-strong">{`${who} ${eventLine(line.line_key, line.count)}`}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
