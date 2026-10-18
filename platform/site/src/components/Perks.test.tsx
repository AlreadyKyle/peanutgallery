import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legal } from '../lib/legal';
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
    expect(legal.perks.profile[0]).toBe(`${XP_PER_DOLLAR} XP for every dollar, more on rarer cards.`);
    expect(RARITY_XP_MULTIPLIER.rare).toBeGreaterThan(RARITY_XP_MULTIPLIER.common);
  });

  it('lists the guest and profile perks and says paying needs no account, with no link, as on the pages where people pay', async () => {
    signInIs(true);
    render(
      <MemoryRouter>
        <Perks />
      </MemoryRouter>,
    );
    // A first visit draws the profile side once the studio says sign-in is open.
    expect(await screen.findByText(legal.perks.profile[0]!)).toBeTruthy();
    for (const line of [...legal.perks.guest, ...legal.perks.profile]) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText(legal.perks.note)).toBeTruthy();
    expect(screen.getByRole('region', { name: legal.perks.title })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps to the guest side while sign-in is closed', async () => {
    signInIs(false);
    render(
      <MemoryRouter>
        <Perks />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(legal.perks.noteClosed)).toBeTruthy());
    for (const line of legal.perks.guest) expect(screen.getByText(line)).toBeTruthy();
    for (const line of legal.perks.profile) expect(screen.queryByText(line)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('sends Keep this card to the desk, which claims the payment once signed in', async () => {
    signInIs(true);
    render(
      <MemoryRouter>
        <KeepThisCard />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: legal.perks.keepTitle })).toBeTruthy();
    expect(screen.getByRole('link', { name: legal.perks.keep }).getAttribute('href')).toBe('/me?keep=1');
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
