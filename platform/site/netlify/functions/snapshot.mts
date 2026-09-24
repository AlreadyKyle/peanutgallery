// Kernel (platform/gate/kernel-paths.txt; docs/specs/site-snapshot.md): the public site's two
// documents, served from its own origin and cached by Netlify's CDN.
//
//   GET /api/live   site_live(), the figures that move; the CDN keeps it 60 seconds
//   GET /api/cards  site_cards(), the text that rarely moves; the CDN keeps it 300 seconds
//
// Each build is one call to Supabase's RPC endpoint with the publishable key, so the function reads
// only what anon may read, and at most one build per window reaches the database whatever the
// traffic. Netlify puts every query parameter in the cache key, so any query string answers 400
// before Supabase is called: a random query cannot skip the cache and reach the database.

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../lib/public-env.ts';

/** How long one RPC call may take before the function answers 502. */
export const RPC_TIMEOUT_MS = 8_000;

const DOCUMENTS: Record<string, { rpc: string; seconds: number }> = {
  '/api/live': { rpc: 'site_live', seconds: 60 },
  '/api/cards': { rpc: 'site_cards', seconds: 300 },
};

const JSON_TYPE = 'application/json; charset=utf-8';
const NO_STORE = { 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store' };

function answer(status: number, body: string, headers: Record<string, string>): Response {
  return new Response(body, { status, headers: { 'Content-Type': JSON_TYPE, ...headers } });
}

function refuse(status: number, message: string, extra: Record<string, string> = {}): Response {
  return answer(status, JSON.stringify({ error: message }), { ...NO_STORE, ...extra });
}

// Netlify calls the default export with (request, context); the tests stub globalThis.fetch.
export default async function snapshot(req: Request): Promise<Response> {
  if (req.method !== 'GET') return refuse(405, 'Only GET is allowed', { Allow: 'GET' });
  const url = new URL(req.url);
  if (url.search !== '') return refuse(400, 'No query string is allowed');
  const document = DOCUMENTS[url.pathname];
  if (document === undefined) return refuse(404, 'Not found');
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${document.rpc}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!response.ok) return refuse(502, 'The studio database did not answer');
    const body = await response.text();
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return refuse(502, 'The studio database did not answer');
    return answer(200, body, {
      'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${document.seconds}, stale-while-revalidate=${document.seconds}`,
      'Cache-Control': 'public, max-age=0, must-revalidate',
    });
  } catch {
    // A timeout, a network failure or a body that is not JSON.
    return refuse(502, 'The studio database did not answer');
  }
}

/** Netlify's in-code function config, typed here so the site takes no @netlify/functions dependency. */
type FunctionConfig = {
  path: string[];
  rateLimit: { windowLimit: number; windowSize: number; aggregateBy: ('ip' | 'domain')[] };
};

// The paths only, with no method key, so a POST reaches the function and answers 405 instead of
// falling through to the page rewrite. The rate limit is the first of the two code-based rules
// legacy Free allows; supporter-pages takes the second. Every full page load reads both documents
// (the Terms pages a third time), so 300 a minute is about 150 page loads from one address: a school
// or an office behind one address, or the live check, stays under it, and a runaway loop does not.
export const config: FunctionConfig = {
  path: ['/api/live', '/api/cards'],
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
