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
import type { Role, Snapshot, StudioSource } from '../lib/source';
import { SourceProvider } from '../lib/studio';
import { Board, CANCEL_CONFIRM, GO_LIVE_CONFIRM } from './Board';

type RpcCall = { name: string; args: Record<string, unknown> | undefined };

type FakeFactor = { id: string; factor_type: 'totp'; status: 'verified' | 'unverified' };

type FakeStudio = {
  paused: boolean;
  agent_mode: string;
  launched_at: string | null;
  dispatcher_seen_at: string | null;
  daily_cap_usd: number;
  card_max_usd: number;
  agent_hourly_rate_usd?: number;
  monthly_cap_usd?: number;
  credit_studio_daily_cap_usd?: number;
};

type FakeCard = {
  id: string;
  title: string;
  stage: string;
  horizon: string | null;
  rank: number | null;
  folder: string;
  lane: string;
  funding_target_usd: string;
  funded_usd: string;
  estimate_usd: string;
  created_at: string;
};

const fake = vi.hoisted(() => ({
  role: 'board' as string | null,
  heartbeatFails: false,
  launchFails: false,
  noClient: false,
  seenAt: '2026-09-14T12:00:00Z',
  launchedAt: '2026-09-14T12:00:00Z',
  studio: {} as FakeStudio,
  cards: [] as FakeCard[],
  selects: [] as { table: string; columns: string; filters: string[] }[],
  calls: [] as { name: string; args: Record<string, unknown> | undefined }[],
  // Supabase Auth MFA: the session's assurance level, the account's factors and every MFA call.
  aal: 'aal2' as 'aal1' | 'aal2',
  factors: [] as FakeFactor[],
  goodCode: '123456',
  mfaCalls: [] as { name: string; args: Record<string, unknown> | undefined }[],
}));

vi.mock('../lib/supabase', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/supabase')>();
  const session = { user: { email: 'board@peanutgallery.games' } };
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: () => Promise.resolve({ error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: () => {
          fake.mfaCalls.push({ name: 'getAuthenticatorAssuranceLevel', args: undefined });
          const verified = fake.factors.some((f) => f.status === 'verified');
          return Promise.resolve({
            data: { currentLevel: fake.aal, nextLevel: verified ? 'aal2' : 'aal1', currentAuthenticationMethods: [] },
            error: null,
          });
        },
        listFactors: () => {
          fake.mfaCalls.push({ name: 'listFactors', args: undefined });
          return Promise.resolve({
            data: { all: [...fake.factors], totp: fake.factors.filter((f) => f.status === 'verified'), phone: [], webauthn: [] },
            error: null,
          });
        },
        unenroll: (args: { factorId: string }) => {
          fake.mfaCalls.push({ name: 'unenroll', args });
          fake.factors = fake.factors.filter((f) => f.id !== args.factorId);
          return Promise.resolve({ data: { id: args.factorId }, error: null });
        },
        enroll: (args: Record<string, unknown>) => {
          fake.mfaCalls.push({ name: 'enroll', args });
          fake.factors.push({ id: 'f-new', factor_type: 'totp', status: 'unverified' });
          return Promise.resolve({
            data: {
              id: 'f-new',
              type: 'totp',
              totp: { qr_code: 'data:image/svg+xml;utf-8,<svg></svg>', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' },
            },
            error: null,
          });
        },
        challenge: (args: { factorId: string }) => {
          fake.mfaCalls.push({ name: 'challenge', args });
          return Promise.resolve({ data: { id: 'challenge-' + args.factorId, type: 'totp', expires_at: 0 }, error: null });
        },
        verify: (args: { factorId: string; challengeId: string; code: string }) => {
          fake.mfaCalls.push({ name: 'verify', args });
          if (args.code !== fake.goodCode) {
            return Promise.resolve({ data: null, error: { message: 'Invalid TOTP code entered' } });
          }
          fake.aal = 'aal2';
          fake.factors = fake.factors.map((f) => (f.id === args.factorId ? { ...f, status: 'verified' } : f));
          return Promise.resolve({ data: { access_token: 'aal2-token' }, error: null });
        },
      },
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
    from: (table: string) => {
      const record = { table, columns: '', filters: [] as string[] };
      fake.selects.push(record);
      const builder = {
        select(columns: string) {
          record.columns = columns;
          return builder;
        },
        in(column: string, values: string[]) {
          record.filters.push(`in ${column} ${values.join(',')}`);
          return builder;
        },
        order(column: string) {
          record.filters.push(`order ${column}`);
          return builder;
        },
        returns() {
          return Promise.resolve({ data: table === 'cards' ? [...fake.cards] : [], error: null });
        },
      };
      return builder;
    },
  };
  return { ...original, getClient: () => (fake.noClient ? null : client) };
});

