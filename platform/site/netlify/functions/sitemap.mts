// Kernel (platform/gate/kernel-paths.txt; docs/specs/robots-sitemap.md): /sitemap.xml, the fixed pages
// and every card page a crawler should know, with each card's lastmod (netlify/lib/sitemap.ts).
//
//   GET /sitemap.xml  site_live() and site_cards(), read together, as feed.mts reads them; the CDN
//                     keeps it an hour and serves it stale 10 minutes more while it rebuilds
//
// Two calls to Supabase's RPC endpoint with the publishable key, so the sitemap reads only what anon
// may read. At most one build per window reaches the database whatever the traffic, and any query
// string answers 400 before Supabase is called (Netlify puts every query parameter in the cache key).
// When the database does not answer, the fixed pages still go out, never cached, so a crawler always
// has the site's pages and the next request reads the cards again.

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../lib/public-env.ts';
import { SITEMAP_PATH, SITEMAP_TYPE, sitemapFrom, staticSitemap } from '../lib/sitemap.ts';

/** How long one RPC call may take before the function falls back to the fixed pages. */
export const RPC_TIMEOUT_MS = 8_000;

const TEXT_TYPE = 'text/plain; charset=utf-8';
const NO_STORE = { 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store' };
export const SITEMAP_CACHE = {
  'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=3600, stale-while-revalidate=600',
  'Cache-Control': 'public, max-age=600',
};

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

function refuse(status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(`${message}\n`, { status, headers: { 'Content-Type': TEXT_TYPE, ...NO_STORE, ...extra } });
}

// Netlify calls the default export with (request, context); the tests stub globalThis.fetch.
export default async function sitemap(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== SITEMAP_PATH) return refuse(404, 'Not found');
  if (req.method !== 'GET') return refuse(405, 'Only GET is allowed', { Allow: 'GET' });
  if (url.search !== '') return refuse(400, 'No query string is allowed');
  try {
    const [live, cards] = await Promise.all([rpc('site_live'), rpc('site_cards')]);
    return new Response(sitemapFrom(live, cards), { status: 200, headers: { 'Content-Type': SITEMAP_TYPE, ...SITEMAP_CACHE } });
  } catch {
    // A Supabase error, a timeout, a network failure, a body that is not JSON or a malformed document.
    return new Response(staticSitemap(), { status: 200, headers: { 'Content-Type': SITEMAP_TYPE, ...NO_STORE } });
  }
}

/** Netlify's in-code function config, typed here so the site takes no @netlify/functions dependency. */
type FunctionConfig = { path: string[] };

// A literal, not SITEMAP_PATH: Netlify reads the config statically.
export const config: FunctionConfig = { path: ['/sitemap.xml'] };
