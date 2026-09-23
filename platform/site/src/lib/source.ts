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

/** One place in the waterfall's order (public_money.funding_order): a card that takes money and its room. */
export type FundingPlace = {
  card_id: string;
  room_usd: number;
};

/**
 * The books in one row, from public_money (docs/specs/money-logic.md): the money-in figures, which
 * leave out the board's own test payment and add up (received - fees - refunded - disputed +
 * corrections = reserve + studio + emergency fund + held + agent credit); Not on a card yet and the
 * shortfall; the board's test payment; the last reconcile with Stripe; and the order money fills
 * cards in.
 */
export type Money = {
  payments: number;
  received_usd: number;
  stripe_fees_usd: number;
  refunded_usd: number;
  disputed_usd: number;
  corrections_usd: number;
  /** The studio share supporters chose at checkout, averaged by amount; null before any payment. */
  studio_pct_avg: number | null;
  reserve_usd: number;
  studio_usd: number;
  incident_usd: number;
  held_usd: number;
  agent_credit_usd: number;
  not_on_card_usd: number;
  short_usd: number;
  board_test_usd: number;
  /** When the latest reconcile run finished, set only when it passed. */
  reconciled_at: string | null;
  /** The latest reconcile run's result; null when none has run. */
  last_run_ok: boolean | null;
  funding_order: FundingPlace[];
};

/** Where a rejected card's unspent money went: a card, or Not on a card yet when to_card_id is null. */
export type StoppedMove = {
  to_card_id: string | null;
  to_title: string | null;
  usd: number;
};

