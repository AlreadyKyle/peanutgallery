import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitchLink } from '../components/LiveStudio';
import type { SeedSummary } from '../lib/community-types';
import { copy } from '../lib/copy';
import { clearPendingSeed, pendingSeed } from '../lib/seed-link';
import { Me } from './Me';
import { scoreFrom, Seeds } from './Seeds';

// /seeds?save=<code> (docs/specs/final-state.md, Seeds and instances): the save goes through the
// same-origin proxy's save_seed RPC (lib/account.ts), never to Supabase directly.

type Sent = { url: string; method: string; body: unknown; auth: string | null };
let sent: Sent[] = [];
let saveStatus = 200;
let otpStatus = 200;
let tally = { up: 0, down: 0 };
let gallery: Record<string, { items: SeedSummary[]; next: string | null }> = {};

function seedItem(id: string, up: number, down: number): SeedSummary {
  return { id, code: `dust:v3:${id}`, game: 'dust', title: `Run ${id}`, author: null, up, down, score: up - down, createdAt: '2026-10-01T00:00:00Z', featured: false };
}

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
  otpStatus = 200;
  tally = { up: 0, down: 0 };
  gallery = {};
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      sent.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.get('Authorization') });
      if (url === '/api/community/rpc/save_seed') return saveStatus === 200 ? json(200, { id: 'seed-1' }) : json(saveStatus, { error: 'no' });
      if (url === '/api/community/auth/otp') return otpStatus === 200 ? json(200, { sent: true }) : json(otpStatus, { error: 'slow down' });
      if (url === '/api/community/rpc/my_profile') return json(500, { error: 'not in this test' });
      if (url === '/api/community/rpc/vote_seed') return json(200, tally);
      if (url.startsWith('/api/community/seeds')) return json(200, gallery[url] ?? { items: [], next: null });
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

describe('/seeds?save= publishing', () => {
  it('offers to publish a copy with a title after the save, needs the title, and publishes once', async () => {
    signIn();
    renderAt('/seeds?save=dust%3Av3%3Aabc');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: copy.seeds.save.publish }));
    await settle();
    expect(screen.getByText(copy.seeds.save.needTitle)).toBeTruthy();
    expect(sent.filter((s) => s.url.endsWith('save_seed'))).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(copy.seeds.save.titleLabel), { target: { value: '  Fast start  ' } });
    fireEvent.click(screen.getByRole('button', { name: copy.seeds.save.publish }));
    await settle();
    const saves = sent.filter((s) => s.url.endsWith('save_seed')).map((s) => s.body);
    expect(saves).toEqual([
      { game: 'dust', code: 'dust:v3:abc', title: null, publish: false },
      { game: 'dust', code: 'dust:v3:abc', title: 'Fast start', publish: true },
    ]);
    expect(screen.getByText(copy.seeds.save.published)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.seeds.save.publish })).toBeNull();
  });

  it('says to wait a minute when sign-in emails are rate limited', async () => {
    otpStatus = 429;
    renderAt('/seeds?save=dust%3Av3%3Aabc');
    await settle();
    fireEvent.change(screen.getByLabelText(copy.me.emailLabel), { target: { value: 'player@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: copy.me.send }));
    await settle();
    expect(screen.getByText(copy.me.tooMany)).toBeTruthy();
  });
});

describe('the gallery', () => {
  it('reads the score from the answer', () => {
    expect(scoreFrom({ up: 4, down: 1 })).toBe(3);
    expect(scoreFrom({ up: 4 })).toBeNull();
    expect(scoreFrom(null)).toBeNull();
  });

  it('shows the score the RPC answered with after a press, never the gallery figure plus the press', async () => {
    signIn();
    gallery['/api/community/seeds?sort=trending'] = { items: [seedItem('s1', 3, 0)], next: null };
    renderAt('/seeds');
    await settle();
    const group = screen.getByRole('group', { name: copy.seeds.scoreLabel.replace('{title}', 'Run s1') });
    expect(within(group).getByText('3')).toBeTruthy();
    // The cached gallery already counted this player's upvote: the server's figures stay 3 up.
    tally = { up: 3, down: 0 };
    fireEvent.click(within(group).getByRole('button', { name: copy.seeds.up }));
    await settle();
    expect(sent.find((s) => s.url.endsWith('vote_seed'))?.body).toEqual({ id: 's1', value: 1 });
    expect(within(group).getByRole('button', { name: copy.seeds.up }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByText('3')).toBeTruthy();
    tally = { up: 2, down: 1 };
    fireEvent.click(within(group).getByRole('button', { name: copy.seeds.down }));
    await settle();
    expect(sent.filter((s) => s.url.endsWith('vote_seed')).at(-1)?.body).toEqual({ id: 's1', value: -1 });
    expect(within(group).getByRole('button', { name: copy.seeds.down }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByText('1')).toBeTruthy();
  });

  it('shows more seeds with the cursor', async () => {
    gallery['/api/community/seeds?sort=trending'] = { items: [seedItem('s1', 1, 0)], next: 'n1' };
    gallery['/api/community/seeds?sort=trending&cursor=n1'] = { items: [seedItem('s2', 1, 0)], next: null };
    renderAt('/seeds');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: copy.seeds.more }));
    await settle();
    expect(screen.getByText('Run s1')).toBeTruthy();
    expect(screen.getByText('Run s2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.seeds.more })).toBeNull();
  });

  it('offers Try again when the gallery did not load, and reads it again', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => json(503, { error: 'down' }));
    renderAt('/seeds');
    await settle();
    expect(screen.getByText(copy.emptyState.retry)).toBeTruthy();
    gallery['/api/community/seeds?sort=trending'] = { items: [seedItem('s1', 1, 0)], next: null };
    fireEvent.click(screen.getByRole('button', { name: copy.emptyState.tryAgain }));
    await settle();
    expect(screen.getByText('Run s1')).toBeTruthy();
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
