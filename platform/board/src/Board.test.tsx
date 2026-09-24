import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board, CANCEL_CONFIRM, FILLED_FROM_CONTROLLER, GO_LIVE_CONFIRM, TIER_CAP_LABEL } from './Board';
import {
  BOARD_CARD_COLUMNS,
  BOARD_SESSION_TTL_MIN,
  DISPATCHER_STALE_MS,
  HEARTBEAT_MS,
  ROLE_COLUMNS,
  sessionExpiry,
  STUDIO_STATE_POLL_MS,
} from './lib/board';
import { formatClock, formatDateTime } from './lib/format';
import { BOARD_PULLS_URL } from './lib/needs';
import { NOTHING_NEEDS_YOU } from './NeedsYou';

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
  anthropic_tier_cap_usd?: number | null;
  platform_lane_open?: boolean;
  cooling_window_minutes?: number;
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
  source?: string;
  drafter_role_id?: string | null;
  opens_at?: string | null;
  board_vetoed?: boolean;
  board_veto_reason?: string | null;
};

const fake = vi.hoisted(() => ({
  role: 'board' as string | null,
  heartbeatFails: false,
  launchFails: false,
  noClient: false,
  signedOut: false,
  otpCalls: [] as Record<string, unknown>[],
  needs: {} as Record<string, unknown>,
  roleRows: [] as Record<string, unknown>[],
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
  // What cancel_card returns (docs/specs/money-logic.md): the amount it moved on.
  cancelResult: null as Record<string, unknown> | null,
  // docs/specs/agent-system-core.md: board_jobs, board_roles and which agent cards card_is_public passes.
  jobs: [] as Record<string, unknown>[],
  boardRoles: [] as Record<string, unknown>[],
  publicCards: [] as string[],
  // An RPC named here is left pending until release() is called, so a test sees a control mid-action.
  held: null as string | null,
  release: () => {},
}));

vi.mock('./lib/supabase', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/supabase')>();
  const session = { user: { email: 'board@peanutgallery.games' } };
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: fake.signedOut ? null : session } }),
      signInWithOtp: (args: Record<string, unknown>) => {
        fake.otpCalls.push(args);
        return Promise.resolve({ data: {}, error: null });
      },
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
    rpc: async (name: string, args?: Record<string, unknown>) => {
      fake.calls.push({ name, args });
      if (name === fake.held) {
        await new Promise<void>((resolve) => {
          fake.release = resolve;
        });
      }
      if (name === 'board_heartbeat' && fake.heartbeatFails) {
        return Promise.resolve({ data: null, error: { message: 'heartbeat refused' } });
      }
      if (name === 'set_launched' && fake.launchFails) {
        return Promise.resolve({ data: null, error: { message: 'launch refused' } });
      }
      if (name === 'card_is_public') return Promise.resolve({ data: fake.publicCards.includes(String(args?.p_card)), error: null });
      // The card RPCs change the card as the database does, so the cards read gives it back changed: a
      // veto moves a card on now with no money to next, a cancelled card is rejected and leaves the list.
      if (name === 'set_card_veto' || name === 'cancel_card' || name === 'set_card_horizon') {
        const id = args?.p_card;
        fake.cards = fake.cards.map((c) => {
          if (c.id !== id) return c;
          if (name === 'cancel_card') return { ...c, stage: 'rejected' };
          if (name === 'set_card_horizon') return { ...c, horizon: String(args?.p_horizon), rank: (args?.p_rank as number | null) ?? null };
          const vetoed = args?.p_vetoed === true;
          return { ...c, board_vetoed: vetoed, board_veto_reason: vetoed ? String(args?.p_reason) : null, horizon: vetoed && c.horizon === 'now' ? 'next' : c.horizon };
        });
      }
      // set_role_pause changes the role, as the database does, so board_roles reads it back changed.
      if (name === 'set_role_pause') {
        fake.boardRoles = fake.boardRoles.map((r) =>
          r.id === args?.p_role ? { ...r, paused: args?.p_paused, paused_reason: args?.p_paused ? args?.p_reason : null } : r,
        );
        return Promise.resolve({ data: null, error: null });
      }
      const data: Record<string, unknown> = {
        board_jobs: fake.jobs,
        board_roles: fake.boardRoles,
        enqueue_manual_job: '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
        board_role: fake.role,
        board_heartbeat: fake.seenAt,
        board_studio_state: fake.studio,
        board_needs_you: fake.needs,
        set_launched: fake.launchedAt,
        set_agent_mode: null,
        set_paused: null,
        cancel_card: fake.cancelResult,
        file_card: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        file_directive: '4f2c9d1e-7b3a-4e6f-8a90-1c2d3e4f5a6b',
        file_note: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      };
      return Promise.resolve({ data: data[name] ?? null, error: null });
    },
    from: (table: string) => {
      const record = { table, columns: '', filters: [] as string[] };
      let only: { column: string; values: string[] } | null = null;
      fake.selects.push(record);
      const builder = {
        select(columns: string) {
          record.columns = columns;
          return builder;
        },
        in(column: string, values: string[]) {
          record.filters.push(`in ${column} ${values.join(',')}`);
          only = { column, values };
          return builder;
        },
        order(column: string) {
          record.filters.push(`order ${column}`);
          return builder;
        },
        returns() {
          const cards = fake.cards.filter((c) => only === null || only.values.includes(String(c[only.column as keyof FakeCard])));
          const data = table === 'cards' ? cards : table === 'public_roles' ? [...fake.roleRows] : [];
          return Promise.resolve({ data, error: null });
        },
      };
      return builder;
    },
  };
  return { ...original, getClient: () => (fake.noClient ? null : client) };
});

