import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_SESSION_TTL_MIN, HEARTBEAT_MS, sessionExpiry } from '../lib/board';
import { formatClock } from '../lib/format';
import type { Snapshot, StudioSource } from '../lib/source';
import { SourceProvider } from '../lib/studio';
import { Board } from './Board';

type RpcCall = { name: string; args: Record<string, unknown> | undefined };

const fake = vi.hoisted(() => ({
  role: 'board' as string | null,
  heartbeatFails: false,
  noClient: false,
  seenAt: '2026-09-14T12:00:00Z',
  calls: [] as { name: string; args: Record<string, unknown> | undefined }[],
}));

vi.mock('../lib/supabase', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/supabase')>();
  const session = { user: { email: 'board@peanutgallery.games' } };
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: () => Promise.resolve({ error: null }),
    },
    rpc: (name: string, args?: Record<string, unknown>) => {
      fake.calls.push({ name, args });
      if (name === 'board_heartbeat' && fake.heartbeatFails) {
        return Promise.resolve({ data: null, error: { message: 'heartbeat refused' } });
      }
      const data: Record<string, unknown> = {
        board_role: fake.role,
        board_heartbeat: fake.seenAt,
        set_paused: null,
        file_directive: '4f2c9d1e-7b3a-4e6f-8a90-1c2d3e4f5a6b',
        file_note: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      };
      return Promise.resolve({ data: data[name] ?? null, error: null });
    },
  };
  return { ...original, getClient: () => (fake.noClient ? null : client) };
});

const snapshot: Snapshot = {
  pool: null,
  goals: [],
  totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
  events: [],
  deploys: [],
  roles: [
    { id: 'r-builder-a', title: 'Builder A', write_access: true, state: 'active' },
    { id: 'r-host', title: 'Host', write_access: false, state: 'active' },
  ],
  cardTitles: {},
};

const source: StudioSource = {
  load: () => Promise.resolve(snapshot),
  subscribe: () => () => {},
};

const startedAt = new Date('2026-09-14T12:00:00Z');
const notActive = 'Board session: not active. Keep this page open to run attended agent sessions.';

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderBoard() {
  render(
    <SourceProvider source={source}>
      <Board />
    </SourceProvider>,
  );
  await flush();
}

function callsNamed(name: string): RpcCall[] {
  return fake.calls.filter((call) => call.name === name);
}

