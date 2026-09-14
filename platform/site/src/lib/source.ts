import type { SupabaseClient } from '@supabase/supabase-js';
import { toNumber, type Numeric } from './format';

export type Pool = {
  balance_usd: number;
  reserve_usd: number;
  incident_reserve_usd: number;
  daily_spent_usd: number;
  day: string;
};

export type Card = {
  id: string;
  title: string;
  intent: string | null;
  source: string;
  stage: string;
  shape: string;
  funding_target_usd: number;
  funded_usd: number;
  actual_usd: number;
  created_at: string;
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

export type Deploy = {
  id: string;
  folder: string;
  sha: string;
  is_green: boolean;
  smoke_result: string | null;
  created_at: string;
};

export type Role = {
  id: string;
  title: string;
  write_access: boolean;
  state: string;
};

export type Snapshot = {
  pool: Pool | null;
  cards: Card[];
  funding: Record<string, CardFunding>;
  launchedAt: string | null;
  totals: LedgerTotals;
  events: AgentEvent[];
  deploys: Deploy[];
  roles: Role[];
  cardTitles: Record<string, string>;
};

export interface StudioSource {
  load(): Promise<Snapshot>;
  subscribe(onChange: () => void): () => void;
}

type PoolRow = {
  balance_usd: Numeric;
  reserve_usd: Numeric;
  incident_reserve_usd: Numeric;
  daily_spent_usd: Numeric;
  day: string;
};

type CardRow = {
  id: string;
  title: string;
  intent: string | null;
  source: string;
  stage: string;
  shape: string;
  funding_target_usd: Numeric;
  funded_usd: Numeric;
  actual_usd: Numeric;
  created_at: string;
};

type FundingRow = {
  card_id: string;
  contributors: Numeric;
  credited_usd: Numeric;
};

type StudioRow = {
  launched_at: string | null;
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
export const DEPLOY_LIMIT = 10;
/** The stages the site lists: Now (building, gated) and Next (the rest). */
export const CARD_STAGES = ['proposed', 'designing', 'voted', 'funded', 'building', 'gated'] as const;
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
    daily_spent_usd: money(row.daily_spent_usd),
    day: row.day,
  };
}

function cardFrom(row: CardRow): Card {
  return {
    id: row.id,
    title: row.title,
    intent: row.intent,
    source: row.source,
    stage: row.stage,
    shape: row.shape,
    funding_target_usd: money(row.funding_target_usd),
    funded_usd: money(row.funded_usd),
    actual_usd: money(row.actual_usd),
    created_at: row.created_at,
  };
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
): Promise<Record<string, string>> {
  const titles: Record<string, string> = {};
  if (ids.length === 0) return titles;
  const rows = unwrap(
    await client.from('cards').select('id,title').in('id', ids).returns<TitleRow[]>(),
  );
  for (const row of rows ?? []) titles[row.id] = row.title;
  return titles;
}

export function createSupabaseSource(client: SupabaseClient): StudioSource {
  return {
    async load() {
      const [pool, cards, funding, studio, totals, events, deploys, roles] = await Promise.all([
        client
          .from('pool')
          .select('balance_usd,reserve_usd,incident_reserve_usd,daily_spent_usd,day')
          .eq('id', 1)
          .maybeSingle<PoolRow>(),
        client
          .from('cards')
          .select(
            'id,title,intent,source,stage,shape,funding_target_usd,funded_usd,actual_usd,created_at',
          )
          .in('stage', [...CARD_STAGES])
          .order('created_at', { ascending: true })
          .returns<CardRow[]>(),
        client
          .from('public_card_funding')
          .select('card_id,contributors,credited_usd')
          .returns<FundingRow[]>(),
        client.from('public_studio').select('launched_at').maybeSingle<StudioRow>(),
        client.from('public_ledger_totals').select('*').maybeSingle<TotalsRow>(),
        client
          .from('public_agent_events')
          .select('id,card_id,role_id,type,created_at')
          .order('created_at', { ascending: false })
          .limit(EVENT_LIMIT)
          .returns<AgentEvent[]>(),
        client
          .from('deploys')
          .select('id,folder,sha,is_green,smoke_result,created_at')
          .order('created_at', { ascending: false })
          .limit(DEPLOY_LIMIT)
          .returns<Deploy[]>(),
        client
          .from('roles')
          .select('id,title,write_access,state')
          .order('hired_at', { ascending: true })
          .order('title', { ascending: true })
          .returns<Role[]>(),
      ]);
      const eventRows = unwrap(events) ?? [];
      return {
        pool: poolFrom(unwrap(pool)),
        cards: (unwrap(cards) ?? []).map(cardFrom),
        funding: fundingFrom(unwrap(funding) ?? []),
        launchedAt: unwrap(studio)?.launched_at ?? null,
        totals: totalsFrom(unwrap(totals)),
        events: eventRows,
        deploys: unwrap(deploys) ?? [],
        roles: unwrap(roles) ?? [],
        cardTitles: await loadCardTitles(client, distinctCardIds(eventRows)),
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
