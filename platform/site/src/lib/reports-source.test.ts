import { describe, expect, it } from 'vitest';
import { loadReports, REPORTS_URL, reportsFrom } from './reports-source';
import { reportsDoc } from './reports.test-fixture';

describe('the weekly reports document', () => {
  it('parses each report newest first, figures from numbers or numeric strings', () => {
    const reports = reportsFrom(reportsDoc());
    expect(reports.map((r) => r.week_start)).toEqual(['2026-09-14', '2026-09-07']);
    const first = reports[0]!;
    expect(first.facts.shipped_count).toBe(2);
    expect(first.facts.spend_usd).toBe(0.54);
    expect(first.facts.shipped[0]).toMatchObject({ title: 'A plant grows faster', cost_usd: 0.29, supporter_count: 5 });
    expect(first.facts.shipped[0]!.supporters[0]).toEqual({ number: 1, founding: true });
    expect(first.facts.open_first.map((c) => c.title)).toEqual(['Open one', 'Open two', 'Open three']);
  });

  it('reads an empty list as no report', () => {
    expect(reportsFrom({ reports: [] })).toEqual([]);
  });

  it('refuses a malformed document', () => {
    expect(() => reportsFrom([])).toThrow();
    expect(() => reportsFrom({})).toThrow();
    expect(() => reportsFrom({ reports: [{ week_start: 'Monday', published_at: 'x', facts: {} }] })).toThrow();
    const doc = reportsDoc();
    (doc.reports[0]!.facts as Record<string, unknown>).spend_usd = 'lots';
    expect(() => reportsFrom(doc)).toThrow('Malformed spend_usd');
  });

  it('reads /api/reports from its own origin, and rejects on a failed answer', async () => {
    const calls: string[] = [];
    const ok = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(reportsDoc()), { status: 200 });
    }) as unknown as typeof fetch;
    expect((await loadReports(ok)).length).toBe(2);
    expect(calls).toEqual([REPORTS_URL]);
    const failing = (async () => new Response('{"error":"x"}', { status: 502 })) as unknown as typeof fetch;
    await expect(loadReports(failing)).rejects.toThrow('502');
  });
});
