import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Test data for the e2e build. Every Supabase request the site makes is answered here, and the
 * realtime socket is held open without a server, so an e2e run never reads or writes the database.
 * The roles come from the real role specs in platform/agents; everything else is fixture data.
 */
export type StudioFixture = {
  paused: boolean;
  /** public_studio.pause_reason while paused; null or left out for none. */
  pauseReason?: string | null;
  launchedAt: string | null;
  pool: Record<string, string>;
  cards: Record<string, unknown>[];
  funding: Record<string, unknown>[];
  spend: Record<string, unknown>[];
  events: Record<string, unknown>[];
  deploys: Record<string, unknown>[];
  roles: Record<string, unknown>[];
  totals: Record<string, string>;
  /** public_terms_versions; versions 1 and 2 posted when left out (docs/specs/legal-copy.md). */
  terms?: Record<string, unknown>[];
  /** public_money's one row (docs/specs/money-logic.md); null answers the read with an error. */
  money: Record<string, unknown> | null;
  /** public_stopped_cards, newest first; null answers the read with an error. */
  stopped: Record<string, unknown>[] | null;
};

/** A public_money row: every figure zero, nothing reconciled and an empty order, with `fields` over it. */
export function moneyRow(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    payments: 0,
    received_usd: '0.0000',
    stripe_fees_usd: '0.0000',
    refunded_usd: '0.0000',
    disputed_usd: '0.0000',
    corrections_usd: '0.0000',
    studio_pct_avg: null,
    reserve_usd: '0.0000',
    studio_usd: '0.0000',
    incident_usd: '0.0000',
    held_usd: '0.0000',
    agent_credit_usd: '0.0000',
    not_on_card_usd: '0.0000',
    short_usd: '0.0000',
    board_test_usd: '0.0000',
    reconciled_at: null,
    last_run_ok: null,
    funding_order: [],
    ...fields,
  };
}

/** A funding order in public_money's shape, from card ids in order. */
export function fundingOrder(ids: readonly unknown[]): Record<string, unknown>[] {
  return ids.map((card_id, i) => ({ position: i + 1, card_id, room_usd: 1 }));
}

/** The posted Terms versions the e2e build reads: version 1 at #47's merge, version 2 a day later. */
export const POSTED_TERMS = [
  { version: 1, posted_at: '2026-09-23T01:32:51+00:00' },
  { version: 2, posted_at: '2026-09-24T15:00:00+00:00' },
];

// The values the board set (docs/PLAN.md §10 decision 36): every role that runs is on claude-opus-5-5.
const MODELS: Record<string, string> = {
  MODEL_DIRECTOR: 'claude-opus-5-5',
  MODEL_BUILDER: 'claude-opus-5-5',
  MODEL_HOST: 'claude-haiku-4-5',
};

type RoleSpec = { name: string; title: string; species_note: string; model: string; write_access: boolean; description?: string };

