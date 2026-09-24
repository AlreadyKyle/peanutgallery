import { useEffect, useState } from 'react';
import { toNumber, type Numeric } from './format';
import { stoppedFrom, type Card, type CardFunding, type StoppedCard } from './source';
import { useStudio } from './studio';

// Kernel (docs/specs/supporter-pages.md): a card's own document, /api/card/:id, which
// netlify/functions/card.mts builds from site_card() and the CDN keeps 60 seconds, as /api/live. It
// carries the card's public columns, its funding, what studio-billed work on it cost, its first 24
// supporters by number and their count, its newest 200 event lines and their count, its milestones,
// the names of the roles on its lines and, for a stopped card, its /ledger Stopped row.

export const CARD_URL = '/api/card/';
/** How long one request may take before the load rejects. */
export const REQUEST_TIMEOUT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The stages whose page reloads its detail on each live poll: the card is being built or checked. */
const MOVING = new Set(['building', 'gated']);

/** The card's public columns, as the Card the faces draw, with what only its own page shows. */
export type DetailCard = Card & {
  commit_sha: string | null;
  failing_check: string | null;
  acceptance_test: string | null;
};

export type Supporter = { number: number; founding: boolean };
export type CardLine = { role_id: string | null; line_key: string; created_at: string };
export type Milestones = {
  created_at: string;
  started_at: string | null;
  gate_at: string | null;
  gate: 'passed' | 'failed' | null;
  live_at: string | null;
};
export type LineRole = { id: string; name: string; title: string };

export type CardDetail = {
  card: DetailCard;
  /** public_card_funding's row; null when no counted money has reached the card. */
  funding: (CardFunding & { on_card_usd: number }) | null;
  spent_usd: number;
  /** The first 24 supporters, in number order. */
  supporters: Supporter[];
  supporter_count: number;
  /** The newest 200 lines with a public key, oldest first. */
  lines: CardLine[];
  line_count: number;
  milestones: Milestones;
  roles: LineRole[];
  /** The card's /ledger Stopped row while it is rejected or paused on now; null otherwise. */
  stopped: StoppedCard | null;
};

type Doc = Record<string, unknown>;

function isDoc(value: unknown): value is Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function doc(value: unknown, name: string): Doc {
  if (!isDoc(value)) throw new Error(`Malformed ${name}`);
  return value;
}

function list(value: unknown, name: string): Doc[] {
  if (!Array.isArray(value) || !value.every(isDoc)) throw new Error(`Malformed ${name}`);
  return value;
}

/** A money or count figure: a number or a numeric string, else the document is malformed. */
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

function cardFrom(row: Doc, spent: number): DetailCard {
  const horizon = row.horizon === 'next' || row.horizon === 'later' ? row.horizon : 'now';
  return {
    id: text(row, 'id'),
    title: text(row, 'title'),
    summary: textOrNull(row, 'summary'),
    intent: textOrNull(row, 'intent'),
    source: text(row, 'source'),
    stage: text(row, 'stage'),
    shape: text(row, 'shape'),
    bucket: text(row, 'bucket'),
    folder: text(row, 'folder'),
    horizon,
    rank: row.rank === null || row.rank === undefined ? null : money(row.rank),
    executor_role_id: textOrNull(row, 'executor_role_id'),
    drafter_role_id: textOrNull(row, 'drafter_role_id'),
    funding_target_usd: money(row.funding_target_usd),
    funded_usd: money(row.funded_usd),
    spent_usd: spent,
    created_at: text(row, 'created_at'),
    updated_at: text(row, 'updated_at'),
    live_at: textOrNull(row, 'live_at'),
    opens_at: textOrNull(row, 'opens_at'),
    board_vetoed: row.board_vetoed === true,
    board_veto_reason: textOrNull(row, 'board_veto_reason'),
    commit_sha: textOrNull(row, 'commit_sha'),
    failing_check: textOrNull(row, 'failing_check'),
    acceptance_test: textOrNull(row, 'acceptance_test'),
  };
}

/** A card's document, parsed. Throws on a missing key, a wrong type or a malformed figure. */
export function cardDetailFrom(value: unknown): CardDetail {
  const root = doc(value, '/api/card');
  const spent = money(root.spent_usd ?? 0);
  const funding = root.funding === null || root.funding === undefined ? null : doc(root.funding, 'funding');
  const milestones = doc(root.milestones, 'milestones');
  const gate = milestones.gate === 'passed' || milestones.gate === 'failed' ? milestones.gate : null;
  return {
    card: cardFrom(doc(root.card, 'card'), spent),
    funding:
      funding === null
        ? null
        : { contributors: money(funding.contributors), credited_usd: money(funding.credited_usd), on_card_usd: money(funding.on_card_usd ?? 0) },
    spent_usd: spent,
    supporters: list(root.supporters, 'supporters').map((row) => ({ number: money(row.number), founding: row.founding === true })),
    supporter_count: money(root.supporter_count),
    lines: list(root.lines, 'lines').map((row) => ({ role_id: textOrNull(row, 'role_id'), line_key: text(row, 'line_key'), created_at: text(row, 'created_at') })),
    line_count: money(root.line_count),
    milestones: {
      created_at: text(milestones, 'created_at'),
      started_at: textOrNull(milestones, 'started_at'),
      gate_at: textOrNull(milestones, 'gate_at'),
      gate,
      live_at: textOrNull(milestones, 'live_at'),
    },
    roles: list(root.roles, 'roles').map((row) => ({ id: text(row, 'id'), name: text(row, 'name'), title: text(row, 'title') })),
    stopped: root.stopped === null || root.stopped === undefined ? null : stoppedFrom(doc(root.stopped, 'stopped')),
  };
}

