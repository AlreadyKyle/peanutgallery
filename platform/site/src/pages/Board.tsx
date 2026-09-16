import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { PageHeader } from '../components/PageHeader';
import {
  agentModes,
  boardStudioState,
  buckets,
  cardStages,
  dispatcherSeenAgoMs,
  enrolTotp,
  fetchBoardRole,
  fileCard,
  fileDirective,
  fileNote,
  folders,
  heartbeat,
  HEARTBEAT_MS,
  lanes,
  sendMagicLink,
  sessionExpiry,
  setAgentMode,
  setLaunched,
  setPaused,
  STUDIO_STATE_POLL_MS,
  TOTP_CODE,
  twoFactorState,
  verifyTotp,
  type AgentMode,
  type BoardRole,
  type BoardStudioState,
  type NextCardStage,
  type TotpEnrolment,
  type TwoFactorState,
} from '../lib/board';
import { formatClock, formatDateTime, formatUsd } from '../lib/format';
import type { Role } from '../lib/source';
import { useStudio } from '../lib/studio';
import { errorMessage, getClient } from '../lib/supabase';

const noDatabase = 'The site has no database configuration, so board sign-in is unavailable.';
const CLOCK_TICK_MS = 1_000;
export const GO_LIVE_CONFIRM = 'Mark the studio live now? This is recorded once and cannot be undone.';

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
      <PageHeader
        title="Board"
        lede="Private controls for the board. Sign-in is limited to board accounts."
      />
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
      {role === 'board' ? (
        <>
          {secondFactor ? null : <TwoFactor client={client} onVerified={setSecondFactor} />}
          {secondFactor ? <PauseControls client={client} /> : null}
          <BoardControls client={client} secondFactor={secondFactor} />
        </>
      ) : null}
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
        A second factor is needed before you can pause agents, go live, change the agent mode, or file cards,
        directives and notes.
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

// Board members only; moderators never mount this, so they never load the studio state. The status
// and the heartbeat run at aal1, so attended dispatcher runs keep a board session; everything that
// changes state waits for the second factor.
function BoardControls({ client, secondFactor }: { client: SupabaseClient; secondFactor: boolean }) {
  const studio = useBoardStudioState(client);
  return (
    <>
      <StudioStatus client={client} studio={studio} canChange={secondFactor} />
      <SessionStatus client={client} />
      {secondFactor ? (
        <>
          <NextCardForm client={client} cardMaxUsd={studio.state?.card_max_usd ?? null} />
          <DirectiveForm client={client} />
          <NoteForm client={client} />
        </>
      ) : null}
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
          </p>
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

function PauseControls({ client }: { client: SupabaseClient }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function apply(paused: boolean) {
    setBusy(true);
    try {
      await setPaused(client, paused);
      setMessage(paused ? 'Agents paused.' : 'Agents resumed.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Pause and resume">
      <h2>Agents</h2>
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

function executors(roles: Role[]): Role[] {
  return roles.filter((role) => role.write_access && role.state === 'active');
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
};

function NextCardForm({
  client,
  cardMaxUsd,
}: {
  client: SupabaseClient;
  // From board_studio_state; null until loaded, and file_card still enforces the cap.
  cardMaxUsd: number | null;
}) {
  const studio = useStudio();
  const roles = studio.state === 'ready' ? executors(studio.snapshot.roles) : [];
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
    const target = Number(form.funding_target_usd);
    const tooHigh = cardMaxUsd !== null && target > cardMaxUsd;
    if (!Number.isFinite(target) || target < 0.01 || tooHigh) {
      setMessage(
        cardMaxUsd === null
          ? 'Funding target must be at least $0.01.'
          : `Funding target must be between $0.01 and ${formatUsd(cardMaxUsd)}.`,
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
      });
      setMessage(`Next card filed as card ${id.slice(0, 8)}.`);
      setForm({ ...emptyCard });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="File a Next card">
      <h2>File a Next card</h2>
      <p>
        A Next card shows on the site under Fund what's next. Supporters fund it to vote for it;
        when its bar reaches the target the agents build it.
      </p>
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
      <p id={hintId}>Config-lane cards need a check: line.</p>
      <label>
        Funding target (USD)
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          max={cardMaxUsd ?? undefined}
          step="0.01"
          required
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
      {roles.length === 0 ? <p>No active roles with write access are loaded.</p> : null}
      <button type="submit" disabled={busy || roles.length === 0}>
        File Next card
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

function DirectiveForm({ client }: { client: SupabaseClient }) {
  const studio = useStudio();
  const roles = studio.state === 'ready' ? executors(studio.snapshot.roles) : [];
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
      <p>A directive enters the queue funded at priority 0, skips the vote and still passes the gate.</p>
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
      {roles.length === 0 ? <p>No active roles with write access are loaded.</p> : null}
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
