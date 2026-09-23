import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  agentModes,
  boardStudioState,
  buckets,
  cancelCard,
  cardStages,
  dispatcherSeenAgoMs,
  enrolTotp,
  fetchBoardCards,
  fetchBoardRole,
  fetchCardRoles,
  fileCard,
  fileDirective,
  fileNote,
  folders,
  heartbeat,
  HEARTBEAT_MS,
  HORIZON_STAGES,
  horizons,
  lanes,
  movesToNow,
  recordCreditPurchase,
  resumeCard,
  sendMagicLink,
  sessionExpiry,
  setAgentMode,
  setCaps,
  setCardHorizon,
  setLaunched,
  PAUSE_REASONS,
  type PauseReason,
  setPaused,
  STUDIO_STATE_POLL_MS,
  TOTP_CODE,
  twoFactorState,
  verifyTotp,
  type AgentMode,
  type BoardCard,
  type BoardRole,
  type BoardStudioState,
  type Caps,
  type Horizon,
  type NextCardStage,
  type Role,
  type TotpEnrolment,
  type TwoFactorState,
} from './lib/board';
import { formatClock, formatDateTime, formatUsd } from './lib/format';
import type { CreditDraft } from './lib/needs';
import { errorMessage, getClient } from './lib/supabase';
import { NeedsYou } from './NeedsYou';

const noDatabase = 'The site has no database configuration, so board sign-in is unavailable.';
const CLOCK_TICK_MS = 1_000;
export const GO_LIVE_CONFIRM = 'Mark the studio live now? This is recorded once and cannot be undone.';
export const CANCEL_CONFIRM =
  'Cancel this card? It is rejected with your reason, its unspent money goes to the next cards in line, and this cannot be undone.';
export const FILLED_FROM_CONTROLLER = "Filled in from the Controller's figure. Check it against the Console receipt, then record it.";

export function Board() {
  const client = getClient();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (client === null) return;
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [client]);

  return (
    <main>
      <div className="hero">
        <h1>Board</h1>
        <p className="lede">Private controls for the board. Sign-in is limited to board accounts.</p>
      </div>
      {client === null || session === null ? (
        <SignIn client={client} />
      ) : (
        <SignedIn client={client} email={session.user.email ?? ''} />
      )}
    </main>
  );
}

