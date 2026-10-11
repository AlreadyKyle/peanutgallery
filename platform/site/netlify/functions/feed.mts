// Kernel (platform/gate/kernel-paths.txt; docs/specs/ship-feed.md): /feed.xml, an Atom feed of every
// shipped card, so anyone can follow the studio without paying or giving an email.
//
//   GET /feed.xml  site_live() and site_cards(), read together; the CDN keeps it 120 seconds and
//                  serves it stale 60 seconds more while it rebuilds
//
// Two calls to Supabase's RPC endpoint with the publishable key, the same two documents snapshot.mts
// serves, so the feed reads only what anon may read. At most one build per window reaches the
// database whatever the traffic, and any query string answers 400 before Supabase is called (Netlify
// puts every query parameter in the cache key). Legacy Free allows two code-based rate-limit rules,
// and snapshot.mts and card.mts hold them, so this path relies on the CDN window instead.

import { FEED_PATH, FEED_TYPE, feedFrom } from '../lib/feed.ts';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../lib/public-env.ts';

/** How long one RPC call may take before the function answers 502. */
export const RPC_TIMEOUT_MS = 8_000;

const TEXT_TYPE = 'text/plain; charset=utf-8';
const NO_STORE = { 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store' };
export const FEED_CACHE = {
  'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=120, stale-while-revalidate=60',
  'Cache-Control': 'public, max-age=60',
};

function refuse(status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(`${message}\n`, { status, headers: { 'Content-Type': TEXT_TYPE, ...NO_STORE, ...extra } });
}

async function rpc(name: string): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${name} answered ${response.status}`);
  return JSON.parse(await response.text());
}

// Netlify calls the default export with (request, context); the tests stub globalThis.fetch.
export default async function feed(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== FEED_PATH) return refuse(404, 'Not found');
  if (req.method !== 'GET') return refuse(405, 'Only GET is allowed', { Allow: 'GET' });
  if (url.search !== '') return refuse(400, 'No query string is allowed');
  let body: string;
  try {
    const [live, cards] = await Promise.all([rpc('site_live'), rpc('site_cards')]);
    body = feedFrom(live, cards);
  } catch {
    // A Supabase error, a timeout, a network failure, a body that is not JSON or a malformed document.
    return refuse(502, 'The studio database did not answer');
  }
  return new Response(body, { status: 200, headers: { 'Content-Type': FEED_TYPE, ...FEED_CACHE } });
}

/** Netlify's in-code function config, typed here so the site takes no @netlify/functions dependency. */
type FunctionConfig = { path: string[] };

// A literal, not FEED_PATH: Netlify reads the config statically.
export const config: FunctionConfig = { path: ['/feed.xml'] };
