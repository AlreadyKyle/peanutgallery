import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { strayNetlifyHosts } from '../scripts/board-address.mjs';
import { App, CartridgeMark } from './App';
import { Glyph } from './components/Glyph';
import { copy } from './lib/copy';
import { legal } from './lib/legal';
import type { Snapshot, StudioSource } from './lib/source';
import { resetSignInOpen } from './lib/sign-in';
import { NEWEST_TERMS } from './lib/terms-versions';
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

  it('renders How it works and the team, each with one h1 that names the tab', () => {
    for (const [path, title] of [
      ['/how-it-works', copy.howItWorksPage.title],
      ['/team', copy.team.title],
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

// With no database in the unit run, Terms and Refunds show the newest version in the bundle with
// the notice that the version in force cannot be confirmed (src/pages/Legal.test.tsx covers every
// state of the versions read).
const TEXT_PAGES = [
  { path: '/terms', page: NEWEST_TERMS.terms, footer: null },
  { path: '/privacy', page: legal.privacy, footer: legal.privacyUpdated },
  { path: '/refunds', page: NEWEST_TERMS.refunds, footer: null },
  { path: '/contact', page: legal.contact, footer: null },
] as const;

describe('Terms, Privacy, Refunds and Contact', () => {
  for (const { path, page, footer } of TEXT_PAGES) {
    it(`renders ${path} as a text page: one h1, the lede, every section and no unreplaced token`, async () => {
      renderAt(path);
      await waitFor(() => expect(screen.queryByText(legal.termsLoading)).toBeNull());
      const main = screen.getByRole('main');
      expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([page.title]);
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
      expect(within(main).queryAllByText(legal.privacyUpdated)).toHaveLength(footer === null ? 0 : 1);
      expect(screen.queryByText(copy.pitchBody)).toBeNull();
    });
  }

  it('links the contact address as mailto on Terms, Privacy, Refunds and Contact', async () => {
    for (const { path } of TEXT_PAGES) {
      renderAt(path);
      await waitFor(() => expect(screen.queryByText(legal.termsLoading)).toBeNull());
      const mail = within(screen.getByRole('main')).getAllByRole('link', { name: legal.contactEmail });
      expect(mail.length, path).toBeGreaterThan(0);
      for (const link of mail) expect(link.getAttribute('href')).toBe(`mailto:${legal.contactEmail}`);
      cleanup();
    }
  });

  it('names the operator on Terms and links Terms to the Refunds page', async () => {
    renderAt('/terms');
    await waitFor(() => expect(screen.queryByText(legal.termsLoading)).toBeNull());
    const main = screen.getByRole('main');
    const operator = within(main).getByText((_, element) =>
      element?.tagName === 'P' && (element.textContent ?? '').startsWith('Mob Machine is operated by Kyle Smith, an individual in Ontario, Canada.'),
    );
    expect(within(operator).getByRole('link', { name: legal.contactEmail })).toBeTruthy();
    expect(within(main).getAllByRole('link', { name: legal.refundsPageLink })[0]!.getAttribute('href')).toBe('/refunds');
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

describe('the you slot', () => {
  // The slot is the card lane's code (routes.tsx), so the kernel's own pages draw the bar without it,
  // however the address is spelt (docs/specs/place.md).
  it('is in the top bar on a card page and absent on every kernel page', () => {
    renderAt('/faq');
    expect(document.querySelector('.you-slot')).not.toBeNull();
    for (const path of ['/contribute', '/Contribute/', '/%63ontribute', '/th%61nks?session=x', '/ledger', '/terms', '/privacy', '/refunds', '/contact']) {
      cleanup();
      renderAt(path);
      expect(document.querySelector('.you-slot'), path).toBeNull();
    }
  });
});

describe('Site chrome', () => {
  // docs/specs/final-state.md adds the studio's history and the player's own page to the footer.
  it('links Weekly reports, the feed, the community pages, Terms, Privacy, Refunds and Contact in the footer of every page', async () => {
    for (const path of ['/', '/ledger', '/contribute', '/how-it-works', '/team', '/roadmap', '/reports', '/terms', '/contact', '/board', '/no-such-page']) {
      renderAt(path);
      const footer = screen.getByRole('contentinfo');
      // Your desk waits for the studio's answer on whether sign-in is open (lib/sign-in.ts).
      await waitFor(() => expect(within(footer).getByRole('link', { name: copy.nav.me })).toBeTruthy());
      const links = within(footer)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]);
      expect(links, path).toEqual([
        [copy.reportsNav, '/reports'],
        [copy.feedLink, '/feed.xml'],
        [copy.nav.history, '/studio/history'],
        [copy.nav.suggest, '/suggest'],
        [copy.nav.seeds, '/seeds'],
        [copy.nav.goals, '/goals'],
        [copy.nav.me, '/me'],
        [legal.footerLinks.terms, '/terms'],
        [legal.footerLinks.privacy, '/privacy'],
        [legal.footerLinks.refunds, '/refunds'],
        [legal.footerLinks.contact, '/contact'],
        [copy.createdByName, copy.createdByUrl],
      ]);
      cleanup();
    }
  });

  it('shows the wordmark linking home, the Ledger link, the pitch line and the footer line', async () => {
    renderAt('/');
    // The you slot waits for the studio's answer on whether sign-in is open (lib/sign-in.ts).
    await waitFor(() => expect(within(nav()).getByRole('link', { name: copy.you.signIn })).toBeTruthy());
    const banner = screen.getByRole('banner');
    const wordmark = within(banner).getByRole('link', { name: copy.studioName });
    expect(wordmark.getAttribute('href')).toBe('/');
    // The mark is decorative inline SVG in the text colour, the same drawing as brand/mark.svg.
    const mark = wordmark.querySelector('svg.mark');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(mark?.querySelector('path')?.getAttribute('fill')).toBe('currentColor');
    const source = readFileSync(resolve(process.cwd(), 'brand/mark.svg'), 'utf8');
    expect(source).toContain(`d="${mark?.querySelector('path')?.getAttribute('d')}"`);
    expect(source).toContain(`viewBox="${mark?.getAttribute('viewBox')}"`);
    expect(source).toContain('fill="currentColor"');
    expect(within(nav()).queryByRole('link', { name: copy.home })).toBeNull();
    expect(within(nav()).getByRole('link', { name: 'Ledger' }).getAttribute('href')).toBe('/ledger');
    expect(
      within(nav())
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      [copy.studioName, '/'],
      // The you slot (docs/specs/place.md): Sign in for a visitor, the player's desk once signed in.
      [copy.you.signIn, '/me'],
      // The top bar keeps to what a first visit needs, Ideas first in the links since players pitch there;
      // goals and seeds are in the footer (docs/specs/brand.md, the second review).
      [copy.nav.suggest, '/suggest'],
      [copy.teamNav, '/team'],
      [copy.howItWorksNav, '/how-it-works'],
      [copy.nav.faq, '/faq'],
      [legal.ledger, '/ledger'],
      // The menu's own way to the desk, shown on phones where the slot keeps to the avatar.
      [copy.nav.me, '/me'],
    ]);
    expect(screen.getByText(copy.pitchBody)).toBeTruthy();
    expect(within(screen.getByRole('contentinfo')).getByText(`${copy.footer} ${legal.allAges}`)).toBeTruthy();
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: copy.createdByName }).getAttribute('href')).toBe(copy.createdByUrl);
  });

  it('keeps Ideas in the top bar and the footer while sign-in is closed, and drops the footer\'s Your desk', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        String(input) === '/api/community/auth/settings'
          ? new Response(JSON.stringify({ signIn: false }), { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }),
      ),
    );
    // Forget an answer an earlier test's render asked for, so this page asks the stub.
    resetSignInOpen();
    try {
      renderAt('/faq');
      await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/community/auth/settings', expect.anything()));
      await waitFor(() => expect(window.localStorage.getItem('mm:sign-in-open')).toBe('0'));
      const hrefs = (root: HTMLElement) => within(root).getAllByRole('link').map((link) => link.getAttribute('href'));
      expect(hrefs(nav())).toContain('/suggest');
      expect(hrefs(nav())).not.toContain('/me');
      expect(hrefs(nav())).toContain('/team');
      const footer = screen.getByRole('contentinfo');
      expect(hrefs(footer)).toContain('/suggest');
      expect(hrefs(footer)).not.toContain('/me');
    } finally {
      resetSignInOpen();
      window.localStorage.clear();
      vi.unstubAllGlobals();
    }
  });

  it('shows the pitch line on the landing only', () => {
    renderAt('/ledger');
    expect(screen.queryByText(copy.pitchBody)).toBeNull();
  });

  it('has no board page: /board is the plain not found page, with no sign-in form and no link to the board site', () => {
    // Built as production builds it: the top bar's Play link names the game's own address on every
    // page, /board included (play.mobmachine.games, PLAN.md §10 decision 59), so no page names any
    // netlify.app address.
    const playUrl = readFileSync(resolve(process.cwd(), 'netlify.toml'), 'utf8').match(/^\s*VITE_PLAY_URL\s*=\s*"([^"]+)"/m)?.[1] ?? '';
    const playHost = new URL(playUrl).host;
    expect(playHost).toBe('play.mobmachine.games');
    vi.stubEnv('VITE_PLAY_URL', playUrl);
    for (const path of ['/board', '/board/']) {
      renderAt(path);
      expect(screen.getByRole('heading', { level: 1, name: copy.notFound }), path).toBeTruthy();
      expect(screen.queryByRole('heading', { level: 1, name: 'Board' }), path).toBeNull();
      expect(screen.queryByRole('form', { name: 'Sign in' }), path).toBeNull();
      expect(screen.queryByLabelText('Email'), path).toBeNull();
      for (const play of within(nav()).getAllByRole('link', { name: copy.play })) expect(play.getAttribute('href'), path).toBe(playUrl);
      expect(strayNetlifyHosts(document.body.innerHTML, []), path).toEqual([]);
      cleanup();
    }
  });

  it('omits the Contribute and Discord links when the env values are unset', () => {
    renderAt('/');
    expect(screen.queryByRole('link', { name: copy.contribute })).toBeNull();
    expect(screen.queryByRole('link', { name: copy.discord })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Board' })).toBeNull();
  });

  it('links Contribute in the nav and Discord in the footer when the env values are set', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
    vi.stubEnv('VITE_DISCORD_INVITE', 'https://discord.gg/invite-code');
    renderAt('/');
    expect(within(nav()).getByRole('link', { name: copy.contribute }).getAttribute('href')).toBe('/contribute');
    expect(within(nav()).queryByRole('link', { name: copy.discord })).toBeNull();
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
    // In the row, and in the Menu list for screens below 22.5rem (styles.css shows one of the two).
    const plays = within(nav()).getAllByRole('link', { name: copy.play });
    expect(plays.map((a) => [a.getAttribute('href'), a.className])).toEqual([
      ['https://play.example', 'button button-secondary nav-play'],
      ['https://play.example', ''],
    ]);
    expect(plays[1]!.closest('li')?.className).toBe('menu-play');
  });

  it('opens and closes the Menu: aria-expanded follows it, and Escape closes it and returns focus', () => {
    renderAt('/');
    const button = within(nav()).getByRole('button', { name: copy.menu });
    const list = document.getElementById('site-menu')!;
    expect(button.getAttribute('aria-controls')).toBe('site-menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(list.hasAttribute('data-open')).toBe(false);
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(list.getAttribute('data-open')).toBe('true');
    const link = within(list).getByRole('link', { name: copy.teamNav });
    link.focus();
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('opens a linked page at the top, not at the last page\'s scroll position', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    renderAt('/how-it-works');
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.click(within(nav()).getByRole('link', { name: legal.ledger }));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockRestore();
  });

  it('draws the Play cartridge exactly as the game suit glyph', () => {
    const kernel = render(<CartridgeMark />).container.innerHTML;
    cleanup();
    const lane = render(<Glyph name="cartridge" />).container.innerHTML;
    expect(kernel).toBe(lane);
  });

  it('puts every page on bands: each direct child of main is a band', () => {
    for (const path of ['/', '/ledger', '/contribute', '/how-it-works', '/team', '/roadmap', '/terms', '/privacy', '/refunds', '/contact', '/no-such-page']) {
      renderAt(path);
      const children = [...screen.getByRole('main').children];
      expect(children.length, path).toBeGreaterThanOrEqual(2);
      expect(children.every((child) => child.classList.contains('band')), path).toBe(true);
      cleanup();
    }
  });

  it('loads the snapshot once for the whole page tree', async () => {
    let loads = 0;
    renderAt('/', {
      load: () => {
        loads += 1;
        return Promise.resolve(snapshot);
      },
    });
    // The StudioProvider loads once; the meter and every card read the shared snapshot.
    await waitFor(() => expect(screen.getAllByText('$48.56').length).toBeGreaterThan(0));
    expect(loads).toBe(1);
  });

  it('shows no pool figure in the top bar', () => {
    renderAt('/', { load: () => Promise.resolve(snapshot) });
    expect(within(screen.getByRole('banner')).queryByText('$48.56')).toBeNull();
  });
});
