import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { boardCardOrder, cancelCard, cardRoleFolder, isCardRole, PAUSE_REASONS, setPaused, studioStateFrom, type BoardCard, type Role } from './board';
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
