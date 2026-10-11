import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { NotFound } from './NotFound';

afterEach(() => {
  cleanup();
});

describe('NotFound', () => {
  it('asks search engines not to index it while drawn, and removes the ask when it goes', () => {
    const view = render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
    view.unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });
});
