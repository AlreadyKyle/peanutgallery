import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../lib/copy';
import { RARITY_XP_MULTIPLIER } from '../lib/rarity';
import { XP_PER_DOLLAR } from '../lib/xp';
import { KeepThisCard, Perks } from './Perks';

// What a contribution gets you (docs/specs/place.md): the panel states only perks that exist, with the
// figures the XP rules use, and paying never needs an account.

afterEach(cleanup);

describe('Perks', () => {
  it('states the XP rate the XP rules use, and that rare cards give more', () => {
    expect(copy.perks.profile[0]).toBe(`${XP_PER_DOLLAR} XP for every dollar, more on rare cards.`);
    expect(RARITY_XP_MULTIPLIER.rare).toBeGreaterThan(RARITY_XP_MULTIPLIER.common);
  });

  it('lists the guest and profile perks, says paying needs no account, and offers a free profile', () => {
    render(
      <MemoryRouter>
        <Perks />
      </MemoryRouter>,
    );
    for (const line of [...copy.perks.guest, ...copy.perks.profile]) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText(copy.perks.note)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.perks.signIn }).getAttribute('href')).toBe('/me');
  });

  it('leaves out the profile link for a signed-in player', () => {
    render(
      <MemoryRouter>
        <Perks signIn={false} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('sends Keep this card to the desk, which claims the payment once signed in', () => {
    render(
      <MemoryRouter>
        <KeepThisCard />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: copy.perks.keepTitle })).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.perks.keep }).getAttribute('href')).toBe('/me?keep=1');
  });
});
