import { describe, expect, it } from 'vitest';
import { createSupabaseDb, fetchWithTimeout, toCard, type UsageInput } from '../src/db.js';
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

  it('pauses the studio only when it is not paused already, naming the dispatcher and the reason', async () => {
    const { fetchFn, seen } = rest([]);
    await createSupabaseDb('https://db.local', 'service-role', { fetchFn }).pauseStudio('dispatcher: Console credit needed (card 4c2f5a1e)', NOW, 'awaiting_credit');
    expect(seen[0]?.method).toBe('PATCH');
    expect(seen[0]?.url.pathname).toBe('/rest/v1/studio_state');
    expect(seen[0]?.url.searchParams.get('id')).toBe('eq.1');
    expect(seen[0]?.url.searchParams.get('paused')).toBe('eq.false');
    expect(seen[0]?.body).toEqual({ paused: true, paused_by: 'dispatcher: Console credit needed (card 4c2f5a1e)', paused_at: NOW.toISOString(), pause_reason: 'awaiting_credit' });
  });

  it('reads the cards a tick chooses from dispatcher_cards, with the approval, the vetoes and the executor pause', async () => {
    const { fetchFn, seen } = rest([{ id: 'a', stage: 'funded', source: 'agent', needs_approval: true, approved: false, board_vetoed: true, executor_paused: true }]);
    const cards = await createSupabaseDb('https://db.local', 'service-role', { fetchFn }).listCardsInStages(['funded', 'building']);
    expect(seen[0]?.url.pathname).toBe('/rest/v1/dispatcher_cards');
    expect(seen[0]?.url.searchParams.get('stage')).toBe('in.(funded,building)');
    expect(cards[0]).toMatchObject({ id: 'a', needs_approval: true, approved: false, board_vetoed: true, executor_paused: true });
    // A card read from cards itself reads the three view columns as false.
    const plain = await createSupabaseDb('https://db.local', 'service-role', { fetchFn: rest([{ id: 'b', stage: 'funded' }]).fetchFn }).getCard('b');
    expect(plain).toMatchObject({ needs_approval: false, approved: false, board_vetoed: false, executor_paused: false });
  });

  it("reads startup recovery's building and gated cards from dispatcher_cards, which holds every stage", async () => {
    const { fetchFn, seen } = rest([{ id: 'g', stage: 'gated', commit_sha: null, failing_check: 'merge_unknown' }]);
    const cards = await createSupabaseDb('https://db.local', 'service-role', { fetchFn }).listCardsInStages(['building', 'gated']);
    expect(seen[0]?.url.pathname).toBe('/rest/v1/dispatcher_cards');
    expect(seen[0]?.url.searchParams.get('stage')).toBe('in.(building,gated)');
    expect(cards.map((c) => [c.id, c.stage])).toEqual([['g', 'gated']]);
  });

  it('calls the job queue and card functions with their arguments', async () => {
    const { fetchFn, calls } = mockFetch((method, url) => {
      if (method !== 'POST') return undefined;
      if (url.endsWith('/rpc/deal_due_cards')) return { status: 200, json: ['card-1', 'card-2'] };
      if (url.endsWith('/rpc/resume_due_by_rule')) return { status: 200, json: { resumed: 1, results: [{ card_id: 'card-3', resumed: true }] } };
      if (url.endsWith('/rpc/enqueue_job_run')) return { status: 200, json: { id: 'run-1', created: true } };
      if (url.endsWith('/rpc/claim_job_run')) return { status: 200, json: true };
      if (url.endsWith('/rpc/finish_job_run')) return { status: 200, json: null };
      if (url.endsWith('/rpc/fail_running_job_runs')) return { status: 200, json: 2 };
      return undefined;
    });
    const db = createSupabaseDb('https://db.local', 'service-role', { fetchFn });
    expect(await db.dealDueCards()).toEqual(['card-1', 'card-2']);
    expect(await db.resumeDueByRule()).toEqual({ resumed: 1, results: [{ card_id: 'card-3', resumed: true }] });
    expect(await db.enqueueJobRun({ job: 'tidy_up', origin: 'event', parentRunId: 'run-0' })).toEqual({ id: 'run-1', created: true });
    expect(await db.claimJobRun('run-1', 'mac/1/abcd')).toBe(true);
    await db.finishJobRun('run-1', 'skipped', 'role_paused', null);
    expect(await db.failRunningJobRuns('mac/1/abcd', 'dispatcher_restart')).toBe(2);
    expect(calls.map((call) => call.body)).toEqual([
      {},
      {},
      { p_job: 'tidy_up', p_origin: 'event', p_key: null, p_card: null, p_input: {}, p_parent: 'run-0' },
      { p_run: 'run-1', p_holder: 'mac/1/abcd' },
      { p_run: 'run-1', p_status: 'skipped', p_reason: 'role_paused', p_output: null },
      { p_holder: 'mac/1/abcd', p_reason: 'dispatcher_restart' },
    ]);
  });

  it('reads the oldest queued runs first, the jobs and a role\'s pause', async () => {
    const queued = rest([{ id: 'run-1', job_name: 'tidy_up', origin: 'board', status: 'queued', card_id: null, input: { floor: 3 }, parent_run_id: null, created_at: NOW.toISOString() }]);
    const runs = await createSupabaseDb('https://db.local', 'service-role', { fetchFn: queued.fetchFn }).queuedRuns(50);
    expect(runs).toEqual([{ id: 'run-1', job_name: 'tidy_up', origin: 'board', status: 'queued', card_id: null, input: { floor: 3 }, parent_run_id: null, created_at: NOW.toISOString() }]);
    expect(queued.seen[0]?.url.pathname).toBe('/rest/v1/job_runs');
    expect(queued.seen[0]?.url.searchParams.get('status')).toBe('eq.queued');
    expect(queued.seen[0]?.url.searchParams.get('order')).toBe('created_at.asc,id.asc');
    expect(queued.seen[0]?.url.searchParams.get('limit')).toBe('50');
    const jobs = rest([{ name: 'tidy_up', role_id: null, calls_model: false, runs_when_paused: true }]);
    expect(await createSupabaseDb('https://db.local', 'service-role', { fetchFn: jobs.fetchFn }).jobs()).toEqual([{ name: 'tidy_up', role_id: null, calls_model: false, runs_when_paused: true }]);
    const state = mockFetch((method, url) => (method === 'GET' && url.includes('/rest/v1/roles') ? { status: 200, json: { paused: true, state: 'active' } } : undefined));
    expect(await createSupabaseDb('https://db.local', 'service-role', { fetchFn: state.fetchFn }).roleState('role-1')).toEqual({ paused: true, state: 'active' });
    expect(state.calls[0]?.url).toContain('id=eq.role-1');
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

  it('reads the Console credit bought and the studio spend totals from one database function, never the ledger rows', async () => {
    const { fetchFn, calls } = mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/rest/v1/rpc/studio_spend_totals')
        ? { status: 200, json: { credit_purchased_usd: 15, spent_usd: 3.00004, month_usd: '2.9990', tier_usd: 2.5 } }
        : undefined,
    );
    const db = createSupabaseDb('https://db.local', 'service-role', { fetchFn });
    const monthStart = new Date('2026-09-01T04:00:00.000Z');
    const tierStart = new Date('2026-09-01T00:00:00.000Z');
    expect(await db.spendTotals(monthStart, tierStart)).toEqual({ creditPurchasedUsd: 15, spentUsd: 3, monthUsd: 2.999, tierUsd: 2.5 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ p_month_start: '2026-09-01T04:00:00.000Z', p_tier_start: '2026-09-01T00:00:00.000Z' });
    expect(calls.some((call) => call.url.includes('/rest/v1/ledger') || call.url.includes('/rest/v1/credit_purchases'))).toBe(false);
  });

  it('refuses spend totals the function did not return, rather than reading them as zero', async () => {
    const missing = mockFetch((method, url) => (method === 'POST' && url.endsWith('/rpc/studio_spend_totals') ? { status: 200, json: { credit_purchased_usd: 15, spent_usd: 3, month_usd: null, tier_usd: 1 } } : undefined));
    await expect(createSupabaseDb('https://db.local', 'service-role', { fetchFn: missing.fetchFn }).spendTotals(NOW, NOW)).rejects.toThrow('db studio_spend_totals: no month_usd');
    const none = mockFetch((method, url) => (method === 'POST' && url.endsWith('/rpc/studio_spend_totals') ? { status: 200, text: 'null' } : undefined));
    await expect(createSupabaseDb('https://db.local', 'service-role', { fetchFn: none.fetchFn }).spendTotals(NOW, NOW)).rejects.toThrow('db studio_spend_totals');
    const refused = mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/rpc/studio_spend_totals') ? { status: 404, json: { code: 'PGRST202', message: 'Could not find the function public.studio_spend_totals' } } : undefined,
    );
    await expect(createSupabaseDb('https://db.local', 'service-role', { fetchFn: refused.fetchFn }).spendTotals(NOW, NOW)).rejects.toThrow(
      'db studio_spend_totals: Could not find the function public.studio_spend_totals',
    );
  });

  it("sums a card's ledger rows in the database, so a card with more rows than one answer holds is not undercounted", async () => {
    const { fetchFn, calls } = mockFetch((method, url) => (method === 'POST' && url.endsWith('/rest/v1/rpc/card_ledger_usd') ? { status: 200, json: 1234.56789 } : undefined));
    const db = createSupabaseDb('https://db.local', 'service-role', { fetchFn });
    expect(await db.sumLedger('card-1')).toBe(1234.5679);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ p_card_id: 'card-1' });
    const none = mockFetch((method, url) => (method === 'POST' && url.endsWith('/rpc/card_ledger_usd') ? { status: 200, text: 'null' } : undefined));
    await expect(createSupabaseDb('https://db.local', 'service-role', { fetchFn: none.fetchFn }).sumLedger('card-1')).rejects.toThrow('db card_ledger_usd: no usd');
  });

  it('reads a card with no horizon column as horizon now, and a studio with no monthly cap as null', async () => {
    expect(toCard({ id: 'a', funded_usd: '2.5000' })).toMatchObject({ horizon: 'now', funded_usd: 2.5 });
    expect(toCard({ id: 'a', horizon: 'later' }).horizon).toBe('later');
    const state = mockFetch((method, url) => (method === 'GET' && url.includes('/rest/v1/studio_state') ? { status: 200, json: { paused: false, agent_mode: 'attended', daily_cap_usd: 100 } } : undefined));
    expect((await createSupabaseDb('https://db.local', 'service-role', { fetchFn: state.fetchFn }).getStudioState()).monthly_cap_usd).toBeNull();
    const capped = mockFetch((method, url) => (method === 'GET' && url.includes('/rest/v1/studio_state') ? { status: 200, json: { paused: false, monthly_cap_usd: '500.0000' } } : undefined));
    expect((await createSupabaseDb('https://db.local', 'service-role', { fetchFn: capped.fetchFn }).getStudioState()).monthly_cap_usd).toBe(500);
  });

  it('reads the usage tier cap, and a studio without one, or before the column exists, as null', async () => {
    const studio = (json: unknown) =>
      createSupabaseDb('https://db.local', 'service-role', { fetchFn: mockFetch((method, url) => (method === 'GET' && url.includes('/rest/v1/studio_state') ? { status: 200, json } : undefined)).fetchFn }).getStudioState();
    expect((await studio({ paused: false })).anthropic_tier_cap_usd).toBeNull();
    expect((await studio({ paused: false, anthropic_tier_cap_usd: null })).anthropic_tier_cap_usd).toBeNull();
    expect((await studio({ paused: false, anthropic_tier_cap_usd: '500.0000' })).anthropic_tier_cap_usd).toBe(500);
  });

  it('reads the platform code lane as open only when studio_state says true, and closed before the column exists', async () => {
    const studio = (json: unknown) =>
      createSupabaseDb('https://db.local', 'service-role', { fetchFn: mockFetch((method, url) => (method === 'GET' && url.includes('/rest/v1/studio_state') ? { status: 200, json } : undefined)).fetchFn }).getStudioState();
    expect((await studio({ paused: false })).platform_lane_open).toBe(false);
    expect((await studio({ paused: false, platform_lane_open: false })).platform_lane_open).toBe(false);
    expect((await studio({ paused: false, platform_lane_open: 'true' })).platform_lane_open).toBe(false);
    expect((await studio({ paused: false, platform_lane_open: true })).platform_lane_open).toBe(true);
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
