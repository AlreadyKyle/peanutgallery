// The community documents and the player's door to Supabase (docs/specs/community-core.md,
// docs/specs/final-state.md, platform/site/src/lib/community-types.ts).
//
//   GET  /api/community/feed?cursor=                     community_feed()         s-maxage 5
//   GET  /api/community/goals                            community_goals()        s-maxage 30
//   GET  /api/community/studio                           community_studio()       s-maxage 30
//   GET  /api/community/seeds?sort=&cursor=              community_seeds()        s-maxage 15
//   GET  /api/community/suggestions?sort=&area=&cursor=  community_suggestions()  s-maxage 15
//   GET  /api/community/profile/<handle>                 community_profile()      s-maxage 30, 404 if none
//   POST /api/community/auth/otp      {email, redirectTo}  sends the magic link (implicit flow: the link
//                                     lands on redirectTo with #access_token=...&refresh_token=...)
//   POST /api/community/auth/refresh  {refresh_token}      -> {access_token, refresh_token, expires_in}
//   POST /api/community/rpc/<name>    Authorization: Bearer <access_token>, a JSON object of named
//                                     arguments; only the player RPCs in lib/community.ts PLAYER_RPCS
//                                     (follow_card, unfollow_card and my_follows among them,
//                                     docs/specs/card-follows.md)
//
// The site's CSP pins connect-src to 'self' and it ships no Supabase client, so every call goes
// through here. The GET documents are read with the publishable key, as snapshot.mts reads its
// own: the CDN keeps each a few seconds and serves it stale while it rebuilds, so a crowd costs the
// database almost nothing, and a query parameter outside each route's list answers 400 before
// Supabase is called. The POST routes are never cached, refuse another origin, are limited per
// address in this instance, and act only as the player whose token they carry: the RPCs check the
// session and rate-limit per account themselves.

import {
  bearer,
  documentRoute,
  errorText,
  MAX_BODY_BYTES,
  otpRequest,
  refreshRequest,
  rpcArgs,
  WindowLimiter,
  COMMUNITY_PREFIX,
} from '../lib/community.ts';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../lib/public-env.ts';

/** How long one Supabase call may take before the function answers 502. */
export const UPSTREAM_TIMEOUT_MS = 8_000;

const JSON_TYPE = 'application/json; charset=utf-8';
export const NO_STORE = { 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store' };

// Per address, per instance: magic links are the scarce thing (Supabase Auth sends a few an hour).
const otpLimiter = new WindowLimiter(5, 10 * 60_000);
const postLimiter = new WindowLimiter(60, 60_000);

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': JSON_TYPE, ...headers } });
}

function refuse(status: number, error: string, extra: Record<string, string> = {}): Response {
  return json(status, { error }, { ...NO_STORE, ...extra });
}

function address(req: Request): string {
  return req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

async function upstream(path: string, init: { body: unknown; token?: string }): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(init.body),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text.trim() !== '') body = JSON.parse(text);
  return { status: response.status, body };
}

async function readBody(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) return { ok: false, response: refuse(415, 'Send application/json') };
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { ok: false, response: refuse(413, 'The body is too large') };
  try {
    return { ok: true, value: text.trim() === '' ? {} : JSON.parse(text) };
  } catch {
    return { ok: false, response: refuse(400, 'The body is not JSON') };
  }
}

async function getDocument(url: URL): Promise<Response> {
  const route = documentRoute(url.pathname, url.searchParams);
  if (!route.ok) return refuse(route.status, route.error);
  try {
    const answer = await upstream(`/rest/v1/rpc/${route.value.rpc}`, { body: route.value.args });
    if (answer.status === 400) return refuse(400, errorText(answer.body, 'Bad request'));
    if (answer.status < 200 || answer.status >= 300) return refuse(502, 'The studio database did not answer');
    const cache = {
      'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${route.value.seconds}, stale-while-revalidate=${route.value.staleSeconds}`,
      'Cache-Control': 'public, max-age=0, must-revalidate',
    };
    if (answer.body === null && route.value.rpc === 'community_profile') return json(404, { error: 'Not found' }, cache);
    if (typeof answer.body !== 'object' || answer.body === null || Array.isArray(answer.body)) return refuse(502, 'The studio database did not answer');
    return json(200, answer.body, cache);
  } catch {
    return refuse(502, 'The studio database did not answer');
  }
}

