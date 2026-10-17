import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitchLink } from '../components/LiveStudio';
import { copy } from '../lib/copy';
import { clearPendingSeed, pendingSeed } from '../lib/seed-link';
import { Me } from './Me';
import { Seeds } from './Seeds';

// /seeds?save=<code> (docs/specs/final-state.md, Seeds and instances): the save goes through the
// same-origin proxy's save_seed RPC (lib/account.ts), never to Supabase directly.

type Sent = { url: string; method: string; body: unknown; auth: string | null };
let sent: Sent[] = [];
let saveStatus = 200;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/seeds" element={<Seeds />} />
        <Route path="/me" element={<Me />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function signIn() {
  window.localStorage.setItem('mm:player-session', JSON.stringify({ accessToken: 'tok-1', refreshToken: 'ref-1', expiresAt: Date.now() + 3_600_000 }));
}

beforeEach(() => {
  sent = [];
  saveStatus = 200;
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      sent.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.get('Authorization') });
      if (url === '/api/community/rpc/save_seed') return saveStatus === 200 ? json(200, { id: 'seed-1' }) : json(saveStatus, { error: 'no' });
      if (url === '/api/community/auth/otp') return json(200, { sent: true });
      if (url === '/api/community/rpc/my_profile') return json(500, { error: 'not in this test' });
      if (url.startsWith('/api/community/seeds')) return json(200, { items: [], next: null });
      return json(404, { error: 'unknown' });
    }),
  );
});

afterEach(() => {
  cleanup();
  clearPendingSeed();
  vi.unstubAllGlobals();
});

describe('/seeds?save=', () => {
  it('saves the seed for a signed-in player through the proxy, once, shows it and drops ?save= from the address', async () => {
    signIn();
    renderAt('/seeds?save=dust%3Av3%3AAbC_-9');
    await settle();
    const saves = sent.filter((s) => s.url === '/api/community/rpc/save_seed');
    expect(saves).toEqual([{ url: '/api/community/rpc/save_seed', method: 'POST', body: { game: 'dust', code: 'dust:v3:AbC_-9', title: null, publish: false }, auth: 'Bearer tok-1' }]);
    expect(screen.getByText(copy.seeds.save.saved)).toBeTruthy();
    expect(screen.getByText('dust:v3:AbC_-9')).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.seeds.save.play }).getAttribute('href')).toBe('https://play.mobmachine.games/?seed=dust%3Av3%3AAbC_-9');
    expect(screen.getByTestId('where').textContent).toBe('/seeds');
    expect(sent.every((s) => s.url.startsWith('/api/community/'))).toBe(true);
  });

  it('sends nothing for a code outside the rule', async () => {
    signIn();
    renderAt('/seeds?save=dust%3Av3%3A%3Cscript%3E');
    await settle();
    expect(screen.getByText(copy.seeds.save.bad)).toBeTruthy();
    expect(sent.filter((s) => s.url.includes('save_seed'))).toEqual([]);
  });

  it('says so when the save fails', async () => {
    signIn();
    saveStatus = 400;
    renderAt('/seeds?save=dust%3Av3%3Aabc');
    await settle();
    expect(screen.getByText(copy.seeds.save.failed)).toBeTruthy();
  });

  it('asks a signed-out player to sign in, keeps the seed, and finishes the save after the link signs them in on /me', async () => {
    renderAt('/seeds?save=dust%3Av3%3Aabc');
    await settle();
    expect(screen.getByText(copy.seeds.save.signedOut)).toBeTruthy();
    expect(sent.filter((s) => s.url.includes('save_seed'))).toEqual([]);
    expect(pendingSeed()).toBe('dust:v3:abc');
    fireEvent.change(screen.getByLabelText(copy.me.emailLabel), { target: { value: 'player@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: copy.me.send }));
    await settle();
    expect(sent.find((s) => s.url === '/api/community/auth/otp')?.body).toEqual({ email: 'player@example.com', redirectTo: `${window.location.origin}/me` });
    cleanup();

    // The magic link lands on /me with the session in the fragment.
    window.history.replaceState(null, '', '/me#access_token=tok-2&refresh_token=ref-2&expires_in=3600');
    renderAt('/me');
    await settle();
    await settle();
    const saves = sent.filter((s) => s.url === '/api/community/rpc/save_seed');
    expect(saves.map((s) => [s.body, s.auth])).toEqual([[{ game: 'dust', code: 'dust:v3:abc', title: null, publish: false }, 'Bearer tok-2']]);
    expect(screen.getByText(copy.seeds.save.saved)).toBeTruthy();
    expect(pendingSeed()).toBeNull();
    window.history.replaceState(null, '', '/');
  });
});

describe('the Twitch link', () => {
  it('shows nothing without a channel, and a Live on Twitch link with one, never a frame', () => {
    const { container, rerender } = render(<TwitchLink channel={null} />);
    expect(container.innerHTML).toBe('');
    rerender(<TwitchLink channel="MobMachine" />);
    const link = screen.getByRole('link', { name: copy.studioRoom.twitchLabel.replace('{channel}', 'mobmachine') });
    expect(link.getAttribute('href')).toBe('https://www.twitch.tv/mobmachine');
    expect(link.textContent).toBe(copy.studioRoom.twitch);
    expect(container.querySelector('iframe')).toBeNull();
  });
});
