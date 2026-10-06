import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cardDetailFrom } from '../lib/card-source';
import { detailDoc } from '../lib/card-detail.test-fixture';
import { legal } from '../lib/legal';
import { replaySteps } from './Replay';
import { Supporters, supporterName } from './Supporters';
import { Timeline } from './Timeline';

afterEach(() => {
  cleanup();
});

describe('Supporters', () => {
  it('lists supporters in number order as Supporter n, founding or not, then "and n more" past the 24 shown', () => {
    const first = Array.from({ length: 24 }, (_, k) => ({ number: 24 - k, founding: k % 2 === 0 }));
    const { container } = render(<Supporters supporters={first} count={30} />);
    const items = [...container.querySelectorAll('ul.supporters li')].map((li) => li.textContent);
    expect(items).toHaveLength(24);
    expect(items[0]).toBe('Supporter 1');
    expect(items[1]).toBe('Supporter 2');
    expect(screen.getByText(legal.supportersMore.replace('{n}', '6'))).toBeTruthy();
    expect(container.textContent).not.toMatch(/\$/);
  });

  it('says no supporters yet with none, and names one supporter plainly', () => {
    render(<Supporters supporters={[]} count={0} />);
    expect(screen.getByText(legal.supportersNone)).toBeTruthy();
    expect(supporterName({ number: 12, founding: false })).toBe('Supporter 12');
    expect(supporterName({ number: 12, founding: true })).toBe('Supporter 12');
  });
});

describe('the replay steps', () => {
  it('steps through at most five recorded milestones in order, and none for a card with nothing after it opened', () => {
    const shipped = cardDetailFrom(detailDoc());
    expect(replaySteps(shipped).map((s) => s.key)).toEqual(['opened', 'funded', 'started', 'gate', 'shipped']);
    const noTarget = cardDetailFrom(detailDoc({ card: { ...(detailDoc().card as object), funding_target_usd: 0 } }));
    expect(replaySteps(noTarget).map((s) => s.key)).toEqual(['opened', 'started', 'gate', 'shipped']);
    const open = cardDetailFrom(detailDoc({ milestones: { created_at: '2026-09-15T00:00:00Z', started_at: null, gate_at: null, gate: null, live_at: null } }));
    expect(replaySteps(open)).toEqual([]);
  });
});

describe('Timeline', () => {
  it('collapses runs and says how many earlier steps are not shown', () => {
    const lines = [
      { role_id: 'r-a', line_key: 'read', created_at: '2026-09-15T01:00:00Z' },
      { role_id: 'r-a', line_key: 'read', created_at: '2026-09-15T01:01:00Z' },
      { role_id: 'r-a', line_key: 'edited', created_at: '2026-09-15T01:02:00Z' },
      { role_id: null, line_key: 'shipped', created_at: '2026-09-15T01:03:00Z' },
    ];
    const { container } = render(<Timeline lines={lines} count={10} roles={[{ id: 'r-a', name: 'Pip', title: 'Builder A' }]} />);
    expect([...container.querySelectorAll('li .row-strong')].map((el) => el.textContent)).toEqual([
      'Builder A read 2 files',
      'Builder A edited a file',
      'The studio shipped it',
    ]);
    expect(screen.getByText('and 6 earlier steps')).toBeTruthy();
    expect(container.querySelectorAll('time')).toHaveLength(3);
  });
});