async function post(req: Request, url: URL): Promise<Response> {
  const origin = req.headers.get('origin');
  if (origin !== null && origin !== url.origin) return refuse(403, 'Cross-origin requests are refused');
  const who = address(req);
  if (!postLimiter.allow(who, Date.now())) return refuse(429, 'Too many requests; try again in a minute', { 'Retry-After': '60' });
  const rest = url.pathname.slice(COMMUNITY_PREFIX.length + 1);
  const body = await readBody(req);
  if (!body.ok) return body.response;
  try {
    if (rest === 'auth/otp') {
      const ask = otpRequest(body.value, url.origin);
      if (!ask.ok) return refuse(ask.status, ask.error);
      if (!otpLimiter.allow(who, Date.now())) return refuse(429, 'Too many sign-in emails; try again later', { 'Retry-After': '600' });
      const answer = await upstream(`/auth/v1/otp?redirect_to=${encodeURIComponent(ask.value.redirectTo)}`, {
        body: { email: ask.value.email, create_user: true },
      });
      if (answer.status === 429) return refuse(429, 'Too many sign-in emails; try again later', { 'Retry-After': '600' });
      if (answer.status >= 400 && answer.status < 500) return refuse(400, errorText(answer.body, 'The sign-in email could not be sent'));
      if (answer.status >= 300) return refuse(502, 'The sign-in service did not answer');
      return json(200, { sent: true }, NO_STORE);
    }
    if (rest === 'auth/refresh') {
      const token = refreshRequest(body.value);
      if (!token.ok) return refuse(token.status, token.error);
      const answer = await upstream('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: token.value } });
      if (answer.status >= 400 && answer.status < 500) return refuse(401, 'Sign in again');
      const session = answer.body as Record<string, unknown> | null;
      if (answer.status >= 300 || typeof session?.access_token !== 'string' || typeof session.refresh_token !== 'string') {
        return refuse(502, 'The sign-in service did not answer');
      }
      return json(200, { access_token: session.access_token, refresh_token: session.refresh_token, expires_in: Number(session.expires_in) || 3600 }, NO_STORE);
    }
    const rpc = /^rpc\/([a-z_]{1,40})$/.exec(rest);
    if (rpc) {
      const args = rpcArgs(rpc[1]!, body.value);
      if (!args.ok) return refuse(args.status, args.error);
      const token = bearer(req.headers.get('authorization'));
      if (token === null) return refuse(401, 'Sign in first');
      const answer = await upstream(`/rest/v1/rpc/${rpc[1]}`, { body: args.value, token });
      if (answer.status === 401 || answer.status === 403) return refuse(401, 'Sign in again');
      if (answer.status >= 400 && answer.status < 500) return refuse(400, errorText(answer.body, 'The request was refused'));
      if (answer.status < 200 || answer.status >= 300) return refuse(502, 'The studio database did not answer');
      return json(200, answer.body ?? {}, NO_STORE);
    }
    return refuse(404, 'Not found');
  } catch {
    return refuse(502, 'The studio database did not answer');
  }
}

// Netlify calls the default export with (request, context); the tests stub globalThis.fetch.
export default async function community(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(`${COMMUNITY_PREFIX}/`)) return refuse(404, 'Not found');
  if (req.method === 'GET') {
    const rest = url.pathname.slice(COMMUNITY_PREFIX.length + 1);
    if (rest.startsWith('auth/') || rest.startsWith('rpc/')) return refuse(405, 'Only POST is allowed', { Allow: 'POST' });
    return getDocument(url);
  }
  if (req.method === 'POST') return post(req, url);
  return refuse(405, 'Only GET and POST are allowed', { Allow: 'GET, POST' });
}

/** Netlify's in-code function config, typed here so the site takes no @netlify/functions dependency. */
type FunctionConfig = { path: string[] };

// No rate-limit rule: legacy Free allows two code-based rules and snapshot.mts and card.mts hold
// them. The documents rely on the CDN window; the POST routes on the limiter above and the
// database's per-account limits.
export const config: FunctionConfig = { path: ['/api/community/*'] };
