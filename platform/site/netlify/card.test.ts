// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Beside the functions folder, not in it: Netlify deploys every file in netlify/functions as a function.
import cardFunction, { config, MAX_BODY_BYTES, PLAY_EVENTS, SESSION_PATTERN } from './functions/card.mts';
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

  it('answers a malformed percent-escape 400 rather than throwing', async () => {
    const calls = stubFetch(ok(CARD_BODY));
    for (const raw of ['%E0', '%', '00000000-0000-4000-8000-00000000000%ZZ']) {
      const response = await request(`/api/card/${raw}`);
      expect(response.status, raw).toBe(400);
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

  it("answers PostgREST's jsonb text, with its spaces, as exactly {\"status\":\"pending\"}", async () => {
    // PostgREST prints a jsonb result as jsonb's text form, a space after each colon and comma; the
    // answer live-check compares, and every other, is the compact form.
    stubFetch(ok('{"status": "pending"}'));
    const response = await post(JSON.stringify({ session: SESSION }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"status":"pending"}');
    stubFetch(ok('{"card": {"id": "00000000-0000-4000-8000-000000000004"}, "supporters": []}'));
    expect(await (await request(`/api/card/${CARD_ID}`)).text()).toBe(CARD_BODY);
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

  it('names its three paths, with no method, and sets the 300-a-minute rate limit per IP and domain', () => {
    expect(config).toEqual({
      path: ['/api/card/:id', '/api/card/:id/preview.png', '/api/thanks', '/api/unsubscribe', '/api/count'],
      rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ['ip', 'domain'] },
    });
    expect(config).not.toHaveProperty('method');
  });

  it('reads no environment variable and holds no secret', () => {
    const text = readFileSync(join(import.meta.dirname, 'functions', 'card.mts'), 'utf8');
    expect(text).not.toMatch(/process\.env|Netlify\.env|Deno\.env|import\.meta\.env/);
    expect(text).not.toMatch(/service_role|SERVICE_ROLE|sb_secret_/);
  });
});

describe('GET /api/card/:id/preview.png', () => {
  const LIVE_CARD = JSON.stringify({ card: { id: CARD_ID, title: 'A card', summary: 'Its summary.', stage: 'voted', created_at: '2026-10-01T00:00:00Z', live_at: null }, spent_usd: 0, supporters: [], supporter_count: 0 });

  it('draws the card as a cached 1200x630 PNG from one site_card call', async () => {
    // satori loads its layout engine from a data: URL through fetch, so that one goes to the real fetch.
    const realFetch = globalThis.fetch;
    const calls = stubFetch(ok(LIVE_CARD));
    const stubbed = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string | URL, init: RequestInit) => (String(url).startsWith('data:') ? realFetch(url, init) : stubbed(url, init)));
    const response = await request(`/api/card/${CARD_ID}/preview.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('public, durable, s-maxage=600, stale-while-revalidate=600');
    const png = Buffer.from(await response.arrayBuffer());
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ p_id: CARD_ID });
  }, 30_000);

  it('answers 400 for a bad id or a query string, 404 for no card and 502 for a failed read', async () => {
    let calls = stubFetch(ok(LIVE_CARD));
    expect((await request('/api/card/nope/preview.png')).status).toBe(400);
    expect((await request(`/api/card/${CARD_ID}/preview.png?v=1`)).status).toBe(400);
    expect(calls).toHaveLength(0);
    stubFetch(ok('null'));
    expect((await request(`/api/card/${CARD_ID}/preview.png`)).status).toBe(404);
    calls = stubFetch(() => Promise.resolve(new Response('boom', { status: 500 })));
    const failed = await request(`/api/card/${CARD_ID}/preview.png`);
    expect(failed.status).toBe(502);
    expect(failed.headers.get('Cache-Control')).toBe('no-store');
    expect(calls).toHaveLength(1);
  });

  it('answers 405 for a POST', async () => {
    stubFetch(ok(LIVE_CARD));
    expect((await request(`/api/card/${CARD_ID}/preview.png`, { method: 'POST' })).status).toBe(405);
  });
});

describe('POST /api/count (docs/specs/play-counts.md)', () => {
  const count = (body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    request('/api/count', { method: 'POST', body, headers });

  it('takes exactly the four events, the list count_play_event holds', () => {
    expect(PLAY_EVENTS).toEqual(['dust_load', 'dust_share', 'card_share', 'dust_next_card']);
    const migration = readFileSync(join(import.meta.dirname, '..', '..', 'supabase', 'migrations', '20261011500000_play_counts.sql'), 'utf8');
    expect(migration).toContain(`in (${PLAY_EVENTS.map((e) => `'${e}'`).join(', ')})`);
  });

  it('passes a known event, and nothing else, to count_play_event with the publishable key, and answers 204 no-store', async () => {
    for (const event of PLAY_EVENTS) {
      const calls = stubFetch(ok('true'));
      // A beacon sends text/plain; the body is read as JSON whatever its type says.
      const response = await count(JSON.stringify({ event }), { 'content-type': 'text/plain;charset=UTF-8', cookie: 'x=1', 'x-forwarded-for': '203.0.113.9' });
      expect(response.status, event).toBe(204);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('no-store');
      expect(response.headers.get('Set-Cookie')).toBeNull();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe(`${SUPABASE_URL}/rest/v1/rpc/count_play_event`);
      expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ p_event: event });
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers.apikey).toBe(SUPABASE_PUBLISHABLE_KEY);
      expect(Object.keys(headers).sort()).toEqual(['Accept', 'Content-Type', 'apikey']);
      vi.unstubAllGlobals();
    }
  });

  it('answers an unknown event, a malformed or oversized body 400 with no Supabase call', async () => {
    const calls = stubFetch(ok('true'));
    for (const body of ['', 'dust_load', '[]', 'null', '{}', '{"event":"page_view"}', '{"event":"Dust_load"}', '{"event":1}', JSON.stringify({ event: 'dust_load', pad: 'x'.repeat(MAX_BODY_BYTES) })]) {
      const response = await count(body);
      expect(response.status, body.slice(0, 40)).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(calls).toHaveLength(0);
  });

  it('answers 502 when the database does not say true', async () => {
    for (const respond of [ok('false'), () => Promise.resolve(new Response('{}', { status: 500 })), () => Promise.reject(new Error('down'))]) {
      stubFetch(respond);
      expect((await count('{"event":"dust_load"}')).status).toBe(502);
      vi.unstubAllGlobals();
    }
  });

  it('answers any other method 405', async () => {
    const calls = stubFetch(ok('true'));
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const response = await request('/api/count', { method });
      expect(response.status, method).toBe(405);
      expect(response.headers.get('Allow')).toBe('POST');
    }
    expect(calls).toHaveLength(0);
  });
});
