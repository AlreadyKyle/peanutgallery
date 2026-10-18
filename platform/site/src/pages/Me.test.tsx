import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../lib/community-types';
import { copy } from '../lib/copy';
import { Me, profileUpdate } from './Me';

// /me: the "show my name" box starts from the player's own setting and is sent only when changed; an
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

function renderMe() {
  return render(
    <MemoryRouter initialEntries={['/me']}>
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

describe('/me', () => {
  it('starts the box from the player setting and saving a name keeps it off', async () => {
    window.localStorage.setItem('mm:player-session', JSON.stringify({ accessToken: 'tok-1', refreshToken: 'ref-1', expiresAt: Date.now() + 3_600_000 }));
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
