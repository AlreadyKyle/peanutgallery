import { POSTED_TERMS, type StudioFixture } from './studio-fixture';

/**
 * The site's two documents (docs/specs/site-snapshot.md) built from a studio fixture the way
 * site_live() and site_cards() build them from the database: the listed set of cards (every card
 * on an open stage or paused, the newest 200 live and the newest 50 rejected), each listed card's
 * stage, bar, spend and funding in the live map, the newest 20 events with their card's title, the
 * newest 10 deploys and the newest 12 stopped cards. A null money or stopped stays null, which the
 * page shows as not available. The e2e run serves these at /api/live and /api/cards, and the unit
 * tests build the golden Snapshot from them.
 */
export type SnapshotDocuments = { live: Record<string, unknown>; cards: Record<string, unknown> };

const OPEN_OR_PAUSED = ['proposed', 'designing', 'voted', 'funded', 'building', 'gated', 'paused'];

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const desc = (key: string) => (a: Record<string, unknown>, b: Record<string, unknown>) =>
  text(b[key]).localeCompare(text(a[key])) || text(b.id).localeCompare(text(a.id));

/** The listed set, oldest first, as site_cards() orders it. */
export function listedCards(cards: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const open = cards.filter((card) => OPEN_OR_PAUSED.includes(text(card.stage)));
  const live = cards.filter((card) => card.stage === 'live').sort(desc('live_at')).slice(0, 200);
  const rejected = cards.filter((card) => card.stage === 'rejected').sort(desc('updated_at')).slice(0, 50);
  return [...open, ...live, ...rejected].sort(
    (a, b) => text(a.created_at).localeCompare(text(b.created_at)) || text(a.id).localeCompare(text(b.id)),
  );
}

export function toDocuments(studio: StudioFixture, builtAt = '2026-09-22T12:00:00+00:00'): SnapshotDocuments {
  const listed = listedCards(studio.cards);
  const spend = new Map(studio.spend.map((row) => [row.card_id, row.spent_usd]));
  const funding = new Map(studio.funding.map((row) => [row.card_id, row]));
  const titles = new Map(studio.cards.map((card) => [card.id, card.title]));
  const liveCards: Record<string, unknown> = {};
  for (const card of listed) {
    const counted = funding.get(card.id);
    liveCards[text(card.id)] = {
      stage: card.stage,
      funded_usd: card.funded_usd,
      spent_usd: spend.get(card.id) ?? 0,
      contributors: counted?.contributors ?? null,
      credited_usd: counted?.credited_usd ?? null,
    };
  }
  const live = {
    built_at: builtAt,
    pool: studio.pool,
    studio: {
      launched_at: studio.launchedAt,
      paused: studio.paused,
      platform_lane_open: false,
      pause_reason: studio.paused ? (studio.pauseReason ?? null) : null,
    },
    totals: studio.totals,
    money: studio.money,
    stopped: studio.stopped === null ? null : studio.stopped.slice(0, 12),
    cards: liveCards,
    events: [...studio.events]
      .sort(desc('created_at'))
      .slice(0, 20)
      .map(({ id, card_id, role_id, type, created_at }) => ({
        id,
        card_id,
        role_id,
        type,
        created_at,
        card_title: card_id === null ? null : (titles.get(card_id) ?? null),
      })),
    deploys: studio.deploys.slice(0, 10).map(({ id, folder, sha, is_green, created_at }) => ({ id, folder, sha, is_green, created_at })),
  };
  const cards = {
    cards: listed,
    roles: studio.roles,
    terms: studio.terms ?? POSTED_TERMS,
  };
  return { live, cards };
}
