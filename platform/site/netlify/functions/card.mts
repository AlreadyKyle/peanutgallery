// Kernel (platform/gate/kernel-paths.txt; docs/specs/supporter-pages.md): a card's own document and
// the /thanks answer, served from the site's own origin.
//
//   GET  /api/card/:id  site_card(p_id): the CDN keeps it 60 seconds, as /api/live
//   POST /api/thanks    thanks_for_session(p_session): never cached
//   GET  /api/card/:id/preview.png  the card's 1200×630 link preview, drawn from site_card's answer
//        (netlify/lib/card-preview.ts; docs/specs/card-preview.md): the CDN keeps it 10 minutes
//   GET|POST /api/unsubscribe  the ship notices' one-click unsubscribe (netlify/lib/unsubscribe.ts;
//        docs/specs/ship-notices.md): never cached; it shares this function's rate limit
//   POST /api/count  count_play_event(p_event): adds one to today's total for one of PLAY_EVENTS
//        (docs/specs/play-counts.md). The body is {"event": "<name>"}, at most 1 KB; it answers 204,
//        never cached, and reads no cookie, keeps no address and passes nothing but the event's name on
//
// Each is one call to Supabase's RPC endpoint with the publishable key, so the function reads only
// what anon may read (the unsubscribe writes only when the database finds its token matches). A card id that is not a uuid, and any query string on /api/card (which Netlify
// would put in the cache key), answer 400 before Supabase is called. /api/thanks takes a JSON body
// of at most 1 KB holding one well-formed Checkout Session id, and every answer it gives is no-store.

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../lib/public-env.ts';
import { unsubscribe, UNSUBSCRIBE_PATH } from '../lib/unsubscribe.ts';

/** How long one RPC call may take before the function answers 502. */
export const RPC_TIMEOUT_MS = 8_000;
/** The largest /api/thanks body read. */
export const MAX_BODY_BYTES = 1024;
/** A Stripe Checkout Session id, as /thanks takes it from the address. */
export const SESSION_PATTERN = /^cs_(live|test)_[A-Za-z0-9]{10,250}$/;
/**
 * The events /api/count takes; the database's count_play_event holds the same list. The first four are
 * the play counts (docs/specs/play-counts.md); the rest are the benchmarks' aggregate counters
 * (docs/specs/operations.md): a load from a save 1 or 7 days old, a session reaching 2 or 4 minutes,
 * a seed saved or opened from a link, a home load and its dwell buckets, the broadcast's load and its
 * QR source, and a click on a Discord link. Each is one daily total with nothing that names a person.
 */
export const PLAY_EVENTS = [
  'dust_load', 'dust_share', 'card_share', 'dust_next_card',
  'dust_return_1d', 'dust_return_7d', 'dust_session_2m', 'dust_session_4m', 'dust_seed_save', 'dust_seed_open',
  'home_load', 'home_dwell_mid', 'home_dwell_long', 'broadcast_load', 'broadcast_qr', 'discord_click',
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD_PATH = /^\/api\/card\/([^/]+)$/;
const PREVIEW_PATH = /^\/api\/card\/([^/]+)\/preview\.png$/;

const JSON_TYPE = 'application/json; charset=utf-8';
const NO_STORE = { 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store' };
/** The header /api/live carries (snapshot.mts): 60 seconds on the CDN, revalidated by the browser. */
const CARD_CACHE = {
  'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=60, stale-while-revalidate=60',
  'Cache-Control': 'public, max-age=0, must-revalidate',
};

function answer(status: number, body: string, headers: Record<string, string>): Response {
  return new Response(body, { status, headers: { 'Content-Type': JSON_TYPE, ...headers } });
}

function refuse(status: number, message: string, extra: Record<string, string> = {}): Response {
  return answer(status, JSON.stringify({ error: message }), { ...NO_STORE, ...extra });
}

/**
 * The RPC's JSON body as compact JSON text, or null for a Supabase error, a timeout, a network failure
 * or a body that is not JSON. PostgREST prints a jsonb result in jsonb's text form, with a space after
 * each colon and comma ('{"status": "pending"}'); the function answers one canonical form instead, so
 * an exact answer such as /api/thanks' pending reads the same from the fixtures and from production.
 */
async function rpc(name: string, args: Record<string, unknown>): Promise<string | null> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return JSON.stringify(JSON.parse(await response.text()));
  } catch {
    return null;
  }
}

function isObject(text: string): boolean {
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
}

async function card(id: string): Promise<Response> {
  if (!UUID.test(id)) return refuse(400, 'Not a card id');
  const body = await rpc('site_card', { p_id: id.toLowerCase() });
  if (body === null) return refuse(502, 'The studio database did not answer');
  if (body.trim() === 'null') return refuse(404, 'There is no card at this address');
  if (!isObject(body)) return refuse(502, 'The studio database did not answer');
  return answer(200, body, CARD_CACHE);
}

