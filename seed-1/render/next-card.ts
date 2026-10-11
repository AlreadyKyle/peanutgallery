// The next card to fund that changes Dust, shown under the canvas beside the studio line. Phaser-free and read only: it reads
// the site's two public documents, /api/live and /api/cards, the same documents every figure on
// mobmachine.games comes from (platform/site/netlify/functions/snapshot.mts). netlify.toml proxies
// both paths to the site, so the fetch stays on this origin and connect-src 'self' holds. Any failure,
// a malformed document or no open Dust card leaves the line hidden.

export const SITE_URL = 'https://mobmachine.games';
export const LIVE_PATH = '/api/live';
export const CARDS_PATH = '/api/cards';
export const GAME_FOLDER = 'seed-1';
const REQUEST_TIMEOUT_MS = 10_000;

export type NextCard = {
  id: string;
  title: string;
  fundedUsd: number;
  targetUsd: number;
};

type Doc = Record<string, unknown>;

function isDoc(value: unknown): value is Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The first card in the waterfall's order (money.funding_order, the order the site's Fund the next
 * card in line follows) whose folder is seed-1, with its title and bar. Null when the order did not
 * load, no Dust card is in it, or a document is malformed.
 */
export function pickNextCard(live: unknown, cards: unknown): NextCard | null {
  if (!isDoc(live) || !isDoc(cards) || !isDoc(live.money) || !isDoc(live.cards) || !Array.isArray(cards.cards)) return null;
  const order = live.money.funding_order;
  if (!Array.isArray(order)) return null;
  const words = new Map<string, Doc>();
  for (const row of cards.cards) {
    if (isDoc(row) && typeof row.id === 'string') words.set(row.id, row);
  }
  for (const place of order) {
    if (!isDoc(place) || typeof place.card_id !== 'string') continue;
    const row = words.get(place.card_id);
    const state = live.cards[place.card_id];
    if (row === undefined || !isDoc(state) || row.folder !== GAME_FOLDER) continue;
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    const fundedUsd = finiteNumber(state.funded_usd);
    const targetUsd = finiteNumber(state.funding_target_usd);
    if (title === '' || fundedUsd === null || targetUsd === null || targetUsd <= 0) return null;
    if (state.horizon !== 'now' || state.stage === 'live') return null;
    return { id: place.card_id, title, fundedUsd: Math.max(0, fundedUsd), targetUsd };
  }
  return null;
}

/** The card's page on the site. */
export function cardUrl(id: string): string {
  return `${SITE_URL}/card/${encodeURIComponent(id.toLowerCase())}`;
}

/** Whole dollars, or cents when the figure has them: "$12", "$12.50". */
export function formatUsd(value: number): string {
  const cents = Math.round(value * 100);
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** How full the bar is, from 0 to 1. */
export function barFraction(card: NextCard): number {
  return Math.min(1, Math.max(0, card.fundedUsd / card.targetUsd));
}

/** The line's words: what the card is and how far its bar has filled. */
export function nextCardText(card: NextCard): { label: string; amount: string; aria: string } {
  const amount = `${formatUsd(card.fundedUsd)} of ${formatUsd(card.targetUsd)}`;
  return {
    label: `Next for Dust: ${card.title}`,
    amount,
    aria: `Next for Dust: ${card.title}, ${amount} funded. Open its card to fund it.`,
  };
}

/** Reads both documents and picks the card; null on any failure. */
export async function loadNextCard(fetchFn: typeof fetch = fetch, timeoutMs = REQUEST_TIMEOUT_MS): Promise<NextCard | null> {
  try {
    const read = async (path: string): Promise<unknown> => {
      const response = await fetchFn(path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`${path} answered ${response.status}`);
      return (await response.json()) as unknown;
    };
    const [live, cards] = await Promise.all([read(LIVE_PATH), read(CARDS_PATH)]);
    return pickNextCard(live, cards);
  } catch {
    return null;
  }
}

/** The elements index.html carries for the line. */
export type NextCardElements = {
  root: HTMLElement;
  link: HTMLAnchorElement;
  title: HTMLElement;
  amount: HTMLElement;
  fill: HTMLElement;
};

/** Fills and shows the line; leaves it hidden when there is no card. */
export function showNextCard(elements: NextCardElements, card: NextCard | null): void {
  if (card === null) {
    elements.root.hidden = true;
    return;
  }
  const text = nextCardText(card);
  elements.link.href = cardUrl(card.id);
  elements.link.setAttribute('aria-label', text.aria);
  elements.title.textContent = text.label;
  elements.amount.textContent = text.amount;
  elements.fill.style.width = `${Math.round(barFraction(card) * 100)}%`;
  elements.root.hidden = false;
}
