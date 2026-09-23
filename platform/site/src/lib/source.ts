import type { SupabaseClient } from '@supabase/supabase-js';
import { toNumber, type Numeric } from './format';

export type Pool = {
  balance_usd: number;
  reserve_usd: number;
  incident_reserve_usd: number;
  held_usd: number;
  daily_spent_usd: number;
  day: string;
};

/** When a card is meant to be built: now (open to funding and the agents), next or later (the roadmap). */
export type Horizon = 'now' | 'next' | 'later';
export const HORIZONS: readonly Horizon[] = ['now', 'next', 'later'];

export type Card = {
  id: string;
  title: string;
  summary: string | null;
  intent: string | null;
  source: string;
  stage: string;
  shape: string;
  bucket: string;
  folder: string;
  /** Only a card on horizon now takes money or runs; next and later cards are planned, not built. */
  horizon: Horizon;
  /** Order within a horizon, lowest first; null when the board has not ranked it. */
  rank: number | null;
  /** The role that builds the card, or null. */
  executor_role_id: string | null;
  funding_target_usd: number;
  funded_usd: number;
  /**
   * What studio-billed agent turns on this card cost, from public_card_spend. Founder-billed
   * turns (attended work on the founder's subscription) are tracked and never published
   * (PLAN.md §4 The Board), so the site never reads cards.actual_usd.
   */
  spent_usd: number;
  created_at: string;
  /** The last change to the card row. A held release or a refund moves it after a card ships. */
  updated_at: string;
  /** When the card went live; null before it ships. */
  live_at: string | null;
};

export type CardFunding = {
  contributors: number;
  credited_usd: number;
};

export type LedgerTotals = {
  usd_total: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  row_count: number;
};

export type AgentEvent = {
  id: string;
  card_id: string | null;
  role_id: string | null;
  type: string;
  created_at: string;
};

/** A deploy row. The smoke bot's raw output stays in the database; the site shows only passed or failed. */
export type Deploy = {
  id: string;
  folder: string;
  sha: string;
  is_green: boolean;
  created_at: string;
};

/** A role from the public_roles view: the public columns of roles, never its prompt or budget. */
export type Role = {
  id: string;
  name: string;
  title: string;
  /** What the role does, in one plain paragraph; null until the roles are seeded with it. */
  description: string | null;
  species_note: string;
  model: string;
  write_access: boolean;
  state: string;
  hired_at: string;
};

/**
 * The parts of a snapshot the page can do without. The pool and the cards are the core: when either
 * fails, the whole load fails. When an enrichment fails, the snapshot carries its empty value and
 * names it in `missing`, so a page says that part is unavailable instead of showing zero.
 */
export const ENRICHMENTS = ['funding', 'spend', 'studio', 'totals', 'events', 'deploys', 'roles', 'cardTitles'] as const;
export type Enrichment = (typeof ENRICHMENTS)[number];

export type Snapshot = {
  pool: Pool | null;
  cards: Card[];
  funding: Record<string, CardFunding>;
  launchedAt: string | null;
  /** True while the board has paused the agents. False when the studio row did not load. */
  paused: boolean;
  totals: LedgerTotals;
  events: AgentEvent[];
  deploys: Deploy[];
  roles: Role[];
  cardTitles: Record<string, string>;
  /** The enrichments that failed to load, in ENRICHMENTS order. */
  missing: Enrichment[];
};

export interface StudioSource {
  load(): Promise<Snapshot>;
  subscribe(onChange: () => void): () => void;
}

type PoolRow = {
  balance_usd: Numeric;
  reserve_usd: Numeric;
  incident_reserve_usd: Numeric;
  held_usd: Numeric;
  daily_spent_usd: Numeric;
  day: string;
};

type CardRow = {
  id: string;
  title: string;
  summary: string | null;
  intent: string | null;
  source: string;
  stage: string;
  shape: string;
  bucket: string;
  folder: string;
  horizon: string | null;
  rank: Numeric | null;
  executor_role_id: string | null;
  funding_target_usd: Numeric;
  funded_usd: Numeric;
  created_at: string;
  updated_at: string;
  live_at: string | null;
};

type SpendRow = {
  card_id: string;
  spent_usd: Numeric;
};

type FundingRow = {
  card_id: string;
  contributors: Numeric;
  credited_usd: Numeric;
};

type StudioRow = {
  launched_at: string | null;
  paused: boolean | null;
};

type RoleRow = {
  id: string;
  name: string;
  title: string;
  description: string | null;
  species_note: string | null;
  model: string | null;
  write_access: boolean;
  state: string;
  hired_at: string;
};

