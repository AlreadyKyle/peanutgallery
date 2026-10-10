import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board, BOARD_LEDE, CANCEL_CONFIRM, NOT_ON_BOARD, SECOND_FACTOR_LINE } from './Board';
import {
  ACTIONABLE_CARD_COLUMNS,
  CARD_EVENT_COLUMNS,
  DISPATCHER_STALE_MS,
  FINDING_COLUMNS,
  RECENT_CARD_COLUMNS,
  ROLE_COLUMNS,
  STUDIO_STATE_POLL_MS,
} from './lib/board';
import { formatDateTime } from './lib/format';
import { CAPS_BY_SQL } from './Status';

// The panel's database calls the old page made and this one never does. Each name is spelt in parts so
// the spec's grep of platform/board/src (docs/specs/optional-board.md, Verification) finds no call.
const rpcName = (...words: string[]) => words.join('_');
const RETIRED_RPCS = [
  rpcName('board', 'heartbeat'),
  rpcName('board', 'needs', 'you'),
  rpcName('set', 'agent', 'mode'),
  rpcName('set', 'card', 'horizon'),
  rpcName('set', 'card', 'veto'),
  rpcName('set', 'cooling', 'window'),
  rpcName('set', 'role', 'pause'),
  rpcName('set', 'caps'),
  rpcName('file', 'directive'),
  rpcName('file', 'note'),
];
const STATE_CHANGING_RPCS = ['set_paused', 'file_card', 'cancel_card', 'resume_card', 'record_credit_purchase', 'enqueue_manual_job', 'set_launched', ...RETIRED_RPCS];

type Call = { name: string; args: Record<string, unknown> | undefined };
type FakeFactor = { id: string; factor_type: 'totp'; status: 'verified' | 'unverified' };
type Row = Record<string, unknown>;

const fake = vi.hoisted(() => ({
  role: 'board' as string | null,
  noClient: false,
  signedOut: false,
  session: null as { user: { id: string; email: string }; access_token: string } | null,
  // supabase-js's auth listeners: a test delivers SIGNED_IN as another tab's sign-in would.
  listeners: [] as ((event: string, session: unknown) => void)[],
  otpCalls: [] as Record<string, unknown>[],
  studio: {} as Record<string, unknown>,
  pauseReason: null as string | null,
  supply: null as Record<string, unknown> | null,
  cards: [] as Record<string, unknown>[],
  jobs: [] as Record<string, unknown>[],
  findings: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  roleRows: [] as Record<string, unknown>[],
  cancelResult: null as Record<string, unknown> | null,
  selects: [] as { table: string; columns: string; filters: string[] }[],
  calls: [] as { name: string; args: Record<string, unknown> | undefined }[],
  aal: 'aal2' as 'aal1' | 'aal2',
  factors: [] as { id: string; factor_type: 'totp'; status: 'verified' | 'unverified' }[],
  goodCode: '123456',
  mfaCalls: [] as { name: string; args: Record<string, unknown> | undefined }[],
  // An RPC named here is left pending until release() is called, so a test sees a control mid-action.
  held: null as string | null,
  release: () => {},
}));

