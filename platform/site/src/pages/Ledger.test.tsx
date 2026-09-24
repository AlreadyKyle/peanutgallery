import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import { formatDateTime } from '../lib/format';
import { books } from '../lib/books.test-fixture';
import type { Snapshot, StoppedCard, StudioSource } from '../lib/source';
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
    held_usd: 0,
    daily_spent_usd: 0,
    day: '2026-09-14',
  },
  cards: [],
  funding: {},
  launchedAt: null,
  paused: false,
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
      created_at: '2026-09-14T02:10:00Z',
    },
    {
      id: 'd1',
      folder: 'seed-1',
      sha: '2775bcb1000a2ebb53a1b03771afb137aae2f50c',
      is_green: true,
      created_at: '2026-09-14T01:20:00Z',
    },
  ],
  roles: [
    {
      id: builderId,
      name: 'Builder A',
      title: 'Builder A',
      description: null,
      species_note: 'A small blue creature with two round antennae and stubby legs.',
      model: 'claude-sonnet-5',
      write_access: true,
      state: 'active',
      hired_at: '2026-09-14T00:00:00Z',
    },
  ],
  cardTitles: { [cardId]: 'Gatherer costs 11' },
  missing: [],
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
  it('renders the funding, the agent work lines and the deploy lines', async () => {
    renderLedger(sourceOf(snapshot));
    await waitFor(() => expect(screen.getByText('$48.56')).toBeTruthy());
    expect(screen.getByText('$7.10')).toBeTruthy();
    expect(screen.getByText('$2.56')).toBeTruthy();
    expect(screen.getByText('$1.25')).toBeTruthy();
    expect(screen.getByText('12,000 in · 3,000 cached · 800 out tokens')).toBeTruthy();

    const events = listItems('Agent work');
    expect(events).toHaveLength(3);
    expect(events[0]?.textContent).toBe(
      `${formatDateTime('2026-09-14T01:00:00Z')}Builder A started · Gatherer costs 11`,
    );
    expect(events[1]?.textContent).toBe(`${formatDateTime('2026-09-14T01:05:00Z')}shipped · Gatherer costs 11`);
    expect(events[2]?.textContent).toBe(`${formatDateTime('2026-09-14T01:06:00Z')}0f9e8d7c hit an error`);

    const deploys = listItems('Deploys');
    expect(deploys).toHaveLength(2);
    // A deploy row is the folder, the sha and passed or failed: the smoke bot's raw output is never shown.
    expect(deploys[0]?.textContent).toBe(`${formatDateTime('2026-09-14T02:10:00Z')}Game b7e1c9a failed checks`);
    expect(deploys[1]?.textContent).toBe(`${formatDateTime('2026-09-14T01:20:00Z')}Game 2775bcb passed checks`);
    expect(screen.queryByText('restored')).toBeNull();
  });

  it('never shows raw smoke output even when a deploy row carries it', async () => {
    const deploy = snapshot.deploys[1];
    if (deploy === undefined) throw new Error('fixture has no green deploy');
    const raw = { ...deploy, smoke_result: 'bot: 812 simulated seconds, 13 unlocks, budget 900 s' };
    renderLedger(sourceOf({ ...snapshot, deploys: [raw] }));
    await waitFor(() => expect(listItems('Deploys')).toHaveLength(1));
    expect(listItems('Deploys')[0]?.textContent).toBe(`${formatDateTime('2026-09-14T01:20:00Z')}Game 2775bcb passed checks`);
    expect(screen.queryByText(/simulated seconds/)).toBeNull();
  });

  it('shows the empty lines when the database holds no work or deploys', async () => {
    renderLedger(sourceOf({ ...snapshot, events: [], deploys: [], cardTitles: {} }));
    await waitFor(() => expect(screen.getByText(legal.ledgerEmpty)).toBeTruthy());
    expect(screen.getByText(legal.deploysEmpty)).toBeTruthy();
    expect(screen.getByText('$1.25')).toBeTruthy();
  });

  it('says a part is unavailable instead of showing zero or an empty line when it did not load', async () => {
    renderLedger(
      sourceOf({
        ...snapshot,
        totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
        events: [],
        deploys: [],
        cardTitles: {},
        missing: ['totals', 'events', 'deploys', 'cardTitles'],
      }),
    );
    await waitFor(() => expect(screen.getByText('$48.56')).toBeTruthy());
    const work = screen.getByRole('region', { name: legal.agentWork });
    expect(within(work).getAllByText(legal.partUnavailable)).toHaveLength(2);
    expect(within(work).queryByText(legal.describeAgentSpend)).toBeNull();
    expect(within(work).queryByText(/tokens/)).toBeNull();
    expect(screen.queryByText(legal.ledgerEmpty)).toBeNull();
    const deploys = screen.getByRole('region', { name: legal.deploys });
    expect(within(deploys).getByText(legal.partUnavailable)).toBeTruthy();
    expect(screen.queryByText(legal.deploysEmpty)).toBeNull();
    expect(within(work).queryByText('$0.00')).toBeNull();
  });

  it('shows the totals and the deploys when only the agent actions did not load', async () => {
    renderLedger(sourceOf({ ...snapshot, events: [], cardTitles: {}, missing: ['events'] }));
    await waitFor(() => expect(screen.getByText('$1.25')).toBeTruthy());
    const work = screen.getByRole('region', { name: legal.agentWork });
    expect(within(work).getByText(legal.partUnavailable)).toBeTruthy();
    expect(listItems('Deploys')).toHaveLength(2);
  });

  it('says the figures may be out of date under the heading when a refresh fails', async () => {
    let onChange = () => {};
    let fail = false;
    renderLedger({
      load: () => (fail ? Promise.reject(new Error('network down')) : Promise.resolve(snapshot)),
      subscribe: (callback) => {
        onChange = callback;
        return () => {};
      },
    });
    const status = screen.getByRole('status');
    await waitFor(() => expect(screen.getByText('$48.56')).toBeTruthy());
    expect(status.textContent).toBe('');
    expect(status.closest('.hero')).not.toBeNull();
    fail = true;
    onChange();
    await waitFor(() => expect(status.textContent).toBe(legal.staleFigures), { timeout: 3000 });
    expect(screen.getAllByRole('status')).toEqual([status]);
    expect(screen.getByText('$48.56')).toBeTruthy();
    const funding = screen.getByRole('region', { name: legal.meter });
    expect(within(funding).getByText(legal.staleFigures)).toBeTruthy();
  });

  it('shows the unavailable line in every section without a database', () => {
    renderLedger(null);
    // Funding, Money in, Agent work and Deploys; the Stopped band is not drawn without a snapshot.
    expect(screen.getAllByText(legal.meterUnavailable)).toHaveLength(4);
    expect(screen.queryByRole('region', { name: legal.stoppedHeading })).toBeNull();
    expect(screen.queryByText(legal.ledgerEmpty)).toBeNull();
    expect(screen.queryByText(legal.deploysEmpty)).toBeNull();
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  const stoppedCard: StoppedCard = {
    card_id: 'st1',
    title: 'A card that paused',
    stage: 'paused',
    failing_check: 'ceiling',
    spent_usd: 0.4,
    funded_usd: 2,
    credited_usd: 2,
    moved: [],
    stopped_at: '2026-09-22T10:00:00Z',
  };

  it('stacks its bands: Funding, Money in, Stopped cards while there are any, Agent work and Deploys', async () => {
    const { container } = renderLedger(sourceOf({ ...snapshot, money: books([], { payments: 1, received_usd: 5 }), stopped: [stoppedCard] }));
    await waitFor(() => expect(screen.getByText('A card that paused')).toBeTruthy());
    const headings = [...container.querySelectorAll('main > .band h2')].map((h) => h.textContent);
    expect(headings).toEqual([legal.meter, legal.moneyIn, legal.stoppedHeading, legal.agentWork, legal.deploys]);
  });

  it('draws no Stopped band with no stopped cards, and says Not available right now. when they did not load', async () => {
    renderLedger(sourceOf({ ...snapshot, money: books(), stopped: [] }));
    await waitFor(() => expect(screen.getByText('$48.56')).toBeTruthy());
    expect(screen.queryByRole('region', { name: legal.stoppedHeading })).toBeNull();
    cleanup();
    renderLedger(sourceOf({ ...snapshot, money: books(), stopped: [], missing: ['stopped'] }));
    const band = await screen.findByRole('region', { name: legal.stoppedHeading });
    expect(within(band).getByText(legal.partUnavailable)).toBeTruthy();
  });

  it('shows Not on a card yet in the Funding band, the shortfall and the board test payment only while above zero', async () => {
    renderLedger(sourceOf({ ...snapshot, money: books([], { not_on_card_usd: 1.25, short_usd: 0, board_test_usd: 0 }) }));
    const funding = await screen.findByRole('region', { name: legal.meter });
    await waitFor(() => expect(within(funding).getByText(legal.notOnCard)).toBeTruthy());
    const row = within(funding).getByText(legal.notOnCard).closest('.stat')!;
    expect(row.querySelector('dd')?.textContent).toBe('$1.25');
    // The band names the one case where its money goes to a card that is not the next to open.
    expect(within(funding).getByText(legal.notOnCardTopUp)).toBeTruthy();
    expect(within(funding).queryByText(/short by/)).toBeNull();
    expect(within(funding).queryByText(/test payment/)).toBeNull();
    cleanup();
    renderLedger(sourceOf({ ...snapshot, money: books([], { not_on_card_usd: 0, short_usd: 0.75, board_test_usd: 0.5019 }) }));
    const again = await screen.findByRole('region', { name: legal.meter });
    await waitFor(() => expect(within(again).getByText(legal.shortBy.replace('{usd}', '$0.75'))).toBeTruthy());
    expect(within(again).getByText("The pool includes $0.50 of the board's own test payment; it funds no card.")).toBeTruthy();
  });

  it('says Not available right now. for Not on a card yet and Money in when public_money did not load', async () => {
    renderLedger(sourceOf({ ...snapshot, money: null, missing: ['money'] }));
    const funding = await screen.findByRole('region', { name: legal.meter });
    await waitFor(() => expect(within(funding).getByText(legal.notOnCard)).toBeTruthy());
    expect(within(funding).getByText(legal.notOnCard).closest('.stat')!.querySelector('dd')?.textContent).toBe(legal.partUnavailable);
    const moneyIn = screen.getByRole('region', { name: legal.moneyIn });
    expect(within(moneyIn).getByText(legal.partUnavailable)).toBeTruthy();
    expect(within(moneyIn).queryByText(legal.notReconciled)).toBeNull();
  });
});
