import { describe, expect, it } from 'vitest';
import { boardCardOrder, cardRoleFolder, isCardRole, runsCards, studioStateFrom, type BoardCard } from './board';
import type { Role } from './source';

function role(title: string, overrides: Partial<Role> = {}): Role {
  return {
    id: title,
    name: title,
    title,
    description: null,
    species_note: 'A small blue creature.',
    model: 'claude-sonnet-5',
    write_access: true,
    state: 'active',
    hired_at: '2026-09-14T00:00:00Z',
    ...overrides,
  };
}

const NINE = ['Studio Head', 'Game Director', 'Builder A', 'Builder B', 'Platform Builder', 'QA', 'Host', 'Scout', 'Community'];

describe('which roles build cards and which run', () => {
  it('offers the builders, QA and the Platform Builder as executors, and runs only the ones whose folder is open', () => {
    const roles = NINE.map((title) =>
      role(title, { write_access: !['Host', 'Scout', 'Community'].includes(title) }),
    );
    expect(roles.filter(isCardRole).map((r) => r.title)).toEqual(['Builder A', 'Builder B', 'Platform Builder', 'QA']);
    // The platform code lane is closed at launch, so the Platform Builder does not run yet.
    expect(roles.filter(runsCards).map((r) => r.title)).toEqual(['Builder A', 'Builder B', 'QA']);
    expect(cardRoleFolder(role('Platform Builder'))).toBe('platform');
    expect(cardRoleFolder(role('Studio Head'))).toBeNull();
  });

  it('never counts a retired role or one without write access', () => {
    expect(runsCards(role('Builder A', { state: 'retired' }))).toBe(false);
    expect(isCardRole(role('Builder B', { write_access: false }))).toBe(false);
    expect(isCardRole(role('toString'))).toBe(false);
  });
});

describe('studioStateFrom', () => {
  it('reads the optional caps when board_studio_state returns them, and null when it does not', () => {
    const base = { paused: false, agent_mode: 'attended', daily_cap_usd: '100', card_max_usd: 25 };
    expect(studioStateFrom(base)).toMatchObject({ agent_hourly_rate_usd: null, monthly_cap_usd: null, credit_studio_daily_cap_usd: null });
    expect(
      studioStateFrom({ ...base, agent_hourly_rate_usd: '4.0000', monthly_cap_usd: 500, credit_studio_daily_cap_usd: '500' }),
    ).toMatchObject({ daily_cap_usd: 100, agent_hourly_rate_usd: 4, monthly_cap_usd: 500, credit_studio_daily_cap_usd: 500 });
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
