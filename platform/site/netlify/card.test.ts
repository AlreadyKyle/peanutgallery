// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Beside the functions folder, not in it: Netlify deploys every file in netlify/functions as a function.
import cardFunction, { config, MAX_BODY_BYTES, SESSION_PATTERN } from './functions/card.mts';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './lib/public-env';

const ORIGIN = 'https://site.example';
const CARD_ID = '00000000-0000-4000-8000-000000000004';
const CARD_BODY = '{"card":{"id":"00000000-0000-4000-8000-000000000004"},"supporters":[]}';
const SESSION = 'cs_test_a1B2c3D4e5F6g7H8';

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

const ok = (body: string) => () => Promise.resolve(new Response(body, { status: 200 }));
const request = (path: string, init: RequestInit = {}) => cardFunction(new Request(`${ORIGIN}${path}`, init));
const post = (body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  request('/api/thanks', { method: 'POST', body, headers });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/card/:id', () => {
  it('answers a card id that is not a uuid 400, no-store, with no Supabase call', async () => {
    const calls = stubFetch(ok(CARD_BODY));
    for (const id of ['not-a-uuid', '1234', "00000000-0000-4000-8000-00000000000'", '00000000-0000-4000-8000-0000000000044']) {
      const response = await request(`/api/card/${encodeURIComponent(id)}`);
      expect(response.status, id).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('no-store');
    }
    expect(calls).toHaveLength(0);
  });

  it('answers a query string 400 before any Supabase call, since the CDN would key on it', async () => {
    const calls = stubFetch(ok(CARD_BODY));
    const response = await request(`/api/card/${CARD_ID}?v=1`);
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(calls).toHaveLength(0);
  });

  it('answers an unknown card 404 when site_card returns null', async () => {
    const calls = stubFetch(ok('null'));
    const response = await request(`/api/card/${CARD_ID}`);
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(calls).toHaveLength(1);
  });

  it('answers a known card 200 from site_card with the publishable key and the /api/live CDN header', async () => {
    const calls = stubFetch(ok(CARD_BODY));
    const response = await request(`/api/card/${CARD_ID.toUpperCase()}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CARD_BODY);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('public, durable, s-maxage=60, stale-while-revalidate=60');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/rest/v1/rpc/site_card`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ p_id: CARD_ID });
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe(SUPABASE_PUBLISHABLE_KEY);
    expect(Object.keys(calls[0]!.init.headers as Record<string, string>)).not.toContain('Authorization');
  });

  it('answers 502 no-store when Supabase fails or times out', async () => {
    for (const failure of [
      () => Promise.resolve(new Response('{"message":"boom"}', { status: 500 })),
      () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
      () => Promise.resolve(new Response('<html>', { status: 200 })),
    ]) {
      stubFetch(failure);
      const response = await request(`/api/card/${CARD_ID}`);
      expect(response.status).toBe(502);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });
});

describe('POST /api/thanks', () => {
  it('passes a well-formed session to thanks_for_session and answers no-store on both cache headers', async () => {
    const calls = stubFetch(ok('{"status":"pending"}'));
    const response = await post(JSON.stringify({ session: SESSION }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'pending' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('no-store');
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/rest/v1/rpc/thanks_for_session`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ p_session: SESSION });
  });

  it('answers a malformed session, a body that is not JSON and a body over 1 KB 400, no-store, with no Supabase call', async () => {
    const calls = stubFetch(ok('{"status":"pending"}'));
    const bad = [
      JSON.stringify({ session: 'cs_test_short' }),
      JSON.stringify({ session: 'pi_test_1234567890abcdef' }),
      JSON.stringify({ session: `${SESSION}!` }),
      JSON.stringify({ other: SESSION }),
      JSON.stringify([SESSION]),
      'not json',
      '',
      JSON.stringify({ session: SESSION, pad: 'x'.repeat(MAX_BODY_BYTES) }),
    ];
    for (const body of bad) {
      const response = await post(body);
      expect(response.status, body.slice(0, 40)).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('no-store');
    }
    expect(calls).toHaveLength(0);
  });

  it('answers 502 no-store when Supabase fails', async () => {
    stubFetch(() => Promise.resolve(new Response('{"message":"boom"}', { status: 500 })));
    const response = await post(JSON.stringify({ session: SESSION }));
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('no-store');
  });

  it('takes the same session ids as /thanks does', () => {
    expect(SESSION_PATTERN.source).toBe('^cs_(live|test)_[A-Za-z0-9]{10,250}$');
  });
});

describe('methods, paths and the config', () => {
  it('answers any other method 405, with no Supabase call', async () => {
    const calls = stubFetch(ok(CARD_BODY));
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await request(`/api/card/${CARD_ID}`, { method });
      expect(response.status, method).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const response = await request('/api/thanks', { method });
      expect(response.status, method).toBe(405);
      expect(response.headers.get('Allow')).toBe('POST');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('no-store');
    }
    expect(calls).toHaveLength(0);
  });

  it('answers a path it does not serve 404', async () => {
    const calls = stubFetch(ok(CARD_BODY));
    expect((await request('/api/card')).status).toBe(404);
    expect((await request(`/api/card/${CARD_ID}/more`)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('names its two paths, with no method, and sets the 60-a-minute rate limit per IP and domain', () => {
    expect(config).toEqual({
      path: ['/api/card/:id', '/api/thanks'],
      rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
    });
    expect(config).not.toHaveProperty('method');
  });

  it('reads no environment variable and holds no secret', () => {
    const text = readFileSync(join(import.meta.dirname, 'functions', 'card.mts'), 'utf8');
    expect(text).not.toMatch(/process\.env|Netlify\.env|Deno\.env|import\.meta\.env/);
    expect(text).not.toMatch(/service_role|SERVICE_ROLE|sb_secret_/);
  });
});
