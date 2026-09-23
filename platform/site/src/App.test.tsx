import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { strayNetlifyHosts } from '../scripts/board-address.mjs';
import { App } from './App';
import { copy } from './lib/copy';
import { legal } from './lib/legal';
import type { Snapshot, StudioSource } from './lib/source';
import { SourceProvider } from './lib/studio';

const snapshot: Snapshot = {
  pool: {
    balance_usd: 48.56,
    reserve_usd: 7.1,
    incident_reserve_usd: 2.56,
    held_usd: 0,
    daily_spent_usd: 0,
    day: '2026-09-14',
  },
  cards: [],
  funding: {},
  launchedAt: null,
  paused: false,
  totals: { usd_total: 1.25, input_tokens: 12000, cached_tokens: 3000, output_tokens: 800, row_count: 3 },
  events: [],
  deploys: [],
  roles: [],
  cardTitles: {},
  missing: [],
};

function renderAt(path: string, source: StudioSource | null = null) {
  return render(
    <SourceProvider source={source}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </SourceProvider>,
  );
}

function nav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Site' });
}

beforeEach(() => {
  vi.stubEnv('VITE_DISCORD_INVITE', '');
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
  vi.stubEnv('VITE_PLAY_URL', '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('App routes', () => {
  it('renders the landing page at the root', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: copy.pitchTitle })).toBeTruthy();
  });

  it('renders the ledger page with its lede', () => {
    renderAt('/ledger');
    expect(screen.getByRole('heading', { level: 1, name: 'Ledger' })).toBeTruthy();
    expect(screen.getByText(legal.ledgerLede)).toBeTruthy();
  });

  it('renders How it works, the team and the roadmap, each with one h1 that names the tab', () => {
    for (const [path, title] of [
      ['/how-it-works', copy.howItWorksPage.title],
      ['/team', copy.team.title],
      ['/roadmap', copy.roadmap.title],
    ] as const) {
      renderAt(path);
      expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent), path).toEqual([title]);
      expect(document.title).toBe(`${title} · ${copy.studioName}`);
      cleanup();
    }
  });

  it('reports an unknown address with a link back home', () => {
    renderAt('/no-such-page');
    expect(screen.getByRole('heading', { level: 1, name: copy.notFound })).toBeTruthy();
    expect(screen.getByText(copy.notFoundBody)).toBeTruthy();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: copy.home }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('heading', { level: 1, name: copy.pitchTitle })).toBeNull();
  });
});

const TEXT_PAGES = [
  { path: '/terms', page: legal.terms, dated: true },
  { path: '/privacy', page: legal.privacy, dated: true },
  { path: '/refunds', page: legal.refunds, dated: true },
  { path: '/contact', page: legal.contact, dated: false },
] as const;

