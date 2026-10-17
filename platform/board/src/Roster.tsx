import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateTime, formatUsd } from './lib/format';
import { fadeIn, swapView } from './lib/motion';
import { fetchAgentRoster, fetchGames, gameInfo, gameStatus, ROLE_REASON_MAX, ROSTER_TABS, setRoleOn, type Agent, type Game, type RosterTab } from './lib/roster';
import { errorMessage } from './lib/supabase';

export const ROSTER_LINE =
  'The games the studio ships and the agents that build them: each game with its art, address, deploys and cards, each agent with its model, tools, write access, runs and spend. Nothing loads until you choose a tab.';
export const NO_GAME_TOGGLES = 'The database has no switch for a single game; pausing the agents or a role is how work on a game stops.';
export const ROLE_SWITCH_LINE = 'Turning a role off stops the jobs it runs until the board turns it on again. Every change needs a reason, recorded with the role.';

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

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function GameTile({ game }: { game: Game }) {
  const info = gameInfo(game.folder);
  const status = gameStatus(game);
  return (
    <li className="game-tile" data-game={game.folder}>
      {info.boxArt === null ? null : <img className="box-art" src={info.boxArt} width={120} height={160} alt={`${info.name} box art`} />}
      <div className="game-facts">
        <h4>{info.name}</h4>
        <p className="muted">
          Folder <code>{game.folder}</code>, status: <strong data-status={status}>{status}</strong>
        </p>
        {info.playUrl === null ? null : (
          <p>
            <a href={info.playUrl} rel="noreferrer" target="_blank">
              Play {info.name}
            </a>{' '}
            <span className="muted">({info.playUrl.replace(/^https:\/\//, '')})</span>
          </p>
        )}
        <p>
          Latest deploy:{' '}
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
        </p>
        <p>
          {game.openCount} open {game.openCount === 1 ? 'card' : 'cards'}, {game.shippedCount} shipped.
        </p>
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
      </div>
    </li>
  );
}

function Games({ client }: { client: SupabaseClient }) {
  const load = useCallback(() => fetchGames(client), [client]);
  const { loaded } = useLoad(load);
  const ref = useArrival(loaded.state === 'ready');
  return (
    <div ref={ref}>
      {loaded.state === 'loading' ? <p role="status">Loading the games.</p> : null}
      {loaded.state === 'error' ? <p className="error">{loaded.message}</p> : null}
      {loaded.state === 'ready' && loaded.data.length === 0 ? <p className="muted">No games yet.</p> : null}
      {loaded.state === 'ready' && loaded.data.length > 0 ? (
        <ul className="game-grid">
          {loaded.data.map((game) => (
            <GameTile key={game.folder} game={game} />
          ))}
        </ul>
      ) : null}
      <p className="muted">{NO_GAME_TOGGLES}</p>
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

function Agents({ client }: { client: SupabaseClient }) {
  const load = useCallback(() => fetchAgentRoster(client), [client]);
  const { loaded, refresh } = useLoad(load);
  const ref = useArrival(loaded.state === 'ready');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const trimmed = reason.trim();

  const toggle = (agent: Agent) => {
    if (busy !== null || trimmed === '') return;
    const on = agent.paused;
    setBusy(agent.id);
    setStatus('');
    setError('');
    setRoleOn(client, agent.id, on, trimmed)
      .then(() => {
        setStatus(`${agent.name} turned ${on ? 'on' : 'off'}.`);
        refresh();
      })
      .catch((cause: unknown) => setError(`${agent.name}: ${errorMessage(cause)}`))
      .finally(() => setBusy(null));
  };

  return (
    <div ref={ref}>
      <p className="muted">{ROLE_SWITCH_LINE}</p>
      <label>
        Reason for turning a role on or off
        <input maxLength={ROLE_REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {status !== '' ? <p role="status">{status}</p> : null}
      {error !== '' ? <p className="error">{error}</p> : null}
      {loaded.state === 'loading' ? <p role="status">Loading the agents.</p> : null}
      {loaded.state === 'error' ? <p className="error">{loaded.message}</p> : null}
      {loaded.state === 'ready' && loaded.data.length === 0 ? <p className="muted">No roles yet.</p> : null}
      {loaded.state === 'ready' && loaded.data.length > 0 ? (
        <ul className="agent-list">
          {loaded.data.map((agent) => (
            <li key={agent.id} className="agent" data-role={agent.name}>
              <div className="agent-head">
                <h4>
                  {agent.name} <span className="muted">{agent.title === agent.name ? '' : agent.title}</span>
                </h4>
                <button
                  type="button"
                  className={agent.paused ? undefined : 'button-secondary'}
                  aria-disabled={busy !== null || trimmed === '' || agent.state !== 'active' ? 'true' : undefined}
                  aria-label={`Turn ${agent.name} ${agent.paused ? 'on' : 'off'}`}
                  onClick={() => (agent.state === 'active' ? toggle(agent) : undefined)}
                >
                  Turn {agent.paused ? 'on' : 'off'}
                </button>
              </div>
              <dl className="facts">
                <dt>State</dt>
                <dd>
                  {agent.state === 'active' ? (agent.paused ? 'off' : 'on') : agent.state}
                  {agent.paused && agent.pausedReason !== null ? <span className="muted"> ({agent.pausedReason})</span> : null}
                </dd>
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
                <dt>Runs, last day</dt>
                <dd>{agent.jobs.length === 0 ? 'no jobs' : runsLine(agent)}</dd>
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
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Games and agents (docs/specs/final-state.md, Admin), under the board's second factor like the rest
 * of the panel. One tab at a time, loaded only when chosen.
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
