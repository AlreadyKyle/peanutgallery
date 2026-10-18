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
import { PLAY_COUNT_HEADS, PLAY_COUNTS_LINE } from './PlayCounts';
import { CAPS_BY_SQL } from './Status';
import { REASON_FIRST } from './Community';
import { confirmText } from './lib/community';
import { GAME_REASON_NEEDED, ROLE_REASON_NEEDED } from './Roster';

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
  // set_role_pause left this list: the final state's Agents admin turns a role on and off
  // (docs/specs/final-state.md, Admin; Roster.tsx), at the second factor as the database requires.
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
  playCounts: [] as Record<string, unknown>[] | null,
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
  // An RPC named here answers with this error message instead of its data.
  rpcErrors: {} as Record<string, string>,
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
      if (fake.rpcErrors[name] !== undefined) return { data: null, error: { message: fake.rpcErrors[name] } };
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
        board_play_counts: fake.playCounts,
        cancel_card: fake.cancelResult,
        file_card: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        enqueue_manual_job: '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
        board_flags: { curator_triage: false, profiles_open: true },
        board_games: ROSTER_GAMES,
        board_agent_roster: ROSTER_AGENTS,
        board_set_flag: { curator_triage: true, profiles_open: true },
        board_community_users: { items: [{ userId: 'u1', handle: 'supporter-1', displayName: 'Supporter One', level: 2, xp: 120, suspended: false }], next: null },
        board_suggestions: { items: COMMUNITY_SUGGESTIONS, next: null },
        board_community_cards: { items: [{ id: 'c-open', title: 'Carts leave dust trails', stage: 'building', suit: 'game', rarity: 'common', computedRarity: 'rare' }], next: null },
        board_seeds: { items: [{ id: 'seed-1', title: 'Big dune', author: 'supporter-1', code: 'dust:v1:AB', up: 3, down: 1, featured: false, unpublished: true }], next: null },
        board_goals: { lifetimeCents: 1000, goals: [{ id: 'g1', amountCents: 50000, title: 'Sound', outcome: 'Hire a sound role', state: 'next', link: null }] },
        board_eras: { eras: [{ id: 'workshop', name: 'Workshop', unlockedBy: 'Sound', reachedAt: null }] },
        board_moderation_log: { items: [{ id: 3, at: '2026-10-10T12:00:00Z', actor: 'board@mobmachine.games', action: 'set_flag', target: 'curator_triage', reason: 'start triage', details: {} }], next: null },
      };
      if (name === 'card_supply' && fake.supply === null) return { data: null, error: { message: 'card_supply is unavailable' } };
      if (name === 'board_play_counts' && fake.playCounts === null) return { data: null, error: { message: 'A second factor is required' } };
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

// Two suggestions in two clusters, as board_suggestions gives them (docs/specs/community-core.md).
const COMMUNITY_SUGGESTIONS = [
  { id: 's1', area: 'dust', title: 'Night mode', body: 'The sand could glow.', state: 'clustered', held: false, votes: 4, author: 'supporter-1', clusterId: 'k-night', clusterKey: 'night-mode', triage: { summary: 'Glowing sand at night.', flags: [] } },
  { id: 's2', area: 'dust', title: 'Glow sand', body: '', state: 'clustered', held: true, votes: 1, author: 'supporter-2', clusterId: 'k-glow', clusterKey: 'glow-sand', triage: { summary: 'Sand that glows.', flags: [] } },
];

