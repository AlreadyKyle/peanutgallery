import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../lib/copy';
import { formatDateTime } from '../lib/format';
import type { Snapshot, StudioSource } from '../lib/source';
import { SourceProvider } from '../lib/studio';
import { Ledger } from './Ledger';

const builderId = '3d1f6a2b-9c4e-4b7a-8f10-2a5c7e9b1d33';
const unknownRoleId = '0f9e8d7c-6b5a-4d3c-9e2f-1a0b9c8d7e6f';
const cardId = '7b2e4c6d-1a3f-4e5b-8c9d-0f1e2d3c4b5a';
const untitledCardId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const snapshot: Snapshot = {
  pool: {
    balance_usd: 48.56,
    reserve_usd: 7.1,
    incident_reserve_usd: 2.56,
    daily_spent_usd: 0,
    day: '2026-09-14',
  },
  cards: [],
  funding: {},
  launchedAt: null,
  totals: { usd_total: 1.25, input_tokens: 12000, cached_tokens: 3000, output_tokens: 800, row_count: 3 },
  events: [
    { id: 'e1', card_id: cardId, role_id: builderId, type: 'start', created_at: '2026-09-14T01:00:00Z' },
    { id: 'e2', card_id: cardId, role_id: null, type: 'ship', created_at: '2026-09-14T01:05:00Z' },
    { id: 'e3', card_id: untitledCardId, role_id: unknownRoleId, type: 'error', created_at: '2026-09-14T01:06:00Z' },
  ],
  deploys: [
    {
      id: 'd2',
      folder: 'seed-1',
      sha: 'b7e1c9a4d2f8e6b0a1c3d5e7f9a2b4c6d8e0f1a2',
      is_green: false,
      smoke_result: 'fail: version.json sha mismatch',
      created_at: '2026-09-14T02:10:00Z',
    },
    {
      id: 'd1',
      folder: 'seed-1',
      sha: '2775bcb1000a2ebb53a1b03771afb137aae2f50c',
      is_green: true,
      smoke_result: 'ok: page, config, bot',
      created_at: '2026-09-14T01:20:00Z',
    },
  ],
  roles: [{ id: builderId, title: 'Builder A', write_access: true, state: 'active' }],
  cardTitles: { [cardId]: 'Gatherer costs 11' },
};

function sourceOf(value: Snapshot): StudioSource {
  return { load: () => Promise.resolve(value), subscribe: () => () => {} };
}

function renderLedger(source: StudioSource | null) {
  return render(
    <SourceProvider source={source}>
      <Ledger />
    </SourceProvider>,
  );
}

function listItems(sectionName: string): HTMLElement[] {
  return within(screen.getByRole('region', { name: sectionName })).getAllByRole('listitem');
}

afterEach(() => {
  cleanup();
});

describe('Ledger', () => {
  it('renders the pool, the agent work lines and the deploy lines', async () => {
    renderLedger(sourceOf(snapshot));
    await waitFor(() => expect(screen.getByText('$48.56')).toBeTruthy());
    expect(screen.getByText('$7.10')).toBeTruthy();
    expect(screen.getByText('$2.56')).toBeTruthy();
    expect(screen.getByText('$1.25')).toBeTruthy();
    expect(screen.getByText('12,000')).toBeTruthy();

    const events = listItems('Agent work');
    expect(events).toHaveLength(3);
    expect(events[0]?.textContent).toBe(
      `${formatDateTime('2026-09-14T01:00:00Z')}Builder AstartGatherer costs 11`,
    );
    expect(events[1]?.textContent).toBe(`${formatDateTime('2026-09-14T01:05:00Z')}shipGatherer costs 11`);
    expect(events[2]?.textContent).toBe(`${formatDateTime('2026-09-14T01:06:00Z')}0f9e8d7cerror`);

    const deploys = listItems('Deploys');
    expect(deploys).toHaveLength(2);
    expect(deploys[0]?.textContent).toBe(
      `${formatDateTime('2026-09-14T02:10:00Z')}seed-1b7e1c9anot greenfail: version.json sha mismatch`,
    );
    expect(deploys[1]?.textContent).toBe(
      `${formatDateTime('2026-09-14T01:20:00Z')}seed-12775bcbgreenok: page, config, bot`,
    );
    expect(screen.queryByText('restored')).toBeNull();
  });

  it('omits the smoke line when a deploy recorded none', async () => {
    const deploy = snapshot.deploys[1];
    if (deploy === undefined) throw new Error('fixture has no green deploy');
    renderLedger(sourceOf({ ...snapshot, deploys: [{ ...deploy, smoke_result: null }] }));
    await waitFor(() => expect(listItems('Deploys')).toHaveLength(1));
    expect(listItems('Deploys')[0]?.textContent).toBe(
      `${formatDateTime('2026-09-14T01:20:00Z')}seed-12775bcbgreen`,
    );
  });

  it('shows the empty lines when the database holds no work or deploys', async () => {
    renderLedger(sourceOf({ ...snapshot, events: [], deploys: [], cardTitles: {} }));
    await waitFor(() => expect(screen.getByText(copy.ledgerEmpty)).toBeTruthy());
    expect(screen.getByText(copy.deploysEmpty)).toBeTruthy();
    expect(screen.getByText('$1.25')).toBeTruthy();
  });

  it('shows the unavailable line in every section without a database', () => {
    renderLedger(null);
    expect(screen.getAllByText(copy.meterUnavailable)).toHaveLength(3);
    expect(screen.queryByText(copy.ledgerEmpty)).toBeNull();
    expect(screen.queryByText(copy.deploysEmpty)).toBeNull();
    expect(screen.queryByText('$0.00')).toBeNull();
  });
});
