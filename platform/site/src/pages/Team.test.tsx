import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../lib/copy';
import { formatDate } from '../lib/format';
import type { Card, Role, Snapshot, StudioSource } from '../lib/source';
import { SourceProvider } from '../lib/studio';
import { Team } from './Team';

const team = copy.team;

const ROLES: [string, boolean, string][] = [
  ['Studio Head', true, 'claude-opus-5-5'],
  ['Game Director', true, 'claude-opus-5-5'],
  ['Builder A', true, 'claude-sonnet-5'],
  ['Builder B', true, 'claude-sonnet-5'],
  ['Platform Builder', true, 'claude-sonnet-5'],
  ['QA', true, 'claude-sonnet-5'],
  ['Host', false, 'claude-haiku-4-5'],
  ['Scout', false, 'claude-sonnet-5'],
  ['Community', false, 'claude-sonnet-5'],
];

function role([title, write_access, model]: [string, boolean, string]): Role {
  return {
    id: `r-${title.toLowerCase().replace(/\s+/g, '-')}`,
    name: title,
    title,
    description: `${title} does its job.`,
    species_note: `A small blue creature called ${title}.`,
    model,
    write_access,
    state: 'active',
    hired_at: '2026-09-14T00:00:00Z',
  };
}

function live(id: string, executor: string | null): Card {
  return {
    id,
    title: id,
    summary: null,
    intent: null,
    source: 'board',
    stage: 'live',
    shape: 'oneoff',
    bucket: 'game',
    folder: 'seed-1',
    horizon: 'now',
    rank: null,
    executor_role_id: executor,
    funding_target_usd: 0,
    funded_usd: 0,
    spent_usd: 0,
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
    live_at: '2026-09-15T00:00:00Z',
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    pool: null,
    cards: [live('one', 'r-builder-a'), live('two', 'r-builder-a'), live('three', 'r-qa'), { ...live('four', 'r-builder-b'), stage: 'building' }],
    funding: {},
    launchedAt: null,
    paused: false,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: ROLES.map(role),
    cardTitles: {},
    missing: [],
    ...overrides,
  };
}

function renderTeam(source: StudioSource | null) {
  return render(
    <SourceProvider source={source}>
      <MemoryRouter>
        <Team />
      </MemoryRouter>
    </SourceProvider>,
  );
}

function sourceOf(value: Snapshot): StudioSource {
  return { load: () => Promise.resolve(value), subscribe: () => () => {} };
}

function names(region: HTMLElement): string[] {
  return within(region)
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent ?? '');
}

function box(name: string): HTMLElement {
  return screen.getByRole('heading', { level: 3, name }).closest('li')!;
}

afterEach(() => {
  cleanup();
});

describe('Team', () => {
  it('splits the roles into running and not running yet from facts, not labels', async () => {
    renderTeam(sourceOf(snapshot()));
    const running = await screen.findByRole('region', { name: team.running });
    expect(names(running)).toEqual(['Builder A', 'Builder B', 'QA']);
    const waiting = screen.getByRole('region', { name: team.notRunning });
    expect(names(waiting)).toEqual(['Studio Head', 'Game Director', 'Platform Builder', 'Host', 'Scout', 'Community']);
    expect(within(waiting).getByRole('link', { name: team.roadmapLink }).getAttribute('href')).toBe('/roadmap');
  });

  it('gives a running role its model, hired date, live cards shipped and what it changes', async () => {
    renderTeam(sourceOf(snapshot()));
    await screen.findByRole('region', { name: team.running });
    const hired = `${team.hired} ${formatDate('2026-09-14T00:00:00Z')}`;
    expect(within(box('Builder A')).getByText(`claude-sonnet-5 · ${hired} · 2 cards shipped · changes the game`)).toBeTruthy();
    expect(within(box('QA')).getByText(`claude-sonnet-5 · ${hired} · 1 card shipped · changes the game`)).toBeTruthy();
    // A card still building is not shipped.
    expect(within(box('Builder B')).getByText(`claude-sonnet-5 · ${hired} · 0 cards shipped · changes the game`)).toBeTruthy();
    expect(within(box('Builder A')).getByText(team.aiAgent)).toBeTruthy();
    expect(within(box('Builder A')).getByText('Builder A does its job.')).toBeTruthy();
  });

  it('shows no model or hired date for a role that does not run, so the director model claims nothing', async () => {
    renderTeam(sourceOf(snapshot()));
    await screen.findByRole('region', { name: team.notRunning });
    for (const name of ['Studio Head', 'Game Director', 'Host', 'Scout', 'Community']) {
      expect(within(box(name)).getByText(`${team.notRunning}.`)).toBeTruthy();
    }
    expect(within(box('Platform Builder')).getByText(`${team.notRunning}. ${team.siteClosed}`)).toBeTruthy();
    expect(screen.queryByText(/claude-opus-5-5/)).toBeNull();
    expect(screen.queryByText(/claude-haiku/)).toBeNull();
  });

  it('draws every agent with an avatar named by its species note, and shows no scorecards', async () => {
    renderTeam(sourceOf(snapshot()));
    await screen.findByRole('region', { name: team.running });
    for (const [title] of ROLES) {
      expect(within(box(title)).getByRole('img', { name: `A small blue creature called ${title}.` })).toBeTruthy();
    }
    expect(document.body.textContent).not.toMatch(/first.pass|reopen|estimate accuracy|cost per ship|score/i);
  });

  it('leaves out a retired role and a blank description, and names a role whose name differs from its title', async () => {
    const roles = [
      { ...role(['Builder A', true, 'claude-sonnet-5']), name: 'Pip', description: '  ' },
      { ...role(['Builder B', true, 'claude-sonnet-5']), state: 'retired' },
    ];
    renderTeam(sourceOf(snapshot({ roles })));
    await screen.findByRole('region', { name: team.running });
    expect(within(box('Pip')).getByText(`${team.aiAgent} · Builder A`)).toBeTruthy();
    expect(box('Pip').querySelectorAll('p')).toHaveLength(2);
    expect(screen.queryByRole('heading', { level: 3, name: 'Builder B' })).toBeNull();
    expect(screen.queryByRole('region', { name: team.notRunning })).toBeNull();
  });

  it('says the team is unavailable when the roles did not load, and loading before', async () => {
    renderTeam(sourceOf(snapshot({ roles: [], missing: ['roles'] })));
    expect(screen.getByText(team.loading)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(copy.partUnavailable)).toBeTruthy());
    cleanup();
    renderTeam(null);
    expect(screen.getByText(copy.meterUnavailable)).toBeTruthy();
  });
});
