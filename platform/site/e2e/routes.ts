import { SUPPORTER_ROUTES } from './supporter-studio';

/**
 * The one route list the design suite reads (docs/specs/design-review.md): design.spec.ts,
 * layout-balance.spec.ts and route-shots.spec.ts all take their routes from here, and
 * src/routes.test.ts fails when a page in src/routes.tsx is missing from ROUTES. Like the rest of
 * this folder it is kernel, so no card can take a page out of the checks. Each route carries a short
 * name, which the frames job's screenshots are named by (<name>-<width>.png).
 */
export type NamedRoute = readonly [name: string, path: string];

/** The design guide: unlisted and not indexed (DESIGN.md, Mockups). */
export const GUIDE = '/design-kit-7q4m';

/** Every page any studio draws, with the legal pages' first versions and the not-found page. */
export const PAGE_ROUTES: readonly NamedRoute[] = [
  ['home', '/'],
  ['contribute', '/contribute'],
  ['ledger', '/ledger'],
  ['how-it-works', '/how-it-works'],
  ['team', '/team'],
  ['roadmap', '/roadmap'],
  ['reports', '/reports'],
  ['terms', '/terms'],
  ['terms-1', '/terms/1'],
  ['privacy', '/privacy'],
  ['refunds', '/refunds'],
  ['refunds-1', '/refunds/1'],
  ['contact', '/contact'],
  ['not-found', '/no-such-page'],
  ['guide', GUIDE],
];

export const PAGE_PATHS: readonly string[] = PAGE_ROUTES.map(([, path]) => path);

/** The supporter pages (/card/:id for the fixture's cards, /thanks by session), drawn on SUPPORTER_STUDIO. */
export { SUPPORTER_ROUTES };

/** Every route the suite draws: the pages, then the supporter pages. */
export const ROUTES: readonly NamedRoute[] = [...PAGE_ROUTES, ...SUPPORTER_ROUTES];

/**
 * The routes whose page shows figures from the site's /api documents: a screenshot of one that still
 * shows its loading, unavailable or stale line instead is not a picture of the page.
 */
export function isDataRoute(path: string): boolean {
  const pathname = path.split('?')[0]!;
  return ['/', '/contribute', '/ledger', '/reports'].includes(pathname) || pathname.startsWith('/card/');
}
