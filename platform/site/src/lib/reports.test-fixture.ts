// A weekly reports document in site_reports()' shape (docs/specs/studio-reports.md), for the unit
// tests. Every figure is made up.
export function reportsDoc(): { reports: { week_start: string; published_at: string; facts: Record<string, unknown> }[] } {
  return {
    reports: [
      {
        week_start: '2026-09-07',
        published_at: '2026-09-14T04:07:00+00:00',
        facts: {
          shipped_count: 1,
          shipped: [
            { id: '10000000-0000-4000-8000-000000000011', title: 'Founder-built card', folder: 'platform', live_at: '2026-09-10T15:00:00+00:00', cost_usd: 0, supporters: [], supporter_count: 0 },
          ],
          open_count: 1,
          open_first: [{ id: '10000000-0000-4000-8000-000000000021', title: 'Open one' }],
          new_supporters: 0,
          spend_usd: 0,
        },
      },
      {
        week_start: '2026-09-14',
        published_at: '2026-09-21T04:07:00+00:00',
        facts: {
          shipped_count: 2,
          shipped: [
            {
              id: '10000000-0000-4000-8000-000000000001',
              title: 'A plant grows faster',
              folder: 'seed-1',
              live_at: '2026-09-16T12:00:00+00:00',
              cost_usd: '0.2900',
              supporters: [
                { number: 1, founding: true },
                { number: 3, founding: false },
                { number: 4, founding: false },
                { number: 7, founding: false },
                { number: 9, founding: false },
              ],
              supporter_count: 5,
            },
            { id: '10000000-0000-4000-8000-000000000002', title: 'Dust settles slower', folder: 'seed-1', live_at: '2026-09-17T12:00:00+00:00', cost_usd: 0.25, supporters: [{ number: 2, founding: false }], supporter_count: 1 },
          ],
          open_count: 6,
          open_first: [
            { id: '10000000-0000-4000-8000-000000000021', title: 'Open one' },
            { id: '10000000-0000-4000-8000-000000000022', title: 'Open two' },
            { id: '10000000-0000-4000-8000-000000000023', title: 'Open three' },
          ],
          new_supporters: 3,
          spend_usd: '0.5400',
        },
      },
    ],
  };
}
