import { useEffect, useState } from 'react';
import type { Supporter } from './card-source';
import { toNumber, type Numeric } from './format';

// Kernel (docs/specs/studio-reports.md): the weekly reports' document, /api/reports, which
// netlify/functions/snapshot.mts builds from site_reports() and the CDN keeps an hour. Each report is
// one New York week in which a card shipped, newest first, with facts SQL wrote from public records
// only: each shipped card's title, folder, live time, studio-billed cost and supporters by number (the
// first 24 and a count), the number shipped, the cards open for funding when it was published and the
// first three of them, the new supporters and the week's spend from contributions. No model writes
// any part of it, and it holds no amount per supporter, name or email.

export const REPORTS_URL = '/api/reports';
/** How long the request may take before the load rejects. */
export const REQUEST_TIMEOUT_MS = 10_000;

export type ReportCard = {
  id: string;
  title: string;
  folder: string;
  live_at: string;
  cost_usd: number;
  /** The first 24 supporters, in number order. */
  supporters: Supporter[];
  supporter_count: number;
};

export type ReportFactsData = {
  shipped_count: number;
  shipped: ReportCard[];
  open_count: number;
  /** The first three cards in the funding order when the report was published. */
  open_first: { id: string; title: string }[];
  new_supporters: number;
  spend_usd: number;
};

export type Report = {
  /** The Monday the New York week starts, YYYY-MM-DD. */
  week_start: string;
  published_at: string;
  facts: ReportFactsData;
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

/** A figure: a number or a numeric string, else the document is malformed. */
function figure(value: unknown, name: string): number {
  const n = toNumber(value as Numeric);
  if (n === null) throw new Error(`Malformed ${name}: ${String(value)}`);
  return n;
}

function text(row: Doc, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Malformed ${key}: ${String(value)}`);
  return value;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function reportFrom(row: Doc): Report {
  const weekStart = text(row, 'week_start');
  if (!DAY.test(weekStart)) throw new Error(`Malformed week_start: ${weekStart}`);
  const facts = doc(row.facts, 'facts');
  return {
    week_start: weekStart,
    published_at: text(row, 'published_at'),
    facts: {
      shipped_count: figure(facts.shipped_count, 'shipped_count'),
      shipped: list(facts.shipped, 'shipped').map((card) => ({
        id: text(card, 'id'),
        title: text(card, 'title'),
        folder: text(card, 'folder'),
        live_at: text(card, 'live_at'),
        cost_usd: figure(card.cost_usd, 'cost_usd'),
        supporters: list(card.supporters, 'supporters').map((s) => ({ number: figure(s.number, 'number'), founding: s.founding === true })),
        supporter_count: figure(card.supporter_count, 'supporter_count'),
      })),
      open_count: figure(facts.open_count, 'open_count'),
      open_first: list(facts.open_first, 'open_first').map((card) => ({ id: text(card, 'id'), title: text(card, 'title') })),
      new_supporters: figure(facts.new_supporters, 'new_supporters'),
      spend_usd: figure(facts.spend_usd, 'spend_usd'),
    },
  };
}

/** The document, parsed, newest first. Throws on a missing key, a wrong type or a malformed figure. */
export function reportsFrom(value: unknown): Report[] {
  const root = doc(value, REPORTS_URL);
  return list(root.reports, 'reports')
    .map(reportFrom)
    .sort((a, b) => b.week_start.localeCompare(a.week_start));
}

/** The reports, or a rejection on any status but 200 or a malformed document. */
export async function loadReports(fetchFn: typeof fetch = fetch, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Report[]> {
  const response = await fetchFn(REPORTS_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${REPORTS_URL} answered ${response.status}`);
  return reportsFrom((await response.json()) as unknown);
}

export type ReportsState = { state: 'loading' } | { state: 'ready'; reports: Report[] } | { state: 'error' };

/** The reports for /reports: loaded once when the page opens. A report is published at most weekly. */
export function useReports(fetchFn: typeof fetch = fetch): ReportsState {
  const [state, setState] = useState<ReportsState>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    loadReports(fetchFn)
      .then((reports) => {
        if (live) setState({ state: 'ready', reports });
      })
      .catch(() => {
        if (live) setState({ state: 'error' });
      });
    return () => {
      live = false;
    };
  }, [fetchFn]);
  return state;
}
