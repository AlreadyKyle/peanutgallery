import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { legal } from '../lib/legal';
import { reportsFrom } from '../lib/reports-source';
import { reportsDoc } from '../lib/reports.test-fixture';
import { ReportFacts, shippedMeta } from './ReportFacts';

afterEach(() => {
  cleanup();
});

const [newest, older] = reportsFrom(reportsDoc());

function draw(report = newest!) {
  return render(
    <MemoryRouter>
      <ReportFacts report={report} />
    </MemoryRouter>,
  );
}

describe('ReportFacts', () => {
  it('heads the report with its week and states the four figures', () => {
    const { container } = draw();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Week of 14 Sep 2026');
    const rows = [...container.querySelectorAll('dl.facts > div')].map((row) => [row.querySelector('dt')!.textContent, row.querySelector('dd')!.textContent]);
    expect(rows).toEqual([
      [legal.reportFacts.shipped, '2'],
      [legal.reportFacts.spent, '$0.54'],
      [legal.reportFacts.newSupporters, '3'],
      [legal.reportFacts.open, '6'],
    ]);
  });

  it('lists each shipped card linking its page, with its cost and its first supporters by number', () => {
    const { container } = draw();
    const shipped = [...container.querySelectorAll('[data-shipped]')];
    expect(shipped.map((row) => row.querySelector('a')!.getAttribute('href'))).toEqual(['/card/10000000-0000-4000-8000-000000000001', '/card/10000000-0000-4000-8000-000000000002']);
    expect(shipped[0]!.querySelector('.row-meta')!.textContent).toBe('$0.29 from contributions · funded by Supporter 1, Supporter 3, Supporter 4 and 2 more');
    expect(shipped[1]!.querySelector('.row-meta')!.textContent).toBe('$0.25 from contributions · funded by Supporter 2');
    const inLine = [...container.querySelectorAll('[data-open] a')].map((a) => a.textContent);
    expect(inLine).toEqual(['Open one', 'Open two', 'Open three']);
    expect(within(container).getByText(legal.reportFacts.firstInLine)).toBeTruthy();
  });

  it('leaves the cost out at $0.00 and the line out with no supporter either', () => {
    const { container } = draw(older!);
    expect(container.querySelector('[data-shipped] .row-meta')).toBeNull();
    expect(shippedMeta({ ...older!.facts.shipped[0]!, supporters: [{ number: 5, founding: false }, { number: 2, founding: true }], supporter_count: 2 })).toBe(
      'funded by Supporter 2 and Supporter 5',
    );
    expect(shippedMeta({ ...older!.facts.shipped[0]!, cost_usd: 0.004 })).toBeNull();
  });

  it('shows no name, email or amount per supporter: only numbers', () => {
    const { container } = draw();
    expect(container.textContent).not.toMatch(/@|contrib_/);
    const dollars = container.textContent!.match(/\$\d+\.\d{2}/g);
    expect(dollars).toEqual(['$0.54', '$0.29', '$0.25']);
  });
});
