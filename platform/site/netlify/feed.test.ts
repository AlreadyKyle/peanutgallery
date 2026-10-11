// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
// Beside the functions folder, not in it: Netlify deploys every file in netlify/functions as a function.
import feed, { config, FEED_CACHE } from './functions/feed.mts';
import { atomFeed, escapeXml, FEED_LIMIT, feedFrom } from './lib/feed';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './lib/public-env';

const ORIGIN = 'https://site.example';
const BUILT_AT = '2026-10-01T12:00:00+00:00';
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

type Row = { id: string; title: string; summary: string | null; stage: string; spent: number; liveAt: string | null };

function documents(rows: Row[]): { live: Record<string, unknown>; cards: Record<string, unknown> } {
  const live: Record<string, unknown> = {
    built_at: BUILT_AT,
    pool: null,
    studio: {},
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    money: null,
    stopped: null,
    cards: Object.fromEntries(
      rows.map((row) => [
        row.id,
        {
          stage: row.stage,
          horizon: 'now',
          rank: null,
          executor_role_id: null,
          funding_target_usd: 10,
          funded_usd: 10,
          spent_usd: row.spent,
          contributors: null,
          credited_usd: null,
          live_at: row.liveAt,
          updated_at: row.liveAt ?? BUILT_AT,
        },
      ]),
    ),
    events: [],
    deploys: [],
    role_stats: [],
  };
  const cards = {
    cards: rows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      intent: null,
      source: 'board',
      shape: 'feature',
      bucket: 'game',
      folder: 'seed-1',
      created_at: '2026-09-01T00:00:00+00:00',
    })),
    roles: [],
    terms: [],
  };
  return { live, cards };
}

/** A small well-formedness check: every tag opened is closed in order, and no bare & or < is left in text. */
function wellFormed(xml: string): boolean {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  if (/&(?!(amp|lt|gt|quot|apos);)/.test(body)) return false;
  const stack: string[] = [];
  for (const match of body.matchAll(/<(\/?)([A-Za-z][\w:-]*)([^<>]*?)(\/?)>/g)) {
    const [, close, name, , self] = match;
    if (self === '/') continue;
    if (close === '/') {
      if (stack.pop() !== name) return false;
    } else stack.push(name!);
  }
  return stack.length === 0 && body.replace(/<[^<>]*>/g, '').indexOf('<') === -1;
}

describe('the feed document', () => {
  it('escapes a title and summary carrying XML characters', () => {
    expect(escapeXml(`Tom & Jerry's <b>"fast"</b>\u0001`)).toBe('Tom &amp; Jerry&apos;s &lt;b&gt;&quot;fast&quot;&lt;/b&gt;');
    const { live, cards } = documents([
      { id: ID_A, title: 'Dust <beta> & "rain"', summary: 'Wind & <sand>.', stage: 'live', spent: 1.5, liveAt: '2026-09-30T10:00:00+00:00' },
    ]);
    const xml = feedFrom(live, cards);
    expect(xml).toContain('<title type="text">Dust &lt;beta&gt; &amp; &quot;rain&quot;</title>');
    expect(xml).toContain('<summary type="text">Wind &amp; &lt;sand&gt;. The agents spent $1.50 on it.</summary>');
    expect(xml).not.toContain('<beta>');
    expect(wellFormed(xml)).toBe(true);
  });

  it('is valid Atom: one feed with its id, title, self link, updated and an entry per shipped card, newest first', () => {
    const { live, cards } = documents([
      { id: ID_A, title: 'Older ship', summary: null, stage: 'live', spent: 2, liveAt: '2026-09-20T10:00:00+00:00' },
      { id: ID_B, title: 'Newer ship', summary: 'A sky.', stage: 'live', spent: 0.25, liveAt: '2026-09-29T08:30:00+00:00' },
      { id: ID_C, title: 'Still building', summary: 'Not yet.', stage: 'building', spent: 3, liveAt: null },
    ]);
    const xml = feedFrom(live, cards);
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">')).toBe(true);
    expect(xml).toContain('<id>https://mobmachine.games/feed.xml</id>');
    expect(xml).toContain('<link rel="self" type="application/atom+xml" href="https://mobmachine.games/feed.xml"/>');
    expect(xml).toContain('<author><name>Mob Machine</name></author>');
    expect(xml).toContain('<updated>2026-09-29T08:30:00.000Z</updated>');
    expect(xml.match(/<entry>/g)).toHaveLength(2);
    expect(xml.indexOf('Newer ship')).toBeLessThan(xml.indexOf('Older ship'));
    expect(xml).not.toContain('Still building');
    expect(xml).toContain(`<link rel="alternate" type="text/html" href="https://mobmachine.games/card/${ID_B}"/>`);
    expect(xml).toContain(`<id>https://mobmachine.games/card/${ID_B}</id>`);
    expect(xml).toContain('<summary type="text">Shipped. The agents spent $2.00 on it.</summary>');
    // Every entry carries the elements Atom requires of it.
    for (const block of xml.split('<entry>').slice(1)) {
      for (const tag of ['<id>', '<title type="text">', '<updated>', '<link rel="alternate"', '<summary type="text">']) expect(block).toContain(tag);
    }
    expect(wellFormed(xml)).toBe(true);
  });

  it('with no shipped card is still a valid feed, updated at the document build time', () => {
    const { live, cards } = documents([]);
    const xml = feedFrom(live, cards);
    expect(xml).not.toContain('<entry>');
    expect(xml).toContain('<updated>2026-10-01T12:00:00.000Z</updated>');
    expect(wellFormed(xml)).toBe(true);
  });

  it(`carries at most ${FEED_LIMIT} entries`, () => {
    const many = Array.from({ length: FEED_LIMIT + 5 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      title: `Card ${i}`,
      summary: null,
      stage: 'live',
      spent: 1,
      liveAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
    }));
    const { live, cards } = documents(many);
    expect(feedFrom(live, cards).match(/<entry>/g)).toHaveLength(FEED_LIMIT);
  });

  it('names nothing about supporters', () => {
    const xml = atomFeed([], BUILT_AT);
    expect(xml).not.toMatch(/supporter|contributor|email/i);
  });
});

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

