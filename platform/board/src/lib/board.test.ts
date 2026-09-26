import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  agentWritten,
  boardCardOrder,
  cancelCard,
  canUnveto,
  canVeto,
  cardRoleFolder,
  draftToFloor,
  draftToFloorInput,
  DRAFT_TO_FLOOR_MAX_CARDS,
  enqueueManualJob,
  fetchCardSupply,
  supplyFrom,
  supplyLine,
  supplyShort,
  fetchBoardCards,
  fetchBoardJobs,
  fetchBoardRoles,
  isCardRole,
  JOB_INPUT_MAX_BYTES,
  PAUSE_REASONS,
  parseJobInput,
  setCardVeto,
  setCoolingWindow,
  setPaused,
  setRolePause,
  studioStateFrom,
  undealt,
  type BoardCard,
  type Role,
} from './board';
import { BOARD_AUTH_OPTIONS } from './supabase';

function role(title: string, overrides: Partial<Role> = {}): Role {
  return { id: title, title, write_access: true, state: 'active', ...overrides };
}

const NINE = ['Studio Head', 'Game Director', 'Builder A', 'Builder B', 'Platform Builder', 'QA', 'Host', 'Biz Dev', 'Community'];

describe('which roles build cards', () => {
  it('offers the builders, QA and the Platform Builder as executors', () => {
    const roles = NINE.map((title) => role(title, { write_access: !['Host', 'Biz Dev', 'Community'].includes(title) }));
    expect(roles.filter(isCardRole).map((r) => r.title)).toEqual(['Builder A', 'Builder B', 'Platform Builder', 'QA']);
    expect(cardRoleFolder(role('Platform Builder'))).toBe('platform');
    expect(cardRoleFolder(role('Studio Head'))).toBeNull();
  });

  it('never offers a retired role or one without write access', () => {
    expect(isCardRole(role('Builder A', { state: 'retired' }))).toBe(false);
    expect(isCardRole(role('Builder B', { write_access: false }))).toBe(false);
    expect(isCardRole(role('toString'))).toBe(false);
  });
});

describe('studioStateFrom', () => {
  it('reads the optional caps when board_studio_state returns them, and null when it does not', () => {
    const base = { paused: false, agent_mode: 'attended', daily_cap_usd: '100', card_max_usd: 25 };
    expect(studioStateFrom(base)).toMatchObject({
      agent_hourly_rate_usd: null,
      monthly_cap_usd: null,
      credit_studio_daily_cap_usd: null,
      anthropic_tier_cap_usd: null,
      platform_lane_open: false,
    });
    expect(
      studioStateFrom({
        ...base,
        agent_hourly_rate_usd: '4.0000',
        monthly_cap_usd: 500,
        credit_studio_daily_cap_usd: '500',
        anthropic_tier_cap_usd: '100.0000',
        platform_lane_open: true,
      }),
    ).toMatchObject({
      daily_cap_usd: 100,
      agent_hourly_rate_usd: 4,
      monthly_cap_usd: 500,
      credit_studio_daily_cap_usd: 500,
      anthropic_tier_cap_usd: 100,
      platform_lane_open: true,
    });
  });
});

describe('the board client', () => {
  it('keeps its session: persisted, refreshed and read from the magic link', () => {
    expect(BOARD_AUTH_OPTIONS).toEqual({ persistSession: true, autoRefreshToken: true, detectSessionInUrl: true });
  });
});

describe('boardCardOrder', () => {
  it('orders now, next, later, then by rank with unranked last, then the oldest', () => {
    const card = (id: string, horizon: BoardCard['horizon'], rank: number | null, created_at = '2026-09-15T00:00:00Z'): BoardCard => ({
      id,
      title: id,
      stage: 'proposed',
      horizon,
      rank,
      folder: 'seed-1',
      lane: 'config',
      funding_target_usd: 0,
      funded_usd: 0,
      estimate_usd: 0,
      created_at,
      source: 'board',
      drafter_role_id: null,
      opens_at: null,
      board_vetoed: false,
      board_veto_reason: null,
      approval: 'none',
    });
    const cards = [
      card('later', 'later', 1),
      card('next-unranked', 'next', null),
      card('next-2', 'next', 2),
      card('now-new', 'now', null, '2026-09-16T00:00:00Z'),
      card('now-old', 'now', null, '2026-09-14T00:00:00Z'),
      card('next-1', 'next', 1),
    ];
    expect([...cards].sort(boardCardOrder).map((c) => c.id)).toEqual(['now-old', 'now-new', 'next-1', 'next-2', 'next-unranked', 'later']);
  });
});

