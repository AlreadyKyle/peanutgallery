import { createContext, useContext, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getClient } from './supabase';
import { TERMS_VERSIONS, type TermsVersion } from './terms-versions';

// Which Terms version is in force (docs/specs/legal-copy.md). The Terms and Refunds pages, and only
// they, read public.public_terms_versions (version, posted_at) themselves rather than through the
// snapshot, so they stay readable when the pool or the cards fail and no other page pays for the
// read. Kernel (platform/gate/kernel-paths.txt): what this decides is which words a reader is told
// applied to their money.

/** One posted version: its number and when it took effect. */
export type PostedRow = { version: number; posted_at: string };

export type PostedTerms = { state: 'loading' } | { state: 'ready'; rows: PostedRow[] } | { state: 'failed' };

/** The read gives up after this long, and the page says it cannot confirm the version. */
export const TERMS_READ_TIMEOUT_MS = 5_000;

/** A version number as a path may carry it: a whole number from 1 to 9999, no sign, no leading zero. */
export const VERSION_PARAM = /^[1-9][0-9]{0,3}$/;

function isPostedRow(row: unknown): row is PostedRow {
  if (typeof row !== 'object' || row === null) return false;
  const { version, posted_at } = row as Record<string, unknown>;
  return (
    typeof version === 'number' &&
    Number.isInteger(version) &&
    version >= 1 &&
    version <= 9999 &&
    typeof posted_at === 'string' &&
    Number.isFinite(new Date(posted_at).getTime())
  );
}

/** Every posted version, oldest first. Throws when the read fails, times out or returns a malformed row. */
export async function loadPostedTerms(client: SupabaseClient): Promise<PostedRow[]> {
  const { data, error } = await client
    .from('public_terms_versions')
    .select('version,posted_at')
    .order('version')
    .abortSignal(AbortSignal.timeout(TERMS_READ_TIMEOUT_MS));
  if (error) throw new Error(error.message);
  const rows: unknown[] = data ?? [];
  if (!rows.every(isPostedRow)) throw new Error('public_terms_versions returned a malformed row');
  return rows.map((row) => ({ version: row.version, posted_at: row.posted_at }));
}

export type TermsLoader = () => Promise<PostedRow[]>;

/** The site's own read. Rejects when the build has no database settings. */
export function defaultTermsLoader(): Promise<PostedRow[]> {
  const client = getClient();
  if (client === null) return Promise.reject(new Error('The site has no database settings'));
  return loadPostedTerms(client);
}

/** Tests put a fake loader here; the site uses the default. */
export const TermsLoaderContext = createContext<TermsLoader>(defaultTermsLoader);

// One read per visit: a loader's answer is kept for the life of the page, so moving between /terms,
// /refunds and a version page reads once. A failure is not kept, so the next page tries again.
const answered = new WeakMap<TermsLoader, Promise<PostedRow[]>>();

function readOnce(load: TermsLoader): Promise<PostedRow[]> {
  const kept = answered.get(load);
  if (kept !== undefined) return kept;
  const read = new Promise<PostedRow[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The terms read timed out')), TERMS_READ_TIMEOUT_MS);
    load().then(
      (rows) => {
        clearTimeout(timer);
        resolve(rows);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
  answered.set(load, read);
  read.catch(() => answered.delete(load));
  return read;
}

/** The posted versions, read once per visit; loading until the read answers, failed after 5 seconds. */
export function usePostedTerms(): PostedTerms {
  const load = useContext(TermsLoaderContext);
  const [result, setResult] = useState<PostedTerms>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    readOnce(load).then(
      (rows) => {
        if (live) setResult({ state: 'ready', rows });
      },
      () => {
        if (live) setResult({ state: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [load]);
  return result;
}

export type EarlierVersion = { entry: TermsVersion; from: string; until: string };

export type TermsView =
  | { state: 'loading' }
  | { state: 'confirmed'; entry: TermsVersion; since: string; earlier: EarlierVersion[] }
  | { state: 'unconfirmed'; entry: TermsVersion };

export type VersionView =
  | { state: 'not-found' }
  | { state: 'loading'; entry: TermsVersion }
  | { state: 'unconfirmed'; entry: TermsVersion }
  | { state: 'current'; entry: TermsVersion; since: string }
  | { state: 'past'; entry: TermsVersion; from: string; until: string; current: number };

/** The posted rows, oldest first, when the read gives a version in force the bundle carries; else null. */
function confirmedRows(result: PostedTerms, bundle: readonly TermsVersion[]): PostedRow[] | null {
  if (result.state !== 'ready' || result.rows.length === 0) return null;
  const rows = [...result.rows].sort((a, b) => a.version - b.version);
  const newest = rows[rows.length - 1]!;
  return bundle.some((entry) => entry.version === newest.version) ? rows : null;
}

/**
 * What /terms and /refunds show: the newest version that is posted and in the bundle, with when it
 * took effect and every earlier posted version (newest first) with its range. When the read failed,
 * timed out, returned no row or names a version newer than the bundle, the newest bundled words,
 * unconfirmed.
 */
export function termsView(result: PostedTerms, bundle: readonly TermsVersion[] = TERMS_VERSIONS): TermsView {
  if (result.state === 'loading') return { state: 'loading' };
  const newestBundled = bundle[bundle.length - 1]!;
  const rows = confirmedRows(result, bundle);
  if (rows === null) return { state: 'unconfirmed', entry: newestBundled };
  const current = rows[rows.length - 1]!;
  const earlier: EarlierVersion[] = [];
  for (let index = rows.length - 2; index >= 0; index -= 1) {
    const entry = bundle.find((candidate) => candidate.version === rows[index]!.version);
    if (entry !== undefined) earlier.push({ entry, from: rows[index]!.posted_at, until: rows[index + 1]!.posted_at });
  }
  return {
    state: 'confirmed',
    entry: bundle.find((candidate) => candidate.version === current.version)!,
    since: current.posted_at,
    earlier,
  };
}

/**
 * What /terms/:version and /refunds/:version show. Not found for a path that is not a whole number
 * from 1 to 9999, a version the bundle does not carry, or one the read says is not posted. The
 * version in force shows since when; an earlier one its range and which version is in force now.
 */
export function versionView(param: string | undefined, result: PostedTerms, bundle: readonly TermsVersion[] = TERMS_VERSIONS): VersionView {
  if (param === undefined || !VERSION_PARAM.test(param)) return { state: 'not-found' };
  const version = Number(param);
  const entry = bundle.find((candidate) => candidate.version === version);
  if (entry === undefined) return { state: 'not-found' };
  if (result.state === 'loading') return { state: 'loading', entry };
  if (result.state === 'failed' || result.rows.length === 0) return { state: 'unconfirmed', entry };
  const sorted = [...result.rows].sort((a, b) => a.version - b.version);
  const at = sorted.findIndex((row) => row.version === version);
  if (at === -1) return { state: 'not-found' };
  const rows = confirmedRows(result, bundle);
  if (rows === null) return { state: 'unconfirmed', entry };
  const current = rows[rows.length - 1]!;
  if (current.version === version) return { state: 'current', entry, since: current.posted_at };
  return { state: 'past', entry, from: sorted[at]!.posted_at, until: sorted[at + 1]!.posted_at, current: current.version };
}
