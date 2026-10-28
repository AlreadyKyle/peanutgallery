// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE, PAGE_PATHS } from '../e2e/routes';
import { copy } from '../src/lib/copy';
import { faq } from '../src/lib/faq';
import { legal } from '../src/lib/legal';
import { NEWEST_TERMS } from '../src/lib/terms-versions';
// Beside the edge-functions folder, not in it: Netlify deploys every file there as an edge function.
import pageMeta, { config } from './edge-functions/page-meta';
import { withCanonical, withCardMeta } from './lib/card-meta';
import { PAGE_META, pageMetaFor, pageTitle, withPageMeta } from './lib/page-meta';

// docs/specs/page-previews.md: each fixed page's link preview names the page, from a table the edge
// function holds, kept in step here with each page's own words and with the kernel route list.
const SITE_DIR = join(__dirname, '..');
const html = readFileSync(join(SITE_DIR, 'index.html'), 'utf8');
const ID = '00000000-0000-4000-8000-000000000004';

function tag(page: string, attribute: 'name' | 'property', key: string): string | null {
  return page.match(new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`))?.[1] ?? null;
}
function canonicals(page: string): string[] {
  return [...page.matchAll(/<link rel="canonical" href="([^"]*)" \/>/g)].map((match) => match[1]!);
}

describe('the page table', () => {
  it("holds each page's own title and lede, as the page draws them", () => {
    const pitch = `${copy.pitchTitle} ${copy.pitchBody}`;
    const pages: Record<string, { title: string; lede: string }> = {
      '/': { title: copy.studioName, lede: pitch },
      '/contribute': { title: legal.contributeTitle, lede: legal.contributeLede },
      '/ledger': { title: legal.ledger, lede: legal.ledgerLede },
      '/how-it-works': copy.howItWorksPage,
      '/team': copy.team,
      '/reports': copy.reports,
      '/terms': NEWEST_TERMS.terms,
      '/privacy': legal.privacy,
      '/refunds': NEWEST_TERMS.refunds,
      '/contact': legal.contact,
      '/goals': copy.goals,
      '/studio/history': copy.history,
      '/week': copy.week,
      '/suggest': copy.suggest,
      '/seeds': copy.seeds,
      '/faq': faq,
    };
    expect(Object.keys(PAGE_META)).toEqual(Object.keys(pages));
    for (const [path, page] of Object.entries(pages)) {
      expect(PAGE_META[path], path).toEqual({ title: page.title, description: page.lede });
    }
    // Home's entry is index.html's own, so the function only adds home's canonical link.
    expect(tag(html, 'name', 'description')).toBe(pitch);
  });

  it('covers every indexed page in the kernel route list, and the edge function runs on exactly those paths', () => {
    // As the sitemap: no versioned legal page, not-found page, design guide, player's page or overlay.
    const unlisted = ['/no-such-page', GUIDE, '/u/sample-player', '/me', '/broadcast', '/sign-in', '/sign-up', '/forgot-password', '/reset-password'];
    const indexed = PAGE_PATHS.filter((path) => !/\/\d+$/.test(path) && !unlisted.includes(path));
    expect(Object.keys(PAGE_META)).toEqual(indexed);
    expect(config.path).toEqual(Object.keys(PAGE_META));
    expect(config.onError).toBe('bypass');
    expect(pageMetaFor('/card/x')).toBeNull();
    expect(pageMetaFor('/ledger/')).toBeNull();
    expect(pageMetaFor('/toString')).toBeNull();
  });
});

describe("a page's tags", () => {
  it('names the page, its description and its address, adds one canonical link and leaves the rest alone', () => {
    const out = withPageMeta(html, '/ledger', PAGE_META['/ledger']!);
    expect(out).toContain('<title>Ledger · Mob Machine</title>');
    expect(tag(out, 'property', 'og:title')).toBe('Ledger · Mob Machine');
    expect(tag(out, 'property', 'og:url')).toBe('https://mobmachine.games/ledger');
    expect(tag(out, 'name', 'description')).toBe(PAGE_META['/ledger']!.description);
    expect(tag(out, 'property', 'og:description')).toBe(PAGE_META['/ledger']!.description);
    expect(canonicals(out)).toEqual(['https://mobmachine.games/ledger']);
    for (const key of ['og:image', 'og:image:alt', 'og:site_name', 'og:type']) expect(tag(out, 'property', key), key).toBe(tag(html, 'property', key));
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out.indexOf('<link rel="canonical"')).toBeLessThan(out.indexOf('</head>'));
  });

  it('keeps home as the studio name and only adds its canonical link', () => {
    const out = withPageMeta(html, '/', PAGE_META['/']!);
    expect(pageTitle('/', PAGE_META['/']!)).toBe('Mob Machine');
    expect(out.replace(/\n\s*<link rel="canonical" href="https:\/\/mobmachine.games\/" \/>/, '')).toBe(html);
  });

  it('escapes the words and replaces a canonical link rather than adding a second', () => {
    const out = withPageMeta(html, '/ledger', { title: `Fish & "chips" <b> $' $&`, description: 'Crisp $& "too".' });
    expect(out).toContain('<title>Fish &amp; &quot;chips&quot; &lt;b&gt; $\' $&amp; · Mob Machine</title>');
    expect(tag(out, 'name', 'description')).toBe('Crisp $&amp; &quot;too&quot;.');
    expect(canonicals(withCanonical(out, 'https://mobmachine.games/team'))).toEqual(['https://mobmachine.games/team']);
  });

  it("gives a card's page its own canonical link too", () => {
    const out = withCardMeta(html, ID, { title: 'A dash', summary: 'Quick.' });
    expect(canonicals(out)).toEqual([`https://mobmachine.games/card/${ID}`]);
    // index.html itself names no canonical address: it is served at every path.
    expect(canonicals(html)).toEqual([]);
  });
});

describe('the edge function', () => {
  const served = (body: string, status = 200, type = 'text/html; charset=UTF-8') => ({
    next: async () => new Response(body, { status, headers: { 'content-type': type, 'content-length': String(body.length), etag: '"abc"' } }),
  });

  it('serves a page in the table with its own tags, whatever the query string', async () => {
    const answer = await pageMeta(new Request('https://mobmachine.games/team?from=reddit'), served(html));
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-length')).toBeNull();
    expect(answer.headers.get('etag')).toBe('"abc"');
    const out = await answer.text();
    expect(out).toContain('<title>The team · Mob Machine</title>');
    expect(tag(out, 'property', 'og:url')).toBe('https://mobmachine.games/team');
    expect(canonicals(out)).toEqual(['https://mobmachine.games/team']);
  });

  it('passes through a path not in the table, a page that is not 200 and an answer that is not HTML', async () => {
    for (const [url, context] of [
      ['https://mobmachine.games/u/someone', served(html)],
      ['https://mobmachine.games/ledger', served('gone', 404)],
      ['https://mobmachine.games/ledger', served('{}', 200, 'application/json')],
    ] as const) {
      const before = await context.next();
      const answer = await pageMeta(new Request(url), { next: async () => before });
      expect(answer, url).toBe(before);
    }
  });
});
