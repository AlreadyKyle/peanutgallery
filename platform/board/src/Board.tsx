import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  agentModes,
  boardStudioState,
  buckets,
  cancelCard,
  canUnveto,
  canVeto,
  cardStages,
  COOLING_WINDOW_MAX,
  dispatcherSeenAgoMs,
  enqueueManualJob,
  enrolTotp,
  fetchBoardCards,
  fetchBoardJobs,
  fetchBoardRole,
  fetchBoardRoles,
  fetchCardRoles,
  fileCard,
  fileDirective,
  fileNote,
  folders,
  heartbeat,
  HEARTBEAT_MS,
  HORIZON_STAGES,
  horizons,
  JOB_BUTTONS,
  lanes,
  movesToNow,
  parseJobInput,
  recordCreditPurchase,
  resumeCard,
  runOutputFrom,
  sendMagicLink,
  sessionExpiry,
  setAgentMode,
  setCaps,
  setCardHorizon,
  setCardVeto,
  setCoolingWindow,
  setLaunched,
  setRolePause,
  PAUSE_REASONS,
  type PauseReason,
  setPaused,
  STUDIO_STATE_POLL_MS,
  TOTP_CODE,
  twoFactorState,
  undealt,
  verifyTotp,
  type AgentMode,
  type BoardCard,
  type BoardJob,
  type BoardRoleRow,
  type BoardRole,
  type BoardStudioState,
  type Caps,
  type Horizon,
  type NextCardStage,
  type Role,
  type RunOutput,
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
    if (busy) return;
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
      <button type="submit" aria-disabled={busy}>
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
      {role === 'moderator' ? (
        <>
          <PauseControls client={client} />
          <RolePauses client={client} canPause canResume={false} />
        </>
      ) : null}
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
    if (busy) return;
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
    if (busy) return;
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
        <button type="submit" aria-disabled={busy}>
          Verify
        </button>
      </form>
    );

  return (
    <section aria-label="Two-factor sign-in">
      <h2>Two-factor sign-in</h2>
      <p>
        A second factor is needed before you can pause agents or roles, go live, change the agent mode, the caps or
        the cooling window, record credit, move, veto, cancel or resume cards, run a job now, or file cards,
        directives and notes.
      </p>
      {state === null ? (
        <p role="status">{loadError === '' ? 'Checking two-factor sign-in.' : loadError}</p>
      ) : null}
      {state !== null && state.verifiedFactorId !== null ? (
        <p>Enter the code your authenticator app shows for Mob Machine.</p>
      ) : null}
      {state !== null && state.verifiedFactorId === null && enrolment === null ? (
        <>
          <p>This account has no authenticator app yet.</p>
          <button type="button" aria-disabled={busy} onClick={() => void startEnrolment()}>
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

// The roles that build cards, loaded once for the card and directive forms. No other role builds a
// card, so none is offered (lib/board.ts CARD_ROLE_FOLDERS): the Studio Head, the Game Designer and
// the Game Director run Rank now and Draft a game card, and the Host, Biz Dev and the Community agent
// have no job that runs yet.
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
  // The cards listed under Cards, id to title, which only the second factor shows; Needs you and the
  // role jobs' output link to these only.
  const [listedCards, setListedCards] = useState<ReadonlyMap<string, string>>(() => new Map());
  const creditForm = useRef<HTMLFormElement | null>(null);

  function fillCredit(next: CreditDraft) {
    setDraft({ ...next });
    creditForm.current?.scrollIntoView?.({ block: 'start' });
  }

  return (
    <>
      <NeedsYou client={client} canRecord={secondFactor} listedCards={listedCards} onFillCredit={fillCredit} />
      {secondFactor ? null : <TwoFactor client={client} onVerified={onVerified} />}
      {/* Pausing refreshes the status below, so the two never disagree about the agents. */}
      {secondFactor ? <PauseControls client={client} onChanged={studio.refresh} /> : null}
      <StudioStatus client={client} studio={studio} canChange={secondFactor} />
      <SessionStatus client={client} />
      <RolePauses client={client} canPause={secondFactor} canResume={secondFactor} />
      <JobsPanel client={client} canRun={secondFactor} cardTitles={listedCards} />
      {secondFactor ? (
        <>
          <CapsForm client={client} state={studio.state} onChanged={studio.refresh} />
          <CoolingWindowForm client={client} state={studio.state} onChanged={studio.refresh} />
          <CreditPurchaseForm client={client} draft={draft} formRef={creditForm} />
          <CardControls client={client} onListed={setListedCards} />
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
    if (busy) return;
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
    if (busy) return;
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
            <button type="button" aria-disabled={busy} onClick={() => void goLive()}>
              Go live
            </button>
          ) : null}
          {canChange ? (
            <>
              <fieldset aria-disabled={busy}>
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
      <h2>Agents</h2>
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
    if (busy) return;
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
      <button type="submit" aria-disabled={busy}>
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
    if (busy) return;
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
      <button type="submit" aria-disabled={busy}>
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

/**
 * The horizon, rank, target, veto, cancel and resume controls for one card. The row is keyed by the
 * card alone, so it stays mounted when an action changes the card's stage, horizon or rank: its
 * confirmation stays shown and announced, and the fields follow the card as the database has it.
 */
function CardControl({
  client,
  card,
  onChanged,
  onCancelled,
}: {
  client: SupabaseClient;
  card: BoardCard;
  /** Reloads the list; `focused` is the control to focus again if the reload moved this row. */
  onChanged: (focused: HTMLElement | null) => Promise<void>;
  /** A cancelled card leaves the list, so its confirmation is said above the list. */
  onCancelled: (notice: string) => void;
}) {
  const [horizon, setHorizon] = useState<Horizon>(card.horizon);
  const [rank, setRank] = useState(card.rank === null ? '' : String(card.rank));
  const [target, setTarget] = useState(card.funding_target_usd > 0 ? String(card.funding_target_usd) : '');
  const [estimate, setEstimate] = useState(card.estimate_usd > 0 ? String(card.estimate_usd) : '');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const idBase = useId();
  const row = useRef<HTMLLIElement | null>(null);
  const stored = `${card.stage} ${card.horizon} ${card.rank} ${card.funding_target_usd} ${card.estimate_usd}`;
  const [shown, setShown] = useState(stored);
  if (shown !== stored) {
    setShown(stored);
    setHorizon(card.horizon);
    setRank(card.rank === null ? '' : String(card.rank));
    setTarget(card.funding_target_usd > 0 ? String(card.funding_target_usd) : '');
    setEstimate(card.estimate_usd > 0 ? String(card.estimate_usd) : '');
  }
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

  async function run(action: () => Promise<void>, done: string) {
    if (busy) return;
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && row.current?.contains(active) ? active : null;
    setBusy(true);
    try {
      await action();
      setMessage(done);
      setReason('');
      await onChanged(focused);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveHorizon(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
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
    if (busy) return;
    const why = needReason();
    if (why === null) return;
    if (!window.confirm(CANCEL_CONFIRM)) return;
    await run(async () => {
      const moved = await cancelCard(client, card.id, why);
      onCancelled(`Card ${card.title} cancelled.${moved > 0 ? ` $${moved.toFixed(2)} of unspent money moved to the next cards in line.` : ''}`);
    }, '');
  }

  async function resume() {
    if (busy) return;
    const why = needReason();
    if (why === null) return;
    const value = dollars(estimate);
    if (value === null || value < 0.01) {
      setMessage('A new estimate of at least $0.01 is required.');
      return;
    }
    await run(() => resumeCard(client, card.id, value, why), 'Card resumed.');
  }

  async function veto(vetoed: boolean) {
    if (busy) return;
    const why = needReason();
    if (why === null) return;
    await run(() => setCardVeto(client, card.id, vetoed, why), vetoed ? 'Card vetoed.' : 'Veto lifted.');
  }

  return (
    <li id={`card-${card.id}`} ref={row}>
      <form className="stack" onSubmit={saveHorizon} aria-label={`Card ${card.title}`}>
        <h3>{card.title}</h3>
        <p>
          {stageWord(card)} · horizon {card.horizon}
          {card.rank === null ? '' : ` · rank ${card.rank}`} · {card.folder} {card.lane} ·{' '}
          {formatUsd(card.funded_usd)} of {formatUsd(card.funding_target_usd)}
        </p>
        <CardMarks card={card} />
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
            <button type="submit" aria-disabled={busy}>
              Save horizon and rank
            </button>
          ) : null}
          {card.stage === 'paused' ? (
            <button type="button" aria-disabled={busy} onClick={() => void resume()}>
              Resume card
            </button>
          ) : null}
          {/* One button that changes its words, so the keyboard user's focus stays on it after a veto. */}
          {canVeto(card) || canUnveto(card) ? (
            <button type="button" className="button-secondary" aria-disabled={busy} onClick={() => void veto(!card.board_vetoed)}>
              {card.board_vetoed ? 'Lift veto' : 'Veto card'}
            </button>
          ) : null}
          <button type="button" className="button-secondary" aria-disabled={busy} onClick={() => void cancel()}>
            Cancel card
          </button>
        </div>
        {message === '' ? null : <p role="status">{message}</p>}
      </form>
    </li>
  );
}

/** The board's veto reason after a colon, without its own closing stop, so the mark ends with one. */
function vetoReason(reason: string | null): string {
  const trimmed = (reason ?? '').trim().replace(/[.!?]+$/, '');
  return trimmed === '' ? '' : `: ${trimmed}`;
}

/** The card row's stage word; a vetoed card or one waiting to be dealt is not open for funding. */
function stageWord(card: BoardCard): string {
  if (card.board_vetoed && HORIZON_STAGES.includes(card.stage)) return 'vetoed';
  if (undealt(card)) return 'waiting to be dealt';
  return STAGE_WORDS[card.stage] ?? card.stage;
}

/**
 * What the public does not see about a card (docs/specs/agent-system-core.md): an approved agent card
 * waiting to be dealt, an agent card with no current approval, and the board's veto.
 */
function CardMarks({ card }: { card: BoardCard }) {
  const marks: string[] = [];
  if (card.approval === 'current') marks.push('Written by an agent; its approval is current.');
  if (undealt(card)) marks.push(`Waiting to be dealt: moves to now at ${formatDateTime(card.opens_at!)}.`);
  if (card.approval === 'missing') marks.push('Hidden: written by an agent with no current approval. The public does not see it, no session runs it and it takes no money.');
  if (card.board_vetoed) marks.push(`Vetoed by the board${vetoReason(card.board_veto_reason)}. It is never dealt or run.`);
  if (marks.length === 0) return null;
  return (
    <ul className="marks">
      {marks.map((mark) => (
        <li key={mark}>{mark}</li>
      ))}
    </ul>
  );
}

/**
 * Every card the board can still move, cancel or resume, now first, then the roadmap. It tells Needs
 * you which cards are listed (onListed), so an inbox item links only to a row that is on the page.
 */
function CardControls({ client, onListed }: { client: SupabaseClient; onListed: (cards: ReadonlyMap<string, string>) => void }) {
  const [cards, setCards] = useState<BoardCard[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const noticeLine = useRef<HTMLParagraphElement | null>(null);
  const refocus = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCards(await fetchBoardCards(client));
      setLoadError('');
    } catch (error) {
      refocus.current = null;
      setLoadError(errorMessage(error));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    onListed(new Map((cards ?? []).map((card) => [card.id, card.title])));
  }, [cards, onListed]);

  // An action that changes a card's horizon or rank moves its row, and a browser drops focus from an
  // element it moves; a cancelled card leaves the list. Once the list is redrawn, the control that was
  // focused gets focus back, or the notice does when its card is gone, unless focus went elsewhere.
  useLayoutEffect(() => {
    const control = refocus.current;
    refocus.current = null;
    if (control === null) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    (control.isConnected ? control : noticeLine.current)?.focus();
  }, [cards]);

  const changed = useCallback(
    async (focused: HTMLElement | null) => {
      refocus.current = focused;
      await refresh();
    },
    [refresh],
  );

  return (
    <section aria-label="Cards">
      <h2>Cards</h2>
      <p>
        Move a card between now, next and later, rank it, set its target, veto it, cancel it, or resume a paused card
        with a new estimate. Each change needs a reason and is recorded. Undealt and hidden agent cards are listed
        here, and nowhere public.
      </p>
      {notice === '' ? null : (
        <p role="status" tabIndex={-1} ref={noticeLine}>
          {notice}
        </p>
      )}
      {cards === null ? <p role="status">{loadError === '' ? 'Loading the cards.' : loadError}</p> : null}
      {cards !== null && cards.length === 0 ? <p>No cards to manage.</p> : null}
      {cards !== null && cards.length > 0 ? (
        <ul className="board-cards">
          {cards.map((card) => (
            <CardControl key={card.id} client={client} card={card} onChanged={changed} onCancelled={setNotice} />
          ))}
        </ul>
      ) : null}
      {cards !== null && loadError !== '' ? <p className="error">{loadError}</p> : null}
    </section>
  );
}

/**
 * The cooling window (docs/specs/agent-system-core.md): how long an approved agent card waits on next
 * before the tick deals it to now, and money can reach it. It ships at 0; the board sets it, up to a
 * week, with a reason.
 */
function CoolingWindowForm({
  client,
  state,
  onChanged,
}: {
  client: SupabaseClient;
  state: BoardStudioState | null;
  onChanged: () => Promise<void>;
}) {
  const [minutes, setMinutes] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const value = minutes ?? (state === null ? '' : String(state.cooling_window_minutes));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const n = Number(value);
    if (value.trim() === '' || !Number.isInteger(n) || n < 0 || n > COOLING_WINDOW_MAX) {
      setMessage('The cooling window must be a whole number of minutes from 0 to 10,080.');
      return;
    }
    if (reason.trim() === '') {
      setMessage('A reason is required.');
      return;
    }
    setBusy(true);
    try {
      await setCoolingWindow(client, n, reason.trim());
      setMessage(n === 0 ? 'Cooling window saved: an approved agent card is dealt on the next tick.' : `Cooling window saved: ${n} minutes.`);
      setMinutes(null);
      setReason('');
      await onChanged();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="Set the cooling window">
      <h2>Cooling window</h2>
      <p>How long an approved agent card waits on next before it moves to now and can take money. 0 deals it on the next tick.</p>
      <label>
        Cooling window (minutes)
        <input type="number" inputMode="numeric" min="0" max={COOLING_WINDOW_MAX} step="1" required value={value} onChange={(event) => setMinutes(event.target.value)} />
      </label>
      <label>
        Reason
        <input required value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <button type="submit" aria-disabled={busy}>
        Save cooling window
      </button>
      {message === '' ? null : <p role="status">{message}</p>}
    </form>
  );
}

const CLASS_WORDS: Record<string, string> = {
  writer: 'writer',
  planner: 'planner',
  reviewer: 'reviewer',
  read_only: 'read only',
  web_only: 'web only',
};

function roleStatus(role: BoardRoleRow): string {
  if (!role.paused) return 'not paused';
  return role.paused_reason ? `paused: ${role.paused_reason}` : 'paused';
}

/**
 * Each role with its trust class and pause (board_roles), one table row each, and one form under the
 * table that pauses or resumes the role chosen. A paused role starts nothing and its running session
 * stops at the next watch; its card returns to funded. The board or the moderator pauses a role; only
 * the board resumes one, at the second factor. The form and its status line stay mounted when the
 * list refreshes, so the confirmation is announced and keyboard focus stays on the button.
 */
function RolePauses({ client, canPause, canResume }: { client: SupabaseClient; canPause: boolean; canResume: boolean }) {
  const [roles, setRoles] = useState<BoardRoleRow[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [chosen, setChosen] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRoles(await fetchBoardRoles(client));
      setLoadError('');
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The board pauses and resumes; the moderator only pauses, so a paused role is listed but not
  // offered to it.
  const offered = (option: BoardRoleRow) => (option.paused ? canResume : canPause);
  const role = (roles ?? []).find((option) => option.id === chosen && offered(option)) ?? null;

  async function apply(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (role === null) {
      setMessage('Choose a role.');
      return;
    }
    if (reason.trim() === '') {
      setMessage('A reason is required.');
      return;
    }
    setBusy(true);
    try {
      await setRolePause(client, role.id, !role.paused, reason.trim());
      setMessage(role.paused ? `${role.name} resumed.` : `${role.name} paused.`);
      setReason('');
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Roles">
      <h2>Roles</h2>
      <p>
        Pause a role to stop its work: it starts nothing, and a session it is running stops and its card goes back to
        funded.{' '}
        {canResume
          ? 'Resuming needs a reason too.'
          : canPause
            ? 'Only the board resumes a role.'
            : 'Verify your second factor to pause or resume a role.'}
      </p>
      {roles === null ? <p role="status">{loadError === '' ? 'Loading the roles.' : loadError}</p> : null}
      {roles !== null && roles.length === 0 ? <p>No roles yet.</p> : null}
      {roles !== null && roles.length > 0 ? (
        <table className="role-table">
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Class</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  {row.name}
                  {row.state === 'retired' ? ' (retired)' : ''}
                </th>
                <td>{row.agent_class === null ? 'no class yet' : (CLASS_WORDS[row.agent_class] ?? row.agent_class)}</td>
                <td>{roleStatus(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {roles !== null && loadError !== '' ? <p className="error">{loadError}</p> : null}
      {roles !== null && roles.length > 0 && (canPause || canResume) ? (
        <form className="stack" onSubmit={apply} aria-label="Pause or resume a role">
          <label>
            Role
            <select value={role === null ? '' : role.id} onChange={(event) => setChosen(event.target.value)}>
              <option value="">Choose a role</option>
              {roles.map((option) => (
                <option key={option.id} value={option.id} disabled={!offered(option)}>
                  {`${option.name}${option.paused ? ' (paused)' : ''}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason
            <input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <button type="submit" aria-disabled={busy}>
            {role === null ? (canResume ? 'Pause or resume' : 'Pause') : role.paused ? `Resume ${role.name}` : `Pause ${role.name}`}
          </button>
        </form>
      ) : null}
      <p role="status" className="role-status">
        {message}
      </p>
    </section>
  );
}

const RUN_WORDS: Record<string, string> = {
  queued: 'queued',
  running: 'running',
  succeeded: 'done',
  failed: 'failed',
  skipped: 'skipped',
};

const shortCard = (id: string) => id.replace(/-/g, '').slice(0, 8);

/** A code in running text: already_holds reads "already holds". */
const codeWords = (code: string) => code.replace(/_/g, ' ');

/** The Game Director's verdict on a round, in words. */
const VERDICT_WORDS: Record<string, string> = {
  approved: 'Approved',
  revise: 'Sent back to revise',
  flagged: 'Flagged',
};

/**
 * A card a run names: its title, linked to its row under Cards while that row is listed (as Needs you
 * links), else the fallback title, else its short id.
 */
function CardName({ id, titles, fallback = null }: { id: string; titles: ReadonlyMap<string, string>; fallback?: string | null }) {
  const title = titles.get(id);
  if (title !== undefined) return <a href={`#card-${id}`}>{title}</a>;
  return <>{fallback ?? `card ${shortCard(id)}`}</>;
}

/** A role job's typed output under its run: the ranking's moves, or the draft's result and rounds. */
function RunOutputLines({ output, cardTitles }: { output: RunOutput; cardTitles: ReadonlyMap<string, string> }) {
  if (output.kind === 'ranking') {
    return (
      <>
        {output.moves.length === 0 ? (
          <p className="muted">Moved no card.</p>
        ) : (
          <ol className="job-runs">
            {output.moves.map((move) => (
              <li key={move.card_id}>
                <CardName id={move.card_id} titles={cardTitles} />: from {move.from === null ? 'no rank' : `rank ${move.from}`} to rank {move.to}
              </li>
            ))}
          </ol>
        )}
        {output.unapplied > 0 ? <p className="muted">{output.unapplied === 1 ? '1 more kept its rank.' : `${output.unapplied} more kept their ranks.`}</p> : null}
      </>
    );
  }
  const approvedTitle = output.rounds.find((round) => round.verdict?.result === 'approved')?.title ?? null;
  return (
    <>
      <p className="muted">
        {output.result === 'approved' && output.card_id ? (
          <>
            Approved: <CardName id={output.card_id} titles={cardTitles} fallback={approvedTitle} /> waits out the cooling window, then is dealt to now.
          </>
        ) : (
          `Withdrawn${output.reason ? `: ${codeWords(output.reason)}` : ''}. No card was written.`
        )}
      </p>
      {output.rounds.length === 0 ? null : (
        <ol className="job-runs">
          {output.rounds.map((round) => (
            <li key={round.round}>
              {round.title === null
                ? 'No valid draft.'
                : `${round.title} (${round.lane ?? 'no lane'}, ${round.executor ?? 'no executor'}, ${round.estimate_usd === null ? 'no estimate' : formatUsd(round.estimate_usd)}): ${round.summary ?? ''}`}
              {round.check ? ` Refused by the ${codeWords(round.check.name)} check: ${round.check.detail}` : ''}
              {round.verdict
                ? ` ${VERDICT_WORDS[round.verdict.result] ?? codeWords(round.verdict.result)}: ${round.verdict.reason_codes.map(codeWords).join(', ')}.${round.verdict.note ? ` ${round.verdict.note}` : ''}`
                : ''}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** A job's name as a heading: studio_ranking reads "Studio ranking". */
function jobTitle(name: string): string {
  const words = name.replace(/_/g, ' ').trim();
  return words === '' ? name : words[0]!.toUpperCase() + words.slice(1);
}

/** Who queued a run. */
const ORIGIN_WORDS: Record<string, string> = {
  board: 'Run now',
  schedule: 'scheduled',
  event: 'after an event',
  operator: 'by the operator',
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

function JobRow({
  client,
  job,
  canRun,
  cardTitles,
  onChanged,
}: {
  client: SupabaseClient;
  job: BoardJob;
  canRun: boolean;
  cardTitles: ReadonlyMap<string, string>;
  onChanged: () => Promise<void>;
}) {
  // The role jobs have a button of their own and send {}; every other job takes typed input.
  const named = JOB_BUTTONS[job.name];
  const [reason, setReason] = useState('');
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function runNow(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (reason.trim() === '') {
      setMessage('A reason is required.');
      return;
    }
    let typed: Record<string, unknown>;
    try {
      typed = named ? {} : parseJobInput(input);
    } catch (error) {
      setMessage(errorMessage(error));
      return;
    }
    setBusy(true);
    try {
      await enqueueManualJob(client, { name: job.name, card_id: null, reason: reason.trim(), input: typed });
      setMessage(job.calls_model ? 'Queued. It runs while a board member is signed in here.' : 'Queued. It runs on the next dispatcher tick.');
      setReason('');
      setInput('');
      await onChanged();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <form className="stack" onSubmit={runNow} aria-label={`Job ${job.name}`}>
        <h3>{jobTitle(job.name)}</h3>
        <p>
          {job.role_name ?? 'No role'} · {job.calls_model ? 'calls a model, on the board plan while you are signed in' : 'code only'}
          {job.runs_when_paused ? ' · runs while the studio is paused' : ''}
        </p>
        {job.description ? <p>{job.description}</p> : null}
        {job.runs.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : (
          <ul className="job-runs">
            {job.runs.map((run) => {
              const output = runOutputFrom(job.name, run.output);
              return (
                <li key={run.id}>
                  {formatDateTime(run.created_at)} · {ORIGIN_WORDS[run.origin] ?? run.origin} · {RUN_WORDS[run.status] ?? run.status}
                  {run.reason ? `: ${REASON_WORDS[run.reason] ?? run.reason}` : ''}
                  {output ? <RunOutputLines output={output} cardTitles={cardTitles} /> : null}
                </li>
              );
            })}
          </ul>
        )}
        {canRun ? (
          <>
            {named ? null : (
              <label>
                Input (JSON, optional)
                <textarea rows={2} value={input} onChange={(event) => setInput(event.target.value)} />
              </label>
            )}
            <label>
              Reason
              <input value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <button type="submit" aria-disabled={busy}>
              {named ?? 'Run now'}
            </button>
          </>
        ) : null}
        {message === '' ? null : <p role="status">{message}</p>}
      </form>
    </li>
  );
}

/**
 * The job queue (board_jobs): each job with its last runs, their origin and why a run was skipped or
 * failed. Run now queues a board-origin run; a model-calling one runs only while a board member is
 * signed in here, billed to the board's plan.
 */
function JobsPanel({ client, canRun, cardTitles }: { client: SupabaseClient; canRun: boolean; cardTitles: ReadonlyMap<string, string> }) {
  const [jobs, setJobs] = useState<BoardJob[] | null>(null);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setJobs(await fetchBoardJobs(client));
      setLoadError('');
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section aria-label="Jobs">
      <h2>Jobs</h2>
      {jobs === null ? <p role="status">{loadError === '' ? 'Loading the jobs.' : loadError}</p> : null}
      {jobs !== null && jobs.length === 0 ? <p>No jobs yet. Each is added with the work it runs.</p> : null}
      {jobs !== null && jobs.length > 0 && !canRun ? <p>Verify your second factor to run a job now.</p> : null}
      {jobs !== null && jobs.length > 0 ? (
        <ul className="board-cards">
          {jobs.map((job) => (
            <JobRow key={job.name} client={client} job={job} canRun={canRun} cardTitles={cardTitles} onChanged={refresh} />
          ))}
        </ul>
      ) : null}
      {jobs !== null && loadError !== '' ? <p className="error">{loadError}</p> : null}
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
    if (busy) return;
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
      <button type="submit" disabled={roles.length === 0} aria-disabled={busy}>
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
    if (busy) return;
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
      <button type="submit" disabled={roles.length === 0} aria-disabled={busy}>
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
    if (busy) return;
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
      <button type="submit" aria-disabled={busy}>
        File note
      </button>
      {message === '' ? null : <p role="status">{message}</p>}
    </form>
  );
}