// docs/specs/money-logic.md: the pause reason and what a cancellation moved.
describe('pause and cancel', () => {
  function client(data: unknown = null) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const rpc = (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({ data, error: null });
    };
    return { calls, client: { rpc } as unknown as SupabaseClient };
  }

  it('sends p_reason only with a pause that is not the default, and never with a resume', async () => {
    const { calls, client: c } = client();
    await setPaused(c, true);
    await setPaused(c, true, 'board');
    await setPaused(c, true, 'spend_limit');
    await setPaused(c, false, 'incident');
    expect(calls.map((call) => call.args)).toEqual([
      { p_paused: true },
      { p_paused: true },
      { p_paused: true, p_reason: 'spend_limit' },
      { p_paused: false },
    ]);
    expect(PAUSE_REASONS.map((r) => r.value)).toEqual(['board', 'incident', 'awaiting_credit', 'spend_limit']);
  });

  it('returns how much unspent money a cancellation moved, and 0 when it names none', async () => {
    expect(await cancelCard(client({ card_id: 'x', moved_usd: 2.5 }).client, 'x', 'why')).toBe(2.5);
    expect(await cancelCard(client({ card_id: 'x' }).client, 'x', 'why')).toBe(0);
    expect(await cancelCard(client(null).client, 'x', 'why')).toBe(0);
  });
});

