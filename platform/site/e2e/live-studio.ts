import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_STUDIO, fundingOrder, moneyRow, type StudioFixture } from './fixtures';

/**
 * The studio as production has it at launch, for the layout targets (docs/specs/home-and-design.md):
 * the launch cards from platform/supabase/seed/launch-cards.json with their real titles and summaries
 * (six open, six shipped), the agents paused while the studio waits for its first payout, $0.50 in
 * the pool, twenty agent actions and ten deploys, the real roles, a few contributions in public_money
 * with the open cards in its funding order, and one paused and one rejected card
 * (docs/specs/money-surfaces.md). Test data only: no public page ever draws a fixture.
 */
type SeedCard = { title: string; summary: string; folder?: string; funding_target_usd?: number; rank?: number };
type Seed = { live: SeedCard[]; open: SeedCard[]; new: SeedCard[] };

const seed = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../supabase/seed/launch-cards.json', import.meta.url)), 'utf8'),
) as Seed;

let n = 0;
function id(): string {
  n += 1;
  return `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function row(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    id: id(),
    summary: null,
    intent: 'Fixture intent for the agents.',
    source: 'board',
    stage: 'proposed',
    shape: 'goal',
    bucket: 'game',
    folder: 'seed-1',
    horizon: 'now',
    rank: null,
    executor_role_id: null,
    funding_target_usd: '0.0000',
    funded_usd: '0.0000',
    created_at: '2026-09-15T00:00:00Z',
    updated_at: '2026-09-15T00:00:00Z',
    live_at: null,
    ...fields,
  };
}

const open = [...seed.open, ...seed.new]
  .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
  .map((card, i) =>
    row({
      title: card.title,
      summary: card.summary,
      stage: i === 0 ? 'voted' : 'proposed',
      rank: card.rank ?? null,
      funding_target_usd: (card.funding_target_usd ?? 0.5).toFixed(4),
      created_at: `2026-09-22T00:00:${String(i).padStart(2, '0')}Z`,
    }),
  );

const builder = String(DEFAULT_STUDIO.roles.find((role) => role.title === 'Builder A')?.id ?? '');
const live = seed.live.map((card, i) =>
  row({
    title: card.title,
    summary: card.summary,
    stage: 'live',
    shape: 'oneoff',
    executor_role_id: builder,
    live_at: `2026-09-15T${String(10 + i).padStart(2, '0')}:00:00Z`,
    updated_at: `2026-09-15T${String(10 + i).padStart(2, '0')}:00:00Z`,
  }),
);

const planned = [
  row({ title: 'Choose the next card without paying', summary: 'Supporters pick what is built next without paying.', folder: 'platform', bucket: 'studio', horizon: 'next', rank: 1 }),
  row({ title: 'The Studio Head drafts cards from the roadmap', summary: 'New cards drafted by an agent for the board to approve.', folder: 'platform', bucket: 'agents', horizon: 'next', rank: 2 }),
  row({ title: 'Image adapter for studio pictures', summary: 'Episode thumbnails and lore cards, reviewed by the board first.', folder: 'platform', bucket: 'studio', horizon: 'later', rank: 1 }),
];

const lastShipped = live.at(-1)!;

/**
 * Two weekly reports in site_reports()' shape (docs/specs/studio-reports.md), newest first: the week the
 * first four live cards shipped, with costs and supporters by number, and an earlier week with the
 * other two, one of them founder-billed with no supporter. Fixture data.
 */
function liveReports(): Record<string, unknown>[] {
  const shipped = (card: Record<string, unknown>, cost: string, supporters: { number: number; founding: boolean }[], count = supporters.length, liveAt = String(card.live_at)) => ({
    id: card.id,
    title: card.title,
    folder: card.folder,
    live_at: liveAt,
    cost_usd: cost,
    supporters,
    supporter_count: count,
  });
  const firsts = open.slice(0, 3).map((card) => ({ id: card.id, title: card.title }));
  return [
    {
      week_start: '2026-09-14',
      published_at: '2026-09-21T04:07:00+00:00',
      facts: {
        shipped_count: 4,
        shipped: [
          shipped(live[0]!, '0.2900', [{ number: 1, founding: true }, { number: 2, founding: true }, { number: 5, founding: false }, { number: 8, founding: false }], 6),
          shipped(live[1]!, '0.4100', [{ number: 3, founding: true }]),
          shipped(live[2]!, '0.0000', []),
          shipped(live[3]!, '1.1200', [{ number: 4, founding: true }, { number: 6, founding: false }]),
        ],
        open_count: open.length,
        open_first: firsts,
        new_supporters: 6,
        spend_usd: '1.8200',
      },
    },
    {
      week_start: '2026-09-07',
      published_at: '2026-09-14T04:07:00+00:00',
      facts: {
        shipped_count: 2,
        shipped: [shipped(live[4]!, '0.0000', [], 0, '2026-09-09T14:00:00Z'), shipped(live[5]!, '0.3300', [{ number: 1, founding: true }], 1, '2026-09-11T16:30:00Z')],
        open_count: 3,
        open_first: firsts,
        new_supporters: 1,
        spend_usd: '0.3300',
      },
    },
  ];
}
const VERBS = ['ship', 'gate_pass', 'message', 'tool_result', 'tool_call'];
const events = Array.from({ length: 20 }, (_, i) => ({
  id: `le${i}`,
  card_id: lastShipped.id,
  role_id: builder,
  type: VERBS[i % VERBS.length],
  created_at: new Date(Date.parse('2026-09-15T22:24:00Z') - i * 60_000).toISOString(),
}));

const deploys = Array.from({ length: 10 }, (_, i) => ({
  id: `ld${i}`,
  folder: 'seed-1',
  sha: `${(0x2775bcb + i).toString(16)}1000a2ebb53a1b03771afb137aae2f50c`.slice(0, 40),
  is_green: true,
  created_at: new Date(Date.parse('2026-09-15T22:25:00Z') - i * 3_600_000).toISOString(),
}));

// Two cards that stopped: one paused on its spending limit, one rejected by the play bot whose unspent
// money moved to two open cards and to Not on a card yet.
const stopped = [
  {
    card_id: id(),
    title: 'Dust drifts toward the cursor',
    stage: 'paused',
    failing_check: 'ceiling',
    spent_usd: '0.4200',
    funded_usd: '0.5000',
    credited_usd: '0.5000',
    moved: [],
    stopped_at: '2026-09-22T18:00:00Z',
  },
  {
    card_id: id(),
    title: 'A faster first unlock',
    stage: 'rejected',
    failing_check: 'smoke',
    spent_usd: '0.1800',
    funded_usd: '0.0000',
    credited_usd: '0.5000',
    moved: [
      { to_card_id: open[0]!.id, to_title: open[0]!.title, usd: 0.15 },
      { to_card_id: open[1]!.id, to_title: open[1]!.title, usd: 0.1 },
      { to_card_id: null, to_title: null, usd: 0.07 },
    ],
    stopped_at: '2026-09-22T16:00:00Z',
  },
];

export const LIVE_STUDIO: StudioFixture = {
  ...DEFAULT_STUDIO,
  paused: true,
  pauseReason: 'awaiting_credit',
  launchedAt: null,
  pool: { ...DEFAULT_STUDIO.pool, balance_usd: '0.5000', reserve_usd: '0.0600', incident_reserve_usd: '0.0300' },
  cards: [...open, ...live, ...planned],
  funding: stopped.map((card) => ({ card_id: card.card_id, contributors: '1', credited_usd: card.credited_usd })),
  spend: [],
  events,
  deploys,
  totals: { usd_total: '0.0000', input_tokens: '0', cached_tokens: '0', output_tokens: '0', row_count: '0' },
  // Two contributions: 3.00 - 0.64 in fees = 2.36 = 0.24 reserve + 0.42 studio + 0.09 emergency fund + 1.61 agent credit;
  // the board's own $1 test payment sits apart, in none of them: $0.5019 of it, its agent credit, is in
  // the pool (board_test_usd, as production has it; docs/specs/money-logic.md).
  money: moneyRow({
    payments: 2,
    received_usd: '3.0000',
    stripe_fees_usd: '0.6400',
    studio_pct_avg: '20.00',
    reserve_usd: '0.2400',
    studio_usd: '0.4200',
    incident_usd: '0.0900',
    agent_credit_usd: '1.6100',
    not_on_card_usd: '0.0700',
    board_test_usd: '0.5019',
    funding_order: fundingOrder(open.map((card) => card.id)),
  }),
  stopped,
  reports: liveReports(),
};