function role(id: string, title: string, write_access: boolean): Role {
  return {
    id,
    name: title,
    title,
    description: null,
    species_note: 'A small blue creature with two round antennae and stubby legs.',
    model: 'claude-sonnet-5',
    write_access,
    state: 'active',
    hired_at: '2026-09-14T00:00:00Z',
  };
}

const snapshot: Snapshot = {
  pool: null,
  cards: [],
  funding: {},
  launchedAt: null,
  paused: false,
  totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
  events: [],
  deploys: [],
  roles: [
    role('r-builder-a', 'Builder A', true),
    role('r-director', 'Game Director', true),
    role('r-platform', 'Platform Builder', true),
    role('r-host', 'Host', false),
  ],
  cardTitles: {},
  missing: [],
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
  // The session, the role and the two-factor state resolve in turn.
  await flush();
  await flush();
}

function callsNamed(name: string): RpcCall[] {
  return fake.calls.filter((call) => call.name === name);
}

function mfaCallsNamed(name: string): RpcCall[] {
  return fake.mfaCalls.filter((call) => call.name === name);
}

const STATE_CHANGING_RPCS = [
  'set_paused',
  'set_launched',
  'set_agent_mode',
  'file_card',
  'file_directive',
  'file_note',
  'set_caps',
  'record_credit_purchase',
  'set_card_horizon',
  'cancel_card',
  'resume_card',
];

