import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  fetchBoardJobs,
  fetchCardEvents,
  fetchFindings,
  fetchRecentCards,
  type AgentEvent,
  type BoardJobs,
  type Finding,
  type FindingKind,
  type RecentCard,
} from './lib/board';
import { formatDateTime } from './lib/format';
import { errorMessage } from './lib/supabase';

/** One read each of the recent cards, the job runs and the findings; each fails on its own. */
export type ActivityLoad = {
  cards: RecentCard[] | null;
  jobs: BoardJobs | null;
  findings: Finding[] | null;
  errors: { cards: string; jobs: string; findings: string };
  busy: boolean;
  refresh: () => Promise<void>;
};

async function settle<T>(read: Promise<T>): Promise<{ value: T | null; error: string }> {
  try {
    return { value: await read, error: '' };
  } catch (error) {
    return { value: null, error: errorMessage(error) };
  }
}

/** Activity loads once and again on Refresh: it never polls. */
export function useActivity(client: SupabaseClient): ActivityLoad {
  const [cards, setCards] = useState<RecentCard[] | null>(null);
  const [jobs, setJobs] = useState<BoardJobs | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [errors, setErrors] = useState({ cards: '', jobs: '', findings: '' });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    const [c, j, f] = await Promise.all([settle(fetchRecentCards(client)), settle(fetchBoardJobs(client)), settle(fetchFindings(client))]);
    if (c.value !== null) setCards(c.value);
    if (j.value !== null) setJobs(j.value);
    if (f.value !== null) setFindings(f.value);
    setErrors({ cards: c.error, jobs: j.error, findings: f.error });
    setBusy(false);
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { cards, jobs, findings, errors, busy, refresh };
}

const ORIGIN_WORDS: Record<string, string> = {
  board: 'run now',
  schedule: 'scheduled',
  event: 'after an event',
  operator: 'by the operator',
};

const RUN_WORDS: Record<string, string> = {
  queued: 'queued',
  running: 'running',
  succeeded: 'done',
  failed: 'failed',
  skipped: 'skipped',
};

/** Why a run was skipped or stopped, for the reasons the dispatcher writes; any other is shown as written. */
const REASON_WORDS: Record<string, string> = {
  role_paused: 'its role is paused',
  studio_paused: 'the studio is paused',
  not_board_origin: 'only the board starts a model run',
  board_session_lapsed: 'no board member was signed in',
  dispatcher_stopping: 'the dispatcher stopped',
  dispatcher_restart: 'the dispatcher restarted',
  no_handler: 'no code runs this job yet',
  handler_error: 'it hit an error',
};

export const FINDING_KIND_WORDS: Record<FindingKind, string> = {
  schema: 'Schema drift',
  model: 'Model',
  cli: 'Claude Code pin',
  scan: 'Weekly scan',
  producer: 'Producer signal',
};

/** A detail value that is a GitHub address (the weekly scan's run and job) is a link; the rest is text. */
function DetailValue({ value }: { value: string }) {
  return /^https:\/\/github\.com\/[^\s]+$/.test(value) ? <a href={value}>{value}</a> : <>{value}</>;
}

function Loading({ what, value, error }: { what: string; value: unknown[] | null; error: string }) {
  if (value === null) return <p role="status">{error === '' ? `Loading ${what}.` : error}</p>;
  return error === '' ? null : <p className="error">{error}</p>;
}

/** One card's public agent events, newest first: time, type and the raw step or line key. */
function CardEvents({ client, cards }: { client: SupabaseClient; cards: RecentCard[] }) {
  const [chosen, setChosen] = useState('');
  const [events, setEvents] = useState<AgentEvent[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const card = cards.find((option) => option.id === chosen) ?? null;

  async function show(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (card === null) {
      setMessage('Choose a card.');
      return;
    }
    setBusy(true);
    try {
      const next = await fetchCardEvents(client, card.id);
      setEvents(next);
      setMessage(next.length === 0 ? `${card.title} has no public events.` : `${next.length} events for ${card.title}, newest first.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={show} aria-label="Card events">
      <h3>Card events</h3>
      <label>
        Card
        <select value={card === null ? '' : card.id} onChange={(event) => setChosen(event.target.value)}>
          <option value="">Choose a card</option>
          {cards.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" aria-disabled={busy}>
        Show events
      </button>
      {message === '' ? null : <p role="status">{message}</p>}
      {events === null || events.length === 0 ? null : (
        <ol className="lines events">
          {events.map((item) => (
            <li key={item.id}>
              {formatDateTime(item.created_at)} · {item.type}
              {item.step === null ? '' : ` · step ${item.step}`}
              {item.line_key === null ? '' : ` · ${item.line_key}`}
            </li>
          ))}
        </ol>
      )}
    </form>
  );
}

/** What the studio did lately: the recent cards, the job runs, the open findings and one card's events. */
export function Activity({ client, activity }: { client: SupabaseClient; activity: ActivityLoad }) {
  const { cards, jobs, findings, errors, busy, refresh } = activity;
  return (
    <section aria-label="Activity">
      <h2>Activity</h2>
      <button type="button" className="button-secondary" aria-disabled={busy} onClick={() => {
          if (!busy) void refresh();
        }}
      >
        Refresh
      </button>

      <h3>Recent cards</h3>
      <Loading what="the cards" value={cards} error={errors.cards} />
      {cards !== null && cards.length === 0 ? <p>No cards yet.</p> : null}
      {cards !== null && cards.length > 0 ? (
        <ul className="lines">
          {cards.map((card) => (
            <li key={card.id} data-card={card.id}>
              <strong>{card.title}</strong> · {card.stage}
              {card.horizon === null ? '' : ` · ${card.horizon}`}
              {card.failing_check === null ? '' : ` · failing check: ${card.failing_check}`} · updated {formatDateTime(card.updated_at)}
            </li>
          ))}
        </ul>
      ) : null}

      <h3>Job runs</h3>
      <Loading what="the job runs" value={jobs?.runs ?? null} error={errors.jobs} />
      {jobs !== null && jobs.runs.length === 0 ? <p>No job runs yet.</p> : null}
      {jobs !== null && jobs.runs.length > 0 ? (
        <ul className="lines">
          {jobs.runs.map((run) => (
            <li key={run.id}>
              {formatDateTime(run.created_at)} · {run.job} · {ORIGIN_WORDS[run.origin] ?? run.origin} · {RUN_WORDS[run.status] ?? run.status}
              {run.reason === null ? '' : `: ${REASON_WORDS[run.reason] ?? run.reason}`}
            </li>
          ))}
        </ul>
      ) : null}

      <h3>Findings</h3>
      <Loading what="the findings" value={findings} error={errors.findings} />
      {findings !== null && findings.length === 0 ? <p>No open findings. The Janitor's daily check lists each difference here.</p> : null}
      {findings !== null && findings.length > 0 ? (
        <ul className="lines findings">
          {findings.map((finding) => (
            <li key={finding.fingerprint} data-finding={finding.kind}>
              <strong>
                {FINDING_KIND_WORDS[finding.kind]}: {finding.subject}.
              </strong>{' '}
              Opened {formatDateTime(finding.opened_at)}
              {finding.last_seen_at === finding.opened_at ? '' : `, last seen ${formatDateTime(finding.last_seen_at)}`}.
              {finding.detail.length === 0 ? null : (
                <ul className="finding-detail">
                  {finding.detail.map(([key, value]) => (
                    <li key={key}>
                      {key.replaceAll('_', ' ')}: <DetailValue value={value} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <CardEvents client={client} cards={cards ?? []} />
    </section>
  );
}
