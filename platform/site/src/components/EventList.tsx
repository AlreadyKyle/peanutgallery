import { legal } from '../lib/legal';
import { formatDateTime } from '../lib/format';
import type { Snapshot } from '../lib/source';

export function EventList({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.events.length === 0) {
    return <p className="muted">{legal.ledgerEmpty}</p>;
  }
  const roleTitles = new Map(snapshot.roles.map((role) => [role.id, role.title]));
  return (
    <ul className="rows">
      {snapshot.events.map((event) => {
        const role =
          event.role_id === null ? null : (roleTitles.get(event.role_id) ?? event.role_id.slice(0, 8));
        const card = event.card_id === null ? null : (snapshot.cardTitles[event.card_id] ?? null);
        const verb = legal.eventVerbs[event.type] ?? event.type;
        return (
          <li key={event.id}>
            <span className="row-time">{formatDateTime(event.created_at)}</span>
            <span>
              {role === null ? verb : `${role} ${verb}`}
              {card === null ? null : <span className="muted"> · {card}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
