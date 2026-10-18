import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateTime, formatUsd } from './lib/format';
import { fadeIn, swapView } from './lib/motion';
import {
  ADMIN_REASON_MAX,
  BLURB_MAX,
  deployHealth,
  fetchAgentRoster,
  fetchGames,
  GAME_STATUS_WORDS,
  GAME_STATUSES,
  gameInfo,
  ROLE_REASON_MAX,
  ROLE_STATUS_WORDS,
  rosterGroups,
  ROSTER_TABS,
  setGameAccepting,
  setGameBlurb,
  setGameFeatured,
  setGameStatus,
  setRoleOn,
  type Agent,
  type Counts,
  type Game,
  type GameStatus,
  type RosterTab,
} from './lib/roster';
import { errorMessage } from './lib/supabase';

export const ROSTER_LINE =
  'The games the studio ships and the agents that build them: each game with its art, address, status, plays, deploys and cards, each agent with its profile, model, tools, write access, runs and spend against the caps. Nothing loads until you choose a tab.';
export const GAME_ADMIN_LINE =
  'Every change to a game needs a reason and is written to the moderation log. A game that takes no new cards gets no new drafts from the card supply; its open cards carry on. The blurb is public and passes the content filter.';
export const ROLE_SWITCH_LINE = 'Turning a role off stops the jobs it runs until the board turns it on again. Every change needs a reason, recorded with the role.';
export const PROFILE_LINE = "A role's profile, model, tools and budget share come from its file in platform/agents and change by pull request. The caps are read-only here: they change by SQL.";
export const ROLE_REASON_NEEDED = 'Type a reason first: turning a role on or off needs one, recorded with the role.';
export const GAME_REASON_NEEDED = 'Type a reason first: every change to a game needs one, and its buttons stay off until there is one.';

type Loaded<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; message: string };

function useLoad<T>(load: () => Promise<T>) {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: 'loading' });
  const refresh = useCallback(() => {
    load()
      .then((data) => setLoaded({ state: 'ready', data }))
      .catch((error: unknown) => setLoaded({ state: 'error', message: errorMessage(error) }));
  }, [load]);
  useEffect(refresh, [refresh]);
  return { loaded, refresh };
}

/** Fades a panel in once, when its data first arrives (lib/motion.ts; nothing under reduced motion). */
function useArrival(ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    fadeIn(ref.current);
  }, [ready]);
  return ref;
}