function role(id: string, title: string, write_access: boolean): Record<string, unknown> {
  return { id, title, write_access, state: 'active' };
}

const ROLE_ROWS = [
  role('r-platform', 'Platform Builder', true),
  role('r-director', 'Game Director', true),
  role('r-builder-a', 'Builder A', true),
  role('r-host', 'Host', false),
  { ...role('r-old', 'Builder B', true), state: 'retired' },
];

const EMPTY_NEEDS = { controller: null, last_credit_purchase: null, incident_reserve_usd: 0, s1_cards: [] };

// docs/specs/agent-system-core.md: two ceiling pauses the rule will not resume and a void card with money.
const NEEDS_CARDS = {
  ...EMPTY_NEEDS,
  rule_blocked: [
    { id: 'max', title: 'At the maximum', why: 'card_max', actual_usd: 25, card_max_usd: 25 },
    { id: 'twice', title: 'Paused twice', why: 'resumed_before', actual_usd: 6.75, card_max_usd: 25 },
  ],
  approval_void: [{ id: 'void', title: 'Rewritten', stage: 'proposed', money_usd: 2 }],
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
  render(<Board />);
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
  fake.signedOut = false;
  fake.otpCalls.length = 0;
  fake.needs = { ...EMPTY_NEEDS };
  fake.roleRows = [...ROLE_ROWS];
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
  fake.cancelResult = null;
  fake.jobs = [];
  fake.boardRoles = [];
  fake.publicCards = [];
  fake.held = null;
  fake.release = () => {};
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

  it('offers the four pause reasons, sends p_reason only for one that is not the default, and never on resume', async () => {
    await renderBoard();
    const select = screen.getByLabelText('Pause reason') as HTMLSelectElement;
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ['board', 'Paused by the board'],
      ['incident', 'A problem we are checking'],
      ['awaiting_credit', "Waiting for a payout to buy the agents' credit"],
      ['spend_limit', 'The monthly spend limit'],
    ]);
    expect(select.value).toBe('board');
    fireEvent.change(select, { target: { value: 'incident' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pause agents' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Resume agents' }));
    await flush();
    fireEvent.change(select, { target: { value: 'board' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pause agents' }));
    await flush();
    expect(callsNamed('set_paused').map((call) => call.args)).toEqual([
      { p_paused: true, p_reason: 'incident' },
      { p_paused: false },
      { p_paused: true },
    ]);
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

    expect(screen.getByText('Daily cap $100.00. Card maximum $10.00. No usage tier cap.')).toBeTruthy();
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
        'Daily cap $100.00. Card maximum $25.00. Hourly rate $4.00. Monthly cap $500.00. Studio daily limit on immediate credit $500.00. No usage tier cap.',
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
        p_anthropic_tier_cap_usd: null,
        p_set_anthropic_tier_cap: true,
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
    expect(fake.selects.filter((select) => select.table === 'cards')).toEqual([
      {
        table: 'cards',
        columns: BOARD_CARD_COLUMNS,
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
    // The confirmation says where the card's money goes (docs/specs/money-logic.md).
    expect(CANCEL_CONFIRM).toBe(
      'Cancel this card? It is rejected with your reason, its unspent money goes to the next cards in line, and this cannot be undone.',
    );
  });

  it('says above the list how much unspent money a cancellation moved on, since the cancelled card leaves the list, and focuses it', async () => {
    fake.cards = [card({ id: 'x2', title: 'Holds money' }), card({ id: 'x3', title: 'Stays' })];
    fake.cancelResult = { card_id: 'x2', stage: 'rejected', from_stage: 'voted', moved_usd: 1.8, moved_to: [] };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderBoard();
    await flush();
    const form = cardForm('Holds money');
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'Out of scope.' } });
    const button = form.getByRole('button', { name: 'Cancel card' });
    button.focus();
    fireEvent.click(button);
    await flush();
    expect(screen.queryByRole('form', { name: 'Card Holds money' })).toBeNull();
    const cards = within(screen.getByRole('region', { name: 'Cards' }));
    const notice = cards.getByText('Card Holds money cancelled. $1.80 of unspent money moved to the next cards in line.');
    expect(notice.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(notice);
    expect(cardForm('Stays').queryByRole('status')).toBeNull();
  });

  it('keeps the row, its confirmation and focus when a save moves the card', async () => {
    fake.cards = [card({ id: 'm1', title: 'Moves', horizon: 'now' }), card({ id: 'm2', title: 'Another', horizon: 'next', rank: 1 })];
    await renderBoard();
    await flush();
    const form = cardForm('Moves');
    fireEvent.change(form.getByLabelText('Horizon'), { target: { value: 'later' } });
    fireEvent.change(form.getByLabelText('Rank'), { target: { value: '4' } });
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'Not yet.' } });
    const save = form.getByRole('button', { name: 'Save horizon and rank' });
    save.focus();
    fireEvent.submit(screen.getByRole('form', { name: 'Card Moves' }));
    await flush();
    const after = cardForm('Moves');
    expect(after.getByRole('status').textContent).toBe('Card saved.');
    expect(after.getByText(/horizon later · rank 4/)).toBeTruthy();
    expect((after.getByLabelText('Horizon') as HTMLSelectElement).value).toBe('later');
    expect(after.getByRole('button', { name: 'Save horizon and rank' })).toBe(save);
    expect(document.activeElement).toBe(save);
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

describe('Board usage tier cap', () => {
  it('shows the tier cap, saves a new one with set_caps, and removes it when left blank', async () => {
    fake.studio = { ...fake.studio, agent_hourly_rate_usd: 4, monthly_cap_usd: 500, credit_studio_daily_cap_usd: 500, anthropic_tier_cap_usd: 100 };
    await renderBoard();
    expect(screen.getByText(/Usage tier cap \$100\.00\./)).toBeTruthy();
    const formElement = screen.getByRole('form', { name: 'Set the caps' });
    const form = within(formElement);
    const tier = form.getByLabelText(TIER_CAP_LABEL) as HTMLInputElement;
    expect(tier.value).toBe('100');
    expect(tier.required).toBe(false);
    fireEvent.change(tier, { target: { value: '500' } });
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'Tier 2 on the Console.' } });
    fireEvent.submit(formElement);
    await flush();
    fireEvent.change(form.getByLabelText(TIER_CAP_LABEL), { target: { value: '' } });
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'No tier limit.' } });
    fireEvent.submit(formElement);
    await flush();
    expect(callsNamed('set_caps').map((call) => [call.args?.p_anthropic_tier_cap_usd, call.args?.p_set_anthropic_tier_cap])).toEqual([
      [500, true],
      [null, true],
    ]);
  });

  it('refuses a tier cap of zero before calling the database', async () => {
    fake.studio = { ...fake.studio, agent_hourly_rate_usd: 4, monthly_cap_usd: 500, credit_studio_daily_cap_usd: 500 };
    await renderBoard();
    const formElement = screen.getByRole('form', { name: 'Set the caps' });
    const form = within(formElement);
    fireEvent.change(form.getByLabelText(TIER_CAP_LABEL), { target: { value: '0' } });
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'x' } });
    fireEvent.submit(formElement);
    await flush();
    expect(form.getByText(`${TIER_CAP_LABEL} must be above zero, or blank for none.`)).toBeTruthy();
    expect(callsNamed('set_caps')).toHaveLength(0);
  });

  it('says whether the studio code lane is open', async () => {
    await renderBoard();
    expect(screen.getByText('Studio code lane: closed.')).toBeTruthy();
    cleanup();
    fake.studio = { ...fake.studio, platform_lane_open: true };
    await renderBoard();
    expect(screen.getByText('Studio code lane: open.')).toBeTruthy();
  });
});