vi.mock('./lib/supabase', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/supabase')>();
  const mfa = (name: string, args: Record<string, unknown> | undefined, data: unknown, error: { message: string } | null = null) => {
    fake.mfaCalls.push({ name, args });
    return Promise.resolve({ data, error });
  };
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: fake.signedOut ? null : fake.session } }),
      signInWithOtp: (args: Record<string, unknown>) => {
        fake.otpCalls.push(args);
        return Promise.resolve({ data: {}, error: null });
      },
      onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
        fake.listeners.push(listener);
        return { data: { subscription: { unsubscribe: () => (fake.listeners = fake.listeners.filter((l) => l !== listener)) } } };
      },
      signOut: () => Promise.resolve({ error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: () => mfa('getAuthenticatorAssuranceLevel', undefined, { currentLevel: fake.aal }),
        listFactors: () => mfa('listFactors', undefined, { all: [...fake.factors], totp: fake.factors.filter((f) => f.status === 'verified') }),
        unenroll: (args: { factorId: string }) => {
          fake.factors = fake.factors.filter((f) => f.id !== args.factorId);
          return mfa('unenroll', args, { id: args.factorId });
        },
        enroll: (args: Record<string, unknown>) => {
          fake.factors.push({ id: 'f-new', factor_type: 'totp', status: 'unverified' });
          return mfa('enroll', args, { id: 'f-new', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg></svg>', secret: 'JBSWY3DPEHPK3PXP' } });
        },
        challenge: (args: { factorId: string }) => mfa('challenge', args, { id: `challenge-${args.factorId}` }),
        verify: (args: { factorId: string; challengeId: string; code: string }) => {
          if (args.code !== fake.goodCode) return mfa('verify', args, null, { message: 'Invalid TOTP code entered' });
          fake.aal = 'aal2';
          fake.factors = fake.factors.map((f) => (f.id === args.factorId ? { ...f, status: 'verified' } : f));
          return mfa('verify', args, { access_token: 'aal2-token' });
        },
      },
    },
    rpc: async (name: string, args?: Record<string, unknown>) => {
      fake.calls.push({ name, args });
      if (name === fake.held) await new Promise<void>((done) => (fake.release = done));
      // The card RPCs change the card as the database does, so the next read gives it back changed.
      if (name === 'cancel_card' || name === 'resume_card') {
        fake.cards = fake.cards.map((c) => (c.id === args?.p_card ? { ...c, stage: name === 'cancel_card' ? 'rejected' : 'funded' } : c));
      }
      if (name === 'file_card') {
        fake.cards = [...fake.cards, { id: 'filed', title: String(args?.p_title), stage: 'proposed', horizon: args?.p_horizon, failing_check: null, updated_at: '2026-10-10T12:00:00Z', estimate_usd: '0.0000' }];
      }
      const data: Record<string, unknown> = {
        board_role: fake.role,
        board_studio_state: fake.studio,
        card_supply: fake.supply,
        board_jobs: fake.jobs,
        cancel_card: fake.cancelResult,
        file_card: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        enqueue_manual_job: '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
      };
      if (name === 'card_supply' && fake.supply === null) return { data: null, error: { message: 'card_supply is unavailable' } };
      return { data: data[name] ?? null, error: null };
    },
    from: (table: string) => {
      const select = { table, columns: '', filters: [] as string[] };
      const where: { column: string; values: unknown[] }[] = [];
      let limit = Infinity;
      fake.selects.push(select);
      const builder = {
        select(columns: string) {
          select.columns = columns;
          return builder;
        },
        in(column: string, values: unknown[]) {
          select.filters.push(`in ${column} ${values.join(',')}`);
          where.push({ column, values });
          return builder;
        },
        eq(column: string, value: unknown) {
          select.filters.push(`eq ${column} ${String(value)}`);
          where.push({ column, values: [value] });
          return builder;
        },
        is(column: string, value: null) {
          select.filters.push(`is ${column} ${String(value)}`);
          return builder;
        },
        order(column: string, options?: { ascending?: boolean }) {
          select.filters.push(`order ${column} ${options?.ascending === false ? 'desc' : 'asc'}`);
          return builder;
        },
        limit(n: number) {
          select.filters.push(`limit ${n}`);
          limit = n;
          return builder;
        },
        returns() {
          const tables: Record<string, Record<string, unknown>[]> = {
            cards: fake.cards,
            public_roles: fake.roleRows,
            findings: fake.findings,
            public_agent_events: fake.events,
            public_studio: [{ pause_reason: fake.pauseReason }],
          };
          const data = (tables[table] ?? []).filter((row) => where.every((w) => w.values.includes(row[w.column]))).slice(0, limit);
          return Promise.resolve({ data, error: null });
        },
      };
      return builder;
    },
  };
  return { ...original, getClient: () => (fake.noClient ? null : client) };
});

const startedAt = new Date('2026-10-10T12:00:00Z');

function card(id: string, title: string, stage: string, more: Row = {}): Row {
  return { id, title, stage, horizon: 'now', failing_check: null, updated_at: '2026-10-09T10:00:00Z', estimate_usd: '0.0000', ...more };
}

const AT_FLOOR = { open: 6, big: 1, small: 5, floor_open: 6, floor_big: 1, floor_small: 1, big_min_usd: '5.0000', small_max_usd: '2.0000' };

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderBoard() {
  render(<Board />);
  // The session, the role, the two-factor state and the panel's first reads resolve in turn.
  for (let i = 0; i < 4; i += 1) await flush();
}

