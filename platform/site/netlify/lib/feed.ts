// Kernel (platform/gate/kernel-paths.txt; docs/specs/ship-feed.md): the Atom feed of every shipped
// card, built from the two public documents the site already reads (site_live and site_cards). It
// carries only what the card pages already show: the title, the ship time, what studio-billed agent
// turns spent, the card's own public summary and its address. Nothing about supporters is read.

import { shippedAt, shippedOrder } from '../../src/lib/cards.ts';
import { formatUsd } from '../../src/lib/format.ts';
import { snapshotFrom, type Card } from '../../src/lib/source.ts';
import { SITE, STUDIO_NAME } from './card-meta.ts';

/** The newest ships a feed carries; older ones stay on the site. */
export const FEED_LIMIT = 50;
export const FEED_PATH = '/feed.xml';
export const FEED_TYPE = 'application/atom+xml; charset=utf-8';

// Characters XML 1.0 does not allow at all: C0 controls other than tab, newline and return, and U+FFFE/F.
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Text safe inside an XML element or a quoted attribute. */
export function escapeXml(text: string): string {
  return text
    .replace(ILLEGAL, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** An ISO time in the RFC 3339 UTC form Atom requires, or null for one that does not parse. */
function rfc3339(iso: string): string | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The entry's plain summary: the card's own public summary, then what the agents spent. */
export function entrySummary(card: Card): string {
  const spent = `The agents spent ${formatUsd(card.spent_usd)} on it.`;
  const summary = (card.summary ?? '').trim();
  return summary === '' ? `Shipped. ${spent}` : `${summary} ${spent}`;
}

function entry(card: Card): string | null {
  const updated = rfc3339(shippedAt(card));
  if (updated === null) return null;
  const link = `${SITE}/card/${card.id}`;
  return [
    '  <entry>',
    `    <id>${escapeXml(link)}</id>`,
    `    <title type="text">${escapeXml(card.title)}</title>`,
    `    <link rel="alternate" type="text/html" href="${escapeXml(link)}"/>`,
    `    <published>${updated}</published>`,
    `    <updated>${updated}</updated>`,
    `    <summary type="text">${escapeXml(entrySummary(card))}</summary>`,
    '  </entry>',
  ].join('\n');
}

/** The shipped cards, newest first, at most FEED_LIMIT. */
export function shippedCards(cards: readonly Card[]): Card[] {
  return cards.filter((card) => card.stage === 'live').sort(shippedOrder).slice(0, FEED_LIMIT);
}

/**
 * The Atom document. `builtAt` (the live document's build time) is the feed's updated time when no
 * card has shipped, so an empty feed is still valid Atom.
 */
export function atomFeed(cards: readonly Card[], builtAt: string): string {
  const shipped = shippedCards(cards);
  const entries = shipped.map(entry).filter((text): text is string => text !== null);
  const newest = shipped.map((card) => rfc3339(shippedAt(card))).find((time) => time !== null);
  const updated = newest ?? rfc3339(builtAt) ?? new Date(0).toISOString();
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${SITE}${FEED_PATH}</id>`,
    `  <title type="text">${escapeXml(`${STUDIO_NAME}: every shipped card`)}</title>`,
    '  <subtitle type="text">Each card the agents ship, with what they spent on it.</subtitle>',
    `  <link rel="self" type="application/atom+xml" href="${SITE}${FEED_PATH}"/>`,
    `  <link rel="alternate" type="text/html" href="${SITE}/"/>`,
    `  <author><name>${escapeXml(STUDIO_NAME)}</name></author>`,
    `  <updated>${updated}</updated>`,
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}

/** The feed from the two documents' parsed JSON; throws on a malformed document, as the pages do. */
export function feedFrom(liveDoc: unknown, cardsDoc: unknown): string {
  const snapshot = snapshotFrom(liveDoc, cardsDoc);
  return atomFeed(snapshot.cards, (liveDoc as { built_at: string }).built_at);
}