function SignIn({ client }: { client: SupabaseClient | null }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (client === null) {
      setMessage(noDatabase);
      return;
    }
    setBusy(true);
    try {
      await sendMagicLink(client, email.trim());
      setMessage(`A sign-in link was sent to ${email.trim()}.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="Sign in">
      <label>
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <button type="submit" disabled={busy}>
        Send sign-in link
      </button>
      {message === '' ? null : <p role="status">{message}</p>}
    </form>
  );
}

function SignedIn({ client, email }: { client: SupabaseClient; email: string }) {
  const [role, setRole] = useState<BoardRole | null | 'pending'>('pending');
  const [roleError, setRoleError] = useState('');
  // The board RPCs that change state refuse a session without a verified second factor (aal2).
  const [secondFactor, setSecondFactor] = useState(false);

  useEffect(() => {
    let live = true;
    fetchBoardRole(client)
      .then((value) => {
        if (live) setRole(value);
      })
      .catch((error: unknown) => {
        if (live) {
          setRole(null);
          setRoleError(errorMessage(error));
        }
      });
    return () => {
      live = false;
    };
  }, [client]);

  async function signOut() {
    await client.auth.signOut();
  }

  return (
    <>
      <p>
        Signed in as {email}.{' '}
        <button type="button" className="link" onClick={() => void signOut()}>
          Sign out
        </button>
      </p>
      {role === 'pending' ? <p>Checking board membership.</p> : null}
      {role === null ? (
        <p role="status">
          {roleError === '' ? 'This account is not on the board.' : roleError}
        </p>
      ) : null}
      {/* The moderator's pause works at aal1; the board's needs the second factor. */}
      {role === 'moderator' ? <PauseControls client={client} /> : null}
      {role === 'board' ? <BoardControls client={client} secondFactor={secondFactor} onVerified={setSecondFactor} /> : null}
    </>
  );
}

/**
 * The second factor for a board member: enrol an authenticator app when the account has no verified
 * TOTP factor, otherwise verify a code from it. Reports aal2 through onVerified.
 */
function TwoFactor({
  client,
  onVerified,
}: {
  client: SupabaseClient;
  onVerified: (verified: boolean) => void;
}) {
  const [state, setState] = useState<TwoFactorState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    twoFactorState(client)
      .then((next) => {
        if (!live) return;
        setState(next);
        if (next.level === 'aal2') onVerified(true);
      })
      .catch((error: unknown) => {
        if (live) setLoadError(errorMessage(error));
      });
    return () => {
      live = false;
    };
  }, [client, onVerified]);

  async function startEnrolment() {
    setBusy(true);
    setMessage('');
    try {
      setEnrolment(await enrolTotp(client));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const factorId = enrolment?.factorId ?? state?.verifiedFactorId ?? null;

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (factorId === null) return;
    const entered = code.trim();
    if (!TOTP_CODE.test(entered)) {
      setMessage('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    try {
      await verifyTotp(client, factorId, entered);
      const next = await twoFactorState(client);
      if (next.level === 'aal2') {
        onVerified(true);
      } else {
        setState(next);
        setMessage('The code was accepted, but this session has no second factor. Sign out and sign in again.');
      }
    } catch (error) {
      setMessage(errorMessage(error));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  const codeForm =
    factorId === null ? null : (
      <form className="stack" onSubmit={verify} aria-label="Verify a code">
        <label>
          6-digit code
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          Verify
        </button>
      </form>
    );

  return (
    <section aria-label="Two-factor sign-in">
      <h2>Two-factor sign-in</h2>
      <p>
        A second factor is needed before you can pause agents, go live, change the agent mode or the caps, record
        credit, move, cancel or resume cards, or file cards, directives and notes.
      </p>
      {state === null ? (
        <p role="status">{loadError === '' ? 'Checking two-factor sign-in.' : loadError}</p>
      ) : null}
      {state !== null && state.verifiedFactorId !== null ? (
        <p>Enter the code your authenticator app shows for Peanut Gallery.</p>
      ) : null}
      {state !== null && state.verifiedFactorId === null && enrolment === null ? (
        <>
          <p>This account has no authenticator app yet.</p>
          <button type="button" disabled={busy} onClick={() => void startEnrolment()}>
            Set up an authenticator app
          </button>
        </>
      ) : null}
      {enrolment === null ? null : (
        <>
          <p>Scan the QR code with an authenticator app, or type the secret into it. Then enter the code it shows.</p>
          <img className="qr" src={enrolment.qrCode} alt="QR code for your authenticator app" width={200} height={200} />
          <p>
            Secret: <code>{enrolment.secret}</code>
          </p>
        </>
      )}
      {codeForm}
      {message === '' ? null : <p role="status">{message}</p>}
    </section>
  );
}

type StudioLoad = {
  state: BoardStudioState | null;
  loadError: string;
  refresh: () => Promise<void>;
};

// One load and one poll of board_studio_state for every board control.
function useBoardStudioState(client: SupabaseClient): StudioLoad {
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

// The roles that build cards, loaded once for the card and directive forms. Every other role, the
// directors, the Host, Biz Dev and the Community agent among them, has no job that runs yet, so none
// is offered (lib/board.ts CARD_ROLE_FOLDERS).
function useCardRoles(client: SupabaseClient): { roles: Role[]; loadError: string } {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let live = true;
    fetchCardRoles(client)
      .then((next) => {
        if (live) setRoles(next);
      })
      .catch((error: unknown) => {
        if (live) setLoadError(errorMessage(error));
      });
    return () => {
      live = false;
    };
  }, [client]);
  return { roles, loadError };
}

// Board members only; moderators never mount this, so they never load the studio state. The first
// thing on the page is the Needs you inbox. The inbox, the status and the heartbeat run at aal1, so
// attended dispatcher runs keep a board session; everything that changes state waits for the second
// factor.
function BoardControls({
  client,
  secondFactor,
  onVerified,
}: {
  client: SupabaseClient;
  secondFactor: boolean;
  onVerified: (verified: boolean) => void;
}) {
  const studio = useBoardStudioState(client);
  const [draft, setDraft] = useState<CreditDraft | null>(null);
  const creditForm = useRef<HTMLFormElement | null>(null);

  function fillCredit(next: CreditDraft) {
    setDraft({ ...next });
    creditForm.current?.scrollIntoView?.({ block: 'start' });
  }

  return (
    <>
      <NeedsYou client={client} canRecord={secondFactor} onFillCredit={fillCredit} />
      {secondFactor ? null : <TwoFactor client={client} onVerified={onVerified} />}
      {/* Pausing refreshes the status below, so the two never disagree about the agents. */}
      {secondFactor ? <PauseControls client={client} onChanged={studio.refresh} /> : null}
      <StudioStatus client={client} studio={studio} canChange={secondFactor} />
      <SessionStatus client={client} />
      {secondFactor ? (
        <>
          <CapsForm client={client} state={studio.state} onChanged={studio.refresh} />
          <CreditPurchaseForm client={client} draft={draft} formRef={creditForm} />
          <CardControls client={client} />
          <SecondFactorForms client={client} />
        </>
      ) : null}
    </>
  );
}

function SecondFactorForms({ client }: { client: SupabaseClient }) {
  const { roles, loadError } = useCardRoles(client);
  return (
    <>
      <NextCardForm client={client} roles={roles} rolesError={loadError} />
      <DirectiveForm client={client} roles={roles} rolesError={loadError} />
      <NoteForm client={client} />
    </>
  );
}

function StudioStatus({
  client,
  studio,
  canChange,
}: {
  client: SupabaseClient;
  studio: StudioLoad;
  canChange: boolean;
}) {
  const { state, loadError, refresh } = studio;
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  async function goLive() {
    if (!window.confirm(GO_LIVE_CONFIRM)) return;
    setBusy(true);
    try {
      const at = await setLaunched(client);
      setMessage(`The studio went live at ${formatDateTime(at.toISOString())}.`);
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function changeMode(mode: AgentMode) {
    setBusy(true);
    try {
      await setAgentMode(client, mode);
      setMessage(`Agent mode set to ${mode}. Restart the dispatcher in the same mode.`);
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const seenAgo = state === null ? null : dispatcherSeenAgoMs(state.dispatcher_seen_at, now);

  return (
    <section aria-label="Studio status">
      <h2>Studio</h2>
      {state === null ? (
        <p role="status">{loadError === '' ? 'Loading the studio state.' : loadError}</p>
      ) : (
        <>
          <p>Agents: {state.paused ? 'paused' : 'running'}.</p>
          <p>Agent mode: {state.agent_mode}.</p>
          <p>
            Dispatcher:{' '}
            {seenAgo === null ? 'not running' : `seen ${Math.round(seenAgo / 1000)} s ago`}.
          </p>
          <p>
            {state.launched_at === null
              ? 'Not live yet.'
              : `Live since ${formatDateTime(state.launched_at)}.`}
          </p>
          <p>
            Daily cap {formatUsd(state.daily_cap_usd)}. Card maximum {formatUsd(state.card_max_usd)}.
            {state.agent_hourly_rate_usd === null ? null : ` Hourly rate ${formatUsd(state.agent_hourly_rate_usd)}.`}
            {state.monthly_cap_usd === null ? null : ` Monthly cap ${formatUsd(state.monthly_cap_usd)}.`}
            {state.credit_studio_daily_cap_usd === null
              ? null
              : ` Studio daily limit on immediate credit ${formatUsd(state.credit_studio_daily_cap_usd)}.`}
            {state.anthropic_tier_cap_usd === null
              ? ' No usage tier cap.'
              : ` Usage tier cap ${formatUsd(state.anthropic_tier_cap_usd)}.`}
          </p>
          <p>Studio code lane: {state.platform_lane_open ? 'open' : 'closed'}.</p>
          {canChange && state.launched_at === null ? (
            <button type="button" disabled={busy} onClick={() => void goLive()}>
              Go live
            </button>
          ) : null}
          {canChange ? (
            <>
              <fieldset disabled={busy}>
                <legend>Agent mode</legend>
                <div className="row">
                  {agentModes.map((mode) => (
                    <label key={mode} className="choice">
                      <input
                        type="radio"
                        name="agent-mode"
                        value={mode}
                        checked={state.agent_mode === mode}
                        onChange={() => void changeMode(mode)}
                      />
                      {mode}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p>Restart the dispatcher in the same mode.</p>
            </>
          ) : null}
          {loadError === '' ? null : <p className="error">{loadError}</p>}
        </>
      )}
      {message === '' ? null : <p role="status">{message}</p>}
    </section>
  );
}

function SessionStatus({ client }: { client: SupabaseClient }) {
  const [lastSeen, setLastSeen] = useState<Date | null>(null);
  const [beatError, setBeatError] = useState('');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let live = true;
    const beat = () => {
      heartbeat(client)
        .then((seen) => {
          if (!live) return;
          setLastSeen(seen);
          setBeatError('');
        })
        .catch((error: unknown) => {
          if (live) setBeatError(errorMessage(error));
        });
    };
    const beatIfVisible = () => {
      if (document.visibilityState === 'visible') beat();
    };
    beat();
    const timer = setInterval(beatIfVisible, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', beatIfVisible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', beatIfVisible);
    };
  }, [client]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const expiry = lastSeen === null ? null : sessionExpiry(lastSeen);
  const active = expiry !== null && expiry.getTime() > now.getTime();

  return (
    <section aria-label="Board session">
      <p role="status">
        {active && expiry !== null
          ? `Board session: active until ${formatClock(expiry)}.`
          : 'Board session: not active. Keep this page open to run attended agent sessions.'}
      </p>
      {beatError === '' ? null : <p className="error">{beatError}</p>}
    </section>
  );
}

function PauseControls({ client, onChanged }: { client: SupabaseClient; onChanged?: () => Promise<void> }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<PauseReason>('board');

  async function apply(paused: boolean) {
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
      <h2>Agents</h2>
      <label>
        Pause reason
        <select value={reason} disabled={busy} onChange={(event) => setReason(event.target.value as PauseReason)}>
          {PAUSE_REASONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => void apply(true)}>
          Pause agents
        </button>
        <button type="button" disabled={busy} onClick={() => void apply(false)}>
          Resume agents
        </button>
      </div>
      {message === '' ? null : <p role="status">{message}</p>}
    </section>
  );
}

/** A dollar field: a finite number of zero or more, or null. */
function dollars(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

type RequiredCap = Exclude<keyof Caps, 'anthropic_tier_cap_usd'>;

const CAP_FIELDS = [
  { key: 'daily_cap_usd', label: 'Daily spend cap (USD)' },
  { key: 'card_max_usd', label: 'Per-card spend ceiling (USD)' },
  { key: 'agent_hourly_rate_usd', label: 'Agent hourly rate (USD)' },
  { key: 'monthly_cap_usd', label: 'Monthly spend cap (USD)' },
  { key: 'credit_studio_daily_cap_usd', label: 'Studio daily limit on immediate credit (USD)' },
] as const satisfies readonly { key: RequiredCap; label: string }[];

export const TIER_CAP_LABEL = 'Anthropic usage tier monthly cap (USD)';

type CapForm = Record<keyof Caps, string>;

function capFormFrom(state: BoardStudioState | null): CapForm {
  const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value));
  return {
    daily_cap_usd: text(state?.daily_cap_usd),
    card_max_usd: text(state?.card_max_usd),
    agent_hourly_rate_usd: text(state?.agent_hourly_rate_usd),
    monthly_cap_usd: text(state?.monthly_cap_usd),
    credit_studio_daily_cap_usd: text(state?.credit_studio_daily_cap_usd),
    anthropic_tier_cap_usd: text(state?.anthropic_tier_cap_usd),
  };
}

/** set_caps: every cap at once, with a reason. The database checks each bound and records the change. */
function CapsForm({
  client,
  state,
  onChanged,
}: {
  client: SupabaseClient;
  state: BoardStudioState | null;
  onChanged: () => Promise<void>;
}) {
  const [edits, setEdits] = useState<Partial<CapForm>>({});
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const tierHintId = useId();
  const form = { ...capFormFrom(state), ...edits };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const caps = { anthropic_tier_cap_usd: null } as Caps;
    for (const field of CAP_FIELDS) {
      const value = dollars(form[field.key]);
      if (value === null) {
        setMessage(`${field.label} must be a dollar amount of zero or more.`);
        return;
      }
      caps[field.key] = value;
    }
    // Blank removes the usage tier cap; a value must be above zero.
    if (form.anthropic_tier_cap_usd.trim() !== '') {
      const tier = dollars(form.anthropic_tier_cap_usd);
      if (tier === null || tier <= 0) {
        setMessage(`${TIER_CAP_LABEL} must be above zero, or blank for none.`);
        return;
      }
      caps.anthropic_tier_cap_usd = tier;
    }
    if (reason.trim() === '') {
      setMessage('A reason is required.');
      return;
    }
    setBusy(true);
    try {
      await setCaps(client, caps, reason.trim());
      setMessage('Caps saved.');
      setEdits({});
      setReason('');
      await onChanged();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="Set the caps">
      <h2>Caps</h2>
      <p>Every cap is saved together, with the reason, and the database checks each bound.</p>
      {CAP_FIELDS.map((field) => (
        <label key={field.key}>
          {field.label}
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            required
            value={form[field.key]}
            onChange={(event) => setEdits((previous) => ({ ...previous, [field.key]: event.target.value }))}
          />
        </label>
      ))}
      <label>
        {TIER_CAP_LABEL}
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          aria-describedby={tierHintId}
          value={form.anthropic_tier_cap_usd}
          onChange={(event) => setEdits((previous) => ({ ...previous, anthropic_tier_cap_usd: event.target.value }))}
        />
      </label>
      <p id={tierHintId}>The monthly limit the Console's Limits page shows for the studio organisation. Leave it blank for none.</p>
      <label>
        Reason
        <input required value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        Save caps
      </button>
      {message === '' ? null : <p role="status">{message}</p>}
    </form>
  );
}

/**
 * record_credit_purchase: Console credit bought for the agents, with the Stripe payout that paid for
 * it. The Needs you inbox fills it from the Controller's figure; the board still presses Record.
 */
function CreditPurchaseForm({
  client,
  draft,
  formRef,
}: {
  client: SupabaseClient;
  draft: CreditDraft | null;
  formRef: RefObject<HTMLFormElement | null>;
}) {
  const [amount, setAmount] = useState('');
  const [payout, setPayout] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (draft === null) return;
    setAmount(String(draft.amount_usd));
    setPayout(draft.stripe_payout_id);
    setReason(draft.reason);
    setMessage(FILLED_FROM_CONTROLLER);
  }, [draft]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = dollars(amount);
    if (value === null || value < 0.01) {
      setMessage('Amount must be at least $0.01.');
      return;
    }
    setBusy(true);
    try {
      await recordCreditPurchase(client, { amount_usd: value, stripe_payout_id: payout.trim(), reason: reason.trim() });
      setMessage(`Credit purchase of ${formatUsd(value)} recorded.`);
      setAmount('');
      setPayout('');
      setReason('');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="Record a credit purchase" ref={formRef}>
      <h2>Record a credit purchase</h2>
      <p>Record Console credit bought for the agents after a Stripe payout. Unattended agents spend only recorded credit.</p>
      <label>
        Amount (USD)
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label>
        Stripe payout id
        <input required value={payout} onChange={(event) => setPayout(event.target.value)} />
      </label>
      <label>
        Reason
        <input required value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        Record purchase
      </button>
      {message === '' ? null : <p role="status">{message}</p>}
    </form>
  );
}

const STAGE_WORDS: Record<string, string> = {
  proposed: 'open for funding',
  designing: 'in design',
  voted: 'picked by the board',
  funded: 'funded',
  paused: 'paused',
};

/** The horizon, rank, target, cancel and resume controls for one card. */
function CardControl({
  client,
  card,
  onChanged,
}: {
  client: SupabaseClient;
  card: BoardCard;
  onChanged: () => Promise<void>;
}) {
  const [horizon, setHorizon] = useState<Horizon>(card.horizon);
  const [rank, setRank] = useState(card.rank === null ? '' : String(card.rank));
  const [target, setTarget] = useState(card.funding_target_usd > 0 ? String(card.funding_target_usd) : '');
  const [estimate, setEstimate] = useState(card.estimate_usd > 0 ? String(card.estimate_usd) : '');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const idBase = useId();
  // Horizon and rank change only while the card is open for funding; the target only on a move to now.
  const movable = HORIZON_STAGES.includes(card.stage);
  const settableTarget = movable && card.horizon !== 'now';

  function needReason(): string | null {
    if (reason.trim() === '') {
      setMessage('A reason is required.');
      return null;
    }
    return reason.trim();
  }

  async function run(action: () => Promise<void>, done: string | (() => string)) {
    setBusy(true);
    try {
      await action();
      setMessage(typeof done === 'string' ? done : done());
      setReason('');
      await onChanged();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveHorizon(event: FormEvent) {
    event.preventDefault();
    if (!movable) return;
    const why = needReason();
    if (why === null) return;
    const rankValue = rank.trim() === '' ? null : Number(rank);
    if (rankValue !== null && (!Number.isInteger(rankValue) || rankValue < 0)) {
      setMessage('Rank must be a whole number of zero or more.');
      return;
    }
    // Only a move to now takes a target; a card already on now keeps the target it has.
    const toNow = movesToNow(card, horizon);
    const targetValue = dollars(target);
    if (toNow && (targetValue === null || targetValue < 0.01)) {
      setMessage('A card on horizon now needs a funding target of at least $0.01.');
      return;
    }
    await run(
      () =>
        setCardHorizon(client, {
          id: card.id,
          horizon,
          rank: rankValue,
          target_usd: toNow ? targetValue : null,
          reason: why,
        }),
      'Card saved.',
    );
  }

  async function cancel() {
    const why = needReason();
    if (why === null) return;
    if (!window.confirm(CANCEL_CONFIRM)) return;
    let moved = 0;
    await run(
      async () => {
        moved = await cancelCard(client, card.id, why);
      },
      () => (moved > 0 ? `Card cancelled. $${moved.toFixed(2)} of unspent money moved to the next cards in line.` : 'Card cancelled.'),
    );
  }

  async function resume() {
    const why = needReason();
    if (why === null) return;
    const value = dollars(estimate);
    if (value === null || value < 0.01) {
      setMessage('A new estimate of at least $0.01 is required.');
      return;
    }
    await run(() => resumeCard(client, card.id, value, why), 'Card resumed.');
  }

  return (
    <li>
      <form className="stack" onSubmit={saveHorizon} aria-label={`Card ${card.title}`}>
        <h3>{card.title}</h3>
        <p>
          {STAGE_WORDS[card.stage] ?? card.stage} · horizon {card.horizon}
          {card.rank === null ? '' : ` · rank ${card.rank}`} · {card.folder} {card.lane} ·{' '}
          {formatUsd(card.funded_usd)} of {formatUsd(card.funding_target_usd)}
        </p>
        {movable ? (
          <label>
            Horizon
            <select value={horizon} onChange={(event) => setHorizon(event.target.value as Horizon)}>
              {horizons.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {movable ? (
          <label>
            Rank
            <input type="number" inputMode="numeric" min="0" step="1" value={rank} onChange={(event) => setRank(event.target.value)} />
          </label>
        ) : null}
        {settableTarget ? (
          <label>
            Funding target (USD)
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              aria-describedby={`${idBase}-target`}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
        ) : null}
        {settableTarget ? <p id={`${idBase}-target`}>Needed to move the card to now.</p> : null}
        {movable && card.horizon === 'now' ? <p>A card with money on its bar stays on now; cancel it instead.</p> : null}
        {movable ? null : <p>A {STAGE_WORDS[card.stage] ?? card.stage} card can only be cancelled{card.stage === 'paused' ? ' or resumed' : ''}.</p>}
        {card.stage === 'paused' ? (
          <label>
            New estimate (USD)
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              aria-describedby={`${idBase}-estimate`}
              value={estimate}
              onChange={(event) => setEstimate(event.target.value)}
            />
          </label>
        ) : null}
        {card.stage === 'paused' ? (
          <p id={`${idBase}-estimate`}>At least what the card has already cost.</p>
        ) : null}
        <label>
          Reason
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <div className="row">
          {movable ? (
            <button type="submit" disabled={busy}>
              Save horizon and rank
            </button>
          ) : null}
          {card.stage === 'paused' ? (
            <button type="button" disabled={busy} onClick={() => void resume()}>
              Resume card
            </button>
          ) : null}
          <button type="button" className="button-secondary" disabled={busy} onClick={() => void cancel()}>
            Cancel card
          </button>
        </div>
        {message === '' ? null : <p role="status">{message}</p>}
      </form>
    </li>
  );
}

/** Every card the board can still move, cancel or resume, now first, then the roadmap. */
function CardControls({ client }: { client: SupabaseClient }) {
  const [cards, setCards] = useState<BoardCard[] | null>(null);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setCards(await fetchBoardCards(client));
      setLoadError('');
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section aria-label="Cards">
      <h2>Cards</h2>
      <p>
        Move a card between now, next and later, rank it, set its target, cancel it, or resume a paused card with a new
        estimate. Each change needs a reason and is recorded.
      </p>
      {cards === null ? <p role="status">{loadError === '' ? 'Loading the cards.' : loadError}</p> : null}
      {cards !== null && cards.length === 0 ? <p>No cards to manage.</p> : null}
      {cards !== null && cards.length > 0 ? (
        <ul className="board-cards">
          {cards.map((card) => (
            <CardControl key={`${card.id}-${card.horizon}-${card.rank}-${card.stage}`} client={client} card={card} onChanged={refresh} />
          ))}
        </ul>
      ) : null}
      {cards !== null && loadError !== '' ? <p className="error">{loadError}</p> : null}
    </section>
  );
}

// file_card and the cards.summary column both cap the summary at 200 characters.
const SUMMARY_MAX = 200;

const emptyCard = {
  bucket: buckets[0] as string,
  lane: lanes[0] as string,
  folder: folders[0] as string,
  title: '',
  summary: '',
  intent: '',
  acceptance_test: '',
  funding_target_usd: '',
  stage: 'proposed' as NextCardStage,
  board_reason: '',
  executor_role_id: '',
  horizon: 'now' as Horizon,
};

// file_card: a card for Fund what's next (horizon now) or for the roadmap (next or later). The target
// is not capped by the per-card spend ceiling; the database keeps a sane upper bound.
function NextCardForm({ client, roles, rolesError }: { client: SupabaseClient; roles: Role[]; rolesError: string }) {
  const hintId = useId();
  const summaryHintId = useId();
  const summaryCountId = useId();
  const [form, setForm] = useState({ ...emptyCard });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const executor = form.executor_role_id === '' ? (roles[0]?.id ?? '') : form.executor_role_id;

  function update<K extends keyof typeof emptyCard>(key: K, value: (typeof emptyCard)[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Refuse a blank summary here so the database is never called with one.
    if (form.summary.trim() === '') {
      setMessage('A public summary is required.');
      return;
    }
    // A roadmap card may leave the target blank; it gets one when the board moves it to now.
    const blankTarget = form.funding_target_usd.trim() === '';
    const target = blankTarget && form.horizon !== 'now' ? 0 : Number(form.funding_target_usd);
    if (form.horizon === 'now' ? !Number.isFinite(target) || target < 0.01 : !Number.isFinite(target) || target < 0) {
      setMessage(
        form.horizon === 'now'
          ? 'Funding target must be at least $0.01.'
          : 'Funding target must be a dollar amount of zero or more.',
      );
      return;
    }
    if (executor === '') {
      setMessage('Choose an executor role.');
      return;
    }
    setBusy(true);
    try {
      const id = await fileCard(client, {
        bucket: form.bucket,
        lane: form.lane,
        folder: form.folder,
        title: form.title.trim(),
        summary: form.summary.trim(),
        intent: form.intent.trim(),
        acceptance_test: form.acceptance_test.trim(),
        funding_target_usd: target,
        stage: form.stage,
        executor_role_id: executor,
        board_reason: form.board_reason.trim(),
        horizon: form.horizon,
      });
      setMessage(`Card filed as card ${id.slice(0, 8)}.`);
      setForm({ ...emptyCard });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="File a card">
      <h2>File a card</h2>
      <p>
        A card on horizon now shows on the site under Fund what's next. Supporters fund it; when its bar
        reaches the target the agents build it. A card on next or later shows on the roadmap and takes no money.
      </p>
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
      <label>
        Bucket
        <select value={form.bucket} onChange={(event) => update('bucket', event.target.value)}>
          {buckets.map((bucket) => (
            <option key={bucket} value={bucket}>
              {bucket}
            </option>
          ))}
        </select>
      </label>
      <label>
        Lane
        <select value={form.lane} onChange={(event) => update('lane', event.target.value)}>
          {lanes.map((lane) => (
            <option key={lane} value={lane}>
              {lane}
            </option>
          ))}
        </select>
      </label>
      <label>
        Folder
        <select value={form.folder} onChange={(event) => update('folder', event.target.value)}>
          {folders.map((folder) => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </select>
      </label>
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
        <textarea
          required
          rows={3}
          value={form.intent}
          onChange={(event) => update('intent', event.target.value)}
        />
      </label>
      <label>
        Acceptance test
        <textarea
          required
          rows={3}
          aria-describedby={hintId}
          value={form.acceptance_test}
          onChange={(event) => update('acceptance_test', event.target.value)}
        />
      </label>
      <p id={hintId}>Config-lane cards need a check: line. A card on horizon now needs check: lines too.</p>
      <label>
        Funding target (USD)
        <input
          type="number"
          inputMode="decimal"
          min={form.horizon === 'now' ? '0.01' : '0'}
          step="0.01"
          required={form.horizon === 'now'}
          value={form.funding_target_usd}
          onChange={(event) => update('funding_target_usd', event.target.value)}
        />
      </label>
      <fieldset>
        <legend>Stage</legend>
        <div className="row">
          {cardStages.map((stage) => (
            <label key={stage.value} className="choice">
              <input
                type="radio"
                name="card-stage"
                value={stage.value}
                checked={form.stage === stage.value}
                onChange={() => update('stage', stage.value)}
              />
              {stage.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        Reason (optional)
        <input
          value={form.board_reason}
          onChange={(event) => update('board_reason', event.target.value)}
        />
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
      <button type="submit" disabled={busy || roles.length === 0}>
        File card
      </button>
      {message === '' ? null : <p role="status">{message}</p>}
    </form>
  );
}

const emptyDirective = {
  bucket: buckets[0],
  lane: lanes[0],
  folder: folders[0],
  title: '',
  intent: '',
  acceptance_test: '',
  estimate_usd: '',
  board_reason: '',
  executor_role_id: '',
};

function DirectiveForm({ client, roles, rolesError }: { client: SupabaseClient; roles: Role[]; rolesError: string }) {
  const [form, setForm] = useState({ ...emptyDirective });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const executor = form.executor_role_id === '' ? (roles[0]?.id ?? '') : form.executor_role_id;

  function update<K extends keyof typeof emptyDirective>(key: K, value: string) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const estimate = Number(form.estimate_usd);
    if (!Number.isFinite(estimate) || estimate < 0) {
      setMessage('Estimate must be a dollar amount of zero or more.');
      return;
    }
    if (executor === '') {
      setMessage('Choose an executor role.');
      return;
    }
    setBusy(true);
    try {
      const id = await fileDirective(client, {
        bucket: form.bucket,
        lane: form.lane,
        folder: form.folder,
        title: form.title.trim(),
        intent: form.intent.trim(),
        acceptance_test: form.acceptance_test.trim(),
        estimate_usd: estimate,
        board_reason: form.board_reason.trim(),
        executor_role_id: executor,
      });
      setMessage(`Directive filed as card ${id.slice(0, 8)}.`);
      setForm({ ...emptyDirective });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="File a directive">
      <h2>File a directive</h2>
      <p>A directive enters the queue funded at priority 0, skips funding and still passes the gate.</p>
      <label>
        Bucket
        <select value={form.bucket} onChange={(event) => update('bucket', event.target.value)}>
          {buckets.map((bucket) => (
            <option key={bucket} value={bucket}>
              {bucket}
            </option>
          ))}
        </select>
      </label>
      <label>
        Lane
        <select value={form.lane} onChange={(event) => update('lane', event.target.value)}>
          {lanes.map((lane) => (
            <option key={lane} value={lane}>
              {lane}
            </option>
          ))}
        </select>
      </label>
      <label>
        Folder
        <select value={form.folder} onChange={(event) => update('folder', event.target.value)}>
          {folders.map((folder) => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input required value={form.title} onChange={(event) => update('title', event.target.value)} />
      </label>
      <label>
        Intent
        <textarea
          required
          rows={3}
          value={form.intent}
          onChange={(event) => update('intent', event.target.value)}
        />
      </label>
      <label>
        Acceptance test
        <textarea
          required
          rows={3}
          value={form.acceptance_test}
          onChange={(event) => update('acceptance_test', event.target.value)}
        />
      </label>
      <label>
        Estimate (USD)
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          required
          value={form.estimate_usd}
          onChange={(event) => update('estimate_usd', event.target.value)}
        />
      </label>
      <label>
        Reason
        <input
          required
          value={form.board_reason}
          onChange={(event) => update('board_reason', event.target.value)}
        />
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
      <button type="submit" disabled={busy || roles.length === 0}>
        File directive
      </button>
      {message === '' ? null : <p role="status">{message}</p>}
    </form>
  );
}

function NoteForm({ client }: { client: SupabaseClient }) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await fileNote(client, text.trim());
      setMessage('Note filed.');
      setText('');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="File a note">
      <h2>File a note</h2>
      <p>Notes are private advice for the Studio Head. Nothing reads them until note triage is built.</p>
      <label>
        Note
        <textarea required rows={4} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        File note
      </button>
      {message === '' ? null : <p role="status">{message}</p>}
    </form>
  );
}
