import { legal } from '../lib/legal';
import { formatDateTime } from '../lib/format';
import type { Snapshot } from '../lib/source';

// Kernel (docs/specs/board-site.md). The agent actions as rail rows: the time in the row's rail from
// 48rem, on its own line above the action below it. `limit` shows only the newest (home shows five,
// the ledger ten until the reader asks for the rest); the row at `focusAt` can take focus from script.
export function EventList({ snapshot, limit, focusAt }: { snapshot: Snapshot; limit?: number; focusAt?: number }) {
  if (snapshot.events.length === 0) {
    return <p className="muted">{legal.ledgerEmpty}</p>;
  }
  const roleTitles = new Map(snapshot.roles.map((role) => [role.id, role.title]));
  const events = limit === undefined ? snapshot.events : snapshot.events.slice(0, limit);
  return (
    <ul className="rows rail">
      {events.map((event, index) => {
        const role =
          event.role_id === null ? null : (roleTitles.get(event.role_id) ?? event.role_id.slice(0, 8));
        const card = event.card_id === null ? null : (snapshot.cardTitles[event.card_id] ?? null);
        const verb = legal.eventVerbs[event.type] ?? event.type;
        return (
          <li key={event.id} tabIndex={index === focusAt ? -1 : undefined}>
            <span className="row-time">{formatDateTime(event.created_at)}</span>
            <span className="row-body">
              <span className="row-strong">{role === null ? verb : `${role} ${verb}`}</span>
              {card === null ? null : <span className="muted"> · {card}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
