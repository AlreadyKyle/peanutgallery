import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { copy } from './lib/copy';
import { SourceProvider } from './lib/studio';

function renderAt(path: string) {
  return render(
    <SourceProvider source={null}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </SourceProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_DISCORD_INVITE', '');
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
  vi.stubEnv('VITE_LAUNCH_AT', '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('App routes', () => {
  it('renders the landing page at the root', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: copy.studioName })).toBeTruthy();
  });

  it('renders the ledger page', () => {
    renderAt('/ledger');
    expect(screen.getByRole('heading', { level: 1, name: 'Ledger' })).toBeTruthy();
  });

  it('reports an unknown address with a link back to the studio page', () => {
    renderAt('/no-such-page');
    expect(screen.getByRole('heading', { level: 1, name: 'Not found' })).toBeTruthy();
    expect(screen.getByText('There is no page at this address.')).toBeTruthy();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: 'Studio' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('heading', { level: 1, name: copy.studioName })).toBeNull();
  });
});
