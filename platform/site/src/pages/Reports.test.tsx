import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../lib/copy';
import { reportsDoc } from '../lib/reports.test-fixture';
import { Reports } from './Reports';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(status: number, body: unknown) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

function draw() {
  return render(
    <MemoryRouter>
      <Reports />
    </MemoryRouter>,
  );
}

describe('/reports', () => {
  it('lists the reports newest first under the title', async () => {
    const calls = serve(200, reportsDoc());
    const { container } = draw();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(copy.reports.title);
    expect(screen.getByText(copy.reports.loading).getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(container.querySelectorAll('section[data-report]')).toHaveLength(2));
    expect([...container.querySelectorAll('section[data-report]')].map((s) => s.getAttribute('data-report'))).toEqual(['2026-09-14', '2026-09-07']);
    expect(calls).toEqual(['/api/reports']);
    expect(container.querySelectorAll('main > .band')).toHaveLength(2);
  });

  it('says there is no report yet, and links the roadmap, with none', async () => {
    serve(200, { reports: [] });
    draw();
    await waitFor(() => expect(screen.getByText(copy.reports.empty)).toBeTruthy());
    expect(copy.reports.empty).toBe('No weekly report yet. A report is published after a week in which a card shipped.');
    expect(screen.getByRole('link', { name: copy.roadmapLink }).getAttribute('href')).toBe('/roadmap');
  });

  it('says the reports could not be loaded when the document fails', async () => {
    serve(502, { error: 'x' });
    draw();
    await waitFor(() => expect(screen.getByText(copy.reports.unavailable)).toBeTruthy());
  });
});
