import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FACES } from '../lib/cards';
import { COLOUR_PAIRS, COLOUR_TOKENS } from '../lib/colour';
import { copy } from '../lib/copy';
import { pageNav, pageRoutes } from '../routes';
import { Guide, GUIDE_PATH } from './Guide';

beforeEach(() => {
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
  vi.stubEnv('VITE_PLAY_URL', 'https://play.example');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function renderGuide() {
  return render(
    <MemoryRouter>
      <Guide />
    </MemoryRouter>,
  );
}

describe('the design guide', () => {
  it('is routed on its unlisted path, with no top bar link', () => {
    expect(GUIDE_PATH).toMatch(/^\/[a-z0-9-]+$/);
    expect(pageRoutes.map((route) => route.path)).toContain(GUIDE_PATH);
    expect(pageNav.map((item) => item.to)).not.toContain(GUIDE_PATH);
  });

  it('asks search engines not to index it while it is open', () => {
    renderGuide();
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow');
    cleanup();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('is three bands, and every card sits in the second', () => {
    const { container } = renderGuide();
    const bands = [...container.querySelectorAll('main > *')];
    expect(bands.map((band) => band.className)).toEqual(['band', 'band', 'band']);
    const cards = [...container.querySelectorAll('li.card, .funding-bar')];
    expect(cards.length).toBeGreaterThan(8);
    for (const card of cards) expect(card.closest('main > .band')).toBe(bands[1]);
  });

  it('draws the card in all nine faces, in two groups by anatomy, each noted and labelled Sample', () => {
    const { container } = renderGuide();
    const gallery = screen.getByRole('region', { name: copy.guide.cardsHeading });
    const faces = [...gallery.querySelectorAll('li.card')].map((card) => card.getAttribute('data-face'));
    expect(faces).toEqual(['open', 'picked', 'funded', 'paused', 'planned', 'building', 'checks', 'live', 'rejected']);
    expect([...faces].sort()).toEqual([...FACES].sort());
    expect(gallery.querySelectorAll('ul.card-grid')).toHaveLength(2);
    expect(gallery.querySelectorAll('.face-notes .sample-label')).toHaveLength(FACES.length);
    expect(container.querySelector('.tag-stamp')).not.toBeNull();
  });

  it('shows every colour token and every pairing from lib/colour.ts, and the colour rules', () => {
    renderGuide();
    const colour = screen.getByRole('region', { name: copy.guide.colourHeading });
    for (const { name } of COLOUR_TOKENS) expect(within(colour).getAllByText(name).length).toBeGreaterThan(0);
    const lists = colour.querySelectorAll('ul.swatches');
    expect(lists[0]?.children).toHaveLength(COLOUR_TOKENS.length);
    expect(lists[1]?.children).toHaveLength(COLOUR_PAIRS.length);
    expect(lists[1]?.querySelectorAll('[data-banned="true"]')).toHaveLength(COLOUR_PAIRS.filter((pair) => pair.banned).length);
    for (const rule of [...copy.guide.rulesDo, ...copy.guide.rulesDont]) expect(within(colour).getByText(rule)).toBeTruthy();
  });

  it('shows the funding bar at 5, 50 and 100 per cent', () => {
    renderGuide();
    const bars = screen.getByRole('region', { name: copy.guide.barHeading }).querySelectorAll('[role="progressbar"]');
    expect([...bars].map((bar) => bar.getAttribute('aria-valuenow'))).toEqual(['5', '50', '100']);
  });

  it('never links a sample card to the Payment Link', () => {
    const { container } = renderGuide();
    expect(container.innerHTML).not.toContain('buy.stripe.com');
    expect(container.innerHTML).not.toContain('client_reference_id');
    expect(screen.getAllByRole('link', { name: copy.contribute }).every((link) => link.getAttribute('href') === '/contribute')).toBe(true);
  });

  it('has a Play button for each moment: the deal, the fund tick, the flip and the slam', () => {
    renderGuide();
    for (const name of [copy.guide.playDeal, copy.guide.playFundTick, copy.guide.playFlip, copy.guide.playSlam]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });
});
