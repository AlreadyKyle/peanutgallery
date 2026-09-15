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

type FakeFactor = { id: string; factor_type: 'totp'; status: 'verified' | 'unverified' };

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

const STATE_CHANGING_RPCS = ['set_paused', 'set_launched', 'set_agent_mode', 'file_card', 'file_directive', 'file_note'];

/** Every control that needs aal2 is absent. */
function expectNoSecondFactorControls() {
  expect(screen.queryByRole('button', { name: 'Pause agents' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Resume agents' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Go live' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Agent mode' })).toBeNull();
  expect(screen.queryByRole('form', { name: 'File a Next card' })).toBeNull();
  expect(screen.queryByRole('form', { name: 'File a directive' })).toBeNull();
  expect(screen.queryByRole('form', { name: 'File a note' })).toBeNull();
}

function expectSecondFactorControls() {
  expect(screen.getByRole('button', { name: 'Pause agents' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Go live' })).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Agent mode' })).toBeTruthy();
  expect(screen.getByRole('form', { name: 'File a Next card' })).toBeTruthy();
  expect(screen.getByRole('form', { name: 'File a directive' })).toBeTruthy();
  expect(screen.getByRole('form', { name: 'File a note' })).toBeTruthy();
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

  it('files a Next card with the contract argument names and only write roles as executors', async () => {
    await renderBoard();
    const form = within(screen.getByRole('form', { name: 'File a Next card' }));
    const executor = form.getByLabelText('Executor') as HTMLSelectElement;
    expect([...executor.options].map((option) => option.textContent)).toEqual(['Builder A']);

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
    fireEvent.submit(screen.getByRole('form', { name: 'File a Next card' }));
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
    fireEvent.change(form.getByLabelText('Public summary'), { target: { value: 'A big change.' } });
    fireEvent.change(form.getByLabelText('Intent (for the agents)'), { target: { value: 'Costs too much.' } });
    fireEvent.change(form.getByLabelText('Acceptance test'), { target: { value: 'It loads.' } });
    fireEvent.change(target, { target: { value: '12' } });
    fireEvent.submit(formElement);
    await flush();

    expect(form.getByText('Funding target must be between $0.01 and $10.00.')).toBeTruthy();
    expect(screen.getByText('Daily cap $100.00. Card maximum $10.00.')).toBeTruthy();
    expect(callsNamed('file_card')).toHaveLength(0);
  });

  it('refuses a blank public summary before calling the database', async () => {
    await renderBoard();
    const formElement = screen.getByRole('form', { name: 'File a Next card' });
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
    const form = within(screen.getByRole('form', { name: 'File a Next card' }));
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
        'A second factor is needed before you can pause agents, go live, change the agent mode, or file cards, directives and notes.',
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
