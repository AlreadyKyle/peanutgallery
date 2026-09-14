import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOARD_SESSION_TTL_MIN,
  DISPATCHER_STALE_MS,
  HEARTBEAT_MS,
  sessionExpiry,
  STUDIO_STATE_POLL_MS,
} from '../lib/board';
import { formatClock, formatDateTime } from '../lib/format';
import type { Snapshot, StudioSource } from '../lib/source';
import { SourceProvider } from '../lib/studio';
import { Board, GO_LIVE_CONFIRM } from './Board';

type RpcCall = { name: string; args: Record<string, unknown> | undefined };

type FakeStudio = {
  paused: boolean;
  agent_mode: string;
  launched_at: string | null;
  dispatcher_seen_at: string | null;
  daily_cap_usd: number;
  card_max_usd: number;
};

const fake = vi.hoisted(() => ({
  role: 'board' as string | null,
  heartbeatFails: false,
  launchFails: false,
  noClient: false,
  seenAt: '2026-09-14T12:00:00Z',
  launchedAt: '2026-09-14T12:00:00Z',
  studio: {} as FakeStudio,
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
      if (name === 'set_launched' && fake.launchFails) {
        return Promise.resolve({ data: null, error: { message: 'launch refused' } });
      }
      const data: Record<string, unknown> = {
        board_role: fake.role,
        board_heartbeat: fake.seenAt,
        board_studio_state: fake.studio,
        set_launched: fake.launchedAt,
        set_agent_mode: null,
        set_paused: null,
        file_card: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
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
  cards: [],
  funding: {},
  launchedAt: null,
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
  fake.launchFails = false;
  fake.noClient = false;
  fake.seenAt = startedAt.toISOString();
  fake.launchedAt = startedAt.toISOString();
  fake.studio = {
    paused: false,
    agent_mode: 'attended',
    launched_at: null,
    dispatcher_seen_at: new Date(startedAt.getTime() - 30_000).toISOString(),
    daily_cap_usd: 100,
    card_max_usd: 25,
  };
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
  vi.restoreAllMocks();
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

  it('files a Next card with the contract argument names and only write roles as executors', async () => {
    await renderBoard();
    const form = within(screen.getByRole('form', { name: 'File a Next card' }));
    const executor = form.getByLabelText('Executor') as HTMLSelectElement;
    expect([...executor.options].map((option) => option.textContent)).toEqual(['Builder A']);

    fireEvent.change(form.getByLabelText('Bucket'), { target: { value: 'game' } });
    fireEvent.change(form.getByLabelText('Lane'), { target: { value: 'code' } });
    fireEvent.change(form.getByLabelText('Folder'), { target: { value: 'seed-1' } });
    fireEvent.change(form.getByLabelText('Title'), { target: { value: ' A second level ' } });
    fireEvent.change(form.getByLabelText('Intent'), { target: { value: 'Add a second stage.' } });
    fireEvent.change(form.getByLabelText('Acceptance test'), {
      target: { value: 'The second level loads.' },
    });
    fireEvent.change(form.getByLabelText('Funding target (USD)'), { target: { value: '10' } });
    fireEvent.change(form.getByLabelText('Reason (optional)'), { target: { value: 'Player favourite.' } });
    fireEvent.submit(screen.getByRole('form', { name: 'File a Next card' }));
    await flush();

    expect(callsNamed('file_card').map((call) => call.args)).toEqual([
      {
        p_bucket: 'game',
        p_lane: 'code',
        p_folder: 'seed-1',
        p_title: 'A second level',
        p_intent: 'Add a second stage.',
        p_acceptance_test: 'The second level loads.',
        p_funding_target_usd: 10,
        p_stage: 'proposed',
        p_executor_role_id: 'r-builder-a',
        p_board_reason: 'Player favourite.',
      },
    ]);
    expect(screen.getByText('Next card filed as card 1a2b3c4d.')).toBeTruthy();
  });

  it('files a directive with the contract argument names and only write roles as executors', async () => {
    await renderBoard();
    const form = within(screen.getByRole('form', { name: 'File a directive' }));
    const executor = form.getByLabelText('Executor') as HTMLSelectElement;
    expect([...executor.options].map((option) => option.textContent)).toEqual(['Builder A']);

    fireEvent.change(form.getByLabelText('Bucket'), { target: { value: 'qa' } });
    fireEvent.change(form.getByLabelText('Lane'), { target: { value: 'code' } });
    fireEvent.change(form.getByLabelText('Folder'), { target: { value: 'platform' } });
    fireEvent.change(form.getByLabelText('Title'), { target: { value: ' Fix the meter ' } });
    fireEvent.change(form.getByLabelText('Intent'), { target: { value: 'The meter shows the pool.' } });
    fireEvent.change(form.getByLabelText('Acceptance test'), {
      target: { value: 'The meter renders the pool balance.' },
    });
    fireEvent.change(form.getByLabelText('Estimate (USD)'), { target: { value: '2.50' } });
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'Live problem.' } });
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

  it('refuses a Next card target above the card maximum loaded from the database', async () => {
    fake.studio.card_max_usd = 10;
    await renderBoard();
    const formElement = screen.getByRole('form', { name: 'File a Next card' });
    const form = within(formElement);
    const target = form.getByLabelText('Funding target (USD)');
    expect(target.getAttribute('max')).toBe('10');

    fireEvent.change(form.getByLabelText('Title'), { target: { value: 'Too big' } });
    fireEvent.change(form.getByLabelText('Intent'), { target: { value: 'Costs too much.' } });
    fireEvent.change(form.getByLabelText('Acceptance test'), { target: { value: 'It loads.' } });
    fireEvent.change(target, { target: { value: '12' } });
    fireEvent.submit(formElement);
    await flush();

    expect(form.getByText('Funding target must be between $0.01 and $10.00.')).toBeTruthy();
    expect(screen.getByText('Daily cap $100.00. Card maximum $10.00.')).toBeTruthy();
    expect(callsNamed('file_card')).toHaveLength(0);
  });
});

describe('Board studio status', () => {
  it('loads the studio state once and refreshes it on one 15 s poll', async () => {
    await renderBoard();
    expect(callsNamed('board_studio_state')).toHaveLength(1);
    await flush(STUDIO_STATE_POLL_MS);
    expect(callsNamed('board_studio_state')).toHaveLength(2);
  });

  it('does not go live when the confirm is declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Go live' }));
    await flush();
    expect(confirm).toHaveBeenCalledWith(GO_LIVE_CONFIRM);
    expect(callsNamed('set_launched')).toHaveLength(0);
  });

  it('goes live once when the confirm is accepted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Go live' }));
    await flush();
    expect(callsNamed('set_launched')).toHaveLength(1);
    expect(
      screen.getByText(`The studio went live at ${formatDateTime(fake.launchedAt)}.`),
    ).toBeTruthy();
  });

  it('shows the error when set_launched fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fake.launchFails = true;
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Go live' }));
    await flush();
    expect(callsNamed('set_launched')).toHaveLength(1);
    expect(screen.getByText('launch refused')).toBeTruthy();
  });

  it('hides Go live once the studio has launched', async () => {
    fake.studio.launched_at = '2026-09-13T09:00:00Z';
    await renderBoard();
    expect(screen.getByText(`Live since ${formatDateTime('2026-09-13T09:00:00Z')}.`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Go live' })).toBeNull();
  });

  it('sends the agent mode RPC with the contract argument', async () => {
    await renderBoard();
    const group = within(screen.getByRole('group', { name: 'Agent mode' }));
    fireEvent.click(group.getByRole('radio', { name: 'unattended' }));
    await flush();
    expect(callsNamed('set_agent_mode').map((call) => call.args)).toEqual([
      { p_mode: 'unattended' },
    ]);
  });

  it('reports a fresh dispatcher heartbeat as seen', async () => {
    await renderBoard();
    expect(screen.getByText('Dispatcher: seen 30 s ago.')).toBeTruthy();
  });

  it('reports the dispatcher as not running with no heartbeat', async () => {
    fake.studio.dispatcher_seen_at = null;
    await renderBoard();
    expect(screen.getByText('Dispatcher: not running.')).toBeTruthy();
  });

  it('reports the dispatcher as not running once its heartbeat is stale', async () => {
    fake.studio.dispatcher_seen_at = new Date(
      startedAt.getTime() - DISPATCHER_STALE_MS - 1_000,
    ).toISOString();
    await renderBoard();
    expect(screen.getByText('Dispatcher: not running.')).toBeTruthy();
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
    expect(screen.queryByRole('form', { name: 'File a Next card' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go live' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Agent mode' })).toBeNull();
    expect(callsNamed('board_heartbeat')).toHaveLength(0);
    expect(callsNamed('board_studio_state')).toHaveLength(0);
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
