import { toNumber, type Numeric } from './format';
import SNAPSHOT_KEYS from './snapshot-keys.json';

export type Pool = {
  balance_usd: number;
  reserve_usd: number;
  incident_reserve_usd: number;
  held_usd: number;
  daily_spent_usd: number;
  day: string;
};

/** When a card is meant to be built: now (open to funding and the agents), next or later (the roadmap). */
export type Horizon = 'now' | 'next' | 'later';
export const HORIZONS: readonly Horizon[] = ['now', 'next', 'later'];

export type Card = {
  id: string;
  title: string;
  summary: string | null;
  intent: string | null;
  source: string;
  stage: string;
  shape: string;
  bucket: string;
  folder: string;
  /** Only a card on horizon now takes money or runs; next and later cards are planned, not built. */
  horizon: Horizon;
  /** Order within a horizon, lowest first; null when the board has not ranked it. */
  rank: number | null;
  /** The role that builds the card, or null. */
  executor_role_id: string | null;
  /**
   * The role that drafted the card when an agent wrote it (docs/specs/agent-workflows.md); null or
   * absent for a card the board filed. The card then carries 'Written by the <role>, an AI agent'.
   */
  drafter_role_id?: string | null;
  funding_target_usd: number;
  funded_usd: number;
  /**
   * What studio-billed agent turns on this card cost, from public_card_spend. Founder-billed
   * turns (attended work on the founder's subscription) are tracked and never published
   * (PLAN.md §4 The Board), so the site never reads cards.actual_usd.
   */
  spent_usd: number;
  created_at: string;
  /** The last change to the card row. A held release or a refund moves it after a card ships. */
  updated_at: string;
  /** When the card went live; null before it ships. */
  live_at: string | null;
  /**
   * When an approved agent card is dealt to horizon now (docs/specs/agent-system-core.md); null or
   * absent for a card that is not waiting to be dealt.
   */
  opens_at?: string | null;
  /** The board has held the card back, with its reason; absent reads as not vetoed. */
  board_vetoed?: boolean;
  board_veto_reason?: string | null;
  /**
   * Board work (docs/specs/copy-pass.md, PLAN.md §4 Work): a change to how the studio runs, which the
   * board makes itself and no card funds. /roadmap groups it apart. Absent reads as not board work.
   */
  board_work?: boolean;
};

export type CardFunding = {
  contributors: number;
  credited_usd: number;
};

export type LedgerTotals = {
  usd_total: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  row_count: number;
};

export type AgentEvent = {
  id: string;
  card_id: string | null;
  role_id: string | null;
  type: string;
  created_at: string;
  // What the database did to a card on a line no role wrote (dealt, ceiling_top_up, resume_rule), and
  // the top-up's amount; absent or null on every other line.
  step?: string | null;
  usd?: number | string | null;
  /**
   * The event's fixed public line (public.event_line_key, docs/specs/supporter-pages.md): started,
   * read, edited, ran, submitted, used_tool, a message step's key, gate_passed and so on. Absent in a
   * document from before the key existed; the page then says the type's verb.
   */
  line_key?: string;
};

/** A role's studio-billed spend and ships, from public_role_stats (docs/specs/supporter-pages.md). */
export type RoleStats = {
  spent_usd: number;
  spent_7d_usd: number;
  shipped_cards: number;
};

/** A deploy row. The smoke bot's raw output stays in the database; the site shows only passed or failed. */
export type Deploy = {
  id: string;
  folder: string;
  sha: string;
  is_green: boolean;
  created_at: string;
};

/** One place in the waterfall's order (public_money.funding_order): a card that takes money and its room. */
export type FundingPlace = {
  card_id: string;
  room_usd: number;
};

/**
 * The books in one row, from public_money (docs/specs/money-logic.md): the money-in figures, which
 * leave out the board's own test payment and add up (received - fees - refunded - disputed +
 * corrections = reserve + studio + emergency fund + held + agent credit); Not on a card yet and the
 * shortfall; the board's test payment; the last reconcile with Stripe; and the order money fills
 * cards in.
 */
export type Money = {
  payments: number;
  received_usd: number;
  stripe_fees_usd: number;
  refunded_usd: number;
  disputed_usd: number;
  corrections_usd: number;
  /** The studio share supporters chose at checkout, averaged by amount; null before any payment. */
  studio_pct_avg: number | null;
  reserve_usd: number;
  studio_usd: number;
  incident_usd: number;
  held_usd: number;
  agent_credit_usd: number;
  not_on_card_usd: number;
  short_usd: number;
  board_test_usd: number;
  /** When the latest reconcile run finished, set only when it passed. */
  reconciled_at: string | null;
  /** The latest reconcile run's result; null when none has run. */
  last_run_ok: boolean | null;
  funding_order: FundingPlace[];
};

