import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../lib/community-types';
import { copy } from '../lib/copy';
import { Me, nextUnlock, profileUpdate } from './Me';

// /me: the desk (docs/specs/place.md) shows the player's cards, ideas, badges and what the next level
// opens, and Keep this card claims the payment once signed in; the "show my name" box starts from the player's own setting and is sent only when changed; an
// expired magic link says so and leaves the address; a rate-limited link says to wait a minute.

type Sent = { url: string; body: unknown };
let sent: Sent[] = [];
let otpStatus = 200;
let profile: Profile;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeProfile(publicByDefault: boolean | undefined): Profile {
  return {
    handle: 'pat',
    displayName: 'Pat',
    level: 1,
    avatar: { body: 'round', eyes: 'two', antennae: 'none', pattern: 'plain', fill: 'coin' },
    frame: null,
    flair: null,
    xp: 0,
    tier: 'Rookie',
    nextLevelXp: 10,
    badges: [],
    collection: [],
    seeds: [],
    suggestions: [],
    joinedAt: '2026-10-01T00:00:00Z',
    ...(publicByDefault === undefined ? {} : { publicByDefault }),
  };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderMe(path = '/me') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Me />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sent = [];
  otpStatus = 200;
  profile = makeProfile(false);
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === '/api/community/rpc/my_profile') return json(200, profile);
      if (url === '/api/community/rpc/update_profile') return json(200, profile);
      if (url === '/api/community/rpc/claim_contributions') return json(200, { claimed: 1 });
      if (url === '/api/community/rpc/my_follows') return json(200, { follows: [], open: 0, cap: 100 });
      if (url === '/api/community/auth/otp') return otpStatus === 200 ? json(200, { sent: true }) : json(otpStatus, { error: 'slow down' });
      return json(404, { error: 'unknown' });
    }),
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('profileUpdate', () => {
  const fields = { name: ' Pat ', avatar: makeProfile(true).avatar, frame: '', flair: '', publicDefault: false };

  it('leaves public_by_default out when the box is as my_profile said', () => {
    expect(profileUpdate(makeProfile(false), fields)).toEqual({ display_name: 'Pat', avatar: fields.avatar, frame: null, flair: null });
  });

  it('sends public_by_default when the player changed the box', () => {
    expect(profileUpdate(makeProfile(true), fields).public_by_default).toBe(false);
    expect(profileUpdate(makeProfile(false), { ...fields, publicDefault: true }).public_by_default).toBe(true);
  });
});

describe('nextUnlock', () => {
  it('names the next level that opens an avatar option, and what it opens', () => {
    expect(nextUnlock(1)).toEqual({ level: 3, options: ['small body', 'one large eye', 'two antennae', 'lavender colour'] });
    expect(nextUnlock(4)?.level).toBe(5);
    expect(nextUnlock(99)).toBeNull();
  });
});

const signIn = (refresh: string) =>
  window.localStorage.setItem('mm:player-session', JSON.stringify({ accessToken: `tok-${refresh}`, refreshToken: refresh, expiresAt: Date.now() + 3_600_000 }));

describe('/me', () => {
  it("opens on the player's desk: their cards, ideas and badges before the editor", async () => {
    signIn('desk-1');
    profile = {
      ...makeProfile(true),
      collection: [{ cardId: 'c1', title: 'A backed card', suit: 'game', rarity: 'rare', cents: 500 }],
      suggestions: [
        { id: 's1', area: 'dust', title: 'A pitched idea', summary: null, state: 'drafted', declineReason: null, upvotes: 3, clusterId: null, cardId: null, author: null, createdAt: '2026-10-01T00:00:00Z' },
      ],
      badges: [{ id: 'b1', name: 'First card', rule: 'Funded a first card.', glyph: 'badge', awardedAt: '2026-10-01T00:00:00Z' }],
    };
    renderMe();
    await settle();
    expect(screen.getByRole('link', { name: 'A backed card' }).getAttribute('href')).toBe('/card/c1');
    expect(screen.getByText('A pitched idea')).toBeTruthy();
    expect(screen.getByText('3 upvotes')).toBeTruthy();
    expect(screen.getByText('First card')).toBeTruthy();
    expect(screen.getByText(copy.desk.nextUnlocks.replace('{n}', '3').replace('{parts}', 'small body, one large eye, two antennae, lavender colour'))).toBeTruthy();
    const order = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(order.indexOf(copy.desk.cardsTitle)).toBeLessThan(order.indexOf(copy.me.editTitle));
    expect(order.indexOf(copy.desk.ideasTitle)).toBeLessThan(order.indexOf(copy.me.editTitle));
  });

  it('says what a profile gives when signed out, and claims at once when Keep this card lands signed in', async () => {
    renderMe('/me?keep=1');
    await settle();
    expect(screen.getByRole('heading', { name: copy.perks.keepTitle })).toBeTruthy();
    expect(screen.getByText(copy.perks.profile[0]!)).toBeTruthy();
    expect(window.localStorage.getItem('mm:pending-claim')).toBe('1');
    cleanup();
    signIn('keep-1');
    renderMe('/me?keep=1');
    await settle();
    await settle();
    expect(sent.filter((s) => s.url.endsWith('/claim_contributions'))).toHaveLength(1);
    expect(screen.getByText(copy.desk.claimed)).toBeTruthy();
  });

  it('starts the box from the player setting and saving a name keeps it off', async () => {
    signIn('ref-1');
    renderMe();
    await settle();
    const box = screen.getByLabelText(copy.me.publicLabel) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.change(screen.getByLabelText(copy.me.nameLabel), { target: { value: 'Patty' } });
    fireEvent.click(screen.getByRole('button', { name: copy.me.save }));
    await settle();
    const update = sent.find((s) => s.url.endsWith('update_profile'))?.body as Record<string, unknown>;
    expect(update.display_name).toBe('Patty');
    expect('public_by_default' in update).toBe(false);
  });

  it('says an expired link expired, and clears the error from the address', async () => {
    window.history.replaceState(null, '', '/me#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    renderMe();
    await settle();
    expect(screen.getByRole('alert').textContent).toBe(copy.me.linkExpired);
    expect(window.location.hash).toBe('');
  });

  it('says to wait a minute when sign-in emails are rate limited', async () => {
    otpStatus = 429;
    renderMe();
    await settle();
    fireEvent.change(screen.getByLabelText(copy.me.emailLabel), { target: { value: 'player@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: copy.me.send }));
    await settle();
    expect(screen.getByText(copy.me.tooMany)).toBeTruthy();
    expect(screen.queryByText(copy.me.closed)).toBeNull();
  });
});