/** A preview changes only when its card does; 10 minutes on the CDN keeps rendering rare. */
const PREVIEW_CACHE = {
  'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=600, stale-while-revalidate=600',
  'Cache-Control': 'public, max-age=600',
};

async function preview(id: string): Promise<Response> {
  if (!UUID.test(id)) return refuse(400, 'Not a card id');
  const body = await rpc('site_card', { p_id: id.toLowerCase() });
  if (body === null) return refuse(502, 'The studio database did not answer');
  if (body.trim() === 'null') return refuse(404, 'There is no card at this address');
  // Imported here so /api/card and /api/thanks never load the renderer.
  const { previewCardFrom, renderPreview } = await import('../lib/card-preview.ts');
  const card = previewCardFrom(body);
  if (card === null) return refuse(502, 'The studio database did not answer');
  let png: Uint8Array<ArrayBuffer>;
  try {
    png = new Uint8Array(await renderPreview(card));
  } catch {
    return refuse(502, 'The preview could not be drawn');
  }
  return new Response(png, { status: 200, headers: { 'Content-Type': 'image/png', ...PREVIEW_CACHE } });
}

/** The session id from a JSON body of at most MAX_BODY_BYTES, or null. */
async function sessionFrom(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const session = (parsed as Record<string, unknown>).session;
    return typeof session === 'string' && SESSION_PATTERN.test(session) ? session : null;
  } catch {
    return null;
  }
}

async function thanks(req: Request): Promise<Response> {
  const session = await sessionFrom(req);
  if (session === null) return refuse(400, 'Send {"session": "cs_..."} as JSON, at most 1 KB');
  const body = await rpc('thanks_for_session', { p_session: session });
  if (body === null || !isObject(body)) return refuse(502, 'The studio database did not answer');
  return answer(200, body, NO_STORE);
}

/** The event name from a JSON body of at most MAX_BODY_BYTES, or null for anything not in PLAY_EVENTS. */
async function eventFrom(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const event = (parsed as Record<string, unknown>).event;
    return typeof event === 'string' && (PLAY_EVENTS as readonly string[]).includes(event) ? event : null;
  } catch {
    return null;
  }
}

async function count(req: Request): Promise<Response> {
  const event = await eventFrom(req);
  if (event === null) return refuse(400, `Send {"event": "<name>"} as JSON, at most 1 KB, naming one of ${PLAY_EVENTS.join(', ')}`);
  const body = await rpc('count_play_event', { p_event: event });
  if (body !== 'true') return refuse(502, 'The studio database did not answer');
  return new Response(null, { status: 204, headers: NO_STORE });
}

// Netlify calls the default export with (request, context); the tests stub globalThis.fetch.
export default async function cardFunction(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === UNSUBSCRIBE_PATH) return unsubscribe(req);
  if (url.pathname === '/api/count') {
    if (req.method !== 'POST') return refuse(405, 'Only POST is allowed', { Allow: 'POST' });
    return count(req);
  }
  if (url.pathname === '/api/thanks') {
    if (req.method !== 'POST') return refuse(405, 'Only POST is allowed', { Allow: 'POST' });
    return thanks(req);
  }
  const previewMatch = PREVIEW_PATH.exec(url.pathname);
  const match = previewMatch ?? CARD_PATH.exec(url.pathname);
  if (match === null) return refuse(404, 'Not found');
  if (req.method !== 'GET') return refuse(405, 'Only GET is allowed', { Allow: 'GET' });
  if (url.search !== '') return refuse(400, 'No query string is allowed');
  // A uuid never needs percent-decoding, and decoding a malformed escape such as %E0 would throw.
  return previewMatch === null ? card(match[1]!) : preview(match[1]!);
}

/** Netlify's in-code function config, typed here so the site takes no @netlify/functions dependency. */
type FunctionConfig = {
  path: string[];
  rateLimit: { windowLimit: number; windowSize: number; aggregateBy: ('ip' | 'domain')[] };
};

// The paths only, with no method key, so any method reaches the function and a wrong one answers
// 405. The rate limit is the second of the two code-based rules legacy Free allows (snapshot.mts
// takes the first), at snapshot.mts's 300 a minute per IP and domain: a card page reads /api/live
// and /api/cards too, and readers behind one address (a school, an office) share the limit. The
// preview shares this rule, so drawing images takes no rule of its own.
export const config: FunctionConfig = {
  path: ['/api/card/:id', '/api/card/:id/preview.png', '/api/thanks', '/api/unsubscribe', '/api/count'],
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