// docs/specs/agent-system-core.md: the veto, the cooling window, role pauses and the job queue.
describe('agent system controls', () => {
  function recording(results: Record<string, unknown> = {}) {
    const calls: { name: string; args: Record<string, unknown> | undefined }[] = [];
    const rpc = (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({ data: results[name] ?? null, error: null });
    };
    return { calls, client: { rpc } as unknown as SupabaseClient };
  }

  it('calls set_cooling_window, set_card_veto, set_role_pause and enqueue_manual_job with the contract arguments', async () => {
    const { calls, client: c } = recording({ enqueue_manual_job: 'run-1' });
    await setCoolingWindow(c, 60, 'An hour');
    await setCardVeto(c, 'card-1', true, 'Not now');
    await setRolePause(c, 'role-1', false, 'Back to work');
    expect(await enqueueManualJob(c, { name: 'studio_ranking', card_id: null, reason: 'Rank now', input: { floor: 3 } })).toBe('run-1');
    expect(calls).toEqual([
      { name: 'set_cooling_window', args: { p_minutes: 60, p_reason: 'An hour' } },
      { name: 'set_card_veto', args: { p_card: 'card-1', p_vetoed: true, p_reason: 'Not now' } },
      { name: 'set_role_pause', args: { p_role: 'role-1', p_paused: false, p_reason: 'Back to work' } },
      { name: 'enqueue_manual_job', args: { p_job: 'studio_ranking', p_card: null, p_reason: 'Rank now', p_input: { floor: 3 } } },
    ]);
  });

  it('reads each job with its runs and each role with its class and pause', async () => {
    const { client: c } = recording({
      board_jobs: [{ name: 'tidy_up', role_name: null, calls_model: false, runs_when_paused: true, description: null, runs: [{ id: 'r1', origin: 'board', status: 'skipped', reason: 'role_paused', created_at: '2026-09-24T00:00:00Z', finished_at: null }] }],
      board_roles: [{ id: 'role-1', name: 'QA', agent_class: 'writer', state: 'active', paused: true, paused_reason: 'Checking' }],
    });
    expect(await fetchBoardJobs(c)).toEqual([
      { name: 'tidy_up', role_name: null, calls_model: false, runs_when_paused: true, description: null, runs: [{ id: 'r1', origin: 'board', status: 'skipped', reason: 'role_paused', created_at: '2026-09-24T00:00:00Z', finished_at: null, output: null }] },
    ]);
    expect(await fetchBoardRoles(c)).toEqual([{ id: 'role-1', name: 'QA', agent_class: 'writer', state: 'active', paused: true, paused_reason: 'Checking' }]);
  });

  it('takes blank typed input as {}, and refuses input that is not a JSON object of at most 4 KB', () => {
    expect(parseJobInput('  ')).toEqual({});
    expect(parseJobInput('{"floor": 3}')).toEqual({ floor: 3 });
    expect(() => parseJobInput('[1]')).toThrow('The input must be a JSON object.');
    expect(() => parseJobInput('{nope')).toThrow('The input must be JSON.');
    expect(() => parseJobInput(JSON.stringify({ x: 'y'.repeat(JOB_INPUT_MAX_BYTES) }))).toThrow('at most 4 KB');
  });

  it('marks an approved agent card on next with an opens_at as undealt, and offers the veto only on an open card with no money', () => {
    const base = { stage: 'proposed', horizon: 'next' as const, opens_at: '2026-09-24T01:00:00Z', approval: 'current' as const, board_vetoed: false, funded_usd: 0 };
    expect(undealt(base)).toBe(true);
    expect(undealt({ ...base, horizon: 'now' })).toBe(false);
    expect(undealt({ ...base, approval: 'missing' })).toBe(false);
    expect(agentWritten({ source: 'agent', drafter_role_id: null })).toBe(true);
    expect(agentWritten({ source: 'board', drafter_role_id: 'role-1' })).toBe(true);
    expect(agentWritten({ source: 'board', drafter_role_id: null })).toBe(false);
    expect(canVeto(base)).toBe(true);
    expect(canVeto({ ...base, funded_usd: 1 })).toBe(false);
    expect(canVeto({ ...base, stage: 'funded' })).toBe(false);
    expect(canVeto({ ...base, board_vetoed: true })).toBe(false);
    expect(canUnveto({ ...base, board_vetoed: true })).toBe(true);
    expect(canUnveto(base)).toBe(false);
  });

  it('reads the cooling window from board_studio_state, and 0 before the column exists', () => {
    const state = { paused: false, daily_cap_usd: 1, card_max_usd: 1 };
    expect(studioStateFrom({ ...state, cooling_window_minutes: 90 }).cooling_window_minutes).toBe(90);
    expect(studioStateFrom(state).cooling_window_minutes).toBe(0);
  });

  it('asks card_is_public only about agent-written cards, and marks one without a current approval as missing', async () => {
    const rows = [
      { id: 'board', title: 'Board', stage: 'proposed', horizon: 'now', rank: null, folder: 'seed-1', lane: 'config', funding_target_usd: 1, funded_usd: 0, estimate_usd: 1, created_at: '2026-09-01T00:00:00Z', source: 'board', drafter_role_id: null, opens_at: null, board_vetoed: false, board_veto_reason: null },
      { id: 'agent-ok', title: 'Agent ok', stage: 'proposed', horizon: 'next', rank: null, folder: 'seed-1', lane: 'config', funding_target_usd: 1, funded_usd: 0, estimate_usd: 1, created_at: '2026-09-02T00:00:00Z', source: 'agent', drafter_role_id: 'r', opens_at: '2026-09-24T00:00:00Z', board_vetoed: false, board_veto_reason: null },
      { id: 'agent-void', title: 'Agent void', stage: 'proposed', horizon: 'next', rank: null, folder: 'seed-1', lane: 'config', funding_target_usd: 1, funded_usd: 0, estimate_usd: 1, created_at: '2026-09-03T00:00:00Z', source: 'agent', drafter_role_id: 'r', opens_at: null, board_vetoed: false, board_veto_reason: null },
    ];
    const asked: string[] = [];
    const builder = { select: () => builder, in: () => builder, order: () => builder, returns: () => Promise.resolve({ data: rows, error: null }) };
    const c = {
      from: () => builder,
      rpc: (name: string, args: { p_card: string }) => {
        asked.push(`${name}:${args.p_card}`);
        return Promise.resolve({ data: args.p_card === 'agent-ok', error: null });
      },
    } as unknown as SupabaseClient;
    const cards = await fetchBoardCards(c);
    expect(asked.sort()).toEqual(['card_is_public:agent-ok', 'card_is_public:agent-void']);
    expect(cards.map((card) => [card.id, card.approval])).toEqual([['board', 'none'], ['agent-ok', 'current'], ['agent-void', 'missing']]);
  });
});

