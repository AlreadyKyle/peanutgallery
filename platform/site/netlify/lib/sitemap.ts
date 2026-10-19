// Kernel (platform/gate/kernel-paths.txt; docs/specs/robots-sitemap.md): /sitemap.xml, built from
// the two public documents the site already reads (site_live and site_cards). It lists the fixed
// pages the page-meta edge function names (netlify/lib/page-meta.ts), then every card a visitor can
// fund, watch being built or play: each card on horizon now and each live card, with when its page
// last changed in a way a crawler cares about (the ship time for a live card, otherwise when it was
// drafted). Nothing about supporters is read.

import { isRunnable, shippedAt, shippedOrder } from '../../src/lib/cards.ts';
import { snapshotFrom, type Card } from '../../src/lib/source.ts';
import { SITE } from './card-meta.ts';
import { escapeXml } from './feed.ts';
import { PAGE_META } from './page-meta.ts';

export const SITEMAP_PATH = '/sitemap.xml';
export const SITEMAP_TYPE = 'application/xml; charset=utf-8';

/** The fixed pages, in the order the kernel route list holds them: the same paths page-meta.ts names. */
export const STATIC_PATHS: readonly string[] = Object.keys(PAGE_META);

export type SitemapUrl = { loc: string; lastmod: string | null };

/** An ISO time in the W3C form a sitemap takes, or null for one that does not parse. */
function w3c(iso: string): string | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function time(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * The cards with a public page worth indexing: every live card, newest ship first, then the cards on
 * horizon now (open for funding, funded, building or in the gate), newest first. A planned card
 * (horizon next or later, not open) and one the board held back are left out.
 */
export function sitemapCards(cards: readonly Card[]): Card[] {
  const live = cards.filter((card) => card.stage === 'live').sort(shippedOrder);
  const now = cards
    .filter((card) => card.stage !== 'live' && isRunnable(card) && card.board_vetoed !== true)
    .sort((a, b) => time(b.created_at) - time(a.created_at));
  return [...live, ...now];
}

/** Every address the sitemap lists: the fixed pages with no lastmod, then the cards'. */
export function sitemapUrls(cards: readonly Card[]): SitemapUrl[] {
  return [
    ...STATIC_PATHS.map((path) => ({ loc: `${SITE}${path}`, lastmod: null })),
    ...sitemapCards(cards).map((card) => ({
      loc: `${SITE}/card/${card.id}`,
      lastmod: w3c(card.stage === 'live' ? shippedAt(card) : card.created_at),
    })),
  ];
}

/** The sitemap document. */
export function sitemapXml(urls: readonly SitemapUrl[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(({ loc, lastmod }) => `  <url><loc>${escapeXml(loc)}</loc>${lastmod === null ? '' : `<lastmod>${lastmod}</lastmod>`}</url>`),
    '</urlset>',
    '',
  ].join('\n');
}

/** The sitemap from the two documents' parsed JSON; throws on a malformed document, as the pages do. */
export function sitemapFrom(liveDoc: unknown, cardsDoc: unknown): string {
  return sitemapXml(sitemapUrls(snapshotFrom(liveDoc, cardsDoc).cards));
}

/** The fixed pages alone: what /sitemap.xml answers while the studio database does not. */
export function staticSitemap(): string {
  return sitemapXml(sitemapUrls([]));
}
