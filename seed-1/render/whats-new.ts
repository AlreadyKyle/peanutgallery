// What shipped for Dust since the player's last visit, shown under the canvas beside the studio line.
// Three-free and read only, like render/next-card.ts: it reads the site's public /api/cards
// document (proxied by netlify.toml, so connect-src 'self' holds) and lists the seed-1 cards at stage
// live whose live_at is after the last visit. The last visit is its own localStorage key, apart from
// the sim save, so SimState and its hash are untouched. Only a returning player (a save exists and a
// last visit was recorded) sees the line; a first visit, a failed read or nothing new leaves it hidden.

import { CARDS_PATH, cardUrl, GAME_FOLDER } from './next-card';

export const LAST_VISIT_KEY = 'dust.lastVisit';
const REQUEST_TIMEOUT_MS = 10_000;

export type ShippedCard = { id: string; title: string; liveAt: number };

type Doc = Record<string, unknown>;

function isDoc(value: unknown): value is Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The Dust cards that went live after `sinceMs`, newest first. Empty for a malformed document. */
export function shippedSince(cards: unknown, sinceMs: number): ShippedCard[] {
  if (!isDoc(cards) || !Array.isArray(cards.cards) || !Number.isFinite(sinceMs)) return [];
  const out: ShippedCard[] = [];
  for (const row of cards.cards) {
    if (!isDoc(row) || typeof row.id !== 'string' || row.folder !== GAME_FOLDER || row.stage !== 'live') continue;
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    const liveAt = typeof row.live_at === 'string' ? Date.parse(row.live_at) : NaN;
    if (title === '' || !Number.isFinite(liveAt) || liveAt <= sinceMs) continue;
    out.push({ id: row.id, title, liveAt });
  }
  return out.sort((a, b) => b.liveAt - a.liveAt || a.id.localeCompare(b.id));
}

/** The last visit recorded in storage, or null when none (or unreadable). */
export function parseLastVisit(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** The line's words and link: the newest card's page, with the count when more than one shipped. */
export function whatsNewText(shipped: ShippedCard[]): { label: string; aria: string; href: string } | null {
  const newest = shipped[0];
  if (newest === undefined) return null;
  const label =
    shipped.length === 1
      ? `New in Dust since your last visit: ${newest.title}`
      : `${shipped.length} changes shipped since your last visit. Newest: ${newest.title}`;
  return { label, aria: `${label}. Open its card to see what's new.`, href: cardUrl(newest.id) };
}

/** Reads /api/cards and lists what shipped since `sinceMs`; null on any failure. */
export async function loadShippedSince(
  sinceMs: number,
  fetchFn: typeof fetch = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<ShippedCard[] | null> {
  try {
    const response = await fetchFn(CARDS_PATH, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const doc = (await response.json()) as unknown;
    if (!isDoc(doc) || !Array.isArray(doc.cards)) return null;
    return shippedSince(doc, sinceMs);
  } catch {
    return null;
  }
}

export type WhatsNewElements = { root: HTMLElement; link: HTMLAnchorElement };

/** Fills and shows the line; leaves it hidden when nothing shipped. */
export function showWhatsNew(elements: WhatsNewElements, shipped: ShippedCard[] | null): void {
  const text = shipped === null ? null : whatsNewText(shipped);
  if (text === null) {
    elements.root.hidden = true;
    return;
  }
  elements.link.href = text.href;
  elements.link.textContent = text.label;
  elements.link.setAttribute('aria-label', text.aria);
  elements.root.hidden = false;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The whole flow for one page load. A returning player (a save under `saveKey` and a recorded last
 * visit) gets the line; the last visit moves to `now` once the read succeeds, or at once when there
 * is nothing to compare against, so a failed read does not swallow the news.
 */
export async function runWhatsNew(
  elements: WhatsNewElements,
  store: Store,
  saveKey: string,
  now: number,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  let hasSave = false;
  let last: number | null = null;
  try {
    hasSave = store.getItem(saveKey) !== null;
    last = parseLastVisit(store.getItem(LAST_VISIT_KEY));
  } catch {
    return;
  }
  const mark = (): void => {
    try {
      store.setItem(LAST_VISIT_KEY, String(Math.floor(now)));
    } catch {
      // Storage refused: the line simply does not show next time.
    }
  };
  if (!hasSave || last === null) {
    mark();
    return;
  }
  const shipped = await loadShippedSince(last, fetchFn);
  if (shipped === null) return;
  mark();
  showWhatsNew(elements, shipped);
}
