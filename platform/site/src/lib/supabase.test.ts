import { describe, expect, it } from 'vitest';
import { clearStoredSessions, PUBLIC_AUTH_OPTIONS, STORED_SESSION_KEY } from './supabase';

// Nobody signs in on the public site once the board has its own (docs/specs/board-site.md).
describe('the public Supabase client', () => {
  it('keeps no session: none stored, none refreshed, none read from the address', () => {
    expect(PUBLIC_AUTH_OPTIONS).toEqual({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  });

  it('removes a board session stored here before the move, and nothing else', () => {
    const store = new Map<string, string>([
      ['sb-lyxndueoeisyqzewflpu-auth-token', '{"refresh_token":"old"}'],
      ['sb-lyxndueoeisyqzewflpu-auth-token-code-verifier', 'v'],
      ['peanutgallery-reload', 'sha'],
      ['sb-other-thing', 'keep'],
    ]);
    const storage = {
      get length() {
        return store.size;
      },
      key: (index: number) => [...store.keys()][index] ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
    expect(clearStoredSessions(storage)).toBe(2);
    expect([...store.keys()]).toEqual(['peanutgallery-reload', 'sb-other-thing']);
    expect(clearStoredSessions(storage)).toBe(0);
    expect(clearStoredSessions(null)).toBe(0);
    expect(STORED_SESSION_KEY.test('sb-abc123-auth-token')).toBe(true);
    expect(STORED_SESSION_KEY.test('sb-abc123-auth-token-x')).toBe(false);
  });
});
