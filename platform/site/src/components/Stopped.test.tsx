import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import type { Snapshot, StoppedCard } from '../lib/source';
import { STATE_TAGS } from './Glyph';
import { Stopped, stopReason } from './Stopped';

afterEach(() => {
  cleanup();
});

function stopped(over: Partial<StoppedCard>): StoppedCard {
  return {
    card_id: 'x',
    title: 'A stopped card',
    stage: 'rejected',
    failing_check: 'gate',
    spent_usd: 0,
    funded_usd: 0,
    credited_usd: 0,
    moved: [],
    stopped_at: '2026-09-22T10:00:00Z',
    ...over,
  };
}

function snapshot(cards: StoppedCard[], over: Partial<Snapshot> = {}): Snapshot {
  return {
    pool: null,
    cards: [],
    funding: { rej: { contributors: 2, credited_usd: 1.2 } },
    launchedAt: null,
    paused: false,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
    stopped: cards,
    missing: [],
    ...over,
  };
}

const PAUSED = stopped({ card_id: 'pau', title: 'A paused card', stage: 'paused', failing_check: 'ceiling', spent_usd: 0.4, credited_usd: 2 });
const REJECTED = stopped({
  card_id: 'rej',
  title: 'A rejected card',
  failing_check: 'smoke',
  spent_usd: 0.3,
  credited_usd: 1.2,
  moved: [
    { to_card_id: 'a', to_title: 'Quiet rooms', usd: 0.4 },
    { to_card_id: 'b', to_title: 'A cheaper Cart', usd: 0.3 },
    { to_card_id: null, to_title: null, usd: 0.2 },
  ],
});

describe('Stopped', () => {
  it('lists a paused card under Paused with its state tag, reason, spend and that its money stays on it', () => {
    render(<Stopped snapshot={snapshot([PAUSED])} />);
    const list = screen.getByRole('region', { name: legal.pausedHeading });
    const row = within(list).getByRole('listitem');
    expect(within(row).getByRole('heading', { level: 4 }).textContent).toBe('A paused card');
    expect(within(row).getByText(legal.failingCheckWords.ceiling!)).toBeTruthy();
    const tag = row.querySelector('.tag[data-state="paused"]')!;
    expect(tag.textContent).toBe(STATE_TAGS.paused.word);
    expect(tag.textContent).toBe(copy.statusPaused);
    expect(tag.querySelector('svg')?.getAttribute('data-glyph')).toBe(STATE_TAGS.paused.glyph);
    expect(within(row).getByText('$0.40 spent')).toBeTruthy();
    expect(within(row).getByText(legal.pausedMoneyStays)).toBeTruthy();
    expect(screen.queryByRole('region', { name: legal.didntShipHeading })).toBeNull();
  });

  it("lists a rejected card under Didn't ship with its reason, spend, who funded it and where its unspent money went", () => {
    render(<Stopped snapshot={snapshot([REJECTED])} />);
    const list = screen.getByRole('region', { name: legal.didntShipHeading });
    const row = within(list).getByRole('listitem');
    expect(within(row).getByText(legal.failingCheckWords.smoke!)).toBeTruthy();
    expect(within(row).getByText('$0.30 spent · funded by $1.20 from 2 supporters')).toBeTruthy();
    expect(
      within(row).getByText('Its unspent money went to Quiet rooms ($0.40), A cheaper Cart ($0.30) and Not on a card yet ($0.20).'),
    ).toBeTruthy();
    expect(row.querySelector('.tag')).toBeNull();
    expect(screen.queryByRole('region', { name: legal.pausedHeading })).toBeNull();
  });

  it('leaves the supporter count out when the funding figures did not load', () => {
    render(<Stopped snapshot={snapshot([REJECTED], { funding: {}, missing: ['funding'] })} />);
    expect(screen.getByText('$0.30 spent · funded by $1.20')).toBeTruthy();
  });

  it('shows the stage fallback for a code with no words, never the code', () => {
    expect(stopReason({ stage: 'paused', failing_check: 'brand_new_check' })).toBe(legal.pausedFallback);
    expect(stopReason({ stage: 'rejected', failing_check: 'brand_new_check' })).toBe(legal.rejectedFallback);
    expect(stopReason({ stage: 'rejected', failing_check: null })).toBe(legal.rejectedFallback);
    expect(stopReason({ stage: 'rejected', failing_check: 'cancelled_by_board' })).toBe(legal.failingCheckWords.cancelled_by_board);
    const { container } = render(
      <Stopped
        snapshot={snapshot([
          stopped({ card_id: 'p', stage: 'paused', failing_check: 'brand_new_check' }),
          stopped({ card_id: 'r', stage: 'rejected', failing_check: 'another_new_code' }),
        ])}
      />,
    );
    expect(container.textContent).toContain(legal.pausedFallback);
    expect(container.textContent).toContain(legal.rejectedFallback);
    expect(container.textContent).not.toMatch(/brand_new_check|another_new_code/);
  });

  it('has plain words for every code it names, and none of them is a code', () => {
    for (const [code, words] of Object.entries(legal.failingCheckWords)) {
      expect(words, code).toMatch(/^[A-Z].*\.$/);
      expect(words, code).not.toContain('_');
    }
  });

  it('draws nothing with no stopped cards', () => {
    const { container } = render(<Stopped snapshot={snapshot([])} />);
    expect(container.innerHTML).toBe('');
    const again = render(<Stopped snapshot={{ ...snapshot([]), stopped: undefined }} />);
    expect(again.container.innerHTML).toBe('');
  });
});
