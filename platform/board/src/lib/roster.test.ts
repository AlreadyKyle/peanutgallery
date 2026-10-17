import { describe, expect, it } from 'vitest';
import { agentsFrom, deployHealth, gameInfo, gamesFrom, rosterGroups } from './roster';

// The roster's parsers and helpers (docs/specs/board-games-admin.md): what board_games and
// board_agent_roster answer, read defensively, so a missing or older field never breaks the panel.

describe('gamesFrom', () => {
  it('reads every field of 20261017220000_board_games_admin.sql, with the counts as numbers', () => {
    const [game] = gamesFrom([
      {
        folder: 'seed-1', name: 'Dust', status: 'paused', accepting_cards: false, featured: true, blurb: 'A line.',
        play_url: 'https://play.mobmachine.games', box_art: '/games/dust-box-art.svg',
        plays: { load_event: 'dust_load', share_event: 'dust_share', loads: { day: '5', week: 6, month: 7, total: 8 }, shares: { day: 1, week: 1, month: 1, total: 1 } },
        admin_log: [{ at: '2026-10-10T09:00:00Z', actor: 'board@mobmachine.games', action: 'close_game_cards', reason: 'r', details: { from: true, to: false } }],
        open_count: 2, shipped_count: '1', open_cards: [], shipped_cards: [], latest_deploy: null, latest_green_deploy: null,
      },
    ]);
    expect(game).toMatchObject({
      folder: 'seed-1', name: 'Dust', status: 'paused', acceptingCards: false, featured: true, blurb: 'A line.', shippedCount: 1,
      plays: { loadEvent: 'dust_load', loads: { day: 5, week: 6, month: 7, total: 8 } },
      adminLog: [{ action: 'close_game_cards', details: { from: true, to: false } }],
    });
  });

  it('reads the roster migration\'s older answer as a game in development that takes new cards, counted nowhere', () => {
    const [game] = gamesFrom([{ folder: 'seed-1', open_count: 0, shipped_count: 0 }]);
    expect(game).toMatchObject({ status: 'in_development', acceptingCards: true, featured: false, blurb: null, adminLog: [] });
    expect(game!.plays).toEqual({ loadEvent: null, shareEvent: null, loads: { day: 0, week: 0, month: 0, total: 0 }, shares: { day: 0, week: 0, month: 0, total: 0 } });
    expect(gamesFrom([{ folder: 'x', status: 'gone' }])[0]!.status).toBe('in_development');
  });
});

describe('gameInfo', () => {
  it("prefers the database's name, art and address, then this site's constant, then the folder", () => {
    expect(gameInfo({ folder: 'seed-1', name: 'Dust Two', boxArt: '/games/x.svg', playUrl: 'https://x.example' })).toEqual({ name: 'Dust Two', boxArt: '/games/x.svg', playUrl: 'https://x.example' });
    expect(gameInfo({ folder: 'seed-1', name: '', boxArt: null, playUrl: null })).toEqual({ name: 'Dust', boxArt: '/games/dust-box-art.svg', playUrl: 'https://play.mobmachine.games' });
    expect(gameInfo({ folder: 'seed-2', name: 'seed-2', boxArt: null, playUrl: null })).toEqual({ name: 'seed-2', boxArt: null, playUrl: null });
  });
});

describe('deployHealth', () => {
  it('says live, last deploy failed or not deployed', () => {
    const green = { sha: 'a', isGreen: true, smokeResult: null, at: '' };
    const red = { sha: 'b', isGreen: false, smokeResult: null, at: '' };
    expect(deployHealth({ latestDeploy: green, latestGreenDeploy: { sha: 'a', at: '' } })).toBe('live');
    expect(deployHealth({ latestDeploy: red, latestGreenDeploy: { sha: 'a', at: '' } })).toBe('last deploy failed');
    expect(deployHealth({ latestDeploy: red, latestGreenDeploy: null })).toBe('not deployed');
    expect(deployHealth({ latestDeploy: null, latestGreenDeploy: null })).toBe('not deployed');
  });
});

describe('agentsFrom and rosterGroups', () => {
  const agent = (name: string, more: Record<string, unknown>) => ({ id: name, name, title: name, model: 'm', state: 'active', ...more });

  it('reads the profile, roster status, caps, week and pause history, and nulls a missing cap', () => {
    const [a] = agentsFrom([
      agent('Builder A', {
        description: 'Builds.', species_note: 'A badger.', status: 'running', budget_share: '0.125', paused_at: '2026-10-10T09:00:00Z',
        caps: { role_day_usd: '1.5', role_month_usd: 2, studio_day_usd: 3, studio_month_usd: 4, daily_cap_usd: 100, monthly_cap_usd: null },
        runs_week: { succeeded: 2, failed: 1, skipped: 0, last_at: '2026-10-10T11:00:00Z' },
        pause_history: [{ at: '2026-10-09T07:00:00Z', actor: 'board@mobmachine.games', paused: true, reason: 'r' }],
      }),
    ]);
    expect(a).toMatchObject({
      description: 'Builds.', speciesNote: 'A badger.', status: 'running', budgetShare: 0.125, pausedAt: '2026-10-10T09:00:00Z',
      caps: { roleDay: 1.5, roleMonth: 2, studioDay: 3, studioMonth: 4, dailyCap: 100, monthlyCap: null },
      runsWeek: { succeeded: 2, failed: 1, lastAt: '2026-10-10T11:00:00Z' },
      pauseHistory: [{ paused: true, reason: 'r' }],
    });
  });

  it('groups running, then starting later, then planned, then no status, then retired, leaving out empty groups', () => {
    const agents = agentsFrom([
      agent('Host', { status: 'planned' }),
      agent('Old', { status: 'running', state: 'retired' }),
      agent('Builder A', { status: 'running' }),
      agent('Janitor', { status: 'starts' }),
      agent('Mystery', {}),
    ]);
    expect(rosterGroups(agents).map((g) => [g.key, g.agents.map((a) => a.name)])).toEqual([
      ['running', ['Builder A']],
      ['starts', ['Janitor']],
      ['planned', ['Host']],
      ['unset', ['Mystery']],
      ['retired', ['Old']],
    ]);
    expect(rosterGroups(agentsFrom([agent('Builder A', { status: 'running' })])).map((g) => g.key)).toEqual(['running']);
  });
});