function activeLine(at: Date): string {
  return `Board session: active until ${formatClock(sessionExpiry(at))}.`;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(startedAt);
  fake.role = 'board';
  fake.heartbeatFails = false;
  fake.noClient = false;
  fake.seenAt = startedAt.toISOString();
  fake.calls.length = 0;
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Board signed in as a board member', () => {
  it('heartbeats on load, every 60 s while visible, and on visibilitychange', async () => {
    await renderBoard();
    expect(callsNamed('board_heartbeat')).toHaveLength(1);
    expect(screen.getByText(activeLine(startedAt))).toBeTruthy();

    await flush(HEARTBEAT_MS);
    expect(callsNamed('board_heartbeat')).toHaveLength(2);

    await act(async () => setVisibility('hidden'));
    await flush(HEARTBEAT_MS);
    expect(callsNamed('board_heartbeat')).toHaveLength(2);

    await act(async () => setVisibility('visible'));
    await flush();
    expect(callsNamed('board_heartbeat')).toHaveLength(3);
  });

  it('derives the expiry from the server timestamp, not the client clock', async () => {
    const serverSeen = new Date('2026-09-14T11:59:00Z');
    fake.seenAt = serverSeen.toISOString();
    await renderBoard();
    expect(screen.getByText(activeLine(serverSeen))).toBeTruthy();
    expect(screen.queryByText(activeLine(startedAt))).toBeNull();
  });

  it('reports the session as not active once the TTL passes without a heartbeat', async () => {
    await renderBoard();
    await act(async () => setVisibility('hidden'));
    await flush(BOARD_SESSION_TTL_MIN * 60_000 - 1_000);
    expect(screen.getByText(activeLine(startedAt))).toBeTruthy();
    await flush(2_000);
    expect(screen.getByText(notActive)).toBeTruthy();
  });

  it('reports the session as not active and shows the error when the heartbeat fails', async () => {
    fake.heartbeatFails = true;
    await renderBoard();
    expect(screen.getByText(notActive)).toBeTruthy();
    expect(screen.getByText('heartbeat refused')).toBeTruthy();
  });

  it('sends the pause and resume RPC with the contract argument', async () => {
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Pause agents' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Resume agents' }));
    await flush();
    expect(callsNamed('set_paused').map((call) => call.args)).toEqual([
      { p_paused: true },
      { p_paused: false },
    ]);
    expect(screen.getByText('Agents resumed.')).toBeTruthy();
  });

  it('files a directive with the contract argument names and only write roles as executors', async () => {
    await renderBoard();
    const executor = screen.getByLabelText('Executor') as HTMLSelectElement;
    expect([...executor.options].map((option) => option.textContent)).toEqual(['Builder A']);

    fireEvent.change(screen.getByLabelText('Bucket'), { target: { value: 'qa' } });
    fireEvent.change(screen.getByLabelText('Lane'), { target: { value: 'code' } });
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'platform' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: ' Fix the meter ' } });
    fireEvent.change(screen.getByLabelText('Intent'), { target: { value: 'The meter shows the pool.' } });
    fireEvent.change(screen.getByLabelText('Acceptance test'), {
      target: { value: 'The meter renders the pool balance.' },
    });
    fireEvent.change(screen.getByLabelText('Estimate (USD)'), { target: { value: '2.50' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Live problem.' } });
    fireEvent.submit(screen.getByRole('form', { name: 'File a directive' }));
    await flush();

    expect(callsNamed('file_directive').map((call) => call.args)).toEqual([
      {
        p_bucket: 'qa',
        p_lane: 'code',
        p_folder: 'platform',
        p_title: 'Fix the meter',
        p_intent: 'The meter shows the pool.',
        p_acceptance_test: 'The meter renders the pool balance.',
        p_estimate_usd: 2.5,
        p_board_reason: 'Live problem.',
        p_executor_role_id: 'r-builder-a',
      },
    ]);
    expect(screen.getByText('Directive filed as card 4f2c9d1e.')).toBeTruthy();
  });

  it('files a note with the contract argument name', async () => {
    await renderBoard();
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: ' Consider a shorter week. ' } });
    fireEvent.submit(screen.getByRole('form', { name: 'File a note' }));
    await flush();
    expect(callsNamed('file_note').map((call) => call.args)).toEqual([
      { p_text: 'Consider a shorter week.' },
    ]);
    expect(screen.getByText('Note filed.')).toBeTruthy();
  });
});

describe('Board signed in as the moderator', () => {
  it('shows only pause and resume and never heartbeats', async () => {
    fake.role = 'moderator';
    await renderBoard();
    await flush(HEARTBEAT_MS);
    expect(screen.getByRole('button', { name: 'Pause agents' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume agents' })).toBeTruthy();
    expect(screen.queryByText(/^Board session:/)).toBeNull();
    expect(screen.queryByRole('form', { name: 'File a directive' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'File a note' })).toBeNull();
    expect(callsNamed('board_heartbeat')).toHaveLength(0);
  });
});

describe('Board without a database configuration', () => {
  it('renders the sign-in form and reports that sign-in is unavailable on submit', async () => {
    fake.noClient = true;
    await renderBoard();
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'board@peanutgallery.games' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Sign in' }));
    await flush();
    expect(screen.getByRole('status').textContent).toBe(
      'The site has no database configuration, so board sign-in is unavailable.',
    );
    expect(fake.calls).toHaveLength(0);
  });
});

describe('Board signed in without membership', () => {
  it('shows the membership line and no controls', async () => {
    fake.role = null;
    await renderBoard();
    expect(screen.getByText('This account is not on the board.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause agents' })).toBeNull();
  });
});
