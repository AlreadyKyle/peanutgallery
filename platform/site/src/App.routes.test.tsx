import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, cardRoutes, KERNEL_SEGMENTS } from './App';
import { copy } from './lib/copy';
import { legal } from './lib/legal';

// App.tsx is kernel and routes.tsx is the card lane's (docs/specs/board-site.md). A routes.tsx that
// tries to take a kernel page's path, /board or every path, or to link the top bar to another host,
// changes nothing: the kernel's pages and the not found page still answer.
vi.mock('./routes', async () => {
  const { createElement } = await import('react');
  const page = (title: string) => createElement('h1', null, title);
  return {
    pageRoutes: [
      { path: '/ledger', element: page('Card ledger') },
      { path: '/Contribute', element: page('Card contribute') },
      { path: '/refunds/', element: page('Card refunds') },
      { path: 'terms', element: page('Card terms') },
      { path: '/board', element: page('Card board') },
      { path: '/:slug', element: page('Card slug') },
      { path: '/ledger?', element: page('Card optional ledger') },
      { path: '*', element: page('Card catch-all') },
      { path: '/extra', element: page('Card extra page') },
    ],
    pageNav: [
      { to: '/extra', label: 'Extra' },
      { to: 'https://buy.stripe.com/evil', label: 'Pay here' },
      { to: '//paypal.me/evil', label: 'Pay there' },
      { to: '/\\paypal.me/evil', label: 'Pay elsewhere' },
    ],
  };
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

function h1(): string[] {
  return screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent ?? '');
}

beforeEach(() => {
  vi.stubEnv('VITE_DISCORD_INVITE', '');
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test_link');
  vi.stubEnv('VITE_PLAY_URL', '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('the kernel frame and the card lane routes', () => {
  it('keeps the Contribute, Ledger and legal pages on their paths whatever routes.tsx declares', () => {
    const pages: [string, string][] = [
      ['/ledger', legal.ledger],
      ['/contribute', legal.contributeTitle],
      ['/terms', legal.terms.title],
      ['/privacy', legal.privacy.title],
      ['/refunds', legal.refunds.title],
      ['/contact', legal.contact.title],
    ];
    for (const [path, title] of pages) {
      renderAt(path);
      expect(h1(), path).toEqual([title]);
      cleanup();
    }
  });

  it('answers /board and an unknown path with the not found page, not a card catch-all', () => {
    for (const path of ['/board', '/board/x', '/no-such-page/x']) {
      renderAt(path);
      expect(h1(), path).toEqual([copy.notFound]);
      cleanup();
    }
  });

  it('mounts a card page on a plain path of its own', () => {
    renderAt('/extra');
    expect(h1()).toEqual(['Card extra page']);
  });

  it('links the top bar to a card page only by a plain path on this site', () => {
    renderAt('/extra');
    const nav = screen.getByRole('navigation', { name: 'Site' });
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    // The wordmark home, Contribute, then the Menu list: the card page and the kernel's Ledger.
    expect(hrefs).toEqual(['/', '/contribute', '/extra', '/ledger']);
  });
});

describe('cardRoutes', () => {
  it('drops a kernel path in any case or spelling, /board, and a dynamic, optional or catch-all first segment', () => {
    const element = null;
    const paths = ['/', '/team', '/how-it-works', '/roadmap/next', '/ledger', '/LEDGER', 'contribute', '/terms/', '//privacy', '/refunds/x', '/contact',
      '/board', '/:slug', '/ledger?', '/*', '*', '/%6Cedger', ''];
    expect(cardRoutes(paths.map((path) => ({ path, element }))).map((route) => route.path)).toEqual(['/', '/team', '/how-it-works', '/roadmap/next']);
    expect(KERNEL_SEGMENTS).toEqual(['contribute', 'ledger', 'terms', 'privacy', 'refunds', 'contact', 'board']);
  });
});
