import { describe, expect, it } from 'vitest';
import { cardRoleFolder, isCardRole, openFolders, runsCards } from './roster';
import type { Role } from './source';

function role(title: string, overrides: Partial<Role> = {}): Role {
  return {
    id: title,
    name: title,
    title,
    description: null,
    species_note: 'A small blue creature.',
    model: 'claude-opus-5-5',
    write_access: true,
    state: 'active',
    hired_at: '2026-09-14T00:00:00Z',
    ...overrides,
  };
}

const NINE = ['Studio Head', 'Game Director', 'Builder A', 'Builder B', 'Platform Builder', 'QA', 'Host', 'Biz Dev', 'Community'];

describe('which roles build cards and which run', () => {
  const roles = NINE.map((title) => role(title, { write_access: !['Host', 'Biz Dev', 'Community'].includes(title) }));

  it('runs the seed-1 builders only while the platform code lane is closed', () => {
    expect(roles.filter(isCardRole).map((r) => r.title)).toEqual(['Builder A', 'Builder B', 'Platform Builder', 'QA']);
    expect(roles.filter((r) => runsCards(r)).map((r) => r.title)).toEqual(['Builder A', 'Builder B', 'QA']);
    expect(openFolders(false)).toEqual(['seed-1']);
    expect(cardRoleFolder(role('Platform Builder'))).toBe('platform');
    expect(cardRoleFolder(role('Studio Head'))).toBeNull();
  });

  it('runs the Platform Builder too once the studio says the lane is open', () => {
    expect(openFolders(true)).toEqual(['seed-1', 'platform']);
    expect(roles.filter((r) => runsCards(r, true)).map((r) => r.title)).toEqual(['Builder A', 'Builder B', 'Platform Builder', 'QA']);
  });

  it('never counts a retired role or one without write access', () => {
    expect(runsCards(role('Builder A', { state: 'retired' }))).toBe(false);
    expect(isCardRole(role('Builder B', { write_access: false }))).toBe(false);
    expect(isCardRole(role('toString'))).toBe(false);
  });
});
