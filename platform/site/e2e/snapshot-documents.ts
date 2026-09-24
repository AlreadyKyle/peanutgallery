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

const READ_TOOLS = ['read', 'grep', 'glob', 'ls'];
const EDIT_TOOLS = ['edit', 'write', 'multiedit', 'notebookedit'];
const STEP_KEYS: Record<string, string> = {
  smoke_pass: 'smoke_passed',
  requeue: 'requeued',
  infrastructure: 'paused_infra',
  patch_reused: 'patch_reused',
  dealt: 'dealt',
  held: 'held',
};
const TYPE_KEYS: Record<string, string> = {
  start: 'started',
  tool_result: 'none',
  gate_pass: 'gate_passed',
  gate_fail: 'gate_failed',
  ship: 'shipped',
  revert: 'reverted',
  error: 'stopped',
};

/**
 * public.event_line_key in TypeScript, for fixtures (docs/specs/supporter-pages.md): a fixture event
 * may carry its tool `name` or message `step` in `payload`, or give its `line_key` outright.
 */
export function lineKeyOf(type: string, payload: Record<string, unknown> = {}): string {
  if (type === 'tool_call') {
    const name = String(payload.name ?? '').toLowerCase();
    if (READ_TOOLS.includes(name)) return 'read';
    if (EDIT_TOOLS.includes(name)) return 'edited';
    if (name === 'bash') return 'ran';
    if (name === 'submit_patch') return 'submitted';
    return 'used_tool';
  }
  if (type === 'message') return STEP_KEYS[String(payload.step ?? '')] ?? 'none';
  return TYPE_KEYS[type] ?? 'other';
}

/** A fixture event's line key: its own, else the one its type and payload give. */
export function eventLineKey(event: Record<string, unknown>): string {
  if (typeof event.line_key === 'string') return event.line_key;
  return lineKeyOf(text(event.type), (event.payload as Record<string, unknown> | undefined) ?? {});
}

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

/**
 * A stopped card the fixture lists only in `stopped`, as the cards table holds it: in the database a
 * paused or rejected card is a card like any other, so both documents carry it.
 */
function stoppedAsCard(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.card_id,
    title: row.title,
    summary: null,
    intent: null,
    source: 'board',
    stage: row.stage,
    shape: 'goal',
    bucket: 'game',
    folder: 'seed-1',
    horizon: 'now',
    rank: null,
    executor_role_id: null,
    funding_target_usd: row.funded_usd,
    funded_usd: row.funded_usd,
    failing_check: row.failing_check,
    created_at: row.stopped_at,
    updated_at: row.stopped_at,
    live_at: null,
  };
}

export function toDocuments(studio: StudioFixture, builtAt = '2026-09-22T12:00:00+00:00'): SnapshotDocuments {
  const known = new Set(studio.cards.map((card) => card.id));
  const table = [...studio.cards, ...(studio.stopped ?? []).filter((row) => !known.has(row.card_id)).map(stoppedAsCard)];
  const listed = listedCards(table);
  const spend = new Map<unknown, unknown>(studio.spend.map((row) => [row.card_id, row.spent_usd]));
  for (const row of studio.stopped ?? []) if (!spend.has(row.card_id)) spend.set(row.card_id, row.spent_usd);
  const funding = new Map(studio.funding.map((row) => [row.card_id, row]));
  const titles = new Map(table.map((card) => [card.id, card.title]));
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
    // The newest 20 with a public line; key none never reaches the document.
    events: [...studio.events]
      .filter((event) => eventLineKey(event) !== 'none')
      .sort(desc('created_at'))
      .slice(0, 20)
      .map((event) => ({
        id: event.id,
        card_id: event.card_id,
        role_id: event.role_id,
        type: event.type,
        created_at: event.created_at,
        card_title: event.card_id === null ? null : (titles.get(event.card_id) ?? null),
        line_key: eventLineKey(event),
      })),
    deploys: studio.deploys.slice(0, 10).map(({ id, folder, sha, is_green, created_at }) => ({ id, folder, sha, is_green, created_at })),
    role_stats: studio.roles.map((role) => ({
      role_id: role.id,
      spent_usd: 0,
      spent_7d_usd: 0,
      shipped_cards: 0,
      ...(studio.roleStats?.[text(role.id)] ?? {}),
    })),
  };
  const cards = {
    cards: listed,
    roles: studio.roles,
    terms: studio.terms ?? POSTED_TERMS,
  };
  return { live, cards };
}
