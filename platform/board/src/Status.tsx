import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import {
  boardStudioState,
  dispatcherStatus,
  fetchCardSupply,
  PAUSE_REASONS,
  setPaused,
  STUDIO_STATE_POLL_MS,
  supplyLine,
  type BoardStudioState,
  type CardSupply,
  type PauseReason,
} from './lib/board';
import { formatDateTime, formatUsd } from './lib/format';
import { errorMessage } from './lib/supabase';

const CLOCK_TICK_MS = 1_000;
export const CAPS_BY_SQL = 'The caps are read-only here: they change by SQL.';

export type StudioLoad = { state: BoardStudioState | null; loadError: string; refresh: () => Promise<void> };

/** One load and one 15 s poll of board_studio_state for the Status screen and the pause control. */
export function useStudioState(client: SupabaseClient): StudioLoad {
  const [state, setState] = useState<BoardStudioState | null>(null);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setState(await boardStudioState(client));
      setLoadError('');
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [client]);

  useEffect(() => {
    let live = true;
    const load = () => {
      if (live) void refresh();
    };
    load();
    const timer = setInterval(load, STUDIO_STATE_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [refresh]);

  return { state, loadError, refresh };
}

function pauseWords(reason: string | null): string {
  if (reason === null) return 'Agents: paused.';
  const label = PAUSE_REASONS.find((option) => option.value === reason)?.label ?? reason;
  return `Agents: paused. Reason: ${label}.`;
}

function capsLine(state: BoardStudioState): string {
  return [
    `Daily cap ${formatUsd(state.daily_cap_usd)}.`,
    `Card maximum ${formatUsd(state.card_max_usd)}.`,
    state.agent_hourly_rate_usd === null ? null : `Hourly rate ${formatUsd(state.agent_hourly_rate_usd)}.`,
    state.monthly_cap_usd === null ? null : `Monthly cap ${formatUsd(state.monthly_cap_usd)}.`,
    state.credit_studio_daily_cap_usd === null ? null : `Studio daily limit on immediate credit ${formatUsd(state.credit_studio_daily_cap_usd)}.`,
    state.anthropic_tier_cap_usd === null ? 'No usage tier cap.' : `Usage tier cap ${formatUsd(state.anthropic_tier_cap_usd)}.`,
  ]
    .filter((part) => part !== null)
    .join(' ');
}

/** The first screen: running or paused with the reason, the dispatcher, the caps read-only, the supply. */
export function StudioStatus({ client, studio }: { client: SupabaseClient; studio: StudioLoad }) {
  const { state, loadError } = studio;
  const [now, setNow] = useState(() => new Date());
  const [supply, setSupply] = useState<CardSupply | null>(null);
  const [supplyError, setSupplyError] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let live = true;
    const load = () => {
      fetchCardSupply(client)
        .then((next) => {
          if (!live) return;
          setSupply(next);
          setSupplyError('');
        })
        .catch((error: unknown) => {
          if (live) setSupplyError(errorMessage(error));
        });
    };
    load();
    const timer = setInterval(load, STUDIO_STATE_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client]);

  const dispatcher = state === null ? null : dispatcherStatus(state.dispatcher_seen_at, now);

  return (
    <section aria-label="Status">
      <h2>Status</h2>
      {state === null ? (
        <p role="status">{loadError === '' ? 'Loading the studio state.' : loadError}</p>
      ) : (
        <>
          <p>{state.paused ? pauseWords(state.pause_reason) : 'Agents: running.'}</p>
          <p>
            {dispatcher?.kind === 'seen'
              ? `Dispatcher: seen ${Math.round(dispatcher.agoMs / 1000)} s ago.`
              : dispatcher?.kind === 'stale'
                ? `Dispatcher: stale, last seen ${formatDateTime(dispatcher.seenAt)}.`
                : 'Dispatcher: not running.'}
          </p>
          <p>{capsLine(state)}</p>
          <p className="muted">{CAPS_BY_SQL}</p>
          <p>Studio code lane: {state.platform_lane_open ? 'open' : 'closed'}.</p>
          {supply !== null ? <p data-supply="line">{supplyLine(supply)}.</p> : null}
          {supplyError === '' ? null : <p className="error">Card supply: {supplyError}</p>}
          {loadError === '' ? null : <p className="error">{loadError}</p>}
        </>
      )}
    </section>
  );
}

/**
 * Pause and Resume, the kill switch (set_paused). The moderator's only control, at the first factor;
 * the board's at the second, under Actions.
 */
export function PauseControls({ client, onChanged, nested = false }: { client: SupabaseClient; onChanged?: () => Promise<void>; nested?: boolean }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<PauseReason>('board');
  const Heading = nested ? 'h3' : 'h2';

  async function apply(paused: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await setPaused(client, paused, reason);
      setMessage(paused ? 'Agents paused.' : 'Agents resumed.');
      await onChanged?.();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Pause and resume">
      <Heading>Pause the agents</Heading>
      <p>While the agents are paused no card session starts, and the public site says so with the reason. Funded cards keep their money.</p>
      <label>
        Pause reason
        <select value={reason} aria-disabled={busy} onChange={(event) => setReason(event.target.value as PauseReason)}>
          {PAUSE_REASONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button type="button" aria-disabled={busy} onClick={() => void apply(true)}>
          Pause agents
        </button>
        <button type="button" aria-disabled={busy} onClick={() => void apply(false)}>
          Resume agents
        </button>
      </div>
      {message === '' ? null : <p role="status">{message}</p>}
    </section>
  );
}
