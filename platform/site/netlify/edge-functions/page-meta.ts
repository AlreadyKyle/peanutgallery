// Kernel (platform/gate/kernel-paths.txt; docs/specs/page-previews.md): each fixed page with its own
// link preview tags and a canonical link (netlify/lib/page-meta.ts), so a shared /ledger or /team
// previews as itself rather than as home. The words come from a fixed table, so nothing is read at
// run time. A path not in the table, a page that is not a 200 HTML answer, or an error goes out as it
// was, with the site's own preview (onError: bypass): a preview tag is never worth a failed page.

import { pageMetaFor, withPageMeta } from '../lib/page-meta.ts';

type Context = { next: () => Promise<Response> };

export default async function pageMeta(req: Request, context: Context): Promise<Response> {
  const page = await context.next();
  const pathname = new URL(req.url).pathname;
  const meta = pageMetaFor(pathname);
  if (meta === null || page.status !== 200 || !(page.headers.get('content-type') ?? '').includes('text/html')) return page;
  const headers = new Headers(page.headers);
  headers.delete('content-length');
  return new Response(withPageMeta(await page.text(), pathname, meta), { status: 200, headers });
}

// A literal, as Netlify reads the config without running the table: the same paths as PAGE_META's keys
// (netlify/page-meta.test.ts). /card/* is card-meta.ts's.
export const config = {
  path: [
    '/',
    '/contribute',
    '/ledger',
    '/how-it-works',
    '/team',
    '/reports',
    '/terms',
    '/privacy',
    '/refunds',
    '/contact',
    '/goals',
    '/studio/history',
    '/week',
    '/suggest',
    '/seeds',
    '/faq',
  ],
  onError: 'bypass',
};
