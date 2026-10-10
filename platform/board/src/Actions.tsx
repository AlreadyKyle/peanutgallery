import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  buckets,
  cancelCard,
  fetchCardRoles,
  fileCard,
  folders,
  horizons,
  lanes,
  recordCreditPurchase,
  resumeCard,
  runJobNow,
  type ActionableCard,
  type Horizon,
  type Role,
} from './lib/board';
import { formatUsd } from './lib/format';
import { errorMessage } from './lib/supabase';
import { PauseControls } from './Status';

export const CANCEL_CONFIRM =
  'Reject this card? It stops for good with your reason, its unspent money goes to the next cards in line, and this cannot be undone.';

// file_card and the cards.summary column both cap the summary at 200 characters.
const SUMMARY_MAX = 200;

/** A dollar field: a finite number of zero or more, or null. */
function dollars(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A form's busy flag and status line, with the one way every action runs: ignored while one runs. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function run(action: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    try {
      setMessage(await action());
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, setMessage, run };
}

const emptyCard = {
  bucket: buckets[0] as string,
  lane: lanes[0] as string,
  folder: folders[0] as string,
  title: '',
  summary: '',
  intent: '',
  acceptance_test: '',
  funding_target_usd: '',
  board_reason: '',
  executor_role_id: '',
  horizon: 'now' as Horizon,
};

function Choice({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

/** file_card: always proposed, on the horizon chosen; only the roles that build cards are executors. */
function FileCardForm({ client, onFiled }: { client: SupabaseClient; onFiled: () => Promise<void> }) {
  const hintId = useId();
  const summaryHintId = useId();
  const summaryCountId = useId();
  const [form, setForm] = useState({ ...emptyCard });
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesError, setRolesError] = useState('');
  const { busy, message, setMessage, run } = useAction();
  const executor = form.executor_role_id === '' ? (roles[0]?.id ?? '') : form.executor_role_id;

  useEffect(() => {
    let live = true;
    fetchCardRoles(client)
      .then((next) => {
        if (live) setRoles(next);
      })
      .catch((error: unknown) => {
        if (live) setRolesError(errorMessage(error));
      });
    return () => {
      live = false;
    };
  }, [client]);

  function update<K extends keyof typeof emptyCard>(key: K, value: (typeof emptyCard)[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (form.summary.trim() === '') {
      setMessage('A public summary is required.');
      return;
    }
    // file_card refuses a target of zero or less on every horizon, the roadmap's included.
    const target = dollars(form.funding_target_usd);
    if (target === null || target < 0.01) {
      setMessage('Funding target must be at least $0.01.');
      return;
    }
    if (executor === '') {
      setMessage('Choose an executor role.');
      return;
    }
    await run(async () => {
      const id = await fileCard(client, {
        bucket: form.bucket,
        lane: form.lane,
        folder: form.folder,
        title: form.title.trim(),
        summary: form.summary.trim(),
        intent: form.intent.trim(),
        acceptance_test: form.acceptance_test.trim(),
        funding_target_usd: target,
        executor_role_id: executor,
        board_reason: form.board_reason.trim(),
        horizon: form.horizon,
      });
      setForm({ ...emptyCard });
      await onFiled();
      return `Card filed as card ${id.slice(0, 8)}.`;
    });
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="File a card">
      <h3>File a card</h3>
      <p>A card on now opens for funding; one on next or later goes on the roadmap and takes no money until it moves to now. Every card needs a funding target.</p>
      <label>
        Horizon
        <select value={form.horizon} onChange={(event) => update('horizon', event.target.value as Horizon)}>
          {horizons.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <Choice label="Bucket" value={form.bucket} options={buckets} onChange={(value) => update('bucket', value)} />
      <Choice label="Lane" value={form.lane} options={lanes} onChange={(value) => update('lane', value)} />
      <Choice label="Folder" value={form.folder} options={folders} onChange={(value) => update('folder', value)} />
      <label>
        Title
        <input required value={form.title} onChange={(event) => update('title', event.target.value)} />
      </label>
      <label>
        Public summary
        <input
          required
          maxLength={SUMMARY_MAX}
          aria-describedby={`${summaryHintId} ${summaryCountId}`}
          value={form.summary}
          onChange={(event) => update('summary', event.target.value)}
        />
      </label>
      <p id={summaryHintId}>One or two plain sentences for supporters. 200 characters at most.</p>
      <p id={summaryCountId} aria-live="polite">
        {form.summary.length} / {SUMMARY_MAX}
      </p>
      <label>
        Intent (for the agents)
        <textarea required rows={3} value={form.intent} onChange={(event) => update('intent', event.target.value)} />
      </label>
      <label>
        Acceptance test
        <textarea required rows={3} aria-describedby={hintId} value={form.acceptance_test} onChange={(event) => update('acceptance_test', event.target.value)} />
      </label>
      <p id={hintId}>Config-lane cards need a check: line. A card on horizon now needs check: lines too.</p>
      <label>
        Funding target (USD)
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          required
          value={form.funding_target_usd}
          onChange={(event) => update('funding_target_usd', event.target.value)}
        />
      </label>
      <label>
        Reason (optional)
        <input value={form.board_reason} onChange={(event) => update('board_reason', event.target.value)} />
      </label>
      <label>
        Executor
        <select value={executor} onChange={(event) => update('executor_role_id', event.target.value)}>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.title}
            </option>
          ))}
        </select>
      </label>
      {roles.length === 0 ? <p>{rolesError === '' ? 'No active card roles are loaded.' : rolesError}</p> : null}
      <button type="submit" aria-disabled={busy}>
        File card
      </button>
      {message === '' ? null : <p role="status">{message}</p>}
    </form>
  );
}