/** Where a rejected card's unspent money went: a card, or Not on a card yet when to_card_id is null. */
export type StoppedMove = {
  to_card_id: string | null;
  to_title: string | null;
  usd: number;
};

/** A rejected or paused card on horizon now, from public_stopped_cards: why it stopped and its money trail. */
export type StoppedCard = {
  card_id: string;
  title: string;
  stage: 'paused' | 'rejected';
  failing_check: string | null;
  spent_usd: number;
  funded_usd: number;
  credited_usd: number;
  moved: StoppedMove[];
  stopped_at: string;
};

/** A role from the public_roles view: the public columns of roles, never its prompt or budget. */
export type Role = {
  id: string;
  name: string;
  title: string;
  /** What the role does, in one plain paragraph; null until the roles are seeded with it. */
  description: string | null;
  species_note: string;
  model: string;
  write_access: boolean;
  state: string;
  hired_at: string;
  /** The roster's place for the role (docs/specs/carry-over.md): running, starts or planned; null when unset. */
  status?: string | null;
  /** When a role that does not run yet starts, in one sentence; null when unset. */
  trigger?: string | null;
  /** The board or the moderator has paused the role (docs/specs/agent-system-core.md), with its reason. */
  paused?: boolean;
  paused_reason?: string | null;
  /**
   * The role's work is code only (docs/specs/agent-upkeep.md): every job it has calls no model and
   * runs while the studio is paused, and it builds no card. public_roles reads it from jobs.
   */
  code_only?: boolean;
};

/**
 * The parts of a snapshot the page can do without. When one is missing, the snapshot carries its
 * empty value and names it in `missing`, so a page says that part is unavailable instead of showing
 * zero. From the site's two documents (docs/specs/site-snapshot.md) only the books and the stopped
 * cards can be missing, when the live document carries them as null; any other missing key, wrong
 * type or malformed figure rejects the whole load, and a page keeps its last figures marked stale.
 */
export const ENRICHMENTS = ['funding', 'spend', 'studio', 'totals', 'events', 'deploys', 'roles', 'money', 'stopped', 'cardTitles'] as const;
export type Enrichment = (typeof ENRICHMENTS)[number];

export type Snapshot = {
  pool: Pool | null;
  cards: Card[];
  funding: Record<string, CardFunding>;
  launchedAt: string | null;
  /** True while the board has paused the agents. False when the studio row did not load. */
  paused: boolean;
  /**
   * True once the platform code lane is open (studio_state.platform_lane_open, docs/specs/board-site.md).
   * Absent or false while it is closed, or when the studio row did not load.
   */
  platformLaneOpen?: boolean;
  /**
   * Why the studio is paused (public_studio.pause_reason): awaiting_credit, spend_limit, incident or
   * board; null while it is not paused, when the reason is missing or when the studio row did not load.
   */
  pauseReason?: string | null;
  totals: LedgerTotals;
  events: AgentEvent[];
  deploys: Deploy[];
  roles: Role[];
  cardTitles: Record<string, string>;
  /**
   * The books, from public_money; null when it did not load (then 'money' is in missing). A snapshot
   * built without it (a sample or a test) leaves it out, which reads the same as not loaded.
   */
  money?: Money | null;
  /** The newest rejected and paused cards, from public_stopped_cards; empty when it did not load. */
  stopped?: StoppedCard[];
  /**
   * Each role's studio-billed spend and ships, by role id, from public_role_stats. A snapshot built
   * without it (a sample or a test) leaves it out, and /team then shows no cost or ships.
   */
  roleStats?: Record<string, RoleStats>;
  /** The enrichments that failed to load, in ENRICHMENTS order. */
  missing: Enrichment[];
};


/** The one thing the pages need from a source: a fresh Snapshot, or a rejection. */
export interface StudioSource {
  load(): Promise<Snapshot>;
}

// Kernel (docs/specs/board-site.md, docs/specs/site-snapshot.md): every figure on the site comes from
// two documents on the site's own origin, which netlify/functions/snapshot.mts builds from
// site_live() and site_cards() and the CDN caches. The page holds no Supabase client.

export const LIVE_URL = '/api/live';
export const CARDS_URL = '/api/cards';
/** How long one request may take before it is aborted and the load rejects. */
export const REQUEST_TIMEOUT_MS = 10_000;
/** The card document is read again once the copy held is older than this. */
export const CARDS_MAX_AGE_MS = 5 * 60_000;
/** The stages the pages list: fund (proposed, designing, voted), queued (funded), building (building, gated) and shipped (live). */
export const CARD_STAGES = ['proposed', 'designing', 'voted', 'funded', 'building', 'gated', 'live'] as const;

