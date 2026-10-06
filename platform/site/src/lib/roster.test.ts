import { describe, expect, it } from 'vitest';
import { legal } from './legal';
import { copy } from './copy';
import { cardRoleFolder, isCardRole, onTheTeam, openFolders, teamStatus, teamStrip } from './roster';
import type { Role, Snapshot } from './source';

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
    status: 'running',
    trigger: null,
    paused: false,
    paused_reason: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    pool: null,
    cards: [],
    funding: {},
    launchedAt: null,
    paused: false,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
    missing: [],
    ...overrides,
  };
}

const NINE = ['Studio Head', 'Game Director', 'Builder A', 'Builder B', 'Platform Builder', 'QA', 'Host', 'Biz Dev', 'Community'];

describe('which roles build cards', () => {
  const roles = NINE.map((title) => role(title, { write_access: !['Host', 'Biz Dev', 'Community'].includes(title) }));

  it('names the card roles and their folders; the platform lane opens only when the studio says so', () => {
    expect(roles.filter(isCardRole).map((r) => r.title)).toEqual(['Builder A', 'Builder B', 'Platform Builder', 'QA']);
    expect(openFolders(false)).toEqual(['seed-1']);
    expect(openFolders(true)).toEqual(['seed-1', 'platform']);
    expect(cardRoleFolder(role('Platform Builder'))).toBe('platform');
    expect(cardRoleFolder(role('Studio Head'))).toBeNull();
  });

  it('never counts a retired role or one without write access', () => {
    expect(isCardRole(role('Builder A', { state: 'retired' }))).toBe(false);
    expect(isCardRole(role('Builder B', { write_access: false }))).toBe(false);
    expect(isCardRole(role('toString'))).toBe(false);
  });
});

describe('teamStatus', () => {
  it('runs a role the roster marks running, card role or not', () => {
    expect(teamStatus(role('Builder A'), snapshot())).toEqual({ kind: 'running', sentence: null });
    expect(teamStatus(role('Studio Head'), snapshot())).toEqual({ kind: 'running', sentence: null });
  });

  it('starts a card role whose folder is closed when the board opens the studio code lane, and runs it once open', () => {
    expect(teamStatus(role('Platform Builder'), snapshot())).toEqual({ kind: 'starts', sentence: copy.team.laneClosed });
    expect(teamStatus(role('Platform Builder'), snapshot({ platformLaneOpen: true }))).toEqual({ kind: 'running', sentence: null });
  });

  it('keeps every running role running while the studio is paused: a studio pause is not shown (decision 62)', () => {
    for (const s of [snapshot({ paused: true, pauseReason: 'awaiting_credit' }), snapshot({ paused: true, pauseReason: null })]) {
      expect(teamStatus(role('Builder A'), s)).toEqual({ kind: 'running', sentence: null });
      expect(teamStatus(role('HR', { status: 'starts', trigger: 'Starts later.' }), s).kind).toBe('starts');
    }
  });

  it("shows a code-only role's own pause, studio paused or not", () => {
    const janitor = role('Janitor', { write_access: false, code_only: true });
    expect(teamStatus(janitor, snapshot({ paused: true, pauseReason: 'awaiting_credit' }))).toEqual({ kind: 'running', sentence: null });
    expect(teamStatus({ ...janitor, paused: true }, snapshot({ paused: true }))).toEqual({ kind: 'paused', sentence: copy.team.rolePaused, by: 'role' });
  });

  it("pauses a role the board paused, with its own reason, before the studio's", () => {
    const own = role('Builder B', { paused: true, paused_reason: 'Waiting on a fix to its tools.' });
    expect(teamStatus(own, snapshot())).toEqual({ kind: 'paused', sentence: 'Waiting on a fix to its tools.', by: 'role' });
    expect(teamStatus(own, snapshot({ paused: true }))).toEqual({ kind: 'paused', sentence: 'Waiting on a fix to its tools.', by: 'role' });
    expect(teamStatus(role('QA', { paused: true }), snapshot())).toEqual({ kind: 'paused', sentence: copy.team.rolePaused, by: 'role' });
  });

  it('says when a starts role starts, and plans a planned or unset one', () => {
    expect(teamStatus(role('HR', { status: 'starts', trigger: 'Starts once role scorecards exist.' }), snapshot())).toEqual({
      kind: 'starts',
      sentence: 'Starts once role scorecards exist.',
    });
    expect(teamStatus(role('Host', { status: 'planned', trigger: 'No trigger is set yet.' }), snapshot())).toEqual({ kind: 'planned', sentence: 'No trigger is set yet.' });
    expect(teamStatus(role('Host', { status: null }), snapshot())).toEqual({ kind: 'planned', sentence: null });
  });

  it('puts running and paused roles on the team, and home strips the first three of them', () => {
    expect(onTheTeam({ kind: 'running', sentence: null })).toBe(true);
    expect(onTheTeam({ kind: 'paused', sentence: null })).toBe(true);
    expect(onTheTeam({ kind: 'starts', sentence: null })).toBe(false);
    expect(onTheTeam({ kind: 'planned', sentence: null })).toBe(false);
    const roles = [
      role('Biz Dev', { status: 'starts' }),
      role('Studio Head'),
      role('Platform Builder'),
      role('Builder A', { paused: true }),
      role('Builder B', { state: 'retired' }),
      role('QA'),
      role('Game Director'),
    ];
    expect(teamStrip(snapshot({ roles })).map((r) => r.title)).toEqual(['Studio Head', 'Builder A', 'QA']);
  });
});