/** True for a card id the function would look up: a uuid. */
export function isCardId(id: string): boolean {
  return UUID.test(id);
}

/**
 * The card's document, or null when there is no public card at the id (the function's 404, or a
 * malformed id, which is never requested). Rejects on any other status or a malformed document.
 */
export async function loadCard(id: string, fetchFn: typeof fetch = fetch, timeoutMs = REQUEST_TIMEOUT_MS): Promise<CardDetail | null> {
  if (!isCardId(id)) return null;
  const response = await fetchFn(`${CARD_URL}${id.toLowerCase()}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) throw new Error(`${CARD_URL}${id} answered ${response.status}`);
  return cardDetailFrom((await response.json()) as unknown);
}

export type CardDetailState =
  | { state: 'loading' }
  | { state: 'ready'; detail: CardDetail; stale: boolean }
  | { state: 'not-found' }
  | { state: 'error' };

/**
 * A card's document for its page: loaded once, then again on each of the site's live polls while
 * the card is being built or checked, so new lines appear at the end. A failed reload keeps what is
 * on screen and marks it stale.
 */
export function useCardDetail(id: string, fetchFn: typeof fetch = fetch): CardDetailState {
  const studio = useStudio();
  const [state, setState] = useState<CardDetailState>(isCardId(id) ? { state: 'loading' } : { state: 'not-found' });
  const snapshot = studio.state === 'ready' ? studio.snapshot : null;
  const moving = state.state === 'ready' && MOVING.has(state.detail.card.stage);

  useEffect(() => {
    if (!isCardId(id)) {
      setState({ state: 'not-found' });
      return;
    }
    let live = true;
    setState({ state: 'loading' });
    loadCard(id, fetchFn)
      .then((detail) => {
        if (live) setState(detail === null ? { state: 'not-found' } : { state: 'ready', detail, stale: false });
      })
      .catch(() => {
        if (live) setState({ state: 'error' });
      });
    return () => {
      live = false;
    };
  }, [id, fetchFn]);

  // Each new snapshot is a live poll: a card being built or checked reads its document again.
  useEffect(() => {
    if (!moving || snapshot === null) return;
    let live = true;
    loadCard(id, fetchFn)
      .then((detail) => {
        if (live && detail !== null) setState({ state: 'ready', detail, stale: false });
      })
      .catch(() => {
        if (live) setState((previous) => (previous.state === 'ready' ? { ...previous, stale: true } : previous));
      });
    return () => {
      live = false;
    };
    // The snapshot's identity changes once per poll; that, not id or moving, is the trigger.
  }, [snapshot]);

  return state;
}

/** One check the gate ran on a config card, as "What changed" shows it: the value, or null for "changed". */
export type ConfigCheck = { file: string; path: string; value: string | null };

const CHECK_LINE = /^check:\s+config\s+(\S+)\s+(\S+)\s+==\s+(.+)$/;
// The acceptance grammar's paths are dotted keys, [n] indexes and [key=value] selectors
// (platform/dispatcher/src/acceptance.ts), so = is allowed beside the spec's characters.
const SAFE_PART = /^[A-Za-z0-9_./$[\]=-]+$/;
const MAX_STRING = 200;

/**
 * The machine lines of a card's already-public acceptance_test, `check: config <file> <path> ==
 * <json>`, for "What changed". A line whose file or path holds any other character is left out. A
 * number or boolean shows as written, a string of at most 200 characters in quotes, and
 * anything else (null, a longer string, an object, an array, text that is not JSON) as null: "changed".
 */
export function parseChecks(acceptanceTest: string | null): ConfigCheck[] {
  if (acceptanceTest === null) return [];
  const checks: ConfigCheck[] = [];
  for (const raw of acceptanceTest.split('\n')) {
    const match = CHECK_LINE.exec(raw.trim());
    if (match === null) continue;
    const [, file, path, json] = match as unknown as [string, string, string, string];
    if (!SAFE_PART.test(file) || !SAFE_PART.test(path)) continue;
    let value: string | null = null;
    try {
      const parsed: unknown = JSON.parse(json.trim());
      if (typeof parsed === 'number' || typeof parsed === 'boolean') value = String(parsed);
      else if (typeof parsed === 'string' && parsed.length <= MAX_STRING) value = JSON.stringify(parsed);
    } catch {
      value = null;
    }
    checks.push({ file, path, value });
  }
  return checks;
}
