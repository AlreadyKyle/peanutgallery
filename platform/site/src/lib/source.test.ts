import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  CARD_STAGES,
  createSupabaseSource,
  DEPLOY_LIMIT,
  ENRICHMENTS,
  EVENT_LIMIT,
  QUERY_TIMEOUT_MS,
  REALTIME_LISTENERS,
  type Snapshot,
} from './source';

type Query = {
  table: string;
  select: string;
  filters: string[];
  orders: { column: string; ascending: boolean }[];
  limit: number | null;
  terminal: string;
  signal: AbortSignal | null;
};

type Listener = { table: string; filter: string | null };
type Channel = { topic: string; listeners: Listener[]; subscribed: number };

type Rows = Record<string, unknown>;

function rowsFor(query: Query): unknown {
  switch (query.table) {
    case 'pool':
      return {
        balance_usd: '48.5600',
        reserve_usd: '7.1000',
        incident_reserve_usd: '2.5600',
        held_usd: '0.0000',
        daily_spent_usd: '0.0000',
        day: '2026-09-14',
      };
    case 'cards':
      if (query.filters.some((f) => f.startsWith('in id'))) {
        return [{ id: 'c1', title: 'Week 1: the loop' }];
      }
      return [
        {
          id: 'c1',
          title: 'Week 1: the loop',
          summary: 'The first playable loop.',
          intent: 'Build the core loop.',
          source: 'board',
          stage: 'voted',
          shape: 'goal',
          bucket: 'game',
          folder: 'seed-1',
          funding_target_usd: '100.0000',
          funded_usd: '25.0000',
          created_at: '2026-09-14T00:00:00Z',
          updated_at: '2026-09-14T02:00:00Z',
          live_at: null,
        },
      ];
    case 'public_card_spend':
      return [{ card_id: 'c1', spent_usd: '0.4200' }];
    case 'public_card_funding':
      return [{ card_id: 'c1', contributors: '3', credited_usd: '18.5000' }];
    case 'public_studio':
      return { launched_at: '2026-09-20T00:00:00Z' };
    case 'public_ledger_totals':
      return {
        usd_total: '1.2500',
        input_tokens: '12000',
        cached_tokens: '3000',
        output_tokens: '800',
        row_count: '3',
      };
    case 'public_agent_events':
      return [
        { id: 'e1', card_id: 'c1', role_id: 'r1', type: 'start', created_at: '2026-09-14T01:00:00Z' },
        { id: 'e2', card_id: 'c1', role_id: null, type: 'ship', created_at: '2026-09-14T01:05:00Z' },
        { id: 'e3', card_id: null, role_id: 'r1', type: 'error', created_at: '2026-09-14T01:06:00Z' },
      ];
    case 'deploys':
      return [];
    case 'roles':
      return [{ id: 'r1', title: 'Builder A', write_access: true, state: 'active' }];
    default:
      throw new Error(`Unexpected table ${query.table}`);
  }
}

