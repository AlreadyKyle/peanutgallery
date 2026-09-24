// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Beside the functions folder, not in it: Netlify deploys every file in netlify/functions as a function.
import snapshot, { config, RPC_TIMEOUT_MS } from './functions/snapshot.mts';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './lib/public-env';

const ORIGIN = 'https://site.example';
const LIVE_BODY = '{"built_at":"2026-09-23T00:00:00+00:00","cards":{}}';

type Call = { url: string; init: RequestInit };

function stubFetch(respond: (call: Call) => Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  });
  return calls;
}

const ok = (body = LIVE_BODY) => () => Promise.resolve(new Response(body, { status: 200 }));
const get = (path: string, method = 'GET') => snapshot(new Request(`${ORIGIN}${path}`, { method }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the snapshot function', () => {
  it('answers /api/live from site_live with the publishable key, cached 60 seconds on the CDN and revalidated by the browser', async () => {
    const calls = stubFetch(ok());
    const response = await get('/api/live');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(LIVE_BODY);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('public, durable, s-maxage=60, stale-while-revalidate=60');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/rest/v1/rpc/site_live`);
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe(SUPABASE_PUBLISHABLE_KEY);
    expect(Object.keys(calls[0]!.init.headers as Record<string, string>)).not.toContain('Authorization');
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers /api/cards from site_cards, cached 300 seconds on the CDN', async () => {
    const calls = stubFetch(ok('{"cards":[],"roles":[],"terms":[]}'));
    const response = await get('/api/cards');
    expect(response.status).toBe(200);
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('public, durable, s-maxage=300, stale-while-revalidate=300');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/rest/v1/rpc/site_cards`);
  });

  it('answers any query string 400 with no-store, before any Supabase call', async () => {
    const calls = stubFetch(ok());
    for (const path of ['/api/live?x=1', '/api/cards?v=abc', '/api/live?']) {
      const response = await get(path);
      if (path.endsWith('?')) {
        // An empty query string is no query string: the URL's search is ''.
        expect(response.status).toBe(200);
        continue;
      }
      expect(response.status, path).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('no-store');
      expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    }
    expect(calls).toHaveLength(1);
  });

  it('answers any method but GET 405, before any Supabase call', async () => {
    const calls = stubFetch(ok());
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await get('/api/live', method);
      expect(response.status, method).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(calls).toHaveLength(0);
  });

  it('answers 502 with no-store on a Supabase error, a timeout, a network failure or a body that is not a JSON object', async () => {
    const failures: (() => Promise<Response>)[] = [
      () => Promise.resolve(new Response('{"message":"boom"}', { status: 500 })),
      () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve(new Response('<html>', { status: 200 })),
      () => Promise.resolve(new Response('[]', { status: 200 })),
    ];
    for (const failure of failures) {
      stubFetch(failure);
      const response = await get('/api/live');
      expect(response.status).toBe(502);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('no-store');
      expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    }
  });

  it('gives up on Supabase after 8 seconds: the signal it passes aborts on its own', async () => {
    expect(RPC_TIMEOUT_MS).toBe(8_000);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      const calls = stubFetch(ok());
      await get('/api/live');
      expect(timeout).toHaveBeenCalledWith(8_000);
      expect(calls[0]!.init.signal).toBe(timeout.mock.results[0]!.value);
    } finally {
      timeout.mockRestore();
    }
  });

  it('answers a path it does not serve 404', async () => {
    const calls = stubFetch(ok());
    expect((await get('/api/other')).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('names its paths only, with no method, and sets the 300-a-minute rate limit per IP and domain', () => {
    expect(config).toEqual({
      path: ['/api/live', '/api/cards'],
      rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ['ip', 'domain'] },
    });
    expect(config).not.toHaveProperty('method');
  });
});

describe('the public values', () => {
  const siteDir = join(import.meta.dirname, '..');

  it('holds the publishable key, never a secret, and the board site’s Supabase URL', () => {
    expect(SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')).toBe(true);
    const boardToml = readFileSync(join(siteDir, '..', 'board', 'netlify.toml'), 'utf8');
    expect(boardToml.match(/^\s*VITE_SUPABASE_URL\s*=\s*"([^"]+)"/m)?.[1]).toBe(SUPABASE_URL);
  });

  it('reads no environment variable in the function or its constants', () => {
    for (const file of ['netlify/functions/snapshot.mts', 'netlify/lib/public-env.ts']) {
      const text = readFileSync(join(siteDir, file), 'utf8');
      expect(text, file).not.toMatch(/process\.env|Netlify\.env|Deno\.env|import\.meta\.env/);
      expect(text, file).not.toMatch(/service_role|SERVICE_ROLE|sb_secret_/);
    }
  });
});

describe('the functions folder', () => {
  it('holds the snapshot function alone, since Netlify deploys every file there as a function', () => {
    expect(readdirSync(join(import.meta.dirname, 'functions'))).toEqual(['snapshot.mts']);
  });
});
