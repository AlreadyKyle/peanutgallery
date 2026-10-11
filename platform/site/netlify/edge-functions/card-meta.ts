// Kernel (platform/gate/kernel-paths.txt; docs/specs/card-preview.md): /card/:id with the card's own
// link preview tags (netlify/lib/card-meta.ts). The card's title comes from /api/card/:id on this
// origin, which the CDN already keeps for 60 seconds. When the id is not a card, or the read fails,
// the page goes out as it was, with the site's own preview.

import { cardIdFrom, metaFrom, withCardMeta } from '../lib/card-meta.ts';

type Context = { next: () => Promise<Response> };

export default async function cardMeta(req: Request, context: Context): Promise<Response> {
  const page = await context.next();
  const id = cardIdFrom(new URL(req.url).pathname);
  if (id === null || page.status !== 200 || !(page.headers.get('content-type') ?? '').includes('text/html')) return page;
  let meta = null;
  try {
    const answer = await fetch(new URL(`/api/card/${id}`, req.url), { signal: AbortSignal.timeout(4_000) });
    if (answer.ok) meta = metaFrom(await answer.text());
  } catch {
    meta = null;
  }
  if (meta === null) return page;
  const headers = new Headers(page.headers);
  headers.delete('content-length');
  return new Response(withCardMeta(await page.text(), id, meta), { status: 200, headers });
}

export const config = { path: '/card/*' };