const RUN = {
  finished_at: '2026-09-24T07:07:00Z',
  ok: true,
  mismatches: 0,
  credit_purchase_usd: '12.5',
  minimum_balance_usd: 3.25,
  settlement_amount: 4.5,
  settlement_currency: 'cad',
  disputes_to_answer: [
    { dispute: 'du_late', status: 'needs_response', due_by: '2026-10-09', amount_usd: 7 },
    { dispute: 'du_soon', status: 'warning_needs_response', due_by: '2026-10-01', amount_usd: 5 },
  ],
  latest_payout: { id: 'po_123', arrival_date: '2026-09-23' },
};

describe('Board Needs you inbox', () => {
  it('is the first section, says nothing needs you, and keeps the standing duties when nothing is due', async () => {
    await renderBoard();
    const inbox = screen.getByRole('region', { name: 'Needs you' });
    expect(document.querySelector('main section')?.getAttribute('aria-label')).toBe('Needs you');
    expect(within(inbox).getByText(NOTHING_NEEDS_YOU)).toBeTruthy();
    expect(within(inbox).getByText(/No Controller run yet, so there is no credit or Minimum balance figure\./)).toBeTruthy();
    expect(within(inbox).getByRole('link', { name: "Stripe's disputes" }).getAttribute('href')).toBe('https://dashboard.stripe.com/disputes');
    expect(within(inbox).getByRole('link', { name: 'hello@clayhouse.studio' }).getAttribute('href')).toBe('mailto:hello@clayhouse.studio');
    expect(within(inbox).getByRole('link', { name: 'open pull requests not from a card branch' }).getAttribute('href')).toBe(BOARD_PULLS_URL);
    expect(BOARD_PULLS_URL).toBe('https://github.com/AlreadyKyle/peanutgallery/pulls?q=is%3Apr+is%3Aopen+-head%3Acard%2F');
    expect(decodeURIComponent(new URL(BOARD_PULLS_URL).searchParams.get('q') ?? '')).toBe('is:pr is:open -head:card/');
    expect(callsNamed('board_needs_you')).toEqual([{ name: 'board_needs_you', args: undefined }]);
  });

  it('lists disputes by due date, an S1 card, then the credit purchase with the Minimum balance', async () => {
    fake.needs = { ...EMPTY_NEEDS, controller: RUN, incident_reserve_usd: '0.4', s1_cards: [{ id: 'c-s1', title: 'Fix the save bug', stage: 'funded' }] };
    await renderBoard();
    const inbox = within(screen.getByRole('region', { name: 'Needs you' }));
    expect(inbox.queryByText(NOTHING_NEEDS_YOU)).toBeNull();
    const items = screen.getByRole('region', { name: 'Needs you' }).querySelectorAll('ul.needs > li');
    expect([...items].map((item) => item.querySelector('strong')?.textContent)).toEqual([
      'Answer dispute du_soon for $5.00 by 1 Oct 2026.',
      'Answer dispute du_late for $7.00 by 9 Oct 2026.',
      'Card Fix the save bug is S1.',
      'Buy $12.50 of Console credit.',
    ]);
    expect(inbox.getAllByRole('link', { name: 'Open the dispute in Stripe' }).map((a) => a.getAttribute('href'))).toEqual([
      'https://dashboard.stripe.com/disputes/du_soon',
      'https://dashboard.stripe.com/disputes/du_late',
    ]);
    expect(inbox.getByText(/emergency-fund credit: \$0\.40 is in the fund/)).toBeTruthy();
    expect(inbox.getByText(/raise the/).textContent).toBe("In Stripe, raise the Minimum balance to $3.25 (4.50 CAD in Stripe's currency).");
    expect(inbox.getByText(/^Controller, 24 Sep 2026, 07:07: the books match Stripe\./)).toBeTruthy();
  });

  it('fills in the credit form from the Controller figure and the latest payout, and records only on submit', async () => {
    fake.needs = { ...EMPTY_NEEDS, controller: RUN };
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Fill in the record form' }));
    await flush();
    const form = within(screen.getByRole('form', { name: 'Record a credit purchase' }));
    expect((form.getByLabelText('Amount (USD)') as HTMLInputElement).value).toBe('12.5');
    expect((form.getByLabelText('Stripe payout id') as HTMLInputElement).value).toBe('po_123');
    expect((form.getByLabelText('Reason') as HTMLInputElement).value).toBe('Controller figure of 2026-09-24');
    expect(form.getByText(FILLED_FROM_CONTROLLER)).toBeTruthy();
    expect(callsNamed('record_credit_purchase')).toHaveLength(0);
    fireEvent.submit(screen.getByRole('form', { name: 'Record a credit purchase' }));
    await flush();
    expect(callsNamed('record_credit_purchase').map((call) => call.args)).toEqual([
      { p_amount_usd: 12.5, p_stripe_payout_id: 'po_123', p_reason: 'Controller figure of 2026-09-24' },
    ]);
  });

  it('shows the inbox at aal1 but asks for the second factor before filling in the form', async () => {
    fake.aal = 'aal1';
    fake.needs = { ...EMPTY_NEEDS, controller: RUN };
    await renderBoard();
    const inbox = within(screen.getByRole('region', { name: 'Needs you' }));
    expect(inbox.getByText('Buy $12.50 of Console credit.')).toBeTruthy();
    expect(inbox.queryByRole('button', { name: 'Fill in the record form' })).toBeNull();
    expect(inbox.getByText(/Verify your second factor, then fill in the record form from here\./)).toBeTruthy();
    expectNoSecondFactorControls();
  });

  it('drops the credit item once a purchase is recorded after the run, and says why', async () => {
    fake.needs = { ...EMPTY_NEEDS, controller: RUN, last_credit_purchase: { created_at: '2026-09-24T09:00:00Z', amount_usd: '12.5' } };
    await renderBoard();
    const inbox = within(screen.getByRole('region', { name: 'Needs you' }));
    expect(inbox.queryByText('Buy $12.50 of Console credit.')).toBeNull();
    expect(inbox.getByText('A purchase of $12.50 was recorded after that run. The next run updates the credit figure.')).toBeTruthy();
  });

  it('lists no credit item when the Controller figure is zero, and names mismatches', async () => {
    fake.needs = { ...EMPTY_NEEDS, controller: { ...RUN, ok: false, mismatches: 2, credit_purchase_usd: 0, disputes_to_answer: [] } };
    await renderBoard();
    const inbox = within(screen.getByRole('region', { name: 'Needs you' }));
    expect(inbox.getByText(NOTHING_NEEDS_YOU)).toBeTruthy();
    expect(inbox.getByText(/2 mismatches, named in its alert/)).toBeTruthy();
  });

  it('shows the error when board_needs_you fails', async () => {
    fake.needs = null as unknown as Record<string, unknown>;
    await renderBoard();
    expect(within(screen.getByRole('region', { name: 'Needs you' })).getByText('board_needs_you returned nothing')).toBeTruthy();
  });
});

