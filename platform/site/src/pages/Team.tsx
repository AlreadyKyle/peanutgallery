import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { PageHeader } from '../components/PageHeader';
import { StaleNotice } from '../components/StaleNotice';
import { copy } from '../lib/copy';
import { formatDate, formatInteger } from '../lib/format';
import { cardRoleFolder, runsCards } from '../lib/roster';
import type { Card, Role, Snapshot } from '../lib/source';
import { unavailableLine, useStudio } from '../lib/studio';

const team = copy.team;

/** How many live cards this role built. */
export function shippedBy(role: Role, cards: readonly Card[]): number {
  return cards.filter((card) => card.stage === 'live' && card.executor_role_id === role.id).length;
}

/**
 * The facts line under a role. A running role shows its model, when it was hired, what it has
 * shipped and what it changes. A role that does not run yet shows none of that, because none of it
 * is true of the studio today; it says it is not running, and why when a closed lane is the reason.
 */
export function roleFacts(role: Role, cards: readonly Card[], platformLaneOpen = false): string {
  if (!runsCards(role, platformLaneOpen)) {
    const folder = cardRoleFolder(role);
    return folder === null ? `${team.notRunning}.` : `${team.notRunning}. ${team.siteClosed}`;
  }
  const shipped = shippedBy(role, cards);
  const shippedLine = shipped === 1 ? team.shippedOne : team.shippedMany.replace('{n}', formatInteger(shipped));
  const folder = cardRoleFolder(role) ?? '';
  return [role.model, `${team.hired} ${formatDate(role.hired_at)}`, shippedLine, team.changes[folder]]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');
}

function RoleCard({ role, cards, platformLaneOpen }: { role: Role; cards: readonly Card[]; platformLaneOpen: boolean }) {
  const titleId = `role-${role.id}`;
  const kind = role.title === role.name ? team.aiAgent : `${team.aiAgent} · ${role.title}`;
  return (
    <li className="card role">
      <Avatar note={role.species_note} />
      <h3 id={titleId}>{role.name}</h3>
      <p className="card-category">{kind}</p>
      {role.description === null || role.description.trim() === '' ? null : <p>{role.description}</p>}
      <p className="card-meta">{roleFacts(role, cards, platformLaneOpen)}</p>
    </li>
  );
}

function Roster({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.missing.includes('roles')) return <p className="muted">{copy.partUnavailable}</p>;
  const roles = snapshot.roles.filter((role) => role.state === 'active');
  if (roles.length === 0) return <p className="muted">{team.empty}</p>;
  const laneOpen = snapshot.platformLaneOpen === true;
  const running = roles.filter((role) => runsCards(role, laneOpen));
  const waiting = roles.filter((role) => !runsCards(role, laneOpen));
  return (
    <>
      {running.length === 0 ? null : (
        <section className="section" aria-labelledby="team-running">
          <h2 id="team-running">{team.running}</h2>
          <p className="muted">{team.runningIntro}</p>
          <ul className="team-grid">
            {running.map((role) => (
              <RoleCard key={role.id} role={role} cards={snapshot.cards} platformLaneOpen={laneOpen} />
            ))}
          </ul>
        </section>
      )}
      {waiting.length === 0 ? null : (
        <section className="section" aria-labelledby="team-waiting">
          <h2 id="team-waiting">{team.notRunning}</h2>
          <p className="muted">
            {team.notRunningIntro} <Link to="/roadmap">{team.roadmapLink}</Link>
          </p>
          <ul className="team-grid">
            {waiting.map((role) => (
              <RoleCard key={role.id} role={role} cards={snapshot.cards} platformLaneOpen={laneOpen} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * Meet the team: every active role from public_roles, running roles first. Running is a fact the
 * site derives, not a label: only a role that builds cards in an open folder runs. No scorecards.
 */
export function Team() {
  const studio = useStudio();
  return (
    <main className="wide">
      <PageHeader title={team.title} lede={team.lede}>
        <StaleNotice studio={studio} />
      </PageHeader>
      {studio.state === 'loading' ? <p className="muted">{team.loading}</p> : null}
      {studio.state === 'unconfigured' || studio.state === 'error' ? <p className="muted">{unavailableLine(studio)}</p> : null}
      {studio.state === 'ready' ? <Roster snapshot={studio.snapshot} /> : null}
    </main>
  );
}
