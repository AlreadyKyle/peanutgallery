import { collapseLines, copy, eventLine } from '../lib/copy';
import { legal } from '../lib/legal';
import { formatDateTime } from '../lib/format';
import type { AgentEvent, Snapshot } from '../lib/source';

// Kernel (docs/specs/board-site.md). The agent actions as rail rows: the time in the row's rail from
// 48rem, on its own line above the action below it. `limit` shows only the newest (home shows five,
// the ledger ten until the reader asks for the rest); the row at `focusAt` can take focus from script.
// Each row says the event's fixed public line (docs/specs/supporter-pages.md), never its payload;
// with `collapse` (home's feed), consecutive lines by the same agent on the same card with the same
// key show as one with a count ("Builder A read 12 files").

/** "Builder A read 12 files": the agent's title (or the studio's, when no agent wrote it) and the line. */
export function eventText(event: AgentEvent & { count?: number }, roleTitles: ReadonlyMap<string, string>): string {
  const role = event.role_id === null ? null : (roleTitles.get(event.role_id) ?? event.role_id.slice(0, 8));
  if (event.line_key === undefined) {
    // A document from before the line keys: the type's verb, as before.
    const verb = legal.eventVerbs[event.type] ?? event.type;
    return role === null ? verb : `${role} ${verb}`;
  }
  return `${role ?? copy.eventStudio} ${eventLine(event.line_key, event.count ?? 1)}`;
}

export function EventList({ snapshot, limit, focusAt, collapse = false }: { snapshot: Snapshot; limit?: number; focusAt?: number; collapse?: boolean }) {
  if (snapshot.events.length === 0) {
    return <p className="muted">{legal.ledgerEmpty}</p>;
  }
  const roleTitles = new Map(snapshot.roles.map((role) => [role.id, role.title]));
  const rows = collapse ? collapseLines(snapshot.events) : snapshot.events;
  const events = limit === undefined ? rows : rows.slice(0, limit);
  return (
    <ul className="rows rail">
      {events.map((event, index) => {
        const card = event.card_id === null ? null : (snapshot.cardTitles[event.card_id] ?? null);
        return (
          <li key={event.id} tabIndex={index === focusAt ? -1 : undefined}>
            <span className="row-time">{formatDateTime(event.created_at)}</span>
            <span className="row-body">
              <span className="row-strong">{eventText(event, roleTitles)}</span>
              {card === null ? null : <span className="muted"> · {card}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