describe('Terms, Privacy, Refunds and Contact', () => {
  for (const { path, page, dated } of TEXT_PAGES) {
    it(`renders ${path} as a text page: one h1, the lede, every section and no unreplaced token`, () => {
      renderAt(path);
      expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([page.title]);
      const main = screen.getByRole('main');
      expect(main.classList.contains('wide')).toBe(false);
      expect(main.classList.contains('text-page')).toBe(true);
      expect(within(main).getByText(page.lede)).toBeTruthy();
      expect(within(main).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(
        page.sections.map((section) => section.heading),
      );
      for (const section of page.sections) {
        expect(within(main).getByRole('region', { name: section.heading })).toBeTruthy();
      }
      expect(main.textContent).not.toMatch(/[{}]/);
      // The pages go to the board for review, but nothing public says draft.
      expect(main.textContent).not.toMatch(/draft/i);
      expect(within(main).queryAllByText(legal.legalUpdated)).toHaveLength(dated ? 1 : 0);
      expect(screen.queryByText(copy.pitchBody)).toBeNull();
    });
  }

  it('links the contact address as mailto on Terms, Privacy, Refunds and Contact', () => {
    for (const { path } of TEXT_PAGES) {
      renderAt(path);
      const mail = within(screen.getByRole('main')).getAllByRole('link', { name: legal.contactEmail });
      expect(mail.length, path).toBeGreaterThan(0);
      for (const link of mail) expect(link.getAttribute('href')).toBe(`mailto:${legal.contactEmail}`);
      cleanup();
    }
  });

  it('names the operator on Terms and links Terms to the Refunds page', () => {
    renderAt('/terms');
    expect(screen.getByText('Peanut Gallery is operated by Kyle Smith, an individual in Ontario, Canada.')).toBeTruthy();
    expect(within(screen.getByRole('main')).getByRole('link', { name: legal.refundsPageLink }).getAttribute('href')).toBe(
      '/refunds',
    );
  });

  it('adds the Discord section to Contact only when the invite is set', () => {
    renderAt('/contact');
    expect(screen.queryByRole('heading', { level: 2, name: legal.contact.discordSection.heading })).toBeNull();
    cleanup();
    vi.stubEnv('VITE_DISCORD_INVITE', 'https://discord.gg/invite-code');
    renderAt('/contact');
    const discord = screen.getByRole('region', { name: legal.contact.discordSection.heading });
    expect(within(discord).getByRole('link', { name: copy.discord }).getAttribute('href')).toBe(
      'https://discord.gg/invite-code',
    );
  });
});

describe('Site chrome', () => {
  it('links Terms, Privacy, Refunds and Contact in the footer of every page', () => {
    for (const path of ['/', '/ledger', '/contribute', '/how-it-works', '/team', '/roadmap', '/terms', '/contact', '/board', '/no-such-page']) {
      renderAt(path);
      const footer = screen.getByRole('contentinfo');
      const links = within(footer)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]);
      expect(links, path).toEqual([
        [legal.footerLinks.terms, '/terms'],
        [legal.footerLinks.privacy, '/privacy'],
        [legal.footerLinks.refunds, '/refunds'],
        [legal.footerLinks.contact, '/contact'],
        [copy.createdByName, copy.createdByUrl],
      ]);
      cleanup();
    }
  });

  it('shows the wordmark linking home, the Ledger link, the pitch line and the footer line', () => {
    renderAt('/');
    const banner = screen.getByRole('banner');
    const wordmark = within(banner).getByRole('link', { name: copy.studioName });
    expect(wordmark.getAttribute('href')).toBe('/');
    const mark = wordmark.querySelector('img.mark');
    expect(mark?.getAttribute('src')).toBe('/peanut.png');
    expect(mark?.getAttribute('alt')).toBe('');
    expect(within(nav()).queryByRole('link', { name: copy.home })).toBeNull();
    expect(within(nav()).getByRole('link', { name: 'Ledger' }).getAttribute('href')).toBe('/ledger');
    expect(
      within(nav())
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      [copy.howItWorksNav, '/how-it-works'],
      [copy.teamNav, '/team'],
      [copy.roadmapNav, '/roadmap'],
      [legal.ledger, '/ledger'],
    ]);
    expect(screen.getByText(copy.pitchBody)).toBeTruthy();
    expect(within(screen.getByRole('contentinfo')).getByText(copy.footer)).toBeTruthy();
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: copy.createdByName }).getAttribute('href')).toBe(copy.createdByUrl);
  });

  it('shows the pitch line on the landing only', () => {
    renderAt('/ledger');
    expect(screen.queryByText(copy.pitchBody)).toBeNull();
  });

  it('has no board page: /board is the plain not found page, with no sign-in form and no link to the board site', () => {
    // Built as production builds it: the top bar's Play link names the game's netlify.app address on
    // every page, /board included, and that is the only netlify.app address allowed.
    const playUrl = readFileSync(resolve(process.cwd(), 'netlify.toml'), 'utf8').match(/^\s*VITE_PLAY_URL\s*=\s*"([^"]+)"/m)?.[1] ?? '';
    const playHost = new URL(playUrl).host;
    expect(playHost).toMatch(/\.netlify\.app$/);
    vi.stubEnv('VITE_PLAY_URL', playUrl);
    for (const path of ['/board', '/board/']) {
      renderAt(path);
      expect(screen.getByRole('heading', { level: 1, name: copy.notFound }), path).toBeTruthy();
      expect(screen.queryByRole('heading', { level: 1, name: 'Board' }), path).toBeNull();
      expect(screen.queryByRole('form', { name: 'Sign in' }), path).toBeNull();
      expect(screen.queryByLabelText('Email'), path).toBeNull();
      expect(within(nav()).getByRole('link', { name: copy.play }).getAttribute('href'), path).toBe(playUrl);
      expect(strayNetlifyHosts(document.body.innerHTML, [playHost]), path).toEqual([]);
      cleanup();
    }
  });

  it('omits the Contribute and Discord links when the env values are unset', () => {
    renderAt('/');
    expect(screen.queryByRole('link', { name: copy.contribute })).toBeNull();
    expect(screen.queryByRole('link', { name: copy.discord })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Board' })).toBeNull();
  });

  it('links Contribute in the nav and Discord in the nav and footer when the env values are set', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
    vi.stubEnv('VITE_DISCORD_INVITE', 'https://discord.gg/invite-code');
    renderAt('/');
    expect(within(nav()).getByRole('link', { name: copy.contribute }).getAttribute('href')).toBe('/contribute');
    expect(within(nav()).getByRole('link', { name: copy.discord }).getAttribute('href')).toBe(
      'https://discord.gg/invite-code',
    );
    expect(
      within(screen.getByRole('contentinfo')).getByRole('link', { name: copy.discord }).getAttribute('href'),
    ).toBe('https://discord.gg/invite-code');
    expect(screen.queryByRole('link', { name: 'Board' })).toBeNull();
  });

  it('links Play in the nav only when the play URL is set', () => {
    renderAt('/');
    expect(screen.queryByRole('link', { name: copy.play })).toBeNull();
    cleanup();
    vi.stubEnv('VITE_PLAY_URL', 'https://play.example');
    renderAt('/');
    expect(within(nav()).getByRole('link', { name: copy.play }).getAttribute('href')).toBe(
      'https://play.example',
    );
  });

  it('loads the snapshot once for the whole page tree', async () => {
    let loads = 0;
    renderAt('/', {
      load: () => {
        loads += 1;
        return Promise.resolve(snapshot);
      },
      subscribe: () => () => {},
    });
    // The StudioProvider loads once; the meter and every card read the shared snapshot.
    await waitFor(() => expect(screen.getAllByText('$48.56').length).toBeGreaterThan(0));
    expect(loads).toBe(1);
  });

  it('shows no pool figure in the top bar', () => {
    renderAt('/', { load: () => Promise.resolve(snapshot), subscribe: () => () => {} });
    expect(within(screen.getByRole('banner')).queryByText('$48.56')).toBeNull();
  });
});
