// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE, PAGE_PATHS } from '../e2e/routes';

// public/robots.txt and public/sitemap.xml (docs/specs/robots-sitemap.md). Without them both paths
// fell through to the page's HTML. The sitemap lists every page in the kernel route list except the
// versioned legal pages, the not-found page and the unlisted design guide, so a new page fails here
// until it is listed. Paths resolve from the package root vitest runs in (see styles.test.ts).
const robots = readFileSync(resolve(process.cwd(), 'public/robots.txt'), 'utf8');
const sitemap = readFileSync(resolve(process.cwd(), 'public/sitemap.xml'), 'utf8');
const ORIGIN = 'https://mobmachine.games';

describe('robots.txt and sitemap.xml', () => {
  it('allows crawling and names the sitemap', () => {
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toMatch(new RegExp(`^Sitemap: ${ORIGIN}/sitemap.xml$`, 'm'));
    expect(robots).not.toMatch(/Disallow/);
  });

  it('lists every public page and nothing else', () => {
    const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
    const expected = PAGE_PATHS.filter((path) => !/\/\d+$/.test(path) && path !== '/no-such-page' && path !== GUIDE);
    expect(listed).toEqual(expected.map((path) => `${ORIGIN}${path}`));
  });

  it('never names the design guide', () => {
    expect(robots).not.toContain(GUIDE);
    expect(sitemap).not.toContain(GUIDE);
  });
});