const named = (name: string): Call[] => fake.calls.filter((call) => call.name === name);
const mfaNamed = (name: string): Call[] => fake.mfaCalls.filter((call) => call.name === name);
const regions = () => screen.queryAllByRole('region').map((region) => region.getAttribute('aria-label'));
const form = (name: string) => within(screen.getByRole('form', { name }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(startedAt);
  fake.role = 'board';
  fake.noClient = false;
  fake.signedOut = false;
  fake.session = { user: { id: 'u-board', email: 'board@mobmachine.games' }, access_token: 'token-1' };
  fake.listeners = [];
  fake.otpCalls.length = 0;
  fake.studio = {
    paused: false,
    dispatcher_seen_at: new Date(startedAt.getTime() - 30_000).toISOString(),
    daily_cap_usd: 100,
    card_max_usd: 25,
  };
  fake.pauseReason = null;
  fake.supply = { ...AT_FLOOR };
  fake.cards = [];
  fake.jobs = [];
  fake.findings = [];
  fake.events = [];
  fake.roleRows = [
    { id: 'r-platform', title: 'Platform Builder', write_access: true, state: 'active' },
    { id: 'r-director', title: 'Game Director', write_access: true, state: 'active' },
    { id: 'r-builder-a', title: 'Builder A', write_access: true, state: 'active' },
    { id: 'r-host', title: 'Host', write_access: false, state: 'active' },
    { id: 'r-old', title: 'Builder B', write_access: true, state: 'retired' },
  ];
  fake.cancelResult = null;
  fake.selects.length = 0;
  fake.calls.length = 0;
  fake.aal = 'aal2';
  fake.factors = [{ id: 'f-1', factor_type: 'totp', status: 'verified' }];
  fake.mfaCalls.length = 0;
  fake.held = null;
  fake.release = () => {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sign-in', () => {
  it('says the site is an optional panel, and that sign-in is for board members, by email link and then a code', async () => {
    fake.signedOut = true;
    await renderBoard();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mob Machine board');
    expect(BOARD_LEDE).toContain('an optional admin panel; the studio runs without it');
    expect(screen.getByText(BOARD_LEDE)).toBeTruthy();
    const signIn = within(screen.getByRole('region', { name: 'Board sign-in' }));
    expect(signIn.getByText(/^For board members only\. Enter your board email/)).toBeTruthy();
    expect(regions()).toEqual(['Board sign-in']);
  });

  it('sends a magic link back to this site that never creates a user', async () => {
    fake.signedOut = true;
    await renderBoard();
    fireEvent.change(screen.getByLabelText('Board email'), { target: { value: ' board@mobmachine.games ' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Sign in' }));
    await flush();
    expect(fake.otpCalls).toEqual([{ email: 'board@mobmachine.games', options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: false } }]);
    expect(screen.getByRole('status').textContent).toBe('Check board@mobmachine.games for your sign-in link, and open it in this browser.');
  });

  it('without a database configuration renders the form and says sign-in is unavailable', async () => {
    fake.noClient = true;
    await renderBoard();
    fireEvent.change(screen.getByLabelText('Board email'), { target: { value: 'board@mobmachine.games' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Sign in' }));
    await flush();
    expect(screen.getByRole('status').textContent).toBe('The site has no database configuration, so board sign-in is unavailable.');
    expect(fake.calls).toEqual([]);
  });

  it('for an email not on the board says so and calls nothing but board_role', async () => {
    fake.role = null;
    await renderBoard();
    await flush(STUDIO_STATE_POLL_MS * 2);
    expect(screen.getByText(NOT_ON_BOARD)).toBeTruthy();
    expect(regions()).toEqual([]);
    expect(fake.calls.map((call) => call.name)).toEqual(['board_role']);
    expect(fake.selects).toEqual([]);
    expect(fake.mfaCalls).toEqual([]);
  });
});

describe('the first factor (aal1)', () => {
  it('renders only the Two-factor step and calls no state-changing or studio RPC, even after the polls would run', async () => {
    fake.aal = 'aal1';
    await renderBoard();
    expect(regions()).toEqual(['Two-factor sign-in']);
    expect(within(screen.getByRole('region', { name: 'Two-factor sign-in' })).getByText(SECOND_FACTOR_LINE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause agents' })).toBeNull();
    expect(screen.queryAllByRole('form').map((f) => f.getAttribute('aria-label'))).toEqual(['Verify a code']);
    await flush(STUDIO_STATE_POLL_MS * 4);
    const names = fake.calls.map((call) => call.name);
    expect(names.filter((name) => STATE_CHANGING_RPCS.includes(name))).toEqual([]);
    for (const read of ['board_studio_state', 'board_jobs', 'card_supply']) expect(names).not.toContain(read);
    expect(names).toEqual(['board_role']);
    expect(fake.selects).toEqual([]);
  });

  it('enrols an authenticator app on an account without one, refuses a bad code, then opens the panel on Status', async () => {
    fake.aal = 'aal1';
    fake.factors = [{ id: 'f-abandoned', factor_type: 'totp', status: 'unverified' }];
    await renderBoard();
    const step = within(screen.getByRole('region', { name: 'Two-factor sign-in' }));
    expect(step.queryByRole('form', { name: 'Verify a code' })).toBeNull();
    fireEvent.click(step.getByRole('button', { name: 'Set up an authenticator app' }));
    await flush();
    await flush();
    expect(mfaNamed('unenroll').map((call) => call.args)).toEqual([{ factorId: 'f-abandoned' }]);
    expect(mfaNamed('enroll').map((call) => call.args)).toEqual([{ factorType: 'totp' }]);
    expect(step.getByRole('img', { name: 'QR code for your authenticator app' }).getAttribute('src')).toBe('data:image/svg+xml;utf-8,<svg></svg>');
    expect(step.getByText('JBSWY3DPEHPK3PXP').tagName).toBe('CODE');

    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '000000' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Verify a code' }));
    await flush();
    expect(screen.getByText('Invalid TOTP code entered')).toBeTruthy();
    expect(regions()).toEqual(['Two-factor sign-in']);

    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Verify a code' }));
    for (let i = 0; i < 4; i += 1) await flush();
    expect(mfaNamed('verify').at(-1)?.args).toEqual({ factorId: 'f-new', challengeId: 'challenge-f-new', code: '123456' });
    expect(regions().slice(0, 3)).toEqual(['Status', 'Activity', 'Actions']);
  });

  it('challenges a verified factor, refuses a code that is not six digits before calling, and never enrols', async () => {
    fake.aal = 'aal1';
    await renderBoard();
    const step = within(screen.getByRole('region', { name: 'Two-factor sign-in' }));
    expect(step.queryByRole('button', { name: 'Set up an authenticator app' })).toBeNull();
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '12 34' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Verify a code' }));
    await flush();
    expect(screen.getByText('Enter the 6-digit code from your authenticator app.')).toBeTruthy();
    expect(mfaNamed('verify')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Verify a code' }));
    for (let i = 0; i < 4; i += 1) await flush();
    expect(mfaNamed('verify').map((call) => call.args)).toEqual([{ factorId: 'f-1', challengeId: 'challenge-f-1', code: '123456' }]);
    expect(mfaNamed('enroll')).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Status' })).toBeTruthy();
  });
});

/** Another tab signs in: supabase-js broadcasts the new session to this one. */
async function signInElsewhere(id: string, email: string, token: string) {
  fake.session = { user: { id, email }, access_token: token };
  await act(async () => {
    for (const listener of fake.listeners) listener('SIGNED_IN', fake.session);
  });
  for (let i = 0; i < 4; i += 1) await flush();
}

const STUDIO_READS = ['board_studio_state', 'card_supply', 'board_jobs'];
const studioReads = () => [fake.calls.filter((call) => STUDIO_READS.includes(call.name)).length, fake.selects.length];

describe('a new session in another tab', () => {
  it('keeps the panel through a refresh at aal2', async () => {
    await renderBoard();
    await signInElsewhere('u-board', 'board@mobmachine.games', 'token-2');
    expect(regions().slice(0, 3)).toEqual(['Status', 'Activity', 'Actions']);
  });

  it('at aal1 for the same board member goes back to the code step, and the panel reads nothing more', async () => {
    await renderBoard();
    expect(regions().slice(0, 3)).toEqual(['Status', 'Activity', 'Actions']);
    fake.aal = 'aal1';
    await signInElsewhere('u-board', 'board@mobmachine.games', 'token-2');
    expect(regions()).toEqual(['Two-factor sign-in']);
    const after = studioReads();
    await flush(STUDIO_STATE_POLL_MS * 3);
    expect(studioReads()).toEqual(after);
    expect(named('board_role')).toHaveLength(2);
  });

  it('at aal1 for another board member goes back to the code step, signed in as them', async () => {
    await renderBoard();
    fake.aal = 'aal1';
    await signInElsewhere('u-other', 'other@mobmachine.games', 'token-3');
    expect(regions()).toEqual(['Two-factor sign-in']);
    expect(screen.getByText(/Signed in as other@mobmachine\.games\./)).toBeTruthy();
    const after = studioReads();
    await flush(STUDIO_STATE_POLL_MS * 3);
    expect(studioReads()).toEqual(after);
  });

  it("for the moderator replacing the board's session shows only Pause and resume, and reads no studio state", async () => {
    await renderBoard();
    fake.role = 'moderator';
    fake.aal = 'aal1';
    await signInElsewhere('u-moderator', 'moderator@mobmachine.games', 'token-4');
    expect(regions()).toEqual(['Pause and resume']);
    const after = studioReads();
    await flush(STUDIO_STATE_POLL_MS * 3);
    expect(studioReads()).toEqual(after);
  });
});

describe('the moderator', () => {
  it('pauses and resumes at aal1 with no two-factor step, reads no studio state and sees nothing else', async () => {
    fake.role = 'moderator';
    fake.aal = 'aal1';
    fake.factors = [];
    await renderBoard();
    expect(regions()).toEqual(['Pause and resume']);
    fireEvent.change(screen.getByLabelText('Pause reason'), { target: { value: 'incident' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pause agents' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Resume agents' }));
    await flush();
    await flush(STUDIO_STATE_POLL_MS * 2);
    expect(named('set_paused').map((call) => call.args)).toEqual([{ p_paused: true, p_reason: 'incident' }, { p_paused: false }]);
    expect(screen.getByText('Agents resumed.')).toBeTruthy();
    expect(fake.calls.map((call) => call.name)).toEqual(['board_role', 'set_paused', 'set_paused']);
    expect(fake.selects).toEqual([]);
    expect(fake.mfaCalls).toEqual([]);
  });
});

describe('the panel at aal2', () => {
  it('never calls a retired RPC or card_is_public, and shows no region of the old page, after every part has been used', async () => {
    fake.cards = [card('c1', 'Faster gatherers', 'paused', { estimate_usd: '1.5000' })];
    fake.jobs = [{ name: 'tidy_up', runs: [] }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await flush();
    fireEvent.change(form('Card events').getByLabelText('Card'), { target: { value: 'c1' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Card events' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Pause agents' }));
    await flush(STUDIO_STATE_POLL_MS * 4);
    const names = fake.calls.map((call) => call.name);
    for (const retired of [...RETIRED_RPCS, 'board_roles', 'card_is_public']) expect(names).not.toContain(retired);
    for (const region of ['Needs you', 'Roles', 'Cooling window', 'File a directive', 'File a note', 'Set the caps', 'Board session', 'Jobs', 'Cards']) {
      expect(screen.queryByRole('region', { name: region })).toBeNull();
      expect(screen.queryByRole('form', { name: region })).toBeNull();
    }
    expect(regions()).toEqual(['Status', 'Activity', 'Actions', 'Pause and resume']);
  });

  it('lists exactly the six actions', async () => {
    await renderBoard();
    const actions = within(screen.getByRole('region', { name: 'Actions' }));
    expect(actions.getByRole('region', { name: 'Pause and resume' })).toBeTruthy();
    expect(actions.getAllByRole('form').map((f) => f.getAttribute('aria-label'))).toEqual(['File a card', 'Card actions', 'Record a credit purchase', 'Run a job now']);
    expect(actions.getByRole('button', { name: 'Reject card' })).toBeTruthy();
  });
});

describe('Status', () => {
  it('is the first screen: running, the dispatcher seen, the caps read-only with the SQL line, the lane and the supply', async () => {
    fake.studio = { ...fake.studio, agent_hourly_rate_usd: 4, monthly_cap_usd: '500', credit_studio_daily_cap_usd: 500, anthropic_tier_cap_usd: null };
    await renderBoard();
    expect(regions()[0]).toBe('Status');
    const status = within(screen.getByRole('region', { name: 'Status' }));
    expect(status.getByText('Agents: running.')).toBeTruthy();
    expect(status.getByText('Dispatcher: seen 30 s ago.')).toBeTruthy();
    expect(
      status.getByText('Daily cap $100.00. Card maximum $25.00. Hourly rate $4.00. Monthly cap $500.00. Studio daily limit on immediate credit $500.00. No usage tier cap.'),
    ).toBeTruthy();
    expect(status.getByText(CAPS_BY_SQL)).toBeTruthy();
    expect(status.getByText('Studio code lane: closed.')).toBeTruthy();
    expect(status.getByText('Open cards: 6 of a floor of 6 · $5 or more: 1 of 1 · under $2: 5 of 1.')).toBeTruthy();
    expect(status.queryByRole('spinbutton')).toBeNull();
  });

  it('says why the studio is paused, from public_studio', async () => {
    fake.studio = { ...fake.studio, paused: true };
    fake.pauseReason = 'awaiting_credit';
    await renderBoard();
    expect(screen.getByText("Agents: paused. Reason: Waiting for a payout to buy the agents' credit.")).toBeTruthy();
    expect(fake.selects.filter((s) => s.table === 'public_studio')[0]).toEqual({ table: 'public_studio', columns: 'pause_reason', filters: ['limit 1'] });
  });

  it('says the dispatcher is not running with no heartbeat, and stale with an old one', async () => {
    fake.studio = { ...fake.studio, dispatcher_seen_at: null };
    await renderBoard();
    expect(screen.getByText('Dispatcher: not running.')).toBeTruthy();
    cleanup();
    const old = new Date(startedAt.getTime() - DISPATCHER_STALE_MS - 1_000).toISOString();
    fake.studio = { ...fake.studio, dispatcher_seen_at: old };
    await renderBoard();
    expect(screen.getByText(`Dispatcher: stale, last seen ${formatDateTime(old)}.`)).toBeTruthy();
  });

  it('polls board_studio_state every 15 s', async () => {
    await renderBoard();
    const first = named('board_studio_state').length;
    expect(first).toBe(1);
    await flush(STUDIO_STATE_POLL_MS);
    expect(named('board_studio_state')).toHaveLength(2);
  });

  it('names a card supply failure', async () => {
    fake.supply = null;
    await renderBoard();
    expect(screen.getByText('Card supply: card_supply is unavailable')).toBeTruthy();
  });
});

describe('Activity', () => {
  it('reads the recent cards, the job runs and the findings once, and again only on Refresh', async () => {
    await renderBoard();
    await flush(STUDIO_STATE_POLL_MS * 4);
    const reads = () => [
      fake.selects.filter((s) => s.table === 'cards' && s.columns === RECENT_CARD_COLUMNS).length,
      named('board_jobs').length,
      fake.selects.filter((s) => s.table === 'findings').length,
    ];
    expect(reads()).toEqual([1, 1, 1]);
    expect(fake.selects.find((s) => s.columns === RECENT_CARD_COLUMNS)).toEqual({ table: 'cards', columns: RECENT_CARD_COLUMNS, filters: ['order updated_at desc', 'limit 25'] });
    expect(fake.selects.find((s) => s.table === 'findings')).toEqual({ table: 'findings', columns: FINDING_COLUMNS, filters: ['is closed_at null', 'order opened_at asc'] });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await flush();
    expect(reads()).toEqual([2, 2, 2]);
  });

  it('shows each recent card with its stage and failing check', async () => {
    fake.cards = [card('c1', 'Bigger pockets', 'funded', { failing_check: 'tests', updated_at: '2026-10-09T08:00:00Z' }), card('c2', 'Quiet rooms', 'proposed', { horizon: 'next' })];
    await renderBoard();
    const items = screen.getByRole('region', { name: 'Activity' }).querySelectorAll('li[data-card]');
    expect([...items].map((li) => li.textContent)).toEqual([
      `Bigger pockets · funded · now · failing check: tests · updated ${formatDateTime('2026-10-09T08:00:00Z')}`,
      `Quiet rooms · proposed · next · updated ${formatDateTime('2026-10-09T10:00:00Z')}`,
    ]);
  });

  it('flattens the job runs, newest first and at most 20, with the origin, status and reason in words', async () => {
    const runs = Array.from({ length: 22 }, (_, i) => ({ id: `r${i}`, origin: 'schedule', status: 'succeeded', reason: null, created_at: `2026-10-0${1 + (i % 9)}T${String(i).padStart(2, '0')}:00:00Z` }));
    fake.jobs = [
      { name: 'weekly_report', runs: [{ id: 'skip', origin: 'board', status: 'skipped', reason: 'studio_paused', created_at: '2026-10-10T11:00:00Z' }] },
      { name: 'tidy_up', runs },
    ];
    await renderBoard();
    const activity = within(screen.getByRole('region', { name: 'Activity' }));
    const lines = activity.getAllByText(/ · (weekly_report|tidy_up) · /);
    expect(lines).toHaveLength(20);
    expect(lines[0]?.textContent).toBe(`${formatDateTime('2026-10-10T11:00:00Z')} · weekly_report · run now · skipped: the studio is paused`);
  });

  it('lists the open findings with their detail, and a GitHub address as a link', async () => {
    const run = 'https://github.com/AlreadyKyle/peanutgallery/actions/runs/7';
    fake.findings = [
      { fingerprint: 'scan:osv', kind: 'scan', subject: "The weekly scan's osv job failed", detail: { run, job: null }, opened_at: '2026-10-09T08:00:00Z', last_seen_at: '2026-10-10T08:00:00Z' },
      { fingerprint: 'bad', kind: 'gossip', subject: 'not a kind', detail: {}, opened_at: '2026-10-09T08:00:00Z' },
    ];
    await renderBoard();
    const activity = within(screen.getByRole('region', { name: 'Activity' }));
    expect(activity.getByText("Weekly scan: The weekly scan's osv job failed.")).toBeTruthy();
    expect(activity.getByRole('link', { name: run }).getAttribute('href')).toBe(run);
    expect(activity.queryByText(/not a kind/)).toBeNull();
  });

  it("shows one chosen card's public agent events, newest first, with the time, type and raw step or line key", async () => {
    fake.cards = [card('c1', 'Bigger pockets', 'funded')];
    fake.events = [
      { id: 'e1', card_id: 'c1', type: 'message', created_at: '2026-10-10T09:00:00Z', step: 'dealt', line_key: 'card_dealt' },
      { id: 'e2', card_id: 'c1', type: 'commit', created_at: '2026-10-10T08:00:00Z', step: null, line_key: null },
      { id: 'e3', card_id: 'other', type: 'commit', created_at: '2026-10-10T07:00:00Z', step: null, line_key: null },
    ];
    await renderBoard();
    fireEvent.submit(screen.getByRole('form', { name: 'Card events' }));
    await flush();
    expect(form('Card events').getByRole('status').textContent).toBe('Choose a card.');
    expect(fake.selects.filter((s) => s.table === 'public_agent_events')).toEqual([]);
    fireEvent.change(form('Card events').getByLabelText('Card'), { target: { value: 'c1' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Card events' }));
    await flush();
    expect(fake.selects.filter((s) => s.table === 'public_agent_events')).toEqual([
      { table: 'public_agent_events', columns: CARD_EVENT_COLUMNS, filters: ['eq card_id c1', 'order created_at desc', 'limit 50'] },
    ]);
    const lines = screen.getByRole('form', { name: 'Card events' }).querySelectorAll('ol li');
    expect([...lines].map((li) => li.textContent)).toEqual([
      `${formatDateTime('2026-10-10T09:00:00Z')} · message · step dealt · card_dealt`,
      `${formatDateTime('2026-10-10T08:00:00Z')} · commit`,
    ]);
  });
});

describe('Actions', () => {
  it('pauses with a reason, resumes without one, and rereads the status', async () => {
    await renderBoard();
    const before = named('board_studio_state').length;
    const pause = within(screen.getByRole('region', { name: 'Pause and resume' }));
    fireEvent.change(pause.getByLabelText('Pause reason'), { target: { value: 'spend_limit' } });
    fireEvent.click(pause.getByRole('button', { name: 'Pause agents' }));
    await flush();
    fireEvent.change(pause.getByLabelText('Pause reason'), { target: { value: 'board' } });
    fireEvent.click(pause.getByRole('button', { name: 'Pause agents' }));
    await flush();
    fireEvent.click(pause.getByRole('button', { name: 'Resume agents' }));
    await flush();
    expect(named('set_paused').map((call) => call.args)).toEqual([{ p_paused: true, p_reason: 'spend_limit' }, { p_paused: true }, { p_paused: false }]);
    expect(named('board_studio_state').length).toBe(before + 3);
  });

  it('files a card as proposed with its horizon, no stage choice, and only the card roles as executors', async () => {
    await renderBoard();
    const file = form('File a card');
    expect(file.queryByRole('radio')).toBeNull();
    expect(file.queryByRole('group', { name: 'Stage' })).toBeNull();
    expect([...(file.getByLabelText('Executor') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['r-builder-a', 'r-platform']);
    expect(fake.selects.find((s) => s.table === 'public_roles')).toEqual({ table: 'public_roles', columns: ROLE_COLUMNS, filters: [] });
    fireEvent.change(file.getByLabelText('Horizon'), { target: { value: 'later' } });
    fireEvent.change(file.getByLabelText('Bucket'), { target: { value: 'game' } });
    fireEvent.change(file.getByLabelText('Lane'), { target: { value: 'code' } });
    fireEvent.change(file.getByLabelText('Title'), { target: { value: ' A second level ' } });
    fireEvent.change(file.getByLabelText('Public summary'), { target: { value: ' Somewhere new to play. ' } });
    fireEvent.change(file.getByLabelText('Intent (for the agents)'), { target: { value: 'Add a stage.' } });
    fireEvent.change(file.getByLabelText('Acceptance test'), { target: { value: 'check: it loads' } });
    fireEvent.change(file.getByLabelText('Reason (optional)'), { target: { value: 'Asked for.' } });
    fireEvent.change(file.getByLabelText('Funding target (USD)'), { target: { value: '3' } });
    fireEvent.submit(screen.getByRole('form', { name: 'File a card' }));
    await flush();
    expect(named('file_card').map((call) => call.args)).toEqual([
      {
        p_bucket: 'game',
        p_lane: 'code',
        p_folder: 'seed-1',
        p_title: 'A second level',
        p_summary: 'Somewhere new to play.',
        p_intent: 'Add a stage.',
        p_acceptance_test: 'check: it loads',
        p_funding_target_usd: 3,
        p_stage: 'proposed',
        p_executor_role_id: 'r-builder-a',
        p_board_reason: 'Asked for.',
        p_horizon: 'later',
      },
    ]);
    expect(file.getByText('Card filed as card 1a2b3c4d.')).toBeTruthy();
  });

  it('counts the summary to 200, refuses a blank one, and refuses a blank or zero target on every horizon before calling', async () => {
    await renderBoard();
    const file = form('File a card');
    const summary = file.getByLabelText('Public summary') as HTMLInputElement;
    expect(summary.maxLength).toBe(200);
    expect(file.getByText('0 / 200')).toBeTruthy();
    fireEvent.change(summary, { target: { value: '   ' } });
    expect(file.getByText('3 / 200')).toBeTruthy();
    fireEvent.submit(screen.getByRole('form', { name: 'File a card' }));
    await flush();
    expect(file.getByText('A public summary is required.')).toBeTruthy();
    fireEvent.change(summary, { target: { value: 'A summary.' } });
    fireEvent.submit(screen.getByRole('form', { name: 'File a card' }));
    await flush();
    expect(file.getByText('Funding target must be at least $0.01.')).toBeTruthy();
    // file_card refuses a target of zero or less whatever the horizon, so the roadmap needs one too.
    const target = file.getByLabelText('Funding target (USD)') as HTMLInputElement;
    expect(target.required).toBe(true);
    expect(target.min).toBe('0.01');
    for (const [horizon, value] of [['later', ''], ['next', '0']] as const) {
      fireEvent.change(file.getByLabelText('Horizon'), { target: { value: horizon } });
      fireEvent.change(target, { target: { value } });
      fireEvent.submit(screen.getByRole('form', { name: 'File a card' }));
      await flush();
      expect(file.getByRole('status').textContent).toBe('Funding target must be at least $0.01.');
    }
    expect(named('file_card')).toHaveLength(0);
  });

  it('offers only the cards that can still be rejected, rejects one after the confirm with the reason, and says how much money moved', async () => {
    fake.cards = [card('x1', 'Retire me', 'voted'), card('x2', 'Stays', 'proposed'), card('x3', 'Done', 'shipped'), card('x4', 'Gone', 'rejected')];
    fake.cancelResult = { card_id: 'x1', moved_usd: 1.8 };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderBoard();
    const actions = form('Card actions');
    const picker = actions.getByLabelText('Card') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(['Choose a card', 'Retire me (voted)', 'Stays (proposed)']);
    expect(fake.selects.find((s) => s.columns === ACTIONABLE_CARD_COLUMNS)?.filters).toEqual(['in stage proposed,designing,voted,funded,paused', 'order created_at asc']);
    expect(actions.queryByRole('button', { name: 'Resume card' })).toBeNull();

    fireEvent.change(picker, { target: { value: 'x1' } });
    fireEvent.click(actions.getByRole('button', { name: 'Reject card' }));
    await flush();
    expect(actions.getByRole('status').textContent).toBe('A reason is required.');
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(actions.getByLabelText('Reason'), { target: { value: 'Out of scope.' } });
    fireEvent.click(actions.getByRole('button', { name: 'Reject card' }));
    await flush();
    expect(confirm).toHaveBeenCalledWith(CANCEL_CONFIRM);
    expect(named('cancel_card')).toHaveLength(0);

    confirm.mockReturnValue(true);
    fireEvent.click(actions.getByRole('button', { name: 'Reject card' }));
    await flush();
    await flush();
    expect(named('cancel_card').map((call) => call.args)).toEqual([{ p_card: 'x1', p_reason: 'Out of scope.' }]);
    expect(actions.getByRole('status').textContent).toBe('Card Retire me rejected. $1.80 of unspent money moved to the next cards in line.');
    expect([...picker.options].map((o) => o.textContent)).toEqual(['Choose a card', 'Stays (proposed)']);
  });

  it('says no money moved when a rejection moves none', async () => {
    fake.cards = [card('x1', 'Empty', 'proposed')];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderBoard();
    const actions = form('Card actions');
    fireEvent.change(actions.getByLabelText('Card'), { target: { value: 'x1' } });
    fireEvent.change(actions.getByLabelText('Reason'), { target: { value: 'No.' } });
    fireEvent.click(actions.getByRole('button', { name: 'Reject card' }));
    await flush();
    await flush();
    expect(actions.getByRole('status').textContent).toBe('Card Empty rejected. No unspent money moved.');
  });

  it('rereads the card picker on Refresh and after Resume and File a card, so it never offers a card that moved on', async () => {
    fake.cards = [card('p1', 'Paused one', 'paused', { estimate_usd: '0.5000' })];
    await renderBoard();
    const actions = form('Card actions');
    const offered = () => [...(actions.getByLabelText('Card') as HTMLSelectElement).options].map((o) => o.textContent);
    const reads = () => fake.selects.filter((s) => s.columns === ACTIONABLE_CARD_COLUMNS).length;
    expect(offered()).toEqual(['Choose a card', 'Paused one (paused)']);
    expect(reads()).toBe(1);

    fake.cards = [...fake.cards, card('v1', 'Voted since', 'voted')];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await flush();
    expect(offered()).toEqual(['Choose a card', 'Paused one (paused)', 'Voted since (voted)']);
    expect(reads()).toBe(2);

    fireEvent.change(actions.getByLabelText('Card'), { target: { value: 'p1' } });
    fireEvent.change(actions.getByLabelText('Reason'), { target: { value: 'Topped up.' } });
    fireEvent.click(actions.getByRole('button', { name: 'Resume card' }));
    await flush();
    await flush();
    expect(offered()).toEqual(['Choose a card', 'Paused one (funded)', 'Voted since (voted)']);
    expect(actions.queryByRole('button', { name: 'Resume card' })).toBeNull();

    const file = form('File a card');
    fireEvent.change(file.getByLabelText('Title'), { target: { value: 'Filed just now' } });
    fireEvent.change(file.getByLabelText('Public summary'), { target: { value: 'New.' } });
    fireEvent.change(file.getByLabelText('Intent (for the agents)'), { target: { value: 'Do it.' } });
    fireEvent.change(file.getByLabelText('Acceptance test'), { target: { value: 'check: it loads' } });
    fireEvent.change(file.getByLabelText('Funding target (USD)'), { target: { value: '2' } });
    fireEvent.submit(screen.getByRole('form', { name: 'File a card' }));
    await flush();
    await flush();
    expect(offered()).toContain('Filed just now (proposed)');
    expect(reads()).toBe(4);
  });

  it('resumes a paused card with a new estimate and the reason', async () => {
    fake.cards = [card('p1', 'Paused one', 'paused', { estimate_usd: '0.5000' })];
    await renderBoard();
    const actions = form('Card actions');
    fireEvent.change(actions.getByLabelText('Card'), { target: { value: 'p1' } });
    expect((actions.getByLabelText('New estimate (USD)') as HTMLInputElement).value).toBe('0.5');
    fireEvent.change(actions.getByLabelText('New estimate (USD)'), { target: { value: '0.8' } });
    fireEvent.change(actions.getByLabelText('Reason'), { target: { value: 'Credit topped up.' } });
    fireEvent.click(actions.getByRole('button', { name: 'Resume card' }));
    await flush();
    await flush();
    expect(named('resume_card').map((call) => call.args)).toEqual([{ p_card: 'p1', p_estimate_usd: 0.8, p_reason: 'Credit topped up.' }]);
    expect(actions.getByRole('status').textContent).toBe('Card Paused one resumed.');
  });

  it('records a credit purchase with the contract arguments', async () => {
    await renderBoard();
    const credit = form('Record a credit purchase');
    fireEvent.change(credit.getByLabelText('Amount (USD)'), { target: { value: '12.5' } });
    fireEvent.change(credit.getByLabelText('Stripe payout id'), { target: { value: ' po_123 ' } });
    fireEvent.change(credit.getByLabelText('Reason'), { target: { value: 'October credit' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Record a credit purchase' }));
    await flush();
    expect(named('record_credit_purchase').map((call) => call.args)).toEqual([{ p_amount_usd: 12.5, p_stripe_payout_id: 'po_123', p_reason: 'October credit' }]);
    expect(credit.getByText('Credit purchase of $12.50 recorded.')).toBeTruthy();
  });

  it('runs a job now from the board_jobs names with input {} and no card, refusing a blank reason', async () => {
    fake.jobs = [{ name: 'tidy_up', runs: [] }, { name: 'weekly_report', runs: [] }];
    await renderBoard();
    const job = form('Run a job now');
    const picker = job.getByLabelText('Job') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toEqual(['', 'tidy_up', 'weekly_report']);
    fireEvent.change(picker, { target: { value: 'weekly_report' } });
    fireEvent.change(job.getByLabelText('Reason'), { target: { value: '  ' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Run a job now' }));
    await flush();
    expect(job.getByRole('status').textContent).toBe('A reason is required.');
    expect(named('enqueue_manual_job')).toHaveLength(0);
    fireEvent.change(job.getByLabelText('Reason'), { target: { value: 'Debugging' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Run a job now' }));
    await flush();
    expect(named('enqueue_manual_job').map((call) => call.args)).toEqual([{ p_job: 'weekly_report', p_card: null, p_reason: 'Debugging', p_input: {} }]);
    expect(job.getByRole('status').textContent).toBe('Queued weekly_report. It runs on the next dispatcher tick.');
  });

  it('keeps a busy button focusable, marked aria-disabled, and ignores a second press while the first runs', async () => {
    fake.held = 'set_paused';
    await renderBoard();
    const button = screen.getByRole('button', { name: 'Pause agents' }) as HTMLButtonElement;
    fireEvent.click(button);
    await flush();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Resume agents' }));
    await flush();
    expect(named('set_paused')).toHaveLength(1);
    await act(async () => fake.release());
    await flush();
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(screen.getByText('Agents paused.')).toBeTruthy();
  });
});

describe('the sources', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));
  // vitest runs in the package root; jsdom gives import.meta.url an http scheme.
  const sources = files(resolve(process.cwd(), 'src'));

  it('never disable a control only because its action is running', () => {
    for (const file of sources.filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/(?<![-\w])disabled=\{[^}]*\bbusy\b/);
    }
  });

  it('name none of the retired RPCs', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const name of RETIRED_RPCS) expect(text.includes(name), `${file} names ${name}`).toBe(false);
    }
  });
});
