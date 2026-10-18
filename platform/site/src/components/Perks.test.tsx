import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../lib/copy';
import { RARITY_XP_MULTIPLIER } from '../lib/rarity';
import { resetSignInOpen } from '../lib/sign-in';
import { XP_PER_DOLLAR } from '../lib/xp';
import { KeepThisCard, Perks } from './Perks';

// What a contribution gets you (docs/specs/place.md): the panel states only perks that exist, with the
// figures the XP rules use, and paying never needs an account. While sign-in is closed it keeps to the
// guest side and Keep this card hides.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetSignInOpen();
  window.localStorage.clear();
});

/** The community function's answer to whether email sign-in is open. */
function signInIs(open: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ signIn: open }), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
}

describe('Perks', () => {
  it('states the XP rate the XP rules use, and that rarer cards give more', () => {
    expect(copy.perks.profile[0]).toBe(`${XP_PER_DOLLAR} XP for every dollar, more on rarer cards.`);
    expect(RARITY_XP_MULTIPLIER.rare).toBeGreaterThan(RARITY_XP_MULTIPLIER.common);
  });

  it('lists the guest and profile perks, says paying needs no account, and can offer a free profile', async () => {
    signInIs(true);
    render(
      <MemoryRouter>
        <Perks signIn />
      </MemoryRouter>,
    );
    for (const line of [...copy.perks.guest, ...copy.perks.profile]) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText(copy.perks.note)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.perks.signIn }).getAttribute('href')).toBe('/me');
    expect(screen.getByRole('region', { name: copy.perks.title })).toBeTruthy();
  });

  it('leaves out the profile link by default, as on the pages where people pay', () => {
    signInIs(true);
    render(
      <MemoryRouter>
        <Perks />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps to the guest side while sign-in is closed', async () => {
    signInIs(false);
    render(
      <MemoryRouter>
        <Perks signIn />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(copy.perks.noteClosed)).toBeTruthy());
    for (const line of copy.perks.guest) expect(screen.getByText(line)).toBeTruthy();
    for (const line of copy.perks.profile) expect(screen.queryByText(line)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('sends Keep this card to the desk, which claims the payment once signed in', () => {
    signInIs(true);
    render(
      <MemoryRouter>
        <KeepThisCard />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: copy.perks.keepTitle })).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.perks.keep }).getAttribute('href')).toBe('/me?keep=1');
  });

  it('draws no Keep this card while sign-in is closed', async () => {
    signInIs(false);
    const { container } = render(
      <MemoryRouter>
        <KeepThisCard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector('.perks-keep')).toBeNull());
  });
});