function fakeClient(
  options: {
    events?: unknown[];
    failTable?: string;
    failTitles?: boolean;
    /** A table whose query never answers; it settles only when its signal aborts, as supabase-js does. */
    hangTable?: string;
    rows?: Record<string, unknown>;
  } = {},
) {
  const queries: Query[] = [];
  const channels: Channel[] = [];
  const removed: string[] = [];

  function from(table: string) {
    const query: Query = { table, select: '', filters: [], orders: [], limit: null, terminal: '', signal: null };
    queries.push(query);
    const resolve = () => {
      if (table === options.hangTable) {
        // supabase-js reports an aborted request as an error result, not a rejection.
        return new Promise((settle) => {
          query.signal?.addEventListener('abort', () =>
            settle({ data: null, error: { message: 'AbortError: signal is aborted without reason' } }),
          );
        });
      }
      const titles = table === 'cards' && query.filters.some((f) => f.startsWith('in id'));
      if (table === options.failTable || (options.failTitles === true && titles)) {
        return Promise.resolve({ data: null, error: { message: `${table} is unavailable` } });
      }
      const data =
        options.rows !== undefined && table in options.rows
          ? options.rows[table]
          : table === 'public_agent_events' && options.events !== undefined
            ? options.events
            : rowsFor(query);
      return Promise.resolve({ data, error: null });
    };
    const builder = {
      select(columns: string) {
        query.select = columns;
        return builder;
      },
      eq(column: string, value: unknown) {
        query.filters.push(`eq ${column} ${String(value)}`);
        return builder;
      },
      in(column: string, values: string[]) {
        query.filters.push(`in ${column} ${values.join(',')}`);
        return builder;
      },
      order(column: string, opts: { ascending: boolean }) {
        query.orders.push({ column, ascending: opts.ascending });
        return builder;
      },
      limit(count: number) {
        query.limit = count;
        return builder;
      },
      abortSignal(signal: AbortSignal) {
        query.signal = signal;
        return builder;
      },
      maybeSingle() {
        query.terminal = 'maybeSingle';
        return resolve();
      },
      returns() {
        query.terminal = 'returns';
        return resolve();
      },
    };
    return builder;
  }

  function channel(topic: string) {
    const record: Channel = { topic, listeners: [], subscribed: 0 };
    channels.push(record);
    const chan = {
      topic,
      on(_type: string, spec: Rows, _callback: () => void) {
        record.listeners.push({
          table: String(spec.table),
          filter: typeof spec.filter === 'string' ? spec.filter : null,
        });
        return chan;
      },
      subscribe() {
        record.subscribed += 1;
        return chan;
      },
    };
    return chan;
  }

  const client = {
    from,
    channel,
    removeChannel(chan: { topic: string }) {
      removed.push(chan.topic);
      return Promise.resolve('ok');
    },
  };

  return { client: client as unknown as SupabaseClient, queries, channels, removed };
}

function emptyQuery(table: string): Query {
  return { table, select: '', filters: [], orders: [], limit: null, terminal: '', signal: null };
}

function query(queries: Query[], table: string, index = 0): Query {
  const match = queries.filter((q) => q.table === table)[index];
  if (match === undefined) throw new Error(`No query ${index} on ${table}`);
  return match;
}

