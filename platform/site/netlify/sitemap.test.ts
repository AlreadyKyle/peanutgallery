// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
// Beside the functions folder, not in it: Netlify deploys every file in netlify/functions as a function.
import sitemap, { config, SITEMAP_CACHE } from './functions/sitemap.mts';
import { PAGE_META } from './lib/page-meta';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './lib/public-env';
import { sitemapFrom, staticSitemap, STATIC_PATHS } from './lib/sitemap';

// docs/specs/robots-sitemap.md: /sitemap.xml lists the fixed pages, then every card page worth
// indexing with its lastmod, from the two public documents.
const ORIGIN = 'https://site.example';
const BUILT_AT = '2026-10-01T12:00:00+00:00';
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Row = { id: string; stage: string; horizon?: string; created: string; liveAt?: string | null; vetoed?: boolean; title?: string };

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
          horizon: row.horizon ?? 'now',
          rank: null,
          executor_role_id: null,
          funding_target_usd: 1,
          funded_usd: 0,
          spent_usd: 0,
          contributors: null,
          credited_usd: null,
          live_at: row.liveAt ?? null,
          updated_at: row.liveAt ?? row.created,
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
      title: row.title ?? `Card ${row.id.slice(-2)}`,
      summary: null,
      intent: null,
      source: 'board',
      shape: 'feature',
      bucket: 'game',
      folder: 'seed-1',
      created_at: row.created,
      ...(row.vetoed === true ? { board_vetoed: true } : {}),
    })),
    roles: [],
    terms: [],
  };
  return { live, cards };
}

function locs(xml: string): { loc: string; lastmod: string | null }[] {
  return [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)].map((match) => ({ loc: match[1]!, lastmod: match[2] ?? null }));
}

describe('the sitemap document', () => {
  it('lists the fixed pages page-meta.ts names, in order, with no lastmod', () => {
    expect(STATIC_PATHS).toEqual(Object.keys(PAGE_META));
    const xml = staticSitemap();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')).toBe(true);
    expect(xml.endsWith('</urlset>\n')).toBe(true);
    expect(locs(xml)).toEqual(STATIC_PATHS.map((path) => ({ loc: `https://mobmachine.games${path}`, lastmod: null })));
  });

  it('adds every live card by its ship time, newest first, then every card on horizon now by when it was drafted', () => {
    const { live, cards } = documents([
      { id: ID(1), stage: 'live', created: '2026-09-01T00:00:00+00:00', liveAt: '2026-09-20T10:00:00+00:00' },
      { id: ID(2), stage: 'live', created: '2026-09-02T00:00:00+00:00', liveAt: '2026-09-29T08:30:00+00:00' },
      { id: ID(3), stage: 'proposed', created: '2026-09-25T00:00:00+00:00' },
      { id: ID(4), stage: 'building', created: '2026-09-27T00:00:00+00:00' },
      { id: ID(5), stage: 'funded', created: '2026-09-26T06:00:00+00:00' },
    ]);
    const cardsListed = locs(sitemapFrom(live, cards)).slice(STATIC_PATHS.length);
    expect(cardsListed).toEqual([
      { loc: `https://mobmachine.games/card/${ID(2)}`, lastmod: '2026-09-29T08:30:00.000Z' },
      { loc: `https://mobmachine.games/card/${ID(1)}`, lastmod: '2026-09-20T10:00:00.000Z' },
      { loc: `https://mobmachine.games/card/${ID(4)}`, lastmod: '2026-09-27T00:00:00.000Z' },
      { loc: `https://mobmachine.games/card/${ID(5)}`, lastmod: '2026-09-26T06:00:00.000Z' },
      { loc: `https://mobmachine.games/card/${ID(3)}`, lastmod: '2026-09-25T00:00:00.000Z' },
    ]);
  });

  it('leaves out planned cards, cards the board held back, and paused or rejected cards', () => {
    const { live, cards } = documents([
      { id: ID(1), stage: 'proposed', horizon: 'next', created: '2026-09-25T00:00:00+00:00' },
      { id: ID(2), stage: 'proposed', created: '2026-09-25T00:00:00+00:00', vetoed: true },
      { id: ID(3), stage: 'rejected', created: '2026-09-25T00:00:00+00:00' },
      { id: ID(4), stage: 'paused', created: '2026-09-25T00:00:00+00:00' },
      { id: ID(5), stage: 'live', horizon: 'later', created: '2026-09-02T00:00:00+00:00', liveAt: '2026-09-29T08:30:00+00:00' },
    ]);
    expect(locs(sitemapFrom(live, cards)).slice(STATIC_PATHS.length).map((url) => url.loc)).toEqual([`https://mobmachine.games/card/${ID(5)}`]);
  });

  it('names nothing but addresses and times', () => {
    const { live, cards } = documents([{ id: ID(1), stage: 'live', created: '2026-09-01T00:00:00+00:00', liveAt: '2026-09-20T10:00:00+00:00', title: 'Secret <b>title</b>' }]);
    const xml = sitemapFrom(live, cards);
    expect(xml).not.toContain('Secret');
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

const get = (path: string, method = 'GET') => sitemap(new Request(`${ORIGIN}${path}`, { method }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sitemap function', () => {
  it('answers /sitemap.xml as XML from site_live and site_cards with the publishable key, cached an hour on the CDN', async () => {
    const { live, cards } = documents([{ id: ID(7), stage: 'live', created: '2026-09-01T00:00:00+00:00', liveAt: '2026-09-30T10:00:00+00:00' }]);
    const calls = stubFetch(({ url }) => Promise.resolve(new Response(JSON.stringify(url.endsWith('site_live') ? live : cards), { status: 200 })));
    const response = await get('/sitemap.xml');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe(SITEMAP_CACHE['Netlify-CDN-Cache-Control']);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=600');
    expect(await response.text()).toContain(`<url><loc>https://mobmachine.games/card/${ID(7)}</loc><lastmod>2026-09-30T10:00:00.000Z</lastmod></url>`);
    expect(calls.map((call) => call.url).sort()).toEqual([`${SUPABASE_URL}/rest/v1/rpc/site_cards`, `${SUPABASE_URL}/rest/v1/rpc/site_live`]);
    for (const call of calls) {
      expect((call.init.headers as Record<string, string>).apikey).toBe(SUPABASE_PUBLISHABLE_KEY);
      expect(Object.keys(call.init.headers as Record<string, string>)).not.toContain('Authorization');
    }
  });

  it('refuses a query string, a POST and another path before Supabase is called', async () => {
    const calls = stubFetch(() => Promise.reject(new Error('called')));
    const query = await get('/sitemap.xml?utm=1');
    expect(query.status).toBe(400);
    expect(query.headers.get('Cache-Control')).toBe('no-store');
    const post = await get('/sitemap.xml', 'POST');
    expect(post.status).toBe(405);
    expect(post.headers.get('Allow')).toBe('GET');
    expect((await get('/sitemap')).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('still lists the fixed pages, never cached, when the database errors or sends a malformed document', async () => {
    for (const answer of [() => new Response('oops', { status: 500 }), () => new Response('{"cards":[]}', { status: 200 })]) {
      stubFetch(() => Promise.resolve(answer()));
      const response = await get('/sitemap.xml');
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('no-store');
      expect(await response.text()).toBe(staticSitemap());
    }
  });

  it('serves /sitemap.xml only', () => {
    expect(config.path).toEqual(['/sitemap.xml']);
  });
});
