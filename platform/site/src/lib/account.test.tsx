import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rpc, useMyProfile } from './account';

// The player's session and profile (docs/specs/place.md): readers that mount together share one
// my_profile read, a fresh read redraws every reader, and an expiring token is refreshed once.

let calls: string[] = [];
let level = 1;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function session(expiresIn: number) {
  window.localStorage.setItem('mm:player-session', JSON.stringify({ accessToken: 'a', refreshToken: `r-${expiresIn}`, expiresAt: Date.now() + expiresIn }));
}

function Reader({ name }: { name: string }) {
  const me = useMyProfile();
  return (
    <p data-testid={name}>
      {me.state === 'ready' ? `level ${me.profile.level}` : me.state}
      <button type="button" onClick={me.reload}>
        reload {name}
      </button>
    </p>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  calls = [];
  level = 1;
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/auth/refresh')) return json({ access_token: 'b', refresh_token: 'r2', expires_in: 3600 });
      if (url.endsWith('/rpc/my_profile')) return json({ handle: 'pat', displayName: 'Pat', level });
      return json({});
    }),
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('useMyProfile', () => {
  it('shares one read between readers that mount together, and a reload redraws them all', async () => {
    session(3_600_000);
    render(
      <>
        <Reader name="chip" />
        <Reader name="desk" />
      </>,
    );
    await settle();
    expect(calls.filter((url) => url.endsWith('/rpc/my_profile'))).toHaveLength(1);
    expect(screen.getByTestId('chip').textContent).toContain('level 1');
    level = 2;
    await act(async () => {
      screen.getByRole('button', { name: 'reload desk' }).click();
    });
    await settle();
    expect(screen.getByTestId('desk').textContent).toContain('level 2');
    expect(screen.getByTestId('chip').textContent).toContain('level 2');
  });
});

describe('rpc', () => {
  it('refreshes an expiring token once for calls made together', async () => {
    session(10_000);
    await Promise.all([rpc('my_profile'), rpc('my_follows')]);
    expect(calls.filter((url) => url.endsWith('/auth/refresh'))).toHaveLength(1);
  });
});
