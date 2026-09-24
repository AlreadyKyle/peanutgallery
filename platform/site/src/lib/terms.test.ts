import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadPostedTerms, termsView, TERMS_READ_TIMEOUT_MS, versionView, type PostedTerms } from './terms';
import { TERMS_VERSIONS } from './terms-versions';

// Which Terms version a page shows (docs/specs/legal-copy.md, Behaviour). Kernel, like terms.ts: a
// card cannot weaken what decides which words a reader is told applied to their money.

const V1_AT = '2026-09-23T01:32:51+00:00';
const V2_AT = '2026-09-24T15:00:00+00:00';
const V3_AT = '2026-09-25T15:00:00+00:00';
const [V1, V2, V3] = TERMS_VERSIONS;
const ready = (...rows: [number, string][]): PostedTerms => ({ state: 'ready', rows: rows.map(([version, posted_at]) => ({ version, posted_at })) });

describe('termsView: /terms and /refunds', () => {
  it('waits while the read runs', () => {
    expect(termsView({ state: 'loading' })).toEqual({ state: 'loading' });
  });

  it('shows the newest posted version with when it took effect, and every earlier one with its range', () => {
    // Version 3 is in the bundle and not posted here: version 2 is the one in force.
    expect(termsView(ready([1, V1_AT], [2, V2_AT]))).toEqual({
      state: 'confirmed',
      entry: V2,
      since: V2_AT,
      earlier: [{ entry: V1, from: V1_AT, until: V2_AT }],
    });
  });

  it('shows version 1 alone while version 2 is in the bundle but not posted', () => {
    expect(termsView(ready([1, V1_AT]))).toEqual({ state: 'confirmed', entry: V1, since: V1_AT, earlier: [] });
  });

  it('reads the rows in version order whatever order they arrive in', () => {
    expect(termsView(ready([2, V2_AT], [1, V1_AT]))).toMatchObject({ state: 'confirmed', entry: V2, earlier: [{ entry: V1 }] });
  });

  it('lists earlier versions newest first, each ending when the next began', () => {
    const bundle = [
      { ...V1!, version: 1 },
      { ...V1!, version: 2 },
      { ...V1!, version: 3 },
    ];
    const view = termsView(ready([1, 'a1'], [2, 'a2'], [3, 'a3']), bundle);
    expect(view.state === 'confirmed' ? view.earlier.map(({ entry, from, until }) => [entry.version, from, until]) : null).toEqual([
      [2, 'a2', 'a3'],
      [1, 'a1', 'a2'],
    ]);
  });

  it('cannot confirm, and shows the newest bundled words, when the read fails, times out or returns no row', () => {
    expect(termsView({ state: 'failed' })).toEqual({ state: 'unconfirmed', entry: V3 });
    expect(termsView(ready())).toEqual({ state: 'unconfirmed', entry: V3 });
  });

  it('cannot confirm when the database lists a version newer than this build carries', () => {
    expect(termsView(ready([1, V1_AT], [2, V2_AT], [3, V3_AT], [4, '2027-01-01T00:00:00Z']))).toEqual({ state: 'unconfirmed', entry: V3 });
    // A build that carries version 1 only, after version 2 is posted.
    expect(termsView(ready([1, V1_AT], [2, V2_AT]), [V1!])).toEqual({ state: 'unconfirmed', entry: V1 });
  });
});

describe('versionView: /terms/:version and /refunds/:version', () => {
  const posted = ready([1, V1_AT], [2, V2_AT]);

  it('is the not found page for anything but a whole number from 1 to 9999', () => {
    for (const param of [undefined, '', '0', '01', '-1', '+1', '1.0', '1e0', 'one', ' 1', '10000', '99999']) {
      expect(versionView(param, posted), String(param)).toEqual({ state: 'not-found' });
    }
  });

  it('is the not found page for a version this build does not carry, even before the read answers', () => {
    expect(versionView('4', posted)).toEqual({ state: 'not-found' });
    expect(versionView('9999', { state: 'loading' })).toEqual({ state: 'not-found' });
    expect(versionView('4', { state: 'failed' })).toEqual({ state: 'not-found' });
  });

  it('is the not found page for a bundled version that is not posted', () => {
    expect(versionView('2', ready([1, V1_AT]))).toEqual({ state: 'not-found' });
    expect(versionView('3', posted)).toEqual({ state: 'not-found' });
  });

  it('waits while the read runs', () => {
    expect(versionView('1', { state: 'loading' })).toEqual({ state: 'loading', entry: V1 });
  });

  it('shows an earlier version with its range and the version in force now', () => {
    expect(versionView('1', posted)).toEqual({ state: 'past', entry: V1, from: V1_AT, until: V2_AT, current: 2 });
  });

  it('shows the version in force with when it took effect', () => {
    expect(versionView('2', posted)).toEqual({ state: 'current', entry: V2, since: V2_AT });
    expect(versionView('1', ready([1, V1_AT]))).toEqual({ state: 'current', entry: V1, since: V1_AT });
  });

  it('shows the bundled words of that version, unconfirmed, when the read fails, returns no row or runs ahead of the build', () => {
    expect(versionView('1', { state: 'failed' })).toEqual({ state: 'unconfirmed', entry: V1 });
    expect(versionView('2', ready())).toEqual({ state: 'unconfirmed', entry: V2 });
    expect(versionView('1', ready([1, V1_AT], [2, V2_AT], [3, V3_AT], [4, '2027-01-01T00:00:00Z']))).toEqual({ state: 'unconfirmed', entry: V1 });
  });
});

/** A stand-in for the one supabase-js chain loadPostedTerms calls, recording what it was asked. */
function fakeClient(answer: { data: unknown; error: { message: string } | null }) {
  const calls: unknown[][] = [];
  const chain = {
    from: (...args: unknown[]) => (calls.push(['from', ...args]), chain),
    select: (...args: unknown[]) => (calls.push(['select', ...args]), chain),
    order: (...args: unknown[]) => (calls.push(['order', ...args]), chain),
    abortSignal: (signal: AbortSignal) => (calls.push(['abortSignal', signal instanceof AbortSignal]), Promise.resolve(answer)),
  };
  return { client: chain as unknown as SupabaseClient, calls };
}

describe('loadPostedTerms', () => {
  it('reads version and posted_at from public_terms_versions in version order, with a 5-second limit', async () => {
    const { client, calls } = fakeClient({ data: [{ version: 1, posted_at: V1_AT }], error: null });
    expect(await loadPostedTerms(client)).toEqual([{ version: 1, posted_at: V1_AT }]);
    expect(calls).toEqual([
      ['from', 'public_terms_versions'],
      ['select', 'version,posted_at'],
      ['order', 'version'],
      ['abortSignal', true],
    ]);
    expect(TERMS_READ_TIMEOUT_MS).toBe(5_000);
  });

  it('throws when the read fails or a row is malformed', async () => {
    await expect(loadPostedTerms(fakeClient({ data: null, error: { message: 'boom' } }).client)).rejects.toThrow('boom');
    for (const row of [{ version: '1', posted_at: V1_AT }, { version: 0, posted_at: V1_AT }, { version: 1.5, posted_at: V1_AT }, { version: 1, posted_at: 'soon' }, null]) {
      await expect(loadPostedTerms(fakeClient({ data: [row], error: null }).client), JSON.stringify(row)).rejects.toThrow('malformed');
    }
  });

  it('answers no rows as an empty list, which the pages treat as unconfirmed', async () => {
    expect(await loadPostedTerms(fakeClient({ data: [], error: null }).client)).toEqual([]);
  });
});
