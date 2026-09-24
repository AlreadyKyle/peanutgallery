import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { Glyph } from '../components/Glyph';
import { PageHeader } from '../components/PageHeader';
import { pausedSentence } from '../components/PausedNotice';
import { StaleNotice } from '../components/StaleNotice';
import { copy } from '../lib/copy';
import { formatInteger, formatUsd } from '../lib/format';
import { legal } from '../lib/legal';
import { onTheTeam, teamStatus, type TeamStatus } from '../lib/roster';
import type { Role, Snapshot } from '../lib/source';
import { unavailableLine, useStudio } from '../lib/studio';

const team = copy.team;

/**
 * The facts line under a running or paused role: its model, what its work paid for with
 * contributions has cost (all time, then the last 7 days) and how many shipped cards it worked on,
 * from public_role_stats. Only rows billed to the studio count, so a role whose work the founder paid
 * for shows $0.00, which is true. A role that does not run shows no facts line.
 */
export function roleFacts(role: Role, snapshot: Snapshot): string {
  const stats = snapshot.roleStats?.[role.id];
  if (stats === undefined) return role.model;
  const spent = legal.teamSpent.replace('{total}', formatUsd(stats.spent_usd)).replace('{week}', formatUsd(stats.spent_7d_usd));
  const ships = stats.shipped_cards === 1 ? team.workedOnOne : team.workedOnMany.replace('{n}', formatInteger(stats.shipped_cards));
  return [role.model, spent, ships].filter((part) => part !== '').join(' · ');
}

function RoleRow({ role, status, snapshot }: { role: Role; status: TeamStatus; snapshot: Snapshot }) {
  const kind = role.title === role.name ? team.aiAgent : `${team.aiAgent} · ${role.title}`;
  // The studio's pause is said once, above the list; a role's own pause, on its row.
  const why = status.kind === 'paused' ? (status.by === 'role' ? status.sentence : null) : status.sentence;
  return (
    <li className="agent" id={`agent-${role.id}`} data-status={status.kind}>
      <Avatar note={role.species_note} asleep={status.kind !== 'running'} />
      <h3 id={`role-${role.id}`}>{role.name}</h3>
      <p className="agent-kind">{kind}</p>
      {role.description === null || role.description.trim() === '' ? null : <p>{role.description}</p>}
      {status.kind === 'paused' ? (
        <p className="row-meta">
          <span className="tag" data-state="paused">
            <Glyph name="pause" />
            {team.statusPaused}
          </span>
        </p>
      ) : null}
      {onTheTeam(status) ? <p className="card-meta">{roleFacts(role, snapshot)}</p> : null}
      {why === null ? null : <p className="muted agent-status">{why}</p>}
    </li>
  );
}

function Section({ id, heading, intro, rows, snapshot, link = false }: {
  id: string;
  heading: string;
  intro: string;
  rows: { role: Role; status: TeamStatus }[];
  snapshot: Snapshot;
  link?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id}>{heading}</h2>
      <p className="muted">
        {intro}
        {link ? (
          <>
            {' '}
            <Link to="/roadmap">{team.roadmapLink}</Link>
          </>
        ) : null}
      </p>
      <ul className="team-grid">
        {rows.map(({ role, status }) => (
          <RoleRow key={role.id} role={role} status={status} snapshot={snapshot} />
        ))}
      </ul>
    </section>
  );
}

function Roster({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.missing.includes('roles')) return <p className="muted">{legal.partUnavailable}</p>;
  const roles = snapshot.roles.filter((role) => role.state === 'active');
  if (roles.length === 0) return <p className="muted">{team.empty}</p>;
  const rows = roles.map((role) => ({ role, status: teamStatus(role, snapshot) }));
  const studioPause = pausedSentence(snapshot);
  const running = rows.filter((row) => onTheTeam(row.status));
  return (
    <>
      <Section
        id="team-running"
        heading={team.running}
        intro={studioPause === null ? team.runningIntro : `${team.runningPausedIntro} ${studioPause}`}
        rows={running}
        snapshot={snapshot}
      />
      <Section id="team-starts" heading={team.startsLater} intro={team.startsLaterIntro} rows={rows.filter((row) => row.status.kind === 'starts')} snapshot={snapshot} />
      <Section id="team-planned" heading={team.planned} intro={team.plannedIntro} rows={rows.filter((row) => row.status.kind === 'planned')} snapshot={snapshot} link />
    </>
  );
}

/**
 * Meet the team: every active role from public_roles in three sections from the roster's own columns
 * (lib/roster.ts teamStatus): Running (with the paused rows while the studio or the role is paused),
 * Starts later and Planned. Running and paused rows show the model, the cost from contributions and
 * the shipped cards; the rest show when they start. Two bands: the heading on the signal plate, and
 * every agent row on paper (DESIGN.md, Bands).
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
        {studio.state === 'loading' ? <p className="muted">{team.loading}</p> : null}
        {studio.state === 'unconfigured' || studio.state === 'error' ? <p className="muted">{unavailableLine(studio)}</p> : null}
        {studio.state === 'ready' ? <Roster snapshot={studio.snapshot} /> : null}
      </div>
    </main>
  );
}