/** Every control that needs aal2 is absent. */
function expectNoSecondFactorControls() {
  expect(screen.queryByRole('button', { name: 'Pause agents' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Resume agents' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Go live' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Agent mode' })).toBeNull();
  expect(screen.queryByRole('form', { name: 'File a card' })).toBeNull();
  expect(screen.queryByRole('form', { name: 'File a directive' })).toBeNull();
  expect(screen.queryByRole('form', { name: 'File a note' })).toBeNull();
  expect(screen.queryByRole('form', { name: 'Set the caps' })).toBeNull();
  expect(screen.queryByRole('form', { name: 'Record a credit purchase' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Cards' })).toBeNull();
}

function expectSecondFactorControls() {
  expect(screen.getByRole('button', { name: 'Pause agents' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Go live' })).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Agent mode' })).toBeTruthy();
  expect(screen.getByRole('form', { name: 'File a card' })).toBeTruthy();
  expect(screen.getByRole('form', { name: 'File a directive' })).toBeTruthy();
  expect(screen.getByRole('form', { name: 'File a note' })).toBeTruthy();
  expect(screen.getByRole('form', { name: 'Set the caps' })).toBeTruthy();
  expect(screen.getByRole('form', { name: 'Record a credit purchase' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Cards' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Two-factor sign-in' })).toBeNull();
}

async function enterCode(code: string) {
  fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: code } });
  fireEvent.submit(screen.getByRole('form', { name: 'Verify a code' }));
  await flush();
  await flush();
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
  fake.cards = [];
  fake.selects.length = 0;
  fake.calls.length = 0;
  fake.aal = 'aal2';
  fake.factors = [{ id: 'f-1', factor_type: 'totp', status: 'verified' }];
  fake.mfaCalls.length = 0;
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

  it('files a card with the contract argument names and only the card roles as executors', async () => {
    await renderBoard();
    const form = within(screen.getByRole('form', { name: 'File a card' }));
    const executor = form.getByLabelText('Executor') as HTMLSelectElement;
    // The directors and the Host build no cards, so they are never offered.
    expect([...executor.options].map((option) => option.textContent)).toEqual(['Builder A', 'Platform Builder']);
    expect((form.getByLabelText('Horizon') as HTMLSelectElement).value).toBe('now');

    fireEvent.change(form.getByLabelText('Bucket'), { target: { value: 'game' } });
    fireEvent.change(form.getByLabelText('Lane'), { target: { value: 'code' } });
    fireEvent.change(form.getByLabelText('Folder'), { target: { value: 'seed-1' } });
    fireEvent.change(form.getByLabelText('Title'), { target: { value: ' A second level ' } });
    fireEvent.change(form.getByLabelText('Public summary'), {
      target: { value: ' A second level to play once the first is done. ' },
    });
    fireEvent.change(form.getByLabelText('Intent (for the agents)'), { target: { value: 'Add a second stage.' } });
    fireEvent.change(form.getByLabelText('Acceptance test'), {
      target: { value: 'The second level loads.' },
    });
    fireEvent.change(form.getByLabelText('Funding target (USD)'), { target: { value: '10' } });
    fireEvent.change(form.getByLabelText('Reason (optional)'), { target: { value: 'Player favourite.' } });
    fireEvent.submit(screen.getByRole('form', { name: 'File a card' }));
    await flush();

    expect(callsNamed('file_card').map((call) => call.args)).toEqual([
      {
        p_bucket: 'game',
        p_lane: 'code',
        p_folder: 'seed-1',
        p_title: 'A second level',
        p_summary: 'A second level to play once the first is done.',
        p_intent: 'Add a second stage.',
        p_acceptance_test: 'The second level loads.',
        p_funding_target_usd: 10,
        p_stage: 'proposed',
        p_executor_role_id: 'r-builder-a',
        p_board_reason: 'Player favourite.',
        p_horizon: 'now',
      },
    ]);
    expect(screen.getByText('Card filed as card 1a2b3c4d.')).toBeTruthy();
  });

  it('files a roadmap card on horizon later with no target', async () => {
    await renderBoard();
    const formElement = screen.getByRole('form', { name: 'File a card' });
    const form = within(formElement);
    fireEvent.change(form.getByLabelText('Horizon'), { target: { value: 'later' } });
    fireEvent.change(form.getByLabelText('Title'), { target: { value: 'Free picks' } });
    fireEvent.change(form.getByLabelText('Public summary'), { target: { value: 'Choose the next card without paying.' } });
    fireEvent.change(form.getByLabelText('Intent (for the agents)'), { target: { value: 'Not built yet.' } });
    fireEvent.change(form.getByLabelText('Acceptance test'), { target: { value: 'Planned.' } });
    expect((form.getByLabelText('Funding target (USD)') as HTMLInputElement).required).toBe(false);
    fireEvent.submit(formElement);
    await flush();
    const [call] = callsNamed('file_card');
    expect(call?.args).toMatchObject({ p_title: 'Free picks', p_funding_target_usd: 0, p_horizon: 'later' });
  });

  it('files a directive with the contract argument names and only write roles as executors', async () => {
    await renderBoard();
    const form = within(screen.getByRole('form', { name: 'File a directive' }));
    const executor = form.getByLabelText('Executor') as HTMLSelectElement;
    expect([...executor.options].map((option) => option.textContent)).toEqual(['Builder A', 'Platform Builder']);

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

  it('accepts a funding target above the per-card spend ceiling, which caps spend and not the target', async () => {
    fake.studio.card_max_usd = 10;
    await renderBoard();
    const formElement = screen.getByRole('form', { name: 'File a card' });
    const form = within(formElement);
    const target = form.getByLabelText('Funding target (USD)');
    expect(target.getAttribute('max')).toBeNull();

    fireEvent.change(form.getByLabelText('Title'), { target: { value: 'Bigger' } });
    fireEvent.change(form.getByLabelText('Public summary'), { target: { value: 'A big change.' } });
    fireEvent.change(form.getByLabelText('Intent (for the agents)'), { target: { value: 'Costs more.' } });
    fireEvent.change(form.getByLabelText('Acceptance test'), { target: { value: 'check: it loads' } });
    fireEvent.change(target, { target: { value: '12' } });
    fireEvent.submit(formElement);
    await flush();

    expect(screen.getByText('Daily cap $100.00. Card maximum $10.00.')).toBeTruthy();
    expect(callsNamed('file_card').map((call) => call.args?.p_funding_target_usd)).toEqual([12]);
  });

  it('refuses a blank public summary before calling the database', async () => {
    await renderBoard();
    const formElement = screen.getByRole('form', { name: 'File a card' });
    const form = within(formElement);
    fireEvent.change(form.getByLabelText('Title'), { target: { value: 'No summary' } });
    fireEvent.change(form.getByLabelText('Public summary'), { target: { value: '   ' } });
    fireEvent.change(form.getByLabelText('Intent (for the agents)'), { target: { value: 'Do a thing.' } });
    fireEvent.change(form.getByLabelText('Acceptance test'), { target: { value: 'It loads.' } });
    fireEvent.change(form.getByLabelText('Funding target (USD)'), { target: { value: '5' } });
    fireEvent.submit(formElement);
    await flush();

    expect(form.getByText('A public summary is required.')).toBeTruthy();
    expect(callsNamed('file_card')).toHaveLength(0);
  });

  it('caps the public summary at 200 characters, explains it and counts as you type', async () => {
    await renderBoard();
    const form = within(screen.getByRole('form', { name: 'File a card' }));
    const summary = form.getByLabelText('Public summary') as HTMLInputElement;
    expect(summary.required).toBe(true);
    expect(summary.maxLength).toBe(200);
    const hint = form.getByText('One or two plain sentences for supporters. 200 characters at most.');
    const count = form.getByText('0 / 200');
    expect(summary.getAttribute('aria-describedby')).toBe(`${hint.id} ${count.id}`);

    fireEvent.change(summary, { target: { value: 'Twelve chars' } });
    expect(form.getByText('12 / 200')).toBeTruthy();
    expect(form.queryByText('0 / 200')).toBeNull();
  });
});

function card(overrides: Partial<FakeCard>): FakeCard {
  return {
    id: '5d6e7f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    title: 'Rename the Gatherer',
    stage: 'proposed',
    horizon: 'now',
    rank: null,
    folder: 'seed-1',
    lane: 'config',
    funding_target_usd: '2.0000',
    funded_usd: '0.0000',
    estimate_usd: '0.0000',
    created_at: '2026-09-15T00:00:00Z',
    ...overrides,
  };
}

function cardForm(title: string) {
  return within(screen.getByRole('form', { name: `Card ${title}` }));
}

describe('Board caps and credit', () => {
  it('shows every cap board_studio_state returns and saves them all with set_caps and a reason', async () => {
    fake.studio = { ...fake.studio, agent_hourly_rate_usd: 4, monthly_cap_usd: 500, credit_studio_daily_cap_usd: 500 };
    await renderBoard();
    expect(
      screen.getByText(
        'Daily cap $100.00. Card maximum $25.00. Hourly rate $4.00. Monthly cap $500.00. Studio daily limit on immediate credit $500.00.',
      ),
    ).toBeTruthy();
    const formElement = screen.getByRole('form', { name: 'Set the caps' });
    const form = within(formElement);
    expect((form.getByLabelText('Daily spend cap (USD)') as HTMLInputElement).value).toBe('100');
    fireEvent.change(form.getByLabelText('Monthly spend cap (USD)'), { target: { value: '400' } });
    fireEvent.submit(formElement);
    await flush();
    expect(form.getByText('A reason is required.')).toBeTruthy();
    expect(callsNamed('set_caps')).toHaveLength(0);

    fireEvent.change(form.getByLabelText('Reason'), { target: { value: ' Match the Console limit. ' } });
    fireEvent.submit(formElement);
    await flush();
    expect(callsNamed('set_caps').map((call) => call.args)).toEqual([
      {
        p_daily_cap_usd: 100,
        p_card_max_usd: 25,
        p_agent_hourly_rate_usd: 4,
        p_monthly_cap_usd: 400,
        p_credit_studio_daily_cap_usd: 500,
        p_reason: 'Match the Console limit.',
      },
    ]);
    expect(form.getByText('Caps saved.')).toBeTruthy();
  });

  it('asks for a cap board_studio_state does not return instead of sending a blank', async () => {
    await renderBoard();
    const formElement = screen.getByRole('form', { name: 'Set the caps' });
    const form = within(formElement);
    expect((form.getByLabelText('Agent hourly rate (USD)') as HTMLInputElement).value).toBe('');
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'Tighten.' } });
    fireEvent.submit(formElement);
    await flush();
    expect(form.getByText('Agent hourly rate (USD) must be a dollar amount of zero or more.')).toBeTruthy();
    expect(callsNamed('set_caps')).toHaveLength(0);
  });

  it('records a credit purchase with the contract argument names', async () => {
    await renderBoard();
    const formElement = screen.getByRole('form', { name: 'Record a credit purchase' });
    const form = within(formElement);
    fireEvent.change(form.getByLabelText('Amount (USD)'), { target: { value: '42.5' } });
    fireEvent.change(form.getByLabelText('Stripe payout id'), { target: { value: ' po_123 ' } });
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'First payout.' } });
    fireEvent.submit(formElement);
    await flush();
    expect(callsNamed('record_credit_purchase').map((call) => call.args)).toEqual([
      { p_amount_usd: 42.5, p_stripe_payout_id: 'po_123', p_reason: 'First payout.' },
    ]);
    expect(form.getByText('Credit purchase of $42.50 recorded.')).toBeTruthy();
  });
});