/** A rejected or paused card on horizon now, from public_stopped_cards: why it stopped and its money trail. */
export type StoppedCard = {
  card_id: string;
  title: string;
  stage: 'paused' | 'rejected';
  failing_check: string | null;
  spent_usd: number;
  funded_usd: number;
  credited_usd: number;
  moved: StoppedMove[];
  stopped_at: string;
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
export const ENRICHMENTS = ['funding', 'spend', 'studio', 'totals', 'events', 'deploys', 'roles', 'money', 'stopped', 'cardTitles'] as const;
export type Enrichment = (typeof ENRICHMENTS)[number];

export type Snapshot = {
  pool: Pool | null;
  cards: Card[];
  funding: Record<string, CardFunding>;
  launchedAt: string | null;
  /** True while the board has paused the agents. False when the studio row did not load. */
  paused: boolean;
  /**
   * True once the platform code lane is open (studio_state.platform_lane_open, docs/specs/board-site.md).
   * Absent or false while it is closed, or when the studio row did not load.
   */
  platformLaneOpen?: boolean;
  /**
   * Why the studio is paused (public_studio.pause_reason): awaiting_credit, spend_limit, incident or
   * board; null while it is not paused, when the reason is missing or when the studio row did not load.
   */
  pauseReason?: string | null;
  totals: LedgerTotals;
  events: AgentEvent[];
  deploys: Deploy[];
  roles: Role[];
  cardTitles: Record<string, string>;
  /**
   * The books, from public_money; null when it did not load (then 'money' is in missing). A snapshot
   * built without it (a sample or a test) leaves it out, which reads the same as not loaded.
   */
  money?: Money | null;
  /** The newest rejected and paused cards, from public_stopped_cards; empty when it did not load. */
  stopped?: StoppedCard[];
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
  platform_lane_open?: boolean | null;
  pause_reason?: string | null;
};

type MoneyRow = {
  payments: Numeric;
  received_usd: Numeric;
  stripe_fees_usd: Numeric;
  refunded_usd: Numeric;
  disputed_usd: Numeric;
  corrections_usd: Numeric;
  studio_pct_avg: Numeric | null;
  reserve_usd: Numeric;
  studio_usd: Numeric;
  incident_usd: Numeric;
  held_usd: Numeric;
  agent_credit_usd: Numeric;
  not_on_card_usd: Numeric;
  short_usd: Numeric;
  board_test_usd: Numeric;
  reconciled_at: string | null;
  last_run_ok: boolean | null;
  funding_order: { card_id: string; room_usd: Numeric }[] | null;
};

type StoppedRow = {
  card_id: string;
  title: string;
  stage: string;
  failing_check: string | null;
  spent_usd: Numeric;
  funded_usd: Numeric;
  credited_usd: Numeric;
  moved: { to_card_id: string | null; to_title: string | null; usd: Numeric }[] | null;
  stopped_at: string;
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
/** The ledger lists the newest twelve stopped cards. */
export const STOPPED_LIMIT = 12;
/** The public_money and public_stopped_cards columns the site reads (docs/specs/money-surfaces.md). */
export const MONEY_COLUMNS =
  'payments,received_usd,stripe_fees_usd,refunded_usd,disputed_usd,corrections_usd,studio_pct_avg,reserve_usd,studio_usd,incident_usd,held_usd,agent_credit_usd,not_on_card_usd,short_usd,board_test_usd,reconciled_at,last_run_ok,funding_order';
export const STOPPED_COLUMNS = 'card_id,title,stage,failing_check,spent_usd,funded_usd,credited_usd,moved,stopped_at';
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

/** The books, or throws on a malformed figure (the enrichment is then missing). No row reads as not loaded. */
function moneyFrom(row: MoneyRow | null): Money {
  if (row === null) throw new Error('public_money returned no row');
  const pct = row.studio_pct_avg === null ? null : money(row.studio_pct_avg);
  return {
    payments: money(row.payments),
    received_usd: money(row.received_usd),
    stripe_fees_usd: money(row.stripe_fees_usd),
    refunded_usd: money(row.refunded_usd),
    disputed_usd: money(row.disputed_usd),
    corrections_usd: money(row.corrections_usd),
    studio_pct_avg: pct,
    reserve_usd: money(row.reserve_usd),
    studio_usd: money(row.studio_usd),
    incident_usd: money(row.incident_usd),
    held_usd: money(row.held_usd),
    agent_credit_usd: money(row.agent_credit_usd),
    not_on_card_usd: money(row.not_on_card_usd),
    short_usd: money(row.short_usd),
    board_test_usd: money(row.board_test_usd),
    reconciled_at: row.reconciled_at ?? null,
    last_run_ok: row.last_run_ok ?? null,
    funding_order: (row.funding_order ?? []).map((place) => ({ card_id: place.card_id, room_usd: money(place.room_usd) })),
  };
}

function stoppedFrom(row: StoppedRow): StoppedCard {
  if (row.stage !== 'paused' && row.stage !== 'rejected') throw new Error(`Unexpected stopped stage: ${row.stage}`);
  return {
    card_id: row.card_id,
    title: row.title,
    stage: row.stage,
    failing_check: row.failing_check ?? null,
    spent_usd: money(row.spent_usd),
    funded_usd: money(row.funded_usd),
    credited_usd: money(row.credited_usd),
    moved: (row.moved ?? []).map((move) => ({ to_card_id: move.to_card_id ?? null, to_title: move.to_title ?? null, usd: money(move.usd) })),
    stopped_at: row.stopped_at,
  };
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

      const [pool, cardRows, funding, spend, studio, totals, events, deploys, roles, books, stopped] = await Promise.all([
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
            // Every column of the view, which holds public columns only: a column it gains (platform_lane_open)
            // is read when present and a database without it still loads the pause and the launch.
            const row = unwrap(
              await client.from('public_studio').select('*').abortSignal(timeout()).maybeSingle<StudioRow>(),
            );
            const paused = row?.paused === true;
            return {
              launchedAt: row?.launched_at ?? null,
              paused,
              platformLaneOpen: row?.platform_lane_open === true,
              pauseReason: paused ? (row?.pause_reason ?? null) : null,
            };
          },
          { launchedAt: null, paused: false, platformLaneOpen: false, pauseReason: null as string | null },
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
        optional(
          'money',
          async () =>
            moneyFrom(unwrap(await client.from('public_money').select(MONEY_COLUMNS).abortSignal(timeout()).maybeSingle<MoneyRow>())),
          null as Money | null,
        ),
        optional(
          'stopped',
          async () =>
            (
              unwrap(
                await client
                  .from('public_stopped_cards')
                  .select(STOPPED_COLUMNS)
                  .order('stopped_at', { ascending: false })
                  .limit(STOPPED_LIMIT)
                  .abortSignal(timeout())
                  .returns<StoppedRow[]>(),
              ) ?? []
            ).map(stoppedFrom),
          [] as StoppedCard[],
        ),
      ]);
      const cardTitles = await optional('cardTitles', () => loadCardTitles(client, distinctCardIds(events), timeout()), {});
      return {
        pool,
        cards: cardRows.map((row) => cardFrom(row, spend)),
        funding,
        launchedAt: studio.launchedAt,
        paused: studio.paused,
        platformLaneOpen: studio.platformLaneOpen,
        pauseReason: studio.pauseReason,
        totals,
        events,
        deploys,
        roles,
        cardTitles,
        money: books,
        stopped,
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
