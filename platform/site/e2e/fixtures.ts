import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';
import { SUPABASE_URL } from './fixture-env';

export { expect };

/**
 * Test data for the e2e build. Every Supabase request the site makes is answered here, and the
 * realtime socket is held open without a server, so an e2e run never reads or writes the database.
 * The roles come from the real role specs in platform/agents; everything else is fixture data.
 */
export type StudioFixture = {
  paused: boolean;
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
};

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
  const dir = fileURLToPath(new URL('../../agents/', import.meta.url));
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(`${dir}${name}`, 'utf8')) as RoleSpec)
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
};

/** Answers every Supabase REST request from the fixture and holds realtime open with no server. */
export async function mockStudio(page: Page, studio: StudioFixture): Promise<void> {
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, () => {});
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
    const ids = url.searchParams.get('id');
    const rows: Record<string, unknown> = {
      pool: [studio.pool],
      cards:
        ids !== null && ids.startsWith('in.')
          ? studio.cards.filter((c) => ids.includes(String(c.id))).map((c) => ({ id: c.id, title: c.title }))
          : studio.cards,
      public_card_funding: studio.funding,
      public_card_spend: studio.spend,
      public_studio: [{ launched_at: studio.launchedAt, paused: studio.paused }],
      public_ledger_totals: [studio.totals],
      public_agent_events: studio.events,
      deploys: studio.deploys,
      public_roles: studio.roles,
      public_terms_versions: studio.terms ?? POSTED_TERMS,
    };
    if (table === undefined || !(table in rows) || route.request().method() !== 'GET') {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: `${url.pathname} is not in the e2e fixture` }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows[table]) });
  });
}

/** Every e2e test gets a page whose Supabase requests the fixture answers; override `studio` per test. */
export const test = base.extend<{ studio: StudioFixture }>({
  studio: [DEFAULT_STUDIO, { option: true }],
  page: async ({ page, studio }, use) => {
    await mockStudio(page, studio);
    await use(page);
  },
});

export async function overflowsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

export const WIDTHS = [
  { width: 375, height: 812 },
  { width: 1440, height: 1000 },
] as const;
