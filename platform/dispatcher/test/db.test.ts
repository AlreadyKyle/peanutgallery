import { describe, expect, it } from 'vitest';
import { PAGE_ROWS, createSupabaseDb, fetchWithTimeout, toCard, type UsageInput } from '../src/db.js';
import { NOW } from './helpers/fake-db.js';
import { mockFetch } from './helpers/mock-fetch.js';

interface Seen {
  method: string;
  url: URL;
  body: unknown;
}

// A PostgREST double: records each request and answers with the given rows.
function rest(rows: unknown[]): { fetchFn: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    seen.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fetchFn, seen };
}

// A fetch that never answers and ignores its signal, like a connection that hangs.
const hang = (() => new Promise<Response>(() => undefined)) as typeof fetch;

const USAGE: UsageInput = {
  billed_to: 'studio',
  card_id: null,
  role_id: null,
  model: 'builder-class',
  input_tokens: 1000,
  cached_tokens: 0,
  output_tokens: 100,
  usd: 0.0045,
  request_id: 'probe/run-1/turn/1',
};

describe('fetchWithTimeout', () => {
  it('rejects a request that never answers once the timeout passes', async () => {
    const started = Date.now();
    await expect(fetchWithTimeout(hang, 30)('https://db.local/rest/v1/pool')).rejects.toThrow(/timeout|timed out|aborted/i);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('aborts the request when the caller signal aborts first', async () => {
    let passed: AbortSignal | null = null;
    const capture = ((_input: string | URL | Request, init?: RequestInit) => {
      passed = init?.signal ?? null;
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;
    const caller = new AbortController();
    const pending = fetchWithTimeout(capture, 60_000)('https://db.local/rest/v1/pool', { signal: caller.signal });
    caller.abort(new Error('caller gave up'));
    await expect(pending).rejects.toThrow('caller gave up');
    expect((passed as AbortSignal | null)?.aborted).toBe(true);
  });
});

describe('createSupabaseDb', () => {
  it('gives up on a record_usage that never answers', async () => {
    const db = createSupabaseDb('https://db.local', 'service-role', { fetchFn: hang, timeoutMs: 30 });
    await expect(db.recordUsage(USAGE)).rejects.toThrow('db record_usage');
  });

  it('passes the request id to record_usage', async () => {
    const { fetchFn, calls } = mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/rest/v1/rpc/record_usage')
        ? { status: 200, json: { ledger_id: 'ledger-1', balance_usd: 10, daily_spent_usd: 0.0045, actual_usd: null } }
        : undefined,
    );
    const db = createSupabaseDb('https://db.local', 'service-role', { fetchFn });
    await expect(db.recordUsage(USAGE)).resolves.toMatchObject({ ledger_id: 'ledger-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      p_card_id: null,
      p_role_id: null,
      p_model: 'builder-class',
      p_input_tokens: 1000,
      p_cached_tokens: 0,
      p_output_tokens: 100,
      p_usd: 0.0045,
      p_billed_to: 'studio',
      p_request_id: 'probe/run-1/turn/1',
    });
  });
});

describe('createSupabaseDb queries', () => {
  it('counts only a board member with the board role as a board session', async () => {
    const empty = rest([]);
    const db = createSupabaseDb('https://db.local', 'service-role', { fetchFn: empty.fetchFn });
    expect(await db.boardSessionActive(3, NOW)).toBe(false);
    const request = empty.seen[0]!;
    expect(request.url.pathname).toBe('/rest/v1/board_members');
    expect(request.url.searchParams.getAll('role')).toEqual(['eq.board']);
    expect(request.url.searchParams.get('last_seen_at')).toBe(`gte.${new Date(NOW.getTime() - 3 * 60_000).toISOString()}`);

    const member = rest([{ email: 'board@example.com' }]);
    expect(await createSupabaseDb('https://db.local', 'service-role', { fetchFn: member.fetchFn }).boardSessionActive(3, NOW)).toBe(true);
  });

  it("finds a card's newest event by its payload step", async () => {
    const { fetchFn, seen } = rest([{ payload_json: { step: 'smoke_pass', sha: 'merge-sha' } }]);
    const db = createSupabaseDb('https://db.local', 'service-role', { fetchFn });
    expect(await db.findEvent('card-1', 'smoke_pass')).toEqual({ step: 'smoke_pass', sha: 'merge-sha' });
    const url = seen[0]!.url;
    expect(url.pathname).toBe('/rest/v1/agent_events');
    expect(url.searchParams.get('card_id')).toBe('eq.card-1');
    expect(url.searchParams.get('payload_json->>step')).toBe('eq.smoke_pass');
    expect(url.searchParams.get('order')).toBe('created_at.desc');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(await createSupabaseDb('https://db.local', 'service-role', { fetchFn: rest([]).fetchFn }).findEvent('card-1', 'smoke_pass')).toBeNull();
  });

  it('writes a stage only while the card is in an expected stage, and says whether it did', async () => {
    const hit = rest([{ id: 'card-1' }]);
    const db = createSupabaseDb('https://db.local', 'service-role', { fetchFn: hit.fetchFn });
    expect(await db.updateCardIf('card-1', ['building', 'gated'], { stage: 'paused', failing_check: 'ceiling' })).toBe(true);
    expect(hit.seen[0]?.method).toBe('PATCH');
    expect(hit.seen[0]?.url.pathname).toBe('/rest/v1/cards');
    expect(hit.seen[0]?.url.searchParams.get('id')).toBe('eq.card-1');
    expect(hit.seen[0]?.url.searchParams.get('stage')).toBe('in.(building,gated)');
    expect(hit.seen[0]?.body).toEqual({ stage: 'paused', failing_check: 'ceiling' });
    const miss = rest([]);
    expect(await createSupabaseDb('https://db.local', 'service-role', { fetchFn: miss.fetchFn }).updateCardIf('card-1', ['gated'], { stage: 'live' })).toBe(false);
  });

  it('claims and releases the dispatcher lease through its functions', async () => {
    const { fetchFn, calls } = mockFetch((method, url) => {
      if (method === 'POST' && url.endsWith('/rest/v1/rpc/claim_dispatcher_lease')) return { status: 200, json: false };
      if (method === 'POST' && url.endsWith('/rest/v1/rpc/release_dispatcher_lease')) return { status: 200, json: null };
      return undefined;
    });
    const db = createSupabaseDb('https://db.local', 'service-role', { fetchFn });
    expect(await db.claimLease('mac/123/abcd', 300)).toBe(false);
    await db.releaseLease('mac/123/abcd');
    expect(calls.map((call) => call.body)).toEqual([{ p_holder: 'mac/123/abcd', p_ttl_seconds: 300 }, { p_holder: 'mac/123/abcd' }]);
    const granted = mockFetch((method, url) => (method === 'POST' && url.endsWith('/rpc/claim_dispatcher_lease') ? { status: 200, json: true } : undefined));
    expect(await createSupabaseDb('https://db.local', 'service-role', { fetchFn: granted.fetchFn }).claimLease('vps/1/ffff', 300)).toBe(true);
  });

  it('pauses the studio only when it is not paused already, naming the dispatcher', async () => {
    const { fetchFn, seen } = rest([]);
    await createSupabaseDb('https://db.local', 'service-role', { fetchFn }).pauseStudio('dispatcher: Console credit needed (card 4c2f5a1e)', NOW);
    expect(seen[0]?.method).toBe('PATCH');
    expect(seen[0]?.url.pathname).toBe('/rest/v1/studio_state');
    expect(seen[0]?.url.searchParams.get('id')).toBe('eq.1');
    expect(seen[0]?.url.searchParams.get('paused')).toBe('eq.false');
    expect(seen[0]?.body).toEqual({ paused: true, paused_by: 'dispatcher: Console credit needed (card 4c2f5a1e)', paused_at: NOW.toISOString() });
  });

  it("reads each card's studio-billed spend from public_card_spend, and asks nothing for no cards", async () => {
    const { fetchFn, seen } = rest([{ card_id: 'a', spent_usd: '1.2500' }]);
    const db = createSupabaseDb('https://db.local', 'service-role', { fetchFn });
    expect(await db.cardSpend(['a', 'b'])).toEqual(new Map([['a', 1.25]]));
    expect(seen[0]?.url.pathname).toBe('/rest/v1/public_card_spend');
    expect(seen[0]?.url.searchParams.get('card_id')).toBe('in.(a,b)');
    expect(await db.cardSpend([])).toEqual(new Map());
    expect(seen).toHaveLength(1);
  });

  it('sums every page of the Console credit bought and of the studio and overhead ledger', async () => {
    const seen: URL[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      seen.push(url);
      const first = (url.searchParams.get('offset') ?? '0') === '0';
      const rows =
        url.pathname === '/rest/v1/credit_purchases'
          ? first
            ? Array.from({ length: PAGE_ROWS }, () => ({ amount_usd: '0.0100' }))
            : [{ amount_usd: '5' }]
          : first
            ? Array.from({ length: PAGE_ROWS }, (_row, i) => ({ usd: '0.0010', created_at: i === 0 ? '2026-08-31T12:00:00.000Z' : '2026-09-02T12:00:00.000Z' }))
            : [{ usd: '2', created_at: '2026-09-10T12:00:00.000Z' }];
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const db = createSupabaseDb('https://db.local', 'service-role', { fetchFn });
    expect(await db.creditPurchasedUsd()).toBe(15);
    expect(await db.studioSpend(new Date('2026-09-01T04:00:00.000Z'))).toEqual({ totalUsd: 3, sinceUsd: 2.999 });
    const ledger = seen.filter((url) => url.pathname === '/rest/v1/ledger');
    expect(ledger).toHaveLength(2);
    expect(ledger[0]?.searchParams.get('billed_to')).toBe('in.(studio,overhead)');
    expect(ledger.map((url) => [url.searchParams.get('offset'), url.searchParams.get('limit')])).toEqual([
      ['0', String(PAGE_ROWS)],
      [String(PAGE_ROWS), String(PAGE_ROWS)],
    ]);
  });

  it('reads a card with no horizon column as horizon now, and a studio with no monthly cap as null', async () => {
    expect(toCard({ id: 'a', funded_usd: '2.5000' })).toMatchObject({ horizon: 'now', funded_usd: 2.5 });
    expect(toCard({ id: 'a', horizon: 'later' }).horizon).toBe('later');
    const state = mockFetch((method, url) => (method === 'GET' && url.includes('/rest/v1/studio_state') ? { status: 200, json: { paused: false, agent_mode: 'attended', daily_cap_usd: 100 } } : undefined));
    expect((await createSupabaseDb('https://db.local', 'service-role', { fetchFn: state.fetchFn }).getStudioState()).monthly_cap_usd).toBeNull();
    const capped = mockFetch((method, url) => (method === 'GET' && url.includes('/rest/v1/studio_state') ? { status: 200, json: { paused: false, monthly_cap_usd: '500.0000' } } : undefined));
    expect((await createSupabaseDb('https://db.local', 'service-role', { fetchFn: capped.fetchFn }).getStudioState()).monthly_cap_usd).toBe(500);
  });

  it('clears commit_sha when it claims a card', async () => {
    const { fetchFn, seen } = rest([]);
    const db = createSupabaseDb('https://db.local', 'service-role', { fetchFn });
    expect(await db.claimCard('card-1')).toBeNull();
    expect(seen[0]?.method).toBe('PATCH');
    expect(seen[0]?.body).toEqual({ stage: 'building', commit_sha: null });
    expect(seen[0]?.url.searchParams.get('stage')).toBe('eq.funded');
  });
});