/** One write at a time, with its outcome in words; the panel reads again after each. */
function useAct(refresh: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const act = (key: string, done: string, failed: string, action: () => Promise<void>) => {
    if (busy !== null) return;
    setBusy(key);
    setStatus('');
    setError('');
    action()
      .then(() => {
        setStatus(done);
        refresh();
      })
      .catch((cause: unknown) => setError(`${failed}: ${errorMessage(cause)}`))
      .finally(() => setBusy(null));
  };
  /** Shows a message in the error line without running anything, such as a missing reason. */
  const say = (message: string) => {
    setStatus('');
    setError(message);
  };
  return { busy, status, error, act, say };
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function countsLine(c: Counts): string {
  return `${c.day} today, ${c.week} in 7 days, ${c.month} in 30 days, ${c.total} in all`;
}

/** A moderation-log entry for a game, in words. */
function logLine(action: string, details: Record<string, unknown>): string {
  switch (action) {
    case 'set_game_status':
      return `status ${String(details.from ?? '')} to ${String(details.to ?? '')}`;
    case 'open_game_cards':
      return 'takes new cards';
    case 'close_game_cards':
      return 'takes no new cards';
    case 'feature_game':
      return typeof details.unfeatured === 'string' ? `featured (unfeatured ${details.unfeatured})` : 'featured';
    case 'unfeature_game':
      return 'unfeatured';
    case 'set_game_blurb':
      return details.to === null || details.to === undefined ? 'blurb cleared' : 'blurb changed';
    default:
      return action;
  }
}

interface GameActs {
  reason: string;
  busy: string | null;
  act: (key: string, done: string, failed: string, action: () => Promise<void>) => void;
  client: SupabaseClient;
}

function GameTile({ game, reason, busy, act, client }: { game: Game } & GameActs) {
  const info = gameInfo(game);
  const health = deployHealth(game);
  const [status, setStatus] = useState<GameStatus>(game.status);
  const [blurb, setBlurb] = useState(game.blurb ?? '');
  useEffect(() => setStatus(game.status), [game.status]);
  useEffect(() => setBlurb(game.blurb ?? ''), [game.blurb]);
  const blocked = busy !== null || reason === '';
  const disabledIf = (extra = false) => (blocked || extra ? 'true' : undefined);
  const name = info.name;
  const blurbChanged = blurb.trim() !== (game.blurb ?? '');
  return (
    <li className="game-tile" data-game={game.folder}>
      {info.boxArt === null ? null : <img className="box-art" src={info.boxArt} width={120} height={160} alt={`${name} box art`} />}
      <div className="game-facts">
        <h4>
          {name}
          {game.featured ? <span className="badge">Featured</span> : null}
        </h4>
        <p className="muted">
          Folder <code>{game.folder}</code>, status: <strong data-status={game.status}>{GAME_STATUS_WORDS[game.status]}</strong>,{' '}
          <span data-accepting={game.acceptingCards ? 'yes' : 'no'}>{game.acceptingCards ? 'takes new cards' : 'takes no new cards'}</span>
        </p>
        {info.playUrl === null ? null : (
          <p>
            <a href={info.playUrl} rel="noreferrer" target="_blank">
              Play {name}
            </a>{' '}
            <span className="muted">({info.playUrl.replace(/^https:\/\//, '')})</span>
          </p>
        )}
        <p data-blurb="">{game.blurb === null ? <span className="muted">No public blurb.</span> : game.blurb}</p>
        <dl className="facts">
          <dt>Deploys</dt>
          <dd>
            <span data-health={health}>{health}</span>:{' '}
            {game.latestDeploy === null ? (
              'none recorded'
            ) : (
              <>
                <code>{shortSha(game.latestDeploy.sha)}</code> {game.latestDeploy.isGreen ? 'green' : 'not green'}, {formatDateTime(game.latestDeploy.at)}
                {game.latestDeploy.smokeResult === null ? null : <span className="muted"> ({game.latestDeploy.smokeResult})</span>}
              </>
            )}
            {game.latestGreenDeploy !== null && game.latestDeploy !== null && !game.latestDeploy.isGreen ? (
              <span className="muted">
                {' '}
                Last green: <code>{shortSha(game.latestGreenDeploy.sha)}</code>, {formatDateTime(game.latestGreenDeploy.at)}.
              </span>
            ) : null}
          </dd>
          <dt>Loads</dt>
          <dd>{game.plays.loadEvent === null ? 'not counted' : countsLine(game.plays.loads)}</dd>
          <dt>Shares</dt>
          <dd>{game.plays.shareEvent === null ? 'not counted' : countsLine(game.plays.shares)}</dd>
          <dt>Cards</dt>
          <dd>
            {game.openCount} open, {game.shippedCount} shipped
          </dd>
        </dl>
        <details>
          <summary>Open cards</summary>
          {game.openCards.length === 0 ? (
            <p className="muted">No open cards.</p>
          ) : (
            <ul className="lines">
              {game.openCards.map((card) => (
                <li key={card.id}>
                  {card.title} <span className="muted">({card.stage})</span>
                </li>
              ))}
            </ul>
          )}
        </details>
        <details>
          <summary>Shipped cards</summary>
          {game.shippedCards.length === 0 ? (
            <p className="muted">Nothing shipped yet.</p>
          ) : (
            <ul className="lines">
              {game.shippedCards.map((card) => (
                <li key={card.id}>
                  {card.title} <span className="muted">{card.at === null ? '' : formatDateTime(card.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
        <details>
          <summary>Manage {name}</summary>
          <div className="stack" role="group" aria-label={`Manage ${name}`}>
            <label>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value as GameStatus)}>
                {GAME_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {GAME_STATUS_WORDS[value]}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <button
                type="button"
                aria-disabled={disabledIf(status === game.status)}
                onClick={() =>
                  blocked || status === game.status
                    ? undefined
                    : act(`${game.folder}:status`, `${name} is ${GAME_STATUS_WORDS[status]}.`, name, () => setGameStatus(client, game.folder, status, reason))
                }
              >
                Set status
              </button>
              <button
                type="button"
                className="button-secondary"
                aria-disabled={disabledIf()}
                onClick={() =>
                  blocked
                    ? undefined
                    : act(
                        `${game.folder}:accepting`,
                        `${name} ${game.acceptingCards ? 'takes no new cards' : 'takes new cards'}.`,
                        name,
                        () => setGameAccepting(client, game.folder, !game.acceptingCards, reason),
                      )
                }
              >
                {game.acceptingCards ? 'Stop new cards' : 'Take new cards'}
              </button>
              <button
                type="button"
                className="button-secondary"
                aria-disabled={disabledIf()}
                onClick={() =>
                  blocked
                    ? undefined
                    : act(`${game.folder}:featured`, `${name} ${game.featured ? 'is no longer featured' : 'is featured'}.`, name, () =>
                        setGameFeatured(client, game.folder, !game.featured, reason),
                      )
                }
              >
                {game.featured ? 'Unfeature' : 'Feature'}
              </button>
            </div>
            <label>
              Public blurb ({blurb.trim().length} of {BLURB_MAX})
              <textarea rows={3} maxLength={BLURB_MAX} value={blurb} onChange={(event) => setBlurb(event.target.value.replace(/\n/g, ' '))} />
            </label>
            <div className="row">
              <button
                type="button"
                aria-disabled={disabledIf(!blurbChanged)}
                onClick={() =>
                  blocked || !blurbChanged
                    ? undefined
                    : act(`${game.folder}:blurb`, blurb.trim() === '' ? `${name}'s blurb cleared.` : `${name}'s blurb saved.`, name, () =>
                        setGameBlurb(client, game.folder, blurb.trim(), reason),
                      )
                }
              >
                {blurb.trim() === '' && game.blurb !== null ? 'Clear blurb' : 'Save blurb'}
              </button>
            </div>
          </div>
        </details>
        <details>
          <summary>Recent changes</summary>
          {game.adminLog.length === 0 ? (
            <p className="muted">No changes logged.</p>
          ) : (
            <ul className="lines">
              {game.adminLog.map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  {logLine(entry.action, entry.details)}: {entry.reason}{' '}
                  <span className="muted">
                    {entry.actor}, {formatDateTime(entry.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </li>
  );
}

function Games({ client }: { client: SupabaseClient }) {
  const load = useCallback(() => fetchGames(client), [client]);
  const { loaded, refresh } = useLoad(load);
  const ref = useArrival(loaded.state === 'ready');
  const [reason, setReason] = useState('');
  const { busy, status, error, act } = useAct(refresh);
  return (
    <div ref={ref} className="roster-panel">
      <p className="muted">{GAME_ADMIN_LINE}</p>
      <label>
        Reason for changes to a game (written to the moderation log)
        <input maxLength={ADMIN_REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {reason.trim() === '' ? <p className="muted">{GAME_REASON_NEEDED}</p> : null}
      {status !== '' ? <p role="status">{status}</p> : null}
      {error !== '' ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {loaded.state === 'loading' ? <p role="status">Loading the games.</p> : null}
      {loaded.state === 'error' ? (
        <p className="error" role="alert">
          {loaded.message}
        </p>
      ) : null}
      {loaded.state === 'ready' && loaded.data.length === 0 ? <p className="muted">No games yet.</p> : null}
      {loaded.state === 'ready' && loaded.data.length > 0 ? (
        <ul className="game-grid">
          {loaded.data.map((game) => (
            <GameTile key={game.folder} game={game} reason={reason.trim()} busy={busy} act={act} client={client} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function runsLine(agent: Agent): string {
  const r = agent.runsDay;
  const parts = [`${r.succeeded} succeeded`, `${r.failed} failed`];
  if (r.skipped > 0) parts.push(`${r.skipped} skipped`);
  if (r.queued + r.running > 0) parts.push(`${r.queued + r.running} waiting or running`);
  return parts.join(', ');
}

function weekLine(agent: Agent): string {
  const w = agent.runsWeek;
  const parts = [`${w.succeeded} succeeded`, `${w.failed} failed`];
  if (w.skipped > 0) parts.push(`${w.skipped} skipped`);
  return `${parts.join(', ')}${w.lastAt === null ? '' : `; last run ${formatDateTime(w.lastAt)}`}`;
}

function capPart(spent: number, studio: number, cap: number | null, when: string, capName: string): string {
  const of = `${formatUsd(spent)} of the studio's ${formatUsd(studio)} ${when}`;
  if (cap === null || cap <= 0) return `${of}, no ${capName} set`;
  return `${of}, ${Math.round((spent / cap) * 100)}% of the ${capName} of ${formatUsd(cap)}`;
}

function rosterLine(agents: readonly Agent[]): string {
  const live = agents.filter((a) => a.state !== 'retired');
  const by = (status: string) => live.filter((a) => a.status === status).length;
  const off = live.filter((a) => a.paused).length;
  return `${live.length} ${live.length === 1 ? 'role' : 'roles'}: ${by('running')} running, ${by('starts')} starting later, ${by('planned')} planned; ${off} turned off.`;
}

function AgentItem({ agent, busy, blocked, toggle }: { agent: Agent; busy: string | null; blocked: boolean; toggle: (agent: Agent) => void }) {
  const canSwitch = agent.state === 'active';
  return (
    <li className="agent" data-role={agent.name}>
      <div className="agent-head">
        <h5>
          {agent.name} <span className="muted">{agent.title === agent.name ? '' : agent.title}</span>
        </h5>
        <button
          type="button"
          className={agent.paused ? undefined : 'button-secondary'}
          aria-disabled={busy !== null || blocked || !canSwitch ? 'true' : undefined}
          aria-label={`Turn ${agent.name} ${agent.paused ? 'on' : 'off'}`}
          onClick={() => (canSwitch ? toggle(agent) : undefined)}
        >
          Turn {agent.paused ? 'on' : 'off'}
        </button>
      </div>
      {agent.description === null ? null : <p className="agent-profile">{agent.description}</p>}
      <dl className="facts">
        <dt>Roster</dt>
        <dd data-roster={agent.status ?? 'unset'}>
          {agent.status === null ? 'not set' : ROLE_STATUS_WORDS[agent.status]}
          {agent.trigger === null ? null : <span className="muted"> ({agent.trigger})</span>}
        </dd>
        <dt>State</dt>
        <dd>
          {agent.state === 'active' ? (agent.paused ? 'off' : 'on') : agent.state}
          {agent.paused && agent.pausedReason !== null ? <span className="muted"> ({agent.pausedReason})</span> : null}
          {agent.paused && agent.pausedAt !== null ? <span className="muted"> since {formatDateTime(agent.pausedAt)}</span> : null}
        </dd>
        {agent.speciesNote === null ? null : (
          <>
            <dt>Creature</dt>
            <dd>{agent.speciesNote}</dd>
          </>
        )}
        <dt>Model</dt>
        <dd>
          <code>{agent.model}</code>
          {agent.agentClass === null ? null : <span className="muted"> ({agent.agentClass})</span>}
        </dd>
        <dt>Tools</dt>
        <dd>{agent.tools.length === 0 ? 'none' : agent.tools.join(', ')}</dd>
        <dt>Write access</dt>
        <dd>{agent.writeAccess ? 'yes' : 'no'}</dd>
        <dt>Spend</dt>
        <dd>
          {formatUsd(agent.spend.day)} today, {formatUsd(agent.spend.week)} in 7 days, {formatUsd(agent.spend.month)} in 30 days, {formatUsd(agent.spend.total)} in all
        </dd>
        <dt>Against the caps</dt>
        <dd data-caps="">
          {capPart(agent.caps.roleDay, agent.caps.studioDay, agent.caps.dailyCap, 'today', 'daily cap')};{' '}
          {capPart(agent.caps.roleMonth, agent.caps.studioMonth, agent.caps.monthlyCap, 'this month', 'monthly cap')}
        </dd>
        <dt>Budget share</dt>
        <dd>
          {Math.round(agent.budgetShare * 1000) / 10}% <span className="muted">(a planning figure; no cap is set per role)</span>
        </dd>
        <dt>Jobs</dt>
        <dd>{agent.jobs.length === 0 ? 'none' : agent.jobs.join(', ')}</dd>
        <dt>Runs, last day</dt>
        <dd>{agent.jobs.length === 0 ? 'no jobs' : runsLine(agent)}</dd>
        <dt>Runs, 7 days</dt>
        <dd>{agent.jobs.length === 0 ? 'no jobs' : weekLine(agent)}</dd>
      </dl>
      {agent.recentRuns.length === 0 ? null : (
        <details>
          <summary>Recent runs</summary>
          <ul className="lines">
            {agent.recentRuns.map((run) => (
              <li key={run.id}>
                <code>{run.job}</code> {run.status}
                {run.reason === null ? '' : ` (${run.reason})`} <span className="muted">{run.origin}, {formatDateTime(run.createdAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {agent.pauseHistory.length === 0 ? null : (
        <details>
          <summary>Turned on and off</summary>
          <ul className="lines">
            {agent.pauseHistory.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                {entry.paused ? 'off' : 'on'}: {entry.reason}{' '}
                <span className="muted">
                  {entry.actor}, {formatDateTime(entry.at)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function Agents({ client }: { client: SupabaseClient }) {
  const load = useCallback(() => fetchAgentRoster(client), [client]);
  const { loaded, refresh } = useLoad(load);
  const ref = useArrival(loaded.state === 'ready');
  const [reason, setReason] = useState('');
  const { busy, status, error, act, say } = useAct(refresh);
  const trimmed = reason.trim();

  const toggle = (agent: Agent) => {
    if (trimmed === '') {
      say(ROLE_REASON_NEEDED);
      return;
    }
    const on = agent.paused;
    act(agent.id, `${agent.name} turned ${on ? 'on' : 'off'}.`, agent.name, () => setRoleOn(client, agent.id, on, trimmed));
  };

  return (
    <div ref={ref} className="roster-panel">
      <p className="muted">{ROLE_SWITCH_LINE}</p>
      <p className="muted">{PROFILE_LINE}</p>
      <label>
        Reason for turning a role on or off
        <input
          maxLength={ROLE_REASON_MAX}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            if (error === ROLE_REASON_NEEDED) say('');
          }}
        />
      </label>
      {status !== '' ? <p role="status">{status}</p> : null}
      {error !== '' ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {loaded.state === 'loading' ? <p role="status">Loading the agents.</p> : null}
      {loaded.state === 'error' ? (
        <p className="error" role="alert">
          {loaded.message}
        </p>
      ) : null}
      {loaded.state === 'ready' && loaded.data.length === 0 ? <p className="muted">No roles yet.</p> : null}
      {loaded.state === 'ready' && loaded.data.length > 0 ? (
        <>
          <p data-roster-line="">{rosterLine(loaded.data)}</p>
          {rosterGroups(loaded.data).map((group) => (
            <div key={group.key} className="roster-group" data-group={group.key}>
              <h4>
                {group.label} <span className="muted">({group.agents.length})</span>
              </h4>
              <ul className="agent-list">
                {group.agents.map((agent) => (
                  <AgentItem key={agent.id} agent={agent} busy={busy} blocked={trimmed === ''} toggle={toggle} />
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

/**
 * Games and agents (docs/specs/final-state.md, Admin; docs/specs/board-games-admin.md), under the
 * board's second factor like the rest of the panel. One tab at a time, loaded only when chosen.
 */
export function Roster({ client }: { client: SupabaseClient }) {
  const [tab, setTab] = useState<RosterTab | null>(null);
  return (
    <section aria-label="Games and agents">
      <h2>Games and agents</h2>
      <p className="muted">{ROSTER_LINE}</p>
      <div className="row" role="group" aria-label="Games and agents tabs">
        {ROSTER_TABS.map((name) => (
          <button key={name} type="button" className={tab === name ? undefined : 'button-secondary'} aria-pressed={tab === name} onClick={() => swapView(() => setTab(name))}>
            {name}
          </button>
        ))}
      </div>
      {tab === null ? null : <h3>{tab}</h3>}
      {tab === 'Games' ? <Games client={client} /> : null}
      {tab === 'Agents' ? <Agents client={client} /> : null}
    </section>
  );
}