type JsonType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
type KeySpec = Record<string, string | readonly string[]>;
type Doc = Record<string, unknown>;

/**
 * The keys each document must carry and their JSON types, and the keys of each card in the live
 * document's map (live_card); the Deno migration test checks the SQL against it.
 */
export const REQUIRED_KEYS: { live: KeySpec; live_card: KeySpec; cards: KeySpec } = SNAPSHOT_KEYS;

function jsonType(value: unknown): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as JsonType;
}

function isDoc(value: unknown): value is Doc {
  return jsonType(value) === 'object';
}

/** The document, once every required key is present with its type; keys it does not know are ignored. */
function checked(name: string, value: unknown, spec: KeySpec): Doc {
  if (!isDoc(value)) throw new Error(`${name} is not a JSON object`);
  for (const [key, allowed] of Object.entries(spec)) {
    if (!(key in value)) throw new Error(`${name} has no ${key}`);
    const types: readonly string[] = typeof allowed === 'string' ? [allowed] : allowed;
    const found = jsonType(value[key]);
    if (!types.includes(found)) throw new Error(`${name}.${key} is ${found}, not ${types.join(' or ')}`);
  }
  return value;
}

function money(value: unknown): number {
  const n = toNumber(value as Numeric);
  if (n === null) throw new Error(`Malformed numeric value: ${String(value)}`);
  return n;
}

