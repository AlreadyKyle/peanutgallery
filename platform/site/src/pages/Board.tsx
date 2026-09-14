import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState, type FormEvent } from 'react';
import {
  buckets,
  fetchBoardRole,
  fileDirective,
  fileNote,
  folders,
  heartbeat,
  HEARTBEAT_MS,
  lanes,
  sendMagicLink,
  sessionExpiry,
  setPaused,
  type BoardRole,
} from '../lib/board';
import { formatClock } from '../lib/format';
import type { Role } from '../lib/source';
import { useStudio } from '../lib/studio';
import { errorMessage, getClient } from '../lib/supabase';

const noDatabase = 'The site has no database configuration, so board sign-in is unavailable.';
const CLOCK_TICK_MS = 1_000;

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
      <div className="masthead">
        <h1 className="display">Board</h1>
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
      <p>Sign-in is limited to board accounts.</p>
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
      {role === 'board' || role === 'moderator' ? <PauseControls client={client} /> : null}
      {role === 'board' ? (
        <>
          <SessionStatus client={client} />
          <DirectiveForm client={client} />
          <NoteForm client={client} />
        </>
      ) : null}
    </>
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
      <p>Notes are private advisory text to the Studio Head.</p>
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