type TitleRow = {
  id: string;
  title: string;
};

type TotalsRow = {
  usd_total: Numeric;
  input_tokens: Numeric;
  cached_tokens: Numeric;
  output_tokens: Numeric;
  row_count: Numeric;
};

export const EVENT_LIMIT = 20;
/**
 * How long one query may take before it is aborted. A hung request would otherwise keep a load
 * pending forever, so a failed refresh would never mark the figures stale.
 */
export const QUERY_TIMEOUT_MS = 10_000;
export const DEPLOY_LIMIT = 10;
/** The stages the site lists: fund (proposed, designing, voted), queued (funded), building (building, gated) and shipped (live). */
export const CARD_STAGES = ['proposed', 'designing', 'voted', 'funded', 'building', 'gated', 'live'] as const;
/** The card columns the site reads. Each one must be in the anon column grant on cards. */
export const CARD_COLUMNS =
  'id,title,summary,intent,source,stage,shape,bucket,folder,horizon,rank,executor_role_id,funding_target_usd,funded_usd,created_at,updated_at,live_at';
/** The public_roles columns the site reads. The site never reads the roles table itself. */
export const ROLE_COLUMNS = 'id,name,title,description,species_note,model,write_access,state,hired_at';
export const REALTIME_LISTENERS = [
  { table: 'pool' },
  { table: 'cards' },
  { table: 'deploys' },
] as const;

const zeroTotals: LedgerTotals = {
  usd_total: 0,
  input_tokens: 0,
  cached_tokens: 0,
  output_tokens: 0,
  row_count: 0,
};

let subscriptionCount = 0;

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T | null {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

function money(value: Numeric): number {
  const n = toNumber(value);
  if (n === null) throw new Error(`Malformed numeric value: ${String(value)}`);
  return n;
}

function poolFrom(row: PoolRow | null): Pool | null {
  if (row === null) return null;
  return {
    balance_usd: money(row.balance_usd),
    reserve_usd: money(row.reserve_usd),
    incident_reserve_usd: money(row.incident_reserve_usd),
    held_usd: money(row.held_usd),
    daily_spent_usd: money(row.daily_spent_usd),
    day: row.day,
  };
}

/** A card with no horizon read (a row from before the column existed) is on horizon now. */
function horizonFrom(value: string | null | undefined): Horizon {
  return value === 'next' || value === 'later' ? value : 'now';
}

function rankFrom(value: Numeric | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return money(value);
}

function cardFrom(row: CardRow, spend: Record<string, number>): Card {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    intent: row.intent,
    source: row.source,
    stage: row.stage,
    shape: row.shape,
    bucket: row.bucket,
    folder: row.folder,
    horizon: horizonFrom(row.horizon),
    rank: rankFrom(row.rank),
    executor_role_id: row.executor_role_id ?? null,
    funding_target_usd: money(row.funding_target_usd),
    funded_usd: money(row.funded_usd),
    spent_usd: spend[row.id] ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    live_at: row.live_at ?? null,
  };
}

function roleFrom(row: RoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description ?? null,
    species_note: row.species_note ?? '',
    model: row.model ?? '',
    write_access: row.write_access,
    state: row.state,
    hired_at: row.hired_at,
  };
}

function spendFrom(rows: SpendRow[]): Record<string, number> {
  const spend: Record<string, number> = {};
  for (const row of rows) spend[row.card_id] = money(row.spent_usd);
  return spend;
}

function fundingFrom(rows: FundingRow[]): Record<string, CardFunding> {
  const funding: Record<string, CardFunding> = {};
  for (const row of rows) {
    funding[row.card_id] = {
      contributors: money(row.contributors),
      credited_usd: money(row.credited_usd),
    };
  }
  return funding;
}

function totalsFrom(row: TotalsRow | null): LedgerTotals {
  if (row === null) return zeroTotals;
  return {
    usd_total: money(row.usd_total),
    input_tokens: money(row.input_tokens),
    cached_tokens: money(row.cached_tokens),
    output_tokens: money(row.output_tokens),
    row_count: money(row.row_count),
  };
}

function distinctCardIds(events: AgentEvent[]): string[] {
  const ids = new Set<string>();
  for (const event of events) if (event.card_id !== null) ids.add(event.card_id);
  return [...ids];
}

async function loadCardTitles(
  client: SupabaseClient,
  ids: string[],
  signal: AbortSignal,
): Promise<Record<string, string>> {
  const titles: Record<string, string> = {};
  if (ids.length === 0) return titles;
  const rows = unwrap(
    await client.from('cards').select('id,title').in('id', ids).abortSignal(signal).returns<TitleRow[]>(),
  );
  for (const row of rows ?? []) titles[row.id] = row.title;
  return titles;
}

