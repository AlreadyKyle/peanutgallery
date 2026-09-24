import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clearStoredSessions, STORED_SESSION_KEY } from './supabase';

// Nobody signs in on the public site once the board has its own (docs/specs/board-site.md), and the
// site holds no Supabase client (docs/specs/site-snapshot.md).
describe('no Supabase client on the public site', () => {
  it('has no supabase-js dependency and keeps only the session cleanup and the error message', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain('@supabase/supabase-js');
    const text = readFileSync(resolve(process.cwd(), 'src/lib/supabase.ts'), 'utf8');
    expect([...text.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1])).toEqual(['STORED_SESSION_KEY', 'clearStoredSessions', 'errorMessage']);
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