/**
 * One card picker over the cards that can still be rejected, and a reason: Reject (cancel_card, after
 * the confirm), and for a paused card a new estimate and Resume (resume_card). The cards come from the
 * Activity load, so Refresh and every action reread them. The form stays mounted when a rejected card
 * leaves the list, so its status line is announced and focus stays on the button.
 */
function CardActionsForm({
  client,
  cards,
  loadError,
  onChanged,
}: {
  client: SupabaseClient;
  cards: ActionableCard[] | null;
  loadError: string;
  onChanged: () => Promise<void>;
}) {
  const estimateHintId = useId();
  const [chosen, setChosen] = useState('');
  const [reason, setReason] = useState('');
  const [estimate, setEstimate] = useState('');
  const { busy, message, setMessage, run } = useAction();
  const card = (cards ?? []).find((option) => option.id === chosen) ?? null;

  function choose(id: string) {
    setChosen(id);
    const next = (cards ?? []).find((option) => option.id === id);
    setEstimate(next !== undefined && next.estimate_usd > 0 ? String(next.estimate_usd) : '');
  }

  function ready(): { card: ActionableCard; why: string } | null {
    if (card === null) {
      setMessage('Choose a card.');
      return null;
    }
    if (reason.trim() === '') {
      setMessage('A reason is required.');
      return null;
    }
    return { card, why: reason.trim() };
  }

  async function reject() {
    if (busy) return;
    const go = ready();
    if (go === null) return;
    if (!window.confirm(CANCEL_CONFIRM)) return;
    await run(async () => {
      const moved = await cancelCard(client, go.card.id, go.why);
      setChosen('');
      setReason('');
      await onChanged();
      const money = moved > 0 ? `${formatUsd(moved)} of unspent money moved to the next cards in line.` : 'No unspent money moved.';
      return `Card ${go.card.title} rejected. ${money}`;
    });
  }

  async function resume() {
    if (busy) return;
    const go = ready();
    if (go === null) return;
    const value = dollars(estimate);
    if (value === null || value < 0.01) {
      setMessage('A new estimate of at least $0.01 is required.');
      return;
    }
    await run(async () => {
      await resumeCard(client, go.card.id, value, go.why);
      setReason('');
      await onChanged();
      return `Card ${go.card.title} resumed.`;
    });
  }

  return (
    <form
      className="stack"
      aria-label="Card actions"
      onSubmit={(event) => {
        // Enter in a field acts on nothing: Reject and Resume each need their own button.
        event.preventDefault();
      }}
    >
      <h3>Reject or resume a card</h3>
      <p>Rejecting stops a card for good; its unspent money goes to the next cards in line. A paused card can be resumed with a new estimate.</p>
      {cards === null ? <p role="status">{loadError === '' ? 'Loading the cards.' : loadError}</p> : null}
      <label>
        Card
        <select value={card === null ? '' : card.id} onChange={(event) => choose(event.target.value)}>
          <option value="">Choose a card</option>
          {(cards ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {`${option.title} (${option.stage})`}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reason
        <input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {card?.stage === 'paused' ? (
        <>
          <label>
            New estimate (USD)
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              aria-describedby={estimateHintId}
              value={estimate}
              onChange={(event) => setEstimate(event.target.value)}
            />
          </label>
          <p id={estimateHintId}>At least what the card has already cost.</p>
        </>
      ) : null}
      <div className="row">
        {card?.stage === 'paused' ? (
          <button type="button" aria-disabled={busy} onClick={() => void resume()}>
            Resume card
          </button>
        ) : null}
        <button type="button" className="button-secondary" aria-disabled={busy} onClick={() => void reject()}>
          Reject card
        </button>
      </div>
      {cards !== null && loadError !== '' ? <p className="error">{loadError}</p> : null}
      {message === '' ? null : <p role="status">{message}</p>}
    </form>
  );
}

/** record_credit_purchase: Console credit bought for the agents, with the Stripe payout that paid for it. */
function CreditPurchaseForm({ client }: { client: SupabaseClient }) {
  const [amount, setAmount] = useState('');
  const [payout, setPayout] = useState('');
  const [reason, setReason] = useState('');
  const { busy, message, setMessage, run } = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const value = dollars(amount);
    if (value === null || value < 0.01) {
      setMessage('Amount must be at least $0.01.');
      return;
    }
    await run(async () => {
      await recordCreditPurchase(client, { amount_usd: value, stripe_payout_id: payout.trim(), reason: reason.trim() });
      setAmount('');
      setPayout('');
      setReason('');
      return `Credit purchase of ${formatUsd(value)} recorded.`;
    });
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="Record a credit purchase">
      <h3>Record a credit purchase</h3>
      <p>Optional: record Console credit bought for the agents after a Stripe payout.</p>
      <label>
        Amount (USD)
        <input type="number" inputMode="decimal" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <label>
        Stripe payout id
        <input required value={payout} onChange={(event) => setPayout(event.target.value)} />
      </label>
      <label>
        Reason
        <input required value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <button type="submit" aria-disabled={busy}>
        Record purchase
      </button>
      {message === '' ? null : <p role="status">{message}</p>}
    </form>
  );
}

/** Run a job now: a board-origin run with input {}, a debug control. */
function RunJobForm({ client, jobs, onQueued }: { client: SupabaseClient; jobs: string[]; onQueued: () => Promise<void> }) {
  const [chosen, setChosen] = useState('');
  const [reason, setReason] = useState('');
  const { busy, message, setMessage, run } = useAction();
  const job = jobs.includes(chosen) ? chosen : '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (job === '') {
      setMessage('Choose a job.');
      return;
    }
    if (reason.trim() === '') {
      setMessage('A reason is required.');
      return;
    }
    await run(async () => {
      await runJobNow(client, job, reason.trim());
      setReason('');
      await onQueued();
      return `Queued ${job}. It runs on the next dispatcher tick.`;
    });
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="Run a job now">
      <h3>Run a job now</h3>
      <p>A debug control: queues one run of the job, with no input, as the board.</p>
      <label>
        Job
        <select value={job} onChange={(event) => setChosen(event.target.value)}>
          <option value="">Choose a job</option>
          {jobs.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reason
        <input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <button type="submit" aria-disabled={busy}>
        Run now
      </button>
      {message === '' ? null : <p role="status">{message}</p>}
    </form>
  );
}

/** Every control that changes state, at the second factor: exactly these six. */
export function Actions({
  client,
  jobs,
  cards,
  cardsError,
  onStudioChanged,
  onActivityChanged,
}: {
  client: SupabaseClient;
  jobs: string[];
  /** The cards Reject and Resume offer, from the Activity load. */
  cards: ActionableCard[] | null;
  cardsError: string;
  onStudioChanged: () => Promise<void>;
  onActivityChanged: () => Promise<void>;
}) {
  return (
    <section aria-label="Actions">
      <h2>Actions</h2>
      <PauseControls client={client} onChanged={onStudioChanged} nested />
      <FileCardForm client={client} onFiled={onActivityChanged} />
      <CardActionsForm client={client} cards={cards} loadError={cardsError} onChanged={onActivityChanged} />
      <CreditPurchaseForm client={client} />
      <RunJobForm client={client} jobs={jobs} onQueued={onActivityChanged} />
    </section>
  );
}
