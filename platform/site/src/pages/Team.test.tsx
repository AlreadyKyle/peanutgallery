import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
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
  ['Biz Dev', false, 'claude-sonnet-5'],
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
  it('splits the roles into running and building no cards from facts, not labels', async () => {
    renderTeam(sourceOf(snapshot()));
    const running = await screen.findByRole('region', { name: team.running });
    expect(names(running)).toEqual(['Builder A', 'Builder B', 'QA']);
    const waiting = screen.getByRole('region', { name: team.notRunning });
    expect(names(waiting)).toEqual(['Studio Head', 'Game Director', 'Platform Builder', 'Host', 'Biz Dev', 'Community']);
    expect(within(waiting).getByRole('link', { name: team.roadmapLink }).getAttribute('href')).toBe('/roadmap');
  });

  // The Studio Head ranks, the Game Designer drafts and the Game Director grades when the board asks
  // (docs/specs/agent-workflows.md), so the section they sit in never says its roles have no job.
  it('says the roles that build no cards include ones that rank, draft or grade when the board asks', async () => {
    renderTeam(sourceOf(snapshot()));
    const waiting = await screen.findByRole('region', { name: team.notRunning });
    expect(team.notRunning).toBe('Not building cards');
    expect(waiting.textContent).toContain('Some rank, draft or grade cards when the board asks');
    expect(waiting.textContent).not.toMatch(/these roles have no job|not running/i);
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
    // The Not building cards heading says it once; a row adds a reason only when a closed lane is it.
    for (const name of ['Studio Head', 'Game Director', 'Host', 'Biz Dev', 'Community']) {
      expect(within(box(name)).queryByText(team.notRunning, { exact: false })).toBeNull();
      expect(box(name).querySelector('.card-meta')).toBeNull();
    }
    expect(within(box('Platform Builder')).getByText(team.siteClosed)).toBeTruthy();
    expect(screen.queryByText(/claude-opus-5-5/)).toBeNull();
    expect(screen.queryByText(/claude-haiku/)).toBeNull();
  });

  it('runs the Platform Builder once the studio says the platform code lane is open', async () => {
    renderTeam(sourceOf(snapshot({ platformLaneOpen: true })));
    const running = await screen.findByRole('region', { name: team.running });
    expect(names(running)).toEqual(['Builder A', 'Builder B', 'Platform Builder', 'QA']);
    const hired = `${team.hired} ${formatDate('2026-09-14T00:00:00Z')}`;
    expect(within(box('Platform Builder')).getByText(`claude-sonnet-5 · ${hired} · 0 cards shipped · changes the site`)).toBeTruthy();
    expect(screen.queryByText(team.siteClosed, { exact: false })).toBeNull();
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
    await waitFor(() => expect(screen.getByText(legal.partUnavailable)).toBeTruthy());
    cleanup();
    renderTeam(null);
    expect(screen.getByText(legal.meterUnavailable)).toBeTruthy();
  });

  it('draws running agents awake and the roles still to come asleep, whether or not the studio is paused', async () => {
    const poses = (region: HTMLElement) => [...region.querySelectorAll('svg.avatar')].map((svg) => svg.getAttribute('data-pose'));
    for (const paused of [true, false]) {
      renderTeam(sourceOf(snapshot({ paused })));
      const running = await screen.findByRole('region', { name: team.running });
      const waiting = screen.getByRole('region', { name: team.notRunning });
      expect(new Set(poses(running))).toEqual(new Set(['awake']));
      expect(new Set(poses(waiting))).toEqual(new Set(['asleep']));
      cleanup();
    }
  });

  it('lists each agent as a plain row, never a card', async () => {
    renderTeam(sourceOf(snapshot()));
    await screen.findByRole('region', { name: team.running });
    expect(document.querySelectorAll('li.card')).toHaveLength(0);
    expect(document.querySelectorAll('li.agent').length).toBe(ROLES.length);
  });
});