describe('createSupabaseSource.load', () => {
  it('reads the contract tables and views with the contract shapes', async () => {
    const fake = fakeClient();
    const snapshot = await createSupabaseSource(fake.client).load();

    const pool = query(fake.queries, 'pool');
    expect(pool.select).toBe('balance_usd,reserve_usd,incident_reserve_usd,held_usd,daily_spent_usd,day');
    expect(pool.filters).toEqual(['eq id 1']);
    expect(pool.terminal).toBe('maybeSingle');

    const cards = query(fake.queries, 'cards');
    expect(cards.select).toBe(
      'id,title,summary,intent,source,stage,shape,bucket,folder,funding_target_usd,funded_usd,created_at,updated_at,live_at',
    );
    expect([...CARD_STAGES]).toEqual(['proposed', 'designing', 'voted', 'funded', 'building', 'gated', 'live']);
    expect(cards.filters).toEqual([`in stage ${CARD_STAGES.join(',')}`]);
    expect(cards.orders).toEqual([{ column: 'created_at', ascending: true }]);

    const funding = query(fake.queries, 'public_card_funding');
    expect(funding.select).toBe('card_id,contributors,credited_usd');
    expect(funding.terminal).toBe('returns');

    const spend = query(fake.queries, 'public_card_spend');
    expect(spend.select).toBe('card_id,spent_usd');
    expect(spend.terminal).toBe('returns');

    const studio = query(fake.queries, 'public_studio');
    expect(studio.select).toBe('launched_at');
    expect(studio.terminal).toBe('maybeSingle');

    expect(query(fake.queries, 'public_ledger_totals').terminal).toBe('maybeSingle');

    const events = query(fake.queries, 'public_agent_events');
    expect(events.select).toBe('id,card_id,role_id,type,created_at');
    expect(events.orders).toEqual([{ column: 'created_at', ascending: false }]);
    expect(events.limit).toBe(EVENT_LIMIT);

    const deploys = query(fake.queries, 'deploys');
    expect(deploys.select).toBe('id,folder,sha,is_green,smoke_result,created_at');
    expect(deploys.orders).toEqual([{ column: 'created_at', ascending: false }]);
    expect(deploys.limit).toBe(DEPLOY_LIMIT);

    const roles = query(fake.queries, 'roles');
    expect(roles.select).toBe('id,title,write_access,state');
    expect(roles.orders).toEqual([
      { column: 'hired_at', ascending: true },
      { column: 'title', ascending: true },
    ]);

    expect(snapshot.pool).toEqual({
      balance_usd: 48.56,
      reserve_usd: 7.1,
      incident_reserve_usd: 2.56,
      held_usd: 0,
      daily_spent_usd: 0,
      day: '2026-09-14',
    });
    expect(snapshot.cards).toEqual([
      {
        id: 'c1',
        title: 'Week 1: the loop',
        summary: 'The first playable loop.',
        intent: 'Build the core loop.',
        source: 'board',
        stage: 'voted',
        shape: 'goal',
        bucket: 'game',
        folder: 'seed-1',
        funding_target_usd: 100,
        funded_usd: 25,
        spent_usd: 0.42,
        created_at: '2026-09-14T00:00:00Z',
        updated_at: '2026-09-14T02:00:00Z',
        live_at: null,
      },
    ]);
    expect(snapshot.funding).toEqual({ c1: { contributors: 3, credited_usd: 18.5 } });
    expect(snapshot.launchedAt).toBe('2026-09-20T00:00:00Z');
    expect(snapshot.totals).toEqual({
      usd_total: 1.25,
      input_tokens: 12000,
      cached_tokens: 3000,
      output_tokens: 800,
      row_count: 3,
    });
    expect(snapshot.events).toHaveLength(3);
    expect(snapshot.roles).toEqual([{ id: 'r1', title: 'Builder A', write_access: true, state: 'active' }]);
    expect(snapshot.missing).toEqual([]);
    // Every query, the title lookup included, carries a timeout signal.
    expect(fake.queries.map((q) => [q.table, q.signal instanceof AbortSignal])).toEqual(
      fake.queries.map((q) => [q.table, true]),
    );
  });

  it('fetches titles only for the distinct card ids in the loaded events', async () => {
    const fake = fakeClient();
    const snapshot = await createSupabaseSource(fake.client).load();
    const titles = query(fake.queries, 'cards', 1);
    expect(titles.select).toBe('id,title');
    expect(titles.filters).toEqual(['in id c1']);
    expect(snapshot.cardTitles).toEqual({ c1: 'Week 1: the loop' });
  });

  it('skips the title query when no event names a card', async () => {
    const fake = fakeClient({ events: [] });
    const snapshot = await createSupabaseSource(fake.client).load();
    expect(fake.queries.filter((q) => q.table === 'cards')).toHaveLength(1);
    expect(snapshot.cardTitles).toEqual({});
  });

  it('rejects with the database error message when the pool fails', async () => {
    const fake = fakeClient({ failTable: 'pool' });
    await expect(createSupabaseSource(fake.client).load()).rejects.toThrow('pool is unavailable');
  });

  it('aborts a request that never answers through supabase-js itself, and rejects the load', async () => {
    // A fetch that never responds and, like the browser's, rejects with the signal's reason on abort.
    const hung = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null) return;
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason));
      });
    const client = createClient('https://example.supabase.co', 'sb_publishable_test', {
      global: { fetch: hung },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await expect(createSupabaseSource(client, { timeoutMs: 20 }).load()).rejects.toThrow(/TimeoutError|AbortError/);
  });

  it('rejects when a core query never answers, once its timeout aborts it', async () => {
    const fake = fakeClient({ hangTable: 'pool' });
    await expect(createSupabaseSource(fake.client, { timeoutMs: 20 }).load()).rejects.toThrow('AbortError');
  });

  it('names an enrichment as missing when its query never answers, once its timeout aborts it', async () => {
    const fake = fakeClient({ hangTable: 'deploys' });
    const snapshot = await createSupabaseSource(fake.client, { timeoutMs: 20 }).load();
    expect(snapshot.missing).toEqual(['deploys']);
    expect(snapshot.deploys).toEqual([]);
    expect(snapshot.pool?.balance_usd).toBe(48.56);
  });

  it('times each query out after ten seconds by default', () => {
    expect(QUERY_TIMEOUT_MS).toBe(10_000);
  });

  it('rejects when the cards fail', async () => {
    const fake = fakeClient({ failTable: 'cards' });
    await expect(createSupabaseSource(fake.client).load()).rejects.toThrow('cards is unavailable');
  });

  it('rejects when a pool figure is malformed', async () => {
    const fake = fakeClient({ rows: { pool: { ...(rowsFor(emptyQuery('pool')) as object), balance_usd: 'abc' } } });
    await expect(createSupabaseSource(fake.client).load()).rejects.toThrow('Malformed numeric value: abc');
  });

  it('names every enrichment the site reads', () => {
    expect([...ENRICHMENTS]).toEqual(['funding', 'spend', 'studio', 'totals', 'events', 'deploys', 'roles', 'cardTitles']);
  });

  // Each enrichment, the table or view it reads, and the empty value the snapshot falls back to.
  const enrichments: [string, string, (snapshot: Snapshot) => void][] = [
    ['funding', 'public_card_funding', (s) => expect(s.funding).toEqual({})],
    ['spend', 'public_card_spend', (s) => expect(s.cards[0]?.spent_usd).toBe(0)],
    ['studio', 'public_studio', (s) => expect(s.launchedAt).toBeNull()],
    ['totals', 'public_ledger_totals', (s) => expect(s.totals.usd_total).toBe(0)],
    [
      'events',
      'public_agent_events',
      (s) => {
        expect(s.events).toEqual([]);
        expect(s.cardTitles).toEqual({});
      },
    ],
    ['deploys', 'deploys', (s) => expect(s.deploys).toEqual([])],
    ['roles', 'roles', (s) => expect(s.roles).toEqual([])],
  ];

  for (const [name, table, fallback] of enrichments) {
    it(`keeps the pool and the cards and names ${name} as missing when ${table} fails`, async () => {
      const fake = fakeClient({ failTable: table });
      const snapshot = await createSupabaseSource(fake.client).load();
      expect(snapshot.missing).toEqual([name]);
      expect(snapshot.pool?.balance_usd).toBe(48.56);
      expect(snapshot.cards.map((card) => card.id)).toEqual(['c1']);
      fallback(snapshot);
    });
  }

  it('names an enrichment as missing when one of its figures is malformed', async () => {
    const fake = fakeClient({ rows: { public_card_funding: [{ card_id: 'c1', contributors: 'abc', credited_usd: '1.0000' }] } });
    const snapshot = await createSupabaseSource(fake.client).load();
    expect(snapshot.missing).toEqual(['funding']);
    expect(snapshot.funding).toEqual({});
  });

  it('names the card titles as missing when the title query fails', async () => {
    const fake = fakeClient({ failTitles: true });
    const snapshot = await createSupabaseSource(fake.client).load();
    expect(snapshot.missing).toEqual(['cardTitles']);
    expect(snapshot.cardTitles).toEqual({});
    expect(snapshot.events).toHaveLength(3);
  });

  it('lists several missing parts in a fixed order', async () => {
    const fake = fakeClient({
      rows: {
        public_ledger_totals: { usd_total: 'x', input_tokens: '0', cached_tokens: '0', output_tokens: '0', row_count: '0' },
        public_card_funding: [{ card_id: 'c1', contributors: 'y', credited_usd: '0' }],
      },
    });
    const snapshot = await createSupabaseSource(fake.client).load();
    expect(snapshot.missing).toEqual(['funding', 'totals']);
  });
});

describe('createSupabaseSource.subscribe', () => {
  it('joins a fresh channel on every subscription and listens to the published tables', () => {
    const expected: Listener[] = [
      { table: 'pool', filter: null },
      { table: 'cards', filter: null },
      { table: 'deploys', filter: null },
    ];
    expect(REALTIME_LISTENERS.map((l) => l.table)).toEqual(expected.map((l) => l.table));
    const fake = fakeClient();
    const source = createSupabaseSource(fake.client);
    const onChange = () => {};

    const first = source.subscribe(onChange);
    first();
    source.subscribe(onChange);

    expect(fake.channels).toHaveLength(2);
    const [a, b] = fake.channels;
    expect(a?.topic).not.toBe(b?.topic);
    expect(a?.subscribed).toBe(1);
    expect(b?.subscribed).toBe(1);
    expect(a?.listeners).toEqual(expected);
    expect(b?.listeners).toEqual(expected);
    expect(fake.removed).toEqual([a?.topic]);
  });
});