describe('Board card controls', () => {
  it('lists every card the board can still move, now first, then by rank', async () => {
    fake.cards = [
      card({ id: 'a', title: 'Later card', horizon: 'later', stage: 'proposed', created_at: '2026-09-15T00:00:00Z' }),
      card({ id: 'b', title: 'Next ranked two', horizon: 'next', rank: 2 }),
      card({ id: 'c', title: 'Next ranked one', horizon: 'next', rank: 1 }),
      card({ id: 'd', title: 'Open now', horizon: 'now', stage: 'voted' }),
      card({ id: 'e', title: 'Old row', horizon: null, stage: 'paused' }),
    ];
    await renderBoard();
    await flush();
    const cards = screen.getByRole('region', { name: 'Cards' });
    expect(within(cards).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Open now',
      'Old row',
      'Next ranked one',
      'Next ranked two',
      'Later card',
    ]);
    expect(fake.selects).toEqual([
      {
        table: 'cards',
        columns: 'id,title,stage,horizon,rank,folder,lane,funding_target_usd,funded_usd,estimate_usd,created_at',
        filters: ['in stage proposed,designing,voted,funded,paused', 'order created_at'],
      },
    ]);
    expect(cardForm('Next ranked one').getByText('open for funding · horizon next · rank 1 · seed-1 config · $0.00 of $2.00')).toBeTruthy();
  });

  it('moves a card to now with its rank and target, and to later without a target', async () => {
    fake.cards = [card({ id: 'n1', title: 'Planned', horizon: 'next', funding_target_usd: '0' })];
    await renderBoard();
    await flush();
    const form = cardForm('Planned');
    fireEvent.change(form.getByLabelText('Horizon'), { target: { value: 'now' } });
    fireEvent.change(form.getByLabelText('Rank'), { target: { value: '3' } });
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'Ready.' } });
    fireEvent.click(form.getByRole('button', { name: 'Save horizon and rank' }));
    await flush();
    expect(form.getByText('A card on horizon now needs a funding target of at least $0.01.')).toBeTruthy();
    expect(callsNamed('set_card_horizon')).toHaveLength(0);

    fireEvent.change(form.getByLabelText('Funding target (USD)'), { target: { value: '3' } });
    fireEvent.click(form.getByRole('button', { name: 'Save horizon and rank' }));
    await flush();
    await flush();
    const after = cardForm('Planned');
    fireEvent.change(after.getByLabelText('Horizon'), { target: { value: 'later' } });
    fireEvent.change(after.getByLabelText('Rank'), { target: { value: '' } });
    fireEvent.change(after.getByLabelText('Reason'), { target: { value: 'Not yet.' } });
    fireEvent.click(after.getByRole('button', { name: 'Save horizon and rank' }));
    await flush();
    expect(callsNamed('set_card_horizon').map((call) => call.args)).toEqual([
      { p_card: 'n1', p_horizon: 'now', p_rank: 3, p_reason: 'Ready.', p_target_usd: 3 },
      { p_card: 'n1', p_horizon: 'later', p_rank: null, p_reason: 'Not yet.' },
    ]);
  });

  it('re-ranks a card already on now without sending a target, which set_card_horizon refuses there', async () => {
    fake.cards = [card({ id: 'k1', title: 'Open now', horizon: 'now', funding_target_usd: '3.0000' })];
    await renderBoard();
    await flush();
    const form = cardForm('Open now');
    expect(form.queryByLabelText('Funding target (USD)')).toBeNull();
    expect(form.getByText('A card with money on its bar stays on now; cancel it instead.')).toBeTruthy();
    fireEvent.change(form.getByLabelText('Rank'), { target: { value: '1' } });
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'First in line.' } });
    fireEvent.click(form.getByRole('button', { name: 'Save horizon and rank' }));
    await flush();
    expect(callsNamed('set_card_horizon').map((call) => call.args)).toEqual([
      { p_card: 'k1', p_horizon: 'now', p_rank: 1, p_reason: 'First in line.' },
    ]);
  });

  it('offers horizon and rank only on cards still open for funding', async () => {
    fake.cards = [
      card({ id: 'f1', title: 'Funded one', stage: 'funded', funded_usd: '2.0000' }),
      card({ id: 'p2', title: 'Paused two', stage: 'paused' }),
    ];
    await renderBoard();
    await flush();
    for (const [title, line] of [
      ['Funded one', 'A funded card can only be cancelled.'],
      ['Paused two', 'A paused card can only be cancelled or resumed.'],
    ] as const) {
      const form = cardForm(title);
      expect(form.queryByLabelText('Horizon')).toBeNull();
      expect(form.queryByLabelText('Rank')).toBeNull();
      expect(form.queryByRole('button', { name: 'Save horizon and rank' })).toBeNull();
      expect(form.getByRole('button', { name: 'Cancel card' })).toBeTruthy();
      expect(form.getByText(line)).toBeTruthy();
    }
    fireEvent.submit(screen.getByRole('form', { name: 'Card Funded one' }));
    await flush();
    expect(callsNamed('set_card_horizon')).toHaveLength(0);
  });

  it('cancels a card only after the confirm, with the reason', async () => {
    fake.cards = [card({ id: 'x1', title: 'Retire me' })];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderBoard();
    await flush();
    const form = cardForm('Retire me');
    fireEvent.click(form.getByRole('button', { name: 'Cancel card' }));
    await flush();
    expect(form.getByText('A reason is required.')).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'No longer makes sense.' } });
    fireEvent.click(form.getByRole('button', { name: 'Cancel card' }));
    await flush();
    expect(confirm).toHaveBeenCalledWith(CANCEL_CONFIRM);
    expect(callsNamed('cancel_card')).toHaveLength(0);

    confirm.mockReturnValue(true);
    fireEvent.click(form.getByRole('button', { name: 'Cancel card' }));
    await flush();
    expect(callsNamed('cancel_card').map((call) => call.args)).toEqual([{ p_card: 'x1', p_reason: 'No longer makes sense.' }]);
  });

  it('resumes a paused card with a new estimate, and offers resume on paused cards only', async () => {
    fake.cards = [
      card({ id: 'p1', title: 'Paused one', stage: 'paused', estimate_usd: '0.5000', funded_usd: '2.0000' }),
      card({ id: 'o1', title: 'Open one' }),
    ];
    await renderBoard();
    await flush();
    expect(cardForm('Open one').queryByRole('button', { name: 'Resume card' })).toBeNull();
    const form = cardForm('Paused one');
    expect((form.getByLabelText('New estimate (USD)') as HTMLInputElement).value).toBe('0.5');
    fireEvent.change(form.getByLabelText('New estimate (USD)'), { target: { value: '0.8' } });
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'Credit topped up.' } });
    fireEvent.click(form.getByRole('button', { name: 'Resume card' }));
    await flush();
    expect(callsNamed('resume_card').map((call) => call.args)).toEqual([
      { p_card: 'p1', p_estimate_usd: 0.8, p_reason: 'Credit topped up.' },
    ]);
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

