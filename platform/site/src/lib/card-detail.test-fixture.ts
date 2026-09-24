// A card's /api/card/:id document for unit tests (docs/specs/supporter-pages.md): a live config card
// with two supporters, one line and every milestone; `fields` replaces top-level keys.

export const ID = '00000000-0000-4000-8000-000000000004';

export function detailDoc(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    card: {
      id: ID,
      bucket: 'game',
      source: 'board',
      shape: 'goal',
      lane: 'config',
      folder: 'seed-1',
      executor_role_id: 'r-a',
      title: 'A cheaper Cart',
      summary: 'The Cart costs less.',
      intent: 'Lower the cost.',
      acceptance_test: 'check: config seed-1/config/spawn-table.json rows[id=cart].baseCost == 11',
      funding_target_usd: '3.0000',
      funded_usd: '3.0000',
      stage: 'live',
      commit_sha: 'abc1234def5678900000000000000000000000ff',
      failing_check: null,
      created_at: '2026-09-15T00:00:00Z',
      updated_at: '2026-09-15T02:00:00Z',
      live_at: '2026-09-15T02:00:00Z',
      horizon: 'now',
      rank: null,
      drafter_role_id: null,
      opens_at: null,
      board_vetoed: false,
      board_veto_reason: null,
    },
    funding: { contributors: 2, credited_usd: '3.0000', on_card_usd: '1.0000' },
    spent_usd: '0.4200',
    supporters: [{ number: 1, founding: true }, { number: 4, founding: false }],
    supporter_count: 2,
    lines: [{ role_id: 'r-a', line_key: 'started', created_at: '2026-09-15T01:00:00Z' }],
    line_count: 1,
    milestones: { created_at: '2026-09-15T00:00:00Z', started_at: '2026-09-15T01:00:00Z', gate_at: '2026-09-15T01:50:00Z', gate: 'passed', live_at: '2026-09-15T02:00:00Z' },
    roles: [{ id: 'r-a', name: 'Builder A', title: 'Builder A' }],
    stopped: null,
    ...fields,
  };
}
