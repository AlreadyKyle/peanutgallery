// Kernel (platform/gate/kernel-paths.txt; docs/specs/page-previews.md): the link preview tags of the
// site's fixed pages. A link preview reader runs no script, so the title each page sets once it runs
// (PageHeader.tsx) never reaches it, and every page previewed as home with home's address. The edge
// function page-meta.ts puts the page's own title, description and address, and a canonical link,
// into index.html's tags before the page leaves the CDN, as card-meta.ts does for a card's page.
// Web APIs only: it runs on Deno at the edge and under vitest here.

import { escapeAttr, SITE, STUDIO_NAME, withCanonical } from './card-meta.ts';

export type PageMeta = { readonly title: string; readonly description: string };

/**
 * Every indexed page by path: its own title (each page's PageHeader title, as copy.ts, legal.ts,
 * faq.ts and terms-versions.ts hold it) and its lede as the description; home keeps index.html's
 * pitch. A fixed table, so the edge function reads nothing at run time; netlify/page-meta.test.ts
 * fails when a page's words move and the table does not, or when a page is added to the kernel route
 * list (e2e/routes.ts) and not here. The sitemap lists the same paths (sitemap.ts).
 */
export const PAGE_META: Readonly<Record<string, PageMeta>> = {
  '/': { title: STUDIO_NAME, description: 'Watch AI agents build a game studio and free games. Fund the card you want built next.' },
  '/contribute': { title: 'Fund a card', description: 'Fund the next card in line, or pick the one you want built. Set the split below, then choose an amount at checkout.' },
  '/ledger': { title: 'Ledger', description: 'What the agents have to spend, what their work paid for by contributions has cost, and their latest actions and deploys.' },
  '/how-it-works': { title: 'How it works', description: 'Supporters fund the changes they want. AI agents build them, and the public ledger shows what the work cost.' },
  '/team': { title: 'The team', description: 'These agents run the studio. Most are an AI model with a role and tools, and a few are plain code.' },
  '/reports': {
    title: 'Weekly reports',
    description: "Each report covers one week, Monday to Sunday in New York time, and code builds it from the studio's public records. A week with nothing shipped has no report.",
  },
  '/terms': { title: 'Terms', description: 'What a contribution pays for, what it does not buy, and the rules that apply.' },
  '/privacy': { title: 'Privacy', description: 'What the studio stores when you contribute, and what it does not.' },
  '/refunds': { title: 'Refunds', description: 'How to ask for a refund, and what a refund changes.' },
  '/contact': { title: 'Contact', description: 'How to reach the studio.' },
  '/goals': { title: 'Goals', description: 'One track shows everything the studio has raised and what each milestone delivers.' },
  '/studio/history': { title: 'Studio history', description: 'Each era of the studio is kept here as a blueprint, from the garage on.' },
  '/suggest': { title: 'Ideas', description: 'Pitch a change you want and upvote the ideas you back. The most backed can become cards to fund.' },
  '/seeds': { title: 'Seeds', description: 'Saved runs anyone can open and play from the same moment.' },
  '/faq': { title: 'Questions', description: 'Plain answers about the studio, the money, the cards and your account.' },
};

/** The page's own tags for a path in the table, or null for any other path. */
export function pageMetaFor(pathname: string): PageMeta | null {
  return Object.hasOwn(PAGE_META, pathname) ? PAGE_META[pathname]! : null;
}

/** The tab and preview title, as PageHeader sets it once the page runs; home is the studio name alone. */
export function pageTitle(pathname: string, meta: PageMeta): string {
  return pathname === '/' ? meta.title : `${meta.title} · ${STUDIO_NAME}`;
}

/** The page's own address: the canonical link and og:url. */
export function pageUrl(pathname: string): string {
  return `${SITE}${pathname}`;
}

/** index.html with the page's own title, description, address and canonical link; other tags untouched. */
export function withPageMeta(html: string, pathname: string, meta: PageMeta): string {
  const title = pageTitle(pathname, meta);
  const url = pageUrl(pathname);
  const values: [string, string][] = [
    ['property="og:title"', title],
    ['property="og:url"', url],
    ['property="og:description"', meta.description],
    ['name="description"', meta.description],
  ];
  let out = html;
  for (const [attr, value] of values) {
    out = out.replace(new RegExp(`(<meta ${attr} content=")[^"]*(")`), (_, a: string, b: string) => `${a}${escapeAttr(value)}${b}`);
  }
  // A function, as in withCardMeta: a value holding $' or $& must not be read as a replacement pattern.
  out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeAttr(title)}</title>`);
  return withCanonical(out, url);
}