describe('Board two-factor sign-in', () => {
  it('enrols an authenticator app on an account without one, then shows the board controls', async () => {
    fake.aal = 'aal1';
    fake.factors = [{ id: 'f-abandoned', factor_type: 'totp', status: 'unverified' }];
    await renderBoard();
    const step = screen.getByRole('region', { name: 'Two-factor sign-in' });
    expect(
      within(step).getByText(
        'A second factor is needed before you can pause agents, go live, change the agent mode or the caps, record credit, move, cancel or resume cards, or file cards, directives and notes.',
      ),
    ).toBeTruthy();
    expectNoSecondFactorControls();
    expect(within(step).queryByRole('form', { name: 'Verify a code' })).toBeNull();

    fireEvent.click(within(step).getByRole('button', { name: 'Set up an authenticator app' }));
    await flush();
    await flush();
    // The abandoned unverified factor is removed before a new one is enrolled.
    expect(mfaCallsNamed('unenroll').map((call) => call.args)).toEqual([{ factorId: 'f-abandoned' }]);
    expect(mfaCallsNamed('enroll').map((call) => call.args)).toEqual([{ factorType: 'totp' }]);
    const qr = within(step).getByRole('img', { name: 'QR code for your authenticator app' });
    expect(qr.getAttribute('src')).toBe('data:image/svg+xml;utf-8,<svg></svg>');
    expect(within(step).getByText('JBSWY3DPEHPK3PXP').tagName).toBe('CODE');
    expectNoSecondFactorControls();

    await enterCode('000000');
    expect(screen.getByText('Invalid TOTP code entered')).toBeTruthy();
    expectNoSecondFactorControls();

    await enterCode('123456');
    expect(mfaCallsNamed('challenge').map((call) => call.args)).toEqual([{ factorId: 'f-new' }, { factorId: 'f-new' }]);
    expect(mfaCallsNamed('verify').at(-1)?.args).toEqual({ factorId: 'f-new', challengeId: 'challenge-f-new', code: '123456' });
    expectSecondFactorControls();
  });

  it('challenges a verified factor on a new aal1 session and never enrols', async () => {
    fake.aal = 'aal1';
    await renderBoard();
    const step = screen.getByRole('region', { name: 'Two-factor sign-in' });
    expect(within(step).queryByRole('button', { name: 'Set up an authenticator app' })).toBeNull();
    expect(within(step).queryByRole('img')).toBeNull();
    expectNoSecondFactorControls();

    await enterCode('12 34');
    expect(screen.getByText('Enter the 6-digit code from your authenticator app.')).toBeTruthy();
    expect(mfaCallsNamed('verify')).toHaveLength(0);

    await enterCode('123456');
    expect(mfaCallsNamed('verify').map((call) => call.args)).toEqual([
      { factorId: 'f-1', challengeId: 'challenge-f-1', code: '123456' },
    ]);
    expect(mfaCallsNamed('enroll')).toHaveLength(0);
    expectSecondFactorControls();
  });

  it('skips the step when the session is already aal2', async () => {
    await renderBoard();
    expectSecondFactorControls();
    expect(mfaCallsNamed('challenge')).toHaveLength(0);
  });

  it('keeps the studio status and the heartbeat running at aal1 while every state-changing control stays hidden', async () => {
    fake.aal = 'aal1';
    await renderBoard();
    expectNoSecondFactorControls();
    expect(screen.getByText('Agents: running.')).toBeTruthy();
    expect(screen.getByText('Agent mode: attended.')).toBeTruthy();
    expect(screen.getByText(activeLine(startedAt))).toBeTruthy();
    expect(callsNamed('board_heartbeat')).toHaveLength(1);
    expect(callsNamed('board_studio_state')).toHaveLength(1);

    await flush(HEARTBEAT_MS);
    expect(callsNamed('board_heartbeat')).toHaveLength(2);
    expect(callsNamed('board_studio_state').length).toBeGreaterThanOrEqual(2);
    expect(fake.calls.filter((call) => STATE_CHANGING_RPCS.includes(call.name))).toEqual([]);
  });
});

describe('Board signed in as the moderator', () => {
  it('pauses and resumes at aal1 with no two-factor step', async () => {
    fake.role = 'moderator';
    fake.aal = 'aal1';
    fake.factors = [];
    await renderBoard();
    expect(screen.queryByRole('region', { name: 'Two-factor sign-in' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pause agents' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Resume agents' }));
    await flush();
    expect(callsNamed('set_paused').map((call) => call.args)).toEqual([{ p_paused: true }, { p_paused: false }]);
    expect(screen.getByText('Agents resumed.')).toBeTruthy();
    expect(fake.mfaCalls).toEqual([]);
  });

  it('shows only pause and resume and never heartbeats', async () => {
    fake.role = 'moderator';
    await renderBoard();
    await flush(HEARTBEAT_MS);
    expect(screen.getByRole('button', { name: 'Pause agents' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume agents' })).toBeTruthy();
    expect(screen.queryByText(/^Board session:/)).toBeNull();
    expect(screen.queryByRole('form', { name: 'File a directive' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'File a note' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'File a card' })).toBeNull();
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