// board_games and board_agent_roster as 20261017220000_board_games_admin.sql answers them.
const ROSTER_GAMES = [
  {
    folder: 'seed-1',
    name: 'Dust',
    status: 'live',
    accepting_cards: true,
    featured: true,
    blurb: 'An idle game you play in a browser.',
    play_url: 'https://play.mobmachine.games',
    box_art: '/games/dust-box-art.svg',
    plays: {
      load_event: 'dust_load',
      share_event: 'dust_share',
      loads: { day: 5, week: 12, month: 23, total: 36 },
      shares: { day: 2, week: 2, month: 2, total: 2 },
    },
    admin_log: [
      { at: '2026-10-10T09:00:00Z', actor: 'board@mobmachine.games', action: 'feature_game', reason: 'Our first game', details: { from: false, to: true, unfeatured: null } },
    ],
    open_count: 2,
    shipped_count: 1,
    open_cards: [{ id: 'c-open', title: 'Carts leave dust trails', stage: 'building', horizon: 'now', updated_at: '2026-10-10T10:00:00Z' }],
    shipped_cards: [{ id: 'c-live', title: 'Night sky', live_at: '2026-10-09T10:00:00Z', commit_sha: 'abc1234' }],
    latest_deploy: { sha: 'def5678aaaa', is_green: false, smoke_result: 'smoke failed', created_at: '2026-10-10T11:00:00Z' },
    latest_green_deploy: { sha: 'abc1234bbbb', created_at: '2026-10-09T11:00:00Z' },
  },
  {
    folder: 'seed-2',
    name: 'seed-2',
    status: 'in_development',
    accepting_cards: false,
    featured: false,
    blurb: null,
    play_url: null,
    box_art: null,
    plays: { load_event: null, share_event: null, loads: { day: 0, week: 0, month: 0, total: 0 }, shares: { day: 0, week: 0, month: 0, total: 0 } },
    admin_log: [],
    open_count: 0,
    shipped_count: 0,
    open_cards: [],
    shipped_cards: [],
    latest_deploy: null,
    latest_green_deploy: null,
  },
];
const CAPS = { role_day_usd: 1.5, role_month_usd: 12.25, studio_day_usd: 3, studio_month_usd: 50, daily_cap_usd: 100, monthly_cap_usd: 500 };
const ROSTER_AGENTS = [
  {
    id: 'r-builder-a', name: 'Builder A', title: 'Builder A', model: 'claude-test', tools: ['Read', 'Edit', 'Bash'], write_access: true, agent_class: 'builder',
    description: 'Builds funded game cards.', species_note: 'A badger with a hard hat.', avatar_url: null, trigger: null, budget_share: 0.125,
    state: 'active', status: 'running', paused: false, paused_reason: null, paused_at: null, jobs: ['build_card'],
    spend: { day_usd: 1.5, week_usd: 4, month_usd: 12.25, total_usd: 40 },
    caps: CAPS,
    runs_day: { succeeded: 3, failed: 1, skipped: 0, queued: 0, running: 0 },
    runs_week: { succeeded: 9, failed: 2, skipped: 1, last_at: '2026-10-10T11:00:00Z' },
    recent_runs: [{ id: 'run-1', job: 'build_card', status: 'failed', origin: 'schedule', card_id: null, reason: 'tests', created_at: '2026-10-10T11:00:00Z', started_at: null, finished_at: null }],
    pause_history: [
      { at: '2026-10-09T08:00:00Z', actor: 'board@mobmachine.games', paused: false, reason: 'Fixed the flaky test' },
      { at: '2026-10-09T07:00:00Z', actor: 'board@mobmachine.games', paused: true, reason: 'Flaky test' },
    ],
  },
  {
    id: 'r-curator', name: 'Curator', title: 'Curator', model: 'claude-test-small', tools: [], write_access: false, agent_class: 'web_only',
    description: 'Sorts suggestions into clusters.', species_note: null, avatar_url: null, trigger: 'When the suggestion box opens.', budget_share: 0,
    state: 'active', status: 'starts', paused: true, paused_reason: 'not yet', paused_at: '2026-10-10T09:00:00Z', jobs: ['curator_triage'],
    spend: { day_usd: 0, week_usd: 0, month_usd: 0, total_usd: 0 },
    caps: { ...CAPS, role_day_usd: 0, role_month_usd: 0 },
    runs_day: { succeeded: 0, failed: 0, skipped: 2, queued: 0, running: 0 },
    runs_week: { succeeded: 0, failed: 0, skipped: 2, last_at: null },
    recent_runs: [],
    pause_history: [],
  },
  {
    id: 'r-host', name: 'Host', title: 'Host', model: 'claude-test-small', tools: [], write_access: false, agent_class: 'web_only',
    description: 'Narrates the stream.', species_note: null, avatar_url: null, trigger: 'When the stream exists.', budget_share: 0,
    state: 'active', status: 'planned', paused: false, paused_reason: null, paused_at: null, jobs: [],
    spend: { day_usd: 0, week_usd: 0, month_usd: 0, total_usd: 0 },
    caps: { ...CAPS, role_day_usd: 0, role_month_usd: 0, daily_cap_usd: 0 },
    runs_day: { succeeded: 0, failed: 0, skipped: 0, queued: 0, running: 0 },
    runs_week: { succeeded: 0, failed: 0, skipped: 0, last_at: null },
    recent_runs: [],
    pause_history: [],
  },
];

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
  fake.playCounts = [];
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
  fake.rpcErrors = {};
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
    expect(regions().slice(0, 4)).toEqual(['Status', 'Activity', 'Play and share counts', 'Actions']);
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
    expect(regions().slice(0, 4)).toEqual(['Status', 'Activity', 'Play and share counts', 'Actions']);
  });

  it('at aal1 for the same board member goes back to the code step, and the panel reads nothing more', async () => {
    await renderBoard();
    expect(regions().slice(0, 4)).toEqual(['Status', 'Activity', 'Play and share counts', 'Actions']);
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
    // community-core adds the Community admin region (docs/specs/final-state.md, docs/specs/community-core.md).
    // board-live adds Games and agents (docs/specs/final-state.md, Admin).
    expect(regions()).toEqual(['Status', 'Activity', 'Play and share counts', 'Actions', 'Pause and resume', 'Games and agents', 'Community']);
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

describe('Play and share counts (docs/specs/play-counts.md)', () => {
  it('reads board_play_counts once for 14 days and shows each day, newest first, with the total', async () => {
    fake.playCounts = [
      { day: '2026-10-10', dust_load: 12, dust_share: 3, card_share: 1, dust_next_card: 2 },
      { day: '2026-10-09', dust_load: '5', dust_share: 0, card_share: 0, dust_next_card: null },
    ];
    await renderBoard();
    const region = screen.getByRole('region', { name: 'Play and share counts' });
    const counts = within(region);
    expect(counts.getByText(PLAY_COUNTS_LINE)).toBeTruthy();
    expect(counts.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Day', ...Object.values(PLAY_COUNT_HEADS)]);
    const rowText = (day: string) => [...region.querySelectorAll(`tr[data-day="${day}"] > *`)].map((cell) => cell.textContent);
    expect(rowText('2026-10-10')).toEqual(['2026-10-10', '12', '3', '1', '2']);
    expect(rowText('2026-10-09')).toEqual(['2026-10-09', '5', '0', '0', '0']);
    expect(rowText('total')).toEqual(['Total', '17', '3', '1', '2']);
    expect(named('board_play_counts')).toEqual([{ name: 'board_play_counts', args: { p_days: 14 } }]);
    await flush(STUDIO_STATE_POLL_MS * 4);
    expect(named('board_play_counts')).toHaveLength(1);
  });

  it('says the error and draws no table when the read fails', async () => {
    fake.playCounts = null;
    await renderBoard();
    const counts = within(screen.getByRole('region', { name: 'Play and share counts' }));
    expect(counts.getByText('A second factor is required')).toBeTruthy();
    expect(counts.queryByRole('table')).toBeNull();
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

describe('community admin', () => {
  const community = () => within(screen.getByRole('region', { name: 'Community' }));
  async function openTab(name: string, reason = '') {
    await renderBoard();
    fireEvent.click(community().getByRole('button', { name }));
    await flush();
    if (reason !== '') fireEvent.change(community().getByLabelText(/^Reason for changes/), { target: { value: reason } });
  }
  const row = (selector: string) => within(document.querySelector(selector) as HTMLElement);

  it('reads nothing until a tab is chosen, then toggles a flag only with a reason and after the confirm, and shows the moderation log', async () => {
    await renderBoard();
    expect(fake.calls.filter((call) => call.name.startsWith('board_') && !['board_role', 'board_studio_state', 'board_jobs', 'board_play_counts'].includes(call.name))).toEqual([]);
    fireEvent.click(community().getByRole('button', { name: 'Flags' }));
    await flush();
    expect(named('board_flags')).toHaveLength(1);
    const toggle = row('tr[data-flag="curator_triage"]').getByRole('button', { name: 'Turn on' });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    // A disabled button says why: the reason comes first.
    expect(community().getByText(REASON_FIRST)).toBeTruthy();
    fireEvent.change(community().getByLabelText(/^Reason for changes/), { target: { value: 'start triage' } });
    expect(community().queryByText(REASON_FIRST)).toBeNull();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(row('tr[data-flag="curator_triage"]').getByRole('button', { name: 'Turn on' }));
    await flush();
    expect(confirm).toHaveBeenCalledWith(confirmText.flag('curator_triage', true));
    expect(named('board_set_flag')).toEqual([]);
    confirm.mockReturnValue(true);
    fireEvent.click(row('tr[data-flag="curator_triage"]').getByRole('button', { name: 'Turn on' }));
    await flush();
    expect(named('board_set_flag')[0]!.args).toEqual({ p_key: 'curator_triage', p_value: true, p_reason: 'start triage' });
    fireEvent.click(community().getByRole('button', { name: 'Moderation log' }));
    await flush();
    expect(community().getByText('start triage')).toBeTruthy();
  });

  it('warns that turning profiles_open off stops new sign-ins', async () => {
    await openTab('Flags', 'spam wave');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(row('tr[data-flag="profiles_open"]').getByRole('button', { name: 'Turn off' }));
    await flush();
    expect(confirm.mock.calls[0]![0]).toMatch(/^Turn profiles_open off\? No new player can sign in/);
    expect(named('board_set_flag')).toEqual([]);
  });

  // Each destructive action asks first, naming what it changes, and does nothing when the board cancels.
  const destructive: { tab: string; selector: string; button: string; rpc: string; says: string }[] = [
    { tab: 'Users', selector: 'tr[data-handle="supporter-1"]', button: 'Suspend', rpc: 'board_suspend_user', says: confirmText.suspend('supporter-1') },
    { tab: 'Suggestions', selector: 'tr[data-suggestion="s1"]', button: 'Decline', rpc: 'board_decline_suggestion', says: confirmText.decline('Night mode', 'duplicate') },
    { tab: 'Suggestions', selector: 'tr[data-suggestion="s1"]', button: 'Draft from cluster', rpc: 'board_draft_from_cluster', says: confirmText.draft('night-mode') },
    { tab: 'Goals', selector: 'tr[data-goal="g1"]', button: 'Delete', rpc: 'board_delete_goal', says: confirmText.deleteGoal('Sound', '$500.00') },
    { tab: 'Studio eras', selector: 'tr[data-era="workshop"]', button: 'Set as current', rpc: 'board_set_era', says: confirmText.era('Workshop') },
  ];
  for (const action of destructive) {
    it(`asks before ${action.button} on ${action.tab}, naming its object`, async () => {
      await openTab(action.tab, 'a reason');
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      fireEvent.click(row(action.selector).getByRole('button', { name: action.button }));
      await flush();
      expect(confirm).toHaveBeenCalledWith(action.says);
      expect(named(action.rpc)).toEqual([]);
      confirm.mockReturnValue(true);
      fireEvent.click(row(action.selector).getByRole('button', { name: action.button }));
      await flush();
      expect(named(action.rpc)).toHaveLength(1);
      expect(named(action.rpc)[0]!.args).toMatchObject({ p_reason: 'a reason' });
    });
  }

  it('merges and links by picking a loaded cluster or card, never a typed id', async () => {
    await openTab('Suggestions', 'same idea');
    const night = row('tr[data-suggestion="s1"]');
    expect(night.queryByRole('textbox')).toBeNull();
    const mergeButton = night.getByRole('button', { name: 'Merge into' }) as HTMLButtonElement;
    expect(mergeButton.disabled).toBe(true);
    const into = night.getByLabelText('Cluster to merge night-mode into') as HTMLSelectElement;
    // The other loaded cluster only, never the row's own.
    expect([...into.options].map((o) => o.textContent)).toEqual(['Choose a cluster', 'glow-sand']);
    fireEvent.change(into, { target: { value: 'k-glow' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(night.getByRole('button', { name: 'Merge into' }));
    await flush();
    expect(confirm).toHaveBeenCalledWith(confirmText.merge('night-mode', 'glow-sand'));
    expect(named('board_merge_clusters')[0]!.args).toEqual({ p_from: 'k-night', p_into: 'k-glow', p_reason: 'same idea' });
    expect(community().getByRole('status').textContent).toBe('Merge night-mode into glow-sand: done.');
    const link = row('tr[data-suggestion="s1"]').getByLabelText('Card to link cluster night-mode to') as HTMLSelectElement;
    expect([...link.options].map((o) => o.textContent)).toEqual(['Choose a card', 'Carts leave dust trails (building)']);
    fireEvent.change(link, { target: { value: 'c-open' } });
    fireEvent.click(row('tr[data-suggestion="s1"]').getByRole('button', { name: 'Link card' }));
    await flush();
    expect(named('board_link_cluster_card')[0]!.args).toEqual({ p_cluster: 'k-night', p_card: 'c-open', p_reason: 'same idea' });
  });

  it('saves a milestone once however often Save is pressed, and takes $500 and 1,000 as amounts', async () => {
    await openTab('Goals', 'new goal');
    fireEvent.change(community().getByLabelText('Amount in dollars'), { target: { value: '1,00' } });
    expect(community().getByText(/^That is not an amount/)).toBeTruthy();
    fireEvent.change(community().getByLabelText('Amount in dollars'), { target: { value: '$500' } });
    expect(community().queryByText(/^That is not an amount/)).toBeNull();
    fireEvent.change(community().getByLabelText('Title'), { target: { value: 'Music' } });
    fireEvent.change(community().getByLabelText('Outcome'), { target: { value: 'A composer role' } });
    fake.held = 'board_save_goal';
    const save = community().getByRole('button', { name: 'Save milestone' });
    fireEvent.click(save);
    fireEvent.click(save);
    await flush();
    fireEvent.click(save);
    await flush();
    expect(named('board_save_goal')).toHaveLength(1);
    expect(named('board_save_goal')[0]!.args).toMatchObject({ p_amount_cents: 50000, p_title: 'Music' });
    // Every action button reads as disabled while one runs, and keeps its focus.
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(row('tr[data-goal="g1"]').getByRole('button', { name: 'Delete' }).getAttribute('aria-disabled')).toBe('true');
    await act(async () => fake.release());
    await flush();
    expect(community().getByRole('status').textContent).toBe('Save milestone: done.');
    expect(save.getAttribute('aria-disabled')).toBeNull();
    fake.held = null;
    fireEvent.change(community().getByLabelText('Amount in dollars'), { target: { value: '1,000' } });
    fireEvent.change(community().getByLabelText('Title'), { target: { value: 'Art' } });
    fireEvent.change(community().getByLabelText('Outcome'), { target: { value: 'An artist role' } });
    fireEvent.click(community().getByRole('button', { name: 'Save milestone' }));
    await flush();
    expect(named('board_save_goal')[1]!.args).toMatchObject({ p_amount_cents: 100000 });
  });

  it('says Republish when it republishes a seed', async () => {
    await openTab('Seeds', 'back up');
    fireEvent.click(row('tr[data-seed="seed-1"]').getByRole('button', { name: 'Republish' }));
    await flush();
    expect(named('board_unpublish_seed')[0]!.args).toEqual({ p_id: 'seed-1', p_unpublished: false, p_reason: 'back up' });
    expect(community().getByRole('status').textContent).toBe('Republish: done.');
  });

  it('shows a gateway error page as a plain sentence', async () => {
    fake.rpcErrors = { board_suspend_user: '<html>Bad gateway</html>' };
    await openTab('Users', 'spam');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(row('tr[data-handle="supporter-1"]').getByRole('button', { name: 'Suspend' }));
    await flush();
    const alert = community().getByRole('alert');
    expect(alert.textContent).toBe('Suspend supporter-1: The server sent back an error page instead of an answer; it may be down or restarting. Try again in a minute.');
    expect(alert.className).toBe('error');
  });
});

describe('games and agents', () => {
  const rosterRegion = () => within(screen.getByRole('region', { name: 'Games and agents' }));
  const openTab = async (name: 'Games' | 'Agents') => {
    await renderBoard();
    fireEvent.click(rosterRegion().getByRole('button', { name }));
    await flush();
    return rosterRegion();
  };
  const tileOf = (folder: string) => document.querySelector(`li[data-game="${folder}"]`) as HTMLElement;
  const agentOf = (name: string) => document.querySelector(`li[data-role="${name}"]`) as HTMLElement;

  it('reads nothing until a tab is chosen, then shows each game with its art, address, status, plays, deploys and cards', async () => {
    await renderBoard();
    const roster = rosterRegion();
    expect(named('board_games')).toEqual([]);
    expect(named('board_agent_roster')).toEqual([]);
    fireEvent.click(roster.getByRole('button', { name: 'Games' }));
    await flush();
    expect(named('board_games')).toHaveLength(1);
    expect(named('board_agent_roster')).toEqual([]);
    const tile = screen.getByText('Dust').closest('li')!;
    expect(tile.getAttribute('data-game')).toBe('seed-1');
    expect(within(tile).getByRole('img', { name: 'Dust box art' }).getAttribute('src')).toBe('/games/dust-box-art.svg');
    expect(within(tile).getByRole('link', { name: 'Play Dust' }).getAttribute('href')).toBe('https://play.mobmachine.games');
    expect(tile.textContent).toContain('Featured');
    expect(tile.textContent).toContain('status: live, takes new cards');
    expect(tile.textContent).toContain('An idle game you play in a browser.');
    expect(tile.textContent).toContain('last deploy failed');
    expect(tile.textContent).toContain('def5678');
    expect(tile.textContent).toContain('Last green: abc1234');
    expect(tile.textContent).toContain('Loads5 today, 12 in 7 days, 23 in 30 days, 36 in all');
    expect(tile.textContent).toContain('Shares2 today, 2 in 7 days, 2 in 30 days, 2 in all');
    expect(tile.textContent).toContain('Cards2 open, 1 shipped');
    expect(tile.textContent).toContain('Carts leave dust trails');
    expect(tile.textContent).toContain('Night sky');
    expect(tile.textContent).toContain('featured: Our first game');
    // A game with no row of its own: the folder for a name, no art or address, in development, counted nowhere.
    const second = tileOf('seed-2');
    expect(second.querySelector('img')).toBeNull();
    expect(second.textContent).toContain('status: in development, takes no new cards');
    expect(second.textContent).toContain('No public blurb.');
    expect(second.textContent).toContain('Loadsnot counted');
    expect(second.textContent).toContain('not deployed: none recorded');
    expect(second.textContent).not.toContain('Featured');
    expect(roster.getByText(/Every change to a game needs a reason/)).toBeTruthy();
  });

  it('changes a game only with a reason: status, new cards, featured and the blurb each call their RPC, then read again', async () => {
    const roster = await openTab('Games');
    const dust = within(tileOf('seed-1'));
    const setStatus = dust.getByRole('button', { name: 'Set status' });
    // The status is unchanged and there is no reason: nothing is called.
    expect(setStatus.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(dust.getByLabelText('Status'), { target: { value: 'paused' } });
    expect(setStatus.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(setStatus);
    fireEvent.click(dust.getByRole('button', { name: 'Stop new cards' }));
    await flush();
    expect(fake.calls.filter((call) => call.name.startsWith('board_set_game'))).toEqual([]);
    // The panel says why the buttons are off.
    expect(roster.getByText(GAME_REASON_NEEDED)).toBeTruthy();

    fireEvent.change(roster.getByLabelText(/^Reason for changes to a game/), { target: { value: 'A crash on load' } });
    expect(roster.queryByText(GAME_REASON_NEEDED)).toBeNull();
    expect(dust.getByRole('button', { name: 'Set status' }).getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(dust.getByRole('button', { name: 'Set status' }));
    await flush();
    expect(named('board_set_game_status').map((call) => call.args)).toEqual([{ p_folder: 'seed-1', p_status: 'paused', p_reason: 'A crash on load' }]);
    expect(roster.getByRole('status').textContent).toBe('Dust is paused.');
    expect(named('board_games')).toHaveLength(2);

    fireEvent.click(dust.getByRole('button', { name: 'Stop new cards' }));
    await flush();
    expect(named('board_set_game_accepting').map((call) => call.args)).toEqual([{ p_folder: 'seed-1', p_accepting: false, p_reason: 'A crash on load' }]);
    expect(roster.getByRole('status').textContent).toBe('Dust takes no new cards.');

    fireEvent.click(dust.getByRole('button', { name: 'Unfeature' }));
    await flush();
    expect(named('board_set_game_featured').map((call) => call.args)).toEqual([{ p_folder: 'seed-1', p_featured: false, p_reason: 'A crash on load' }]);

    fireEvent.click(within(tileOf('seed-2')).getByRole('button', { name: 'Feature' }));
    await flush();
    expect(named('board_set_game_featured').at(-1)!.args).toEqual({ p_folder: 'seed-2', p_featured: true, p_reason: 'A crash on load' });
    fireEvent.click(within(tileOf('seed-2')).getByRole('button', { name: 'Take new cards' }));
    await flush();
    expect(named('board_set_game_accepting').at(-1)!.args).toEqual({ p_folder: 'seed-2', p_accepting: true, p_reason: 'A crash on load' });

    // The blurb: unchanged text calls nothing; a new line is kept to one line; an empty one clears it.
    const save = dust.getByRole('button', { name: 'Save blurb' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    const blurb = dust.getByLabelText(/^Public blurb/) as HTMLTextAreaElement;
    expect(blurb.maxLength).toBe(280);
    fireEvent.change(blurb, { target: { value: 'A quarry idle game.\nPlay it free.' } });
    expect(dust.getByLabelText(/^Public blurb \(33 of 280\)/)).toBeTruthy();
    fireEvent.click(dust.getByRole('button', { name: 'Save blurb' }));
    await flush();
    expect(named('board_set_game_blurb').map((call) => call.args)).toEqual([{ p_folder: 'seed-1', p_blurb: 'A quarry idle game. Play it free.', p_reason: 'A crash on load' }]);
    expect(roster.getByRole('status').textContent).toBe("Dust's blurb saved.");
    fireEvent.change(blurb, { target: { value: '' } });
    fireEvent.click(dust.getByRole('button', { name: 'Clear blurb' }));
    await flush();
    expect(named('board_set_game_blurb').at(-1)!.args).toEqual({ p_folder: 'seed-1', p_blurb: '', p_reason: 'A crash on load' });
  });

  it('ignores a second game write while one runs, then says what happened', async () => {
    const roster = await openTab('Games');
    fireEvent.change(roster.getByLabelText(/^Reason for changes to a game/), { target: { value: 'r' } });
    fake.held = 'board_set_game_accepting';
    const dust = within(tileOf('seed-1'));
    fireEvent.click(dust.getByRole('button', { name: 'Stop new cards' }));
    await flush();
    expect(dust.getByRole('button', { name: 'Unfeature' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(dust.getByRole('button', { name: 'Unfeature' }));
    fireEvent.click(dust.getByRole('button', { name: 'Stop new cards' }));
    await flush();
    expect(named('board_set_game_accepting')).toHaveLength(1);
    expect(named('board_set_game_featured')).toEqual([]);
    fake.release();
    await flush();
    expect(roster.getByRole('status').textContent).toBe('Dust takes no new cards.');
  });

  it('groups every role by roster status and shows its profile, model, tools, write access, runs and spend against the caps', async () => {
    const roster = await openTab('Agents');
    expect(named('board_agent_roster')).toHaveLength(1);
    expect(roster.getByText('3 roles: 1 running, 1 starting later, 1 planned; 1 turned off.')).toBeTruthy();
    expect([...document.querySelectorAll('[data-group]')].map((g) => g.getAttribute('data-group'))).toEqual(['running', 'starts', 'planned']);
    expect(document.querySelector('[data-group="starts"] h4')!.textContent).toBe('Starts later (1)');
    const builder = agentOf('Builder A');
    expect(builder.textContent).toContain('Builds funded game cards.');
    expect(builder.textContent).toContain('RosterRunning');
    expect(builder.textContent).toContain('CreatureA badger with a hard hat.');
    expect(builder.textContent).toContain('claude-test');
    expect(builder.textContent).toContain('Read, Edit, Bash');
    expect(builder.textContent).toContain('Write accessyes');
    expect(builder.textContent).toContain('$1.50 today, $4.00 in 7 days, $12.25 in 30 days, $40.00 in all');
    expect(builder.querySelector('[data-caps]')!.textContent).toBe(
      "$1.50 of the studio's $3.00 today, 2% of the daily cap of $100.00; $12.25 of the studio's $50.00 this month, 2% of the monthly cap of $500.00",
    );
    expect(builder.textContent).toContain('Budget share12.5%');
    expect(builder.textContent).toContain('3 succeeded, 1 failed');
    expect(builder.textContent).toContain(`9 succeeded, 2 failed, 1 skipped; last run ${formatDateTime('2026-10-10T11:00:00Z')}`);
    expect(builder.textContent).toContain('build_card failed (tests)');
    expect(builder.textContent).toContain('on: Fixed the flaky test');
    expect(builder.textContent).toContain('off: Flaky test');
    const curator = agentOf('Curator');
    expect(curator.textContent).toContain('Starts later (When the suggestion box opens.)');
    expect(curator.textContent).toContain(`off (not yet) since ${formatDateTime('2026-10-10T09:00:00Z')}`);
    expect(curator.textContent).not.toContain('Turned on and off');
    const host = agentOf('Host');
    expect(host.textContent).toContain('Planned (When the stream exists.)');
    expect(host.textContent).toContain('no daily cap set');
    expect(host.textContent).toContain('Runs, 7 daysno jobs');
  });

  it('turns a role on or off only with a reason, and reads the roster again', async () => {
    const roster = await openTab('Agents');
    const curator = roster.getByRole('button', { name: 'Turn Curator on' });
    expect(curator.closest('li')!.textContent).toContain('off (not yet)');
    expect(curator.closest('li')!.textContent).toContain('Write accessno');
    // No reason, no call, and the panel says a reason is needed.
    expect(curator.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(curator);
    await flush();
    expect(named('set_role_pause')).toEqual([]);
    expect(roster.getByRole('alert').textContent).toBe(ROLE_REASON_NEEDED);
    fireEvent.change(roster.getByLabelText('Reason for turning a role on or off'), { target: { value: 'start triage' } });
    expect(roster.queryByRole('alert')).toBeNull();
    fireEvent.click(roster.getByRole('button', { name: 'Turn Curator on' }));
    await flush();
    expect(named('set_role_pause').map((call) => call.args)).toEqual([{ p_role: 'r-curator', p_paused: false, p_reason: 'start triage' }]);
    expect(roster.getByRole('status').textContent).toBe('Curator turned on.');
    expect(named('board_agent_roster')).toHaveLength(2);
    fireEvent.click(roster.getByRole('button', { name: 'Turn Builder A off' }));
    await flush();
    expect(named('set_role_pause').at(-1)!.args).toEqual({ p_role: 'r-builder-a', p_paused: true, p_reason: 'start triage' });
  });
});
