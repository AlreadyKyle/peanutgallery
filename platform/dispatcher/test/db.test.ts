import { describe, expect, it } from 'vitest';
import { createSupabaseDb } from '../src/db.js';
import { NOW } from './helpers/fake-db.js';

interface Seen {
  method: string;
  url: URL;
  body: unknown;
}

// A PostgREST double: records each request and answers with the given rows.
function rest(rows: unknown[]): { fetchFn: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    seen.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fetchFn, seen };
}

describe('createSupabaseDb', () => {
  it('counts only a board member with the board role as a board session', async () => {
    const empty = rest([]);
    const db = createSupabaseDb('https://db.local', 'service-role', empty.fetchFn);
    expect(await db.boardSessionActive(3, NOW)).toBe(false);
    const request = empty.seen[0]!;
    expect(request.url.pathname).toBe('/rest/v1/board_members');
    expect(request.url.searchParams.getAll('role')).toEqual(['eq.board']);
    expect(request.url.searchParams.get('last_seen_at')).toBe(`gte.${new Date(NOW.getTime() - 3 * 60_000).toISOString()}`);

    const member = rest([{ email: 'board@example.com' }]);
    expect(await createSupabaseDb('https://db.local', 'service-role', member.fetchFn).boardSessionActive(3, NOW)).toBe(true);
  });

  it('clears commit_sha when it claims a card', async () => {
    const { fetchFn, seen } = rest([]);
    const db = createSupabaseDb('https://db.local', 'service-role', fetchFn);
    expect(await db.claimCard('card-1')).toBeNull();
    expect(seen[0]?.method).toBe('PATCH');
    expect(seen[0]?.body).toEqual({ stage: 'building', commit_sha: null });
    expect(seen[0]?.url.searchParams.get('stage')).toBe('eq.funded');
  });
});