export function createSupabaseSource(
  client: SupabaseClient,
  { timeoutMs = QUERY_TIMEOUT_MS }: { timeoutMs?: number } = {},
): StudioSource {
  return {
    async load() {
      // Each query gets its own timer. An aborted query resolves with an error, which unwrap throws:
      // a core query rejects the load, and an enrichment lands in missing.
      const timeout = () => AbortSignal.timeout(timeoutMs);
      const failed = new Set<Enrichment>();
      /** Runs one enrichment; any error, a malformed figure included, names it missing and returns the fallback. */
      const optional = async <T>(name: Enrichment, run: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await run();
        } catch {
          failed.add(name);
          return fallback;
        }
      };

      const [pool, cardRows, funding, spend, studio, totals, events, deploys, roles] = await Promise.all([
        client
          .from('pool')
          .select('balance_usd,reserve_usd,incident_reserve_usd,held_usd,daily_spent_usd,day')
          .eq('id', 1)
          .abortSignal(timeout())
          .maybeSingle<PoolRow>()
          .then((result) => poolFrom(unwrap(result))),
        client
          .from('cards')
          .select(CARD_COLUMNS)
          .in('stage', [...CARD_STAGES])
          .order('created_at', { ascending: true })
          .abortSignal(timeout())
          .returns<CardRow[]>()
          .then((result) => unwrap(result) ?? []),
        optional(
          'funding',
          async () =>
            fundingFrom(
              unwrap(
                await client
                  .from('public_card_funding')
                  .select('card_id,contributors,credited_usd')
                  .abortSignal(timeout())
                  .returns<FundingRow[]>(),
              ) ?? [],
            ),
          {},
        ),
        optional(
          'spend',
          async () =>
            spendFrom(
              unwrap(
                await client.from('public_card_spend').select('card_id,spent_usd').abortSignal(timeout()).returns<SpendRow[]>(),
              ) ?? [],
            ),
          {},
        ),
        optional(
          'studio',
          async () => {
            const row = unwrap(
              await client.from('public_studio').select('launched_at,paused').abortSignal(timeout()).maybeSingle<StudioRow>(),
            );
            return { launchedAt: row?.launched_at ?? null, paused: row?.paused === true };
          },
          { launchedAt: null, paused: false },
        ),
        optional(
          'totals',
          async () =>
            totalsFrom(
              unwrap(await client.from('public_ledger_totals').select('*').abortSignal(timeout()).maybeSingle<TotalsRow>()),
            ),
          zeroTotals,
        ),
        optional(
          'events',
          async () =>
            unwrap(
              await client
                .from('public_agent_events')
                .select('id,card_id,role_id,type,created_at')
                .order('created_at', { ascending: false })
                .limit(EVENT_LIMIT)
                .abortSignal(timeout())
                .returns<AgentEvent[]>(),
            ) ?? [],
          [] as AgentEvent[],
        ),
        optional(
          'deploys',
          async () =>
            unwrap(
              await client
                .from('deploys')
                .select('id,folder,sha,is_green,created_at')
                .order('created_at', { ascending: false })
                .limit(DEPLOY_LIMIT)
                .abortSignal(timeout())
                .returns<Deploy[]>(),
            ) ?? [],
          [] as Deploy[],
        ),
        optional(
          'roles',
          async () =>
            (
              unwrap(
                await client
                  .from('public_roles')
                  .select(ROLE_COLUMNS)
                  .order('hired_at', { ascending: true })
                  .order('title', { ascending: true })
                  .abortSignal(timeout())
                  .returns<RoleRow[]>(),
              ) ?? []
            ).map(roleFrom),
          [] as Role[],
        ),
      ]);
      const cardTitles = await optional('cardTitles', () => loadCardTitles(client, distinctCardIds(events), timeout()), {});
      return {
        pool,
        cards: cardRows.map((row) => cardFrom(row, spend)),
        funding,
        launchedAt: studio.launchedAt,
        paused: studio.paused,
        totals,
        events,
        deploys,
        roles,
        cardTitles,
        missing: ENRICHMENTS.filter((name) => failed.has(name)),
      };
    },
    subscribe(onChange) {
      subscriptionCount += 1;
      let channel = client.channel(`site-live-${subscriptionCount}`);
      for (const listener of REALTIME_LISTENERS) {
        channel = channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', ...listener },
          onChange,
        );
      }
      channel.subscribe();
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}