describe('the role jobs (docs/specs/agent-workflows.md)', () => {
  it('names the two buttons that queue {} and reads each run output for its job', async () => {
    const { JOB_BUTTONS, runOutputFrom } = await import('./board');
    expect(JOB_BUTTONS).toEqual({ studio_ranking: 'Rank now', draft_card: 'Draft a game card' });
    expect(runOutputFrom('studio_ranking', { moves: [{ card_id: 'c1', from: null, to: 1 }], unapplied: 0 })).toEqual({ kind: 'ranking', moves: [{ card_id: 'c1', from: null, to: 1 }], unapplied: 0 });
    expect(runOutputFrom('draft_card', { result: 'withdrawn', reason: 'no_approval_in_three_rounds', rounds: [{ round: 1, draft: null, check: { name: 'schema', detail: 'not one object' }, verdict: null }] })).toEqual({
      kind: 'draft',
      result: 'withdrawn',
      card_id: null,
      reason: 'no_approval_in_three_rounds',
      rounds: [{ round: 1, title: null, summary: null, lane: null, executor: null, estimate_usd: null, check: { name: 'schema', detail: 'not one object' }, verdict: null }],
    });
    expect(runOutputFrom('draft_card', null)).toBeNull();
    expect(runOutputFrom('weekly_report', { anything: 1 })).toBeNull();
  });
});

describe('the card supply (docs/specs/studio-reports.md)', () => {
  const raw = {
    open: 6,
    big: 0,
    small: 6,
    floor_open: 6,
    floor_big: 1,
    floor_small: 1,
    big_min_usd: '5.0000',
    small_max_usd: '2.0000',
    short_open: 0,
    short_big: 1,
    short_small: 0,
    open_cards: Array.from({ length: 6 }, (_, i) => ({ id: `card-${i}`, title: `Card ${i}`, target_usd: '1.0000' })),
  };

  it('reads card_supply, and writes the line the board reads', () => {
    const supply = supplyFrom(raw);
    expect(supplyLine(supply)).toBe('Open cards: 6 of a floor of 6 · $5 or more: 0 of 1 · under $2: 6 of 1');
    expect(supplyShort(supply)).toBe(true);
    expect(supplyShort({ ...supply, short_big: 0 })).toBe(false);
    expect(supplyLine({ ...supply, big_min_usd: 7.5, small_max_usd: 2.25 })).toBe('Open cards: 6 of a floor of 6 · $7.50 or more: 0 of 1 · under $2.25: 6 of 1');
    expect(supply.open_cards[0]).toEqual({ id: 'card-0', title: 'Card 0', target_usd: 1 });
    expect(() => supplyFrom(null)).toThrow('card_supply returned nothing');
    expect(() => supplyFrom({ ...raw, short_big: undefined })).toThrow('card_supply returned no short_big');
  });

  it('queues draft_card through enqueue_manual_job with the shortfalls, the sizes they ask for and the open card ids, under 4 KB', async () => {
    const calls: { name: string; args: Record<string, unknown> | undefined }[] = [];
    const client = {
      rpc: (name: string, args?: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve({ data: name === 'card_supply' ? raw : 'run-9', error: null });
      },
    } as unknown as SupabaseClient;
    const supply = await fetchCardSupply(client);
    expect(await draftToFloor(client, 'Short of a big card', supply)).toBe('run-9');
    expect(calls).toEqual([
      { name: 'card_supply', args: undefined },
      {
        name: 'enqueue_manual_job',
        args: { p_job: 'draft_card', p_card: null, p_reason: 'Short of a big card', p_input: { floor: { short_open: 0, short_big: 1, short_small: 0, big_min_usd: 5, small_max_usd: 2 }, open_cards: raw.open_cards.map((c) => c.id) } },
      },
    ]);
    // The Designer is told what big and small mean from studio_state's own thresholds, not a copy of $5 and $2.
    expect(draftToFloorInput({ ...supply, big_min_usd: 7.5, small_max_usd: 2.25 }).floor).toEqual({ short_open: 0, short_big: 1, short_small: 0, big_min_usd: 7.5, small_max_usd: 2.25 });
    const many = { ...supply, open_cards: Array.from({ length: 200 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: 'x', target_usd: 1 })) };
    const input = draftToFloorInput(many);
    expect(input.open_cards).toHaveLength(DRAFT_TO_FLOOR_MAX_CARDS);
    expect(new TextEncoder().encode(JSON.stringify(input)).length).toBeLessThanOrEqual(JOB_INPUT_MAX_BYTES);
  });
});