describe('Board executors', () => {
  it('reads the roles from public_roles and offers active card roles only, in title order', async () => {
    await renderBoard();
    await flush();
    expect(fake.selects.filter((select) => select.table === 'public_roles')).toEqual([{ table: 'public_roles', columns: ROLE_COLUMNS, filters: [] }]);
    const executor = within(screen.getByRole('form', { name: 'File a card' })).getByLabelText('Executor') as HTMLSelectElement;
    expect([...executor.options].map((option) => option.value)).toEqual(['r-builder-a', 'r-platform']);
  });
});

describe('Board sign-in', () => {
  it('sends a magic link back to this site that never creates a user', async () => {
    fake.signedOut = true;
    await renderBoard();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' board@peanutgallery.games ' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Sign in' }));
    await flush();
    expect(fake.otpCalls).toEqual([
      { email: 'board@peanutgallery.games', options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: false } },
    ]);
    expect(screen.getByRole('status').textContent).toBe('A sign-in link was sent to board@peanutgallery.games.');
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

  it('pauses a role at aal1 and is never offered a resume (docs/specs/agent-system-core.md)', async () => {
    fake.role = 'moderator';
    fake.aal = 'aal1';
    fake.factors = [];
    fake.boardRoles = [
      { id: 'r-qa', name: 'QA', agent_class: 'writer', state: 'active', paused: false, paused_reason: null },
      { id: 'r-studio-head', name: 'Studio Head', agent_class: 'planner', state: 'active', paused: true, paused_reason: 'Checking' },
    ];
    await renderBoard();
    await flush();
    const roles = within(screen.getByRole('region', { name: 'Roles' }));
    expect(roles.getByText('Only the board resumes a role.', { exact: false })).toBeTruthy();
    // The paused role is listed but never offered to the moderator.
    const select = roles.getByLabelText('Role') as HTMLSelectElement;
    expect([...select.options].map((option) => [option.textContent, option.disabled])).toEqual([
      ['Choose a role', false],
      ['QA', false],
      ['Studio Head (paused)', true],
    ]);
    fireEvent.change(select, { target: { value: 'r-studio-head' } });
    expect(roles.queryByRole('button', { name: 'Resume Studio Head' })).toBeNull();
    fireEvent.change(select, { target: { value: 'r-qa' } });
    fireEvent.change(roles.getByLabelText('Reason'), { target: { value: 'Looks wrong' } });
    fireEvent.click(roles.getByRole('button', { name: 'Pause QA' }));
    await flush();
    expect(callsNamed('set_role_pause').map((call) => call.args)).toEqual([{ p_role: 'r-qa', p_paused: true, p_reason: 'Looks wrong' }]);
    expect(roles.getByRole('status').textContent).toBe('QA paused.');
    expect(roles.getByRole('row', { name: 'QA writer paused: Looks wrong' })).toBeTruthy();
    expect(roles.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('shows only pause and resume, and the role pauses, and never heartbeats', async () => {
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
    expect(callsNamed('board_needs_you')).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull();
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

// docs/specs/agent-system-core.md: the cooling window, role pauses, the job list with Run now, each
// card's veto (undealt and hidden agent cards included) and Needs you's two new lists.
describe('Board agent system controls', () => {
  it('shows the cooling window beside the caps and saves it with a reason, refusing more than a week before calling', async () => {
    fake.studio = { ...fake.studio, cooling_window_minutes: 0 };
    await renderBoard();
    const form = within(screen.getByRole('form', { name: 'Set the cooling window' }));
    expect((form.getByLabelText('Cooling window (minutes)') as HTMLInputElement).value).toBe('0');
    fireEvent.change(form.getByLabelText('Cooling window (minutes)'), { target: { value: '10081' } });
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'Too long' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Set the cooling window' }));
    await flush();
    expect(callsNamed('set_cooling_window')).toEqual([]);
    expect(form.getByText('The cooling window must be a whole number of minutes from 0 to 10,080.')).toBeTruthy();
    fireEvent.change(form.getByLabelText('Cooling window (minutes)'), { target: { value: '60' } });
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'An hour to look' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Set the cooling window' }));
    await flush();
    expect(callsNamed('set_cooling_window').map((call) => call.args)).toEqual([{ p_minutes: 60, p_reason: 'An hour to look' }]);
  });

  it("lists each role's class and pause in one row each, pauses and resumes the chosen role with a reason, and keeps the form for the second factor", async () => {
    fake.boardRoles = [
      { id: 'r-director', name: 'Game Director', agent_class: 'reviewer', state: 'active', paused: false, paused_reason: null },
      { id: 'r-qa', name: 'QA', agent_class: 'writer', state: 'active', paused: true, paused_reason: 'Checking the gate' },
      { id: 'r-scout', name: 'Old Scout', agent_class: null, state: 'retired', paused: false, paused_reason: null },
    ];
    await renderBoard();
    await flush();
    const roles = within(screen.getByRole('region', { name: 'Roles' }));
    expect(roles.getAllByRole('row').map((row) => row.textContent)).toEqual([
      'RoleClassStatus',
      'Game Directorreviewernot paused',
      'QAwriterpaused: Checking the gate',
      'Old Scout (retired)no class yetnot paused',
    ]);
    // One form for every role, not a reason field on each row.
    expect(roles.getAllByRole('textbox')).toHaveLength(1);
    fireEvent.click(roles.getByRole('button', { name: 'Pause or resume' }));
    await flush();
    expect(roles.getByRole('status').textContent).toBe('Choose a role.');
    fireEvent.change(roles.getByLabelText('Role'), { target: { value: 'r-qa' } });
    fireEvent.click(roles.getByRole('button', { name: 'Resume QA' }));
    await flush();
    expect(roles.getByRole('status').textContent).toBe('A reason is required.');
    fireEvent.change(roles.getByLabelText('Reason'), { target: { value: 'Fixed' } });
    fireEvent.click(roles.getByRole('button', { name: 'Resume QA' }));
    await flush();
    expect(callsNamed('set_role_pause').map((call) => call.args)).toEqual([{ p_role: 'r-qa', p_paused: false, p_reason: 'Fixed' }]);
    cleanup();
    fake.aal = 'aal1';
    await renderBoard();
    await flush();
    const readOnly = within(screen.getByRole('region', { name: 'Roles' }));
    expect(readOnly.getByRole('row', { name: 'Game Director reviewer not paused' })).toBeTruthy();
    expect(readOnly.queryByRole('form', { name: 'Pause or resume a role' })).toBeNull();
    expect(readOnly.queryByRole('button', { name: /^Pause/ })).toBeNull();
  });

  it('keeps the confirmation and keyboard focus on the button after a role is paused and the list refreshes', async () => {
    fake.boardRoles = [{ id: 'r-director', name: 'Game Director', agent_class: 'reviewer', state: 'active', paused: false, paused_reason: null }];
    await renderBoard();
    await flush();
    const roles = within(screen.getByRole('region', { name: 'Roles' }));
    fireEvent.change(roles.getByLabelText('Role'), { target: { value: 'r-director' } });
    fireEvent.change(roles.getByLabelText('Reason'), { target: { value: 'Too many loops' } });
    const button = roles.getByRole('button', { name: 'Pause Game Director' });
    button.focus();
    fireEvent.submit(roles.getByRole('form', { name: 'Pause or resume a role' }));
    await flush();
    expect(callsNamed('set_role_pause').map((call) => call.args)).toEqual([{ p_role: 'r-director', p_paused: true, p_reason: 'Too many loops' }]);
    expect(roles.getByRole('row', { name: 'Game Director reviewer paused: Too many loops' })).toBeTruthy();
    expect(roles.getByRole('status').textContent).toBe('Game Director paused.');
    // The same button, still focused, now resumes the role.
    expect(document.activeElement).toBe(button);
    expect(button.isConnected).toBe(true);
    expect(button.textContent).toBe('Resume Game Director');
    expect((roles.getByLabelText('Reason') as HTMLInputElement).value).toBe('');
  });

  it('keeps a busy button focusable, marked aria-disabled rather than disabled, and ignores a second submit while the first runs', async () => {
    fake.boardRoles = [{ id: 'r-director', name: 'Game Director', agent_class: 'reviewer', state: 'active', paused: false, paused_reason: null }];
    fake.held = 'set_role_pause';
    await renderBoard();
    await flush();
    const roles = within(screen.getByRole('region', { name: 'Roles' }));
    fireEvent.change(roles.getByLabelText('Role'), { target: { value: 'r-director' } });
    fireEvent.change(roles.getByLabelText('Reason'), { target: { value: 'Too many loops' } });
    const button = roles.getByRole('button', { name: 'Pause Game Director' }) as HTMLButtonElement;
    fireEvent.submit(roles.getByRole('form', { name: 'Pause or resume a role' }));
    await flush();
    // A browser moves focus off a focused button when it becomes disabled, so busy never disables.
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.submit(roles.getByRole('form', { name: 'Pause or resume a role' }));
    await flush();
    expect(callsNamed('set_role_pause')).toHaveLength(1);
    await act(async () => fake.release());
    await flush();
    expect(roles.getByRole('status').textContent).toBe('Game Director paused.');
    expect(button.getAttribute('aria-disabled')).toBe('false');
  });

  it('never disables a control only because its action is running', () => {
    // Every busy control in the board site keeps its focus the same way (the test above shows one).
    // vitest runs in the package root; jsdom gives import.meta.url an http scheme.
    const source = readFileSync(resolve(process.cwd(), 'src/Board.tsx'), 'utf8');
    expect(source).toMatch(/aria-disabled=\{busy\}/);
    expect(source).not.toMatch(/(?<![-\w])disabled=\{[^}]*\bbusy\b/);
  });

  it('lists each job with its last runs, their origin and reason, and queues a board-origin run with typed input', async () => {
    fake.jobs = [
      {
        name: 'studio_ranking',
        role_name: 'Studio Head',
        calls_model: true,
        runs_when_paused: true,
        description: null,
        runs: [{ id: 'run-1', origin: 'schedule', status: 'skipped', reason: 'not_board_origin', created_at: '2026-09-14T11:00:00Z', finished_at: '2026-09-14T11:00:05Z' }],
      },
    ];
    await renderBoard();
    await flush();
    const job = within(screen.getByRole('form', { name: 'Job studio_ranking' }));
    expect(job.getByText('Studio Head · calls a model, on the board plan while you are signed in · runs while the studio is paused')).toBeTruthy();
    expect(job.getByText(`${formatDateTime('2026-09-14T11:00:00Z')} · schedule · skipped: not_board_origin`)).toBeTruthy();
    fireEvent.change(job.getByLabelText('Input (JSON, optional)'), { target: { value: '[1]' } });
    fireEvent.change(job.getByLabelText('Reason'), { target: { value: 'Rank now' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Job studio_ranking' }));
    await flush();
    expect(job.getByText('The input must be a JSON object.')).toBeTruthy();
    fireEvent.change(job.getByLabelText('Input (JSON, optional)'), { target: { value: '{"floor": 3}' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Job studio_ranking' }));
    await flush();
    expect(callsNamed('enqueue_manual_job').map((call) => call.args)).toEqual([{ p_job: 'studio_ranking', p_card: null, p_reason: 'Rank now', p_input: { floor: 3 } }]);
    expect(job.getByText('Queued. It runs while a board member is signed in here.')).toBeTruthy();
  });

  it('marks an undealt agent card and a hidden one, vetoes the undealt one with a reason, and lifts a veto', async () => {
    fake.cards = [
      card({ id: 'undealt', title: 'Approved, waiting', horizon: 'next', source: 'agent', drafter_role_id: 'r-designer', opens_at: '2026-09-14T13:00:00Z' }),
      card({ id: 'hidden', title: 'No current approval', horizon: 'next', source: 'agent', drafter_role_id: 'r-designer' }),
      card({ id: 'vetoed', title: 'Vetoed card', horizon: 'next', board_vetoed: true, board_veto_reason: 'Off pillar' }),
    ];
    fake.publicCards = ['undealt'];
    await renderBoard();
    await flush();
    expect(cardForm('Approved, waiting').getByText(`Waiting to be dealt: moves to now at ${formatDateTime('2026-09-14T13:00:00Z')}.`)).toBeTruthy();
    expect(cardForm('No current approval').getByText(/^Hidden: written by an agent with no current approval/)).toBeTruthy();
    expect(cardForm('Vetoed card').getByText('Vetoed by the board: Off pillar. It is never dealt or run.')).toBeTruthy();
    expect(cardForm('Vetoed card').queryByRole('button', { name: 'Veto card' })).toBeNull();
    fireEvent.change(cardForm('Approved, waiting').getByLabelText('Reason'), { target: { value: 'Not this week' } });
    fireEvent.click(cardForm('Approved, waiting').getByRole('button', { name: 'Veto card' }));
    await flush();
    fireEvent.change(cardForm('Vetoed card').getByLabelText('Reason'), { target: { value: 'Fine now' } });
    fireEvent.click(cardForm('Vetoed card').getByRole('button', { name: 'Lift veto' }));
    await flush();
    expect(callsNamed('set_card_veto').map((call) => call.args)).toEqual([
      { p_card: 'undealt', p_vetoed: true, p_reason: 'Not this week' },
      { p_card: 'vetoed', p_vetoed: false, p_reason: 'Fine now' },
    ]);
    // Only agent-written cards are asked about their approval; the board-filed one is not.
    expect(new Set(callsNamed('card_is_public').map((call) => call.args?.p_card))).toEqual(new Set(['hidden', 'undealt']));
  });

  it('vetoes a card on now with one button that keeps focus and says so, though the veto moves the card to next', async () => {
    fake.cards = [card({ id: 'on-now', title: 'On now', horizon: 'now' }), card({ id: 'on-next', title: 'On next', horizon: 'next', rank: 1 })];
    await renderBoard();
    await flush();
    const form = cardForm('On now');
    fireEvent.change(form.getByLabelText('Reason'), { target: { value: 'Off pillar' } });
    const toggle = form.getByRole('button', { name: 'Veto card' });
    toggle.focus();
    fireEvent.click(toggle);
    await flush();
    const after = cardForm('On now');
    expect(after.getByRole('status').textContent).toBe('Card vetoed.');
    expect(after.getByText(/horizon next/)).toBeTruthy();
    // The same element, now reading Lift veto, still has focus.
    expect(after.getByRole('button', { name: 'Lift veto' })).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
    fireEvent.change(after.getByLabelText('Reason'), { target: { value: 'Back in' } });
    fireEvent.click(toggle);
    await flush();
    expect(cardForm('On now').getByRole('status').textContent).toBe('Veto lifted.');
    expect(toggle.textContent).toBe('Veto card');
    expect(document.activeElement).toBe(toggle);
  });

  it('lists the ceiling pauses the rule will not resume and the cards holding money whose approval is not current, each linking to its row under Cards', async () => {
    fake.needs = { ...NEEDS_CARDS };
    fake.cards = [
      card({ id: 'max', title: 'At the maximum', stage: 'paused' }),
      card({ id: 'twice', title: 'Paused twice', stage: 'paused' }),
      card({ id: 'void', title: 'Rewritten', source: 'agent', drafter_role_id: 'r-designer' }),
    ];
    await renderBoard();
    await flush();
    const needs = within(screen.getByRole('region', { name: 'Needs you' }));
    expect(needs.getByText('Card At the maximum is paused at its ceiling at the card maximum of $25.00.')).toBeTruthy();
    // resumed_before covers a first resume by the rule or by the board.
    expect(needs.getByText('Card Paused twice is paused at its ceiling a second time, after it was resumed once.')).toBeTruthy();
    expect(needs.getAllByRole('link', { name: 'resume it with a new estimate, or cancel it, under Cards' }).map((link) => link.getAttribute('href'))).toEqual(['#card-max', '#card-twice']);
    expect(needs.getByText('Card Rewritten holds $2.00 but its approval is not current.')).toBeTruthy();
    expect(needs.getByRole('link', { name: 'Cancel it under Cards' }).getAttribute('href')).toBe('#card-void');
    // Every link has its row on the page.
    for (const link of needs.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('#'))) {
      expect(document.getElementById(link.getAttribute('href')!.slice(1)), link.getAttribute('href')!).not.toBeNull();
    }
  });

  it('names the second factor and links to no card at the first factor, where Cards is not shown', async () => {
    fake.aal = 'aal1';
    fake.needs = { ...NEEDS_CARDS };
    await renderBoard();
    const region = screen.getByRole('region', { name: 'Needs you' });
    const needs = within(region);
    expect(screen.queryByRole('region', { name: 'Cards' })).toBeNull();
    expect(region.querySelectorAll('a[href^="#"]')).toHaveLength(0);
    expect(needs.getByText(/Verify your second factor, then cancel it under Cards, which moves its unspent money/)).toBeTruthy();
    expect(needs.getAllByText(/The rule will not resume it: verify your second factor, then resume it with a new estimate, or cancel it, under Cards\./)).toHaveLength(2);
  });

  it('links to no card while the cards read has not listed it', async () => {
    fake.needs = { ...NEEDS_CARDS };
    fake.cards = [];
    await renderBoard();
    await flush();
    const region = screen.getByRole('region', { name: 'Needs you' });
    expect(region.querySelectorAll('a[href^="#"]')).toHaveLength(0);
    expect(within(region).getByText(/Cancel it under Cards, which moves its unspent money/)).toBeTruthy();
  });
});
