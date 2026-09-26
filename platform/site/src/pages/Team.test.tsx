import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import type { Card, Role, Snapshot, StudioSource } from '../lib/source';
import { SourceProvider } from '../lib/studio';
import { Team } from './Team';

const team = copy.team;

// title, write access, model, roster status, trigger.
const ROLES: [string, boolean, string, string, string | null][] = [
  ['Studio Head', true, 'claude-opus-5-5', 'running', null],
  ['Game Director', true, 'claude-opus-5-5', 'running', null],
  ['Builder A', true, 'claude-opus-5-5', 'running', null],
  ['Builder B', true, 'claude-opus-5-5', 'running', null],
  ['Platform Builder', true, 'claude-opus-5-5', 'running', null],
  ['QA', true, 'claude-opus-5-5', 'running', null],
  ['Host', false, 'claude-haiku-4-5', 'planned', 'No trigger is set yet; the Host waits on the stream.'],
  ['Biz Dev', false, 'claude-opus-5-5', 'starts', 'Starts last, once every other role is built.'],
  ['Community', false, 'claude-opus-5-5', 'starts', 'Starts once a named moderator is in place.'],
];

function role([title, write_access, model, status, trigger]: [string, boolean, string, string, string | null]): Role {
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
    status,
    trigger,
    paused: false,
    paused_reason: null,
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
    roleStats: {
      'r-builder-a': { spent_usd: 1.5, spent_7d_usd: 0.25, shipped_cards: 2 },
      'r-qa': { spent_usd: 0, spent_7d_usd: 0, shipped_cards: 1 },
    },
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
  return { load: () => Promise.resolve(value) };
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

const facts = (model: string, total: string, week: string, ships: string) =>
  `${model} · ${legal.teamSpent.replace('{total}', total).replace('{week}', week)} · ${ships}`;

describe('Team', () => {
  it('puts the roles in Running, Starts later and Planned from the roster columns', async () => {
    renderTeam(sourceOf(snapshot()));
    const running = await screen.findByRole('region', { name: team.running });
    expect(names(running)).toEqual(['Studio Head', 'Game Director', 'Builder A', 'Builder B', 'QA']);
    const starts = screen.getByRole('region', { name: team.startsLater });
    expect(names(starts)).toEqual(['Platform Builder', 'Biz Dev', 'Community']);
    const planned = screen.getByRole('region', { name: team.planned });
    expect(names(planned)).toEqual(['Host']);
    expect(within(planned).getByRole('link', { name: team.roadmapLink }).getAttribute('href')).toBe('/roadmap');
    expect(box('Builder A').getAttribute('data-status')).toBe('running');
    expect(box('Biz Dev').getAttribute('data-status')).toBe('starts');
    expect(box('Host').getAttribute('data-status')).toBe('planned');
  });

  it('gives a running role its model, its cost from contributions and the shipped cards it worked on', async () => {
    renderTeam(sourceOf(snapshot()));
    await screen.findByRole('region', { name: team.running });
    expect(within(box('Builder A')).getByText(facts('claude-opus-5-5', '$1.50', '$0.25', 'Worked on 2 shipped cards'))).toBeTruthy();
    expect(within(box('QA')).getByText(facts('claude-opus-5-5', '$0.00', '$0.00', 'Worked on 1 shipped card'))).toBeTruthy();
    // A role with no stats row has spent nothing from contributions and shipped nothing.
    expect(within(box('Builder A')).getByText(team.aiAgent)).toBeTruthy();
    expect(within(box('Builder A')).getByText('Builder A does its job.')).toBeTruthy();
  });

  it('shows the trigger and no model or cost on a role that does not run', async () => {
    renderTeam(sourceOf(snapshot()));
    await screen.findByRole('region', { name: team.startsLater });
    expect(within(box('Biz Dev')).getByText('Starts last, once every other role is built.')).toBeTruthy();
    expect(within(box('Platform Builder')).getByText(team.laneClosed)).toBeTruthy();
    expect(within(box('Host')).getByText('No trigger is set yet; the Host waits on the stream.')).toBeTruthy();
    for (const name of ['Platform Builder', 'Biz Dev', 'Community', 'Host']) {
      expect(within(box(name)).queryByText(/claude-/)).toBeNull();
      expect(within(box(name)).queryByText(/Spent from contributions/)).toBeNull();
    }
  });

  it('runs the Platform Builder once the studio says the platform code lane is open', async () => {
    renderTeam(sourceOf(snapshot({ platformLaneOpen: true })));
    const running = await screen.findByRole('region', { name: team.running });
    expect(names(running)).toContain('Platform Builder');
    expect(screen.queryByText(team.laneClosed)).toBeNull();
  });

  it("while the studio is paused keeps the running roles in Running as paused, says the reason once, and draws them awake", async () => {
    renderTeam(sourceOf(snapshot({ paused: true, pauseReason: 'awaiting_credit' })));
    const running = await screen.findByRole('region', { name: team.running });
    expect(names(running)).toEqual(['Studio Head', 'Game Director', 'Builder A', 'Builder B', 'QA']);
    expect(within(running).getAllByText(legal.pauseReasons.awaiting_credit!, { exact: false })).toHaveLength(1);
    for (const name of names(running)) {
      expect(box(name).getAttribute('data-status')).toBe('paused');
      expect(within(box(name)).getByText(team.statusPaused)).toBeTruthy();
    }
    expect(within(box('Builder A')).getByText(facts('claude-opus-5-5', '$1.50', '$0.25', 'Worked on 2 shipped cards'))).toBeTruthy();
    const poses = [...running.querySelectorAll('svg.avatar')].map((svg) => svg.getAttribute('data-pose'));
    expect(new Set(poses)).toEqual(new Set(['awake']));
  });

  it("shows a paused role with its own reason while the rest run, awake", async () => {
    const roles = ROLES.map(role).map((r) => (r.title === 'QA' ? { ...r, paused: true, paused_reason: 'Waiting on a fix to its tools.' } : r));
    renderTeam(sourceOf(snapshot({ roles })));
    await screen.findByRole('region', { name: team.running });
    expect(box('QA').getAttribute('data-status')).toBe('paused');
    expect(within(box('QA')).getByText('Waiting on a fix to its tools.')).toBeTruthy();
    expect(box('Builder A').querySelector('svg.avatar')?.getAttribute('data-pose')).toBe('awake');
    expect(box('QA').querySelector('svg.avatar')?.getAttribute('data-pose')).toBe('asleep');
    expect(box('Biz Dev').querySelector('svg.avatar')?.getAttribute('data-pose')).toBe('asleep');
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
      { ...role(['Builder A', true, 'claude-opus-5-5', 'running', null]), name: 'Pip', description: '  ' },
      { ...role(['Builder B', true, 'claude-opus-5-5', 'running', null]), state: 'retired' },
    ];
    renderTeam(sourceOf(snapshot({ roles })));
    await screen.findByRole('region', { name: team.running });
    expect(within(box('Pip')).getByText(`${team.aiAgent} · Builder A`)).toBeTruthy();
    expect(box('Pip').querySelectorAll('p')).toHaveLength(2);
    expect(screen.queryByRole('heading', { level: 3, name: 'Builder B' })).toBeNull();
    expect(screen.queryByRole('region', { name: team.startsLater })).toBeNull();
    expect(screen.queryByRole('region', { name: team.planned })).toBeNull();
  });

  it('says the team is unavailable when the roles did not load, and loading before', async () => {
    renderTeam(sourceOf(snapshot({ roles: [], missing: ['roles'] })));
    expect(screen.getByText(team.loading)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(legal.partUnavailable)).toBeTruthy());
    cleanup();
    renderTeam(null);
    expect(screen.getByText(legal.meterUnavailable)).toBeTruthy();
  });

  it('draws the Running section awake and the roles still to come asleep, whether or not the studio is paused', async () => {
    const poses = (region: HTMLElement) => [...region.querySelectorAll('svg.avatar')].map((svg) => svg.getAttribute('data-pose'));
    for (const paused of [true, false]) {
      renderTeam(sourceOf(snapshot({ paused })));
      const running = await screen.findByRole('region', { name: team.running });
      expect(new Set(poses(running))).toEqual(new Set(['awake']));
      for (const name of [team.startsLater, team.planned]) {
        expect(new Set(poses(screen.getByRole('region', { name })))).toEqual(new Set(['asleep']));
      }
      cleanup();
    }
  });

  it('draws every section as the same team grid of agent boxes, never a card (the board, 26 Sep 2026)', async () => {
    renderTeam(sourceOf(snapshot()));
    await screen.findByRole('region', { name: team.running });
    expect(document.querySelectorAll('li.card')).toHaveLength(0);
    expect(document.querySelectorAll('li.agent').length).toBe(ROLES.length);
    expect(document.querySelectorAll('.team-coming, .agent-coming')).toHaveLength(0);
    for (const name of [team.running, team.startsLater, team.planned]) {
      const lists = screen.getByRole('region', { name }).querySelectorAll('ul');
      expect(lists).toHaveLength(1);
      expect(lists[0]!.className).toBe('team-grid');
      expect([...lists[0]!.children].every((li) => li.tagName === 'LI' && li.className === 'agent')).toBe(true);
    }
    // A role still to come has the same parts as a running one: the avatar, the name, "AI agent",
    // the description and its foot.
    for (const name of ['Biz Dev', 'Host']) {
      expect(within(box(name)).getByText(team.aiAgent)).toBeTruthy();
      expect(box(name).querySelector(':scope > .agent-foot')).not.toBeNull();
    }
  });

  it('repeats the board block at its foot, after every section, in its own band (docs/specs/copy-pass.md)', async () => {
    const { container } = renderTeam(sourceOf(snapshot()));
    await screen.findByRole('region', { name: team.running });
    const who = screen.getByRole('region', { name: legal.whoRuns.heading });
    expect(who.textContent).toContain('Mob Machine is run by AI agents and a human board: Kyle Smith.');
    expect(within(who).getAllByRole('listitem')).toHaveLength(legal.whoRuns.duties.length);
    expect(who.textContent).not.toMatch(/publish|public list|with (its|their) reasons?/i);
    const bands = [...container.querySelectorAll('main > .band')];
    expect(bands).toHaveLength(3);
    expect(bands.at(-1)!.contains(who)).toBe(true);
    expect(bands[1]!.querySelector('.agent')).not.toBeNull();
    expect(bands.at(-1)!.querySelector('.agent')).toBeNull();
  });
});
