// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
// Beside the functions folder, not in it: Netlify deploys every file in netlify/functions as a function.
import community, { config } from './functions/community.mts';
import { bearer, documentRoute, otpRequest, PLAYER_RPCS, rpcArgs, WindowLimiter } from './lib/community';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './lib/public-env';

const ORIGIN = 'https://mobmachine.games';
const TOKEN = `${'a'.repeat(20)}.${'b'.repeat(40)}.${'c'.repeat(20)}`;

type Call = { url: string; init: RequestInit };

function stubFetch(answers: Array<{ status?: number; body?: unknown }>): Call[] {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = answers[Math.min(i, answers.length - 1)] ?? {};
    i += 1;
    return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
  return calls;
}

let ip = 0;
const get = (path: string) => community(new Request(`${ORIGIN}${path}`));
// Each request from its own address, so the per-address limiter does not carry across tests.
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  community(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': `10.0.0.${(ip += 1)}`, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

afterEach(() => vi.unstubAllGlobals());

describe('the community documents', () => {
  it('serves /api/community/* only', () => {
    expect(config.path).toEqual(['/api/community/*']);
  });

  it('reads each document with the publishable key and the right arguments, cached at the edge for 5 to 30 seconds', async () => {
    const cases: Array<[string, string, Record<string, unknown>, number]> = [
      ['/api/community/feed', 'community_feed', { p_cursor: null }, 5],
      ['/api/community/feed?cursor=123', 'community_feed', { p_cursor: '123' }, 5],
      ['/api/community/goals', 'community_goals', {}, 30],
      ['/api/community/studio', 'community_studio', {}, 30],
      ['/api/community/seeds', 'community_seeds', { p_sort: 'trending', p_cursor: null }, 15],
      ['/api/community/seeds?sort=top_week&cursor=1.5|00000000-0000-4000-8000-000000000001', 'community_seeds', { p_sort: 'top_week', p_cursor: '1.5|00000000-0000-4000-8000-000000000001' }, 15],
      ['/api/community/suggestions?sort=new&area=dust', 'community_suggestions', { p_sort: 'new', p_area: 'dust', p_cursor: null }, 15],
      ['/api/community/profile/supporter-12', 'community_profile', { p_handle: 'supporter-12' }, 30],
    ];
    for (const [path, rpc, args, seconds] of cases) {
      const calls = stubFetch([{ body: { items: [] } }]);
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(calls[0]!.url).toBe(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`);
      expect(JSON.parse(String(calls[0]!.init.body))).toEqual(args);
      expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe(SUPABASE_PUBLISHABLE_KEY);
      expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
      expect(response.headers.get('Netlify-CDN-Cache-Control')).toMatch(new RegExp(`s-maxage=${seconds}, stale-while-revalidate=\\d+`));
      expect(seconds).toBeGreaterThanOrEqual(5);
      expect(seconds).toBeLessThanOrEqual(30);
    }
  });

  it('refuses an unknown parameter, sort, area, cursor or path with 400 or 404 before Supabase is called', async () => {
    const calls = stubFetch([{ body: {} }]);
    for (const [path, status] of [
      ['/api/community/feed?x=1', 400],
      ['/api/community/feed?cursor=1&cursor=2', 400],
      ['/api/community/goals?cachebust=1', 400],
      ['/api/community/seeds?sort=random', 400],
      ['/api/community/suggestions?area=everything', 400],
      ['/api/community/feed?cursor=%27%3B%20drop', 400],
      ['/api/community/profile/Not_A_Handle', 404],
      ['/api/community/profile/a/b', 404],
      ['/api/community/secrets', 404],
    ] as const) {
      const response = await get(path);
      expect(response.status, path).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(calls).toHaveLength(0);
  });

  it('answers 404 for a profile the database does not have, and 502 when the database fails', async () => {
    stubFetch([{ body: null }]);
    expect((await get('/api/community/profile/nobody-here')).status).toBe(404);
    stubFetch([{ status: 500, body: { message: 'boom' } }]);
    const failed = await get('/api/community/feed');
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'The studio database did not answer' });
  });
});

describe('the sign-in routes', () => {
  it('sends the magic link for a redirect on this origin, with the implicit flow', async () => {
    const calls = stubFetch([{ body: {} }]);
    const response = await post('/api/community/auth/otp', { email: ' Player@Example.com ', redirectTo: `${ORIGIN}/me` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true });
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/auth/v1/otp?redirect_to=${encodeURIComponent(`${ORIGIN}/me`)}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: 'player@example.com', create_user: true });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('refuses another origin, a bad email, extra fields, a cross-origin caller and a non-JSON body', async () => {
    const calls = stubFetch([{ body: {} }]);
    expect((await post('/api/community/auth/otp', { email: 'a@example.com', redirectTo: 'https://evil.example/me' })).status).toBe(400);
    expect((await post('/api/community/auth/otp', { email: 'a@example.com', redirectTo: '/me' })).status).toBe(400);
    expect((await post('/api/community/auth/otp', { email: 'not-an-email', redirectTo: `${ORIGIN}/me` })).status).toBe(400);
    expect((await post('/api/community/auth/otp', { email: 'a@example.com', redirectTo: `${ORIGIN}/me`, admin: true })).status).toBe(400);
    expect((await post('/api/community/auth/otp', { email: 'a@example.com', redirectTo: `${ORIGIN}/me` }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('/api/community/auth/otp', 'email=a', { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect((await post('/api/community/auth/otp', 'x'.repeat(9000))).status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('limits magic links per address', async () => {
    stubFetch([{ body: {} }]);
    const send = () =>
      community(
        new Request(`${ORIGIN}/api/community/auth/otp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '192.0.2.77' },
          body: JSON.stringify({ email: 'a@example.com', redirectTo: `${ORIGIN}/me` }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await send()).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('refreshes a session and returns only the three fields', async () => {
    const calls = stubFetch([{ body: { access_token: TOKEN, refresh_token: 'r3fresh-token', expires_in: 3600, user: { email: 'x@example.com' } } }]);
    const response = await post('/api/community/auth/refresh', { refresh_token: 'old-refresh-token' });
    expect(await response.json()).toEqual({ access_token: TOKEN, refresh_token: 'r3fresh-token', expires_in: 3600 });
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`);
    stubFetch([{ status: 400, body: { error: 'invalid_grant' } }]);
    expect((await post('/api/community/auth/refresh', { refresh_token: 'old-refresh-token' })).status).toBe(401);
    expect((await post('/api/community/auth/refresh', { refresh_token: 'bad token!' })).status).toBe(400);
  });

  it('answers 405 to a GET on a POST route', async () => {
    expect((await get('/api/community/auth/otp')).status).toBe(405);
    expect((await get('/api/community/rpc/my_profile')).status).toBe(405);
  });
});

describe('the player RPCs', () => {
  it('passes the player token and named arguments to an allowlisted RPC', async () => {
    const calls = stubFetch([{ body: { id: 'abc' } }]);
    const response = await post('/api/community/rpc/submit_suggestion', { area: 'dust', title: 'Carts', body: 'Faster' }, { authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'abc' });
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/rest/v1/rpc/submit_suggestion`);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('allows exactly the player RPCs of the contract (and set_contribution_public)', () => {
    expect(Object.keys(PLAYER_RPCS).sort()).toEqual(
      ['claim_contributions', 'my_profile', 'save_seed', 'set_contribution_public', 'submit_suggestion', 'update_profile', 'vote_seed', 'vote_suggestion'],
    );
  });

  it('refuses another RPC, an unknown argument and a missing token before Supabase is called', async () => {
    const calls = stubFetch([{ body: {} }]);
    expect((await post('/api/community/rpc/board_flags', {}, { authorization: `Bearer ${TOKEN}` })).status).toBe(404);
    expect((await post('/api/community/rpc/curator_take_batch', {}, { authorization: `Bearer ${TOKEN}` })).status).toBe(404);
    expect((await post('/api/community/rpc/vote_seed', { id: 'x', value: 1, user_id: 'y' }, { authorization: `Bearer ${TOKEN}` })).status).toBe(400);
    expect((await post('/api/community/rpc/my_profile', [], { authorization: `Bearer ${TOKEN}` })).status).toBe(400);
    expect((await post('/api/community/rpc/my_profile', {})).status).toBe(401);
    expect((await post('/api/community/rpc/my_profile', {}, { authorization: 'Bearer nope' })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("maps the database's refusal to 400 with its message, and an expired token to 401", async () => {
    stubFetch([{ status: 400, body: { code: 'P0001', message: 'You can send 3 suggestions a day' } }]);
    const refused = await post('/api/community/rpc/submit_suggestion', { area: 'dust', title: 'x' }, { authorization: `Bearer ${TOKEN}` });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'You can send 3 suggestions a day' });
    stubFetch([{ status: 401, body: { message: 'JWT expired' } }]);
    expect((await post('/api/community/rpc/my_profile', {}, { authorization: `Bearer ${TOKEN}` })).status).toBe(401);
  });
});

describe('the pure helpers', () => {
  it('parse routes, tokens, arguments and redirects', () => {
    expect(documentRoute('/api/other', new URLSearchParams()).ok).toBe(false);
    expect(bearer(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearer(`Basic ${TOKEN}`)).toBeNull();
    expect(rpcArgs('my_profile', {}).ok).toBe(true);
    expect(otpRequest({ email: 'a@b.co', redirectTo: 'https://user:pw@mobmachine.games/me' }, ORIGIN).ok).toBe(false);
    const limiter = new WindowLimiter(2, 1000);
    expect([limiter.allow('a', 0), limiter.allow('a', 1), limiter.allow('a', 2), limiter.allow('a', 1001)]).toEqual([true, true, false, true]);
  });
});