const get = (path: string, method = 'GET') => feed(new Request(`${ORIGIN}${path}`, { method }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the feed function', () => {
  it('answers /feed.xml as Atom from site_live and site_cards with the publishable key, cached 120 seconds on the CDN', async () => {
    const { live, cards } = documents([{ id: ID_A, title: 'Shipped', summary: null, stage: 'live', spent: 1, liveAt: '2026-09-30T10:00:00+00:00' }]);
    const calls = stubFetch(({ url }) => Promise.resolve(new Response(JSON.stringify(url.endsWith('site_live') ? live : cards), { status: 200 })));
    const response = await get('/feed.xml');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/atom+xml; charset=utf-8');
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe(FEED_CACHE['Netlify-CDN-Cache-Control']);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(await response.text()).toContain('<title type="text">Shipped</title>');
    expect(calls.map((call) => call.url).sort()).toEqual([`${SUPABASE_URL}/rest/v1/rpc/site_cards`, `${SUPABASE_URL}/rest/v1/rpc/site_live`]);
    for (const call of calls) {
      expect((call.init.headers as Record<string, string>).apikey).toBe(SUPABASE_PUBLISHABLE_KEY);
      expect(Object.keys(call.init.headers as Record<string, string>)).not.toContain('Authorization');
    }
  });

  it('refuses a query string, a POST and another path before Supabase is called', async () => {
    const calls = stubFetch(() => Promise.reject(new Error('called')));
    const query = await get('/feed.xml?utm=1');
    expect(query.status).toBe(400);
    expect(query.headers.get('Cache-Control')).toBe('no-store');
    const post = await get('/feed.xml', 'POST');
    expect(post.status).toBe(405);
    expect(post.headers.get('Allow')).toBe('GET');
    expect((await get('/feed')).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('answers 502, never cached, when the database errors or sends a malformed document', async () => {
    stubFetch(() => Promise.resolve(new Response('oops', { status: 500 })));
    const failed = await get('/feed.xml');
    expect(failed.status).toBe(502);
    expect(failed.headers.get('Cache-Control')).toBe('no-store');
    stubFetch(() => Promise.resolve(new Response('{"cards":[]}', { status: 200 })));
    expect((await get('/feed.xml')).status).toBe(502);
  });

  it('serves /feed.xml only', () => {
    expect(config.path).toEqual(['/feed.xml']);
  });
});
