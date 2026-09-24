import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { PageHeader } from '../components/PageHeader';
import { StaleNotice } from '../components/StaleNotice';
import { copy } from '../lib/copy';
import { formatDate, formatInteger } from '../lib/format';
import { legal } from '../lib/legal';
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
 * shipped and what it changes. A role that builds no cards shows none of that; under its Not
 * building cards heading it says why only when a closed lane is the reason. Some of those roles run
 * a job when the board asks (the ranking, drafting and grading), which their descriptions say.
 */
export function roleFacts(role: Role, cards: readonly Card[], platformLaneOpen = false): string {
  if (!runsCards(role, platformLaneOpen)) {
    // The section heading already says the role is not running; only a closed lane adds a reason.
    return cardRoleFolder(role) === null ? '' : team.siteClosed;
  }
  const shipped = shippedBy(role, cards);
  const shippedLine = shipped === 1 ? team.shippedOne : team.shippedMany.replace('{n}', formatInteger(shipped));
  const folder = cardRoleFolder(role) ?? '';
  return [role.model, `${team.hired} ${formatDate(role.hired_at)}`, shippedLine, team.changes[folder]]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');
}

function RoleRow({ role, cards, platformLaneOpen, asleep }: { role: Role; cards: readonly Card[]; platformLaneOpen: boolean; asleep: boolean }) {
  const titleId = `role-${role.id}`;
  const kind = role.title === role.name ? team.aiAgent : `${team.aiAgent} · ${role.title}`;
  const facts = roleFacts(role, cards, platformLaneOpen);
  return (
    <li className="agent" id={`agent-${role.id}`}>
      <Avatar note={role.species_note} asleep={asleep} />
      <h3 id={titleId}>{role.name}</h3>
      <p className="agent-kind">{kind}</p>
      {role.description === null || role.description.trim() === '' ? null : <p>{role.description}</p>}
      {facts === '' ? null : <p className="card-meta">{facts}</p>}
    </li>
  );
}

/**
 * A role that does not run yet, as a compact tile: its avatar asleep, its name and its job. The
 * section heading says it is not running; a tile adds a reason only when a closed lane is it.
 */
function ComingTile({ role, cards, platformLaneOpen }: { role: Role; cards: readonly Card[]; platformLaneOpen: boolean }) {
  const facts = roleFacts(role, cards, platformLaneOpen);
  return (
    <li className="agent agent-coming" id={`agent-${role.id}`}>
      <Avatar note={role.species_note} asleep size={56} />
      <h3 id={`role-${role.id}`}>{role.name}</h3>
      {role.description === null || role.description.trim() === '' ? null : <p>{role.description}</p>}
      {facts === '' ? null : <p className="card-meta">{facts}</p>}
    </li>
  );
}

function Roster({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.missing.includes('roles')) return <p className="muted">{legal.partUnavailable}</p>;
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
              <RoleRow key={role.id} role={role} cards={snapshot.cards} platformLaneOpen={laneOpen} asleep={false} />
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
          <ul className="team-coming">
            {waiting.map((role) => (
              <ComingTile key={role.id} role={role} cards={snapshot.cards} platformLaneOpen={laneOpen} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * Meet the team: every active role from public_roles, running roles first. Running is a fact the
 * site derives, not a label: only a role that builds cards in an open folder runs. Running agents
 * are drawn awake and the roles still to come asleep (the board, 23 Sep 2026). No scorecards.
 * Two bands: the heading on the signal plate, and every agent row on paper (DESIGN.md, Bands).
 */
export function Team() {
  const studio = useStudio();
  return (
    <main className="wide">
      <div className="band">
        <PageHeader title={team.title} lede={team.lede}>
          <StaleNotice studio={studio} />
        </PageHeader>
      </div>
      <div className="band">
        {studio.state === 'loading' ? (
          <p className="muted" aria-busy="true">
            {team.loading}
          </p>
        ) : null}
        {studio.state === 'unconfigured' || studio.state === 'error' ? <p className="muted">{unavailableLine(studio)}</p> : null}
        {studio.state === 'ready' ? <Roster snapshot={studio.snapshot} /> : null}
      </div>
    </main>
  );
}
