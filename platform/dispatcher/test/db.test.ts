import { describe, expect, it } from 'vitest';
import { createSupabaseDb, fetchWithTimeout, type UsageInput } from '../src/db.js';
import { mockFetch } from './helpers/mock-fetch.js';

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
