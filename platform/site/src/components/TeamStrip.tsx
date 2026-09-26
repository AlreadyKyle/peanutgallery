import { Link } from 'react-router-dom';
import type { Role } from '../lib/source';
import { Avatar } from './Avatar';

/**
 * The team strip: borderless links, each an agent's avatar beside its name and one-line job, linking
 * to its box on /team, three equal columns from 48rem. Never `li.agent` (a box there) (DESIGN.md,
 * The team).
 */
export function TeamStrip({ roles, asleep }: { roles: readonly Role[]; asleep: boolean }) {
  return (
    <ul className="team-strip">
      {roles.map((role) => (
        <li key={role.id}>
          <Link className="member" to={`/team#agent-${role.id}`}>
            <Avatar note={role.species_note} asleep={asleep} size={72} />
            <span>
              <span className="member-name">{role.name}</span>
              <span className="member-job">{role.description ?? role.title}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