function roleId(title: string): string {
  return `r-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
}

function rolesFromSpecs(): Record<string, unknown>[] {
  // import.meta.dirname, not import.meta.url: the unit tests read this file under jsdom as well.
  const dir = join(import.meta.dirname, '../../agents/');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as RoleSpec)
    .map((spec) => ({
      id: roleId(spec.title),
      name: spec.name,
      title: spec.title,
      description: spec.description ?? null,
      species_note: spec.species_note,
      model: MODELS[spec.model] ?? spec.model,
      write_access: spec.write_access,
      state: 'active',
      hired_at: '2026-09-14T00:00:00Z',
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

let cardCount = 0;
function card(fields: Record<string, unknown>): Record<string, unknown> {
  cardCount += 1;
  return {
    id: `00000000-0000-4000-8000-${String(cardCount).padStart(12, '0')}`,
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
    created_at: `2026-09-15T00:00:${String(cardCount).padStart(2, '0')}Z`,
    updated_at: `2026-09-15T00:00:${String(cardCount).padStart(2, '0')}Z`,
    live_at: null,
    ...fields,
  };
}

const CARDS = [
  card({ title: 'Rename the Gatherer to Sweeper', summary: 'The first building gets a clearer name.', funding_target_usd: '2.0000', funded_usd: '0.8000' }),
  card({ title: 'Quiet rooms: one more unlock', summary: 'Add a fourteenth unlock at 300M dust.', stage: 'voted', funding_target_usd: '3.0000', funded_usd: '1.2000' }),
  card({ title: 'A cheaper Cart', summary: 'The Cart costs less to build.', stage: 'funded', funding_target_usd: '3.0000', funded_usd: '3.0000', executor_role_id: roleId('Builder B') }),
  card({ title: 'Save progress and resume on reload', summary: 'Your progress is kept between visits.', stage: 'live', shape: 'oneoff', executor_role_id: roleId('Builder A'), live_at: '2026-09-15T08:00:00Z' }),
  card({ title: 'The unlock list fits any number of unlocks', summary: 'The unlock list scrolls instead of overflowing.', stage: 'live', shape: 'oneoff', executor_role_id: roleId('Builder A'), live_at: '2026-09-15T10:00:00Z' }),
  card({ title: 'Choose the next card without paying', summary: 'Supporters pick what is built next without paying.', folder: 'platform', bucket: 'studio', horizon: 'next', rank: 1 }),
  card({ title: 'The Studio Head drafts cards from the roadmap', summary: 'New cards drafted by an agent for the board to approve.', folder: 'platform', bucket: 'agents', horizon: 'next', rank: 2 }),
  card({ title: 'Board on its own site', summary: 'The board signs in on a separate site built only from kernel files.', folder: 'platform', bucket: 'platform', horizon: 'next', rank: 3 }),
  card({ title: 'A second area in Dust', summary: 'A new place to explore once the first one is done.', horizon: 'later', rank: 1 }),
  card({ title: 'Image adapter for studio pictures', summary: 'Episode thumbnails and lore cards, reviewed by the board first.', folder: 'platform', bucket: 'studio', horizon: 'later', rank: 2 }),
];

export const DEFAULT_STUDIO: StudioFixture = {
  paused: false,
  launchedAt: null,
  pool: {
    balance_usd: '12.3400',
    reserve_usd: '1.5000',
    incident_reserve_usd: '0.6200',
    held_usd: '0.0000',
    daily_spent_usd: '0.0000',
    day: '2026-09-22',
  },
  cards: CARDS,
  funding: [
    { card_id: CARDS[0]!.id, contributors: '1', credited_usd: '0.8000' },
    { card_id: CARDS[1]!.id, contributors: '2', credited_usd: '1.2000' },
    { card_id: CARDS[2]!.id, contributors: '3', credited_usd: '3.0000' },
  ],
  spend: [{ card_id: CARDS[4]!.id, spent_usd: '0.2400' }],
  events: [
    { id: 'e3', card_id: CARDS[4]!.id, role_id: roleId('Builder A'), type: 'ship', created_at: '2026-09-15T10:00:00Z' },
    { id: 'e2', card_id: CARDS[4]!.id, role_id: roleId('Builder A'), type: 'tool_call', created_at: '2026-09-15T09:55:00Z' },
    { id: 'e1', card_id: CARDS[4]!.id, role_id: roleId('Builder A'), type: 'start', created_at: '2026-09-15T09:50:00Z' },
  ],
  deploys: [
    { id: 'd2', folder: 'seed-1', sha: '2775bcb1000a2ebb53a1b03771afb137aae2f50c', is_green: true, smoke_result: 'bot: 812 simulated seconds, 13 unlocks, budget 900 s', created_at: '2026-09-15T10:02:00Z' },
    { id: 'd1', folder: 'seed-1', sha: 'b7e1c9a4d2f8e6b0a1c3d5e7f9a2b4c6d8e0f1a2', is_green: true, smoke_result: 'bot: 790 simulated seconds, 12 unlocks, budget 900 s', created_at: '2026-09-15T08:02:00Z' },
  ],
  roles: rolesFromSpecs(),
  totals: { usd_total: '0.2400', input_tokens: '12000', cached_tokens: '3000', output_tokens: '800', row_count: '3' },
  // Four contributions: 12.00 - 1.40 in fees = 10.60 = 1.06 reserve + 1.91 studio + 0.38 emergency fund + 7.25 agent credit.
  money: moneyRow({
    payments: 4,
    received_usd: '12.0000',
    stripe_fees_usd: '1.4000',
    studio_pct_avg: '20.00',
    reserve_usd: '1.0600',
    studio_usd: '1.9100',
    incident_usd: '0.3800',
    agent_credit_usd: '7.2500',
    not_on_card_usd: '0.3000',
    funding_order: fundingOrder([CARDS[1]!.id, CARDS[0]!.id]),
  }),
  stopped: [],
};
