import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_STUDIO, type StudioFixture } from './fixtures';

/**
 * The studio as production has it at launch, for the layout targets (docs/specs/home-and-design.md):
 * the launch cards from platform/supabase/seed/launch-cards.json with their real titles and summaries
 * (six open, six shipped), the agents paused, $0.50 in the pool, twenty agent actions and ten
 * deploys, and the real roles. Test data only: no public page ever draws a fixture.
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

export const LIVE_STUDIO: StudioFixture = {
  ...DEFAULT_STUDIO,
  paused: true,
  launchedAt: null,
  pool: { ...DEFAULT_STUDIO.pool, balance_usd: '0.5000', reserve_usd: '0.0600', incident_reserve_usd: '0.0300' },
  cards: [...open, ...live, ...planned],
  funding: [],
  spend: [],
  events,
  deploys,
  totals: { usd_total: '0.0000', input_tokens: '0', cached_tokens: '0', output_tokens: '0', row_count: '0' },
};
