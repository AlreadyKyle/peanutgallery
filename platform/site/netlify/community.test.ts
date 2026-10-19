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
      ['/api/community/card/44AD6D1E-6D7F-4F16-B8D6-5DF66BFB157C/ideas', 'community_card_ideas', { p_card: '44ad6d1e-6d7f-4f16-b8d6-5df66bfb157c' }, 30],
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
      ['/api/community/profile/%E0%A4%A', 404],
      ['/api/community/profile/supporter%', 404],
      ['/api/community/card/not-a-card/ideas', 404],
      ['/api/community/card/44ad6d1e-6d7f-4f16-b8d6-5df66bfb157c/ideas?x=1', 400],
      ['/api/community/card/44ad6d1e-6d7f-4f16-b8d6-5df66bfb157c', 404],
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

  it('says whether email sign-in takes new players, as one boolean read from the public auth settings', async () => {
    for (const [settings, signIn, providers] of [
      [{ external: { email: true, google: false }, disable_signup: false, mailer_autoconfirm: false }, true, []],
      [{ external: { email: true, google: true, github: true, twitter: true, discord: false, apple: true }, disable_signup: false }, true, ['google', 'apple', 'github']],
      [{ external: { email: true, google: true }, disable_signup: true }, false, []],
      [{ external: { email: false }, disable_signup: false }, false, []],
      [{}, false, []],
    ] as const) {
      const calls = stubFetch([{ body: settings }]);
      const response = await get('/api/community/auth/settings');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ signIn, providers });
      expect(calls[0]!.url).toBe(`${SUPABASE_URL}/auth/v1/settings`);
      expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe(SUPABASE_PUBLISHABLE_KEY);
      expect(response.headers.get('Netlify-CDN-Cache-Control')).toContain('s-maxage=60');
    }
    stubFetch([{ status: 500, body: {} }]);
    expect((await get('/api/community/auth/settings')).status).toBe(502);
    const none = stubFetch([{ body: {} }]);
    expect((await get('/api/community/auth/settings?x=1')).status).toBe(400);
    expect(none).toHaveLength(0);
  });

  it('makes an account with a password, asking for the email to be confirmed, and never says who has one', async () => {
    const calls = stubFetch([{ body: { id: 'u1', email: 'new@example.com', identities: [] } }]);
    const response = await post('/api/community/auth/signup', { email: 'New@Example.com', password: 'long enough pass', redirectTo: `${ORIGIN}/me` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ confirm: true });
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/auth/v1/signup?redirect_to=${encodeURIComponent(`${ORIGIN}/me`)}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: 'new@example.com', password: 'long enough pass' });
    stubFetch([{ body: { access_token: TOKEN, refresh_token: 'r3fresh-token', expires_in: 60, user: {} } }]);
    expect(await (await post('/api/community/auth/signup', { email: 'a@example.com', password: 'long enough pass', redirectTo: `${ORIGIN}/me` })).json()).toEqual({
      access_token: TOKEN,
      refresh_token: 'r3fresh-token',
      expires_in: 60,
    });
  });

  it('refuses a short password before Supabase, and turns its refusals into codes', async () => {
    const none = stubFetch([{ body: {} }]);
    const short = await post('/api/community/auth/signup', { email: 'a@example.com', password: 'short', redirectTo: `${ORIGIN}/me` });
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: 'Use at least 8 characters', code: 'weak' });
    expect((await post('/api/community/auth/signup', { email: 'a@example.com', password: 'x'.repeat(73), redirectTo: `${ORIGIN}/me` })).status).toBe(400);
    expect((await post('/api/community/auth/signup', { email: 'a@example.com', password: 'long enough pass', redirectTo: 'https://evil.example/me' })).status).toBe(400);
    expect(none).toHaveLength(0);
    for (const [status, body, want, code] of [
      [422, { error_code: 'weak_password', msg: 'Password is known to be weak' }, 400, 'weak'],
      [422, { error_code: 'signup_disabled', msg: 'Signups not allowed' }, 403, 'closed'],
      [429, { error_code: 'over_email_send_rate_limit' }, 429, 'limit'],
    ] as const) {
      stubFetch([{ status, body }]);
      const response = await post('/api/community/auth/signup', { email: 'a@example.com', password: 'long enough pass', redirectTo: `${ORIGIN}/me` });
      expect(response.status).toBe(want);
      expect(((await response.json()) as { code: string }).code).toBe(code);
    }
  });

  it('signs in with a password, and says wrong or unconfirmed without saying which part was wrong', async () => {
    const calls = stubFetch([{ body: { access_token: TOKEN, refresh_token: 'r3fresh-token', expires_in: 3600, user: { email: 'a@example.com' } } }]);
    const ok = await post('/api/community/auth/password', { email: 'A@example.com', password: 'pw' });
    expect(await ok.json()).toEqual({ access_token: TOKEN, refresh_token: 'r3fresh-token', expires_in: 3600 });
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=password`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: 'a@example.com', password: 'pw' });
    stubFetch([{ status: 400, body: { error_code: 'invalid_credentials' } }]);
    const wrong = await post('/api/community/auth/password', { email: 'a@example.com', password: 'pw' });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: 'Wrong email or password', code: 'wrong' });
    stubFetch([{ status: 400, body: { error_code: 'email_not_confirmed' } }]);
    expect(((await (await post('/api/community/auth/password', { email: 'a@example.com', password: 'pw' })).json()) as { code: string }).code).toBe('unconfirmed');
    expect((await post('/api/community/auth/password', { email: 'a@example.com', password: '' })).status).toBe(400);
  });

  it('limits password tries per address', async () => {
    stubFetch([{ status: 400, body: { error_code: 'invalid_credentials' } }]);
    const tryOnce = () =>
      community(
        new Request(`${ORIGIN}/api/community/auth/password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '192.0.2.88' },
          body: JSON.stringify({ email: 'a@example.com', password: 'guess' }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await tryOnce()).status);
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('sends a reset link or the confirmation again, with the same answer for any address', async () => {
    const calls = stubFetch([{ body: {} }, { status: 422, body: { error_code: 'user_not_found' } }]);
    const reset = await post('/api/community/auth/recover', { email: 'a@example.com', redirectTo: `${ORIGIN}/me` });
    expect(await reset.json()).toEqual({ sent: true });
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(`${ORIGIN}/me`)}`);
    const again = await post('/api/community/auth/resend', { email: 'a@example.com', redirectTo: `${ORIGIN}/me` });
    expect(await again.json()).toEqual({ sent: true });
    expect(calls[1]!.url).toBe(`${SUPABASE_URL}/auth/v1/resend?redirect_to=${encodeURIComponent(`${ORIGIN}/me`)}`);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ type: 'signup', email: 'a@example.com' });
  });

  it('sets a new password only with the player\'s token, by PUT', async () => {
    const calls = stubFetch([{ body: { id: 'u1' } }]);
    expect((await post('/api/community/auth/new-password', { password: 'a new long one' })).status).toBe(401);
    const changed = await post('/api/community/auth/new-password', { password: 'a new long one' }, { authorization: `Bearer ${TOKEN}` });
    expect(await changed.json()).toEqual({ changed: true });
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/auth/v1/user`);
    expect(calls[0]!.init.method).toBe('PUT');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect((await post('/api/community/auth/new-password', { password: 'short' }, { authorization: `Bearer ${TOKEN}` })).status).toBe(400);
    stubFetch([{ status: 422, body: { error_code: 'same_password' } }]);
    expect(((await (await post('/api/community/auth/new-password', { password: 'a new long one' }, { authorization: `Bearer ${TOKEN}` })).json()) as { code: string }).code).toBe('same');
  });

  it('sends a provider sign-in to Supabase Auth, only for the listed providers and back to this site', async () => {
    const back = encodeURIComponent(`${ORIGIN}/me`);
    const google = await get(`/api/community/auth/authorize?provider=google&redirectTo=${back}`);
    expect(google.status).toBe(302);
    expect(google.headers.get('Location')).toBe(`${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${back}`);
    expect((await get(`/api/community/auth/authorize?provider=twitter&redirectTo=${back}`)).status).toBe(400);
    expect((await get(`/api/community/auth/authorize?provider=google&redirectTo=${encodeURIComponent('https://evil.example/me')}`)).status).toBe(400);
    expect((await get(`/api/community/auth/authorize?provider=google&redirectTo=${back}&scopes=x`)).status).toBe(400);
  });

  it('ends a session on the server when signing out', async () => {
    const calls = stubFetch([{ status: 204 }]);
    expect(await (await post('/api/community/auth/signout', {}, { authorization: `Bearer ${TOKEN}` })).json()).toEqual({ signedOut: true });
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/auth/v1/logout?scope=local`);
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

  it('allows exactly the player RPCs of the contract (and set_contribution_public, and the follows of docs/specs/card-follows.md)', () => {
    expect(Object.keys(PLAYER_RPCS).sort()).toEqual([
      'claim_contributions', 'follow_card', 'my_follows', 'my_profile', 'save_seed', 'set_contribution_public', 'submit_suggestion', 'unfollow_card',
      'update_profile', 'vote_seed', 'vote_suggestion',
    ]);
    expect(PLAYER_RPCS.follow_card).toEqual(['card_id']);
    expect(PLAYER_RPCS.unfollow_card).toEqual(['card_id']);
    expect(PLAYER_RPCS.my_follows).toEqual([]);
  });

  it("passes a follow through with the player's token, and refuses one with another argument", async () => {
    const card = '00000000-0000-4000-8000-0000000000c1';
    const calls = stubFetch([{ body: { cardId: card, following: true, state: 'open' } }]);
    const response = await post('/api/community/rpc/follow_card', { card_id: card }, { authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cardId: card, following: true, state: 'open' });
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/rest/v1/rpc/follow_card`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ card_id: card });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect((await post('/api/community/rpc/follow_card', { card_id: card, user_id: 'x' }, { authorization: `Bearer ${TOKEN}` })).status).toBe(400);
    expect((await post('/api/community/rpc/follow_card', { card_id: card })).status).toBe(401);
    expect(calls).toHaveLength(1);
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
