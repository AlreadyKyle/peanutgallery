import { copy } from '../lib/copy';
import { formatDateTime } from '../lib/format';
import type { Snapshot } from '../lib/source';

export function EventList({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.events.length === 0) {
    return <p>{copy.ledgerEmpty}</p>;
  }
  const roleTitles = new Map(snapshot.roles.map((role) => [role.id, role.title]));
  return (
    <ul className="events">
      {snapshot.events.map((event) => {
        const role =
          event.role_id === null ? null : (roleTitles.get(event.role_id) ?? event.role_id.slice(0, 8));
        const card = event.card_id === null ? null : (snapshot.cardTitles[event.card_id] ?? null);
        return (
          <li key={event.id}>
            <span className="event-time">{formatDateTime(event.created_at)}</span>
            {role === null ? null : <span className="event-role">{role}</span>}
            <span className="event-type">{event.type}</span>
            {card === null ? null : <span className="event-card">{card}</span>}
          </li>
        );
      })}
    </ul>
  );
}