function text(row: Doc, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Malformed ${key}: ${String(value)}`);
  return value;
}

function textOrNull(row: Doc, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`Malformed ${key}: ${String(value)}`);
  return value;
}

function rows(value: unknown, name: string): Doc[] {
  if (!Array.isArray(value) || !value.every(isDoc)) throw new Error(`Malformed ${name}`);
  return value;
}

function poolFrom(row: unknown): Pool | null {
  if (row === null) return null;
  if (!isDoc(row)) throw new Error('Malformed pool');
  return {
    balance_usd: money(row.balance_usd),
    reserve_usd: money(row.reserve_usd),
    incident_reserve_usd: money(row.incident_reserve_usd),
    held_usd: money(row.held_usd),
    daily_spent_usd: money(row.daily_spent_usd),
    day: text(row, 'day'),
  };
}

function horizonFrom(value: unknown): Horizon {
  if (!(HORIZONS as readonly unknown[]).includes(value)) throw new Error(`Malformed horizon: ${String(value)}`);
  return value as Horizon;
}

function rankFrom(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return money(value);
}

/** A card's state from the live document's map: every column that moves as the card travels. */
type LiveCard = Pick<Card, 'stage' | 'horizon' | 'rank' | 'executor_role_id' | 'funding_target_usd' | 'funded_usd' | 'spent_usd' | 'live_at' | 'updated_at'> & {
  funding: CardFunding | null;
};

function liveCardFrom(id: string, value: unknown): LiveCard {
  const entry = checked(`/api/live cards.${id}`, value, REQUIRED_KEYS.live_card);
  return {
    stage: text(entry, 'stage'),
    horizon: horizonFrom(entry.horizon),
    rank: rankFrom(entry.rank),
    executor_role_id: textOrNull(entry, 'executor_role_id'),
    funding_target_usd: money(entry.funding_target_usd),
    funded_usd: money(entry.funded_usd),
    spent_usd: money(entry.spent_usd),
    live_at: textOrNull(entry, 'live_at'),
    updated_at: text(entry, 'updated_at'),
    funding: entry.contributors === null ? null : { contributors: money(entry.contributors), credited_usd: money(entry.credited_usd) },
  };
}

/**
 * A card: its words from the card document, and everything that moves from the live document (its
 * stage, horizon, rank, builder, target, bar, spend, ship time and last change). The card document
 * runs up to about fifteen minutes behind and the live document about three, so a card that ships
 * or is dealt to now shows its new stage with its ship time, horizon and target, never a mix.
 */
function cardFrom(row: Doc, live: LiveCard): Card {
  return {
    id: text(row, 'id'),
    title: text(row, 'title'),
    summary: textOrNull(row, 'summary'),
    intent: textOrNull(row, 'intent'),
    source: text(row, 'source'),
    stage: live.stage,
    shape: text(row, 'shape'),
    bucket: text(row, 'bucket'),
    folder: text(row, 'folder'),
    horizon: live.horizon,
    rank: live.rank,
    executor_role_id: live.executor_role_id,
    drafter_role_id: textOrNull(row, 'drafter_role_id'),
    funding_target_usd: live.funding_target_usd,
    funded_usd: live.funded_usd,
    spent_usd: live.spent_usd,
    created_at: text(row, 'created_at'),
    updated_at: live.updated_at,
    live_at: live.live_at,
    opens_at: textOrNull(row, 'opens_at'),
    board_vetoed: row.board_vetoed === true,
    board_veto_reason: textOrNull(row, 'board_veto_reason'),
    board_work: row.board_work === true,
  };
}

function roleFrom(row: Doc): Role {
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    title: text(row, 'title'),
    description: textOrNull(row, 'description'),
    species_note: textOrNull(row, 'species_note') ?? '',
    model: textOrNull(row, 'model') ?? '',
    write_access: row.write_access === true,
    state: text(row, 'state'),
    hired_at: text(row, 'hired_at'),
    status: textOrNull(row, 'status'),
    trigger: textOrNull(row, 'trigger'),
    paused: row.paused === true,
    paused_reason: textOrNull(row, 'paused_reason'),
    code_only: row.code_only === true,
  };
}

function roleStatsFrom(value: unknown): Record<string, RoleStats> {
  const stats: Record<string, RoleStats> = {};
  for (const row of rows(value, 'role_stats')) {
    stats[text(row, 'role_id')] = {
      spent_usd: money(row.spent_usd),
      spent_7d_usd: money(row.spent_7d_usd),
      shipped_cards: money(row.shipped_cards),
    };
  }
  return stats;
}

function moneyFrom(row: Doc): Money {
  const order = row.funding_order === null || row.funding_order === undefined ? [] : rows(row.funding_order, 'funding_order');
  return {
    payments: money(row.payments),
    received_usd: money(row.received_usd),
    stripe_fees_usd: money(row.stripe_fees_usd),
    refunded_usd: money(row.refunded_usd),
    disputed_usd: money(row.disputed_usd),
    corrections_usd: money(row.corrections_usd),
    studio_pct_avg: row.studio_pct_avg === null || row.studio_pct_avg === undefined ? null : money(row.studio_pct_avg),
    reserve_usd: money(row.reserve_usd),
    studio_usd: money(row.studio_usd),
    incident_usd: money(row.incident_usd),
    held_usd: money(row.held_usd),
    agent_credit_usd: money(row.agent_credit_usd),
    not_on_card_usd: money(row.not_on_card_usd),
    short_usd: money(row.short_usd),
    board_test_usd: money(row.board_test_usd),
    reconciled_at: textOrNull(row, 'reconciled_at'),
    last_run_ok: typeof row.last_run_ok === 'boolean' ? row.last_run_ok : null,
    funding_order: order.map((place) => ({ card_id: text(place, 'card_id'), room_usd: money(place.room_usd) })),
  };
}

/** A public_stopped_cards row; card-source.ts reads a card's own row with it. */
export function stoppedFrom(row: Doc): StoppedCard {
  const stage = text(row, 'stage');
  if (stage !== 'paused' && stage !== 'rejected') throw new Error(`Unexpected stopped stage: ${stage}`);
  const moved = row.moved === null || row.moved === undefined ? [] : rows(row.moved, 'moved');
  return {
    card_id: text(row, 'card_id'),
    title: text(row, 'title'),
    stage,
    failing_check: textOrNull(row, 'failing_check'),
    spent_usd: money(row.spent_usd),
    funded_usd: money(row.funded_usd),
    credited_usd: money(row.credited_usd),
    moved: moved.map((move) => ({ to_card_id: textOrNull(move, 'to_card_id'), to_title: textOrNull(move, 'to_title'), usd: money(move.usd) })),
    stopped_at: text(row, 'stopped_at'),
  };
}

function totalsFrom(row: Doc): LedgerTotals {
  return {
    usd_total: money(row.usd_total),
    input_tokens: money(row.input_tokens),
    cached_tokens: money(row.cached_tokens),
    output_tokens: money(row.output_tokens),
    row_count: money(row.row_count),
  };
}

/** The Snapshot the pages read, from the two documents. Throws on a missing key, a wrong type or a malformed figure. */
export function snapshotFrom(liveDoc: unknown, cardsDoc: unknown): Snapshot {
  const live = checked('/api/live', liveDoc, REQUIRED_KEYS.live);
  const text_ = checked('/api/cards', cardsDoc, REQUIRED_KEYS.cards);
  const liveCards = new Map(Object.entries(live.cards as Doc).map(([id, value]) => [id, liveCardFrom(id, value)]));
  const missing = new Set<Enrichment>();

  // A card in the card document but not in the live map is not shown; nor is a paused or rejected
  // card, which the pages list only through `stopped` (docs/specs/money-surfaces.md).
  const cards: Card[] = [];
  for (const row of rows(text_.cards, 'cards')) {
    const now = liveCards.get(text(row, 'id'));
    if (now === undefined || !(CARD_STAGES as readonly string[]).includes(now.stage)) continue;
    cards.push(cardFrom(row, now));
  }
  const funding: Record<string, CardFunding> = {};
  for (const [id, entry] of liveCards) if (entry.funding !== null) funding[id] = entry.funding;

  const studio = live.studio as Doc;
  const paused = studio.paused === true;

  const events: AgentEvent[] = [];
  const cardTitles: Record<string, string> = {};
  for (const row of rows(live.events, 'events')) {
    const cardId = textOrNull(row, 'card_id');
    // step and usd name what the database did to a card (dealt, topped up, resumed by rule); a line
    // without them carries neither key, as the pages read it (EventList.tsx).
    const step = textOrNull(row, 'step');
    const usd = row.usd === null || row.usd === undefined ? null : money(row.usd);
    const lineKey = textOrNull(row, 'line_key');
    events.push({
      id: text(row, 'id'),
      card_id: cardId,
      role_id: textOrNull(row, 'role_id'),
      type: text(row, 'type'),
      created_at: text(row, 'created_at'),
      ...(step === null ? {} : { step }),
      ...(usd === null ? {} : { usd }),
      ...(lineKey === null ? {} : { line_key: lineKey }),
    });
    const title = textOrNull(row, 'card_title');
    if (cardId !== null && title !== null) cardTitles[cardId] = title;
  }

  let books: Money | null = null;
  if (live.money === null) missing.add('money');
  else books = moneyFrom(live.money as Doc);
  let stopped: StoppedCard[] = [];
  if (live.stopped === null) missing.add('stopped');
  else stopped = rows(live.stopped, 'stopped').map(stoppedFrom);

  return {
    pool: poolFrom(live.pool),
    cards,
    funding,
    launchedAt: textOrNull(studio, 'launched_at'),
    paused,
    platformLaneOpen: studio.platform_lane_open === true,
    pauseReason: paused ? textOrNull(studio, 'pause_reason') : null,
    totals: totalsFrom(live.totals as Doc),
    events,
    deploys: rows(live.deploys, 'deploys').map((row) => ({
      id: text(row, 'id'),
      folder: text(row, 'folder'),
      sha: text(row, 'sha'),
      is_green: row.is_green === true,
      created_at: text(row, 'created_at'),
    })),
    roles: rows(text_.roles, 'roles').map(roleFrom),
    cardTitles,
    money: books,
    stopped,
    roleStats: roleStatsFrom(live.role_stats),
    missing: ENRICHMENTS.filter((name) => missing.has(name)),
  };
}

/**
 * Reads /api/live on every load, and /api/cards on the first load, when the live map names a card
 * the held copy does not carry, or when that copy is more than five minutes old. Each request aborts
 * after ten seconds; a failed request, a status other than 200 or a malformed document rejects.
 */
export function createSnapshotSource({
  fetchFn = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  now = () => Date.now(),
}: { fetchFn?: typeof fetch; timeoutMs?: number; now?: () => number } = {}): StudioSource {
  type Held = { doc: Doc; at: number; ids: Set<string> };
  let held: Held | null = null;

  const read = async (url: string): Promise<unknown> => {
    const response = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return (await response.json()) as unknown;
  };
  const readCards = async (): Promise<Held> => {
    const doc = checked('/api/cards', await read(CARDS_URL), REQUIRED_KEYS.cards);
    const ids = new Set(rows(doc.cards, 'cards').map((row) => String(row.id)));
    held = { doc, at: now(), ids };
    return held;
  };

  return {
    async load() {
      // The first load reads both at once. A later one reads the card document again only when the
      // live map names a card the held copy lacks, or the copy is over five minutes old.
      const kept = held;
      const [liveDoc, fresh] = await Promise.all([read(LIVE_URL), kept === null ? readCards() : Promise.resolve(null)]);
      const live = checked('/api/live', liveDoc, REQUIRED_KEYS.live);
      let copy = fresh ?? kept!;
      if (fresh === null) {
        const unknown = Object.keys(live.cards as Doc).some((id) => !copy.ids.has(id));
        if (unknown || now() - copy.at > CARDS_MAX_AGE_MS) copy = await readCards();
      }
      return snapshotFrom(live, copy.doc);
    },
  };
}
